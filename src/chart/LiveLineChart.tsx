import { Platform, StyleSheet, Text, View } from 'react-native';

import { resolvePalette } from './theme';
import { NativeLiveLineChart } from './NativeLiveLineChart';
import { NativeCandlestickChart } from './NativeCandlestickChart';
import { NativeMultiSeriesChart } from './NativeMultiSeriesChart';
import type { LiveLineChartProps } from './types';

export function LiveLineChart(props: LiveLineChartProps) {
  if (Platform.OS !== 'web') {
    if (props.mode === 'candle') {
      return <NativeCandlestickChart {...props} />;
    }
    if (props.series && props.series.length > 0) {
      return <NativeMultiSeriesChart {...props} />;
    }
    return <NativeLiveLineChart {...props} />;
  }

  return <WebFallbackChart {...props} />;
}

function WebFallbackChart({
  theme = 'dark',
  color = '#3b82f6',
  height = 300,
  emptyText = 'Native chart renderer only',
  style,
}: LiveLineChartProps) {
  const palette = resolvePalette(color, theme, undefined);

  return (
    <View
      style={[
        styles.webFallback,
        {
          height,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      <Text style={[styles.webFallbackTitle, { color: palette.tooltipText }]}>
        Native chart renderer only
      </Text>
      <Text style={[styles.webFallbackBody, { color: palette.tooltipMuted }]}>
        Android and iOS use the Skia/Reanimated pipeline. Web stays disabled here because the
        native smooth path relies on Skia primitives that are not wired for this build.
      </Text>
      <Text style={[styles.webFallbackHint, { color: palette.tooltipMuted }]}>
        {emptyText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  webFallback: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    justifyContent: 'center',
    gap: 10,
  },
  webFallbackTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  webFallbackBody: {
    fontSize: 13,
    lineHeight: 20,
  },
  webFallbackHint: {
    fontSize: 12,
    fontWeight: '600',
  },
});
