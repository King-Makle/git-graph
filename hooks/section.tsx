import type { ElementTable, Elements, RenderElement, RenderSurface } from 'claude-code'

import { CARD_BG, RULE } from './chips'
import { COUNT_H, RULE_H, countWidth, svgCount, svgRule, svgSpace } from './svg'

// Pixels under a card's last row on the desktop: its own inset is 13px and cannot be trimmed, so it is turned off
// (paddingBottom 0 leaves ~2px) and this is drawn instead, for 10px in all (measured live 2026-10-09).
const CARD_BOTTOM = 7

/** Buttons with a space between each: the engine's own gap is a whole cell (~16px, too wide), a space character in the proportional font is ~5px. */
export function spaced(Text: ElementTable['Text'], items: RenderElement[]): RenderElement[] {
  const out: RenderElement[] = []
  items.forEach((item, index) => {
    if (index > 0) out.push(<Text key={`space:${index}`}> </Text>)
    out.push(item)
  })
  return out
}

export type Section = {
  title: string
  /** A count pill after the title: the number, its background and its text colour, and the tooltip that says what it counts. */
  count?: { label: string; bg: string; fg: string; title: string }
  /** Controls at the header row's right edge. */
  actions?: RenderElement[]
  body: RenderElement[]
}

/**
 * One section as a card, the approved look: a rounded, tinted box whose first
 * row is the title, the count pill and the actions at the right, the body under
 * it. The terminal draws the count as coloured text. Pure.
 */
export function drawSection(table: ElementTable, surface: RenderSurface, section: Section): RenderElement {
  const { Box, Text } = table
  const Svg = surface === 'terminal' ? undefined : (table as Elements['desktop']).Svg
  const head: RenderElement[] = [<Text bold>{section.title}</Text>]
  if (section.count !== undefined) {
    const { label, bg, fg, title } = section.count
    // White on a colour is the pill; the terminal has no pill, so it shows the colour itself.
    head.push(Svg !== undefined ? <Svg source={svgCount(label, bg, fg, title)} alt={label} width={countWidth(label)} height={COUNT_H} /> : <Text color={fg === '#ffffff' ? bg : fg} bold>{label}</Text>)
  }
  const header: RenderElement[] = [
    <Box flexDirection="row" alignItems="center" gap={1} flexGrow={1}>
      {head}
    </Box>,
  ]
  if (section.actions !== undefined && section.actions.length > 0)
    header.push(
      <Box flexDirection="row" alignItems="center">
        {spaced(Text, section.actions)}
      </Box>,
    )
  // The engine refuses an empty array child.
  const body = section.body.length > 0 ? [...section.body] : [<Text dimColor>nothing here</Text>]
  // The terminal keeps its own inset and gets no spacer.
  if (Svg !== undefined) body.push(<Svg key="card-bottom" source={svgSpace(CARD_BOTTOM)} alt="space" height={CARD_BOTTOM} />)
  return (
    <Box key={`section:${section.title}`} flexDirection="column" marginX={1} marginTop={1} borderStyle="round" borderColor={RULE} backgroundColor={CARD_BG} {...(Svg !== undefined ? { paddingBottom: 0 } : {})}>
      <Box flexDirection="row" alignItems="center">
        {header}
      </Box>
      {Svg !== undefined ? <Svg source={svgRule(RULE)} alt="rule" height={RULE_H} /> : <Text dimColor>{''}</Text>}
      {body}
    </Box>
  )
}
