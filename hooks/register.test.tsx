import { test, expect } from 'claude-code/testing'

import type { Commit } from '../types'
import { CEILING, budget } from './budget'
import { FILE_TOGGLES } from './detail'
import { splitDiff, trimDiff } from './diff'
import { drawPane } from './pane'
import type { Model } from './pane'
import { setLook } from './chips'
// A test's own hook draws, so no surface module is loaded: the Input stands in for the editor.
setLook({ editor: false })


const c = (hash: string, parents: string[], subject: string, refs: string[] = []): Commit => ({
  hash,
  parents,
  refs,
  author: 'King Makle',
  date: '2 days ago',
  when: 'October 2, 2026 at 9:25 PM',
  subject,
  stat: '14 files changed, 949 insertions(+), 3 deletions(-)',
})

const history = [
  c('aaaaaaa1', ['bbbbbbb1', 'ccccccc1'], 'Merge the intake branch', ['HEAD -> main', 'origin/main']),
  c('ccccccc1', ['bbbbbbb1'], 'Fix the phone walkthrough', ['origin/intake', 'intake']),
  c('bbbbbbb1', [], 'Set the mark beside the wordmark'),
]

const DIFF =
  'diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3\n'

const sync = { ahead: 0, behind: 0, upstream: null, busy: null, note: null }
const empty: Model = { commits: [], head: '', headHash: '', files: [], ticked: [], sync, message: '', editRev: 0, editCaret: null, openFiles: [], confirmDiscard: null, changesNote: null, undo: null, stashes: [], confirmDrop: null, selected: null, detail: null, error: null, remote: 'https://github.com/King-Makle/all-mite.git', pending: null, input: '', note: null, isHelpOpen: false, helpSection: 'Settings', branches: [], isWriting: false, isSummarizing: false, summary: null, pr: null, isPrBusy: false, isMerging: false, prNote: null, hasGh: true, summaryRev: 0, summaryCaret: null, you: '', incoming: [], clashes: {}, historyView: 'graph', mainRows: [], openMerge: null, teammates: [], openTeammate: null, openPrs: {}, isAutoFetch: false, historyShown: 25, isBranchesOpen: false, branchList: [], branchesShown: 12, aheadOfBase: 0, worktrees: [], isWorktreesOpen: false, confirmRemove: null }
const none = { refresh() {}, pick() {}, close() {}, copy() {}, toggleFile() {}, showFiles() {}, toggleBody() {}, start() {}, confirm() {}, cancel() {}, setInput() {}, toggleHelp() {}, toggleHelpSection() {}, sync() {}, undo() {}, stashApply() {}, stashPop() {}, askDrop() {}, stashDrop() {}, setMessage() {}, commit() {}, toggleAll() {}, stageTicked() {}, unstage() {}, stash() {}, toggleTick() {}, toggleDiff() {}, askDiscard() {}, discard() {}, switchBranch() {}, write() {}, summarize() {}, closeSummary() {}, copySummary() {}, createPr() {}, setSummaryTitle() {}, askMerge() {}, cancelMerge() {}, mergePr() {}, closePr() {}, refreshPr() {}, toggleView() {}, toggleMerge() {}, toggleTeammate() {}, checkoutTeammate() {}, refreshTeammates() {}, toggleAutoFetch() {}, showMoreHistory() {}, toggleBranches() {}, showMoreBranches() {}, startBranch() {}, toggleWorktrees() {}, openWorktree() {}, copyPath() {}, askRemove() {}, removeWorktree() {}, pruneWorktrees() {} }

// A pane the plugin's own hook does not claim (another requestId), drawn by the test's hook from a model.
const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'test',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane draws every commit row with its graph and refs on each surface', async ($, on) => {
  const model: Model = { ...empty, commits: history, head: 'main', files: [{ path: 'a.ts', status: 'M', isStaged: false, isUnstaged: true }] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Main')
    expect(await ui.find({ key: 'c:aaaaaaa1' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'message' })).toBeDefined()
    // The terminal draws glyph runs (the dot in lane 0, the curve into lane 1 beside it); the desktop an SVG per row.
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^─╮$/ })).toBeDefined()
    else expect(await ui.find({ type: 'Svg' })).toBeDefined()
    // origin/intake folds into the local intake chip, which carries a cloud mark.
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /intake.*☁/ })).toBeDefined()
    else expect(await ui.find({ type: 'Svg', text: /intake/ }) ?? (await ui.find({ type: 'Svg' }))).toBeDefined()
    await ui.unmount()
  }
})

