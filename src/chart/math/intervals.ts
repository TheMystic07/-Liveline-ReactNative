/**
 * Pick a nice time interval in seconds for time axis labels — identical to upstream.
 */
export function niceTimeInterval(windowSecs: number): number {
  if (windowSecs <= 15) return 2;
  if (windowSecs <= 30) return 5;
  if (windowSecs <= 60) return 10;
  if (windowSecs <= 120) return 15;
  if (windowSecs <= 300) return 30;
  if (windowSecs <= 600) return 60;
  if (windowSecs <= 1800) return 300;
  if (windowSecs <= 3600) return 600;
  if (windowSecs <= 14400) return 1800;
  if (windowSecs <= 43200) return 3600;
  if (windowSecs <= 86400) return 7200;
  if (windowSecs <= 604800) return 86400;
  return 604800;
}

/**
 * Pick a nice value interval — TradingView's cycling divisor approach.
 * Used for grid Y-axis labels.
 */
export function pickValueInterval(
  valRange: number,
  pxPerUnit: number,
  minGap: number,
  prev: number,
): number {
  // Hysteresis: once chosen, sticks until spacing falls outside [0.5x, 4x] of minGap
  if (prev > 0) {
    const px = prev * pxPerUnit;
    if (px >= minGap * 0.5 && px <= minGap * 4) return prev;
  }

  const divisorSets = [
    [2, 2.5, 2],
    [2, 2, 2.5],
    [2.5, 2, 2],
  ];
  let best = Infinity;
  for (const divs of divisorSets) {
    let span = Math.pow(10, Math.ceil(Math.log10(valRange)));
    let i = 0;
    while ((span / divs[i % 3]) * pxPerUnit >= minGap) {
      span /= divs[i % 3];
      i++;
    }
    if (span < best) best = span;
  }
  return best === Infinity ? valRange / 5 : best;
}
