import type { ChartPadding, LiveLinePoint } from './types';
import { pickValueInterval, niceTimeInterval } from './math/intervals';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function defaultFormatValue(value: number) {
  return value.toFixed(2);
}

export function defaultFormatTime(time: number) {
  const d = new Date(time * 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function toScreenXJs(
  time: number,
  leftEdge: number,
  rightEdge: number,
  width: number,
  pad: ChartPadding,
) {
  const chartWidth = Math.max(1, width - pad.left - pad.right);
  return pad.left + ((time - leftEdge) / (rightEdge - leftEdge || 1)) * chartWidth;
}

export function toScreenYJs(
  value: number,
  min: number,
  max: number,
  height: number,
  pad: ChartPadding,
) {
  const chartHeight = Math.max(1, height - pad.top - pad.bottom);
  const span = Math.max(0.0001, max - min);
  return pad.top + (1 - (value - min) / span) * chartHeight;
}

export function interpAtTimeJs(points: readonly LiveLinePoint[], target: number) {
  if (points.length === 0) return null;
  if (target <= points[0].time) return points[0].value;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    if (target <= curr.time) {
      const span = curr.time - prev.time || 1;
      const progress = (target - prev.time) / span;
      return prev.value + (curr.value - prev.value) * progress;
    }
  }
  return points[points.length - 1].value;
}

export function nearestPointAtTimeJs(points: readonly LiveLinePoint[], target: number) {
  if (points.length === 0) return null;
  let nearest = points[0];
  let bestDistance = Math.abs(points[0].time - target);
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].time - target);
    if (distance < bestDistance) {
      nearest = points[index];
      bestDistance = distance;
    }
  }
  return nearest;
}

export function calcGridTicksJs(
  min: number,
  max: number,
  chartHeight: number,
  height: number,
  pad: ChartPadding,
  formatValue: (value: number) => string,
) {
  const range = Math.max(0.0001, max - min);
  const ppu = chartHeight / range;
  const coarse = pickValueInterval(range, ppu, 36, 1);
  const fine = coarse / 2;
  const ticks: Array<{ key: number; value: number; y: number; text: string; alpha: number; isCoarse: boolean }> = [];
  const first = Math.ceil(min / fine) * fine;
  for (let value = first; value <= max; value += fine) {
    const y = toScreenYJs(value, min, max, height, pad);
    const isCoarse = Math.abs(Math.round(value / coarse) * coarse - value) < coarse * 0.01;
    ticks.push({
      key: Math.round(value * 1000),
      value,
      y,
      text: formatValue(value),
      alpha: isCoarse ? 1 : 0.7,
      isCoarse,
    });
  }
  return ticks;
}

export function calcTimeTicksJs(
  leftEdge: number,
  rightEdge: number,
  width: number,
  pad: ChartPadding,
  formatTime: (time: number) => string,
) {
  const chartWidth = width - pad.left - pad.right;
  const interval = niceTimeInterval(rightEdge - leftEdge);
  const first = Math.ceil(leftEdge / interval) * interval;
  const ticks: Array<{ key: number; x: number; text: string; alpha: number; width: number }> = [];
  for (let time = first; time <= rightEdge && ticks.length < 30; time += interval) {
    const text = formatTime(time);
    ticks.push({
      key: Math.round(time * 100),
      x: toScreenXJs(time, leftEdge, rightEdge, width, pad),
      text,
      alpha: 1,
      width: Math.max(48, text.length * 7.2),
    });
  }
  return ticks;
}
