import { Platform } from 'react-native';

import { NativeLiveLineChart } from './NativeLiveLineChart';
import { NativeMultiSeriesChart } from './NativeMultiSeriesChart';
import type { LiveLineChartProps } from './types';
import { WebFallbackChart } from './WebFallbackChart';

export function LiveLineChart(props: LiveLineChartProps) {
  if (Platform.OS !== 'web') {
    if (props.series && props.series.length > 0) {
      return <NativeMultiSeriesChart {...props} />;
    }
    // NativeLiveLineChart handles both line and candle modes via its animation engine
    return <NativeLiveLineChart {...props} />;
  }

  return <WebFallbackChart {...props} />;
}
