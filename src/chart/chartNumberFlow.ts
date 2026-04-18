import { Easing } from 'react-native-reanimated';

/**
 * Format price for SkiaNumberFlow `sharedValue` — cent quantization avoids
 * float noise (`1.23` vs `1.229999`) fighting digit animations.
 */
export function formatPriceCentsWorklet(v: number): string {
  'worklet';
  const q = Math.round(v * 100);
  return (q / 100).toFixed(2);
}

export function supportsTwoDecimalNumberFlow(formatValue: (value: number) => string): boolean {
  const probes = [-12.34, 0, 1.23, 98765.43];
  return probes.every((value) => formatValue(value) === value.toFixed(2));
}

/** Calmer layout + digit timings than library defaults (less wobble on rapid updates). */
export const chartFlowTransformTiming = {
  duration: 280,
  easing: Easing.out(Easing.cubic),
} as const;

export const chartFlowSpinTiming = {
  duration: 340,
  easing: Easing.out(Easing.quad),
} as const;

/** Shared SkiaNumberFlow behavior for badge + scrub tooltips. */
export const chartSkiaNumberFlowStable = {
  trend: 0 as const,
  continuous: false,
  tabularNums: true,
  mask: true,
  scrubDigitWidthPercentile: 0.96,
  transformTiming: chartFlowTransformTiming,
  spinTiming: chartFlowSpinTiming,
} as const;
