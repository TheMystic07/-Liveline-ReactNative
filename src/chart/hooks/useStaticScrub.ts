import { useCallback, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { CandlePoint, ChartPadding, LiveLinePoint } from '../types';
import { scrubCentTickHaptic, scrubPanBeginHaptic } from '../scrubHaptics';

/* ------------------------------------------------------------------ */
/*  Worklet helpers — copied from NativeLiveLineChart (pure functions) */
/* ------------------------------------------------------------------ */

function clampW(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/** Linearly interpolate a value at `target` time from a sorted array. */
function interpAtTime(
  pts: readonly LiveLinePoint[],
  target: number,
  tipT: number,
  tipV: number,
) {
  'worklet';
  if (pts.length === 0) return tipV;
  if (target <= pts[0]!.time) return pts[0]!.value;
  for (let i = 1; i < pts.length; i++) {
    if (target <= pts[i]!.time) {
      const span = pts[i]!.time - pts[i - 1]!.time || 1;
      const p = (target - pts[i - 1]!.time) / span;
      return pts[i - 1]!.value + (pts[i]!.value - pts[i - 1]!.value) * p;
    }
  }
  const last = pts[pts.length - 1]!;
  if (target <= tipT) {
    const span = tipT - last.time || 1;
    return last.value + (tipV - last.value) * ((target - last.time) / span);
  }
  return tipV;
}

/** Binary search for the nearest point at `target` time. */
function nearestPointAtTime(
  pts: readonly LiveLinePoint[],
  target: number,
  tipT: number,
  tipV: number,
) {
  'worklet';
  if (pts.length === 0) return { time: tipT, value: tipV };
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pts[mid]!.time < target) lo = mid + 1;
    else hi = mid;
  }
  const upper = pts[lo]!;
  const lower = lo > 0 ? pts[lo - 1]! : upper;
  let nearest = Math.abs(upper.time - target) < Math.abs(lower.time - target) ? upper : lower;
  if (Math.abs(tipT - target) < Math.abs(nearest.time - target)) {
    nearest = { time: tipT, value: tipV };
  }
  return nearest;
}

