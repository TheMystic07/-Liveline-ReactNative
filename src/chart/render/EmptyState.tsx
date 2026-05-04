import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Canvas,
  Group,
  LinearGradient,
  Path,
  Rect,
  vec,
} from '@shopify/react-native-skia';

import { LOADING_AMPLITUDE_RATIO } from '../draw/loadingShape';
import type { ChartPadding, ChartPalette } from '../types';

type EmptyStateProps = {
  layoutWidth: number;
  layoutHeight: number;
  pad: ChartPadding;
  loadPath: string;
  loadAlpha: number;
  loading: boolean;
  emptyText: string;
  pal: Pick<ChartPalette, 'gridLabel' | 'lineWidth'>;
};

const GAP_PAD = 20;
const GAP_FADE_W = 30;

export function EmptyState({
  layoutWidth,
  layoutHeight,
  pad,
  loadPath,
  loadAlpha,
  loading,
  emptyText,
  pal,
}: EmptyStateProps) {
  const [gapTextW, setGapTextW] = useState(120);

  const chartH = layoutHeight - pad.top - pad.bottom;
  const centerY = pad.top + chartH / 2;
  const centerX = pad.left + (layoutWidth - pad.left - pad.right) / 2;
  const amplitude = chartH * LOADING_AMPLITUDE_RATIO;
  const eraseH = amplitude * 2 + pal.lineWidth + 6;
  const gapHalf = gapTextW / 2 + GAP_PAD;
  const gapLeft = centerX - gapHalf - GAP_FADE_W;
  const gapRight = centerX + gapHalf + GAP_FADE_W;

  return (
    <View style={styles.emptyWrap}>
      {layoutWidth > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path
            path={loadPath}
            style="stroke"
            strokeWidth={pal.lineWidth}
            strokeJoin="round"
            strokeCap="round"
            color={pal.gridLabel}
            opacity={loadAlpha}
          />

          {!loading ? (
            <Group blendMode="dstOut" opacity={1}>
              <Rect
                x={gapLeft}
                y={centerY - eraseH / 2}
                width={gapRight - gapLeft}
                height={eraseH}
              >
                <LinearGradient
                  start={vec(gapLeft, 0)}
                  end={vec(gapRight, 0)}
                  colors={[
                    'rgba(0,0,0,0)',
                    'rgba(0,0,0,1)',
                    'rgba(0,0,0,1)',
                    'rgba(0,0,0,0)',
                  ]}
                  positions={[
                    0,
                    GAP_FADE_W / Math.max(1, gapRight - gapLeft),
                    1 - GAP_FADE_W / Math.max(1, gapRight - gapLeft),
                    1,
                  ]}
                />
              </Rect>
            </Group>
          ) : null}
        </Canvas>
      ) : null}

      {!loading ? (
        <Text
          onLayout={(event) => setGapTextW(event.nativeEvent.layout.width)}
          style={[styles.emptyTxt, { color: pal.gridLabel, opacity: 0.35 }]}
        >
          {emptyText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { fontSize: 12, fontWeight: '400' },
});
