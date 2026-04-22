import type { CandlePoint, LiveLinePoint } from '../chart';

export type DemoVolatility = 'calm' | 'normal' | 'chaos';

export type FeedSnapshot = {
  data: LiveLinePoint[];
  value: number;
  candles: CandlePoint[];
  liveCandle: CandlePoint | undefined;
};

export const VOLATILITY_SCALE: Record<DemoVolatility, number> = {
  calm: 0.22,
  normal: 0.7,
  chaos: 1.7,
};

export const MOCK_CANDLE_BUCKET_SEC = 5;
const DEFAULT_SEED_END = 1_700_000_000;

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveSeed(baseValue: number, volatility: DemoVolatility, endTime: number) {
  const vol = volatility === 'calm' ? 17 : volatility === 'normal' ? 31 : 47;
  return Math.round(baseValue * 100) ^ vol ^ Math.floor(endTime);
}

function bucketStart(timeSec: number) {
  return Math.floor(timeSec / MOCK_CANDLE_BUCKET_SEC) * MOCK_CANDLE_BUCKET_SEC;
}

export function nextPoint(
  previous: number,
  time: number,
  volatility: DemoVolatility,
  random: () => number = Math.random,
) {
  const scale = VOLATILITY_SCALE[volatility];
  const drift = (random() - 0.47) * scale;
  const spike = random() > 0.94 ? (random() - 0.5) * scale * 4.5 : 0;
  return {
    time,
    value: previous + drift + spike,
  };
}

export function aggregateOHLC(points: LiveLinePoint[]): {
  candles: CandlePoint[];
  live: CandlePoint | undefined;
} {
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

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const pointBucket = bucketStart(point.time);
    if (pointBucket !== bucket) {
      const candle: CandlePoint = { time: bucket, open, high, low, close };
      if (bucket < currentBucket) history.push(candle);
      else live = candle;
      bucket = pointBucket;
      open = point.value;
      high = point.value;
      low = point.value;
      close = point.value;
      seen = 1;
      continue;
    }
    if (point.value > high) high = point.value;
    if (point.value < low) low = point.value;
    close = point.value;
    seen += 1;
  }

  if (seen > 0) {
    const candle: CandlePoint = { time: bucket, open, high, low, close };
    if (bucket < currentBucket) history.push(candle);
    else live = candle;
  }

  return {
    candles: history.length > 140 ? history.slice(-140) : history,
    live,
  };
}

export function buildSeedSnapshot(
  baseValue: number,
  volatility: DemoVolatility,
  options?: {
    endTime?: number;
    seed?: number;
  },
): FeedSnapshot {
  const seedEnd = options?.endTime ?? DEFAULT_SEED_END;
  const random = createRng(options?.seed ?? deriveSeed(baseValue, volatility, seedEnd));
  const seeded: LiveLinePoint[] = [];
  let cursor = baseValue;

  for (let index = 140; index >= 0; index -= 1) {
    const point = nextPoint(cursor, seedEnd - index * 0.6, volatility, random);
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

export function nextSnapshotFromPoint(
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
