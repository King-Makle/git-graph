import { test, expect } from 'claude-code/testing'

import { abortCommand, actionCommand, describeAction, diffCommand, discardCommands, inverseOf, isUndoValid, rejected, syncCommand } from './actions'
import type { ChangedFile } from '../types'
import { refChips } from './chips'
import { githubUrl, pushedHashes } from './detail'
import { parseCommitFiles } from './diff'
import { parseBranchList } from './git'
import { diffstatSplit } from './svg'

test('refChips makes the chips: the HEAD branch, locals, folded remotes, tags, then +N with an icon per kind it folds', () => {
  const chips = refChips([
    'HEAD -> claude/claude-mods-desktop-plugins-09d282',
    'origin/main',
    'origin/HEAD',
    'main',
    'claude/ai-agent-referral-page-252794',
    'origin/claude/ai-agent-referral-page-252794',
    'tag: v1',
  ])
  expect(chips).toEqual([
    { kind: 'head', label: 'claude/claude-mod…', title: 'claude/claude-mods-desktop-plugins-09d282', isRemote: false },
    { kind: 'local', label: 'main', title: 'main', isRemote: true },
    { kind: 'more', label: '+2', title: 'claude/ai-agent-referral-page-252794, v1', isRemote: false, hidden: ['branch', 'tag'] },
  ])
})

test('refChips folds the checked-out branch\'s remote into its chip, as any local branch\'s', () => {
  expect(refChips(['HEAD -> main', 'origin/main', 'tag: v1']).map(chip => [chip.kind, chip.label, chip.isRemote])).toEqual([['head', 'main', true], ['tag', 'v1', false]])
})

test('refChips keeps a lone remote and a tag as their own kinds', () => {
  expect(refChips(['origin/feature', 'tag: v2'])).toEqual([
    { kind: 'remote', label: 'origin/feature', title: 'origin/feature', isRemote: true },
    { kind: 'tag', label: 'v2', title: 'v2', isRemote: false },
  ])
})

test('githubUrl turns an https or ssh origin into a commit link', () => {
  expect(githubUrl('https://github.com/King-Makle/all-mite.git', 'abc')).toBe('https://github.com/King-Makle/all-mite/commit/abc')
  expect(githubUrl('git@github.com:King-Makle/all-mite.git', 'abc')).toBe('https://github.com/King-Makle/all-mite/commit/abc')
  expect(githubUrl('https://gitlab.com/x/y.git', 'abc')).toBe(null)
  expect(githubUrl('', 'abc')).toBe(null)
})

test('pushedHashes is everything reachable from an origin ref, so a local-only commit gets no GitHub link', () => {
  const c = (hash: string, parents: string[], refs: string[] = []) => ({ hash, parents, refs, author: '', date: '', when: '', subject: '', stat: '' })
  const commits = [c('d', ['c'], ['HEAD -> main']), c('c', ['b'], ['feature']), c('b', ['a'], ['origin/main']), c('a', [])]
  expect([...pushedHashes(commits)].sort()).toEqual(['a', 'b'])
  expect(pushedHashes([c('x', [])]).size).toBe(0)
})

test('parseCommitFiles joins -z numstat and name-status: a rename under its new path, a binary file without counts', () => {
  // Captured from `git show -z --numstat --format=` and `--name-status` of a commit that renames, deletes a binary and edits.
  const numstat = '0\t0\t\x00old.txt\x00dir/new.txt\x00-\t-\timg.bin\x002\t1\tkeep.ts\x00'
  const nameStatus = 'R100\x00old.txt\x00dir/new.txt\x00D\x00img.bin\x00M\x00keep.ts\x00'
  expect(parseCommitFiles(numstat, nameStatus)).toEqual([
    { path: 'dir/new.txt', status: 'R', added: 0, deleted: 0 },
    { path: 'img.bin', status: 'D', added: null, deleted: null },
    { path: 'keep.ts', status: 'M', added: 2, deleted: 1 },
  ])
  expect(parseCommitFiles('', '')).toEqual([])
})

test('diffstatSplit gives five squares as GitHub does, at least one for each side with lines', () => {
  expect(diffstatSplit(4, 2)).toEqual({ green: 3, red: 2 })
  expect(diffstatSplit(100, 1)).toEqual({ green: 4, red: 1 })
  expect(diffstatSplit(1, 100)).toEqual({ green: 1, red: 4 })
  expect(diffstatSplit(7, 0)).toEqual({ green: 5, red: 0 })
  expect(diffstatSplit(0, 0)).toEqual({ green: 0, red: 0 })
})

