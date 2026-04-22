import { StyleSheet, Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { LiveLineTheme } from './types';
import { resolvePalette } from './theme';

export type WebFallbackChartProps = {
  theme?: LiveLineTheme;
  color?: string;
  height?: number;
  emptyText?: string;
  style?: ViewStyle;
};

export function WebFallbackChart({
  theme = 'dark',
  color = '#3b82f6',
  height = 300,
  emptyText = 'Native chart renderer only',
  style,
}: WebFallbackChartProps) {
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
