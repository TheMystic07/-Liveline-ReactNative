import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { resolvePalette } from './theme';
import { buildPath } from './draw/buildLiveLinePath';
import {
  badgeSvgPath,
  BADGE_PAD_X,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
  BADGE_TAIL_SPREAD,
  BADGE_LINE_H,
} from './draw/badge';
import {
  LIVELINE_CANDLE_BULL,
  LIVELINE_CANDLE_BEAR,
  collapseCandleOHLC,
  inferCandleWidthSecs,
  layoutLivelineCandles,
} from './draw/livelineCandlestick';
import { BADGE_NUMBER_FLOW_FONT_SRC } from './BadgeSkiaNumberFlow';
import { formatPriceCentsWorklet, supportsTwoDecimalNumberFlow } from './chartNumberFlow';
import { computeRange } from './math/range';
import type {
  CandlePoint,
  ChartPadding,
  LiveLinePoint,
} from './types';
import type { StaticChartProps } from './staticTypes';
import {
  calcGridTicksJs,
  calcTimeTicksJs,
  defaultFormatTime,
  defaultFormatValue,
  toScreenXJs,
  toScreenYJs,
} from './nativeChartUtils';

import { useStaticDrawAnimation } from './hooks/useStaticDrawAnimation';
import { useStaticScrub } from './hooks/useStaticScrub';

import { AxisLabels } from './render/AxisLabels';
import { BadgeOverlay } from './render/BadgeOverlay';
import { CandleScrubOHLCTooltip } from './render/CandleScrubOHLCTooltip';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { GridCanvas } from './render/GridCanvas';
import { LinePathLayer } from './render/LinePathLayer';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { ScrubTooltip } from './render/ScrubTooltip';
import { useTrackedGridLabels, useTrackedTimeLabels } from './render/useTrackedAxisLabels';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_HEIGHT = 300;
const FADE_EDGE_WIDTH = 40;
const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
/** Duration of the candle ↔ line morph animation. */
const LINE_MORPH_MS = 500;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const PRICE_DASH_INTERVALS: readonly [number, number] = [4, 4];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function windowBuffer(showBadge: boolean) {
  return showBadge ? WINDOW_BUFFER_BADGE : WINDOW_BUFFER_NO_BADGE;
}

function windowEdges(now: number, win: number, buffer: number) {
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return { leftEdge, rightEdge };
}