test('refChips takes a narrower cap and clip for a narrow pane', () => {
  const chips = refChips(['HEAD -> claude/claude-mods-desktop-plugins-09d282', 'main', 'origin/feature'], 1, 12)
  expect(chips.map(c => c.label)).toEqual(['claude/clau…', '+2'])
  // A local branch and a branch only origin has: one branch icon and one cloud.
  expect(chips[1]?.hidden).toEqual(['branch', 'cloud'])
})

test('actionCommand spells each action as a git argv', () => {
  const h = '4de3aefbd8b53f4811b38b52f91b9f748350bcdc'
  expect(actionCommand({ kind: 'checkout', hash: h }, '')).toEqual({ argv: ['git', 'checkout', h] })
  expect(actionCommand({ kind: 'branch', hash: h }, 'fix/thing')).toEqual({ argv: ['git', 'checkout', '-b', 'fix/thing', h] })
  expect(actionCommand({ kind: 'cherry-pick', hash: h }, '')).toEqual({ argv: ['git', 'cherry-pick', h] })
  expect(actionCommand({ kind: 'reset', hash: h }, '')).toEqual({ argv: ['git', 'reset', '--soft', h] })
  expect(actionCommand({ kind: 'revert', hash: h }, '')).toEqual({ argv: ['git', 'revert', '--no-edit', h] })
  expect(actionCommand({ kind: 'revert', hash: h }, '', true)).toEqual({ argv: ['git', 'revert', '--no-edit', '-m', '1', h] })
  expect(actionCommand({ kind: 'merge', hash: h }, '')).toEqual({ argv: ['git', 'merge', '--no-edit', h] })
  expect(actionCommand({ kind: 'rebase', hash: h }, '')).toEqual({ argv: ['git', 'rebase', h] })
  expect(actionCommand({ kind: 'tag', hash: h }, 'v1.2')).toEqual({ argv: ['git', 'tag', 'v1.2', h] })
  expect(actionCommand({ kind: 'delete-branch', hash: h, target: 'old' }, '')).toEqual({ argv: ['git', 'branch', '-d', 'old'] })
  expect(actionCommand({ kind: 'rename-branch', hash: h, target: 'old' }, 'new')).toEqual({ argv: ['git', 'branch', '-m', 'old', 'new'] })
})

test('actionCommand refuses a name git would refuse, for branches and tags', () => {
  const h = '4de3aefbd8b53f4811b38b52f91b9f748350bcdc'
  expect(actionCommand({ kind: 'branch', hash: h }, '')).toEqual({ error: 'Type a branch name first.' })
  // Spaces become hyphens, as the confirm line shows while typing.
  expect(actionCommand({ kind: 'branch', hash: h }, ' has  space ')).toEqual({ argv: ['git', 'checkout', '-b', 'has-space', h] })
  expect(actionCommand({ kind: 'tag', hash: h }, 'Tag Test')).toEqual({ argv: ['git', 'tag', 'Tag-Test', h] })
  expect(actionCommand({ kind: 'tag', hash: h }, '')).toEqual({ error: 'Type a tag name first.' })
  expect(actionCommand({ kind: 'tag', hash: h }, 'a..b')).toEqual({ error: 'Tag names cannot contain "..", "~", "^", ":", "?", "*", "[" or a backslash, or start with "-" or ".".' })
  expect(actionCommand({ kind: 'rename-branch', hash: h, target: 'old' }, '')).toEqual({ error: 'Type a branch name first.' })
})

test('abortCommand names the abort for the actions that can stop on a conflict', () => {
  expect(abortCommand('cherry-pick')).toEqual(['git', 'cherry-pick', '--abort'])
  expect(abortCommand('revert')).toEqual(['git', 'revert', '--abort'])
  expect(abortCommand('merge')).toEqual(['git', 'merge', '--abort'])
  expect(abortCommand('rebase')).toEqual(['git', 'rebase', '--abort'])
  expect(abortCommand('checkout')).toBe(null)
  expect(abortCommand('tag')).toBe(null)
})

