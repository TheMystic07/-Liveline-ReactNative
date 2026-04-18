import { memo } from 'react';
import { View } from 'react-native';

import { Chip, ControlRow } from '../Controls';
import type { ChartConfig } from '../config/useChartConfig';
import type { FeedConfig } from '../config/useFeedConfig';

const TICK_RATES = [
  { label: '80ms', value: 80 },
  { label: '150ms', value: 150 },
  { label: '300ms', value: 300 },
  { label: '900ms', value: 900 },
];

type Props = {
  feed: FeedConfig;
  accent: string;
  theme: ChartConfig['theme'];
  muted: string;
  chartViewSupportsDegen: boolean;
};

function FeedControlsSectionInner({ feed, accent, theme, muted, chartViewSupportsDegen }: Props) {
  return (
    <View>
      <ControlRow label="Transport" labelColor={muted}>
        {TICK_RATES.map((option) => (
          <Chip
            key={option.value}
            active={feed.tickMs === option.value}
            label={option.label}
            onPress={() => feed.setTickMs(option.value)}
            theme={theme}
            accent={accent}
          />
        ))}
        <Chip active={feed.paused} label={feed.paused ? 'Resume' : 'Pause'} onPress={() => feed.setPaused((p) => !p)} theme={theme} accent={accent} />
      </ControlRow>

      <ControlRow label="Profile" labelColor={muted}>
        <Chip active={!feed.degenMode} label="Classic" onPress={() => feed.setDegenMode(false)} theme={theme} accent={accent} />
        <Chip active={feed.degenMode} label="Degen" onPress={() => feed.setDegenMode(true)} disabled={!chartViewSupportsDegen} theme={theme} accent={accent} />
      </ControlRow>

      <ControlRow label="Degen+" labelColor={muted}>
        <Chip
          active={chartViewSupportsDegen && feed.degenDownMomentum}
          label="Down move"
          onPress={() => feed.setDegenDownMomentum((p) => !p)}
          disabled={!chartViewSupportsDegen}
          theme={theme}
          accent={accent}
        />
        {[1, 1.5, 2].map((scale) => (
          <Chip
            key={scale}
            active={chartViewSupportsDegen && feed.degenScale === scale}
            label={`${scale}x`}
            onPress={() => feed.setDegenScale(scale as 1 | 1.5 | 2)}
            disabled={!chartViewSupportsDegen}
            theme={theme}
            accent={accent}
          />
        ))}
      </ControlRow>

      <ControlRow label="Volatility" labelColor={muted}>
        <Chip active={feed.volatility === 'calm'} label="Calm" onPress={() => feed.setVolatility('calm')} theme={theme} accent={accent} />
        <Chip active={feed.volatility === 'normal'} label="Normal" onPress={() => feed.setVolatility('normal')} theme={theme} accent={accent} />
        <Chip active={feed.volatility === 'chaos'} label="Chaos" onPress={() => feed.setVolatility('chaos')} theme={theme} accent={accent} />
      </ControlRow>
    </View>
  );
}

export const FeedControlsSection = memo(FeedControlsSectionInner);
