import { useCallback, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  Canvas,
  DashPathEffect,
  Group,
  Line as SkiaLine,
  LinearGradient,
  Path,
  Rect,
  Shadow,
  vec,
  rect,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { buildPath } from './draw/buildLiveLinePath';
import { badgeSvgPath, BADGE_LINE_H, BADGE_PAD_X, BADGE_PAD_Y, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD } from './draw/badge';
import { computeRange } from './math/range';
import { resolvePalette, parseColorRgb } from './theme';
import { calcGridTicks, calcTimeTicks, getVisible, toScreenXJs, toScreenY, windowBuffer } from './snapshotAxis';
import { clampW, crosshairScrubAttenuation, sampleScrubAtX } from './snapshotScrub';
import { scrubCentTickHaptic, scrubPanBeginHaptic } from './scrubHaptics';
import { AxisLabels } from './render/AxisLabels';
import { CrosshairCanvas } from './render/CrosshairCanvas';
import { EmptyState } from './render/EmptyState';
import { GridCanvas } from './render/GridCanvas';
import { LiveDotLayer } from './render/LiveDotLayer';
import type { TrackedGridLabel, TrackedTimeLabel } from './render/useTrackedAxisLabels';
import type { ChartPadding, SnapshotLineChartProps } from './types';

const DEFAULT_HEIGHT = 300;
const FADE_EDGE_WIDTH = 40;
/** Right segment dim while scrubbing (matches `NativeLiveLineChart` `dvRightSegOp`). */
const SCRUB_RIGHT_SEG_OP = 0.4;
const CHART_REVEAL = 1;
const REVEAL_GRID_START = 0.15;
const REVEAL_GRID_END = 0.7;
const REVEAL_DOT_START = 0.3;
const REVEAL_BADGE_START = 0.25;

function revealGridOpacity(rev: number) {
  if (rev < REVEAL_GRID_START) return 0;
  return Math.min(1, (rev - REVEAL_GRID_START) / (REVEAL_GRID_END - REVEAL_GRID_START));
}

function revealDotOpacity(rev: number) {
  if (rev < REVEAL_DOT_START) return 0;
  return (rev - REVEAL_DOT_START) / (1 - REVEAL_DOT_START);
}

function revealBadgeOpacity(rev: number) {
  if (rev < REVEAL_BADGE_START) return 0;
  return Math.min(1, (rev - REVEAL_BADGE_START) / (1 - REVEAL_BADGE_START));
}

function defaultFmtVal(v: number) {
  return v.toFixed(2);
}

function defaultFmtTime(t: number) {
  const d = new Date(t * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function SnapshotLineChart({
  data,
  value,
  theme = 'dark',
  color = '#3b82f6',
  lineWidth,
  window: winProp = 30,
  grid = true,
  fill = true,
  badge = true,
  badgeVariant = 'default',
  liveDotGlow = true,
  lineTrailGlow = true,
  gradientLineColoring = false,
  referenceLine,
  exaggerate = false,
  height: heightProp = DEFAULT_HEIGHT,
  emptyText = 'Waiting for ticks',
  formatValue = defaultFmtVal,
  formatTime = defaultFmtTime,
  contentInset,
  style,
  scrub = true,
  snapToPointScrubbing = false,
  scrubHaptics = true,
  tooltipY = 14,
  tooltipOutline = true,
  onHover,
}: SnapshotLineChartProps) {
  const [layout, setLayout] = useState({ width: 0, height: heightProp });
  const gridIntRef = useRef(0.01);
  const lastScrubCentRef = useRef<number | null>(null);
  const minimal = badgeVariant === 'minimal';
  const scrubOn = scrub !== false;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setLayout({ width, height: h > 0 ? h : heightProp });
  };

  const pad: ChartPadding = useMemo(
    () => ({
      top: contentInset?.top ?? 12,
      right: contentInset?.right ?? (badge ? 80 : grid ? 54 : 12),
      bottom: contentInset?.bottom ?? 28,
      left: contentInset?.left ?? 12,
    }),
    [contentInset, grid, badge],
  );

  const pal = useMemo(
    () => resolvePalette(color, theme, lineWidth),
    [color, theme, lineWidth],
  );

  const buf = windowBuffer(!!badge);
  const win = winProp;
  const axisNow = data.length > 0 ? data[data.length - 1]!.time : 0;
  const tipT = axisNow;
  const tipV = value;

  const vis = useMemo(
    () => (data.length > 0 ? getVisible(data, axisNow, win, buf) : []),
    [data, axisNow, win, buf],
  );
  const rng = useMemo(
    () => computeRange(vis, value, referenceLine?.value, exaggerate),
    [vis, value, referenceLine?.value, exaggerate],
  );

  const w = layout.width;
  const h = layout.height;
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const baseY = h - pad.bottom;
  const empty = w <= 0 || data.length < 2;
  const loadPath = '';
  const loadAlpha = 0;

  const linePath = useMemo(
    () =>
      !empty
        ? buildPath(data, tipT, tipV, rng.min, rng.max, w, h, pad, win, buf, false)
        : '',
    [data, tipT, tipV, rng.min, rng.max, w, h, pad, win, buf, empty],
  );
  const fillPath = useMemo(
    () =>
      !empty
        ? buildPath(data, tipT, tipV, rng.min, rng.max, w, h, pad, win, buf, true)
        : '',
    [data, tipT, tipV, rng.min, rng.max, w, h, pad, win, buf, empty],
  );

  const gridRes = useMemo(() => {
    const r = calcGridTicks(
      rng.min,
      rng.max,
      chartH,
      pad.top,
      pad.bottom,
      h,
      formatValue,
      gridIntRef.current,
    );
    gridIntRef.current = r.interval;
    return r;
  }, [rng.min, rng.max, chartH, pad.top, pad.bottom, h, formatValue]);

  const tTicks = useMemo(
    () => (empty ? [] : calcTimeTicks(axisNow, win, w, pad, formatTime, buf)),
    [empty, axisNow, win, w, pad, formatTime, buf],
  );

  const trackedGridLabels: TrackedGridLabel[] = useMemo(
    () =>
      gridRes.ticks.map((t) => ({
        key: Math.round(t.value * 1000),
        value: t.value,
        y: t.y,
        text: t.text,
        alpha: t.fineOp,
        isCoarse: t.isCoarse,
      })),
    [gridRes.ticks],
  );

  const trackedTimeLabels: TrackedTimeLabel[] = useMemo(() => {
    const ordered = [...tTicks]
      .sort((a, b) => a.x - b.x)
      .map((t) => ({
        key: Math.round(t.time * 100),
        x: t.x,
        text: t.text,
        alpha: t.edge,
        width: Math.max(48, t.text.length * 7.25),
      }));
    const resolved: TrackedTimeLabel[] = [];
    const GAP = 8;
    for (const label of ordered) {
      const left = label.x - label.width / 2;
      const prev = resolved[resolved.length - 1];
      if (prev) {
        const prevRight = prev.x + prev.width / 2;
        if (left < prevRight + GAP) {
          if (label.alpha > prev.alpha) {
            resolved[resolved.length - 1] = label;
          }
          continue;
        }
      }
      resolved.push(label);
    }
    return resolved;
  }, [tTicks]);

  const liveX = useMemo(
    () => (empty || w <= 0 ? 0 : toScreenXJs(tipT, axisNow, win, w, pad, buf)),
    [empty, w, tipT, axisNow, win, pad, buf],
  );
  const liveY = useMemo(
    () => (empty || h <= 0 ? 0 : toScreenY(tipV, rng.min, rng.max, h, pad)),
    [empty, h, tipV, rng.min, rng.max, pad],
  );

  const refY =
    referenceLine && !empty && w > 0
      ? toScreenY(referenceLine.value, rng.min, rng.max, h, pad)
      : 0;
  const refSeg =
    referenceLine &&
    w > 0 &&
    h > 0 &&
    (referenceLine.value >= rng.min && referenceLine.value <= rng.max);

  const [scrubTip, setScrubTip] = useState<{
    hx: number;
    hv: number;
    ht: number;
    hy: number;
  } | null>(null);

  const endScrub = useCallback(() => {
    setScrubTip(null);
    onHover?.(null);
    lastScrubCentRef.current = null;
  }, [onHover]);

  const applyScrubX = useCallback(
    (x: number) => {
      if (empty || w <= 0) return;
      const s = sampleScrubAtX(
        x,
        w,
        pad,
        win,
        buf,
        tipT,
        tipV,
        data,
        snapToPointScrubbing,
      );
      const hy = Math.max(
        pad.top,
        Math.min(h - pad.bottom, toScreenY(s.hv, rng.min, rng.max, h, pad)),
      );
      setScrubTip({ hx: s.hx, hv: s.hv, ht: s.ht, hy });
      onHover?.({ time: s.ht, value: s.hv, x: s.hx, y: hy });
      if (scrubHaptics) {
        const cent = Math.round(s.hv * 100);
        if (lastScrubCentRef.current !== null && cent !== lastScrubCentRef.current) {
          scrubCentTickHaptic();
        }
        lastScrubCentRef.current = cent;
      }
    },
    [
      empty,
      w,
      pad,
      win,
      buf,
      tipT,
      tipV,
      data,
      snapToPointScrubbing,
      rng.min,
      rng.max,
      h,
      onHover,
      scrubHaptics,
    ],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(scrubOn && !empty)
        .minDistance(0)
        .onBegin((e) => {
          runOnJS((x: number) => {
            scrubPanBeginHaptic();
            lastScrubCentRef.current = null;
            applyScrubX(x);
          })(e.x);
        })
        .onUpdate((e) => {
          runOnJS(applyScrubX)(e.x);
        })
        .onEnd(() => {
          runOnJS(endScrub)();
        }),
    [scrubOn, empty, applyScrubX, endScrub],
  );

  const scrubTipLayout = useMemo(() => {
    if (!scrubTip || w < 300) return null;
    const v = formatValue(scrubTip.hv);
    const t = formatTime(scrubTip.ht);
    const sep = '  ·  ';
    const charW = 7.85;
    const totalW = v.length * charW + sep.length * charW + t.length * charW;
    const dotRight = liveX + 7;
    let left = scrubTip.hx - totalW / 2;
    const minX = pad.left + 4;
    const maxX = dotRight - totalW;
    if (left < minX) left = minX;
    if (left > maxX) left = maxX;
    return { left, v, t, sep };
  }, [scrubTip, w, formatValue, formatTime, liveX, pad.left]);

  const crossAtt = scrubTip ? crosshairScrubAttenuation(scrubTip.hx, liveX, chartW) : 0;
  const crossOp = crossAtt;
  const liveDotScrubMult = scrubTip ? 0.7 * crossAtt : 1;

  const splitX = scrubTip ? clampW(scrubTip.hx, pad.left, liveX) : null;

  const rev = CHART_REVEAL;
  const opGrid = revealGridOpacity(rev);
  const opLine = opGrid;
  const opDot = revealDotOpacity(rev);
  const opBadge = revealBadgeOpacity(rev);

  const clipRect = w > 0 && h > 0 ? rect(pad.left - 1, pad.top, chartW + 2, chartH) : undefined;
  const clipL =
    splitX != null && w > 0 && h > 0
      ? rect(pad.left, pad.top, Math.max(0, splitX - pad.left), chartH)
      : null;
  const clipR =
    splitX != null && w > 0 && h > 0
      ? rect(splitX, pad.top, Math.max(0, w - pad.right - splitX), chartH)
      : null;

  const bgRgb = `rgb(${pal.bgRgb[0]},${pal.bgRgb[1]},${pal.bgRgb[2]})`;
  const pillH = BADGE_LINE_H + BADGE_PAD_Y * 2;
  const badgeStr = formatValue(value);
  const [pillW, setPillW] = useState(64);
  const onBadgeTemplateLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    const nw = e.nativeEvent.layout.width + BADGE_PAD_X * 2 + 4;
    if (Math.abs(nw - pillW) > 1) setPillW(nw);
  };
  const pillOuterW = BADGE_TAIL_LEN + pillW;
  const badgeX = Math.max(pad.left + 4, w - pillOuterW - 18);
  const desiredBadgeY = liveY - pillH / 2;
  const badgeY = Math.max(
    pad.top + 4,
    Math.min(desiredBadgeY, h - pad.bottom - pillH - 4),
  );
  const badgeBg = badgeSvgPath(pillW, pillH, BADGE_TAIL_LEN, BADGE_TAIL_SPREAD);
  const badgeInner = badgeSvgPath(
    pillW - 4,
    pillH - 4,
    BADGE_TAIL_LEN - 1,
    BADGE_TAIL_SPREAD - 0.5,
  );
  const [r, g, b] = parseColorRgb(pal.accent);
  const innerColor = `rgb(${r},${g},${b})`;

  return (
    <View style={[styles.shell, { height: heightProp, backgroundColor: pal.surface, borderColor: pal.border }, style]} onLayout={onLayout}>
      <View style={styles.plot}>
        {empty ? (
          <EmptyState
            layoutWidth={w}
            layoutHeight={h}
            pad={pad}
            loadPath={loadPath}
            loadAlpha={loadAlpha}
            loading={false}
            emptyText={emptyText}
            pal={pal}
          />
        ) : (
          <GestureDetector gesture={panGesture}>
            <View style={{ flex: 1 }}>
            <View style={StyleSheet.absoluteFill}>
              <Canvas style={StyleSheet.absoluteFill}>
                <Rect
                  x={0}
                  y={0}
                  width={w}
                  height={h}
                  color={bgRgb}
                />

                <GridCanvas
                  grid={grid}
                  gridLabels={trackedGridLabels}
                  timeLabels={trackedTimeLabels}
                  pad={pad}
                  layoutWidth={w}
                  baseY={baseY}
                  opacity={opGrid}
                  pal={pal}
                />

                {fill && fillPath && (splitX != null ? clipL && clipR : clipRect) ? (
                  splitX != null && clipL && clipR ? (
                    <>
                      <Group clip={clipL} opacity={opLine}>
                        <Path path={fillPath}>
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(0, h - pad.bottom)}
                            colors={[pal.accentFillTop, pal.accentFillBottom]}
                          />
                        </Path>
                      </Group>
                      <Group clip={clipR} opacity={opLine * SCRUB_RIGHT_SEG_OP}>
                        <Path path={fillPath}>
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(0, h - pad.bottom)}
                            colors={[pal.accentFillTop, pal.accentFillBottom]}
                          />
                        </Path>
                      </Group>
                    </>
                  ) : (
                    <Group clip={clipRect!} opacity={opLine}>
                      <Path path={fillPath}>
                        <LinearGradient
                          start={vec(0, pad.top)}
                          end={vec(0, h - pad.bottom)}
                          colors={[pal.accentFillTop, pal.accentFillBottom]}
                        />
                      </Path>
                    </Group>
                  )
                ) : null}

                {linePath && (splitX != null ? clipL && clipR : clipRect) ? (
                  splitX != null && clipL && clipR ? (
                    <>
                      <Group clip={clipL} opacity={opLine}>
                        {lineTrailGlow ? (
                          <Path
                            path={linePath}
                            style="stroke"
                            strokeWidth={pal.lineWidth + 4}
                            strokeJoin="round"
                            strokeCap="round"
                            color={pal.accentGlow}
                            opacity={0.5}
                          />
                        ) : null}
                        <Path
                          path={linePath}
                          style="stroke"
                          strokeWidth={pal.lineWidth}
                          strokeJoin="round"
                          strokeCap="round"
                          color={gradientLineColoring ? undefined : pal.accent}
                        >
                          {gradientLineColoring ? (
                            <LinearGradient
                              start={vec(0, pad.top)}
                              end={vec(w - pad.right, h)}
                              colors={[pal.gridLabel, pal.accent]}
                            />
                          ) : null}
                        </Path>
                      </Group>
                      <Group clip={clipR} opacity={opLine * SCRUB_RIGHT_SEG_OP}>
                        {lineTrailGlow ? (
                          <Path
                            path={linePath}
                            style="stroke"
                            strokeWidth={pal.lineWidth + 4}
                            strokeJoin="round"
                            strokeCap="round"
                            color={pal.accentGlow}
                            opacity={0.5}
                          />
                        ) : null}
                        <Path
                          path={linePath}
                          style="stroke"
                          strokeWidth={pal.lineWidth}
                          strokeJoin="round"
                          strokeCap="round"
                          color={gradientLineColoring ? undefined : pal.accent}
                        >
                          {gradientLineColoring ? (
                            <LinearGradient
                              start={vec(0, pad.top)}
                              end={vec(w - pad.right, h)}
                              colors={[pal.gridLabel, pal.accent]}
                            />
                          ) : null}
                        </Path>
                      </Group>
                    </>
                  ) : (
                    <Group clip={clipRect!} opacity={opLine}>
                      {lineTrailGlow ? (
                        <Path
                          path={linePath}
                          style="stroke"
                          strokeWidth={pal.lineWidth + 4}
                          strokeJoin="round"
                          strokeCap="round"
                          color={pal.accentGlow}
                          opacity={0.5}
                        />
                      ) : null}
                      <Path
                        path={linePath}
                        style="stroke"
                        strokeWidth={pal.lineWidth}
                        strokeJoin="round"
                        strokeCap="round"
                        color={gradientLineColoring ? undefined : pal.accent}
                      >
                        {gradientLineColoring ? (
                          <LinearGradient
                            start={vec(0, pad.top)}
                            end={vec(w - pad.right, h)}
                            colors={[pal.gridLabel, pal.accent]}
                          />
                        ) : null}
                      </Path>
                    </Group>
                  )
                ) : null}

                {refSeg ? (
                  <Group opacity={opGrid}>
                    {referenceLine?.label ? (
                      <>
                        <SkiaLine
                          p1={vec(pad.left, refY)}
                          p2={vec(w / 2 - 44, refY)}
                          color={pal.refLine}
                          strokeWidth={1}
                        />
                        <SkiaLine
                          p1={vec(w / 2 + 44, refY)}
                          p2={vec(w - pad.right, refY)}
                          color={pal.refLine}
                          strokeWidth={1}
                        />
                      </>
                    ) : (
                      <SkiaLine
                        p1={vec(pad.left, refY)}
                        p2={vec(w - pad.right, refY)}
                        color={pal.refLine}
                        strokeWidth={1}
                      >
                        <DashPathEffect intervals={[4, 4]} />
                      </SkiaLine>
                    )}
                  </Group>
                ) : null}

                <Group opacity={opLine * (scrubTip ? 0.8 : 1)}>
                  <SkiaLine
                    p1={vec(pad.left, liveY)}
                    p2={vec(w - pad.right, liveY)}
                    color={pal.dashLine}
                    strokeWidth={1}
                  >
                    <DashPathEffect intervals={[4, 4]} />
                  </SkiaLine>
                </Group>

                <LiveDotLayer
                  revealOpacity={opDot * liveDotScrubMult}
                  liveX={liveX}
                  liveY={liveY}
                  glowEnabled={liveDotGlow}
                  glowColor={pal.accentGlow}
                  outerColor={pal.badgeOuterBg}
                  outerShadow={pal.badgeOuterShadow}
                  innerColor={pal.accent}
                />

                {crossOp > 0.01 && scrubTip ? (
                  <CrosshairCanvas
                    lineP1={vec(scrubTip.hx, pad.top)}
                    lineP2={vec(scrubTip.hx, baseY)}
                    lineOpacity={crossOp * 0.5}
                    dotX={scrubTip.hx}
                    dotY={scrubTip.hy}
                    dotRadius={4 * Math.min(crossOp * 3, 1)}
                    dotOpacity={crossOp > 0.01 ? 1 : 0}
                    lineColor={pal.crosshair}
                    dotColor={pal.accent}
                  />
                ) : null}

                <Group blendMode="dstOut">
                  <Rect
                    x={0}
                    y={0}
                    width={pad.left + FADE_EDGE_WIDTH}
                    height={h}
                  >
                    <LinearGradient
                      start={vec(pad.left, 0)}
                      end={vec(pad.left + FADE_EDGE_WIDTH, 0)}
                      colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
                    />
                  </Rect>
                </Group>
              </Canvas>
            </View>

            <AxisLabels
              grid={grid}
              gridLabels={trackedGridLabels}
              timeLabels={trackedTimeLabels}
              pad={pad}
              layoutWidth={w}
              baseY={baseY}
              pal={pal}
              styles={{ yLabel: styles.yLabel, tLabel: styles.tLabel }}
            />

            {referenceLine?.label && refSeg ? (
              <Text
                pointerEvents="none"
                style={[
                  styles.referenceLabel,
                  {
                    color: pal.refLabel,
                    left: pad.left,
                    width: w - pad.left - pad.right,
                    top: refY - 8,
                    opacity: opGrid,
                  },
                ]}
                numberOfLines={1}
              >
                {referenceLine.label}
              </Text>
            ) : null}

            {scrubOn && scrubTip && scrubTipLayout ? (
              <Text
                pointerEvents="none"
                style={[
                  styles.scrubTipText,
                  {
                    position: 'absolute',
                    left: scrubTipLayout.left,
                    top: pad.top + tooltipY,
                    opacity: 1,
                  },
                  tooltipOutline && {
                    textShadowColor: pal.tooltipBg,
                    textShadowOffset: { width: 0, height: 0 },
                    textShadowRadius: 3,
                  },
                ]}
              >
                <Text style={{ color: pal.tooltipText }}>{scrubTipLayout.v}</Text>
                <Text
                  style={{ color: pal.gridLabel }}
                >{`${scrubTipLayout.sep}${scrubTipLayout.t}`}</Text>
              </Text>
            ) : null}

            {badge ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: badgeX,
                  top: badgeY,
                  width: pillOuterW,
                  height: pillH + 6,
                  opacity: opBadge,
                }}
              >
                <Text onLayout={onBadgeTemplateLayout} style={styles.badgeMeasureGhost}>
                  {badgeStr.replace(/[0-9]/g, '8')}
                </Text>
                <Canvas style={StyleSheet.absoluteFill}>
                  <Path path={badgeBg} color={pal.badgeOuterBg}>
                    <Shadow dx={0} dy={2} blur={8} color={pal.badgeOuterShadow} />
                  </Path>
                  {!minimal ? (
                    <Group transform={[{ translateX: 2 }, { translateY: 2 }]}>
                      <Path path={badgeInner} color={innerColor} />
                    </Group>
                  ) : null}
                </Canvas>
                <Text
                  style={[
                    styles.badgeTxt,
                    {
                      position: 'absolute',
                      left: BADGE_TAIL_LEN + 2,
                      top: BADGE_PAD_Y,
                      right: BADGE_PAD_X,
                      color: minimal ? pal.tooltipText : pal.badgeText,
                    },
                  ]}
                >
                  {badgeStr}
                </Text>
              </View>
            ) : null}
            </View>
          </GestureDetector>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  plot: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  yLabel: { position: 'absolute', fontSize: 11, fontWeight: '400', fontFamily: mono },
  tLabel: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '400',
    fontFamily: mono,
    textAlign: 'center',
  },
  referenceLabel: { position: 'absolute', fontSize: 11, fontWeight: '500', fontFamily: mono },
  badgeMeasureGhost: { position: 'absolute', opacity: 0, fontFamily: mono, fontSize: 12, fontWeight: '600' },
  badgeTxt: { fontFamily: mono, fontSize: 12, fontWeight: '600', letterSpacing: 0.15 },
  scrubTipText: { fontFamily: mono, fontSize: 13, fontWeight: '400' },
});
