import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  LinearGradient,
  Rect,
  RoundedRect,
  Shadow,
  vec,
} from '@shopify/react-native-skia';
import { useSkiaFont } from 'number-flow-react-native/skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BADGE_NUMBER_FLOW_FONT_SRC } from './BadgeSkiaNumberFlow';
import { supportsTwoDecimalNumberFlow } from './chartNumberFlow';
import {
  BADGE_LINE_H,
  BADGE_PAD_X,
  BADGE_PAD_Y,
  BADGE_TAIL_LEN,
  BADGE_TAIL_SPREAD,
  badgeSvgPath,
} from './draw/badge';
import {
  inferCandleWidthSecs,
  layoutLivelineCandles,
  LIVELINE_CANDLE_BULL,
  LIVELINE_CANDLE_BEAR,
} from './draw/livelineCandlestick';
import { parseColorRgb, resolvePalette } from './theme';
import { GridCanvas } from './render/GridCanvas';
import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { ReferenceLineCanvas } from './render/ReferenceLineCanvas';
import { ReferenceLineLabel } from './render/ReferenceLineLabel';
import { BadgeOverlay } from './render/BadgeOverlay';
import type { CandlePoint, LiveLineChartProps } from './types';
import {
  calcGridTicksJs,
  calcTimeTicksJs,
  clamp,
  defaultFormatTime,
  defaultFormatValue,
  toScreenXJs,
  toScreenYJs,
} from './nativeChartUtils';

/* ------------------------------------------------------------------ */
/*  Constants — matching upstream / NativeLiveLineChart                 */
/* ------------------------------------------------------------------ */

/** Matches upstream `WINDOW_BUFFER` / `WINDOW_BUFFER_NO_BADGE`. */
const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
const FADE_EDGE_WIDTH = 40;

