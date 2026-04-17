/**
 * Chart shake utility for degen mode — matching upstream.
 *
 * When a particle burst fires, the chart applies a subtle shake
 * that decays exponentially.
 */

/** Decay per ~16.67ms frame (0.92 means rapid falloff). */
export const SHAKE_DECAY = 0.92;

/** Initial amplitude scales with swing magnitude and burst intensity. */
export function shakeAmplitude(swingMagnitude: number, burstIntensity: number): number {
  return (3 + swingMagnitude * 4) * burstIntensity;
}

/** Per-frame decay — call from worklet frame callback. */
export function decayShake(current: number, dt: number): number {
  'worklet';
  const factor = Math.pow(SHAKE_DECAY, dt / 16.67);
  return Math.abs(current) < 0.15 ? 0 : current * factor;
}

/** Random directional shake offset. */
export function randomShakeOffset(amplitude: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * amplitude,
    y: Math.sin(angle) * amplitude,
  };
}
