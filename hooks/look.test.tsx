import { test, expect } from 'claude-code/testing'

import type { BranchInfo, Commit, Teammate, Worktree } from '../types'
import { BRANCH_ROWS } from './budget'
import { ORANGE, ago, initials, setLook } from './chips'
import { TRUNK, YOU, personColor } from './people'
import { REFERENCE, drawPane } from './pane'
import type { Actions, Model } from './pane'
import { actionGroups, clipBody, relationTo } from './detail'
import { branchesStage, headerStage } from './fit'
import type { Relation } from './detail'
import { drawSection } from './section'
import { AVATAR, COUNT_H, ICON, countWidth, svgAvatar, svgCount, svgIcon } from './svg'
// A test's own hook draws, so no surface module is loaded: the Input stands in for the editor.
setLook({ editor: false })


/** The props of the first Svg with this alt under a found element, or undefined. */
function svgProps(found: { children: unknown[] } | undefined, alt: string): { isInteractive?: boolean } | undefined {
  let hit: { isInteractive?: boolean } | undefined
  const visit = (node: unknown) => {
    if (hit !== undefined || node === null || typeof node !== 'object') return
    const el = node as { type?: string; props?: { alt?: string; isInteractive?: boolean }; children?: unknown[] }
    if (el.type === 'Svg' && el.props?.alt === alt) hit = el.props
    for (const child of el.children ?? []) visit(child)
  }
  for (const child of found?.children ?? []) visit(child)
  return hit
}

/** Every Svg alt under a found element: the kit's `find` answers one element and reads no alt, so a drawing's pills are checked by walking it. */
function alts(found: { children: unknown[] } | undefined): string[] {
  const out: string[] = []
  const visit = (node: unknown) => {
    if (node === null || typeof node !== 'object') return
    const el = node as { type?: string; props?: { alt?: string }; children?: unknown[] }
    if (el.type === 'Svg' && typeof el.props?.alt === 'string') out.push(el.props.alt)
    for (const child of el.children ?? []) visit(child)
  }
  for (const child of found?.children ?? []) visit(child)
  return out
}

/** Every Svg `source` under a found element, joined: the kit's `find` reads no markup, so colours are checked by walking the drawing. */
function sources(found: { children: unknown[] } | undefined): string {
  const out: string[] = []
  const visit = (node: unknown) => {
    if (node === null || typeof node !== 'object') return
    const el = node as { type?: string; props?: { source?: string }; children?: unknown[] }
    if (el.type === 'Svg' && typeof el.props?.source === 'string') out.push(el.props.source)
    for (const child of el.children ?? []) visit(child)
  }
  for (const child of found?.children ?? []) visit(child)
  return out.join('\n')
}

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'test',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test("ago shortens git's relative dates to a number and one unit", () => {
  expect(ago('2 hours ago')).toBe('2h')
  expect(ago('1 hour ago')).toBe('1h')
  expect(ago('5 minutes ago')).toBe('5m')
  expect(ago('3 days ago')).toBe('3d')
  expect(ago('2 weeks ago')).toBe('2w')
  expect(ago('4 months ago')).toBe('4mo')
  expect(ago('1 year, 2 months ago')).toBe('1y')
  expect(ago('10 seconds ago')).toBe('now')
  expect(ago('')).toBe('')
})

test('ago carries minutes into hours, hours into days and days into weeks, as git counts in smaller units for longer', () => {
  // Git says `61 minutes ago` until about 90 minutes, `35 hours ago` until about a day and a half, `10 days ago` until two weeks.
  expect(ago('59 minutes ago')).toBe('59m')
  expect(ago('60 minutes ago')).toBe('1h')
  expect(ago('61 minutes ago')).toBe('1h')
  expect(ago('89 minutes ago')).toBe('1h')
  expect(ago('120 minutes ago')).toBe('2h')
  expect(ago('23 hours ago')).toBe('23h')
  expect(ago('24 hours ago')).toBe('1d')
  expect(ago('35 hours ago')).toBe('1d')
  expect(ago('6 days ago')).toBe('6d')
  expect(ago('7 days ago')).toBe('1w')
  expect(ago('10 days ago')).toBe('1w')
  expect(ago('13 days ago')).toBe('1w')
  expect(ago('3 weeks ago')).toBe('3w')
})

test('initials takes the first letter of the first two words, upper-cased', () => {
  expect(initials('King Makle')).toBe('KM')
  expect(initials('makle')).toBe('M')
  expect(initials('Jean-Luc Picard Jr')).toBe('JP')
  expect(initials('')).toBe('?')
})

test('svgCount is a rounded pill sized to its label', () => {
  const svg = svgCount('6', '#2b63c8', '#ffffff')
  expect(svg).toContain(`height="${COUNT_H}"`)
  expect(svg).toContain(`rx="${COUNT_H / 2}" fill="#2b63c8"`)
  expect(svg).toContain('fill="#ffffff">6</text>')
  expect(countWidth('12')).toBeGreaterThan(countWidth('6'))
})

test('svgAvatar is a circle carrying the initials', () => {
  const svg = svgAvatar('KM')
  expect(svg).toContain(`width="${AVATAR}" height="${AVATAR}"`)
  expect(svg).toContain(`<circle cx="${AVATAR / 2}" cy="${AVATAR / 2}" r="${AVATAR / 2}"`)
  expect(svg).toContain('>KM</text>')
})

test('svgIcon draws a toolbar icon in the given colour', () => {
  const svg = svgIcon('fetch', '#8b949e')
  expect(svg).toContain(`width="${ICON}" height="${ICON}"`)
  expect(svg).toContain('stroke="#8b949e"')
  expect(svgIcon('branch', '#8b949e')).not.toBe(svg)
})

test('drawSection is a bordered card: title, count and actions in its header row, the body under', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => {
    const table = $.ui.resolve(e)
    const { Text, Button } = table
    return drawSection(table, e.surface, {
      title: 'Changes',
      count: { label: '6', bg: '#2b63c8', fg: '#ffffff', title: '6 changed files' },
      actions: [
        <Button plain key="all" onPress={() => {}}>
          all
        </Button>,
      ],
      body: [<Text>body row</Text>],
    })
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const card = await ui.find({ key: 'section:Changes' })
    expect(card?.props.borderStyle).toBe('round')
    expect(card?.props.backgroundColor).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Changes$/ }))?.props.bold).toBe(true)
    expect(await ui.find({ key: 'all' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^body row$/ })).toBeDefined()
    // On the desktop the card's own bottom inset is off and a spacer gives the 10px under the last row instead.
    if (surface === 'desktop') expect(alts(card)).toEqual(['6', 'rule', 'space'])
    if (surface === 'desktop') expect(card?.props.paddingBottom).toBe(0)
    else expect(await ui.find({ type: 'Text', text: /^6$/ })).toBeDefined()
    await ui.unmount()
  }
})

