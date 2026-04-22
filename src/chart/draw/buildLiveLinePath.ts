import type { ChartPadding, LiveLinePoint } from '../types';
import type { SkPath } from '@shopify/react-native-skia';

type ScreenPoint = { x: number; y: number };

/* ------------------------------------------------------------------ */
/*  Pre-allocated buffers — avoids per-frame GC in worklet hot paths   */
/* ------------------------------------------------------------------ */

const BUF_SIZE = 512;

/** Reusable buffers for Fritsch-Carlson spline math (module scope = worklet-safe). */
const _delta = new Float64Array(BUF_SIZE);
const _hh = new Float64Array(BUF_SIZE);
const _m = new Float64Array(BUF_SIZE + 1); // size n, up to BUF_SIZE+1
/** Flat X/Y buffers for screen points in buildPath / buildPathToSkPath. */
const _spX = new Float64Array(BUF_SIZE);
const _spY = new Float64Array(BUF_SIZE);

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

  // Use pre-allocated buffers when n fits, fall back to dynamic for huge datasets
  const useBuf = n <= BUF_SIZE;
  const delta = useBuf ? _delta : new Float64Array(n - 1);
  const hh = useBuf ? _hh : new Float64Array(n - 1);
  const m = useBuf ? _m : new Float64Array(n);

  for (let i = 0; i < n - 1; i++) {
    hh[i] = pts[i + 1]!.x - pts[i]!.x;
    delta[i] = hh[i] === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / hh[i]!;
  }

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

export function buildSplinePathFromBuffers(
  xPoints: ArrayLike<number>,
  yPoints: ArrayLike<number>,
  count: number,
  floorY?: number,
): string {
  'worklet';
  if (count <= 0) return '';
  if (count < 2) {
    const x0 = xPoints[0]!;
    const y0 = yPoints[0]!;
    const cmds = [`M ${x0} ${y0}`, `L ${x0 + 0.1} ${y0}`];
    if (floorY !== undefined) cmds.push(`L ${x0 + 0.1} ${floorY}`, `L ${x0} ${floorY}`, 'Z');
    return cmds.join(' ');
  }

  const useBuf = count <= BUF_SIZE;
  const delta = useBuf ? _delta : new Float64Array(count - 1);
  const hh = useBuf ? _hh : new Float64Array(count - 1);
  const m = useBuf ? _m : new Float64Array(count);

  for (let i = 0; i < count - 1; i++) {
    hh[i] = xPoints[i + 1]! - xPoints[i]!;
    delta[i] = hh[i] === 0 ? 0 : (yPoints[i + 1]! - yPoints[i]!) / hh[i]!;
  }

  m[0] = delta[0]!;
  m[count - 1] = delta[count - 2]!;
  for (let i = 1; i < count - 1; i++) {
    m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
  }

  for (let i = 0; i < count - 1; i++) {
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

  const cmds: string[] = [`M ${xPoints[0]!} ${yPoints[0]!}`];
  for (let i = 0; i < count - 1; i++) {
    const hi = hh[i]!;
    cmds.push(
      `C ${xPoints[i]! + hi / 3} ${yPoints[i]! + m[i]! * hi / 3} ${xPoints[i + 1]! - hi / 3} ${yPoints[i + 1]! - m[i + 1]! * hi / 3} ${xPoints[i + 1]!} ${yPoints[i + 1]!}`,
    );
  }

  if (floorY !== undefined) {
    cmds.push(`L ${xPoints[count - 1]!} ${floorY}`, `L ${xPoints[0]!} ${floorY}`, 'Z');
  }
  return cmds.join(' ');
}

/** Build a Fritsch-Carlson monotone spline directly into an existing {@link SkPath}. */
export function buildSplinePathToSkPath(
  path: SkPath,
  pts: readonly ScreenPoint[],
  floorY?: number,
): void {
  'worklet';
  path.reset();
  if (pts.length === 0) return;
  if (pts.length < 2) {
    path.moveTo(pts[0]!.x, pts[0]!.y).lineTo(pts[0]!.x + 0.1, pts[0]!.y);
    if (floorY !== undefined) {
      path.lineTo(pts[0]!.x + 0.1, floorY).lineTo(pts[0]!.x, floorY).close();
    }
    return;
  }

  const n = pts.length;

  const useBuf = n <= BUF_SIZE;
  const delta = useBuf ? _delta : new Float64Array(n - 1);
  const hh = useBuf ? _hh : new Float64Array(n - 1);
  const m = useBuf ? _m : new Float64Array(n);

  for (let i = 0; i < n - 1; i++) {
    hh[i] = pts[i + 1]!.x - pts[i]!.x;
    delta[i] = hh[i] === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / hh[i]!;
  }

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

  path.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 0; i < n - 1; i++) {
    const hi = hh[i]!;
    path.cubicTo(
      pts[i]!.x + hi / 3,
      pts[i]!.y + m[i]! * hi / 3,
      pts[i + 1]!.x - hi / 3,
      pts[i + 1]!.y - m[i + 1]! * hi / 3,
      pts[i + 1]!.x,
      pts[i + 1]!.y,
    );
  }

  if (floorY !== undefined) {
    path.lineTo(pts[n - 1]!.x, floorY).lineTo(pts[0]!.x, floorY).close();
  }
}

