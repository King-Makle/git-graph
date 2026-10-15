import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { ActionKind, Commit, CommitFile, Detail, FileStatus, Pending } from '../types'
import { NAMED_KINDS, describeAction } from './actions'
import { STATUS_COLOR } from './changes'
import { DIM, GLYPH, GREEN, ORANGE, PURPLE, RED, RULE, capitalize, clip, glyphOnly, initials, pill, refChips } from './chips'
import { splitDiff } from './diff'
import { heldBy } from './git'
import { parseShortstat } from './mainline'
import type { Actions, Model } from './pane'
import { CELL, cardInner, spacedPx } from './fit'
import { personColor } from './people'
import { spaced } from './section'
import { AVATAR_BIG, DIFFSTAT_W, FILE_ROW_H, ICON, LABEL_H, LABEL_W, LETTER_W, RULE_H, svgAvatar, svgDiffstat, svgIcon, svgLabel, svgLetter, svgRule, svgSpace } from './svg'
// The most files a card gives diff toggles; budget.ts lowers it while file and stash rows take their share.
export const FILE_TOGGLES = 60

/** `https://github.com/o/r.git` or `git@github.com:o/r.git` to the commit's page; null for anything else. */
export function githubUrl(remote: string, hash: string): string | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim())
  if (match === null) return null
  return `https://github.com/${match[1]}/${match[2]}/commit/${hash}`
}

/** The commits the remote has: everything reachable from a commit carrying an `origin/` ref, among those loaded. A commit past the list is an ancestor of one inside it, so it is pushed too. */
export function pushedHashes(commits: Commit[]): Set<string> {
  const byHash = new Map(commits.map(commit => [commit.hash, commit]))
  const pushed = new Set<string>()
  const todo = commits.filter(commit => commit.refs.some(ref => ref.startsWith('origin/'))).map(commit => commit.hash)
  for (let hash = todo.pop(); hash !== undefined; hash = todo.pop()) {
    if (pushed.has(hash)) continue
    pushed.add(hash)
    for (const parent of byHash.get(hash)?.parents ?? []) todo.push(parent)
  }
  return pushed
}

// The body is softer than the subject, so the subject stays the headline.
const BODY_TEXT = '#aab1bb'
// A long body shows this much (and at most this many lines) until `more` is pressed.
const BODY_CHARS = 190
const BODY_LINES = 3
// A group name longer than this is clipped to keep the label column (a branch name can be long).
const LABEL_CHARS = 16

/**
 * Each action's button, drawn as the toolbar's are (a plain dim Button, a glyph inside the label, since an Svg beside a
 * Button is not pressable). The glyphs are ones the pane's font draws at full size: ⑂ ⌗ ⇣ ⇡ ⟲ fell back to a tiny one
 * and ⎇ to a squiggle (seen live, 2026-10-08).
 */
export const LABELS: Record<ActionKind, string> = {
  checkout: '↪ Check Out',
  branch: `${GLYPH.stage} Branch`,
  tag: '# Tag',
  'cherry-pick': '↓ Cherry-Pick',
  revert: '↺ Revert',
  merge: '⤵ Merge',
  rebase: '↑ Rebase Onto',
  reset: '⇤ Reset Here',
  'rename-branch': '✎ Rename',
  'delete-branch': '✕ Delete',
}

type Group = { id: string; title: string; isWarning: boolean; actions: { kind: ActionKind; target?: string }[] }

/** Local branches on this commit: `HEAD -> x` and bare names, never origin/ or tag:. */
function localBranches(commit: Commit): string[] {
  return commit.refs.filter(ref => !ref.startsWith('origin/') && !ref.startsWith('tag: ') && ref !== 'HEAD').map(ref => ref.replace(/^HEAD -> /, ''))
}

/** Where a commit sits against HEAD: HEAD itself, in HEAD's history, or not in it (another branch, an incoming commit). */
export type Relation = 'head' | 'history' | 'other'

