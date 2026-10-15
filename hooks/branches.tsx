import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { BranchInfo, Pending } from '../types'
import { DIM, GREEN, ORANGE, PILL, PURPLE, PURPLE_BG, RED, RULE, glyphOnly } from './chips'
import { drawConfirm } from './detail'
import type { Actions, Model } from './pane'
import { branchNameRoom, branchesStage, clipToPx } from './fit'
import { BRANCH_ROWS } from './budget'
import { drawSection, spaced } from './section'
import { heldBy } from './git'
import { heldLabel } from './worktrees'
import { COUNT_H, ICON, RULE_H, countWidth, svgCount, svgIcon, svgRule } from './svg'


export type BranchesActions = {
  toggleBranches: () => void
  /** Draws the next BRANCH_ROWS rows. */
  showMoreBranches: () => void
  /** Opens a rename (the branch you are on) or a delete confirm line on the card, for that branch. */
  startBranch: (kind: 'rename-branch' | 'delete-branch', branch: BranchInfo) => void
}

/** Is this the card's confirm line for that branch? */
const isFor = (pending: Pending | null, name: string): pending is Pending => pending !== null && pending.site === 'branches' && pending.target === name

/**
 * The Branches card, opened from the header: a row per local branch, the one you are on first and then the newest,
 * each with its state (current, merged into it or not, its remote branch gone), its age, and what can be done to it:
 * rename for the branch you are on, switch and delete for the rest. A delete or rename asks first, in the row's place.
 * `limit` is how many rows the pressable budget leaves (budget.ts); the rest are counted in a line. When the widest
 * row would not fit `columns`, the ages go, then each button shows its glyph alone, so the row's two sides never overlap.
 * A branch checked out in another worktree is purple, with a ⌂ pill saying where; git would refuse its switch and
 * delete, so it offers to open that worktree's folder or copy its path instead (or, its folder gone, to prune it).
 */
