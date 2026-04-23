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
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BADGE_NUMBER_FLOW_FONT_SRC } from './BadgeSkiaNumberFlow';
import { formatPriceCentsWorklet, supportsTwoDecimalNumberFlow } from './chartNumberFlow';
import { ChartControlRow, type ChartControlOption } from './ChartControlRow';
import {
  BADGE_LINE_H,
  BADGE_PAD_X,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
  BADGE_TAIL_SPREAD,
  badgeSvgPath,
} from './draw/badge';
import { buildPath } from './draw/buildLiveLinePath';
import {
  LIVELINE_CANDLE_BEAR,
  LIVELINE_CANDLE_BULL,
  collapseCandleOHLC,
  inferCandleWidthSecs,
  layoutLivelineCandles,
} from './draw/livelineCandlestick';
import { useStaticDrawAnimation } from './hooks/useStaticDrawAnimation';
import { useStaticScrub } from './hooks/useStaticScrub';
import { useStaticWindowTransition } from './hooks/useStaticWindowTransition';
import {
  calcGridTicksJs,
  calcTimeTicksJs,
  clamp,
  defaultFormatTime,
  defaultFormatValue,
  toScreenXJs,
  toScreenYJs,
} from './nativeChartUtils';
import { resolvePalette } from './theme';
import type { CandlePoint, ChartPadding, LiveLinePoint, LiveLineWindowStyle } from './types';
import type { StaticChartProps } from './staticTypes';
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

const DEFAULT_HEIGHT = 300;
const FADE_EDGE_WIDTH = 40;
const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
const LINE_MORPH_MS = 500;
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const PRICE_DASH_INTERVALS = [4, 4];

function windowBuffer(showBadge: boolean) {
  return showBadge ? WINDOW_BUFFER_BADGE : WINDOW_BUFFER_NO_BADGE;
}

function windowEdges(now: number, win: number, buffer: number) {
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return { leftEdge, rightEdge };
}

