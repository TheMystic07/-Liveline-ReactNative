import type { ChartPadding, LiveLinePoint, ScreenPoint } from './types';

interface ChartLayoutInput {
  width: number;
  height: number;
  padding: ChartPadding;
}

interface BuildChartModelInput {
  data: LiveLinePoint[];
  displayValue: number;
  displayTime: number;
  windowSecs: number;
  layout: ChartLayoutInput;
  scrubX: number | null;
  formatValue: (value: number) => string;
  formatTime: (time: number) => string;
}

export interface AxisLabel {
  x: number;
  y: number;
  text: string;
}

export interface ChartModel {
  linePath: string | null;
  fillPath: string | null;
  screenPoints: ScreenPoint[];
  livePoint: ScreenPoint | null;
  hoverPoint: ScreenPoint | null;
  yTicks: AxisLabel[];
  xTicks: AxisLabel[];
  leftEdge: number;
  rightEdge: number;
  chartWidth: number;
  chartHeight: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeRange(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = values[0];
  let max = values[0];

  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (Math.abs(max - min) < 0.0001) {
    const delta = Math.max(Math.abs(max) * 0.04, 1);
    return { min: min - delta, max: max + delta };
  }

  const padding = (max - min) * 0.14;
  return {
    min: min - padding,
    max: max + padding,
  };
}

function buildSmoothPath(points: ScreenPoint[], floorY?: number) {
  if (points.length === 0) {
    return null;
  }

  const commands: string[] = [`M ${points[0].x} ${points[0].y}`];

  if (points.length === 1) {
    commands.push(`L ${points[0].x + 0.01} ${points[0].y}`);
  } else {
    for (let index = 0; index < points.length - 1; index += 1) {
      const p0 = points[index - 1] ?? points[index];
      const p1 = points[index];
      const p2 = points[index + 1];
      const p3 = points[index + 2] ?? p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      commands.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
    }
  }

  if (typeof floorY === 'number') {
    const first = points[0];
    const last = points[points.length - 1];
    commands.push(`L ${last.x} ${floorY}`);
    commands.push(`L ${first.x} ${floorY}`);
    commands.push('Z');
  }

  return commands.join(' ');
}

function interpolateValue(points: ScreenPoint[], targetTime: number) {
  if (points.length === 0) return null;
  if (targetTime <= points[0].time) return points[0].value;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (targetTime <= current.time) {
      const span = current.time - previous.time || 1;
      const progress = (targetTime - previous.time) / span;
      return previous.value + (current.value - previous.value) * progress;
    }
  }

  return points[points.length - 1].value;
}

export function buildChartModel({
  data,
  displayValue,
  displayTime,
  windowSecs,
  layout,
  scrubX,
  formatValue,
  formatTime,
}: BuildChartModelInput): ChartModel | null {
  const { width, height, padding } = layout;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  if (chartWidth <= 0 || chartHeight <= 0) {
    return null;
  }

  const latestTime = data[data.length - 1]?.time ?? displayTime;
  const rightEdge = Math.max(displayTime, latestTime) + windowSecs * 0.06;
  const leftEdge = rightEdge - windowSecs;
  const visible = data.filter((point) => point.time >= leftEdge - 2);

  if (visible.length === 0) {
    return {
      linePath: null,
      fillPath: null,
      screenPoints: [],
      livePoint: null,
      hoverPoint: null,
      yTicks: [],
      xTicks: [],
      leftEdge,
      rightEdge,
      chartWidth,
      chartHeight,
    };
  }

  const range = computeRange([...visible.map((point) => point.value), displayValue]);
  const valueSpan = range.max - range.min || 1;
  const toX = (time: number) =>
    padding.left + ((time - leftEdge) / (rightEdge - leftEdge || 1)) * chartWidth;
  const toY = (value: number) =>
    padding.top + (1 - (value - range.min) / valueSpan) * chartHeight;

  const screenPoints = visible.map<ScreenPoint>((point) => ({
    ...point,
    x: toX(point.time),
    y: toY(point.value),
  }));

  const livePoint: ScreenPoint = {
    time: displayTime,
    value: displayValue,
    x: toX(displayTime),
    y: toY(displayValue),
  };

  const mergedPoints = [...screenPoints];
  const lastPoint = mergedPoints[mergedPoints.length - 1];
  if (!lastPoint || livePoint.x - lastPoint.x > 1) {
    mergedPoints.push(livePoint);
  } else {
    mergedPoints[mergedPoints.length - 1] = livePoint;
  }

  const linePath = buildSmoothPath(mergedPoints);
  const fillPath = buildSmoothPath(mergedPoints, height - padding.bottom);

  const yTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const value = range.max - valueSpan * ratio;
    return {
      x: width - padding.right + 6,
      y: padding.top + chartHeight * ratio + 4,
      text: formatValue(value),
    };
  });

  const xTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const time = leftEdge + windowSecs * ratio;
    return {
      x: padding.left + chartWidth * ratio - 16,
      y: height - padding.bottom + 18,
      text: formatTime(time),
    };
  });

  let hoverPoint: ScreenPoint | null = null;
  if (typeof scrubX === 'number') {
    const clampedX = clamp(scrubX, padding.left, livePoint.x);
    const scrubTime = leftEdge + ((clampedX - padding.left) / (chartWidth || 1)) * windowSecs;
    const scrubValue = interpolateValue(mergedPoints, scrubTime);

    if (typeof scrubValue === 'number') {
      hoverPoint = {
        x: clampedX,
        y: toY(scrubValue),
        time: scrubTime,
        value: scrubValue,
      };
    }
  }

  return {
    linePath,
    fillPath,
    screenPoints: mergedPoints,
    livePoint,
    hoverPoint,
    yTicks,
    xTicks,
    leftEdge,
    rightEdge,
    chartWidth,
    chartHeight,
  };
}
