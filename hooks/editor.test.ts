import { test, expect } from 'claude-code/testing'

import { applyKey, caretAt, cellWidth, place, selection, wrap } from './editor'

// One cell per character, so the tests count characters.
const one = () => 1

const lines = (text: string, width: number) => wrap(text, width, one).map(line => text.slice(line.start, line.end))

test('wrap breaks after a space, keeps the trailing space, breaks a long word mid-word and starts a line at a newline', () => {
  expect(lines('hello big world', 10)).toEqual(['hello big ', 'world'])
  expect(lines('abcdefghijkl', 8)).toEqual(['abcdefgh', 'ijkl'])
  expect(lines('one\ntwo', 20)).toEqual(['one', 'two'])
  expect(lines('', 20)).toEqual([''])
})

test('place and caretAt agree on a wrapped line, and a click never lands after a wrap space', () => {
  const text = 'hello big world'
  const w = wrap(text, 10, one)
  expect(place(w, 0)).toEqual({ row: 0, col: 0 })
  expect(place(w, 10)).toEqual({ row: 1, col: 0 })
  expect(place(w, 15)).toEqual({ row: 1, col: 5 })
  expect(caretAt(text, w, 1, 2, one)).toBe(12)
  expect(caretAt(text, w, 0, 99, one)).toBe(9)
  expect(caretAt(text, w, 9, 99, one)).toBe(15)
})

const at = (text: string, caret: number, anchor: number | null = null) => ({ text, caret, anchor })

test('typing and deleting happen at the caret, so the middle of a message can be edited', () => {
  const w = (text: string) => wrap(text, 40, one)
  let s = at('fix the bug', 7)
  expect(applyKey(s, 'X', {}, w(s.text))?.next).toEqual(at('fix theX bug', 8))
  expect(applyKey(s, 'backspace', {}, w(s.text))?.next).toEqual(at('fix th bug', 6))
  expect(applyKey(s, 'delete', {}, w(s.text))?.next).toEqual(at('fix thebug', 7))
  expect(applyKey(at('a', 0), 'backspace', {}, w('a'))).toBe(null)
  expect(applyKey(at('a', 1), 'delete', {}, w('a'))).toBe(null)
})

test('arrows, home, end and word jumps move the caret and never past the text', () => {
  const text = 'one two three'
  const w = wrap(text, 40, one)
  expect(applyKey(at(text, 4), 'left', {}, w)?.next.caret).toBe(3)
  expect(applyKey(at(text, 0), 'left', {}, w)?.next.caret).toBe(0)
  expect(applyKey(at(text, 13), 'right', {}, w)?.next.caret).toBe(13)
  expect(applyKey(at(text, 6), 'home', {}, w)?.next.caret).toBe(0)
  expect(applyKey(at(text, 6), 'end', {}, w)?.next.caret).toBe(13)
  expect(applyKey(at(text, 6), 'left', { meta: true }, w)?.next.caret).toBe(4)
  expect(applyKey(at(text, 6), 'right', { meta: true }, w)?.next.caret).toBe(7)
})

test('up and down keep the column across wrapped lines', () => {
  const text = 'hello big world'
  const w = wrap(text, 10, one)
  expect(applyKey(at(text, 12), 'up', {}, w, one)?.next.caret).toBe(2)
  expect(applyKey(at(text, 2), 'down', {}, w, one)?.next.caret).toBe(12)
})

test('Enter types a line and never commits; control keys and unknown names type nothing; space types a space', () => {
  const s = at('msg', 3)
  const w = wrap(s.text, 40, one)
  expect(applyKey(s, 'return', {}, w)?.next).toEqual(at('msg\n', 4))
  expect(applyKey(s, 'return', { shift: true }, w)?.next).toEqual(at('msg\n', 4))
  expect(applyKey(s, 'return', {}, w)?.effect).toBeUndefined()
  expect(applyKey(s, 'tab', {}, w)).toBe(null)
  expect(applyKey(s, 'space', {}, w)?.next).toEqual(at('msg ', 4))
  expect(applyKey(s, 'f13', {}, w)).toBe(null)
  expect(applyKey(s, 'q', { ctrl: true }, w)).toBe(null)
})

