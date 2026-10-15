import type { ClientModule, RenderElement } from 'claude-code'

// The commit message as a box of our own: the desktop's Input is one fixed-width line whose caret the mod
// cannot move, so a long message could not be edited in the middle. This is a surface module (a `Client`):
// it keeps the text and the caret as its local state, draws the text wrapped, takes keys and clicks, and
// posts each change to the hooks module, which keeps the message atom.

/** The text, the caret, and the other end of the selection (null when nothing is selected). */
export type Edit = { text: string; caret: number; anchor: number | null }
/** `isActive`: a click put the caret here and nothing else has been pressed since; `isOn`: the blink's visible half; `blur`: the last `blur` prop seen. */
export type EditorState = Edit & { rev: number; isActive: boolean; isOn: boolean; blur: number }
/** `blur` is bumped by the hooks whenever anything else in the pane is pressed: the box has no focus event of its own. */
export type EditorProps = { text: string; rev: number; caret: number | null; placeholder: string; blur: number; debug?: boolean }
/** What a key did beyond editing: `paste` asks the hooks for the clipboard; `copy` is the text to put on it. */
export type Effect = { paste: true } | { copy: string }
export type Keys = { ctrl?: true; shift?: true; meta?: true }
export type Line = { start: number; end: number }

const NAMES = new Set(['up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backtab', 'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end', 'escape', 'insert'])

/**
 * How wide a character draws, in the grid's cells. The desktop's text is proportional, so a click or a wrap needs each
 * character's own advance: the old class table (narrow, medium, wide, one default) was up to 2x off for some characters
 * (a percent sign, a hash, a digit) and ~8% narrow overall, which put a click further right the further right it was.
 * Measured 2026-10-05 from the live pane: each ASCII character drawn 10 and 20 times between two H anchors, the width
 * difference over 10 characters, in device px, over a 17.5 px cell (a 65-column editor region of 1138 px). Anything else
 * (an accent, a symbol) takes one cell.
 */
export type Measure = (ch: string) => number
const WIDTHS: Record<string, number> = {
  ' ': 0.4,
  '!': 0.371,
  '"': 0.64,
  '#': 1.04,
  '$': 0.851,
  '%': 1.606,
  '&': 1.097,
  '\'': 0.377,
  '(': 0.657,
  ')': 0.657,
  '*': 0.794,
  '+': 1.04,
  ',': 0.371,
  '-': 0.589,
  '.': 0.371,
  '/': 0.537,
  '0': 0.994,
  '1': 0.6,
  '2': 0.943,
  '3': 0.954,
  '4': 1.0,
  '5': 0.92,
  '6': 0.931,
  '7': 0.863,
  '8': 0.914,
  '9': 0.931,
  ':': 0.371,
  ';': 0.371,
  '<': 1.04,
  '=': 1.04,
  '>': 1.04,
  '?': 0.874,
  '@': 1.417,
  'A': 1.194,
  'B': 1.063,
  'C': 1.234,
  'D': 1.206,
  'E': 1.04,
  'F': 1.011,
  'G': 1.286,
  'H': 1.206,
  'I': 0.44,
  'J': 0.869,
  'K': 1.103,
  'L': 0.937,
  'M': 1.514,
  'N': 1.274,
  'O': 1.326,
  'P': 0.989,
  'Q': 1.326,
  'R': 1.109,
  'S': 0.949,
  'T': 0.937,
  'U': 1.183,
  'V': 1.194,
  'W': 1.64,
  'X': 1.074,
  'Y': 1.149,
  'Z': 1.074,
  '[': 0.657,
  '\\': 0.537,
  ']': 0.657,
  '^': 1.04,
  '_': 0.811,
  '`': 0.811,
  'a': 0.88,
  'b': 1.006,
  'c': 0.891,
  'd': 1.006,
  'e': 0.931,
  'f': 0.634,
  'g': 0.891,
  'h': 0.966,
  'i': 0.406,
  'j': 0.406,
  'k': 0.909,
  'l': 0.451,
  'm': 1.406,
  'n': 0.966,
  'o': 0.943,
  'p': 1.006,
  'q': 1.006,
  'r': 0.646,
  's': 0.829,
  't': 0.634,
  'u': 0.96,
  'v': 0.903,
  'w': 1.326,
  'x': 0.909,
  'y': 0.92,
  'z': 0.817,
  '{': 0.657,
  '|': 0.491,
  '}': 0.657,
  '~': 1.04
}
export const cellWidth: Measure = ch => WIDTHS[ch] ?? 1

