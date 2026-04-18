import {
  DashPathEffect,
  Group,
  Line as SkiaLine,
  vec,
} from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

import type { ChartPadding, ChartPalette } from '../types';
import type { TrackedGridLabel, TrackedTimeLabel } from './useTrackedAxisLabels';

type GridCanvasProps = {
  grid: boolean;
  gridLabels: readonly TrackedGridLabel[];
  timeLabels: readonly TrackedTimeLabel[];
  pad: ChartPadding;
  layoutWidth: number;
  baseY: number;
  opacity: number | SharedValue<number>;
  pal: Pick<ChartPalette, 'gridLine' | 'axisLine'>;
};

export function GridCanvas({
  grid,
  gridLabels,
  timeLabels,
  pad,
  layoutWidth,
  baseY,
  opacity,
  pal,
}: GridCanvasProps) {
  return (
    <>
      {grid ? (
        <Group opacity={opacity}>
          {gridLabels.map((label) => (
            <Group key={`g${label.key}`} opacity={label.alpha}>
              <SkiaLine
                p1={vec(pad.left, label.y)}
                p2={vec(layoutWidth - pad.right, label.y)}
                color={pal.gridLine}
                strokeWidth={1}
              >
                <DashPathEffect intervals={[1, 3]} />
              </SkiaLine>
            </Group>
          ))}
        </Group>
      ) : null}

      <Group opacity={opacity}>
        <SkiaLine
          p1={vec(pad.left, baseY)}
          p2={vec(layoutWidth - pad.right, baseY)}
          color={pal.axisLine}
          strokeWidth={1}
        />

        {timeLabels.map((label) => (
          <Group key={`t${label.key}`} opacity={label.alpha}>
            <SkiaLine
              p1={vec(label.x, baseY)}
              p2={vec(label.x, baseY + 5)}
              color={pal.gridLine}
              strokeWidth={1}
            />
          </Group>
        ))}
      </Group>
    </>
  );
}