export function drawBranches(table: ElementTable, surface: RenderSurface, model: Model, act: Actions, limit: number, columns: number): RenderElement {
  const { Box, Text, Button } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  // A state as a small pill on the desktop, coloured text on the terminal.
  const pill = (label: string, bg: string, fg: string): RenderElement =>
    Svg !== undefined ? <Svg source={svgCount(label, bg, fg)} alt={label} width={countWidth(label)} height={COUNT_H} /> : <Text color={fg === '#ffffff' ? bg : fg}>{label}</Text>
  const rows: RenderElement[] = []
  const shown = model.branchList.slice(0, limit)
  // Only as short as the widest row needs (fit.ts): first the ages go, then the buttons become their glyphs.
  // The worktree that holds each branch, other than this pane's: the pane's own branch is the current one.
  const held = shown.map(branch => (branch.name === model.head ? null : heldBy(model.worktrees, branch.name)))
  const buttonsOf = (index: number, isCurrent: boolean): string[] => {
    const tree = held[index]
    if (isCurrent) return ['✎ Rename']
    if (tree == null) return ['⟁ Switch', '✕ Delete']
    return tree.isGone ? ['⌫ Prune'] : ['⎋ Open', '⧉ Copy Path']
  }
  const measured = shown.map((branch, index) => ({
    name: branch.name,
    marks: branch.upstream.length > 0 && !branch.isGone ? 1 : 0,
    pills: [...(held[index] != null ? [heldLabel(held[index]!)] : []), branch.name === model.head ? '◎ Current' : branch.isMerged ? 'Merged' : 'Not Merged', ...(branch.isGone ? ['Remote Gone'] : [])],
    age: branch.age,
    buttons: buttonsOf(index, branch.name === model.head),
  }))
  const stage = branchesStage(columns, measured, label => glyphOnly(label, true))
  const isCompact = stage >= 2
  // Past that, a name too long for its row is cut with `…` (its row's own room), so it never runs under its pills.
  const nameOf = (index: number, name: string): string => {
    const row = measured[index]
    return isCompact && row !== undefined ? clipToPx(name, branchNameRoom(columns, { ...row, buttons: row.buttons.map(label => glyphOnly(label, true)) }), 15) : name
  }
  shown.forEach((branch, index) => {
    if (index > 0 && Svg !== undefined) rows.push(<Svg key={`branch-rule:${branch.name}`} source={svgRule(RULE)} alt="rule" height={RULE_H} />)
    if (isFor(model.pending, branch.name)) {
      rows.push(drawConfirm(table, surface, model.pending, model, act))
      return
    }
    const isCurrent = branch.name === model.head
    const tree = held[index] ?? null
    const left: RenderElement[] = [
      Svg !== undefined ? <Svg source={svgIcon('branch', tree !== null ? PURPLE : DIM)} alt="branch" width={ICON} height={ICON} /> : <Text color={tree !== null ? PURPLE : DIM}>⎇</Text>,
      <Text bold={isCurrent}>{nameOf(index, branch.name)}</Text>,
    ]
    if (branch.upstream.length > 0 && !branch.isGone) left.push(Svg !== undefined ? <Svg source={svgIcon('cloud', DIM)} alt="on origin" width={ICON} height={ICON} /> : <Text dimColor>☁</Text>)
    if (tree !== null) left.push(tree.isGone ? pill(heldLabel(tree), 'rgba(248,113,113,0.16)', RED) : pill(heldLabel(tree), PURPLE_BG, PURPLE))
    if (isCurrent) left.push(pill('◎ Current', PILL, '#ffffff'))
    else left.push(branch.isMerged ? pill('Merged', 'rgba(74,222,128,0.16)', GREEN) : pill('Not Merged', '#2a2f37', DIM))
    if (branch.isGone) left.push(pill('Remote Gone', 'rgba(249,115,22,0.2)', ORANGE))
    if (stage === 0) left.push(<Text dimColor>{branch.age}</Text>)
    const heldActions: RenderElement[] =
      tree === null
        ? []
        : tree.isGone
          ? [
              <Button plain dimColor key={`branch-prune:${branch.name}`} onPress={() => act.pruneWorktrees()}>
                {glyphOnly('⌫ Prune', isCompact)}
              </Button>,
            ]
          : [
              <Button plain dimColor key={`branch-open:${branch.name}`} onPress={() => act.openWorktree(tree.path)}>
                {glyphOnly('⎋ Open', isCompact)}
              </Button>,
              <Button plain dimColor key={`branch-copy:${branch.name}`} onPress={() => act.copyPath(tree.path, surface)}>
                {glyphOnly('⧉ Copy Path', isCompact)}
              </Button>,
            ]
    const actions: RenderElement[] = tree !== null ? heldActions : isCurrent
      ? [
          <Button plain dimColor key={`branch-rename:${branch.name}`} onPress={() => act.startBranch('rename-branch', branch)}>
            {glyphOnly('✎ Rename', isCompact)}
          </Button>,
        ]
      : [
          <Button plain dimColor key={`branch-switch:${branch.name}`} onPress={() => act.switchBranch(branch.name)}>
            {glyphOnly('⟁ Switch', isCompact)}
          </Button>,
          <Button plain dimColor key={`branch-delete:${branch.name}`} onPress={() => act.startBranch('delete-branch', branch)}>
            {glyphOnly('✕ Delete', isCompact)}
          </Button>,
        ]
    rows.push(
      <Box key={`branch:${branch.name}`} flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" alignItems="center" gap={1}>
          {left}
        </Box>
        <Box flexDirection="row" alignItems="center">
          {spaced(Text, actions)}
        </Box>
      </Box>,
    )
  })
  // Past the rows drawn: one row to draw the next step, as History's Show More.
  const rest = model.branchList.length - shown.length
  if (rest > 0) {
    if (Svg !== undefined) rows.push(<Svg key="branch-rule:more" source={svgRule(RULE)} alt="rule" height={RULE_H} />)
    rows.push(
      <Box key="branches-more-row" flexDirection="row" justifyContent="space-between" alignItems="center">
        <Button plain key="branches-more" onPress={() => act.showMoreBranches()}>
          {`+ Show ${Math.min(BRANCH_ROWS, rest)} More`}
        </Button>
        <Text dimColor>{`${rest} Older`}</Text>
      </Box>,
    )
  }
  if (model.branchList.length === 0) rows.push(<Text dimColor italic>Loading…</Text>)
  const n = model.branchList.length
  return drawSection(table, surface, {
    title: 'Branches',
    count: n === 0 ? undefined : { label: `${n}`, bg: PILL, fg: '#ffffff', title: `${n} local ${n === 1 ? 'branch' : 'branches'}` },
    actions: [
      <Button plain dimColor key="branches-close" onPress={() => act.toggleBranches()}>
        ✕
      </Button>,
    ],
    body: rows,
  })
}
