import { useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveLineChart, type LiveLineTheme, type WindowOption } from './src/chart';
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
  const [degenMode, setDegenMode] = useState(true);

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

  const pageBackground = theme === 'dark' ? '#111111' : '#f5f5f5';
  const panelBackground = theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
  const panelBorder = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const headline = theme === 'dark' ? '#ffffff' : '#111111';
  const muted = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  const deltaColor = valueDelta >= 0 ? '#22c55e' : '#ef4444';

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
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

              <ControlRow label="Mode" labelColor={muted}>
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
                  theme={theme}
                  accent={accent}
                />
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
              degen={degenMode}
              loading={feed.data.length < 2}
              height={320}
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
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
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
