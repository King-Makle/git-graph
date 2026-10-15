import type { ElementTable, Elements, EngineInterface, RenderElement, RenderSurface } from 'claude-code'

import type { ActionKind, BranchInfo, ChangedFile, Commit, Detail, HistoryView, MainRow, OpenFile, OpenMerge, OpenTeammate, Pending, PrBadge, PullRequest, Stash, Summary, Sync, SyncKind, Teammate, Undo, Worktree } from '../types'
import { HISTORY_LOADED, HISTORY_STEP, budget } from './budget'
import { drawIncomingBand } from './band'
import { drawChanges } from './changes'
import type { ChangesActions } from './changes'
import { BLUE_TEXT, CARD_BG, DIM, GLYPH, HOVER, INCOMING_BG, ORANGE, PILL, PURPLE, PURPLE_BG, RED, RULE, ago, capitalize, clip, glyphOnly, initials, pill, refChips } from './chips'
import type { Chip } from './chips'
import { LABELS, drawDetails } from './detail'
import { drawBranches } from './branches'
import { cardHeaderFits, fitsBranchName, headerStage, historyAuthorFits } from './fit'
import type { BranchesActions } from './branches'
import { heldBy } from './git'
import { drawWorktrees } from './worktrees'
import type { WorktreesActions } from './worktrees'
import { drawSection, spaced } from './section'
import { clashLabel } from './incoming'
import { drawMainRows } from './mainview'
import { drawStashes } from './stashes'
import { badgeFor, badgeLabel } from './teammates'
import { drawTeammates } from './teammatesview'
import { drawPrCard } from './prcard'
import type { PrCardActions } from './prcard'
import { drawSummary } from './summary'
import type { SummaryActions } from './summary'
import { glyphs, layout } from './graph'
import { laneColors, personColor, trunkHashes } from './people'
import type { RowColors } from './people'
import { groupFiles } from './selection'
import type { Lanes } from './graph'
import { AVATAR, COUNT_H, ICON, LANE_W, ROW_H, RULE_H, countWidth, pillWidth, svgAvatar, svgCount, svgIcon, svgRow, svgRule, svgSpace } from './svg'
import type { DotStyle } from './svg'

export type Model = {
  commits: Commit[]
  head: string
  branches: string[]
  headHash: string
  files: ChangedFile[]
  /** The ticked paths: a selection only. */
  ticked: string[]
  sync: Sync
  message: string
  editRev: number
  editCaret: number | null
  /** Bumped on every press but the message box's own: the box's caret stops blinking. */
  editorBlur?: number
  openFiles: OpenFile[]
  confirmDiscard: string | null
  changesNote: string | null
  undo: Undo | null
  stashes: Stash[]
  confirmDrop: number | null
  selected: string | null
  detail: Detail | null
  error: string | null
  remote: string
  pending: Pending | null
  input: string
  note: string | null
  isHelpOpen: boolean
  /** The reference panel's one open section, by title; null when every section is folded. */
  helpSection: string | null
  isWriting: boolean
  isSummarizing: boolean
  summary: Summary | null
  pr: PullRequest | null
  isPrBusy: boolean
  isMerging: boolean
  prNote: string | null
  hasGh: boolean | null
  summaryRev: number
  summaryCaret: number | null
  you: string
  /** Hashes on the upstream that HEAD does not have: drawn dashed under a band with Pull. */
  incoming: string[]
  /** Incoming commit hash to the changed files it also touches; empty when none clash. */
  clashes: Record<string, string[]>
  historyView: HistoryView
  /** How many commits (or Main line rows) History draws; Show more adds a step, up to what is loaded. */
  historyShown: number
  mainRows: MainRow[]
  openMerge: OpenMerge | null
  teammates: Teammate[]
  openTeammate: OpenTeammate | null
  /** Every open PR by head branch, for the pill on a branch tip. */
  openPrs: Record<string, PrBadge>
  /** A quiet `git fetch` every few minutes while the pane is open. */
  isAutoFetch: boolean
  /** Commits on this branch its base does not have: Draft PR shows only when there are some. */
  aheadOfBase: number
  isBranchesOpen: boolean
  branchList: BranchInfo[]
  /** Branches card rows drawn; Show More adds BRANCH_ROWS. */
  branchesShown: number
  /** Every checkout of the repo; the Worktrees card lists them, and a branch another one holds is drawn purple. */
  worktrees: Worktree[]
  isWorktreesOpen: boolean
  /** The worktree path whose remove confirm is open. */
  confirmRemove: string | null
}

export type Actions = {
  refresh: () => void
  pick: (hash: string) => void
  close: () => void
  copy: (hash: string, surface: RenderSurface) => void
  toggleFile: (path: string) => void
  showFiles: () => void
  toggleBody: () => void
  start: (kind: ActionKind, hash: string, target?: string) => void
  confirm: () => void
  cancel: () => void
  setInput: (text: string) => void
  toggleHelp: () => void
  toggleHelpSection: (title: string) => void
  sync: (kind: SyncKind) => void
  undo: () => void
  stashApply: (index: number) => void
  stashPop: (index: number) => void
  askDrop: (index: number | null) => void
  stashDrop: (index: number) => void
  switchBranch: (name: string) => void
  summarize: () => void
  toggleView: () => void
  showMoreHistory: () => void
  toggleMerge: (hash: string) => void
  toggleTeammate: (branch: string) => void
  checkoutTeammate: (branch: string) => void
  refreshTeammates: () => void
  toggleAutoFetch: () => void
} & ChangesActions &
  BranchesActions &
  WorktreesActions &
  SummaryActions &
  PrCardActions

