import { test, expect } from 'claude-code/testing'

import { AUTO_FETCH_MS, autoFetchCommand, failureNote, newCommitsNote, nextFailures, shouldAutoFetch } from './autofetch'

const base = { isEnabled: true, isClosed: false, busy: null, hasOrigin: true, now: 10 * AUTO_FETCH_MS, lastAt: 0 }

test('shouldAutoFetch runs only when on, open, idle, with an origin, and five minutes since the last fetch', () => {
  expect(shouldAutoFetch(base)).toBe(true)
  expect(shouldAutoFetch({ ...base, isEnabled: false })).toBe(false)
  expect(shouldAutoFetch({ ...base, isClosed: true })).toBe(false)
  expect(shouldAutoFetch({ ...base, busy: 'push' })).toBe(false)
  expect(shouldAutoFetch({ ...base, hasOrigin: false })).toBe(false)
  expect(shouldAutoFetch({ ...base, lastAt: base.now - AUTO_FETCH_MS + 1 })).toBe(false)
  expect(shouldAutoFetch({ ...base, lastAt: base.now - AUTO_FETCH_MS })).toBe(true)
})

test('autoFetchCommand prunes deleted branches, like the Fetch button', () => {
  expect(autoFetchCommand()).toEqual(['git', 'fetch', '--prune'])
})

test('newCommitsNote speaks only when more commits are behind than before', () => {
  expect(newCommitsNote(0, 3)).toBe('3 new commits on origin')
  expect(newCommitsNote(2, 3)).toBe('1 new commit on origin')
  expect(newCommitsNote(3, 3)).toBe(null)
  expect(newCommitsNote(3, 1)).toBe(null)
})

test('three failures in a row raise one note, and a success clears the count', () => {
  expect(nextFailures(0, false)).toBe(1)
  expect(nextFailures(2, false)).toBe(3)
  expect(nextFailures(5, true)).toBe(0)
  expect(failureNote(2)).toBe(null)
  expect(failureNote(3)).toBe('auto-fetch cannot reach origin')
  expect(failureNote(9)).toBe('auto-fetch cannot reach origin')
})
