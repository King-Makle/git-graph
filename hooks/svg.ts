import type { Lanes } from './graph'

/** Pixels per lane and per row on a desktop surface, the same for every row so the lanes line up. */
export const LANE_W = 10
// Taller than the text beside it, so the row takes the SVG's height and vertical lines meet edge to edge.
export const ROW_H = 22
const DOT = 3.5
const STROKE = 1.5

export type DotStyle = {
  /** Hollow dot with a heavier stroke: the commit HEAD points at. */
  isHead?: boolean
  /** Hollow dot and dashed stem: the uncommitted changes row. */
  isHollow?: boolean
  /** Dashed hollow dot and dashed stem: a commit on the upstream that has not been pulled. */
  isIncoming?: boolean
  /** A ring in the dot colour with solid stems: a merge row in the Main line view. */
  isMerge?: boolean
  /** The dot's colour when it differs from the lane's stem colour (a trunk commit: grey stem, its author's dot). */
  dot?: string
  /** The stem below the dot on its own lane. */
  below?: string
  /** A ring round the dot: an incoming commit that touches a file the person changed. */
  ring?: string
}

/** The clash ring's radius: as wide as a lane allows, so lane 0's ring is not cut by the SVG's left edge. */
export const RING = 5

/**
 * One row's graph segment as an SVG document: the dot on its
 * lane, straight stems, a quarter curve for each lane that forks or joins.
 */
