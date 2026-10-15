import { test, expect } from 'claude-code/testing'

import type { ChangedFile } from '../types'
import { FILE_ROWS, commitReadiness, drawChanges, drawMessageFooter, messageCount, splitPath } from './changes'
import type { ChangesModel } from './changes'
import { setLook } from './chips'
// A test's own hook draws, so no surface module is loaded: the Input stands in for the editor.
setLook({ editor: false })


const f = (path: string, status: ChangedFile['status'], isStaged = false): ChangedFile => ({ path, status, isStaged, isUnstaged: !isStaged || status === 'M' })

const files = [f('git-graph/hooks/pane.tsx', 'M'), f('git-graph/hooks/changes.ts', 'A', true), f('git-graph/hooks/changes.test.ts', 'U'), f('git-graph/hooks/old.ts', 'D')]
const base: ChangesModel = { head: 'main', files, ticked: ['git-graph/hooks/changes.ts'], message: '', editRev: 0, editCaret: null, openFiles: [], confirmDiscard: null, note: null, isWriting: false }
const none = { write() {}, setMessage() {}, commit() {}, toggleAll() {}, stageTicked() {}, unstage() {}, stash() {}, toggleTick() {}, toggleDiff() {}, askDiscard() {}, discard() {} }

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'test',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const HUNKS = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3'

