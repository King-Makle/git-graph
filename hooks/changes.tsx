import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { ChangedFile, FileStatus, OpenFile } from '../types'
import { GLYPH, HOVER, RED, RULE, glyphOnly, look } from './chips'
import { drawSection } from './section'
import { groupFiles, tickedFiles } from './selection'
import { COUNT_H, FILE_ROW_H, LETTER_W, countWidth, svgCount, svgLetter, svgSpace } from './svg'

// File rows drawn with buttons (three each: checkbox, name, cross or minus), both groups together; the rest are text. See budget.ts.
export const FILE_ROWS = 30
// VS Code's status colours.
// Pixels of air between the message box and the first file row: with the rows' own leading, as deep as the card's
// inset under the last row (11px each, measured live 2026-10-09).
const MESSAGE_GAP = 4.5
// Pixels between the header's rule and the message box (the rule's own box adds 5 under its line).
const ABOVE_MESSAGE = 5

export const STATUS_COLOR: Record<FileStatus, string> = { M: '#e2c08d', A: '#73c991', U: '#73c991', D: '#f87171', R: '#60a5fa', C: '#f97316' }
// The letter spelled out, as its tooltip.
const STATUS_NAME: Record<FileStatus, string> = { M: 'Modified', A: 'Added', U: 'Untracked', D: 'Deleted', R: 'Renamed', C: 'Conflict' }
const COUNT_BG = '#2b63c8'
// The message field's fill: a little darker than the card, so the box reads as an input.
const FIELD_BG = '#1a1d22'

// Dev probe: how many of the section's elements to draw, to bisect a tree the live desktop refuses.
let probe = Infinity
export function setProbe(level: number): void {
  probe = level
}

export type ChangesModel = {
  head: string
  files: ChangedFile[]
  /** The ticked paths: a selection only, acted on by Commit, Stage and Stash. */
  ticked: string[]
  message: string
  editRev: number
  editCaret: number | null
  /** Bumped on every other press in the pane: the message box drops its caret (it has no focus event). */
  editorBlur?: number
  openFiles: OpenFile[]
  confirmDiscard: string | null
  note: string | null
  /** A model call is drafting the message: ✎ reads as busy and does nothing. */
  isWriting: boolean
  /** A narrow pane: the glyph-and-word buttons show their glyph alone. */
  isCompact?: boolean
}

export type ChangesActions = {
  setMessage: (text: string) => void
  commit: () => void
  write: () => void
  toggleAll: () => void
  stageTicked: () => void
  /** Take one staged file out of the index, or every staged file (null). */
  unstage: (path: string | null) => void
  stash: () => void
  toggleTick: (path: string) => void
  toggleDiff: (path: string) => void
  askDiscard: (path: string | null) => void
  discard: (path: string) => void
}

/** Whether Commit is live; when it is not, the note its press should show. */
export function commitReadiness(model: Pick<ChangesModel, 'message' | 'files' | 'ticked'>): { isReady: boolean; why: string | null } {
  if (model.files.length === 0) return { isReady: false, why: 'Nothing to commit.' }
  if (model.message.trim().length === 0) return { isReady: false, why: 'Type a message first.' }
  if (tickedFiles(model.files, model.ticked).length === 0) return { isReady: false, why: 'Tick the files to commit.' }
  return { isReady: true, why: null }
}

// The subject length git log and GitHub show before cutting a line: a guide for the counter, never a limit.
export const SUBJECT_MAX = 72
// The field shows about this many characters; a longer message is drawn whole under it.
export const FIELD_CHARS = 24

/**
 * The counter beside the message, `12/72 · 3 files`: the subject's length out of 72 (the 72 is the subject's guide and a
 * body has none), then the ticked files a Commit would take. The count lives here, not in the Commit label, so that
 * button keeps one width and Write beside it does not move. Null when there is neither.
 */
export function messageCount(message: string, ticked: number): string | null {
  const trimmed = message.trim()
  const parts: string[] = []
  if (trimmed.length > 0) parts.push(`${(trimmed.split('\n')[0] ?? '').trim().length}/${SUBJECT_MAX}`)
  if (ticked > 0) parts.push(`${ticked} ${ticked === 1 ? 'file' : 'files'}`)
  return parts.length === 0 ? null : parts.join(' · ')
}

