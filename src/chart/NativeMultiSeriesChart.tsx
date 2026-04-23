import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  rect,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { buildPath } from './draw/buildLiveLinePath';
import { resolvePalette } from './theme';
import { GridCanvas } from './render/GridCanvas';
import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import type { LiveLineChartProps, LiveLinePoint } from './types';
import { useChartSmoothingEngine } from './smoothingEngine';
import {
  calcGridTicksJs,
  calcTimeTicksJs,
  clamp,
  defaultFormatTime,
  defaultFormatValue,
  interpAtTimeJs,
  nearestPointAtTimeJs,
  toScreenXJs,
  toScreenYJs,
} from './nativeChartUtils';

const MULTI_WIN_BUF = 0.015;
const MULTI_WIN_BUF_BADGE = 0.05;
const FADE_EDGE_WIDTH = 40;
const MULTI_PULSE_DURATION = 1100;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type SmoothFrame = {
  min: number;
  max: number;
  tipT: number;
  seriesTips: Record<string, number>;
};

function sameSeriesTips(
  next: Record<string, number>,
  prev: Record<string, number>,
) {
  const nextKeys = Object.keys(next);
  const prevKeys = Object.keys(prev);
  if (nextKeys.length !== prevKeys.length) return false;
  for (const key of nextKeys) {
    if (Math.abs((prev[key] ?? NaN) - next[key]!) > 1e-6) return false;
  }
  return true;
}

function AnimatedSeriesStroke({
  clipRect,
  points,
  tipT,
  tipV,
  min,
  max,
  width,
  height,
  pad,
  win,
  buffer,
  lineWidth,
  lineColor,
  fill,
  fillOpacity,
  fillStartColor,
  fillEndColor,
  trailGlow,
  trailGlowColor,
  gradientLineColoring,
  gradientStartColor,
  gradientEndColor,
}: {
  clipRect: ReturnType<typeof rect> | undefined;
  points: LiveLinePoint[];
  tipT: SharedValue<number>;
  tipV: SharedValue<number>;
  min: SharedValue<number>;
  max: SharedValue<number>;
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
  win: number;
  buffer: number;
  lineWidth: number;
  lineColor: string;
  fill: boolean;
  fillOpacity: number;
  fillStartColor: string;
  fillEndColor: string;
  trailGlow: boolean;
  trailGlowColor: string;
  gradientLineColoring: boolean;
  gradientStartColor: string;
  gradientEndColor: string;
}) {
  const dvPath = useDerivedValue(() => {
    'worklet';
    return buildPath(
      points,
      tipT.value,
      tipV.value,
      min.value,
      max.value,
      width,
      height,
      pad,
      win,
      buffer,
      false,
    );
  }, [points, tipT, tipV, min, max, width, height, pad, win, buffer]);
  const dvFillPath = useDerivedValue(() => {
    'worklet';
    return buildPath(
      points,
      tipT.value,
      tipV.value,
      min.value,
      max.value,
      width,
      height,
      pad,
      win,
      buffer,
      true,
    );
  }, [points, tipT, tipV, min, max, width, height, pad, win, buffer]);

  if (!clipRect) return null;

  return (
    <Group clip={clipRect}>
      {fill ? (
        <Path path={dvFillPath} opacity={fillOpacity}>
          <LinearGradient
            start={vec(0, pad.top)}
            end={vec(0, height - pad.bottom)}
            colors={[fillStartColor, fillEndColor]}
          />
        </Path>
      ) : null}
      {trailGlow ? (
        <>
          <Path
            path={dvPath}
            style="stroke"
            strokeWidth={lineWidth + 10}
            strokeJoin="round"
            strokeCap="round"
            color={trailGlowColor}
            opacity={0.16}
          />
          <Path
            path={dvPath}
            style="stroke"
            strokeWidth={lineWidth + 5}
            strokeJoin="round"
            strokeCap="round"
            color={trailGlowColor}
            opacity={0.42}
          />
        </>
      ) : null}
      <Path
        path={dvPath}
        style="stroke"
        strokeWidth={lineWidth}
        strokeJoin="round"
        strokeCap="round"
        color={gradientLineColoring ? undefined : lineColor}
      >
        {gradientLineColoring ? (
          <LinearGradient
            start={vec(0, pad.top)}
            end={vec(width - pad.right, height)}
            colors={[gradientStartColor, gradientEndColor]}
          />
        ) : null}
      </Path>
    </Group>
  );
}

