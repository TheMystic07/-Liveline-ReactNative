import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export type FeedConfig = {
  tickMs: number;
  setTickMs: (v: number) => void;
  volatility: 'calm' | 'normal' | 'chaos';
  setVolatility: (v: 'calm' | 'normal' | 'chaos') => void;
  paused: boolean;
  setPaused: (v: boolean | ((prev: boolean) => boolean)) => void;
  degenMode: boolean;
  setDegenMode: (v: boolean) => void;
  degenScale: 1 | 1.5 | 2;
  setDegenScale: (v: 1 | 1.5 | 2) => void;
  degenDownMomentum: boolean;
  setDegenDownMomentum: (v: boolean | ((prev: boolean) => boolean)) => void;
  appIsActive: boolean;
};

export function useFeedConfig(): FeedConfig {
  const [tickMs, setTickMs] = useState<number>(300);
  const [volatility, setVolatility] = useState<'calm' | 'normal' | 'chaos'>('normal');
  const [paused, setPaused] = useState<boolean>(false);
  const [degenMode, setDegenMode] = useState<boolean>(false);
  const [degenScale, setDegenScale] = useState<1 | 1.5 | 2>(1);
  const [degenDownMomentum, setDegenDownMomentum] = useState<boolean>(false);
  const [appIsActive, setAppIsActive] = useState<boolean>(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  return {
    tickMs,
    setTickMs,
    volatility,
    setVolatility,
    paused,
    setPaused,
    degenMode,
    setDegenMode,
    degenScale,
    setDegenScale,
    degenDownMomentum,
    setDegenDownMomentum,
    appIsActive,
  };
}