test('Shift+arrows grow a selection; typing, Backspace and Enter replace it; an arrow drops it at its edge', () => {
  const text = 'fix the bug'
  const w = wrap(text, 40, one)
  const grown = applyKey(at(text, 4), 'right', { shift: true }, w)?.next
  expect(grown).toEqual(at(text, 5, 4))
  expect(selection(at(text, 7, 4))).toEqual({ from: 4, to: 7 })
  expect(selection(at(text, 4, 4))).toBe(null)
  expect(applyKey(at(text, 7, 4), 'X', {}, w)?.next).toEqual(at('fix X bug', 5))
  expect(applyKey(at(text, 7, 4), 'backspace', {}, w)?.next).toEqual(at('fix  bug', 4))
  expect(applyKey(at(text, 7, 4), 'return', {}, w)?.next).toEqual(at('fix \n bug', 5))
  expect(applyKey(at(text, 7, 4), 'left', {}, w)?.next).toEqual(at(text, 4))
  expect(applyKey(at(text, 7, 4), 'right', {}, w)?.next).toEqual(at(text, 7))
  expect(applyKey(at(text, 2), 'a', { meta: true }, w)?.next).toEqual(at(text, 11, 0))
})

test('Cmd+C copies the selection, Cmd+X copies and removes it, Cmd+V asks for the clipboard', () => {
  const text = 'fix the bug'
  const w = wrap(text, 40, one)
  expect(applyKey(at(text, 7, 4), 'c', { meta: true }, w)?.effect).toEqual({ copy: 'the' })
  expect(applyKey(at(text, 4, 4), 'c', { meta: true }, w)).toBe(null)
  const cut = applyKey(at(text, 7, 4), 'x', { meta: true }, w)
  expect(cut?.next).toEqual(at('fix  bug', 4))
  expect(cut?.effect).toEqual({ copy: 'the' })
  expect(applyKey(at(text, 2), 'v', { meta: true }, w)?.effect).toEqual({ paste: true })
})

test('cellWidth draws narrow letters narrower than wide ones, and a click lands between the nearest two characters', () => {
  expect(cellWidth('i')).toBeLessThan(cellWidth('n'))
  expect(cellWidth('n')).toBeLessThan(cellWidth('m'))
  expect(cellWidth(' ')).toBeLessThan(cellWidth('n'))
  const text = 'iiimmm'
  const w = wrap(text, 40)
  expect(caretAt(text, w, 0, 0.1)).toBe(0)
  expect(caretAt(text, w, 0, 3 * cellWidth('i') + 0.3)).toBe(3)
  expect(caretAt(text, w, 0, 99)).toBe(6)
  expect(wrap('i'.repeat(100), 20).length).toBeLessThan(wrap('m'.repeat(100), 20).length)
})

test('cellWidth matches the real widths of text in the live pane, measured in cells, within 2%', () => {
  // Measured 2026-10-05 on the desktop (a 65-column editor region, 17.5 device px a cell): two drawn lines of the message.
  const total = (text: string) => [...text].reduce((sum, ch) => sum + cellWidth(ch), 0)
  expect(total('The model wraps long paragraphs at 72 columns with hard newlines, but the')).toBeGreaterThan(56.9 * 0.98)
  expect(total('The model wraps long paragraphs at 72 columns with hard newlines, but the')).toBeLessThan(56.9 * 1.02)
  expect(total('message box should show each paragraph as continuous text.')).toBeGreaterThan(46.7 * 0.98)
  expect(total('message box should show each paragraph as continuous text.')).toBeLessThan(46.7 * 1.02)
  // Single characters, which the old class table got wrong by up to 2x (a percent sign, a hash).
  expect(cellWidth('%')).toBeGreaterThan(1.5)
  expect(cellWidth('m')).toBeGreaterThan(1.3)
  expect(cellWidth('i')).toBeLessThan(0.45)
  expect(cellWidth(' ')).toBeGreaterThan(0.35)
  expect(cellWidth(' ')).toBeLessThan(0.45)
})
