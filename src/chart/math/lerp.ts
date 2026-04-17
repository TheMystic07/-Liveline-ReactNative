/**
 * Frame-rate-independent exponential lerp (matches upstream Liveline `math/lerp`).
 * `speed` is the fraction approached per 16.67ms (60fps frame).
 */
export function lerp(current: number, target: number, speed: number, dt = 16.67): number {
  'worklet';
  const factor = 1 - Math.pow(1 - speed, dt / 16.67);
  return current + (target - current) * factor;
}