/** The commit's relation to HEAD, by walking parents from HEAD through the loaded commits. */
export function relationTo(hash: string, commits: Commit[], headHash: string): Relation {
  if (hash === headHash) return 'head'
  const byHash = new Map(commits.map(commit => [commit.hash, commit]))
  const seen = new Set<string>()
  const todo = [headHash]
  for (let at = todo.pop(); at !== undefined; at = todo.pop()) {
    if (seen.has(at)) continue
    seen.add(at)
    if (at === hash) return 'history'
    for (const parent of byHash.get(at)?.parents ?? []) todo.push(parent)
  }
  return 'other'
}

/**
 * The actions that do something for this commit, sorted by where the change lands. HEAD's own commit can only be
 * branched, tagged or reverted (checking it out, picking it, merging or rebasing onto it, resetting to it change
 * nothing). A commit in HEAD's history can be undone or reset to, not brought in again. A commit outside it can be
 * brought in, not reverted (it is not there to undo).
 */
export function actionGroups(commit: Commit, head: string, relation: Relation): Group[] {
  // The branch as the header shows it, first letter capitalised (Title Case, as every label): `Undo On Main`. A display choice only.
  const branch = head.length > 0 ? capitalize(head) : 'HEAD'
  const go: Group = { id: 'go', title: 'Go To It', isWarning: false, actions: relation === 'head' ? [{ kind: 'branch' }, { kind: 'tag' }] : [{ kind: 'checkout' }, { kind: 'branch' }, { kind: 'tag' }] }
  const rewrite: Group = { id: 'rewrite', title: `Rewrites ${branch}`, isWarning: true, actions: [{ kind: 'reset' }] }
  if (relation !== 'other') {
    const undo: Group = { id: 'undo', title: `Undo On ${branch}`, isWarning: false, actions: [{ kind: 'revert' }] }
    return relation === 'head' ? [go, undo] : [go, undo, rewrite]
  }
  // A merge cannot be cherry-picked without choosing a parent, so it is not offered.
  const into: ActionKind[] = commit.parents.length > 1 ? ['merge', 'rebase'] : ['cherry-pick', 'merge', 'rebase']
  return [go, { id: 'into', title: `Bring Into ${branch}`, isWarning: false, actions: into.map(kind => ({ kind })) }, rewrite]
}

const holds = (group: Group, pending: Pending): boolean => group.actions.some(action => action.kind === pending.kind && (action.target ?? '') === (pending.target ?? ''))

/** The selected commit's card: a header, the message body, the files behind a toggle, then the actions in groups. */
export function drawDetails(table: ElementTable, surface: RenderSurface, commit: Commit, shown: Detail | null, model: Model, act: Actions, toggles = FILE_TOGGLES, columns = Infinity): RenderElement {
  const { Box } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const loaded = shown !== null && shown.hash === commit.hash ? shown : null
  const rule = (key: string): RenderElement[] => (Svg !== undefined ? [<Svg key={key} source={svgRule(RULE)} alt="rule" height={RULE_H} />] : [])
  // The buttons show their glyph alone only when the widest action row would not fit inside this card (fit.ts): the
  // History card's and this card's margins and insets come off the pane's width, then the label column.
  const room = cardInner(columns) - 2 * CELL - 26
  const isCompact = actionGroups(commit, model.head, relationTo(commit.hash, model.commits, model.headHash)).some(group => LABEL_W + CELL + spacedPx(group.actions.map(action => LABELS[action.kind])) > room)
  const parts: RenderElement[] = [drawHeader(table, Svg, commit, model, act, isCompact), ...rule('rule:head')]
  // A body gets its own rule under it; without one the header's rule already sits above the files.
  if (loaded !== null && loaded.body.length > 0) parts.push(...drawBody(table, loaded, act), ...rule('rule:files'))
  parts.push(...drawFiles(table, Svg, commit, loaded, act, toggles), ...rule('rule:actions'), ...drawActions(table, surface, Svg, commit, model, act, isCompact))
  // A Branches card action's note shows on that card, not here as well.
  // While a confirm is open its own line carries what went wrong (drawConfirm); after it, the outcome shows here.
  if (model.note !== null && model.pending === null) parts.push(<table.Text color={model.note.startsWith('failed') ? RED : '#9ca3af'}>{model.note}</table.Text>)
  return (
    <Box flexDirection="column" marginX={1} marginY={1} borderStyle="round" borderColor={RULE}>
      {parts}
    </Box>
  )
}

