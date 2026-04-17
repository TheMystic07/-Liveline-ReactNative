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
  Shadow,
  rect,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
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

import { resolvePalette, parseColorRgb } from './theme';
import { lerp as lerpFr } from './math/lerp';
import type { ChartPadding, LiveLineChartProps, LiveLinePoint, LiveLineWindowStyle } from './types';
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
import {
  loadingY,
  loadingBreath,
  LOADING_AMPLITUDE_RATIO,
  LOADING_SCROLL_SPEED,
} from './draw/loadingShape';
import { decayShake, randomShakeOffset, shakeAmplitude } from './draw/shake';
import { monotoneSplinePath } from './math/spline';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParticleSpec {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

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

/* ------------------------------------------------------------------ */
/*  Constants — matching upstream exactly                               */
/* ------------------------------------------------------------------ */

const DEFAULT_HEIGHT = 300;
const FADE_EDGE_WIDTH = 40;
const PULSE_INTERVAL = 1500;
const PULSE_DURATION = 900;
/** Matches upstream `WINDOW_BUFFER` / `WINDOW_BUFFER_NO_BADGE`. */
const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
const CROSSHAIR_FADE_MIN_PX = 5;
const MAX_PARTICLES = 80;
const PARTICLE_COOLDOWN_MS = 400;
const MAGNITUDE_THRESHOLD = 0.08;
const MAX_BURSTS = 3;
/** Upstream `ADAPTIVE_SPEED_BOOST` — scales with gap between live value and display. */
const ADAPTIVE_SPEED_BOOST = 0.2;
/** Upstream `VALUE_SNAP_THRESHOLD`. */
const VALUE_SNAP_THRESHOLD = 0.001;
/** Throttle grid label refresh while range lerps (ms, worklet accumulator). */
const GRID_FLUSH_MS = 24;
/** Upstream `BADGE_WIDTH_LERP` — badge pill width eases toward measured text. */
const BADGE_WIDTH_LERP = 0.15;
const MAX_DELTA_MS = 50;

/* -- Upstream constants for smoother animation -- */
/** Range lerp base speed (upstream uses 0.15, separate from value lerp 0.08). */
const RANGE_LERP_SPEED = 0.15;
/** Range adaptive boost when range changes significantly. */
const RANGE_ADAPTIVE_BOOST = 0.2;
/** Badge Y position lerp speed (upstream 0.35, faster during window transitions). */
const BADGE_Y_LERP = 0.35;
const BADGE_Y_LERP_TRANSITION = 0.5;
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

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

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

/* ------------------------------------------------------------------ */
/*  Path builder — Fritsch-Carlson monotone cubic spline               */
/*  Inline worklet-compatible version                                  */
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
  'worklet';
  if (pts.length === 0 || w <= 0 || h <= 0) return '';

  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const rightEdge = tipT + win * buffer;
  const leftEdge = rightEdge - win;
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

  // Append live tip
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

  // Fritsch-Carlson monotone cubic
  const n = f.length;
  const delta: number[] = new Array(n - 1);
  const hh: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    hh[i] = f[i + 1].x - f[i].x;
    delta[i] = hh[i] === 0 ? 0 : (f[i + 1].y - f[i].y) / hh[i];
  }
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / delta[i];
      const b = m[i + 1] / delta[i];
      const s2 = a * a + b * b;
      if (s2 > 9) {
        const s = 3 / Math.sqrt(s2);
        m[i] = s * a * delta[i];
        m[i + 1] = s * b * delta[i];
      }
    }
  }

  const cmds: string[] = [`M ${f[0].x} ${f[0].y}`];
  for (let i = 0; i < n - 1; i++) {
    const hi2 = hh[i];
    cmds.push(
      `C ${f[i].x + hi2 / 3} ${f[i].y + m[i] * hi2 / 3} ${f[i + 1].x - hi2 / 3} ${f[i + 1].y - m[i + 1] * hi2 / 3} ${f[i + 1].x} ${f[i + 1].y}`,
    );
  }

  if (floor) {
    cmds.push(`L ${f[n - 1].x} ${floorY}`, `L ${f[0].x} ${floorY}`, 'Z');
  }
  return cmds.join(' ');
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
): ParticleSpec[] {
  const isUp = mom === 'up';
  const mg = Math.min(mag * 5, 1);
  const count = Math.round(12 + mg * 20);
  const speedMul = 1 + mg * 0.8;
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count && out.length < MAX_PARTICLES; i++) {
    const base = isUp ? -Math.PI / 2 : Math.PI / 2;
    const angle = base + (Math.random() - 0.5) * Math.PI * 1.2;
    const spd = (60 + Math.random() * 100) * speedMul;
    out.push({
      id: ids.current++,
      x: dx + (Math.random() - 0.5) * 24,
      y: dy + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1000,
      size: 1 + Math.random() * 1.2,
      color: accent,
    });
  }
  return out;
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

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

