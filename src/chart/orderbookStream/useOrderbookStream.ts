import { useEffect, useRef } from 'react';
import {
  cancelAnimation,
  Easing,
  makeMutable,
  type SharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { ChartPadding, LiveOrderbookSnapshot, OrderbookPriceSize } from '../types';

const MAX_FLOATERS = 20;
/** One vertical list: px from `pad.left` for every row (same x). */
const LIST_X_OFFSET = 6;
const MIN_VISIBLE_ROWS = 10;
const TARGET_VISIBLE_ROWS = 11;
const MAX_VISIBLE_ROWS = 12;
const MIN_ROW_STEP_PX = 17;
const MAX_ROW_STEP_PX = 19;
const BASE_PX_PER_SEC = 74;
const MOMENTUM_PX_PER_SEC = 30;
const CHURN_PX_PER_SEC = 18;
const SPEED_SMOOTHING = 0.08;
const MIN_TRAVEL_MS = 1120;
const MAX_TRAVEL_MS = 1560;
const FADE_OUT_START = 0.82;
const MIN_WAKE_MS = 48;
const MAX_WAKE_MS = 220;
const BID_STREAM_COLOR = '#2EF27A';
const ASK_STREAM_COLOR = '#FF6B7A';

export interface OrderbookStreamSlot {
  id: number;
  x: SharedValue<number>;
  y: SharedValue<number>;
  text: SharedValue<string>;
  color: SharedValue<string>;
  opacity: SharedValue<number>;
}

type OrderbookStreamSlotState = OrderbookStreamSlot & {
  active: boolean;
  startAt: number;
  durationMs: number;
  startY: number;
  driftPx: number;
};

function createSlot(id: number): OrderbookStreamSlotState {
  return {
    id,
    x: makeMutable(0),
    y: makeMutable(0),
    text: makeMutable(''),
    color: makeMutable(BID_STREAM_COLOR),
    opacity: makeMutable(0),
    active: false,
    startAt: 0,
    durationMs: 0,
    startY: 0,
    driftPx: 0,
  };
}

function clearSlot(slot: OrderbookStreamSlotState) {
  cancelAnimation(slot.y);
  cancelAnimation(slot.opacity);
  slot.active = false;
  slot.startAt = 0;
  slot.durationMs = 0;
  slot.startY = 0;
  slot.driftPx = 0;
  slot.text.value = '';
  slot.opacity.value = 0;
}

function sumSizes(levels: readonly OrderbookPriceSize[]): number {
  let sum = 0;
  for (let i = 0; i < levels.length; i++) sum += Math.max(0, levels[i]![1]);
  return sum;
}

function maxSize(levels: readonly OrderbookPriceSize[]): number {
  let max = 0;
  for (let i = 0; i < levels.length; i++) max = Math.max(max, levels[i]![1]);
  return max || 1;
}

function weightedPick(
  bids: readonly OrderbookPriceSize[],
  asks: readonly OrderbookPriceSize[],
): { side: 'bid' | 'ask'; size: number } | null {
  if (bids.length === 0 && asks.length === 0) return null;

  let bidWeight = 0;
  for (let i = 0; i < bids.length; i++) bidWeight += Math.sqrt(Math.max(bids[i]![1], 1e-9));

  let askWeight = 0;
  for (let i = 0; i < asks.length; i++) askWeight += Math.sqrt(Math.max(asks[i]![1], 1e-9));

  const totalWeight = bidWeight + askWeight;
  if (totalWeight < 1e-9) return null;

  const side: 'bid' | 'ask' =
    asks.length === 0
      ? 'bid'
      : bids.length === 0
        ? 'ask'
        : Math.random() * totalWeight < bidWeight
          ? 'bid'
          : 'ask';

  const rows = side === 'bid' ? bids : asks;
  let rowWeight = 0;
  for (let i = 0; i < rows.length; i++) rowWeight += Math.sqrt(Math.max(rows[i]![1], 1e-9));

  let remaining = Math.random() * rowWeight;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    remaining -= Math.sqrt(Math.max(row[1], 1e-9));
    if (remaining <= 0) return { side, size: row[1] };
  }

  const last = rows[rows.length - 1]!;
  return { side, size: last[1] };
}

