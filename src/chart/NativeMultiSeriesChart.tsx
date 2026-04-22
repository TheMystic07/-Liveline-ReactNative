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
import { runOnJS } from 'react-native-reanimated';

import { buildPath } from './draw/buildLiveLinePath';
import { lerp as lerpFr } from './math/lerp';
import { resolvePalette } from './theme';
import { GridCanvas } from './render/GridCanvas';
import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import type { LiveLineChartProps, LiveLinePoint } from './types';
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
const FADE_EDGE_WIDTH = 40;
const RANGE_LERP_SPEED = 0.15;
const RANGE_ADAPTIVE_BOOST = 0.2;
const ADAPTIVE_SPEED_BOOST = 0.2;
const VALUE_SNAP_THRESHOLD = 0.001;
const LIVE_TIP_CLOCK_CATCHUP = 0.42;
const MAX_DELTA_MS = 50;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type SmoothFrame = {
  min: number;
  max: number;
  tipT: number;
  seriesTips: Record<string, number>;
};

function buildSeriesTips(
  series: ReadonlyArray<{ id: string; value: number }>,
  prev?: Record<string, number>,
) {
  const next: Record<string, number> = {};
  for (const entry of series) {
    next[entry.id] = prev?.[entry.id] ?? entry.value;
  }
  return next;
}

function buildSeriesPath(
  points: LiveLinePoint[],
  tipT: number,
  tipV: number,
  lo: number,
  hi: number,
  w: number,
  h: number,
  pad: { top: number; right: number; bottom: number; left: number },
  win: number,
  buffer: number,
) {
  return buildPath(points, tipT, tipV, lo, hi, w, h, pad, win, buffer, false);
}

