import { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  LiveLineChart,
  StaticChart,
  type LiveLineSeries,
  type LiveOrderbookSnapshot,
} from './src/chart';
import { useChartConfig } from './src/demo/config/useChartConfig';
import { useFeedConfig } from './src/demo/config/useFeedConfig';
import { useInteractionConfig } from './src/demo/config/useInteractionConfig';
import { ChartControlsSection } from './src/demo/controls/ChartControlsSection';
import { FeedControlsSection } from './src/demo/controls/FeedControlsSection';
import { InteractionControlsSection } from './src/demo/controls/InteractionControlsSection';
import { buildSeedSnapshot } from './src/demo/mockFeedData';
import { useMockLiveFeed } from './src/demo/useMockLiveFeed';
import { DEMO_WINDOW_OPTIONS } from './src/demo/windowOptions';

export default function App() {
  const chart = useChartConfig();
  const feed = useFeedConfig();
  const interaction = useInteractionConfig();

  const effectivePaused = feed.paused || !feed.appIsActive;

  const degenConfig = useMemo(
    () =>
      feed.degenMode
        ? { scale: feed.degenScale, downMomentum: feed.degenDownMomentum }
        : false,
    [feed.degenDownMomentum, feed.degenMode, feed.degenScale],
  );

  const liveFeed = useMockLiveFeed({
    tickMs: feed.tickMs,
    volatility: feed.volatility,
    paused: effectivePaused,
    mania: feed.degenMode,
  });
  const staticSnapshot = useMemo(() => buildSeedSnapshot(100, feed.volatility), [feed.volatility]);
  const chartFeed = chart.renderMode === 'static' ? staticSnapshot : liveFeed;

  const valueDelta = useMemo(() => {
    if (chartFeed.data.length < 2) return 0;
    return chartFeed.value - chartFeed.data[Math.max(0, chartFeed.data.length - 24)].value;
  }, [chartFeed.data, chartFeed.value]);

  const syntheticOrderbook = useMemo((): LiveOrderbookSnapshot | undefined => {
    if (chart.renderMode === 'static' || chart.chartView === 'multi' || !chart.showOrderbookStream) {
      return undefined;
    }
    const mid = chartFeed.value;
    const spread =
      Math.max(0.02, mid * 0.0011) *
      (feed.volatility === 'chaos' ? 2.1 : feed.volatility === 'calm' ? 0.62 : 1);
    const levels = 10;
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    const n = chartFeed.data.length;
    for (let i = 0; i < levels; i += 1) {
      const j = i + 1;
      const szb = 3 + ((i * 19 + (n % 13)) % 78) * (feed.volatility === 'chaos' ? 1.45 : 1);
      const sza = 3 + ((i * 17 + (n % 10)) % 76) * (feed.volatility === 'chaos' ? 1.4 : 1);
      bids.push([mid - spread * j, szb]);
      asks.push([mid + spread * j, sza]);
    }
    return { bids, asks };
  }, [
    chart.chartView,
    chart.renderMode,
    chart.showOrderbookStream,
    chartFeed.data.length,
    chartFeed.value,
    feed.volatility,
  ]);

  const demoSeries = useMemo((): LiveLineSeries[] => {
    if (chart.chartView !== 'multi') return [];
    const data = chartFeed.data;
    if (data.length === 0) return [];

    const seedOffset = (id: string) => id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);

    const makeSeries = (id: string, label: string, colorValue: string, bias: number, scale: number) => {
      const offset = seedOffset(id);
      const base = data[0]?.value ?? 100;
      const biasOffset = base * bias;
      const points = data.map((point, index) => {
        const t = point.time;
        const harmonic =
          Math.sin(t * 0.73 + offset * 0.11) * 0.52 +
          Math.cos(t * 0.29 + offset * 0.07) * 0.34 +
          Math.sin(index * 0.09 + offset * 0.03) * 0.18;
        return { time: t, value: point.value + biasOffset + harmonic * scale };
      });
      return { id, label, color: colorValue, data: points, value: points[points.length - 1]?.value ?? base };
    };

    return [
      { id: 'primary', label: 'Primary', color: chart.accent, data, value: chartFeed.value },
      makeSeries('hedge', 'Hedge', '#22c55e', -0.02, 0.85),
      makeSeries('arb', 'Arb', '#f59e0b', 0.015, 1.15),
    ];
  }, [chart.accent, chart.chartView, chartFeed.data, chartFeed.value]);

  const staticChartKey = useMemo(
    () =>
      [
        'static',
        chart.chartView,
        chart.windowSecs,
        staticSnapshot.data.length,
        staticSnapshot.data[0]?.time ?? 0,
        staticSnapshot.data[staticSnapshot.data.length - 1]?.time ?? 0,
        staticSnapshot.value.toFixed(4),
      ].join(':'),
    [chart.chartView, chart.windowSecs, staticSnapshot],
  );

  const pageBackground = chart.theme === 'dark' ? '#111111' : '#f5f5f5';
  const panelBackground = chart.theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
  const panelBorder = chart.theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const headline = chart.theme === 'dark' ? '#ffffff' : '#111111';
  const muted = chart.theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  const deltaColor = valueDelta >= 0 ? '#22c55e' : '#ef4444';

  const modeSupportsOrderbook = chart.renderMode === 'live' && chart.chartView !== 'multi';
  const modeSupportsScrubNumberFlow = chart.chartView === 'line';
  const modeSupportsScrubHaptics = chart.chartView === 'line';
  const modeSupportsSnap = chart.chartView !== 'candle';
  const modeSupportsLiveDotGlow = chart.renderMode === 'live' && chart.chartView === 'line';
  const modeSupportsLineTrailGlow =
    chart.chartView === 'line' || (chart.chartView === 'candle' && chart.candleLineMorph);
  const modeSupportsGradientLine =
    chart.chartView === 'line' || (chart.chartView === 'candle' && chart.candleLineMorph);
  const modeSupportsDegen = chart.renderMode === 'live' && chart.chartView === 'line';

  const referenceLine = useMemo(
    () =>
      chart.showReferenceLine
        ? { value: chartFeed.value - valueDelta / 2, label: 'MID' as const }
        : undefined,
    [chart.showReferenceLine, chartFeed.value, valueDelta],
  );

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: pageBackground }]}>
          <StatusBar style={chart.theme === 'dark' ? 'light' : 'dark'} />
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.contentWrap}>
              <View style={styles.headerBlock}>
                <Text style={[styles.title, { color: headline }]}>Liveline</Text>
                <Text style={[styles.subtitle, { color: muted }]}>
                  React Native reference with native motion, restrained chrome, and a degen switch when you want it.
                </Text>
              </View>

              <View style={[styles.controlPanel, { backgroundColor: panelBackground, borderColor: panelBorder }]}>
                <ChartControlsSection
                  config={chart}
                  muted={muted}
                  chartViewSupportsGlow={modeSupportsLiveDotGlow}
                  chartViewSupportsOrderbook={modeSupportsOrderbook}
                  chartViewSupportsGradient={modeSupportsGradientLine}
                  chartViewSupportsTrailGlow={modeSupportsLineTrailGlow}
                />
                <FeedControlsSection
                  feed={feed}
                  accent={chart.accent}
                  theme={chart.theme}
                  muted={muted}
                  chartViewSupportsDegen={modeSupportsDegen}
                />
                <InteractionControlsSection
                  interaction={interaction}
                  chart={chart}
                  muted={muted}
                  chartViewSupportsScrubNumberFlow={modeSupportsScrubNumberFlow}
                  chartViewSupportsScrubHaptics={modeSupportsScrubHaptics}
                  chartViewSupportsSnap={modeSupportsSnap}
                />
              </View>

              <Text style={[styles.helperText, { color: muted }]}>
                Disabled controls do not apply in the current chart mode.
              </Text>

              {chart.renderMode === 'live' ? (
                <LiveLineChart
                  data={liveFeed.data}
                  value={liveFeed.value}
                  theme={chart.theme}
                  color={chart.accent}
                  window={chart.windowSecs}
                  windows={DEMO_WINDOW_OPTIONS}
                  onWindowChange={chart.setWindowSecs}
                  windowStyle="rounded"
                  momentum
                  badge={chart.showBadge}
                  badgeVariant={chart.badgeVariant}
                  badgeNumberFlow={chart.badgeNumberFlow}
                  scrubNumberFlow={interaction.scrubNumberFlow}
                  scrubHaptics={interaction.scrubHaptics}
                  snapToPointScrubbing={interaction.snapToPointScrubbing}
                  pinchToZoom={interaction.pinchToZoom}
                  referenceLine={referenceLine}
                  liveDotGlow={chart.liveDotGlow}
                  lineTrailGlow={chart.lineTrailGlow}
                  gradientLineColoring={chart.gradientLineColoring}
                  degen={degenConfig}
                  paused={effectivePaused}
                  loading={liveFeed.data.length < 2}
                  height={320}
                  mode={chart.chartView === 'candle' ? 'candle' : 'line'}
                  onModeChange={(next) => {
                    chart.setChartView(next === 'candle' ? 'candle' : 'line');
                    if (next === 'line') chart.setCandleLineMorph(false);
                  }}
                  showBuiltInModeToggle={chart.chartView !== 'multi'}
                  showBuiltInMorphToggle={chart.chartView === 'candle'}
                  lineMode={chart.candleLineMorph}
                  onLineModeChange={chart.setCandleLineMorph}
                  {...(chart.chartView === 'candle'
                    ? { candles: liveFeed.candles, liveCandle: liveFeed.liveCandle }
                    : chart.chartView === 'multi'
                      ? { series: demoSeries }
                      : {})}
                  orderbook={syntheticOrderbook}
                />
              ) : (
                <StaticChart
                  key={staticChartKey}
                  data={staticSnapshot.data}
                  theme={chart.theme}
                  color={chart.accent}
                  window={chart.windowSecs}
                  windows={DEMO_WINDOW_OPTIONS}
                  onWindowChange={chart.setWindowSecs}
                  windowStyle="rounded"
                  badge={chart.showBadge}
                  badgeVariant={chart.badgeVariant}
                  scrubNumberFlow={interaction.scrubNumberFlow}
                  scrubHaptics={interaction.scrubHaptics}
                  snapToPointScrubbing={interaction.snapToPointScrubbing}
                  pinchToZoom={interaction.pinchToZoom}
                  referenceLine={referenceLine}
                  lineTrailGlow={chart.lineTrailGlow}
                  gradientLineColoring={chart.gradientLineColoring}
                  loading={false}
                  height={320}
                  mode={chart.chartView === 'candle' ? 'candle' : 'line'}
                  onModeChange={(next) => {
                    chart.setChartView(next === 'candle' ? 'candle' : 'line');
                    if (next === 'line') chart.setCandleLineMorph(false);
                  }}
                  showBuiltInModeToggle={chart.chartView !== 'multi'}
                  showBuiltInMorphToggle={chart.chartView === 'candle'}
                  lineMode={chart.candleLineMorph}
                  onLineModeChange={chart.setCandleLineMorph}
                  {...(chart.chartView === 'candle'
                    ? { candles: staticSnapshot.candles }
                    : chart.chartView === 'multi'
                      ? { series: demoSeries }
                      : {})}
                />
              )}

              <View style={styles.statusRail}>
                <Text style={[styles.statusText, { color: muted }]}>
                  value: <Text style={{ color: headline }}>{chartFeed.value.toFixed(2)}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  delta:{' '}
                  <Text style={{ color: deltaColor }}>
                    {valueDelta >= 0 ? '+' : ''}
                    {valueDelta.toFixed(2)}
                  </Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  tick: <Text style={{ color: headline }}>{feed.tickMs}ms</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  vol: <Text style={{ color: headline }}>{feed.volatility}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  mode: <Text style={{ color: headline }}>{feed.degenMode ? 'degen' : 'classic'}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  lifecycle: <Text style={{ color: headline }}>{feed.appIsActive ? 'active' : 'paused'}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  render: <Text style={{ color: headline }}>{chart.renderMode}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  chart:{' '}
                  <Text style={{ color: headline }}>
                    {chart.chartView}
                    {chart.chartView === 'candle' ? (chart.candleLineMorph ? ' +morph' : '') : ''}
                  </Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  badge: <Text style={{ color: headline }}>{chart.showBadge ? 'on' : 'off'}</Text>
                </Text>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingVertical: 28 },
  contentWrap: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: 14 },
  headerBlock: { gap: 4 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 12, lineHeight: 18, maxWidth: 720 },
  controlPanel: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  helperText: { fontSize: 11, lineHeight: 16, marginTop: -2, marginBottom: 4 },
  statusRail: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingTop: 2 },
  statusText: { fontSize: 11, fontFamily: 'monospace' },
});