test('describeAction says what the confirm will do, naming the current branch', () => {
  const h = '4de3aefbd8b53f4811b38b52f91b9f748350bcdc'
  expect(describeAction({ kind: 'checkout', hash: h }, '', 'main')).toBe('Check out 4de3aef as a detached HEAD?')
  expect(describeAction({ kind: 'branch', hash: h }, 'fix/thing', 'main')).toBe('Create branch fix/thing at 4de3aef and switch to it?')
  expect(describeAction({ kind: 'cherry-pick', hash: h }, '', 'main')).toBe('Cherry-pick 4de3aef onto main?')
  expect(describeAction({ kind: 'reset', hash: h }, '', 'main')).toBe('Move main to 4de3aef, keeping the changes since as staged?')
  expect(describeAction({ kind: 'revert', hash: h }, '', 'main')).toBe('Revert 4de3aef with a new commit on main?')
  expect(describeAction({ kind: 'merge', hash: h }, '', 'main')).toBe('Merge 4de3aef into main?')
  expect(describeAction({ kind: 'rebase', hash: h }, '', 'main')).toBe('Rebase main onto 4de3aef?')
  expect(describeAction({ kind: 'tag', hash: h }, 'v1', 'main')).toBe('Tag 4de3aef as v1?')
  expect(describeAction({ kind: 'tag', hash: h }, 'flash is gone', 'main')).toBe('Tag 4de3aef as flash-is-gone?')
  expect(describeAction({ kind: 'delete-branch', hash: h, target: 'old' }, '', 'main')).toBe('Delete branch old? Git refuses if it is not merged.')
  expect(describeAction({ kind: 'rename-branch', hash: h, target: 'old' }, 'new', 'main')).toBe('Rename old to new?')
})

test('inverseOf covers the new actions', () => {
  const ctx = { headHash: 'abc1234', branch: 'main', name: 'v1', target: 'old' }
  expect(inverseOf('revert', ctx)).toEqual({ label: 'revert', argv: [['git', 'reset', '--keep', 'HEAD~1']] })
  expect(inverseOf('merge', ctx)).toEqual({ label: 'merge', argv: [['git', 'reset', '--keep', 'abc1234']] })
  expect(inverseOf('rebase', ctx)).toEqual({ label: 'rebase', argv: [['git', 'reset', '--keep', 'abc1234']] })
  expect(inverseOf('tag', ctx)).toEqual({ label: 'tag', argv: [['git', 'tag', '-d', 'v1']] })
  expect(inverseOf('rename-branch', ctx)).toEqual({ label: 'rename', argv: [['git', 'branch', '-m', 'v1', 'old']] })
  expect(inverseOf('delete-branch', ctx)).toBe(null)
})

const changed = (path: string, status: ChangedFile['status'], isStaged: boolean, isUnstaged = !isStaged): ChangedFile => ({ path, status, isStaged, isUnstaged })

test('discardCommands restores a tracked file, deletes an untracked one, and unstages then deletes a staged new file', () => {
  expect(discardCommands(changed('a.ts', 'M', true))).toEqual([['git', 'restore', '--staged', '--worktree', '--', 'a.ts']])
  expect(discardCommands(changed('a.ts', 'D', false))).toEqual([['git', 'restore', '--staged', '--worktree', '--', 'a.ts']])
  expect(discardCommands(changed('new.ts', 'U', false))).toEqual([['git', 'clean', '-f', '--', 'new.ts']])
  expect(discardCommands(changed('new.ts', 'A', true))).toEqual([['git', 'restore', '--staged', '--', 'new.ts'], ['git', 'clean', '-f', '--', 'new.ts']])
  // A rename restores both names, or the old file would stay deleted.
  expect(discardCommands({ ...changed('new.md', 'R', true), orig: 'old.md' })).toEqual([['git', 'restore', '--staged', '--worktree', '--', 'new.md', 'old.md']])
})

test('diffCommand compares a tracked file with HEAD, so both staged and unstaged halves show, and an untracked file with nothing', () => {
  expect(diffCommand(changed('a.ts', 'M', true, true))).toEqual(['git', 'diff', 'HEAD', '--', 'a.ts'])
  expect(diffCommand(changed('new.ts', 'U', false))).toEqual(['git', 'diff', '--no-index', '--', '/dev/null', 'new.ts'])
})

test('syncCommand fetches with prune, pulls fast-forward only, and sets the upstream on a first push', () => {
  const tracked = { ahead: 1, behind: 0, upstream: 'origin/main', busy: null, note: null }
  expect(syncCommand('fetch', tracked, 'main')).toEqual(['git', 'fetch', '--prune'])
  expect(syncCommand('pull', tracked, 'main')).toEqual(['git', 'pull', '--ff-only'])
  expect(syncCommand('push', tracked, 'main')).toEqual(['git', 'push'])
  expect(syncCommand('push', { ...tracked, upstream: null }, 'feature')).toEqual(['git', 'push', '-u', 'origin', 'feature'])
})

