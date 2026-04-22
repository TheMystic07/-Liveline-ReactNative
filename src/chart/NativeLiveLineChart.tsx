import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  LinearGradient,
  Path,
  Rect,
  RoundedRect,
  rect,
  vec,
} from '@shopify/react-native-skia';
import type { SkPath } from '@shopify/react-native-skia';
import { useSkiaFont } from 'number-flow-react-native/skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { parseColorRgb, resolvePalette } from './theme';
import { lerp as lerpFr } from './math/lerp';
import {
  collapseCandleOHLC,
  inferCandleWidthSecs,
  layoutLivelineCandles,
  LIVELINE_CANDLE_BULL,
  LIVELINE_CANDLE_BEAR,
} from './draw/livelineCandlestick';
import type {
  CandlePoint,
  ChartPadding,
  DegenOptions,
  LiveLineChartProps,
  LiveLinePoint,
  LiveLineWindowStyle,
} from './types';
import { computeRange } from './math/range';
import { detectMomentum, computeSwingMagnitude } from './math/momentum';
import type { Momentum } from './math/momentum';
import { niceTimeInterval, pickValueInterval } from './math/intervals';
import {
  WINDOW_TRANSITION_MS,
  lerpWindowLogSpace,
} from './math/windowTransition';
import {
  badgeSvgPath,
  BADGE_PAD_X,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
  BADGE_TAIL_SPREAD,
  BADGE_LINE_H,
} from './draw/badge';
import { BADGE_NUMBER_FLOW_FONT_SRC } from './BadgeSkiaNumberFlow';
import { formatPriceCentsWorklet, supportsTwoDecimalNumberFlow } from './chartNumberFlow';
import { SCRUB_TIP_FLOW_W } from './ScrubSkiaNumberFlow';
import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { GridCanvas } from './render/GridCanvas';
import { LiveDotLayer } from './render/LiveDotLayer';
import { LiveBadgeOverlay } from './render/LiveBadgeOverlay';
import { LinePathLayer } from './render/LinePathLayer';
import { type ParticleSpec, ParticlesLayer } from './render/ParticlesLayer';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { CandleScrubOHLCTooltip } from './render/CandleScrubOHLCTooltip';
import { OrderbookStreamOverlay } from './orderbookStream/OrderbookStreamOverlay';
import { ScrubTooltip } from './render/ScrubTooltip';
import { useTrackedGridLabels, useTrackedTimeLabels } from './render/useTrackedAxisLabels';
import { scrubCentTickHaptic, scrubPanBeginHaptic } from './scrubHaptics';
import {
  loadingY,
  loadingBreath,
  LOADING_AMPLITUDE_RATIO,
  LOADING_SCROLL_SPEED,
} from './draw/loadingShape';
import {
  buildPath,
  buildSplinePathFromBuffers,
  buildSplinePathToSkPathFromBuffers,
} from './draw/buildLiveLinePath';
import { decayShake, randomShakeOffset, shakeAmplitude } from './draw/shake';
import { monotoneSplinePath } from './math/spline';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GridTick {
  value: number;
  y: number;
  text: string;
  isCoarse: boolean;
  /** Fine label opacity (0-1): fades based on pixel spacing between fine ticks. */
  fineOp: number;
}

interface TimeTick {
  time: number;
  x: number;
  text: string;
}

