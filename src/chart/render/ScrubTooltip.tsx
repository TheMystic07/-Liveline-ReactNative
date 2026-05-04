import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SkFont } from '@shopify/react-native-skia';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import type { ChartPalette } from '../types';
import { ScrubSkiaNumberFlow } from '../ScrubSkiaNumberFlow';

export type ScrubTooltipLayout = {
  left: number;
  v: string;
  t: string;
  sep: string;
};

type ScrubTooltipProps = {
  layout: ScrubTooltipLayout | null;
  top: number;
  opacity: SharedValue<number>;
  tooltipOutline: boolean;
  skiaScrubFlow: boolean;
  scrubFlowA11yLabel?: string;
  scrubTipFont: SkFont;
  scrubValue: SharedValue<string>;
  pal: Pick<ChartPalette, 'tooltipText' | 'gridLabel' | 'tooltipBg'>;
  textStyle: object;
};

function ScrubTooltipImpl({
  layout,
  top,
  opacity,
  tooltipOutline,
  skiaScrubFlow,
  scrubFlowA11yLabel,
  scrubTipFont,
  scrubValue,
  pal,
  textStyle,
}: ScrubTooltipProps) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!layout) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessible={!!skiaScrubFlow}
      accessibilityLabel={
        skiaScrubFlow ? `${scrubFlowA11yLabel ?? layout.v}${layout.sep}${layout.t}` : undefined
      }
      style={[styles.wrap, { left: layout.left, top }, animatedStyle]}
    >
      {skiaScrubFlow ? (
        <View style={styles.row}>
          <ScrubSkiaNumberFlow
            dvStr={scrubValue}
            font={scrubTipFont}
            color={pal.tooltipText}
          />
          <Text
            style={[
              textStyle,
              { color: pal.gridLabel },
              tooltipOutline && {
                textShadowColor: pal.tooltipBg,
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 3,
              },
            ]}
          >
            {`${layout.sep}${layout.t}`}
          </Text>
        </View>
      ) : (
        <Text
          style={[
            textStyle,
            tooltipOutline && {
              textShadowColor: pal.tooltipBg,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 3,
            },
          ]}
        >
          <Text style={{ color: pal.tooltipText }}>{layout.v}</Text>
          <Text style={{ color: pal.gridLabel }}>{`${layout.sep}${layout.t}`}</Text>
        </Text>
      )}
    </Animated.View>
  );
}

export const ScrubTooltip = memo(ScrubTooltipImpl);

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