/** The wrapped lines of `text` as index ranges: a newline starts a paragraph, a line breaks after the last space that fits, and a word wider than the line breaks mid-word. A line keeps its trailing space. */
export function wrap(text: string, width: number, measure: Measure = cellWidth): Line[] {
  const w = Math.max(4, width)
  const lines: Line[] = []
  let at = 0
  for (const paragraph of text.split('\n')) {
    const end = at + paragraph.length
    let start = at
    for (;;) {
      let used = 0
      let space = -1
      let i = start
      for (; i < end; i++) {
        used += measure(text[i] ?? ' ')
        if (used > w) break
        if (text[i] === ' ') space = i
      }
      if (i >= end) {
        lines.push({ start, end })
        break
      }
      const cut = space >= start ? space + 1 : Math.max(start + 1, i)
      lines.push({ start, end: cut })
      start = cut
    }
    at = end + 1
  }
  return lines
}

const NONE: Line = { start: 0, end: 0 }
const lineAt = (lines: Line[], row: number): Line => lines[row] ?? NONE

/** The line a caret is on and its column in it. */
export function place(lines: Line[], caret: number): { row: number; col: number } {
  let row = 0
  lines.forEach((line, index) => {
    if (line.start <= caret) row = index
  })
  return { row, col: caret - lineAt(lines, row).start }
}

/** Where a caret at `col` on a line sits, in cells from the line's left edge. */
function offsetOf(text: string, line: Line, col: number, measure: Measure): number {
  let x = 0
  for (let i = line.start; i < line.start + col; i++) x += measure(text[i] ?? ' ')
  return x
}

/** The caret index for a click `x` cells from the left of `row`: the nearest gap between characters; never past the line, and never after a wrap's trailing space. */
export function caretAt(text: string, lines: Line[], row: number, x: number, measure: Measure = cellWidth): number {
  const line = lineAt(lines, Math.max(0, Math.min(lines.length - 1, row)))
  const isLast = line === lines[lines.length - 1] || text[line.end] === '\n'
  const len = line.end - line.start
  const max = !isLast && text[line.end - 1] === ' ' ? len - 1 : len
  let used = 0
  let col = 0
  while (col < max) {
    const w = measure(text[line.start + col] ?? ' ')
    if (x < used + w / 2) break
    used += w
    col++
  }
  return line.start + col
}

/** The selected range, or null. */
export function selection(s: Edit): { from: number; to: number } | null {
  if (s.anchor === null || s.anchor === s.caret) return null
  return { from: Math.min(s.anchor, s.caret), to: Math.max(s.anchor, s.caret) }
}

