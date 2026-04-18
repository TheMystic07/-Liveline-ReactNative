import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { lerp as lerpFr } from './math/lerp';

const RANGE_LERP_SPEED = 0.15;
const RANGE_ADAPTIVE_BOOST = 0.2;
const ADAPTIVE_SPEED_BOOST = 0.2;
const VALUE_SNAP_THRESHOLD = 0.001;
const LIVE_TIP_CLOCK_CATCHUP = 0.42;
const ENGINE_IDLE_STOP_MS = 60;
const MAX_DELTA_MS = 50;

/** Max simultaneous series (multi-mode uses 2). */
const MAX_SERIES = 8;

function tickSeriesSlot(
  slot: SharedValue<number>,
  target: SharedValue<number>,
  dt: number,
  prevR: number,
): void {
  'worklet';
  const cur = slot.value;
  const tgt = target.value;
  const gap = Math.abs(tgt - cur);
  const spd = RANGE_LERP_SPEED + (1 - Math.min(gap / prevR, 1)) * ADAPTIVE_SPEED_BOOST;
  let next = lerpFr(cur, tgt, spd, dt);
  if (Math.abs(next - tgt) < prevR * VALUE_SNAP_THRESHOLD) next = tgt;
  slot.value = next;
}

function slotPairConverged(slot: SharedValue<number>, target: SharedValue<number>): boolean {
  'worklet';
  return Math.abs(slot.value - target.value) <= 1e-4;
}

export type SmoothingEngineInputs = {
  targetMin: number;
  targetMax: number;
  seriesTargets: ReadonlyArray<{ id: string; value: number }>;
  dataTipT: number;
  enabled: boolean;
};

export type SmoothingEngineApi = {
  svMin: SharedValue<number>;
  svMax: SharedValue<number>;
  svTipT: SharedValue<number>;
  getSeriesTipV: (id: string) => SharedValue<number>;
  pulse: () => void;
};