const commit = (hash: string, subject: string, refs: string[] = []): Commit => ({ hash, parents: [], refs, author: 'King Makle', date: '2 hours ago', when: 'x', subject, stat: '' })
const model: Model = {
  commits: [commit('a1', 'First', ['HEAD -> main'])],
  head: 'main',
  headHash: 'a1',
  files: [],
  ticked: [],
  sync: { ahead: 1, behind: 0, upstream: 'origin/main', busy: null, note: null },
  message: '', editRev: 0, editCaret: null,
  openFiles: [],
  confirmDiscard: null,
  changesNote: null,
  undo: { label: 'commit', argv: [], expectHead: 'a1' },
  stashes: [],
  confirmDrop: null,
  selected: null,
  detail: null,
  error: null,
  remote: '',
  pending: null,
  input: '',
  note: null,
  isHelpOpen: false,
  helpSection: 'Settings',
  historyShown: 25,
  branches: ['feature', 'main'],
  isWriting: false,
  isSummarizing: false,
  summary: null,
  pr: null,
  isPrBusy: false,
  isMerging: false,
  prNote: null,
  hasGh: true,
  summaryRev: 0,
  summaryCaret: null,
  you: 'King Makle',
  incoming: [],
  clashes: {},
  historyView: 'graph',
  mainRows: [],
  openMerge: null,
  teammates: [],
  openTeammate: null,
  openPrs: {},
  isAutoFetch: false,
  isBranchesOpen: false,
  branchList: [],
  branchesShown: 12,
  worktrees: [],
  isWorktreesOpen: false,
  confirmRemove: null,
  aheadOfBase: 0,
}
const none: Actions = {
  refresh() {}, pick() {}, close() {}, copy() {}, toggleFile() {}, showFiles() {}, toggleBody() {}, start() {}, confirm() {}, cancel() {}, setInput() {}, toggleHelp() {}, toggleHelpSection() {}, showMoreHistory() {}, sync() {}, undo() {},
  stashApply() {}, stashPop() {}, askDrop() {}, stashDrop() {}, setMessage() {}, commit() {}, toggleAll() {}, stageTicked() {}, unstage() {}, stash() {}, toggleTick() {}, toggleDiff() {}, askDiscard() {}, discard() {}, switchBranch() {}, write() {}, summarize() {}, closeSummary() {}, copySummary() {},
  createPr() {}, setSummaryTitle() {}, askMerge() {}, cancelMerge() {}, mergePr() {}, closePr() {}, refreshPr() {},
  toggleView() {}, toggleMerge() {},
  toggleTeammate() {}, checkoutTeammate() {}, refreshTeammates() {}, toggleAutoFetch() {}, toggleBranches() {}, showMoreBranches() {}, startBranch() {}, toggleWorktrees() {}, openWorktree() {}, copyPath() {}, askRemove() {}, removeWorktree() {}, pruneWorktrees() {},
}

test('the header is a strip: branch, counts as pills, and an icon-chip toolbar whose words are the buttons', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const header = await ui.find({ key: 'header' })
    expect(header?.props.backgroundColor).toBeDefined()
    expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Main')
    for (const key of ['undo', 'fetch', 'pull', 'push', 'help', 'refresh']) expect(await ui.find({ key })).toBeDefined()
    expect((await ui.find({ key: 'fetch' }))?.props.label).toBe('⤓ Fetch')
    expect((await ui.find({ key: 'undo' }))?.props.label).toBe('↚  Undo')
    if (surface === 'desktop') {
      // The toolbar's icons are glyphs in the button labels, so the only Svgs left are the branch icon and the pills.
      expect(await ui.find({ key: 'tool:fetch' })).toBeUndefined()
      expect(alts(header)).toEqual(['branch', 'ahead 1'])
    } else expect(await ui.find({ type: 'Text', text: /^1 Ahead$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a commit row carries an avatar and the author with a short age; the history sits in a card', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^King Makle · 2h$/ })).toBeDefined()
    expect(await ui.find({ key: 'c:a1' })).toBeDefined()
    const history = await ui.find({ key: 'section:History' })
    expect(history?.props.borderStyle).toBe('round')
    if (surface === 'desktop') expect(alts(history)).toContain('avatar KM')
    else expect(await ui.find({ type: 'Text', text: /^KM$/ })).toBeDefined()
    await ui.unmount()
  }
})

test("a commit's dot and avatar take its author's colour, a branch stem too, and yours is blue", async ($, on) => {
  const by = (hash: string, parents: string[], author: string, refs: string[] = []): Commit => ({ ...commit(hash, hash, refs), parents, author })
  const shown: Model = { ...model, you: 'King Makle', headHash: 'm1', commits: [by('m1', ['f0'], 'King Makle', ['HEAD -> main']), by('s2', ['s1'], 'Sam Lee'), by('s1', ['f0'], 'Sam Lee'), by('f0', [], 'King Makle')] }
  const sam = personColor('Sam Lee', 'King Makle')
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = sources(await desktop.find({ key: 'section:History' }))
  expect(svg).toContain(`fill="${YOU}"`)
  expect(svg).toContain(`stroke="${TRUNK}"`)
  expect(svg).toContain(`stroke="${sam}"`)
  expect(svg).toContain(`fill="${sam}"`)
  await desktop.unmount()
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /^SL$/ }))?.props.color).toBe(sam)
  await terminal.unmount()
})