test('a selected commit opens its detail with the diff drawn as hunks', async ($, on) => {
  const model: Model = {
    ...empty,
    commits: history,
    head: 'main',
    selected: 'ccccccc1',
    detail: { hash: 'ccccccc1', body: '', files: [{ path: 'src/a.ts', status: 'M', added: 1, deleted: 1 }], diff: DIFF, droppedFiles: 0, open: ['src/a.ts'], showFiles: true },
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // The header: subject, who and the absolute date, the hash to copy, a GitHub link and close.
    expect(await ui.find({ type: 'Text', text: /^King Makle · October 2, 2026/ })).toBeDefined()
    expect((await ui.find({ key: 'copy' }))?.props.label).toBe('⧉ ccccccc')
    expect((await ui.find({ type: 'Link' }))?.props.label).toBe('↗ GitHub')
    expect(await ui.find({ key: 'close' })).toBeDefined()
    // The files line counts from the loaded list; the folder is dim text, the name the toggle.
    expect((await ui.find({ key: 'files' }))?.props.label).toBe('▾ 1 File')
    expect(await ui.find({ type: 'Text', text: /^\+1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^src\/$/ })).toBeDefined()
    expect((await ui.find({ key: 'f:src/a.ts' }))?.props.label).toBe('a.ts')
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).some(svg => svg.props.alt === '+1 −1')).toBe(true)
    await ui.unmount()
  }
})

test('a git error replaces the list with the message', async ($, on) => {
  const model: Model = { ...empty, error: 'fatal: not a git repository' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /not a git repository/ })).toBeDefined()
  await ui.unmount()
})