export function svgRow(row: Lanes, width: number, color: (lane: number) => string, style: DotStyle): string {
  const w = Math.max(width, row.width) * LANE_W
  const x = (lane: number) => LANE_W / 2 + lane * LANE_W
  const mid = ROW_H / 2
  const xi = x(row.lane)
  const own = color(row.lane)
  const fill = style.dot ?? own
  const isDashed = style.isHollow === true || style.isIncoming === true
  const parts: string[] = []
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, dashed = false) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${STROKE}"${dashed ? ' stroke-dasharray="2 3"' : ''}/>`
  const curve = (d: string, stroke: string) => `<path d="${d}" stroke="${stroke}" stroke-width="${STROKE}" fill="none"/>`

  for (const p of row.passing) parts.push(line(x(p), 0, x(p), ROW_H, color(p)))
  if (row.fromAbove) parts.push(line(xi, 0, xi, mid, own))
  if (row.continues) parts.push(line(xi, mid, xi, ROW_H, style.below ?? own, isDashed))
  for (const j of row.joins) parts.push(curve(`M ${x(j)} 0 Q ${x(j)} ${mid} ${xi} ${mid}`, color(j)))
  for (const d of row.down) parts.push(curve(`M ${xi} ${mid} Q ${x(d)} ${mid} ${x(d)} ${ROW_H}`, color(d)))

  if (style.ring !== undefined) parts.push(`<circle cx="${xi}" cy="${mid}" r="${RING}" fill="none" stroke="${style.ring}" stroke-width="${STROKE}"/>`)
  if (style.isIncoming) {
    parts.push(`<circle cx="${xi}" cy="${mid}" r="${DOT}" fill="none" stroke="${fill}" stroke-width="${STROKE}" stroke-dasharray="2 1.6"/>`)
  } else if (style.isHollow || style.isMerge) {
    parts.push(`<circle cx="${xi}" cy="${mid}" r="${DOT}" fill="none" stroke="${fill}" stroke-width="${STROKE}"/>`)
  } else if (style.isHead) {
    parts.push(`<circle cx="${xi}" cy="${mid}" r="4" fill="none" stroke="${fill}" stroke-width="2"/>`)
  } else {
    parts.push(`<circle cx="${xi}" cy="${mid}" r="${DOT}" fill="${fill}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ROW_H}" viewBox="0 0 ${w} ${ROW_H}">${parts.join('')}</svg>`
}

export type PillSpec = { kind: 'head' | 'local' | 'remote' | 'tag' | 'more'; label: string; title: string; isRemote: boolean; isElsewhere?: boolean; hidden?: HiddenKind[] }
/** What a `more` pill folds, one icon each: a branch, a branch only origin has, a tag. */
export type HiddenKind = 'branch' | 'cloud' | 'tag'

/** Pixels: a pill's height, its side padding, the icon size, the gap after the icon, the average glyph width at 13px. */
export const PILL_H = 20
const PILL_PAD = 8
const PILL_ICON = 12
const PILL_GAP = 5
// Glyph widths at 12px: narrow, wide, and everything else.
const NARROW_GLYPHS = /[iljtfr.,:;'|!I()[\]{}/ ]/
const WIDE_GLYPHS = /[mwMW@]/
const textWidth = (text: string): number => [...text].reduce((w, ch) => w + (NARROW_GLYPHS.test(ch) ? 3.4 : WIDE_GLYPHS.test(ch) ? 9.6 : 6.6), 0)
const PILL_BG = '#2b63c8'
const PILL_TAG_BG = '#8a5a12'
// A branch checked out in another worktree (PURPLE_PILL in chips.tsx).
const PILL_ELSEWHERE_BG = '#6d4fc2'

// Lucide's icons, 24-unit paths drawn in white at 12px.
const ICONS = {
  branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1" fill="#ffffff"/>',
  // Worktrees: a checkout's folder, and the house on a branch chip checked out in another one.
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  // The toolbar's icons.
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  fetch: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  pull: '<path d="M12 3v18"/><path d="m6 15 6 6 6-6"/>',
  push: '<path d="M12 21V3"/><path d="m6 9 6-6 6 6"/>',
  // Changes' controls.
  selectAll: '<path d="M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5"/><path d="m9 11 3 3L22 4"/>',
  stash: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
}
export type IconName = keyof typeof ICONS

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"


/** Pixels: a toolbar icon's side. */
export const ICON = 13

/** One icon on its own, in the chip's text colour, for the toolbar and the branch name. */
export function svgIcon(name: IconName, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 ${ICON} ${ICON}">` +
    `<g transform="scale(${ICON / 24})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g></svg>`
  )
}

/** Pixels: a count pill's height, its side padding, the average glyph width at 11px semibold. */
export const COUNT_H = 16
const COUNT_PAD = 5
const COUNT_CHAR = 6.6

/** The width a count pill needs for its label; never narrower than it is tall, so one digit is a circle. */
export function countWidth(label: string): number {
  return Math.max(COUNT_H, Math.ceil(COUNT_PAD * 2 + label.length * COUNT_CHAR))
}

/** A count as a small rounded pill: a section's file count, the branch's ahead and behind. `title` is its tooltip. */
export function svgCount(label: string, bg: string, fg: string, title?: string): string {
  const w = countWidth(label)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${COUNT_H}" viewBox="0 0 ${w} ${COUNT_H}">` +
    tip(title) +
    `<rect width="${w}" height="${COUNT_H}" rx="${COUNT_H / 2}" fill="${bg}"/>` +
    `<text x="${w / 2}" y="${COUNT_H / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="600" fill="${fg}">${escapeXml(label)}</text></svg>`
  )
}

/** Pixels: the rule's box and where its line sits; the air above and below is what spaces a header band from its body. */
export const RULE_H = 10
const RULE_Y = 5

/** A one-pixel rule in a box that stretches to its slot: under a card's header row and under the header strip. */
export function svgRule(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${RULE_H}" viewBox="0 0 100 ${RULE_H}" preserveAspectRatio="none"><rect y="${RULE_Y}" width="100" height="1" fill="${color}"/></svg>`
}

/**
 * Air of a given height across the whole slot, drawn as the rules are (width 100% in the markup, no width prop, a
 * shape inside, an alt text). On the live desktop (2026-10-09) a 1px-wide empty Svg with an empty alt took no height;
 * this one does. Give it an alt: the engine's margins are whole cells, this is the few pixels between.
 */