export function buildSplinePathToSkPathFromBuffers(
  path: SkPath,
  xPoints: ArrayLike<number>,
  yPoints: ArrayLike<number>,
  count: number,
  floorY?: number,
): void {
  'worklet';
  path.reset();
  if (count <= 0) return;
  if (count < 2) {
    const x0 = xPoints[0]!;
    const y0 = yPoints[0]!;
    path.moveTo(x0, y0).lineTo(x0 + 0.1, y0);
    if (floorY !== undefined) {
      path.lineTo(x0 + 0.1, floorY).lineTo(x0, floorY).close();
    }
    return;
  }

  const useBuf = count <= BUF_SIZE;
  const delta = useBuf ? _delta : new Float64Array(count - 1);
  const hh = useBuf ? _hh : new Float64Array(count - 1);
  const m = useBuf ? _m : new Float64Array(count);

  for (let i = 0; i < count - 1; i++) {
    hh[i] = xPoints[i + 1]! - xPoints[i]!;
    delta[i] = hh[i] === 0 ? 0 : (yPoints[i + 1]! - yPoints[i]!) / hh[i]!;
  }

  m[0] = delta[0]!;
  m[count - 1] = delta[count - 2]!;
  for (let i = 1; i < count - 1; i++) {
    m[i] = delta[i - 1]! * delta[i]! <= 0 ? 0 : (delta[i - 1]! + delta[i]!) / 2;
  }

  for (let i = 0; i < count - 1; i++) {
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

  path.moveTo(xPoints[0]!, yPoints[0]!);
  for (let i = 0; i < count - 1; i++) {
    const hi = hh[i]!;
    path.cubicTo(
      xPoints[i]! + hi / 3,
      yPoints[i]! + m[i]! * hi / 3,
      xPoints[i + 1]! - hi / 3,
      yPoints[i + 1]! - m[i + 1]! * hi / 3,
      xPoints[i + 1]!,
      yPoints[i + 1]!,
    );
  }

  if (floorY !== undefined) {
    path.lineTo(xPoints[count - 1]!, floorY).lineTo(xPoints[0]!, floorY).close();
  }
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

  // Use flat buffers to avoid object allocation per point
  const useFlatBuf = dataEnd + 2 <= BUF_SIZE;
  let spCount = 0;

  if (useFlatBuf) {
    for (let i = 0; i < dataEnd; i++) {
      const p = pts[i]!;
      if (p.time < leftEdge - 2) continue;
      if (p.time > rightEdge + 1) break;
      const x = pad.left + ((p.time - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
      const value = i === pts.length - 1 ? tipV : p.value;
      const rawY = pad.top + (1 - (value - lo) / span) * ch;
      _spX[spCount] = x;
      _spY[spCount] = cy(rawY);
      spCount++;
    }
    if (spCount === 0) return '';

    if (includeTip) {
      const tipX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
      const tipY = cy(pad.top + (1 - (tipV - lo) / span) * ch);
      _spX[spCount] = tipX;
      _spY[spCount] = tipY;
      spCount++;
    }
    return buildSplinePathFromBuffers(_spX, _spY, spCount, floor ? h - pad.bottom : undefined);
  }

  // Fallback for very large datasets
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

/** Build a live line path directly into an existing {@link SkPath} (avoids SVG string creation). */
export function buildPathToSkPath(
  path: SkPath,
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
): void {
  'worklet';
  path.reset();
  if (pts.length === 0 || w <= 0 || h <= 0) return;

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

  // Use flat buffers to avoid object allocation per point
  const useFlatBuf = dataEnd + 2 <= BUF_SIZE;
  let spCount = 0;

  if (useFlatBuf) {
    for (let i = 0; i < dataEnd; i++) {
      const p = pts[i]!;
      if (p.time < leftEdge - 2) continue;
      if (p.time > rightEdge + 1) break;
      const x = pad.left + ((p.time - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
      const value = i === pts.length - 1 ? tipV : p.value;
      const rawY = pad.top + (1 - (value - lo) / span) * ch;
      _spX[spCount] = x;
      _spY[spCount] = cy(rawY);
      spCount++;
    }
    if (spCount === 0) return;

    if (includeTip) {
      const tipX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
      const tipY = cy(pad.top + (1 - (tipV - lo) / span) * ch);
      _spX[spCount] = tipX;
      _spY[spCount] = tipY;
      spCount++;
    }
    buildSplinePathToSkPathFromBuffers(
      path,
      _spX,
      _spY,
      spCount,
      floor ? h - pad.bottom : undefined,
    );
    return;
  }

  // Fallback for very large datasets
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
  if (screenPoints.length === 0) return;

  if (includeTip) {
    const tipX = pad.left + ((tipT - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
    const tipY = cy(pad.top + (1 - (tipV - lo) / span) * ch);
    screenPoints.push({ x: tipX, y: tipY });
  }

  buildSplinePathToSkPath(path, screenPoints, floor ? h - pad.bottom : undefined);
}
