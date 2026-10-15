import { test, expect } from 'claude-code/testing'

import { PR_EVERY_MS, branchOf, checksOf, closeStep, createSteps, hasNoPr, isGhAbsent, mergeStep, parsePr, shouldLookup } from './pr'

const VIEW = {
  number: 14,
  title: 'Add search',
  url: 'https://github.com/King-Makle/my-claude-mods/pull/14',
  baseRefName: 'main',
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  commits: [{}, {}, {}],
  additions: 505,
  deletions: 44,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
}

test('parsePr reads an open pull request from gh pr view', () => {
  expect(parsePr(JSON.stringify(VIEW))).toEqual({
    number: 14,
    title: 'Add search',
    url: 'https://github.com/King-Makle/my-claude-mods/pull/14',
    base: 'main',
    commits: 3,
    additions: 505,
    deletions: 44,
    checks: 'pass',
    failing: 0,
    hasConflicts: false,
  })
  expect(parsePr(JSON.stringify({ ...VIEW, mergeable: 'CONFLICTING' }))?.hasConflicts).toBe(true)
})

test('parsePr answers null for a merged or closed PR, junk and an empty reply', () => {
  expect(parsePr(JSON.stringify({ ...VIEW, state: 'MERGED' }))).toBe(null)
  expect(parsePr(JSON.stringify({ ...VIEW, state: 'CLOSED' }))).toBe(null)
  expect(parsePr('no pull requests found for branch "x"')).toBe(null)
  expect(parsePr('')).toBe(null)
  expect(parsePr('{}')).toBe(null)
  expect(parsePr('null')).toBe(null)
})

test("checksOf reduces gh's rollup: any failure fails, any unfinished check runs, skipped and neutral pass, none is none", () => {
  expect(checksOf(undefined)).toEqual({ checks: 'none', failing: 0 })
  expect(checksOf([])).toEqual({ checks: 'none', failing: 0 })
  expect(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'COMPLETED', conclusion: 'SKIPPED' }, { status: 'COMPLETED', conclusion: 'NEUTRAL' }])).toEqual({ checks: 'pass', failing: 0 })
  expect(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }])).toEqual({ checks: 'run', failing: 0 })
  expect(checksOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'COMPLETED', conclusion: 'TIMED_OUT' }, { status: 'IN_PROGRESS' }])).toEqual({ checks: 'fail', failing: 2 })
  // A commit status context carries `state`, not `status`/`conclusion`.
  expect(checksOf([{ state: 'SUCCESS' }])).toEqual({ checks: 'pass', failing: 0 })
  expect(checksOf([{ state: 'PENDING' }])).toEqual({ checks: 'run', failing: 0 })
  expect(checksOf([{ state: 'ERROR' }])).toEqual({ checks: 'fail', failing: 1 })
})

test('branchOf drops the origin/ prefix gh does not want', () => {
  expect(branchOf('origin/main')).toBe('main')
  expect(branchOf('main')).toBe('main')
  expect(branchOf('origin/release/1.0')).toBe('release/1.0')
})

test('createSteps pushes first only when asked and sends the description on stdin, even when empty', () => {
  const input = { branch: 'feature/search', base: 'origin/main', title: 'Add search', description: 'Body.', needsPush: true }
  expect(createSteps(input)).toEqual([
    { argv: ['git', 'push', '-u', 'origin', 'feature/search'] },
    { argv: ['gh', 'pr', 'create', '--base', 'main', '--head', 'feature/search', '--title', 'Add search', '--body-file', '-'], stdin: 'Body.' },
  ])
  const second = createSteps({ ...input, needsPush: false, description: '' })
  expect(second).toHaveLength(1)
  expect(second[0]!.stdin).toBe('')
})

test('mergeStep always squashes and deletes the branch; closeStep just closes', () => {
  expect(mergeStep(14)).toEqual(['gh', 'pr', 'merge', '14', '--squash', '--delete-branch'])
  expect(closeStep(14)).toEqual(['gh', 'pr', 'close', '14'])
})

test('shouldLookup asks gh only for a pushed branch, when forced, when the branch changed, or when an open PR is a minute old', () => {
  const base = { force: false, branch: 'feature', upstream: 'origin/feature', lastBranch: 'feature', lastAt: 1_000, now: 1_000 + 5_000, hasPr: false }
  expect(shouldLookup(base)).toBe(false)
  expect(shouldLookup({ ...base, hasPr: true })).toBe(false)
  expect(shouldLookup({ ...base, hasPr: true, now: 1_000 + PR_EVERY_MS })).toBe(true)
  expect(shouldLookup({ ...base, lastBranch: 'other' })).toBe(true)
  expect(shouldLookup({ ...base, lastBranch: null })).toBe(true)
  expect(shouldLookup({ ...base, force: true })).toBe(true)
  // Detached, or never pushed: no PR can exist, forced or not.
  expect(shouldLookup({ ...base, branch: '', force: true })).toBe(false)
  expect(shouldLookup({ ...base, upstream: null, force: true })).toBe(false)
})

test('hasNoPr is only the answer gh gives for a branch without a PR, never a timeout or a network error', () => {
  expect(hasNoPr('no pull requests found for branch "feature/search"')).toBe(true)
  expect(hasNoPr('Get "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host')).toBe(false)
  expect(hasNoPr('')).toBe(false)
})

test('isGhAbsent is gh missing or signed out, never a network failure, so a flaky first check is asked again', () => {
  expect(isGhAbsent('You are not logged into any GitHub hosts. To log in, run: gh auth login')).toBe(true)
  expect(isGhAbsent('spawn gh ENOENT')).toBe(true)
  expect(isGhAbsent('executable file not found in $PATH')).toBe(true)
  expect(isGhAbsent('error connecting to api.github.com')).toBe(false)
  expect(isGhAbsent('')).toBe(false)
})