function windowBuffer(showBadge: boolean) {
  return showBadge ? WINDOW_BUFFER_BADGE : WINDOW_BUFFER_NO_BADGE;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mergeCandles(history: CandlePoint[] | undefined, live?: CandlePoint): CandlePoint[] {
  const map = new Map<number, CandlePoint>();
  for (const c of history ?? []) {
    map.set(c.time, c);
  }
  if (live) {
    map.set(live.time, live);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function candleYRange(candles: CandlePoint[], referenceValue?: number) {
  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
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

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function nearestCandle(candles: CandlePoint[], t: number): CandlePoint | null {
  if (candles.length === 0) return null;
  let best = candles[0];
  let bestD = Math.abs(candles[0].time - t);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const d = Math.abs(c.time - t);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Live candle glow pulse (matching upstream livePulse)                */
/* ------------------------------------------------------------------ */

function useLivePulse() {
  const pulse = useSharedValue(0.12);
  useEffect(() => {
    pulse.value = 0.12;
    pulse.value = withRepeat(
      withTiming(0.2, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
      pulse.value = 0.12;
    };
  }, [pulse]);
  return pulse;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NativeCandlestickChart({
  candles: candlesProp,
  liveCandle,
  candleWidth: candleWidthProp,
  theme = 'dark',
  chartColors,
  color = '#3b82f6',
  window: controlledWin = 30,
  windows,
  onWindowChange,
  referenceLine,
  badge = true,
  badgeVariant = 'default',
  badgeNumberFlow = true,
  grid = true,
  scrub = true,
  pinchToZoom = false,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  height = 300,
  emptyText = 'Waiting for ticks',
  loading = false,
  style,
  contentInset,
}: LiveLineChartProps) {
  const palette = resolvePalette(color, theme, undefined, chartColors);
  const badgeNumFont = useSkiaFont(BADGE_NUMBER_FLOW_FONT_SRC, 11);
  const skiaBadgeFlow =
    !!badgeNumFont &&
    badge &&
    badgeNumberFlow !== false &&
    supportsTwoDecimalNumberFlow(formatValue);
  const [layout, setLayout] = useState({ width: 0, height });
  const [scrubX, setScrubX] = useState<number | null>(null);
  const [pinchWindow, setPinchWindow] = useState<number | null>(null);

  /** Badge-aware window buffer — matches NativeLiveLineChart. */
  const buf = windowBuffer(badge);

  /** Live candle pulse glow — matches upstream `livePulse = 0.12 + sin(now*0.004)*0.08`. */
  const livePulse = useLivePulse();

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

  const merged = useMemo(() => mergeCandles(candlesProp, liveCandle), [candlesProp, liveCandle]);

  const latestTime = merged.length ? merged[merged.length - 1].time : 0;
  /** Right/left edges — badge-aware buffer so candles don't overlap badge. */
  const rightEdge = latestTime + activeWindow * buf;
  const leftEdge = rightEdge - activeWindow;

  const visible = useMemo(
    () => merged.filter((c) => c.time >= leftEdge - 2 && c.time <= rightEdge + 1),
    [leftEdge, merged, rightEdge],
  );

  const range = useMemo(
    () => candleYRange(visible, referenceLine?.value),
    [referenceLine?.value, visible],
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

  const windowSpanSecs = rightEdge - leftEdge || 1;
  const candleWidthSecs = useMemo(
    () => inferCandleWidthSecs(visible, windowSpanSecs),
    [visible, windowSpanSecs],
  );

  /** Optional max body width in px (only applied when ≥ 12 to avoid tiny demo caps). */
  const maxBodyWidthPx =
    candleWidthProp != null && candleWidthProp >= 12 ? candleWidthProp : undefined;

  const liveCandleTime = liveCandle?.time ?? -1;

  const candleLayouts = useMemo(
    () =>
      layoutLivelineCandles(
        visible,
        liveCandleTime,
        leftEdge,
        rightEdge,
        layout.width,
        layout.height,
        pad,
        range.min,
        range.max,
        candleWidthSecs,
        maxBodyWidthPx,
      ),
    [
      candleWidthSecs,
      layout.height,
      layout.width,
      leftEdge,
      liveCandleTime,
      maxBodyWidthPx,
      pad,
      range.max,
      range.min,
      rightEdge,
      visible,
    ],
  );

  const liveX =
    latestTime > 0
      ? toScreenXJs(latestTime + candleWidthSecs / 2, leftEdge, rightEdge, layout.width, pad)
      : pad.left;

  const empty = loading || layout.width <= 0 || visible.length < 2;

  const tipCandle = merged.length ? merged[merged.length - 1] : null;
  const tipBullish = tipCandle ? tipCandle.close >= tipCandle.open : true;
  const badgeFillColor = tipBullish ? LIVELINE_CANDLE_BULL : LIVELINE_CANDLE_BEAR;
  const badgeDashColor = useMemo(() => {
    const [r, g, b] = parseColorRgb(badgeFillColor);
    return `rgba(${r},${g},${b},0.35)`;
  }, [badgeFillColor]);

  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;

  /* ---- Badge pill width (dynamic, matching liveline) ---- */
  const [badgeMeasuredTextW, setBadgeMeasuredTextW] = useState(28);
  const badgePillW = useMemo(() => {
    return Math.max(40, badgeMeasuredTextW + BADGE_PAD_X * 2);
  }, [badgeMeasuredTextW]);

  const badgeBgPath = useMemo(
    () => badgeSvgPath(badgePillW, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD),
    [pillH, badgePillW],
  );
  const badgeInnerPath = useMemo(
    () =>
      badgeSvgPath(badgePillW - 4, pillH - 4, BADGE_TAIL_LEN - 1, BADGE_TAIL_SPREAD - 0.5),
    [pillH, badgePillW],
  );
  const badgeInnerRgb = useMemo(() => {
    const [r, g, b] = parseColorRgb(badgeFillColor);
    return `rgb(${r},${g},${b})`;
  }, [badgeFillColor]);

  const svBadgeLiveX = useSharedValue(0);
  const svBadgeLiveY = useSharedValue(0);
  const svBadgeValue = useSharedValue(0);
  const svScrubDim = useSharedValue(0);
  /** Track whether badge position was initialized so we can skip the animation on first place. */
  const badgeInitRef = useRef(false);

  useEffect(() => {
    if (!tipCandle || empty) {
      badgeInitRef.current = false;
      return;
    }
    const cx = toScreenXJs(
      tipCandle.time + candleWidthSecs / 2,
      leftEdge,
      rightEdge,
      layout.width,
      pad,
    );
    const cy = toScreenYJs(tipCandle.close, range.min, range.max, layout.height, pad);

    if (!badgeInitRef.current) {
      // First placement — snap immediately (no animation from 0,0)
      badgeInitRef.current = true;
      svBadgeLiveX.value = cx;
      svBadgeLiveY.value = cy;
    } else {
      svBadgeLiveX.value = withTiming(cx, { duration: 110, easing: Easing.out(Easing.quad) });
      svBadgeLiveY.value = withTiming(cy, { duration: 110, easing: Easing.out(Easing.quad) });
    }
  }, [
    tipCandle,
    empty,
    leftEdge,
    rightEdge,
    layout.width,
    layout.height,
    pad,
    range.min,
    range.max,
    svBadgeLiveX,
    svBadgeLiveY,
    candleWidthSecs,
  ]);
  useEffect(() => {
    if (!tipCandle || empty) return;
    svBadgeValue.value = withTiming(tipCandle.close, {
      duration: 110,
      easing: Easing.out(Easing.quad),
    });
  }, [tipCandle, empty, svBadgeValue]);

  const [badgeStr, setBadgeStr] = useState(() => (tipCandle ? formatValue(tipCandle.close) : ''));
  useEffect(() => {
    if (!tipCandle) return;
    setBadgeStr(formatValue(tipCandle.close));
  }, [formatValue, tipCandle]);

  const badgeDashY =
    badge && tipCandle && !empty
      ? toScreenYJs(tipCandle.close, range.min, range.max, layout.height, pad)
      : 0;

  /** Badge animated style — dims during scrub, matches liveline. */
  const asBadge = useAnimatedStyle(() => {
    const totalW = BADGE_TAIL_LEN + badgePillW;
    const badgeX = Math.max(pad.left + 4, layout.width - totalW - 18);
    const badgeY = Math.min(
      Math.max(svBadgeLiveY.value - pillH / 2, pad.top + 4),
      layout.height - pad.bottom - pillH - 4,
    );
    const scrubDim = svScrubDim.value;
    const baseOp = badge ? (1 - scrubDim) : 0;
    return {
      opacity: baseOp,
      width: totalW,
      height: pillH + 10,
      transform: [
        { translateX: badgeX },
        { translateY: badgeY },
      ],
    };
  });
  const asBadgeTextWrap = useAnimatedStyle(() => ({
    width: Math.max(8, badgePillW - BADGE_TAIL_LEN),
  }));

  const onBadgeTemplateLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      setBadgeMeasuredTextW(e.nativeEvent.layout.width);
    },
    [],
  );

  const scrubInfo = useMemo(() => {
    if (scrubX == null || chartWidth <= 0 || visible.length === 0) return null;
    const clampedX = clamp(scrubX, pad.left, liveX);
    const scrubTime =
      leftEdge + ((clampedX - pad.left) / Math.max(1, chartWidth)) * (rightEdge - leftEdge);
    const hit = nearestCandle(visible, scrubTime);
    if (!hit) return null;
    const xSnap = toScreenXJs(
      hit.time + candleWidthSecs / 2,
      leftEdge,
      rightEdge,
      layout.width,
      pad,
    );
    const yMid = toScreenYJs(hit.close, range.min, range.max, layout.height, pad);
    return { x: xSnap, time: scrubTime, candle: hit, yMid };
  }, [
    candleWidthSecs,
    chartWidth,
    layout.height,
    layout.width,
    leftEdge,
    liveX,
    pad,
    range.max,
    range.min,
    rightEdge,
    scrubX,
    visible,
  ]);

  /** Track scrub dimming shared value for badge opacity. */
  useEffect(() => {
    if (scrubX != null) {
      svScrubDim.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
    } else {
      svScrubDim.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) });
    }
  }, [scrubX, svScrubDim]);

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

  /** Dash line dimming during scrub — matches liveline. */
  const dashLineOpacity = scrubX != null ? 0.8 : 1;

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
                    grid={!!grid}
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

                  <Group>
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
                        {/* Body — live candle gets animated pulse glow */}
                        {row.isLive ? (
                          <Group>
                            {/* Pulse glow layer — upstream: opacity cycles with sin wave */}
                            <RoundedRect
                              x={row.cx - row.halfBody - 2}
                              y={row.bodyTop - 2}
                              width={row.bodyW + 4}
                              height={row.bodyH + 4}
                              r={row.radius + 1}
                              color={row.fill}
                              opacity={livePulse}
                            >
                              <Shadow dx={0} dy={0} blur={10} color={row.fill} />
                            </RoundedRect>
                            {/* Solid body */}
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

                  {/* Dashed close-price line */}
                  {badge && tipCandle && !empty ? (
                    <Group opacity={dashLineOpacity}>
                      <SkiaLine
                        p1={vec(pad.left, badgeDashY)}
                        p2={vec(layout.width - pad.right, badgeDashY)}
                        color={badgeDashColor}
                        strokeWidth={1}
                      >
                        <DashPathEffect intervals={[4, 4]} />
                      </SkiaLine>
                    </Group>
                  ) : null}

                  {/* -- Left edge fade: destination-out gradient (matches liveline) -- */}
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

                  {scrubInfo ? (
                    <>
                      <CrosshairCanvas
                        lineP1={vec(scrubInfo.x, pad.top)}
                        lineP2={vec(scrubInfo.x, layout.height - pad.bottom)}
                        lineOpacity={0.6}
                        dotX={scrubInfo.x}
                        dotY={scrubInfo.yMid}
                        dotRadius={4}
                        dotOpacity={1}
                        lineColor={palette.crosshair}
                        dotColor={
                          scrubInfo.candle.close >= scrubInfo.candle.open
                            ? LIVELINE_CANDLE_BULL
                            : LIVELINE_CANDLE_BEAR
                        }
                      />
                      <Circle
                        cx={scrubInfo.x}
                        cy={scrubInfo.yMid}
                        r={4}
                        color={
                          scrubInfo.candle.close >= scrubInfo.candle.open
                            ? LIVELINE_CANDLE_BULL
                            : LIVELINE_CANDLE_BEAR
                        }
                      />
                    </>
                  ) : null}
                </Canvas>

                <AxisLabels
                  grid={!!grid}
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
                      {formatTime(scrubInfo.candle.time)}
                    </Text>
                    <Text style={[styles.tooltipText, { color: palette.tooltipMuted }]}>
                      {`O ${formatValue(scrubInfo.candle.open)}  H ${formatValue(scrubInfo.candle.high)}`}
                    </Text>
                    <Text style={[styles.tooltipText, { color: palette.tooltipMuted }]}>
                      {`L ${formatValue(scrubInfo.candle.low)}  C ${formatValue(scrubInfo.candle.close)}`}
                    </Text>
                  </View>
                ) : null}

                {badge && tipCandle && !empty ? (
                  <BadgeOverlay
                    badge={badge}
                    empty={empty}
                    variant={badgeVariant}
                    skiaBadgeFlow={skiaBadgeFlow}
                    badgeFlowA11yLabel={badgeStr}
                    badgeNumFont={badgeNumFont}
                    badgeValue={svBadgeValue}
                    flowPillW={badgePillW}
                    badgeStr={badgeStr}
                    badgeStyle={asBadge}
                    badgeTextWrapStyle={asBadgeTextWrap}
                    backgroundPath={badgeBgPath}
                    innerPath={badgeInnerPath}
                    innerColor={badgeInnerRgb}
                    pillH={pillH}
                    onBadgeTemplateLayout={onBadgeTemplateLayout}
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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

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
      <Text style={[styles.pillText, { color: active ? color : inactiveTextColor }]}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

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
