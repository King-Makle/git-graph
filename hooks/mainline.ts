import type { Commit, MainRow, Merge, MergeCommit } from '../types'

/** Fields per first-parent entry; `%b` last so a body keeps its newlines, `%aN` so the repo's .mailmap applies. */
export const MAIN_FORMAT = '--format=%H%x1f%P%x1f%D%x1f%aN%x1f%ar%x1f%ad%x1f%s%x1f%b%x1e'
/** A merge row opens to at most this many commits; the rest are a count. */
export const MERGE_COMMITS_SHOWN = 12

/**
 * `git log --first-parent --diff-merges=first-parent --shortstat` in `MAIN_FORMAT`: records split on the record
 * separator, each followed by its shortstat line, which belongs to the record before it.
 */
export function parseMainLog(stdout: string): { commit: Commit; body: string }[] {
  const out: { commit: Commit; body: string }[] = []
  for (const chunk of stdout.split('\x1e')) {
    const lines = chunk.replace(/^\n+/, '').split('\n')
    if (/^\s*\d+ files? changed/.test(lines[0] ?? '')) {
      const last = out[out.length - 1]
      if (last !== undefined) last.commit.stat = lines.shift()!.trim()
    }
    const record = lines.join('\n')
    if (record.length === 0) continue
    const [hash = '', parents = '', refs = '', author = '', date = '', when = '', subject = '', ...body] = record.split('\x1f')
    out.push({
      commit: { hash, parents: parents.split(' ').filter(Boolean), refs: refs.split(', ').filter(Boolean), author, date, when, subject, stat: '' },
      body: body.join('\x1f').trim(),
    })
  }
  return out
}

/** `Merge pull request #34 from King-Makle/claude/phase-6s` to its number and branch (the owner dropped); null for any other subject. */
export function prMerge(subject: string): { number: number; branch: string } | null {
  const hit = /^Merge pull request #(\d+) from (\S+)/.exec(subject)
  if (hit === null) return null
  const from = hit[2]!
  return { number: Number(hit[1]), branch: from.includes('/') ? from.slice(from.indexOf('/') + 1) : from }
}

/** `27 files changed, 420 insertions(+), 88 deletions(-)` to its two counts, either missing. */
export function parseShortstat(stat: string): { additions: number; deletions: number } {
  return { additions: Number(/(\d+) insertions?\(\+\)/.exec(stat)?.[1] ?? 0), deletions: Number(/(\d+) deletions?\(-\)/.exec(stat)?.[1] ?? 0) }
}

/** A GitHub PR merge reads as its number and the PR title from the body (else the branch); any other merge keeps its subject. */
export function mergeTitle(subject: string, body: string): { number: number | null; label: string } {
  const pr = prMerge(subject)
  if (pr === null) return { number: null, label: subject }
  const first = body
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0)
  return { number: pr.number, label: first ?? pr.branch }
}

/** `git log --format=%aN M^1..M^2`: one name per commit the merge brought in, as a count and the distinct authors in first-seen order. */
export function parseMergeAuthors(stdout: string): { count: number; authors: string[] } {
  const names = stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  return { count: names.length, authors: [...new Set(names)] }
}

/** `git log --format=%h%x1f%aN%x1f%s M^1..M^2`: the commits a merge row opens to. */
export function parseMergeCommits(stdout: string): MergeCommit[] {
  return stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const [hash = '', author = '', ...subject] = line.split('\x1f')
      return { hash, author, subject: subject.join('\x1f') }
    })
}

/** The rows from the parsed log and each merge's size; a commit with two or more parents is a merge, a failed count shows as 0. */
export function buildMainRows(entries: { commit: Commit; body: string }[], details: Record<string, { count: number; authors: string[] }>): MainRow[] {
  return entries.map(({ commit, body }) => {
    if (commit.parents.length < 2) return { commit, merge: null }
    const { number, label } = mergeTitle(commit.subject, body)
    const info = details[commit.hash] ?? { count: 0, authors: [] }
    const merge: Merge = { number, label, ...parseShortstat(commit.stat), count: info.count, authors: info.authors }
    return { commit, merge }
  })
}

/** The first-parent log for the Main line view. `isModern` asks `--diff-merges=first-parent` (git 2.31+); otherwise `-m`, which with `--first-parent` gives the same one-parent diff on an older git. */
export function mainLogCommand(input: { limit: number; date: string; upstream: string | null; isModern: boolean }): string[] {
  return ['git', 'log', '--first-parent', input.isModern ? '--diff-merges=first-parent' : '-m', '--shortstat', '--topo-order', '-n', String(input.limit), input.date, MAIN_FORMAT, 'HEAD', ...(input.upstream === null ? [] : [input.upstream])]
}

/** A git that does not know `--diff-merges`: ask again with `-m`. */
export const needsOlderDiffMerges = (stderr: string): boolean => /diff-merges|unrecognized argument|unknown option/i.test(stderr)
