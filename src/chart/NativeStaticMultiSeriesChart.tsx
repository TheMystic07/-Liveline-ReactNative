import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Rect,
  rect,
  vec,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue } from 'react-native-reanimated';

import {
  BADGE_LINE_H,
  BADGE_PAD_X,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
  BADGE_TAIL_SPREAD,
  badgeSvgPath,
} from './draw/badge';
import { buildPath } from './draw/buildLiveLinePath';
import { useStaticDrawAnimation } from './hooks/useStaticDrawAnimation';
import { useStaticScrub } from './hooks/useStaticScrub';
import { useStaticWindowTransition } from './hooks/useStaticWindowTransition';
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
import type {
  ChartPadding,
  LiveLinePoint,
  LiveLineTheme,
  LiveLineWindowStyle,
} from './types';
import { resolvePalette } from './theme';
import type { StaticChartProps } from './staticTypes';
import { AxisLabels } from './render/AxisLabels';
import { BadgeOverlay } from './render/BadgeOverlay';
import { ChartControlRow, type ChartControlOption } from './ChartControlRow';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { GridCanvas } from './render/GridCanvas';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { useTrackedGridLabels, useTrackedTimeLabels } from './render/useTrackedAxisLabels';

const FADE_EDGE_WIDTH = 40;
const WIN_BUF = 0.015;
const WIN_BUF_BADGE = 0.05;
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

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

function buildWindowControls(
  windows: StaticChartProps['windows'],
  resolvedWin: number,
  pinchWindow: number | null,
  onWindowChange?: (secs: number) => void,
): ChartControlOption[] {
  return (
    windows?.map((entry) => ({
      key: entry.secs,
      label: entry.label,
      active: pinchWindow == null && resolvedWin === entry.secs,
      onPress: () => onWindowChange?.(entry.secs),
    })) ?? []
  );
}

