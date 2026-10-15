import { test, expect } from 'claude-code/testing'

import type { ChangedFile } from '../types'
import { clashLabel, dirtyPaths, findClashes, incomingFilesCommand, parseHashes, parseNameOnly } from './incoming'

test('parseHashes reads one hash per line and drops anything else', () => {
  const full = 'ffff0000ffff0000ffff0000ffff0000ffff0000'
  expect(parseHashes(`abc1234\n\n${full}\nnot a hash\nfatal: bad revision\n`)).toEqual(['abc1234', full])
})

test('parseHashes of nothing is nothing, so a branch with no upstream draws no band', () => {
  expect(parseHashes('')).toEqual([])
})

test('parseNameOnly maps each incoming commit to the files it changes; a merge lists none', () => {
  const out = '\x1eaaa\n\ngit-graph/hooks/pane.tsx\ndocs/a b.md\ndocs/café.md\n\x1ebbb\n\nREADME.md\n\x1eccc\n'
  expect(parseNameOnly(out)).toEqual({ aaa: ['git-graph/hooks/pane.tsx', 'docs/a b.md', 'docs/café.md'], bbb: ['README.md'], ccc: [] })
  expect(parseNameOnly('')).toEqual({})
})

test('dirtyPaths names a renamed file by both paths, so either side of a rename clashes', () => {
  const file = (path: string, orig?: string): ChangedFile => ({ path, status: 'M', isStaged: false, isUnstaged: true, ...(orig === undefined ? {} : { orig }) })
  expect(dirtyPaths([file('a.ts'), file('new name.md', 'old name.md')])).toEqual(['a.ts', 'new name.md', 'old name.md'])
})

test('findClashes keeps only the incoming files the working tree also changed, and only commits that clash', () => {
  const files = { aaa: ['git-graph/hooks/pane.tsx', 'other.ts'], bbb: ['README.md'] }
  expect(findClashes(files, ['git-graph/hooks/pane.tsx', 'docs/a b.md'])).toEqual({ aaa: ['git-graph/hooks/pane.tsx'] })
  expect(findClashes({ aaa: ['docs/a b.md'] }, ['docs/a b.md'])).toEqual({ aaa: ['docs/a b.md'] })
  expect(findClashes(files, [])).toEqual({})
})

test('clashLabel names the first file by its base name and counts the rest', () => {
  expect(clashLabel(['git-graph/hooks/pane.tsx'])).toBe('⚠ touches your pane.tsx')
  expect(clashLabel(['git-graph/hooks/pane.tsx', 'a.ts', 'b.ts'])).toBe('⚠ touches your pane.tsx +2')
})

test('incomingFilesCommand lists a renamed file by both paths, so an incoming rename of a file you are editing clashes', () => {
  expect(incomingFilesCommand()).toEqual(['git', '-c', 'core.quotepath=off', 'log', '--no-renames', 'HEAD..@{u}', '--name-only', '--format=%x1e%H'])
  // With renames off, git lists the old path as a deletion and the new one as an addition.
  const files = parseNameOnly('\x1eaaa\n\nold name.md\nnew name.md\n')
  expect(findClashes(files, ['old name.md'])).toEqual({ aaa: ['old name.md'] })
})
