import type { SyncKind } from '../types'

/** A quiet fetch this often while the switch is on. */
export const AUTO_FETCH_MS = 5 * 60_000
/** This many failed fetches in a row raise the one note. */
const FAILURES_BEFORE_NOTE = 3

/** The same fetch the Fetch button runs: `--prune` drops branches deleted on origin. */
export const autoFetchCommand = (): string[] => ['git', 'fetch', '--prune']

/** Whether the timer's tick should fetch now: switched on, pane open, no sync running, an origin to ask, and the interval passed since the last fetch (manual or automatic). */
export function shouldAutoFetch(input: { isEnabled: boolean; isClosed: boolean; busy: SyncKind | null; hasOrigin: boolean; now: number; lastAt: number }): boolean {
  return input.isEnabled && !input.isClosed && input.busy === null && input.hasOrigin && input.now - input.lastAt >= AUTO_FETCH_MS
}

/** The toast after a quiet fetch: only when more commits are behind than before. */
export function newCommitsNote(before: number, after: number): string | null {
  const added = after - before
  return added > 0 ? `${added} new ${added === 1 ? 'commit' : 'commits'} on origin` : null
}

/** Failures in a row: one more after a failed fetch, none after a success. */
export const nextFailures = (count: number, isOk: boolean): number => (isOk ? 0 : count + 1)

/** The dim header note once fetches keep failing (offline, signed out). */
export const FAILURE_NOTE = 'auto-fetch cannot reach origin'
/** The note after this many failures in a row; null until there are enough. */
export const failureNote = (count: number): string | null => (count >= FAILURES_BEFORE_NOTE ? FAILURE_NOTE : null)
