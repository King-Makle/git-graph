import { test, expect } from 'claude-code/testing'

import type { PrBadge } from '../types'
import { isGithubRemote, needsFallback, agoSeconds, badgeFor, badgeLabel, badgesOf, branchUrl, branchesCommand, checkMark, commitsCommand, countCommand, filesCommand, joinTeammates, mergedListCommand, parseMergedAt, parseNumstat, parsePrList, parseRemoteBranches, parseReviewNumbers, prListCommand, reviewListCommand } from './teammates'

const US = '\x1f'
const NOW = 1_800_000_000
const DAY = 86_400

test('parsePrList reads number, branch, draft, checks, size and updated time, and drops junk entries', () => {
  const json = JSON.stringify([
    { number: 12, title: 'Rename stashes', url: 'https://github.com/o/r/pull/12', headRefName: 'sam/stash-rename', isDraft: false, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], updatedAt: '2027-01-15T08:00:00Z', additions: 40, deletions: 8 },
    { number: 13, title: 'Hover', url: 'u', headRefName: 'jo/dark-hover', isDraft: true, statusCheckRollup: [], updatedAt: 'not a date' },
    { title: 'no number', headRefName: 'x' },
    null,
  ])
  const prs = parsePrList(json)
  expect(prs.map(p => p.number)).toEqual([12, 13])
  expect(prs[0]).toMatchObject({ branch: 'sam/stash-rename', isDraft: false, checks: 'pass', additions: 40, deletions: 8, updated: Math.floor(Date.parse('2027-01-15T08:00:00Z') / 1000) })
  expect(prs[1]).toMatchObject({ branch: 'jo/dark-hover', isDraft: true, checks: 'none', updated: 0, additions: 0 })
  expect(parsePrList('')).toEqual([])
  expect(parsePrList('{"not":"a list"}')).toEqual([])
})

test('parseReviewNumbers reads the PR numbers asked of you, and nothing from an error', () => {
  expect([...parseReviewNumbers('[{"number":12},{"number":15},{"x":1}]')].sort()).toEqual([12, 15])
  expect(parseReviewNumbers('gh: not logged in').size).toBe(0)
})

test('parseRemoteBranches reads name, author, time and ahead count, skipping origin/HEAD; no counts means unknown', () => {
  const out = [`HEAD${US}Me${US}1${US}0 0`, `main${US}Me${US}1${US}0 0`, `sam/stash-rename${US}Sam Lee${US}1799999000${US}4 1`, ''].join('\n')
  expect(parseRemoteBranches(out)).toEqual([
    { name: 'main', author: 'Me', updated: 1, ahead: 0 },
    { name: 'sam/stash-rename', author: 'Sam Lee', updated: 1_799_999_000, ahead: 4 },
  ])
  expect(parseRemoteBranches(`feat/x${US}Jo${US}5`)).toEqual([{ name: 'feat/x', author: 'Jo', updated: 5, ahead: null }])
  expect(parseRemoteBranches('')).toEqual([])
})

test('parseNumstat reads added and deleted counts per path, keeping binary dashes and tabs in names', () => {
  expect(parseNumstat('33\t8\tgit-graph/hooks/stashes.tsx\n-\t-\tlogo.png\n1\t0\tdir/a\tb.txt\n')).toEqual([
    { path: 'git-graph/hooks/stashes.tsx', additions: '33', deletions: '8' },
    { path: 'logo.png', additions: '-', deletions: '-' },
    { path: 'dir/a\tb.txt', additions: '1', deletions: '0' },
  ])
  expect(parseNumstat('')).toEqual([])
})

test('the commands are plain argv: gh lists open PRs, git lists remote branches with or without ahead counts', () => {
  expect(prListCommand().slice(0, 4)).toEqual(['gh', 'pr', 'list', '--state'])
  expect(prListCommand()).toContain('number,title,url,headRefName,isDraft,isCrossRepository,statusCheckRollup,updatedAt,additions,deletions')
  expect(reviewListCommand()).toContain('review-requested:@me')
  expect(branchesCommand('main', true)).toContain('--format=%(refname:lstrip=3)%1f%(authorname:mailmap)%1f%(committerdate:unix)%1f%(ahead-behind:origin/main)')
  expect(branchesCommand('main', false).some(a => a.includes('ahead-behind'))).toBe(false)
  expect(countCommand('main', 'sam/x')).toEqual(['git', 'rev-list', '--count', 'origin/main..origin/sam/x'])
  expect(commitsCommand('main', 'sam/x')).toEqual(['git', 'log', '--format=%h%x1f%aN%x1f%s', '-n', '8', 'origin/main..origin/sam/x'])
  expect(filesCommand('main', 'sam/x')).toEqual(['git', '-c', 'core.quotepath=off', 'diff', '--numstat', 'origin/main...origin/sam/x'])
})

