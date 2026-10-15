import { test, expect } from 'claude-code/testing'

import type { Commit } from '../types'
import { layout } from './graph'
import { TRUNK, YOU, canonicalName, checkMailmapCommand, laneColors, personColor, trunkHashes } from './people'

const c = (hash: string, parents: string[], author = 'a', refs: string[] = []): Commit => ({ hash, parents, refs, author, date: 'now', when: 'now', subject: hash, stat: '' })

test('personColor is blue for you and a stable, different colour for anyone else', () => {
  expect(personColor('King Makle', 'King Makle')).toBe(YOU)
  expect(personColor('Sam Lee', 'King Makle')).toBe(personColor('Sam Lee', 'King Makle'))
  expect(personColor('Sam Lee', 'King Makle')).not.toBe(YOU)
  // A "you" that is not known yet never turns a nameless author blue.
  expect(personColor('', '')).not.toBe(YOU)
})

test('personColor repeats past six people without failing, hashes unicode, and never picks orange or red', () => {
  const seen = new Set<string>()
  for (const name of ['Sam', 'Jo', 'Alex', 'Priya', 'Chen', 'Dana', 'Eli', 'Fay', 'Gus', 'Hana', 'Ira', 'Zoë Ångström', '李雷']) seen.add(personColor(name, 'me'))
  expect(seen.size).toBeGreaterThan(1)
  expect(seen.size).toBeLessThanOrEqual(6)
  expect(seen.has('#f97316')).toBe(false)
  expect(seen.has('#f87171')).toBe(false)
})

test('trunkHashes follows the first parents from HEAD and from the upstream tip, not a side branch', () => {
  const commits = [c('h', ['g']), c('side', ['g']), c('o', ['g'], 'a', ['origin/main']), c('g', ['f']), c('f', [])]
  expect([...trunkHashes(commits, 'h', 'origin/main')].sort()).toEqual(['f', 'g', 'h', 'o'])
  expect([...trunkHashes(commits, 'h', null)].sort()).toEqual(['f', 'g', 'h'])
  // A HEAD outside the loaded window leaves no trunk, so every lane takes its author's colour.
  expect(trunkHashes(commits, 'unknown', null).size).toBe(0)
})

test('laneColors tints a branch lane by its author and keeps the trunk grey, the dots by author', () => {
  const rows = layout([c('m', ['a', 'b'], 'me'), c('b', ['a'], 'sam'), c('a', [], 'me')])
  const colorOf = (x: Commit) => (x.author === 'me' ? 'BLUE' : 'AMBER')
  const colors = laneColors(rows, colorOf, x => x.hash !== 'b')
  expect(colors[0]).toEqual({ entering: {}, dot: 'BLUE', below: TRUNK, down: { 1: 'AMBER' } })
  expect(colors[1]).toEqual({ entering: { 0: TRUNK, 1: 'AMBER' }, dot: 'AMBER', below: 'AMBER', down: {} })
  expect(colors[2]).toEqual({ entering: { 0: TRUNK, 1: 'AMBER' }, dot: 'BLUE', below: TRUNK, down: {} })
})

test('laneColors has no colours to hand out for no rows', () => {
  expect(laneColors([], () => 'x', () => false)).toEqual([])
})

test('canonicalName reads the name git check-mailmap answers, else keeps the configured one', () => {
  expect(checkMailmapCommand('Makle Richards', 'm@x.com')).toEqual(['git', 'check-mailmap', 'Makle Richards <m@x.com>'])
  expect(canonicalName('King Makle <m@x.com>\n', 'Makle Richards')).toBe('King Makle')
  expect(canonicalName('', 'Makle Richards')).toBe('Makle Richards')
  expect(canonicalName('fatal: not a git repository', 'Makle Richards')).toBe('Makle Richards')
})
