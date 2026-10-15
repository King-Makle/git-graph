import type { ElementTable, RenderElement } from 'claude-code'

import { BAND_BG, BLUE_TEXT, GLYPH } from './chips'

/** The band above the first row not pulled yet: how many are coming, and Pull. While a sync runs the button is a word. */
export function drawIncomingBand(table: ElementTable, count: number, isBusy: boolean, pull: () => void): RenderElement {
  const { Box, Text, Button } = table
  return (
    <Box key="incoming-band" flexDirection="row" alignItems="center" justifyContent="space-between" paddingX={1} backgroundColor={BAND_BG}>
      <Text color={BLUE_TEXT}>{`↓ ${count} incoming from origin`}</Text>
      {isBusy ? (
        <Text dimColor>Pull</Text>
      ) : (
        <Button plain key="incoming-pull" onPress={pull}>
          {`${GLYPH.pull} Pull`}
        </Button>
      )}
    </Box>
  )
}