test('rows not pulled yet are dashed under a band that counts them and offers Pull; none draw no band', async ($, on) => {
  const behind: Model = { ...model, sync: { ...model.sync, ahead: 0, behind: 1 }, incoming: ['a1'] }
  let shown = behind
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = behind
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'incoming-pull' }))?.props.label).toBe('↓ Pull')
    expect(await ui.find({ type: 'Text', text: /^↓ 1 incoming from origin$/ })).toBeDefined()
    if (surface === 'desktop') expect(sources(await ui.find({ key: 'section:History' }))).toContain('stroke-dasharray="2 1.6"')
    await ui.unmount()
    // A sync running turns the button into a word.
    shown = { ...behind, sync: { ...behind.sync, busy: 'pull' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'incoming-pull' })).toBeUndefined()
    await ui.unmount()
    shown = model
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'incoming-pull' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /incoming from origin/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('an incoming commit that touches a changed file gets an orange ring, a pill naming the file, and a clash count in the header', async ($, on) => {
  const clashing: Model = { ...model, sync: { ...model.sync, ahead: 0, behind: 1 }, incoming: ['a1'], clashes: { a1: ['git-graph/hooks/pane.tsx', 'git-graph/hooks/summary.tsx'] } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, clashing, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^⚠ touches your pane\.tsx \+1$/ })).toBeDefined()
    if (surface === 'desktop') {
      expect(sources(await ui.find({ key: 'section:History' }))).toContain(`stroke="${ORANGE}"`)
      expect(alts(await ui.find({ key: 'header' }))).toContain('2 clashing')
    } else expect(await ui.find({ type: 'Text', text: /^⚠ 2 Clashes$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the Main line view draws one row per merged PR with its size, opens its commits in place, and the chip swaps views', async ($, on) => {
  const by = (hash: string, parents: string[], subject: string, author = 'Sam Lee'): Commit => ({ ...commit(hash, subject, []), parents, author })
  const merge = { number: 34, label: 'Phase 6s: the suite', additions: 420, deletions: 88, count: 15, authors: ['Sam Lee'] }
  const rows = [
    { commit: by('m34', ['p1', 'b1'], 'Merge pull request #34 from o/x', 'King Makle'), merge },
    { commit: by('p1', ['p0'], 'A plain commit on main', 'King Makle'), merge: null },
  ]
  let shown: Model = { ...model, you: 'King Makle', historyView: 'main', mainRows: rows }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...model, you: 'King Makle', historyView: 'main', mainRows: rows }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'm:m34' }))?.props.label).toBe('▸ #34 Phase 6s: the suite')
    expect(await ui.find({ key: 'c:p1' })).toBeDefined()
    expect(await ui.find({ key: 'c:m34' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\+420$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /15 commits/ })).toBeDefined()
    expect((await ui.find({ key: 'history-view' }))?.props.label).toBe('Full Graph')
    await ui.unmount()
    shown = { ...shown, openMerge: { hash: 'm34', commits: [{ hash: 'c1', author: 'Sam Lee', subject: 'Add the suite' }] } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'm:m34' }))?.props.label).toBe('▾ #34 Phase 6s: the suite')
    expect(await ui.find({ type: 'Text', text: /Add the suite/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+ 14 more/ })).toBeDefined()
    await ui.unmount()
    shown = model
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'history-view' }))?.props.label).toBe('Main Line')
    expect(await ui.find({ key: 'm:m34' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the Main line view keeps the band, the dashed dot and the clash ring on rows not pulled yet, and none when nothing is incoming', async ($, on) => {
  const rows = [{ commit: { ...commit('m35', 'Merge pull request #35 from o/y', []), parents: ['p1', 'b2'], author: 'Sam Lee' }, merge: { number: 35, label: 'Search', additions: 5, deletions: 1, count: 2, authors: ['Sam Lee'] } }]
  let shown: Model = { ...model, historyView: 'main', mainRows: rows, incoming: ['m35'], clashes: { m35: ['git-graph/hooks/pane.tsx'] }, sync: { ...model.sync, behind: 2, ahead: 0 } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'incoming-pull' }))?.props.label).toBe('↓ Pull')
    expect(await ui.find({ type: 'Text', text: /^⚠ touches your pane\.tsx$/ })).toBeDefined()
    if (surface === 'desktop') expect(sources(await ui.find({ key: 'section:History' }))).toContain('stroke-dasharray="2 1.6"')
    await ui.unmount()
    shown = { ...shown, incoming: [], clashes: {} }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'incoming-pull' })).toBeUndefined()
    await ui.unmount()
    shown = { ...shown, incoming: ['m35'], clashes: { m35: ['git-graph/hooks/pane.tsx'] } }
  }
})

test('the Main line view dims nothing for a selection it does not draw, and says it is waiting while its rows load', async ($, on) => {
  const plain = { commit: { ...commit('p1', 'A plain commit', []), parents: ['p0'] }, merge: null }
  let shown: Model = { ...model, historyView: 'main', mainRows: [plain], selected: 'side-branch-commit' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...model, historyView: 'main', mainRows: [plain], selected: 'side-branch-commit' }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'c:p1' }))?.props.dimColor).toBeFalsy()
    await ui.unmount()
    // Rows still loading (graph mode clears them): the card waits instead of claiming there are no commits.
    shown = { ...model, historyView: 'main', mainRows: [] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^The main line loads on the next refresh\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^No commits yet\.$/ })).toBeUndefined()
    await ui.unmount()
    // A repository with no commits at all still says so.
    shown = { ...model, historyView: 'main', mainRows: [], commits: [] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^No commits yet\.$/ })).toBeDefined()
    await ui.unmount()
  }
})

const sam: Teammate = { branch: 'sam/stash-rename', author: 'Sam Lee', ahead: 4, updated: Math.floor(Date.now() / 1000) - 1200, pr: { number: 12, isDraft: false, checks: 'pass', title: 'Rename stashes from the pane', url: 'https://github.com/o/r/pull/12', additions: 40, deletions: 8, isReviewRequested: true } }
const jo: Teammate = { branch: 'jo/spike-worktrees', author: 'Jo Park', ahead: 7, updated: Math.floor(Date.now() / 1000) - 5 * 86_400, pr: null }

