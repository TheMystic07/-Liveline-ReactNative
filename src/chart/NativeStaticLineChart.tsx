import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useSkiaFont } from 'number-flow-react-native/skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { parseColorRgb, resolvePalette } from './theme';
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
import { BadgeOverlay } from './render/BadgeOverlay';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { GridCanvas } from './render/GridCanvas';
import { LiveDotLayer } from './render/LiveDotLayer';
import { LinePathLayer } from './render/LinePathLayer';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { CandleScrubOHLCTooltip } from './render/CandleScrubOHLCTooltip';
import { ScrubTooltip } from './render/ScrubTooltip';
import { useTrackedGridLabels, useTrackedTimeLabels } from './render/useTrackedAxisLabels';
import { scrubCentTickHaptic, scrubPanBeginHaptic } from './scrubHaptics';
import {
  loadingY,
  loadingBreath,
  LOADING_AMPLITUDE_RATIO,
  LOADING_SCROLL_SPEED,
} from './draw/loadingShape';
import { monotoneSplinePath } from './math/spline';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GridTick {
  value: number;
  y: number;
  text: string;
  isCoarse: boolean;
  fineOp: number;
}

interface TimeTick {
  time: number;
  x: number;
  text: string;
}

/* ------------------------------------------------------------------ */
/*  Constants — matching upstream exactly                               */
/* ------------------------------------------------------------------ */

const DEFAULT_HEIGHT = 300;
const FADE_EDGE_WIDTH = 40;
const PULSE_DURATION = 900;
const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
const CROSSHAIR_FADE_MIN_PX = 5;
const MAX_PARTICLE_BURST = 14;
const PARTICLE_LIFE_MS = 920;
const PARTICLE_COOLDOWN_MS = 400;
const MAGNITUDE_THRESHOLD = 0.08;
const MAX_BURSTS = 3;
const ADAPTIVE_SPEED_BOOST = 0.2;
const VALUE_SNAP_THRESHOLD = 0.001;
const GRID_FLUSH_MS = 110;
const LIVE_AXIS_WALL_MS = 480;
const LIVE_TIP_CLOCK_CATCHUP = 0.42;
const BADGE_WIDTH_LERP = 0.15;
const MAX_DELTA_MS = 50;
const CANDLE_OHLC_LERP_SPEED = 0.25;
const LINE_MORPH_MS = 500;
const CANDLE_SMOOTH_EMIT_MS = 32;
const ENGINE_IDLE_STOP_MS = 60;
const ARROW_WAVE_DURATION_MS = 680;
const SCRUB_HAPTIC_MIN_INTERVAL_MS = 48;
const PINCH_WINDOW_MIN_SECS = 5;
const PINCH_WINDOW_MAX_MULTIPLIER = 6;

const RANGE_LERP_SPEED = 0.15;
const RANGE_ADAPTIVE_BOOST = 0.2;
const BADGE_Y_LERP = 0.35;
const BADGE_Y_LERP_TRANSITION = 0.5;
const PAUSE_PROGRESS_SPEED = 0.12;
const MOMENTUM_COLOR_SPEED = 0.12;
const CHART_REVEAL_SPEED = 0.09;
const REVEAL_GRID_START = 0.15;
const REVEAL_GRID_END = 0.7;
const REVEAL_DOT_START = 0.3;
const REVEAL_BADGE_START = 0.25;
const REVEAL_ARROWS_START = 0.6;
const REVEAL_PARTICLES_START = 0.9;
const REVEAL_CENTER_SPREAD = 0.4;
const FINE_LABEL_SHOW_PX = 60;
const FINE_LABEL_HIDE_PX = 40;
const GRID_LABEL_FADE_IN = 0.18;
const GRID_LABEL_FADE_OUT = 0.12;

type RangeTransform = Array<{ translateY: number } | { scaleY: number }>;

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

