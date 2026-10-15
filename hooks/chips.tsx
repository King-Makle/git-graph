import type { ElementTable, Elements, RenderElement } from 'claude-code'

import { PILL_H, pillWidth, svgPill } from './svg'
import type { HiddenKind } from './svg'

// The chip and card colours on a dark ground.
export const PILL = '#2b63c8'
export const PILL_TAG = '#8a5a12'
export const CARD = '#1c1f24'
export const RULE = '#3a3f47'
export const GREEN = '#4ade80'
export const RED = '#f87171'
export const HOVER = '#262a30'
// The approved look (2026-10-05): a darker header strip, tinted section cards, orange for undo and the dirty count.
export const STRIP = '#15181d'
export const CARD_BG = '#1f2329'
export const ORANGE = '#f97316'
export const DIM = '#8b949e'
// Rows not pulled yet: a faint blue tint, a stronger one for the band that counts them, and the band's text.
export const INCOMING_BG = '#1f2a3b'
export const BAND_BG = '#22304a'
export const BLUE_TEXT = '#7aa7ff'
// Checked out in another worktree: the Branches card's pill and icon, the Worktrees card, the History chip.
export const PURPLE = '#a78bfa'
export const PURPLE_BG = 'rgba(167,139,250,0.18)'
export const PURPLE_PILL = '#6d4fc2'

/**
 * The toolbar's icons as glyphs inside the Button's own label ("⤓ Fetch"). An Svg beside the Button was not
 * pressable, so a click on the icon did nothing and the hover lit only the word (2026-10-05); a glyph in the
 * label is one control with one hover and one click target. A Button takes no colour, so these are plain.
 */
export const GLYPH = { undo: '↚', fetch: '⤓', pull: '↓', push: '↑', selectAll: '☑', selectNone: '□', stash: '❏', stage: '＋', worktree: '⌂' } as const

/** A glyph-and-word label as its glyph alone in a narrow pane (`⤓ Fetch` to `⤓`), whole otherwise. */
export const glyphOnly = (label: string, isCompact: boolean): string => (isCompact ? (label.split(' ')[0] ?? label) : label)

/**
 * Dev probe: which of the newer desktop features the drawing uses. The live desktop refuses a
 * tree it cannot draw without a word, so the reload tool's `probe` opens one pane per feature,
 * each drawn with that feature alone (see register.tsx), and the pane that draws names what the
 * desktop accepts. Every normal drawing runs with both on. (Tooltips were a third feature: an
 * `isInteractive` Svg is a frame the desktop re-creates on every redraw, so it blinked on scroll;
 * every Svg is an image again, 2026-10-05.)
 */
export type Look = { editor: boolean }
// `editor`: the message box is the mod's own multi-line editor (editor.tsx), not the desktop's one-line Input.
export const look: Look = { editor: true }
export function setLook(next: Partial<Look>): void {
  Object.assign(look, next)
}

export type Chip = {
  /** `head` is the branch HEAD is on, `local` another local branch, `remote` a remote-only branch, `tag` a tag, `more` the count of chips past the row's cap. */
  kind: 'head' | 'local' | 'remote' | 'tag' | 'more'
  /** What the row shows, clipped. */
  label: string
  /** The whole name (or names, for `more`), for the hover card. */
  title: string
  /** A local branch that `origin` also has on this commit: one chip with a cloud mark. */
  isRemote: boolean
  /** Checked out in another worktree (or, for a detached one, that worktree's commit): a purple chip with a house. */
  isElsewhere?: boolean
  /** For `more`: one icon per kind it folds. */
  hidden?: HiddenKind[]
}

// A row shows this many chips; a long branch name is clipped so one chip stays one line. A
// narrow pane shows one shorter chip and the count (see NARROW in pane.tsx).
const CHIPS_PER_ROW = 2
const CHIP_CHARS = 18

