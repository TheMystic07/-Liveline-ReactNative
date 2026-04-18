import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { lerp } from '../math/lerp';

type GridLabelInput = {
  value: number;
  y: number;
  text: string;
  isCoarse: boolean;
  fineOp: number;
};

type TimeLabelInput = {
  time: number;
  x: number;
  text: string;
};

export type TrackedGridLabel = {
  key: number;
  value: number;
  y: number;
  text: string;
  alpha: number;
  isCoarse: boolean;
};

export type TrackedTimeLabel = {
  key: number;
  x: number;
  text: string;
  alpha: number;
  width: number;
};

const GRID_FADE_IN = 0.18;
const GRID_FADE_OUT = 0.12;
const TIME_FADE = 0.08;
const TIME_LABEL_CHAR_W = 7.25;
const TIME_LABEL_MIN_W = 48;
const TIME_LABEL_GAP = 8;

function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function consumeDelta(lastTsRef: MutableRefObject<number | null>): number {
  const now = getNowMs();
  const prev = lastTsRef.current;
  lastTsRef.current = now;
  if (prev == null) return 16.67;
  return Math.min(64, Math.max(8, now - prev));
}

function snapAlpha(alpha: number, target: number): number {
  if (target === 0 && alpha < 0.01) return 0;
  if (target === 1 && alpha > 0.99) return 1;
  if (Math.abs(alpha - target) < 0.02) return target;
  return alpha;
}

export function useTrackedGridLabels(ticks: readonly GridLabelInput[]): TrackedGridLabel[] {
  const stateRef = useRef<Map<number, TrackedGridLabel>>(new Map());
  const lastTsRef = useRef<number | null>(null);

  return useMemo(() => {
    const dt = consumeDelta(lastTsRef);
    const state = stateRef.current;
    const targets = new Map<number, GridLabelInput>();

    for (const tick of ticks) {
      targets.set(Math.round(tick.value * 1000), tick);
    }

    for (const [key, entry] of state) {
      const tick = targets.get(key);
      const target = tick?.fineOp ?? 0;
      const speed = target >= entry.alpha ? GRID_FADE_IN : GRID_FADE_OUT;
      const nextAlpha = snapAlpha(lerp(entry.alpha, target, speed, dt), target);

      if (tick) {
        entry.value = tick.value;
        entry.y = tick.y;
        entry.text = tick.text;
        entry.isCoarse = tick.isCoarse;
      }

      if (nextAlpha <= 0 && !tick) {
        state.delete(key);
        continue;
      }

      entry.alpha = nextAlpha;
      state.set(key, entry);
    }

    for (const [key, tick] of targets) {
      if (state.has(key)) continue;
      state.set(key, {
        key,
        value: tick.value,
        y: tick.y,
        text: tick.text,
        alpha: snapAlpha(tick.fineOp * GRID_FADE_IN, tick.fineOp),
        isCoarse: tick.isCoarse,
      });
    }

    return Array.from(state.values())
      .filter((entry) => entry.alpha > 0.02)
      .sort((a, b) => a.y - b.y);
  }, [ticks]);
}

export function useTrackedTimeLabels(ticks: readonly TimeLabelInput[]): TrackedTimeLabel[] {
  const stateRef = useRef<Map<number, TrackedTimeLabel>>(new Map());
  const lastTsRef = useRef<number | null>(null);

  return useMemo(() => {
    const dt = consumeDelta(lastTsRef);
    const state = stateRef.current;
    const targets = new Map<number, TimeLabelInput>();

    for (const tick of ticks) {
      targets.set(Math.round(tick.time * 100), tick);
    }

    for (const [key, entry] of state) {
      const tick = targets.get(key);
      const target = tick ? 1 : 0;
      const nextAlpha = snapAlpha(lerp(entry.alpha, target, TIME_FADE, dt), target);

      if (tick) {
        entry.x = tick.x;
        entry.text = tick.text;
        entry.width = Math.max(TIME_LABEL_MIN_W, tick.text.length * TIME_LABEL_CHAR_W);
      }

      if (nextAlpha <= 0 && !tick) {
        state.delete(key);
        continue;
      }

      entry.alpha = nextAlpha;
      state.set(key, entry);
    }

    for (const [key, tick] of targets) {
      if (state.has(key)) continue;
      state.set(key, {
        key,
        x: tick.x,
        text: tick.text,
        alpha: 0,
        width: Math.max(TIME_LABEL_MIN_W, tick.text.length * TIME_LABEL_CHAR_W),
      });
    }

    const ordered = Array.from(state.values())
      .filter((entry) => entry.alpha > 0.02)
      .sort((a, b) => a.x - b.x);

    const resolved: TrackedTimeLabel[] = [];
    for (const label of ordered) {
      const left = label.x - label.width / 2;
      const prev = resolved[resolved.length - 1];
      if (prev) {
        const prevRight = prev.x + prev.width / 2;
        if (left < prevRight + TIME_LABEL_GAP) {
          if (label.alpha > prev.alpha) {
            resolved[resolved.length - 1] = label;
          }
          continue;
        }
      }
      resolved.push(label);
    }

    return resolved;
  }, [ticks]);
}
