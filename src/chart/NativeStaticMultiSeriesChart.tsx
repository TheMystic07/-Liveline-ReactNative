import { useCallback, useMemo, useState } from 'react';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { resolvePalette } from './theme';
import { buildPath } from './draw/buildLiveLinePath';
import type { ChartPadding, LiveLinePoint, LiveLineSeries } from './types';
import type { StaticChartProps } from './staticTypes';
import {
  calcGridTicksJs,
  calcTimeTicksJs,
  defaultFormatTime,
  defaultFormatValue,
  interpAtTimeJs,
  toScreenXJs,
  toScreenYJs,
} from './nativeChartUtils';

import { useStaticDrawAnimation } from './hooks/useStaticDrawAnimation';
import { useStaticScrub } from './hooks/useStaticScrub';

import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { GridCanvas } from './render/GridCanvas';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { ScrubTooltip } from './render/ScrubTooltip';
import { useTrackedGridLabels, useTrackedTimeLabels } from './render/useTrackedAxisLabels';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FADE_EDGE_WIDTH = 40;
const WIN_BUF = 0.015;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function computeUnionRange(
  seriesArr: Array<{ data: readonly LiveLinePoint[]; value: number }>,
  referenceValue?: number,
) {
  let min = Infinity;
  let max = -Infinity;
  for (const entry of seriesArr) {
    for (const point of entry.data) {
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
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
  const rawRange = max - min;
  const minRange = rawRange * 0.1 || 0.4;
  if (rawRange < minRange) {
    const mid = (min + max) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  const margin = rawRange * 0.12;
  return { min: min - margin, max: max + margin };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NativeStaticMultiSeriesChart({
  series = [],
  data: dataProp = [],
  theme = 'dark',
  color = '#3b82f6',
  lineWidth: lineWidthProp,
  window: controlledWin = 30,
  windows,
  onWindowChange,
  grid = true,
  badge = true,
  referenceLine,
  lineTrailGlow = true,
  gradientLineColoring = false,
  height = 300,
  emptyText = 'No data',
  loading = false,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  scrub = true,
  snapToPointScrubbing = false,
  scrubHaptics: scrubHapticsProp = true,
  tooltipY = 14,
  tooltipOutline = true,
  drawDuration = 1200,
  drawEasing = 'ease-out',
  onDrawComplete,
  style,
  contentInset,
}: StaticChartProps) {
  const win = controlledWin;
  const buf = WIN_BUF;

  /* ---- Layout ---- */
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const pad: ChartPadding = useMemo(
    () => ({
      top: contentInset?.top ?? 12,
      right: contentInset?.right ?? 60,
      bottom: contentInset?.bottom ?? 28,
      left: contentInset?.left ?? 12,
    }),
    [contentInset],
  );
  const chartW = Math.max(0, layout.width - pad.left - pad.right);
  const chartH = Math.max(0, layout.height - pad.top - pad.bottom);

  /* ---- Palette ---- */
  const primaryPal = useMemo(
    () => resolvePalette(series[0]?.color ?? color, theme, lineWidthProp),
    [series, color, theme, lineWidthProp],
  );

  /* ---- Data prep ---- */
  const visibleSeries = series.length > 0 ? series : [];

  const latestTime = useMemo(
    () =>
      visibleSeries.reduce(
        (mx, s) => Math.max(mx, s.data[s.data.length - 1]?.time ?? 0),
        0,
      ),
    [visibleSeries],
  );

  const rightEdge = latestTime + win * buf;
  const leftEdge = rightEdge - win;

  const preparedSeries = useMemo(
    () =>
      visibleSeries.map((s) => {
        const filteredData = s.data.filter(
          (p) => p.time >= leftEdge - 2 && p.time <= rightEdge + 1,
        );
        const lastVal = s.data.length > 0 ? s.data[s.data.length - 1]!.value : 0;
        const pal = resolvePalette(s.color ?? color, theme, lineWidthProp);
        return { ...s, filteredData, lastVal, palette: pal };
      }),
    [visibleSeries, leftEdge, rightEdge, color, theme, lineWidthProp],
  );

  const empty = loading || layout.width <= 0 || preparedSeries.every((s) => s.filteredData.length < 2);

  const rng = useMemo(
    () =>
      computeUnionRange(
        preparedSeries.map((s) => ({ data: s.filteredData, value: s.lastVal })),
        referenceLine?.value,
      ),
    [preparedSeries, referenceLine?.value],
  );

  // Build paths (once per series)
  const seriesPaths = useMemo(
    () =>
      !empty && layout.width > 0
        ? preparedSeries.map((s) =>
            buildPath(
              s.data, latestTime, s.lastVal,
              rng.min, rng.max,
              layout.width, layout.height,
              pad, win, buf, false,
            ),
          )
        : [],
    [preparedSeries, latestTime, rng, layout, pad, win, buf, empty],
  );

  /* ---- Grid / Axis ---- */
  const gridTicks = useMemo(
    () =>
      grid && !empty && layout.width > 0
        ? calcGridTicksJs(rng.min, rng.max, chartH, layout.height, pad, formatValue)
        : [],
    [grid, rng, chartH, layout.height, pad, formatValue, empty],
  );
  const trackedGridLabels = useTrackedGridLabels(gridTicks);

  const timeTicks = useMemo(
    () =>
      !empty && layout.width > 0
        ? calcTimeTicksJs(leftEdge, rightEdge, layout.width, pad, formatTime)
        : [],
    [leftEdge, rightEdge, layout.width, pad, formatTime, empty],
  );
  const trackedTimeLabels = useTrackedTimeLabels(timeTicks);

  /* ---- Draw animation ---- */
  const {
    drawComplete,
    dvClipRect,
    dvDrawDotX,
    dvGridOp,
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

  /* ---- Primary series for scrub ---- */
  const primary = preparedSeries[0];
  const tipT = latestTime;
  const tipV = primary?.lastVal ?? 0;

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
    data: primary?.data ?? [],
    snapToPoint: snapToPointScrubbing,
    haptics: scrubHapticsProp,
    isCandle: false,
  });

  /* ---- Derived values ---- */
  const clipRect = useMemo(
    () =>
      chartW > 0 && chartH > 0
        ? rect(pad.left - 1, pad.top, chartW + 2, chartH)
        : undefined,
    [chartW, chartH, pad.left, pad.top],
  );

  // Drawing dot Y (follows primary series)
  const dvDrawDotY = useDerivedValue(() => {
    if (!primary || layout.width <= 0) return 0;
    const dotX = dvDrawDotX.value;
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const re = tipT + win * buf;
    const le = re - win;
    const t = le + ((dotX - pad.left) / cw) * (re - le);
    const v = interpAtTimeJs(primary.data, t) ?? tipV;
    const span = Math.max(0.0001, rng.max - rng.min);
    const ch = Math.max(1, layout.height - pad.top - pad.bottom);
    return pad.top + (1 - (v - rng.min) / span) * ch;
  }, [primary, layout, pad, win, buf, tipT, tipV, rng]);

  // End dot positions for each series
  const endDots = useMemo(
    () =>
      preparedSeries.map((s) => ({
        x: toScreenXJs(latestTime, leftEdge, rightEdge, layout.width, pad),
        y: toScreenYJs(s.lastVal, rng.min, rng.max, layout.height, pad),
        color: s.palette.accent,
      })),
    [preparedSeries, latestTime, leftEdge, rightEdge, layout, pad, rng],
  );

  // Reference line
  const dvReferenceY = useDerivedValue(
    () =>
      referenceLine
        ? toScreenYJs(referenceLine.value, rng.min, rng.max, layout.height, pad)
        : 0,
    [referenceLine, rng, layout.height, pad],
  );

  // Crosshair
  const dvHoverX = useDerivedValue(() => svScrubX.value);
  const dvHoverY = useDerivedValue(() => {
    if (!scrubTip) return 0;
    return toScreenYJs(svScrubHv.value, rng.min, rng.max, layout.height, pad);
  }, [rng, layout.height, pad, scrubTip]);
  const dvCrossP1 = useDerivedValue(() => vec(svScrubX.value, pad.top), [pad.top]);
  const dvCrossP2 = useDerivedValue(
    () => vec(svScrubX.value, layout.height - pad.bottom),
    [layout.height, pad.bottom],
  );
  const dvCrossLineOp = useDerivedValue(() => svScrubOp.value * 0.3);
  const dvCrossDotR = useDerivedValue(() => (svScrubOp.value > 0.01 ? 4.5 : 0));
  const dvCrossDotOp = useDerivedValue(() => svScrubOp.value);

  // Scrub tip layout
  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || layout.width < 300) return null;
    const v = formatValue(scrubTip.hv);
    const t = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const totalW = v.length * charW + sep.length * charW + t.length * charW;
    const liveX = endDots[0]?.x ?? 0;
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v, t, sep };
  }, [scrubTip, layout.width, formatValue, formatTime, endDots, pad]);

  const dvScrubValueStr = useDerivedValue(() => {
    'worklet';
    return String(svScrubHv.value.toFixed(2));
  });

  const baseY = layout.height - pad.bottom;

  const gesture = useMemo(
    () => Gesture.Simultaneous(scrubGesture),
    [scrubGesture],
  );

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <View style={[styles.root, { height }, style]}>
      <GestureDetector gesture={gesture}>
        <View style={[styles.shell, { backgroundColor: primaryPal.surface }]}>
          <View
            style={[styles.plot, { backgroundColor: primaryPal.plotSurface }]}
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
                pal={primaryPal}
              />
            ) : (
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
                    pal={primaryPal}
                  />

                  {/* Series lines (all clipped by draw animation) */}
                  <Group clip={dvClipRect}>
                    {seriesPaths.map((path, idx) => {
                      const s = preparedSeries[idx]!;
                      return (
                        <Group key={s.id} clip={clipRect}>
                          {lineTrailGlow ? (
                            <Path
                              path={path}
                              style="stroke"
                              strokeWidth={s.palette.lineWidth + 4}
                              strokeJoin="round"
                              strokeCap="round"
                              color={s.palette.accentGlow}
                              opacity={0.5}
                            />
                          ) : null}
                          <Path
                            path={path}
                            style="stroke"
                            strokeWidth={s.palette.lineWidth}
                            strokeJoin="round"
                            strokeCap="round"
                            color={s.palette.accent}
                          />
                        </Group>
                      );
                    })}
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
                      lineColor={primaryPal.refLine}
                    />
                  ) : null}

                  {/* Drawing dot (primary series) */}
                  <Group opacity={dvDrawDotOp}>
                    <Circle
                      cx={dvDrawDotX}
                      cy={dvDrawDotY}
                      r={10}
                      color={primaryPal.accentGlow}
                      opacity={0.5}
                    />
                    <Circle
                      cx={dvDrawDotX}
                      cy={dvDrawDotY}
                      r={4}
                      color={primaryPal.accent}
                    />
                  </Group>

                  {/* End dots (one per series, after draw completes) */}
                  <Group opacity={dvEndDotOp}>
                    {endDots.map((dot, idx) => (
                      <Circle
                        key={preparedSeries[idx]!.id}
                        cx={dot.x}
                        cy={dot.y}
                        r={4}
                        color={dot.color}
                      />
                    ))}
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
                    lineColor={primaryPal.crosshair}
                    dotColor={primaryPal.accent}
                  />
                </Canvas>

                {/* Scrub tooltip */}
                <ScrubTooltip
                  layout={scrub && scrubTipLayout ? scrubTipLayout : null}
                  top={pad.top + tooltipY + 10}
                  opacity={svScrubOp}
                  tooltipOutline={tooltipOutline}
                  skiaScrubFlow={false}
                  scrubTipFont={null as any}
                  scrubValue={dvScrubValueStr}
                  pal={primaryPal}
                  textStyle={styles.scrubTipText}
                />

                {/* Axis labels */}
                <AxisLabels
                  grid={grid}
                  gridLabels={trackedGridLabels}
                  timeLabels={trackedTimeLabels}
                  pad={pad}
                  layoutWidth={layout.width}
                  baseY={baseY}
                  pal={primaryPal}
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
                    color={primaryPal.refLabel}
                    textStyle={styles.referenceLabel}
                  />
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

const styles = StyleSheet.create({
  root: { gap: 6 },
  shell: { flex: 1, borderRadius: 12, padding: 0 },
  plot: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  scrubTipText: {
    fontFamily: mono,
    fontSize: 13,
    fontWeight: '400',
  },
  referenceLabel: { fontFamily: mono, fontSize: 11, fontWeight: '500' },
  yLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono },
  tLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono, textAlign: 'center' },
});
