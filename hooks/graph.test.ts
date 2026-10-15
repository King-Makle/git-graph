import { test, expect } from 'claude-code/testing'

import { layout, glyphs } from './graph'
import { parseLog } from './git'
import type { Commit } from '../types'

const c = (hash: string, parents: string[], subject = hash): Commit => ({
  hash,
  parents,
  refs: [],
  author: 'a',
  date: 'now',
  when: 'now',
  subject,
  stat: '',
})

test('parseLog reads the record format with each commit\'s shortstat line after it', () => {
  // `--shortstat` prints its line after the record separator; a merge commit prints none.
  const out =
    'aaa\x1fbbb ccc\x1fHEAD -> main, origin/main\x1fKing\x1f2 days ago\x1fOctober 2, 2026 at 9:25 PM\x1fMerge\x1e\n' +
    'bbb\x1fddd\x1f\x1fKing\x1f3 days ago\x1fOctober 1, 2026 at 1:00 PM\x1fFirst\x1e\n\n 14 files changed, 949 insertions(+)\n' +
    'ddd\x1f\x1f\x1fKing\x1f4 days ago\x1fSeptember 30, 2026 at 8:00 AM\x1fRoot\x1e\n\n 1 file changed, 2 insertions(+), 1 deletion(-)\n'
  expect(parseLog(out)).toEqual([
    { hash: 'aaa', parents: ['bbb', 'ccc'], refs: ['HEAD -> main', 'origin/main'], author: 'King', date: '2 days ago', when: 'October 2, 2026 at 9:25 PM', subject: 'Merge', stat: '' },
    { hash: 'bbb', parents: ['ddd'], refs: [], author: 'King', date: '3 days ago', when: 'October 1, 2026 at 1:00 PM', subject: 'First', stat: '14 files changed, 949 insertions(+)' },
    { hash: 'ddd', parents: [], refs: [], author: 'King', date: '4 days ago', when: 'September 30, 2026 at 8:00 AM', subject: 'Root', stat: '1 file changed, 2 insertions(+), 1 deletion(-)' },
  ])
})

test('layout keeps a linear history in lane 0', () => {
  const rows = layout([c('c', ['b']), c('b', ['a']), c('a', [])])
  expect(rows.map(r => r.lane)).toEqual([0, 0, 0])
  expect(rows.map(r => r.continues)).toEqual([true, true, false])
})

test('layout forks a merge commit into a second lane and joins it back', () => {
  // m merges b (lane 1) into a's line (lane 0)
  const rows = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  expect(rows[0]).toMatchObject({ lane: 0, continues: true, down: [1], joins: [], passing: [] })
  expect(rows[1]).toMatchObject({ lane: 1, continues: true, down: [], joins: [], passing: [0] })
  expect(rows[2]).toMatchObject({ lane: 0, continues: false, down: [], joins: [1], passing: [] })
})

test('layout joins two branch tips that share a parent', () => {
  // t1 and t2 are unmerged tips; both sit on x
  const rows = layout([c('t1', ['x']), c('t2', ['x']), c('x', [])])
  expect(rows[0]).toMatchObject({ lane: 0 })
  expect(rows[1]).toMatchObject({ lane: 1, passing: [0] })
  expect(rows[2]).toMatchObject({ lane: 0, joins: [1], continues: false })
})

test('glyphs draws a fork as a dot and a curve into the new lane', () => {
  const [m] = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  expect(glyphs(m!).map(g => g.text).join('')).toBe('●─╮')
})

test('glyphs draws a side commit beside its passing lane, then joins it at the parent', () => {
  const [, b, a] = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  expect(glyphs(b!).map(g => g.text).join('')).toBe('│ ●')
  expect(glyphs(a!).map(g => g.text).join('')).toBe('●─╯')
})

test('glyphs pads every row to a shared width', () => {
  const [, , a] = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  expect(glyphs(a!, 3).map(g => g.text).join('')).toBe('●─╯  ')
})

test('glyphs crosses a passing lane with a horizontal connector', () => {
  // a merges q, already awaited in lane 2, while lane 1 runs between them
  const rows = layout([c('t1', ['a']), c('t2', ['y']), c('t3', ['q']), c('a', ['p', 'q'])])
  expect(glyphs(rows[3]!).map(g => g.text).join('')).toBe('●─┼─┤')
})

test('glyphs colours a horizontal connector by the side lane', () => {
  const [m] = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  expect(glyphs(m!).map(g => g.lane)).toEqual([0, 1, 1])
})

test('glyphs draws a lane passing through an unrelated row', () => {
  const rows = layout([c('t1', ['x']), c('t2', ['y']), c('y', ['x']), c('x', [])])
  expect(glyphs(rows[2]!).map(g => g.text).join('')).toBe('│ ●')
})

test('layout says whether a commit has a line arriving from above', () => {
  const rows = layout([c('t1', ['x']), c('t2', ['x']), c('x', [])])
  expect(rows.map(r => r.fromAbove)).toEqual([false, false, true])
})