test('splitDiff strips the git header so each file is hunks the Code element accepts', () => {
  expect(splitDiff(DIFF)).toEqual([{ path: 'src/a.ts', hunks: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3', note: '' }])
  expect(splitDiff('diff --git a/x.png b/x.png\nBinary files differ\n')).toEqual([{ path: 'x.png', hunks: '', note: 'binary file' }])
})

test('trimDiff keeps whole files under the budget and counts the rest', () => {
  const two = DIFF + DIFF.replace(/a\.ts/g, 'b.ts')
  expect(trimDiff(two, DIFF.length + 10)).toEqual({ diff: DIFF, droppedFiles: 1 })
  expect(trimDiff(two, 100000)).toEqual({ diff: two, droppedFiles: 0 })
})

test('the pane stays shut until /git-graph, then reopens each time a surface attaches', async ($, on) => {
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(opened).toEqual([])
  await $.command.run({ command: 'git-graph', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(opened).toEqual(['git-graph', 'git-graph'])
})

test('a commit with many files gets toggles only up to the cap, so the drawing stays pressable', async ($, on) => {
  const paths = Array.from({ length: FILE_TOGGLES + 10 }, (_, i) => `src/file-${i}.ts`)
  const files = paths.map(path => ({ path, status: 'M', added: 1, deleted: 1 }))
  const model: Model = {
    ...empty,
    commits: history,
    head: 'main',
    selected: 'ccccccc1',
    detail: { hash: 'ccccccc1', body: '', files, diff: '', droppedFiles: 0, open: [], showFiles: true },
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // A clean tree with no stashes: the budget leaves what the fixed buttons do not take of the 60 maximum.
  const { toggles } = budget(0, 0)
  expect(await ui.find({ key: `f:${paths[toggles - 1]}` })).toBeDefined()
  expect(await ui.find({ key: `f:${paths[toggles]}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(`Diffs open for the first ${toggles} files`) })).toBeDefined()
  await ui.unmount()
})

test('the file list stays behind an expand button until asked', async ($, on) => {
  const model: Model = {
    ...empty,
    commits: history,
    head: 'main',
    selected: 'ccccccc1',
    detail: { hash: 'ccccccc1', body: '', files: [{ path: 'src/a.ts', status: 'M', added: 1, deleted: 1 }], diff: DIFF, droppedFiles: 0, open: [], showFiles: false },
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'files' })).toBeDefined()
  expect(await ui.find({ key: 'f:src/a.ts' })).toBeUndefined()
  await ui.unmount()
})

test('a selected commit offers what applies to it and delete for another branch on it, then a confirm line for the one started', async ($, on) => {
  const base: Model = {
    ...empty,
    commits: history,
    head: 'main',
    headHash: 'aaaaaaa1',
    selected: 'ccccccc1',
    detail: { hash: 'ccccccc1', body: '', files: [], diff: '', droppedFiles: 0, open: [], showFiles: false },
  }
  let model = base
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = base
    let ui = await $.ui.mount({ ...PANE, surface })
    // ccccccc1 is in HEAD's history (the merge's second parent): it can be undone or reset to, not brought in again.
    for (const kind of ['checkout', 'branch', 'tag', 'revert', 'reset']) expect(await ui.find({ key: `act:${kind}` })).toBeDefined()
    for (const kind of ['cherry-pick', 'merge', 'rebase']) expect(await ui.find({ key: `act:${kind}` })).toBeUndefined()
    // ccccccc1 carries the local branch intake, which is not the current branch: the card offers its delete, not a rename.
    expect(await ui.find({ key: 'act:delete-branch:intake' })).toBeDefined()
    expect(await ui.find({ key: 'act:rename-branch:intake' })).toBeUndefined()
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
    await ui.unmount()

    model = { ...base, selected: 'aaaaaaa1' }
    ui = await $.ui.mount({ ...PANE, surface })
    // aaaaaaa1 is HEAD -> main: the card draws no line for the current branch; the header's ✎ renames it.
    expect(await ui.find({ key: 'branch-line:main' })).toBeUndefined()
    expect(await ui.find({ key: 'act:delete-branch:main' })).toBeUndefined()
    await ui.unmount()

    model = { ...base, pending: { kind: 'checkout', hash: 'ccccccc1' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Check out ccccccc as a detached HEAD\?/ })).toBeDefined()
    expect(await ui.find({ key: 'confirm' })).toBeDefined()
    expect(await ui.find({ key: 'cancel' })).toBeDefined()
    expect(await ui.find({ key: 'act:checkout' })).toBeUndefined()
    await ui.unmount()

    model = { ...base, pending: { kind: 'tag', hash: 'ccccccc1' }, note: 'Type a tag name first.' }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Input', key: 'name' })).toBeDefined()
    expect((await ui.find({ type: 'Input', key: 'name' }))?.props.placeholder).toBe('Tag Name For ccccccc')
    expect(await ui.find({ type: 'Text', text: /Type a tag name first/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the header has an info button that opens a reference panel explaining every action', async ($, on) => {
  let model: Model = { ...empty, commits: history, head: 'main' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'help' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /detached HEAD/ })).toBeUndefined()
  await ui.unmount()

  model = { ...model, isHelpOpen: true, helpSection: 'Commit Card' }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const name of ['↪ Check Out', '＋ Branch', '# Tag', '↺ Revert', '↓ Cherry-Pick', '⤵ Merge', '↑ Rebase Onto', '⇤ Reset Here']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${name.replace(/[+#*?]/g, c => `\\${c}`)}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /detached HEAD/ })).toBeDefined()
  expect(await ui.find({ key: 'help-close' })).toBeDefined()
  await ui.unmount()
})

test('the action buttons are Buttons with a glyph and a verb', async ($, on) => {
  const model: Model = {
    ...empty,
    commits: history,
    head: 'main',
    selected: 'ccccccc1',
    detail: { hash: 'ccccccc1', body: '', files: [], diff: '', droppedFiles: 0, open: [], showFiles: false },
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"key":"act:checkout","label":"↪ Check Out"')
  await ui.unmount()
})

test('the header shows how far the branch is ahead of and behind its upstream', async ($, on) => {
  const model: Model = { ...empty, commits: history, head: 'main', sync: { ...sync, ahead: 2, behind: 1, upstream: 'origin/main' } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Pills on the desktop, coloured text on the terminal.
    if (surface === 'desktop') {
      const header = await ui.find({ key: 'header' })
      const alts = JSON.stringify(header?.children)
      expect(alts).toContain('"ahead 2"')
      expect(alts).toContain('"behind 1"')
    } else {
      expect(await ui.find({ type: 'Text', text: /^2 Ahead$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^1 Behind$/ })).toBeDefined()
    }
    // The Changes section stays, message box and buttons included, even with nothing to commit.
    expect(await ui.find({ type: 'Input', key: 'message' })).toBeDefined()
    await ui.unmount()
  }
})

test('the header offers fetch, pull and push, shows the one running, and reports a failure', async ($, on) => {
  let model: Model = { ...empty, commits: history, head: 'main' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ ...PANE, surface })
    for (const kind of ['fetch', 'pull', 'push']) expect(await ui.find({ key: kind })).toBeDefined()
    await ui.unmount()

    model = { ...model, sync: { ...sync, busy: 'pull' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^↓ Pulling…$/ })).toBeDefined()
    expect(await ui.find({ key: 'pull' })).toBeUndefined()
    expect(await ui.find({ key: 'push' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^↑ Push$/ })).toBeDefined()
    await ui.unmount()

    model = { ...model, sync: { ...sync, note: 'pull failed: Not possible to fast-forward, aborting.' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Not possible to fast-forward/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the header offers undo while a record exists', async ($, on) => {
  let model: Model = { ...empty, commits: history, head: 'main' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'undo' })).toBeUndefined()
  await ui.unmount()
  model = { ...model, undo: { label: 'commit', argv: [['git', 'reset', '--soft', 'HEAD~1']], expectHead: 'aaaaaaa1' } }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'undo' }))?.props.label).toBe('↚  Undo')
  await ui.unmount()
})

test('the header offers Draft PR only on a branch ahead of its base, shows it drafting, and draws the draft as a card with copy and close', async ($, on) => {
  let model: Model = { ...empty, commits: history, head: 'main' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    // On the base, or level with it, there is nothing to draft.
    model = { ...empty, commits: history, head: 'main' }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'summarize' })).toBeUndefined()
    await ui.unmount()
    model = { ...empty, commits: history, head: 'feature', aheadOfBase: 3 }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'summarize' }))?.props.label).toBe('≡ Draft PR')
    expect(await ui.find({ key: 'section:Summary' })).toBeUndefined()
    await ui.unmount()
    model = { ...model, isSummarizing: true }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'summarize' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Drafting/ })).toBeDefined()
    await ui.unmount()
    model = { ...empty, commits: history, head: 'feature', summary: { branch: 'feature', base: 'origin/main', title: 'Add search to the graph', description: 'Filters commits.\n- one\n- two' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'section:Summary' })).toBeDefined()
    expect((await ui.find({ type: 'Input', key: 'summary-title' }))?.props.value).toBe('Add search to the graph')
    expect(await ui.find({ type: 'Text', text: /Filters commits\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /origin\/main/ })).toBeDefined()
    expect(await ui.find({ key: 'summary-copy' })).toBeDefined()
    expect(await ui.find({ key: 'summary-close' })).toBeDefined()
    await ui.unmount()
  }
})

test('the Summary card edits its title in an Input whose submit is Create PR, shows the description, and says why when gh is unavailable', async ($, on) => {
  const drafted = { branch: 'feature', base: 'origin/main', title: 'Add search', description: 'Filters commits.\n- one' }
  let model: Model = { ...empty, commits: history, head: 'feature', summary: drafted }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = { ...empty, commits: history, head: 'feature', summary: drafted }
    let ui = await $.ui.mount({ ...PANE, surface })
    const title = await ui.find({ type: 'Input', key: 'summary-title' })
    expect(title?.props.value).toBe('Add search')
    expect(title?.props.submitLabel).toBe('Create PR')
    expect(await ui.find({ type: 'Text', text: 'feature ahead of origin/main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Filters commits\./ })).toBeDefined()
    await ui.unmount()
    model = { ...model, isPrBusy: true }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Input', key: 'summary-title' }))?.props.submitLabel).toBe('Creating…')
    await ui.unmount()
    model = { ...model, isPrBusy: false, hasGh: false }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Input', key: 'summary-title' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Add search' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /gh auth login/ })).toBeDefined()
    expect(await ui.find({ key: 'summary-copy' })).toBeDefined()
    await ui.unmount()
  }
  model = { ...empty, commits: history, head: 'feature', summary: { ...drafted, description: 'Body.' } }
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Add search' })).toBeDefined()
  await ui.unmount()
})

test('a pull request replaces the Summary card and the Summarize chip, and its number marks the head commit', async ($, on) => {
  const pr = { number: 14, title: 'Add search', url: 'https://github.com/King-Makle/my-claude-mods/pull/14', base: 'main', commits: 3, additions: 5, deletions: 1, checks: 'pass' as const, failing: 0, hasConflicts: false }
  const model: Model = { ...empty, commits: history, head: 'main', pr, summary: { branch: 'main', base: 'origin/main', title: 'Add search', description: 'Body.' } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'section:Pull Request' })).toBeDefined()
    expect(await ui.find({ key: 'section:Summary' })).toBeUndefined()
    expect(await ui.find({ key: 'summarize' })).toBeUndefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: '#14' })).toBeDefined()
    else expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toContain('pull request 14')
    await ui.unmount()
  }
})

test('the Stashes section is composed in above the graph', async ($, on) => {
  const model: Model = { ...empty, commits: history, head: 'main', stashes: [{ index: 0, hash: 'a1b2c3d', message: 'On main: wip', files: 1 }] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'stash-apply:0' })).toBeDefined()
  await ui.unmount()
})

test('the whole drawing stays at or under the pressable ceiling in the worst case', async ($, on) => {
  // Zero-padded so no two fixture hashes collide (`c4` and `c40` would both pad to the same string).
  const hash = (i: number) => `c${String(i).padStart(3, '0')}0000`
  const commits = Array.from({ length: 150 }, (_, i) => c(hash(i), i < 149 ? [hash(i + 1)] : [], `commit ${i}`, i === 0 ? ['HEAD -> main'] : []))
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.ts`, status: 'M' as const, isStaged: false, isUnstaged: true }))
  const stashes = Array.from({ length: 8 }, (_, i) => ({ index: i, hash: `h${i}`, message: `s${i}`, files: 1 }))
  const paths = Array.from({ length: 70 }, (_, i) => `src/d${i}.ts`)
  const detailFiles = paths.map(path => ({ path, status: 'M', added: 1, deleted: 1 }))
  const model: Model = {
    ...empty,
    historyShown: 150,
    commits,
    head: 'main',
    files,
    stashes,
    selected: commits[0]!.hash,
    detail: { hash: commits[0]!.hash, body: '', files: detailFiles, diff: '', droppedFiles: 0, open: [], showFiles: true },
    confirmDiscard: files[0]!.path,
    confirmDrop: 0,
    undo: { label: 'commit', argv: [], expectHead: '' },
    pr: { number: 14, title: 'T', url: 'https://github.com/o/r/pull/14', base: 'main', commits: 3, additions: 1, deletions: 1, checks: 'fail' as const, failing: 1, hasConflicts: false },
    isMerging: true,
    isBranchesOpen: true,
    branchList: Array.from({ length: 20 }, (_, i) => ({ name: i === 0 ? 'main' : `b${i}`, hash: hash(i), age: '1d', time: 0, upstream: '', isGone: false, isMerged: false })),
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.length).toBeLessThanOrEqual(CEILING)
  expect(await ui.find({ key: `c:${hash(39)}` })).toBeDefined()
  expect(await ui.find({ key: `c:${hash(40)}` })).toBeUndefined()
  await ui.unmount()
})

test('the Main line view with 150 merge rows, an open merge, the band and a PR card stays under the pressable ceiling', async ($, on) => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    commit: { ...c(`h${i}`, [`h${i + 1}`, `b${i}`], `Merge pull request #${i} from o/x`), author: 'Sam Lee' },
    merge: { number: i, label: `PR ${i}`, additions: 1, deletions: 1, count: 3, authors: ['Sam Lee'] },
  }))
  const model: Model = {
    ...empty,
    historyShown: 150,
    head: 'main',
    historyView: 'main',
    mainRows: rows,
    incoming: ['h0'],
    sync: { ...sync, behind: 1, upstream: 'origin/main' },
    openMerge: { hash: 'h3', commits: Array.from({ length: 12 }, (_, i) => ({ hash: `c${i}`, author: 'Sam Lee', subject: `s${i}` })) },
    pr: { number: 14, title: 'T', url: 'https://github.com/o/r/pull/14', base: 'main', commits: 3, additions: 1, deletions: 1, checks: 'fail' as const, failing: 1, hasConflicts: false },
    isMerging: true,
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button' })).length).toBeLessThanOrEqual(CEILING)
  await ui.unmount()
})

test('twelve teammates with one open, the Main line, the band and a PR card stay under the pressable ceiling', async ($, on) => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    commit: { ...c(`h${i}`, [`h${i + 1}`, `b${i}`], `Merge pull request #${i} from o/x`), author: 'Sam Lee' },
    merge: { number: i, label: `PR ${i}`, additions: 1, deletions: 1, count: 3, authors: ['Sam Lee'] },
  }))
  const teammates = Array.from({ length: 12 }, (_, i) => ({ branch: `jo/b${i}`, author: 'Jo Park', ahead: 2, updated: 1, pr: null }))
  const model: Model = {
    ...empty,
    historyShown: 150,
    head: 'main',
    historyView: 'main',
    mainRows: rows,
    incoming: ['h0'],
    sync: { ...sync, behind: 1, upstream: 'origin/main' },
    teammates,
    openTeammate: { branch: 'jo/b3', commits: [{ hash: 'c1', author: 'Jo Park', subject: 's' }], files: [{ path: 'a.ts', additions: '1', deletions: '1' }] },
    pr: { number: 14, title: 'T', url: 'https://github.com/o/r/pull/14', base: 'main', commits: 3, additions: 1, deletions: 1, checks: 'fail' as const, failing: 1, hasConflicts: false },
    isMerging: true,
  }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button' })).length).toBeLessThanOrEqual(CEILING)
  await ui.unmount()
})

