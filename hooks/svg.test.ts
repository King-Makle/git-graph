import { test, expect } from 'claude-code/testing'

import { layout } from './graph'
import { LANE_W, PILL_H, RING, ROW_H, svgAvatar, svgCount, svgLetter, svgPill, svgRow, svgStashMarker } from './svg'
import type { Commit } from '../types'

const c = (hash: string, parents: string[]): Commit => ({ hash, parents, refs: [], author: 'a', date: 'now', when: 'now', subject: hash, stat: '' })
const color = (lane: number) => ['red', 'green', 'blue'][lane]!

test('svgRow draws a dot at the lane centre and sizes the box to the shared width', () => {
  const [row] = layout([c('a', [])])
  const svg = svgRow(row!, 3, color, {})
  expect(svg).toContain(`width="${LANE_W * 3}" height="${ROW_H}"`)
  expect(svg).toContain(`<circle cx="${LANE_W / 2}" cy="${ROW_H / 2}" r="3.5" fill="red"`)
})

test('svgRow draws a passing lane as a full-height line in its own colour', () => {
  const [, b] = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  const svg = svgRow(b!, 2, color, {})
  expect(svg).toContain(`<line x1="${LANE_W / 2}" y1="0" x2="${LANE_W / 2}" y2="${ROW_H}" stroke="red"`)
})

test('svgRow curves from the dot to a new lane below and from a joining lane above', () => {
  const [m, , a] = layout([c('m', ['a', 'b']), c('b', ['a']), c('a', [])])
  const x0 = LANE_W / 2
  const x1 = LANE_W / 2 + LANE_W
  const mid = ROW_H / 2
  expect(svgRow(m!, 2, color, {})).toContain(`<path d="M ${x0} ${mid} Q ${x1} ${mid} ${x1} ${ROW_H}" stroke="green"`)
  expect(svgRow(a!, 2, color, {})).toContain(`<path d="M ${x1} 0 Q ${x1} ${mid} ${x0} ${mid}" stroke="green"`)
})

test('svgRow only draws the stem above the dot when a line arrives there', () => {
  const [t, x] = layout([c('t', ['x']), c('x', [])])
  const x0 = LANE_W / 2
  expect(svgRow(t!, 1, color, {})).not.toContain(`y1="0" x2="${x0}" y2="${ROW_H / 2}"`)
  expect(svgRow(t!, 1, color, {})).toContain(`<line x1="${x0}" y1="${ROW_H / 2}" x2="${x0}" y2="${ROW_H}"`)
  expect(svgRow(x!, 1, color, {})).toContain(`<line x1="${x0}" y1="0" x2="${x0}" y2="${ROW_H / 2}"`)
})

test('svgRow draws the HEAD commit and the uncommitted row as hollow dots', () => {
  const [row] = layout([c('a', [])])
  expect(svgRow(row!, 1, color, { isHead: true })).toContain('r="4" fill="none" stroke="red" stroke-width="2"')
  expect(svgRow(row!, 1, color, { isHollow: true })).toContain('r="3.5" fill="none" stroke="red"')
})

test('svgPill draws a rounded pill sized to its label, with the icon and a cloud mark', () => {
  const svg = svgPill({ kind: 'local', label: 'main', title: 'main', isRemote: true })
  expect(svg).toContain(`height="${PILL_H}"`)
  expect(svg).toContain(`rx="${PILL_H / 2}"`)
  expect(svg).toContain('>main</text>')
  expect(svg).toContain('M17.5 19H9')
  expect(svgPill({ kind: 'tag', label: 'v1 <2>', title: 'v1 <2>', isRemote: false })).toContain('>v1 &lt;2&gt;</text>')
  // A remote-only pill leads with the cloud and does not repeat it.
  expect(svgPill({ kind: 'remote', label: 'origin/x', title: 'origin/x', isRemote: true }).split('M17.5 19H9').length).toBe(2)
})

test('svgStashMarker is a dashed teal square the size of a graph cell', () => {
  const svg = svgStashMarker()
  expect(svg).toContain(`width="${LANE_W}" height="${ROW_H}"`)
  expect(svg).toContain('stroke-dasharray')
  expect(svg).toContain('stroke="#22d3ee"')
})

test('svgPill carries the whole ref name as a tooltip title, even when the label is clipped', () => {
  const svg = svgPill({ kind: 'local', label: 'claude/claude-mod…', title: 'claude/claude-mods-desktop-plugins-09d282', isRemote: false })
  expect(svg).toContain('<title>claude/claude-mods-desktop-plugins-09d282</title>')
  expect(svgPill({ kind: 'more', label: '2', title: 'intake, v1', isRemote: false })).toContain('<title>intake, v1</title>')
})

test('svgAvatar, svgLetter and svgCount take an optional tooltip title, escaped', () => {
  expect(svgAvatar('KM', 'King Makle · October 2, 2026 at 9:25 PM')).toContain('<title>King Makle · October 2, 2026 at 9:25 PM</title>')
  expect(svgAvatar('KM')).not.toContain('<title')
  expect(svgLetter('M', '#e2c08d', 'Modified')).toContain('<title>Modified</title>')
  expect(svgLetter('M', '#e2c08d', 'a & b')).toContain('<title>a &amp; b</title>')
  expect(svgCount('3', '#000', '#fff', '3 uncommitted changes')).toContain('<title>3 uncommitted changes</title>')
  expect(svgCount('3', '#000', '#fff')).not.toContain('<title')
})

test('svgRow takes the dot and the stem below it from the style, so a trunk stem and its author dot differ', () => {
  const [a, b] = layout([c('b', ['a']), c('a', [])])
  const below = svgRow(a!, 1, color, { dot: 'pink', below: 'grey' })
  expect(below).toContain('r="3.5" fill="pink"')
  expect(below).toContain(`y2="${ROW_H}" stroke="grey"`)
  expect(below).not.toContain('fill="red"')
  // The stem arriving from above keeps the lane's colour.
  expect(svgRow(b!, 1, color, { dot: 'pink' })).toContain(`y2="${ROW_H / 2}" stroke="red"`)
})

test('svgRow draws a commit not pulled yet as a dashed hollow dot with a dashed stem below', () => {
  const [a] = layout([c('b', ['a']), c('a', [])])
  const svg = svgRow(a!, 1, color, { isIncoming: true, dot: 'pink' })
  expect(svg).toContain('r="3.5" fill="none" stroke="pink" stroke-width="1.5" stroke-dasharray="2 1.6"')
  expect(svg).toContain('stroke-dasharray="2 3"')
})

test('svgRow draws a ring round the dot and a merge as a solid hollow dot', () => {
  const [a] = layout([c('a', [])])
  expect(svgRow(a!, 1, color, { ring: 'orange' })).toContain(`r="${RING}" fill="none" stroke="orange"`)
  const merge = svgRow(a!, 1, color, { isMerge: true })
  expect(merge).toContain('r="3.5" fill="none" stroke="red" stroke-width="1.5"/>')
  expect(merge).not.toContain('stroke-dasharray')
})

test('svgAvatar fills with the colour it is given and keeps the grey default', () => {
  expect(svgAvatar('SL', undefined, '#14b8a6')).toContain('fill="#14b8a6"')
  expect(svgAvatar('SL')).toContain('fill="#4c5a73"')
})