function computeUnionRange(
  series: Array<{ points: LiveLinePoint[]; value: number }>,
  referenceValue?: number,
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
  const minRange = rawRange * 0.1 || 0.4;
  if (rawRange < minRange) {
    const mid = (min + max) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  const margin = rawRange * 0.12;
  return { min: min - margin, max: max + margin };
}

export function NativeMultiSeriesChart({
  series = [],
  theme = 'dark',
  color = '#3b82f6',
  window: controlledWin = 30,
  windows,
  onWindowChange,
  referenceLine,
  badge = true,
  scrub = true,
  snapToPointScrubbing = false,
  pinchToZoom = false,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  height = 300,
  emptyText = 'Waiting for ticks',
  loading = false,
  style,
  contentInset,
  onSeriesToggle,
  seriesToggleCompact = false,
  lerpSpeed = 0.08,
}: LiveLineChartProps) {
  const palette = resolvePalette(series[0]?.color ?? color, theme, undefined);
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
  const dataRightEdge = latestTime + activeWindow * MULTI_WIN_BUF;
  const dataLeftEdge = dataRightEdge - activeWindow;

  const preparedSeries = useMemo(() => {
    return visibleSeries.map((entry) => {
      const points = entry.data.filter(
        (point) => point.time >= dataLeftEdge - 2 && point.time <= dataRightEdge + 1,
      );
      return { ...entry, points };
    });
  }, [dataLeftEdge, dataRightEdge, visibleSeries]);

  const empty = loading || layout.width <= 0 || preparedSeries.every((entry) => entry.points.length < 2);

  const targetRange = useMemo(
    () => computeUnionRange(preparedSeries, referenceLine?.value),
    [preparedSeries, referenceLine?.value],
  );
  const visibleTargets = useMemo(
    () => visibleSeries.map((entry) => ({ id: entry.id, value: entry.value })),
    [visibleSeries],
  );
  const [display, setDisplay] = useState<SmoothFrame>(() => ({
    min: targetRange.min,
    max: targetRange.max,
    tipT: latestTime,
    seriesTips: buildSeriesTips(visibleTargets),
  }));
  const displayRef = useRef<SmoothFrame>(display);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const syncBase: SmoothFrame = {
      min: targetRange.min,
      max: targetRange.max,
      tipT: latestTime,
      seriesTips: buildSeriesTips(visibleTargets, displayRef.current.seriesTips),
    };

    if (empty) {
      displayRef.current = syncBase;
      setDisplay(syncBase);
      return;
    }

    displayRef.current = {
      ...displayRef.current,
      seriesTips: buildSeriesTips(visibleTargets, displayRef.current.seriesTips),
    };

    let rafId = 0;
    let lastFrame = 0;

    const tick = (nowMs: number) => {
      const prev = displayRef.current;
      const dt = lastFrame === 0 ? 16.67 : Math.min(MAX_DELTA_MS, nowMs - lastFrame);
      lastFrame = nowMs;

      const targetT = Math.max(Date.now() / 1000, latestTime);
      let nextTipT = lerpFr(prev.tipT, targetT, LIVE_TIP_CLOCK_CATCHUP, dt);
      if (Math.abs(nextTipT - targetT) < 0.002) nextTipT = targetT;

      const currentRange = Math.max(1e-4, prev.max - prev.min);
      const targetRangeSpan = Math.max(1e-4, targetRange.max - targetRange.min);
      const rangeGap = Math.abs(currentRange - targetRangeSpan);
      const rangeSpeed =
        RANGE_LERP_SPEED + Math.min(rangeGap / currentRange, 1) * RANGE_ADAPTIVE_BOOST;
      let nextMin = lerpFr(prev.min, targetRange.min, rangeSpeed, dt);
      let nextMax = lerpFr(prev.max, targetRange.max, rangeSpeed, dt);
      if (Math.abs(nextMin - targetRange.min) < currentRange * VALUE_SNAP_THRESHOLD) {
        nextMin = targetRange.min;
      }
      if (Math.abs(nextMax - targetRange.max) < currentRange * VALUE_SNAP_THRESHOLD) {
        nextMax = targetRange.max;
      }

      const nextRange = Math.max(1e-4, nextMax - nextMin);
      const nextSeriesTips = buildSeriesTips(visibleTargets, prev.seriesTips);
      let converged = Math.abs(nextTipT - targetT) < 0.002;

      for (const entry of visibleTargets) {
        const currentValue = prev.seriesTips[entry.id] ?? entry.value;
        const gap = Math.abs(entry.value - currentValue);
        const speed =
          lerpSpeed + (1 - Math.min(gap / nextRange, 1)) * ADAPTIVE_SPEED_BOOST;
        let nextValue = lerpFr(currentValue, entry.value, speed, dt);
        if (Math.abs(nextValue - entry.value) < nextRange * VALUE_SNAP_THRESHOLD) {
          nextValue = entry.value;
        }
        nextSeriesTips[entry.id] = nextValue;
        if (Math.abs(nextValue - entry.value) >= 1e-4) converged = false;
      }

      if (Math.abs(nextMin - targetRange.min) >= 1e-4 || Math.abs(nextMax - targetRange.max) >= 1e-4) {
        converged = false;
      }

      const nextFrame: SmoothFrame = {
        min: nextMin,
        max: nextMax,
        tipT: nextTipT,
        seriesTips: nextSeriesTips,
      };

      displayRef.current = nextFrame;
      setDisplay(nextFrame);

      if (!converged) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [empty, latestTime, lerpSpeed, targetRange.max, targetRange.min, visibleTargets]);

  const displayMin = display.min;
  const displayMax = display.max;
  const displayTipT = display.tipT;
  const rightEdge = displayTipT + activeWindow * MULTI_WIN_BUF;
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

  // Build paths using SMOOTHED range and tip values
  const seriesPaths = useMemo(() => {
    return preparedSeries.map((entry) => {
      const smoothedValue = display.seriesTips[entry.id] ?? entry.value;
      const path = buildSeriesPath(
        entry.points,
        displayTipT,
        smoothedValue,
        displayMin,
        displayMax,
        layout.width,
        layout.height,
        pad,
        activeWindow,
        MULTI_WIN_BUF,
      );
      const liveX = toScreenXJs(displayTipT, leftEdge, rightEdge, layout.width, pad);
      const liveY = toScreenYJs(smoothedValue, displayMin, displayMax, layout.height, pad);
      return {
        id: entry.id,
        color: entry.color,
        label: entry.label ?? entry.id,
        path,
        liveX,
        liveY,
        points: entry.points,
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
    activeWindow,
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
        const value = snap ? snap.value : interpAtTimeJs(entry.points, scrubTime);
        if (value == null) return null;
        return {
          id: entry.id,
          label: entry.label,
          color: entry.color,
          value,
          y: toScreenYJs(value, displayMin, displayMax, layout.height, pad),
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

                  {seriesPaths.map((entry) => (
                    <Group key={entry.id} clip={clipRect}>
                      <Path
                        path={entry.path}
                        style="stroke"
                        strokeWidth={2}
                        strokeJoin="round"
                        strokeCap="round"
                        color={entry.color}
                      />
                    </Group>
                  ))}

                  {/* Endpoint dots + labels */}
                  {seriesPaths.map((entry) => (
                    <Group key={`dot-${entry.id}`}>
                      <Circle cx={entry.liveX} cy={entry.liveY} r={3} color={entry.color} />
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
  onPress,
}: {
  active: boolean;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        {
          borderColor: active ? `${color}66` : 'rgba(255,255,255,0.08)',
          backgroundColor: active ? `${color}18` : 'rgba(255,255,255,0.02)',
        },
      ]}
    >
      <Text style={[styles.pillText, { color: active ? color : 'rgba(255,255,255,0.48)' }]}>
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
