import { test, expect } from 'claude-code/testing'

import { STASH_ROWS, drawStashes } from './stashes'
import type { StashesModel } from './stashes'

const stashes = [
  { index: 0, hash: 'a1b2c3d', message: 'On main: wip words', files: 2 },
  { index: 1, hash: 'e4f5a6b', message: 'WIP on main: 9c1d2e4 Draw ref chips', files: 1 },
]
const none = { apply() {}, pop() {}, askDrop() {}, drop() {} }
const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'test',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('each stash row has its ref, message, file count and three buttons', async ($, on) => {
  const model: StashesModel = { stashes, confirmDrop: null }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawStashes($.ui.resolve(e), e.surface, model, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^stash@\{0\}$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /On main: wip words/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 files$/ })).toBeDefined()
    for (const key of ['stash-apply:0', 'stash-pop:0', 'stash-drop:0', 'stash-apply:1']) expect(await ui.find({ key })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /^▣$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('drop asks first', async ($, on) => {
  const model: StashesModel = { stashes, confirmDrop: 1 }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawStashes($.ui.resolve(e), e.surface, model, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Drop stash@\{1\}\? Its changes are gone for good\./ })).toBeDefined()
  expect(await ui.find({ key: 'drop-yes' })).toBeDefined()
  expect(await ui.find({ key: 'drop-no' })).toBeDefined()
  await ui.unmount()
})

test('rows past the cap are text', async ($, on) => {
  const many = Array.from({ length: STASH_ROWS + 2 }, (_, i) => ({ index: i, hash: `h${i}`, message: `stash ${i}`, files: 1 }))
  const model: StashesModel = { stashes: many, confirmDrop: null }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawStashes($.ui.resolve(e), e.surface, model, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: `stash-apply:${STASH_ROWS - 1}` })).toBeDefined()
  expect(await ui.find({ key: `stash-apply:${STASH_ROWS}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /2 more stashes/ })).toBeDefined()
  await ui.unmount()
})
