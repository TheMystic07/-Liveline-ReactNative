import type { ChartPadding, LiveLinePoint } from '../types';

type ScreenPoint = { x: number; y: number };

export function buildSplinePath(
  pts: readonly ScreenPoint[],
  floorY?: number,
): string {
  'worklet';
  if (pts.length === 0) return '';
  if (pts.length < 2) {
    const cmds = [`M ${pts[0]!.x} ${pts[0]!.y}`, `L ${pts[0]!.x + 0.1} ${pts[0]!.y}`];
    if (floorY !== undefined) cmds.push(`L ${pts[0]!.x + 0.1} ${floorY}`, `L ${pts[0]!.x} ${floorY}`, 'Z');
    return cmds.join(' ');
  }

  const n = pts.length;
  const delta: number[] = new Array(n - 1);
  const hh: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    hh[i] = pts[i + 1]!.x - pts[i]!.x;
    delta[i] = hh[i] === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / hh[i]!;
  }

  const m: number[] = new Array(n);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i]! / delta[i]!;
      const b = m[i + 1]! / delta[i]!;
      const s2 = a * a + b * b;
      if (s2 > 9) {
        const s = 3 / Math.sqrt(s2);
        m[i] = s * a * delta[i]!;
        m[i + 1] = s * b * delta[i]!;
      }
    }
  }

  const cmds: string[] = [`M ${pts[0]!.x} ${pts[0]!.y}`];
  for (let i = 0; i < n - 1; i++) {
    const hi = hh[i]!;
    cmds.push(
      `C ${pts[i]!.x + hi / 3} ${pts[i]!.y + m[i]! * hi / 3} ${pts[i + 1]!.x - hi / 3} ${pts[i + 1]!.y - m[i + 1]! * hi / 3} ${pts[i + 1]!.x} ${pts[i + 1]!.y}`,
    );
  }

  if (floorY !== undefined) {
    cmds.push(`L ${pts[n - 1]!.x} ${floorY}`, `L ${pts[0]!.x} ${floorY}`, 'Z');
  }
  return cmds.join(' ');
}

export function buildPath(
  pts: readonly LiveLinePoint[],
  tipT: number,
  tipV: number,
  lo: number,
  hi: number,
  w: number,
  h: number,
  pad: ChartPadding,
  win: number,
  buffer: number,
  floor: boolean,
  includeTip = true,
  trimTrailingDataPoints = 0,
): string {
  'worklet';
  if (pts.length === 0 || w <= 0 || h <= 0) return '';

  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const lastDataT = pts[pts.length - 1]!.time;
  let rightEdge = tipT + win * buffer;
  let leftEdge = rightEdge - win;
  if (leftEdge > lastDataT - 2) {
    rightEdge = lastDataT + win * buffer;
    leftEdge = rightEdge - win;
  }

  const span = Math.max(0.0001, hi - lo);
  const yMin = pad.top;
  const yMax = h - pad.bottom;
  const cy = (y: number) => Math.max(yMin, Math.min(yMax, y));

  const dataEnd = Math.max(0, pts.length - trimTrailingDataPoints);
  const screenPoints: ScreenPoint[] = [];
  for (let i = 0; i < dataEnd; i++) {
    const p = pts[i]!;
    if (p.time < leftEdge - 2) continue;
    if (p.time > rightEdge + 1) break;
    const x = pad.left + ((p.time - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const value = i === pts.length - 1 ? tipV : p.value;
    const rawY = pad.top + (1 - (value - lo) / span) * ch;
    screenPoints.push({ x, y: cy(rawY) });
  }
  if (screenPoints.length === 0) return '';

  if (includeTip) {
    const tipX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const tipY = cy(pad.top + (1 - (tipV - lo) / span) * ch);
    screenPoints.push({ x: tipX, y: tipY });
  }

  return buildSplinePath(screenPoints, floor ? h - pad.bottom : undefined);
}
