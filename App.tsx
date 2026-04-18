import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  LiveLineChart,
  type BadgeVariant,
  type LiveLinePoint,
  type LiveLineSeries,
  type LiveLineTheme,
  type LiveOrderbookSnapshot,
  type WindowOption,
} from './src/chart';
import { Chip, ControlRow } from './src/demo/Controls';
import { useMockLiveFeed } from './src/demo/useMockLiveFeed';

const WINDOWS: WindowOption[] = [
  { label: '15s', secs: 15 },
  { label: '30s', secs: 30 },
  { label: '60s', secs: 60 },
  { label: '2m', secs: 120 },
];

const TICK_RATES = [
  { label: '80ms', value: 80 },
  { label: '150ms', value: 150 },
  { label: '300ms', value: 300 },
  { label: '900ms', value: 900 },
];

const ACCENTS = [
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Bitcoin', value: '#f7931a' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Violet', value: '#8b5cf6' },
];

export default function App() {
  const [theme, setTheme] = useState<LiveLineTheme>('dark');
  const [windowSecs, setWindowSecs] = useState(30);
  const [tickMs, setTickMs] = useState(300);
  const [volatility, setVolatility] = useState<'calm' | 'normal' | 'chaos'>('normal');
  const [paused, setPaused] = useState(false);
  const [accent, setAccent] = useState(ACCENTS[0].value);
  const [degenMode, setDegenMode] = useState(false);
  const [badgeVariant, setBadgeVariant] = useState<BadgeVariant>('default');
  const [showBadge, setShowBadge] = useState(true);
  const [chartView, setChartView] = useState<'line' | 'multi' | 'candle'>('line');
  const [candleLineMorph, setCandleLineMorph] = useState(false);
  const [showReferenceLine, setShowReferenceLine] = useState(false);
  const [degenScale, setDegenScale] = useState<1 | 1.5 | 2>(1);
  const [degenDownMomentum, setDegenDownMomentum] = useState(false);
  const [badgeNumberFlow, setBadgeNumberFlow] = useState(false);
  const [scrubNumberFlow, setScrubNumberFlow] = useState(false);
  const [scrubHaptics, setScrubHaptics] = useState(true);
  const [snapToPointScrubbing, setSnapToPointScrubbing] = useState(false);
  const [pinchToZoom, setPinchToZoom] = useState(false);
  const [liveDotGlow, setLiveDotGlow] = useState(false);
  const [lineTrailGlow, setLineTrailGlow] = useState(false);
  const [gradientLineColoring, setGradientLineColoring] = useState(false);
  const [showOrderbookStream, setShowOrderbookStream] = useState(false);

  const degenConfig = useMemo(
    () =>
      degenMode
        ? {
            scale: degenScale,
            downMomentum: degenDownMomentum,
          }
        : false,
    [degenMode, degenScale, degenDownMomentum],
  );

  const feed = useMockLiveFeed({
    tickMs,
    volatility,
    paused,
    mania: degenMode,
  });

  const valueDelta = useMemo(() => {
    if (feed.data.length < 2) return 0;
    return feed.value - feed.data[Math.max(0, feed.data.length - 24)].value;
  }, [feed.data, feed.value]);

  const syntheticOrderbook = useMemo((): LiveOrderbookSnapshot => {
    const mid = feed.value;
    const spread =
      Math.max(0.02, mid * 0.0011) *
      (volatility === 'chaos' ? 2.1 : volatility === 'calm' ? 0.62 : 1);
    const levels = 10;
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    const n = feed.data.length;
    for (let i = 0; i < levels; i++) {
      const j = i + 1;
      const szb = 3 + ((i * 19 + (n % 13)) % 78) * (volatility === 'chaos' ? 1.45 : 1);
      const sza = 3 + ((i * 17 + (n % 10)) % 76) * (volatility === 'chaos' ? 1.4 : 1);
      bids.push([mid - spread * j, szb]);
      asks.push([mid + spread * j, sza]);
    }
    return { bids, asks };
  }, [feed.value, feed.data.length, volatility]);

  const demoSeries = useMemo((): LiveLineSeries[] => {
    const d = feed.data;
    if (d.length === 0) return [];
    const hedge: LiveLinePoint[] = d.map((p) => ({
      time: p.time,
      value: p.value * 0.998 - valueDelta * 0.12,
    }));
    const hedgeVal = hedge[hedge.length - 1]?.value ?? feed.value;
    return [
      {
        id: 'primary',
        label: 'Primary',
        color: accent,
        data: d,
        value: feed.value,
      },
      {
        id: 'hedge',
        label: 'Hedge',
        color: '#22c55e',
        data: hedge,
        value: hedgeVal,
      },
    ];
  }, [accent, feed.data, feed.value, valueDelta]);

  const pageBackground = theme === 'dark' ? '#111111' : '#f5f5f5';
  const panelBackground = theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
  const panelBorder = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const headline = theme === 'dark' ? '#ffffff' : '#111111';
  const muted = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  const deltaColor = valueDelta >= 0 ? '#22c55e' : '#ef4444';
  const modeSupportsOrderbook = chartView !== 'multi';
  const modeSupportsScrubNumberFlow = chartView === 'line';
  const modeSupportsScrubHaptics = chartView === 'line';
  const modeSupportsSnap = chartView !== 'candle';
  const modeSupportsLiveDotGlow = chartView === 'line';
  const modeSupportsLineTrailGlow = chartView === 'line' || (chartView === 'candle' && candleLineMorph);
  const modeSupportsGradientLine = chartView === 'line' || (chartView === 'candle' && candleLineMorph);
  const modeSupportsDegen = chartView === 'line';

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: pageBackground }]}>
          <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.contentWrap}>
              <View style={styles.headerBlock}>
                <Text style={[styles.title, { color: headline }]}>Liveline</Text>
                <Text style={[styles.subtitle, { color: muted }]}>
                  React Native reference with native motion, restrained chrome, and a degen switch when you want it.
                </Text>
              </View>

              <View
                style={[
                  styles.controlPanel,
                  {
                    backgroundColor: panelBackground,
                    borderColor: panelBorder,
                  },
                ]}
              >
                <ControlRow label="Theme" labelColor={muted}>
                  <Chip
                    active={theme === 'dark'}
                    label="Dark"
                    onPress={() => setTheme('dark')}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={theme === 'light'}
                    label="Light"
                    onPress={() => setTheme('light')}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Transport" labelColor={muted}>
                  {TICK_RATES.map((option) => (
                    <Chip
                      key={option.value}
                      active={tickMs === option.value}
                      label={option.label}
                      onPress={() => setTickMs(option.value)}
                      theme={theme}
                      accent={accent}
                    />
                  ))}
                  <Chip
                    active={paused}
                    label={paused ? 'Resume' : 'Pause'}
                    onPress={() => setPaused((current) => !current)}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Profile" labelColor={muted}>
                  <Chip
                    active={!degenMode}
                    label="Classic"
                    onPress={() => setDegenMode(false)}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={degenMode}
                    label="Degen"
                    onPress={() => setDegenMode(true)}
                    disabled={!modeSupportsDegen}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Badge" labelColor={muted}>
                  <Chip
                    active={showBadge}
                    label="On"
                    onPress={() => setShowBadge(true)}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={!showBadge}
                    label="Off"
                    onPress={() => setShowBadge(false)}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={badgeVariant === 'default'}
                    label="Default"
                    onPress={() => setBadgeVariant('default')}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={badgeVariant === 'minimal'}
                    label="Minimal"
                    onPress={() => setBadgeVariant('minimal')}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={badgeNumberFlow}
                    label="Num flow"
                    onPress={() => setBadgeNumberFlow((current) => !current)}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Chart" labelColor={muted}>
                  <Chip
                    active={chartView === 'line'}
                    label="Line"
                    onPress={() => {
                      setChartView('line');
                      setCandleLineMorph(false);
                    }}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={chartView === 'multi'}
                    label="Multi"
                    onPress={() => setChartView('multi')}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={chartView === 'candle'}
                    label="Candle"
                    onPress={() => setChartView('candle')}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Scrub" labelColor={muted}>
                  <Chip
                    active={modeSupportsScrubNumberFlow && scrubNumberFlow}
                    label="Num flow"
                    onPress={() => setScrubNumberFlow((current) => !current)}
                    disabled={!modeSupportsScrubNumberFlow}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={modeSupportsScrubHaptics && scrubHaptics}
                    label="Haptics"
                    onPress={() => setScrubHaptics((current) => !current)}
                    disabled={!modeSupportsScrubHaptics}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={modeSupportsSnap && snapToPointScrubbing}
                    label="Snap"
                    onPress={() => setSnapToPointScrubbing((current) => !current)}
                    disabled={!modeSupportsSnap}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={pinchToZoom}
                    label="Pinch"
                    onPress={() => setPinchToZoom((current) => !current)}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={showReferenceLine}
                    label="Ref line"
                    onPress={() => setShowReferenceLine((current) => !current)}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Effects" labelColor={muted}>
                  <Chip
                    active={modeSupportsOrderbook && showOrderbookStream}
                    label="Book stream"
                    onPress={() => setShowOrderbookStream((current) => !current)}
                    disabled={!modeSupportsOrderbook}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={modeSupportsLiveDotGlow && liveDotGlow}
                    label="Dot glow"
                    onPress={() => setLiveDotGlow((current) => !current)}
                    disabled={!modeSupportsLiveDotGlow}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={modeSupportsLineTrailGlow && lineTrailGlow}
                    label="Trail glow"
                    onPress={() => setLineTrailGlow((current) => !current)}
                    disabled={!modeSupportsLineTrailGlow}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={modeSupportsGradientLine && gradientLineColoring}
                    label="Gradient"
                    onPress={() => setGradientLineColoring((current) => !current)}
                    disabled={!modeSupportsGradientLine}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Degen+" labelColor={muted}>
                  <Chip
                    active={modeSupportsDegen && degenDownMomentum}
                    label="Down move"
                    onPress={() => setDegenDownMomentum((current) => !current)}
                    disabled={!modeSupportsDegen}
                    theme={theme}
                    accent={accent}
                  />
                  {[1, 1.5, 2].map((scale) => (
                    <Chip
                      key={scale}
                      active={modeSupportsDegen && degenScale === scale}
                      label={`${scale}x`}
                      onPress={() => setDegenScale(scale as 1 | 1.5 | 2)}
                      disabled={!modeSupportsDegen}
                      theme={theme}
                      accent={accent}
                    />
                  ))}
                </ControlRow>

                <ControlRow label="Volatility" labelColor={muted}>
                  <Chip
                    active={volatility === 'calm'}
                    label="Calm"
                    onPress={() => setVolatility('calm')}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={volatility === 'normal'}
                    label="Normal"
                    onPress={() => setVolatility('normal')}
                    theme={theme}
                    accent={accent}
                  />
                  <Chip
                    active={volatility === 'chaos'}
                    label="Chaos"
                    onPress={() => setVolatility('chaos')}
                    theme={theme}
                    accent={accent}
                  />
                </ControlRow>

                <ControlRow label="Accent" labelColor={muted}>
                  {ACCENTS.map((option) => (
                    <Chip
                      key={option.value}
                      active={accent === option.value}
                      label={option.label}
                      onPress={() => setAccent(option.value)}
                      theme={theme}
                      accent={option.value}
                    />
                  ))}
                </ControlRow>
              </View>

              <Text style={[styles.helperText, { color: muted }]}>
                Disabled controls do not apply in the current chart mode.
              </Text>

              <LiveLineChart
                data={feed.data}
                value={feed.value}
                theme={theme}
                color={accent}
                window={windowSecs}
                windows={WINDOWS}
                onWindowChange={setWindowSecs}
                windowStyle="rounded"
                momentum
                badge={showBadge}
                badgeVariant={badgeVariant}
                badgeNumberFlow={badgeNumberFlow}
                scrubNumberFlow={scrubNumberFlow}
                scrubHaptics={scrubHaptics}
                snapToPointScrubbing={snapToPointScrubbing}
                pinchToZoom={pinchToZoom}
                referenceLine={
                  showReferenceLine
                    ? { value: feed.value - valueDelta / 2, label: 'MID' }
                    : undefined
                }
                liveDotGlow={liveDotGlow}
                lineTrailGlow={lineTrailGlow}
                gradientLineColoring={gradientLineColoring}
                degen={degenConfig}
                paused={paused}
                loading={feed.data.length < 2}
                height={320}
                mode={chartView === 'candle' ? 'candle' : 'line'}
                onModeChange={(next) => {
                  setChartView(next === 'candle' ? 'candle' : 'line');
                  if (next === 'line') setCandleLineMorph(false);
                }}
                showBuiltInModeToggle={chartView !== 'multi'}
                showBuiltInMorphToggle={chartView === 'candle'}
                lineMode={candleLineMorph}
                onLineModeChange={setCandleLineMorph}
                {...(chartView === 'candle'
                  ? {
                      candles: feed.candles,
                      liveCandle: feed.liveCandle,
                    }
                  : chartView === 'multi'
                    ? { series: demoSeries }
                    : {})}
                orderbook={
                  chartView === 'multi' || !showOrderbookStream ? undefined : syntheticOrderbook
                }
              />

              <View style={styles.statusRail}>
                <Text style={[styles.statusText, { color: muted }]}>
                  value: <Text style={{ color: headline }}>{feed.value.toFixed(2)}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  delta:{' '}
                  <Text style={{ color: deltaColor }}>
                    {valueDelta >= 0 ? '+' : ''}
                    {valueDelta.toFixed(2)}
                  </Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  tick: <Text style={{ color: headline }}>{tickMs}ms</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  vol: <Text style={{ color: headline }}>{volatility}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  mode: <Text style={{ color: headline }}>{degenMode ? 'degen' : 'classic'}</Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  chart:{' '}
                  <Text style={{ color: headline }}>
                    {chartView}
                    {chartView === 'candle' ? (candleLineMorph ? ' +morph' : '') : ''}
                  </Text>
                </Text>
                <Text style={[styles.statusText, { color: muted }]}>
                  badge: <Text style={{ color: headline }}>{showBadge ? 'on' : 'off'}</Text>
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
  gestureRoot: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  contentWrap: {
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
    gap: 14,
  },
  headerBlock: {
    gap: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 720,
  },
  controlPanel: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  helperText: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: -2,
    marginBottom: 4,
  },
  statusRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    paddingTop: 2,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
