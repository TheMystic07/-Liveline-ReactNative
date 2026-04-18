import type { SkFont } from '@shopify/react-native-skia';
import { Canvas } from '@shopify/react-native-skia';
import { SkiaNumberFlow } from 'number-flow-react-native/skia';
import type { SharedValue } from 'react-native-reanimated';

import { chartSkiaNumberFlowStable } from './chartNumberFlow';

/** Width reserved for the numeric portion of the scrub tooltip (tabular digits). */
export const SCRUB_TIP_FLOW_W = 76;
export const SCRUB_TIP_FLOW_H = 22;

type ScrubSkiaNumberFlowProps = {
  dvStr: SharedValue<string>;
  font: SkFont;
  color: string;
};

/**
 * Rolling scrub price using SkiaNumberFlow (UI-thread `sharedValue` string).
 * @see https://number-flow-react-native.awingender.com/docs/components/skia-number-flow
 */
export function ScrubSkiaNumberFlow({ dvStr, font, color }: ScrubSkiaNumberFlowProps) {
  return (
    <Canvas style={{ width: SCRUB_TIP_FLOW_W, height: SCRUB_TIP_FLOW_H }}>
      <SkiaNumberFlow
        {...chartSkiaNumberFlowStable}
        sharedValue={dvStr}
        font={font}
        color={color}
        x={0}
        y={16}
        width={SCRUB_TIP_FLOW_W}
        textAlign="left"
      />
    </Canvas>
  );
}