/** One key against the text: the new state and an effect (paste, copy), or null for a key the box ignores. Enter types a line; committing is the Commit button's alone. */
export function applyKey(s: Edit, key: string, keys: Keys, lines: Line[], measure: Measure = cellWidth): { next: Edit; effect?: Effect } | null {
  const { text, caret } = s
  const sel = selection(s)
  const clamp = (n: number): number => Math.max(0, Math.min(text.length, n))
  // A move: with Shift the selection grows from where it started, without it the selection is dropped.
  const go = (to: number): { next: Edit } => ({ next: { text, caret: clamp(to), anchor: keys.shift ? (s.anchor ?? caret) : null } })
  // Typing over a selection replaces it.
  const put = (what: string): { next: Edit } => {
    const from = sel?.from ?? caret
    const to = sel?.to ?? caret
    return { next: { text: text.slice(0, from) + what + text.slice(to), caret: from + what.length, anchor: null } }
  }
  const command = keys.meta || keys.ctrl
  if (command && key === 'a') return { next: { text, caret: text.length, anchor: 0 } }
  if (command && key === 'c') return sel === null ? null : { next: s, effect: { copy: text.slice(sel.from, sel.to) } }
  if (command && key === 'x') return sel === null ? null : { next: put('').next, effect: { copy: text.slice(sel.from, sel.to) } }
  if (command && key === 'v') return { next: s, effect: { paste: true } }
  if (key === 'return' || key === 'enter') return put('\n')
  if (key === 'backspace') {
    if (sel !== null) return put('')
    return caret === 0 ? null : { next: { text: text.slice(0, caret - 1) + text.slice(caret), caret: caret - 1, anchor: null } }
  }
  if (key === 'delete') {
    if (sel !== null) return put('')
    return caret >= text.length ? null : { next: { text: text.slice(0, caret) + text.slice(caret + 1), caret, anchor: null } }
  }
  if (key === 'left') return !keys.shift && sel !== null && !command ? { next: { text, caret: sel.from, anchor: null } } : go(command ? wordBefore(text, caret) : caret - 1)
  if (key === 'right') return !keys.shift && sel !== null && !command ? { next: { text, caret: sel.to, anchor: null } } : go(command ? wordAfter(text, caret) : caret + 1)
  if (key === 'home' || (keys.ctrl && key === 'a')) return go(lineAt(lines, place(lines, caret).row).start)
  if (key === 'end' || (keys.ctrl && key === 'e')) return go(lineAt(lines, place(lines, caret).row).end)
  if (key === 'up' || key === 'down') {
    const { row, col } = place(lines, caret)
    const to = row + (key === 'up' ? -1 : 1)
    if (to < 0) return go(0)
    if (to >= lines.length) return go(text.length)
    return go(caretAt(text, lines, to, offsetOf(text, lineAt(lines, row), col, measure), measure))
  }
  // The desktop names the space bar (seen 2026-10-05: `key space`), as it names Enter.
  if (key === 'space') return put(' ')
  if (command || NAMES.has(key)) return null
  // One character types. A longer name is a key this box does not know: ignored, never typed out as a word.
  return [...key].length === 1 ? put(key) : null
}

function wordBefore(text: string, caret: number): number {
  let i = caret
  while (i > 0 && text[i - 1] === ' ') i--
  while (i > 0 && text[i - 1] !== ' ') i--
  return i
}

function wordAfter(text: string, caret: number): number {
  let i = caret
  while (i < text.length && text[i] === ' ') i++
  while (i < text.length && text[i] !== ' ') i++
  return i
}

const PAD = 0
// Cells kept free at the right so a line that measures a little short never wraps again in the engine.
const SLACK = 3
// The caret's blink, on and off, as a native text field's (macOS uses about this).
const BLINK_MS = 530
// The caret: a hair space drawn inverse, about one pixel wide like a native field's, sitting before the character it
// is at. It stays in the line when the caret blinks off or the box is idle, so the text never shifts by its width.
const CARET = '\u200a'