type EngineFrameFlushPayload = {
  effectiveWin?: number | null;
  smoothedDisplay?: { o: number; h: number; l: number; c: number; t: number } | null;
  grid?: { min: number; max: number } | null;
  stop?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Constants — matching upstream exactly                               */
/* ------------------------------------------------------------------ */

const DEFAULT_HEIGHT = 300;
const FADE_EDGE_WIDTH = 40;
const PULSE_DURATION = 900;
/** Matches upstream `WINDOW_BUFFER` / `WINDOW_BUFFER_NO_BADGE`. */
const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
const CROSSHAIR_FADE_MIN_PX = 5;
/** Max particles per burst (single shared animation driver — keep low for UI thread). */
const MAX_PARTICLE_BURST = 14;
const PARTICLE_LIFE_MS = 920;
const PARTICLE_COOLDOWN_MS = 400;
const MAGNITUDE_THRESHOLD = 0.08;
const MAX_BURSTS = 3;
/** Upstream `ADAPTIVE_SPEED_BOOST` — scales with gap between live value and display. */
const ADAPTIVE_SPEED_BOOST = 0.2;
/** Upstream `VALUE_SNAP_THRESHOLD`. */
const VALUE_SNAP_THRESHOLD = 0.001;
/** Throttle grid label refresh while range lerps (ms, worklet accumulator). */
const GRID_FLUSH_MS = 110;
/** Wall-clock tick for time axis when the last sample time lags (ms, JS interval). */
const LIVE_AXIS_WALL_MS = 480;
/** How fast `svTipT` eases toward wall clock between ticks (scaled by `engineDt`). */
const LIVE_TIP_CLOCK_CATCHUP = 0.42;
/** Upstream `BADGE_WIDTH_LERP` — badge pill width eases toward measured text. */
const BADGE_WIDTH_LERP = 0.15;
const MAX_DELTA_MS = 50;
/** Upstream `CANDLE_LERP_SPEED` — live OHLC eases toward each tick. */
const CANDLE_OHLC_LERP_SPEED = 0.25;
/** Upstream `LINE_MORPH_MS` — line↔candle morph duration. */
const LINE_MORPH_MS = 500;
/** Extracted to module scope to avoid per-render array allocations. */
const PRICE_DASH_INTERVALS = [4, 4];
/** Throttle JS merges while OHLC lerps on the UI thread (ms). */
const CANDLE_SMOOTH_EMIT_MS = 32;
const ENGINE_IDLE_STOP_MS = 60;
const ARROW_WAVE_DURATION_MS = 680;
const SCRUB_HAPTIC_MIN_INTERVAL_MS = 48;
const PINCH_WINDOW_MIN_SECS = 5;
const PINCH_WINDOW_MAX_MULTIPLIER = 6;

/* -- Upstream constants for smoother animation -- */
/** Range lerp base speed (upstream uses 0.15, separate from value lerp 0.08). */
const RANGE_LERP_SPEED = 0.15;
/** Range adaptive boost when range changes significantly. */
const RANGE_ADAPTIVE_BOOST = 0.2;
/** Badge Y position lerp speed (upstream 0.35, faster during window transitions). */
const BADGE_Y_LERP = 0.35;
const BADGE_Y_LERP_TRANSITION = 0.5;
/** Pause progress easing — 0 playing, 1 fully paused. */
const PAUSE_PROGRESS_SPEED = 0.12;
/** Momentum color blend speed (0.12 per 16.67ms frame). */
const MOMENTUM_COLOR_SPEED = 0.12;
/** Chart reveal speed: loading→chart (upstream 0.14 reverse, 0.09 forward). */
const CHART_REVEAL_SPEED = 0.09;
/** Reveal thresholds for staggered element appearance. */
const REVEAL_GRID_START = 0.15;
const REVEAL_GRID_END = 0.7;
const REVEAL_DOT_START = 0.3;
const REVEAL_BADGE_START = 0.25;
const REVEAL_ARROWS_START = 0.6;
const REVEAL_PARTICLES_START = 0.9;
/** Reveal morph center-out factor — center resolves first. */
const REVEAL_CENTER_SPREAD = 0.4;
/** Fine grid label visibility thresholds (px spacing). */
const FINE_LABEL_SHOW_PX = 60;
const FINE_LABEL_HIDE_PX = 40;
/** Grid label fade speeds. */
const GRID_LABEL_FADE_IN = 0.18;
const GRID_LABEL_FADE_OUT = 0.12;
const LIVE_TAIL_HISTORY_POINTS = 3;

/** Pre-allocated flat buffers for tail path — avoids per-frame GC (max ~5 points). */
const _tailX = new Float64Array(8);
const _tailY = new Float64Array(8);

type RangeTransform = Array<
  { translateX: number } | { translateY: number } | { scaleY: number }
>;

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

function clampW(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/** Matches upstream `computeAdaptiveSpeed` (line mode). */
function computeAdaptiveSpeed(
  value: number,
  displayValue: number,
  displayMin: number,
  displayMax: number,
  lerpSpeed: number,
) {
  'worklet';
  const valGap = Math.abs(value - displayValue);
  const prevRange = displayMax - displayMin || 1;
  const gapRatio = Math.min(valGap / prevRange, 1);
  return lerpSpeed + (1 - gapRatio) * ADAPTIVE_SPEED_BOOST;
}

/** Linearly interpolate a value from a time-sorted `LiveLinePoint` array at time `t`. */
function interpolateValueAtTime(
  pts: readonly LiveLinePoint[],
  t: number,
  fallback: number,
): number {
  'worklet';
  if (pts.length === 0) return fallback;
  if (pts.length === 1) return pts[0]!.value;
  if (t <= pts[0]!.time) return pts[0]!.value;
  const last = pts[pts.length - 1]!;
  if (t >= last.time) return last.value;
  // Scan backwards — t is usually near the end
  for (let i = pts.length - 1; i > 0; i--) {
    const p1 = pts[i - 1]!;
    const p2 = pts[i]!;
    if (t >= p1.time && t <= p2.time) {
      const ratio = (t - p1.time) / (p2.time - p1.time || 1);
      return p1.value + (p2.value - p1.value) * ratio;
    }
  }
  return fallback;
}

function defaultFmtVal(v: number) {
  return v.toFixed(2);
}

function defaultFmtTime(t: number) {
  const d = new Date(t * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/** One momentum chevron (upstream `drawArrows` geometry). */
function chevronStroke(bx: number, by: number, dir: -1 | 1, i: number) {
  'worklet';
  const nudge = dir === -1 ? -3 : 3;
  const cy = by + dir * (i * 8 - 4) + nudge;
  return `M ${bx - 5} ${cy - dir * 3.5} L ${bx} ${cy} L ${bx + 5} ${cy - dir * 3.5}`;
}

function windowBuffer(showBadge: boolean) {
  return showBadge ? WINDOW_BUFFER_BADGE : WINDOW_BUFFER_NO_BADGE;
}

function windowEdges(now: number, win: number, buffer: number) {
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return { leftEdge, rightEdge };
}

function getVisible(
  data: LiveLinePoint[],
  now: number,
  win: number,
  buffer: number,
) {
  const { leftEdge, rightEdge } = windowEdges(now, win, buffer);
  return data.filter((p) => p.time >= leftEdge - 2 && p.time <= rightEdge + 1);
}

/* ------------------------------------------------------------------ */
/*  Projection — matching upstream layout model                        */
/*  leftEdge = now - windowSecs;  rightEdge = now                     */
/*  Live dot sits at rightEdge (chart right edge inside padding)      */
/* ------------------------------------------------------------------ */

function toScreenX(
  t: number,
  now: number,
  win: number,
  w: number,
  pad: ChartPadding,
  buffer: number,
) {
  'worklet';
  const cw = Math.max(1, w - pad.left - pad.right);
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return pad.left + ((t - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
}

/** Same math as `toScreenX` for React `useMemo` (must not be a worklet). */
function toScreenXJs(
  t: number,
  now: number,
  win: number,
  w: number,
  pad: ChartPadding,
  buffer: number,
) {
  const cw = Math.max(1, w - pad.left - pad.right);
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return pad.left + ((t - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
}

function toScreenY(
  v: number,
  lo: number,
  hi: number,
  h: number,
  pad: ChartPadding,
) {
  'worklet';
  const ch = Math.max(1, h - pad.top - pad.bottom);
  const span = Math.max(0.0001, hi - lo);
  return pad.top + (1 - (v - lo) / span) * ch;
}

function interpAtTime(
  pts: readonly LiveLinePoint[],
  target: number,
  tipT: number,
  tipV: number,
) {
  'worklet';
  if (pts.length === 0) return tipV;
  if (target <= pts[0].time) return pts[0].value;
  for (let i = 1; i < pts.length; i++) {
    if (target <= pts[i].time) {
      const span = pts[i].time - pts[i - 1].time || 1;
      const p = (target - pts[i - 1].time) / span;
      return pts[i - 1].value + (pts[i].value - pts[i - 1].value) * p;
    }
  }
  const last = pts[pts.length - 1];
  if (target <= tipT) {
    const span = tipT - last.time || 1;
    return last.value + (tipV - last.value) * ((target - last.time) / span);
  }
  return tipV;
}

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
    if (pts[mid].time < target) lo = mid + 1;
    else hi = mid;
  }
  const upper = pts[lo];
  const lower = lo > 0 ? pts[lo - 1] : upper;
  let nearest = Math.abs(upper.time - target) < Math.abs(lower.time - target) ? upper : lower;
  if (Math.abs(tipT - target) < Math.abs(nearest.time - target)) {
    nearest = { time: tipT, value: tipV };
  }
  return nearest;
}

/** Scrub sample at pointer X — used in pan worklets (onBegin / onUpdate). */
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
  const liveX =
    pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
  const rawHx = clampW(x, pad.left, liveX);
  const rawHt = leftEdge + ((rawHx - pad.left) / chartWi) * (rightEdge - leftEdge);
  if (!snapToPoint) {
    const hv = interpAtTime(pts, rawHt, tipT, tipV);
    return { hx: rawHx, ht: rawHt, hv, liveX };
  }
  const nearest = nearestPointAtTime(pts, rawHt, tipT, tipV);
  const snappedX =
    pad.left + ((nearest.time - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
  return {
    hx: clampW(snappedX, pad.left, liveX),
    ht: nearest.time,
    hv: nearest.value,
    liveX,
  };
}

/** Candle scrub: X → time, nearest visible bucket, snap crosshair to candle center (matches NativeCandlestickChart). */
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
  const liveX =
    pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
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

type CandleScrubSample = {
  hx: number;
  hv: number;
  ht: number;
  liveX: number;
  candle: CandlePoint | null;
};

type LineScrubSample = {
  hx: number;
  hv: number;
  ht: number;
  liveX: number;
};

/** While candle↔line morph runs (`morphT` 0→1), ease scrub from snap-to-candle toward free line scrub. */
function candleLineMorphScrubBlend(
  morphT: number,
  c: CandleScrubSample,
  l: LineScrubSample,
): { hx: number; hv: number; ht: number; liveX: number; cand: CandlePoint | undefined } {
  'worklet';
  const w = morphT * morphT * (3 - 2 * morphT);
  const hx = c.hx + (l.hx - c.hx) * w;
  const hv = c.hv + (l.hv - c.hv) * w;
  const ht = c.ht + (l.ht - c.ht) * w;
  const cand = w < 0.34 && c.candle ? c.candle : undefined;
  return { hx, hv, ht, liveX: l.liveX, cand };
}

/* ------------------------------------------------------------------ */
/*  Grid ticks — upstream pickInterval + dashed grid                   */
/* ------------------------------------------------------------------ */

function calcGridTicks(
  minV: number,
  maxV: number,
  chartH: number,
  padT: number,
  padB: number,
  h: number,
  fmt: (v: number) => string,
  prevInt: number,
): { ticks: GridTick[]; interval: number } {
  const range = maxV - minV;
  if (chartH <= 0 || range <= 0) return { ticks: [], interval: prevInt };
  const ppu = chartH / range;
  const coarse = pickValueInterval(range, ppu, 36, prevInt);
  const fine = coarse / 2;
  const toY = (v: number) => padT + (1 - (v - minV) / range) * chartH;
  const fade = 32;
  const edge = (y: number) => {
    const d = Math.min(y - padT, h - padB - y);
    return d >= fade ? 1 : d <= 0 ? 0 : d / fade;
  };

  // Fine label visibility: based on pixel spacing between fine ticks
  const finePxSpacing = fine * ppu;
  let fineOp = 1;
  if (finePxSpacing < FINE_LABEL_HIDE_PX) fineOp = 0;
  else if (finePxSpacing < FINE_LABEL_SHOW_PX)
    fineOp = (finePxSpacing - FINE_LABEL_HIDE_PX) / (FINE_LABEL_SHOW_PX - FINE_LABEL_HIDE_PX);

  const ticks: GridTick[] = [];
  const first = Math.ceil(minV / fine) * fine;
  for (let v = first; v <= maxV; v += fine) {
    const y = toY(v);
    if (y < padT - 2 || y > h - padB + 2) continue;
    const isC =
      Math.abs(Math.round(v / coarse) * coarse - v) < coarse * 0.01;
    if (edge(y) < 0.02) continue;
    const edgeA = edge(y);
    ticks.push({
      value: v,
      y,
      text: fmt(v),
      isCoarse: isC,
      fineOp: isC ? edgeA : edgeA * fineOp,
    });
  }
  return { ticks, interval: coarse };
}

/* ------------------------------------------------------------------ */
/*  Time axis ticks — upstream niceTimeInterval                        */
/* ------------------------------------------------------------------ */

function calcTimeTicks(
  now: number,
  win: number,
  w: number,
  pad: ChartPadding,
  fmt: (t: number) => string,
  buffer: number,
): TimeTick[] {
  const cl = pad.left;
  const cr = w - pad.right;
  const cw = cr - cl;
  if (cw <= 0) return [];

  const { leftEdge, rightEdge } = windowEdges(now, win, buffer);
  const left = leftEdge;
  const right = rightEdge;
  const pps = cw / (rightEdge - leftEdge || 1);
  let interval = niceTimeInterval(win);
  while (interval * pps < 60 && interval < win) interval *= 2;

  const toX = (t: number) => cl + ((t - left) / (right - left || 1)) * cw;
  const fadeZ = 50;
  const edge = (x: number) => {
    const d = Math.min(x - cl, cr - x);
    return d >= fadeZ ? 1 : d <= 0 ? 0 : d / fadeZ;
  };

  const first = Math.ceil((left - interval) / interval) * interval;
  const out: TimeTick[] = [];
  for (let t = first; t <= right + interval && out.length < 30; t += interval) {
    const x = toX(t);
    if (x < cl - 20 || x > cr + 20) continue;
    if (edge(x) < 0.05) continue;
    out.push({ time: t, x, text: fmt(t) });
  }
  return out;
}

function buildAnimatedTailPath(
  pts: readonly LiveLinePoint[],
  tipT: number,
  tipV: number,
  buildTipT: number,
  buildMin: number,
  buildMax: number,
  currentMin: number,
  currentMax: number,
  w: number,
  h: number,
  pad: ChartPadding,
  win: number,
  buf: number,
) {
  'worklet';
  if (pts.length === 0 || w <= 0 || h <= 0) return '';

  const ch = Math.max(1, h - pad.top - pad.bottom);
  const cw = Math.max(1, w - pad.left - pad.right);
  const buildSpan = Math.max(1e-4, buildMax - buildMin);
  const currentSpan = Math.max(1e-4, currentMax - currentMin);
  const rightEdgeBuild = buildTipT + win * buf;
  const leftEdgeBuild = rightEdgeBuild - win;
  const rightEdgeCurrent = tipT + win * buf;
  const leftEdgeCurrent = rightEdgeCurrent - win;
  const dx = -((tipT - buildTipT) / Math.max(win, 1e-4)) * cw;
  const scaleY = buildSpan / currentSpan;
  const translateY =
    (pad.top + ch) * (1 - scaleY) + ((currentMin - buildMin) / buildSpan) * ch * scaleY;
  const yMin = pad.top;
  const yMax = h - pad.bottom;
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));

  let spCount = 0;
  const tailStart = Math.max(0, pts.length - LIVE_TAIL_HISTORY_POINTS);
  for (let i = tailStart; i < pts.length; i++) {
    const point = pts[i]!;
    const value = i === pts.length - 1 ? tipV : point.value;
    const x =
      pad.left + ((point.time - leftEdgeBuild) / (rightEdgeBuild - leftEdgeBuild || 1)) * cw + dx;
    const yBuild = pad.top + (1 - (value - buildMin) / buildSpan) * ch;
    const y = clampY(yBuild * scaleY + translateY);
    _tailX[spCount] = x;
    _tailY[spCount] = y;
    spCount++;
  }

  if (spCount === 0) return '';

  const tipX =
    pad.left + ((tipT - leftEdgeCurrent) / (rightEdgeCurrent - leftEdgeCurrent || 1)) * cw;
  const tipY = clampY(pad.top + (1 - (tipV - currentMin) / currentSpan) * ch);
  if (Math.abs(_tailX[spCount - 1]! - tipX) < 0.5) {
    _tailX[spCount - 1] = tipX;
    _tailY[spCount - 1] = tipY;
  } else {
    _tailX[spCount] = tipX;
    _tailY[spCount] = tipY;
    spCount++;
  }

  return buildSplinePathFromBuffers(_tailX, _tailY, spCount);
}

function buildAnimatedTailPathToSkPath(
  path: SkPath,
  pts: readonly LiveLinePoint[],
  tipT: number,
  tipV: number,
  buildTipT: number,
  buildMin: number,
  buildMax: number,
  currentMin: number,
  currentMax: number,
  w: number,
  h: number,
  pad: ChartPadding,
  win: number,
  buf: number,
) {
  'worklet';
  path.reset();
  if (pts.length === 0 || w <= 0 || h <= 0) return;

  const ch = Math.max(1, h - pad.top - pad.bottom);
  const cw = Math.max(1, w - pad.left - pad.right);
  const buildSpan = Math.max(1e-4, buildMax - buildMin);
  const currentSpan = Math.max(1e-4, currentMax - currentMin);
  const rightEdgeBuild = buildTipT + win * buf;
  const leftEdgeBuild = rightEdgeBuild - win;
  const rightEdgeCurrent = tipT + win * buf;
  const leftEdgeCurrent = rightEdgeCurrent - win;
  const dx = -((tipT - buildTipT) / Math.max(win, 1e-4)) * cw;
  const scaleY = buildSpan / currentSpan;
  const translateY =
    (pad.top + ch) * (1 - scaleY) + ((currentMin - buildMin) / buildSpan) * ch * scaleY;
  const yMin = pad.top;
  const yMax = h - pad.bottom;
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));

  // Use tiny fixed-size flat arrays (LIVE_TAIL_HISTORY_POINTS = 3, so max ~5 points)
  let spCount = 0;
  const tailStart = Math.max(0, pts.length - LIVE_TAIL_HISTORY_POINTS);
  for (let i = tailStart; i < pts.length; i++) {
    const point = pts[i]!;
    const value = i === pts.length - 1 ? tipV : point.value;
    const x =
      pad.left + ((point.time - leftEdgeBuild) / (rightEdgeBuild - leftEdgeBuild || 1)) * cw + dx;
    const yBuild = pad.top + (1 - (value - buildMin) / buildSpan) * ch;
    const y = clampY(yBuild * scaleY + translateY);
    _tailX[spCount] = x;
    _tailY[spCount] = y;
    spCount++;
  }

  if (spCount === 0) return;

  const tipX =
    pad.left + ((tipT - leftEdgeCurrent) / (rightEdgeCurrent - leftEdgeCurrent || 1)) * cw;
  const tipY = clampY(pad.top + (1 - (tipV - currentMin) / currentSpan) * ch);
  if (Math.abs(_tailX[spCount - 1]! - tipX) < 0.5) {
    _tailX[spCount - 1] = tipX;
    _tailY[spCount - 1] = tipY;
  } else {
    _tailX[spCount] = tipX;
    _tailY[spCount] = tipY;
    spCount++;
  }

  buildSplinePathToSkPathFromBuffers(path, _tailX, _tailY, spCount);
}

/* ------------------------------------------------------------------ */
/*  Loading path                                                       */
/* ------------------------------------------------------------------ */

function buildLoadingPath(
  w: number,
  h: number,
  pad: ChartPadding,
  ms: number,
): string {
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const cY = pad.top + ch / 2;
  const amp = ch * LOADING_AMPLITUDE_RATIO;
  const scroll = ms * LOADING_SCROLL_SPEED;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    pts.push({ x: pad.left + t * cw, y: loadingY(t, cY, amp, scroll) });
  }
  return monotoneSplinePath(pts);
}

/* ------------------------------------------------------------------ */
/*  Particle burst — matching upstream spawnOnSwing physics            */
/* ------------------------------------------------------------------ */

function spawnBurst(
  dx: number,
  dy: number,
  mom: Momentum,
  accent: string,
  mag: number,
  ids: { current: number },
  options?: DegenOptions,
): ParticleSpec[] {
  if (mom === 'down' && options?.downMomentum !== true) return [];
  const isUp = mom === 'up';
  const mg = Math.min(mag * 5, 1);
  const scale = options?.scale ?? 1;
  const count = Math.round((6 + mg * 8) * scale);
  const speedMul = 1 + mg * 0.55;
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count && out.length < MAX_PARTICLE_BURST; i++) {
    const base = isUp ? -Math.PI / 2 : Math.PI / 2;
    const angle = base + (Math.random() - 0.5) * Math.PI * 1.2;
    const spd = (60 + Math.random() * 100) * speedMul;
    out.push({
      id: ids.current++,
      x: dx + (Math.random() - 0.5) * 24,
      y: dy + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: PARTICLE_LIFE_MS,
      size: (1 + Math.random() * 1.2) * scale,
      color: accent,
    });
  }
  return out;
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

const WindowBtn = React.memo(function WindowBtn({
  active,
  label,
  onPress,
  activeColor,
  inactiveColor,
  borderRadius,
  paddingH,
  paddingV,
  onLayout,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
  borderRadius: number;
  paddingH: number;
  paddingV: number;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable
      onLayout={onLayout}
      onPress={onPress}
      style={({ pressed }) => [
        { paddingHorizontal: paddingH, paddingVertical: paddingV, borderRadius },
        pressed && { opacity: 0.82 },
      ]}
    >
      <Text
        style={[
          styles.windowBtnTxt,
          { color: inactiveColor },
          active && { fontWeight: '600' as const, color: activeColor },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export function NativeLiveLineChart({
  data,
  value,
  theme = 'dark',
  color = '#3b82f6',
  lineWidth,
  window: controlledWin = 30,
  windows,
  onWindowChange,
  windowStyle: windowStyleProp = 'default',
  grid = true,
  fill = true,
  badge = true,
  badgeVariant = 'default',
  paused = false,
  badgeNumberFlow = true,
  pulse = true,
  scrub = true,
  scrubNumberFlow = true,
  snapToPointScrubbing = false,
  pinchToZoom = false,
  scrubHaptics = true,
  momentum: momProp = true,
  degen = false,
  referenceLine,
  liveDotGlow = true,
  lineTrailGlow = true,
  gradientLineColoring = false,
  exaggerate = false,
  tooltipY = 14,
  tooltipOutline = true,
  height = DEFAULT_HEIGHT,
  loading = false,
  emptyText = 'Waiting for ticks',
  formatValue = defaultFmtVal,
  formatTime = defaultFmtTime,
  lerpSpeed = 0.08,
  streamDelay = 0,
  mode,
  candles: candlesProp,
  liveCandle,
  candleWidth: candleWidthProp,
  lineMode = false,
  lineData,
  lineValue,
  onModeChange,
  onLineModeChange,
  showBuiltInModeToggle = false,
  showBuiltInMorphToggle = false,
  orderbook: orderbookProp,
  style,
  contentInset,
}: LiveLineChartProps) {
  const buf = windowBuffer(badge);
  const isDark = theme === 'dark';
  const isCandle = mode === 'candle';
  const ws: LiveLineWindowStyle = windowStyleProp ?? 'default';
  const degenEnabled = degen !== false;
  const degenOptions = typeof degen === 'object' ? degen : undefined;

  /* ---- palette ---- */
  const pal = useMemo(
    () => resolvePalette(color, theme, lineWidth),
    [color, theme, lineWidth],
  );

  const [smoothedLive, setSmoothedLive] = useState<CandlePoint | null>(null);
  const smoothedLiveRef = useRef<CandlePoint | null>(null);
  useEffect(() => {
    smoothedLiveRef.current = smoothedLive;
  }, [smoothedLive]);

  const skiaDefaultNumberFormat = useMemo(
    () => supportsTwoDecimalNumberFlow(formatValue),
    [formatValue],
  );
  const badgeNumFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 11);
  const scrubTipFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 13);
  const orderbookStreamFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 10);
  const skiaBadgeFlow =
    badge && badgeNumberFlow !== false && skiaDefaultNumberFormat && badgeNumFont != null;
  const skiaScrubFlow =
    scrub && scrubNumberFlow !== false && skiaDefaultNumberFormat;
  const lineRevealStartRgb = useMemo(() => parseColorRgb(pal.gridLabel), [pal.gridLabel]);
  const lineRevealEndRgb = useMemo(() => parseColorRgb(pal.accent), [pal.accent]);

  const winUi = useMemo(
    () => ({
      indicatorBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
      activeTxt: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)',
      inactiveTxt: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)',
    }),
    [isDark],
  );

  const winBarMetrics = useMemo(() => {
    const barBg =
      ws === 'text'
        ? 'transparent'
        : isDark
          ? 'rgba(255,255,255,0.03)'
          : 'rgba(0,0,0,0.02)';
    if (ws === 'text') {
      return {
        gap: 4,
        barRadius: 0,
        barPadding: 0,
        barBg,
        showIndicator: false,
        btnRadius: 4,
        padH: 6,
        padV: 2,
        indRadius: 4,
      };
    }
    if (ws === 'rounded') {
      return {
        gap: 2,
        barRadius: 999,
        barPadding: 3,
        barBg,
        showIndicator: true,
        btnRadius: 999,
        padH: 10,
        padV: 3,
        indRadius: 999,
      };
    }
    return {
      gap: 2,
      barRadius: 6,
      barPadding: 2,
      barBg,
      showIndicator: true,
      btnRadius: 4,
      padH: 10,
      padV: 3,
      indRadius: 4,
    };
  }, [ws, isDark]);

  /* ---- layout ---- */
  const [layout, setLayout] = useState({ width: 0, height });
  const pad = useMemo<ChartPadding>(
    () => ({
      top: contentInset?.top ?? 12,
      right:
        contentInset?.right ??
        (badge ? 80 : grid ? 54 : 12),
      bottom: contentInset?.bottom ?? 28,
      left: contentInset?.left ?? 12,
    }),
    [contentInset, grid, badge],
  );
  const padTopForEngine = pad.top;
  const padBottomForEngine = pad.bottom;

  /* ---- time window with smooth transition (upstream log-space cosine easing) ---- */
  const resolvedWin = useMemo(() => {
    if (!windows?.length) return controlledWin;
    if (windows.some((w) => w.secs === controlledWin)) return controlledWin;
    return windows[0].secs;
  }, [windows, controlledWin]);
  const [pinchWindow, setPinchWindow] = useState<number | null>(null);
  const baseWin = pinchWindow ?? resolvedWin;
  const maxPinchWindow = useMemo(() => {
    const largestWindow = windows?.length ? Math.max(...windows.map((entry) => entry.secs)) : resolvedWin;
    return Math.max(largestWindow, resolvedWin) * PINCH_WINDOW_MAX_MULTIPLIER;
  }, [windows, resolvedWin]);

  /** Window transition state — tracks animated window secs via worklet frame callback. */
  const winTransRef = useRef<{
    from: number;
    to: number;
    startMs: number;
    active: boolean;
  }>({ from: baseWin, to: baseWin, startMs: 0, active: false });
  const svWinFrom = useSharedValue(baseWin);
  const svWinTo = useSharedValue(baseWin);
  const svWinProgress = useSharedValue(1); // 0=from, 1=to (done)
  const svWinTransActive = useSharedValue(0);
  /** Current effective window secs (animated). Used by rendering. */
  const [effectiveWin, setEffectiveWin] = useState(baseWin);
  const effectiveWinRef = useRef(baseWin);
  useEffect(() => {
    effectiveWinRef.current = effectiveWin;
  }, [effectiveWin]);

  /** Trigger a smooth window transition when the target render window changes. */
  const prevResolvedWin = useRef(baseWin);
  useEffect(() => {
    if (prevResolvedWin.current === baseWin) return;
    const from = prevResolvedWin.current;
    prevResolvedWin.current = baseWin;
    winTransRef.current = {
      from,
      to: baseWin,
      startMs: performance.now(),
      active: true,
    };
    svWinFrom.value = from;
    svWinTo.value = baseWin;
    svWinProgress.value = 0;
    svWinTransActive.value = 1;
  }, [baseWin, svWinFrom, svWinTo, svWinProgress, svWinTransActive]);

  useEffect(() => {
    setPinchWindow(null);
  }, [resolvedWin]);

  /** Compute effective window: animated if in transition, else target. */
  const win = effectiveWin;

  const slotLayoutsRef = useRef<Record<number, { x: number; width: number }>>({});
  const indLeft = useSharedValue(0);
  const indWidth = useSharedValue(0);
  const indOpacity = useSharedValue(0);
  const indEverPlaced = useRef(false);

  const moveWindowIndicator = useCallback(
    (x: number, width: number, instant: boolean) => {
      const duration = instant ? 0 : 250;
      const easing = Easing.bezier(0.4, 0, 0.2, 1);
      indLeft.value = withTiming(x, { duration, easing });
      indWidth.value = withTiming(width, { duration, easing });
      indOpacity.value = withTiming(1, { duration: instant ? 0 : 80 });
    },
    [indLeft, indWidth, indOpacity],
  );

  const onWindowSlotLayout = useCallback(
    (secs: number, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      slotLayoutsRef.current[secs] = { x, width };
      if (!winBarMetrics.showIndicator || secs !== resolvedWin) return;
      moveWindowIndicator(x, width, !indEverPlaced.current);
      indEverPlaced.current = true;
    },
    [resolvedWin, winBarMetrics.showIndicator, moveWindowIndicator],
  );

  useLayoutEffect(() => {
    if (!windows?.length || !winBarMetrics.showIndicator) return;
    const m = slotLayoutsRef.current[resolvedWin];
    if (m) {
      moveWindowIndicator(m.x, m.width, !indEverPlaced.current);
      indEverPlaced.current = true;
    }
  }, [resolvedWin, windows, winBarMetrics.showIndicator, moveWindowIndicator]);

  useEffect(() => {
    if (!winBarMetrics.showIndicator) indEverPlaced.current = false;
  }, [winBarMetrics.showIndicator]);

  const windowIndStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: indLeft.value,
    width: indWidth.value,
    top: 0,
    bottom: 0,
    opacity: indOpacity.value,
  }));

  /* ---- chart reveal (loading → data morph, upstream 0→1) ---- */
  const svReveal = useSharedValue(0);
  /** Track whether we've started revealing. */
  const revealStartedRef = useRef(false);

  /* ---- badge Y lerp (smooth vertical tracking) ---- */
  const svBadgeY = useSharedValue(0);
  const svBadgeYInit = useRef(false);

  /* ---- momentum color (R,G,B shared values for badge bg blending) ---- */
  const svMomColorR = useSharedValue(0);
  const svMomColorG = useSharedValue(0);
  const svMomColorB = useSharedValue(0);
  const momColorInitRef = useRef(false);

  /* ---- chart shake (degen mode) ---- */
  const svShakeX = useSharedValue(0);
  const svShakeY = useSharedValue(0);

  /* ---- particles ---- */
  const [particles, setParticles] = useState<ParticleSpec[]>([]);
  const idRef = useRef(0);
  const burstRef = useRef({ cooldown: 0, burstCount: 0 });

  /* ---- loading animation ---- */
  const [loadMs, setLoadMs] = useState(0);
  const gridIntRef = useRef(0);
  /** Y-range used for grid / labels — tracks smoothed `svMin`/`svMax` from the UI thread. */
  const [gridSmooth, setGridSmooth] = useState<{ min: number; max: number } | null>(null);
  const gridSmoothRef = useRef<{ min: number; max: number } | null>(null);
  const didRangeInitRef = useRef(false);
  useEffect(() => {
    gridSmoothRef.current = gridSmooth;
  }, [gridSmooth]);

  const flushEngineFrame = useCallback((payload: EngineFrameFlushPayload) => {
    if (payload.effectiveWin != null) {
      const prevWin = effectiveWinRef.current;
      if (Math.abs(prevWin - payload.effectiveWin) > 1e-6) {
        effectiveWinRef.current = payload.effectiveWin;
        setEffectiveWin(payload.effectiveWin);
      }
    }

    if (payload.smoothedDisplay) {
      const next = {
        time: payload.smoothedDisplay.t,
        open: payload.smoothedDisplay.o,
        high: payload.smoothedDisplay.h,
        low: payload.smoothedDisplay.l,
        close: payload.smoothedDisplay.c,
      };
      const prev = smoothedLiveRef.current;
      if (
        !prev ||
        prev.time !== next.time ||
        prev.open !== next.open ||
        prev.high !== next.high ||
        prev.low !== next.low ||
        prev.close !== next.close
      ) {
        smoothedLiveRef.current = next;
        setSmoothedLive(next);
      }
    }

    if (payload.grid) {
      const prev = gridSmoothRef.current;
      if (!prev || Math.abs(prev.min - payload.grid.min) > 1e-12 || Math.abs(prev.max - payload.grid.max) > 1e-12) {
        gridSmoothRef.current = payload.grid;
        setGridSmooth(payload.grid);
      }
    }

    if (payload.stop) {
      setEngineActive((prev) => (prev ? false : prev));
    }
  }, []);

  useEffect(() => {
    if (!loading && data.length >= 2) return;
    const tick = () => {
      if (paused) return;
      setLoadMs(typeof performance !== 'undefined' ? performance.now() : Date.now());
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [loading, data.length, paused]);

  /* ---- pause snapshot ---- */
  const pausedSnapshotRef = useRef<{ data: LiveLinePoint[]; value: number } | null>(null);
  if (paused) {
    if (pausedSnapshotRef.current === null && data.length >= 2) {
      pausedSnapshotRef.current = {
        data: data.slice(),
        value,
      };
    }
  } else if (pausedSnapshotRef.current !== null) {
    pausedSnapshotRef.current = null;
  }

  /* ---- derived data ---- */
  const effectiveData = pausedSnapshotRef.current?.data ?? data;
  const effectiveValue = pausedSnapshotRef.current?.value ?? value;
  const now = effectiveData[effectiveData.length - 1]?.time ?? Date.now() / 1000;
  const [axisWallSec, setAxisWallSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    setAxisWallSec((w) => (now > w ? now : w));
  }, [now]);
  useEffect(() => {
    if (layout.width <= 0 || effectiveData.length < 2 || loading || paused) return;
    const id = setInterval(() => setAxisWallSec(Date.now() / 1000), LIVE_AXIS_WALL_MS);
    return () => clearInterval(id);
  }, [layout.width, effectiveData.length, loading, paused]);
  const axisNow = Math.max(now, axisWallSec);
  const vis = useMemo(
    () => getVisible(effectiveData, axisNow, win, buf),
    [effectiveData, axisNow, win, buf],
  );

  const morphLineData = useMemo(
    () => (lineData ?? effectiveData) as LiveLinePoint[],
    [lineData, effectiveData],
  );

  /* ---- candle mode data ---- */
  const candleMergedRef = useRef<CandlePoint[]>([]);
  const candleMerged = useMemo(() => {
    if (!isCandle) {
      candleMergedRef.current = [];
      return [];
    }
    const cp = candlesProp ?? [];
    const lc = liveCandle;
    const prev = candleMergedRef.current;

    // Fast path: only the live candle changed (most common at high tick rates)
    if (
      prev.length > 0 &&
      lc &&
      cp.length > 0 &&
      prev.length === cp.length + 1 &&
      prev[prev.length - 2].time === cp[cp.length - 1].time &&
      prev[prev.length - 1].time === lc.time
    ) {
      const next = prev.slice();
      next[next.length - 1] = lc;
      candleMergedRef.current = next;
      return next;
    }

    const map = new Map<number, CandlePoint>();
    for (const c of cp) map.set(c.time, c);
    if (lc) map.set(lc.time, lc);
    const next = [...map.values()].sort((a, b) => a.time - b.time);
    candleMergedRef.current = next;
    return next;
  }, [isCandle, candlesProp, liveCandle]);

  const candleVisible = useMemo(() => {
    if (!isCandle || candleMerged.length === 0) return [];
    const { leftEdge, rightEdge } = windowEdges(axisNow, win, buf);
    return candleMerged.filter((c) => c.time >= leftEdge - 2 && c.time <= rightEdge + 1);
  }, [isCandle, candleMerged, axisNow, win, buf]);

  const candleWidthSecs = useMemo(
    () => (isCandle ? inferCandleWidthSecs(candleVisible, win) : 1),
    [isCandle, candleVisible, win],
  );

  const candleVisibleForLayout = useMemo(() => {
    if (!isCandle || candleVisible.length === 0) return [];
    const last = candleVisible[candleVisible.length - 1];
    if (
      smoothedLive &&
      liveCandle &&
      last.time === liveCandle.time &&
      smoothedLive.time === liveCandle.time
    ) {
      return [...candleVisible.slice(0, -1), smoothedLive];
    }
    return candleVisible;
  }, [candleVisible, isCandle, liveCandle, smoothedLive]);

  const rng = useMemo(() => {
    if (isCandle && candleVisible.length > 0) {
      // OHLC range for candle mode
      let cMin = Infinity;
      let cMax = -Infinity;
      for (const c of candleVisible) {
        if (c.low < cMin) cMin = c.low;
        if (c.high > cMax) cMax = c.high;
      }
      if (referenceLine?.value !== undefined) {
        if (referenceLine.value < cMin) cMin = referenceLine.value;
        if (referenceLine.value > cMax) cMax = referenceLine.value;
      }
      if (!isFinite(cMin) || !isFinite(cMax)) return { min: 0, max: 1 };
      const rawRange = cMax - cMin;
      const minRange = rawRange * 0.1 || 0.4;
      if (rawRange < minRange) {
        const mid = (cMin + cMax) / 2;
        return { min: mid - minRange / 2, max: mid + minRange / 2 };
      }
      const margin = rawRange * 0.12;
      return { min: cMin - margin, max: cMax + margin };
    }
    return computeRange(vis, effectiveValue, referenceLine?.value, exaggerate);
  }, [isCandle, candleVisible, vis, effectiveValue, referenceLine?.value, exaggerate]);
  const mom = useMemo(() => detectMomentum(vis), [vis]);
  const swMag = useMemo(
    () => computeSwingMagnitude(vis, effectiveValue, rng.min, rng.max),
    [vis, effectiveValue, rng.min, rng.max],
  );
  const momUi: 0 | 1 | 2 = mom === 'up' ? 1 : mom === 'down' ? 2 : 0;

  const chartW = layout.width - pad.left - pad.right;
  const chartH = layout.height - pad.top - pad.bottom;
  const empty = layout.width <= 0 || effectiveData.length < 2 || loading;

  /* ---- grid ticks ---- */
  const gridRes = useMemo(() => {
    const lo = gridSmooth?.min ?? rng.min;
    const hi = gridSmooth?.max ?? rng.max;
    const r = calcGridTicks(
      lo, hi, chartH, pad.top, pad.bottom,
      layout.height, formatValue, gridIntRef.current,
    );
    gridIntRef.current = r.interval;
    return r;
  }, [gridSmooth, rng.min, rng.max, chartH, pad.top, pad.bottom, layout.height, formatValue]);

  /* ---- time ticks ---- */
  const tTicks = useMemo(
    () => calcTimeTicks(axisNow, win, layout.width, pad, formatTime, buf),
    [axisNow, win, layout.width, pad, formatTime, buf],
  );
  const trackedGridLabels = useTrackedGridLabels(gridRes.ticks);
  const trackedTimeLabels = useTrackedTimeLabels(tTicks);
  const badgeFlowA11y = useMemo(() => effectiveValue.toFixed(2), [effectiveValue]);

  /** Candle badge / dash tint — prefer smoothed live OHLC when available. */
  const candleTip =
    isCandle && smoothedLive && liveCandle && smoothedLive.time === liveCandle.time
      ? smoothedLive
      : isCandle && candleMerged.length
        ? candleMerged[candleMerged.length - 1]!
        : null;
  const candleBadgeDashColor = useMemo(() => {
    if (!candleTip) return pal.dashLine;
    const isBull = candleTip.close >= candleTip.open;
    const c = isBull ? LIVELINE_CANDLE_BULL : LIVELINE_CANDLE_BEAR;
    const [r, g, b] = parseColorRgb(c);
    return `rgba(${r},${g},${b},0.35)`;
  }, [candleTip, pal.dashLine]);

  /* ---- shared values ---- */
  const initialTipT = streamDelay > 0 && effectiveData.length > 0
    ? Math.max(effectiveData[0]!.time, now - streamDelay)
    : now;
  const svTipT = useSharedValue(initialTipT);
  /** Last sample timestamp from props — `svTipT` eases toward max(this, wall clock) when the feed gaps. */
  const svDataTipT = useSharedValue(now);
  const svTipV = useSharedValue(effectiveValue);
  const svMin = useSharedValue(rng.min);
  const svMax = useSharedValue(rng.max);
  const svTargetMin = useSharedValue(rng.min);
  const svTargetMax = useSharedValue(rng.max);
  const svRawValue = useSharedValue(effectiveValue);
  const svChartH = useSharedValue(Math.max(1, chartH));
  const svLerpSpeed = useSharedValue(lerpSpeed);
  const svStreamDelay = useSharedValue(streamDelay);
  const svGridFlushAcc = useSharedValue(0);
  const svGridOn = useSharedValue(grid ? 1 : 0);
  const svPinchStartWin = useSharedValue(baseWin);
  const svPauseTarget = useSharedValue(paused ? 1 : 0);
  const svPauseProgress = useSharedValue(paused ? 1 : 0);
  const svScrubX = useSharedValue(-1);
  /** Interpolated Y value at crosshair — updated every pan frame for SkiaNumberFlow. */
  const svScrubHv = useSharedValue(0);
  const svScrubOp = useSharedValue(0);
  /** Throttle scrub tooltip runOnJS — line/crosshair still follow every frame via svScrubX. */
  const svScrubJsLastTs = useSharedValue(0);
  const svScrubJsLastHx = useSharedValue(-1e9);
  /** Throttle badge label runOnJS to ~42 Hz max (reduces JS thread pressure). */
  const svBadgeLastJsFlush = useSharedValue(0);
  const svScrubJsLastOp = useSharedValue(-1);
  const svBurst = useSharedValue(0);
  /** Single 0→1 timeline for all particles in the current burst (one `withTiming` instead of N). */
  const svBurstLife = useSharedValue(0);
  const svPulseWave = useSharedValue(1);
  const svArrowWave = useSharedValue(1);
  const svEngineIdleMs = useSharedValue(0);
  /** Upstream `arrowState` — cross-fade up/down before fading in new direction. */
  const svArrowUp = useSharedValue(0);
  const svArrowDown = useSharedValue(0);
  /** Pill width (px), lerped toward measured template width + horizontal padding. */
  const svBadgePillW = useSharedValue(74);
  /** Measured template text width (JS onLayout → UI thread). */
  const svBadgeTargetTextW = useSharedValue(28);
  /** Momentum on UI thread: 0 flat, 1 up, 2 down. */
  const svMom = useSharedValue(0);
  const svMomProp = useSharedValue(1);
  const svBadgeOn = useSharedValue(1);

  /** Candle OHLC targets + smoothed display (worklet lerps → JS merge for Skia layouts). */
  const svIsCandleFlag = useSharedValue(0);
  const svTargLiveO = useSharedValue(0);
  const svTargLiveH = useSharedValue(0);
  const svTargLiveL = useSharedValue(0);
  const svTargLiveC = useSharedValue(0);
  const svSmLiveO = useSharedValue(0);
  const svSmLiveH = useSharedValue(0);
  const svSmLiveL = useSharedValue(0);
  const svSmLiveC = useSharedValue(0);
  const svLiveBucketTime = useSharedValue(0);
  const svCandleEmitAcc = useSharedValue(0);
  const svLineModeProg = useSharedValue(0);
  /** Morph overlay line tip (tick value), independent of candle-close badge lerp. */
  const svMorphTipV = useSharedValue(0);
  const svStaticLinePath = useSharedValue('');
  const svStaticFillPath = useSharedValue('');
  const svStaticMorphLinePath = useSharedValue('');
  /** Skia `transform` must receive `SharedValue`, not `DerivedValue` — keep scalars here. */
  const svAnimTranslateX = useSharedValue(0);
  const svAnimRangeScaleY = useSharedValue(1);
  const svAnimRangeTranslateY = useSharedValue(0);
  const svIdentityTranslateX = useSharedValue(0);
  const svIdentityRangeScaleY = useSharedValue(1);
  const svIdentityRangeTranslateY = useSharedValue(0);
  const svFillRangeTransform = useSharedValue<RangeTransform>([
    { translateX: 0 },
    { translateY: 0 },
    { scaleY: 1 },
  ]);
  const svBuildMin = useSharedValue(0);
  const svBuildMax = useSharedValue(1);
  const svBuildTipT = useSharedValue(0);
  /** Last committed data point — worklet must not read `effectiveData` / `morphLineData` arrays (host crash). */
  const liveCandleBucketRef = useRef<number | null>(null);

  /** Full point arrays stored in SharedValues so worklets can build live tail paths on the UI thread. */
  const svEffectiveDataArr = useSharedValue<LiveLinePoint[]>([]);
  const svMorphLineDataArr = useSharedValue<LiveLinePoint[]>([]);
  const svCandleVisibleArr = useSharedValue<CandlePoint[]>([]);
  const svCandleWidthSecs = useSharedValue(1);

  const [lineMorphJs, setLineMorphJs] = useState(0);
  useAnimatedReaction(
    () => ({
      translateX: svAnimTranslateX.value,
      translateY: svAnimRangeTranslateY.value,
      scaleY: svAnimRangeScaleY.value,
    }),
    ({ translateX, translateY, scaleY }) => {
      svFillRangeTransform.value = [{ translateX }, { translateY }, { scaleY }];
    },
    [svAnimTranslateX, svAnimRangeTranslateY, svAnimRangeScaleY],
  );

  useAnimatedReaction(
    () => Math.round(svLineModeProg.value * 50) / 50,
    (v, prev) => {
      if (prev !== undefined && v === prev) return;
      runOnJS(setLineMorphJs)(v);
    },
    [],
  );

  const candleVisibleMorphed = useMemo(() => {
    if (!isCandle || candleVisibleForLayout.length === 0) return [];
    const lp = lineMorphJs;
    if (lp < 0.01) return candleVisibleForLayout;
    const inv = 1 - lp;
    return candleVisibleForLayout.map((c) => collapseCandleOHLC(c, inv));
  }, [candleVisibleForLayout, isCandle, lineMorphJs]);

  const liveCandleTime = liveCandle?.time ?? -1;
  const candleLayouts = useMemo(() => {
    if (!isCandle || chartW <= 0 || candleVisibleMorphed.length === 0) return [];
    const { leftEdge, rightEdge } = windowEdges(axisNow, win, buf);
    const lo = gridSmooth?.min ?? rng.min;
    const hi = gridSmooth?.max ?? rng.max;
    const maxBodyPx = candleWidthProp != null && candleWidthProp >= 12 ? candleWidthProp : undefined;
    return layoutLivelineCandles(
      candleVisibleMorphed,
      liveCandleTime,
      leftEdge,
      rightEdge,
      layout.width,
      layout.height,
      pad,
      lo,
      hi,
      candleWidthSecs,
      maxBodyPx,
    );
  }, [
    isCandle,
    candleVisibleMorphed,
    liveCandleTime,
    axisNow,
    win,
    buf,
    layout.width,
    layout.height,
    pad,
    gridSmooth,
    rng.min,
    rng.max,
    candleWidthSecs,
    chartW,
    candleWidthProp,
  ]);

  const [engineActive, setEngineActive] = useState(false);

  type BuildSnapshot = {
    range: { min: number; max: number };
    tipT: number;
    tipV: number;
    morphTipV: number;
  };

  const [buildSnapshot, setBuildSnapshot] = useState<BuildSnapshot>({
    range: { min: 0, max: 1 },
    tipT: 0,
    tipV: 0,
    morphTipV: 0,
  });

  const setPinchWindowStable = useCallback((nextWindow: number | null) => {
    setPinchWindow((prev) => {
      if (prev === nextWindow) return prev;
      if (prev !== null && nextWindow !== null && Math.abs(prev - nextWindow) < 0.05) return prev;
      return nextWindow;
    });
  }, []);
  const startEngine = useCallback(() => {
    setEngineActive(true);
  }, []);

  const dvScrubValueStr = useDerivedValue(() => {
    'worklet';
    return formatPriceCentsWorklet(svScrubHv.value);
  });

  const badgeQuantMul = formatValue === defaultFmtVal ? 100 : 10_000;
  /** Batch simple SharedValue config updates to reduce effect overhead. */
  useEffect(() => {
    svLerpSpeed.value = lerpSpeed;
    svStreamDelay.value = streamDelay;
    svChartH.value = Math.max(1, chartH);
    svGridOn.value = grid ? 1 : 0;
    svPauseTarget.value = paused ? 1 : 0;
  }, [lerpSpeed, streamDelay, chartH, grid, paused, svLerpSpeed, svStreamDelay, svChartH, svGridOn, svPauseTarget]);

  /** Batch data-driven SharedValue updates. */
  useEffect(() => {
    if (isCandle && liveCandle) {
      svRawValue.value = liveCandle.close;
    } else {
      svRawValue.value = effectiveValue;
    }
    svMorphTipV.value = lineValue ?? effectiveValue;
    svDataTipT.value = now;
  }, [
    isCandle,
    liveCandle,
    effectiveValue,
    lineValue,
    now,
    svRawValue,
    svMorphTipV,
    svDataTipT,
  ]);

  useEffect(() => {
    svIsCandleFlag.value = isCandle ? 1 : 0;
    if (!isCandle) setLineMorphJs(0);
  }, [isCandle, svIsCandleFlag]);

  useEffect(() => {
    cancelAnimation(svLineModeProg);
    if (!isCandle) {
      svLineModeProg.value = 0;
      return;
    }
    svLineModeProg.value = withTiming(lineMode ? 1 : 0, {
      duration: LINE_MORPH_MS,
      easing: Easing.inOut(Easing.quad),
    });
  }, [isCandle, lineMode, svLineModeProg]);

  useEffect(() => {
    if (!isCandle || !liveCandle) {
      setSmoothedLive(null);
      liveCandleBucketRef.current = null;
      return;
    }
    svTargLiveO.value = liveCandle.open;
    svTargLiveH.value = liveCandle.high;
    svTargLiveL.value = liveCandle.low;
    svTargLiveC.value = liveCandle.close;
    svLiveBucketTime.value = liveCandle.time;
    if (liveCandleBucketRef.current !== liveCandle.time) {
      liveCandleBucketRef.current = liveCandle.time;
      svSmLiveO.value = liveCandle.open;
      svSmLiveH.value = liveCandle.open;
      svSmLiveL.value = liveCandle.open;
      svSmLiveC.value = liveCandle.open;
    }
  }, [
    isCandle,
    liveCandle?.time,
    liveCandle?.open,
    liveCandle?.high,
    liveCandle?.low,
    liveCandle?.close,
    svTargLiveO,
    svTargLiveH,
    svTargLiveL,
    svTargLiveC,
    svLiveBucketTime,
    svSmLiveO,
    svSmLiveH,
    svSmLiveL,
    svSmLiveC,
  ]);

  useEffect(() => {
    if (empty) return;
    svTargetMin.value = rng.min;
    svTargetMax.value = rng.max;
  }, [empty, rng.min, rng.max, svTargetMin, svTargetMax]);

  useLayoutEffect(() => {
    if (empty) {
      didRangeInitRef.current = false;
      svBadgeYInit.current = false;
      setGridSmooth(null);
      svGridFlushAcc.value = 0;
      return;
    }
    if (!didRangeInitRef.current) {
      didRangeInitRef.current = true;
      svMin.value = rng.min;
      svMax.value = rng.max;
      svTargetMin.value = rng.min;
      svTargetMax.value = rng.max;
      svTipV.value = isCandle && liveCandle ? liveCandle.close : effectiveValue;
      setGridSmooth({ min: rng.min, max: rng.max });
      svGridFlushAcc.value = GRID_FLUSH_MS;
      // Initialize badge Y to target (no lerp on first frame)
      if (!svBadgeYInit.current && layout.height > 0) {
        svBadgeYInit.current = true;
        svBadgeY.value = toScreenY(effectiveValue, rng.min, rng.max, layout.height, pad);
      }
      // Initialize momentum color to accent
      if (!momColorInitRef.current) {
        const [r, g, b] = parseColorRgb(color);
        svMomColorR.value = r;
        svMomColorG.value = g;
        svMomColorB.value = b;
        momColorInitRef.current = true;
      }
    }
  }, [
    empty,
    rng.min,
    rng.max,
    effectiveValue,
    isCandle,
    liveCandle,
    svMin,
    svMax,
    svTargetMin,
    svTargetMax,
    svTipV,
    svGridFlushAcc,
  ]);

  useEffect(() => {
    svMom.value = mom === 'up' ? 1 : mom === 'down' ? 2 : 0;
  }, [mom, svMom]);

  useEffect(() => {
    svMomProp.value = momProp ? 1 : 0;
  }, [momProp, svMomProp]);

  useEffect(() => {
    svBadgeOn.value = badge ? 1 : 0;
  }, [badge, svBadgeOn]);

  /** Initialize momentum color to accent RGB. */
  useEffect(() => {
    if (!momColorInitRef.current) {
      const [r, g, b] = parseColorRgb(color);
      svMomColorR.value = r;
      svMomColorG.value = g;
      svMomColorB.value = b;
      momColorInitRef.current = true;
    }
  }, [color, svMomColorR, svMomColorG, svMomColorB]);

  /** Kick reveal when data arrives. */
  useEffect(() => {
    if (!empty && !revealStartedRef.current) {
      revealStartedRef.current = true;
      // reveal will be driven by frame callback
    }
    if (empty) {
      revealStartedRef.current = false;
      svReveal.value = 0;
    }
  }, [empty, svReveal]);

  useEffect(() => {
    if (empty) {
      svEngineIdleMs.value = 0;
      setEngineActive(false);
      return;
    }
    svEngineIdleMs.value = 0;
    startEngine();
  }, [
    empty,
    startEngine,
    effectiveValue,
    rng.min,
    rng.max,
    win,
    paused,
    badge,
    grid,
    mom,
  ]);

  useEffect(() => {
    cancelAnimation(svPulseWave);
    if (!pulse || empty || paused) {
      svPulseWave.value = 1;
      return;
    }
    svPulseWave.value = 0;
    svPulseWave.value = withTiming(1, {
      duration: PULSE_DURATION,
      easing: Easing.linear,
    });
  }, [pulse, empty, paused, now, svPulseWave]);

  useEffect(() => {
    cancelAnimation(svArrowWave);
    if (!momProp || empty || paused || mom === 'flat') {
      svArrowWave.value = 1;
      return;
    }
    svArrowWave.value = 0;
    svArrowWave.value = withTiming(1, {
      duration: ARROW_WAVE_DURATION_MS,
      easing: Easing.linear,
    });
  }, [momProp, empty, paused, mom, now, svArrowWave]);

  /** Stable worklet — avoids re-registering the frame callback every render. */
  const onEngineFrame = useCallback(
    (frameInfo: { timeSincePreviousFrame: number | null }) => {
      'worklet';
      const rawDt = frameInfo.timeSincePreviousFrame;
      const dt = Math.min(MAX_DELTA_MS, rawDt == null ? 16.67 : rawDt);
      const pauseTarget = svPauseTarget.value;
      let pauseProgress = lerpFr(svPauseProgress.value, pauseTarget, PAUSE_PROGRESS_SPEED, dt);
      if (pauseProgress < 0.005) pauseProgress = 0;
      if (pauseProgress > 0.995) pauseProgress = 1;
      svPauseProgress.value = pauseProgress;
      const engineDt = dt * (1 - pauseProgress);
      let pendingEffectiveWin: number | null = null;
      let pendingSmoothedDisplay: EngineFrameFlushPayload['smoothedDisplay'] = null;
      let pendingGrid: EngineFrameFlushPayload['grid'] = null;
      let shouldStopEngine = false;

      /* ---- Live tip time: glide on wall clock when samples are sparse / delayed ---- */
      if (pauseProgress < 0.995) {
        const wall = Date.now() / 1000;
        const dataT = svDataTipT.value;
        const delay = svStreamDelay.value;
        if (delay > 0) {
          // Delayed mode: tip advances linearly with wall clock, offset by delay.
          // Value is interpolated from historical data at the delayed time for a
          // perfectly flowy line even with sparse (1s / 3s) ticks.
          let targetT = wall - delay;
          const pts = svEffectiveDataArr.value;
          if (pts.length > 0) {
            const firstT = pts[0]!.time;
            const lastT = pts[pts.length - 1]!.time;
            if (targetT < firstT) targetT = firstT;
            if (targetT > lastT) targetT = lastT;
          }
          svTipT.value = targetT;
        } else {
          const targetT = wall > dataT ? wall : dataT;
          let tipT = svTipT.value;
          tipT = lerpFr(tipT, targetT, LIVE_TIP_CLOCK_CATCHUP, Math.max(engineDt, 0.0001));
          if (Math.abs(tipT - targetT) < 0.002) tipT = targetT;
          svTipT.value = tipT;
        }
      }

      /* ---- Horizontal scroll transform (static path follows tip time) ---- */
      {
        const buildTipT = svBuildTipT.value;
        const currentTipT = svTipT.value;
        const dx =
          -((currentTipT - buildTipT) / Math.max(win, 1e-4)) * Math.max(1, chartW);
        svAnimTranslateX.value = dx;
      }

      /* ---- Window transition (log-space cosine easing) ---- */
      if (svWinTransActive.value === 1) {
        // Accumulate progress using dt (frame-rate independent)
        let prog = svWinProgress.value + dt / WINDOW_TRANSITION_MS;
        if (prog > 1) prog = 1;
        svWinProgress.value = prog;
        const winVal = lerpWindowLogSpace(svWinFrom.value, svWinTo.value, prog);
        pendingEffectiveWin = winVal;
        if (prog >= 1) {
          svWinTransActive.value = 0;
          pendingEffectiveWin = svWinTo.value;
        }
      }

      /* ---- Chart reveal (0→1 smooth morph) ---- */
      if (svReveal.value < 1) {
        let rev = svReveal.value;
        rev = lerpFr(rev, 1, CHART_REVEAL_SPEED, dt);
        if (rev > 0.995) rev = 1;
        svReveal.value = rev;
      }

      /* ---- Value smoothing (live) or historical interpolation (delayed) ---- */
      const ch = svChartH.value;
      const dmin0 = svMin.value;
      const dmax0 = svMax.value;
      const delay = svStreamDelay.value;
      if (delay > 0) {
        // Delayed mode: sample the data array at the delayed tip time for
        // smooth, flowy motion between sparse ticks.
        const pts = svEffectiveDataArr.value;
        svTipV.value = interpolateValueAtTime(pts, svTipT.value, svRawValue.value);
      } else {
        const disp = svTipV.value;
        const tgt = svRawValue.value;
        const ls = svLerpSpeed.value;
        const spd = computeAdaptiveSpeed(tgt, disp, dmin0, dmax0, ls);
        const prevR = dmax0 - dmin0 || 1;
        let nextDisp = lerpFr(disp, tgt, spd, engineDt);
        if (Math.abs(nextDisp - tgt) < prevR * VALUE_SNAP_THRESHOLD) nextDisp = tgt;
        svTipV.value = nextDisp;
      }

      /* ---- Live candle OHLC smoothing (upstream `CANDLE_LERP_SPEED`) ---- */
      if (svIsCandleFlag.value === 1) {
        const spd = CANDLE_OHLC_LERP_SPEED;
        svSmLiveO.value = lerpFr(svSmLiveO.value, svTargLiveO.value, spd, engineDt);
        svSmLiveH.value = lerpFr(svSmLiveH.value, svTargLiveH.value, spd, engineDt);
        svSmLiveL.value = lerpFr(svSmLiveL.value, svTargLiveL.value, spd, engineDt);
        svSmLiveC.value = lerpFr(svSmLiveC.value, svTargLiveC.value, spd, engineDt);
        let acc = svCandleEmitAcc.value + dt;
        if (acc >= CANDLE_SMOOTH_EMIT_MS) {
          acc = 0;
          pendingSmoothedDisplay = {
            o: svSmLiveO.value,
            h: svSmLiveH.value,
            l: svSmLiveL.value,
            c: svSmLiveC.value,
            t: svLiveBucketTime.value,
          };
        }
        svCandleEmitAcc.value = acc;
      } else {
        svCandleEmitAcc.value = 0;
      }

      /* ---- Range smoothing (SEPARATE speed — upstream 0.15 + 0.2 adaptive) ---- */
      const curRange = dmax0 - dmin0 || 1;
      const tmin = svTargetMin.value;
      const tmax = svTargetMax.value;
      const rangeGap = Math.abs((tmax - tmin) - curRange);
      const rangeRatio = Math.min(rangeGap / curRange, 1);
      const rangeLerpSpd = RANGE_LERP_SPEED + (1 - rangeRatio) * RANGE_ADAPTIVE_BOOST;
      let nextMin = lerpFr(dmin0, tmin, rangeLerpSpd, engineDt);
      let nextMax = lerpFr(dmax0, tmax, rangeLerpSpd, engineDt);
      const pxTh = (0.5 * curRange) / ch || 0.001;
      if (Math.abs(nextMin - tmin) < pxTh) nextMin = tmin;
      if (Math.abs(nextMax - tmax) < pxTh) nextMax = tmax;
      svMin.value = nextMin;
      svMax.value = nextMax;

      /* ---- Range transform (static path follows range animation) ---- */
      {
        const bMin = svBuildMin.value;
        const bMax = svBuildMax.value;
        const buildSpan = Math.max(1e-4, bMax - bMin);
        const curSpan = Math.max(1e-4, nextMax - nextMin);
        const scaleY = buildSpan / curSpan;
        const translateY =
          (padTopForEngine + ch) * (1 - scaleY) + ((nextMin - bMin) / buildSpan) * ch * scaleY;
        svAnimRangeScaleY.value = scaleY;
        svAnimRangeTranslateY.value = translateY;
      }

      /* ---- Badge Y lerp (upstream BADGE_Y_LERP = 0.35) ---- */
      if (svBadgeOn.value === 1) {
        // Approximate full layout height from chartH + typical padding (12 + 28 = 40)
        const fullH = ch + 40;
        const padApprox = { top: 12, right: 0, bottom: 28, left: 0 } as ChartPadding;
        const targetBY = toScreenY(svTipV.value, svMin.value, svMax.value, fullH, padApprox);
        const bySpeed = svWinTransActive.value === 1 ? BADGE_Y_LERP_TRANSITION : BADGE_Y_LERP;
        let by = svBadgeY.value;
        by = lerpFr(by, targetBY, bySpeed, engineDt);
        if (Math.abs(by - targetBY) < 0.3) by = targetBY;
        svBadgeY.value = by;
      }

      /* ---- Momentum color blending (green up / red down / accent flat) ---- */
      if (svBadgeOn.value === 1) {
        const momentum = svMom.value;
        // Target RGB based on momentum direction
        let tR: number, tG: number, tB: number;
        if (momentum === 1) {
          // Up: green #22c55e
          tR = 34; tG = 197; tB = 94;
        } else if (momentum === 2) {
          // Down: red #ef4444
          tR = 239; tG = 68; tB = 68;
        } else {
          // Flat: accent color
          // We use a simple parse from the theme palette (pre-computed)
          tR = svMomColorR.value; tG = svMomColorG.value; tB = svMomColorB.value;
          // Only re-target accent when flat (stays at current until flat)
        }
        if (momentum !== 0) {
          svMomColorR.value = lerpFr(svMomColorR.value, tR, MOMENTUM_COLOR_SPEED, engineDt);
          svMomColorG.value = lerpFr(svMomColorG.value, tG, MOMENTUM_COLOR_SPEED, engineDt);
          svMomColorB.value = lerpFr(svMomColorB.value, tB, MOMENTUM_COLOR_SPEED, engineDt);
        }
      }

      /* ---- Grid flush ---- */
      if (svGridOn.value === 1) {
        svGridFlushAcc.value += engineDt;
        if (svGridFlushAcc.value >= GRID_FLUSH_MS) {
          svGridFlushAcc.value = 0;
          pendingGrid = { min: svMin.value, max: svMax.value };
        }
      }

      /* ---- Momentum arrows (cross-fade direction) ---- */
      if (svMomProp.value === 1) {
        const momentum = svMom.value;
        const upTarget = momentum === 1 ? 1 : 0;
        const downTarget = momentum === 2 ? 1 : 0;
        const canFadeInUp = svArrowDown.value < 0.02;
        const canFadeInDown = svArrowUp.value < 0.02;
        let up = svArrowUp.value;
        let down = svArrowDown.value;
        const upSpeed = upTarget > up ? 0.08 : 0.04;
        const downSpeed = downTarget > down ? 0.08 : 0.04;
        up = lerpFr(up, canFadeInUp ? upTarget : 0, upSpeed, engineDt);
        down = lerpFr(down, canFadeInDown ? downTarget : 0, downSpeed, engineDt);
        if (up < 0.01) up = 0;
        if (down < 0.01) down = 0;
        if (up > 0.99) up = 1;
        if (down > 0.99) down = 1;
        svArrowUp.value = up;
        svArrowDown.value = down;
      } else {
        svArrowUp.value = 0;
        svArrowDown.value = 0;
      }

      /* ---- Badge pill width ---- */
      if (svBadgeOn.value === 1) {
        const textTw = Math.max(8, svBadgeTargetTextW.value);
        const targetPillW = textTw + BADGE_PAD_X * 2;
        let w = svBadgePillW.value;
        if (w < 4) w = targetPillW;
        w = lerpFr(w, targetPillW, BADGE_WIDTH_LERP, engineDt);
        if (Math.abs(w - targetPillW) < 0.3) w = targetPillW;
        svBadgePillW.value = w;
      }

      /* ---- Chart shake decay (degen mode) ---- */
      if (svShakeX.value !== 0 || svShakeY.value !== 0) {
        svShakeX.value = decayShake(svShakeX.value, engineDt);
        svShakeY.value = decayShake(svShakeY.value, engineDt);
      }

      const displayRange = Math.max(0.0001, svMax.value - svMin.value);
      const valueSettled = Math.abs(svTipV.value - svRawValue.value) < displayRange * VALUE_SNAP_THRESHOLD;
      const rangeSettled =
        Math.abs(svMin.value - svTargetMin.value) < displayRange * 0.002 &&
        Math.abs(svMax.value - svTargetMax.value) < displayRange * 0.002;
      const revealSettled = svReveal.value >= 0.995;
      const pauseSettled = Math.abs(svPauseProgress.value - svPauseTarget.value) < 0.01;
      const badgeSettled =
        svBadgeOn.value === 0 ||
        Math.abs(svBadgePillW.value - (Math.max(8, svBadgeTargetTextW.value) + BADGE_PAD_X * 2)) < 0.4;
      const arrowSettled =
        svMomProp.value === 0 ||
        (svMom.value === 1
          ? Math.abs(svArrowUp.value - 1) < 0.02 && svArrowDown.value < 0.02
          : svMom.value === 2
            ? Math.abs(svArrowDown.value - 1) < 0.02 && svArrowUp.value < 0.02
            : svArrowUp.value < 0.02 && svArrowDown.value < 0.02);
      const shakeSettled = Math.abs(svShakeX.value) < 0.02 && Math.abs(svShakeY.value) < 0.02;

      if (
        valueSettled &&
        rangeSettled &&
        revealSettled &&
        pauseSettled &&
        badgeSettled &&
        arrowSettled &&
        shakeSettled &&
        svScrubOp.value <= 0.01 &&
        svWinTransActive.value === 0
      ) {
        const nextIdle = svEngineIdleMs.value + dt;
        svEngineIdleMs.value = nextIdle;
        if (nextIdle >= ENGINE_IDLE_STOP_MS) {
          svEngineIdleMs.value = -1e9;
          shouldStopEngine = true;
        }
      } else {
        svEngineIdleMs.value = 0;
      }

      if (
        pendingEffectiveWin !== null ||
        pendingSmoothedDisplay !== null ||
        pendingGrid !== null ||
        shouldStopEngine
      ) {
        runOnJS(flushEngineFrame)({
          effectiveWin: pendingEffectiveWin,
          smoothedDisplay: pendingSmoothedDisplay,
          grid: pendingGrid,
          stop: shouldStopEngine,
        });
      }
    },
    [
      flushEngineFrame,
      padTopForEngine,
      padBottomForEngine,
      svBuildMin,
      svBuildMax,
      svBuildTipT,
      svAnimTranslateX,
      svAnimRangeScaleY,
      svAnimRangeTranslateY,
      svMin,
      svMax,
      svChartH,
      chartW,
      win,
    ],
  );

  const engineFrame = useFrameCallback(onEngineFrame, false);

  useEffect(() => {
    engineFrame.setActive(!empty && engineActive);
    if (empty) {
      svArrowUp.value = 0;
      svArrowDown.value = 0;
      svShakeX.value = 0;
      svShakeY.value = 0;
    }
  }, [empty, engineActive, engineFrame, svArrowUp, svArrowDown, svShakeX, svShakeY]);

  useEffect(() => {
    setBuildSnapshot({
      range: { min: svMin.value, max: svMax.value },
      tipT: svTipT.value,
      tipV: svTipV.value,
      morphTipV: svMorphTipV.value,
    });
  }, [effectiveData, morphLineData, win, buf, svMin, svMax, svTipT, svTipV, svMorphTipV]);

  useEffect(() => {
    svBuildMin.value = buildSnapshot.range.min;
    svBuildMax.value = buildSnapshot.range.max;
    svBuildTipT.value = buildSnapshot.tipT;
  }, [buildSnapshot, svBuildMin, svBuildMax, svBuildTipT]);

  useEffect(() => {
    svEffectiveDataArr.value = effectiveData;
    svMorphLineDataArr.value = morphLineData;
  }, [effectiveData, morphLineData, svEffectiveDataArr, svMorphLineDataArr]);

  useEffect(() => {
    svCandleVisibleArr.value = candleVisibleForLayout;
  }, [candleVisibleForLayout, svCandleVisibleArr]);

  useEffect(() => {
    svCandleWidthSecs.value = candleWidthSecs;
  }, [candleWidthSecs, svCandleWidthSecs]);

  /* ---- degen burst ---- */
  const spawnPt = useMemo(
    () => ({
      x: toScreenXJs(axisNow, axisNow, win, layout.width, pad, buf),
      y: toScreenY(
        effectiveValue,
        gridSmooth?.min ?? rng.min,
        gridSmooth?.max ?? rng.max,
        layout.height,
        pad,
      ),
    }),
    [axisNow, win, layout.width, layout.height, pad, buf, effectiveValue, rng.min, rng.max, gridSmooth],
  );

  const clearBurstParticles = useCallback(() => {
    cancelAnimation(svBurstLife);
    setParticles([]);
  }, [svBurstLife]);

  useEffect(() => {
    if (!degenEnabled || layout.width <= 0 || mom === 'flat') return;
    if (swMag < MAGNITUDE_THRESHOLD) {
      burstRef.current.burstCount = 0;
      return;
    }
    if (burstRef.current.burstCount >= MAX_BURSTS) return;
    const nowMs = Date.now();
    if (nowMs - burstRef.current.cooldown < PARTICLE_COOLDOWN_MS) return;
    burstRef.current.cooldown = nowMs;
    burstRef.current.burstCount++;

    svBurst.value = withSequence(
      withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 760, easing: Easing.out(Easing.quad) }),
    );

    // Chart shake (upstream: amplitude = (3 + swingMag * 4) * burstIntensity)
    const burstIntensity = burstRef.current.burstCount <= 1 ? 1 : burstRef.current.burstCount <= 2 ? 0.6 : 0.35;
    const amp = shakeAmplitude(swMag, burstIntensity);
    const shake = randomShakeOffset(amp);
    svShakeX.value = shake.x;
    svShakeY.value = shake.y;

    svBurstLife.value = 0;
    setParticles(spawnBurst(spawnPt.x, spawnPt.y, mom, pal.accent, swMag, idRef, degenOptions));
    svBurstLife.value = withTiming(
      1,
      { duration: PARTICLE_LIFE_MS, easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(clearBurstParticles)();
      },
    );
  }, [degenEnabled, degenOptions, layout.width, mom, swMag, spawnPt, pal.accent, effectiveValue, svBurstLife, clearBurstParticles]);

  useEffect(() => {
    if (!degenEnabled || empty || mom === 'flat') {
      cancelAnimation(svBurstLife);
      setParticles([]);
    }
  }, [degenEnabled, empty, mom, svBurstLife]);

  /* ================================================================ */
  /*  ALL derived values (hooks) — BEFORE return                      */
  /* ================================================================ */

  const clipRect = useMemo(
    () =>
      chartW > 0 && chartH > 0
        ? rect(pad.left - 1, pad.top, chartW + 2, chartH)
        : undefined,
    [chartW, chartH, pad.left, pad.top],
  );

  const staticLinePath = useMemo(
    () =>
      buildPath(
        effectiveData,
        buildSnapshot.tipT,
        buildSnapshot.tipV,
        buildSnapshot.range.min,
        buildSnapshot.range.max,
        layout.width,
        layout.height,
        pad,
        win,
        buf,
        false,
        false,
        LIVE_TAIL_HISTORY_POINTS,
      ),
    [effectiveData, buildSnapshot, layout.width, layout.height, pad, win, buf],
  );

  const staticMorphLinePath = useMemo(
    () =>
      buildPath(
        morphLineData,
        buildSnapshot.tipT,
        buildSnapshot.morphTipV,
        buildSnapshot.range.min,
        buildSnapshot.range.max,
        layout.width,
        layout.height,
        pad,
        win,
        buf,
        false,
        false,
        LIVE_TAIL_HISTORY_POINTS,
      ),
    [morphLineData, buildSnapshot, layout.width, layout.height, pad, win, buf],
  );

  const staticFillPath = useMemo(
    () =>
      buildPath(
        effectiveData,
        buildSnapshot.tipT,
        buildSnapshot.tipV,
        buildSnapshot.range.min,
        buildSnapshot.range.max,
        layout.width,
        layout.height,
        pad,
        win,
        buf,
        true,
      ),
    [effectiveData, buildSnapshot, layout.width, layout.height, pad, win, buf],
  );

  /** Batch static path SharedValue updates into a single effect. */
  useEffect(() => {
    svStaticLinePath.value = staticLinePath;
    svStaticMorphLinePath.value = staticMorphLinePath;
    svStaticFillPath.value = staticFillPath;
  }, [
    staticLinePath,
    staticMorphLinePath,
    staticFillPath,
    svStaticLinePath,
    svStaticMorphLinePath,
    svStaticFillPath,
  ]);

  const tipPadL = pad.left;
  const tipPadR = pad.right;
  const tipPadT = pad.top;
  const tipPadB = pad.bottom;
  const tipLayW = layout.width;
  const tipLayH = layout.height;

  const svAnimatedLinePath = useDerivedValue(() => {
    'worklet';
    return buildPath(
      svEffectiveDataArr.value,
      svTipT.value,
      svTipV.value,
      svMin.value,
      svMax.value,
      tipLayW,
      tipLayH,
      { left: tipPadL, right: tipPadR, top: tipPadT, bottom: tipPadB },
      win,
      buf,
      false,
    );
  }, [
    tipLayW,
    tipLayH,
    tipPadL,
    tipPadR,
    tipPadT,
    tipPadB,
    win,
    buf,
    svEffectiveDataArr,
    svMin,
    svMax,
    svTipT,
    svTipV,
  ]);

  const svAnimatedMorphLinePath = useDerivedValue(() => {
    'worklet';
    return buildPath(
      svMorphLineDataArr.value,
      svTipT.value,
      svMorphTipV.value,
      svMin.value,
      svMax.value,
      tipLayW,
      tipLayH,
      { left: tipPadL, right: tipPadR, top: tipPadT, bottom: tipPadB },
      win,
      buf,
      false,
    );
  }, [
    tipLayW,
    tipLayH,
    tipPadL,
    tipPadR,
    tipPadT,
    tipPadB,
    win,
    buf,
    svMorphLineDataArr,
    svMin,
    svMax,
    svTipT,
    svMorphTipV,
  ]);

  const svAnimatedFillPath = useDerivedValue(() => {
    'worklet';
    return buildPath(
      svEffectiveDataArr.value,
      svTipT.value,
      svTipV.value,
      svMin.value,
      svMax.value,
      tipLayW,
      tipLayH,
      { left: tipPadL, right: tipPadR, top: tipPadT, bottom: tipPadB },
      win,
      buf,
      true,
    );
  }, [
    tipLayW,
    tipLayH,
    tipPadL,
    tipPadR,
    tipPadT,
    tipPadB,
    win,
    buf,
    svEffectiveDataArr,
    svMin,
    svMax,
    svTipT,
    svTipV,
  ]);

  const svTipLinePath = useDerivedValue(() => {
    'worklet';
    return buildAnimatedTailPath(
      svEffectiveDataArr.value,
      svTipT.value,
      svTipV.value,
      svBuildTipT.value,
      svBuildMin.value,
      svBuildMax.value,
      svMin.value,
      svMax.value,
      tipLayW,
      tipLayH,
      { left: tipPadL, right: tipPadR, top: tipPadT, bottom: tipPadB },
      win,
      buf,
    );
  }, [
    tipLayW,
    tipLayH,
    tipPadL,
    tipPadR,
    tipPadT,
    tipPadB,
    win,
    buf,
    svEffectiveDataArr,
    svBuildMin,
    svBuildMax,
    svBuildTipT,
    svMin,
    svMax,
    svTipT,
    svTipV,
  ]);

  const svTipMorphLinePath = useDerivedValue(() => {
    'worklet';
    return buildAnimatedTailPath(
      svMorphLineDataArr.value,
      svTipT.value,
      svMorphTipV.value,
      svBuildTipT.value,
      svBuildMin.value,
      svBuildMax.value,
      svMin.value,
      svMax.value,
      tipLayW,
      tipLayH,
      { left: tipPadL, right: tipPadR, top: tipPadT, bottom: tipPadB },
      win,
      buf,
    );
  }, [
    tipLayW,
    tipLayH,
    tipPadL,
    tipPadR,
    tipPadT,
    tipPadB,
    win,
    buf,
    svMorphLineDataArr,
    svBuildMin,
    svBuildMax,
    svBuildTipT,
    svMin,
    svMax,
    svTipT,
    svMorphTipV,
  ]);

  // Live dot position
  const dvLiveX = useDerivedValue(
    () => toScreenX(svTipT.value, svTipT.value, win, layout.width, pad, buf),
    [win, layout.width, pad, buf],
  );
  const dvLiveY = useDerivedValue(
    () => toScreenY(svTipV.value, svMin.value, svMax.value, layout.height, pad),
    [layout.height, pad],
  );

  // Pulse ring (upstream: 1500ms interval, 900ms duration)
  const dvRingProgress = useDerivedValue(
    () => (pulse ? svPulseWave.value : 1),
    [pulse, svPulseWave],
  );
  const dvRingR = useDerivedValue(() => {
    const p = dvRingProgress.value;
    return p < 1 ? 9 + p * 12 : 0;
  });
  const dvDotDim = useDerivedValue(() => {
    let dotScrub = svScrubOp.value;
    if (dotScrub <= 0.01) return 0;
    const w = layout.width;
    const cw = Math.max(1, w - pad.left - pad.right);
    const rightEdge = svTipT.value + win * buf;
    const leftEdge = rightEdge - win;
    const liveX = pad.left + ((svTipT.value - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const hx = clampW(svScrubX.value, pad.left, liveX);
    const dist = liveX - hx;
    const fadeStart = Math.min(80, cw * 0.3);
    if (dist < CROSSHAIR_FADE_MIN_PX) dotScrub = 0;
    else if (dist < fadeStart) {
      dotScrub =
        ((dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * dotScrub;
    }
    return dotScrub * 0.7;
  }, [layout.width, pad.left, pad.right, win, buf]);

  const dvRingOp = useDerivedValue(() => {
    const p = dvRingProgress.value;
    if (!pulse || p >= 1) return 0;
    // Suppress pulse during early reveal (upstream: hidden until 60%)
    const rev = svReveal.value;
    if (rev < 0.6) return 0;
    const revealScale = Math.min(1, (rev - 0.6) / 0.4);
    const base = 0.35 * (1 - p) * revealScale;
    const dim = dvDotDim.value;
    const pauseScale = 1 - svPauseProgress.value;
    if (dim < 0.3) return base * (1 - dim * 3) * pauseScale;
    return base * pauseScale;
  }, [pulse]);

  // Dashed price line Y
  const dvDashY = useDerivedValue(() => {
    const dashV = svIsCandleFlag.value === 1 ? svSmLiveC.value : svTipV.value;
    return clampW(
      toScreenY(dashV, svMin.value, svMax.value, layout.height, pad),
      pad.top,
      layout.height - pad.bottom,
    );
  }, [layout.height, pad]);
  const dvDashP1 = useDerivedValue(
    () => ({ x: pad.left, y: dvDashY.value }),
    [pad.left],
  );
  const dvDashP2 = useDerivedValue(
    () => ({ x: layout.width - pad.right, y: dvDashY.value }),
    [layout.width, pad.right],
  );

  const dvDashLineOp = useDerivedValue(
    () => 1 - svScrubOp.value * 0.2,
  );

  const dvSplitX = useDerivedValue(() => {
    if (svScrubOp.value <= 0.01) return layout.width - pad.right;
    return clampW(svScrubX.value, pad.left, dvLiveX.value);
  }, [layout.width, pad.left, pad.right]);

  const dvClipL = useDerivedValue(() => {
    const xs = dvSplitX.value;
    return rect(pad.left, pad.top, xs - pad.left, chartH);
  }, [pad.left, pad.top, chartH]);

  const dvClipR = useDerivedValue(() => {
    const xs = dvSplitX.value;
    return rect(xs, pad.top, layout.width - pad.right - xs, chartH);
  }, [pad.left, pad.top, pad.right, chartH, layout.width]);

  const dvRightSegOp = useDerivedValue(() => {
    if (svScrubOp.value <= 0.01) return 1;
    return Math.max(0, 1 - svScrubOp.value * 0.6);
  });

  const dvLineColor = useDerivedValue(() => {
    const t = Math.min(1, svReveal.value * 3);
    const r = Math.round(lineRevealStartRgb[0] + (lineRevealEndRgb[0] - lineRevealStartRgb[0]) * t);
    const g = Math.round(lineRevealStartRgb[1] + (lineRevealEndRgb[1] - lineRevealStartRgb[1]) * t);
    const b = Math.round(lineRevealStartRgb[2] + (lineRevealEndRgb[2] - lineRevealStartRgb[2]) * t);
    return `rgb(${r},${g},${b})`;
  }, [lineRevealStartRgb, lineRevealEndRgb]);

  const liveGlowColor = useMemo(() => {
    if (mom === 'up') return pal.glowUp;
    if (mom === 'down') return pal.glowDown;
    return pal.glowFlat;
  }, [mom, pal.glowDown, pal.glowFlat, pal.glowUp]);

  const dvReferenceY = useDerivedValue(
    () =>
      referenceLine
        ? toScreenY(referenceLine.value, svMin.value, svMax.value, layout.height, pad)
        : -100,
    [referenceLine, layout.height, pad],
  );

  // Crosshair
  const dvHoverX = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01) return -100;
    return clampW(svScrubX.value, pad.left, dvLiveX.value);
  }, [pad.left, scrub]);
  const dvHoverY = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01 || chartW <= 0) return -100;
    if (isCandle) {
      return toScreenY(svScrubHv.value, svMin.value, svMax.value, layout.height, pad);
    }
    const rightEdge = svTipT.value + win * buf;
    const leftEdge = rightEdge - win;
    const ht =
      leftEdge +
      ((dvHoverX.value - pad.left) / Math.max(1, chartW)) * (rightEdge - leftEdge);
    const hv = interpAtTime(svEffectiveDataArr.value, ht, svTipT.value, svTipV.value);
    return toScreenY(hv, svMin.value, svMax.value, layout.height, pad);
  }, [chartW, win, layout.height, pad, scrub, buf, isCandle]);

  const dvCrossEffectiveOp = useDerivedValue(() => {
    const scrubAmt = svScrubOp.value;
    if (scrubAmt <= 0.01) return 0;
    const w = layout.width;
    const cw = Math.max(1, w - pad.left - pad.right);
    const rightEdge = svTipT.value + win * buf;
    const leftEdge = rightEdge - win;
    const liveX = pad.left + ((svTipT.value - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const hx = dvHoverX.value;
    const dist = liveX - hx;
    const fadeStart = Math.min(80, cw * 0.3);
    if (dist < CROSSHAIR_FADE_MIN_PX) return 0;
    if (dist >= fadeStart) return scrubAmt;
    return ((dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * scrubAmt;
  }, [layout.width, pad.left, pad.right, win, buf]);

  const dvCrossP1 = useDerivedValue(
    () => ({ x: dvHoverX.value, y: pad.top }), [pad.top],
  );
  const dvCrossP2 = useDerivedValue(
    () => ({ x: dvHoverX.value, y: layout.height - pad.bottom }),
    [layout.height, pad.bottom],
  );
  const dvCrossLineOp = useDerivedValue(() => dvCrossEffectiveOp.value * 0.5);
  const dvCrossDotR = useDerivedValue(
    () => 4 * Math.min(dvCrossEffectiveOp.value * 3, 1),
  );
  const dvCrossDotOp = useDerivedValue(
    () => (dvCrossEffectiveOp.value > 0.01 ? 1 : 0),
  );

  // Momentum chevrons — upstream drawArrows: per-chevron cascade + arrowState cross-fade.
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;

  const dvChev0Path = useDerivedValue(() => {
    if (!momProp || mom === 'flat') return '';
    const dir = mom === 'up' ? -1 : 1;
    return chevronStroke(dvLiveX.value + 19, dvLiveY.value, dir, 0);
  }, [momProp, mom]);

  const dvChev1Path = useDerivedValue(() => {
    if (!momProp || mom === 'flat') return '';
    const dir = mom === 'up' ? -1 : 1;
    return chevronStroke(dvLiveX.value + 19, dvLiveY.value, dir, 1);
  }, [momProp, mom]);

  const dvChev0Op = useDerivedValue(() => {
    if (!momProp || mom === 'flat') return 0;
    const opacity = mom === 'up' ? svArrowUp.value : svArrowDown.value;
    if (opacity < 0.01) return 0;
    const cycle = svArrowWave.value;
    const i = 0;
    const start = i * 0.2;
    const dur = 0.35;
    const localT = cycle - start;
    const wave =
      localT >= 0 && localT < dur ? Math.sin((localT / dur) * Math.PI) : 0;
    const pulse = 0.3 + 0.7 * wave;
    return opacity * pulse;
  }, [momProp, mom, svArrowWave]);

  const dvChev1Op = useDerivedValue(() => {
    if (!momProp || mom === 'flat') return 0;
    const opacity = mom === 'up' ? svArrowUp.value : svArrowDown.value;
    if (opacity < 0.01) return 0;
    const cycle = svArrowWave.value;
    const i = 1;
    const start = i * 0.2;
    const dur = 0.35;
    const localT = cycle - start;
    const wave =
      localT >= 0 && localT < dur ? Math.sin((localT / dur) * Math.PI) : 0;
    const pulse = 0.3 + 0.7 * wave;
    return opacity * pulse;
  }, [momProp, mom, svArrowWave]);

  const dvBadgeBgPath = useDerivedValue(() =>
    badgeSvgPath(svBadgePillW.value, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD),
  );
  const dvBadgeInnerPath = useDerivedValue(() =>
    badgeSvgPath(
      svBadgePillW.value - 4,
      pillH - 4,
      BADGE_TAIL_LEN - 1,
      BADGE_TAIL_SPREAD - 0.5,
    ),
  );

  /** Momentum-blended badge inner color (derived from svMomColorR/G/B). */
  const dvBadgeInnerColor = useDerivedValue(() => {
    const r = Math.round(clampW(svMomColorR.value, 0, 255));
    const g = Math.round(clampW(svMomColorG.value, 0, 255));
    const b = Math.round(clampW(svMomColorB.value, 0, 255));
    return `rgb(${r},${g},${b})`;
  });

  const asBadge = useAnimatedStyle(() => {
    const pillW = svBadgePillW.value;
    const totalW = BADGE_TAIL_LEN + pillW;
    const badgeX = Math.max(pad.left + 4, layout.width - totalW - 18);
    const desiredY = svBadgeY.value - pillH / 2;
    const badgeY = clampW(desiredY, pad.top + 4, layout.height - pad.bottom - pillH - 4);
    // Reveal-gated: badge appears after REVEAL_BADGE_START
    const rev = svReveal.value;
    const revealOp = rev < REVEAL_BADGE_START ? 0 : Math.min(1, (rev - REVEAL_BADGE_START) / (1 - REVEAL_BADGE_START));
    const baseOp = badge ? (1 - svScrubOp.value) * revealOp * (1 - svPauseProgress.value) : 0;
    return {
      opacity: baseOp,
      width: totalW,
      height: pillH + 10,
      transform: [{ translateX: badgeX }, { translateY: badgeY }],
    };
  });

  const asBadgeTextWrap = useAnimatedStyle(() => ({
    width: Math.max(12, svBadgePillW.value - BADGE_TAIL_LEN - 2),
  }));

  const [scrubTip, setScrubTip] = useState<{
    hx: number;
    hv: number;
    ht: number;
    candle?: CandlePoint;
  } | null>(null);

  const scrubFlowA11yLabel = useMemo(() => {
    if (!scrubTip) return undefined;
    if (scrubTip.candle) {
      const c = scrubTip.candle;
      return `O ${formatValue(c.open)} H ${formatValue(c.high)} L ${formatValue(c.low)} C ${formatValue(
        c.close,
      )} ${formatTime(c.time)}`;
    }
    return scrubTip.hv.toFixed(2);
  }, [scrubTip, formatValue, formatTime]);

  const scrubHapticsRef = useRef(scrubHaptics);
  scrubHapticsRef.current = scrubHaptics;
  const lastScrubHapticCentRef = useRef<number | null>(null);
  const lastScrubHapticTsRef = useRef(0);

  const onScrubPanBeginHaptic = useCallback(() => {
    if (!scrubHapticsRef.current) return;
    scrubPanBeginHaptic();
  }, []);

  const clearScrubTip = useCallback(() => {
    lastScrubHapticCentRef.current = null;
    lastScrubHapticTsRef.current = 0;
    setScrubTip(null);
  }, []);

  const applyScrubTip = useCallback(
    (hx: number, hv: number, ht: number, op: number, candle?: CandlePoint) => {
      if (op <= 0.01) {
        clearScrubTip();
        return;
      }
      if (scrubHapticsRef.current) {
        const c = Math.round(hv * 100);
        const prev = lastScrubHapticCentRef.current;
        const nowMs = Date.now();
        if (
          prev !== null &&
          prev !== c &&
          nowMs - lastScrubHapticTsRef.current >= SCRUB_HAPTIC_MIN_INTERVAL_MS
        ) {
          scrubCentTickHaptic();
          lastScrubHapticTsRef.current = nowMs;
        }
        lastScrubHapticCentRef.current = c;
      }
      setScrubTip((prev) => {
        if (
          prev &&
          Math.abs(prev.hx - hx) < 0.8 &&
          Math.abs(prev.hv - hv) < 2e-4 &&
          Math.abs(prev.ht - ht) < 1e-5 &&
          prev.candle?.time === candle?.time &&
          prev.candle?.open === candle?.open &&
          prev.candle?.high === candle?.high &&
          prev.candle?.low === candle?.low &&
          prev.candle?.close === candle?.close
        ) {
          return prev;
        }
        return candle ? { hx, hv, ht, candle } : { hx, hv, ht };
      });
    },
    [clearScrubTip],
  );

  // Gestures — scrub pan with optional point snapping, plus optional pinch-to-zoom.
  // Arrays are read from SharedValues so the gesture memo stays stable across ticks.
  const gesture = useMemo(() => {
    const panGesture = Gesture.Pan()
      .enabled(scrub)
      .minDistance(0)
      .onBegin((e) => {
        'worklet';
        cancelAnimation(svScrubOp);
        let hx: number;
        let hv: number;
        let ht: number;
        let cand: CandlePoint | undefined;
        const candleVis = svCandleVisibleArr.value;
        const effData = svEffectiveDataArr.value;
        if (isCandle && candleVis.length > 0) {
          const c = sampleCandleScrubAtX(
            e.x,
            layout.width,
            pad,
            win,
            buf,
            svTipT.value,
            svTipV.value,
            candleVis,
            svCandleWidthSecs.value,
          );
          const morphT = svLineModeProg.value;
          if (morphT < 1e-4) {
            hx = c.hx;
            hv = c.hv;
            ht = c.ht;
            cand = c.candle ?? undefined;
          } else {
            const l = sampleScrubAtX(
              e.x,
              layout.width,
              pad,
              win,
              buf,
              svTipT.value,
              svTipV.value,
              effData,
              snapToPointScrubbing,
            );
            const b = candleLineMorphScrubBlend(morphT, c, l);
            hx = b.hx;
            hv = b.hv;
            ht = b.ht;
            cand = b.cand;
          }
        } else {
          const sample = sampleScrubAtX(
            e.x,
            layout.width,
            pad,
            win,
            buf,
            svTipT.value,
            svTipV.value,
            effData,
            snapToPointScrubbing,
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
        let hx: number;
        let hv: number;
        let ht: number;
        let liveX: number;
        let cand: CandlePoint | undefined;
        const candleVis = svCandleVisibleArr.value;
        const effData = svEffectiveDataArr.value;
        if (isCandle && candleVis.length > 0) {
          const c = sampleCandleScrubAtX(
            e.x,
            layout.width,
            pad,
            win,
            buf,
            svTipT.value,
            svTipV.value,
            candleVis,
            svCandleWidthSecs.value,
          );
          const morphT = svLineModeProg.value;
          if (morphT < 1e-4) {
            hx = c.hx;
            hv = c.hv;
            ht = c.ht;
            liveX = c.liveX;
            cand = c.candle ?? undefined;
          } else {
            const l = sampleScrubAtX(
              e.x,
              layout.width,
              pad,
              win,
              buf,
              svTipT.value,
              svTipV.value,
              effData,
              snapToPointScrubbing,
            );
            const b = candleLineMorphScrubBlend(morphT, c, l);
            hx = b.hx;
            hv = b.hv;
            ht = b.ht;
            liveX = b.liveX;
            cand = b.cand;
          }
        } else {
          const sample = sampleScrubAtX(
            e.x,
            layout.width,
            pad,
            win,
            buf,
            svTipT.value,
            svTipV.value,
            effData,
            snapToPointScrubbing,
          );
          hx = sample.hx;
          hv = sample.hv;
          ht = sample.ht;
          liveX = sample.liveX;
          cand = undefined;
        }
        svScrubX.value = hx;
        svScrubHv.value = hv;

        const chartWi = Math.max(1, layout.width - pad.left - pad.right);
        const scrubAmt = svScrubOp.value;
        const dist = liveX - hx;
        const fadeStart = Math.min(80, chartWi * 0.3);
        let op = 0;
        if (dist >= CROSSHAIR_FADE_MIN_PX) {
          op =
            dist >= fadeStart
              ? scrubAmt
              : ((dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) *
                scrubAmt;
        }
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

    const pinchGesture = Gesture.Pinch()
      .enabled(pinchToZoom)
      .onBegin(() => {
        'worklet';
        svPinchStartWin.value = pinchWindow ?? resolvedWin;
      })
      .onUpdate((e) => {
        'worklet';
        const nextWindow = clampW(
          svPinchStartWin.value / Math.max(0.5, Math.min(2.5, e.scale)),
          PINCH_WINDOW_MIN_SECS,
          maxPinchWindow,
        );
        runOnJS(setPinchWindowStable)(nextWindow);
      })
      .onEnd(() => {
        'worklet';
        if (pinchWindow != null && Math.abs(pinchWindow - resolvedWin) < 0.5) {
          runOnJS(setPinchWindowStable)(null);
        }
      });

    return Gesture.Simultaneous(panGesture, pinchGesture);
  }, [
    applyScrubTip,
    buf,
    clearScrubTip,
    isCandle,
    layout.width,
    maxPinchWindow,
    onScrubPanBeginHaptic,
    pad,
    pinchToZoom,
    pinchWindow,
    resolvedWin,
    scrub,
    setPinchWindowStable,
    snapToPointScrubbing,
    svScrubHv,
    svScrubJsLastHx,
    svScrubJsLastOp,
    svScrubJsLastTs,
    svScrubOp,
    svScrubX,
    svPinchStartWin,
    svTipT,
    svTipV,
    svLineModeProg,
    win,
    svCandleVisibleArr,
    svCandleWidthSecs,
    svEffectiveDataArr,
  ]);

  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || layout.width < 300 || scrubTip.candle) return null;
    const v = formatValue(scrubTip.hv);
    const t = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const valueSlotW = skiaScrubFlow ? SCRUB_TIP_FLOW_W : v.length * charW;
    const totalW = valueSlotW + sep.length * charW + t.length * charW;
    const liveX = toScreenXJs(axisNow, axisNow, win, layout.width, pad, buf);
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v, t, sep };
  }, [scrubTip, layout.width, formatValue, formatTime, axisNow, win, pad, buf, skiaScrubFlow]);

  /** Liveline-style horizontal O H L C + time while scrubbing a candle. */
  const candleScrubLayout = useMemo(() => {
    if (!scrubTip?.candle || layout.width < 200) return null;
    const c = scrubTip.candle;
    const charW = 7.05;
    const sep = '  ·  ';
    const seg = (lab: string, val: string) => lab.length + val.length + 1;
    const o = formatValue(c.open);
    const hi = formatValue(c.high);
    const lo = formatValue(c.low);
    const cl = formatValue(c.close);
    const t = formatTime(c.time);
    const totalW =
      (seg('O', o) + seg('H', hi) + seg('L', lo) + seg('C', cl)) * charW +
      sep.length * charW * 4 +
      t.length * charW;
    const liveX = toScreenXJs(axisNow, axisNow, win, layout.width, pad, buf);
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, candle: c };
  }, [scrubTip, layout.width, formatValue, formatTime, axisNow, win, pad, buf]);

  /* ---- computed ---- */
  const baseY = layout.height - pad.bottom;

  // Loading state
  const loadPath = useMemo(
    () => (empty && layout.width > 0 ? buildLoadingPath(layout.width, layout.height, pad, loadMs) : ''),
    [empty, layout.width, layout.height, pad, loadMs],
  );
  const loadAlpha = useMemo(
    () => (empty ? loadingBreath(loadMs) : 0),
    [empty, loadMs],
  );

  /* ---- Reveal-gated opacity derived values ---- */
  /** Grid elements: visible from 15%→70% reveal. */
  const dvRevealGridOp = useDerivedValue(() => {
    const rev = svReveal.value;
    if (rev < REVEAL_GRID_START) return 0;
    if (rev >= REVEAL_GRID_END) return 1;
    return (rev - REVEAL_GRID_START) / (REVEAL_GRID_END - REVEAL_GRID_START);
  });
  /** Dot: visible from 30%→100% reveal. */
  const dvRevealDotOp = useDerivedValue(() => {
    const rev = svReveal.value;
    if (rev < REVEAL_DOT_START) return 0;
    return Math.min(1, (rev - REVEAL_DOT_START) / (1 - REVEAL_DOT_START));
  });
  /** Arrows: visible from 60%→100% reveal. */
  const dvRevealArrowOp = useDerivedValue(() => {
    const rev = svReveal.value;
    if (rev < REVEAL_ARROWS_START) return 0;
    return Math.min(1, (rev - REVEAL_ARROWS_START) / (1 - REVEAL_ARROWS_START));
  });
  /** Line opacity ramps with reveal. */
  const dvRevealLineOp = useDerivedValue(() => {
    return Math.min(1, svReveal.value * 2); // 0→0.5 reveal = 0→1 line
  });
  /** Candle bodies fade out as line morph (`lineModeProg`) approaches 1. */
  const dvCandleMorphOp = useDerivedValue(
    () => dvRevealLineOp.value * (1 - svLineModeProg.value),
  );
  /** Tick-density morph line fades in with `lineModeProg`. */
  const dvMorphLineOverlayOp = useDerivedValue(() => dvRevealLineOp.value * svLineModeProg.value);
  /** Particles: fade in only near full reveal to avoid fighting the line draw. */
  const dvRevealParticleOp = useDerivedValue(() => {
    const rev = svReveal.value;
    if (rev < REVEAL_PARTICLES_START) return 0;
    return Math.min(1, (rev - REVEAL_PARTICLES_START) / (1 - REVEAL_PARTICLES_START));
  });

  /* ---- Shake animated style (wraps the Canvas for degen mode) ---- */
  const asShake = useAnimatedStyle(() => ({
    transform: [
      { translateX: svShakeX.value },
      { translateY: svShakeY.value },
    ],
  }));

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <View style={[styles.root, { height }, style]}>
      {/* Window bar */}
      {windows && windows.length > 0 ? (
        <View style={[styles.winBarWrap, { marginLeft: pad.left }]}>
          <View
            style={[
              styles.winBarRow,
              {
                backgroundColor: winBarMetrics.barBg,
                borderRadius: winBarMetrics.barRadius,
                padding: winBarMetrics.barPadding,
                gap: winBarMetrics.gap,
              },
            ]}
          >
            {winBarMetrics.showIndicator ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  windowIndStyle,
                  {
                    backgroundColor: winUi.indicatorBg,
                    borderRadius: winBarMetrics.indRadius,
                  },
                ]}
              />
            ) : null}
            {windows.map((o) => (
              <WindowBtn
                key={o.secs}
                active={o.secs === resolvedWin}
                label={o.label}
                activeColor={winUi.activeTxt}
                inactiveColor={winUi.inactiveTxt}
                borderRadius={winBarMetrics.btnRadius}
                paddingH={winBarMetrics.padH}
                paddingV={winBarMetrics.padV}
                onLayout={(e) => onWindowSlotLayout(o.secs, e)}
                onPress={() => onWindowChange?.(o.secs)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {(showBuiltInModeToggle && onModeChange) || (showBuiltInMorphToggle && isCandle && onLineModeChange) ? (
        <View style={[styles.winBarWrap, { marginLeft: pad.left, marginTop: 2, gap: 6 }]}>
          {showBuiltInModeToggle && onModeChange ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: winBarMetrics.gap }}>
              <WindowBtn
                active={!isCandle}
                label="Line"
                onPress={() => onModeChange('line')}
                activeColor={winUi.activeTxt}
                inactiveColor={winUi.inactiveTxt}
                borderRadius={winBarMetrics.btnRadius}
                paddingH={winBarMetrics.padH}
                paddingV={winBarMetrics.padV}
              />
              <WindowBtn
                active={isCandle}
                label="Candle"
                onPress={() => onModeChange('candle')}
                activeColor={winUi.activeTxt}
                inactiveColor={winUi.inactiveTxt}
                borderRadius={winBarMetrics.btnRadius}
                paddingH={winBarMetrics.padH}
                paddingV={winBarMetrics.padV}
              />
            </View>
          ) : null}
          {showBuiltInMorphToggle && isCandle && onLineModeChange ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: winBarMetrics.gap }}>
              <WindowBtn
                active={!lineMode}
                label="Bars"
                onPress={() => onLineModeChange(false)}
                activeColor={winUi.activeTxt}
                inactiveColor={winUi.inactiveTxt}
                borderRadius={winBarMetrics.btnRadius}
                paddingH={winBarMetrics.padH}
                paddingV={winBarMetrics.padV}
              />
              <WindowBtn
                active={lineMode}
                label="Morph"
                onPress={() => onLineModeChange(true)}
                activeColor={winUi.activeTxt}
                inactiveColor={winUi.inactiveTxt}
                borderRadius={winBarMetrics.btnRadius}
                paddingH={winBarMetrics.padH}
                paddingV={winBarMetrics.padV}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View style={[styles.shell, { backgroundColor: pal.surface }]}>
          <View
            style={[styles.plot, { backgroundColor: pal.plotSurface }]}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setLayout({ width: w, height: h });
            }}
          >
            {/* =================== EMPTY / LOADING =================== */}
            {empty ? (
              <EmptyState
                layoutWidth={layout.width}
                layoutHeight={layout.height}
                pad={pad}
                loadPath={loadPath}
                loadAlpha={loadAlpha}
                loading={loading}
                emptyText={emptyText}
                pal={pal}
              />
            ) : (
              /* =================== CHART =================== */
              <>
                <Animated.View style={[StyleSheet.absoluteFill, asShake]}>
                <Canvas style={StyleSheet.absoluteFill}>

                  <GridCanvas
                    grid={grid}
                    gridLabels={trackedGridLabels}
                    timeLabels={trackedTimeLabels}
                    pad={pad}
                    layoutWidth={layout.width}
                    baseY={baseY}
                    opacity={dvRevealGridOp}
                    pal={pal}
                  />

                  {/* ========== LINE MODE ========== */}
                  {!isCandle ? (
                    <>
                      {/* -- Fill gradient (scrub splits like upstream drawLine) — reveal-gated -- */}
                      {fill && clipRect ? (
                        <Group clip={clipRect} opacity={dvRevealLineOp}>
                          <Group clip={dvClipL}>
                            <Path path={svAnimatedFillPath}>
                              <LinearGradient
                                start={vec(0, pad.top)}
                                end={vec(0, layout.height - pad.bottom)}
                                colors={[pal.accentFillTop, pal.accentFillBottom]}
                              />
                            </Path>
                          </Group>
                          <Group clip={dvClipR} opacity={dvRightSegOp}>
                            <Path path={svAnimatedFillPath}>
                              <LinearGradient
                                start={vec(0, pad.top)}
                                end={vec(0, layout.height - pad.bottom)}
                                colors={[pal.accentFillTop, pal.accentFillBottom]}
                              />
                            </Path>
                          </Group>
                        </Group>
                      ) : null}

                      <LinePathLayer
                        clipRect={clipRect}
                        leftClip={dvClipL}
                        rightClip={dvClipR}
                        rightOpacity={dvRightSegOp}
                        revealOpacity={dvRevealLineOp}
                        path={svAnimatedLinePath}
                        layoutHeight={layout.height}
                        padTop={pad.top}
                        padRight={pad.right}
                        layoutWidth={layout.width}
                        lineWidth={pal.lineWidth}
                        lineColor={dvLineColor}
                        trailGlow={lineTrailGlow}
                        trailGlowColor={pal.accentGlow}
                        gradientLineColoring={gradientLineColoring}
                        gradientStartColor={pal.gridLabel}
                        gradientEndColor={pal.accent}
                        rangeTranslateX={svIdentityTranslateX}
                        rangeScaleY={svIdentityRangeScaleY}
                        rangeTranslateY={svIdentityRangeTranslateY}
                      />
                    </>
                  ) : null}

                  {/* ========== CANDLE MODE (+ line morph overlay) ========== */}
                  {isCandle ? (
                    <>
                      <Group opacity={dvCandleMorphOp}>
                        {candleLayouts.map((row) => (
                          <Group key={row.c.time}>
                            {row.bodyTop - row.yHigh > 0.5 ? (
                              <SkiaLine
                                p1={vec(row.cx, row.bodyTop)}
                                p2={vec(row.cx, row.yHigh)}
                                style="stroke"
                                strokeWidth={row.wickW}
                                color={row.fill}
                                strokeCap="round"
                              />
                            ) : null}
                            {row.yLow - row.bodyBottom > 0.5 ? (
                              <SkiaLine
                                p1={vec(row.cx, row.bodyBottom)}
                                p2={vec(row.cx, row.yLow)}
                                style="stroke"
                                strokeWidth={row.wickW}
                                color={row.fill}
                                strokeCap="round"
                              />
                            ) : null}
                            {row.isLive ? (
                              <Group>
                                <RoundedRect
                                  x={row.cx - row.halfBody - 6}
                                  y={row.bodyTop - 6}
                                  width={row.bodyW + 12}
                                  height={row.bodyH + 12}
                                  r={row.radius + 3}
                                  color={row.fill}
                                  opacity={0.12}
                                />
                                <RoundedRect
                                  x={row.cx - row.halfBody - 2}
                                  y={row.bodyTop - 2}
                                  width={row.bodyW + 4}
                                  height={row.bodyH + 4}
                                  r={row.radius + 1}
                                  color={row.fill}
                                  opacity={0.22}
                                />
                                <RoundedRect
                                  x={row.cx - row.halfBody}
                                  y={row.bodyTop}
                                  width={row.bodyW}
                                  height={row.bodyH}
                                  r={row.radius}
                                  color={row.fill}
                                />
                              </Group>
                            ) : (
                              <RoundedRect
                                x={row.cx - row.halfBody}
                                y={row.bodyTop}
                                width={row.bodyW}
                                height={row.bodyH}
                                r={row.radius}
                                color={row.fill}
                              />
                            )}
                          </Group>
                        ))}
                      </Group>
                      <Group opacity={dvMorphLineOverlayOp}>
                        <LinePathLayer
                          clipRect={clipRect}
                          leftClip={dvClipL}
                          rightClip={dvClipR}
                          rightOpacity={dvRightSegOp}
                          revealOpacity={1}
                          path={svAnimatedMorphLinePath}
                          layoutHeight={layout.height}
                          padTop={pad.top}
                          padRight={pad.right}
                          layoutWidth={layout.width}
                          lineWidth={pal.lineWidth}
                          lineColor={dvLineColor}
                          trailGlow={lineTrailGlow}
                          trailGlowColor={pal.accentGlow}
                          gradientLineColoring={gradientLineColoring}
                          gradientStartColor={pal.gridLabel}
                          gradientEndColor={pal.accent}
                          rangeTranslateX={svIdentityTranslateX}
                          rangeScaleY={svIdentityRangeScaleY}
                          rangeTranslateY={svIdentityRangeTranslateY}
                        />
                      </Group>
                    </>
                  ) : null}

                  {referenceLine ? (
                    <ReferenceLineCanvas
                      label={referenceLine.label}
                      y={dvReferenceY}
                      opacity={dvRevealGridOp}
                      padLeft={pad.left}
                      padRight={pad.right}
                      layoutWidth={layout.width}
                      lineColor={pal.refLine}
                    />
                  ) : null}

                  {/* -- Dashed price line [4,4] -- */}
                  <Group opacity={dvDashLineOp}>
                    <SkiaLine
                      p1={dvDashP1}
                      p2={dvDashP2}
                      color={isCandle ? candleBadgeDashColor : pal.dashLine}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={PRICE_DASH_INTERVALS} />
                    </SkiaLine>
                  </Group>

                  {!isCandle ? (
                    <>
                      <ParticlesLayer
                        enabled={degenEnabled}
                        particles={particles}
                        burstLife={svBurstLife}
                        opacity={dvRevealParticleOp}
                      />

                      {/* -- Pulse ring — reveal-gated (only after 60%) -- */}
                      {pulse ? (
                        <Circle
                          cx={dvLiveX}
                          cy={dvLiveY}
                          r={dvRingR}
                          color={pal.accent}
                          style="stroke"
                          strokeWidth={1.5}
                          opacity={dvRingOp}
                        />
                      ) : null}

                      <LiveDotLayer
                        revealOpacity={dvRevealDotOp}
                        liveX={dvLiveX}
                        liveY={dvLiveY}
                        glowEnabled={liveDotGlow}
                        glowColor={liveGlowColor}
                        outerColor={pal.badgeOuterBg}
                        outerShadow={pal.badgeOuterShadow}
                        innerColor={pal.accent}
                      />

                      {/* -- Momentum chevrons (upstream drawArrows cascade) — reveal-gated -- */}
                      {momProp ? (
                        <Group opacity={dvRevealArrowOp}>
                          <Path
                            path={dvChev0Path}
                            style="stroke"
                            strokeWidth={2.5}
                            strokeJoin="round"
                            strokeCap="round"
                            color={pal.gridLabel}
                            opacity={dvChev0Op}
                          />
                          <Path
                            path={dvChev1Path}
                            style="stroke"
                            strokeWidth={2.5}
                            strokeJoin="round"
                            strokeCap="round"
                            color={pal.gridLabel}
                            opacity={dvChev1Op}
                          />
                        </Group>
                      ) : null}
                    </>
                  ) : null}

                  {/* -- Left edge fade: destination-out gradient (matches upstream) -- */}
                  <Group blendMode="dstOut">
                    <Rect
                      x={0}
                      y={0}
                      width={pad.left + FADE_EDGE_WIDTH}
                      height={layout.height}
                    >
                      <LinearGradient
                        start={vec(pad.left, 0)}
                        end={vec(pad.left + FADE_EDGE_WIDTH, 0)}
                        colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
                      />
                    </Rect>
                  </Group>

                  <CrosshairCanvas
                    lineP1={dvCrossP1}
                    lineP2={dvCrossP2}
                    lineOpacity={dvCrossLineOp}
                    dotX={dvHoverX}
                    dotY={dvHoverY}
                    dotRadius={dvCrossDotR}
                    dotOpacity={dvCrossDotOp}
                    lineColor={pal.crosshair}
                    dotColor={pal.accent}
                  />
                </Canvas>
                </Animated.View>

                {scrub && candleScrubLayout ? (
                  <CandleScrubOHLCTooltip
                    layout={candleScrubLayout}
                    top={pad.top + tooltipY + 10}
                    opacity={svScrubOp}
                    formatValue={formatValue}
                    formatTime={formatTime}
                    pal={pal}
                    textStyle={styles.scrubTipText}
                    tooltipOutline={tooltipOutline}
                  />
                ) : (
                  <ScrubTooltip
                    layout={scrub && scrubTipLayout ? scrubTipLayout : null}
                    top={pad.top + tooltipY + 10}
                    opacity={svScrubOp}
                    tooltipOutline={tooltipOutline}
                    skiaScrubFlow={skiaScrubFlow}
                    scrubFlowA11yLabel={scrubFlowA11yLabel}
                    scrubTipFont={scrubTipFont}
                    scrubValue={dvScrubValueStr}
                    pal={pal}
                    textStyle={styles.scrubTipText}
                  />
                )}

                <AxisLabels
                  grid={grid}
                  gridLabels={trackedGridLabels}
                  timeLabels={trackedTimeLabels}
                  pad={pad}
                  layoutWidth={layout.width}
                  baseY={baseY}
                  pal={pal}
                  styles={{ yLabel: styles.yLabel, tLabel: styles.tLabel }}
                />

                {referenceLine?.label ? (
                  <ReferenceLineLabel
                    label={referenceLine.label}
                    y={dvReferenceY}
                    opacity={dvRevealGridOp}
                    padLeft={pad.left}
                    padRight={pad.right}
                    layoutWidth={layout.width}
                    color={pal.refLabel}
                    textStyle={styles.referenceLabel}
                  />
                ) : null}

                <LiveBadgeOverlay
                  badge={badge}
                  empty={empty}
                  variant={badgeVariant}
                  skiaBadgeFlow={skiaBadgeFlow}
                  badgeFlowA11yLabel={badgeFlowA11y}
                  badgeNumFont={badgeNumFont}
                  badgeValue={svTipV}
                  badgePillWidth={svBadgePillW}
                  badgeTargetTextW={svBadgeTargetTextW}
                  badgeLastJsFlush={svBadgeLastJsFlush}
                  badgeQuantMul={badgeQuantMul}
                  formatValue={formatValue}
                  effectiveValue={effectiveValue}
                  badgeStyle={asBadge}
                  badgeTextWrapStyle={asBadgeTextWrap}
                  backgroundPath={dvBadgeBgPath}
                  innerPath={dvBadgeInnerPath}
                  innerColor={dvBadgeInnerColor}
                  pillH={pillH}
                  pal={pal}
                  badgeTextStyle={styles.badgeTxt}
                />

                {orderbookProp ? (
                  <View
                    pointerEvents="none"
                    collapsable={false}
                    style={[StyleSheet.absoluteFill, { zIndex: 40, elevation: 40 }]}
                  >
                    <OrderbookStreamOverlay
                      orderbook={orderbookProp}
                      layoutWidth={layout.width}
                      layoutHeight={layout.height}
                      pad={pad}
                      paused={paused}
                      empty={empty}
                      momUi={momUi}
                      swingMag={swMag}
                      font={orderbookStreamFont}
                    />
                  </View>
                ) : null}
              </>
            )}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

/* ================================================================== */
/*  Styles                                                             */
/* ================================================================== */

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create({
  root: { gap: 6 },
  winBarWrap: { alignSelf: 'flex-start' },
  winBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    position: 'relative',
  },
  windowBtnTxt: {
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 16,
  },
  shell: { flex: 1, borderRadius: 12, padding: 0 },
  plot: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  scrubTipText: {
    fontFamily: mono,
    fontSize: 13,
    fontWeight: '400',
  },
  badgeTxt: { fontFamily: mono, fontSize: 12, fontWeight: '600', letterSpacing: 0.15 },
  referenceLabel: { fontFamily: mono, fontSize: 11, fontWeight: '500' },
  yLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono },
  tLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono, textAlign: 'center' },
});
