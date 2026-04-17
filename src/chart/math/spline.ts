/**
 * Fritsch-Carlson monotone cubic interpolation — identical to upstream.
 * Guarantees no overshoots — the curve never exceeds local min/max.
 *
 * Returns SVG path string (M + C commands) for use with Skia Path.
 */
export function monotoneSplinePath(
  pts: { x: number; y: number }[],
  closeToFloor?: number,
): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const p = pts[0];
    const cmds = [`M ${p.x} ${p.y}`, `L ${p.x + 0.1} ${p.y}`];
    if (closeToFloor != null) {
      cmds.push(`L ${p.x + 0.1} ${closeToFloor}`, `L ${p.x} ${closeToFloor}`, 'Z');
    }
    return cmds.join(' ');
  }
  if (pts.length === 2) {
    const cmds = [`M ${pts[0].x} ${pts[0].y}`, `L ${pts[1].x} ${pts[1].y}`];
    if (closeToFloor != null) {
      cmds.push(
        `L ${pts[1].x} ${closeToFloor}`,
        `L ${pts[0].x} ${closeToFloor}`,
        'Z',
      );
    }
    return cmds.join(' ');
  }

  const n = pts.length;

  // 1. Compute secant slopes between consecutive points
  const delta: number[] = new Array(n - 1);
  const h: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1].x - pts[i].x;
    delta[i] = h[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h[i];
  }

  // 2. Initial tangent estimates
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (delta[i - 1] + delta[i]) / 2;
    }
  }

  // 3. Fritsch-Carlson constraint: alpha^2 + beta^2 <= 9
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const s2 = alpha * alpha + beta * beta;
      if (s2 > 9) {
        const s = 3 / Math.sqrt(s2);
        m[i] = s * alpha * delta[i];
        m[i + 1] = s * beta * delta[i];
      }
    }
  }

  // 4. Build SVG path using cubic bezier curves
  const commands: string[] = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < n - 1; i++) {
    const hi = h[i];
    const cp1x = pts[i].x + hi / 3;
    const cp1y = pts[i].y + m[i] * hi / 3;
    const cp2x = pts[i + 1].x - hi / 3;
    const cp2y = pts[i + 1].y - m[i + 1] * hi / 3;
    commands.push(
      `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${pts[i + 1].x} ${pts[i + 1].y}`,
    );
  }

  if (closeToFloor != null) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    commands.push(
      `L ${last.x} ${closeToFloor}`,
      `L ${first.x} ${closeToFloor}`,
      'Z',
    );
  }

  return commands.join(' ');
}