/** The avatar centred on the subject, who and when, and the branch lines; the hash to copy, the GitHub link and close on the subject's line; a merge's parents under it. A rule follows, as under a section card's header. */
function drawHeader(table: ElementTable, Svg: Elements['desktop']['Svg'] | undefined, commit: Commit, model: Model, act: Actions, isCompact: boolean): RenderElement {
  const { Box, Text, Button, Link } = table
  const short = commit.hash.slice(0, 7)
  const who = initials(commit.author)
  const colour = personColor(commit.author, model.you)
  // A commit the remote has not got yet would 404 on GitHub.
  const url = pushedHashes(model.commits).has(commit.hash) ? githubUrl(model.remote, commit.hash) : null
  const tools: RenderElement[] = [
    <Button plain key="copy" dimColor onPress={press => act.copy(commit.hash, press.surface)}>
      {`⧉ ${short}`}
    </Button>,
  ]
  if (url !== null) tools.push(<Link href={url} label="↗ GitHub" />)
  tools.push(
    <Button plain key="close" dimColor role="dismiss" onPress={() => act.close()}>
      ✕
    </Button>,
  )
  const strip: RenderElement[] = []
  // The avatar centres on the lines beside it, so the copy, link and close ride on the subject's line inside the column
  // rather than in a third column of the row. Live, 2026-10-08: an alignSelf on the avatar's own Box did nothing, and a
  // flexShrink on the subject's Box (beside the Buttons) was refused; flexGrow alone draws.
  strip.push(
    <Box flexDirection="row" gap={1} alignItems="center">
      {Svg !== undefined ? <Svg source={svgAvatar(who, commit.author, colour, AVATAR_BIG)} alt={`avatar ${who}`} width={AVATAR_BIG} height={AVATAR_BIG} /> : <Text color={colour}>{who}</Text>}
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box flexGrow={1}>
            <Text bold>{commit.subject}</Text>
          </Box>
          {tools}
        </Box>
        <Text dimColor>{`${commit.author} · ${commit.when}`}</Text>
        {refsRow(table, Svg, commit, model)}
        {branchLines(table, Svg, commit, model, act, isCompact)}
      </Box>
    </Box>,
  )
  // A merge's parents, the ones in the graph as buttons that select them.
  if (commit.parents.length > 1) {
    const listed = new Set(model.commits.map(c => c.hash))
    const parents = commit.parents.map((parent, index) =>
      listed.has(parent) ? (
        <Button plain key={`parent:${parent}`} dimColor onPress={() => act.pick(parent)}>
          {`${index === 0 ? '↑' : '↖'} ${parent.slice(0, 7)}`}
        </Button>
      ) : (
        <Text dimColor>{parent.slice(0, 7)}</Text>
      ),
    )
    strip.push(
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text dimColor>Parents</Text>
        {parents}
      </Box>,
    )
  }
  return (
    <Box key="detail-head" flexDirection="column">
      {strip}
    </Box>
  )
}

// A ref's whole name: the card shows what the row clipped or folded into its +N pill.
const FULL_NAME = 80

/**
 * Every branch, remote branch and tag on the commit as chips with whole names, wrapped: the row shows two at most and
 * folds the rest into a +N pill, and there is no tooltip on this desktop, so this is where they are read. A branch held
 * by another worktree is purple, as on the row. Nothing when the commit has no refs.
 */
function refsRow(table: ElementTable, Svg: Elements['desktop']['Svg'] | undefined, commit: Commit, model: Model): RenderElement[] {
  const { Box } = table
  const chips = refChips(commit.refs, Infinity, FULL_NAME).map(chip => (chip.kind === 'local' && heldBy(model.worktrees, chip.title) !== null ? { ...chip, isElsewhere: true } : chip))
  if (chips.length === 0) return []
  return [
    <Box key="detail-refs" flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
      {chips.map(chip => pill(table, Svg, chip))}
    </Box>,
  ]
}

/**
 * Each other local branch on the commit as a dim line under the date, with delete: cleaning up a merged branch spotted
 * in the graph. The branch you are on gets no line (the row's pill names it) and is renamed from the header. A branch
 * checked out in another worktree cannot be deleted: its line is purple, names the folder, and opens it instead.
 */