test('the Teammates card lists each person\'s branch with its ahead count, PR and checks, and opens one row in place', async ($, on) => {
  let shown: Model = { ...model, teammates: [sam, jo] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...model, teammates: [sam, jo] }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 't:sam/stash-rename' }))?.props.label).toBe('▸ sam/stash-rename')
    expect((await ui.find({ key: 't:jo/spike-worktrees' }))?.props.label).toBe('▸ jo/spike-worktrees')
    expect(await ui.find({ key: 'teammates-refresh' })).toBeDefined()
    if (surface === 'desktop') {
      const found = alts(await ui.find({ key: 'section:Teammates' }))
      expect(found).toContain('ahead 4')
      expect(found).toContain('pull request 12 open')
      expect(found).toContain('no pull request')
      expect(found).toContain('avatar SL')
    } else {
      expect(await ui.find({ type: 'Text', text: /^#12 Open$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^No PR$/ })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^20m$/ })).toBeDefined()
    expect(await ui.find({ key: 'tm-checkout' })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, teammates: [sam, jo], openTeammate: { branch: 'sam/stash-rename', commits: [{ hash: 'abc1234', author: 'Sam Lee', subject: 'Rename a stash with an Input' }], files: [{ path: 'git-graph/hooks/stashes.tsx', additions: '33', deletions: '8' }] } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 't:sam/stash-rename' }))?.props.label).toBe('▾ sam/stash-rename')
    expect((await ui.find({ key: 't:jo/spike-worktrees' }))?.props.label).toBe('▸ jo/spike-worktrees')
    expect(await ui.find({ type: 'Text', text: /Rename stashes from the pane/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^review requested from you$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Rename a stash with an Input/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /git-graph\/hooks\/stashes\.tsx/ })).toBeDefined()
    expect((await ui.find({ key: 'tm-checkout' }))?.props.label).toBe('Check Out')
    expect(await ui.find({ type: 'Link' })).toBeDefined()
    await ui.unmount()
  }
})

test('the Teammates card is not drawn without a signed-in gh or without anyone, and caps at twelve rows with a count', async ($, on) => {
  const many: Teammate[] = Array.from({ length: 14 }, (_, i) => ({ ...jo, branch: `jo/b${i}` }))
  let shown: Model = { ...model, hasGh: false, teammates: [sam] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...model, hasGh: false, teammates: [sam] }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'section:Teammates' })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, hasGh: null, teammates: [sam] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'section:Teammates' })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, teammates: [] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'section:Teammates' })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, teammates: many }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 't:jo/b11' })).toBeDefined()
    expect(await ui.find({ key: 't:jo/b12' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\+ 2 more$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a commit an open PR\'s branch points at carries the PR pill, and the commit HEAD is on does not get it twice', async ($, on) => {
  const tip: Commit = { ...commit('t1', 'Rename a stash', ['origin/sam/stash-rename']), parents: ['a1'] }
  const feat: Commit = { ...commit('f1', 'Feature work', ['HEAD -> feat', 'origin/feat']), parents: ['a1'] }
  const pr14 = { number: 14, title: 'T', url: 'https://github.com/o/r/pull/14', base: 'main', commits: 3, additions: 1, deletions: 1, checks: 'pass' as const, failing: 0, hasConflicts: false }
  let shown: Model = { ...model, head: 'feat', commits: [tip, feat, commit('a1', 'Base')], openPrs: { 'sam/stash-rename': { number: 12, isDraft: false, checks: 'pass' }, feat: { number: 14, isDraft: false, checks: 'pass' } }, pr: pr14 }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...shown }
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') {
      const found = alts(await ui.find({ key: 'section:History' }))
      expect(found).toContain('pull request 12')
      // HEAD's own PR already has its pill from the PR card's number: one, not two.
      expect(found.filter(alt => alt === 'pull request 14')).toHaveLength(1)
    } else {
      expect(await ui.find({ type: 'Text', text: /^#12 ✓$/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('an opened teammate row shows the PR size, and the branch you are on says checked out instead of offering Check out', async ($, on) => {
  const open = { branch: 'sam/stash-rename', commits: [], files: [] }
  let shown: Model = { ...model, teammates: [sam], openTeammate: open }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...model, teammates: [sam], openTeammate: open }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^\+40$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^−8$/ })).toBeDefined()
    expect(await ui.find({ key: 'tm-checkout' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^checked out$/ })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, head: 'sam/stash-rename', teammates: [sam], openTeammate: open }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'tm-checkout' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^checked out$/ })).toBeDefined()
    await ui.unmount()
  }
})

test("the pill on HEAD's own PR keeps the checks mark from the PR card", async ($, on) => {
  const pr14 = { number: 14, title: 'T', url: 'https://github.com/o/r/pull/14', base: 'main', commits: 3, additions: 1, deletions: 1, checks: 'pass' as const, failing: 0, hasConflicts: false }
  const shown: Model = { ...model, pr: pr14 }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^#14 ✓$/ })).toBeDefined()
  await ui.unmount()
})

test('the incoming band stays at the top of History when no incoming commit is among the rows drawn, in both views', async ($, on) => {
  const behind: Model = { ...model, sync: { ...model.sync, ahead: 0, behind: 3 }, incoming: ['past-the-cap'] }
  const plain = { commit: { ...commit('p1', 'A plain commit', []), parents: ['p0'] }, merge: null }
  let shown: Model = behind
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = behind
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'incoming-pull' }))?.props.label).toBe('↓ Pull')
    expect(await ui.find({ type: 'Text', text: /^↓ 1 incoming from origin$/ })).toBeDefined()
    await ui.unmount()
    shown = { ...behind, historyView: 'main', mainRows: [plain] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'incoming-pull' }))?.props.label).toBe('↓ Pull')
    await ui.unmount()
    // Nothing incoming: no band, however the rows fall.
    shown = { ...model, historyView: 'main', mainRows: [plain] }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'incoming-pull' })).toBeUndefined()
    await ui.unmount()
  }
})

