import type { ChartPadding, LiveLinePoint } from './types';

export function clampW(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Read-only clone of the live worklet: interpolate value at a wall-clock time. */
export function scrubInterpAtTime(
  pts: readonly LiveLinePoint[],
  target: number,
  tipT: number,
  tipV: number,
): number {
  if (pts.length === 0) return tipV;
  if (target <= pts[0]!.time) return pts[0]!.value;
  for (let i = 1; i < pts.length; i++) {
    if (target <= pts[i]!.time) {
      const span = pts[i]!.time - pts[i - 1]!.time || 1;
      const p = (target - pts[i - 1]!.time) / span;
      return pts[i - 1]!.value + (pts[i]!.value - pts[i - 1]!.value) * p;
    }
  }
  const last = pts[pts.length - 1]!;
  if (target <= tipT) {
    const span = tipT - last.time || 1;
    return last.value + (tipV - last.value) * ((target - last.time) / span);
  }
  return tipV;
}

function nearestPointAtTime(
  pts: readonly LiveLinePoint[],
  target: number,
  tipT: number,
  tipV: number,
) {
  if (pts.length === 0) return { time: tipT, value: tipV };
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pts[mid]!.time < target) lo = mid + 1;
    else hi = mid;
  }
  const upper = pts[lo]!;
  const lower = lo > 0 ? pts[lo - 1]! : upper;
  let nearest = Math.abs(upper.time - target) < Math.abs(lower.time - target) ? upper : lower;
  if (Math.abs(tipT - target) < Math.abs(nearest.time - target)) {
    nearest = { time: tipT, value: tipV };
  }
  return nearest;
}

export type ScrubLineSample = {
  hx: number;
  ht: number;
  hv: number;
  liveX: number;
};

/**
 * X → time/value along the static window (identical to `NativeLiveLineChart` `sampleScrubAtX`, JS thread).
 */
export function sampleScrubAtX(
  x: number,
  layoutWidth: number,
  pad: ChartPadding,
  win: number,
  buf: number,
  tipT: number,
  tipV: number,
  pts: readonly LiveLinePoint[],
  snapToPoint: boolean,
): ScrubLineSample {
  const chartW = Math.max(1, layoutWidth - pad.left - pad.right);
  const rightEdge = tipT + win * buf;
  const leftEdge = rightEdge - win;
  const liveX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * chartW;
  const rawHx = clampW(x, pad.left, liveX);
  const rawHt = leftEdge + ((rawHx - pad.left) / chartW) * (rightEdge - leftEdge);
  if (!snapToPoint) {
    const hv = scrubInterpAtTime(pts, rawHt, tipT, tipV);
    return { hx: rawHx, ht: rawHt, hv, liveX };
  }
  const nearest = nearestPointAtTime(pts, rawHt, tipT, tipV);
  const snappedX =
    pad.left + ((nearest.time - leftEdge) / (rightEdge - leftEdge || 1)) * chartW;
  return {
    hx: clampW(snappedX, pad.left, liveX),
    ht: nearest.time,
    hv: nearest.value,
    liveX,
  };
}

const CROSSHAIR_FADE_MIN_PX = 5;

/** Fade crosshair + dim live dot when the finger sits on the live tip. */
export function crosshairScrubAttenuation(hx: number, liveX: number, chartWInner: number): number {
  const cw = Math.max(1, chartWInner);
  const dist = liveX - hx;
  const fadeStart = Math.min(80, cw * 0.3);
  if (dist < CROSSHAIR_FADE_MIN_PX) return 0;
  if (dist >= fadeStart) return 1;
  return (dist - CROSSHAIR_FADE_MIN_PX) / (fadeStart - CROSSHAIR_FADE_MIN_PX);
}
