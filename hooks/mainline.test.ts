import { test, expect } from 'claude-code/testing'

import type { Commit } from '../types'
import { MAIN_FORMAT, buildMainRows, mainLogCommand, mergeTitle, needsOlderDiffMerges, parseMainLog, parseMergeAuthors, parseMergeCommits, parseShortstat, prMerge } from './mainline'

const RECORD = (hash: string, parents: string, subject: string, body = '') => `${hash}\x1f${parents}\x1f\x1fKing\x1f2 days ago\x1fOctober 2, 2026 at 9:25 PM\x1f${subject}\x1f${body}\x1e`

test('parseMainLog reads each first-parent entry with its body and the shortstat line after it', () => {
  const out = RECORD('m1', 'a1 b1', 'Merge pull request #34 from King-Makle/claude/phase-6s', 'Phase 6s: the suite\n') + '\n\n 27 files changed, 420 insertions(+), 88 deletions(-)\n' + RECORD('a1', 'z0', 'Plain commit') + '\n\n 1 file changed, 2 insertions(+)\n'
  const entries = parseMainLog(out)
  expect(entries.map(e => e.commit.hash)).toEqual(['m1', 'a1'])
  expect(entries[0]).toMatchObject({ body: 'Phase 6s: the suite', commit: { parents: ['a1', 'b1'], author: 'King', stat: '27 files changed, 420 insertions(+), 88 deletions(-)' } })
  expect(entries[1]?.commit.stat).toBe('1 file changed, 2 insertions(+)')
  expect(parseMainLog('')).toEqual([])
})

test('prMerge reads a GitHub PR merge subject and drops the owner from the branch', () => {
  expect(prMerge('Merge pull request #34 from King-Makle/claude/phase-6s')).toEqual({ number: 34, branch: 'claude/phase-6s' })
  expect(prMerge('Merge pull request #5 from solo')).toEqual({ number: 5, branch: 'solo' })
  expect(prMerge("Merge branch 'x' into main")).toBe(null)
})

test('mergeTitle shows the PR title from the body, else the branch, and keeps any other merge subject', () => {
  expect(mergeTitle('Merge pull request #34 from King-Makle/claude/phase-6s', '\nPhase 6s: the suite\nmore')).toEqual({ number: 34, label: 'Phase 6s: the suite' })
  expect(mergeTitle('Merge pull request #34 from King-Makle/claude/phase-6s', '')).toEqual({ number: 34, label: 'claude/phase-6s' })
  expect(mergeTitle("Merge branch 'x' into main", 'body')).toEqual({ number: null, label: "Merge branch 'x' into main" })
})

test('parseShortstat reads insertions and deletions, either missing', () => {
  expect(parseShortstat('27 files changed, 420 insertions(+), 88 deletions(-)')).toEqual({ additions: 420, deletions: 88 })
  expect(parseShortstat('1 file changed, 1 insertion(+)')).toEqual({ additions: 1, deletions: 0 })
  expect(parseShortstat('1 file changed, 3 deletions(-)')).toEqual({ additions: 0, deletions: 3 })
  expect(parseShortstat('')).toEqual({ additions: 0, deletions: 0 })
})

test('parseMergeAuthors counts the commits and lists each author once; a failed log counts none', () => {
  expect(parseMergeAuthors('Sam\nSam\nJo\n')).toEqual({ count: 3, authors: ['Sam', 'Jo'] })
  expect(parseMergeAuthors('')).toEqual({ count: 0, authors: [] })
})

test('parseMergeCommits reads hash, author and subject per line', () => {
  expect(parseMergeCommits('abc1234\x1fSam\x1fAdd search\ndef5678\x1fJo\x1fFix typo\n')).toEqual([
    { hash: 'abc1234', author: 'Sam', subject: 'Add search' },
    { hash: 'def5678', author: 'Jo', subject: 'Fix typo' },
  ])
  expect(parseMergeCommits('')).toEqual([])
})

test('buildMainRows makes a merge row from two parents, keeps an octopus and a plain merge, and omits an unknown commit count', () => {
  const commit = (hash: string, parents: string[], subject: string, stat = ''): Commit => ({ hash, parents, refs: [], author: 'King', date: 'now', when: 'now', subject, stat })
  const entries = [
    { commit: commit('m1', ['a', 'b'], 'Merge pull request #34 from o/x', '3 files changed, 10 insertions(+), 2 deletions(-)'), body: 'Title' },
    { commit: commit('o1', ['a', 'b', 'c'], "Merge branches 'b' and 'c'"), body: '' },
    { commit: commit('p1', ['a'], 'Plain'), body: '' },
  ]
  const rows = buildMainRows(entries, { m1: { count: 15, authors: ['Sam'] } })
  expect(rows[0]?.merge).toEqual({ number: 34, label: 'Title', additions: 10, deletions: 2, count: 15, authors: ['Sam'] })
  expect(rows[1]?.merge).toMatchObject({ number: null, label: "Merge branches 'b' and 'c'", count: 0, authors: [] })
  expect(rows[2]?.merge).toBe(null)
})

test('mainLogCommand asks for the first-parent log with --diff-merges, or with -m on a git before 2.31', () => {
  const input = { limit: 150, date: '--date=x', upstream: 'origin/main', isModern: true }
  const modern = mainLogCommand(input)
  expect(modern).toEqual(['git', 'log', '--first-parent', '--diff-merges=first-parent', '--shortstat', '--topo-order', '-n', '150', '--date=x', MAIN_FORMAT, 'HEAD', 'origin/main'])
  const older = mainLogCommand({ ...input, isModern: false, upstream: null })
  expect(older).toContain('-m')
  expect(older.some(a => a.includes('diff-merges'))).toBe(false)
  expect(older.slice(-1)).toEqual(['HEAD'])
})

test('needsOlderDiffMerges recognises a git that does not know --diff-merges, and nothing else', () => {
  expect(needsOlderDiffMerges('fatal: unrecognized argument: --diff-merges=first-parent')).toBe(true)
  expect(needsOlderDiffMerges('error: unknown option `diff-merges=first-parent\'')).toBe(true)
  expect(needsOlderDiffMerges("fatal: ambiguous argument 'origin/main': unknown revision")).toBe(false)
  expect(needsOlderDiffMerges('')).toBe(false)
})
