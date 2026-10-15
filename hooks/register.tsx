import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, RenderSurface } from 'claude-code'

import type { ActionKind, BranchInfo, ChangedFile, Commit, Detail, HistoryView, MainRow, OpenFile, OpenMerge, OpenTeammate, Pending, PrBadge, PullRequest, Stash, Summary, Sync, SyncKind, Teammate, Undo, Worktree } from '../types'
import { BRANCH_LIST_COMMAND, MERGED_COMMAND, TOPLEVEL_COMMAND, WORKTREE_LIST_COMMAND, parseBranchList, parseBranches, parseLog, parseStashList, parseStatus, parseWorktrees } from './git'
import { dirtyPaths, findClashes, incomingFilesCommand, parseHashes, parseNameOnly } from './incoming'
import { badgesOf, branchesCommand, commitsCommand, countCommand, filesCommand, isGithubRemote, joinTeammates, mergedListCommand, needsFallback, parseMergedAt, parseNumstat, parsePrList, parseRemoteBranches, parseReviewNumbers, prListCommand, reviewListCommand } from './teammates'
import { FAILURE_NOTE, autoFetchCommand, failureNote, newCommitsNote, nextFailures, shouldAutoFetch } from './autofetch'
import { canonicalName, checkMailmapCommand } from './people'
import { MERGE_COMMITS_SHOWN, buildMainRows, mainLogCommand, needsOlderDiffMerges, parseMainLog, parseMergeAuthors, parseMergeCommits } from './mainline'
import { abortCommand, actionCommand, refName, diffCommand, discardCommands, inverseOf, isUndoValid, rejected, syncCommand } from './actions'
import type { UndoContext, UndoKind } from './actions'
import { commitReadiness, setProbe } from './changes'
import { allPaths, commitCommands, pruneTicked, stageCommand, stashCommand, tickedFiles, toggleAll, toggleTick, unstageCommand } from './selection'
import { BASES, branchPrompt, capDiff, commitPrompt, describeCommands, parseDraft, parseSummary, writeReadiness } from './draft'
import { parseCommitFiles, splitDiff, trimDiff } from './diff'
import { setLook } from './chips'
import type { Look } from './chips'
import { PR_EVERY_MS, PR_FIELDS, branchOf, closeStep, createSteps, hasNoPr, isGhAbsent, mergeStep, parsePr, shouldLookup } from './pr'
import { BRANCH_ROWS, HISTORY_STEP } from './budget'
import { drawPane } from './pane'
import type { Actions, Model } from './pane'

const PANE = 'git-graph'
const TITLE = 'Git Graph'
// Commit rows drawn. The live desktop refuses a drawing with more than about 256 pressable
// elements (222 drew, 274 did not), and every commit row is a Button, so this plus the file
// toggles below (FILE_TOGGLES in pane.tsx) and the few fixed buttons must stay under it.
const LIMIT = 150
// The most a message holds, and the most the editor will post or take from the clipboard.
const MESSAGE_MAX = 10_000
// Unit separator between fields, record separator after each commit: nothing a subject can contain.
// %aN, not %an: the author's name through the repo's .mailmap, so one person under two names is one colour.
const FORMAT = '--format=%H%x1f%P%x1f%D%x1f%aN%x1f%ar%x1f%ad%x1f%s%x1e'
// The hover card's absolute date.
const DATE = '--date=format:%B %-d, %Y at %-I:%M %p'

const commits = atom({ plugin: 'git-graph', key: 'commits' } as const, [] as Commit[])
const head = atom({ plugin: 'git-graph', key: 'head' } as const, '')
const branches = atom({ plugin: 'git-graph', key: 'branches' } as const, [] as string[])
const headHash = atom({ plugin: 'git-graph', key: 'headHash' } as const, '')
const files = atom({ plugin: 'git-graph', key: 'files' } as const, [] as ChangedFile[])
const ticked = atom({ plugin: 'git-graph', key: 'ticked' } as const, [] as string[])
const sync = atom({ plugin: 'git-graph', key: 'sync' } as const, { ahead: 0, behind: 0, upstream: null, busy: null, note: null } as Sync)
const message = atom({ plugin: 'git-graph', key: 'message' } as const, '')
const editRev = atom({ plugin: 'git-graph', key: 'editRev' } as const, 0)
const editCaret = atom({ plugin: 'git-graph', key: 'editCaret' } as const, null as number | null)
const openFiles = atom({ plugin: 'git-graph', key: 'openFiles' } as const, [] as OpenFile[])
const confirmDiscard = atom({ plugin: 'git-graph', key: 'confirmDiscard' } as const, null as string | null)
const changesNote = atom({ plugin: 'git-graph', key: 'changesNote' } as const, null as string | null)
const undo = atom({ plugin: 'git-graph', key: 'undo' } as const, null as Undo | null)
const stashes = atom({ plugin: 'git-graph', key: 'stashes' } as const, [] as Stash[])
const confirmDrop = atom({ plugin: 'git-graph', key: 'confirmDrop' } as const, null as number | null)
const selected = atom({ plugin: 'git-graph', key: 'selected' } as const, null as string | null)
const detail = atom({ plugin: 'git-graph', key: 'detail' } as const, null as Detail | null)
const error = atom({ plugin: 'git-graph', key: 'error' } as const, null as string | null)
const remote = atom({ plugin: 'git-graph', key: 'remote' } as const, '')
// Closed until the person runs /git-graph: a new session does not open the pane on its own.
const isClosed = atom({ plugin: 'git-graph', key: 'isClosed' } as const, true)
const pending = atom({ plugin: 'git-graph', key: 'pending' } as const, null as Pending | null)
const note = atom({ plugin: 'git-graph', key: 'note' } as const, null as string | null)
const isHelpOpen = atom({ plugin: 'git-graph', key: 'isHelpOpen' } as const, false)
const helpSection = atom({ plugin: 'git-graph', key: 'helpSection' } as const, 'Settings' as string | null)
const historyShown = atom({ plugin: 'git-graph', key: 'historyShown' } as const, HISTORY_STEP)
const isWriting = atom({ plugin: 'git-graph', key: 'isWriting' } as const, false)
const isSummarizing = atom({ plugin: 'git-graph', key: 'isSummarizing' } as const, false)
const summary = atom({ plugin: 'git-graph', key: 'summary' } as const, null as Summary | null)
const pr = atom({ plugin: 'git-graph', key: 'pr' } as const, null as PullRequest | null)
const isPrBusy = atom({ plugin: 'git-graph', key: 'isPrBusy' } as const, false)
const isMerging = atom({ plugin: 'git-graph', key: 'isMerging' } as const, false)
const prNote = atom({ plugin: 'git-graph', key: 'prNote' } as const, null as string | null)
const hasGh = atom({ plugin: 'git-graph', key: 'hasGh' } as const, null as boolean | null)
const summaryRev = atom({ plugin: 'git-graph', key: 'summaryRev' } as const, 0)
const summaryCaret = atom({ plugin: 'git-graph', key: 'summaryCaret' } as const, null as number | null)
const you = atom({ plugin: 'git-graph', key: 'you' } as const, '')
const incoming = atom({ plugin: 'git-graph', key: 'incoming' } as const, [] as string[])
const clashes = atom({ plugin: 'git-graph', key: 'clashes' } as const, {} as Record<string, string[]>)
const historyView = atom({ plugin: 'git-graph', key: 'historyView' } as const, 'graph' as HistoryView)
const mainRows = atom({ plugin: 'git-graph', key: 'mainRows' } as const, [] as MainRow[])
const openMerge = atom({ plugin: 'git-graph', key: 'openMerge' } as const, null as OpenMerge | null)
const teammates = atom({ plugin: 'git-graph', key: 'teammates' } as const, [] as Teammate[])
const openTeammate = atom({ plugin: 'git-graph', key: 'openTeammate' } as const, null as OpenTeammate | null)
const openPrs = atom({ plugin: 'git-graph', key: 'openPrs' } as const, {} as Record<string, PrBadge>)
const isAutoFetch = atom({ plugin: 'git-graph', key: 'isAutoFetch' } as const, false)
const isBranchesOpen = atom({ plugin: 'git-graph', key: 'isBranchesOpen' } as const, false)
const branchList = atom({ plugin: 'git-graph', key: 'branchList' } as const, [] as BranchInfo[])
const aheadOfBase = atom({ plugin: 'git-graph', key: 'aheadOfBase' } as const, 0)
const branchesShown = atom({ plugin: 'git-graph', key: 'branchesShown' } as const, BRANCH_ROWS)
const worktrees = atom({ plugin: 'git-graph', key: 'worktrees' } as const, [] as Worktree[])
const isWorktreesOpen = atom({ plugin: 'git-graph', key: 'isWorktreesOpen' } as const, false)
const confirmRemove = atom({ plugin: 'git-graph', key: 'confirmRemove' } as const, null as string | null)
const editorBlur = atom({ plugin: 'git-graph', key: 'editorBlur' } as const, 0)
// The name typed in a confirm line's field, kept out of state on purpose: any state write per keystroke redraws the
// pane, and every redraw made the focused field's focus ring flicker (seen live twice, 2026-10-14). The field draws its
// own keystrokes; this is read when the action runs, and handed to any redraw meanwhile so the field keeps its text.
let typedName = ''
// When the last fetch ran (a press or the timer), and how many timer fetches in a row failed; one tick at a time.
let lastFetchAt = 0
let autoFetchFailures = 0
let isAutoFetching = false
// When the teammates were last asked for: the lookup runs on the PR pace, or at once when forced.
let teammatesAt = 0
// A lookup is running: another press, command or tick waits for it instead of starting a second.
let isTeammatesBusy = false

// The model behind ✎ Write and ≡ Draft PR: small and quick, no tools, one reply.
const DRAFT_MODEL = 'haiku'