// Pixels between History's last rule and its Show More row, to centre the row above the card's bottom edge.
const MORE_AIR = 3

// The header's branch icon, as bright as the branch name beside it.
const BRANCH_ICON = '#ffffff'
// What the branch button shows in place of the name when the header has no room for it (U+25BD, the user's pick 2026-10-09).
const BRANCH_GLYPH = '▽'
// Undo's button. ↚ draws its stroke past its own width (seen live, 2026-10-09), so a second space keeps it off the word,
// and alone it carries a no-break space after it so the stroke stays inside the button.
const UNDO_LABEL = `${GLYPH.undo}  Undo`
const UNDO_COMPACT = `${GLYPH.undo}\u00a0`
// The Worktrees card's button, right of the branch name, with no count: U+273F, which draws ~20% taller than the U+2743
// first picked (a Button's text has no size; measured live 2026-10-09).
const TREE_GLYPH = '✿'
// A branch name longer than this is clipped in the header's branch button.
const BRANCH_CHARS = 32

// A narrow pane (under this many cells) shows one shorter chip and the count.
const NARROW = 70

/** The whole pane from its model: pure, so a test mounts it with any history. */
/** `cut` keeps only the first N root children (a dev bisect of a tree the live desktop refuses); Infinity draws all. */
export function drawPane(table: ElementTable, surface: RenderSurface, model: Model, columns: number, act: Actions, cut = Infinity): RenderElement {
  const { Box, Text, Button } = table
  // The desktop refuses a drawing past about 222 buttons: file and stash rows take their share first.
  // A file edited since it was staged is in both groups, so the rows can outnumber the files.
  const { staged: stagedRows, changes: changeRows } = groupFiles(model.files)
  const { commits: cap, toggles, branchRows, worktreeRows } = budget(stagedRows.length + changeRows.length, model.stashes.length, model.isBranchesOpen ? Math.min(model.branchList.length, model.branchesShown) : undefined, model.isWorktreesOpen ? model.worktrees.length : undefined, model.isHelpOpen ? REFERENCE.length + 1 : 0)
  // History draws a window of what is loaded; Show more widens it, never past the budget.
  const shownCap = Math.max(1, Math.min(model.historyShown, cap))
  const rows = layout(model.commits.slice(0, shownCap))
  const width = Math.max(1, ...rows.map(r => r.width))
  const graphCols = width * 2 - 1
  // Dots and branch stems take their author's colour; the trunk's stems stay neutral.
  const trunk = trunkHashes(model.commits, model.headHash, model.sync.upstream)
  const colors = laneColors(rows, commit => personColor(commit.author, model.you), commit => trunk.has(commit.hash))
  // The terminal draws the lanes as glyphs; every other surface gets real curves. The resolved
  // table carries every constructor whatever the surface, so the surface name is the switch.
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const graph = (lanes: Lanes, rowColors: RowColors, style: DotStyle): RenderElement => {
    const stem = (lane: number) => rowColors.entering[lane] ?? rowColors.down[lane] ?? rowColors.dot
    return Svg !== undefined ? (
      <Svg source={svgRow(lanes, width, stem, { ...style, dot: rowColors.dot, below: rowColors.below })} alt="commit graph" width={width * LANE_W} height={ROW_H} />
    ) : (
      <Box flexDirection="row">{spans(table, glyphs(lanes, width), lane => (lane === lanes.lane ? rowColors.dot : stem(lane)))}</Box>
    )
  }
  // A count as a pill on the desktop, coloured text on the terminal.
  const countPill = (label: string, bg: string, fg: string, alt: string, title: string): RenderElement =>
    Svg !== undefined ? <Svg source={svgCount(label, bg, fg, title)} alt={alt} width={countWidth(label)} height={COUNT_H} /> : <Text color={fg} bold>{label}</Text>

  // The engine refuses a placeholder child (false, null, an empty array), so every optional
  // element is pushed into a list and the list is the only conditional thing in the tree.
  // The header shortens only as far as it must to fit (fit.ts): first the count pills, then the buttons to their glyphs.
  const clashFiles = new Set(Object.values(model.clashes).flat()).size
  const pillLabels: { full: string; short: string }[] = []
  if (model.sync.ahead > 0) pillLabels.push({ full: `${model.sync.ahead} Ahead`, short: `↑${model.sync.ahead}` })
  if (model.sync.behind > 0) pillLabels.push({ full: `${model.sync.behind} Behind`, short: `↓${model.sync.behind}` })
  if (clashFiles > 0) pillLabels.push({ full: `⚠ ${clashFiles} ${clashFiles === 1 ? 'Clash' : 'Clashes'}`, short: `⚠${clashFiles}` })
  if (model.files.length > 0) pillLabels.push({ full: `${model.files.length} Changed`, short: `${model.files.length}` })
  // This pane runs in a linked worktree, not the repo's own folder: a pill beside the branch name says so.
  const isLinked = model.worktrees.some(tree => tree.isHere && !tree.isMain)
  if (isLinked) pillLabels.push({ full: `${GLYPH.worktree} Worktree`, short: GLYPH.worktree })
  // The Worktrees card's button beside the branch name, only when the repo has more than one checkout; measured with
  // the left group as one more pill.
  const hasWorktrees = model.worktrees.length > 1
  if (hasWorktrees) pillLabels.unshift({ full: TREE_GLYPH, short: TREE_GLYPH })
  const showDraft = model.pr === null && (model.aheadOfBase > 0 || model.isSummarizing)
  const buttonLabels = [
    ...(model.undo !== null ? [UNDO_LABEL] : []),
    `${GLYPH.fetch} Fetch`,
    `${GLYPH.pull} Pull`,
    `${GLYPH.push} Push`,
    ...(showDraft ? ['≡ Draft PR'] : []),
    'ⓘ',
    '↻',
  ]
  // The branch you are on is the button that opens the Branches card, where every branch is switched, renamed or deleted.
  // It shows with a capital first letter (a display choice: git's name is unchanged), and when even the shortest header
  // is too wide the name is what gives way, clipped to the room left.
  const shownName = capitalize(clip(model.head || 'detached', BRANCH_CHARS))
  const stage = headerStage(columns, shownName, pillLabels, buttonLabels, label => glyphOnly(label, true))
  const isShortPills = stage >= 1
  const isCompact = stage >= 2
  // The name alone; when even the shortest header leaves it too little room, the triangle stands in for it.
  const branchLabel = isCompact && !fitsBranchName(columns, shownName, pillLabels.map(pill => pill.short), buttonLabels.map(label => glyphOnly(label, true))) ? BRANCH_GLYPH : shownName
  // The icon and the branch button are one chip: no whole-cell gap between them, and the chip lights as one on hover.
  // Only the button takes the click (an Svg is never pressable on this desktop, 2026-10-05).
  const titleBits: RenderElement[] = [
    <Box key="branch-chip" flexDirection="row" alignItems="center" hover={{ backgroundColor: HOVER }}>
      {Svg !== undefined ? <Svg source={svgIcon('branch', BRANCH_ICON)} alt="branch" width={ICON} height={ICON} /> : <Text>⎇</Text>}
      <Button plain key="branches" onPress={() => act.toggleBranches()}>
        {branchLabel}
      </Button>
    </Box>,
  ]
  // Right after the branch name with no whole-cell gap: only the two buttons' own padding between them.
  if (hasWorktrees)
    titleBits[0] = (
      <Box key="branch-group" flexDirection="row" alignItems="center">
        {titleBits[0]!}
        <Button plain key="worktrees" dimColor onPress={() => act.toggleWorktrees()}>
          {TREE_GLYPH}
        </Button>
      </Box>
    )
  if (isLinked) {
    const here = model.worktrees.find(tree => tree.isHere)!
    titleBits.push(countPill(isShortPills ? GLYPH.worktree : `${GLYPH.worktree} Worktree`, PURPLE_BG, PURPLE, 'worktree', `This pane runs in the worktree ${here.folder}`))
  }
  const upstream = model.sync.upstream ?? 'origin'
  if (model.sync.ahead > 0) titleBits.push(countPill(isShortPills ? `↑${model.sync.ahead}` : `${model.sync.ahead} Ahead`, '#2a2f37', DIM, `ahead ${model.sync.ahead}`, `${model.sync.ahead} ahead of ${upstream}: push sends ${model.sync.ahead === 1 ? 'it' : 'them'}`))
  if (model.sync.behind > 0) titleBits.push(countPill(isShortPills ? `↓${model.sync.behind}` : `${model.sync.behind} Behind`, '#2a2f37', DIM, `behind ${model.sync.behind}`, `${model.sync.behind} behind ${upstream}: pull brings ${model.sync.behind === 1 ? 'it' : 'them'} in`))
  // How many of the person's changed files an incoming commit also touches.
  if (clashFiles > 0) titleBits.push(countPill(isShortPills ? `⚠${clashFiles}` : `⚠ ${clashFiles} ${clashFiles === 1 ? 'Clash' : 'Clashes'}`, 'rgba(249,115,22,0.2)', ORANGE, `${clashFiles} clashing`, `${clashFiles} of your changed ${clashFiles === 1 ? 'file is' : 'files are'} also changed by commits you have not pulled`))
  if (model.files.length > 0) titleBits.push(countPill(isShortPills ? `${model.files.length}` : `${model.files.length} Changed`, 'rgba(249,115,22,0.2)', ORANGE, `${model.files.length} uncommitted`, `${model.files.length} uncommitted ${model.files.length === 1 ? 'change' : 'changes'}`))
  // One sync command at a time: the running one shows as a verb, the other two wait as plain text.
  const BUSY: Record<SyncKind, string> = { fetch: 'Fetching…', pull: 'Pulling…', push: 'Pushing…' }
  const controls: RenderElement[] = []
  if (model.undo !== null)
    controls.push(
      <Button plain key="undo" dimColor onPress={() => act.undo()}>
        {isCompact ? UNDO_COMPACT : UNDO_LABEL}
      </Button>,
    )
  const LABEL: Record<SyncKind, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push' }
  for (const kind of ['fetch', 'pull', 'push'] as const) {
    const control =
      model.sync.busy === kind ? (
        <Text dimColor>{isCompact ? `${GLYPH[kind]}…` : `${GLYPH[kind]} ${BUSY[kind]}`}</Text>
      ) : model.sync.busy !== null ? (
        <Text dimColor>{glyphOnly(`${GLYPH[kind]} ${LABEL[kind]}`, isCompact)}</Text>
      ) : (
        <Button plain key={kind} dimColor onPress={() => act.sync(kind)}>
          {glyphOnly(`${GLYPH[kind]} ${LABEL[kind]}`, isCompact)}
        </Button>
      )
    controls.push(control)
  }
  // ≡ Draft PR has a model draft a pull request title and description for this branch; drafting, it is a word. Only a
  // branch with commits its base lacks and no open PR can lead to one, so anywhere else (the base itself, a detached
  // HEAD, a branch level with main) there is nothing to offer.
  if (showDraft)
    controls.push(
      model.isSummarizing ? (
        <Text dimColor>{isCompact ? '≡…' : 'Drafting…'}</Text>
      ) : (
        <Button plain key="summarize" dimColor onPress={() => act.summarize()}>
          {glyphOnly('≡ Draft PR', isCompact)}
        </Button>
      ),
    )
  controls.push(
    <Button plain key="help" dimColor onPress={() => act.toggleHelp()}>
      ⓘ
    </Button>,
    <Button plain key="refresh" dimColor onPress={() => act.refresh()}>
      ↻
    </Button>,
  )
  const header = (
    <Box key="header" flexDirection="column" marginX={1} marginTop={1} borderStyle="round" borderColor={RULE} backgroundColor={CARD_BG}>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" alignItems="center" gap={1}>
          {titleBits}
        </Box>
        <Box flexDirection="row" alignItems="center">
          {spaced(Text, controls)}
        </Box>
      </Box>
    </Box>
  )
  const helpPanel: RenderElement[] = model.isHelpOpen ? [helpBox(table, surface, act, model.helpSection, model.isAutoFetch)] : []
  if (model.isWorktreesOpen) helpPanel.push(drawWorktrees(table, surface, model, act, columns, worktreeRows))
  if (model.isBranchesOpen) helpPanel.push(drawBranches(table, surface, model, act, branchRows, columns))
  if (model.sync.note !== null)
    helpPanel.unshift(
      <Box paddingX={1}>
        <Text color={model.sync.note.includes('failed') ? RED : '#9ca3af'}>{model.sync.note}</Text>
      </Box>,
    )

  if (model.error !== null) {
    return (
      <Box flexDirection="column">
        {header}
        {helpPanel}
        <Box paddingX={1}>
          <Text color="#ef4444">{model.error}</Text>
        </Box>
      </Box>
    )
  }

  const body: RenderElement[] = []
  // A row's ref chips: a branch another worktree holds turns purple with a house, and a detached worktree's commit gets
  // a chip naming its folder, so what is checked out elsewhere shows in the graph.
  const detachedAt = new Map(model.worktrees.filter(tree => tree.branch === null && !tree.isHere && tree.head.length > 0).map(tree => [tree.head, tree] as const))
  const chipsOf = (commit: Commit, isNarrow: boolean): Chip[] => {
    const chips = (isNarrow ? refChips(commit.refs, 1, 12) : refChips(commit.refs)).map(chip => (chip.kind === 'local' && heldBy(model.worktrees, chip.title) !== null ? { ...chip, isElsewhere: true } : chip))
    const tree = detachedAt.get(commit.hash)
    return tree === undefined ? chips : [...chips, { kind: 'local', label: clip(tree.folder, isNarrow ? 12 : 18), title: `Detached checkout in ${tree.path}`, isRemote: false, isElsewhere: true }]
  }
  const incomingSet = new Set(model.incoming)
  // When the pane is too narrow for the author beside each age, every row drops its author, so the ages stay in the
  // card and in one column (fit.ts).
  const showAuthor =
    Svg === undefined ||
    historyAuthorFits(
      columns,
      width * LANE_W,
      rows.map(({ commit }) => ({
        pills: chipsOf(commit, columns < NARROW).map(chip => pillWidth(chip)),
        meta: `${commit.author} · ${ago(commit.date)}`,
      })),
    )
  let isBandDrawn = false
  for (let index = 0; model.historyView === 'graph' && index < rows.length; index++) {
    const row = rows[index]!
    const rowColors = colors[index]!
    const { commit } = row
    const isIncoming = incomingSet.has(commit.hash)
    const clash = model.clashes[commit.hash]
    const isPicked = commit.hash === model.selected
    const isNarrow = columns < NARROW
    const chips = chipsOf(commit, isNarrow)
    const isHead = commit.refs.some(ref => ref === 'HEAD' || ref.startsWith('HEAD -> '))
    const who = initials(commit.author)
    const meta = showAuthor ? `${commit.author} · ${ago(commit.date)}` : ago(commit.date)
    // The open pull request's number marks the commit HEAD is on.
    const clashText: RenderElement[] = clash === undefined ? [] : [<Text color={ORANGE}>{clashLabel(clash)}</Text>]
    const prPill: RenderElement[] = isHead && model.pr !== null ? [countPill(badgeLabel({ number: model.pr.number, isDraft: false, checks: model.pr.checks }), PILL, '#ffffff', `pull request ${model.pr.number}`, model.pr.title)] : []
    // An open PR's branch tip carries its number and checks; the commit HEAD is on already has its own pill from the PR card.
    const badge = isHead && model.pr !== null ? null : badgeFor(commit.refs, model.openPrs)
    const badgePill: RenderElement[] = badge === null ? [] : [countPill(badgeLabel(badge), badge.isDraft ? '#2a2f37' : PILL, badge.isDraft ? DIM : '#ffffff', `pull request ${badge.number}`, `pull request ${badge.number}${badge.isDraft ? ' (draft)' : ''}`)]
    // The desktop truncates a Button's label itself; the terminal does not, so there the subject is
    // clipped to the cells left after the avatar, the meta and the chips.
    const room = surface === 'terminal' ? columns - graphCols - who.length - meta.length - chips.reduce((n, c) => n + c.label.length + 4, 0) - 8 : Infinity
    if (isIncoming && !isBandDrawn) {
      isBandDrawn = true
      body.push(drawIncomingBand(table, model.incoming.length, model.sync.busy !== null, () => act.sync('pull')))
    }
    body.push(
      <Box key={commit.hash} flexDirection="row" alignItems="center" gap={1} hover={{ backgroundColor: HOVER }} {...(isIncoming ? { backgroundColor: INCOMING_BG } : {})}>
        <Box flexShrink={0}>{graph(row, rowColors, { isHead, isIncoming, ...(clash === undefined ? {} : { ring: ORANGE }) })}</Box>
        {Svg !== undefined ? <Svg source={svgAvatar(who, `${commit.author} · ${commit.when}`, rowColors.dot)} alt={`avatar ${who}`} width={AVATAR} height={AVATAR} /> : <Text color={rowColors.dot}>{who}</Text>}
        {/* Subject and meta share one shrinkable box: the subject gives way first, the meta stays
            on one line, and a crowded row clips here rather than pushing the chips off the edge. */}
        <Box flexDirection="row" alignItems="center" flexGrow={1} flexShrink={1} overflow="hidden">
          <Button plain key={`c:${commit.hash}`} dimColor={!isPicked && model.selected !== null} onPress={() => act.pick(commit.hash)}>
            {clip(commit.subject, Math.max(room, 24))}
          </Button>
        </Box>
        {/* The pills first, then the author and age at the right edge, so the meta lines up in a column. */}
        <Box flexDirection="row" alignItems="center" flexShrink={0} gap={1}>
          {chips.map(chip => pill(table, Svg, chip))}
          {prPill}
          {badgePill}
          {clashText}
          <Text dimColor>{meta}</Text>
        </Box>
      </Box>,
    )
    if (isPicked) body.push(drawDetails(table, surface, commit, model.detail, model, act, toggles, columns))
  }
  // A selection the Main line does not draw as a plain row (a merge, a side-branch commit) dims nothing and opens nothing.
  const mainSelected = model.mainRows.some(row => row.merge === null && row.commit.hash === model.selected) ? model.selected : null
  if (model.historyView === 'main')
    body.push(
      ...drawMainRows(
        table,
        surface,
        { rows: model.mainRows.slice(0, shownCap), open: model.openMerge, selected: mainSelected, incoming: model.incoming, clashes: model.clashes, you: model.you, columns, isBusy: model.sync.busy !== null },
        { pick: act.pick, toggleMerge: act.toggleMerge, pull: () => act.sync('pull') },
        commit => [drawDetails(table, surface, commit, model.detail, model, act, toggles, columns)],
      ),
    )
  // The band is drawn above the first incoming row; when none is among the rows (past the commit cap) it still tops History.
  if (model.historyView === 'graph' && !isBandDrawn && model.incoming.length > 0) body.unshift(drawIncomingBand(table, model.incoming.length, model.sync.busy !== null, () => act.sync('pull')))
  // Past the window: one row to widen it, or a note when nothing more can be drawn.
  const total = Math.min(model.historyView === 'main' ? model.mainRows.length : model.commits.length, cap)
  const left = total - shownCap
  // The rule, then a few pixels so the row sits midway between it and the card's bottom edge (measured live 2026-10-09).
  const moreRule: RenderElement[] =
    Svg !== undefined && (left > 0 || total > HISTORY_STEP)
      ? [<Svg key="history-more-rule" source={svgRule(RULE)} alt="rule" height={RULE_H} />, <Svg key="history-more-air" source={svgSpace(MORE_AIR)} alt="space" height={MORE_AIR} />]
      : []
  if (left > 0)
    body.push(
      ...moreRule,
      <Box key="history-more-row" flexDirection="row" justifyContent="space-between" alignItems="center">
        <Button plain key="history-more" onPress={() => act.showMoreHistory()}>
          {`+ Show ${Math.min(HISTORY_STEP, left)} More`}
        </Button>
        <Text dimColor>{`${left} Older`}</Text>
      </Box>,
    )
  else if (total >= Math.min(cap, HISTORY_LOADED) && total > HISTORY_STEP)
    body.push(
      ...moreRule,
      <Box>
        <Text dimColor>{`Showing all ${total} · the pane loads no older commits`}</Text>
      </Box>,
    )
  if (body.length === 0)
    body.push(
      <Box>
        <Text dimColor>{model.historyView === 'main' && model.commits.length > 0 ? 'The main line loads on the next refresh.' : 'No commits yet.'}</Text>
      </Box>,
    )

  const children: RenderElement[] = [header, ...helpPanel]
  if (model.pr !== null) children.push(drawPrCard(table, surface, model.pr, { isBusy: model.isPrBusy, isMerging: model.isMerging, note: model.prNote }, act))
  else if (model.summary !== null)
    children.push(drawSummary(table, surface, model.summary, { rev: model.summaryRev, caret: model.summaryCaret, note: model.prNote, isBusy: model.isPrBusy, canCreate: model.hasGh === true, isGhMissing: model.hasGh === false }, act))
  children.push(drawChanges(table, surface, { head: model.head, files: model.files, ticked: model.ticked, message: model.message, editRev: model.editRev, editCaret: model.editCaret, editorBlur: model.editorBlur ?? 0, openFiles: model.openFiles, confirmDiscard: model.confirmDiscard, note: model.changesNote, isWriting: model.isWriting, isCompact: !cardHeaderFits(columns, 'Changes', model.files.length > 0 ? `${model.files.length}` : null, [`${GLYPH.selectAll} All`, `${GLYPH.stage} Stage`, `${GLYPH.stash} Stash`]) }, act))
  if (model.stashes.length > 0)
    children.push(drawStashes(table, surface, { stashes: model.stashes, confirmDrop: model.confirmDrop }, { apply: act.stashApply, pop: act.stashPop, askDrop: act.askDrop, drop: act.stashDrop }))
  // Other people's branches and PRs: only with a signed-in gh and someone to list.
  if (model.hasGh === true && model.teammates.length > 0)
    children.push(drawTeammates(table, surface, { items: model.teammates, open: model.openTeammate, you: model.you, head: model.head, remote: model.remote, columns, now: Math.floor(Date.now() / 1000) }, { toggle: act.toggleTeammate, checkout: act.checkoutTeammate, refresh: act.refreshTeammates }))
  const viewChip = (
    <Button plain key="history-view" dimColor onPress={() => act.toggleView()}>
      {model.historyView === 'main' ? 'Full Graph' : 'Main Line'}
    </Button>
  )
  children.push(drawSection(table, surface, { title: 'History', actions: [viewChip], body }))
  return (
    <Box flexDirection="column" paddingBottom={2}>
      {children.slice(0, Math.max(1, cut))}
    </Box>
  )
}

