import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { LIVELINE_CANDLE_BEAR, LIVELINE_CANDLE_BULL } from '../draw/livelineCandlestick';
import type { CandlePoint, ChartPalette } from '../types';

export type CandleScrubOHLCLayout = {
  left: number;
  candle: CandlePoint;
};

type CandleScrubOHLCTooltipProps = {
  layout: CandleScrubOHLCLayout | null;
  top: number;
  opacity: SharedValue<number>;
  formatValue: (v: number) => string;
  formatTime: (t: number) => string;
  pal: Pick<ChartPalette, 'gridLabel' | 'tooltipText' | 'tooltipBg'>;
  textStyle: object;
  tooltipOutline: boolean;
};

function OhlcPair({
  label,
  value,
  valueColor,
  gridLabel,
  textStyle,
  outline,
  outlineBg,
}: {
  label: string;
  value: string;
  valueColor: string;
  gridLabel: string;
  textStyle: object;
  outline: boolean;
  outlineBg: string;
}) {
  const shadow = outline
    ? {
        textShadowColor: outlineBg,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 3,
      }
    : undefined;
  return (
    <Text style={[textStyle, styles.rowText, shadow]}>
      <Text style={{ color: gridLabel }}>{label}</Text>
      <Text style={{ color: valueColor }}>{` ${value}`}</Text>
    </Text>
  );
}

function CandleScrubOHLCTooltipImpl({
  layout,
  top,
  opacity,
  formatValue,
  formatTime,
  pal,
  textStyle,
  tooltipOutline,
}: CandleScrubOHLCTooltipProps) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!layout) return null;

  const { candle: c } = layout;
  const bull = c.close >= c.open;
  const valueColor = bull ? LIVELINE_CANDLE_BULL : LIVELINE_CANDLE_BEAR;
  const sep = '  ·  ';
  const tStr = formatTime(c.time);

  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityLabel={`Open ${formatValue(c.open)}, High ${formatValue(c.high)}, Low ${formatValue(
        c.low,
      )}, Close ${formatValue(c.close)}, ${tStr}`}
      style={[styles.wrap, { left: layout.left, top }, animatedStyle]}
    >
      <View style={styles.row}>
        <OhlcPair
          label="O"
          value={formatValue(c.open)}
          valueColor={valueColor}
          gridLabel={pal.gridLabel}
          textStyle={textStyle}
          outline={tooltipOutline}
          outlineBg={pal.tooltipBg}
        />
        <Text
          style={[
            textStyle,
            styles.sep,
            { color: pal.gridLabel },
            tooltipOutline && {
              textShadowColor: pal.tooltipBg,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 3,
            },
          ]}
        >
          {sep}
        </Text>
        <OhlcPair
          label="H"
          value={formatValue(c.high)}
          valueColor={valueColor}
          gridLabel={pal.gridLabel}
          textStyle={textStyle}
          outline={tooltipOutline}
          outlineBg={pal.tooltipBg}
        />
        <Text
          style={[
            textStyle,
            styles.sep,
            { color: pal.gridLabel },
            tooltipOutline && {
              textShadowColor: pal.tooltipBg,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 3,
            },
          ]}
        >
          {sep}
        </Text>
        <OhlcPair
          label="L"
          value={formatValue(c.low)}
          valueColor={valueColor}
          gridLabel={pal.gridLabel}
          textStyle={textStyle}
          outline={tooltipOutline}
          outlineBg={pal.tooltipBg}
        />
        <Text
          style={[
            textStyle,
            styles.sep,
            { color: pal.gridLabel },
            tooltipOutline && {
              textShadowColor: pal.tooltipBg,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 3,
            },
          ]}
        >
          {sep}
        </Text>
        <OhlcPair
          label="C"
          value={formatValue(c.close)}
          valueColor={valueColor}
          gridLabel={pal.gridLabel}
          textStyle={textStyle}
          outline={tooltipOutline}
          outlineBg={pal.tooltipBg}
        />
        <Text
          style={[
            textStyle,
            styles.sep,
            { color: pal.gridLabel },
            tooltipOutline && {
              textShadowColor: pal.tooltipBg,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 3,
            },
          ]}
        >
          {sep}
        </Text>
        <Text
          style={[
            textStyle,
            styles.rowText,
            { color: pal.gridLabel },
            tooltipOutline && {
              textShadowColor: pal.tooltipBg,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 3,
            },
          ]}
        >
          {tStr}
        </Text>
      </View>
    </Animated.View>
  );
}

export const CandleScrubOHLCTooltip = memo(CandleScrubOHLCTooltipImpl);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', maxWidth: '96%' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  rowText: { flexShrink: 0 },
  sep: { flexShrink: 0 },
});