const pr = (number: number, branch: string, over: Record<string, unknown> = {}) => ({ number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, branch, isDraft: false, checks: 'pass' as const, updated: NOW - 60, additions: 3, deletions: 1, ...over })
const branch = (name: string, author: string, ahead: number | null, updated = NOW - 3600) => ({ name, author, updated, ahead })

test('joinTeammates keeps other people with an open PR or commits of their own, newest activity first', () => {
  const items = joinTeammates({
    prs: [pr(12, 'sam/stash-rename', { updated: NOW - 600 }), pr(13, 'jo/dark-hover', { isDraft: true, updated: NOW - 3600 }), pr(14, 'fork-user:their-branch'), pr(15, 'me/mine')],
    branches: [
      branch('main', 'Me', 0),
      branch('sam/stash-rename', 'Sam Lee', 4, NOW - 7200),
      branch('jo/dark-hover', 'Jo Park', 2),
      branch('jo/spike', 'Jo Park', 7, NOW - 5 * DAY),
      branch('merged/old', 'Sam Lee', 0),
      branch('stale/idea', 'Sam Lee', 3, NOW - 30 * DAY),
      branch('me/mine', 'Me', 5),
    ],
    reviewFor: new Set([12]),
    you: 'Me',
    base: 'main',
    now: NOW,
  })
  expect(items.map(t => t.branch)).toEqual(['sam/stash-rename', 'jo/dark-hover', 'jo/spike'])
  expect(items[0]).toMatchObject({ author: 'Sam Lee', ahead: 4, updated: NOW - 600, pr: { number: 12, isReviewRequested: true, isDraft: false, checks: 'pass', title: 'PR 12' } })
  expect(items[1]?.pr).toMatchObject({ number: 13, isDraft: true, isReviewRequested: false })
  expect(items[2]?.pr).toBe(null)
})

test('joinTeammates with no known you excludes nobody, keeps a PR with no commits ahead, and tolerates an unknown ahead count', () => {
  const items = joinTeammates({ prs: [pr(9, 'new/pr')], branches: [branch('new/pr', 'Someone', 0), branch('x', 'Someone', null)], reviewFor: new Set(), you: '', base: 'main', now: NOW })
  expect(items.map(t => t.branch)).toEqual(['new/pr'])
})

test('badgesOf maps each open PR by its branch, and badgeFor finds it from a commit\'s refs, local or origin', () => {
  const badges = badgesOf([pr(12, 'sam/stash-rename'), pr(13, 'jo/dark-hover', { isDraft: true, checks: 'run' })])
  expect(badges).toEqual({ 'sam/stash-rename': { number: 12, isDraft: false, checks: 'pass' }, 'jo/dark-hover': { number: 13, isDraft: true, checks: 'run' } })
  expect(badgeFor(['origin/sam/stash-rename'], badges)?.number).toBe(12)
  expect(badgeFor(['HEAD -> jo/dark-hover', 'tag: v1'], badges)?.number).toBe(13)
  expect(badgeFor(['origin/main', 'tag: v2'], badges)).toBe(null)
  expect(badgeFor(['origin/constructor'], badges)).toBe(null)
  expect(badgeFor([], badges)).toBe(null)
})

test('badgeLabel and checkMark say what the checks came to; agoSeconds shortens an age', () => {
  const badge = (checks: PrBadge['checks']): PrBadge => ({ number: 12, isDraft: false, checks })
  expect(badgeLabel(badge('pass'))).toBe('#12 ✓')
  expect(badgeLabel(badge('run'))).toBe('#12 ●')
  expect(badgeLabel(badge('fail'))).toBe('#12 ✕')
  expect(badgeLabel(badge('none'))).toBe('#12')
  expect(checkMark('pass')).toBe('✓')
  expect(agoSeconds(NOW - 20, NOW)).toBe('now')
  expect(agoSeconds(NOW - 20 * 60, NOW)).toBe('20m')
  expect(agoSeconds(NOW - 3 * 3600, NOW)).toBe('3h')
  expect(agoSeconds(NOW - 5 * DAY, NOW)).toBe('5d')
  expect(agoSeconds(NOW - 21 * DAY, NOW)).toBe('3w')
  expect(agoSeconds(NOW + 100, NOW)).toBe('now')
})