function clampW(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

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

function defaultFmtVal(v: number) {
  return v.toFixed(2);
}

function defaultFmtTime(t: number) {
  const d = new Date(t * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

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

/** Same math as `toScreenY` for React `useMemo` (must not be a worklet). */
function toScreenYJs(
  v: number,
  lo: number,
  hi: number,
  h: number,
  pad: ChartPadding,
) {
  const ch = Math.max(1, h - pad.top - pad.bottom);
  const span = Math.max(0.0001, hi - lo);
  return pad.top + (1 - (v - lo) / span) * ch;
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
/*  Grid ticks                                                         */
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
/*  Time axis ticks                                                    */
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

/* ------------------------------------------------------------------ */
/*  Path builder                                                       */
/* ------------------------------------------------------------------ */

function buildPath(
  pts: readonly LiveLinePoint[],
  tipT: number,
  tipV: number,
  lo: number,
  hi: number,
  w: number,
  h: number,
  pad: ChartPadding,
  win: number,
  buffer: number,
  floor: boolean,
) {
  if (pts.length === 0 || w <= 0 || h <= 0) return '';

  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const lastDataT = pts[pts.length - 1]!.time;
  let rightEdge = tipT + win * buffer;
  let leftEdge = rightEdge - win;
  if (leftEdge > lastDataT - 2) {
    rightEdge = lastDataT + win * buffer;
    leftEdge = rightEdge - win;
  }
  const span = Math.max(0.0001, hi - lo);
  const floorY = h - pad.bottom;
  const yMin = pad.top;
  const yMax = h - pad.bottom;
  const cy = (y: number) => Math.max(yMin, Math.min(yMax, y));

  const f: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.time < leftEdge - 2) continue;
    if (p.time > tipT + 1) break;
    const x = pad.left + ((p.time - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const rawY = pad.top + (1 - (p.value - lo) / span) * ch;
    f.push({ x, y: cy(rawY) });
  }
  if (f.length === 0) return '';

  const lx = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
  const ly = cy(pad.top + (1 - (tipV - lo) / span) * ch);
  const last = f[f.length - 1];
  if (Math.abs(last.x - lx) < 0.5) {
    f[f.length - 1] = { x: lx, y: ly };
  } else {
    f.push({ x: lx, y: ly });
  }

  if (f.length < 2) {
    const cmds = [`M ${f[0].x} ${f[0].y}`, `L ${f[0].x + 0.1} ${f[0].y}`];
    if (floor) cmds.push(`L ${f[0].x + 0.1} ${floorY}`, `L ${f[0].x} ${floorY}`, 'Z');
    return cmds.join(' ');
  }

  return monotoneSplinePath(f, floor ? floorY : undefined);
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
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function WindowBtn({
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
}

/* ================================================================== */
/*  Static Line Chart                                                  */
/*  Looks exactly like NativeLiveLineChart but without the live        */
/*  animation engine (no useFrameCallback, no per-tick smoothing).     */
/* ================================================================== */

export function NativeStaticLineChart({
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

  const skiaDefaultNumberFormat = useMemo(
    () => supportsTwoDecimalNumberFlow(formatValue),
    [formatValue],
  );
  const badgeNumFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 11);
  const scrubTipFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 13);
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

  /* ---- time window ---- */
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

  const winTransRef = useRef<{
    from: number;
    to: number;
    startMs: number;
    active: boolean;
  }>({ from: baseWin, to: baseWin, startMs: 0, active: false });
  const svWinFrom = useSharedValue(baseWin);
  const svWinTo = useSharedValue(baseWin);
  const svWinProgress = useSharedValue(1);
  const svWinTransActive = useSharedValue(0);
  const [effectiveWin, setEffectiveWin] = useState(baseWin);

  const flushEffectiveWin = useCallback((v: number) => {
    setEffectiveWin(v);
  }, []);

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

  /* ---- data (static — no pause snapshot, no smoothing) ---- */
  const effectiveData = data;
  const effectiveValue = value;
  const now = effectiveData[effectiveData.length - 1]?.time ?? Date.now() / 1000;
  const axisNow = now; // static: no wall-clock drift

  const morphLineData = useMemo(
    () => (lineData ?? effectiveData) as LiveLinePoint[],
    [lineData, effectiveData],
  );

  /* ---- candle mode data ---- */
  const candleMerged = useMemo(() => {
    if (!isCandle) return [];
    const map = new Map<number, CandlePoint>();
    for (const c of candlesProp ?? []) map.set(c.time, c);
    if (liveCandle) map.set(liveCandle.time, liveCandle);
    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [isCandle, candlesProp, liveCandle]);

  const candleVisible = useMemo(() => {
    if (!isCandle || candleMerged.length === 0) return [];
    const { leftEdge, rightEdge } = windowEdges(now, win, buf);
    return candleMerged.filter((c) => c.time >= leftEdge - 2 && c.time <= rightEdge + 1);
  }, [isCandle, candleMerged, now, win, buf]);

  const candleWidthSecs = useMemo(
    () => (isCandle ? inferCandleWidthSecs(candleVisible, win) : 1),
    [isCandle, candleVisible, win],
  );

  const candleVisibleForLayout = useMemo(() => {
    if (!isCandle || candleVisible.length === 0) return candleVisible;
    return candleVisible;
  }, [candleVisible, isCandle]);

  const rng = useMemo(() => {
    if (isCandle && candleVisible.length > 0) {
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
    return computeRange(effectiveData, effectiveValue, referenceLine?.value, exaggerate);
  }, [isCandle, candleVisible, effectiveData, effectiveValue, referenceLine?.value, exaggerate]);

  const mom = useMemo(() => detectMomentum(effectiveData), [effectiveData]);
  const swMag = useMemo(
    () => computeSwingMagnitude(effectiveData, effectiveValue, rng.min, rng.max),
    [effectiveData, effectiveValue, rng.min, rng.max],
  );
  const momUi: 0 | 1 | 2 = mom === 'up' ? 1 : mom === 'down' ? 2 : 0;

  const chartW = layout.width - pad.left - pad.right;
  const chartH = layout.height - pad.top - pad.bottom;
  const empty = layout.width <= 0 || effectiveData.length < 2 || loading;

  /* ---- grid ticks ---- */
  const gridIntRef = useRef(0);
  const [gridSmooth, setGridSmooth] = useState<{ min: number; max: number } | null>(null);
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
    () => calcTimeTicks(now, win, layout.width, pad, formatTime, buf),
    [now, win, layout.width, pad, formatTime, buf],
  );
  const trackedGridLabels = useTrackedGridLabels(gridRes.ticks);
  const trackedTimeLabels = useTrackedTimeLabels(tTicks);
  const badgeFlowA11y = useMemo(() => effectiveValue.toFixed(2), [effectiveValue]);

  /* ---- candle badge/dash tint ---- */
  const candleTip = isCandle && candleMerged.length
    ? candleMerged[candleMerged.length - 1]!
    : null;
  const candleBadgeDashColor = useMemo(() => {
    if (!candleTip) return pal.dashLine;
    const isBull = candleTip.close >= candleTip.open;
    const c = isBull ? LIVELINE_CANDLE_BULL : LIVELINE_CANDLE_BEAR;
    const [r, g, b] = parseColorRgb(c);
    return `rgba(${r},${g},${b},0.35)`;
  }, [candleTip, pal.dashLine]);

  /* ---- static paths (computed once per render, no animation) ---- */
  const staticLinePath = useMemo(
    () =>
      empty
        ? ''
        : buildPath(
            effectiveData,
            now,
            effectiveValue,
            rng.min,
            rng.max,
            layout.width,
            layout.height,
            pad,
            win,
            buf,
            false,
          ),
    [empty, effectiveData, now, effectiveValue, rng.min, rng.max, layout.width, layout.height, pad, win, buf],
  );

  const staticMorphLinePath = useMemo(
    () =>
      empty
        ? ''
        : buildPath(
            morphLineData,
            now,
            lineValue ?? effectiveValue,
            rng.min,
            rng.max,
            layout.width,
            layout.height,
            pad,
            win,
            buf,
            false,
          ),
    [empty, morphLineData, now, lineValue, effectiveValue, rng.min, rng.max, layout.width, layout.height, pad, win, buf],
  );

  const staticFillPath = useMemo(
    () =>
      empty
        ? ''
        : buildPath(
            effectiveData,
            now,
            effectiveValue,
            rng.min,
            rng.max,
            layout.width,
            layout.height,
            pad,
            win,
            buf,
            true,
          ),
    [empty, effectiveData, now, effectiveValue, rng.min, rng.max, layout.width, layout.height, pad, win, buf],
  );

  /* ---- candle layouts (static — no morph animation) ---- */
  const lineMorphJs = isCandle && lineMode ? 1 : 0;
  const svLineModeProg = useSharedValue(lineMorphJs);

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
    const { leftEdge, rightEdge } = windowEdges(now, win, buf);
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
    now,
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

  /* ---- loading animation ---- */
  const [loadMs, setLoadMs] = useState(0);
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

  const loadPath = useMemo(
    () => (empty && layout.width > 0 ? buildLoadingPath(layout.width, layout.height, pad, loadMs) : ''),
    [empty, layout.width, layout.height, pad, loadMs],
  );
  const loadAlpha = useMemo(
    () => (empty ? loadingBreath(loadMs) : 0),
    [empty, loadMs],
  );

  /* ---- static values (plain, no UI-thread reactivity) ---- */
  const svReveal = useSharedValue(empty ? 0 : 1);
  const revealOp = empty ? 0 : 1;

  const clipRect = chartW > 0 && chartH > 0
    ? rect(pad.left, pad.top, chartW, chartH)
    : undefined;

  /* ---- gesture-driven shared values (user interaction only) ---- */
  const svScrubX = useSharedValue(-1);
  const svScrubHv = useSharedValue(0);
  const svScrubOp = useSharedValue(0);
  const svPinchStartWin = useSharedValue(baseWin);

  /* ---- data snapshot shared values (sync once for gesture worklets) ---- */
  const svTipT = useSharedValue(now);
  const svTipV = useSharedValue(effectiveValue);
  const svMin = useSharedValue(rng.min);
  const svMax = useSharedValue(rng.max);
  const svLineDataCount = useSharedValue(effectiveData.length);
  const svIsCandleFlag = useSharedValue(isCandle ? 1 : 0);
  const svRangeScaleY = useSharedValue(1);
  const svRangeTranslateY = useSharedValue(0);

  useEffect(() => { svTipT.value = now; }, [now, svTipT]);
  useEffect(() => { svTipV.value = effectiveValue; }, [effectiveValue, svTipV]);
  useEffect(() => { svMin.value = rng.min; svMax.value = rng.max; }, [rng.min, rng.max, svMin, svMax]);
  useEffect(() => { svLineDataCount.value = effectiveData.length; }, [effectiveData.length, svLineDataCount]);
  useEffect(() => { svIsCandleFlag.value = isCandle ? 1 : 0; }, [isCandle, svIsCandleFlag]);

  /* ---- static prop-dependent values (plain useMemo, no UI thread) ---- */
  const liveX = useMemo(
    () => toScreenXJs(now, now, win, layout.width, pad, buf),
    [now, win, layout.width, pad, buf],
  );
  const liveY = useMemo(
    () => toScreenYJs(effectiveValue, rng.min, rng.max, layout.height, pad),
    [effectiveValue, rng.min, rng.max, layout.height, pad],
  );

  const dashY = useMemo(() => {
    const dashV = isCandle ? (liveCandle?.close ?? effectiveValue) : effectiveValue;
    return clampW(
      toScreenYJs(dashV, rng.min, rng.max, layout.height, pad),
      pad.top,
      layout.height - pad.bottom,
    );
  }, [isCandle, liveCandle, effectiveValue, rng.min, rng.max, layout.height, pad]);
  const dashP1 = vec(pad.left, dashY);
  const dashP2 = vec(layout.width - pad.right, dashY);

  const lineColor = useMemo(() => {
    const t = Math.min(1, revealOp * 3);
    const r = Math.round(lineRevealStartRgb[0] + (lineRevealEndRgb[0] - lineRevealStartRgb[0]) * t);
    const g = Math.round(lineRevealStartRgb[1] + (lineRevealEndRgb[1] - lineRevealStartRgb[1]) * t);
    const b = Math.round(lineRevealStartRgb[2] + (lineRevealEndRgb[2] - lineRevealStartRgb[2]) * t);
    return `rgb(${r},${g},${b})`;
  }, [revealOp, lineRevealStartRgb, lineRevealEndRgb]);

  const liveGlowColor = useMemo(() => {
    if (mom === 'up') return pal.glowUp;
    if (mom === 'down') return pal.glowDown;
    return pal.glowFlat;
  }, [mom, pal.glowDown, pal.glowFlat, pal.glowUp]);

  const referenceY = useMemo(
    () =>
      referenceLine
        ? toScreenYJs(referenceLine.value, rng.min, rng.max, layout.height, pad)
        : -100,
    [referenceLine, rng.min, rng.max, layout.height, pad],
  );

  /* ---- gesture-reactive derived values (scrub only) ---- */
  const svEffectiveDataArr = useSharedValue<LiveLinePoint[]>(effectiveData);
  useEffect(() => { svEffectiveDataArr.value = effectiveData; }, [effectiveData, svEffectiveDataArr]);

  const dvDashLineOp = useDerivedValue(() => 1 - svScrubOp.value * 0.2);

  const dvSplitX = useDerivedValue(() => {
    if (svScrubOp.value <= 0.01) return layout.width - pad.right;
    return clampW(svScrubX.value, pad.left, liveX);
  }, [layout.width, pad.left, pad.right, liveX]);

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

  const dvHoverX = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01) return -100;
    return clampW(svScrubX.value, pad.left, liveX);
  }, [pad.left, scrub, liveX]);

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
  }, [chartW, win, layout.height, pad, scrub, buf, isCandle, liveX]);

  const dvCrossEffectiveOp = useDerivedValue(() => {
    const scrubAmt = svScrubOp.value;
    if (scrubAmt <= 0.01) return 0;
    const w = layout.width;
    const cw = Math.max(1, w - pad.left - pad.right);
    const rightEdge = svTipT.value + win * buf;
    const leftEdge = rightEdge - win;
    const liveXWorklet = pad.left + ((svTipT.value - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const hx = dvHoverX.value;
    const dist = liveXWorklet - hx;
    const fadeStart = Math.min(80, cw * 0.3);
    if (dist < CROSSHAIR_FADE_MIN_PX) return 0;
    if (dist >= fadeStart) return scrubAmt;
    return ((dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * scrubAmt;
  }, [layout.width, pad.left, pad.right, win, buf, liveX]);

  const dvCrossP1 = useDerivedValue(() => vec(dvHoverX.value, pad.top), [pad.top]);
  const dvCrossP2 = useDerivedValue(() => vec(dvHoverX.value, layout.height - pad.bottom), [layout.height, pad.bottom]);
  const dvCrossLineOp = useDerivedValue(() => dvCrossEffectiveOp.value * 0.5);
  const dvCrossDotR = useDerivedValue(() => 4 * Math.min(dvCrossEffectiveOp.value * 3, 1));
  const dvCrossDotOp = useDerivedValue(() => (dvCrossEffectiveOp.value > 0.01 ? 1 : 0));

  /* ---- badge ---- */
  const [badgeStr, setBadgeStr] = useState(() => formatValue(effectiveValue));
  useEffect(() => {
    setBadgeStr(formatValue(effectiveValue));
  }, [effectiveValue, formatValue]);

  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;
  const badgeX = Math.max(pad.left + 4, layout.width - (BADGE_TAIL_LEN + 80) - 18);
  const badgeY = Math.max(
    pad.top + 4,
    Math.min(
      layout.height - pad.bottom - pillH - 4,
      toScreenYJs(effectiveValue, rng.min, rng.max, layout.height, pad) - pillH / 2,
    ),
  );

  const badgeFlowA11yLabel = badgeStr;

  /* ---- scrub tip ---- */
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
      return `O ${formatValue(c.open)} H ${formatValue(c.high)} L ${formatValue(c.low)} C ${formatValue(c.close)} ${formatTime(c.time)}`;
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
          prev.candle?.time === candle?.time
        ) {
          return prev;
        }
        return candle ? { hx, hv, ht, candle } : { hx, hv, ht };
      });
    },
    [clearScrubTip],
  );

  /* ---- pinch window stable setter (must be before gesture memo) ---- */
  const setPinchWindowStable = useCallback((nextWindow: number | null) => {
    setPinchWindow((prev) => {
      if (prev === nextWindow) return prev;
      if (prev !== null && nextWindow !== null && Math.abs(prev - nextWindow) < 0.05) return prev;
      return nextWindow;
    });
  }, []);

  /* ---- gestures (stable deps via SharedValues) ---- */
  const svCandleVisibleArr = useSharedValue<CandlePoint[]>(candleVisibleForLayout);
  useEffect(() => { svCandleVisibleArr.value = candleVisibleForLayout; }, [candleVisibleForLayout, svCandleVisibleArr]);
  const svCandleWidthSecs = useSharedValue(candleWidthSecs);
  useEffect(() => { svCandleWidthSecs.value = candleWidthSecs; }, [candleWidthSecs, svCandleWidthSecs]);

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
            e.x, layout.width, pad, win, buf,
            svTipT.value, svTipV.value, candleVis, svCandleWidthSecs.value,
          );
          const morphT = svLineModeProg.value;
          if (morphT < 1e-4) {
            hx = c.hx; hv = c.hv; ht = c.ht; cand = c.candle ?? undefined;
          } else {
            const l = sampleScrubAtX(
              e.x, layout.width, pad, win, buf,
              svTipT.value, svTipV.value, effData, snapToPointScrubbing,
            );
            const b = candleLineMorphScrubBlend(morphT, c, l);
            hx = b.hx; hv = b.hv; ht = b.ht; cand = b.cand;
          }
        } else {
          const sample = sampleScrubAtX(
            e.x, layout.width, pad, win, buf,
            svTipT.value, svTipV.value, effData, snapToPointScrubbing,
          );
          hx = sample.hx; hv = sample.hv; ht = sample.ht; cand = undefined;
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
            e.x, layout.width, pad, win, buf,
            svTipT.value, svTipV.value, candleVis, svCandleWidthSecs.value,
          );
          const morphT = svLineModeProg.value;
          if (morphT < 1e-4) {
            hx = c.hx; hv = c.hv; ht = c.ht; liveX = c.liveX; cand = c.candle ?? undefined;
          } else {
            const l = sampleScrubAtX(
              e.x, layout.width, pad, win, buf,
              svTipT.value, svTipV.value, effData, snapToPointScrubbing,
            );
            const b = candleLineMorphScrubBlend(morphT, c, l);
            hx = b.hx; hv = b.hv; ht = b.ht; liveX = b.liveX; cand = b.cand;
          }
        } else {
          const sample = sampleScrubAtX(
            e.x, layout.width, pad, win, buf,
            svTipT.value, svTipV.value, effData, snapToPointScrubbing,
          );
          hx = sample.hx; hv = sample.hv; ht = sample.ht; liveX = sample.liveX; cand = undefined;
        }
        svScrubX.value = hx;
        svScrubHv.value = hv;

        const chartWi = Math.max(1, layout.width - pad.left - pad.right);
        const scrubAmt = svScrubOp.value;
        const dist = liveX - hx;
        const fadeStart = Math.min(80, chartWi * 0.3);
        let op = 0;
        if (dist >= CROSSHAIR_FADE_MIN_PX) {
          op = dist >= fadeStart ? scrubAmt : ((dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX)) * scrubAmt;
        }
        const ts = Date.now();
        const hxD = Math.abs(hx - svScrubJsLastHx.value);
        const opD = Math.abs(op - svScrubJsLastOp.value);
        const dtUi = ts - svScrubJsLastTs.value;
        if (op > 0.01 && dtUi < 30 && hxD < 2.25 && opD < 0.045) return;
        svScrubJsLastTs.value = ts;
        svScrubJsLastHx.value = hx;
        svScrubJsLastOp.value = op;
        runOnJS(applyScrubTip)(hx, hv, ht, op, cand);
      })
      .onFinalize(() => {
        svScrubOp.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) runOnJS(clearScrubTip)();
        });
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
    scrub, layout.width, pad, win, buf, isCandle, snapToPointScrubbing,
    svScrubOp, svScrubX, svScrubHv, svTipT, svTipV, svLineModeProg,
    svPinchStartWin, pinchToZoom, pinchWindow, resolvedWin, maxPinchWindow,
    onScrubPanBeginHaptic, applyScrubTip, clearScrubTip,
    svCandleVisibleArr, svCandleWidthSecs, svEffectiveDataArr,
  ]);

  const svScrubJsLastTs = useSharedValue(0);
  const svScrubJsLastHx = useSharedValue(-1e9);
  const svScrubJsLastOp = useSharedValue(-1);

  /* ---- reveal opacities (static, no animation) ---- */
  const revealGridOp = revealOp;
  const revealDotOp = revealOp;
  const revealArrowOp = revealOp;
  const revealLineOp = revealOp;
  const candleMorphOp = revealOp * (1 - lineMorphJs);
  const morphLineOverlayOp = revealOp * lineMorphJs;

  /* ---- momentum chevrons (static) ---- */
  const chev0Path = !momProp || mom === 'flat'
    ? ''
    : chevronStroke(liveX + 19, liveY, mom === 'up' ? -1 : 1, 0);
  const chev1Path = !momProp || mom === 'flat'
    ? ''
    : chevronStroke(liveX + 19, liveY, mom === 'up' ? -1 : 1, 1);

  /* ---- badge paths (static) ---- */
  const badgeBgPath = badgeSvgPath(80, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD);
  const badgeInnerPathStr = badgeSvgPath(76, pillH - 4, BADGE_TAIL_LEN - 1, BADGE_TAIL_SPREAD - 0.5);

  const badgeInnerColor = useMemo(() => {
    const [r, g, b] = parseColorRgb(color);
    return `rgb(${r},${g},${b})`;
  }, [color]);

  const dvScrubValueStr = useDerivedValue(() => {
    'worklet';
    return formatPriceCentsWorklet(svScrubHv.value);
  });

  /* ---- scrub tooltip layouts ---- */
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

  const onBadgeTemplateLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      // static — no dynamic width tracking
    },
    [],
  );

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
                <Canvas style={StyleSheet.absoluteFill}>
                  <GridCanvas
                    grid={grid}
                    gridLabels={trackedGridLabels}
                    timeLabels={trackedTimeLabels}
                    pad={pad}
                    layoutWidth={layout.width}
                    baseY={baseY}
                    opacity={revealGridOp}
                    pal={pal}
                  />

                  {/* ========== LINE MODE ========== */}
                  {!isCandle ? (
                    <>
                      {fill && clipRect ? (
                        <Group clip={clipRect} opacity={revealLineOp}>
                          <Group clip={dvClipL}>
                            <Path path={staticFillPath}>
                              <LinearGradient
                                start={vec(0, pad.top)}
                                end={vec(0, layout.height - pad.bottom)}
                                colors={[pal.accentFillTop, pal.accentFillBottom]}
                              />
                            </Path>
                          </Group>
                          <Group clip={dvClipR} opacity={dvRightSegOp}>
                            <Path path={staticFillPath}>
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
                        revealOpacity={revealLineOp}
                        path={staticLinePath}
                        layoutHeight={layout.height}
                        padTop={pad.top}
                        padRight={pad.right}
                        layoutWidth={layout.width}
                        lineWidth={pal.lineWidth}
                        lineColor={lineColor}
                        trailGlow={lineTrailGlow}
                        trailGlowColor={pal.accentGlow}
                        gradientLineColoring={gradientLineColoring}
                        gradientStartColor={pal.gridLabel}
                        gradientEndColor={pal.accent}
                        rangeScaleY={svRangeScaleY}
                        rangeTranslateY={svRangeTranslateY}
                      />
                    </>
                  ) : null}

                  {/* ========== CANDLE MODE ========== */}
                  {isCandle ? (
                    <>
                      <Group opacity={candleMorphOp}>
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
                      <Group opacity={morphLineOverlayOp}>
                        <LinePathLayer
                          clipRect={clipRect}
                          leftClip={dvClipL}
                          rightClip={dvClipR}
                          rightOpacity={dvRightSegOp}
                          revealOpacity={1}
                          path={staticMorphLinePath}
                          layoutHeight={layout.height}
                          padTop={pad.top}
                          padRight={pad.right}
                          layoutWidth={layout.width}
                          lineWidth={pal.lineWidth}
                          lineColor={lineColor}
                          trailGlow={lineTrailGlow}
                          trailGlowColor={pal.accentGlow}
                          gradientLineColoring={gradientLineColoring}
                          gradientStartColor={pal.gridLabel}
                          gradientEndColor={pal.accent}
                          rangeScaleY={svRangeScaleY}
                          rangeTranslateY={svRangeTranslateY}
                        />
                      </Group>
                    </>
                  ) : null}

                  {referenceLine ? (
                    <ReferenceLineCanvas
                      label={referenceLine.label}
                      y={referenceY}
                      opacity={revealGridOp}
                      padLeft={pad.left}
                      padRight={pad.right}
                      layoutWidth={layout.width}
                      lineColor={pal.refLine}
                    />
                  ) : null}

                  {/* -- Dashed price line -- */}
                  <Group opacity={dvDashLineOp}>
                    <SkiaLine
                      p1={dashP1}
                      p2={dashP2}
                      color={isCandle ? candleBadgeDashColor : pal.dashLine}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[4, 4]} />
                    </SkiaLine>
                  </Group>

                  {!isCandle ? (
                    <>
                      {/* -- Live dot -- */}
                      <LiveDotLayer
                        revealOpacity={revealDotOp}
                        liveX={liveX}
                        liveY={liveY}
                        glowEnabled={liveDotGlow}
                        glowColor={liveGlowColor}
                        outerColor={pal.badgeOuterBg}
                        outerShadow={pal.badgeOuterShadow}
                        innerColor={pal.accent}
                      />

                      {/* -- Momentum chevrons -- */}
                      {momProp ? (
                        <Group opacity={revealArrowOp}>
                          <Path
                            path={chev0Path}
                            style="stroke"
                            strokeWidth={2.5}
                            strokeJoin="round"
                            strokeCap="round"
                            color={pal.gridLabel}
                          />
                          <Path
                            path={chev1Path}
                            style="stroke"
                            strokeWidth={2.5}
                            strokeJoin="round"
                            strokeCap="round"
                            color={pal.gridLabel}
                          />
                        </Group>
                      ) : null}
                    </>
                  ) : null}

                  {/* -- Left edge fade -- */}
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
                    y={referenceY}
                    opacity={revealGridOp}
                    padLeft={pad.left}
                    padRight={pad.right}
                    layoutWidth={layout.width}
                    color={pal.refLabel}
                    textStyle={styles.referenceLabel}
                  />
                ) : null}

                <BadgeOverlay
                  badge={badge}
                  empty={empty}
                  variant={badgeVariant}
                  skiaBadgeFlow={skiaBadgeFlow}
                  badgeFlowA11yLabel={badgeFlowA11y}
                  badgeNumFont={badgeNumFont}
                  badgeValue={svTipV}
                  flowPillW={80}
                  badgeStr={badgeStr}
                  badgeStyle={{ opacity: badge ? 1 : 0, width: BADGE_TAIL_LEN + 80, height: pillH + 10, transform: [{ translateX: badgeX }, { translateY: badgeY }] }}
                  badgeTextWrapStyle={{ width: Math.max(12, 80 - BADGE_TAIL_LEN - 2) }}
                  backgroundPath={badgeBgPath}
                  innerPath={badgeInnerPathStr}
                  innerColor={badgeInnerColor}
                  pillH={pillH}
                  onBadgeTemplateLayout={onBadgeTemplateLayout}
                  pal={pal}
                  badgeTextStyle={styles.badgeTxt}
                />
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