/** The graph cells as runs of one colour: fewer elements than one Text per cell. */
function spans({ Text }: ElementTable, cells: ReturnType<typeof glyphs>, color: (lane: number) => string): RenderElement[] {
  const out: RenderElement[] = []
  let text = ''
  let lane: number | null = null
  const flush = () => {
    if (text.length === 0) return
    out.push(lane === null ? <Text>{text}</Text> : <Text color={color(lane)}>{text}</Text>)
    text = ''
  }
  for (const cell of cells) {
    const owner = cell.text === ' ' ? null : cell.lane
    if (owner !== lane) {
      flush()
      lane = owner
    }
    text += cell.text
  }
  flush()
  return out
}

/** What each control does, as the info button shows it, grouped as the panel's sections. Every action asks before git runs. */
export type Reference = { title: string; entries: readonly { name: string; what: string; toggle?: true }[] }
/**
 * The ⓘ panel: one entry per control or mark, named exactly as it is drawn (from the same constants), saying what it does
 * and when to use it, and a last section defining the git words the others use. One section opens at a time.
 */
export const REFERENCE: readonly Reference[] = [
  { title: 'Settings', entries: [
    { name: 'Auto-Fetch', toggle: true, what: 'Checks origin for new commits every 5 minutes while the pane is open, so incoming work shows up without pressing Fetch. Toasts only when something new arrives.' },
  ] },
  { title: 'Header', entries: [
    { name: `Branch Name · ${BRANCH_GLYPH}`, what: `The branch you are on; press it to open the Branches card. ${BRANCH_GLYPH} stands in for the name when the pane is too narrow to show it.` },
    { name: TREE_GLYPH, what: 'Opens the Worktrees card. Only shown when the repo has more than one worktree.' },
    { name: `${GLYPH.worktree} Worktree`, what: "A pill: this pane is running in a worktree, not in the repo's main folder." },
    { name: 'Ahead · ↑', what: 'Commits on your branch that origin does not have yet. Push sends them.' },
    { name: 'Behind · ↓', what: 'Commits on origin that your branch does not have yet. Pull brings them in.' },
    { name: '⚠ Clashes', what: 'How many of your changed files are also changed by commits you have not pulled. Expect a conflict; commit or stash before pulling.' },
    { name: `${GLYPH.fetch} Fetch`, what: "Downloads what is new on origin without touching your files. Use it to see what's incoming before you pull." },
    { name: `${GLYPH.pull} Pull`, what: "Brings origin's new commits into your branch. Stops instead of merging when both sides have new commits." },
    { name: `${GLYPH.push} Push`, what: 'Sends your commits to origin. The first push of a new branch also creates it there.' },
    { name: UNDO_LABEL, what: 'Reverses the last thing you did in the pane: a commit, reset, merge, stash, tag or branch delete. Gone after a push.' },
    { name: '≡ Draft PR', what: "Claude writes a pull request title and description from this branch's commits. Shown only when the branch has commits main lacks and no open PR." },
    { name: '↻', what: 'Re-reads the repository now. The pane also refreshes every 15 seconds and after each git command.' },
  ] },
  { title: 'Branches Card', entries: [
    { name: '◎ Current', what: 'The branch you are on.' },
    { name: 'Merged', what: 'All its commits are already in your branch, so deleting it loses nothing.' },
    { name: 'Not Merged', what: 'It has commits your branch lacks. Deleting it asks a second time.' },
    { name: 'Remote Gone', what: 'Its copy on origin was deleted, usually after its pull request merged. Safe to delete if it is also Merged.' },
    { name: 'Cloud', what: 'Origin has this branch too.' },
    { name: '✎ Rename', what: 'Renames the branch you are on. Spaces in the name become hyphens.' },
    { name: '⟁ Switch', what: 'Checks out that branch. git refuses if your uncommitted changes would be overwritten.' },
    { name: LABELS['delete-branch'], what: `Deletes the branch after a confirm. ${UNDO_LABEL} brings it back.` },
    { name: `${GLYPH.worktree} Session · ${GLYPH.worktree} Worktree`, what: 'The branch is checked out in another worktree (Session: one a Claude session made), so it cannot be switched to or deleted here.' },
    { name: '⎋ Open', what: 'Shows the worktree holding that branch in Finder.' },
    { name: '⧉ Copy Path', what: "Copies that worktree's folder path." },
  ] },
  { title: 'Worktrees Card', entries: [
    { name: '◎ This Pane', what: 'The worktree this pane runs in.' },
    { name: 'Main Checkout', what: "The repo's own folder." },
    { name: 'Claude Session', what: 'A worktree a Claude Code session made to work in.' },
    { name: 'Detached', what: 'That worktree is on a commit, not a branch.' },
    { name: 'Folder Gone', what: "Its folder was deleted, but git still holds the record and the branch." },
    { name: '⎋ Open', what: 'Shows the folder in Finder.' },
    { name: '⧉ Copy Path', what: "Copies the folder's path." },
    { name: '✕ Remove', what: 'Deletes the worktree folder after a confirm; its branch stays. git refuses if it has uncommitted changes.' },
    { name: '⌫ Prune', what: 'Clears the records of worktrees whose folders are gone, which frees their branches.' },
  ] },
  { title: 'Changes', entries: [
    { name: 'Checkbox', what: 'Selects a file; nothing runs when you tick it. Commit, Stage and Stash act on the ticked files.' },
    { name: `${GLYPH.selectAll} All · ${GLYPH.selectNone} None`, what: 'Ticks every file, or clears every tick.' },
    { name: `${GLYPH.stage} Stage`, what: 'Stages the ticked files: marks them to go into the next commit.' },
    { name: '− · Unstage All', what: 'Takes a staged file, or all of them, back out of the next commit. The files are untouched.' },
    { name: `${GLYPH.stash} Stash`, what: 'Shelves the changes in the ticked files (all files when none are ticked) and clears them from your folder. Use it to switch tasks without committing.' },
    { name: '✕ Discard', what: "Throws away that file's changes after a confirm. A new file is deleted. Cannot be undone." },
    { name: '✎ Write', what: 'Claude writes a commit message from the ticked changes. Never replaces one you typed.' },
    { name: 'Commit', what: 'Commits the ticked files with your message. Dim until there is a message and a ticked file.' },
  ] },
  { title: 'Stashes', entries: [
    { name: 'Apply', what: 'Puts the stashed changes back and keeps the stash.' },
    { name: 'Pop', what: 'Puts the stashed changes back and deletes the stash.' },
    { name: 'Drop', what: 'Deletes the stash after a confirm, without applying it.' },
  ] },
  { title: 'History', entries: [
    { name: 'Commit Row', what: "Press it to open the commit's card. The dot and avatar are in the author's colour; blue is you." },
    { name: 'Branch Chips', what: 'The branches and tags on that commit. Blue is a branch (a cloud when origin has it), purple a branch checked out in another worktree, brown a tag. A grey +2 means two more that did not fit; open the commit to see them all.' },
    { name: 'Incoming', what: 'Commits on origin you have not pulled, dashed on a blue band with ↓ Pull. Fetch first to see new ones.' },
    { name: 'Orange Ring', what: 'An incoming commit that changes a file you have also changed.' },
    { name: 'Main Line', what: 'Shows one row per merged pull request instead of every commit; press a row for the commits it brought in.' },
    { name: 'Full Graph', what: 'Goes back to every commit.' },
  ] },
  { title: 'Commit Card', entries: [
    { name: '⧉ Hash', what: "Copies the commit's full hash." },
    { name: '↗ GitHub', what: 'Opens the commit on GitHub.' },
    { name: '▸ More', what: 'Shows the whole commit message.' },
    { name: '▸ N Files', what: 'Lists the files it changed; press one for its diff.' },
    { name: LABELS.checkout, what: 'Puts your folder on this commit (detached HEAD) to look around or test. Switch to a branch to go back.' },
    { name: LABELS.branch, what: 'Creates a branch at this commit and switches to it. Spaces in the name become hyphens.' },
    { name: LABELS.tag, what: 'Gives this commit a name, such as a release number. Spaces in the name become hyphens.' },
    { name: LABELS.revert, what: 'Adds a new commit that undoes this one. The safe undo on a branch others have pulled.' },
    { name: LABELS['cherry-pick'], what: 'Copies just this commit onto your branch.' },
    { name: LABELS.merge, what: 'Brings this commit and everything before it into your branch.' },
    { name: LABELS.rebase, what: 'Replays your commits on top of this one. Rewrites them, so avoid it on a branch you have pushed.' },
    { name: LABELS.reset, what: 'Moves your branch back to this commit; the changes since stay staged. Rewrites history.' },
    { name: `${LABELS['delete-branch']} (Branch)`, what: 'Deletes a merged branch that sits on this commit.' },
  ] },
  { title: 'Teammates and PRs', entries: [
    { name: 'Teammates', what: "Other people's open pull requests and recent branches. Press a row for its commits and files. Needs gh signed in." },
    { name: 'Check Out', what: "Switches to that teammate's branch." },
    { name: 'Open On GitHub', what: 'Opens the pull request or branch on GitHub.' },
    { name: 'Create PR', what: 'Pushes the branch if needed and opens the drafted pull request on GitHub.' },
    { name: 'Merge', what: 'Squash-merges the pull request and deletes its branch, after a confirm. Reads Merge Anyway when checks failed.' },
    { name: 'Close', what: 'Closes the pull request without merging.' },
  ] },
  { title: 'Git Terms', entries: [
    { name: 'Origin', what: 'The shared copy of the repo, usually on GitHub.' },
    { name: 'Upstream', what: "The branch on origin that yours pushes to and pulls from." },
    { name: 'HEAD', what: 'The commit your folder is on now; normally the tip of your branch.' },
    { name: 'Detached HEAD', what: 'Your folder is on a commit, not a branch, so new commits there belong to no branch.' },
    { name: 'Staged', what: 'Changes marked to go into the next commit.' },
    { name: 'Untracked', what: 'A new file git has not been told to keep yet.' },
    { name: 'Stash', what: 'Changes put aside without a commit, to bring back later.' },
    { name: 'Worktree', what: 'An extra folder with its own checkout of the same repo, so two branches can be open at once.' },
    { name: 'Fast-Forward', what: 'A pull that only moves your branch ahead, with nothing to merge.' },
    { name: 'Conflict', what: 'Two changes to the same lines. The pane backs out rather than leave the repo half done.' },
    { name: 'Squash', what: "Combining a pull request's commits into one when it merges." },
    { name: 'Reflog', what: "git's record of where HEAD has been. It can recover a commit lost to a reset, for a while." },
  ] },
]

