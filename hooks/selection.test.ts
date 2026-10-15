import { test, expect } from 'claude-code/testing'

import type { ChangedFile } from '../types'
import { allPaths, commitCommands, groupFiles, pathsOf, pruneTicked, stageCommand, stashCommand, tickedFiles, toggleAll, toggleTick, unstageCommand } from './selection'

const f = (path: string, isStaged: boolean, isUnstaged: boolean, extra: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: 'M', isStaged, isUnstaged, ...extra })

const files = [f('a.ts', true, false), f('b.ts', false, true), f('c.ts', true, true, { treeStatus: 'M' }), f('new.md', true, false, { status: 'R', orig: 'old.md' }), f('u.txt', false, true, { status: 'U' })]

test('groupFiles splits Staged Changes from Changes, and a file edited since it was staged is in both', () => {
  const { staged, changes } = groupFiles(files)
  expect(staged.map(file => file.path)).toEqual(['a.ts', 'c.ts', 'new.md'])
  expect(changes.map(file => file.path)).toEqual(['b.ts', 'c.ts', 'u.txt'])
})

test('tickedFiles keeps the files that are ticked and still changed, in file order', () => {
  expect(tickedFiles(files, ['u.txt', 'a.ts', 'gone.ts']).map(file => file.path)).toEqual(['a.ts', 'u.txt'])
  expect(tickedFiles(files, [])).toEqual([])
})

test('allPaths ticks every changed file, as after a commit leaves the rest', () => {
  expect(allPaths(files)).toEqual(['a.ts', 'b.ts', 'c.ts', 'new.md', 'u.txt'])
  expect(allPaths([])).toEqual([])
})

test('pathsOf names a renamed file by both names, or its deletion would stay behind', () => {
  expect(pathsOf([files[0]!, files[3]!])).toEqual(['a.ts', 'new.md', 'old.md'])
})

test('toggleTick flips one path, toggleAll ticks every file unless every file is ticked, pruneTicked drops what is gone', () => {
  expect(toggleTick(['a.ts'], 'b.ts')).toEqual(['a.ts', 'b.ts'])
  expect(toggleTick(['a.ts', 'b.ts'], 'a.ts')).toEqual(['b.ts'])
  expect(toggleAll(files, ['a.ts'])).toEqual(['a.ts', 'b.ts', 'c.ts', 'new.md', 'u.txt'])
  expect(toggleAll(files, ['a.ts', 'b.ts', 'c.ts', 'new.md', 'u.txt'])).toEqual([])
  expect(toggleAll([], [])).toEqual([])
  expect(pruneTicked(['a.ts', 'gone.ts', 'u.txt'], files)).toEqual(['a.ts', 'u.txt'])
})

test('commitCommands adds the ticked files as they are now, then commits exactly those paths and nothing else that is staged', () => {
  expect(commitCommands('Fix it', files, ['b.ts', 'new.md'])).toEqual([
    ['git', 'add', '--', 'b.ts', 'new.md', 'old.md'],
    ['git', 'commit', '-m', 'Fix it', '--', 'b.ts', 'new.md', 'old.md'],
  ])
  // The message is trimmed; nothing ticked, nothing to run.
  expect(commitCommands('  Fix it \n', files, ['b.ts'])![1]).toEqual(['git', 'commit', '-m', 'Fix it', '--', 'b.ts'])
  expect(commitCommands('Fix it', files, [])).toBe(null)
  expect(commitCommands('Fix it', files, ['gone.ts'])).toBe(null)
})

test('stageCommand adds what is ticked, unstageCommand takes files out of the index naming both halves of a rename', () => {
  expect(stageCommand(files, ['b.ts', 'u.txt'])).toEqual(['git', 'add', '--', 'b.ts', 'u.txt'])
  expect(stageCommand(files, [])).toBe(null)
  expect(unstageCommand([files[0]!, files[3]!])).toEqual(['git', 'restore', '--staged', '--', 'a.ts', 'new.md', 'old.md'])
  expect(unstageCommand([])).toBe(null)
})

test('stashCommand shelves the ticked files, everything when none or all are ticked, named by the message', () => {
  expect(stashCommand('', files, ['b.ts'])).toEqual(['git', 'stash', 'push', '-u', '--', 'b.ts'])
  expect(stashCommand('wip', files, ['b.ts', 'u.txt'])).toEqual(['git', 'stash', 'push', '-u', '-m', 'wip', '--', 'b.ts', 'u.txt'])
  expect(stashCommand('', files, [])).toEqual(['git', 'stash', 'push', '-u'])
  expect(stashCommand('', files, ['a.ts', 'b.ts', 'c.ts', 'new.md', 'u.txt'])).toEqual(['git', 'stash', 'push', '-u'])
})
