import React, { memo } from 'react';
import { View } from 'react-native';

import { Chip, ControlRow } from '../Controls';
import type { ChartConfig } from '../config/useChartConfig';
import type { InteractionConfig } from '../config/useInteractionConfig';

type Props = {
  interaction: InteractionConfig;
  chart: ChartConfig;
  muted: string;
  chartViewSupportsScrubNumberFlow: boolean;
  chartViewSupportsScrubHaptics: boolean;
  chartViewSupportsSnap: boolean;
};

function InteractionControlsSectionInner({
  interaction,
  chart,
  muted,
  chartViewSupportsScrubNumberFlow,
  chartViewSupportsScrubHaptics,
  chartViewSupportsSnap,
}: Props) {
  return (
    <View>
      <ControlRow label="Scrub" labelColor={muted}>
        <Chip
          active={chartViewSupportsScrubNumberFlow && interaction.scrubNumberFlow}
          label="Num flow"
          onPress={() => interaction.setScrubNumberFlow((p) => !p)}
          disabled={!chartViewSupportsScrubNumberFlow}
          theme={chart.theme}
          accent={chart.accent}
        />
        <Chip
          active={chartViewSupportsScrubHaptics && interaction.scrubHaptics}
          label="Haptics"
          onPress={() => interaction.setScrubHaptics((p) => !p)}
          disabled={!chartViewSupportsScrubHaptics}
          theme={chart.theme}
          accent={chart.accent}
        />
        <Chip
          active={chartViewSupportsSnap && interaction.snapToPointScrubbing}
          label="Snap"
          onPress={() => interaction.setSnapToPointScrubbing((p) => !p)}
          disabled={!chartViewSupportsSnap}
          theme={chart.theme}
          accent={chart.accent}
        />
        <Chip
          active={interaction.pinchToZoom}
          label="Pinch"
          onPress={() => interaction.setPinchToZoom((p) => !p)}
          theme={chart.theme}
          accent={chart.accent}
        />
        <Chip
          active={chart.showReferenceLine}
          label="Ref line"
          onPress={() => chart.setShowReferenceLine(!chart.showReferenceLine)}
          theme={chart.theme}
          accent={chart.accent}
        />
      </ControlRow>
    </View>
  );
}

export const InteractionControlsSection = memo(InteractionControlsSectionInner);