// Dev probes: one pane per newer desktop feature, drawn with that feature alone (Look in chips.tsx).
type ProbeName = 'bare' | 'none'
const PROBES: Record<ProbeName, Partial<Look>> = {
  // `bare` draws one line of text instead of the pane: whether any drawing reaches the desktop at all.
  bare: {},
  none: {},
}
const ALL: Partial<Look> = {}
const probeId = (name: ProbeName) => `${PANE}-probe-${name}`

// Dev: keep only the first N children of the pane's root (header, rule, Changes, Stashes, History), to bisect a refused tree.
let cut = Infinity

// What the last render of each pane saw, answered by the reload tool: the quickest sign of a refused
// tree, since the desktop keeps the previous drawing and prints no reason. Module state, reset on reload.
const lastRenders = new Map<string, string>()
// Dev trace: the last few button presses and what each came to, answered by the reload tool (a press that never arrives leaves no line).
const presses: string[] = []
const trace = (text: string): void => {
  presses.push(`${new Date().toISOString().slice(11, 19)} ${text}`)
  if (presses.length > 12) presses.shift()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git-graph', description: 'Open the commit graph pane' })
    // A tool the model calls to reload the mod mid-turn while it is being developed: the engine
    // reloads a watched plugin before a tool it registered runs, so an edit shows without a turn end.
    await $.tool.register({
      name: 'reload',
      description: 'Reload the git-graph mod and refresh its pane; answers the pane state. `select` opens that commit\'s detail, as a click would.',
      inputSchema: {
        type: 'object',
        properties: {
          select: { type: 'string', description: 'A commit hash to select, or empty to clear' },
          reopen: { type: 'boolean', description: 'Close and reopen the pane' },
          start: { type: 'string', description: 'Open the confirm line for this action on the selected commit: checkout, branch, cherry-pick, reset, revert, merge, rebase or tag; empty cancels' },
          input: { type: 'string', description: 'Type this into the name field of the confirm line' },
          confirm: { type: 'boolean', description: 'Press confirm on the open confirm line' },
          help: { type: 'boolean', description: 'Show or hide the reference panel' },
          shown: { type: 'number', description: 'Dev: how many History rows to draw (default 25); Show more adds 25' },
          helpSection: { type: 'string', description: "Open one section of the reference panel by title ('Settings', 'Header', 'Changes', 'History', 'Teammates and PRs'); empty folds them all" },
          level: { type: 'number', description: 'Dev probe: draw only the first N elements of the Changes section' },
          message: { type: 'string', description: 'Set the commit message' },
          editor: { type: 'boolean', description: 'Dev: draw the message as the mod\'s own multi-line editor (true) or the desktop\'s one-line field (false)' },
          tick: { type: 'string', description: 'Press the checkbox of this path (tick or clear it)' },
          tickAll: { type: 'boolean', description: 'Press All / None' },
          stage: { type: 'boolean', description: 'Press Stage: stage what is ticked' },
          unstageAll: { type: 'boolean', description: 'Press Unstage all in the Staged Changes group' },
          diff: { type: 'string', description: 'Press the name of this path (toggle its diff)' },
          commit: { type: 'boolean', description: 'Press Commit' },
          write: { type: 'boolean', description: 'Press ✎ Write: has the model draft the commit message' },
          summarize: { type: 'boolean', description: 'Press ≡ Draft PR: has the model draft a pull request title and description' },
          closeSummary: { type: 'boolean', description: 'Close the summary card' },
          createPr: { type: 'boolean', description: 'Press Create PR on the summary card' },
          askMerge: { type: 'boolean', description: 'Press Merge on the PR card (opens the in-place ask)' },
          mergePr: { type: 'boolean', description: 'Confirm the merge ask' },
          closePr: { type: 'boolean', description: 'Press Close on the PR card' },
          refreshPr: { type: 'boolean', description: 'Press the refresh on the PR card' },
          sync: { type: 'string', description: 'Press fetch, pull or push' },
          undo: { type: 'boolean', description: 'Press undo' },
          stash: { type: 'string', description: 'Press apply, pop or drop on stash@{0}, or push to press the stash button' },
          branch: { type: 'string', description: 'Pick this branch in the header menu (checks it out)' },
          view: { type: 'string', description: 'Set the History view: graph or main' },
          merge: { type: 'string', description: 'Open or close this merge row (a commit hash)' },
          teammates: { type: 'boolean', description: 'Look up other people\'s PRs and branches now' },
          teammate: { type: 'string', description: 'Open or close this teammate branch row' },
          autoFetch: { type: 'boolean', description: 'Switch auto-fetch on or off' },
          autoFetchTick: { type: 'boolean', description: 'Run one auto-fetch tick now, ignoring the five minutes' },
          branches: { type: 'boolean', description: 'Open (true) or close (false) the Branches card' },
          branchAction: { type: 'string', description: 'On the Branches card: rename (the current branch), delete:<name>, or switch:<name>' },
          worktrees: { type: 'boolean', description: 'Open (true) or close (false) the Worktrees card' },
          worktreeAction: { type: 'string', description: 'On the Worktrees card, by folder name: open:<folder>, copy:<folder>, remove:<folder> (asks), confirmRemove, or prune' },
          probe: { type: 'boolean', description: 'Dev: open (true) or close (false) one pane per newer desktop feature, each drawn with that feature alone, to see which the live desktop refuses' },
          cut: { type: 'number', description: 'Dev: draw only the first N sections of the pane (header, rule, Changes, Stashes, History); 0 or absent draws all' },
          dump: { type: 'boolean', description: 'Dev: answer the whole model as JSON instead of the summary' },
          show: { type: 'string', description: 'Dev: close and reopen this pane so it is the front tab: main, bare or none' },
        },
      },
    })
    if ((await $.store.get('historyView')) === 'main') await update($, historyView, () => 'main')
    if ((await $.store.get('autoFetch')) === true) await update($, isAutoFetch, () => true)
    if (!(await read($, isClosed))) void $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    $.clock.every(15_000, () => void refresh($))
    $.clock.every(60_000, () => void refreshPr($))
    $.clock.every(60_000, () => void refreshTeammates($))
    // The quiet fetch: a tick a minute, the five minutes are kept by shouldAutoFetch.
    $.clock.every(60_000, () => void autoFetch($))
    return next(e)
  })

  // The desktop drops its panes when the person switches sessions; it attaches again on the way
  // back, and the pane returns with it if the person had opened it and not closed it since.
  on('session.attach', async ($, e, next) => {
    if (!(await read($, isClosed))) {
      void $.ui.open({ id: PANE, title: TITLE })
      void refresh($)
      void refreshPr($, true)
      void refreshTeammates($, true)
    }
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, isClosed, () => true)
    return next(e)
  })

  on('command.run', { command: 'git-graph' }, async $ => {
    await update($, isClosed, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    // The PR and teammates lookups are throttled: reopening asks for both at once.
    void refreshPr($, true)
    void refreshTeammates($, true)
    return { text: 'Git graph pane opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (typeof e.command === 'string' && /\bgit\b/.test(e.command)) await refresh($)
    if (typeof e.command === 'string' && /\bgh\b/.test(e.command)) await refreshPr($, true)
    // A gh command (a PR opened or merged) or a fetch or pull the agent ran changes what teammates have in flight.
    if (typeof e.command === 'string' && (/\bgh\b/.test(e.command) || /\bgit\s+(fetch|pull)\b/.test(e.command))) void refreshTeammates($, true)
    return ran
  })

  on('tool.call', { tool: 'mcp__git-graph__reload' }, async ($, e) => {
    if (e.reopen === true) {
      await update($, isClosed, () => false)
      await $.ui.close({ id: PANE })
      await $.ui.open({ id: PANE, title: TITLE })
    }
    if (e.dump === true) return { result: JSON.stringify(await readModel($)) }
    if (typeof e.level === 'number') setProbe(e.level)
    if (typeof e.cut === 'number') cut = e.cut > 0 ? e.cut : Infinity
    await refresh($)
    if (typeof e.select === 'string') {
      await Promise.all([update($, selected, () => null), update($, detail, () => null)])
      if (e.select.length > 0) await pick($, e.select)
    }
    if (typeof e.editor === 'boolean') setLook({ editor: e.editor })
    if (typeof e.help === 'boolean') await update($, isHelpOpen, () => e.help === true)
    if (typeof e.shown === 'number') await update($, historyShown, () => Math.max(1, Math.floor(e.shown as number)))
    if (typeof e.helpSection === 'string') await update($, helpSection, () => (e.helpSection === '' ? null : e.helpSection))
    if (typeof e.message === 'string') await setMessage($, e.message)
    if (typeof e.tick === 'string') await tickToggle($, e.tick)
    if (e.stage === true) await stageSelected($)
    if (e.unstageAll === true) await unstageFiles($, null)
    if (e.tickAll === true) await tickAll($)
    if (typeof e.diff === 'string') await toggleDiff($, e.diff)
    if (e.commit === true) await commit($)
    if (e.write === true) await writeMessage($)
    if (e.summarize === true) await summarize($)
    if (e.closeSummary === true) await update($, summary, () => null)
    if (e.createPr === true) await createPr($)
    if (e.askMerge === true) await askMerge($)
    if (e.mergePr === true) await mergePr($)
    if (e.closePr === true) await closePr($)
    if (e.refreshPr === true) await refreshPr($, true)
    if (e.sync === 'fetch' || e.sync === 'pull' || e.sync === 'push') await runSync($, e.sync)
    if (e.undo === true) await runUndo($)
    if (e.stash === 'push') await stashPush($)
    if (e.stash === 'apply' || e.stash === 'pop' || e.stash === 'drop') await stashAction($, e.stash, 0)
    if (typeof e.branch === 'string') await switchBranch($, e.branch)
    if (typeof e.branches === 'boolean' && e.branches !== (await read($, isBranchesOpen))) await toggleBranches($)
    if (typeof e.branchAction === 'string') {
      const [verb = '', name = ''] = e.branchAction.split(':')
      const [list, current] = await Promise.all([read($, branchList), read($, head)])
      const target = list.find(b => b.name === (verb === 'rename' ? current : name))
      if (target !== undefined && verb === 'switch') await switchBranch($, target.name)
      else if (target !== undefined && (verb === 'rename' || verb === 'delete')) await startBranch($, verb === 'rename' ? 'rename-branch' : 'delete-branch', target)
    }
    if (typeof e.worktrees === 'boolean' && e.worktrees !== (await read($, isWorktreesOpen))) await update($, isWorktreesOpen, open => !open)
    if (typeof e.worktreeAction === 'string') {
      const [verb = '', folder = ''] = e.worktreeAction.split(':')
      const tree = (await read($, worktrees)).find(t => t.folder === folder)
      if (verb === 'prune') await pruneWorktrees($)
      else if (verb === 'confirmRemove') {
        const asked = await read($, confirmRemove)
        if (asked !== null) await removeWorktree($, asked)
      } else if (tree !== undefined && verb === 'open') await openWorktree($, tree.path)
      else if (tree !== undefined && verb === 'copy') await $.ui.copy({ text: tree.path, surface: 'desktop' })
      else if (tree !== undefined && verb === 'remove') await update($, confirmRemove, () => tree.path)
    }
    if (e.view === 'graph' || e.view === 'main') {
      if ((await read($, historyView)) !== e.view) await toggleView($)
    }
    if (typeof e.merge === 'string') await toggleMerge($, e.merge)
    if (e.teammates === true) await refreshTeammates($, true)
    if (typeof e.teammate === 'string') await toggleTeammate($, e.teammate)
    if (typeof e.autoFetch === 'boolean' && (await read($, isAutoFetch)) !== e.autoFetch) await toggleAutoFetch($)
    if (e.autoFetchTick === true) {
      lastFetchAt = 0
      await autoFetch($)
    }
    if (typeof e.probe === 'boolean')
      for (const name of Object.keys(PROBES) as ProbeName[]) {
        if (e.probe) await $.ui.open({ id: probeId(name), title: `dev: ${name} only` })
        else await $.ui.close({ id: probeId(name) })
      }
    if (e.show === 'main' || (typeof e.show === 'string' && e.show in PROBES)) {
      const name = e.show as 'main' | ProbeName
      const id = name === 'main' ? PANE : probeId(name)
      await $.ui.close({ id })
      await $.ui.open({ id, title: name === 'main' ? TITLE : `dev: ${name} only`, focus: true })
    }
    if (typeof e.input === 'string') {
      typedName = e.input
      await update($, note, () => null)
    }
    if (e.confirm === true) await runAction($)
    if (typeof e.start === 'string') {
      const picked = await read($, selected)
      const kinds: ActionKind[] = ['checkout', 'branch', 'cherry-pick', 'reset', 'revert', 'merge', 'rebase', 'tag']
      const kind = kinds.find(k => k === e.start)
      await update($, pending, () => (kind !== undefined && picked !== null ? { kind, hash: picked } : null))
    }
    const [list, failed, picked, shown] = await Promise.all([read($, commits), read($, error), read($, selected), read($, detail)])
    const loaded = shown === null ? 'none' : `${shown.hash.slice(0, 7)} (${shown.files.length} files, ${shown.diff.length} diff chars, ${shown.droppedFiles} dropped)`
    return { result: `git-graph reloaded: ${list.length} commits${picked === null ? '' : `, selected ${picked.slice(0, 7)}`}, detail ${loaded}${failed === null ? '' : `, error: ${failed}`}; renders: ${[...lastRenders].map(([id, what]) => `${id}: ${what}`).join('; ') || 'none'}; presses: ${presses.join(' | ') || 'none'}` }
  })

  // The message editor (editor.tsx) posts each edit; the summary's description is a second instance of it.
  on('ui.message', { element: 'message-editor' }, async ($, e, next) => {
    await editorMessage($, e, 'message')
    return next(e)
  })
  on('ui.message', { element: 'summary-editor' }, async ($, e, next) => {
    await editorMessage($, e, 'summary')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    lastRenders.set(PANE, `started surface=${e.surface} cols=${e.props.bodyColumns} placement=${e.props.placement} focused=${String(e.props.isFocused)}`)
    const model = await readModel($)
    lastRenders.set(PANE, `${lastRenders.get(PANE)} -> returned a tree (selected ${model.selected === null ? 'none' : model.selected.slice(0, 7)}, detail ${model.detail === null ? 'none' : model.detail.hash.slice(0, 7)})`)
    return drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, actions($), cut)
  })

  // The probe panes: the same drawing, one feature at a time, so a glance says which the live desktop refuses.
  for (const name of Object.keys(PROBES) as ProbeName[])
    on('ui.render', { component: 'Pane', requestId: probeId(name) }, async ($, e) => {
      const model = await readModel($)
      lastRenders.set(probeId(name), `drew with ${name} only on ${e.surface}`)
      if (name === 'bare') {
        const { Box, Text } = $.ui.resolve(e)
        return (
          <Box>
            <Text>bare probe: one line of text</Text>
          </Box>
        )
      }
      setLook(PROBES[name])
      try {
        return drawPane($.ui.resolve(e), e.surface, model, e.props.bodyColumns, actions($))
      } finally {
        setLook(ALL)
      }
    })
}

