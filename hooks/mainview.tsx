import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Commit, MainRow, OpenMerge } from '../types'
import { drawIncomingBand } from './band'
import { GREEN, HOVER, INCOMING_BG, ORANGE, RED, ago, clip, initials, pill, refChips } from './chips'
import type { Lanes } from './graph'
import { clashLabel } from './incoming'
import { MERGE_COMMITS_SHOWN } from './mainline'
import { TRUNK, personColor } from './people'
import { AVATAR, LANE_W, ROW_H, svgAvatar, svgRow } from './svg'

export type MainModel = {
  rows: MainRow[]
  open: OpenMerge | null
  selected: string | null
  incoming: string[]
  clashes: Record<string, string[]>
  you: string
  columns: number
  isBusy: boolean
}
export type MainActions = { pick: (hash: string) => void; toggleMerge: (hash: string) => void; pull: () => void }

const MAX_AVATARS = 2

/**
 * The Main line view's rows: every row is one trunk dot with its author's colour; a merge is a ring, its PR's size
 * and authors beside it, and opens in place to its commits as plain text. Not-pulled rows keep the band, the dashed
 * dot and the clash ring. `details` draws the selected commit's detail under a plain row.
 */
export function drawMainRows(table: ElementTable, surface: RenderSurface, model: MainModel, act: MainActions, details: (commit: Commit) => RenderElement[]): RenderElement[] {
  const { Box, Text, Button } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const incoming = new Set(model.incoming)
  const body: RenderElement[] = []
  let isBandDrawn = false
  for (let index = 0; index < model.rows.length; index++) {
    const { commit, merge } = model.rows[index]!
    const isIncoming = incoming.has(commit.hash)
    const clash = model.clashes[commit.hash]
    const dot = personColor(commit.author, model.you)
    const lanes: Lanes = { lane: 0, fromAbove: index > 0, continues: index < model.rows.length - 1, joins: [], down: [], passing: [], width: 1 }
    const style = { isMerge: merge !== null, isIncoming, dot, below: TRUNK, ...(clash === undefined ? {} : { ring: ORANGE }) }
    const graph =
      Svg !== undefined ? <Svg source={svgRow(lanes, 1, () => TRUNK, style)} alt="commit graph" width={LANE_W} height={ROW_H} /> : <Text color={dot}>{merge !== null ? '○' : '●'}</Text>
    const people = merge !== null && merge.authors.length > 0 ? merge.authors.slice(0, MAX_AVATARS) : [commit.author]
    const avatars = people.map(name =>
      Svg !== undefined ? <Svg source={svgAvatar(initials(name), name, personColor(name, model.you))} alt={`avatar ${initials(name)}`} width={AVATAR} height={AVATAR} /> : <Text color={personColor(name, model.you)}>{initials(name)}</Text>,
    )
    const clashText: RenderElement[] = clash === undefined ? [] : [<Text color={ORANGE}>{clashLabel(clash)}</Text>]
    const isOpen = merge !== null && model.open?.hash === commit.hash
    const room = model.columns > 70 ? 60 : 30
    const title =
      merge === null ? (
        <Button plain key={`c:${commit.hash}`} dimColor={commit.hash !== model.selected && model.selected !== null} onPress={() => act.pick(commit.hash)}>
          {clip(commit.subject, room)}
        </Button>
      ) : (
        <Button plain key={`m:${commit.hash}`} onPress={() => act.toggleMerge(commit.hash)}>
          {`${isOpen ? '▾' : '▸'} ${merge.number === null ? '' : `#${merge.number} `}${clip(merge.label, room)}`}
        </Button>
      )
    const stats: RenderElement[] =
      merge === null
        ? []
        : [
            <Text color={GREEN}>{`+${merge.additions}`}</Text>,
            <Text color={RED}>{`−${merge.deletions}`}</Text>,
            ...(merge.count > 0 ? [<Text dimColor>{`${merge.count} ${merge.count === 1 ? 'commit' : 'commits'}`}</Text>] : []),
          ]
    const chips = refChips(commit.refs, 1, 12)
    if (isIncoming && !isBandDrawn) {
      isBandDrawn = true
      body.push(drawIncomingBand(table, model.incoming.length, model.isBusy, act.pull))
    }
    body.push(
      <Box key={`main:${commit.hash}`} flexDirection="row" alignItems="center" gap={1} hover={{ backgroundColor: HOVER }} {...(isIncoming ? { backgroundColor: INCOMING_BG } : {})}>
        <Box flexShrink={0}>{graph}</Box>
        <Box flexDirection="row" flexShrink={0}>
          {avatars}
        </Box>
        <Box flexDirection="row" alignItems="center" flexGrow={1} flexShrink={1} overflow="hidden">
          {title}
        </Box>
        <Box flexDirection="row" alignItems="center" flexShrink={0} gap={1}>
          {chips.map(chip => pill(table, Svg, chip))}
          {clashText}
          {stats}
          <Text dimColor>{ago(commit.date)}</Text>
        </Box>
      </Box>,
    )
    if (isOpen && model.open !== null) {
      const shown = model.open.commits.slice(0, MERGE_COMMITS_SHOWN)
      for (const inner of shown) {
        body.push(
          <Box key={`mc:${inner.hash}`} flexDirection="row" gap={1} marginLeft={4}>
            <Text dimColor>{`• ${clip(inner.subject, room)}`}</Text>
            <Text dimColor>{inner.author}</Text>
          </Box>,
        )
      }
      const more = (merge?.count ?? 0) - shown.length
      if (more > 0)
        body.push(
          <Box key={`mc-more:${commit.hash}`} marginLeft={4}>
            <Text dimColor>{`+ ${more} more`}</Text>
          </Box>,
        )
    }
    if (merge === null && commit.hash === model.selected) body.push(...details(commit))
  }
  // None of the rows is incoming (the incoming commits are inside a PR or past the cap): the band still tops the list.
  if (!isBandDrawn && model.incoming.length > 0) body.unshift(drawIncomingBand(table, model.incoming.length, model.isBusy, act.pull))
  return body
}
