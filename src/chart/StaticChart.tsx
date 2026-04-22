import { NativeStaticCandlestickChart } from './NativeStaticCandlestickChart';
import { NativeStaticLineChart } from './NativeStaticLineChart';
import { NativeStaticMultiSeriesChart } from './NativeStaticMultiSeriesChart';
import type { StaticChartProps } from './staticTypes';

/**
 * Public wrapper that routes to the correct static chart component
 * based on the provided props.
 *
 * - Multi-series data → `NativeStaticMultiSeriesChart`
 * - Candle mode with candle data → `NativeStaticCandlestickChart`
 * - Default → `NativeStaticLineChart`
 */
export function StaticChart(props: StaticChartProps) {
  if (props.series && props.series.length > 0) {
    return <NativeStaticMultiSeriesChart {...props} />;
  }
  if (props.mode === 'candle' && props.candles && props.candles.length > 0) {
    return <NativeStaticCandlestickChart {...props} />;
  }
  return <NativeStaticLineChart {...props} />;
}
