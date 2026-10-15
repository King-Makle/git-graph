import { cellWidth } from './editor'
import { countWidth } from './svg'

/**
 * Whether a row of the pane fits its width, estimated in CSS pixels, so labels shorten only when the full ones would
 * push something out of place. Calibrated on the live desktop (2026-10-09, a 153-column pane): a cell is 8.75px,
 * button and Select text is 14px (the editor's per-character table, which was measured at 15px, scaled down), a
 * symbol glyph ~11px, a plain Button pads 5px a side, the space between spaced buttons is 3.5px, a `gap` is one cell,
 * and a bordered card insets 13px a side. The header's left group came to 343px estimated against 344px measured.
 */
export const CELL = 8.75
const BUTTON_PAD = 5
const SPACE = 3.5
const INSET = 13
const GLYPH_PX = 11
// Pixels the header keeps spare: its estimate ran ~25px under the live width (2026-10-09).
const HEADER_SLACK = 32
// Pixels a Branches card row keeps spare, as the header does (its estimate ran short at 38 columns, 2026-10-09).
const ROW_SLACK = 24
// The fewest letters a clipped branch name keeps; a name this short plus two is shown whole.
const MIN_NAME = 6
// The icon at the start of a header or branch row.
const ICON_PX = 13

/** A label's width at the pane's 14px text: ASCII by the measured table, any other symbol as one glyph. */
export function textPx(text: string, size = 14): number {
  let cells = 0
  let glyphs = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) cells += cellWidth(ch)
    else glyphs += 1
  }
  return (cells * CELL * size) / 15 + glyphs * GLYPH_PX
}

export const buttonPx = (label: string): number => textPx(label) + BUTTON_PAD * 2

/** Buttons drawn by `spaced`: each one and a space between. */
export const spacedPx = (labels: string[]): number => labels.reduce((sum, label) => sum + buttonPx(label), 0) + SPACE * Math.max(0, labels.length - 1)

/** The width inside a section card (marginX 1 and the border inset each side) of a pane `columns` wide. */
export const cardInner = (columns: number): number => columns * CELL - 2 * CELL - 2 * INSET

/**
 * How far the header must shorten to fit: 0 everything whole, 1 the count pills short (`↑3`, `10`), 2 the pills short and
 * every glyph-and-word button its glyph alone. `branchLabel` is the branch button's name (`Main`), which never shortens;
 * `pills` are the full and short labels; `buttons` the right-hand labels.
 */
export function headerStage(columns: number, branchLabel: string, pills: { full: string; short: string }[], buttons: string[], glyphOf: (label: string) => string): 0 | 1 | 2 {
  // The header keeps a margin: its estimate ran ~25px under the live width (the old branch Select shrank to `m…`).
  const room = cardInner(columns) - CELL - HEADER_SLACK
  const left = (short: boolean): number =>
    ICON_PX + buttonPx(branchLabel) + pills.reduce((sum, pill) => sum + CELL + countWidth(short ? pill.short : pill.full), 0)
  const right = (glyphs: boolean): number => spacedPx(glyphs ? buttons.map(glyphOf) : buttons)
  if (left(false) + right(false) <= room) return 0
  if (left(true) + right(false) <= room) return 1
  return 2
}

/**
 * Whether the branch name fits the room the header leaves it once the pills are short and the buttons are glyphs; when
 * it does not, the header shows the triangle in its place.
 */
export function fitsBranchName(columns: number, name: string, pills: string[], buttons: string[]): boolean {
  const room = cardInner(columns) - CELL - HEADER_SLACK
  const others = ICON_PX + BUTTON_PAD * 2 + pills.reduce((sum, pill) => sum + CELL + countWidth(pill), 0) + spacedPx(buttons)
  return textPx(name) <= room - others
}

/** `text` cut with `…` to `px` at `size`; a short text is never cut (`M…` saves almost nothing and reads worse), and a cut keeps at least a few letters. */
export function clipToPx(text: string, px: number, size = 14): string {
  if (textPx(text, size) <= px || text.length <= MIN_NAME + 2) return text
  let cut = text.length
  while (cut > MIN_NAME && textPx(`${text.slice(0, cut)}…`, size) > px) cut -= 1
  return `${text.slice(0, cut)}…`
}

/** A card header row (title, count pill, actions at the right) fits with its actions whole. */
export function cardHeaderFits(columns: number, title: string, count: string | null, actions: string[]): boolean {
  const titlePx = textPx(title, 15) * 1.05 + (count === null ? 0 : CELL + countWidth(count))
  return titlePx + CELL + spacedPx(actions) <= cardInner(columns)
}

/**
 * How far the Branches card must shorten: 0 whole, 1 without the ages, 2 without the ages and with glyph-only buttons.
 * Each row is the icon, name, cloud, pills and age at the left, its buttons at the right; the widest row decides.
 */
export function branchesStage(columns: number, rows: { name: string; marks: number; pills: string[]; age: string; buttons: string[] }[], glyphOf: (label: string) => string): 0 | 1 | 2 {
  const room = cardInner(columns) - CELL - ROW_SLACK
  const width = (row: (typeof rows)[number], age: boolean, glyphs: boolean): number =>
    ICON_PX + CELL + textPx(row.name, 15) + row.marks * (CELL + ICON_PX) + row.pills.reduce((sum, pill) => sum + CELL + countWidth(pill), 0) + (age ? CELL + textPx(row.age, 15) : 0) + spacedPx(glyphs ? row.buttons.map(glyphOf) : row.buttons)
  const fits = (age: boolean, glyphs: boolean) => rows.every(row => width(row, age, glyphs) <= room)
  if (fits(true, false)) return 0
  if (fits(false, false)) return 1
  return 2
}

/** The room a Branches card row leaves its name once the ages are gone and the buttons are glyphs: the last resort. */
export function branchNameRoom(columns: number, row: { marks: number; pills: string[]; buttons: string[] }): number {
  return cardInner(columns) - CELL - ROW_SLACK - (ICON_PX + CELL + row.marks * (CELL + ICON_PX) + row.pills.reduce((sum, pill) => sum + CELL + countWidth(pill), 0) + spacedPx(row.buttons))
}

// The least a commit subject keeps before a History row would rather lose its author: a few letters and the `…`.
const MIN_SUBJECT = 48
// The avatar beside each History row's graph.
const AVATAR_PX = 18

/**
 * Whether every History row fits with its author beside its age: the graph, avatar, a few letters of subject, the
 * pills (their widths in px) and `Author · 4d`. When one does not, the rows show their ages alone, all together, so
 * the ages still line up in a column at the right edge.
 */
export function historyAuthorFits(columns: number, lanesPx: number, rows: { pills: number[]; meta: string }[]): boolean {
  const room = cardInner(columns) - ROW_SLACK
  return rows.every(row => lanesPx + CELL + AVATAR_PX + CELL + MIN_SUBJECT + CELL + row.pills.reduce((sum, px) => sum + px + CELL, 0) + textPx(row.meta, 15) <= room)
}
