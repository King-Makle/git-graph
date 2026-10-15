import { test, expect } from 'claude-code/testing'

import type { PullRequest } from '../types'
import { setLook } from './chips'
import { drawPrCard } from './prcard'
import type { PrCardView } from './prcard'
setLook({ editor: false })

const pr: PullRequest = { number: 14, title: 'Add search to the commit graph', url: 'https://github.com/King-Makle/my-claude-mods/pull/14', base: 'main', commits: 3, additions: 505, deletions: 44, checks: 'pass', failing: 0, hasConflicts: false }
const calm: PrCardView = { isBusy: false, isMerging: false, note: null }
const none = { askMerge() {}, cancelMerge() {}, mergePr() {}, closePr() {}, refreshPr() {} }

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'test',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the PR card shows the number as a link, the title, the branches and the totals, with Merge and Close', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPrCard($.ui.resolve(e), e.surface, pr, calm, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe(pr.url)
    expect(await ui.find({ type: 'Text', text: 'Add search to the commit graph' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 commits/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+505/ })).toBeDefined()
    expect((await ui.find({ key: 'pr-merge' }))?.props.label).toBe('Merge')
    expect((await ui.find({ key: 'pr-close' }))?.props.label).toBe('Close')
    expect(await ui.find({ key: 'pr-refresh' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /checks passing/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the checks line says running, failing with a count, or none, and a conflict is named', async ($, on) => {
  let shown: PullRequest = pr
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPrCard($.ui.resolve(e), e.surface, shown, calm, none))
  const cases: [Partial<PullRequest>, RegExp][] = [
    [{ checks: 'run' }, /checks running/],
    [{ checks: 'fail', failing: 2 }, /2 checks failing/],
    [{ checks: 'fail', failing: 1 }, /1 check failing/],
    [{ checks: 'none' }, /no checks/],
    [{ hasConflicts: true }, /has conflicts/],
  ]
  for (const [change, text] of cases) {
    shown = { ...pr, ...change }
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
    await ui.unmount()
  }
})

test('asking to merge replaces Merge and Close with the question, yes and cancel, and names a failing check', async ($, on) => {
  let shown: PullRequest = pr
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPrCard($.ui.resolve(e), e.surface, shown, { ...calm, isMerging: true }, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'pr-merge' })).toBeUndefined()
  expect(await ui.find({ key: 'pr-close' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Merge into main\? The 3 commits become one and the branch is deleted\./ })).toBeDefined()
  expect((await ui.find({ key: 'pr-merge-yes' }))?.props.label).toBe('Merge')
  expect(await ui.find({ key: 'pr-merge-no' })).toBeDefined()
  await ui.unmount()
  shown = { ...pr, checks: 'fail', failing: 1 }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'pr-merge-yes' }))?.props.label).toBe('Merge Anyway')
  await ui.unmount()
})

test('while an action runs the buttons give way to one word, and a note shows', async ($, on) => {
  let view: PrCardView = { ...calm, isBusy: true }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPrCard($.ui.resolve(e), e.surface, pr, view, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'pr-merge' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Working…/ })).toBeDefined()
  await ui.unmount()
  view = { ...calm, note: 'failed: branch protection' }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'failed: branch protection' })).toBeDefined()
  await ui.unmount()
})
