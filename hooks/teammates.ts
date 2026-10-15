import type { Checks, PrBadge, Teammate, TeammateFile } from '../types'
import { checksOf } from './pr'

/** The Teammates card lists this many rows; the rest are a count. */
export const TEAMMATE_ROWS = 12
/** An opened row lists this many files and commits. */
export const SHOWN_FILES = 10
const SHOWN_COMMITS = 8
/** A branch with no activity for this long is left out. */
const STALE_SECONDS = 14 * 86_400
const PR_LIST_FIELDS = 'number,title,url,headRefName,isDraft,isCrossRepository,statusCheckRollup,updatedAt,additions,deletions'

/** `gh pr list` for every open PR; forks are not asked for. */
export const prListCommand = (): string[] => ['gh', 'pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_LIST_FIELDS]
/** The PRs merged lately, by head branch and merge time: a branch whose PR merged after its last commit is done, not in flight. */
export const mergedListCommand = (): string[] => ['gh', 'pr', 'list', '--state', 'merged', '--limit', '50', '--json', 'headRefName,mergedAt']
/** The open PRs whose review was asked of the person: only their numbers are read. */
export const reviewListCommand = (): string[] => ['gh', 'pr', 'list', '--state', 'open', '--limit', '50', '--search', 'review-requested:@me', '--json', 'number']

/** Remote branches newest first: name, author (through .mailmap), time and, on git 2.41+, commits ahead of and behind the base. */
export const branchesCommand = (base: string, withCounts: boolean): string[] => [
  'git',
  'for-each-ref',
  '--sort=-committerdate',
  // `:mailmap` needs git 2.42, `ahead-behind` 2.41: the fallback listing (no counts) asks for neither.
  `--format=%(refname:lstrip=3)%1f${withCounts ? '%(authorname:mailmap)' : '%(authorname)'}%1f%(committerdate:unix)${withCounts ? `%1f%(ahead-behind:origin/${base})` : ''}`,
  'refs/remotes/origin',
]
/** The fallback for a git without `ahead-behind`: one count per branch. */
export const countCommand = (base: string, name: string): string[] => ['git', 'rev-list', '--count', `origin/${base}..origin/${name}`]
export const commitsCommand = (base: string, branch: string): string[] => ['git', 'log', '--format=%h%x1f%aN%x1f%s', '-n', String(SHOWN_COMMITS), `origin/${base}..origin/${branch}`]
export const filesCommand = (base: string, branch: string): string[] => ['git', '-c', 'core.quotepath=off', 'diff', '--numstat', `origin/${base}...origin/${branch}`]

export type ListedPr = { number: number; title: string; url: string; branch: string; isDraft: boolean; checks: Checks; updated: number; additions: number; deletions: number }

/** `gh pr list --json …`: the open PRs; an entry without a number or branch, or an answer that is not a list, is dropped. */
export function parsePrList(stdout: string): ListedPr[] {
  let list: unknown
  try {
    list = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const out: ListedPr[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (item === null || typeof item !== 'object' || typeof item.number !== 'number' || typeof item.headRefName !== 'string') continue
    // A PR from a fork names a bare head branch that could be one of ours (its own `main`): it is not ours to list or badge.
    if (item.isCrossRepository === true) continue
    const stamp = typeof item.updatedAt === 'string' ? Math.floor(Date.parse(item.updatedAt) / 1000) : 0
    out.push({
      number: item.number,
      title: typeof item.title === 'string' ? item.title : '',
      url: typeof item.url === 'string' ? item.url : '',
      branch: item.headRefName,
      isDraft: item.isDraft === true,
      checks: checksOf(item.statusCheckRollup).checks,
      updated: Number.isNaN(stamp) ? 0 : stamp,
      additions: typeof item.additions === 'number' ? item.additions : 0,
      deletions: typeof item.deletions === 'number' ? item.deletions : 0,
    })
  }
  return out
}

/** `gh pr list --state merged --json headRefName,mergedAt`: the latest merge time (unix seconds) per head branch. */
export function parseMergedAt(stdout: string): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    const list: unknown = JSON.parse(stdout)
    if (!Array.isArray(list)) return out
    for (const item of list as Record<string, unknown>[]) {
      if (item === null || typeof item !== 'object' || typeof item.headRefName !== 'string' || typeof item.mergedAt !== 'string') continue
      const stamp = Math.floor(Date.parse(item.mergedAt) / 1000)
      if (Number.isNaN(stamp)) continue
      if (!Object.prototype.hasOwnProperty.call(out, item.headRefName) || stamp > out[item.headRefName]!) out[item.headRefName] = stamp
    }
  } catch {
    return {}
  }
  return out
}

/** The numbers of the PRs whose review was asked of the person. */
export function parseReviewNumbers(stdout: string): Set<number> {
  try {
    const list: unknown = JSON.parse(stdout)
    if (!Array.isArray(list)) return new Set()
    return new Set((list as Record<string, unknown>[]).flatMap(item => (item !== null && typeof item === 'object' && typeof item.number === 'number' ? [item.number] : [])))
  } catch {
    return new Set()
  }
}

