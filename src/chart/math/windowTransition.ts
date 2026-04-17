/**
 * Window transition utilities — identical to upstream Liveline.
 *
 * Uses log-space cosine ease-in-out for smooth zooming between
 * different time windows (e.g. 30s → 2m).
 */

export const WINDOW_TRANSITION_MS = 750;

/** Cosine ease-in-out: smooth at start and end. */
function cosineEaseInOut(t: number): number {
  'worklet';
  return (1 - Math.cos(t * Math.PI)) / 2;
}

/**
 * Interpolate between two window durations in log-space.
 * Log-space interpolation ensures smooth zooming across
 * orders of magnitude (e.g. 15s → 2m looks as smooth as 30s → 60s).
 */
export function lerpWindowLogSpace(
  from: number,
  to: number,
  progress: number,
): number {
  'worklet';
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const eased = cosineEaseInOut(progress);
  const logFrom = Math.log(from);
  const logTo = Math.log(to);
  return Math.exp(logFrom + (logTo - logFrom) * eased);
}