test('branchUrl links a branch on GitHub from an https or ssh origin, and nothing for another host', () => {
  expect(branchUrl('https://github.com/King-Makle/all-mite.git', 'sam/x')).toBe('https://github.com/King-Makle/all-mite/tree/sam/x')
  expect(branchUrl('git@github.com:King-Makle/all-mite.git', 'sam/x')).toBe('https://github.com/King-Makle/all-mite/tree/sam/x')
  expect(branchUrl('https://gitlab.com/x/y.git', 'sam/x')).toBe(null)
  expect(branchUrl('', 'sam/x')).toBe(null)
})

test('a PR from a fork is dropped by gh\'s own flag, since its head branch name is bare and could be the name of a branch of ours', () => {
  const json = JSON.stringify([
    { number: 20, headRefName: 'main', isCrossRepository: true, title: 'from a fork', url: 'u' },
    { number: 21, headRefName: 'sam/search', isCrossRepository: false, title: 'ours', url: 'u' },
  ])
  expect(parsePrList(json).map(p => p.number)).toEqual([21])
  // A PR from a fork never puts a pill on our own main.
  expect(badgeFor(['HEAD -> main', 'origin/main'], badgesOf(parsePrList(json)))).toBe(null)
  expect(prListCommand().join(' ')).toContain('isCrossRepository')
})

test('the fallback branch listing avoids :mailmap, which needs a newer git than ahead-behind does', () => {
  expect(branchesCommand('main', false).join(' ')).not.toContain(':mailmap')
  expect(branchesCommand('main', true).join(' ')).toContain('%(authorname:mailmap)')
})

test('parseMergedAt keeps the latest merge time per head branch, and nothing from junk', () => {
  const json = JSON.stringify([
    { headRefName: 'sam/old', mergedAt: '2027-01-10T00:00:00Z' },
    { headRefName: 'sam/old', mergedAt: '2027-01-12T00:00:00Z' },
    { headRefName: 'jo/x', mergedAt: 'not a date' },
    { mergedAt: '2027-01-10T00:00:00Z' },
  ])
  expect(parseMergedAt(json)).toEqual({ 'sam/old': Math.floor(Date.parse('2027-01-12T00:00:00Z') / 1000) })
  expect(parseMergedAt('')).toEqual({})
  expect(mergedListCommand()).toEqual(['gh', 'pr', 'list', '--state', 'merged', '--limit', '50', '--json', 'headRefName,mergedAt'])
})

test('joinTeammates leaves out a branch whose PR was merged after its last commit, but keeps one with newer commits', () => {
  const items = joinTeammates({
    prs: [],
    branches: [branch('sam/squashed', 'Sam Lee', 3, NOW - 7200), branch('sam/reused', 'Sam Lee', 2, NOW - 600)],
    merged: { 'sam/squashed': NOW - 3600, 'sam/reused': NOW - 3600 },
    reviewFor: new Set(),
    you: 'Me',
    base: 'main',
    now: NOW,
  })
  expect(items.map(t => t.branch)).toEqual(['sam/reused'])
})

test('needsFallback is only for a git that does not know the format, not for a missing base branch', () => {
  expect(needsFallback('fatal: unknown field name: ahead-behind:origin/main')).toBe(true)
  expect(needsFallback('fatal: unknown field name: authorname:mailmap')).toBe(true)
  expect(needsFallback("fatal: failed to find 'origin/nonexistent'")).toBe(false)
  expect(needsFallback('')).toBe(false)
})

test('isGithubRemote is true for an https or ssh github origin and false for another host or none', () => {
  expect(isGithubRemote('https://github.com/King-Makle/my-claude-mods.git')).toBe(true)
  expect(isGithubRemote('git@github.com:King-Makle/my-claude-mods.git')).toBe(true)
  expect(isGithubRemote('https://gitlab.com/x/y.git')).toBe(false)
  expect(isGithubRemote('')).toBe(false)
})