function branchLines(table: ElementTable, Svg: Elements['desktop']['Svg'] | undefined, commit: Commit, model: Model, act: Actions, isCompact: boolean): RenderElement[] {
  const { Box, Text, Button } = table
  return localBranches(commit)
    .filter(name => name !== model.head)
    .map(name => {
      const tree = heldBy(model.worktrees, name)
      return (
        <Box key={`branch-line:${name}`} flexDirection="row" alignItems="center">
          {Svg !== undefined ? <Svg source={svgIcon('branch', tree === null ? DIM : PURPLE)} alt="branch" width={ICON} height={ICON} /> : <Text color={tree === null ? DIM : PURPLE}>⎇</Text>}
          <Text dimColor>{tree === null ? ` ${name}  ` : ` ${name} · in ${tree.folder}  `}</Text>
          {tree === null ? (
            <Button plain dimColor key={`act:delete-branch:${name}`} onPress={() => act.start('delete-branch', commit.hash, name)}>
              {glyphOnly(LABELS['delete-branch'], isCompact)}
            </Button>
          ) : tree.isGone ? (
            <Button plain dimColor key={`act:prune:${name}`} onPress={() => act.pruneWorktrees()}>
              {glyphOnly('⌫ Prune', isCompact)}
            </Button>
          ) : (
            <Button plain dimColor key={`act:open:${name}`} onPress={() => act.openWorktree(tree.path)}>
              {glyphOnly('⎋ Open', isCompact)}
            </Button>
          )}
        </Box>
      )
    })
}

/** A long body clipped to a few lines at a word, with `more`; the whole of it once asked. */
export function clipBody(body: string, isOpen: boolean): { text: string; isClipped: boolean } {
  const lines = body.split('\n')
  let text = lines.slice(0, BODY_LINES).join('\n')
  if (text.length > BODY_CHARS) {
    const space = text.lastIndexOf(' ', BODY_CHARS)
    text = text.slice(0, space > 0 ? space : BODY_CHARS)
  }
  const isClipped = text.length < body.length
  return isOpen || !isClipped ? { text: body, isClipped } : { text: `${text.trimEnd()}…`, isClipped }
}

function drawBody(table: ElementTable, shown: Detail, act: Actions): RenderElement[] {
  const { Box, Text, Button } = table
  const { text, isClipped } = clipBody(shown.body, shown.showBody === true)
  // Plain soft text under the strip, as the rest of the pane draws prose: a tinted block here touched the strip, since
  // neither a margin nor a small Svg spacer gave it air (seen live, 2026-10-08).
  const out: RenderElement[] = [
    <Box key="detail-body" paddingX={1} marginTop={1}>
      <Text color={BODY_TEXT}>{text}</Text>
    </Box>,
  ]
  if (isClipped)
    out.push(
      <Box>
        <Button plain dimColor key="body-more" onPress={() => act.toggleBody()}>
          {shown.showBody === true ? '▴ Less' : '▸ More'}
        </Button>
      </Box>,
    )
  return out
}

