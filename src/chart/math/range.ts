import type { LiveLinePoint } from '../types';

/**
 * Compute visible Y range — identical to upstream.
 * Uses 12% margin (not 18% like the old native version).
 */
export function computeRange(
  visible: LiveLinePoint[],
  currentValue: number,
  exaggerate: boolean = false,
): { min: number; max: number } {
  let targetMin = Infinity;
  let targetMax = -Infinity;

  for (const p of visible) {
    if (p.value < targetMin) targetMin = p.value;
    if (p.value > targetMax) targetMax = p.value;
  }

  if (currentValue < targetMin) targetMin = currentValue;
  if (currentValue > targetMax) targetMax = currentValue;

  // Handle edge case of no data
  if (!isFinite(targetMin) || !isFinite(targetMax)) {
    targetMin = currentValue;
    targetMax = currentValue;
  }

  const rawRange = targetMax - targetMin;
  const marginFactor = exaggerate ? 0.01 : 0.12;
  const minRange =
    rawRange * (exaggerate ? 0.02 : 0.1) || (exaggerate ? 0.04 : 0.4);

  if (rawRange < minRange) {
    const mid = (targetMin + targetMax) / 2;
    targetMin = mid - minRange / 2;
    targetMax = mid + minRange / 2;
  } else {
    const margin = rawRange * marginFactor;
    targetMin -= margin;
    targetMax += margin;
  }

  return { min: targetMin, max: targetMax };
}
