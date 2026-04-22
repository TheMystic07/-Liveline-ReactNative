import { niceTimeInterval, pickValueInterval } from './math/intervals';
import type { ChartPadding, LiveLinePoint } from './types';

const WINDOW_BUFFER_BADGE = 0.05;
const WINDOW_BUFFER_NO_BADGE = 0.015;
const FINE_LABEL_SHOW_PX = 60;
const FINE_LABEL_HIDE_PX = 40;

export function windowBuffer(showBadge: boolean) {
  return showBadge ? WINDOW_BUFFER_BADGE : WINDOW_BUFFER_NO_BADGE;
}

export function windowEdges(now: number, win: number, buffer: number) {
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return { leftEdge, rightEdge };
}

export function getVisible(
  data: readonly LiveLinePoint[],
  now: number,
  win: number,
  buffer: number,
) {
  const { leftEdge, rightEdge } = windowEdges(now, win, buffer);
  return data.filter((p) => p.time >= leftEdge - 2 && p.time <= rightEdge + 1);
}

export function toScreenXJs(
  t: number,
  now: number,
  win: number,
  w: number,
  pad: ChartPadding,
  buffer: number,
) {
  const cw = Math.max(1, w - pad.left - pad.right);
  const rightEdge = now + win * buffer;
  const leftEdge = rightEdge - win;
  return pad.left + ((t - leftEdge) / (rightEdge - leftEdge || 1)) * cw;
}

export function toScreenY(
  v: number,
  lo: number,
  hi: number,
  h: number,
  pad: ChartPadding,
) {
  const ch = Math.max(1, h - pad.top - pad.bottom);
  const span = Math.max(0.0001, hi - lo);
  return pad.top + (1 - (v - lo) / span) * ch;
}

export interface SnapshotGridTick {
  value: number;
  y: number;
  text: string;
  isCoarse: boolean;
  fineOp: number;
}

export function calcGridTicks(
  minV: number,
  maxV: number,
  chartH: number,
  padT: number,
  padB: number,
  h: number,
  fmt: (v: number) => string,
  prevInt: number,
): { ticks: SnapshotGridTick[]; interval: number } {
  const range = maxV - minV;
  if (chartH <= 0 || range <= 0) return { ticks: [], interval: prevInt };
  const ppu = chartH / range;
  const coarse = pickValueInterval(range, ppu, 36, prevInt);
  const fine = coarse / 2;
  const toY = (v: number) => padT + (1 - (v - minV) / range) * chartH;
  const fade = 32;
  const edge = (y: number) => {
    const d = Math.min(y - padT, h - padB - y);
    return d >= fade ? 1 : d <= 0 ? 0 : d / fade;
  };
  const finePxSpacing = fine * ppu;
  let fineOp = 1;
  if (finePxSpacing < FINE_LABEL_HIDE_PX) fineOp = 0;
  else if (finePxSpacing < FINE_LABEL_SHOW_PX)
    fineOp = (finePxSpacing - FINE_LABEL_HIDE_PX) / (FINE_LABEL_SHOW_PX - FINE_LABEL_HIDE_PX);

  const ticks: SnapshotGridTick[] = [];
  const first = Math.ceil(minV / fine) * fine;
  for (let v = first; v <= maxV; v += fine) {
    const y = toY(v);
    if (y < padT - 2 || y > h - padB + 2) continue;
    const isC = Math.abs(Math.round(v / coarse) * coarse - v) < coarse * 0.01;
    if (edge(y) < 0.02) continue;
    const edgeA = edge(y);
    ticks.push({
      value: v,
      y,
      text: fmt(v),
      isCoarse: isC,
      fineOp: isC ? edgeA : edgeA * fineOp,
    });
  }
  return { ticks, interval: coarse };
}

export interface SnapshotTimeTick {
  time: number;
  x: number;
  text: string;
  edge: number;
}

export function calcTimeTicks(
  now: number,
  win: number,
  w: number,
  pad: ChartPadding,
  fmt: (t: number) => string,
  buffer: number,
): SnapshotTimeTick[] {
  const cl = pad.left;
  const cr = w - pad.right;
  const cw = cr - cl;
  if (cw <= 0) return [];

  const { leftEdge, rightEdge } = windowEdges(now, win, buffer);
  const left = leftEdge;
  const right = rightEdge;
  const pps = cw / (rightEdge - leftEdge || 1);
  let interval = niceTimeInterval(win);
  while (interval * pps < 60 && interval < win) interval *= 2;

  const toX = (t: number) => cl + ((t - left) / (right - left || 1)) * cw;
  const fadeZ = 50;
  const edge = (x: number) => {
    const d = Math.min(x - cl, cr - x);
    return d >= fadeZ ? 1 : d <= 0 ? 0 : d / fadeZ;
  };

  const first = Math.ceil((left - interval) / interval) * interval;
  const out: SnapshotTimeTick[] = [];
  for (let t = first; t <= right + interval && out.length < 30; t += interval) {
    const x = toX(t);
    if (x < cl - 20 || x > cr + 20) continue;
    const e = edge(x);
    if (e < 0.05) continue;
    out.push({ time: t, x, text: fmt(t), edge: e });
  }
  return out;
}