function Particle({
  p,
  onDone,
}: {
  p: ParticleSpec;
  onDone: (id: number) => void;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: p.life, easing: Easing.linear }, (ok) => {
      if (ok) runOnJS(onDone)(p.id);
    });
  }, [onDone, p.id, p.life, t]);

  // Upstream physics: x += vx*dt; vx *= 0.95 each frame (60fps)
  // Closed-form integral of geometric decay:
  // displacement = v0 * (1 - 0.95^n) / (1 - 0.95) * dt
  // where n = t * 60 (frame count over lifetime)
  const cx = useDerivedValue(() => {
    const progress = t.value;
    const frames = progress * 60;
    const disp = p.vx * (1 - Math.pow(0.95, frames)) / 0.05 / 60;
    return p.x + disp;
  });
  const cy = useDerivedValue(() => {
    const progress = t.value;
    const frames = progress * 60;
    const disp = p.vy * (1 - Math.pow(0.95, frames)) / 0.05 / 60;
    return p.y + disp;
  });
  const op = useDerivedValue(() => (1 - t.value) * 0.55);
  const r = useDerivedValue(() => p.size * (0.5 + (1 - t.value) * 0.5));

  return <Circle cx={cx} cy={cy} r={r} color={p.color} opacity={op} />;
}

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
  pulse = true,
  scrub = true,
  momentum: momProp = true,
  degen = false,
  exaggerate = false,
  tooltipY = 14,
  tooltipOutline = true,
  height = DEFAULT_HEIGHT,
  loading = false,
  emptyText = 'Waiting for ticks',
  formatValue = defaultFmtVal,
  formatTime = defaultFmtTime,
  lerpSpeed = 0.08,
  style,
  contentInset,
}: LiveLineChartProps) {
  const buf = windowBuffer(badge);
  const isDark = theme === 'dark';
  const ws: LiveLineWindowStyle = windowStyleProp ?? 'default';

  /* ---- palette ---- */
  const pal = useMemo(
    () => resolvePalette(color, theme, lineWidth),
    [color, theme, lineWidth],
  );

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

  /* ---- time window with smooth transition (upstream log-space cosine easing) ---- */
  const resolvedWin = useMemo(() => {
    if (!windows?.length) return controlledWin;
    if (windows.some((w) => w.secs === controlledWin)) return controlledWin;
    return windows[0].secs;
  }, [windows, controlledWin]);

  /** Window transition state — tracks animated window secs via worklet frame callback. */
  const winTransRef = useRef<{
    from: number;
    to: number;
    startMs: number;
    active: boolean;
  }>({ from: resolvedWin, to: resolvedWin, startMs: 0, active: false });
  const svWinFrom = useSharedValue(resolvedWin);
  const svWinTo = useSharedValue(resolvedWin);
  const svWinProgress = useSharedValue(1); // 0=from, 1=to (done)
  const svWinTransActive = useSharedValue(0);
  /** Current effective window secs (animated). Used by rendering. */
  const [effectiveWin, setEffectiveWin] = useState(resolvedWin);

  const flushEffectiveWin = useCallback((v: number) => {
    setEffectiveWin(v);
  }, []);

  /** Trigger a smooth window transition when resolvedWin changes. */
  const prevResolvedWin = useRef(resolvedWin);
  useEffect(() => {
    if (prevResolvedWin.current === resolvedWin) return;
    const from = prevResolvedWin.current;
    prevResolvedWin.current = resolvedWin;
    winTransRef.current = {
      from,
      to: resolvedWin,
      startMs: performance.now(),
      active: true,
    };
    svWinFrom.value = from;
    svWinTo.value = resolvedWin;
    svWinProgress.value = 0;
    svWinTransActive.value = 1;
  }, [resolvedWin, svWinFrom, svWinTo, svWinProgress, svWinTransActive]);

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
  const didRangeInitRef = useRef(false);
  const flushGridRef = useRef<(lo: number, hi: number) => void>(() => {});

  useEffect(() => {
    if (!loading && data.length >= 2) return;
    let id: number;
    const tick = () => {
      setLoadMs(performance.now());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [loading, data.length]);

  /* ---- derived data ---- */
  const now = data[data.length - 1]?.time ?? Date.now() / 1000;
  const vis = useMemo(() => getVisible(data, now, win, buf), [data, now, win, buf]);
  const rng = useMemo(
    () => computeRange(vis, value, exaggerate),
    [vis, value, exaggerate],
  );
  const mom = useMemo(() => detectMomentum(vis), [vis]);
  const swMag = useMemo(
    () => computeSwingMagnitude(vis, value, rng.min, rng.max),
    [vis, value, rng.min, rng.max],
  );

  const chartW = layout.width - pad.left - pad.right;
  const chartH = layout.height - pad.top - pad.bottom;
  const empty = layout.width <= 0 || data.length < 2 || loading;

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
    () => calcTimeTicks(now, win, layout.width, pad, formatTime, buf),
    [now, win, layout.width, pad, formatTime, buf],
  );

  /* ---- shared values ---- */
  const svTipT = useSharedValue(now);
  const svTipV = useSharedValue(value);
  const svMin = useSharedValue(rng.min);
  const svMax = useSharedValue(rng.max);
  const svTargetMin = useSharedValue(rng.min);
  const svTargetMax = useSharedValue(rng.max);
  const svRawValue = useSharedValue(value);
  const svChartH = useSharedValue(Math.max(1, chartH));
  const svLerpSpeed = useSharedValue(lerpSpeed);
  const svGridFlushAcc = useSharedValue(0);
  const svGridOn = useSharedValue(grid ? 1 : 0);
  const svScrubX = useSharedValue(-1);
  const svScrubOp = useSharedValue(0);
  /** Throttle scrub tooltip runOnJS — line/crosshair still follow every frame via svScrubX. */
  const svScrubJsLastTs = useSharedValue(0);
  const svScrubJsLastHx = useSharedValue(-1e9);
  const svScrubJsLastOp = useSharedValue(-1);
  const svBurst = useSharedValue(0);
  const clock = useClock();
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

  const [badgeStr, setBadgeStr] = useState(() => formatValue(value));
  const badgeQuantMul = formatValue === defaultFmtVal ? 100 : 10_000;

  /** Sync badge label only when quantized display changes (avoids runOnJS every frame). */
  const setBadgeFromQuant = useCallback(
    (q: number) => {
      const v = q / badgeQuantMul;
      setBadgeStr((s) => {
        const n = formatValue(v);
        return n === s ? s : n;
      });
    },
    [formatValue, badgeQuantMul],
  );

  useAnimatedReaction(
    () => Math.round(svTipV.value * badgeQuantMul),
    (q, prev) => {
      'worklet';
      if (prev !== undefined && q === prev) return;
      runOnJS(setBadgeFromQuant)(q);
    },
    [badgeQuantMul, setBadgeFromQuant],
  );

  const flushGridSmooth = useCallback((lo: number, hi: number) => {
    setGridSmooth((prev) => {
      if (prev && Math.abs(prev.min - lo) < 1e-12 && Math.abs(prev.max - hi) < 1e-12) return prev;
      return { min: lo, max: hi };
    });
  }, []);
  flushGridRef.current = flushGridSmooth;

  useEffect(() => {
    svLerpSpeed.value = lerpSpeed;
  }, [lerpSpeed, svLerpSpeed]);

  useEffect(() => {
    svChartH.value = Math.max(1, chartH);
  }, [chartH, svChartH]);

  useEffect(() => {
    svGridOn.value = grid ? 1 : 0;
  }, [grid, svGridOn]);

  useEffect(() => {
    svRawValue.value = value;
  }, [value, svRawValue]);

  /** Live dot X tracks data time (upstream: no horizontal ease between ticks). */
  useEffect(() => {
    svTipT.value = now;
  }, [now, svTipT]);

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
      svTipV.value = value;
      setGridSmooth({ min: rng.min, max: rng.max });
      svGridFlushAcc.value = GRID_FLUSH_MS;
      // Initialize badge Y to target (no lerp on first frame)
      if (!svBadgeYInit.current && layout.height > 0) {
        svBadgeYInit.current = true;
        svBadgeY.value = toScreenY(value, rng.min, rng.max, layout.height, pad);
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
  }, [empty, rng.min, rng.max, value, svMin, svMax, svTargetMin, svTargetMax, svTipV, svGridFlushAcc]);

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

  /** Stable worklet — avoids re-registering the frame callback every render. */
  const onEngineFrame = useCallback(
    (frameInfo: { timeSincePreviousFrame: number | null }) => {
      'worklet';
      const rawDt = frameInfo.timeSincePreviousFrame;
      const dt = Math.min(MAX_DELTA_MS, rawDt == null ? 16.67 : rawDt);

      /* ---- Window transition (log-space cosine easing) ---- */
      if (svWinTransActive.value === 1) {
        // Accumulate progress using dt (frame-rate independent)
        let prog = svWinProgress.value + dt / WINDOW_TRANSITION_MS;
        if (prog > 1) prog = 1;
        svWinProgress.value = prog;
        const winVal = lerpWindowLogSpace(svWinFrom.value, svWinTo.value, prog);
        runOnJS(flushEffectiveWin)(winVal);
        if (prog >= 1) {
          svWinTransActive.value = 0;
          runOnJS(flushEffectiveWin)(svWinTo.value);
        }
      }

      /* ---- Chart reveal (0→1 smooth morph) ---- */
      if (svReveal.value < 1) {
        let rev = svReveal.value;
        rev = lerpFr(rev, 1, CHART_REVEAL_SPEED, dt);
        if (rev > 0.995) rev = 1;
        svReveal.value = rev;
      }

      /* ---- Value smoothing (unchanged base logic, matches upstream exactly) ---- */
      const ch = svChartH.value;
      const dmin0 = svMin.value;
      const dmax0 = svMax.value;
      const disp = svTipV.value;
      const tgt = svRawValue.value;
      const ls = svLerpSpeed.value;
      const spd = computeAdaptiveSpeed(tgt, disp, dmin0, dmax0, ls);
      const prevR = dmax0 - dmin0 || 1;
      let nextDisp = lerpFr(disp, tgt, spd, dt);
      if (Math.abs(nextDisp - tgt) < prevR * VALUE_SNAP_THRESHOLD) nextDisp = tgt;
      svTipV.value = nextDisp;

      /* ---- Range smoothing (SEPARATE speed — upstream 0.15 + 0.2 adaptive) ---- */
      const curRange = dmax0 - dmin0 || 1;
      const tmin = svTargetMin.value;
      const tmax = svTargetMax.value;
      const rangeGap = Math.abs((tmax - tmin) - curRange);
      const rangeRatio = Math.min(rangeGap / curRange, 1);
      const rangeLerpSpd = RANGE_LERP_SPEED + (1 - rangeRatio) * RANGE_ADAPTIVE_BOOST;
      let nextMin = lerpFr(dmin0, tmin, rangeLerpSpd, dt);
      let nextMax = lerpFr(dmax0, tmax, rangeLerpSpd, dt);
      const pxTh = (0.5 * curRange) / ch || 0.001;
      if (Math.abs(nextMin - tmin) < pxTh) nextMin = tmin;
      if (Math.abs(nextMax - tmax) < pxTh) nextMax = tmax;
      svMin.value = nextMin;
      svMax.value = nextMax;

      /* ---- Badge Y lerp (upstream BADGE_Y_LERP = 0.35) ---- */
      if (svBadgeOn.value === 1) {
        // Approximate full layout height from chartH + typical padding (12 + 28 = 40)
        const fullH = ch + 40;
        const padApprox = { top: 12, right: 0, bottom: 28, left: 0 } as ChartPadding;
        const targetBY = toScreenY(svTipV.value, svMin.value, svMax.value, fullH, padApprox);
        const bySpeed = svWinTransActive.value === 1 ? BADGE_Y_LERP_TRANSITION : BADGE_Y_LERP;
        let by = svBadgeY.value;
        by = lerpFr(by, targetBY, bySpeed, dt);
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
          svMomColorR.value = lerpFr(svMomColorR.value, tR, MOMENTUM_COLOR_SPEED, dt);
          svMomColorG.value = lerpFr(svMomColorG.value, tG, MOMENTUM_COLOR_SPEED, dt);
          svMomColorB.value = lerpFr(svMomColorB.value, tB, MOMENTUM_COLOR_SPEED, dt);
        }
      }

      /* ---- Grid flush ---- */
      if (svGridOn.value === 1) {
        svGridFlushAcc.value += dt;
        if (svGridFlushAcc.value >= GRID_FLUSH_MS) {
          svGridFlushAcc.value = 0;
          runOnJS(flushGridRef.current)(svMin.value, svMax.value);
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
        up = lerpFr(up, canFadeInUp ? upTarget : 0, upSpeed, dt);
        down = lerpFr(down, canFadeInDown ? downTarget : 0, downSpeed, dt);
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
        w = lerpFr(w, targetPillW, BADGE_WIDTH_LERP, dt);
        if (Math.abs(w - targetPillW) < 0.3) w = targetPillW;
        svBadgePillW.value = w;
      }

      /* ---- Chart shake decay (degen mode) ---- */
      if (svShakeX.value !== 0 || svShakeY.value !== 0) {
        svShakeX.value = decayShake(svShakeX.value, dt);
        svShakeY.value = decayShake(svShakeY.value, dt);
      }
    },
    [],
  );

  const engineFrame = useFrameCallback(onEngineFrame, false);

  useEffect(() => {
    const run = !empty;
    engineFrame.setActive(run);
    if (empty) {
      svArrowUp.value = 0;
      svArrowDown.value = 0;
      svShakeX.value = 0;
      svShakeY.value = 0;
    }
  }, [empty, engineFrame, svArrowUp, svArrowDown, svShakeX, svShakeY]);

  /* ---- degen burst ---- */
  const spawnPt = useMemo(
    () => ({
      x: toScreenXJs(now, now, win, layout.width, pad, buf),
      y: toScreenY(
        value,
        gridSmooth?.min ?? rng.min,
        gridSmooth?.max ?? rng.max,
        layout.height,
        pad,
      ),
    }),
    [now, win, layout.width, layout.height, pad, buf, value, rng.min, rng.max, gridSmooth],
  );

  useEffect(() => {
    if (!degen || layout.width <= 0 || mom === 'flat') return;
    if (swMag < MAGNITUDE_THRESHOLD) {
      burstRef.current.burstCount = 0;
      return;
    }
    if (burstRef.current.burstCount >= MAX_BURSTS) return;
    const t = Date.now();
    if (t - burstRef.current.cooldown < PARTICLE_COOLDOWN_MS) return;
    burstRef.current.cooldown = t;
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

    setParticles((c) => [
      ...c.slice(-56),
      ...spawnBurst(spawnPt.x, spawnPt.y, mom, pal.accent, swMag, idRef),
    ]);
  }, [degen, layout.width, mom, swMag, spawnPt, pal.accent, svBurst, svShakeX, svShakeY, value]);

  /* ================================================================ */
  /*  ALL derived values (hooks) — BEFORE return                      */
  /* ================================================================ */

  const clipRect = chartW > 0 && chartH > 0
    ? rect(pad.left, pad.top, chartW, chartH)
    : undefined;

  // Line path
  const dvLinePath = useDerivedValue(
    () => buildPath(vis, svTipT.value, svTipV.value, svMin.value, svMax.value,
      layout.width, layout.height, pad, win, buf, false),
    [vis, layout.width, layout.height, pad, win, buf],
  );

  // Fill path
  const dvFillPath = useDerivedValue(
    () => buildPath(vis, svTipT.value, svTipV.value, svMin.value, svMax.value,
      layout.width, layout.height, pad, win, buf, true),
    [vis, layout.width, layout.height, pad, win, buf],
  );

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
    () => (pulse ? (clock.value % PULSE_INTERVAL) / PULSE_DURATION : 2),
    [clock, pulse],
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
    if (dim < 0.3) return base * (1 - dim * 3);
    return base;
  }, [pulse]);

  // Dashed price line Y
  const dvDashY = useDerivedValue(
    () => clampW(
      toScreenY(svTipV.value, svMin.value, svMax.value, layout.height, pad),
      pad.top, layout.height - pad.bottom,
    ),
    [layout.height, pad],
  );
  const dvDashP1 = useDerivedValue(
    () => vec(pad.left, dvDashY.value),
    [pad.left],
  );
  const dvDashP2 = useDerivedValue(
    () => vec(layout.width - pad.right, dvDashY.value),
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

  // Crosshair
  const dvHoverX = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01) return -100;
    return clampW(svScrubX.value, pad.left, dvLiveX.value);
  }, [pad.left, scrub]);
  const dvHoverY = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01 || chartW <= 0) return -100;
    const rightEdge = svTipT.value + win * buf;
    const leftEdge = rightEdge - win;
    const ht =
      leftEdge +
      ((dvHoverX.value - pad.left) / Math.max(1, chartW)) * (rightEdge - leftEdge);
    const hv = interpAtTime(vis, ht, svTipT.value, svTipV.value);
    return toScreenY(hv, svMin.value, svMax.value, layout.height, pad);
  }, [chartW, win, layout.height, pad, scrub, vis, buf]);

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
    () => vec(dvHoverX.value, pad.top), [pad.top],
  );
  const dvCrossP2 = useDerivedValue(
    () => vec(dvHoverX.value, layout.height - pad.bottom),
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
    const cycle = (clock.value % 1400) / 1400;
    const i = 0;
    const start = i * 0.2;
    const dur = 0.35;
    const localT = cycle - start;
    const wave =
      localT >= 0 && localT < dur ? Math.sin((localT / dur) * Math.PI) : 0;
    const pulse = 0.3 + 0.7 * wave;
    return opacity * pulse;
  }, [momProp, mom, clock]);

  const dvChev1Op = useDerivedValue(() => {
    if (!momProp || mom === 'flat') return 0;
    const opacity = mom === 'up' ? svArrowUp.value : svArrowDown.value;
    if (opacity < 0.01) return 0;
    const cycle = (clock.value % 1400) / 1400;
    const i = 1;
    const start = i * 0.2;
    const dur = 0.35;
    const localT = cycle - start;
    const wave =
      localT >= 0 && localT < dur ? Math.sin((localT / dur) * Math.PI) : 0;
    const pulse = 0.3 + 0.7 * wave;
    return opacity * pulse;
  }, [momProp, mom, clock]);

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
    // Reveal-gated: badge appears after REVEAL_BADGE_START
    const rev = svReveal.value;
    const revealOp = rev < REVEAL_BADGE_START ? 0 : Math.min(1, (rev - REVEAL_BADGE_START) / (1 - REVEAL_BADGE_START));
    const baseOp = badge ? (1 - svScrubOp.value) * revealOp : 0;
    return {
      opacity: baseOp,
      width: totalW,
      transform: [
        { translateX: dvLiveX.value - totalW / 2 - BADGE_TAIL_LEN },
        // Use lerped badge Y for smooth vertical tracking
        { translateY: svBadgeY.value - pillH - 12 },
      ],
    };
  });

  const asBadgeTextWrap = useAnimatedStyle(() => ({
    width: Math.max(8, svBadgePillW.value - BADGE_TAIL_LEN),
  }));

  const [scrubTip, setScrubTip] = useState<{
    hx: number;
    hv: number;
    ht: number;
    op: number;
  } | null>(null);

  const applyScrubTip = useCallback((hx: number, hv: number, ht: number, op: number) => {
    if (op <= 0.01) {
      setScrubTip(null);
      return;
    }
    setScrubTip({ hx, hv, ht, op });
  }, []);

  // Gesture — hover X clamps to live tip; tooltip opacity uses distance fade like upstream.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(scrub)
        .minDistance(0)
        .onBegin((e) => {
          svScrubX.value = e.x;
          svScrubOp.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
        })
        .onUpdate((e) => {
          'worklet';
          svScrubX.value = e.x;

          const w = layout.width;
          const chartWi = Math.max(1, w - pad.left - pad.right);
          const rightEdge = svTipT.value + win * buf;
          const leftEdge = rightEdge - win;
          const liveX =
            pad.left +
            ((svTipT.value - leftEdge) / (rightEdge - leftEdge || 1)) * chartWi;
          const hx = clampW(e.x, pad.left, liveX);
          const ht =
            leftEdge + ((hx - pad.left) / chartWi) * (rightEdge - leftEdge);
          const hv = interpAtTime(vis, ht, svTipT.value, svTipV.value);

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
          if (op > 0.01 && dtUi < 22 && hxD < 1.5 && opD < 0.035) {
            // skip React state update; scrub geometry already updated above
          } else {
            svScrubJsLastTs.value = ts;
            svScrubJsLastHx.value = hx;
            svScrubJsLastOp.value = op;
            runOnJS(applyScrubTip)(hx, hv, ht, op);
          }
        })
        .onFinalize(() => {
          svScrubOp.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) });
          svScrubJsLastTs.value = 0;
          runOnJS(applyScrubTip)(0, 0, 0, 0);
        }),
    [
      applyScrubTip,
      buf,
      layout.width,
      pad.left,
      pad.right,
      scrub,
      svScrubJsLastHx,
      svScrubJsLastOp,
      svScrubJsLastTs,
      svScrubOp,
      svScrubX,
      svTipT,
      svTipV,
      vis,
      win,
    ],
  );

  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || layout.width < 300 || scrubTip.op < 0.1) return null;
    const v = formatValue(scrubTip.hv);
    const t = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const totalW = (v.length + sep.length + t.length) * charW;
    const liveX = toScreenXJs(now, now, win, layout.width, pad, buf);
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v, t, sep };
  }, [scrubTip, layout.width, formatValue, formatTime, now, win, pad, buf]);

  const rmParticle = useCallback(
    (id: number) => setParticles((c) => c.filter((p) => p.id !== id)),
    [],
  );

  /* ---- computed ---- */
  const baseY = layout.height - pad.bottom;

  const onBadgeTemplateLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      svBadgeTargetTextW.value = e.nativeEvent.layout.width;
    },
    [svBadgeTargetTextW],
  );

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
              <View style={styles.emptyWrap}>
                {layout.width > 0 ? (
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
                  </Canvas>
                ) : null}
                {!loading ? (
                  <Text style={[styles.emptyTxt, { color: pal.gridLabel, opacity: 0.35 }]}>
                    {emptyText}
                  </Text>
                ) : null}
              </View>
            ) : (
              /* =================== CHART =================== */
              <>
                <Animated.View style={[StyleSheet.absoluteFill, asShake]}>
                <Canvas style={StyleSheet.absoluteFill}>

                  {/* -- Grid lines (dashed [1,3], upstream style) — reveal-gated with fine label fading -- */}
                  {grid ? (
                    <Group opacity={dvRevealGridOp}>
                      {gridRes.ticks.map((tk) => (
                        <Group key={`g${tk.value}`} opacity={tk.fineOp}>
                          <SkiaLine
                            p1={vec(pad.left, tk.y)}
                            p2={vec(layout.width - pad.right, tk.y)}
                            color={pal.gridLine}
                            strokeWidth={1}
                          >
                            <DashPathEffect intervals={[1, 3]} />
                          </SkiaLine>
                        </Group>
                      ))}
                    </Group>
                  ) : null}

                  {/* -- Axis baseline — reveal-gated -- */}
                  <Group opacity={dvRevealGridOp}>
                    <SkiaLine
                      p1={vec(pad.left, baseY)}
                      p2={vec(layout.width - pad.right, baseY)}
                      color={pal.axisLine}
                      strokeWidth={1}
                    />

                    {/* -- Time tick marks -- */}
                    {tTicks.map((tk) => (
                      <SkiaLine
                        key={`t${tk.time}`}
                        p1={vec(tk.x, baseY)}
                        p2={vec(tk.x, baseY + 5)}
                        color={pal.gridLine}
                        strokeWidth={1}
                      />
                    ))}
                  </Group>

                  {/* -- Fill gradient (scrub splits like upstream drawLine) — reveal-gated -- */}
                  {fill && clipRect ? (
                    <Group clip={clipRect} opacity={dvRevealLineOp}>
                      <Group clip={dvClipL}>
                        <Path path={dvFillPath}>
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(0, layout.height - pad.bottom)}
                            colors={[pal.accentFillTop, pal.accentFillBottom]}
                          />
                        </Path>
                      </Group>
                      <Group clip={dvClipR} opacity={dvRightSegOp}>
                        <Path path={dvFillPath}>
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(0, layout.height - pad.bottom)}
                            colors={[pal.accentFillTop, pal.accentFillBottom]}
                          />
                        </Path>
                      </Group>
                    </Group>
                  ) : null}

                  {/* -- Main line — reveal-gated -- */}
                  {clipRect ? (
                    <Group clip={clipRect} opacity={dvRevealLineOp}>
                      <Group clip={dvClipL}>
                        <Path
                          path={dvLinePath}
                          style="stroke"
                          strokeWidth={pal.lineWidth}
                          strokeJoin="round"
                          strokeCap="round"
                          color={pal.accent}
                        />
                      </Group>
                      <Group clip={dvClipR} opacity={dvRightSegOp}>
                        <Path
                          path={dvLinePath}
                          style="stroke"
                          strokeWidth={pal.lineWidth}
                          strokeJoin="round"
                          strokeCap="round"
                          color={pal.accent}
                        />
                      </Group>
                    </Group>
                  ) : null}

                  {/* -- Dashed price line [4,4] -- */}
                  <Group opacity={dvDashLineOp}>
                    <SkiaLine
                      p1={dvDashP1}
                      p2={dvDashP2}
                      color={pal.dashLine}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[4, 4]} />
                    </SkiaLine>
                  </Group>

                  {/* -- Particles (only after reveal > 90%) -- */}
                  {degen ? particles.map((pp) => (
                    <Particle key={pp.id} p={pp} onDone={rmParticle} />
                  )) : null}

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

                  {/* -- Outer dot (bg color + shadow) — reveal-gated -- */}
                  <Group opacity={dvRevealDotOp}>
                    <Circle cx={dvLiveX} cy={dvLiveY} r={6.5} color={pal.badgeOuterBg}>
                      <Shadow dx={0} dy={1} blur={6} color={pal.badgeOuterShadow} />
                    </Circle>

                    {/* -- Inner dot (accent; matches upstream drawDot fill) -- */}
                    <Circle cx={dvLiveX} cy={dvLiveY} r={3.5} color={pal.accent} />
                  </Group>

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

                  {/* -- Crosshair (drawn after fade, like upstream) -- */}
                  <SkiaLine
                    p1={dvCrossP1}
                    p2={dvCrossP2}
                    color={pal.crosshair}
                    strokeWidth={1}
                    opacity={dvCrossLineOp}
                  />

                  <Circle
                    cx={dvHoverX}
                    cy={dvHoverY}
                    r={dvCrossDotR}
                    color={pal.accent}
                    opacity={dvCrossDotOp}
                  />
                </Canvas>
                </Animated.View>

                {/* -- Scrub tooltip (matches upstream drawCrosshair top label) -- */}
                {scrub && scrubTipLayout ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.scrubTipWrap,
                      {
                        left: scrubTipLayout.left,
                        top: pad.top + tooltipY + 10,
                        opacity: scrubTip?.op ?? 0,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.scrubTipText,
                        tooltipOutline && {
                          textShadowColor: pal.tooltipBg,
                          textShadowOffset: { width: 0, height: 0 },
                          textShadowRadius: 3,
                        },
                      ]}
                    >
                      <Text style={{ color: pal.tooltipText }}>{scrubTipLayout.v}</Text>
                      <Text style={{ color: pal.gridLabel }}>
                        {`${scrubTipLayout.sep}${scrubTipLayout.t}`}
                      </Text>
                    </Text>
                  </View>
                ) : null}

                {/* -- Y-axis labels (right, monospace, upstream font) — fine labels with fading -- */}
                {grid ? gridRes.ticks.filter((tk) => tk.fineOp > 0.02).map((tk) => (
                  <Text
                    key={`yl${tk.value}`}
                    style={[
                      styles.yLabel,
                      {
                        left: layout.width - pad.right + 8,
                        top: tk.y - 6,
                        color: pal.gridLabel,
                        opacity: tk.fineOp,
                        fontWeight: tk.isCoarse ? ('500' as const) : ('400' as const),
                      },
                    ]}
                  >
                    {tk.text}
                  </Text>
                )) : null}

                {/* -- Time labels -- */}
                {tTicks.map((tk) => (
                  <Text
                    key={`tl${tk.time}`}
                    style={[
                      styles.tLabel,
                      {
                        left: clamp(tk.x - 24, pad.left, layout.width - pad.right - 48),
                        top: baseY + 14,
                        width: 48,
                        color: pal.timeLabel,
                      },
                    ]}
                  >
                    {tk.text}
                  </Text>
                ))}

                {/* -- Badge width template (upstream: digits -> '8' for stable measure) -- */}
                {badge && !empty ? (
                  <Text
                    pointerEvents="none"
                    onLayout={onBadgeTemplateLayout}
                    style={[styles.badgeTxt, styles.badgeMeasureGhost]}
                  >
                    {badgeStr.replace(/[0-9]/g, '8')}
                  </Text>
                ) : null}

                {/* -- Badge with curved SVG tail + lerped width + momentum color + smooth value -- */}
                {badge ? (
                  <Animated.View pointerEvents="none" style={[styles.badgeWrap, asBadge]}>
                    <Canvas style={StyleSheet.absoluteFill}>
                      <Path path={dvBadgeBgPath} color={pal.badgeOuterBg}>
                        <Shadow dx={0} dy={2} blur={8} color={pal.badgeOuterShadow} />
                      </Path>
                      <Group transform={[{ translateX: 2 }, { translateY: 2 }]}>
                        {/* Inner badge uses momentum-blended color */}
                        <Path path={dvBadgeInnerPath} color={dvBadgeInnerColor} />
                      </Group>
                    </Canvas>
                    <Animated.View
                      style={[
                        styles.badgeTxtWrap,
                        { height: pillH, left: BADGE_TAIL_LEN + 2 },
                        asBadgeTextWrap,
                      ]}
                    >
                      <Text style={[styles.badgeTxt, { color: pal.badgeText }]} numberOfLines={1}>
                        {badgeStr}
                      </Text>
                    </Animated.View>
                  </Animated.View>
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
  scrubTipWrap: { position: 'absolute' },
  scrubTipText: {
    fontFamily: mono,
    fontSize: 13,
    fontWeight: '400',
  },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { fontSize: 12, fontWeight: '400' },
  badgeWrap: { position: 'absolute', overflow: 'hidden' },
  badgeTxtWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { fontFamily: mono, fontSize: 11, fontWeight: '500' },
  badgeMeasureGhost: {
    position: 'absolute',
    left: -4000,
    top: 0,
    opacity: 0,
  },
  yLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono },
  tLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono, textAlign: 'center' },
});
