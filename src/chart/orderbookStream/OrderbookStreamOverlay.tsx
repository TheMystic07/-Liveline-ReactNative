import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';
import type { SkFont } from '@shopify/react-native-skia';

import { OrderbookStreamLayer } from '../render/OrderbookStreamLayer';
import type { ChartPadding, LiveOrderbookSnapshot } from '../types';

import { useOrderbookStream } from './useOrderbookStream';

export type OrderbookStreamOverlayProps = {
  orderbook: LiveOrderbookSnapshot | undefined;
  layoutWidth: number;
  layoutHeight: number;
  pad: ChartPadding;
  paused: boolean;
  empty: boolean;
  momUi: 0 | 1 | 2;
  swingMag: number;
  font: SkFont | null;
};

/**
 * Owns `useOrderbookStream` + a separate Skia `Canvas` so label ticks do not reconcile the
 * main chart `Canvas` (line/fill/grid) — that was correlated with the stroke disappearing.
 */
function OrderbookStreamOverlayImpl({
  orderbook,
  layoutWidth,
  layoutHeight,
  pad,
  paused,
  empty,
  momUi,
  swingMag,
  font,
}: OrderbookStreamOverlayProps) {
  const slots = useOrderbookStream({
    orderbook,
    layoutWidth,
    layoutHeight,
    pad,
    paused,
    empty,
    momUi,
    swingMag,
  });

  if (!font) return null;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <OrderbookStreamLayer slots={slots} font={font} />
    </Canvas>
  );
}

export const OrderbookStreamOverlay = memo(OrderbookStreamOverlayImpl);