/** Compute Y range from candle high/low spread. */
function computeCandleRange(
  candles: readonly CandlePoint[],
  referenceValue?: number,
  exaggerate = false,
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (referenceValue !== undefined) {
    if (referenceValue < lo) lo = referenceValue;
    if (referenceValue > hi) hi = referenceValue;
  }
  if (!isFinite(lo) || !isFinite(hi)) return { min: 0, max: 1 };
  const rawRange = hi - lo;
  const marginFactor = exaggerate ? 0.01 : 0.12;
  const minRange = rawRange * (exaggerate ? 0.02 : 0.1) || (exaggerate ? 0.04 : 0.4);
  if (rawRange < minRange) {
    const mid = (lo + hi) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  const margin = rawRange * marginFactor;
  return { min: lo - margin, max: hi + margin };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NativeStaticCandlestickChart({
  candles: candlesProp = [],
  data: dataProp = [],
  theme = 'dark',
  color = '#3b82f6',
  lineWidth: lineWidthProp,
  window: controlledWin = 30,
  windows,
  onWindowChange,
  windowStyle: windowStyleProp = 'default',
  grid = true,
  badge = true,
  badgeVariant = 'default',
  referenceLine,
  lineTrailGlow = true,
  gradientLineColoring = false,
  exaggerate = false,
  tooltipY = 14,
  tooltipOutline = true,
  height = DEFAULT_HEIGHT,
  loading = false,
  emptyText = 'No data',
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  scrub = true,
  scrubNumberFlow = true,
  snapToPointScrubbing = false,
  scrubHaptics: scrubHapticsProp = true,
  drawDuration = 1200,
  drawEasing = 'ease-out',
  onDrawComplete,
  onHover,
  lineMode = false,
  candleWidth: candleWidthProp,
  style,
  contentInset,
}: StaticChartProps) {
  const buf = windowBuffer(badge);
  const win = controlledWin;
  const empty = candlesProp.length === 0;

  /* ---- Palette ---- */
  const pal = useMemo(
    () => resolvePalette(color, theme, lineWidthProp),
    [color, theme, lineWidthProp],
  );

  /* ---- Layout ---- */
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const pad: ChartPadding = useMemo(
    () => ({
      top: contentInset?.top ?? 12,
      right: contentInset?.right ?? 56,
      bottom: contentInset?.bottom ?? 28,
      left: contentInset?.left ?? 0,
    }),
    [contentInset],
  );
  const chartW = Math.max(0, layout.width - pad.left - pad.right);
  const chartH = Math.max(0, layout.height - pad.top - pad.bottom);

  /* ---- Data prep ---- */
  const lastCandle = useMemo(
    () => (candlesProp.length > 0 ? candlesProp[candlesProp.length - 1]! : null),
    [candlesProp],
  );
  const tipT = lastCandle?.time ?? 0;
  const tipV = lastCandle?.close ?? 0;

  const candleWidthSecs = useMemo(
    () => inferCandleWidthSecs(candlesProp, win),
    [candlesProp, win],
  );

  const { leftEdge, rightEdge } = useMemo(
    () => windowEdges(tipT, win, buf),
    [tipT, win, buf],
  );

  const visibleCandles = useMemo(
    () => candlesProp.filter((c) => c.time >= leftEdge - 2 && c.time <= rightEdge + 1),
    [candlesProp, leftEdge, rightEdge],
  );

  const rng = useMemo(
    () => computeCandleRange(visibleCandles, referenceLine?.value, exaggerate),
    [visibleCandles, referenceLine?.value, exaggerate],
  );

  /* ---- Line morph animation ---- */
  const svLineModeProg = useSharedValue(0);
  const [lineMorphJs, setLineMorphJs] = useState(0);

  useEffect(() => {
    cancelAnimation(svLineModeProg);
    svLineModeProg.value = withTiming(lineMode ? 1 : 0, {
      duration: LINE_MORPH_MS,
      easing: Easing.inOut(Easing.quad),
    });
  }, [lineMode, svLineModeProg]);

  // Sync morph progress to JS for candle layout morphing
  const dvLineMorphRounded = useDerivedValue(
    () => Math.round(svLineModeProg.value * 50) / 50,
  );

  useEffect(() => {
    // This is driven by the derived value via a polling approach;
    // for simplicity in the static chart, we track via the lineMode prop
    setLineMorphJs(lineMode ? 1 : 0);
  }, [lineMode]);

  /* ---- Morphed candle layouts ---- */
  const candleVisibleMorphed = useMemo(() => {
    if (visibleCandles.length === 0) return [];
    const lp = lineMorphJs;
    if (lp < 0.01) return visibleCandles;
    const inv = 1 - lp;
    return visibleCandles.map((c) => collapseCandleOHLC(c, inv));
  }, [visibleCandles, lineMorphJs]);

  const candleLayouts = useMemo(() => {
    if (chartW <= 0 || candleVisibleMorphed.length === 0) return [];
    const maxBodyPx = candleWidthProp != null && candleWidthProp >= 12 ? candleWidthProp : undefined;
    return layoutLivelineCandles(
      candleVisibleMorphed,
      -1, // no live candle in static mode
      leftEdge,
      rightEdge,
      layout.width,
      layout.height,
      pad,
      rng.min,
      rng.max,
      candleWidthSecs,
      maxBodyPx,
    );
  }, [
    candleVisibleMorphed,
    leftEdge,
    rightEdge,
    layout.width,
    layout.height,
    pad,
    rng.min,
    rng.max,
    candleWidthSecs,
    candleWidthProp,
    chartW,
  ]);

  /* ---- Morph line path (from candle close values) ---- */
  const morphLineData: LiveLinePoint[] = useMemo(
    () => candlesProp.map((c) => ({ time: c.time + candleWidthSecs / 2, value: c.close })),
    [candlesProp, candleWidthSecs],
  );

  const morphLinePath = useMemo(
    () =>
      layout.width > 0 && !empty
        ? buildPath(morphLineData, tipT, tipV, rng.min, rng.max, layout.width, layout.height, pad, win, buf, false)
        : '',
    [morphLineData, tipT, tipV, rng.min, rng.max, layout.width, layout.height, pad, win, buf, empty],
  );

  /* ---- Candle morph opacity derived values ---- */
  const dvCandleMorphOp = useDerivedValue(
    () => 1 - svLineModeProg.value,
  );
  const dvMorphLineOverlayOp = useDerivedValue(
    () => svLineModeProg.value,
  );

  /* ---- Grid / Axis labels ---- */
  const gridTicks = useMemo(
    () =>
      grid && layout.width > 0 && !empty
        ? calcGridTicksJs(rng.min, rng.max, chartH, layout.height, pad, formatValue)
        : [],
    [grid, rng.min, rng.max, chartH, layout.height, pad, formatValue, empty],
  );
  const trackedGridLabels = useTrackedGridLabels(gridTicks);

  const timeTicks = useMemo(
    () =>
      layout.width > 0 && !empty
        ? calcTimeTicksJs(leftEdge, rightEdge, layout.width, pad, formatTime)
        : [],
    [leftEdge, rightEdge, layout.width, pad, formatTime, empty],
  );
  const trackedTimeLabels = useTrackedTimeLabels(timeTicks);

  /* ---- Draw animation ---- */
  const {
    svDrawProgress,
    drawComplete,
    dvClipRect,
    dvDrawDotX,
    dvGridOp,
    dvBadgeOp,
    dvDrawDotOp,
    dvEndDotOp,
  } = useStaticDrawAnimation({
    ready: !empty && layout.width > 0,
    chartWidth: chartW,
    chartHeight: layout.height,
    padLeft: pad.left,
    duration: drawDuration,
    easing: drawEasing,
    onComplete: onDrawComplete,
  });

  /* ---- Scrub ---- */
  const {
    gesture: scrubGesture,
    svScrubX,
    svScrubOp,
    svScrubHv,
    scrubTip,
  } = useStaticScrub({
    enabled: scrub,
    drawComplete,
    chartWidth: layout.width,
    chartHeight: layout.height,
    pad,
    win,
    buf,
    tipT,
    tipV,
    data: morphLineData,
    candles: candlesProp,
    candleWidthSecs,
    snapToPoint: snapToPointScrubbing,
    haptics: scrubHapticsProp,
    isCandle: true,
  });

  /* ---- Derived values for Skia rendering ---- */
  const clipRect = useMemo(
    () =>
      chartW > 0 && chartH > 0
        ? rect(pad.left - 1, pad.top, chartW + 2, chartH)
        : undefined,
    [chartW, chartH, pad.left, pad.top],
  );

  // Identity transforms for morph line (no smoothing engine)
  const svIdentityTranslateX = useSharedValue(0);
  const svIdentityScaleY = useSharedValue(1);
  const svIdentityTranslateY = useSharedValue(0);

  // Last candle positions
  const lastCandleX = useMemo(
    () =>
      layout.width > 0 && lastCandle
        ? toScreenXJs(tipT + candleWidthSecs / 2, leftEdge, rightEdge, layout.width, pad)
        : 0,
    [tipT, candleWidthSecs, leftEdge, rightEdge, layout.width, pad, lastCandle],
  );
  const lastCandleCloseY = useMemo(
    () =>
      layout.height > 0 && lastCandle
        ? toScreenYJs(tipV, rng.min, rng.max, layout.height, pad)
        : 0,
    [tipV, rng.min, rng.max, layout.height, pad, lastCandle],
  );

  // Drawing dot Y: follows the close value of the nearest visible candle at clip edge
  const dvDrawDotY = useDerivedValue(() => {
    if (!lastCandle || layout.width <= 0 || candlesProp.length === 0) return 0;
    const dotX = dvDrawDotX.value;
    // Convert dotX back to time
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const re = tipT + win * buf;
    const le = re - win;
    const t = le + ((dotX - pad.left) / cw) * (re - le);
    // Find nearest candle at time t
    let bestClose = tipV;
    let bestDist = Infinity;
    for (const c of candlesProp) {
      const ct = c.time + candleWidthSecs / 2;
      const d = Math.abs(ct - t);
      if (d < bestDist) {
        bestDist = d;
        bestClose = c.close;
      }
    }
    const span = Math.max(0.0001, rng.max - rng.min);
    const ch = Math.max(1, layout.height - pad.top - pad.bottom);
    return pad.top + (1 - (bestClose - rng.min) / span) * ch;
  }, [lastCandle, layout.width, layout.height, pad, win, buf, tipT, tipV, candlesProp, candleWidthSecs, rng]);

  // Badge color: bull/bear based on last candle
  const candleBadgeColor = lastCandle && lastCandle.close >= lastCandle.open
    ? LIVELINE_CANDLE_BULL
    : LIVELINE_CANDLE_BEAR;
  const candleBadgeDashColor = lastCandle && lastCandle.close >= lastCandle.open
    ? `${LIVELINE_CANDLE_BULL}44`
    : `${LIVELINE_CANDLE_BEAR}44`;

  // Reference line Y
  const dvReferenceY = useDerivedValue(
    () =>
      referenceLine
        ? toScreenYJs(referenceLine.value, rng.min, rng.max, layout.height, pad)
        : 0,
    [referenceLine, rng.min, rng.max, layout.height, pad],
  );

  // Crosshair derived values
  const dvHoverX = useDerivedValue(() => svScrubX.value);
  const dvHoverY = useDerivedValue(() => {
    if (!scrubTip) return 0;
    return toScreenYJs(svScrubHv.value, rng.min, rng.max, layout.height, pad);
  }, [rng.min, rng.max, layout.height, pad, scrubTip]);
  const dvCrossP1 = useDerivedValue(() => vec(svScrubX.value, pad.top), [pad.top]);
  const dvCrossP2 = useDerivedValue(
    () => vec(svScrubX.value, layout.height - pad.bottom),
    [layout.height, pad.bottom],
  );
  const dvCrossLineOp = useDerivedValue(() => svScrubOp.value * 0.3);
  const dvCrossDotR = useDerivedValue(() => (svScrubOp.value > 0.01 ? 4.5 : 0));
  const dvCrossDotOp = useDerivedValue(() => svScrubOp.value);

  // Dashed price line
  const dvDashY = useDerivedValue(
    () => toScreenYJs(tipV, rng.min, rng.max, layout.height, pad),
    [tipV, rng.min, rng.max, layout.height, pad],
  );
  const dvDashP1 = useDerivedValue(() => vec(pad.left, dvDashY.value), [pad.left]);
  const dvDashP2 = useDerivedValue(
    () => vec(layout.width - pad.right, dvDashY.value),
    [layout.width, pad.right],
  );

  /* ---- Badge ---- */
  const badgeStr = useMemo(() => formatValue(tipV), [formatValue, tipV]);
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;

  const skiaDefaultNumberFormat = useMemo(
    () => supportsTwoDecimalNumberFlow(formatValue),
    [formatValue],
  );
  const badgeNumFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 11);
  const skiaBadgeFlow = badge && skiaDefaultNumberFormat && badgeNumFont != null;

  const svBadgeValue = useSharedValue(tipV);
  useMemo(() => {
    svBadgeValue.value = tipV;
  }, [tipV, svBadgeValue]);

  const [flowPillW, setFlowPillW] = useState(80);
  const onBadgeTemplateLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      const w = e.nativeEvent.layout.width;
      setFlowPillW((prev) => (prev === Math.round(w) ? prev : Math.round(w)));
    },
    [],
  );

  const badgePillW = useMemo(
    () => Math.max(8, flowPillW) + BADGE_PAD_X * 2,
    [flowPillW],
  );
  const badgeBgPath = useMemo(
    () => badgeSvgPath(badgePillW, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD),
    [badgePillW, pillH],
  );
  const badgeInnerPath = useMemo(
    () => badgeSvgPath(badgePillW - 4, pillH - 4, BADGE_TAIL_LEN - 1, BADGE_TAIL_SPREAD - 0.5),
    [badgePillW, pillH],
  );
  const badgeX = useMemo(
    () => layout.width - pad.right + 4,
    [layout.width, pad.right],
  );
  const asBadge = useMemo(
    () => ({
      left: badgeX,
      top: lastCandleCloseY - pillH / 2,
      width: BADGE_TAIL_LEN + badgePillW,
      height: pillH,
    }),
    [badgeX, lastCandleCloseY, badgePillW, pillH],
  );
  const asBadgeTextWrap = useMemo(() => ({ opacity: 1 }), []);

  /* ---- Candle scrub tooltip ---- */
  const candleScrubLayout = useMemo(() => {
    if (!scrubTip || !scrubTip.candle) return null;
    return { left: scrubTip.hx, candle: scrubTip.candle };
  }, [scrubTip]);

  /* ---- Scrub tip for line-morph mode (fallback) ---- */
  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || scrubTip.candle || layout.width < 300) return null;
    const v = formatValue(scrubTip.hv);
    const t = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const totalW = v.length * charW + sep.length * charW + t.length * charW;
    const liveX = lastCandleX;
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v, t, sep };
  }, [scrubTip, layout.width, formatValue, formatTime, lastCandleX, pad]);

  const dvScrubValueStr = useDerivedValue(() => {
    'worklet';
    return formatPriceCentsWorklet(svScrubHv.value);
  });

  const baseY = layout.height - pad.bottom;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  const gesture = useMemo(
    () => Gesture.Simultaneous(scrubGesture),
    [scrubGesture],
  );

  return (
    <View style={[styles.root, { height }, style]}>
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
                loadPath=""
                loadAlpha={0}
                loading={loading}
                emptyText={emptyText}
                pal={pal}
              />
            ) : (
              /* =================== CHART =================== */
              <>
                <Canvas style={StyleSheet.absoluteFill}>
                  {/* Grid */}
                  <GridCanvas
                    grid={grid}
                    gridLabels={trackedGridLabels}
                    timeLabels={trackedTimeLabels}
                    pad={pad}
                    layoutWidth={layout.width}
                    baseY={baseY}
                    opacity={dvGridOp}
                    pal={pal}
                  />

                  {/* ========== CANDLE BODIES (clipped by draw animation) ========== */}
                  <Group clip={dvClipRect}>
                    <Group opacity={dvCandleMorphOp}>
                      {candleLayouts.map((row) => (
                        <Group key={row.c.time}>
                          {/* Upper wick */}
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
                          {/* Lower wick */}
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
                          {/* Candle body */}
                          <RoundedRect
                            x={row.cx - row.halfBody}
                            y={row.bodyTop}
                            width={row.bodyW}
                            height={row.bodyH}
                            r={row.radius}
                            color={row.fill}
                          />
                        </Group>
                      ))}
                    </Group>

                    {/* ========== MORPH LINE OVERLAY ========== */}
                    {clipRect ? (
                      <Group opacity={dvMorphLineOverlayOp}>
                        <LinePathLayer
                          clipRect={clipRect}
                          leftClip={clipRect}
                          rightClip={clipRect}
                          rightOpacity={1}
                          revealOpacity={1}
                          path={morphLinePath}
                          layoutHeight={layout.height}
                          padTop={pad.top}
                          padRight={pad.right}
                          layoutWidth={layout.width}
                          lineWidth={pal.lineWidth}
                          lineColor={pal.accent}
                          trailGlow={lineTrailGlow}
                          trailGlowColor={pal.accentGlow}
                          gradientLineColoring={gradientLineColoring}
                          gradientStartColor={pal.gridLabel}
                          gradientEndColor={pal.accent}
                          rangeTranslateX={svIdentityTranslateX}
                          rangeScaleY={svIdentityScaleY}
                          rangeTranslateY={svIdentityTranslateY}
                        />
                      </Group>
                    ) : null}
                  </Group>

                  {/* Reference line */}
                  {referenceLine ? (
                    <ReferenceLineCanvas
                      label={referenceLine.label}
                      y={dvReferenceY}
                      opacity={dvGridOp}
                      padLeft={pad.left}
                      padRight={pad.right}
                      layoutWidth={layout.width}
                      lineColor={pal.refLine}
                    />
                  ) : null}

                  {/* Dashed price line */}
                  <Group opacity={dvBadgeOp}>
                    <SkiaLine
                      p1={dvDashP1}
                      p2={dvDashP2}
                      color={candleBadgeDashColor}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={PRICE_DASH_INTERVALS} />
                    </SkiaLine>
                  </Group>

                  {/* Drawing dot (traces close values during draw) */}
                  <Group opacity={dvDrawDotOp}>
                    <Circle
                      cx={dvDrawDotX}
                      cy={dvDrawDotY}
                      r={10}
                      color={pal.accentGlow}
                      opacity={0.5}
                    />
                    <Circle
                      cx={dvDrawDotX}
                      cy={dvDrawDotY}
                      r={4}
                      color={pal.accent}
                    />
                  </Group>

                  {/* Static end dot at last candle close */}
                  <Group opacity={dvEndDotOp}>
                    <Circle
                      cx={lastCandleX}
                      cy={lastCandleCloseY}
                      r={4}
                      color={candleBadgeColor}
                    />
                  </Group>

                  {/* Left-edge fade */}
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

                  {/* Crosshair */}
                  <CrosshairCanvas
                    lineP1={dvCrossP1}
                    lineP2={dvCrossP2}
                    lineOpacity={dvCrossLineOp}
                    dotX={dvHoverX}
                    dotY={dvHoverY}
                    dotRadius={dvCrossDotR}
                    dotOpacity={dvCrossDotOp}
                    lineColor={pal.crosshair}
                    dotColor={candleBadgeColor}
                  />
                </Canvas>

                {/* Candle OHLC scrub tooltip */}
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
                ) : scrub && scrubTipLayout ? (
                  <ScrubTooltip
                    layout={scrubTipLayout}
                    top={pad.top + tooltipY + 10}
                    opacity={svScrubOp}
                    tooltipOutline={tooltipOutline}
                    skiaScrubFlow={false}
                    scrubTipFont={null as any}
                    scrubValue={dvScrubValueStr}
                    pal={pal}
                    textStyle={styles.scrubTipText}
                  />
                ) : null}

                {/* Axis labels */}
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

                {/* Reference line label */}
                {referenceLine?.label ? (
                  <ReferenceLineLabel
                    label={referenceLine.label}
                    y={dvReferenceY}
                    opacity={dvGridOp}
                    padLeft={pad.left}
                    padRight={pad.right}
                    layoutWidth={layout.width}
                    color={pal.refLabel}
                    textStyle={styles.referenceLabel}
                  />
                ) : null}

                {/* Badge */}
                <BadgeOverlay
                  badge={badge}
                  empty={empty}
                  variant={badgeVariant}
                  skiaBadgeFlow={skiaBadgeFlow}
                  badgeNumFont={badgeNumFont}
                  badgeValue={svBadgeValue}
                  flowPillW={flowPillW}
                  badgeStr={badgeStr}
                  badgeStyle={asBadge}
                  badgeTextWrapStyle={asBadgeTextWrap}
                  backgroundPath={badgeBgPath}
                  innerPath={badgeInnerPath}
                  innerColor={candleBadgeColor}
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

const styles = StyleSheet.create({
  root: { gap: 6 },
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