test('inverseOf spells the command that puts the last action back', () => {
  const ctx = { headHash: 'abc1234', branch: 'main', name: 'fix/x', target: '' }
  expect(inverseOf('commit', ctx)).toEqual({ label: 'commit', argv: [['git', 'reset', '--soft', 'HEAD~1']] })
  expect(inverseOf('reset', ctx)).toEqual({ label: 'reset', argv: [['git', 'reset', '--soft', 'abc1234']] })
  expect(inverseOf('checkout', ctx)).toEqual({ label: 'checkout', argv: [['git', 'checkout', 'main']] })
  expect(inverseOf('checkout', { ...ctx, branch: '' })).toEqual({ label: 'checkout', argv: [['git', 'checkout', 'abc1234']] })
  expect(inverseOf('branch', ctx)).toEqual({ label: 'branch', argv: [['git', 'checkout', 'main'], ['git', 'branch', '-D', 'fix/x']] })
  expect(inverseOf('cherry-pick', ctx)).toEqual({ label: 'cherry-pick', argv: [['git', 'reset', '--keep', 'HEAD~1']] })
  expect(inverseOf('pull', ctx)).toEqual({ label: 'pull', argv: [['git', 'reset', '--keep', 'abc1234']] })
  expect(inverseOf('stash', ctx)).toEqual({ label: 'stash', argv: [['git', 'stash', 'pop']] })
})

test('isUndoValid holds only while HEAD is where the action left it', () => {
  const record = { label: 'commit', argv: [['git', 'reset', '--soft', 'HEAD~1']], expectHead: 'def5678' }
  expect(isUndoValid(record, 'def5678')).toBe(true)
  expect(isUndoValid(record, 'abc1234')).toBe(false)
  expect(isUndoValid(null, 'def5678')).toBe(false)
  // A stash undo also wants the pane's own stash on top, or it would pop someone else's.
  const stashed = { label: 'stash', argv: [['git', 'stash', 'pop']], expectHead: 'def5678', expectStash: 's111111' }
  expect(isUndoValid(stashed, 'def5678', 's111111')).toBe(true)
  expect(isUndoValid(stashed, 'def5678', 's222222')).toBe(false)
  expect(isUndoValid(stashed, 'def5678', '')).toBe(false)
  expect(isUndoValid(record, 'def5678', 's222222')).toBe(true)
})

test('rejected turns a process that could not run into a failed result with its reason', () => {
  expect(rejected(new Error('timed out after 120000 ms'))).toEqual({ exitCode: -1, stdout: '', stderr: 'timed out after 120000 ms' })
  expect(rejected('boom')).toEqual({ exitCode: -1, stdout: '', stderr: 'boom' })
})

test('inverseOf a branch switch checks the previous branch out again, or the hash when it was detached', () => {
  expect(inverseOf('switch', { headHash: 'abc', branch: 'main', name: 'feature', target: '' })).toEqual({ label: 'switch', argv: [['git', 'checkout', 'main']] })
  expect(inverseOf('switch', { headHash: 'abc', branch: '', name: 'feature', target: '' })).toEqual({ label: 'switch', argv: [['git', 'checkout', 'abc']] })
})


test('parseBranchList puts the branch you are on first, then the newest, with merged and gone marked', () => {
  const line = (name: string, unix: number, upstream = '', track = '') => [name, `${name}-tip`, '3 days ago', String(unix), upstream, track].join('\x1f')
  const out = [line('old', 100), line('main', 50, 'origin/main', '[ahead 2]'), line('new', 300, 'origin/new', '[gone]')].join('\n') + '\n'
  const list = parseBranchList(out, 'main\nold\n', 'main')
  expect(list.map(b => b.name)).toEqual(['main', 'new', 'old'])
  expect(list[1]).toEqual({ name: 'new', hash: 'new-tip', age: '3d', time: 300, upstream: 'origin/new', isGone: true, isMerged: false })
  expect(list[2]?.isMerged).toBe(true)
})

test('a forced delete is -D, and a delete can be undone at the tip it removed', () => {
  expect(actionCommand({ kind: 'delete-branch', hash: 'h', target: 'wip', force: true }, '')).toEqual({ argv: ['git', 'branch', '-D', 'wip'] })
  expect(inverseOf('delete-branch', { headHash: 'x', branch: 'main', name: '', target: 'wip', hash: 'abc' })).toEqual({ label: 'delete', argv: [['git', 'branch', 'wip', 'abc']] })
  expect(inverseOf('delete-branch', { headHash: 'x', branch: 'main', name: '', target: 'wip' })).toBe(null)
})