function formatStreamValue(value: number) {
  const fixed = value.toFixed(2).replace(/\.?0+$/, '');
  return `+$${fixed}`;
}

function spawnSlot({
  slot,
  now,
  rowX,
  rowY,
  size,
  color,
  spawnOpacity,
  travelPx,
  durationMs,
}: {
  slot: OrderbookStreamSlotState;
  now: number;
  rowX: number;
  rowY: number;
  size: number;
  color: string;
  spawnOpacity: number;
  travelPx: number;
  durationMs: number;
}) {
  const fadeOutMs = Math.max(140, durationMs * (1 - FADE_OUT_START));

  cancelAnimation(slot.y);
  cancelAnimation(slot.opacity);

  slot.active = true;
  slot.startAt = now;
  slot.durationMs = durationMs;
  slot.startY = rowY;
  slot.driftPx = travelPx;

  slot.x.value = rowX;
  slot.y.value = rowY;
  slot.text.value = formatStreamValue(size);
  slot.color.value = color;
  slot.opacity.value = 0;

  slot.y.value = withTiming(rowY - travelPx, {
    duration: durationMs,
    easing: Easing.linear,
  });
  slot.opacity.value = withSequence(
    withTiming(spawnOpacity, { duration: 92, easing: Easing.out(Easing.quad) }),
    withDelay(
      durationMs * FADE_OUT_START,
      withTiming(0, { duration: fadeOutMs, easing: Easing.inOut(Easing.quad) }),
    ),
  );
}

export type OrderbookStreamInputs = {
  orderbook: LiveOrderbookSnapshot | undefined;
  layoutWidth: number;
  layoutHeight: number;
  pad: ChartPadding;
  paused: boolean;
  empty: boolean;
  /** Momentum direction from chart: 0 flat, 1 up, 2 down. */
  momUi: 0 | 1 | 2;
  /** Swing magnitude 0..~1 from visible series. */
  swingMag: number;
};

/**
 * The stream now only uses JS to decide when to spawn/retire rows.
 * Actual motion runs on the UI thread via Reanimated timings, which removes frame stepping.
 */