/** One line with the count and the totals that opens the list; each file a status letter, its folder dim, the name, its counts and squares. */
function drawFiles(table: ElementTable, Svg: Elements['desktop']['Svg'] | undefined, commit: Commit, shown: Detail | null, act: Actions, toggles: number): RenderElement[] {
  const { Box, Text, Button, Code } = table
  if (shown === null)
    return [
      <Text dimColor italic>
        Loading…
      </Text>,
    ]
  const count = shown.files.length
  const totals = shown.files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), deleted: sum.deleted + (file.deleted ?? 0) }), { added: 0, deleted: 0 })
  // Before the list loads (or for a merge, whose shortstat is empty) the log's own line is the fallback.
  const fromLog = parseShortstat(commit.stat)
  const added = count > 0 ? totals.added : fromLog.additions
  const deleted = count > 0 ? totals.deleted : fromLog.deletions
  const line: RenderElement[] = [
    <Button plain key="files" onPress={() => act.showFiles()}>
      {`${shown.showFiles ? '▾' : '▸'} ${count} ${count === 1 ? 'File' : 'Files'}`}
    </Button>,
    <Text color={GREEN}>{`+${added}`}</Text>,
    <Text color={RED}>{`−${deleted}`}</Text>,
  ]
  if (commit.parents.length > 1) line.push(<Text dimColor>· against the first parent</Text>)
  const out: RenderElement[] = [
    <Box key="files-line" flexDirection="row" gap={1} alignItems="center">
      {line}
    </Box>,
  ]
  if (!shown.showFiles) return out

  const diffs = splitDiff(shown.diff)
  shown.files.forEach((file, index) => {
    const canToggle = index < toggles
    const isOpen = canToggle && shown.open.includes(file.path)
    const entry: RenderElement[] = [fileRow(table, Svg, file, canToggle, isOpen, act)]
    if (isOpen) {
      const diff = diffs.find(f => f.path === file.path)
      const hunks =
        diff === undefined ? (
          <Text dimColor italic>
            not loaded: past the diff budget
          </Text>
        ) : diff.hunks.length > 0 ? (
          <Code source={diff.hunks} format="diff" path={diff.path} wrap="truncate-end" />
        ) : (
          <Text dimColor italic>
            {diff.note}
          </Text>
        )
      entry.push(
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          {hunks}
        </Box>,
      )
    }
    out.push(<Box flexDirection="column">{entry}</Box>)
  })
  if (count > toggles) out.push(<Text dimColor italic>{`Diffs open for the first ${toggles} files.`}</Text>)
  return out
}

function fileRow(table: ElementTable, Svg: Elements['desktop']['Svg'] | undefined, file: CommitFile, canToggle: boolean, isOpen: boolean, act: Actions): RenderElement {
  const { Box, Text, Button } = table
  const letter = file.status as FileStatus
  const colour = STATUS_COLOR[letter] ?? STATUS_COLOR.M
  const cut = file.path.lastIndexOf('/') + 1
  const folder = file.path.slice(0, cut)
  const name = file.path.slice(cut)
  const path: RenderElement[] = []
  if (folder.length > 0) path.push(<Text dimColor>{folder}</Text>)
  path.push(
    canToggle ? (
      <Button plain key={`f:${file.path}`} onPress={() => act.toggleFile(file.path)}>
        {name}
      </Button>
    ) : (
      <Text>{name}</Text>
    ),
  )
  const counts: RenderElement[] =
    file.added === null || file.deleted === null
      ? [<Text dimColor>binary</Text>]
      : [<Text color={GREEN}>{`+${file.added}`}</Text>, <Text color={RED}>{`−${file.deleted}`}</Text>]
  if (Svg !== undefined && file.added !== null && file.deleted !== null) counts.push(<Svg source={svgDiffstat(file.added, file.deleted)} alt={`+${file.added} −${file.deleted}`} width={DIFFSTAT_W} height={FILE_ROW_H} />)
  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text dimColor>{canToggle ? (isOpen ? '▾' : '▸') : ' '}</Text>
      {Svg !== undefined ? (
        <Svg source={svgLetter(file.status, colour)} alt={`status ${file.status}`} width={LETTER_W} height={FILE_ROW_H} />
      ) : (
        <Text color={colour} bold>
          {file.status}
        </Text>
      )}
      <Box flexDirection="row" flexGrow={1}>
        {path}
      </Box>
      {counts}
    </Box>
  )
}

/**
 * The actions, a row per group: the group's name in a fixed-width column (orange for the one that rewrites the
 * branch), its buttons beside it drawn as the toolbar's (plain, dim, a glyph and a word, a space apart), a hairline
 * between rows. A confirm line takes its group's row; one for a branch delete (started in the header) sits above the
 * rows.
 */