export function splitPath(path: string): { name: string; dir: string } {
  // git lists an untracked directory as `dir/`: the slash belongs to the name.
  const at = path.endsWith('/') ? path.lastIndexOf('/', path.length - 2) : path.lastIndexOf('/')
  return at === -1 ? { name: path, dir: '' } : { name: path.slice(at + 1), dir: path.slice(0, at) }
}

/** A space either side of a label: the engine's own padding is whole cells (too wide), a space is ~5px, and Write and Commit take the same. */
const air = (label: string): string => ` ${label} `

/**
 * Commit: a plain button like Write beside it, with the same air around its words. Dim until it is ready (a press then
 * only explains why); ready it is full strength. Its label never changes, so Write does not shift when the ticks do (the
 * file count is in the counter). A Button takes no colour, so ready is the difference between dim and bright text.
 */
function commitButton(table: ElementTable, model: Pick<ChangesModel, 'message' | 'files' | 'ticked'>, act: Pick<ChangesActions, 'commit'>): RenderElement {
  const { Button } = table
  const isReady = commitReadiness(model).isReady
  return (
    <Button plain key="commit" dimColor={!isReady} onPress={() => act.commit()}>
      {air('Commit')}
    </Button>
  )
}

/**
 * The row under the message: the note (red) or the subject counter on the left, Write and then Commit on the right.
 * With the editor it sits inside the message box, like a composer's action bar (the bordered box insets it already);
 * under the one-line Input it stands alone and Commit is the field's own submit. Pure.
 */
export function drawMessageFooter(
  table: ElementTable,
  model: Pick<ChangesModel, 'message' | 'note' | 'files' | 'ticked' | 'isWriting' | 'isCompact'>,
  act: Pick<ChangesActions, 'write' | 'commit'>,
  withCommit: boolean,
): RenderElement {
  const { Box, Text, Button } = table
  const count = messageCount(model.message, tickedFiles(model.files, model.ticked).length)
  const left = model.note !== null ? <Text color={RED}>{model.note}</Text> : count !== null ? <Text dimColor>{count}</Text> : <Text> </Text>
  // ✎ has a model draft the message (subject and body) from the diff; a quiet button like the toolbar's, a word while it works.
  const buttons: RenderElement[] = [
    <Button plain key="write" dimColor onPress={() => act.write()}>
      {air(model.isWriting ? (model.isCompact === true ? '✎…' : '✎ Writing…') : glyphOnly('✎ Write', model.isCompact === true))}
    </Button>,
  ]
  if (withCommit) buttons.push(commitButton(table, model, act))
  return (
    <Box key="message-footer" flexDirection="row" alignItems="center" justifyContent="space-between" {...(withCommit ? {} : { paddingX: 1 })}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        {left}
      </Box>
      <Box flexDirection="row" alignItems="center" gap={1}>
        {buttons}
      </Box>
    </Box>
  )
}

