/**
 * Candle layout matching `liveline-upstream/src/draw/candlestick.ts` (candleDims + placement).
 */
import type { CandlePoint, ChartPadding } from '../types';
import { toScreenXJs, toScreenYJs } from '../nativeChartUtils';

/** Upstream Liveline candle bull/bear (fixed hex, not theme accent). */
export const LIVELINE_CANDLE_BULL = '#22c55e';
export const LIVELINE_CANDLE_BEAR = '#ef4444';

export function inferCandleWidthSecs(visible: CandlePoint[], windowSpanSecs: number): number {
  if (visible.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < visible.length; i++) {
      gaps.push(Math.max(1e-6, visible[i].time - visible[i - 1].time));
    }
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)]!;
  }
  if (visible.length === 1) {
    return Math.max(0.25, windowSpanSecs / 32);
  }
  return Math.max(0.25, windowSpanSecs / 32);
}

/** Same math as upstream `candleDims` (body 70% of candle span in px, wick width from body). */
export function candleDimsFromLayout(
  chartWidthPx: number,
  windowSpanSecs: number,
  candleWidthSecs: number,
): { bodyW: number; wickW: number; radius: number } {
  const pxPerSec = chartWidthPx / Math.max(1e-9, windowSpanSecs);
  const candlePxW = candleWidthSecs * pxPerSec;
  const bodyW = Math.max(1, candlePxW * 0.7);
  const wickW = Math.max(0.8, Math.min(2, bodyW * 0.15));
  const radius = bodyW > 6 ? 1.5 : 0;
  return { bodyW, wickW, radius };
}

export type LivelineCandleLayoutRow = {
  c: CandlePoint;
  cx: number;
  bodyW: number;
  halfBody: number;
  wickW: number;
  radius: number;
  yHigh: number;
  yLow: number;
  bodyTop: number;
  bodyBottom: number;
  bodyH: number;
  bullish: boolean;
  isLive: boolean;
  fill: string;
};

export function layoutLivelineCandles(
  visible: CandlePoint[],
  liveCandleTime: number,
  leftEdge: number,
  rightEdge: number,
  layoutWidth: number,
  layoutHeight: number,
  pad: ChartPadding,
  rangeMin: number,
  rangeMax: number,
  candleWidthSecs: number,
  /** Optional max body width in px (legacy); omit for pure upstream sizing. */
  maxBodyWidthPx?: number,
): LivelineCandleLayoutRow[] {
  if (visible.length === 0 || layoutWidth <= 0) return [];

  const chartW = Math.max(1, layoutWidth - pad.left - pad.right);
  const windowSpan = rightEdge - leftEdge || 1;
  let { bodyW, wickW, radius } = candleDimsFromLayout(chartW, windowSpan, candleWidthSecs);
  if (maxBodyWidthPx != null && maxBodyWidthPx > 0) {
    bodyW = Math.min(bodyW, maxBodyWidthPx);
    wickW = Math.max(0.8, Math.min(2, bodyW * 0.15));
    radius = bodyW > 6 ? 1.5 : 0;
  }

  const halfBody = bodyW / 2;
  const padL = pad.left;
  const padR = layoutWidth - pad.right;
  const rows: LivelineCandleLayoutRow[] = [];

  for (const c of visible) {
    const cx = toScreenXJs(c.time + candleWidthSecs / 2, leftEdge, rightEdge, layoutWidth, pad);
    if (cx + halfBody < padL || cx - halfBody > padR) continue;

    const yHigh = toScreenYJs(c.high, rangeMin, rangeMax, layoutHeight, pad);
    const yLow = toScreenYJs(c.low, rangeMin, rangeMax, layoutHeight, pad);
    const yOpen = toScreenYJs(c.open, rangeMin, rangeMax, layoutHeight, pad);
    const yClose = toScreenYJs(c.close, rangeMin, rangeMax, layoutHeight, pad);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    const bodyH = Math.max(1, bodyBottom - bodyTop);
    const bullish = c.close >= c.open;
    const isLive = liveCandleTime >= 0 && c.time === liveCandleTime;
    const fill = bullish ? LIVELINE_CANDLE_BULL : LIVELINE_CANDLE_BEAR;

    rows.push({
      c,
      cx,
      bodyW,
      halfBody,
      wickW,
      radius,
      yHigh,
      yLow,
      bodyTop,
      bodyBottom,
      bodyH,
      bullish,
      isLive,
      fill,
    });
  }

  return rows;
}