export type RemoteBranch = { name: string; author: string; updated: number; ahead: number | null }

/** `for-each-ref` in `branchesCommand`'s format: a line per branch, `origin/HEAD` skipped; `ahead` is null without counts. */
export function parseRemoteBranches(stdout: string): RemoteBranch[] {
  const out: RemoteBranch[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const [name = '', author = '', updated = '0', counts] = line.split('\x1f')
    if (name === '' || name === 'HEAD') continue
    out.push({ name, author, updated: Number(updated) || 0, ahead: counts === undefined ? null : Number(counts.split(' ')[0]) || 0 })
  }
  return out
}

/** `git diff --numstat`: tab-separated added and deleted counts (`-` for binary) and the path, which may itself hold tabs. */
export function parseNumstat(stdout: string): TeammateFile[] {
  return stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const [additions = '0', deletions = '0', ...path] = line.split('\t')
      return { path: path.join('\t'), additions, deletions }
    })
    .filter(file => file.path.length > 0)
}

/**
 * Other people's work in flight: a branch on origin whose tip is not the person's, that has commits of its own
 * (or an open PR), touched within two weeks. A PR whose head branch is not on origin (a fork) is not listed.
 * Newest activity first, the later of the branch tip and the PR's update.
 */
export function joinTeammates(input: { prs: ListedPr[]; branches: RemoteBranch[]; reviewFor: Set<number>; you: string; base: string; now: number; merged?: Record<string, number> }): Teammate[] {
  const merged = input.merged ?? {}
  const byBranch = new Map(input.prs.map(listed => [listed.branch, listed]))
  const out: Teammate[] = []
  for (const remote of input.branches) {
    if (remote.name === input.base || remote.name === 'HEAD') continue
    if (input.you !== '' && remote.author === input.you) continue
    const listed = byBranch.get(remote.name) ?? null
    const ahead = remote.ahead ?? 0
    if (listed === null && ahead === 0) continue
    // Merged (a squash leaves the branch ahead of main): done, unless it has commits newer than the merge.
    if (listed === null && Object.prototype.hasOwnProperty.call(merged, remote.name) && merged[remote.name]! >= remote.updated) continue
    const updated = Math.max(remote.updated, listed?.updated ?? 0)
    if (input.now - updated > STALE_SECONDS) continue
    out.push({
      branch: remote.name,
      author: remote.author,
      ahead,
      updated,
      pr:
        listed === null
          ? null
          : { number: listed.number, isDraft: listed.isDraft, checks: listed.checks, title: listed.title, url: listed.url, additions: listed.additions, deletions: listed.deletions, isReviewRequested: input.reviewFor.has(listed.number) },
    })
  }
  return out.sort((a, b) => b.updated - a.updated)
}

/** Every open PR by head branch, for the pill on a branch tip in the graph. */
export function badgesOf(prs: ListedPr[]): Record<string, PrBadge> {
  const out: Record<string, PrBadge> = {}
  for (const listed of prs) out[listed.branch] = { number: listed.number, isDraft: listed.isDraft, checks: listed.checks }
  return out
}

/** The PR badge for the first of a commit's refs that is the head branch of an open PR, local or on origin. */
export function badgeFor(refs: string[], openPrs: Record<string, PrBadge>): PrBadge | null {
  for (const ref of refs) {
    const name = ref.replace(/^HEAD -> /, '').replace(/^origin\//, '')
    if (Object.prototype.hasOwnProperty.call(openPrs, name)) return openPrs[name]!
  }
  return null
}

export const checkMark = (checks: Checks): string => (checks === 'pass' ? '✓' : checks === 'run' ? '●' : checks === 'fail' ? '✕' : '')

/** `#12 ✓`: the number and what the checks came to; no mark when it has no checks. */
export function badgeLabel(badge: PrBadge): string {
  const mark = checkMark(badge.checks)
  return mark === '' ? `#${badge.number}` : `#${badge.number} ${mark}`
}

/** A unix time as an age: `now`, `20m`, `3h`, `5d`, `3w`. */
export function agoSeconds(updated: number, now: number): string {
  const seconds = Math.max(0, now - updated)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`
  return `${Math.floor(seconds / (7 * 86_400))}w`
}

/** A branch's page on GitHub from an https or ssh origin; null for another host. */
export function branchUrl(remote: string, branch: string): string | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return match === null ? null : `https://github.com/${match[1]}/${match[2]}/tree/${branch}`
}

/** Whether a failed branch listing means this git does not know the format (before 2.41 or 2.42), as opposed to a missing base branch. */
export const needsFallback = (stderr: string): boolean => /unknown field name|unknown atom/i.test(stderr)

/** An origin on github.com: the only host the `gh` calls can answer for. */
export const isGithubRemote = (remote: string): boolean => branchUrl(remote, 'x') !== null
