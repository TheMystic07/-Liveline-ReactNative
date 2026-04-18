import { useEffect, useMemo, useRef, useState } from 'react';

import type { CandlePoint, LiveLinePoint } from '../chart';

type Volatility = 'calm' | 'normal' | 'chaos';

const VOLATILITY_SCALE: Record<Volatility, number> = {
  calm: 0.22,
  normal: 0.7,
  chaos: 1.7,
};

/** Wall-clock bucket length (seconds) for OHLC candles (matches upstream-style fixed period). */
export const MOCK_CANDLE_BUCKET_SEC = 5;

function bucketStart(timeSec: number): number {
  return Math.floor(timeSec / MOCK_CANDLE_BUCKET_SEC) * MOCK_CANDLE_BUCKET_SEC;
}

function nextPoint(previous: number, time: number, volatility: Volatility) {
  const scale = VOLATILITY_SCALE[volatility];
  const drift = (Math.random() - 0.47) * scale;
  const spike = Math.random() > 0.94 ? (Math.random() - 0.5) * scale * 4.5 : 0;
  return {
    time,
    value: previous + drift + spike,
  };
}

function aggregateOHLC(points: LiveLinePoint[]): { candles: CandlePoint[]; live: CandlePoint | undefined } {
  if (points.length === 0) return { candles: [], live: undefined };
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const lastT = sorted[sorted.length - 1].time;
  const currentBucket = bucketStart(lastT);
  const groups = new Map<number, LiveLinePoint[]>();
  for (const p of sorted) {
    const b = bucketStart(p.time);
    const arr = groups.get(b) ?? [];
    arr.push(p);
    groups.set(b, arr);
  }
  const history: CandlePoint[] = [];
  for (const [b, arr] of [...groups.entries()].sort((x, y) => x[0] - y[0])) {
    if (b >= currentBucket) continue;
    const open = arr[0].value;
    const close = arr[arr.length - 1].value;
    let high = open;
    let low = open;
    for (const q of arr) {
      if (q.value > high) high = q.value;
      if (q.value < low) low = q.value;
    }
    history.push({ time: b, open, high, low, close });
  }
  const cur = groups.get(currentBucket);
  let live: CandlePoint | undefined;
  if (cur && cur.length > 0) {
    const open = cur[0].value;
    const close = cur[cur.length - 1].value;
    let high = open;
    let low = open;
    for (const q of cur) {
      if (q.value > high) high = q.value;
      if (q.value < low) low = q.value;
    }
    live = { time: currentBucket, open, high, low, close };
  }
  return { candles: history.slice(-140), live };
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
  const hasSeedDataRef = useRef(false);

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
    hasSeedDataRef.current = true;
    setData(seeded);
    setValue(cursor);
  }, [baseValue, volatility]);

  useEffect(() => {
    if (paused || !hasSeedDataRef.current) {
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
      setData((current) => [...current.slice(-480), point]);
    }, tickMs);

    return () => clearInterval(interval);
  }, [mania, paused, tickMs, volatility]);

  const { candles, live } = useMemo(() => aggregateOHLC(data), [data]);

  return useMemo(
    () => ({
      data,
      value,
      candles,
      liveCandle: live,
    }),
    [candles, data, live, value],
  );
}
