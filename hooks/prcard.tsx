import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { PullRequest } from '../types'
import { GREEN, RED } from './chips'
import { drawSection } from './section'

export type PrCardActions = { askMerge: () => void; cancelMerge: () => void; mergePr: () => void; closePr: () => void; refreshPr: () => void }
export type PrCardView = { isBusy: boolean; isMerging: boolean; note: string | null }

const YELLOW = '#e2c08d'

function checksLine(pr: PullRequest): { text: string; color: string | undefined } {
  if (pr.checks === 'run') return { text: '● checks running…', color: YELLOW }
  if (pr.checks === 'fail') return { text: `✕ ${pr.failing} ${pr.failing === 1 ? 'check' : 'checks'} failing`, color: RED }
  if (pr.checks === 'none') return { text: 'no checks', color: undefined }
  return { text: '✓ checks passing', color: GREEN }
}

/** The open pull request as a card: its number (a link), title, branches and totals, the checks, then Merge and Close; Merge asks in place of the two buttons. Pure. */
export function drawPrCard(table: ElementTable, surface: RenderSurface, pr: PullRequest, view: PrCardView, act: PrCardActions): RenderElement {
  const { Box, Text, Button, Link } = table
  const checks = checksLine(pr)
  const commits = `${pr.commits} ${pr.commits === 1 ? 'commit' : 'commits'}`
  const lines: RenderElement[] = [
    <Box flexDirection="row" alignItems="center" gap={1}>
      <Link href={pr.url} label={`#${pr.number} ↗`} />
      <Text bold>{pr.title}</Text>
    </Box>,
    <Text dimColor>{`${pr.base} · ${commits} · +${pr.additions} −${pr.deletions}`}</Text>,
    <Box flexDirection="row" gap={1}>
      {checks.color === undefined ? <Text dimColor>{checks.text}</Text> : <Text color={checks.color}>{checks.text}</Text>}
      {pr.hasConflicts ? <Text color={RED}>has conflicts</Text> : <Text dimColor>no conflicts</Text>}
    </Box>,
  ]
  let controls: RenderElement
  if (view.isBusy) controls = <Text dimColor>Working…</Text>
  else if (view.isMerging)
    controls = (
      <Box flexDirection="column" gap={1}>
        <Text>{`Merge into ${pr.base}? The ${commits} become one and the branch is deleted.`}</Text>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Button variant="primary" key="pr-merge-yes" onPress={() => act.mergePr()}>
            {pr.checks === 'fail' ? 'Merge Anyway' : 'Merge'}
          </Button>
          <Button key="pr-merge-no" onPress={() => act.cancelMerge()}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  else
    controls = (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button variant="primary" key="pr-merge" onPress={() => act.askMerge()}>
          Merge
        </Button>
        <Button key="pr-close" onPress={() => act.closePr()}>
          Close
        </Button>
      </Box>
    )
  lines.push(controls)
  if (view.note !== null) lines.push(<Text color={RED}>{view.note}</Text>)
  return drawSection(table, surface, {
    title: 'Pull Request',
    actions: [
      <Button plain key="pr-refresh" dimColor onPress={() => act.refreshPr()}>
        ↻
      </Button>,
    ],
    body: [
      <Box key="pr-text" flexDirection="column" gap={1} paddingX={1} paddingBottom={1}>
        {lines}
      </Box>,
    ],
  })
}
