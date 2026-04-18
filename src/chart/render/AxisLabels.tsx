import { memo } from 'react';
import { Text } from 'react-native';

import type { ChartPadding, ChartPalette } from '../types';
import type { TrackedGridLabel, TrackedTimeLabel } from './useTrackedAxisLabels';

type AxisLabelsProps = {
  grid: boolean;
  gridLabels: readonly TrackedGridLabel[];
  timeLabels: readonly TrackedTimeLabel[];
  pad: ChartPadding;
  layoutWidth: number;
  baseY: number;
  pal: Pick<ChartPalette, 'gridLabel' | 'timeLabel'>;
  styles: {
    yLabel: object;
    tLabel: object;
  };
};

function AxisLabelsImpl({
  grid,
  gridLabels,
  timeLabels,
  pad,
  layoutWidth,
  baseY,
  pal,
  styles,
}: AxisLabelsProps) {
  return (
    <>
      {grid
        ? gridLabels.map((label) => (
            <Text
              key={`yl${label.key}`}
              style={[
                styles.yLabel,
                {
                  left: layoutWidth - pad.right + 8,
                  top: label.y - 6,
                  color: pal.gridLabel,
                  opacity: label.alpha,
                  fontWeight: label.isCoarse ? ('500' as const) : ('400' as const),
                },
              ]}
            >
              {label.text}
            </Text>
          ))
        : null}

      {timeLabels.map((label) => (
        <Text
          key={`tl${label.key}`}
          style={[
            styles.tLabel,
            {
              left: label.x - label.width / 2,
              top: baseY + 14,
              width: label.width,
              color: pal.timeLabel,
              opacity: label.alpha,
            },
          ]}
        >
          {label.text}
        </Text>
      ))}
    </>
  );
}

export const AxisLabels = memo(AxisLabelsImpl);