/** Every value the drawing reads, as one model. */
async function readModel($: EngineInterface): Promise<Model> {
  const [list, branch, oid, changed, syncing, text, open, discarding, changesWhy, record, stashed, dropping, picked, shown, failed, origin, started, typed, lastNote, helping, helpOpen, names, rev, caretAt, writing, summarizing, drafted, prs, prBusy, merging, prWhy, ghKnown, sRev, sCaret, tickedPaths, youName, coming, clashed, viewName, mainEntries, openedMerge, mates, openedMate, badges, autoOn, shownCount, branchesOpen, branchRows, aheadBase, branchesCount, trees, treesOpen, removing, blurCount] = await Promise.all([
    read($, commits),
    read($, head),
    read($, headHash),
    read($, files),
    read($, sync),
    read($, message),
    read($, openFiles),
    read($, confirmDiscard),
    read($, changesNote),
    read($, undo),
    read($, stashes),
    read($, confirmDrop),
    read($, selected),
    read($, detail),
    read($, error),
    read($, remote),
    read($, pending),
    Promise.resolve(typedName),
    read($, note),
    read($, isHelpOpen),
    read($, helpSection),
    read($, branches),
    read($, editRev),
    read($, editCaret),
    read($, isWriting),
    read($, isSummarizing),
    read($, summary),
    read($, pr),
    read($, isPrBusy),
    read($, isMerging),
    read($, prNote),
    read($, hasGh),
    read($, summaryRev),
    read($, summaryCaret),
    read($, ticked),
    read($, you),
    read($, incoming),
    read($, clashes),
    read($, historyView),
    read($, mainRows),
    read($, openMerge),
    read($, teammates),
    read($, openTeammate),
    read($, openPrs),
    read($, isAutoFetch),
    read($, historyShown),
    read($, isBranchesOpen),
    read($, branchList),
    read($, aheadOfBase),
    read($, branchesShown),
    read($, worktrees),
    read($, isWorktreesOpen),
    read($, confirmRemove),
    read($, editorBlur),
  ])
  return { commits: list, head: branch, branches: names, headHash: oid, files: changed, sync: syncing, message: text, openFiles: open, confirmDiscard: discarding, changesNote: changesWhy, undo: record, stashes: stashed, confirmDrop: dropping, selected: picked, detail: shown, error: failed, remote: origin, pending: started, input: typed, note: lastNote, isHelpOpen: helping, helpSection: helpOpen, editRev: rev, editCaret: caretAt, isWriting: writing, isSummarizing: summarizing, summary: drafted, pr: prs, isPrBusy: prBusy, isMerging: merging, prNote: prWhy, hasGh: ghKnown, summaryRev: sRev, summaryCaret: sCaret, ticked: tickedPaths, you: youName, incoming: coming, clashes: clashed, historyView: viewName, mainRows: mainEntries, openMerge: openedMerge, teammates: mates, openTeammate: openedMate, openPrs: badges, isAutoFetch: autoOn, historyShown: shownCount, isBranchesOpen: branchesOpen, branchList: branchRows, aheadOfBase: aheadBase, branchesShown: branchesCount, worktrees: trees, isWorktreesOpen: treesOpen, confirmRemove: removing, editorBlur: blurCount }
}

// The handlers an Input calls on each keystroke: they never count as pressing something else.
const TYPING = new Set(['setMessage', 'setInput', 'setSummaryTitle'])

/**
 * What the drawing's controls do, each bound to this engine. Every one also tells the message box that something else
 * was pressed, so it drops its blinking caret: the box gets no focus event of its own.
 */