export function NativeStaticMultiSeriesChart({
  series = [],
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
  fill = true,
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
  pinchToZoom = false,
  scrubHaptics: scrubHapticsProp = true,
  tooltipY = 14,
  drawDuration = 1200,
  drawEasing = 'ease-out',
  onDrawComplete,
  onHover,
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
  const buf = badge ? WIN_BUF_BADGE : WIN_BUF;

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

  const primaryPal = useMemo(
    () => resolvePalette(series[0]?.color ?? color, theme, lineWidthProp, chartColors),
    [chartColors, color, lineWidthProp, series, theme],
  );
  const visibleSeries = series.length > 0 ? series : [];
  const latestTime = useMemo(
    () =>
      visibleSeries.reduce(
        (mx, entry) => Math.max(mx, entry.data[entry.data.length - 1]?.time ?? 0),
        0,
      ),
    [visibleSeries],
  );
  const animationKey = useMemo(
    () =>
      `${visibleSeries
        .map(
          (entry) =>
            `${entry.id}:${entry.data.length}:${entry.data[0]?.time ?? 0}:${entry.data[entry.data.length - 1]?.time ?? 0}:${entry.value}`,
        )
        .join('|')}`,
    [visibleSeries],
  );

  const rightEdge = latestTime + win * buf;
  const leftEdge = rightEdge - win;

  const preparedSeries = useMemo(
    () =>
      visibleSeries.map((entry) => {
        const filteredData = entry.data.filter(
          (point) => point.time >= leftEdge - 2 && point.time <= rightEdge + 1,
        );
        const lastVal = entry.data.length > 0 ? entry.data[entry.data.length - 1]!.value : 0;
        return {
          ...entry,
          filteredData,
          lastVal,
          palette: resolvePalette(entry.color ?? color, theme, lineWidthProp, chartColors),
          linePalette: resolvePalette(entry.color ?? color, theme, lineWidthProp),
        };
      }),
    [chartColors, color, leftEdge, lineWidthProp, rightEdge, theme, visibleSeries],
  );

  const empty =
    loading || layout.width <= 0 || preparedSeries.every((entry) => entry.filteredData.length < 2);

  const rng = useMemo(
    () =>
      computeUnionRange(
        preparedSeries.map((entry) => ({ data: entry.filteredData, value: entry.lastVal })),
        referenceLine?.value,
      ),
    [preparedSeries, referenceLine?.value],
  );

  const seriesPaths = useMemo(
    () =>
      !empty && layout.width > 0
        ? preparedSeries.map((entry) =>
            buildPath(
              entry.data,
              latestTime,
              entry.lastVal,
              rng.min,
              rng.max,
              layout.width,
              layout.height,
              pad,
              win,
              buf,
              false,
            ),
          )
        : [],
    [buf, empty, latestTime, layout.height, layout.width, pad, preparedSeries, rng.max, rng.min, win],
  );
  const seriesFillPaths = useMemo(
    () =>
      !empty && layout.width > 0
        ? preparedSeries.map((entry) =>
            buildPath(
              entry.data,
              latestTime,
              entry.lastVal,
              rng.min,
              rng.max,
              layout.width,
              layout.height,
              pad,
              win,
              buf,
              true,
            ),
          )
        : [],
    [buf, empty, latestTime, layout.height, layout.width, pad, preparedSeries, rng.max, rng.min, win],
  );

  const gridTicks = useMemo(
    () =>
      grid && !empty && layout.width > 0
        ? calcGridTicksJs(rng.min, rng.max, chartH, layout.height, pad, formatValue)
        : [],
    [chartH, empty, formatValue, grid, layout.height, layout.width, pad, rng.max, rng.min],
  );
  const trackedGridLabels = useTrackedGridLabels(gridTicks);
  const timeTicks = useMemo(
    () =>
      !empty && layout.width > 0
        ? calcTimeTicksJs(leftEdge, rightEdge, layout.width, pad, formatTime)
        : [],
    [empty, formatTime, layout.width, leftEdge, pad, rightEdge],
  );
  const trackedTimeLabels = useTrackedTimeLabels(timeTicks);
  const primaryDrawEndX = useMemo(() => {
    if (layout.width <= 0 || latestTime <= 0) return pad.left;
    const x = toScreenXJs(latestTime, leftEdge, rightEdge, layout.width, pad);
    return clamp(x, pad.left, layout.width - pad.right);
  }, [latestTime, layout.width, leftEdge, pad, rightEdge]);
  const drawRevealWidth = useMemo(
    () => clamp(primaryDrawEndX - pad.left, 0, chartW),
    [chartW, pad.left, primaryDrawEndX],
  );

  const { drawComplete, dvClipRect, dvDrawDotX, dvGridOp, dvDrawDotOp, dvEndDotOp } =
    useStaticDrawAnimation({
      ready: !empty && layout.width > 0,
      chartWidth: drawRevealWidth,
      chartHeight: layout.height,
      padLeft: pad.left,
      animationKey,
      duration: drawDuration,
      easing: drawEasing,
      onComplete: onDrawComplete,
    });

  const primary = preparedSeries[0];
  const tipT = latestTime;
  const tipV = primary?.lastVal ?? 0;

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
    data: primary?.data ?? [],
    snapToPoint: snapToPointScrubbing,
    haptics: scrubHapticsProp,
    isCandle: false,
    onHoverSample,
  });

  const clipRect = useMemo(
    () => (chartW > 0 && chartH > 0 ? rect(pad.left - 1, pad.top, chartW + 2, chartH) : undefined),
    [chartH, chartW, pad.left, pad.top],
  );
  const svPrimaryData = useSharedValue<LiveLinePoint[]>(primary?.data ? [...primary.data] : []);

  useEffect(() => {
    svPrimaryData.value = primary?.data ? [...primary.data] : [];
  }, [primary?.data, svPrimaryData]);

  const dvDrawDotY = useDerivedValue(() => {
    if (!primary || layout.width <= 0) return 0;
    const dotX = dvDrawDotX.value;
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const re = tipT + win * buf;
    const le = re - win;
    const t = le + ((dotX - pad.left) / cw) * (re - le);
    const v = interpAtTimeJs(svPrimaryData.value, t) ?? tipV;
    const span = Math.max(0.0001, rng.max - rng.min);
    const ch = Math.max(1, layout.height - pad.top - pad.bottom);
    return pad.top + (1 - (v - rng.min) / span) * ch;
  }, [buf, dvDrawDotX, layout.height, layout.width, pad, primary, rng.max, rng.min, svPrimaryData, tipT, tipV, win]);

  const endDots = useMemo(
    () =>
      preparedSeries.map((entry) => ({
        x: toScreenXJs(latestTime, leftEdge, rightEdge, layout.width, pad),
        y: toScreenYJs(entry.lastVal, rng.min, rng.max, layout.height, pad),
        color: entry.palette.accent,
      })),
    [latestTime, layout.height, layout.width, leftEdge, pad, preparedSeries, rightEdge, rng.max, rng.min],
  );

  const multiScrubInfo = useMemo(() => {
    if (!scrubTip) return null;
    const values = preparedSeries
      .map((entry) => {
        const nearest = snapToPointScrubbing
          ? nearestPointAtTimeJs(entry.data, scrubTip.ht)
          : null;
        const value = nearest ? nearest.value : interpAtTimeJs(entry.data, scrubTip.ht);
        if (value == null) return null;
        return {
          id: entry.id,
          label: entry.label ?? entry.id,
          color: entry.palette.accent,
          value,
          y: toScreenYJs(value, rng.min, rng.max, layout.height, pad),
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
    return { x: scrubTip.hx, time: scrubTip.ht, values };
  }, [layout.height, pad, preparedSeries, rng.max, rng.min, scrubTip, snapToPointScrubbing]);

  const dvReferenceY = useDerivedValue(
    () =>
      referenceLine ? toScreenYJs(referenceLine.value, rng.min, rng.max, layout.height, pad) : 0,
    [layout.height, pad, referenceLine, rng.max, rng.min],
  );
  const primaryLiveX = endDots[0]?.x ?? 0;
  const dvHoverX = useDerivedValue(() => {
    if (!scrub || svScrubOp.value <= 0.01) return -100;
    return clamp(svScrubX.value, pad.left, primaryLiveX);
  }, [scrub, pad.left, primaryLiveX]);
  const dvHoverY = useDerivedValue(
    () => (scrub && svScrubOp.value > 0.01 ? toScreenYJs(svScrubHv.value, rng.min, rng.max, layout.height, pad) : -100),
    [layout.height, pad, rng.max, rng.min, scrub, svScrubHv],
  );
  const dvCrossEffectiveOp = useDerivedValue(() => {
    const scrubAmt = svScrubOp.value;
    if (scrubAmt <= 0.01) return 0;
    const cw = Math.max(1, layout.width - pad.left - pad.right);
    const dist = primaryLiveX - dvHoverX.value;
    const fadeStart = Math.min(80, cw * 0.3);
    if (dist < 5) return 0;
    if (dist >= fadeStart) return scrubAmt;
    return ((dist - 5) / (fadeStart - 5)) * scrubAmt;
  }, [layout.width, pad.left, pad.right, primaryLiveX]);
  const dvCrossP1 = useDerivedValue(() => vec(dvHoverX.value, pad.top), [pad.top]);
  const dvCrossP2 = useDerivedValue(
    () => vec(dvHoverX.value, layout.height - pad.bottom),
    [layout.height, pad.bottom],
  );
  const dvCrossLineOp = useDerivedValue(() => dvCrossEffectiveOp.value * 0.5);

  const [flowPillW, setFlowPillW] = useState(80);
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;
  const badgeStr = useMemo(() => formatValue(primary?.lastVal ?? 0), [formatValue, primary?.lastVal]);
  const svBadgeValue = useSharedValue(primary?.lastVal ?? 0);
  useEffect(() => {
    svBadgeValue.value = primary?.lastVal ?? 0;
  }, [primary?.lastVal, svBadgeValue]);
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
  const badgeY = endDots[0]?.y ?? 0;
  const asBadge = useAnimatedStyle(() => ({
      opacity: badge ? 1 - svScrubOp.value : 0,
      left: badgeX,
      top: badgeY - pillH / 2,
      width: BADGE_TAIL_LEN + badgePillW,
      height: pillH,
    }));
  const asBadgeTextWrap = useMemo(() => ({ opacity: 1 }), []);

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
    () => buildWindowControls(windows, resolvedWin, pinchWindow, onWindowChange),
    [onWindowChange, pinchWindow, resolvedWin, windows],
  );

  return (
    <View style={[styles.root, { height }, style]}>
      {windowControls.length > 0 ? (
        <ChartControlRow
          options={windowControls}
          theme={theme as LiveLineTheme}
          styleVariant={ws}
          marginLeft={pad.left}
          colors={chartColors}
        />
      ) : null}
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

                  <Group clip={dvClipRect}>
                    {seriesPaths.map((path, idx) => {
                      const entry = preparedSeries[idx]!;
                      return (
                        <Group key={entry.id} clip={clipRect}>
                          {fill ? (
                            <Path path={seriesFillPaths[idx] ?? ''} opacity={idx === 0 ? 0.9 : 0.42}>
                              <LinearGradient
                                start={vec(0, pad.top)}
                                end={vec(0, layout.height - pad.bottom)}
                                colors={[
                                  entry.palette.accentFillTop,
                                  entry.palette.accentFillBottom,
                                ]}
                              />
                            </Path>
                          ) : null}
                          {lineTrailGlow ? (
                            <Path
                              path={path}
                              style="stroke"
                              strokeWidth={entry.palette.lineWidth + 4}
                              strokeJoin="round"
                              strokeCap="round"
                              color={entry.palette.accentGlow}
                              opacity={0.5}
                            />
                          ) : null}
                          <Path
                            path={path}
                            style="stroke"
                            strokeWidth={entry.palette.lineWidth}
                            strokeJoin="round"
                            strokeCap="round"
                            color={gradientLineColoring ? undefined : entry.palette.accent}
                          >
                            {gradientLineColoring ? (
                              <LinearGradient
                                start={vec(0, pad.top)}
                                end={vec(layout.width - pad.right, layout.height)}
                                colors={[entry.linePalette.gridLabel, entry.palette.accent]}
                              />
                            ) : null}
                          </Path>
                        </Group>
                      );
                    })}
                  </Group>

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

                  <Group opacity={dvDrawDotOp}>
                    <Circle cx={dvDrawDotX} cy={dvDrawDotY} r={10} color={primaryPal.accentGlow} opacity={0.5} />
                    <Circle cx={dvDrawDotX} cy={dvDrawDotY} r={4} color={primaryPal.accent} />
                  </Group>

                  <Group opacity={dvEndDotOp}>
                    {endDots.map((dot, idx) => (
                      <Circle key={preparedSeries[idx]!.id} cx={dot.x} cy={dot.y} r={4} color={dot.color} />
                    ))}
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
                    dotRadius={0}
                    dotOpacity={0}
                    lineColor={primaryPal.crosshair}
                    dotColor={primaryPal.accent}
                  />
                  {multiScrubInfo
                    ? multiScrubInfo.values.map((entry) => (
                      <Circle
                        key={`scrub-${entry.id}`}
                        cx={multiScrubInfo.x}
                        cy={entry.y}
                        r={4}
                        color={entry.color}
                      />
                    ))
                    : null}
                </Canvas>

                {multiScrubInfo ? (
                  <View pointerEvents="none" style={[styles.tooltip, { top: pad.top + tooltipY + 10 }]}>
                    <Text style={[styles.tooltipText, { color: primaryPal.tooltipText }]}>
                      {formatTime(multiScrubInfo.time)}
                    </Text>
                    {multiScrubInfo.values.map((entry) => (
                      <Text key={entry.id} style={[styles.tooltipText, { color: entry.color }]}>
                        {`${entry.label}: ${formatValue(entry.value)}`}
                      </Text>
                    ))}
                  </View>
                ) : null}

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

                {preparedSeries.map((entry, index) =>
                  endDots[index] ? (
                    <View
                      key={`label-${entry.id}`}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: endDots[index]!.x + 8,
                        top: endDots[index]!.y - 7,
                      }}
                    >
                      <Text style={[styles.seriesLabel, { color: entry.palette.accent }]}>
                        {entry.label ?? entry.id}
                      </Text>
                    </View>
                  ) : null,
                )}

                <BadgeOverlay
                  badge={badge}
                  empty={empty}
                  variant={badgeVariant}
                  skiaBadgeFlow={false}
                  badgeNumFont={null}
                  badgeValue={svBadgeValue}
                  flowPillW={flowPillW}
                  badgeStr={badgeStr}
                  badgeStyle={asBadge}
                  badgeTextWrapStyle={asBadgeTextWrap}
                  backgroundPath={badgeBgPath}
                  innerPath={badgeInnerPath}
                  innerColor={primary?.palette.accent ?? primaryPal.accent}
                  pillH={pillH}
                  onBadgeTemplateLayout={onBadgeTemplateLayout}
                  pal={primaryPal}
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
  badgeTxt: { fontFamily: mono, fontSize: 12, fontWeight: '600', letterSpacing: 0.15 },
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
  yLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono },
  tLabel: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '400',
    fontFamily: mono,
    textAlign: 'center',
  },
  seriesLabel: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '600',
  },
});
