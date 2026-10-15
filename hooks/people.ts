import type { Commit } from '../types'
import type { Row } from './graph'

/** The person's own colour: the blue dots have always been. */
export const YOU = '#3b82f6'
/** The trunk's stems (the first-parent chain from HEAD and from the upstream): neutral, so the main line does not flicker with every author. */
export const TRUNK = '#5b6472'
// Teal, pink, lime, sky, yellow, lavender: never orange (a clash) or red (a failure).
const OTHERS = ['#14b8a6', '#ec4899', '#a3e635', '#38bdf8', '#facc15', '#c4b5fd'] as const

/** A person's colour: blue for you, otherwise one of six chosen by a stable hash of the name. */
export function personColor(name: string, you: string): string {
  if (you !== '' && name === you) return YOU
  let hash = 0
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return OTHERS[hash % OTHERS.length]!
}

/** Hashes on the first-parent chain from HEAD and from the commit the upstream points at. */
export function trunkHashes(commits: Commit[], headHash: string, upstream: string | null): Set<string> {
  const byHash = new Map(commits.map(commit => [commit.hash, commit]))
  const starts = [headHash]
  const tip = upstream === null ? undefined : commits.find(commit => commit.refs.includes(upstream))
  if (tip !== undefined) starts.push(tip.hash)
  const trunk = new Set<string>()
  for (const start of starts) {
    let at = byHash.get(start)
    while (at !== undefined && !trunk.has(at.hash)) {
      trunk.add(at.hash)
      const parent = at.parents[0]
      at = parent === undefined ? undefined : byHash.get(parent)
    }
  }
  return trunk
}

/** One row's colours: each lane's stem as the row is entered, the commit's dot, the stem below it, and each lane it forks into. */
export type RowColors = { entering: Record<number, string>; dot: string; below: string; down: Record<number, string> }

/**
 * Colours for every row. A lane carries the colour of the last commit placed on
 * it (a trunk commit's stem is `TRUNK`, its dot its author's colour); a lane a
 * merge opens for a later parent takes that parent's colour, so the branch
 * being merged reads as its author's from the merge down.
 */
export function laneColors(rows: Row[], colorOf: (commit: Commit) => string, isTrunk: (commit: Commit) => boolean): RowColors[] {
  const byHash = new Map(rows.map(row => [row.commit.hash, row.commit]))
  const stemOf = (commit: Commit) => (isTrunk(commit) ? TRUNK : colorOf(commit))
  const owner: Record<number, string> = {}
  const out: RowColors[] = []
  for (const row of rows) {
    const entering = { ...owner }
    const dot = colorOf(row.commit)
    const below = stemOf(row.commit)
    for (const j of row.joins) delete owner[j]
    if (row.continues) owner[row.lane] = below
    else delete owner[row.lane]
    const down: Record<number, string> = {}
    row.commit.parents.slice(1).forEach((parent, i) => {
      const lane = row.down[i]
      if (lane === undefined) return
      const target = byHash.get(parent)
      const colour = owner[lane] ?? (target === undefined ? below : stemOf(target))
      down[lane] = colour
      owner[lane] = colour
    })
    out.push({ entering, dot, below, down })
  }
  return out
}

/** `git check-mailmap "Name <email>"`: asks git what the repo's .mailmap makes of the person's own name and address. */
export const checkMailmapCommand = (name: string, email: string): string[] => ['git', 'check-mailmap', `${name} <${email}>`]

/** The name check-mailmap answers (`Canonical Name <email>`), else the configured one when it said nothing or failed. */
export function canonicalName(stdout: string, configured: string): string {
  const hit = /^(.+?) <[^>]*>\s*$/m.exec(stdout.trim())
  return hit === null ? configured : hit[1]!
}