function actions($: EngineInterface): Actions {
  const bound = boundActions($)
  const blurred = {} as Record<string, unknown>
  for (const [name, fn] of Object.entries(bound))
    blurred[name] = (...args: unknown[]) => {
      // Not for typing into a field: a state write per keystroke redraws the pane, and a redraw made the focused
      // field's focus ring flicker on every key (seen live, 2026-10-14).
      if (!TYPING.has(name)) void update($, editorBlur, count => count + 1)
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  return blurred as Actions
}

function boundActions($: EngineInterface): Actions {
  return {
    refresh: () => void refresh($),
    pick: (hash: string) => void pick($, hash),
    close: () => void Promise.all([update($, selected, () => null), update($, detail, () => null)]),
    copy: (hash: string, surface: RenderSurface) => copy($, hash, surface),
    toggleFile: (path: string) =>
      void update($, detail, current =>
        current === null ? null : { ...current, open: current.open.includes(path) ? current.open.filter(p => p !== path) : [...current.open, path] },
      ),
    showFiles: () => void update($, detail, current => (current === null ? null : { ...current, showFiles: !current.showFiles })),
    toggleBody: () => void update($, detail, current => (current === null ? null : { ...current, showBody: current.showBody !== true })),
    start: (kind: ActionKind, hash: string, target?: string) => {
      typedName = ''
      void Promise.all([update($, pending, () => ({ kind, hash, target })), update($, note, () => null)])
    },
    confirm: () => void runAction($),
    cancel: () => {
      typedName = ''
      void Promise.all([update($, pending, () => null), update($, note, () => null)])
    },
    // Typing clears the last confirm's complaint: it was about the name before this one.
    setInput: (text: string) => void setName($, text),
    toggleHelp: () => void update($, isHelpOpen, open => !open),
    toggleHelpSection: (title: string) => void update($, helpSection, open => (open === title ? null : title)),
    sync: (kind: SyncKind) => void runSync($, kind),
    undo: () => void runUndo($),
    stashApply: (index: number) => void stashAction($, 'apply', index),
    stashPop: (index: number) => void stashAction($, 'pop', index),
    askDrop: (index: number | null) => void update($, confirmDrop, () => index),
    stashDrop: (index: number) => void stashAction($, 'drop', index),
    switchBranch: (name: string) => void switchBranch($, name),
    toggleView: () => void toggleView($),
    showMoreHistory: () => void update($, historyShown, count => count + HISTORY_STEP),
    toggleMerge: (hash: string) => void toggleMerge($, hash),
    toggleTeammate: (branch: string) => void toggleTeammate($, branch),
    checkoutTeammate: (branch: string) => void checkoutTeammate($, branch),
    refreshTeammates: () => void refreshTeammates($, true),
    toggleAutoFetch: () => void toggleAutoFetch($),
    toggleBranches: () => void toggleBranches($),
    showMoreBranches: () => void update($, branchesShown, current => current + BRANCH_ROWS),
    startBranch: (kind: 'rename-branch' | 'delete-branch', branch: BranchInfo) => void startBranch($, kind, branch),
    toggleWorktrees: () => void Promise.all([update($, isWorktreesOpen, open => !open), update($, confirmRemove, () => null)]),
    openWorktree: (path: string) => void openWorktree($, path),
    copyPath: (path: string, surface: RenderSurface) => {
      void $.ui.copy({ text: path, surface })
      $.ui.toast(`Copied ${path}`)
    },
    askRemove: (path: string | null) => void update($, confirmRemove, () => path),
    removeWorktree: (path: string) => void removeWorktree($, path),
    pruneWorktrees: () => void pruneWorktrees($),
    setMessage: (text: string) => void update($, message, () => text),
    commit: () => void commit($),
    write: () => void writeMessage($),
    summarize: () => void summarize($),
    closeSummary: () => void update($, summary, () => null),
    copySummary: (surface: RenderSurface) => void copySummary($, surface),
    createPr: () => void createPr($),
    setSummaryTitle: (text: string) => void update($, summary, current => (current === null ? null : { ...current, title: text })),
    askMerge: () => void askMerge($),
    cancelMerge: () => void update($, isMerging, () => false),
    mergePr: () => void mergePr($),
    closePr: () => void closePr($),
    refreshPr: () => void refreshPr($, true),
    toggleAll: () => void tickAll($),
    stageTicked: () => void stageSelected($),
    unstage: (path: string | null) => void unstageFiles($, path),
    stash: () => void stashPush($),
    toggleTick: (path: string) => void tickToggle($, path),
    toggleDiff: (path: string) => void toggleDiff($, path),
    askDiscard: (path: string | null) => void update($, confirmDiscard, () => path),
    discard: (path: string) => void discard($, path),
  }
}

function copy($: EngineInterface, hash: string, surface: RenderSurface): void {
  void $.ui.copy({ text: hash, surface })
  $.ui.toast(`Copied ${hash.slice(0, 7)}`)
}

async function refresh($: EngineInterface): Promise<void> {
  // A closed pane is not drawn, so nothing is read for it; reopening refreshes everything.
  if (await read($, isClosed)) return
  try {
    const log = await $.process.run(['git', 'log', '--exclude=refs/stash', '--all', '--topo-order', '--shortstat', '-n', String(LIMIT), DATE, FORMAT])
    if (log.exitCode !== 0) {
      await update($, error, () => log.stderr.trim() || 'git log failed')
      return
    }
    const [status, origin, list, refs, who, email, trees, top] = await Promise.all([
      // `-uall` lists every untracked file, not a bare `dir/`, so each gets a dot.
      $.process.run(['git', 'status', '--porcelain=v2', '-b', '-uall', '-z']),
      $.process.run(['git', 'remote', 'get-url', 'origin']),
      $.process.run(['git', 'stash', 'list', '--format=%gd%x1f%H%x1f%gs%x1e', '--shortstat']),
      $.process.run(['git', 'for-each-ref', '--format=%(refname:short)', '--sort=refname', 'refs/heads']),
      $.process.run(['git', 'config', 'user.name']),
      $.process.run(['git', 'config', 'user.email']),
      run($, WORKTREE_LIST_COMMAND),
      run($, TOPLEVEL_COMMAND),
    ])
    // The person's own name as the repo's .mailmap spells it, as the log's %aN does, so their branches are never listed as someone else's.
    const configured = who.exitCode === 0 ? who.stdout.trim() : ''
    const mapped = configured !== '' && email.exitCode === 0 ? await run($, checkMailmapCommand(configured, email.stdout.trim()), { timeoutMs: 5_000 }) : null
    const me = canonicalName(mapped === null || mapped.exitCode !== 0 ? '' : mapped.stdout, configured)
    const parsed = parseStatus(status.stdout)
    // The commits not pulled yet, so the graph can mark them: only asked when the branch is behind its upstream.
    const comingRun = parsed.upstream !== null && parsed.behind > 0 ? await $.process.run(['git', 'rev-list', 'HEAD..@{u}']) : null
    const incomingHashes = comingRun !== null && comingRun.exitCode === 0 ? parseHashes(comingRun.stdout) : []
    // Which incoming commits touch a file the working tree has changed: only worth a call when there is both.
    let clashing: Record<string, string[]> = {}
    if (incomingHashes.length > 0 && parsed.files.length > 0) {
      const names = await $.process.run(incomingFilesCommand())
      if (names.exitCode === 0) clashing = findClashes(parseNameOnly(names.stdout), dirtyPaths(parsed.files))
    }
    // The Main line view: the first-parent log (HEAD and the upstream), each merge's size from its own log.
    let mainList: MainRow[] = []
    if ((await read($, historyView)) === 'main') {
      let first = await run($, mainLogCommand({ limit: LIMIT, date: DATE, upstream: parsed.upstream, isModern: true }))
      // A git before 2.31 does not know --diff-merges: the older spelling, -m, gives the same one-parent diff.
      if (first.exitCode !== 0 && needsOlderDiffMerges(first.stderr)) first = await run($, mainLogCommand({ limit: LIMIT, date: DATE, upstream: parsed.upstream, isModern: false }))
      if (first.exitCode === 0) {
        const entries = parseMainLog(first.stdout)
        const merges = entries.filter(entry => entry.commit.parents.length > 1).slice(0, 40)
        const counted = await Promise.all(merges.map(async item => ({ hash: item.commit.hash, result: await run($, ['git', 'log', '--format=%aN', `${item.commit.hash}^1..${item.commit.hash}^2`]) })))
        const details: Record<string, { count: number; authors: string[] }> = {}
        for (const { hash, result } of counted) if (result.exitCode === 0) details[hash] = parseMergeAuthors(result.stdout)
        mainList = buildMainRows(entries, details)
        // A collapsed incoming PR clashes when any commit inside it does.
        const coming = new Set(incomingHashes)
        const inside = await Promise.all(merges.filter(item => coming.has(item.commit.hash)).map(async item => ({ hash: item.commit.hash, result: await run($, ['git', 'rev-list', `${item.commit.hash}^1..${item.commit.hash}^2`]) })))
        for (const { hash, result } of inside) {
          if (result.exitCode !== 0) continue
          const files = [...new Set(parseHashes(result.stdout).flatMap(h => clashing[h] ?? []))]
          if (files.length > 0) clashing[hash] = files
        }
      }
    }
    const stashed = list.exitCode === 0 ? parseStashList(list.stdout) : []
    // An undo is only good against the HEAD its action left (and, for a stash, its own stash on top); anything else voids it.
    if (!isUndoValid(await read($, undo), parsed.oid, stashed[0]?.hash ?? '')) await update($, undo, () => null)
    await Promise.all([
      update($, commits, () => parseLog(log.stdout)),
      update($, head, () => parsed.branch),
      update($, branches, () => (refs.exitCode === 0 ? parseBranches(refs.stdout) : [])),
      update($, headHash, () => parsed.oid),
      update($, files, () => parsed.files),
      update($, ticked, current => pruneTicked(current, parsed.files)),
      update($, stashes, () => stashed),
      update($, sync, current => ({ ...current, ahead: parsed.ahead, behind: parsed.behind, upstream: parsed.upstream })),
      update($, error, () => null),
      update($, remote, () => (origin.exitCode === 0 ? origin.stdout.trim() : '')),
      update($, you, () => me),
      update($, incoming, () => incomingHashes),
      update($, clashes, () => clashing),
      update($, mainRows, () => mainList),
      update($, worktrees, () => (trees.exitCode === 0 ? parseWorktrees(trees.stdout, top.stdout) : [])),
    ])
    void refreshPr($)
    // After `you` is written above, so the person's own branches are never listed as a teammate's; the 60 s throttle keeps this to one lookup a minute.
    void refreshTeammates($)
    if (await read($, isBranchesOpen)) await refreshBranches($)
    await refreshAheadOfBase($, parsed.branch)
  } catch (err) {
    await update($, error, () => (err instanceof Error ? err.message : String(err)))
  }
}

/** Opens or closes the Branches card; opening reads the branches, closing drops a confirm line it held. */
async function toggleBranches($: EngineInterface): Promise<void> {
  const next = !(await read($, isBranchesOpen))
  await Promise.all([update($, isBranchesOpen, () => next), update($, branchesShown, () => BRANCH_ROWS)])
  if (next) await refreshBranches($)
  else await update($, pending, current => (current?.site === 'branches' ? null : current))
}

/** The local branches with their tips, ages, upstreams and whether HEAD has all of each. */
async function refreshBranches($: EngineInterface): Promise<void> {
  const [list, merged, current] = await Promise.all([run($, BRANCH_LIST_COMMAND), run($, MERGED_COMMAND), read($, head)])
  if (list.exitCode !== 0) return
  await update($, branchList, () => parseBranchList(list.stdout, merged.exitCode === 0 ? merged.stdout : '', current))
}

/** A keystroke in a confirm line's name field: kept without a redraw, and the last complaint cleared only when there is one. */
async function setName($: EngineInterface, text: string): Promise<void> {
  typedName = text
  if ((await read($, note)) !== null) await update($, note, () => null)
}

/** Shows a worktree's folder in Finder: the mod cannot start a Claude session there. */
async function openWorktree($: EngineInterface, path: string): Promise<void> {
  const ran = await run($, ['open', path])
  if (ran.exitCode !== 0) await update($, sync, current => ({ ...current, note: `open failed: ${firstLine(ran)}` }))
}

/** `git worktree remove`, after the ask: git refuses a worktree with changes or untracked files, and the branch stays. */
async function removeWorktree($: EngineInterface, path: string): Promise<void> {
  await update($, confirmRemove, () => null)
  const ran = await run($, ['git', 'worktree', 'remove', path], { timeoutMs: 60_000 })
  const folder = path.slice(path.lastIndexOf('/') + 1)
  await update($, sync, current => ({ ...current, note: ran.exitCode === 0 ? null : `remove ${folder} failed: ${firstLine(ran)}` }))
  if (ran.exitCode === 0) $.ui.toast(`Removed the worktree ${folder}`)
  await refresh($)
}

/** Clears the records of worktrees whose folders are gone, which frees their branches. */
async function pruneWorktrees($: EngineInterface): Promise<void> {
  const ran = await run($, ['git', 'worktree', 'prune'])
  await update($, sync, current => ({ ...current, note: ran.exitCode === 0 ? null : `prune failed: ${firstLine(ran)}` }))
  if (ran.exitCode === 0) $.ui.toast('Pruned the missing worktrees')
  await refresh($)
}

/** A rename or delete asked on the Branches card: a delete of a branch HEAD does not have is forced, after a harder warning. */
async function startBranch($: EngineInterface, kind: 'rename-branch' | 'delete-branch', branch: BranchInfo): Promise<void> {
  const force: { force?: true } = kind === 'delete-branch' && !branch.isMerged ? { force: true } : {}
  await Promise.all([update($, pending, () => ({ kind, hash: branch.hash, target: branch.name, site: 'branches' as const, ...force })), update($, note, () => null)])
  typedName = ''
}

async function toggleView($: EngineInterface): Promise<void> {
  const next: HistoryView = (await read($, historyView)) === 'main' ? 'graph' : 'main'
  await Promise.all([update($, historyView, () => next), update($, openMerge, () => null), update($, historyShown, () => HISTORY_STEP)])
  void $.store.set('historyView', next)
  await refresh($)
}

/** Opens a merge row to its commits (newest first), or closes it when it is the open one. */
async function toggleMerge($: EngineInterface, hash: string): Promise<void> {
  if ((await read($, openMerge))?.hash === hash) {
    await update($, openMerge, () => null)
    return
  }
  const ran = await $.process.run(['git', 'log', '--format=%h%x1f%aN%x1f%s', '-n', String(MERGE_COMMITS_SHOWN), `${hash}^1..${hash}^2`])
  await update($, openMerge, () => ({ hash, commits: ran.exitCode === 0 ? parseMergeCommits(ran.stdout) : [] }))
}

/** Lists other people's open PRs and recent branches on origin, on the PR lookup's one-minute pace; with no signed-in gh, or an origin that is not GitHub, the card and the pills go and nothing more is asked. Never two at once. */
async function refreshTeammates($: EngineInterface, force = false): Promise<void> {
  if (await read($, isClosed)) return
  const now = Date.now()
  // The throttle sits a little under the one-minute clock, so a tick right after a forced lookup is not skipped.
  if (isTeammatesBusy || (!force && now - teammatesAt < PR_EVERY_MS - 5_000)) return
  isTeammatesBusy = true
  try {
    await lookupTeammates($, now)
  } finally {
    isTeammatesBusy = false
  }
}

async function lookupTeammates($: EngineInterface, now: number): Promise<void> {
  teammatesAt = now
  const originUrl = await read($, remote)
  // No origin read yet: ask again soon. An origin that is not on GitHub has no PRs to list.
  if (originUrl === '') {
    teammatesAt = 0
    return
  }
  const noOne = () => Promise.all([update($, teammates, () => []), update($, openPrs, () => ({})), update($, openTeammate, () => null)])
  if (!isGithubRemote(originUrl)) {
    await noOne()
    return
  }
  // The cached `gh auth status`: a forced lookup skips only the throttle, refreshPr rechecks the sign-in when a gh command ran.
  if (!(await ghReady($, false))) {
    // Signed out drops the card; a check that merely failed keeps it and asks again next time.
    if ((await read($, hasGh)) === false) await noOne()
    else teammatesAt = 0
    return
  }
  const base = await baseBranch($)
  if (base === null) return
  const baseName = branchOf(base)
  const [listed, asked, finished, counted] = await Promise.all([
    run($, prListCommand(), { timeoutMs: 30_000 }),
    run($, reviewListCommand(), { timeoutMs: 30_000 }),
    run($, mergedListCommand(), { timeoutMs: 30_000 }),
    run($, branchesCommand(baseName, true), { timeoutMs: 15_000 }),
  ])
  // A timeout or a network error says nothing about who is working: keep what is shown and ask again next time.
  if (listed.exitCode !== 0) {
    teammatesAt = 0
    return
  }
  let remotes = counted.exitCode === 0 ? parseRemoteBranches(counted.stdout) : []
  if (counted.exitCode !== 0) {
    // The plain listing, with no counts: a git before 2.41/2.42 gets one count per branch below, while a base branch
    // that is simply missing leaves the counts unknown, so only branches with a PR are listed.
    const plain = await run($, branchesCommand(baseName, false), { timeoutMs: 15_000 })
    const found = plain.exitCode === 0 ? parseRemoteBranches(plain.stdout).slice(0, 30) : []
    if (needsFallback(counted.stderr)) {
      const ahead = await Promise.all(found.map(async entry => ({ name: entry.name, out: await run($, countCommand(baseName, entry.name), { timeoutMs: 10_000 }) })))
      const byName = new Map(ahead.map(entry => [entry.name, entry.out.exitCode === 0 ? Number(entry.out.stdout.trim()) || 0 : 0]))
      remotes = found.map(entry => ({ ...entry, ahead: byName.get(entry.name) ?? 0 }))
    } else remotes = found
  }
  const prList = parsePrList(listed.stdout)
  const items = joinTeammates({ prs: prList, branches: remotes, reviewFor: asked.exitCode === 0 ? parseReviewNumbers(asked.stdout) : new Set<number>(), merged: finished.exitCode === 0 ? parseMergedAt(finished.stdout) : {}, you: await read($, you), base: baseName, now: Math.floor(now / 1000) })
  const opened = await read($, openTeammate)
  await Promise.all([
    update($, teammates, () => items),
    update($, openPrs, () => badgesOf(prList)),
    ...(opened !== null && !items.some(item => item.branch === opened.branch) ? [update($, openTeammate, () => null)] : []),
  ])
}

/** Opens a teammate row to its commits and files against the base (at most the first few of each), or closes it when it is the open one. */
async function toggleTeammate($: EngineInterface, branch: string): Promise<void> {
  if ((await read($, openTeammate))?.branch === branch) {
    await update($, openTeammate, () => null)
    return
  }
  const base = await baseBranch($)
  if (base === null) return
  const baseName = branchOf(base)
  const [log, stat] = await Promise.all([run($, commitsCommand(baseName, branch), { timeoutMs: 15_000 }), run($, filesCommand(baseName, branch), { timeoutMs: 15_000 })])
  await update($, openTeammate, () => ({ branch, commits: log.exitCode === 0 ? parseMergeCommits(log.stdout) : [], files: stat.exitCode === 0 ? parseNumstat(stat.stdout) : [] }))
}

/** Check out: git makes a tracking branch from origin when only the remote has it; a refusal goes to the header note like the branch menu's. */
async function checkoutTeammate($: EngineInterface, branch: string): Promise<void> {
  await update($, openTeammate, () => null)
  await switchBranch($, branch)
}

/** The quiet fetch, on the timer's tick: when the switch is on and the pane open it runs `git fetch --prune`; silent unless new commits arrive, and one dim note after three failures in a row. */
async function autoFetch($: EngineInterface): Promise<void> {
  if (isAutoFetching) return
  const [enabled, closed, state, origin] = await Promise.all([read($, isAutoFetch), read($, isClosed), read($, sync), read($, remote)])
  const now = Date.now()
  if (!shouldAutoFetch({ isEnabled: enabled, isClosed: closed, busy: state.busy, hasOrigin: origin !== '', now, lastAt: lastFetchAt })) return
  isAutoFetching = true
  lastFetchAt = now
  try {
    const ran = await run($, autoFetchCommand(), { timeoutMs: 60_000 })
    autoFetchFailures = nextFailures(autoFetchFailures, ran.exitCode === 0)
    const warning = failureNote(autoFetchFailures)
    if (warning !== null) await update($, sync, current => (current.note === null ? { ...current, note: warning } : current))
    else await update($, sync, current => (current.note === FAILURE_NOTE ? { ...current, note: null } : current))
    if (ran.exitCode !== 0) return
    await refresh($)
    const heard = newCommitsNote(state.behind, (await read($, sync)).behind)
    if (heard !== null) $.ui.toast(heard)
    void refreshTeammates($, true)
  } finally {
    isAutoFetching = false
  }
}

/** The reference panel's switch: on or off, kept across sessions; turning it on lets the next tick fetch at once. */
async function toggleAutoFetch($: EngineInterface): Promise<void> {
  const next = !(await read($, isAutoFetch))
  await update($, isAutoFetch, () => next)
  void $.store.set('autoFetch', next)
  if (next) {
    lastFetchAt = 0
    autoFetchFailures = 0
  }
  $.ui.toast(next ? 'Auto-fetch on: every 5 minutes' : 'Auto-fetch off')
}

async function pick($: EngineInterface, hash: string): Promise<void> {
  await update($, selected, current => (current === hash ? null : hash))
  if ((await read($, selected)) !== hash) return
  // A merge is shown against its first parent: what the merge brought in, as a pull request lists it.
  const [show, numstat, nameStatus] = await Promise.all([
    $.process.run(['git', '-c', 'core.quotepath=off', 'show', '--no-color', '--diff-merges=first-parent', '--format=%b', hash]),
    $.process.run(['git', '-c', 'core.quotepath=off', 'show', '--no-color', '--diff-merges=first-parent', '-z', '--numstat', '--format=', hash]),
    $.process.run(['git', '-c', 'core.quotepath=off', 'show', '--no-color', '--diff-merges=first-parent', '-z', '--name-status', '--format=', hash]),
  ])
  const text = show.stdout
  const at = text.indexOf('\ndiff --git ')
  const body = (at === -1 ? text : text.slice(0, at)).trim()
  const trimmed = trimDiff(at === -1 ? '' : text.slice(at + 1))
  await update($, detail, () => ({ hash, body, files: parseCommitFiles(numstat.stdout, nameStatus.stdout), diff: trimmed.diff, droppedFiles: trimmed.droppedFiles, open: [], showFiles: false }))
}

/** Runs the pending action the person confirmed, reports in `note`, and refreshes the graph. */
async function runAction($: EngineInterface): Promise<void> {
  const typed = typedName
  const [started, oid, branch, list] = await Promise.all([read($, pending), read($, headHash), read($, head), read($, commits)])
  if (started === null) return
  const isMerge = (list.find(commit => commit.hash === started.hash)?.parents.length ?? 0) > 1
  const command = actionCommand(started, typed, isMerge)
  if ('error' in command) {
    await update($, note, () => command.error)
    return
  }
  const short = started.hash.slice(0, 7)
  const ran = await run($, command.argv, { timeoutMs: 60_000 })
  if (ran.exitCode !== 0) {
    const why = firstLine(ran)
    // An action that stopped on conflicts would leave the tree mid-way; back out so the pane never does.
    const abort = abortCommand(started.kind)
    if (abort !== null) await run($, abort)
    await update($, note, () => `failed: ${why}${abort === null ? '' : ` (${started.kind} aborted)`}`)
    $.ui.toast(`git-graph: ${started.kind} failed`)
    return
  }
  const name = refName(typed)
  const target = started.target ?? ''
  const done: Record<ActionKind, string> = {
    checkout: `Checked out ${short} (detached HEAD)`,
    branch: `Created ${name} at ${short} and switched to it`,
    'cherry-pick': `Cherry-picked ${short}`,
    reset: `Moved the branch to ${short}; the changes since are staged`,
    revert: `Reverted ${short} with a new commit`,
    merge: `Merged ${short} into ${branch || 'HEAD'}`,
    rebase: `Rebased ${branch || 'HEAD'} onto ${short}`,
    tag: `Tagged ${short} as ${name}`,
    'delete-branch': `Deleted branch ${target}`,
    'rename-branch': `Renamed ${target} to ${name}`,
  }
  typedName = ''
  await Promise.all([update($, pending, () => null), update($, note, () => done[started.kind])])
  $.ui.toast(done[started.kind])
  await recordUndo($, started.kind, { headHash: oid, branch, name, target, hash: started.hash })
  await refresh($)
}

/** The first non-empty line of stderr without git's `error: ` prefix, or the exit code. */
function firstLine(ran: { stderr: string; exitCode: number }): string {
  return (ran.stderr.trim().split('\n').find(line => line.length > 0) ?? `exit ${ran.exitCode}`).replace(/^(error|fatal): /, '')
}

/** A box was ticked or cleared: the selection only, no git command. */
async function tickToggle($: EngineInterface, path: string): Promise<void> {
  await Promise.all([update($, ticked, current => toggleTick(current, path)), update($, changesNote, () => null)])
}

async function tickAll($: EngineInterface): Promise<void> {
  const list = await read($, files)
  await Promise.all([update($, ticked, current => toggleAll(list, current)), update($, changesNote, () => null)])
}

/** Stage what is ticked. */
async function stageSelected($: EngineInterface): Promise<void> {
  const [list, picked] = await Promise.all([read($, files), read($, ticked)])
  const command = stageCommand(list, picked)
  if (command === null) {
    await update($, changesNote, () => 'Tick the files to stage.')
    return
  }
  const ran = await run($, command, { timeoutMs: 60_000 })
  await update($, changesNote, () => (ran.exitCode === 0 ? null : `failed: ${firstLine(ran)}`))
  await refresh($)
}

/** Take one staged file, or every staged file, out of the index. */
async function unstageFiles($: EngineInterface, path: string | null): Promise<void> {
  const list = (await read($, files)).filter(file => file.isStaged && (path === null || file.path === path))
  const command = unstageCommand(list)
  if (command === null) return
  const ran = await run($, command, { timeoutMs: 60_000 })
  await update($, changesNote, () => (ran.exitCode === 0 ? null : `failed: ${firstLine(ran)}`))
  await refresh($)
}

/** Which text an editor holds: the commit message, or the summary's description. The validator wants `$` passed only to top-level functions, so the two are told apart here, not by an object of methods. */
type EditorTarget = 'message' | 'summary'

/** What an editor typed: kept as that text. */
async function keepEditorText($: EngineInterface, target: EditorTarget, text: string): Promise<void> {
  if (target === 'message') await update($, message, () => text)
  else await update($, summary, current => (current === null ? null : { ...current, description: text }))
}

/** A paste landed: the hooks replace the editor's text and put its caret. */
async function putEditorText($: EngineInterface, target: EditorTarget, text: string, caret: number): Promise<void> {
  if (target === 'message') {
    await setMessage($, text, caret)
    return
  }
  await Promise.all([update($, summary, current => (current === null ? null : { ...current, description: text })), update($, summaryCaret, () => caret), update($, summaryRev, n => n + 1)])
}

/** An editor's post: an edit keeps its text (and copies a selection when asked), a paste splices the clipboard in at the caret. */
async function editorMessage($: EngineInterface, e: { data: unknown; surface: RenderSurface }, target: EditorTarget): Promise<void> {
  const data = e.data as { kind?: unknown; text?: unknown; caret?: unknown; anchor?: unknown; copy?: unknown } | null
  if (data === null || typeof data !== 'object' || typeof data.text !== 'string' || data.text.length > MESSAGE_MAX) return
  if (data.kind === 'paste') {
    const clip = await clipboardText($)
    if (clip === null) {
      $.ui.toast('Nothing to paste')
      return
    }
    const at = typeof data.caret === 'number' ? Math.max(0, Math.min(data.text.length, data.caret)) : data.text.length
    const other = typeof data.anchor === 'number' ? Math.max(0, Math.min(data.text.length, data.anchor)) : at
    const from = Math.min(at, other)
    const to = Math.max(at, other)
    await putEditorText($, target, (data.text.slice(0, from) + clip + data.text.slice(to)).slice(0, MESSAGE_MAX), from + clip.length)
    return
  }
  await keepEditorText($, target, data.text)
  if (typeof data.copy === 'string' && data.copy.length > 0) await $.ui.copy({ text: data.copy, surface: e.surface })
}

/** Sets the message from the hooks' side (a clear, a paste, the reload tool): the editor drops its own text for it, its caret at `caret` (the end when null). */
async function setMessage($: EngineInterface, text: string, caret: number | null = null): Promise<void> {
  await Promise.all([update($, message, () => text), update($, editCaret, () => caret), update($, editRev, n => n + 1)])
}

/** The system clipboard's text, capped like the message; null when it holds none. macOS's `pbpaste`: the engine has no clipboard read. */
async function clipboardText($: EngineInterface): Promise<string | null> {
  const ran = await run($, ['pbpaste'], { timeoutMs: 5_000 })
  if (ran.exitCode !== 0 || ran.stdout.length === 0) return null
  return ran.stdout.replace(/\r\n?/g, '\n').slice(0, MESSAGE_MAX)
}

async function commit($: EngineInterface): Promise<void> {
  const [text, list, picked, oid, branch] = await Promise.all([read($, message), read($, files), read($, ticked), read($, headHash), read($, head)])
  const ready = commitReadiness({ message: text, files: list, ticked: picked })
  const commands = commitCommands(text, list, picked)
  if (!ready.isReady || commands === null) {
    await update($, changesNote, () => ready.why)
    return
  }
  // Add what is ticked as it is on disk now, then commit exactly those paths: files staged another way stay staged.
  for (const command of commands) {
    const ran = await run($, command, { timeoutMs: 60_000 })
    if (ran.exitCode !== 0) {
      await update($, changesNote, () => `failed: ${firstLine(ran)}`)
      await refresh($)
      return
    }
  }
  const chosen = tickedFiles(list, picked)
  await Promise.all([setMessage($, ''), update($, changesNote, () => null), update($, openFiles, () => [])])
  $.ui.toast(`Committed ${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}`)
  await recordUndo($, 'commit', { headHash: oid, branch, name: '', target: '' })
  await refresh($)
  // What the commit left is ticked again, so the next commit is one press away, not a trip through All.
  const left = allPaths(await read($, files))
  await update($, ticked, () => left)
}

/** ✎ Write: a model drafts a subject and body from what Commit would take, and the message box shows it. A message the person typed is never replaced. */
async function writeMessage($: EngineInterface): Promise<void> {
  trace('write pressed')
  if (await read($, isWriting)) return trace('write: already writing')
  const [text, list] = await Promise.all([read($, message), read($, files)])
  const ready = writeReadiness({ message: text, files: list })
  if (!ready.isReady) {
    trace(`write: refused, ${ready.why}`)
    await update($, changesNote, () => ready.why)
    return
  }
  trace('write: asking the model')
  await Promise.all([update($, isWriting, () => true), update($, changesNote, () => null)])
  try {
    const commands = describeCommands(list, await read($, ticked))
    const [stat, recent, ...diffs] = await Promise.all([
      run($, commands.stat, { timeoutMs: 15_000 }),
      run($, ['git', 'log', '-n', '5', '--format=%s'], { timeoutMs: 15_000 }),
      ...commands.diffs.map(argv => run($, argv, { timeoutMs: 15_000 })),
    ])
    const { text: diff, dropped } = capDiff(diffs.map(ran => ran.stdout).join('\n'))
    const prompt = commitPrompt({ stat: stat.stdout, diff, recent: recent.stdout.split('\n').filter(Boolean), untracked: commands.untracked, dropped })
    const reply = await $.model.complete({ model: DRAFT_MODEL, system: 'You write concise, accurate git commit messages.', prompt, maxTokens: 400, effort: 'low', timeoutMs: 45_000 })
    if (!reply.isAnswered) {
      await update($, changesNote, () => `failed: Claude did not answer (${reply.reason})`)
      return
    }
    trace('write: the model answered')
    const draft = parseDraft(reply.text).slice(0, MESSAGE_MAX)
    if (draft.length === 0) {
      await update($, changesNote, () => 'failed: Claude sent an empty message')
      return
    }
    // The person may have started typing while the model worked: theirs wins.
    if ((await read($, message)).trim().length > 0) {
      await update($, changesNote, () => 'Kept what you typed.')
      return
    }
    await setMessage($, draft)
  } catch (err) {
    await update($, changesNote, () => `failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, isWriting, () => false)
  }
}

/** The branch a pull request would target: what `origin/HEAD` points at, else the first of BASES that exists; null when none does. */
async function baseBranch($: EngineInterface): Promise<string | null> {
  const ref = await run($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: 5_000 })
  if (ref.exitCode === 0 && ref.stdout.trim().length > 0) return ref.stdout.trim()
  for (const name of BASES) {
    const found = await run($, ['git', 'rev-parse', '--verify', '--quiet', name], { timeoutMs: 5_000 })
    if (found.exitCode === 0) return name
  }
  return null
}

/** How many commits `branch` has that its base lacks, for Draft PR: 0 on the base, detached, or with no base to compare. */
async function refreshAheadOfBase($: EngineInterface, branch: string): Promise<void> {
  const base = branch.length === 0 ? null : await baseBranch($)
  let count = 0
  if (base !== null && branchOf(base) !== branch) {
    const counted = await run($, ['git', 'rev-list', '--count', `${base}..HEAD`], { timeoutMs: 5_000 })
    count = counted.exitCode === 0 ? Number(counted.stdout.trim()) || 0 : 0
  }
  await update($, aheadOfBase, () => count)
}

/** ≡ Draft PR: a model drafts a pull request title and description from the branch's commits and diff against its base; the card shows it. The header note says why when there is nothing to draft. */
async function summarize($: EngineInterface): Promise<void> {
  trace('summarize pressed')
  if (await read($, isSummarizing)) return trace('summarize: already running')
  await update($, isSummarizing, () => true)
  // The header note, and a toast so a refusal is not missed (a faint line under the header went unnoticed on the base branch).
  const say = async (text: string | null) => {
    await update($, sync, current => ({ ...current, note: text }))
    if (text !== null) $.ui.toast(text)
  }
  try {
    await say(null)
    const [branch, base] = await Promise.all([read($, head), baseBranch($)])
    if (base === null) {
      await say('summary failed: no main or master branch to compare with')
      return
    }
    await ghReady($, false)
    if (branchOf(base) === branch) {
      await say(`You are on ${branchOf(base)}; open a pull request from another branch.`)
      return
    }
    const [log, stat, whole] = await Promise.all([
      run($, ['git', 'log', '-n', '40', '--format=%s', `${base}..HEAD`], { timeoutMs: 15_000 }),
      run($, ['git', 'diff', '--stat', `${base}...HEAD`], { timeoutMs: 15_000 }),
      run($, ['git', 'diff', `${base}...HEAD`], { timeoutMs: 15_000 }),
    ])
    if (log.exitCode !== 0) {
      await say(`summary failed: ${firstLine(log)}`)
      return
    }
    const subjects = log.stdout.split('\n').filter(Boolean)
    if (subjects.length === 0) {
      await say(`Nothing ahead of ${base}.`)
      return
    }
    const { text: diff, dropped } = capDiff(whole.stdout)
    const prompt = branchPrompt({ base, head: branch, commits: subjects, stat: stat.stdout, diff, dropped })
    const reply = await $.model.complete({ model: DRAFT_MODEL, system: 'You write clear pull request titles and descriptions.', prompt, maxTokens: 700, effort: 'low', timeoutMs: 60_000 })
    if (!reply.isAnswered) {
      await say(`summary failed: Claude did not answer (${reply.reason})`)
      return
    }
    trace('summarize: the model answered')
    const parsed = parseSummary(reply.text)
    if (parsed.title.length === 0) {
      await say('summary failed: Claude sent an empty reply')
      return
    }
    await Promise.all([update($, summary, () => ({ branch, base, ...parsed })), update($, summaryCaret, () => null), update($, summaryRev, n => n + 1), update($, prNote, () => null)])
  } catch (err) {
    await say(`summary failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, isSummarizing, () => false)
  }
}

async function copySummary($: EngineInterface, surface: RenderSurface): Promise<void> {
  const drafted = await read($, summary)
  if (drafted === null) return
  void $.ui.copy({ text: drafted.description.length > 0 ? `${drafted.title}\n\n${drafted.description}` : drafted.title, surface })
  $.ui.toast('Copied the summary')
}

// When and for which branch the PR was last asked for: module state is fine, a reload only costs one extra lookup.
let prLookup: { branch: string | null; at: number } = { branch: null, at: 0 }

/** `gh auth status` once; a forced lookup asks again, so signing in is picked up by the card's refresh. */
async function ghReady($: EngineInterface, force: boolean): Promise<boolean> {
  const known = await read($, hasGh)
  if (known !== null && !force) return known
  const ran = await run($, ['gh', 'auth', 'status'], { timeoutMs: 15_000 })
  // Only a definite answer is kept: a flaky network check is asked again on the next call.
  if (ran.exitCode === 0 || isGhAbsent(ran.stderr)) await update($, hasGh, () => ran.exitCode === 0)
  return ran.exitCode === 0
}

/** Looks for the open PR of the current branch when `shouldLookup` says to, and keeps it in state. */
async function refreshPr($: EngineInterface, force = false): Promise<void> {
  if (await read($, isClosed)) return
  const [branch, info, current] = await Promise.all([read($, head), read($, sync), read($, pr)])
  const now = Date.now()
  if (!shouldLookup({ force, branch, upstream: info.upstream, lastBranch: prLookup.branch, lastAt: prLookup.at, now, hasPr: current !== null })) {
    // A branch that cannot have a PR (detached, or never pushed) drops a stale card.
    if (current !== null && (branch === '' || info.upstream === null)) await update($, pr, () => null)
    return
  }
  prLookup = { branch, at: now }
  if (!(await ghReady($, force))) {
    // Signed out drops the card; a check that merely failed keeps it and asks again next time.
    if ((await read($, hasGh)) === false) await update($, pr, () => null)
    else prLookup = { branch: null, at: 0 }
    return
  }
  const ran = await run($, ['gh', 'pr', 'view', '--json', PR_FIELDS], { timeoutMs: 20_000 })
  if (ran.exitCode !== 0 && !hasNoPr(ran.stderr)) {
    // A timeout or a network error says nothing about the PR: keep what is shown and ask again next time.
    prLookup = { branch: null, at: 0 }
    return
  }
  const found = ran.exitCode === 0 ? parsePr(ran.stdout) : null
  // A merge ask belongs to the PR it was opened on.
  if ((current?.number ?? null) !== (found?.number ?? null)) await update($, isMerging, () => false)
  await update($, pr, () => found)
}

/** Create PR: push when needed, open the PR with the edited title and description, then show it. Acts at once. */
async function createPr($: EngineInterface): Promise<void> {
  if (await read($, isPrBusy)) return
  const [drafted, branch, info] = await Promise.all([read($, summary), read($, head), read($, sync)])
  if (drafted === null || branch === '') return
  if (drafted.branch !== branch || branchOf(drafted.base) === branch) {
    await update($, prNote, () => (drafted.branch !== branch ? `This draft was written for ${drafted.branch}: summarize again.` : `You are on ${branch}; open a pull request from another branch.`))
    return
  }
  const title = (drafted.title.split('\n')[0] ?? '').trim()
  if (title.length === 0) {
    await update($, prNote, () => 'Give the pull request a title first.')
    return
  }
  await Promise.all([update($, isPrBusy, () => true), update($, prNote, () => null)])
  let isMade = false
  try {
    const steps = createSteps({ branch, base: drafted.base, title, description: drafted.description.trim(), needsPush: info.upstream === null || info.ahead > 0 })
    for (const step of steps) {
      const ran = await run($, step.argv, { timeoutMs: 120_000, stdin: step.stdin })
      if (ran.exitCode !== 0) {
        await update($, prNote, () => `failed: ${firstLine(ran)}`)
        return
      }
    }
    isMade = true
    await update($, summary, () => null)
  } finally {
    // After a push the branch has an upstream, so the lookup below can find the new PR.
    await refresh($)
    if (isMade) {
      await refreshPr($, true)
      // GitHub can lag a moment behind the create: look once more before giving up on showing the card.
      if ((await read($, pr)) === null) await refreshPr($, true)
      const made = await read($, pr)
      $.ui.toast(made === null ? 'Opened the pull request' : `Opened #${made.number}`)
    }
    await update($, isPrBusy, () => false)
  }
}

/** Merge pressed: ask in place, or explain why it cannot be merged. */
async function askMerge($: EngineInterface): Promise<void> {
  const current = await read($, pr)
  if (current === null) return
  if (current.hasConflicts) {
    await update($, prNote, () => 'This pull request has conflicts: resolve them on GitHub first.')
    return
  }
  await Promise.all([update($, isMerging, () => true), update($, prNote, () => null)])
}

/** The merge, after the ask. gh merges, then switches to the base branch and deletes the local one; a dirty tree can stop only that second part. */
async function mergePr($: EngineInterface): Promise<void> {
  const current = await read($, pr)
  if (current === null || (await read($, isPrBusy))) return
  await Promise.all([update($, isPrBusy, () => true), update($, isMerging, () => false), update($, prNote, () => null)])
  try {
    const ran = await run($, mergeStep(current.number), { timeoutMs: 120_000 })
    if (ran.exitCode !== 0) {
      const state = await run($, ['gh', 'pr', 'view', String(current.number), '--json', 'state', '--jq', '.state'], { timeoutMs: 20_000 })
      if (state.stdout.trim() !== 'MERGED') {
        await update($, prNote, () => `failed: ${firstLine(ran)}`)
        return
      }
      await update($, sync, c => ({ ...c, note: `Merged #${current.number}, but stayed on this branch: ${firstLine(ran)}` }))
    } else $.ui.toast(`Merged #${current.number}`)
    await update($, pr, () => null)
    await refresh($)
  } finally {
    await update($, isPrBusy, () => false)
  }
}

/** Close without merging. Acts at once; reopening is done on GitHub. */
async function closePr($: EngineInterface): Promise<void> {
  const current = await read($, pr)
  if (current === null || (await read($, isPrBusy))) return
  await Promise.all([update($, isPrBusy, () => true), update($, isMerging, () => false), update($, prNote, () => null)])
  try {
    const ran = await run($, closeStep(current.number), { timeoutMs: 60_000 })
    if (ran.exitCode !== 0) {
      await update($, prNote, () => `failed: ${firstLine(ran)}`)
      return
    }
    await update($, pr, () => null)
    $.ui.toast(`Closed #${current.number}`)
  } finally {
    await update($, isPrBusy, () => false)
  }
}

async function stashPush($: EngineInterface): Promise<void> {
  const [text, list, picked, oid, branch] = await Promise.all([read($, message), read($, files), read($, ticked), read($, headHash), read($, head)])
  if (list.length === 0) return
  const ran = await run($, stashCommand(text, list, picked), { timeoutMs: 60_000 })
  if (ran.exitCode !== 0) {
    await update($, changesNote, () => `failed: ${firstLine(ran)}`)
    return
  }
  await Promise.all([setMessage($, ''), update($, changesNote, () => null), update($, openFiles, () => []), update($, ticked, () => [])])
  $.ui.toast('Stashed')
  await recordUndo($, 'stash', { headHash: oid, branch, name: '', target: '' })
  await refresh($)
}

async function toggleDiff($: EngineInterface, path: string): Promise<void> {
  const open = await read($, openFiles)
  if (open.some(entry => entry.path === path)) {
    await update($, openFiles, current => current.filter(entry => entry.path !== path))
    return
  }
  const file = (await read($, files)).find(entry => entry.path === path)
  if (file === undefined) return
  // `--no-index` exits 1 when the files differ, which is the normal case.
  const ran = await run($, diffCommand(file))
  const hunks = splitDiff(ran.stdout)[0]?.hunks ?? ''
  await update($, openFiles, current => [...current, { path, diff: hunks }])
}

async function discard($: EngineInterface, path: string): Promise<void> {
  const file = (await read($, files)).find(entry => entry.path === path)
  await update($, confirmDiscard, () => null)
  if (file === undefined) return
  let isDone = true
  for (const argv of discardCommands(file)) {
    const ran = await run($, argv)
    if (ran.exitCode !== 0) {
      await update($, changesNote, () => `failed: ${firstLine(ran)}`)
      isDone = false
      break
    }
  }
  await update($, openFiles, current => current.filter(entry => entry.path !== path))
  if (isDone) $.ui.toast(`Discarded ${path.split('/').pop() ?? path}`)
  await refresh($)
}

/** Fetch, pull (fast-forward only) or push, one at a time; the result goes to the header note or a toast. */
async function runSync($: EngineInterface, kind: SyncKind): Promise<void> {
  const [state, branch, oid] = await Promise.all([read($, sync), read($, head), read($, headHash)])
  if (state.busy !== null) return
  if (kind === 'push' && branch.length === 0) {
    await update($, sync, current => ({ ...current, note: 'Nothing to push from a detached HEAD.' }))
    return
  }
  await update($, sync, current => ({ ...current, busy: kind, note: null }))
  try {
    const ran = await run($, syncCommand(kind, state, branch), { timeoutMs: 120_000 })
    const done: Record<SyncKind, string> = { fetch: 'Fetched', pull: ran.stdout.includes('Already up to date') ? 'Already up to date' : 'Pulled', push: 'Pushed' }
    await update($, sync, current => ({ ...current, note: ran.exitCode === 0 ? null : `${kind} failed: ${firstLine(ran)}` }))
    if (ran.exitCode === 0) {
      $.ui.toast(done[kind])
      if (kind !== 'push') {
        lastFetchAt = Date.now()
        void refreshTeammates($, true)
      }
      if (kind === 'pull' && !ran.stdout.includes('Already up to date')) await recordUndo($, 'pull', { headHash: oid, branch, name: '', target: '' })
      if (kind === 'push') await update($, undo, () => null)
    }
  } finally {
    // Whatever happened, the three buttons come back.
    await update($, sync, current => ({ ...current, busy: null }))
  }
  await refresh($)
}

/** Checks a branch from the header menu out. git refuses when uncommitted work would be overwritten; the refusal goes to the header note and the menu snaps back. */
async function switchBranch($: EngineInterface, name: string): Promise<void> {
  const [branch, oid, state] = await Promise.all([read($, head), read($, headHash), read($, sync)])
  if (name.length === 0 || name === branch || state.busy !== null) return
  const ran = await run($, ['git', 'checkout', name], { timeoutMs: 60_000 })
  if (ran.exitCode !== 0) {
    await update($, sync, current => ({ ...current, note: `checkout ${name} failed: ${firstLine(ran)}` }))
    await refresh($)
    return
  }
  await update($, sync, current => ({ ...current, note: null }))
  await update($, historyShown, () => HISTORY_STEP)
  $.ui.toast(`Switched to ${name}`)
  await recordUndo($, 'switch', { headHash: oid, branch, name, target: '' })
  await refresh($)
}

/** Records the inverse of an action that just succeeded, against the HEAD it left. */
async function recordUndo($: EngineInterface, kind: UndoKind, ctx: UndoContext): Promise<void> {
  const inverse = inverseOf(kind, ctx)
  if (inverse === null) return
  const oid = (await run($, ['git', 'rev-parse', 'HEAD'])).stdout.trim()
  if (kind !== 'stash') {
    await update($, undo, () => ({ ...inverse, expectHead: oid }))
    return
  }
  // A stash push leaves HEAD alone, so the record also remembers which stash is the pane's own.
  const top = (await run($, ['git', 'rev-parse', 'refs/stash'])).stdout.trim()
  await update($, undo, () => ({ ...inverse, expectHead: oid, expectStash: top }))
}

async function runUndo($: EngineInterface): Promise<void> {
  const record = await read($, undo)
  if (record === null) return
  for (const argv of record.argv) {
    const ran = await run($, argv, { timeoutMs: 60_000 })
    if (ran.exitCode !== 0) {
      // `--keep` refused rather than overwrite uncommitted work: say so and keep the record for a retry.
      await update($, sync, current => ({ ...current, note: `undo failed: ${firstLine(ran)}` }))
      await refresh($)
      return
    }
  }
  await update($, undo, () => null)
  $.ui.toast(`Undid ${record.label}`)
  await refresh($)
}

/** apply, pop or drop one stash; drop was confirmed in the pane. The result goes to the header note or a toast. */
async function stashAction($: EngineInterface, verb: 'apply' | 'pop' | 'drop', index: number): Promise<void> {
  await update($, confirmDrop, () => null)
  const ran = await run($, ['git', 'stash', verb, `stash@{${index}}`], { timeoutMs: 60_000 })
  const done = { apply: 'Applied', pop: 'Popped', drop: 'Dropped' }[verb]
  await update($, sync, current => ({ ...current, note: ran.exitCode === 0 ? null : `stash ${verb} failed: ${firstLine(ran)}` }))
  if (ran.exitCode === 0) $.ui.toast(`${done} stash@{${index}}`)
  await refresh($)
}

/** `$.process.run` that never throws: a command that could not start or timed out reads as a failed result. */
async function run($: EngineInterface, argv: string[], init?: { timeoutMs?: number; stdin?: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    return await $.process.run(argv, init)
  } catch (err) {
    return rejected(err)
  }
}
