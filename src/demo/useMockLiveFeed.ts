import { useEffect, useMemo, useRef, useState } from 'react';

import type { CandlePoint, LiveLinePoint } from '../chart';

type Volatility = 'calm' | 'normal' | 'chaos';
const FEED_FLUSH_MS = 200;

const VOLATILITY_SCALE: Record<Volatility, number> = {
  calm: 0.22,
  normal: 0.7,
  chaos: 1.7,
};

/** Wall-clock bucket length (seconds) for OHLC candles (matches upstream-style fixed period). */
export const MOCK_CANDLE_BUCKET_SEC = 5;

const CAPACITY = 480;

class PointRing {
  private buf: LiveLinePoint[] = new Array(CAPACITY);
  private head = 0;
  private size = 0;

  push(p: LiveLinePoint): void {
    const idx = (this.head + this.size) % CAPACITY;
    this.buf[idx] = p;
    if (this.size < CAPACITY) {
      this.size += 1;
    } else {
      this.head = (this.head + 1) % CAPACITY;
    }
  }

  seed(points: LiveLinePoint[]): void {
    const take = Math.min(CAPACITY, points.length);
    this.head = 0;
    this.size = take;
    for (let i = 0; i < take; i++) {
      this.buf[i] = points[points.length - take + i]!;
    }
  }

  toArray(): LiveLinePoint[] {
    const out = new Array<LiveLinePoint>(this.size);
    for (let i = 0; i < this.size; i++) {
      out[i] = this.buf[(this.head + i) % CAPACITY]!;
    }
    return out;
  }

  get length(): number {
    return this.size;
  }

  last(): LiveLinePoint | undefined {
    if (this.size === 0) return undefined;
    return this.buf[(this.head + this.size - 1) % CAPACITY];
  }
}

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

  const lastT = points[points.length - 1]!.time;
  const currentBucket = bucketStart(lastT);
  const history: CandlePoint[] = [];

  let bucket = bucketStart(points[0]!.time);
  let open = points[0]!.value;
  let high = open;
  let low = open;
  let close = open;
  let seen = 0;
  let live: CandlePoint | undefined;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const b = bucketStart(p.time);
    if (b !== bucket) {
      const candle: CandlePoint = { time: bucket, open, high, low, close };
      if (bucket < currentBucket) {
        history.push(candle);
      } else {
        live = candle;
      }
      bucket = b;
      open = p.value;
      high = p.value;
      low = p.value;
      close = p.value;
      seen = 1;
      continue;
    }
    if (p.value > high) high = p.value;
    if (p.value < low) low = p.value;
    close = p.value;
    seen += 1;
  }

  if (seen > 0) {
    const candle: CandlePoint = { time: bucket, open, high, low, close };
    if (bucket < currentBucket) {
      history.push(candle);
    } else {
      live = candle;
    }
  }

  const candles = history.length > 140 ? history.slice(-140) : history;
  return { candles, live };
}

type FeedSnapshot = {
  data: LiveLinePoint[];
  value: number;
  candles: CandlePoint[];
  liveCandle: CandlePoint | undefined;
};

function buildSeedSnapshot(baseValue: number, volatility: Volatility): FeedSnapshot {
  const seedEnd = Date.now() / 1000;
  const seeded: LiveLinePoint[] = [];
  let cursor = baseValue;

  for (let index = 140; index >= 0; index -= 1) {
    const point = nextPoint(cursor, seedEnd - index * 0.6, volatility);
    cursor = point.value;
    seeded.push(point);
  }

  const { candles, live } = aggregateOHLC(seeded);
  return {
    data: seeded,
    value: cursor,
    candles,
    liveCandle: live,
  };
}

function nextSnapshotFromRing(
  current: FeedSnapshot,
  nextData: LiveLinePoint[],
  point: LiveLinePoint,
): FeedSnapshot {
  const pointBucket = bucketStart(point.time);
  const live = current.liveCandle;

  if (!live) {
    return {
      data: nextData,
      value: point.value,
      candles: current.candles,
      liveCandle: {
        time: pointBucket,
        open: point.value,
        high: point.value,
        low: point.value,
        close: point.value,
      },
    };
  }

  if (pointBucket < live.time) {
    const { candles, live: fallbackLive } = aggregateOHLC(nextData);
    return { data: nextData, value: point.value, candles, liveCandle: fallbackLive };
  }

  if (pointBucket === live.time) {
    return {
      data: nextData,
      value: point.value,
      candles: current.candles,
      liveCandle: {
        ...live,
        high: Math.max(live.high, point.value),
        low: Math.min(live.low, point.value),
        close: point.value,
      },
    };
  }

  return {
    data: nextData,
    value: point.value,
    candles: [...current.candles, live].slice(-140),
    liveCandle: {
      time: pointBucket,
      open: point.value,
      high: point.value,
      low: point.value,
      close: point.value,
    },
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
  const ringRef = useRef<PointRing>(new PointRing());
  const [feed, setFeed] = useState<FeedSnapshot>(() => {
    const snap = buildSeedSnapshot(baseValue, volatility);
    ringRef.current.seed(snap.data);
    return snap;
  });
  const latestValueRef = useRef(baseValue);
  const hasSeedDataRef = useRef(false);
  const pendingPointRef = useRef<LiveLinePoint | null>(null);

  useEffect(() => {
    const seeded = buildSeedSnapshot(baseValue, volatility);
    latestValueRef.current = seeded.value;
    hasSeedDataRef.current = true;
    pendingPointRef.current = null;
    ringRef.current = new PointRing();
    ringRef.current.seed(seeded.data);
    setFeed(seeded);
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
      pendingPointRef.current = point;
    }, tickMs);

    const flush = setInterval(() => {
      const point = pendingPointRef.current;
      if (!point) return;
      pendingPointRef.current = null;
      ringRef.current.push(point);
      const nextData = ringRef.current.toArray();
      setFeed((current) => nextSnapshotFromRing(current, nextData, point));
    }, FEED_FLUSH_MS);

    return () => {
      clearInterval(interval);
      clearInterval(flush);
    };
  }, [mania, paused, tickMs, volatility]);

  return useMemo(() => feed, [feed]);
}