/** The Changes section as a card: title, count and the all / stash controls in its header; the message with Commit beside it, then one row per changed file or a note. Pure. */
export function drawChanges(table: ElementTable, surface: RenderSurface, model: ChangesModel, act: ChangesActions): RenderElement {
  const { Box, Text, Button, Code } = table
  // The mobile app draws no Input.
  const Input = surface === 'mobile' ? undefined : (table as Elements['desktop']).Input
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  // The message box: the mod's own multi-line editor where a Client is drawn (terminal and desktop), the Input otherwise.
  const Client = surface === 'mobile' || !look.editor ? undefined : (table as Elements['desktop']).Client
  // The letter at a fixed width on the desktop, so a narrow `U` does not shift its name.
  const letter = (status: FileStatus): RenderElement =>
    Svg !== undefined ? (
      <Svg source={svgLetter(status, STATUS_COLOR[status], STATUS_NAME[status])} alt={`status ${status}`} width={LETTER_W} height={FILE_ROW_H} />
    ) : (
      <Text color={STATUS_COLOR[status]} bold>
        {status}
      </Text>
    )
  const commit = commitButton(table, model, act)
  const out: RenderElement[] = []
  // Air between the header's rule and the message box: a few pixels of Svg on the desktop (a margin is a whole cell).
  if (Client !== undefined) out.push(Svg !== undefined ? <Svg key="message-top" source={svgSpace(ABOVE_MESSAGE)} alt="space" height={ABOVE_MESSAGE} /> : <Box key="message-top" marginTop={1} />)
  if (Client !== undefined)
    out.push(
      // A bordered box keeps it looking like a field. The editor fills it edge to edge: only the Client's own region takes the
      // keyboard, so anything drawn around it (air above and below, 2026-10-05) is a dead strip that a click does not focus.
      // The box runs the card's full width, edge to edge with the hover pills of the checkbox and the cross below it.
      <Box key="message-box" flexDirection="column" borderStyle="round" borderColor={RULE} backgroundColor={FIELD_BG}>
        <Client key="message-editor" module="./editor.tsx" width="100%" props={{ text: model.message, rev: model.editRev, caret: model.editCaret, placeholder: 'Write a commit message', blur: model.editorBlur ?? 0 }} />
        {drawMessageFooter(table, model, act, true)}
      </Box>,
    )
  else if (Input !== undefined)
    out.push(
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Input key="message" placeholder="Message (⏎ to commit)" value={model.message} submitLabel="Commit" onInput={(value: string) => act.setMessage(value)} onSubmit={() => act.commit()} />
      </Box>,
    )
  // The field is ~300px and cannot show a longer message, so past FIELD_CHARS the whole of it is drawn
  // under the field, wrapped. The one-line Input has no room for a footer, so Write and the note stand under it;
  // with the editor they are inside its box.
  if (Input !== undefined && Client === undefined) {
    if (model.message.trim().length > FIELD_CHARS)
      out.push(
        <Box paddingX={1}>
          <Text>{model.message}</Text>
        </Box>,
      )
    out.push(drawMessageFooter(table, model, act, false))
  }
  if (Svg !== undefined) out.push(<Svg key="message-gap" source={svgSpace(MESSAGE_GAP)} alt="space" height={MESSAGE_GAP} />)
  if (Input === undefined)
    out.push(
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text dimColor italic>
          Type the commit message from a desktop or terminal session.
        </Text>
        {commit}
      </Box>,
    )
  if (model.note !== null && Input === undefined)
    out.push(
      <Box>
        <Text color={RED}>{model.note}</Text>
      </Box>,
    )
  if (model.files.length === 0)
    out.push(
      <Box>
        <Text dimColor italic>
          No changes
        </Text>
      </Box>,
    )
  const { staged, changes } = groupFiles(model.files)
  const isTicked = (file: ChangedFile): boolean => model.ticked.includes(file.path)
  // A small count pill after a group's title, as a section card has.
  const count = (n: number): RenderElement =>
    Svg !== undefined ? <Svg source={svgCount(`${n}`, COUNT_BG, '#ffffff', `${n} ${n === 1 ? 'file' : 'files'}`)} alt={`${n}`} width={countWidth(`${n}`)} height={COUNT_H} /> : <Text color={COUNT_BG} bold>{`${n}`}</Text>
  const groupHeader = (title: string, n: number, actions: RenderElement[]): RenderElement => (
    <Box key={`group:${title}`} flexDirection="row" alignItems="center" gap={1} marginTop={1}>
      <Box flexDirection="row" alignItems="center" gap={1} flexGrow={1}>
        <Text bold>{title}</Text>
        {count(n)}
      </Box>
      {actions}
    </Box>
  )
  let drawn = 0
  const shown = new Set<string>()
  // One row, a checkbox that only selects, the status letter, the name (its diff), the folder, and the cross or minus.
  const fileRow = (file: ChangedFile, group: 'staged' | 'changes'): void => {
    const { name, dir } = splitPath(file.path)
    const status = group === 'staged' ? file.status : file.treeStatus ?? file.status
    if (drawn >= FILE_ROWS) {
      out.push(
        <Box flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[status]} bold>
            {status}
          </Text>
          <Text>{name}</Text>
          <Text dimColor>{dir}</Text>
        </Box>,
      )
      drawn++
      return
    }
    drawn++
    // A file edited since it was staged is in both groups, so the staged group's keys carry a prefix.
    const k = group === 'staged' ? 's-' : ''
    out.push(
      // The row lights as a whole on hover, as slim as the pills inside it (FILE_ROW_H). A Box's fill cannot have rounded corners:
      // a round border would, but it made each row ~19px taller and pushed the columns right (measured 2026-10-05).
      <Box key={`${k}row:${file.path}`} flexDirection="row" alignItems="center" hover={{ backgroundColor: HOVER }}>
        <Button plain key={`${k}tick:${file.path}`} dimColor={!isTicked(file)} onPress={() => act.toggleTick(file.path)}>
          {isTicked(file) ? '☑' : '□'}
        </Button>
        {letter(status)}
        <Button plain key={`${k}file:${file.path}`} onPress={() => act.toggleDiff(file.path)}>
          {name}
        </Button>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {dir}
          </Text>
        </Box>
        {group === 'staged' ? (
          <Button plain key={`s-unstage:${file.path}`} dimColor onPress={() => act.unstage(file.path)}>
            −
          </Button>
        ) : (
          <Button plain key={`discard:${file.path}`} dimColor onPress={() => act.askDiscard(file.path)}>
            ✕
          </Button>
        )}
      </Box>,
    )
    // The diff (against HEAD, so both halves show) opens once, under the first row the file has.
    const open = model.openFiles.find(entry => entry.path === file.path)
    if (open !== undefined && !shown.has(file.path)) {
      shown.add(file.path)
      out.push(
        <Box flexDirection="column" marginLeft={4} marginRight={1} marginBottom={1}>
          {open.diff.length > 0 ? (
            <Code source={open.diff} format="diff" path={file.path} wrap="truncate-end" />
          ) : (
            <Text dimColor italic>
              no text changes
            </Text>
          )}
        </Box>,
      )
    }
    if (group === 'changes' && model.confirmDiscard === file.path)
      out.push(
        <Box flexDirection="column" gap={1} marginX={1} marginBottom={1} paddingX={1} borderStyle="round" borderColor="#f97316">
          <Text bold>{file.status === 'U' ? `Delete untracked ${name}? This cannot be undone.` : `Discard changes to ${name}? This cannot be undone.`}</Text>
          <Box flexDirection="row" gap={1}>
            <Button variant="primary" key="discard-yes" onPress={() => act.discard(file.path)}>
              Discard
            </Button>
            <Button key="discard-no" onPress={() => act.askDiscard(null)}>
              Cancel
            </Button>
          </Box>
        </Box>,
      )
  }
  if (staged.length > 0) {
    out.push(
      groupHeader('Staged Changes', staged.length, [
        <Button plain key="unstage-all" dimColor onPress={() => act.unstage(null)}>
          Unstage All
        </Button>,
      ]),
    )
    staged.forEach(file => fileRow(file, 'staged'))
  }
  if (changes.length > 0) {
    // With nothing staged the one group needs no title of its own beyond the card's.
    if (staged.length > 0) out.push(groupHeader('Changes', changes.length, []))
    changes.forEach(file => fileRow(file, 'changes'))
  }
  const rows = staged.length + changes.length
  if (rows > FILE_ROWS) out.push(<Box><Text dimColor italic>{`${rows - FILE_ROWS} more rows; tick and stage them from the terminal.`}</Text></Box>)
  const allTicked = model.files.length > 0 && model.files.every(isTicked)
  return drawSection(table, surface, {
    title: 'Changes',
    // No pill for a clean tree (a blue 0 says nothing), and none while the groups show their own counts: a third number beside them would read as a total of nothing.
    count: model.files.length === 0 || staged.length > 0 ? undefined : { label: `${model.files.length}`, bg: COUNT_BG, fg: '#ffffff', title: `${model.files.length} changed ${model.files.length === 1 ? 'file' : 'files'}` },
    actions: [
      <Button plain key="all" dimColor onPress={() => act.toggleAll()}>
        {glyphOnly(allTicked ? `${GLYPH.selectNone} None` : `${GLYPH.selectAll} All`, model.isCompact === true)}
      </Button>,
      <Button plain key="stage" dimColor onPress={() => act.stageTicked()}>
        {glyphOnly(`${GLYPH.stage} Stage`, model.isCompact === true)}
      </Button>,
      <Button plain key="stash" dimColor onPress={() => act.stash()}>
        {glyphOnly(`${GLYPH.stash} Stash`, model.isCompact === true)}
      </Button>,
    ],
    body: out.slice(0, Math.max(1, probe)),
  })
}