test('while a sync runs the header keeps every glyph: the running one reads as a verb, the other two wait dim', async ($, on) => {
  let shown: Model = { ...model, sync: { ...model.sync, busy: 'push' } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    shown = { ...model, sync: { ...model.sync, busy: 'push' } }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^↑ Pushing…$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^⤓ Fetch$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^↓ Pull$/ })).toBeDefined()
    // None of the three is pressable while one runs.
    for (const key of ['fetch', 'pull', 'push']) expect(await ui.find({ key })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, sync: { ...model.sync, busy: 'fetch' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^⤓ Fetching…$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^↓ Pull$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^↑ Push$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the reference panel folds into sections: one open, its entries drawn, the auto-fetch switch in Settings', async ($, on) => {
  let shown: Model = { ...model, isHelpOpen: true }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  const titles = ['Settings', 'Header', 'Branches Card', 'Worktrees Card', 'Changes', 'Stashes', 'History', 'Commit Card', 'Teammates and PRs', 'Git Terms']
  for (const surface of ['terminal', 'desktop'] as const) {
    // Settings open: its switch shows whether auto-fetch is on, the other sections are only headers.
    shown = { ...model, isHelpOpen: true, helpSection: 'Settings', isAutoFetch: false }
    let ui = await $.ui.mount({ ...PANE, surface })
    for (const title of titles) expect((await ui.find({ key: `help-sec:${title}` }))?.props.label).toBe(`${title === 'Settings' ? '−' : '+'} ${title}`)
    expect((await ui.find({ key: 'autofetch' }))?.props.label).toBe('□ Auto-Fetch Every 5 Minutes: Off')
    expect(await ui.find({ type: 'Text', text: /^Main Line$/ })).toBeUndefined()
    await ui.unmount()
    shown = { ...model, isHelpOpen: true, helpSection: 'Settings', isAutoFetch: true }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'autofetch' }))?.props.label).toBe('☑ Auto-Fetch Every 5 Minutes: On')
    await ui.unmount()
    // Another section open: its entries draw and the switch does not.
    shown = { ...model, isHelpOpen: true, helpSection: 'History' }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'help-sec:History' }))?.props.label).toBe('− History')
    expect(await ui.find({ type: 'Text', text: /^Main Line$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Commit Row$/ })).toBeDefined()
    expect(await ui.find({ key: 'autofetch' })).toBeUndefined()
    await ui.unmount()
    // All folded: headers only.
    shown = { ...model, isHelpOpen: true, helpSection: null }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Main Line$/ })).toBeUndefined()
    expect(await ui.find({ key: 'help-sec:Header' })).toBeDefined()
    await ui.unmount()
    // Closed panel: no headers, no switch.
    shown = { ...model, isHelpOpen: false }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'help-sec:Settings' })).toBeUndefined()
    expect(await ui.find({ key: 'autofetch' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the reference has ten titled sections, every entry says something, and no name repeats within a section', () => {
  expect(REFERENCE.map(section => section.title)).toEqual(['Settings', 'Header', 'Branches Card', 'Worktrees Card', 'Changes', 'Stashes', 'History', 'Commit Card', 'Teammates and PRs', 'Git Terms'])
  for (const section of REFERENCE) expect(new Set(section.entries.map(entry => entry.name)).size).toBe(section.entries.length)
  for (const section of REFERENCE) for (const entry of section.entries) {
    expect(entry.name.length).toBeGreaterThan(0)
    expect(entry.what.length).toBeGreaterThan(10)
  }
})

test('the branch you are on is the header button that opens the Branches card; a detached HEAD reads detached', async ($, on) => {
  let shown: Model = model
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Main')
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    await ui.unmount()
  }
  shown = { ...model, head: '' }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Detached')
  await ui.unmount()
})

// An interactive Svg is a sandboxed frame the desktop re-creates on every redraw, so it blinks on scroll
// and on each refresh (seen 2026-10-05). Every Svg stays an image; the titles in the markup are harmless.
test('no Svg is drawn interactive: pills, avatars, status letters and count pills are images', async ($, on) => {
  const dirty: Model = { ...model, files: [{ path: 'a.ts', status: 'M', isStaged: false, isUnstaged: true }] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, dirty, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const header = await ui.find({ key: 'header' })
  expect(svgProps(header, 'ahead 1')?.isInteractive).toBeUndefined()
  expect(svgProps(header, '1 uncommitted')?.isInteractive).toBeUndefined()
  const history = await ui.find({ key: 'section:History' })
  expect(svgProps(history, 'avatar KM')).toBeDefined()
  expect(svgProps(history, 'avatar KM')?.isInteractive).toBeUndefined()
  expect(svgProps(history, 'head main')?.isInteractive).toBeUndefined()
  const changes = await ui.find({ key: 'section:Changes' })
  expect(svgProps(changes, 'status M')).toBeDefined()
  expect(svgProps(changes, 'status M')?.isInteractive).toBeUndefined()
  expect(svgProps(changes, '1')?.isInteractive).toBeUndefined()
  await ui.unmount()
})

test('no control anywhere draws a key box, the commit card and its confirm line included', async ($, on) => {
  const opened: Model = { ...model, selected: 'a1', detail: { hash: 'a1', body: '', files: [], diff: '', droppedFiles: 0, open: [], showFiles: false } }
  let drawn = opened
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, drawn, e.props.bodyColumns, none))
  for (const next of [opened, { ...opened, pending: { kind: 'tag' as const, hash: 'a1' } }]) {
    drawn = next
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    for (const button of await ui.findAll({ type: 'Button' })) expect(button.props.hotkey).toBeUndefined()
    await ui.unmount()
  }
})

