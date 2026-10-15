import { test, expect } from 'claude-code/testing'

import { BRANCH_ROWS, CEILING, FIXED, budget } from './budget'

test('a clean tree keeps 150 commits and 14 diff toggles under the ceiling', () => {
  expect(budget(0, 0)).toEqual({ commits: 150, toggles: 14, branchRows: 0, worktreeRows: 0 })
  expect(FIXED + 150 + 14).toBeLessThanOrEqual(CEILING)
})

test('the worst dirty tree gives up commits first, then toggles, and stays under the ceiling', () => {
  expect(budget(30, 8)).toEqual({ commits: 40, toggles: 10, branchRows: 0, worktreeRows: 0 })
  expect(FIXED + 40 + 10 + 30 * 3 + 8 * 3).toBeLessThanOrEqual(CEILING)
  // Past the row caps the rest are text and cost nothing more.
  expect(budget(200, 50)).toEqual({ commits: 40, toggles: 10, branchRows: 0, worktreeRows: 0 })
})

test('the open Branches card takes its rows from the commits, and shrinks before the commits fall under their floor', () => {
  const clean = budget(0, 0, BRANCH_ROWS)
  expect(clean).toEqual({ commits: 150 - 2 - 2 * BRANCH_ROWS, toggles: 14, branchRows: BRANCH_ROWS, worktreeRows: 0 })
  expect(FIXED + clean.commits + clean.toggles + 2 + 2 * clean.branchRows).toBeLessThanOrEqual(CEILING)
  // Show More asks for more rows; the budget gives what fits.
  const more = budget(0, 0, 3 * BRANCH_ROWS)
  expect(more.branchRows).toBe(3 * BRANCH_ROWS)
  expect(FIXED + more.commits + more.toggles + 2 + 2 * more.branchRows).toBeLessThanOrEqual(CEILING)
  const worst = budget(30, 8, 20)
  expect(worst.commits).toBe(40)
  expect(worst.branchRows).toBeLessThan(BRANCH_ROWS)
  expect(FIXED + worst.commits + worst.toggles + 30 * 3 + 8 * 3 + 2 + 2 * worst.branchRows).toBeLessThanOrEqual(CEILING)
  expect(budget(0, 0, 3).branchRows).toBe(3)
})

test('the open Worktrees card takes its close and three buttons a row from the commits', () => {
  const open = budget(0, 0, undefined, 3)
  expect(open.commits).toBe(150 - 1 - 3 * 3)
  expect(FIXED + open.commits + open.toggles + 1 + 3 * 3).toBeLessThanOrEqual(CEILING)
  expect(open.worktreeRows).toBe(3)
  // The worst dirty tree: rows past what fits draw without their buttons, and the Branches card gives way too.
  const worst = budget(30, 8, 20, 5)
  expect(worst.commits).toBe(40)
  expect(worst.worktreeRows).toBeLessThan(5)
  expect(FIXED + worst.commits + worst.toggles + 30 * 3 + 8 * 3 + 1 + 3 * worst.worktreeRows + 2 + 2 * worst.branchRows).toBeLessThanOrEqual(CEILING)
})

test('the open reference panel takes its buttons from the commits, even past their floor when everything else is full', () => {
  expect(budget(0, 0, undefined, undefined, 11)).toEqual({ commits: 139, toggles: 14, branchRows: 0, worktreeRows: 0 })
  const worst = budget(30, 8, 20, 5, 11)
  expect(FIXED + worst.commits + worst.toggles + 30 * 3 + 8 * 3 + 11 + 1 + 3 * worst.worktreeRows + 2 + 2 * worst.branchRows).toBeLessThanOrEqual(CEILING)
})
