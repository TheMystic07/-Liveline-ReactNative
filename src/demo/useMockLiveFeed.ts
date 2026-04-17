import { useEffect, useMemo, useRef, useState } from 'react';

import type { LiveLinePoint } from '../chart';

type Volatility = 'calm' | 'normal' | 'chaos';

const VOLATILITY_SCALE: Record<Volatility, number> = {
  calm: 0.22,
  normal: 0.7,
  chaos: 1.7,
};

function nextPoint(previous: number, time: number, volatility: Volatility) {
  const scale = VOLATILITY_SCALE[volatility];
  const drift = (Math.random() - 0.47) * scale;
  const spike = Math.random() > 0.94 ? (Math.random() - 0.5) * scale * 4.5 : 0;
  return {
    time,
    value: previous + drift + spike,
  };
}

export function useMockLiveFeed({
  tickMs,
  volatility,
  paused,
  mania = false,
  baseValue = 100,
}: {
  tickMs: number;
  volatility: Volatility;
  paused: boolean;
  mania?: boolean;
  baseValue?: number;
}) {
  const [data, setData] = useState<LiveLinePoint[]>([]);
  const [value, setValue] = useState(baseValue);
  const latestValueRef = useRef(baseValue);

  useEffect(() => {
    const seedEnd = Date.now() / 1000;
    const seeded: LiveLinePoint[] = [];
    let cursor = baseValue;

    for (let index = 140; index >= 0; index -= 1) {
      const point = nextPoint(cursor, seedEnd - index * 0.6, volatility);
      cursor = point.value;
      seeded.push(point);
    }

    latestValueRef.current = cursor;
    setData(seeded);
    setValue(cursor);
  }, [baseValue, volatility]);

  useEffect(() => {
    if (paused || data.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      const nextTime = Date.now() / 1000;
      const basePoint = nextPoint(latestValueRef.current, nextTime, volatility);
      const maniaSpike =
        mania && Math.random() > 0.76
          ? (Math.random() - 0.5) * VOLATILITY_SCALE[volatility] * 3.8
          : 0;
      const momentumDrift =
        mania && Math.random() > 0.52
          ? (Math.random() > 0.5 ? 1 : -1) * VOLATILITY_SCALE[volatility] * 0.48
          : 0;
      const point = {
        time: nextTime,
        value: basePoint.value + maniaSpike + momentumDrift,
      };
      latestValueRef.current = point.value;
      setValue(point.value);
      setData((current) => [...current.slice(-360), point]);
    }, tickMs);

    return () => clearInterval(interval);
  }, [data.length, mania, paused, tickMs, volatility]);

  return useMemo(
    () => ({
      data,
      value,
    }),
    [data, value],
  );
}