export function svgSpace(height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" viewBox="0 0 100 ${height}" preserveAspectRatio="none"><rect width="100" height="${height}" fill="transparent"/></svg>`
}

/** Pixels: a status letter's box, as wide as the widest letter so the names line up, as tall as a file row. */
export const LETTER_W = 14
export const FILE_ROW_H = 20

/** One status letter in its colour at a fixed width, so `U` and `M` rows align their names. `title` spells the status out as its tooltip. */
export function svgLetter(letter: string, color: string, title?: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LETTER_W}" height="${FILE_ROW_H}" viewBox="0 0 ${LETTER_W} ${FILE_ROW_H}">` +
    tip(title) +
    `<text x="${LETTER_W / 2}" y="${FILE_ROW_H / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="13" font-weight="600" fill="${color}">${escapeXml(letter)}</text></svg>`
  )
}

/** Pixels: an avatar's diameter. */
export const AVATAR = 18

/** An author's initials in a slate circle, drawn before the subject of each commit row. `title` (the name and the date) is its tooltip. */
export function svgAvatar(text: string, title?: string, fill = '#4c5a73', size = AVATAR): string {
  const r = size / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    tip(title) +
    `<circle cx="${r}" cy="${r}" r="${r}" fill="${fill}"/>` +
    `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${Math.round(size / 2)}" font-weight="700" fill="#ffffff">${escapeXml(text)}</text></svg>`
  )
}

/** Pixels: the commit card's group names, a fixed column so each row's buttons start at the same x; as tall as a button. */
export const LABEL_W = 108
export const LABEL_H = 26

/** A group's name as text in a fixed-width box: the engine refuses a Box width on the desktop, an Svg keeps one. */
export function svgLabel(text: string, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_W}" height="${LABEL_H}" viewBox="0 0 ${LABEL_W} ${LABEL_H}">` +
    `<text x="0" y="${LABEL_H / 2}" dominant-baseline="central" font-family="${FONT}" font-size="14" fill="${color}">${escapeXml(text)}</text></svg>`
  )
}

/** Pixels: the commit card's avatar, beside a two-line header. */
export const AVATAR_BIG = 28

/** Pixels: the diffstat's five squares, each SQUARE wide with SQUARE_GAP between, as tall as a file row. */
const SQUARES = 5
const SQUARE = 7
const SQUARE_GAP = 2
export const DIFFSTAT_W = SQUARES * SQUARE + (SQUARES - 1) * SQUARE_GAP

/** How many of the five squares are green and red: GitHub's split, at least one each for a side that has lines. */
export function diffstatSplit(added: number, deleted: number): { green: number; red: number } {
  const total = added + deleted
  if (total === 0) return { green: 0, red: 0 }
  let green = Math.round((SQUARES * added) / total)
  if (added > 0 && green === 0) green = 1
  if (deleted > 0 && green === SQUARES) green = SQUARES - 1
  return { green, red: SQUARES - green }
}