export function useChartSmoothingEngine(
  inputs: SmoothingEngineInputs,
): SmoothingEngineApi {
  const svMin = useSharedValue(inputs.targetMin);
  const svMax = useSharedValue(inputs.targetMax);
  const svTargetMin = useSharedValue(inputs.targetMin);
  const svTargetMax = useSharedValue(inputs.targetMax);
  const svTipT = useSharedValue(inputs.dataTipT);
  const svDataTipT = useSharedValue(inputs.dataTipT);
  const svIdleMs = useSharedValue(0);

  const slot0 = useSharedValue(0);
  const slot1 = useSharedValue(0);
  const slot2 = useSharedValue(0);
  const slot3 = useSharedValue(0);
  const slot4 = useSharedValue(0);
  const slot5 = useSharedValue(0);
  const slot6 = useSharedValue(0);
  const slot7 = useSharedValue(0);
  const target0 = useSharedValue(0);
  const target1 = useSharedValue(0);
  const target2 = useSharedValue(0);
  const target3 = useSharedValue(0);
  const target4 = useSharedValue(0);
  const target5 = useSharedValue(0);
  const target6 = useSharedValue(0);
  const target7 = useSharedValue(0);

  const slots = useMemo(
    () => [slot0, slot1, slot2, slot3, slot4, slot5, slot6, slot7],
    [slot0, slot1, slot2, slot3, slot4, slot5, slot6, slot7],
  );
  const targets = useMemo(
    () => [target0, target1, target2, target3, target4, target5, target6, target7],
    [target0, target1, target2, target3, target4, target5, target6, target7],
  );

  const slotByIdRef = useRef<Map<string, number>>(new Map());
  const freeSlotsRef = useRef<number[]>([0, 1, 2, 3, 4, 5, 6, 7]);

  const registerSeries = useCallback(
    (id: string, initialValue: number) => {
      if (slotByIdRef.current.has(id)) return;
      const slotIdx = freeSlotsRef.current.shift();
      if (slotIdx === undefined) {
        throw new Error(`smoothingEngine: exceeded MAX_SERIES=${MAX_SERIES}`);
      }
      slotByIdRef.current.set(id, slotIdx);
      slots[slotIdx]!.value = initialValue;
      targets[slotIdx]!.value = initialValue;
    },
    [slots, targets],
  );

  const unregisterSeries = useCallback(
    (id: string) => {
      const slotIdx = slotByIdRef.current.get(id);
      if (slotIdx === undefined) return;
      slotByIdRef.current.delete(id);
      freeSlotsRef.current.push(slotIdx);
      slots[slotIdx]!.value = 0;
      targets[slotIdx]!.value = 0;
    },
    [slots, targets],
  );

  const getSeriesTipV = useCallback(
    (id: string): SharedValue<number> => {
      const idx = slotByIdRef.current.get(id);
      if (idx === undefined) {
        throw new Error(`smoothingEngine: series "${id}" is not registered`);
      }
      return slots[idx]!;
    },
    [slots],
  );

  const seriesSignature = inputs.seriesTargets.map((s) => `${s.id}:${s.value}`).join('|');

  for (const s of inputs.seriesTargets) {
    if (!slotByIdRef.current.has(s.id)) {
      registerSeries(s.id, s.value);
    }
  }
  for (const id of Array.from(slotByIdRef.current.keys())) {
    if (!inputs.seriesTargets.some((s) => s.id === id)) {
      unregisterSeries(id);
    }
  }

  useEffect(() => {
    svTargetMin.value = inputs.targetMin;
    svTargetMax.value = inputs.targetMax;
    svDataTipT.value = inputs.dataTipT;
    for (const s of inputs.seriesTargets) {
      const idx = slotByIdRef.current.get(s.id);
      if (idx !== undefined) targets[idx]!.value = s.value;
    }
  }, [
    inputs.targetMin,
    inputs.targetMax,
    inputs.dataTipT,
    seriesSignature,
    inputs.seriesTargets,
    svTargetMin,
    svTargetMax,
    svDataTipT,
    targets,
  ]);

  const [active, setActive] = useState(false);

  const pulse = useCallback(() => {
    svIdleMs.value = 0;
    setActive(true);
  }, [svIdleMs]);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const onFrame = useCallback(
    (frame: { timeSincePreviousFrame: number | null }) => {
      'worklet';
      const rawDt = frame.timeSincePreviousFrame;
      const dt = Math.min(MAX_DELTA_MS, rawDt == null ? 16.67 : rawDt);

      const wall = Date.now() / 1000;
      const dataT = svDataTipT.value;
      const targetT = Math.max(wall, dataT);
      let tipT = svTipT.value;
      tipT = lerpFr(tipT, targetT, LIVE_TIP_CLOCK_CATCHUP, Math.max(dt, 0.0001));
      if (Math.abs(tipT - targetT) < 0.002) tipT = targetT;
      svTipT.value = tipT;

      const curMin = svMin.value;
      const curMax = svMax.value;
      const tMin = svTargetMin.value;
      const tMax = svTargetMax.value;
      const rangeGap = Math.abs(curMax - curMin - (tMax - tMin));
      const basePrev = Math.max(1e-4, curMax - curMin);
      const rSpd = RANGE_LERP_SPEED + Math.min(rangeGap / basePrev, 1) * RANGE_ADAPTIVE_BOOST;
      svMin.value = lerpFr(curMin, tMin, rSpd, dt);
      svMax.value = lerpFr(curMax, tMax, rSpd, dt);

      const sMin = svMin.value;
      const sMax = svMax.value;
      const prevR = Math.max(1e-4, sMax - sMin);
      tickSeriesSlot(slot0, target0, dt, prevR);
      tickSeriesSlot(slot1, target1, dt, prevR);
      tickSeriesSlot(slot2, target2, dt, prevR);
      tickSeriesSlot(slot3, target3, dt, prevR);
      tickSeriesSlot(slot4, target4, dt, prevR);
      tickSeriesSlot(slot5, target5, dt, prevR);
      tickSeriesSlot(slot6, target6, dt, prevR);
      tickSeriesSlot(slot7, target7, dt, prevR);

      let allConverged =
        Math.abs(svMin.value - tMin) < 1e-4 && Math.abs(svMax.value - tMax) < 1e-4;
      if (allConverged) {
        if (
          !slotPairConverged(slot0, target0) ||
          !slotPairConverged(slot1, target1) ||
          !slotPairConverged(slot2, target2) ||
          !slotPairConverged(slot3, target3) ||
          !slotPairConverged(slot4, target4) ||
          !slotPairConverged(slot5, target5) ||
          !slotPairConverged(slot6, target6) ||
          !slotPairConverged(slot7, target7)
        ) {
          allConverged = false;
        }
      }

      if (allConverged) {
        svIdleMs.value += dt;
        if (svIdleMs.value >= ENGINE_IDLE_STOP_MS) {
          svIdleMs.value = -1e9;
          runOnJS(stop)();
        }
      } else {
        svIdleMs.value = 0;
      }
    },
    [
      svMin,
      svMax,
      svTargetMin,
      svTargetMax,
      svTipT,
      svDataTipT,
      svIdleMs,
      stop,
      slot0,
      slot1,
      slot2,
      slot3,
      slot4,
      slot5,
      slot6,
      slot7,
      target0,
      target1,
      target2,
      target3,
      target4,
      target5,
      target6,
      target7,
    ],
  );

  const frameHandle = useFrameCallback(onFrame, false);

  useEffect(() => {
    frameHandle.setActive(inputs.enabled && active);
  }, [inputs.enabled, active, frameHandle]);

  return useMemo(
    () => ({ svMin, svMax, svTipT, getSeriesTipV, pulse }),
    [svMin, svMax, svTipT, getSeriesTipV, pulse],
  );
}