function computeUnionRange(
  series: Array<{ points: LiveLinePoint[]; value: number }>,
  referenceValue?: number,
  exaggerate = false,
) {
  let min = Infinity;
  let max = -Infinity;
  for (const entry of series) {
    for (const point of entry.points) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
    if (entry.value < min) min = entry.value;
    if (entry.value > max) max = entry.value;
  }
  if (referenceValue !== undefined) {
    if (referenceValue < min) min = referenceValue;
    if (referenceValue > max) max = referenceValue;
  }
  if (!isFinite(min) || !isFinite(max)) {
    return { min: 0, max: 1 };
  }
  const rawRange = max - min;
  const minRange = rawRange * (exaggerate ? 0.02 : 0.1) || (exaggerate ? 0.04 : 0.4);
  if (rawRange < minRange) {
    const mid = (min + max) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  const margin = rawRange * (exaggerate ? 0.01 : 0.12);
  return { min: min - margin, max: max + margin };
}

export function NativeMultiSeriesChart({
  series = [],
  theme = 'dark',
  chartColors,
  color = '#3b82f6',
  lineWidth,
  window: controlledWin = 30,
  windows,
  onWindowChange,
  referenceLine,
  badge = true,
  fill = true,
  scrub = true,
  snapToPointScrubbing = false,
  pinchToZoom = false,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  lineTrailGlow = true,
  gradientLineColoring = false,
  exaggerate = true,
  height = 300,
  emptyText = 'Waiting for ticks',
  loading = false,
  style,
  contentInset,
  onSeriesToggle,
  seriesToggleCompact = false,
  lerpSpeed = 0.08,
}: LiveLineChartProps) {
  const palette = resolvePalette(series[0]?.color ?? color, theme, lineWidth, chartColors);
  const [layout, setLayout] = useState({ width: 0, height });
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [scrubX, setScrubX] = useState<number | null>(null);
  const [pinchWindow, setPinchWindow] = useState<number | null>(null);

  const resolvedWin = useMemo(() => {
    if (!windows?.length) return controlledWin;
    if (windows.some((entry) => entry.secs === controlledWin)) return controlledWin;
    return windows[0].secs;
  }, [windows, controlledWin]);
  const activeWindow = pinchWindow ?? resolvedWin;
  const winBuffer = badge ? MULTI_WIN_BUF_BADGE : MULTI_WIN_BUF;

  const pad = useMemo(
    () => ({
      top: contentInset?.top ?? 12,
      right: contentInset?.right ?? (badge ? 80 : 60),
      bottom: contentInset?.bottom ?? 28,
      left: contentInset?.left ?? 12,
    }),
    [contentInset, badge],
  );

  const visibleSeries = useMemo(
    () => series.filter((entry) => !hiddenSeries.has(entry.id)),
    [hiddenSeries, series],
  );

  const latestTime = useMemo(
    () =>
      visibleSeries.reduce(
        (max, entry) => Math.max(max, entry.data[entry.data.length - 1]?.time ?? 0),
        0,
      ),
    [visibleSeries],
  );
  const dataRightEdge = latestTime + activeWindow * winBuffer;
  const dataLeftEdge = dataRightEdge - activeWindow;

  const preparedSeries = useMemo(() => {
    const rawSeries = visibleSeries.map((entry) => {
      const rawPoints = entry.data.filter(
        (point) => point.time >= dataLeftEdge - 2 && point.time <= dataRightEdge + 1,
      );
      const seriesPalette = resolvePalette(entry.color ?? color, theme, lineWidth, chartColors);
      return { ...entry, rawPoints, palette: seriesPalette };
    });
    const primaryBase = rawSeries[0]?.rawPoints[0]?.value ?? rawSeries[0]?.value ?? 0;
    return rawSeries.map((entry) => {
      const seriesBase = entry.rawPoints[0]?.value ?? entry.value;
      const toDisplayValue = (value: number) => primaryBase + (value - seriesBase);
      const points = entry.rawPoints.map((point) => ({
        time: point.time,
        value: toDisplayValue(point.value),
      }));
      return {
        ...entry,
        points,
        displayValue: toDisplayValue(entry.value),
      };
    });
  }, [chartColors, color, dataLeftEdge, dataRightEdge, lineWidth, theme, visibleSeries]);

  const empty = loading || layout.width <= 0 || preparedSeries.every((entry) => entry.points.length < 2);

  const targetRange = useMemo(
    () => computeUnionRange(preparedSeries, referenceLine?.value, exaggerate),
    [exaggerate, preparedSeries, referenceLine?.value],
  );
  const visibleTargets = useMemo(
    () => preparedSeries.map((entry) => ({ id: entry.id, value: entry.displayValue })),
    [preparedSeries],
  );
  const engine = useChartSmoothingEngine({
    targetMin: targetRange.min,
    targetMax: targetRange.max,
    seriesTargets: visibleTargets,
    dataTipT: latestTime,
    enabled: !empty,
  });
  const [display, setDisplay] = useState<SmoothFrame>(() => ({
    min: targetRange.min,
    max: targetRange.max,
    tipT: latestTime,
    seriesTips: Object.fromEntries(visibleTargets.map((entry) => [entry.id, entry.value])),
  }));
  const displayRef = useRef(display);
  const svPulse = useSharedValue(1);

  useEffect(() => {
    if (!empty) engine.pulse();
  }, [empty, engine, series, latestTime]);

  useEffect(() => {
    cancelAnimation(svPulse);
    if (empty) {
      svPulse.value = 1;
      return;
    }
    svPulse.value = 0;
    svPulse.value = withRepeat(
      withTiming(1, { duration: MULTI_PULSE_DURATION, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(svPulse);
      svPulse.value = 1;
    };
  }, [empty, svPulse]);

  const dvPulseRingR = useDerivedValue(() => 5 + svPulse.value * 12, [svPulse]);
  const dvPulseRingOp = useDerivedValue(() => (1 - svPulse.value) * 0.35, [svPulse]);

  useEffect(() => {
    if (empty) {
      const idleFrame: SmoothFrame = {
        min: targetRange.min,
        max: targetRange.max,
        tipT: latestTime,
        seriesTips: Object.fromEntries(visibleTargets.map((entry) => [entry.id, entry.value])),
      };
      displayRef.current = idleFrame;
      setDisplay(idleFrame);
      return;
    }

    let rafId = 0;
    const tick = () => {
      const nextSeriesTips: Record<string, number> = {};
      for (const entry of visibleTargets) {
        nextSeriesTips[entry.id] = engine.getSeriesTipV(entry.id).value;
      }
      const nextFrame: SmoothFrame = {
        min: engine.svMin.value,
        max: engine.svMax.value,
        tipT: engine.svTipT.value,
        seriesTips: nextSeriesTips,
      };
      const prev = displayRef.current;
      if (
        Math.abs(prev.min - nextFrame.min) > 1e-6 ||
        Math.abs(prev.max - nextFrame.max) > 1e-6 ||
        Math.abs(prev.tipT - nextFrame.tipT) > 1e-6 ||
        !sameSeriesTips(nextFrame.seriesTips, prev.seriesTips)
      ) {
        displayRef.current = nextFrame;
        setDisplay(nextFrame);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [empty, engine, latestTime, targetRange.max, targetRange.min, visibleTargets]);

  const displayMin = display.min;
  const displayMax = display.max;
  const displayTipT = display.tipT;
  const rightEdge = displayTipT + activeWindow * winBuffer;
  const leftEdge = rightEdge - activeWindow;

  const chartWidth = layout.width - pad.left - pad.right;
  const chartHeight = layout.height - pad.top - pad.bottom;

  const gridLabels = useMemo(
    () => calcGridTicksJs(displayMin, displayMax, chartHeight, layout.height, pad, formatValue),
    [displayMin, displayMax, chartHeight, layout.height, pad, formatValue],
  );
  const timeLabels = useMemo(
    () => calcTimeTicksJs(leftEdge, rightEdge, layout.width, pad, formatTime),
    [formatTime, layout.width, leftEdge, pad, rightEdge],
  );

  // Build live marker positions using the smoothed range/tip snapshot.
  const seriesPaths = useMemo(() => {
    return preparedSeries.map((entry) => {
      const smoothedValue = display.seriesTips[entry.id] ?? entry.displayValue;
      const liveX = toScreenXJs(displayTipT, leftEdge, rightEdge, layout.width, pad);
      const liveY = toScreenYJs(smoothedValue, displayMin, displayMax, layout.height, pad);
      return {
        id: entry.id,
        color: entry.color,
        label: entry.label ?? entry.id,
        liveX,
        liveY,
        points: entry.points,
        rawPoints: entry.rawPoints,
        smoothedValue,
      };
    });
  }, [
    display.seriesTips,
    preparedSeries,
    displayTipT,
    displayMin,
    displayMax,
    layout.width,
    layout.height,
    pad,
    leftEdge,
    rightEdge,
  ]);

  const clipRect =
    chartWidth > 0 && chartHeight > 0
      ? rect(pad.left - 1, pad.top, chartWidth + 2, chartHeight)
      : undefined;

  const scrubInfo = useMemo(() => {
    if (scrubX == null || chartWidth <= 0 || displayTipT <= 0) return null;
    const liveX = toScreenXJs(displayTipT, leftEdge, rightEdge, layout.width, pad);
    const clampedX = clamp(scrubX, pad.left, liveX);
    const scrubTime =
      leftEdge + ((clampedX - pad.left) / Math.max(1, chartWidth)) * (rightEdge - leftEdge);
    const values = seriesPaths
      .map((entry) => {
        const snap = snapToPointScrubbing ? nearestPointAtTimeJs(entry.points, scrubTime) : null;
        const displayValue = snap ? snap.value : interpAtTimeJs(entry.points, scrubTime);
        const rawValue = interpAtTimeJs(entry.rawPoints, snap?.time ?? scrubTime);
        if (displayValue == null || rawValue == null) return null;
        return {
          id: entry.id,
          label: entry.label,
          color: entry.color,
          value: rawValue,
          y: toScreenYJs(displayValue, displayMin, displayMax, layout.height, pad),
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        label: string;
        color: string;
        value: number;
        y: number;
      }>;
    if (values.length === 0) return null;
    return {
      x: snapToPointScrubbing
        ? toScreenXJs(
            nearestPointAtTimeJs(seriesPaths[0]?.points ?? [], scrubTime)?.time ?? scrubTime,
            leftEdge,
            rightEdge,
            layout.width,
            pad,
          )
        : clampedX,
      time: scrubTime,
      values,
    };
  }, [
    chartWidth,
    displayTipT,
    layout.height,
    layout.width,
    leftEdge,
    pad,
    displayMax,
    displayMin,
    rightEdge,
    scrubX,
    seriesPaths,
    snapToPointScrubbing,
  ]);

  const handleSeriesToggle = (id: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        onSeriesToggle?.(id, true);
        return next;
      }
      if (series.length - next.size <= 1) return prev;
      next.add(id);
      onSeriesToggle?.(id, false);
      return next;
    });
  };

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(scrub)
      .minDistance(0)
      .onBegin((e) => runOnJS(setScrubX)(e.x))
      .onUpdate((e) => runOnJS(setScrubX)(e.x))
      .onFinalize(() => runOnJS(setScrubX)(null));

    const pinch = Gesture.Pinch()
      .enabled(pinchToZoom)
      .onUpdate((e) => {
        const next = clamp(
          resolvedWin / Math.max(0.5, Math.min(2.5, e.scale)),
          5,
          resolvedWin * 6,
        );
        runOnJS(setPinchWindow)(next);
      })
      .onEnd(() => {
        runOnJS(setPinchWindow)(null);
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [pinchToZoom, resolvedWin, scrub]);

  return (
    <View style={[styles.root, { height }, style]}>
      {windows?.length ? (
        <View style={styles.row}>
          {windows.map((entry) => (
            <ControlPill
              key={entry.secs}
              active={resolvedWin === entry.secs && pinchWindow == null}
              label={entry.label}
              color={palette.accent}
              inactiveBorderColor={palette.border}
              inactiveBgColor={chartColors?.controlBarBg ?? palette.surface}
              inactiveTextColor={chartColors?.controlInactiveText ?? palette.gridLabel}
              onPress={() => onWindowChange?.(entry.secs)}
            />
          ))}
        </View>
      ) : null}

      {series.length > 1 ? (
        <View style={styles.row}>
          {series.map((entry) => (
            <ControlPill
              key={entry.id}
              active={!hiddenSeries.has(entry.id)}
              label={seriesToggleCompact ? '•' : entry.label ?? entry.id}
              color={entry.color}
              inactiveBorderColor={palette.border}
              inactiveBgColor={chartColors?.controlBarBg ?? palette.surface}
              inactiveTextColor={chartColors?.controlInactiveText ?? palette.gridLabel}
              onPress={() => handleSeriesToggle(entry.id)}
            />
          ))}
        </View>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View style={[styles.shell, { backgroundColor: palette.surface }]}>
          <View
            style={[styles.plot, { backgroundColor: palette.plotSurface }]}
            onLayout={(event) => {
              const { width, height: nextHeight } = event.nativeEvent.layout;
              setLayout({ width, height: nextHeight });
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
                pal={palette}
              />
            ) : (
              <>
                <Canvas style={StyleSheet.absoluteFill}>
                  <GridCanvas
                    grid
                    gridLabels={gridLabels}
                    timeLabels={timeLabels}
                    pad={pad}
                    layoutWidth={layout.width}
                    baseY={layout.height - pad.bottom}
                    opacity={1}
                    pal={palette}
                  />

                  {referenceLine ? (
                    <ReferenceLineCanvas
                      label={referenceLine.label}
                      y={toScreenYJs(
                        referenceLine.value,
                        displayMin,
                        displayMax,
                        layout.height,
                        pad,
                      )}
                      opacity={1}
                      padLeft={pad.left}
                      padRight={pad.right}
                      layoutWidth={layout.width}
                      lineColor={palette.refLine}
                    />
                  ) : null}

                  {preparedSeries.map((entry, index) => (
                    <AnimatedSeriesStroke
                      key={entry.id}
                      clipRect={clipRect}
                      points={entry.points}
                      tipT={engine.svTipT}
                      tipV={engine.getSeriesTipV(entry.id)}
                      min={engine.svMin}
                      max={engine.svMax}
                      width={layout.width}
                      height={layout.height}
                      pad={pad}
                      win={activeWindow}
                      buffer={winBuffer}
                      lineWidth={entry.palette.lineWidth}
                      lineColor={entry.palette.accent}
                      fill={fill}
                      fillOpacity={index === 0 ? 0.9 : 0.42}
                      fillStartColor={entry.palette.accentFillTop}
                      fillEndColor={entry.palette.accentFillBottom}
                      trailGlow={lineTrailGlow}
                      trailGlowColor={entry.palette.accentGlow}
                      gradientLineColoring={gradientLineColoring}
                      gradientStartColor={entry.palette.gridLabel}
                      gradientEndColor={entry.palette.accent}
                    />
                  ))}

                  {/* Endpoint dots + labels */}
                  {seriesPaths.map((entry) => (
                    <Group key={`dot-${entry.id}`}>
                      {lineTrailGlow ? (
                        <Circle
                          cx={entry.liveX}
                          cy={entry.liveY}
                          r={dvPulseRingR}
                          color={entry.color}
                          opacity={dvPulseRingOp}
                        />
                      ) : null}
                      <Circle cx={entry.liveX} cy={entry.liveY} r={7} color={entry.color} opacity={0.18} />
                      <Circle cx={entry.liveX} cy={entry.liveY} r={4.25} color={entry.color} />
                      <Circle cx={entry.liveX} cy={entry.liveY} r={1.8} color={palette.badgeText} opacity={0.72} />
                    </Group>
                  ))}

                  {/* Dashed price line for primary series */}
                  {badge && seriesPaths[0] ? (
                    <Group opacity={0.7}>
                      <SkiaLine
                        p1={vec(pad.left, seriesPaths[0].liveY)}
                        p2={vec(layout.width - pad.right, seriesPaths[0].liveY)}
                        color={palette.dashLine}
                        strokeWidth={1}
                      >
                        <DashPathEffect intervals={[4, 4]} />
                      </SkiaLine>
                    </Group>
                  ) : null}

                  {/* Crosshair */}
                  {scrubInfo ? (
                    <>
                      <CrosshairCanvas
                        lineP1={vec(scrubInfo.x, pad.top)}
                        lineP2={vec(scrubInfo.x, layout.height - pad.bottom)}
                        lineOpacity={0.6}
                        dotX={scrubInfo.x}
                        dotY={scrubInfo.values[0]?.y ?? -100}
                        dotRadius={0}
                        dotOpacity={0}
                        lineColor={palette.crosshair}
                        dotColor={palette.accent}
                      />
                      {scrubInfo.values.map((entry) => (
                        <Circle
                          key={`scrub-${entry.id}`}
                          cx={scrubInfo.x}
                          cy={entry.y}
                          r={4}
                          color={entry.color}
                        />
                      ))}
                    </>
                  ) : null}

                  {/* Left edge fade */}
                  <Group blendMode="dstOut">
                    <Rect x={0} y={0} width={pad.left + FADE_EDGE_WIDTH} height={layout.height}>
                      <LinearGradient
                        start={vec(pad.left, 0)}
                        end={vec(pad.left + FADE_EDGE_WIDTH, 0)}
                        colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
                      />
                    </Rect>
                  </Group>
                </Canvas>

                <AxisLabels
                  grid
                  gridLabels={gridLabels}
                  timeLabels={timeLabels}
                  pad={pad}
                  layoutWidth={layout.width}
                  baseY={layout.height - pad.bottom}
                  pal={palette}
                  styles={{ yLabel: styles.axisY, tLabel: styles.axisT }}
                />

                {referenceLine?.label ? (
                  <ReferenceLineLabel
                    label={referenceLine.label}
                    y={toScreenYJs(
                      referenceLine.value,
                      displayMin,
                      displayMax,
                      layout.height,
                      pad,
                    )}
                    opacity={1}
                    padLeft={pad.left}
                    padRight={pad.right}
                    layoutWidth={layout.width}
                    color={palette.refLabel}
                    textStyle={styles.referenceLabel}
                  />
                ) : null}

                {/* Series endpoint labels */}
                {seriesPaths.map((entry) =>
                  entry.label ? (
                    <View
                      key={`label-${entry.id}`}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: entry.liveX + 8,
                        top: entry.liveY - 7,
                      }}
                    >
                      <Text style={[styles.seriesLabel, { color: entry.color }]}>
                        {entry.label}
                      </Text>
                    </View>
                  ) : null,
                )}

                {/* Scrub tooltip */}
                {scrubInfo ? (
                  <View pointerEvents="none" style={[styles.tooltip, { top: pad.top + 8 }]}>
                    <Text style={[styles.tooltipText, { color: palette.tooltipText }]}>
                      {formatTime(scrubInfo.time)}
                    </Text>
                    {scrubInfo.values.map((entry) => (
                      <Text key={entry.id} style={[styles.tooltipText, { color: entry.color }]}>
                        {`${entry.label}: ${formatValue(entry.value)}`}
                      </Text>
                    ))}
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

function ControlPill({
  active,
  label,
  color,
  inactiveBorderColor,
  inactiveBgColor,
  inactiveTextColor,
  onPress,
}: {
  active: boolean;
  label: string;
  color: string;
  inactiveBorderColor: string;
  inactiveBgColor: string;
  inactiveTextColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        {
          borderColor: active ? `${color}66` : inactiveBorderColor,
          backgroundColor: active ? `${color}18` : inactiveBgColor,
        },
      ]}
    >
      <Text style={[styles.pillText, { color: active ? color : inactiveTextColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  shell: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  plot: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: '500' },
  axisY: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '400',
    fontFamily: mono,
  },
  axisT: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '400',
    fontFamily: mono,
    textAlign: 'center',
  },
  referenceLabel: { fontFamily: mono, fontSize: 11, fontWeight: '500' },
  tooltip: {
    position: 'absolute',
    left: 12,
    gap: 2,
  },
  tooltipText: {
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '500',
  },
  seriesLabel: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '600',
  },
});
