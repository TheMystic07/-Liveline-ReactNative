import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  LinearGradient,
  Path,
  Rect,
  rect,
  vec,
} from '@shopify/react-native-skia';
import { useSkiaFont } from 'number-flow-react-native/skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
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
import { BADGE_NUMBER_FLOW_FONT_SRC } from './BadgeSkiaNumberFlow';
import { formatPriceCentsWorklet, supportsTwoDecimalNumberFlow } from './chartNumberFlow';
import { SCRUB_TIP_FLOW_W } from './ScrubSkiaNumberFlow';
import { computeRange } from './math/range';
import type {
  ChartPadding,
  LiveLinePoint,
  LiveLineWindowStyle,
} from './types';
import type { StaticChartProps } from './staticTypes';
import {
  calcGridTicksJs,
  calcTimeTicksJs,
  clamp,
  defaultFormatTime,
  defaultFormatValue,
  interpAtTimeJs,
  toScreenXJs,
  toScreenYJs,
} from './nativeChartUtils';

import { useStaticDrawAnimation } from './hooks/useStaticDrawAnimation';
import { useStaticScrub } from './hooks/useStaticScrub';
import { useStaticWindowTransition } from './hooks/useStaticWindowTransition';

import { AxisLabels } from './render/AxisLabels';
import { BadgeOverlay } from './render/BadgeOverlay';
import { ChartControlRow, type ChartControlOption } from './ChartControlRow';
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

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const PRICE_DASH_INTERVALS = [4, 4];

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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NativeStaticLineChart({
  data,
  theme = 'dark',
  chartColors,
  color = '#3b82f6',
  lineWidth: lineWidthProp,
  window: controlledWin = 30,
  windows,
  onWindowChange,
  windowStyle: windowStyleProp = 'default',
  grid = true,
  fill = true,
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
  style,
  contentInset,
}: StaticChartProps) {
  const buf = windowBuffer(badge);
  const ws: LiveLineWindowStyle = windowStyleProp ?? 'default';

  const resolvedWin = useMemo(() => {
    if (!windows?.length) return controlledWin;
    if (windows.some((entry) => entry.secs === controlledWin)) return controlledWin;
    return windows[0]!.secs;
  }, [controlledWin, windows]);
  const [pinchWindow, setPinchWindow] = useState<number | null>(null);
  const targetWin = pinchWindow ?? resolvedWin;
  const win = useStaticWindowTransition(targetWin);

  /* ---- Palette ---- */
  const linePal = useMemo(
    () => resolvePalette(color, theme, lineWidthProp),
    [color, lineWidthProp, theme],
  );
  const pal = useMemo(
    () => resolvePalette(color, theme, lineWidthProp, chartColors),
    [chartColors, color, lineWidthProp, theme],
  );

  /* ---- Layout ---- */
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const chartW = Math.max(0, layout.width - (contentInset?.left ?? 0) - (contentInset?.right ?? 56));
  const chartH = Math.max(0, layout.height - (contentInset?.top ?? 12) - (contentInset?.bottom ?? 28));
  const pad: ChartPadding = useMemo(
    () => ({
      top: contentInset?.top ?? 12,
      right: contentInset?.right ?? 56,
      bottom: contentInset?.bottom ?? 28,
      left: contentInset?.left ?? 0,
    }),
    [contentInset],
  );

  /* ---- Data prep ---- */
  const lastPoint = useMemo(
    () => (data.length > 0 ? data[data.length - 1]! : null),
    [data],
  );
  const animationKey = useMemo(
    () => `${data.length}:${data[0]?.time ?? 0}:${lastPoint?.time ?? 0}:${lastPoint?.value ?? 0}`,
    [data, lastPoint],
  );
  const tipT = lastPoint?.time ?? 0;
  const tipV = lastPoint?.value ?? 0;

  const { leftEdge, rightEdge } = useMemo(
    () => windowEdges(tipT, win, buf),
    [tipT, win, buf],
  );

  const visibleData = useMemo(
    () => data.filter((p) => p.time >= leftEdge - 2 && p.time <= rightEdge + 1),
    [data, leftEdge, rightEdge],
  );
  const empty = loading || layout.width <= 0 || visibleData.length < 2;

  const rng = useMemo(
    () => computeRange(visibleData, tipV, referenceLine?.value, exaggerate),
    [visibleData, tipV, referenceLine?.value, exaggerate],
  );

  /* ---- Paths (built once) ---- */
  const linePath = useMemo(
    () =>
      layout.width > 0 && !empty
        ? buildPath(data, tipT, tipV, rng.min, rng.max, layout.width, layout.height, pad, win, buf, false)
        : '',
    [data, tipT, tipV, rng.min, rng.max, layout.width, layout.height, pad, win, buf, empty],
  );

  const fillPath = useMemo(
    () =>
      layout.width > 0 && !empty && fill
        ? buildPath(data, tipT, tipV, rng.min, rng.max, layout.width, layout.height, pad, win, buf, true)
        : '',
    [data, tipT, tipV, rng.min, rng.max, layout.width, layout.height, pad, win, buf, empty, fill],
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

  const lastPointX = useMemo(
    () => (layout.width > 0 && lastPoint ? toScreenXJs(tipT, leftEdge, rightEdge, layout.width, pad) : pad.left),
    [tipT, leftEdge, rightEdge, layout.width, pad, lastPoint],
  );
  const drawRevealWidth = useMemo(
    () => clamp(lastPointX - pad.left, 0, chartW),
    [chartW, lastPointX, pad.left],
  );

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
    [onHover, rng.min, rng.max, layout.height, pad],
  );

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
    data,
    snapToPoint: snapToPointScrubbing,
    haptics: scrubHapticsProp,
    isCandle: false,
    onHoverSample,
  });

  /* ---- Derived values for Skia rendering ---- */
  const clipRect = useMemo(
    () =>
      chartW > 0 && chartH > 0
        ? rect(pad.left - 1, pad.top, chartW + 2, chartH)
        : undefined,
    [chartW, chartH, pad.left, pad.top],
  );

  // Identity transforms (no smoothing engine → no range animation)
  const svIdentityTranslateX = useSharedValue(0);
  const svIdentityScaleY = useSharedValue(1);
  const svIdentityTranslateY = useSharedValue(0);
  const svLineData = useSharedValue<LiveLinePoint[]>(data.slice());

  useEffect(() => {
    svLineData.value = data.slice();
  }, [data, svLineData]);

  // Live dot position (last data point)
  const lastPointY = useMemo(
    () => (layout.height > 0 && lastPoint ? toScreenYJs(tipV, rng.min, rng.max, layout.height, pad) : 0),
    [tipV, rng.min, rng.max, layout.height, pad, lastPoint],
  );
  const dvSplitX = useDerivedValue(() => {
    if (svScrubOp.value <= 0.01) return layout.width - pad.right;
    return clamp(svScrubX.value, pad.left, lastPointX);
  }, [layout.width, pad.left, pad.right, lastPointX]);
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

  // Drawing dot Y: interpolate value at the draw progress position
  const dvDrawDotY = useDerivedValue(() => {
    if (!lastPoint || layout.width <= 0) return 0;
    const dotX = dvDrawDotX.value;
    // Convert dotX back to time
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const re = tipT + win * buf;
    const le = re - win;
    const t = le + ((dotX - pad.left) / cw) * (re - le);
    const v = interpAtTimeJs(svLineData.value, t) ?? tipV;
    const span = Math.max(0.0001, rng.max - rng.min);
    const ch = Math.max(1, layout.height - pad.top - pad.bottom);
    return pad.top + (1 - (v - rng.min) / span) * ch;
  }, [lastPoint, layout.width, layout.height, pad, win, buf, tipT, tipV, rng, svLineData]);

  // Line color (static — no momentum blending)
  const lineColor = pal.accent;

  // Reference line Y
  const dvReferenceY = useDerivedValue(
    () =>
      referenceLine
        ? toScreenYJs(referenceLine.value, rng.min, rng.max, layout.height, pad)
        : 0,
    [referenceLine, rng.min, rng.max, layout.height, pad],
  );

  // Crosshair derived values
  const dvHoverX = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01) return -100;
    return clamp(svScrubX.value, pad.left, lastPointX);
  }, [scrub, pad.left, lastPointX]);
  const dvHoverY = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01 || chartW <= 0) return -100;
    const re = tipT + win * buf;
    const le = re - win;
    const ht = le + ((dvHoverX.value - pad.left) / Math.max(1, chartW)) * (re - le);
    const hv = interpAtTimeJs(svLineData.value, ht) ?? svScrubHv.value;
    return toScreenYJs(hv, rng.min, rng.max, layout.height, pad);
  }, [scrub, chartW, tipT, win, buf, pad, rng.min, rng.max, layout.height, svLineData]);
  const dvCrossEffectiveOp = useDerivedValue(() => {
    const scrubAmt = svScrubOp.value;
    if (scrubAmt <= 0.01) return 0;
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const hx = dvHoverX.value;
    const dist = lastPointX - hx;
    const fadeStart = Math.min(80, cw * 0.3);
    if (dist < 5) return 0;
    if (dist >= fadeStart) return scrubAmt;
    return ((dist - 5) / (fadeStart - 5)) * scrubAmt;
  }, [layout.width, pad.left, pad.right, lastPointX]);
  const dvCrossP1 = useDerivedValue(() => ({ x: dvHoverX.value, y: pad.top }), [pad.top]);
  const dvCrossP2 = useDerivedValue(
    () => ({ x: dvHoverX.value, y: layout.height - pad.bottom }),
    [layout.height, pad.bottom],
  );
  const dvCrossLineOp = useDerivedValue(() => dvCrossEffectiveOp.value * 0.5);
  const dvCrossDotR = useDerivedValue(() => 4 * Math.min(dvCrossEffectiveOp.value * 3, 1));
  const dvCrossDotOp = useDerivedValue(() => (dvCrossEffectiveOp.value > 0.01 ? 1 : 0));

  // Dashed price line
  const dvDashY = useDerivedValue(
    () => toScreenYJs(tipV, rng.min, rng.max, layout.height, pad),
    [tipV, rng.min, rng.max, layout.height, pad],
  );
  const dvDashP1 = useDerivedValue(() => ({ x: pad.left, y: dvDashY.value }), [pad.left]);
  const dvDashP2 = useDerivedValue(
    () => ({ x: layout.width - pad.right, y: dvDashY.value }),
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
  const scrubTipFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 13);
  const skiaBadgeFlow = badge && skiaDefaultNumberFormat && badgeNumFont != null;
  const skiaScrubFlow = scrub && scrubNumberFlow !== false && skiaDefaultNumberFormat && scrubTipFont != null;

  const svBadgeValue = useSharedValue(tipV);
  useEffect(() => {
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

  // Badge position (static — at last point Y)
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

  const asBadge = useAnimatedStyle(() => ({
      opacity: badge ? 1 - svScrubOp.value : 0,
      left: badgeX,
      top: lastPointY - pillH / 2,
      width: BADGE_TAIL_LEN + badgePillW,
      height: pillH,
    }));

  const asBadgeTextWrap = useMemo(() => ({ opacity: 1 }), []);

  // Scrub tip layout
  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || layout.width < 300) return null;
    const v = formatValue(scrubTip.hv);
    const t = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const valueSlotW = skiaScrubFlow ? SCRUB_TIP_FLOW_W : v.length * charW;
    const totalW = valueSlotW + sep.length * charW + t.length * charW;
    const liveX = lastPointX;
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v, t, sep };
  }, [scrubTip, layout.width, formatValue, formatTime, lastPointX, pad, skiaScrubFlow]);

  const dvScrubValueStr = useDerivedValue(() => {
    'worklet';
    return formatPriceCentsWorklet(svScrubHv.value);
  });

  /* ---- Loading state ---- */
  const [loadMs] = useState(0);

  /* ---- Computed ---- */
  const baseY = layout.height - pad.bottom;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

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

  const windowControls = useMemo<ChartControlOption[]>(
    () =>
      windows?.map((entry) => ({
        key: entry.secs,
        label: entry.label,
        active: pinchWindow == null && resolvedWin === entry.secs,
        onPress: () => onWindowChange?.(entry.secs),
      })) ?? [],
    [onWindowChange, pinchWindow, resolvedWin, windows],
  );

  return (
    <View style={[styles.root, { height }, style]}>
      {windowControls.length > 0 ? (
        <ChartControlRow
          options={windowControls}
          theme={theme}
          styleVariant={ws}
          marginLeft={pad.left}
          colors={chartColors}
        />
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

                  {/* Fill gradient (clipped by draw animation) */}
                  {fill && clipRect ? (
                    <Group clip={dvClipRect} opacity={dvGridOp}>
                      <Group clip={dvClipL}>
                        <Path path={fillPath}>
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(0, layout.height - pad.bottom)}
                            colors={[pal.accentFillTop, pal.accentFillBottom]}
                          />
                        </Path>
                      </Group>
                      <Group clip={dvClipR} opacity={dvRightSegOp}>
                        <Path path={fillPath}>
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(0, layout.height - pad.bottom)}
                            colors={[pal.accentFillTop, pal.accentFillBottom]}
                          />
                        </Path>
                      </Group>
                    </Group>
                  ) : null}

                  {/* Line path (clipped by draw animation) */}
                  {clipRect ? (
                    <Group clip={dvClipRect}>
                      <LinePathLayer
                        clipRect={clipRect}
                        leftClip={dvClipL}
                        rightClip={dvClipR}
                        rightOpacity={dvRightSegOp}
                        revealOpacity={1}
                        path={linePath}
                        layoutHeight={layout.height}
                        padTop={pad.top}
                        padRight={pad.right}
                        layoutWidth={layout.width}
                        lineWidth={pal.lineWidth}
                        lineColor={lineColor}
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
                      color={pal.dashLine}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={PRICE_DASH_INTERVALS} />
                    </SkiaLine>
                  </Group>

                  {/* Drawing dot (traces the leading edge during draw) */}
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

                  {/* Static end dot (appears when draw completes) */}
                  <Group opacity={dvEndDotOp}>
                    <Circle
                      cx={lastPointX}
                      cy={lastPointY}
                      r={4}
                      color={pal.accent}
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
                    dotColor={pal.accent}
                  />
                </Canvas>

                {/* Scrub tooltip */}
                <ScrubTooltip
                  layout={scrub && scrubTipLayout ? scrubTipLayout : null}
                  top={pad.top + tooltipY + 10}
                  opacity={svScrubOp}
                  tooltipOutline={tooltipOutline}
                  skiaScrubFlow={skiaScrubFlow}
                  scrubTipFont={scrubTipFont}
                  scrubValue={dvScrubValueStr}
                  pal={pal}
                  textStyle={styles.scrubTipText}
                />

                {/* Axis labels (RN Text elements) */}
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
                  innerColor={pal.accent}
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
