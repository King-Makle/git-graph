import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Worktree } from '../types'
import { DIM, GLYPH, ORANGE, PILL, PURPLE, PURPLE_BG, RED, RULE, glyphOnly } from './chips'
import { branchNameRoom, branchesStage, clipToPx } from './fit'
import { drawSection, spaced } from './section'
import { COUNT_H, ICON, RULE_H, countWidth, svgCount, svgIcon, svgRule } from './svg'

export type WorktreesActions = {
  toggleWorktrees: () => void
  /** Shows the folder in Finder. */
  openWorktree: (path: string) => void
  copyPath: (path: string, surface: RenderSurface) => void
  /** Opens (a path) or closes (null) the remove confirm. */
  askRemove: (path: string | null) => void
  removeWorktree: (path: string) => void
  pruneWorktrees: () => void
}

export type WorktreesModel = { worktrees: Worktree[]; confirmRemove: string | null }

const HERE_BG = 'rgba(96,165,250,0.16)'
const HERE_FG = '#60a5fa'

/** The labels a row's kind pill takes: this pane's own, a missing folder, a session's, the main checkout, any other. */
export function kindLabel(tree: Worktree): string {
  if (tree.isHere) return '◎ This Pane'
  if (tree.isGone) return 'Folder Gone'
  if (tree.isSession) return 'Claude Session'
  return tree.isMain ? 'Main Checkout' : 'Worktree'
}

/** A row's buttons: this pane's own can only be copied, a missing one pruned, the main checkout never removed. */
export function worktreeButtons(tree: Worktree): string[] {
  if (tree.isHere) return ['⧉ Copy Path']
  if (tree.isGone) return ['⌫ Prune']
  return tree.isMain ? ['⎋ Open', '⧉ Copy Path'] : ['⎋ Open', '⧉ Copy Path', '✕ Remove']
}

/** The pill on a Branches card row (and the label a History chip carries) for a branch checked out in `tree`. */
export function heldLabel(tree: Worktree): string {
  if (tree.isGone) return `${GLYPH.worktree} Folder Gone`
  return `${GLYPH.worktree} ${tree.isSession ? 'Session' : 'Worktree'}`
}

/**
 * The Worktrees card, opened from the ✿ button beside the header's branch name: every checkout of the repo, this pane's first as git lists
 * the main one, with what each has checked out and what can be done to it. A remove asks first, in the row's place.
 * Narrow, the branch pill goes and the buttons show their glyphs, as on the Branches card. Rows past `limit` (the
 * pressable budget, budget.ts) draw without their buttons.
 */
export function drawWorktrees(table: ElementTable, surface: RenderSurface, model: WorktreesModel, act: WorktreesActions, columns: number, limit = Infinity): RenderElement {
  const { Box, Text, Button } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const pill = (label: string, bg: string, fg: string): RenderElement =>
    Svg !== undefined ? <Svg source={svgCount(label, bg, fg)} alt={label} width={countWidth(label)} height={COUNT_H} /> : <Text color={fg === '#ffffff' ? bg : fg}>{label}</Text>
  const branchOf = (tree: Worktree): string => tree.branch ?? `Detached ${tree.head.slice(0, 7)}`
  const measured = model.worktrees.map(tree => ({ name: tree.folder, marks: 0, pills: [branchOf(tree), kindLabel(tree)], age: '', buttons: worktreeButtons(tree) }))
  const stage = branchesStage(columns, measured, label => glyphOnly(label, true))
  const isCompact = stage >= 2
  const rows: RenderElement[] = []
  model.worktrees.forEach((tree, index) => {
    if (index > 0 && Svg !== undefined) rows.push(<Svg key={`worktree-rule:${tree.path}`} source={svgRule(RULE)} alt="rule" height={RULE_H} />)
    if (model.confirmRemove === tree.path) {
      rows.push(
        <Box key={`worktree-confirm:${tree.path}`} flexDirection="column" gap={1} borderStyle="round" borderColor={ORANGE}>
          <Text bold>{`Remove the worktree ${tree.folder}? Its folder is deleted and the branch stays. Git refuses if it has uncommitted changes.`}</Text>
          <Box flexDirection="row" gap={1}>
            <Button variant="primary" key="worktree-remove-yes" onPress={() => act.removeWorktree(tree.path)}>
              ✕ Remove
            </Button>
            <Button plain dimColor key="worktree-remove-no" onPress={() => act.askRemove(null)}>
              Cancel
            </Button>
          </Box>
        </Box>,
      )
      return
    }
    const row = measured[index]!
    const color = tree.isHere ? '#ffffff' : tree.isGone ? RED : PURPLE
    const name = isCompact ? clipToPx(tree.folder, branchNameRoom(columns, { ...row, pills: [kindLabel(tree)], buttons: row.buttons.map(label => glyphOnly(label, true)) }), 15) : tree.folder
    const left: RenderElement[] = [Svg !== undefined ? <Svg source={svgIcon('folder', color)} alt="folder" width={ICON} height={ICON} /> : <Text color={color}>▭</Text>, <Text bold={tree.isHere}>{name}</Text>]
    if (!isCompact) left.push(tree.branch === null ? pill(branchOf(tree), '#2a2f37', DIM) : tree.isHere ? pill(tree.branch, HERE_BG, HERE_FG) : pill(tree.branch, PURPLE_BG, PURPLE))
    left.push(tree.isHere ? pill(kindLabel(tree), PILL, '#ffffff') : tree.isGone ? pill(kindLabel(tree), 'rgba(248,113,113,0.16)', RED) : tree.isMain ? pill(kindLabel(tree), '#2a2f37', DIM) : pill(kindLabel(tree), PURPLE_BG, PURPLE))
    const press: Record<string, { key: string; run: () => void }> = {
      '⎋ Open': { key: 'open', run: () => act.openWorktree(tree.path) },
      '⧉ Copy Path': { key: 'copy', run: () => act.copyPath(tree.path, surface) },
      '✕ Remove': { key: 'remove', run: () => act.askRemove(tree.path) },
      '⌫ Prune': { key: 'prune', run: () => act.pruneWorktrees() },
    }
    const buttons = (index < limit ? row.buttons : []).map(label => (
      <Button plain dimColor key={`worktree-${press[label]!.key}:${tree.path}`} onPress={press[label]!.run}>
        {glyphOnly(label, isCompact)}
      </Button>
    ))
    rows.push(
      <Box key={`worktree:${tree.path}`} flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" alignItems="center" gap={1}>
          {left}
        </Box>
        <Box flexDirection="row" alignItems="center">
          {spaced(Text, buttons)}
        </Box>
      </Box>,
    )
  })
  if (model.worktrees.length === 0) rows.push(<Text dimColor italic>Loading…</Text>)
  const n = model.worktrees.length
  return drawSection(table, surface, {
    title: 'Worktrees',
    count: n === 0 ? undefined : { label: `${n}`, bg: PILL, fg: '#ffffff', title: `${n} ${n === 1 ? 'checkout' : 'checkouts'} of this repo` },
    actions: [
      <Button plain dimColor key="worktrees-close" onPress={() => act.toggleWorktrees()}>
        ✕
      </Button>,
    ],
    body: rows,
  })
}
