import type { SkFont } from '@shopify/react-native-skia';
import { SkiaNumberFlow } from 'number-flow-react-native/skia';
import type { SharedValue } from 'react-native-reanimated';
import { useDerivedValue } from 'react-native-reanimated';

import {
  BADGE_LINE_H,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
} from './draw/badge';
import { chartSkiaNumberFlowStable, formatPriceCentsWorklet } from './chartNumberFlow';

const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;

/** Remote Inter TTF — same family as number-flow Skia docs; `useSkiaFont` falls back to system font until loaded. */
export const BADGE_NUMBER_FLOW_FONT_SRC =
  'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf';

type BadgeSkiaNumberFlowProps = {
  svTipV: SharedValue<number>;
  font: SkFont;
  color: string;
  /** Pill body width (same units as `badgeSvgPath` first argument). */
  pillBodyWidth: number;
};

/**
 * Animated badge value using SkiaNumberFlow (UI-thread string from smoothed `svTipV`).
 * @see https://number-flow-react-native.awingender.com/docs/components/skia-number-flow
 */
export function BadgeSkiaNumberFlow({
  svTipV,
  font,
  color,
  pillBodyWidth,
}: BadgeSkiaNumberFlowProps) {
  const dvStr = useDerivedValue(() => formatPriceCentsWorklet(svTipV.value));
  const innerPad = 4;
  const textW = Math.max(8, pillBodyWidth - BADGE_TAIL_LEN - innerPad * 2);
  const x = BADGE_TAIL_LEN + innerPad;
  const y = pillH * 0.72;

  return (
    <SkiaNumberFlow
      {...chartSkiaNumberFlowStable}
      sharedValue={dvStr}
      font={font}
      color={color}
      x={x}
      y={y}
      width={textW}
      textAlign="center"
    />
  );
}
