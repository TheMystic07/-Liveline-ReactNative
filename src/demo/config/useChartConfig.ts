import { useState } from 'react';

import type { BadgeVariant } from '../../chart';

export type ChartView = 'line' | 'multi' | 'candle';
export type RenderMode = 'live' | 'static';

export type ChartConfig = {
  theme: 'dark' | 'light';
  setTheme: (v: 'dark' | 'light') => void;
  accent: string;
  setAccent: (v: string) => void;
  renderMode: RenderMode;
  setRenderMode: (v: RenderMode) => void;
  chartView: ChartView;
  setChartView: (v: ChartView) => void;
  windowSecs: number;
  setWindowSecs: (v: number) => void;
  showBadge: boolean;
  setShowBadge: (v: boolean) => void;
  badgeVariant: BadgeVariant;
  setBadgeVariant: (v: BadgeVariant) => void;
  badgeNumberFlow: boolean;
  setBadgeNumberFlow: (v: boolean) => void;
  liveDotGlow: boolean;
  setLiveDotGlow: (v: boolean) => void;
  lineTrailGlow: boolean;
  setLineTrailGlow: (v: boolean) => void;
  gradientLineColoring: boolean;
  setGradientLineColoring: (v: boolean) => void;
  showOrderbookStream: boolean;
  setShowOrderbookStream: (v: boolean) => void;
  showReferenceLine: boolean;
  setShowReferenceLine: (v: boolean) => void;
  candleLineMorph: boolean;
  setCandleLineMorph: (v: boolean) => void;
};

const DEFAULT_ACCENT = '#3b82f6';

export function useChartConfig(): ChartConfig {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [accent, setAccent] = useState<string>(DEFAULT_ACCENT);
  const [renderMode, setRenderMode] = useState<RenderMode>('live');
  const [chartView, setChartView] = useState<ChartView>('line');
  const [windowSecs, setWindowSecs] = useState<number>(30);
  const [showBadge, setShowBadge] = useState<boolean>(true);
  const [badgeVariant, setBadgeVariant] = useState<BadgeVariant>('default');
  const [badgeNumberFlow, setBadgeNumberFlow] = useState<boolean>(false);
  const [liveDotGlow, setLiveDotGlow] = useState<boolean>(false);
  const [lineTrailGlow, setLineTrailGlow] = useState<boolean>(false);
  const [gradientLineColoring, setGradientLineColoring] = useState<boolean>(false);
  const [showOrderbookStream, setShowOrderbookStream] = useState<boolean>(false);
  const [showReferenceLine, setShowReferenceLine] = useState<boolean>(false);
  const [candleLineMorph, setCandleLineMorph] = useState<boolean>(false);

  return {
    theme,
    setTheme,
    accent,
    setAccent,
    renderMode,
    setRenderMode,
    chartView,
    setChartView,
    windowSecs,
    setWindowSecs,
    showBadge,
    setShowBadge,
    badgeVariant,
    setBadgeVariant,
    badgeNumberFlow,
    setBadgeNumberFlow,
    liveDotGlow,
    setLiveDotGlow,
    lineTrailGlow,
    setLineTrailGlow,
    gradientLineColoring,
    setGradientLineColoring,
    showOrderbookStream,
    setShowOrderbookStream,
    showReferenceLine,
    setShowReferenceLine,
    candleLineMorph,
    setCandleLineMorph,
  };
}
