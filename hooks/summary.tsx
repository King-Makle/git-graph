import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Summary } from '../types'
import { RED, RULE, look } from './chips'
import { drawSection } from './section'

export type SummaryActions = {
  copySummary: (surface: RenderSurface) => void
  closeSummary: () => void
  setSummaryTitle: (text: string) => void
  createPr: () => void
}
/** `canCreate`: gh is signed in; `isGhMissing`: it is known not to be. A mobile surface cannot edit, so it never creates. */
export type SummaryView = { rev: number; caret: number | null; note: string | null; isBusy: boolean; canCreate: boolean; isGhMissing: boolean }

// The description's field: a little darker than the card, like the commit message's.
const FIELD_BG = '#1a1d22'

/** The drafted pull request text as a card under the header: the base, the title in a field whose submit is Create PR, the description in the mod's own editor, and copy and close. Pure. */
export function drawSummary(table: ElementTable, surface: RenderSurface, summary: Summary, view: SummaryView, act: SummaryActions): RenderElement {
  const { Box, Text, Button } = table
  const Input = surface === 'mobile' ? undefined : (table as Elements['desktop']).Input
  const Client = surface === 'mobile' || !look.editor ? undefined : (table as Elements['desktop']).Client
  const lines: RenderElement[] = [<Text dimColor>{`${summary.branch} ahead of ${summary.base}`}</Text>]
  if (view.canCreate && Input !== undefined)
    lines.push(
      <Box flexDirection="row" alignItems="center">
        <Input key="summary-title" placeholder="Title" value={summary.title} submitLabel={view.isBusy ? 'Creating…' : 'Create PR'} onInput={(value: string) => act.setSummaryTitle(value)} onSubmit={() => act.createPr()} />
      </Box>,
    )
  else lines.push(<Text bold>{summary.title}</Text>)
  if (view.canCreate && Client !== undefined)
    lines.push(
      <Box key="summary-box" flexDirection="column" borderStyle="round" borderColor={RULE} backgroundColor={FIELD_BG}>
        <Client key="summary-editor" module="./editor.tsx" width="100%" props={{ text: summary.description, rev: view.rev, caret: view.caret, placeholder: 'Describe the change' }} />
      </Box>,
    )
  else if (summary.description.length > 0) lines.push(<Text>{summary.description}</Text>)
  if (view.isGhMissing && surface !== 'mobile') lines.push(<Text dimColor>gh is not signed in: copy the text, or run gh auth login to create the pull request from here.</Text>)
  if (view.note !== null) lines.push(<Text color={RED}>{view.note}</Text>)
  return drawSection(table, surface, {
    title: 'Summary',
    actions: [
      <Button plain key="summary-copy" dimColor onPress={() => act.copySummary(surface)}>
        Copy
      </Button>,
      <Button plain key="summary-close" dimColor role="dismiss" onPress={() => act.closeSummary()}>
        Close
      </Button>,
    ],
    body: [
      <Box key="summary-text" flexDirection="column" gap={1} paddingX={1} paddingBottom={1}>
        {lines}
      </Box>,
    ],
  })
}