/** `%D` as git spells it, `HEAD -> main, origin/main, tag: v1`. */
export function refChips(refs: string[], max = CHIPS_PER_ROW, chars = CHIP_CHARS): Chip[] {
  const names = refs.filter(ref => ref !== 'origin/HEAD')
  const remotes = new Set(names.filter(ref => ref.startsWith('origin/')).map(ref => ref.slice(7)))
  const chips: Chip[] = []
  for (const ref of names) {
    if (ref.startsWith('HEAD -> ')) chips.push({ kind: 'head', label: ref.slice(8), title: ref.slice(8), isRemote: remotes.has(ref.slice(8)) })
    else if (ref === 'HEAD') chips.push({ kind: 'head', label: 'HEAD', title: 'HEAD', isRemote: false })
    else if (ref.startsWith('tag: ')) chips.push({ kind: 'tag', label: ref.slice(5), title: ref.slice(5), isRemote: false })
    else if (ref.startsWith('origin/')) {
      // A remote branch whose local branch sits on the same commit folds into that chip, the checked-out one included.
      if (!names.includes(ref.slice(7)) && !names.includes(`HEAD -> ${ref.slice(7)}`)) chips.push({ kind: 'remote', label: ref, title: ref, isRemote: true })
    } else chips.push({ kind: 'local', label: ref, title: ref, isRemote: remotes.has(ref) })
  }
  const order: Chip['kind'][] = ['head', 'local', 'remote', 'tag', 'more']
  chips.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  const shown = chips.slice(0, max).map(chip => ({ ...chip, label: clip(chip.label, chars) }))
  const rest = chips.slice(max)
  if (rest.length === 0) return shown
  const kinds: HiddenKind[] = (['branch', 'cloud', 'tag'] as const).filter(kind => rest.some(chip => (chip.kind === 'tag' ? 'tag' : chip.kind === 'remote' ? 'cloud' : 'branch') === kind))
  return [...shown, { kind: 'more', label: `+${rest.length}`, title: rest.map(chip => chip.title).join(', '), isRemote: false, hidden: kinds }]
}

/** One chip: a rounded pill with an icon on surfaces that draw Svg, a coloured Text on the terminal. */
export function pill(table: ElementTable, Svg: Elements['desktop']['Svg'] | undefined, chip: Chip): RenderElement {
  const { Text } = table
  if (Svg === undefined) {
    if (chip.kind === 'more') return <Text dimColor>{` ${chip.label} `}</Text>
    const bg = chip.isElsewhere === true ? PURPLE_PILL : chip.kind === 'tag' ? PILL_TAG : PILL
    const mark = chip.isElsewhere === true ? '⊡ ' : chip.kind === 'head' ? '◎ ' : chip.kind === 'remote' ? '☁ ' : chip.kind === 'tag' ? '⌂ ' : '⑂ '
    return (
      <Text color="#ffffff" backgroundColor={bg} bold={chip.kind === 'head'}>
        {` ${mark}${chip.label}${chip.isRemote && chip.kind !== 'remote' ? ' ☁' : ''} `}
      </Text>
    )
  }
  return <Svg source={svgPill(chip)} alt={`${chip.kind} ${chip.title}`} width={pillWidth(chip)} height={PILL_H} />
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * `2 hours ago`, as git's `%ar` spells it, shortened to `2h`: the first number and unit; seconds are `now`. Git counts
 * in minutes until about 90 and in hours until about a day and a half, so the number carries up a unit when it
 * reaches one: `61 minutes` is `1h`, `35 hours` is `1d`, `10 days` is `1w`. Anything else as given.
 */
export function ago(relative: string): string {
  const match = /^(\d+)\s+(second|minute|hour|day|week|month|year)/.exec(relative)
  if (match === null) return relative
  const count = Number(match[1])
  const unit = match[2]!
  if (unit === 'second') return 'now'
  const days = (n: number) => (n < 7 ? `${n}d` : `${Math.floor(n / 7)}w`)
  const hours = (n: number) => (n < 24 ? `${n}h` : days(Math.floor(n / 24)))
  if (unit === 'minute') return count < 60 ? `${count}m` : hours(Math.floor(count / 60))
  if (unit === 'hour') return hours(count)
  if (unit === 'day') return days(count)
  return `${count}${unit === 'month' ? 'mo' : unit[0]}`
}

/** `cherry-pick` to `Cherry-Pick`, `undo on main` to `Undo On Main`: labels, buttons and pills capitalise every word, the short ones too (the user's rule, 2026-10-14). */
export function titleCase(text: string): string {
  return text
    .split(' ')
    .map(word => word.split('-').map(part => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part)).join('-'))
    .join(' ')
}

/** `main` to `Main`: the first letter upper-cased for display, the rest as it is. */
export const capitalize = (text: string): string => (text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1))

/** `King Makle` to `KM`: the first letter of the first two words, upper-cased; `?` for no name. */
export function initials(author: string): string {
  const letters = author
    .split(/\s+/)
    .filter(word => word.length > 0)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
  return letters.length === 0 ? '?' : letters.join('')
}
