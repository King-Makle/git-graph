import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Stash } from '../types'
import { HOVER } from './chips'
import { drawSection } from './section'
import { LANE_W, ROW_H, svgStashMarker } from './svg'

// Stash rows drawn with buttons (three each); the rest are text. See budget.ts.
export const STASH_ROWS = 8
const TEAL = '#22d3ee'
const TEAL_BG = 'rgba(34,211,238,0.18)'

export type StashesModel = { stashes: Stash[]; confirmDrop: number | null }

export type StashActions = {
  apply: (index: number) => void
  pop: (index: number) => void
  askDrop: (index: number | null) => void
  drop: (index: number) => void
}

/** The Stashes section as a card: one row per stash with apply, pop and drop as quiet controls; drop asks first. Pure. */
export function drawStashes(table: ElementTable, surface: RenderSurface, model: StashesModel, act: StashActions): RenderElement {
  const { Box, Text, Button } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const marker = () => (Svg !== undefined ? <Svg source={svgStashMarker()} alt="stash" width={LANE_W} height={ROW_H} /> : <Text color={TEAL}>▣</Text>)
  const out: RenderElement[] = []
  model.stashes.forEach((stash, position) => {
    const count = `${stash.files} ${stash.files === 1 ? 'file' : 'files'}`
    if (position >= STASH_ROWS) {
      out.push(
        <Box flexDirection="row" gap={1}>
          <Text color={TEAL}>{`stash@{${stash.index}}`}</Text>
          <Text>{stash.message}</Text>
          <Text dimColor>{count}</Text>
        </Box>,
      )
      return
    }
    out.push(
      <Box key={`stash:${stash.index}`} flexDirection="row" alignItems="center" gap={1} hover={{ backgroundColor: HOVER }}>
        {marker()}
        <Text color={TEAL}>{`stash@{${stash.index}}`}</Text>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">{stash.message}</Text>
        </Box>
        <Text dimColor>{count}</Text>
        <Button plain key={`stash-apply:${stash.index}`} dimColor onPress={() => act.apply(stash.index)}>
          Apply
        </Button>
        <Button plain key={`stash-pop:${stash.index}`} dimColor onPress={() => act.pop(stash.index)}>
          Pop
        </Button>
        <Button plain key={`stash-drop:${stash.index}`} dimColor onPress={() => act.askDrop(stash.index)}>
          Drop
        </Button>
      </Box>,
    )
    if (model.confirmDrop === stash.index)
      out.push(
        <Box flexDirection="column" gap={1} marginX={1} marginBottom={1} paddingX={1} borderStyle="round" borderColor="#f97316">
          <Text bold>{`Drop stash@{${stash.index}}? Its changes are gone for good.`}</Text>
          <Box flexDirection="row" gap={1}>
            <Button variant="primary" key="drop-yes" onPress={() => act.drop(stash.index)}>
              Drop
            </Button>
            <Button key="drop-no" onPress={() => act.askDrop(null)}>
              Cancel
            </Button>
          </Box>
        </Box>,
      )
  })
  if (model.stashes.length > STASH_ROWS)
    out.push(
      <Box>
        <Text dimColor italic>{`${model.stashes.length - STASH_ROWS} more stashes; see git stash list.`}</Text>
      </Box>,
    )
  return drawSection(table, surface, { title: 'Stashes', count: { label: `${model.stashes.length}`, bg: TEAL_BG, fg: TEAL, title: `${model.stashes.length} ${model.stashes.length === 1 ? 'stash' : 'stashes'}` }, body: out })
}