test('the commit card groups its actions by where the change lands, and a confirm line takes only its own row', async ($, on) => {
  // HEAD is the merge m1 on main; a1 and b1 are its parents; s1 is on another branch, not in HEAD's history.
  const merge: Commit = { ...commit('m1', 'Merge pull request #12', ['HEAD -> main']), parents: ['a1', 'b1'] }
  const side = commit('s1', 'Side work', ['feature'])
  const long = 'word '.repeat(80).trim()
  const loaded = (hash: string) => ({ hash, body: long, files: [], diff: '', droppedFiles: 0, open: [], showFiles: false })
  const base: Model = { ...model, head: 'main', headHash: 'm1', commits: [side, merge, commit('a1', 'First'), commit('b1', 'Side')], selected: 's1', detail: loaded('s1') }
  let drawn = base
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, drawn, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    drawn = base
    let ui = await $.ui.mount({ ...PANE, surface })
    // A row per group; on the desktop each name is a fixed-width Svg, so the buttons line up. The buttons are the toolbar's: plain and dim.
    expect((await ui.find({ key: 'act:checkout' }))?.props.plain).toBe(true)
    expect((await ui.find({ key: 'act:checkout' }))?.props.dimColor).toBe(true)
    for (const [id, title] of [['go', 'Go To It'], ['into', 'Bring Into Main'], ['rewrite', 'Rewrites Main']]) {
      const row = await ui.find({ key: `group:${id}` })
      if (surface === 'desktop') expect(alts(row)).toContain(title)
      else expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeDefined()
    }
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /^Rewrites Main$/ }))?.props.color).toBe(ORANGE)
    expect((await ui.find({ key: 'act:branch' }))?.props.label).toBe('＋ Branch')
    // The other branch on the commit gets a line with delete; a long body is clipped with a more button; the header is flat.
    expect((await ui.find({ key: 'act:delete-branch:feature' }))?.props.label).toBe('✕ Delete')
    expect(await ui.find({ key: 'act:rename-branch:feature' })).toBeUndefined()
    expect(await ui.find({ key: 'body-more' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /…$/ })).toBeDefined()
    expect((await ui.find({ key: 'detail-head' }))?.props.backgroundColor).toBeUndefined()
    await ui.unmount()

    // HEAD's own merge: branch, tag and revert only; its parents in the graph are buttons; the branch you are on gets no line.
    drawn = { ...base, selected: 'm1', detail: loaded('m1') }
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'act:revert' }))?.props.label).toBe('↺ Revert')
    for (const kind of ['checkout', 'cherry-pick', 'merge', 'rebase', 'reset']) expect(await ui.find({ key: `act:${kind}` })).toBeUndefined()
    expect((await ui.find({ key: 'parent:a1' }))?.props.label).toBe('↑ a1')
    expect((await ui.find({ key: 'parent:b1' }))?.props.label).toBe('↖ b1')
    expect(await ui.find({ key: 'branch-line:main' })).toBeUndefined()
    await ui.unmount()

    // A confirm line takes its own group's row and leaves the others.
    drawn = { ...base, pending: { kind: 'merge', hash: 's1' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'group:into' })).toBeUndefined()
    expect(await ui.find({ key: 'group:go' })).toBeDefined()
    expect((await ui.find({ key: 'confirm' }))?.props.label).toBe('✓ Confirm')
    await ui.unmount()

    // A delete started on the card's branch line has no row of its own: its confirm line sits above the rows, every row stays.
    drawn = { ...base, pending: { kind: 'delete-branch', hash: 's1', target: 'feature' } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'confirm-line' })).toBeDefined()
    for (const id of ['go', 'into', 'rewrite']) expect(await ui.find({ key: `group:${id}` })).toBeDefined()
    await ui.unmount()

  }
})

test('actionGroups offers only what changes something: HEAD, a commit in its history, one outside it', () => {
  const kinds = (relation: Relation, parents = ['p']) =>
    actionGroups({ ...commit('x', 'X'), parents }, 'main', relation).map(group => `${group.title}: ${group.actions.map(action => action.kind).join(' ')}`)
  expect(kinds('head')).toEqual(['Go To It: branch tag', 'Undo On Main: revert'])
  expect(kinds('history')).toEqual(['Go To It: checkout branch tag', 'Undo On Main: revert', 'Rewrites Main: reset'])
  expect(kinds('other')).toEqual(['Go To It: checkout branch tag', 'Bring Into Main: cherry-pick merge rebase', 'Rewrites Main: reset'])
  expect(kinds('other', ['p', 'q'])).toEqual(['Go To It: checkout branch tag', 'Bring Into Main: merge rebase', 'Rewrites Main: reset'])
  expect(actionGroups(commit('x', 'X'), '', 'head').map(group => group.title)).toEqual(['Go To It', 'Undo On HEAD'])
})

test('relationTo walks parents from HEAD through the loaded commits', () => {
  const list = [{ ...commit('m', 'M'), parents: ['a', 'b'] }, { ...commit('a', 'A'), parents: ['r'] }, { ...commit('b', 'B'), parents: ['r'] }, commit('r', 'R'), { ...commit('s', 'S'), parents: ['r'] }]
  expect(relationTo('m', list, 'm')).toBe('head')
  expect(relationTo('b', list, 'm')).toBe('history')
  expect(relationTo('r', list, 'm')).toBe('history')
  expect(relationTo('s', list, 'm')).toBe('other')
})

test('clipBody keeps a short body whole and clips a long one at a word or after three lines', () => {
  expect(clipBody('Short.', false)).toEqual({ text: 'Short.', isClipped: false })
  const long = 'word '.repeat(80).trim()
  const clipped = clipBody(long, false)
  expect(clipped.isClipped).toBe(true)
  expect(clipped.text.endsWith('word…')).toBe(true)
  expect(clipped.text.length).toBeLessThanOrEqual(191)
  expect(clipBody(long, true)).toEqual({ text: long, isClipped: true })
  expect(clipBody('a\nb\nc\nd', false).text).toBe('a\nb\nc…')
})

const branch = (name: string, extra: Partial<BranchInfo> = {}): BranchInfo => ({ name, hash: `${name}-tip`, age: '3d', time: 0, upstream: '', isGone: false, isMerged: false, ...extra })