function computeCandleRange(
  candles: readonly CandlePoint[],
  referenceValue?: number,
  exaggerate = false,
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const candle of candles) {
    if (candle.low < lo) lo = candle.low;
    if (candle.high > hi) hi = candle.high;
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

function buildControlOptions(
  options: StaticChartProps['windows'],
  resolvedWin: number,
  pinchWindow: number | null,
  onWindowChange?: (secs: number) => void,
): ChartControlOption[] {
  return (
    options?.map((entry) => ({
      key: entry.secs,
      label: entry.label,
      active: pinchWindow == null && resolvedWin === entry.secs,
      onPress: () => onWindowChange?.(entry.secs),
    })) ?? []
  );
}

export function NativeStaticCandlestickChart({
  candles: candlesProp = [],
  theme = 'dark',
  chartColors,
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
  pinchToZoom = false,
  scrubHaptics: scrubHapticsProp = true,
  drawDuration = 1200,
  drawEasing = 'ease-out',
  onDrawComplete,
  onHover,
  mode = 'candle',
  lineMode = false,
  candleWidth: candleWidthProp,
  showBuiltInModeToggle = false,
  showBuiltInMorphToggle = false,
  onModeChange,
  onLineModeChange,
  style,
  contentInset,
}: StaticChartProps) {
  const ws: LiveLineWindowStyle = windowStyleProp ?? 'default';
  const resolvedWin = useMemo(() => {
    if (!windows?.length) return controlledWin;
    if (windows.some((entry) => entry.secs === controlledWin)) return controlledWin;
    return windows[0]!.secs;
  }, [controlledWin, windows]);
  const [pinchWindow, setPinchWindow] = useState<number | null>(null);
  const targetWin = pinchWindow ?? resolvedWin;
  const win = useStaticWindowTransition(targetWin);
  const buf = windowBuffer(badge);

  const linePal = useMemo(
    () => resolvePalette(color, theme, lineWidthProp),
    [color, lineWidthProp, theme],
  );
  const pal = useMemo(
    () => resolvePalette(color, theme, lineWidthProp, chartColors),
    [chartColors, color, lineWidthProp, theme],
  );

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

  const lastCandle = useMemo(
    () => (candlesProp.length > 0 ? candlesProp[candlesProp.length - 1]! : null),
    [candlesProp],
  );
  const tipT = lastCandle?.time ?? 0;
  const tipV = lastCandle?.close ?? 0;
  const animationKey = useMemo(
    () =>
      `${candlesProp.length}:${candlesProp[0]?.time ?? 0}:${tipT}:${tipV}`,
    [candlesProp, tipT, tipV],
  );

  const candleWidthSecs = useMemo(() => inferCandleWidthSecs(candlesProp, win), [candlesProp, win]);
  const { leftEdge, rightEdge } = useMemo(() => windowEdges(tipT, win, buf), [buf, tipT, win]);
  const visibleCandles = useMemo(
    () => candlesProp.filter((candle) => candle.time >= leftEdge - 2 && candle.time <= rightEdge + 1),
    [candlesProp, leftEdge, rightEdge],
  );
  const empty = loading || layout.width <= 0 || visibleCandles.length < 2;
  const rng = useMemo(
    () => computeCandleRange(visibleCandles, referenceLine?.value, exaggerate),
    [exaggerate, referenceLine?.value, visibleCandles],
  );

  const svLineModeProg = useSharedValue(0);
  const [lineMorphJs, setLineMorphJs] = useState(0);
  useEffect(() => {
    cancelAnimation(svLineModeProg);
    svLineModeProg.value = withTiming(lineMode ? 1 : 0, {
      duration: LINE_MORPH_MS,
      easing: Easing.inOut(Easing.quad),
    });
  }, [lineMode, svLineModeProg]);
  useAnimatedReaction(
    () => Math.round(svLineModeProg.value * 50) / 50,
    (value, prev) => {
      if (prev !== undefined && value === prev) return;
      runOnJS(setLineMorphJs)(value);
    },
    [svLineModeProg],
  );

  const candleVisibleMorphed = useMemo(() => {
    if (visibleCandles.length === 0) return [];
    if (lineMorphJs < 0.01) return visibleCandles;
    const inv = 1 - lineMorphJs;
    return visibleCandles.map((candle) => collapseCandleOHLC(candle, inv));
  }, [lineMorphJs, visibleCandles]);

  const candleLayouts = useMemo(() => {
    if (chartW <= 0 || candleVisibleMorphed.length === 0) return [];
    const maxBodyPx = candleWidthProp != null && candleWidthProp >= 12 ? candleWidthProp : undefined;
    return layoutLivelineCandles(
      candleVisibleMorphed,
      -1,
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
    candleWidthProp,
    candleWidthSecs,
    chartW,
    layout.height,
    layout.width,
    leftEdge,
    pad,
    rightEdge,
    rng.max,
    rng.min,
  ]);

  const morphLineData: LiveLinePoint[] = useMemo(
    () => candlesProp.map((candle) => ({ time: candle.time + candleWidthSecs / 2, value: candle.close })),
    [candlesProp, candleWidthSecs],
  );
  const morphLinePath = useMemo(
    () =>
      layout.width > 0 && !empty
        ? buildPath(
            morphLineData,
            tipT,
            tipV,
            rng.min,
            rng.max,
            layout.width,
            layout.height,
            pad,
            win,
            buf,
            false,
          )
        : '',
    [buf, empty, layout.height, layout.width, morphLineData, pad, rng.max, rng.min, tipT, tipV, win],
  );
  const dvCandleMorphOp = useDerivedValue(() => 1 - svLineModeProg.value, [svLineModeProg]);
  const dvMorphLineOverlayOp = useDerivedValue(() => svLineModeProg.value, [svLineModeProg]);

  const gridTicks = useMemo(
    () =>
      grid && layout.width > 0 && !empty
        ? calcGridTicksJs(rng.min, rng.max, chartH, layout.height, pad, formatValue)
        : [],
    [chartH, empty, formatValue, grid, layout.height, layout.width, pad, rng.max, rng.min],
  );
  const trackedGridLabels = useTrackedGridLabels(gridTicks);
  const timeTicks = useMemo(
    () =>
      layout.width > 0 && !empty
        ? calcTimeTicksJs(leftEdge, rightEdge, layout.width, pad, formatTime)
        : [],
    [empty, formatTime, layout.width, leftEdge, pad, rightEdge],
  );
  const trackedTimeLabels = useTrackedTimeLabels(timeTicks);

  const lastCandleX = useMemo(() => {
    if (layout.width <= 0 || !lastCandle) return pad.left;
    const x = toScreenXJs(tipT + candleWidthSecs / 2, leftEdge, rightEdge, layout.width, pad);
    return clamp(x, pad.left, layout.width - pad.right);
  }, [candleWidthSecs, lastCandle, layout.width, leftEdge, pad, rightEdge, tipT]);
  const drawRevealWidth = useMemo(
    () => clamp(lastCandleX - pad.left, 0, chartW),
    [chartW, lastCandleX, pad.left],
  );

  const {
    drawComplete,
    dvClipRect,
    dvDrawDotX,
    dvGridOp,
    dvBadgeOp,
    dvDrawDotOp,
    dvEndDotOp,
  } = useStaticDrawAnimation({
    ready: !empty && layout.width > 0,
    chartWidth: drawRevealWidth,
    chartHeight: layout.height,
    padLeft: pad.left,
    animationKey,
    duration: drawDuration,
    easing: drawEasing,
    onComplete: onDrawComplete,
  });

  const onHoverSample = useCallback(
    (sample: { hx: number; hv: number; ht: number; opacity: number } | null) => {
      if (!onHover) return;
      if (!sample || sample.opacity <= 0.01) {
        onHover(null);
        return;
      }
      onHover({
        time: sample.ht,
        value: sample.hv,
        x: sample.hx,
        y: toScreenYJs(sample.hv, rng.min, rng.max, layout.height, pad),
      });
    },
    [layout.height, onHover, pad, rng.max, rng.min],
  );

  const { gesture: scrubGesture, svScrubX, svScrubOp, svScrubHv, scrubTip } = useStaticScrub({
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
    candles: visibleCandles,
    candleWidthSecs,
    snapToPoint: snapToPointScrubbing,
    haptics: scrubHapticsProp,
    isCandle: true,
    onHoverSample,
  });

  const clipRect = useMemo(
    () => (chartW > 0 && chartH > 0 ? rect(pad.left - 1, pad.top, chartW + 2, chartH) : undefined),
    [chartH, chartW, pad.left, pad.top],
  );
  const svIdentityTranslateX = useSharedValue(0);
  const svIdentityScaleY = useSharedValue(1);
  const svIdentityTranslateY = useSharedValue(0);
  const svVisibleCandles = useSharedValue<CandlePoint[]>([...visibleCandles]);

  useEffect(() => {
    svVisibleCandles.value = [...visibleCandles];
  }, [svVisibleCandles, visibleCandles]);

  const lastCandleCloseY = useMemo(
    () =>
      layout.height > 0 && lastCandle ? toScreenYJs(tipV, rng.min, rng.max, layout.height, pad) : 0,
    [lastCandle, layout.height, pad, rng.max, rng.min, tipV],
  );
  const dvSplitX = useDerivedValue(() => {
    if (svScrubOp.value <= 0.01) return layout.width - pad.right;
    return clamp(svScrubX.value, pad.left, lastCandleX);
  }, [layout.width, pad.left, pad.right, lastCandleX]);
  const dvClipL = useDerivedValue(() => {
    const xs = dvSplitX.value;
    return rect(pad.left, pad.top, xs - pad.left, chartH);
  }, [pad.left, pad.top, chartH]);
  const dvClipR = useDerivedValue(() => {
    const xs = dvSplitX.value;
    return rect(xs, pad.top, layout.width - pad.right - xs, chartH);
  }, [layout.width, pad.top, pad.right, chartH]);
  const dvRightSegOp = useDerivedValue(() => {
    if (svScrubOp.value <= 0.01) return 1;
    return Math.max(0, 1 - svScrubOp.value * 0.6);
  });

  const dvDrawDotY = useDerivedValue(() => {
    const candles = svVisibleCandles.value;
    if (!lastCandle || layout.width <= 0 || candles.length === 0) return 0;
    const dotX = dvDrawDotX.value;
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const re = tipT + win * buf;
    const le = re - win;
    const t = le + ((dotX - pad.left) / cw) * (re - le);
    let bestClose = tipV;
    let bestDist = Infinity;
    for (const candle of candles) {
      const candleT = candle.time + candleWidthSecs / 2;
      const distance = Math.abs(candleT - t);
      if (distance < bestDist) {
        bestDist = distance;
        bestClose = candle.close;
      }
    }
    const span = Math.max(0.0001, rng.max - rng.min);
    const ch = Math.max(1, layout.height - pad.top - pad.bottom);
    return pad.top + (1 - (bestClose - rng.min) / span) * ch;
  }, [buf, candleWidthSecs, dvDrawDotX, lastCandle, layout.height, layout.width, pad, rng.max, rng.min, svVisibleCandles, tipT, tipV, win]);

  const candleBadgeColor =
    lastCandle && lastCandle.close >= lastCandle.open ? LIVELINE_CANDLE_BULL : LIVELINE_CANDLE_BEAR;
  const candleBadgeDashColor =
    lastCandle && lastCandle.close >= lastCandle.open
      ? `${LIVELINE_CANDLE_BULL}44`
      : `${LIVELINE_CANDLE_BEAR}44`;

  const dvReferenceY = useDerivedValue(
    () =>
      referenceLine ? toScreenYJs(referenceLine.value, rng.min, rng.max, layout.height, pad) : 0,
    [layout.height, pad, referenceLine, rng.max, rng.min],
  );
  const dvHoverX = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01) return -100;
    return clamp(svScrubX.value, pad.left, lastCandleX);
  }, [scrub, pad.left, lastCandleX]);
  const dvHoverY = useDerivedValue(
    () => (scrub && svScrubOp.value > 0.01 ? toScreenYJs(svScrubHv.value, rng.min, rng.max, layout.height, pad) : -100),
    [layout.height, pad, rng.max, rng.min, scrub, svScrubHv],
  );
  const dvCrossEffectiveOp = useDerivedValue(() => {
    const scrubAmt = svScrubOp.value;
    if (scrubAmt <= 0.01) return 0;
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const dist = lastCandleX - dvHoverX.value;
    const fadeStart = Math.min(80, cw * 0.3);
    if (dist < 5) return 0;
    if (dist >= fadeStart) return scrubAmt;
    return ((dist - 5) / (fadeStart - 5)) * scrubAmt;
  }, [layout.width, pad.left, pad.right, lastCandleX]);
  const dvCrossP1 = useDerivedValue(
    () => ({ x: dvHoverX.value, y: pad.top }),
    [pad.top],
  );
  const dvCrossP2 = useDerivedValue(
    () => ({ x: dvHoverX.value, y: layout.height - pad.bottom }),
    [layout.height, pad.bottom],
  );
  const dvCrossLineOp = useDerivedValue(() => dvCrossEffectiveOp.value * 0.5);
  const dvCrossDotR = useDerivedValue(() => 4 * Math.min(dvCrossEffectiveOp.value * 3, 1));
  const dvCrossDotOp = useDerivedValue(() => (dvCrossEffectiveOp.value > 0.01 ? 1 : 0));
  const dvDashY = useDerivedValue(
    () => toScreenYJs(tipV, rng.min, rng.max, layout.height, pad),
    [layout.height, pad, rng.max, rng.min, tipV],
  );
  const dvDashP1 = useDerivedValue(
    () => ({ x: pad.left, y: dvDashY.value }),
    [dvDashY, pad.left],
  );
  const dvDashP2 = useDerivedValue(
    () => ({ x: layout.width - pad.right, y: dvDashY.value }),
    [dvDashY, layout.width, pad.right],
  );

  const badgeStr = useMemo(() => formatValue(tipV), [formatValue, tipV]);
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;
  const skiaDefaultNumberFormat = useMemo(
    () => supportsTwoDecimalNumberFlow(formatValue),
    [formatValue],
  );
  const badgeNumFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 11);
  const skiaBadgeFlow = badge && skiaDefaultNumberFormat && badgeNumFont != null;
  const svBadgeValue = useSharedValue(tipV);
  useEffect(() => {
    svBadgeValue.value = tipV;
  }, [svBadgeValue, tipV]);
  const [flowPillW, setFlowPillW] = useState(80);
  const onBadgeTemplateLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      const w = e.nativeEvent.layout.width;
      setFlowPillW((prev) => (prev === Math.round(w) ? prev : Math.round(w)));
    },
    [],
  );
  const badgePillW = useMemo(() => Math.max(8, flowPillW) + BADGE_PAD_X * 2, [flowPillW]);
  const badgeBgPath = useMemo(
    () => badgeSvgPath(badgePillW, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD),
    [badgePillW, pillH],
  );
  const badgeInnerPath = useMemo(
    () => badgeSvgPath(badgePillW - 4, pillH - 4, BADGE_TAIL_LEN - 1, BADGE_TAIL_SPREAD - 0.5),
    [badgePillW, pillH],
  );
  const badgeX = useMemo(() => layout.width - pad.right + 4, [layout.width, pad.right]);
  const asBadge = useAnimatedStyle(() => ({
      opacity: badge ? 1 - svScrubOp.value : 0,
      left: badgeX,
      top: lastCandleCloseY - pillH / 2,
      width: BADGE_TAIL_LEN + badgePillW,
      height: pillH,
    }));
  const asBadgeTextWrap = useMemo(() => ({ opacity: 1 }), []);

  const candleScrubLayout = useMemo(
    () => (scrubTip && scrubTip.candle ? { left: scrubTip.hx, candle: scrubTip.candle } : null),
    [scrubTip],
  );
  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || scrubTip.candle || layout.width < 300) return null;
    const valueText = formatValue(scrubTip.hv);
    const timeText = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const totalW = valueText.length * charW + sep.length * charW + timeText.length * charW;
    const dotRight = lastCandleX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v: valueText, t: timeText, sep };
  }, [formatTime, formatValue, lastCandleX, layout.width, pad, scrubTip]);
  const dvScrubValueStr = useDerivedValue(() => formatPriceCentsWorklet(svScrubHv.value), [svScrubHv]);

  const baseY = layout.height - pad.bottom;
  const gesture = useMemo(
    () =>
      Gesture.Simultaneous(
        scrubGesture,
        Gesture.Pinch()
          .enabled(pinchToZoom)
          .onUpdate((e) => {
            'worklet';
            const next = clamp(
              resolvedWin / Math.max(0.5, Math.min(2.5, e.scale)),
              5,
              resolvedWin * 6,
            );
            runOnJS(setPinchWindow)(next);
          })
          .onEnd(() => {
            'worklet';
            runOnJS(setPinchWindow)(null);
          }),
      ),
    [pinchToZoom, resolvedWin, scrubGesture],
  );

  const windowControls = useMemo(
    () => buildControlOptions(windows, resolvedWin, pinchWindow, onWindowChange),
    [onWindowChange, pinchWindow, resolvedWin, windows],
  );
  const modeControls = useMemo<ChartControlOption[]>(
    () =>
      showBuiltInModeToggle && onModeChange
        ? [
            { key: 'line', label: 'Line', active: mode !== 'candle', onPress: () => onModeChange('line') },
            { key: 'candle', label: 'Candle', active: mode === 'candle', onPress: () => onModeChange('candle') },
          ]
        : [],
    [mode, onModeChange, showBuiltInModeToggle],
  );
  const morphControls = useMemo<ChartControlOption[]>(
    () =>
      showBuiltInMorphToggle && onLineModeChange
        ? [
            { key: 'bars', label: 'Bars', active: !lineMode, onPress: () => onLineModeChange(false) },
            { key: 'morph', label: 'Morph', active: lineMode, onPress: () => onLineModeChange(true) },
          ]
        : [],
    [lineMode, onLineModeChange, showBuiltInMorphToggle],
  );

  return (
    <View style={[styles.root, { height }, style]}>
      {windowControls.length > 0 ? (
        <ChartControlRow options={windowControls} theme={theme} styleVariant={ws} marginLeft={pad.left} colors={chartColors} />
      ) : null}
      {modeControls.length > 0 ? (
        <ChartControlRow options={modeControls} theme={theme} styleVariant={ws} marginLeft={pad.left} colors={chartColors} />
      ) : null}
      {morphControls.length > 0 ? (
        <ChartControlRow options={morphControls} theme={theme} styleVariant={ws} marginLeft={pad.left} colors={chartColors} />
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
              <>
                <Canvas style={StyleSheet.absoluteFill}>
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

                  <Group clip={dvClipRect}>
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

                    {clipRect ? (
                      <Group opacity={dvMorphLineOverlayOp}>
                        <LinePathLayer
                          clipRect={clipRect}
                          leftClip={dvClipL}
                          rightClip={dvClipR}
                          rightOpacity={dvRightSegOp}
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
                          gradientStartColor={linePal.gridLabel}
                          gradientEndColor={pal.accent}
                          rangeTranslateX={svIdentityTranslateX}
                          rangeScaleY={svIdentityScaleY}
                          rangeTranslateY={svIdentityTranslateY}
                        />
                      </Group>
                    ) : null}
                  </Group>

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

                  <Group opacity={dvBadgeOp}>
                    <SkiaLine p1={dvDashP1} p2={dvDashP2} color={candleBadgeDashColor} strokeWidth={1}>
                      <DashPathEffect intervals={PRICE_DASH_INTERVALS} />
                    </SkiaLine>
                  </Group>

                  <Group opacity={dvDrawDotOp}>
                    <Circle cx={dvDrawDotX} cy={dvDrawDotY} r={10} color={pal.accentGlow} opacity={0.5} />
                    <Circle cx={dvDrawDotX} cy={dvDrawDotY} r={4} color={pal.accent} />
                  </Group>

                  <Group opacity={dvEndDotOp}>
                    <Circle cx={lastCandleX} cy={lastCandleCloseY} r={4} color={candleBadgeColor} />
                  </Group>

                  <Group blendMode="dstOut">
                    <Rect x={0} y={0} width={pad.left + FADE_EDGE_WIDTH} height={layout.height}>
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
                    dotColor={candleBadgeColor}
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
                ) : scrub && scrubTipLayout ? (
                  <ScrubTooltip
                    layout={scrubTipLayout}
                    top={pad.top + tooltipY + 10}
                    opacity={svScrubOp}
                    tooltipOutline={tooltipOutline}
                    skiaScrubFlow={false}
                    scrubTipFont={null as never}
                    scrubValue={dvScrubValueStr}
                    pal={pal}
                    textStyle={styles.scrubTipText}
                  />
                ) : null}

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
                    opacity={dvGridOp}
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