export function useOrderbookStream({
  orderbook,
  layoutWidth,
  layoutHeight,
  pad,
  paused,
  empty,
  momUi,
  swingMag,
}: OrderbookStreamInputs): readonly OrderbookStreamSlot[] {
  const slotsRef = useRef<OrderbookStreamSlotState[]>(
    Array.from({ length: MAX_FLOATERS }, (_, index) => createSlot(index + 1)),
  );
  const orderbookRef = useRef(orderbook);
  orderbookRef.current = orderbook;
  const momUiRef = useRef(momUi);
  momUiRef.current = momUi;
  const swingMagRef = useRef(swingMag);
  swingMagRef.current = swingMag;
  const prevTotalsRef = useRef<{ b: number; a: number } | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const churnSmRef = useRef(0);
  const speedSmRef = useRef(0);
  const nextSpawnAtRef = useRef<number | null>(null);
  const slots = slotsRef.current;

  useEffect(() => {
    const clearLoop = () => {
      if (loopTimerRef.current) {
        clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    };

    const resetSlots = () => {
      clearLoop();
      for (const slot of slots) clearSlot(slot);
      prevTotalsRef.current = null;
      churnSmRef.current = 0;
      speedSmRef.current = 0;
      nextSpawnAtRef.current = null;
    };

    clearLoop();

    if (!orderbook || empty || paused || layoutWidth < 80) {
      resetSlots();
      return;
    }

    const baseY = layoutHeight - pad.bottom;
    const plotTop = pad.top;
    const travel = Math.max(40, baseY - plotTop);
    const rowX = pad.left + LIST_X_OFFSET;
    const botRowY = baseY - 16;
    const travelPx = Math.max(28, travel - 4);
    const targetVisibleRows = Math.max(
      MIN_VISIBLE_ROWS,
      Math.min(MAX_VISIBLE_ROWS, Math.round(TARGET_VISIBLE_ROWS + (travelPx - 216) / 54)),
    );
    const rowStepPx = Math.max(
      MIN_ROW_STEP_PX,
      Math.min(MAX_ROW_STEP_PX, travelPx / targetVisibleRows),
    );

    const scheduleTick = (delayMs: number) => {
      clearLoop();
      loopTimerRef.current = setTimeout(tick, Math.max(MIN_WAKE_MS, Math.min(MAX_WAKE_MS, delayMs)));
    };

    const tick = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const ob = orderbookRef.current;
      if (!ob || ob.bids.length + ob.asks.length === 0) {
        resetSlots();
        return;
      }

      let activeCount = 0;
      let earliestEndAt = Number.POSITIVE_INFINITY;
      for (const slot of slots) {
        if (!slot.active) continue;
        const endAt = slot.startAt + slot.durationMs + 24;
        if (now >= endAt) {
          clearSlot(slot);
          continue;
        }
        activeCount += 1;
        earliestEndAt = Math.min(earliestEndAt, endAt);
      }

      const bids = ob.bids;
      const asks = ob.asks;
      const sumB = sumSizes(bids);
      const sumA = sumSizes(asks);
      const maxSz = Math.max(maxSize(bids), maxSize(asks));
      const prev = prevTotalsRef.current;
      let churn = 0;
      if (prev) {
        churn = Math.abs(sumB - prev.b) + Math.abs(sumA - prev.a);
      }
      prevTotalsRef.current = { b: sumB, a: sumA };

      const depth = sumB + sumA + 1e-6;
      churnSmRef.current = churnSmRef.current * 0.9 + churn * 0.1;
      const churnNorm = Math.min(1.25, churnSmRef.current / (depth * 0.035 + 1e-6));

      const mom = momUiRef.current;
      const sw = swingMagRef.current;
      const momBoost = mom === 0 ? 0.18 : 0.6 + Math.min(1, sw * 2.1) * 0.82;
      const targetPxPerSec = BASE_PX_PER_SEC + momBoost * MOMENTUM_PX_PER_SEC + churnNorm * CHURN_PX_PER_SEC;
      const prevSpeed = speedSmRef.current || targetPxPerSec;
      const pxPerSec = prevSpeed + (targetPxPerSec - prevSpeed) * SPEED_SMOOTHING;
      speedSmRef.current = pxPerSec;

      const durationMs = Math.round(
        Math.max(MIN_TRAVEL_MS, Math.min(MAX_TRAVEL_MS, (travelPx / Math.max(24, pxPerSec)) * 1000)),
      );
      const cadenceMs = Math.round((durationMs * rowStepPx) / Math.max(rowStepPx, travelPx));

      if (nextSpawnAtRef.current == null) {
        nextSpawnAtRef.current = now;
      }

      if (
        activeCount < MAX_FLOATERS &&
        nextSpawnAtRef.current != null &&
        now >= nextSpawnAtRef.current &&
        bids.length + asks.length > 0
      ) {
        const pick = weightedPick(bids, asks);
        const slot = slots.find((candidate) => !candidate.active);
        if (pick && slot) {
          const color = pick.side === 'bid' ? BID_STREAM_COLOR : ASK_STREAM_COLOR;
          const sizeNorm = Math.pow(Math.min(1, pick.size / maxSz), 0.56);
          const spawnOpacity = Math.min(0.94, 0.58 + sizeNorm * 0.22);
          const size = Number.isFinite(pick.size) ? pick.size : 0;

          spawnSlot({
            slot,
            now,
            rowX,
            rowY: botRowY,
            size,
            color,
            spawnOpacity,
            travelPx,
            durationMs,
          });

          nextSpawnAtRef.current = now + cadenceMs;
          activeCount += 1;
          earliestEndAt = Math.min(earliestEndAt, now + durationMs + 24);
        } else {
          nextSpawnAtRef.current = now + cadenceMs;
        }
      }

      const nextSpawnDelay =
        nextSpawnAtRef.current == null ? MAX_WAKE_MS : Math.max(MIN_WAKE_MS, nextSpawnAtRef.current - now);
      const nextExpireDelay =
        earliestEndAt === Number.POSITIVE_INFINITY
          ? MAX_WAKE_MS
          : Math.max(MIN_WAKE_MS, earliestEndAt - now);
      scheduleTick(Math.min(nextSpawnDelay, nextExpireDelay, MAX_WAKE_MS));
    };

    tick();

    return () => {
      clearLoop();
    };
  }, [empty, paused, layoutWidth, layoutHeight, pad.top, pad.bottom, pad.left, slots]);

  return slots;
}