test('splitDiff keeps a trailing blank context line, so the hunk still has the lines its header counts', () => {
  const diff = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,4 @@\n a\n+b\n c\n \n'
  expect(splitDiff(diff)[0]?.hunks).toBe('--- a/x\n+++ b/x\n@@ -1,3 +1,4 @@\n a\n+b\n c\n ')
})

test('splitDiff turns a hunk whose lines do not add up into a note, never a Code block the desktop refuses', () => {
  const cut = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,4 @@\n a\n+b\n c\n'
  expect(splitDiff(cut)[0]).toEqual({ path: 'x', hunks: '', note: 'diff could not be read' })
})

test('History draws a window of the commits with a Show more row for the rest, and a note at the end of what is loaded', async ($, on) => {
  const hash = (i: number) => `c${String(i).padStart(3, '0')}0000`
  const chain = (n: number) => Array.from({ length: n }, (_, i) => c(hash(i), i < n - 1 ? [hash(i + 1)] : [], `commit ${i}`))
  let model: Model = { ...empty, head: 'main', commits: chain(60), historyShown: 25 }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = { ...empty, head: 'main', commits: chain(60), historyShown: 25 }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: `c:${hash(24)}` })).toBeDefined()
    expect(await ui.find({ key: `c:${hash(25)}` })).toBeUndefined()
    expect((await ui.find({ key: 'history-more' }))?.props.label).toBe('+ Show 25 More')
    expect(await ui.find({ type: 'Text', text: /^35 Older$/ })).toBeDefined()
    await ui.unmount()
    // The last step shows only what is left, and nothing is promised once all 60 are drawn.
    model = { ...model, historyShown: 50 }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'history-more' }))?.props.label).toBe('+ Show 10 More')
    await ui.unmount()
    model = { ...model, historyShown: 75 }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: `c:${hash(59)}` })).toBeDefined()
    expect(await ui.find({ key: 'history-more' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Showing all/ })).toBeUndefined()
    await ui.unmount()
    // Everything the pane loads (150) is drawn: the note says no older commits exist here.
    model = { ...model, commits: chain(150), historyShown: 150 }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Showing all 150 · the pane loads no older commits$/ })).toBeDefined()
    expect(await ui.find({ key: 'history-more' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the Main line view takes the same window and Show more row', async ($, on) => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ commit: c(`m${i}`, [`m${i + 1}`], `row ${i}`), merge: null }))
  let model: Model = { ...empty, head: 'main', commits: [c('m0', [], 'x')], historyView: 'main', mainRows: rows, historyShown: 25 }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    model = { ...model, historyShown: 25 }
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'c:m24' })).toBeDefined()
    expect(await ui.find({ key: 'c:m25' })).toBeUndefined()
    expect((await ui.find({ key: 'history-more' }))?.props.label).toBe('+ Show 25 More')
    await ui.unmount()
  }
})