test('the Branches card lists the branch you are on first with rename, the rest with their state, switch and delete', async ($, on) => {
  const list = [branch('main', { upstream: 'origin/main', isMerged: true, age: '2m' }), branch('done', { isMerged: true }), branch('wip'), branch('old-pr', { upstream: 'origin/old-pr', isGone: true, isMerged: true })]
  const base: Model = { ...model, isBranchesOpen: true, branchList: list }
  let drawn = base
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, drawn, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    drawn = base
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Main')
    expect(await ui.find({ key: 'section:Branches' })).toBeDefined()
    expect((await ui.find({ key: 'branch-rename:main' }))?.props.label).toBe('✎ Rename')
    expect(await ui.find({ key: 'branch-delete:main' })).toBeUndefined()
    expect(await ui.find({ key: 'branch-switch:main' })).toBeUndefined()
    for (const name of ['done', 'wip', 'old-pr']) {
      expect((await ui.find({ key: `branch-switch:${name}` }))?.props.label).toBe('⟁ Switch')
      expect((await ui.find({ key: `branch-delete:${name}` }))?.props.label).toBe('✕ Delete')
    }
    const states = surface === 'desktop' ? alts(await ui.find({ key: 'section:Branches' })) : []
    if (surface === 'desktop') for (const label of ['◎ Current', 'Merged', 'Not Merged', 'Remote Gone']) expect(states).toContain(label)
    else expect(await ui.find({ type: 'Text', text: /^Not Merged$/ })).toBeDefined()
    expect(await ui.find({ key: 'rename-head' })).toBeUndefined()
    await ui.unmount()

    // A delete of a branch HEAD does not have asks harder and is forced; its confirm line takes the row's place.
    drawn = { ...base, pending: { kind: 'delete-branch', hash: 'wip-tip', target: 'wip', site: 'branches', force: true } }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'branch:wip' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Delete branch wip\? It is not merged/ })).toBeDefined()
    expect((await ui.find({ key: 'confirm' }))?.props.label).toBe('✕ Delete Anyway')
    await ui.unmount()

    // A rename of the branch you are on, with what went wrong under it on the card.
    drawn = { ...base, pending: { kind: 'rename-branch', hash: 'main-tip', target: 'main', site: 'branches' }, note: 'Type a branch name first.' }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'branch:main' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Text', text: /^Type a branch name first\.$/ })).toHaveLength(1)
    if (surface === 'desktop') {
      const field = await ui.find({ type: 'Input', key: 'name' })
      expect(field?.props.placeholder).toBe('New Name For Main')
      // The field's own submit is the confirm; no second Confirm button under it.
      expect(field?.props.submitLabel).toBe('✓ Confirm')
      expect(await ui.find({ key: 'confirm' })).toBeUndefined()
      expect(await ui.find({ key: 'cancel' })).toBeDefined()
      // No line above the field: echoing the name per keystroke redrew the pane and flickered its focus ring.
      expect(await ui.find({ type: 'Text', text: /^Rename main/ })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('an open commit lists every ref on it with its whole name, which the row clips or folds into +N', async ($, on) => {
  const refs = ['HEAD -> main', 'origin/main', 'release/1.22', 'tag: pf-toolkit-v1.22.3', 'tag: v1.22.3']
  const top: Commit = { ...commit('top', 'Release v1.22.3'), refs }
  const shown: Model = { ...model, commits: [top, ...model.commits.slice(1)], head: 'main', selected: top.hash, headHash: top.hash, detail: { hash: top.hash, body: '', files: [], diff: '', droppedFiles: 0, open: [], showFiles: false } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const card = alts(await ui.find({ key: 'detail-refs' }))
  expect(card).toEqual(['head main', 'local release/1.22', 'tag pf-toolkit-v1.22.3', 'tag v1.22.3'])
  // The row keeps two chips and folds the two tags into one grey +2.
  expect(alts(await ui.find({ key: top.hash }))).toContain('more pf-toolkit-v1.22.3, v1.22.3')
  await ui.unmount()
})

const tree = (path: string, extra: Partial<Worktree> = {}): Worktree => ({ path, folder: path.slice(path.lastIndexOf('/') + 1), branch: null, head: 'abc1234def', isMain: false, isHere: false, isSession: false, isGone: false, ...extra })
const trees = [
  tree('/r/repo', { branch: 'main', isMain: true, isHere: true }),
  tree('/r/repo/.claude/worktrees/spike-1', { branch: 'spike', isSession: true }),
  tree('/r/side', { branch: 'side' }),
  tree('/r/gone', { branch: 'stale', isGone: true }),
  tree('/r/repo/.claude/worktrees/look-2', { head: 'c1', isSession: true }),
]

test('a branch checked out in another worktree is purple on the Branches card, with open and copy path in place of switch and delete', async ($, on) => {
  const list = [branch('main', { isMerged: true }), branch('spike'), branch('side', { isMerged: true }), branch('stale'), branch('free')]
  const base: Model = { ...model, isBranchesOpen: true, branchList: list, worktrees: trees }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, base, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const name of ['spike', 'side']) {
      expect((await ui.find({ key: `branch-open:${name}` }))?.props.label).toBe('⎋ Open')
      expect((await ui.find({ key: `branch-copy:${name}` }))?.props.label).toBe('⧉ Copy Path')
      expect(await ui.find({ key: `branch-switch:${name}` })).toBeUndefined()
      expect(await ui.find({ key: `branch-delete:${name}` })).toBeUndefined()
    }
    expect((await ui.find({ key: 'branch-prune:stale' }))?.props.label).toBe('⌫ Prune')
    expect((await ui.find({ key: 'branch-switch:free' }))?.props.label).toBe('⟁ Switch')
    expect((await ui.find({ key: 'branch-rename:main' }))?.props.label).toBe('✎ Rename')
    if (surface === 'desktop') {
      const states = alts(await ui.find({ key: 'section:Branches' }))
      for (const label of ['⌂ Session', '⌂ Worktree', '⌂ Folder Gone']) expect(states).toContain(label)
    }
    await ui.unmount()
  }
})

test('the header offers ✿ beside the branch name, which opens the Worktrees card; a remove asks in its row', async ($, on) => {
  let drawn: Model = { ...model, worktrees: trees }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, drawn, e.props.bodyColumns, none))
  for (const surface of ['terminal', 'desktop'] as const) {
    drawn = { ...model, worktrees: trees }
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'worktrees' }))?.props.label).toBe('✿')
    expect(await ui.find({ key: 'section:Worktrees' })).toBeUndefined()
    await ui.unmount()

    drawn = { ...model, worktrees: trees, isWorktreesOpen: true }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'section:Worktrees' })).toBeDefined()
    // This pane's own: copy only. The main checkout (when it is not this pane) is never removed.
    expect((await ui.find({ key: 'worktree-copy:/r/repo' }))?.props.label).toBe('⧉ Copy Path')
    expect(await ui.find({ key: 'worktree-open:/r/repo' })).toBeUndefined()
    for (const path of ['/r/repo/.claude/worktrees/spike-1', '/r/side', '/r/repo/.claude/worktrees/look-2']) {
      expect((await ui.find({ key: `worktree-open:${path}` }))?.props.label).toBe('⎋ Open')
      expect((await ui.find({ key: `worktree-remove:${path}` }))?.props.label).toBe('✕ Remove')
    }
    expect((await ui.find({ key: 'worktree-prune:/r/gone' }))?.props.label).toBe('⌫ Prune')
    if (surface === 'desktop') {
      const labels = alts(await ui.find({ key: 'section:Worktrees' }))
      for (const label of ['◎ This Pane', 'Claude Session', 'Worktree', 'Folder Gone', 'Detached c1', 'spike']) expect(labels).toContain(label)
    }
    await ui.unmount()

    drawn = { ...model, worktrees: trees, isWorktreesOpen: true, confirmRemove: '/r/side' }
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'worktree:/r/side' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Remove the worktree side\?/ })).toBeDefined()
    expect((await ui.find({ key: 'worktree-remove-yes' }))?.props.label).toBe('✕ Remove')
    await ui.unmount()
  }
  // One checkout: no button. A pane in a linked worktree says so beside the branch name.
  drawn = { ...model, worktrees: [trees[0]!] }
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'worktrees' })).toBeUndefined()
  await ui.unmount()
  drawn = { ...model, worktrees: [{ ...trees[0]!, isHere: false }, { ...trees[1]!, isHere: true }] }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(alts(await ui.find({ key: 'header' }))).toContain('worktree')
  await ui.unmount()
})