/** A file's added and deleted lines as five squares, green then red, as GitHub's diffstat. */
export function svgDiffstat(added: number, deleted: number): string {
  const { green, red } = diffstatSplit(added, deleted)
  const y = (FILE_ROW_H - SQUARE) / 2
  const squares = Array.from({ length: SQUARES }, (_, i) => {
    const fill = i < green ? '#3fb950' : i < green + red ? '#e5534b' : '#3a3f47'
    return `<rect x="${i * (SQUARE + SQUARE_GAP)}" y="${y}" width="${SQUARE}" height="${SQUARE}" rx="1.5" fill="${fill}"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DIFFSTAT_W}" height="${FILE_ROW_H}" viewBox="0 0 ${DIFFSTAT_W} ${FILE_ROW_H}">${squares.join('')}</svg>`
}

function iconAt(name: keyof typeof ICONS, x: number, color = '#ffffff'): string {
  const scale = PILL_ICON / 24
  const y = (PILL_H - PILL_ICON) / 2
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`
}

/** A `<title>` as the SVG's first child: what the drawing says, for a surface that ever shows it (an image shows none); nothing when there is no title. */
function tip(title: string | undefined): string {
  return title === undefined ? '' : `<title>${escapeXml(title)}</title>`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The width a pill needs for its label and marks, so the text never clips. */
export function pillWidth(pill: PillSpec): number {
  if (pill.kind === 'more') return Math.ceil(PILL_PAD + (pill.hidden ?? []).length * (PILL_ICON + MORE_GAP) + textWidth(pill.label) + PILL_PAD)
  const mark = pill.isRemote && pill.kind !== 'remote' ? PILL_GAP + PILL_ICON : 0
  return Math.ceil(PILL_PAD + PILL_ICON + PILL_GAP + textWidth(pill.label) + mark + PILL_PAD)
}

/**
 * One ref chip: a rounded blue pill, an icon for its kind
 * (target for the HEAD branch, branch, cloud for remote-only, tag), the label,
 * and a cloud mark when origin has the branch too. Fixed height, so rows stay even.
 * The whole name is its tooltip, so a clipped label still reads in full.
 */
export function svgPill(pill: PillSpec): string {
  const w = pillWidth(pill)
  if (pill.kind === 'more') return svgMorePill(pill, w)
  const bg = pill.isElsewhere === true ? PILL_ELSEWHERE_BG : pill.kind === 'tag' ? PILL_TAG_BG : PILL_BG
  const glyph: keyof typeof ICONS = pill.isElsewhere === true ? 'house' : pill.kind === 'head' ? 'target' : pill.kind === 'remote' ? 'cloud' : pill.kind === 'tag' ? 'tag' : 'branch'
  const textX = PILL_PAD + PILL_ICON + PILL_GAP
  const weight = pill.kind === 'head' ? ' font-weight="600"' : ''
  // A remote-only pill already leads with the cloud; the trailing mark is for a local branch origin also has.
  const cloud = pill.isRemote && pill.kind !== 'remote' ? iconAt('cloud', w - PILL_PAD - PILL_ICON) : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${PILL_H}" viewBox="0 0 ${w} ${PILL_H}">` +
    tip(pill.title) +
    `<rect width="${w}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${bg}"/>` +
    iconAt(glyph, PILL_PAD) +
    `<text x="${textX}" y="${PILL_H / 2}" dominant-baseline="central" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="12"${weight} fill="#ffffff">${escapeXml(pill.label)}</text>` +
    cloud +
    `</svg>`
  )
}

// The folded pill: grey, so it reads as a count beside the real chips, with a small icon per kind it folds.
const MORE_BG = '#2a2f37'
const MORE_FG = '#a3a9b3'
const MORE_GAP = 3

/** `+2` with the icons of what it folds (a branch, a tag): the refs a row has no room for. */
function svgMorePill(pill: PillSpec, w: number): string {
  const icons = (pill.hidden ?? []).map((kind, index) => iconAt(kind, PILL_PAD + index * (PILL_ICON + MORE_GAP), MORE_FG)).join('')
  const textX = PILL_PAD + (pill.hidden ?? []).length * (PILL_ICON + MORE_GAP)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${PILL_H}" viewBox="0 0 ${w} ${PILL_H}">` +
    tip(pill.title) +
    `<rect width="${w}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${MORE_BG}"/>` +
    icons +
    `<text x="${textX}" y="${PILL_H / 2}" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="600" fill="${MORE_FG}">${escapeXml(pill.label)}</text></svg>`
  )
}

const STASH = '#22d3ee'

/** A stash row's marker in the lane column: a dashed square, nothing like a commit's dot. */
export function svgStashMarker(): string {
  const size = 7
  const x = (LANE_W - size) / 2
  const y = (ROW_H - size) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LANE_W}" height="${ROW_H}" viewBox="0 0 ${LANE_W} ${ROW_H}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="1.5" fill="none" stroke="${STASH}" stroke-width="${STROKE}" stroke-dasharray="2 1.5"/></svg>`
}
