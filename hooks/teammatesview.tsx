import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { OpenTeammate, Teammate } from '../types'
import { DIM, GREEN, HOVER, PILL, RED, clip, initials } from './chips'
import { personColor } from './people'
import { drawSection } from './section'
import { AVATAR, COUNT_H, countWidth, svgAvatar, svgCount } from './svg'
import { SHOWN_FILES, TEAMMATE_ROWS, agoSeconds, branchUrl, checkMark } from './teammates'

export type TeammatesView = { items: Teammate[]; open: OpenTeammate | null; you: string; head: string; remote: string; columns: number; now: number }
export type TeammatesActions = { toggle: (branch: string) => void; checkout: (branch: string) => void; refresh: () => void }

const YELLOW = '#e2c08d'
const LAVENDER = '#c4b5fd'
const GREY_BG = '#2a2f37'

const checkColor = (checks: 'pass' | 'run' | 'fail' | 'none'): string => (checks === 'pass' ? GREEN : checks === 'run' ? YELLOW : checks === 'fail' ? RED : DIM)

/**
 * Other people's work in flight, as a card above History: a row per branch (their avatar colour, the branch as the
 * button, ahead count, PR and checks, age); one row opens in place to its PR title, commits and files as plain text,
 * then Check Out and Open On GitHub. Pure.
 */
export function drawTeammates(table: ElementTable, surface: RenderSurface, view: TeammatesView, act: TeammatesActions): RenderElement {
  const { Box, Text, Button } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const room = view.columns > 70 ? 36 : 22
  const pill = (label: string, bg: string, fg: string, alt: string): RenderElement =>
    Svg !== undefined ? <Svg source={svgCount(label, bg, fg)} alt={alt} width={countWidth(label)} height={COUNT_H} /> : <Text color={fg} bold>{label}</Text>
  const body: RenderElement[] = []
  for (const item of view.items.slice(0, TEAMMATE_ROWS)) {
    const isOpen = view.open?.branch === item.branch
    const colour = personColor(item.author, view.you)
    const who = initials(item.author)
    const bits: RenderElement[] = []
    if (item.ahead > 0) bits.push(pill(`↑${item.ahead}`, GREY_BG, DIM, `ahead ${item.ahead}`))
    if (item.pr === null) bits.push(pill('No PR', GREY_BG, DIM, 'no pull request'))
    else {
      const state = item.pr.isDraft ? 'Draft' : 'Open'
      bits.push(pill(`#${item.pr.number} ${state}`, item.pr.isDraft ? GREY_BG : PILL, item.pr.isDraft ? DIM : '#ffffff', `pull request ${item.pr.number} ${state.toLowerCase()}`))
      const mark = checkMark(item.pr.checks)
      if (mark !== '') bits.push(<Text color={checkColor(item.pr.checks)}>{mark}</Text>)
    }
    body.push(
      <Box key={`teammate:${item.branch}`} flexDirection="row" alignItems="center" gap={1} hover={{ backgroundColor: HOVER }}>
        {Svg !== undefined ? <Svg source={svgAvatar(who, item.author, colour)} alt={`avatar ${who}`} width={AVATAR} height={AVATAR} /> : <Text color={colour}>{who}</Text>}
        <Box flexDirection="row" alignItems="center" flexGrow={1} flexShrink={1} overflow="hidden">
          <Button plain key={`t:${item.branch}`} onPress={() => act.toggle(item.branch)}>
            {`${isOpen ? '▾' : '▸'} ${clip(item.branch, room)}`}
          </Button>
        </Box>
        <Box flexDirection="row" alignItems="center" flexShrink={0} gap={1}>
          {bits}
          <Text dimColor>{agoSeconds(item.updated, view.now)}</Text>
        </Box>
      </Box>,
    )
    if (isOpen && view.open !== null) body.push(drawOpen(table, item, view.open, view.remote, item.branch === view.head, act))
  }
  if (view.items.length > TEAMMATE_ROWS)
    body.push(
      <Box key="teammates-more">
        <Text dimColor>{`+ ${view.items.length - TEAMMATE_ROWS} more`}</Text>
      </Box>,
    )
  const refresh = (
    <Button plain key="teammates-refresh" dimColor onPress={() => act.refresh()}>
      ↻
    </Button>
  )
  return drawSection(table, surface, { title: 'Teammates', count: { label: String(view.items.length), bg: GREY_BG, fg: DIM, title: `${view.items.length} active` }, actions: [refresh], body })
}

/** One opened row: the PR title (or that there is none), who asked for a review, its commits and files as text, then the two actions. */
function drawOpen(table: ElementTable, item: Teammate, open: OpenTeammate, remote: string, isCurrent: boolean, act: TeammatesActions): RenderElement {
  const { Box, Text, Button, Link } = table
  const lines: RenderElement[] =
    item.pr === null
      ? [<Text dimColor>No pull request yet</Text>]
      : [
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{item.pr.title}</Text>
            <Text color={GREEN}>{`+${item.pr.additions}`}</Text>
            <Text color={RED}>{`−${item.pr.deletions}`}</Text>
          </Box>,
        ]
  if (item.pr !== null && item.pr.isReviewRequested) lines.push(<Text color={LAVENDER}>review requested from you</Text>)
  for (const entry of open.commits) lines.push(<Text dimColor>{`• ${clip(entry.subject, 70)}  ${entry.author}`}</Text>)
  for (const file of open.files.slice(0, SHOWN_FILES))
    lines.push(
      <Box flexDirection="row" gap={1}>
        <Text>{clip(file.path, 60)}</Text>
        <Text color={GREEN}>{`+${file.additions}`}</Text>
        <Text color={RED}>{`−${file.deletions}`}</Text>
      </Box>,
    )
  if (open.files.length > SHOWN_FILES) lines.push(<Text dimColor>{`+ ${open.files.length - SHOWN_FILES} more files`}</Text>)
  const url = item.pr !== null && item.pr.url.length > 0 ? item.pr.url : branchUrl(remote, item.branch)
  // The branch you are on has nothing to check out: say so, so a second press is not a silent one.
  const actions: RenderElement[] = [
    isCurrent ? (
      <Text dimColor>checked out</Text>
    ) : (
      <Button key="tm-checkout" onPress={() => act.checkout(item.branch)}>
        Check Out
      </Button>
    ),
  ]
  if (url !== null) actions.push(<Link href={url} label="Open On GitHub ↗" />)
  lines.push(
    <Box flexDirection="row" alignItems="center" gap={1}>
      {actions}
    </Box>,
  )
  return (
    <Box key={`teammate-open:${item.branch}`} flexDirection="column" marginLeft={4}>
      {lines}
    </Box>
  )
}