/** Sample the line chart at pointer X. */
function sampleScrubAtX(
  x: number,
  chartW: number,
  pad: ChartPadding,
  win: number,
  buf: number,
  tipT: number,
  tipV: number,
  pts: readonly LiveLinePoint[],
  snapToPoint: boolean,
) {
  'worklet';
  const chartWi = Math.max(1, chartW - pad.left - pad.right);
  const rightEdge = tipT + win * buf;
  const leftEdge = rightEdge - win;
  const liveX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
  const rawHx = clampW(x, pad.left, liveX);
  const rawHt = leftEdge + ((rawHx - pad.left) / chartWi) * (rightEdge - leftEdge);
  if (!snapToPoint) {
    const hv = interpAtTime(pts, rawHt, tipT, tipV);
    return { hx: rawHx, ht: rawHt, hv, liveX };
  }
  const nearest = nearestPointAtTime(pts, rawHt, tipT, tipV);
  const snappedX = pad.left + ((nearest.time - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
  return {
    hx: clampW(snappedX, pad.left, liveX),
    ht: nearest.time,
    hv: nearest.value,
    liveX,
  };
}

/** Candle scrub: snap crosshair to nearest candle center. */
function sampleCandleScrubAtX(
  x: number,
  chartW: number,
  pad: ChartPadding,
  win: number,
  buf: number,
  tipT: number,
  tipV: number,
  candles: readonly CandlePoint[],
  candleWidthSecs: number,
) {
  'worklet';
  const chartWi = Math.max(1, chartW - pad.left - pad.right);
  const rightEdge = tipT + win * buf;
  const leftEdge = rightEdge - win;
  const liveX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
  if (candles.length === 0) {
    const rawHx = clampW(x, pad.left, liveX);
    const rawHt = leftEdge + ((rawHx - pad.left) / chartWi) * (rightEdge - leftEdge);
    return { hx: rawHx, ht: rawHt, hv: tipV, liveX, candle: null as CandlePoint | null };
  }
  const rawHx = clampW(x, pad.left, liveX);
  const rawHt = leftEdge + ((rawHx - pad.left) / chartWi) * (rightEdge - leftEdge);
  let best = candles[0]!;
  let bestD = Math.abs(candles[0]!.time - rawHt);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const d = Math.abs(c.time - rawHt);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const snappedX =
    pad.left +
    ((best.time + candleWidthSecs / 2 - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
  return {
    hx: clampW(snappedX, pad.left, liveX),
    ht: best.time,
    hv: best.close,
    liveX,
    candle: best,
  };
}

/* ------------------------------------------------------------------ */
/*  Crosshair fade constants                                           */
/* ------------------------------------------------------------------ */

const CROSSHAIR_FADE_MIN_PX = 5;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ScrubTipState = {
  hx: number;
  hv: number;
  ht: number;
  opacity: number;
  candle?: CandlePoint;
} | null;

export type UseStaticScrubInput = {
  /** Whether scrub is enabled (prop-level). */
  enabled: boolean;
  /** 1 when draw animation has completed. */
  drawComplete: SharedValue<number>;
  /** Full layout width. */
  chartWidth: number;
  /** Full layout height. */
  chartHeight: number;
  pad: ChartPadding;
  /** Time window in seconds. */
  win: number;
  /** Window buffer factor (e.g., 0.015 or 0.05). */
  buf: number;
  /** Last data point time (fixed for static). */
  tipT: number;
  /** Last data point value (fixed for static). */
  tipV: number;
  /** Line chart data. */
  data: readonly LiveLinePoint[];
  /** Candle data (for candle mode). */
  candles?: readonly CandlePoint[];
  /** Candle bucket width in seconds. */
  candleWidthSecs?: number;
  /** Snap crosshair to nearest data point. */
  snapToPoint: boolean;
  /** Enable scrub haptics. */
  haptics: boolean;
  /** Whether we're in candle mode. */
  isCandle: boolean;
};

export type UseStaticScrubOutput = {
  gesture: ReturnType<typeof Gesture.Pan>;
  svScrubX: SharedValue<number>;
  svScrubOp: SharedValue<number>;
  svScrubHv: SharedValue<number>;
  scrubTip: ScrubTipState;
  clearScrubTip: () => void;
};

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useStaticScrub(input: UseStaticScrubInput): UseStaticScrubOutput {
  const {
    enabled,
    drawComplete,
    chartWidth,
    pad,
    win,
    buf,
    tipT,
    tipV,
    data,
    candles,
    candleWidthSecs = 0,
    snapToPoint,
    haptics,
    isCandle,
  } = input;

  const svScrubX = useSharedValue(0);
  const svScrubOp = useSharedValue(0);
  const svScrubHv = useSharedValue(0);

  // Throttle runOnJS calls
  const svScrubJsLastTs = useSharedValue(0);
  const svScrubJsLastHx = useSharedValue(-1e9);
  const svScrubJsLastOp = useSharedValue(-1);

  const [scrubTip, setScrubTip] = useState<ScrubTipState>(null);

  const applyScrubTip = useCallback(
    (hx: number, hv: number, ht: number, op: number, cand?: CandlePoint) => {
      setScrubTip((prev) => {
        if (
          prev &&
          Math.abs(prev.hx - hx) < 0.1 &&
          Math.abs(prev.hv - hv) < 1e-8 &&
          Math.abs(prev.opacity - op) < 0.01
        ) {
          return prev;
        }
        return { hx, hv, ht, opacity: op, candle: cand };
      });
    },
    [],
  );

  const clearScrubTip = useCallback(() => {
    setScrubTip(null);
  }, []);

  const onScrubPanBeginHaptic = useCallback(() => {
    if (haptics) scrubPanBeginHaptic();
  }, [haptics]);

  const gesture = useMemo(() => {
    const panGesture = Gesture.Pan()
      .enabled(enabled)
      .minDistance(0)
      .onBegin((e) => {
        'worklet';
        if (drawComplete.value !== 1) return;

        let hx: number;
        let hv: number;
        let ht: number;
        let cand: CandlePoint | undefined;

        if (isCandle && candles && candles.length > 0) {
          const c = sampleCandleScrubAtX(
            e.x, chartWidth, pad, win, buf, tipT, tipV,
            candles, candleWidthSecs,
          );
          hx = c.hx;
          hv = c.hv;
          ht = c.ht;
          cand = c.candle ?? undefined;
        } else {
          const sample = sampleScrubAtX(
            e.x, chartWidth, pad, win, buf, tipT, tipV,
            data, snapToPoint,
          );
          hx = sample.hx;
          hv = sample.hv;
          ht = sample.ht;
          cand = undefined;
        }

        svScrubX.value = hx;
        svScrubHv.value = hv;
        svScrubOp.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
        runOnJS(onScrubPanBeginHaptic)();
        runOnJS(applyScrubTip)(hx, hv, ht, 1, cand);
      })
      .onUpdate((e) => {
        'worklet';
        if (drawComplete.value !== 1) return;

        let hx: number;
        let hv: number;
        let ht: number;
        let liveX: number;
        let cand: CandlePoint | undefined;

        if (isCandle && candles && candles.length > 0) {
          const c = sampleCandleScrubAtX(
            e.x, chartWidth, pad, win, buf, tipT, tipV,
            candles, candleWidthSecs,
          );
          hx = c.hx;
          hv = c.hv;
          ht = c.ht;
          liveX = c.liveX;
          cand = c.candle ?? undefined;
        } else {
          const sample = sampleScrubAtX(
            e.x, chartWidth, pad, win, buf, tipT, tipV,
            data, snapToPoint,
          );
          hx = sample.hx;
          hv = sample.hv;
          ht = sample.ht;
          liveX = sample.liveX;
          cand = undefined;
        }

        svScrubX.value = hx;
        svScrubHv.value = hv;

        // Compute crosshair opacity based on distance from live edge
        const chartWi = Math.max(1, chartWidth - pad.left - pad.right);
        const scrubAmt = svScrubOp.value;
        const dist = liveX - hx;
        const fadeStart = Math.min(80, chartWi * 0.3);
        let op = 0;
        if (dist >= CROSSHAIR_FADE_MIN_PX) {
          op =
            dist >= fadeStart
              ? scrubAmt
              : ((dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * scrubAmt;
        }

        // Throttle runOnJS calls
        const ts = Date.now();
        const hxD = Math.abs(hx - svScrubJsLastHx.value);
        const opD = Math.abs(op - svScrubJsLastOp.value);
        const dtUi = ts - svScrubJsLastTs.value;
        if (op > 0.01 && dtUi < 30 && hxD < 2.25 && opD < 0.045) {
          return;
        }
        svScrubJsLastTs.value = ts;
        svScrubJsLastHx.value = hx;
        svScrubJsLastOp.value = op;
        runOnJS(applyScrubTip)(hx, hv, ht, op, cand);
      })
      .onFinalize(() => {
        'worklet';
        svScrubOp.value = withTiming(
          0,
          { duration: 120, easing: Easing.out(Easing.quad) },
          (finished) => {
            if (finished) runOnJS(clearScrubTip)();
          },
        );
        svScrubJsLastTs.value = 0;
        svScrubJsLastHx.value = -1e9;
        svScrubJsLastOp.value = -1;
      });

    return panGesture;
  }, [
    enabled,
    drawComplete,
    chartWidth,
    pad,
    win,
    buf,
    tipT,
    tipV,
    data,
    candles,
    candleWidthSecs,
    snapToPoint,
    isCandle,
    applyScrubTip,
    clearScrubTip,
    onScrubPanBeginHaptic,
    svScrubX,
    svScrubOp,
    svScrubHv,
    svScrubJsLastTs,
    svScrubJsLastHx,
    svScrubJsLastOp,
  ]);

  return {
    gesture,
    svScrubX,
    svScrubOp,
    svScrubHv,
    scrubTip,
    clearScrubTip,
  };
}
