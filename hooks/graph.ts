import type { Commit } from '../types'

/**
 * One commit's row in the graph: which lane holds its dot, and how the lanes
 * around it connect on this row. Lanes are numbered from 0 at the left.
 */
export type Row = {
  commit: Commit
  lane: number
  /** A line arrives at the dot from above: some child was waiting for this commit. */
  fromAbove: boolean
  /** The commit's own lane carries on below (its first parent is still to come). */
  continues: boolean
  /** Other lanes that end at this commit: their line curves in from above. */
  joins: number[]
  /** Other lanes this commit connects to below: a new lane for a parent, or an existing one. */
  down: number[]
  /** Lanes that run through this row, the commit's own excluded. */
  passing: number[]
  /** How many lanes this row draws. */
  width: number
}

/** A row's lanes without its commit: what the renderers draw from. */
export type Lanes = Omit<Row, 'commit'>

export type Glyph = { text: string; lane: number | null }

/**
 * Assigns lanes, commits in the order git listed them (children before
 * parents). `active[i]` is the hash lane i is waiting for; a lane stays open
 * until that commit appears, so a side branch runs beside the main line down
 * to the commit it forked from, as `git log --graph` draws it.
 */
export function layout(commits: Commit[]): Row[] {
  const active: (string | null)[] = []
  const rows: Row[] = []

  for (const commit of commits) {
    const before = active.slice()
    const waiting = indicesOf(active, commit.hash)
    // A lane freed on this row is not reused on it, so a join and a fork never share a cell.
    const free = () => {
      const slot = active.findIndex((h, i) => h === null && (before[i] ?? null) === null)
      if (slot !== -1) return slot
      active.push(null)
      return active.length - 1
    }

    const lane = waiting[0] ?? free()
    const fromAbove = waiting.length > 0
    const joins = waiting.slice(1)
    for (const j of joins) active[j] = null

    const [first, ...rest] = commit.parents
    const down: number[] = []
    const continues = first !== undefined
    active[lane] = first ?? null
    for (const parent of rest) {
      const existing = active.indexOf(parent)
      if (existing !== -1) {
        if (!down.includes(existing)) down.push(existing)
        continue
      }
      const slot = free()
      active[slot] = parent
      down.push(slot)
    }

    const passing: number[] = []
    for (let i = 0; i < Math.max(before.length, active.length); i++) {
      if (i !== lane && (before[i] ?? null) !== null && (active[i] ?? null) !== null) passing.push(i)
    }

    while (active.length > 0 && active[active.length - 1] === null) active.pop()
    const width = Math.max(before.length, active.length, lane + 1, ...down.map(d => d + 1), ...joins.map(j => j + 1))
    rows.push({ commit, lane, fromAbove, continues, joins, down, passing, width })
  }

  return rows
}

function indicesOf(list: (string | null)[], hash: string): number[] {
  const found: number[] = []
  list.forEach((h, i) => {
    if (h === hash) found.push(i)
  })
  return found
}

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8

const LINES: Record<number, string> = {
  [UP]: '│',
  [DOWN]: '│',
  [UP | DOWN]: '│',
  [LEFT]: '─',
  [RIGHT]: '─',
  [LEFT | RIGHT]: '─',
  [DOWN | RIGHT]: '╭',
  [DOWN | LEFT]: '╮',
  [UP | RIGHT]: '╰',
  [UP | LEFT]: '╯',
  [UP | DOWN | RIGHT]: '├',
  [UP | DOWN | LEFT]: '┤',
  [LEFT | RIGHT | DOWN]: '┬',
  [LEFT | RIGHT | UP]: '┴',
  [UP | DOWN | LEFT | RIGHT]: '┼',
}

/**
 * Draws one row as a run of cells, two per lane (the lane's cell and the gap
 * after it), each with the lane that colours it. `width` pads the run so the
 * text after every row lines up.
 */
export function glyphs(row: Lanes, width = row.width): Glyph[] {
  const cols = Math.max(width, row.width) * 2 - 1
  const bits: number[] = new Array(cols).fill(0)
  const owner: (number | null)[] = new Array(cols).fill(null)
  const at = (lane: number) => lane * 2
  const add = (col: number, mask: number) => {
    bits[col] = (bits[col] ?? 0) | mask
  }

  for (const p of row.passing) {
    add(at(p), UP | DOWN)
    owner[at(p)] = p
  }
  const horizontal = (from: number, to: number, colour: number) => {
    const [lo, hi] = from < to ? [from, to] : [to, from]
    for (let col = at(lo) + 1; col < at(hi); col++) {
      add(col, LEFT | RIGHT)
      // A gap takes the side lane's colour; a passing lane keeps its own.
      if (col % 2 === 1 || owner[col] === null) owner[col] = colour
    }
  }
  for (const j of row.joins) {
    add(at(j), UP | (j < row.lane ? RIGHT : LEFT))
    owner[at(j)] = j
    horizontal(j, row.lane, j)
  }
  for (const d of row.down) {
    add(at(d), DOWN | (d < row.lane ? RIGHT : LEFT))
    if (owner[at(d)] === null) owner[at(d)] = d
    horizontal(d, row.lane, d)
  }

  const out: Glyph[] = []
  for (let col = 0; col < cols; col++) {
    if (col === at(row.lane)) {
      out.push({ text: '●', lane: row.lane })
      continue
    }
    const b = bits[col] ?? 0
    out.push(b === 0 ? { text: ' ', lane: null } : { text: LINES[b] ?? '│', lane: owner[col] ?? null })
  }
  return out
}
