import { useEffect, useMemo, useRef, useState } from 'react';

import type { LiveLinePoint } from '../chart';
import {
  VOLATILITY_SCALE,
  buildSeedSnapshot,
  nextPoint,
  nextSnapshotFromPoint,
  type DemoVolatility as Volatility,
  type FeedSnapshot,
} from './mockFeedData';
const FEED_FLUSH_MS = 200;

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
      setFeed((current) => nextSnapshotFromPoint(current, nextData, point));
    }, FEED_FLUSH_MS);

    return () => {
      clearInterval(interval);
      clearInterval(flush);
    };
  }, [mania, paused, tickMs, volatility]);

  return useMemo(() => feed, [feed]);
}
