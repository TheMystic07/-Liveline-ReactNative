import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  Path,
  vec,
} from '@shopify/react-native-skia';
import { useSkiaFont } from 'number-flow-react-native/skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BADGE_NUMBER_FLOW_FONT_SRC } from './BadgeSkiaNumberFlow';
import { supportsTwoDecimalNumberFlow } from './chartNumberFlow';
import {
  BADGE_LINE_H,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
  BADGE_TAIL_SPREAD,
  badgeSvgPath,
} from './draw/badge';
import { parseColorRgb, resolvePalette } from './theme';
import { GridCanvas } from './render/GridCanvas';
import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { BadgeOverlay } from './render/BadgeOverlay';
import type { LiveLineChartProps, LiveLinePoint, LiveLineSeries } from './types';
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
import { monotoneSplinePath } from './math/spline';

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

const BADGE_PILL_BODY_W = 78;
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function NativeMultiSeriesChart({
  series = [],
  theme = 'dark',
  window: controlledWin = 30,
  windows,
  onWindowChange,
  referenceLine,
  badge = true,
  badgeVariant = 'default',
  badgeNumberFlow = true,
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
}: LiveLineChartProps) {
  const palette = resolvePalette(series[0]?.color ?? '#3b82f6', theme, undefined);
  const badgeNumFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 11);
  const skiaBadgeFlow =
    !!badgeNumFont &&
    badge &&
    badgeNumberFlow !== false &&
    supportsTwoDecimalNumberFlow(formatValue);
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
      visibleSeries.reduce((max, entry) => Math.max(max, entry.data[entry.data.length - 1]?.time ?? 0), 0),
    [visibleSeries],
  );
  const rightEdge = latestTime + activeWindow * 0.015;
  const leftEdge = rightEdge - activeWindow;

  const preparedSeries = useMemo(() => {
    return visibleSeries.map((entry) => {
      const points = entry.data.filter((point) => point.time >= leftEdge - 2 && point.time <= rightEdge + 1);
      return { ...entry, points };
    });
  }, [leftEdge, rightEdge, visibleSeries]);

  const range = useMemo(
    () => computeUnionRange(preparedSeries, referenceLine?.value),
    [preparedSeries, referenceLine?.value],
  );

  const chartWidth = layout.width - pad.left - pad.right;
  const chartHeight = layout.height - pad.top - pad.bottom;
  const gridLabels = useMemo(
    () => calcGridTicksJs(range.min, range.max, chartHeight, layout.height, pad, formatValue),
    [chartHeight, formatValue, layout.height, pad, range.max, range.min],
  );
  const timeLabels = useMemo(
    () => calcTimeTicksJs(leftEdge, rightEdge, layout.width, pad, formatTime),
    [formatTime, layout.width, leftEdge, pad, rightEdge],
  );

  const primarySeries = visibleSeries[0] ?? series[0];
  const primaryColor = primarySeries?.color ?? palette.accent;

  const seriesPaths = useMemo(() => {
    return preparedSeries.map((entry) => {
      const screenPoints = entry.points.map((point) => ({
        x: toScreenXJs(point.time, leftEdge, rightEdge, layout.width, pad),
        y: toScreenYJs(point.value, range.min, range.max, layout.height, pad),
      }));
      const livePoint = {
        x: toScreenXJs(latestTime, leftEdge, rightEdge, layout.width, pad),
        y: toScreenYJs(entry.value, range.min, range.max, layout.height, pad),
      };
      const merged = screenPoints.length > 0 ? [...screenPoints, livePoint] : [livePoint];
      return {
        id: entry.id,
        color: entry.color,
        label: entry.label ?? entry.id,
        path: monotoneSplinePath(merged),
        livePoint,
        points: entry.points,
      };
    });
  }, [leftEdge, latestTime, layout.height, layout.width, pad, preparedSeries, range.max, range.min, rightEdge]);

  const primaryPath = useMemo(() => {
    if (!primarySeries) return null;
    return seriesPaths.find((p) => p.id === primarySeries.id) ?? seriesPaths[0] ?? null;
  }, [primarySeries, seriesPaths]);

  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;
  const badgeBgPath = useMemo(
    () => badgeSvgPath(BADGE_PILL_BODY_W, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD),
    [pillH],
  );
  const badgeInnerPath = useMemo(
    () =>
      badgeSvgPath(BADGE_PILL_BODY_W - 4, pillH - 4, BADGE_TAIL_LEN - 1, BADGE_TAIL_SPREAD - 0.5),
    [pillH],
  );
  const badgeInnerRgb = useMemo(() => {
    const [r, g, b] = parseColorRgb(primaryColor);
    return `rgb(${r},${g},${b})`;
  }, [primaryColor]);

  const svBadgeLiveX = useSharedValue(0);
  const svBadgeLiveY = useSharedValue(0);
  const svBadgeValue = useSharedValue(0);
  useEffect(() => {
    if (!primaryPath) return;
    svBadgeLiveX.value = withTiming(primaryPath.livePoint.x, {
      duration: 110,
      easing: Easing.out(Easing.quad),
    });
    svBadgeLiveY.value = withTiming(primaryPath.livePoint.y, {
      duration: 110,
      easing: Easing.out(Easing.quad),
    });
  }, [primaryPath, svBadgeLiveX, svBadgeLiveY]);
  useEffect(() => {
    if (!primarySeries) return;
    svBadgeValue.value = withTiming(primarySeries.value, {
      duration: 110,
      easing: Easing.out(Easing.quad),
    });
  }, [primarySeries, svBadgeValue]);

  const [badgeStr, setBadgeStr] = useState(() =>
    primarySeries ? formatValue(primarySeries.value) : '',
  );
  useEffect(() => {
    if (!primarySeries) return;
    setBadgeStr(formatValue(primarySeries.value));
  }, [formatValue, primarySeries]);

  const badgeDashY =
    badge && primarySeries && layout.height > 0
      ? toScreenYJs(primarySeries.value, range.min, range.max, layout.height, pad)
      : 0;

  const asBadge = useAnimatedStyle(() => {
    const totalW = BADGE_TAIL_LEN + BADGE_PILL_BODY_W;
    return {
      opacity: 1,
      width: totalW,
      transform: [
        { translateX: svBadgeLiveX.value - totalW / 2 - BADGE_TAIL_LEN },
        { translateY: svBadgeLiveY.value - pillH - 12 },
      ],
    };
  });
  const asBadgeTextWrap = useAnimatedStyle(() => ({
    width: Math.max(8, BADGE_PILL_BODY_W - BADGE_TAIL_LEN),
  }));
  const noopBadgeLayout = useCallback(() => {}, []);

  const scrubInfo = useMemo(() => {
    if (scrubX == null || chartWidth <= 0 || latestTime <= 0) return null;
    const liveX = toScreenXJs(latestTime, leftEdge, rightEdge, layout.width, pad);
    const clampedX = clamp(scrubX, pad.left, liveX);
    const scrubTime = leftEdge + ((clampedX - pad.left) / Math.max(1, chartWidth)) * (rightEdge - leftEdge);
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
          y: toScreenYJs(value, range.min, range.max, layout.height, pad),
        };
      })
      .filter(Boolean) as Array<{ id: string; label: string; color: string; value: number; y: number }>;
    if (values.length === 0) return null;
    return {
      x: snapToPointScrubbing ? toScreenXJs(nearestPointAtTimeJs(seriesPaths[0]?.points ?? [], scrubTime)?.time ?? scrubTime, leftEdge, rightEdge, layout.width, pad) : clampedX,
      time: scrubTime,
      values,
    };
  }, [chartWidth, latestTime, layout.height, layout.width, leftEdge, pad, range.max, range.min, rightEdge, scrubX, seriesPaths, snapToPointScrubbing]);

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
        const next = clamp(resolvedWin / Math.max(0.5, Math.min(2.5, e.scale)), 5, resolvedWin * 6);
        runOnJS(setPinchWindow)(next);
      })
      .onEnd(() => {
        runOnJS(setPinchWindow)(null);
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [pinchToZoom, resolvedWin, scrub]);

  const empty = loading || layout.width <= 0 || preparedSeries.every((entry) => entry.points.length < 2);

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
                      y={toScreenYJs(referenceLine.value, range.min, range.max, layout.height, pad)}
                      opacity={1}
                      padLeft={pad.left}
                      padRight={pad.right}
                      layoutWidth={layout.width}
                      lineColor={palette.refLine}
                    />
                  ) : null}

                  {seriesPaths.map((entry) => (
                    <Group key={entry.id}>
                      <Path
                        path={entry.path}
                        style="stroke"
                        strokeWidth={2}
                        strokeJoin="round"
                        strokeCap="round"
                        color={entry.color}
                      />
                      <Circle cx={entry.livePoint.x} cy={entry.livePoint.y} r={4} color={entry.color} />
                    </Group>
                  ))}

                  {badge && primarySeries && !empty ? (
                    <SkiaLine
                      p1={vec(pad.left, badgeDashY)}
                      p2={vec(layout.width - pad.right, badgeDashY)}
                      color={palette.dashLine}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[4, 4]} />
                    </SkiaLine>
                  ) : null}

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
                        <Circle key={entry.id} cx={scrubInfo.x} cy={entry.y} r={4} color={entry.color} />
                      ))}
                    </>
                  ) : null}
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
                    y={toScreenYJs(referenceLine.value, range.min, range.max, layout.height, pad)}
                    opacity={1}
                    padLeft={pad.left}
                    padRight={pad.right}
                    layoutWidth={layout.width}
                    color={palette.refLabel}
                    textStyle={styles.referenceLabel}
                  />
                ) : null}

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

                {badge && primarySeries && !empty ? (
                  <BadgeOverlay
                    badge={badge}
                    empty={empty}
                    variant={badgeVariant}
                    skiaBadgeFlow={skiaBadgeFlow}
                    badgeFlowA11yLabel={badgeStr}
                    badgeNumFont={badgeNumFont}
                    badgeValue={svBadgeValue}
                    flowPillW={BADGE_PILL_BODY_W}
                    badgeStr={badgeStr}
                    badgeStyle={asBadge}
                    badgeTextWrapStyle={asBadgeTextWrap}
                    backgroundPath={badgeBgPath}
                    innerPath={badgeInnerPath}
                    innerColor={badgeInnerRgb}
                    pillH={pillH}
                    onBadgeTemplateLayout={noopBadgeLayout}
                    pal={palette}
                    badgeTextStyle={styles.badgeTxt}
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
      <Text style={[styles.pillText, { color: active ? color : 'rgba(255,255,255,0.48)' }]}>{label}</Text>
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
  axisY: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: 'monospace' },
  axisT: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: 'monospace', textAlign: 'center' },
  referenceLabel: { fontFamily: 'monospace', fontSize: 11, fontWeight: '500' },
  tooltip: {
    position: 'absolute',
    left: 12,
    gap: 2,
  },
  tooltipText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '500',
  },
  badgeTxt: { fontFamily: mono, fontSize: 11, fontWeight: '500' },
});
