import type { Checks, PullRequest } from '../types'

/** What `gh pr view --json` is asked for. */
export const PR_FIELDS = 'number,title,url,baseRefName,state,mergeable,commits,additions,deletions,statusCheckRollup'
/** An open PR is looked up again this often; a branch with none is looked up when it changes or on a forced refresh. */
export const PR_EVERY_MS = 60_000

/** A rollup entry: a check run has `status` and `conclusion`, a commit status context has `state`. */
type Check = { status?: unknown; conclusion?: unknown; state?: unknown }

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
const word = (value: unknown): string => (typeof value === 'string' ? value.toUpperCase() : '')

/** Any failure fails, any unfinished check runs, otherwise pass; no entries is none. */
export function checksOf(rollup: unknown): { checks: Checks; failing: number } {
  if (!Array.isArray(rollup) || rollup.length === 0) return { checks: 'none', failing: 0 }
  let failing = 0
  let running = 0
  for (const entry of rollup as Check[]) {
    const conclusion = word(entry.conclusion)
    const state = word(entry.state)
    const status = word(entry.status)
    if (FAILED.has(conclusion) || state === 'FAILURE' || state === 'ERROR') failing++
    else if ((status !== '' && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED') running++
  }
  if (failing > 0) return { checks: 'fail', failing }
  return { checks: running > 0 ? 'run' : 'pass', failing: 0 }
}

type View = {
  number?: unknown
  title?: unknown
  url?: unknown
  baseRefName?: unknown
  state?: unknown
  mergeable?: unknown
  commits?: unknown
  additions?: unknown
  deletions?: unknown
  statusCheckRollup?: unknown
}

/** `gh pr view --json …` as a PullRequest; null when it is not an open PR (a merged or closed one for the branch, an error message, junk). */
export function parsePr(stdout: string): PullRequest | null {
  let view: View | null
  try {
    view = JSON.parse(stdout) as View | null
  } catch {
    return null
  }
  if (view === null || typeof view !== 'object' || typeof view.number !== 'number' || view.state !== 'OPEN') return null
  const { checks, failing } = checksOf(view.statusCheckRollup)
  return {
    number: view.number,
    title: typeof view.title === 'string' ? view.title : '',
    url: typeof view.url === 'string' ? view.url : '',
    base: typeof view.baseRefName === 'string' ? view.baseRefName : '',
    commits: Array.isArray(view.commits) ? view.commits.length : 0,
    additions: typeof view.additions === 'number' ? view.additions : 0,
    deletions: typeof view.deletions === 'number' ? view.deletions : 0,
    checks,
    failing,
    hasConflicts: view.mergeable === 'CONFLICTING',
  }
}

/** `origin/main` as gh wants it, `main`. */
export function branchOf(base: string): string {
  return base.replace(/^origin\//, '')
}

export type Step = { argv: string[]; stdin?: string }

/** Push when the branch is not on the remote yet or is ahead of it, then open the PR with the description on stdin (an empty one is still sent). */
export function createSteps(input: { branch: string; base: string; title: string; description: string; needsPush: boolean }): Step[] {
  const steps: Step[] = []
  if (input.needsPush) steps.push({ argv: ['git', 'push', '-u', 'origin', input.branch] })
  steps.push({
    argv: ['gh', 'pr', 'create', '--base', branchOf(input.base), '--head', input.branch, '--title', input.title, '--body-file', '-'],
    stdin: input.description,
  })
  return steps
}

export const mergeStep = (number: number): string[] => ['gh', 'pr', 'merge', String(number), '--squash', '--delete-branch']
export const closeStep = (number: number): string[] => ['gh', 'pr', 'close', String(number)]

/** Whether to run `gh pr view` now. A detached HEAD or a branch with no upstream cannot have a PR. */
export function shouldLookup(input: { force: boolean; branch: string; upstream: string | null; lastBranch: string | null; lastAt: number; now: number; hasPr: boolean }): boolean {
  if (input.branch === '' || input.upstream === null) return false
  if (input.force || input.branch !== input.lastBranch) return true
  return input.hasPr && input.now - input.lastAt >= PR_EVERY_MS
}

/** What `gh pr view` says for a branch without a PR: the only failure that means "none". A timeout or a network error says something else and must not drop a card. */
export const hasNoPr = (stderr: string): boolean => /no pull requests found/i.test(stderr)

/** `gh auth status` failing because gh is missing or signed out, which will not pass by itself; any other failure (offline) is asked again. */
export const isGhAbsent = (stderr: string): boolean => /not logged in|no oauth token|enoent|not found|no such file|could not start/i.test(stderr)