function helpBox(table: ElementTable, surface: RenderSurface, act: Actions, openSection: string | null, isAutoFetch: boolean): RenderElement {
  const { Box, Text, Button } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  // A hairline after every row; the terminal has none and the rows stand apart on their own.
  const rule = (key: string): RenderElement[] => (Svg !== undefined ? [<Svg key={key} source={svgRule(RULE)} alt="rule" height={RULE_H} />] : [])
  // No `width` on a Box: the live desktop refuses it, like `position` and `minWidth`. No card inside the panel's own: it read as a box in a box.
  const rows: RenderElement[] = []
  for (const section of REFERENCE) {
    const isOpen = section.title === openSection
    rows.push(
      <Button plain key={`help-sec:${section.title}`} onPress={() => act.toggleHelpSection(section.title)}>
        {`${isOpen ? '−' : '+'} ${section.title}`}
      </Button>,
      ...rule(`help-rule:${section.title}`),
    )
    if (!isOpen) continue
    for (const entry of section.entries) {
      rows.push(
        <Box key={`help-entry:${section.title}:${entry.name}`} flexDirection="column" marginLeft={1}>
          {entry.toggle === true ? (
            <Button plain key="autofetch" onPress={() => act.toggleAutoFetch()}>
              {`${isAutoFetch ? GLYPH.selectAll : GLYPH.selectNone} ${entry.name} Every 5 Minutes: ${isAutoFetch ? 'On' : 'Off'}`}
            </Button>
          ) : (
            <Text color={BLUE_TEXT} bold>{entry.name}</Text>
          )}
          <Text dimColor>{entry.what}</Text>
        </Box>,
        ...rule(`help-rule:${section.title}:${entry.name}`),
      )
    }
  }
  // The panel is a section card like Changes and History: the same tint, border and title row, with the close at the right.
  return drawSection(table, surface, {
    title: 'What the controls do',
    actions: [
      <Button plain key="help-close" role="dismiss" onPress={() => act.toggleHelp()}>
        Close
      </Button>,
    ],
    body: rows,
  })
}

export type { EngineInterface }