const Editor: ClientModule<EditorProps, EditorState & { last: string }> = (props, surface) => {
  const { Box, Text } = surface.elements
  const columns = surface.columns > 0 ? surface.columns : 40
  const width = Math.max(8, columns - 2 * PAD - SLACK)
  const state = surface.state
  const fresh = (): EditorState & { last: string } => ({ text: props.text, caret: props.text.length, anchor: null, rev: props.rev, isActive: false, isOn: false, blur: props.blur, last: '' })
  const live = (): EditorState & { last: string } => surface.state ?? fresh()
  const linesNow = (text: string): Line[] => wrap(text, Math.max(8, surface.columns - 2 * PAD - SLACK))

  if (state === undefined || state.rev !== props.rev) {
    // First draw, or the hooks changed the text on their own (a commit cleared it, a paste landed): take theirs.
    const first = state === undefined
    // A paste or a Write lands while the box is in use, so whether it is active carries over.
    surface.setState({ text: props.text, caret: Math.min(props.caret ?? props.text.length, props.text.length), anchor: null, rev: props.rev, isActive: state?.isActive ?? false, isOn: true, blur: props.blur, last: first ? 'start' : 'reset' })
    if (first) {
      // The blink: only an active box redraws on the tick, so an idle one costs nothing.
      surface.every(BLINK_MS, () => {
        const s = live()
        if (s.isActive) surface.setState({ ...s, isOn: !s.isOn })
      })
      surface.onKey(event => {
        const s = live()
        // Escape hands the keyboard back: the caret goes with it.
        if (event.key === 'escape') {
          surface.setState({ ...s, isActive: false, last: 'escape' })
          return
        }
        const done = applyKey(s, event.key, event, linesNow(s.text))
        if (done === null) {
          surface.setState({ ...s, last: `ignored ${event.key}${event.meta ? ' +meta' : ''}${event.ctrl ? ' +ctrl' : ''}` })
          return
        }
        // Typing keeps the caret lit, as a native field does, and restarts the blink from there.
        surface.setState({ ...s, ...done.next, isActive: true, isOn: true, last: `key ${event.key}${event.meta ? ' +meta' : ''}` })
        const effect = done.effect
        if (effect !== undefined && 'paste' in effect) surface.post({ kind: 'paste', text: done.next.text, caret: done.next.caret, anchor: done.next.anchor })
        else surface.post({ kind: 'edit', text: done.next.text, copy: effect === undefined ? null : effect.copy })
      })
      // A press places the caret; a drag with the button down grows a selection from there.
      surface.onPointer(event => {
        const s = live()
        // The engine reports a whole cell (a click 16.7 cells in reads 16): the middle of that cell is the unbiased guess.
        const at = caretAt(s.text, linesNow(s.text), event.y, event.x + 0.5 - PAD)
        if (event.type === 'down' && event.button === 'left') surface.setState({ ...s, caret: at, anchor: at, isActive: true, isOn: true, last: `click ${event.x},${event.y}` })
        else if (event.type === 'move' && event.button === 'left') surface.setState({ ...s, caret: at, isOn: true, last: `drag ${event.x},${event.y}` })
      })
    }
  } else if (state.blur !== props.blur) {
    // Something else in the pane was pressed: the box has lost the keyboard, so its caret goes.
    surface.setState({ ...state, isActive: false, blur: props.blur, last: 'blur' })
  }

  const s = state ?? fresh()
  // The caret shows only while the box has the keyboard, and blinks there.
  const showCaret = s.isActive && s.isOn
  const lines = wrap(s.text, width)
  const sel = selection(s)
  const here = place(lines, Math.min(s.caret, s.text.length))
  const rows: RenderElement[] = lines.map((line, index) => {
    const text = s.text.slice(line.start, line.end)
    // The engine refuses a placeholder child, so the pieces are a list. A selected stretch gets a background; with no
    // selection the caret (CARET) sits before the character it is at.
    const pieces: RenderElement[] = []
    if (sel !== null) {
      const from = Math.max(sel.from, line.start) - line.start
      const to = Math.min(sel.to, line.end) - line.start
      if (to > from) {
        if (from > 0) pieces.push(<Text>{text.slice(0, from)}</Text>)
        pieces.push(<Text backgroundColor="#2b63c8">{text.slice(from, to)}</Text>)
        if (to < text.length) pieces.push(<Text>{text.slice(to)}</Text>)
      } else pieces.push(<Text>{text.length > 0 ? text : ' '}</Text>)
    } else if (index === here.row) {
      const before = text.slice(0, here.col)
      const after = text.slice(here.col)
      if (before.length > 0) pieces.push(<Text>{before}</Text>)
      pieces.push(<Text inverse={showCaret}>{CARET}</Text>)
      if (after.length > 0) pieces.push(<Text>{after}</Text>)
    } else pieces.push(<Text>{text.length > 0 ? text : ' '}</Text>)
    return <Box flexDirection="row">{pieces}</Box>
  })
  // Empty: the caret block sits at the start, then the placeholder, so a click visibly lands in the box.
  const out: RenderElement[] =
    s.text.length === 0
      ? [
          <Box flexDirection="row">
            <Text inverse={showCaret}>{CARET}</Text>
            <Text dimColor>{props.placeholder}</Text>
          </Box>,
        ]
      : rows
  if (props.debug === true) out.push(<Text dimColor>{`cols ${surface.columns} rows ${surface.rows} caret ${s.caret} ${s.isActive ? (s.isOn ? 'on' : 'off') : 'idle'} ${s.last}`}</Text>)
  return (
    <Box flexDirection="column" paddingX={PAD}>
      {out}
    </Box>
  )
}

export default Editor