function drawActions(table: ElementTable, surface: RenderSurface, Svg: Elements['desktop']['Svg'] | undefined, commit: Commit, model: Model, act: Actions, isCompact: boolean): RenderElement[] {
  const { Box, Text, Button } = table
  // One started on the Branches card draws there, not here.
  const pending = model.pending !== null && model.pending.hash === commit.hash && model.pending.site !== 'branches' ? model.pending : null
  const groups = actionGroups(commit, model.head, relationTo(commit.hash, model.commits, model.headHash))
  const rows: RenderElement[] = []
  groups.forEach((group, index) => {
    if (index > 0 && Svg !== undefined) rows.push(<Svg key={`rule:${group.id}`} source={svgRule(RULE)} alt="rule" height={RULE_H} />)
    if (pending !== null && holds(group, pending)) {
      rows.push(drawConfirm(table, surface, pending, model, act))
      return
    }
    const colour = group.isWarning ? ORANGE : DIM
    const title = clip(group.title, LABEL_CHARS)
    rows.push(
      <Box key={`group:${group.id}`} flexDirection="row" gap={1} alignItems="center">
        {Svg !== undefined ? <Svg source={svgLabel(title, colour)} alt={group.title} width={LABEL_W} height={LABEL_H} /> : <Text color={colour}>{title}</Text>}
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" flexGrow={1}>
          {spaced(
            Text,
            group.actions.map(action => (
              <Button plain dimColor key={`act:${action.kind}`} onPress={() => act.start(action.kind, commit.hash)}>
                {glyphOnly(LABELS[action.kind], isCompact)}
              </Button>
            )),
          )}
        </Box>
      </Box>,
    )
  })
  const out: RenderElement[] = []
  if (pending !== null && !groups.some(group => holds(group, pending))) {
    out.push(drawConfirm(table, surface, pending, model, act))
    if (Svg !== undefined) out.push(<Svg key="confirm-gap" source={svgSpace(10)} alt="space" height={10} />)
  }
  out.push(
    <Box key="actions" flexDirection="column">
      {rows}
    </Box>,
  )
  return out
}

export function drawConfirm(table: ElementTable, surface: RenderSurface, pending: Pending, model: Model, act: Actions): RenderElement {
  const { Box, Text, Button } = table
  // The mobile app draws no Input; there the named action shows its prompt without a field.
  const Input = surface === 'mobile' ? undefined : (table as Elements['desktop']).Input
  const isNamed = NAMED_KINDS.includes(pending.kind) && Input !== undefined
  // A named action has no line above its field: echoing the name as typed redrew the pane per key, which made the
  // field's focus ring flicker, and the field with its placeholder says enough.
  const line: RenderElement[] = isNamed ? [] : [<Text bold>{describeAction(pending, model.input, model.head)}</Text>]
  // A button like the field's own submit beside it; plain and dim beside the primary Confirm of the other actions.
  const cancel = isNamed ? (
    <Button key="cancel" onPress={() => act.cancel()}>
      Cancel
    </Button>
  ) : (
    <Button plain dimColor key="cancel" onPress={() => act.cancel()}>
      Cancel
    </Button>
  )
  // Why the last confirm did not run (a name git refuses, a failure), in the box beside the field it is about.
  const why: RenderElement[] = model.note === null ? [] : [<Text color={RED}>{model.note}</Text>]
  if (isNamed && Input !== undefined) {
    // The desktop always draws an Input's own submit button beside it, so that button is the confirm, with Cancel on
    // the same row: a separate Confirm under it did the same thing twice.
    line.push(
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Input
          key="name"
          placeholder={pending.kind === 'tag' ? `Tag Name For ${pending.hash.slice(0, 7)}` : pending.kind === 'rename-branch' ? `New Name For ${capitalize(pending.target ?? 'the branch')}` : 'New Branch Name'}
          value={model.input}
          submitLabel="✓ Confirm"
          // Focus on opening only, so a redraw while typing does not hand the field its focus again.
          {...(model.input === '' ? { autoFocus: true } : {})}
          onInput={(value: string) => act.setInput(value)}
          onSubmit={() => act.confirm()}
        />
        {cancel}
      </Box>,
      ...why,
    )
  } else
    line.push(
      ...why,
      <Box flexDirection="row" gap={1}>
        <Button variant="primary" key="confirm" onPress={() => act.confirm()}>
          {pending.force === true ? '✕ Delete Anyway' : '✓ Confirm'}
        </Button>
        {cancel}
      </Box>,
    )
  return (
    <Box key="confirm-line" flexDirection="column" gap={1} borderStyle="round" borderColor={ORANGE}>
      {line}
    </Box>
  )
}