test('a file row has a checkbox that only selects, its status letter, its name as a button, and a cross (a minus when staged)', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, base, none))
  const staged = ['git-graph/hooks/changes.ts']
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const file of files) {
      const k = staged.includes(file.path) ? 's-' : ''
      expect(await ui.find({ key: `${k}tick:${file.path}` })).toBeDefined()
      expect(await ui.find({ key: `${k}file:${file.path}` })).toBeDefined()
      // One-glyph buttons, since a Button takes no icon beside it: a cross discards, a minus unstages.
      if (k === '') expect((await ui.find({ key: `discard:${file.path}` }))?.props.label).toBe('✕')
      else expect((await ui.find({ key: `s-unstage:${file.path}` }))?.props.label).toBe('−')
    }
    expect((await ui.find({ key: 's-tick:git-graph/hooks/changes.ts' }))?.props.label).toBe('☑')
    expect((await ui.find({ key: 'tick:git-graph/hooks/pane.tsx' }))?.props.label).toBe('□')
    if (surface === 'terminal') for (const letter of ['M', 'A', 'U', 'D']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${letter}$`) })).toBeDefined()
    else {
      const alts = JSON.stringify((await ui.find({ key: 'section:Changes' }))?.children)
      for (const letter of ['M', 'A', 'U', 'D']) expect(alts).toContain(`"status ${letter}"`)
    }
    expect(await ui.find({ type: 'Input', key: 'message' })).toBeDefined()
    await ui.unmount()
  }
})

test('files in the index are listed apart under Staged Changes, with Unstage all; a file edited since is in both groups', async ($, on) => {
  const both = f('both.ts', 'A', true)
  both.isUnstaged = true
  both.treeStatus = 'M'
  let model: ChangesModel = { ...base, files: [{ ...f('s.ts', 'M', true), isUnstaged: false }, both, { ...f('c.ts', 'M'), isStaged: false }], ticked: [] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = { ...base, files: [{ ...f('s.ts', 'M', true), isUnstaged: false }, both, { ...f('c.ts', 'M'), isStaged: false }], ticked: [] }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Staged Changes' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Changes' })).toBeDefined()
    expect((await ui.find({ key: 'unstage-all' }))?.props.label).toBe('Unstage All')
    // Staged group: s.ts and both.ts; Changes group: both.ts (its own letter) and c.ts.
    expect(await ui.find({ key: 's-tick:s.ts' })).toBeDefined()
    expect(await ui.find({ key: 's-tick:both.ts' })).toBeDefined()
    expect(await ui.find({ key: 'tick:both.ts' })).toBeDefined()
    expect(await ui.find({ key: 'tick:c.ts' })).toBeDefined()
    expect(await ui.find({ key: 'tick:s.ts' })).toBeUndefined()
    // The groups carry their own counts, so the card's header drops the total that would read as a third number.
    expect(JSON.stringify((await ui.find({ key: 'section:Changes' }))?.children)).not.toContain('changed file')
    await ui.unmount()
    // Nothing staged: one list under the card's own title, no group titles and no Unstage all.
    model = { ...base, files: [f('c.ts', 'M'), f('d.ts', 'M')], ticked: [] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Staged Changes' })).toBeUndefined()
    expect(await ui.find({ key: 'unstage-all' })).toBeUndefined()
    expect(await ui.find({ key: 'tick:c.ts' })).toBeDefined()
    // With no group titles the header's count is the only one, so it stays.
    if (surface === 'desktop') expect(JSON.stringify((await ui.find({ key: 'section:Changes' }))?.children)).toContain('2 changed files')
    await ui.unmount()
  }
})

test('the card header offers All, Stage and Stash, and ticking a box is a selection only', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, base, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'all' }))?.props.label).toBe('☑ All')
  expect((await ui.find({ key: 'stage' }))?.props.label).toBe('＋ Stage')
  expect((await ui.find({ key: 'stash' }))?.props.label).toBe('❏ Stash')
  await ui.unmount()
})

test('the message field is the one Commit button: its submit says Commit, and mobile keeps a dim-until-ready Button', async ($, on) => {
  let model = base
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Input', key: 'message' }))?.props.submitLabel).toBe('Commit')
    expect(await ui.find({ key: 'commit' })).toBeUndefined()
    await ui.unmount()
  }
  let ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect((await ui.find({ key: 'commit' }))?.props.dimColor).toBe(true)
  await ui.unmount()
  model = { ...base, message: 'Wire the atoms' }
  ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  // Ready, Commit is a plain button at full strength, like Write beside it but not dim.
  expect((await ui.find({ key: 'commit' }))?.props.dimColor).not.toBe(true)
  await ui.unmount()
})

test('commitReadiness names what is missing', () => {
  const ticked = ['git-graph/hooks/changes.ts']
  expect(commitReadiness({ message: 'x', files: [], ticked })).toEqual({ isReady: false, why: 'Nothing to commit.' })
  expect(commitReadiness({ message: '', files, ticked })).toEqual({ isReady: false, why: 'Type a message first.' })
  expect(commitReadiness({ message: 'x', files, ticked: [] })).toEqual({ isReady: false, why: 'Tick the files to commit.' })
  // A tick for a file that is no longer changed counts for nothing.
  expect(commitReadiness({ message: 'x', files, ticked: ['gone.ts'] })).toEqual({ isReady: false, why: 'Tick the files to commit.' })
  expect(commitReadiness({ message: 'x', files, ticked })).toEqual({ isReady: true, why: null })
})

test('messageCount is the subject length out of 72, then the ticked files, with no warning past it', () => {
  expect(messageCount('   ', 0)).toBe(null)
  expect(messageCount('Fix it', 0)).toBe('6/72')
  expect(messageCount('x'.repeat(83), 0)).toBe('83/72')
  // The files a Commit would take are counted here, so the Commit button keeps one width and Write beside it stays put.
  expect(messageCount('Fix it', 18)).toBe('6/72 · 18 files')
  expect(messageCount('Fix it', 1)).toBe('6/72 · 1 file')
  expect(messageCount('', 3)).toBe('3 files')
  // Only the subject counts: the body under it has no 72 to stay inside.
  expect(messageCount('Fix it\n\nA long body line that goes on and on and on past seventy-two characters easily.', 0)).toBe('6/72')
})

test('a message longer than the field is drawn whole under it, a short one only counted', async ($, on) => {
  const long = 'A message much longer than the field can show'
  let message = long
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, { ...base, message }, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    message = long
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: long })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: `${long.length}/72` })).toBeDefined()
    await ui.unmount()
    message = 'Fix it'
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Fix it' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '6/72' })).toBeDefined()
    await ui.unmount()
  }
})

test('all reads none once every file is ticked', async ($, on) => {
  let model = base
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'all' }))?.props.label).toBe('☑ All')
  expect((await ui.find({ key: 'stash' }))?.props.label).toBe('❏ Stash')
  await ui.unmount()
  model = { ...base, ticked: files.map(x => x.path) }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'all' }))?.props.label).toBe('□ None')
  await ui.unmount()
})

test('a discard confirm opens under its file, naming an untracked file as a deletion', async ($, on) => {
  let model: ChangesModel = { ...base, confirmDiscard: 'git-graph/hooks/pane.tsx' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Discard changes to pane\.tsx\? This cannot be undone\./ })).toBeDefined()
  expect(await ui.find({ key: 'discard-yes' })).toBeDefined()
  expect(await ui.find({ key: 'discard-no' })).toBeDefined()
  await ui.unmount()
  model = { ...base, confirmDiscard: 'git-graph/hooks/changes.test.ts' }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Delete untracked changes\.test\.ts\?/ })).toBeDefined()
  await ui.unmount()
})

test('an open file shows its diff as a Code block, or a note when there are no text changes', async ($, on) => {
  const model: ChangesModel = { ...base, openFiles: [{ path: 'git-graph/hooks/pane.tsx', diff: HUNKS }, { path: 'git-graph/hooks/old.ts', diff: '' }] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no text changes/ })).toBeDefined()
  await ui.unmount()
})

test('rows past the cap are text, so the drawing stays pressable', async ($, on) => {
  const many = Array.from({ length: FILE_ROWS + 5 }, (_, i) => f(`src/file-${i}.ts`, 'M'))
  const model: ChangesModel = { ...base, files: many }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: `tick:src/file-${FILE_ROWS - 1}.ts` })).toBeDefined()
  expect(await ui.find({ key: `tick:src/file-${FILE_ROWS}.ts` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /5 more rows; tick and stage them from the terminal/ })).toBeDefined()
  await ui.unmount()
})

test('the note under the Commit row shows why the last press did nothing', async ($, on) => {
  const model: ChangesModel = { ...base, note: 'Type a message first.' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Type a message first/ })).toBeDefined()
  await ui.unmount()
})

test('mobile has no message field and says so', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, base, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Type the commit message from a desktop or terminal session/ })).toBeDefined()
  await ui.unmount()
})

test('splitPath separates the name from its folder', () => {
  expect(splitPath('git-graph/hooks/pane.tsx')).toEqual({ name: 'pane.tsx', dir: 'git-graph/hooks' })
  expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' })
  // git lists an untracked directory as `dir/`: it is the name, not an empty file in a folder.
  expect(splitPath('scripts/')).toEqual({ name: 'scripts/', dir: '' })
  expect(splitPath('a/b/')).toEqual({ name: 'b/', dir: 'a' })
})

test('the Changes count pill is gone on a clean tree and back with files', async ($, on) => {
  let model: ChangesModel = { ...base, files: [] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = { ...base, files: [] }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(JSON.stringify((await ui.find({ key: 'section:Changes' }))?.children)).not.toContain('changed file')
    expect(await ui.find({ key: 'all' })).toBeDefined()
    await ui.unmount()
    // `base` has a staged file, so its groups carry the counts; four unstaged files leave the header's count as the only one.
    model = { ...base, files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(path => f(path, 'M')) }
    ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') expect(JSON.stringify((await ui.find({ key: 'section:Changes' }))?.children)).toContain('4 changed files')
    await ui.unmount()
  }
})

test('a clean tree keeps the message box and buttons and says there are no changes', async ($, on) => {
  const model: ChangesModel = { ...base, files: [] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Input', key: 'message' })).toBeDefined()
    expect(await ui.find({ key: 'all' })).toBeDefined()
    expect(await ui.find({ key: 'stash' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^No changes$/ })).toBeDefined()
    // All, Stage and Stash, and ✎ Write, which answers "Nothing to describe." until there is something.
    expect(await ui.find({ key: 'write' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    await ui.unmount()
  }
})

test('Write and Commit carry the same air around their words, so they are the same size for their length', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawMessageFooter($.ui.resolve(e), { message: 'Fix it', note: null, files, ticked: ['git-graph/hooks/changes.ts'], isWriting: false }, none, true))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const air = (label: unknown) => String(label).length - String(label).trim().length
  expect(air((await ui.find({ key: 'write' }))?.props.label)).toBe(2)
  expect(air((await ui.find({ key: 'commit' }))?.props.label)).toBe(2)
  // The same kind of element too: both plain buttons, so they share one shape.
  expect((await ui.find({ key: 'write' }))?.props.plain).toBe(true)
  expect((await ui.find({ key: 'commit' }))?.props.plain).toBe(true)
  await ui.unmount()
})

test('a Commit that is not ready is dim, a ready one is not', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawMessageFooter($.ui.resolve(e), { message: '', note: null, files, ticked: [], isWriting: false }, none, true))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'commit' }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('the write button sits beside Commit on terminal and desktop, shows a busy label while the model drafts, and is absent on mobile', async ($, on) => {
  let model = base
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawChanges($.ui.resolve(e), e.surface, model, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = base
    let ui = await $.ui.mount({ ...PANE, surface })
    const write = await ui.find({ key: 'write' })
    expect(write?.props.label).toBe(' ✎ Write ')
    // A quiet button like the toolbar's: plain and dim, until hover.
    expect(write?.props.plain).toBe(true)
    await ui.unmount()
    model = { ...base, isWriting: true }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'write' }))?.props.label).toBe(' ✎ Writing… ')
    await ui.unmount()
  }
  model = base
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: 'write' })).toBeUndefined()
  await ui.unmount()
})

test('the message footer has the note or the subject counter on the left, and Write then Commit on the right', async ($, on) => {
  let model = { message: 'Fix it\n\nA body line that is much longer than the subject.', note: null as string | null, files, ticked: ['git-graph/hooks/changes.ts'], isWriting: false }
  let withCommit = true
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawMessageFooter($.ui.resolve(e), model, none, withCommit))
  for (const surface of ['terminal', 'desktop'] as const) {
    withCommit = true
    model = { ...model, note: null }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '6/72 · 1 file' })).toBeDefined()
    expect((await ui.find({ key: 'write' }))?.props.label).toBe(' ✎ Write ')
    // One file of the fixture is ticked and the message is there: Commit is live, and its label never changes width.
    expect((await ui.find({ key: 'commit' }))?.props.label).toBe(' Commit ')
    expect((await ui.find({ key: 'commit' }))?.props.plain).toBe(true)
    expect((await ui.find({ key: 'commit' }))?.props.dimColor).not.toBe(true)
    await ui.unmount()
    // A note takes the counter's place.
    model = { ...model, note: 'failed: Claude did not answer (api-error)' }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'failed: Claude did not answer (api-error)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '6/72 · 1 file' })).toBeUndefined()
    await ui.unmount()
    // Under the Input field Commit is the field's own submit, so the footer has Write alone.
    withCommit = false
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'write' })).toBeDefined()
    expect(await ui.find({ key: 'commit' })).toBeUndefined()
    await ui.unmount()
  }
})
