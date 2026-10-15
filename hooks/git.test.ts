import { test, expect } from 'claude-code/testing'

import { heldBy, parseBranches, parseStashList, parseStatus, parseWorktrees } from './git'

const STATUS = [
  '# branch.oid efc8060aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb git-graph/hooks/pane.tsx',
  '1 M. N... 100644 100644 100644 aaa bbb git-graph/hooks/register.tsx',
  '1 MM N... 100644 100644 100644 aaa bbb git-graph/types/index.d.ts',
  '1 A. N... 000000 100644 100644 000 bbb git-graph/hooks/changes.ts',
  '1 .D N... 100644 100644 000000 aaa 000 git-graph/hooks/old.ts',
  '2 R. N... 100644 100644 100644 aaa aaa R100 docs/new name.md',
  'docs/old.md',
  'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/clash.ts',
  '? git-graph/hooks/changes.test.ts',
  '? docs/café.md',
  '? say "hi" \\ there.md',
  '',
].join('\0')

test('parseStatus reads the branch, counts and each file with its staged and unstaged halves', () => {
  const status = parseStatus(STATUS)
  expect(status.oid).toBe('efc8060aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  expect(status.branch).toBe('main')
  expect(status.upstream).toBe('origin/main')
  expect(status.ahead).toBe(2)
  expect(status.behind).toBe(1)
  expect(status.files).toEqual([
    { path: 'git-graph/hooks/pane.tsx', status: 'M', isStaged: false, isUnstaged: true },
    { path: 'git-graph/hooks/register.tsx', status: 'M', isStaged: true, isUnstaged: false },
    { path: 'git-graph/types/index.d.ts', status: 'M', isStaged: true, isUnstaged: true, treeStatus: 'M' },
    { path: 'git-graph/hooks/changes.ts', status: 'A', isStaged: true, isUnstaged: false },
    { path: 'git-graph/hooks/old.ts', status: 'D', isStaged: false, isUnstaged: true },
    { path: 'docs/new name.md', status: 'R', isStaged: true, isUnstaged: false, orig: 'docs/old.md' },
    { path: 'src/clash.ts', status: 'C', isStaged: false, isUnstaged: true },
    { path: 'git-graph/hooks/changes.test.ts', status: 'U', isStaged: false, isUnstaged: true },
    // `-z` output is never C-quoted, so a non-ASCII name, quotes and backslashes come through as typed.
    { path: 'docs/café.md', status: 'U', isStaged: false, isUnstaged: true },
    { path: 'say "hi" \\ there.md', status: 'U', isStaged: false, isUnstaged: true },
  ])
})

test('parseStatus reads a detached HEAD and a branch with no upstream', () => {
  const status = parseStatus('# branch.oid abc\0# branch.head (detached)\0')
  expect(status).toEqual({ oid: 'abc', branch: '', upstream: null, ahead: 0, behind: 0, files: [] })
  expect(parseStatus('# branch.oid abc\0# branch.head feature\0').upstream).toBe(null)
})

test('parseStashList reads each stash with its shortstat line after it', () => {
  const out = 'stash@{0}\x1fa1b2c3d\x1fOn main: wip words\x1e\n\n 2 files changed, 10 insertions(+)\nstash@{1}\x1fe4f5a6b\x1fWIP on main: 9c1d2e4 Draw ref chips\x1e\n\n 1 file changed, 1 deletion(-)\n'
  expect(parseStashList(out)).toEqual([
    { index: 0, hash: 'a1b2c3d', message: 'On main: wip words', files: 2 },
    { index: 1, hash: 'e4f5a6b', message: 'WIP on main: 9c1d2e4 Draw ref chips', files: 1 },
  ])
  expect(parseStashList('')).toEqual([])
})

test('parseBranches reads git for-each-ref one short name per line', () => {
  expect(parseBranches('feature\nmain\n')).toEqual(['feature', 'main'])
  expect(parseBranches('')).toEqual([])
  expect(parseBranches('\n  main  \n')).toEqual(['main'])
})

test('parseWorktrees reads the main checkout, a branch, a detached session worktree and a missing one, and marks this pane\'s own', () => {
  const out = [
    'worktree /r/repo', 'HEAD aaa', 'branch refs/heads/main', '',
    'worktree /r/repo/.claude/worktrees/hist-1', 'HEAD bbb', 'detached', '',
    'worktree /r/side', 'HEAD ccc', 'branch refs/heads/feature/x', 'locked', '',
    'worktree /r/gone', 'HEAD ddd', 'branch refs/heads/stale', 'prunable gitdir file points to non-existent location', '',
  ].join('\0')
  const trees = parseWorktrees(out, '/r/side\n')
  expect(trees.map(t => [t.folder, t.branch, t.head, t.isMain, t.isHere, t.isSession, t.isGone])).toEqual([
    ['repo', 'main', 'aaa', true, false, false, false],
    ['hist-1', null, 'bbb', false, false, true, false],
    ['side', 'feature/x', 'ccc', false, true, false, false],
    ['gone', 'stale', 'ddd', false, false, false, true],
  ])
  // This pane's own branch is never held elsewhere; another worktree's is.
  expect(heldBy(trees, 'feature/x')).toBeNull()
  expect(heldBy(trees, 'main')?.folder).toBe('repo')
  expect(heldBy(trees, 'nope')).toBeNull()
  expect(parseWorktrees('', '/r')).toEqual([])
})