test('the Branches card stays shut until opened, and draws at most its row cap', async ($, on) => {
  let drawn: Model = model
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, drawn, e.props.bodyColumns, none))
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'section:Branches' })).toBeUndefined()
  await ui.unmount()
  drawn = { ...model, isBranchesOpen: true, branchList: Array.from({ length: BRANCH_ROWS + 3 }, (_, i) => branch(i === 0 ? 'main' : `b${i}`)) }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: `branch:b${BRANCH_ROWS - 1}` })).toBeDefined()
  expect(await ui.find({ key: `branch:b${BRANCH_ROWS}` })).toBeUndefined()
  expect((await ui.find({ key: 'branches-more' }))?.props.label).toBe('+ Show 3 More')
  expect(await ui.find({ type: 'Text', text: /^3 Older$/ })).toBeDefined()
  await ui.unmount()
})

test('labels shorten only as far as the width needs: the header pills first, then its buttons, each card on its own', async ($, on) => {
  const list = [branch('main', { isMerged: true, age: '2m' }), branch('wip', { age: '3d' })]
  const shown: Model = { ...model, isBranchesOpen: true, branchList: list, files: [{ path: 'a.ts', status: 'M', isStaged: false, isUnstaged: true }], selected: 'a1', headHash: 'x', detail: { hash: 'a1', body: '', files: [], diff: '', droppedFiles: 0, open: [], showFiles: false } }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, shown, e.props.bodyColumns, none))
  const at = (columns: number) => $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'desktop' })
  const label = async (ui: Awaited<ReturnType<typeof at>>, key: string) => (await ui.find({ key }))?.props.label

  // Wide: everything whole.
  let ui = await at(140)
  expect(await label(ui, 'fetch')).toBe('⤓ Fetch')
  expect(await label(ui, 'branches')).toBe('Main')
  expect(JSON.stringify(await ui.find({ key: 'header' }))).toContain('1 Ahead')
  expect(await label(ui, 'branch-switch:wip')).toBe('⟁ Switch')
  expect(await ui.find({ type: 'Text', text: /^3d$/ })).toBeDefined()
  await ui.unmount()

  // 45 columns: the header is too tight, so its pills go short and its buttons to their glyphs; the cards still fit whole.
  ui = await at(45)
  for (const [key, glyph] of [['branches', 'Main'], ['fetch', '⤓'], ['pull', '↓'], ['push', '↑'], ['undo', '↚\u00a0']] as const) expect(await label(ui, key)).toBe(glyph)
  expect(JSON.stringify(await ui.find({ key: 'header' }))).not.toContain('1 Ahead')
  expect(await label(ui, 'stage')).toBe('＋ Stage')
  expect(await label(ui, 'branch-switch:wip')).toBe('⟁ Switch')
  await ui.unmount()

  // 28 columns: every card shortens too, and the Branches card drops its ages.
  ui = await at(28)
  for (const [key, glyph] of [['stage', '＋'], ['stash', '❏'], ['branch-switch:wip', '⟁'], ['branch-delete:wip', '✕'], ['branch-rename:main', '✎'], ['act:checkout', '↪']] as const) expect(await label(ui, key)).toBe(glyph)
  expect(await ui.find({ type: 'Text', text: /^3d$/ })).toBeUndefined()
  await ui.unmount()
})

test('headerStage and branchesStage pick the least shortening that fits', () => {
  const glyph = (label: string) => label.split(' ')[0]!
  const pills = [{ full: '3 Ahead', short: '↑3' }, { full: '10 Changed', short: '10' }]
  const buttons = ['⤓ Fetch', '↓ Pull', '↑ Push', 'ⓘ', '↻']
  expect(headerStage(120, 'main ▽', pills, buttons, glyph)).toBe(0)
  const tight = [70, 60, 50, 40].map(columns => headerStage(columns, 'main ▽', pills, buttons, glyph))
  expect(tight).toEqual([...tight].sort())
  expect(headerStage(30, 'main ▽', pills, buttons, glyph)).toBe(2)
  const rows = [{ name: 'info-panel-sections', marks: 1, pills: ['Merged'], age: '4d', buttons: ['⟁ Switch', '✕ Delete'] }]
  expect(branchesStage(120, rows, glyph)).toBe(0)
  expect(branchesStage(25, rows, glyph)).toBe(2)
})

test('the header branch name shows capitalised, and the triangle stands in for it when even the shortest header has no room', async ($, on) => {
  const long: Model = { ...model, head: 'feature/a-very-long-branch-name-for-the-header' }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, long, e.props.bodyColumns, none))
  let ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 140 }, surface: 'desktop' })
  expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Feature/a-very-long-branch-name…')
  expect(alts(await ui.find({ key: 'branch-chip' }))).toContain('branch')
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50 }, surface: 'desktop' })
  expect((await ui.find({ key: 'branches' }))?.props.label).toBe('▽')
  await ui.unmount()
})

test('a short branch name keeps its place in a narrow header', async ($, on) => {
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, none))
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 45 }, surface: 'desktop' })
  expect((await ui.find({ key: 'branches' }))?.props.label).toBe('Main')
  await ui.unmount()
})

test('History rows drop their authors together when the pane is too narrow for them, so the ages stay in one column', async ($, on) => {
  const list: Model = { ...model, commits: [commit('a1', 'First', ['HEAD -> main', 'origin/main']), commit('b1', 'Second'), commit('c1', 'Third', ['feature'])] }
  on('ui.render', { component: 'Pane', requestId: 'test' }, ($, e) => drawPane($.ui.resolve(e), e.surface, list, e.props.bodyColumns, none))
  let ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 120 }, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Text', text: /^King Makle · 2h$/ })).toHaveLength(3)
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 40 }, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Text', text: /^King Makle/ })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Text', text: /^2h$/ })).toHaveLength(3)
  await ui.unmount()
})
