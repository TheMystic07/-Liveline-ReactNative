import { memo } from 'react';
import { View } from 'react-native';

import { Chip, ControlRow } from '../Controls';
import type { ChartConfig } from '../config/useChartConfig';

const ACCENTS = [
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Bitcoin', value: '#f7931a' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Violet', value: '#8b5cf6' },
];

type Props = {
  config: ChartConfig;
  muted: string;
  chartViewSupportsGlow: boolean;
  chartViewSupportsOrderbook: boolean;
  chartViewSupportsGradient: boolean;
  chartViewSupportsTrailGlow: boolean;
};

function ChartControlsSectionInner({
  config,
  muted,
  chartViewSupportsGlow,
  chartViewSupportsOrderbook,
  chartViewSupportsGradient,
  chartViewSupportsTrailGlow,
}: Props) {
  const { theme, accent } = config;
  return (
    <View>
      <ControlRow label="Theme" labelColor={muted}>
        <Chip active={theme === 'dark'} label="Dark" onPress={() => config.setTheme('dark')} theme={theme} accent={accent} />
        <Chip active={theme === 'light'} label="Light" onPress={() => config.setTheme('light')} theme={theme} accent={accent} />
      </ControlRow>

      <ControlRow label="Badge" labelColor={muted}>
        <Chip active={config.showBadge} label="On" onPress={() => config.setShowBadge(true)} theme={theme} accent={accent} />
        <Chip active={!config.showBadge} label="Off" onPress={() => config.setShowBadge(false)} theme={theme} accent={accent} />
        <Chip active={config.badgeVariant === 'default'} label="Default" onPress={() => config.setBadgeVariant('default')} theme={theme} accent={accent} />
        <Chip active={config.badgeVariant === 'minimal'} label="Minimal" onPress={() => config.setBadgeVariant('minimal')} theme={theme} accent={accent} />
        <Chip active={config.badgeNumberFlow} label="Num flow" onPress={() => config.setBadgeNumberFlow(!config.badgeNumberFlow)} theme={theme} accent={accent} />
      </ControlRow>

      <ControlRow label="Chart" labelColor={muted}>
        <Chip active={config.chartView === 'line'} label="Line" onPress={() => { config.setChartView('line'); config.setCandleLineMorph(false); }} theme={theme} accent={accent} />
        <Chip active={config.chartView === 'multi'} label="Multi" onPress={() => config.setChartView('multi')} theme={theme} accent={accent} />
        <Chip active={config.chartView === 'candle'} label="Candle" onPress={() => config.setChartView('candle')} theme={theme} accent={accent} />
      </ControlRow>

      <ControlRow label="Effects" labelColor={muted}>
        <Chip
          active={chartViewSupportsOrderbook && config.showOrderbookStream}
          label="Book stream"
          onPress={() => config.setShowOrderbookStream(!config.showOrderbookStream)}
          disabled={!chartViewSupportsOrderbook}
          theme={theme}
          accent={accent}
        />
        <Chip
          active={chartViewSupportsGlow && config.liveDotGlow}
          label="Dot glow"
          onPress={() => config.setLiveDotGlow(!config.liveDotGlow)}
          disabled={!chartViewSupportsGlow}
          theme={theme}
          accent={accent}
        />
        <Chip
          active={chartViewSupportsTrailGlow && config.lineTrailGlow}
          label="Trail glow"
          onPress={() => config.setLineTrailGlow(!config.lineTrailGlow)}
          disabled={!chartViewSupportsTrailGlow}
          theme={theme}
          accent={accent}
        />
        <Chip
          active={chartViewSupportsGradient && config.gradientLineColoring}
          label="Gradient"
          onPress={() => config.setGradientLineColoring(!config.gradientLineColoring)}
          disabled={!chartViewSupportsGradient}
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
            onPress={() => config.setAccent(option.value)}
            theme={theme}
            accent={option.value}
          />
        ))}
      </ControlRow>
    </View>
  );
}

export const ChartControlsSection = memo(ChartControlsSectionInner);
