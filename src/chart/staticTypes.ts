import type { ViewStyle } from 'react-native';

import type {
  BadgeVariant,
  CandlePoint,
  ChartPadding,
  ChartChromeColors,
  HoverPoint,
  LiveLinePoint,
  LiveLineSeries,
  LiveLineTheme,
  LiveLineWindowStyle,
  ReferenceLine,
  WindowOption,
} from './types';

/**
 * Props for the static (non-live) chart components.
 *
 * Static charts receive all data upfront, play a left-to-right draw animation
 * on load, and support full scrub UI after the animation completes.
 *
 * This is a focused subset of `LiveLineChartProps` with draw-animation controls
 * added and live-only features (momentum, particles, orderbook, etc.) omitted.
 */
export interface StaticChartProps {
  /* ------------------------------------------------------------------ */
  /*  Data (all upfront, no streaming)                                   */
  /* ------------------------------------------------------------------ */
  data: LiveLinePoint[];
  /** Multi-series data — when provided, routes to NativeStaticMultiSeriesChart. */
  series?: LiveLineSeries[];
  /** Candlestick data — when `mode === 'candle'`, routes to NativeStaticCandlestickChart. */
  candles?: CandlePoint[];

  /* ------------------------------------------------------------------ */
  /*  Visual (same as live)                                              */
  /* ------------------------------------------------------------------ */
  theme?: LiveLineTheme;
  /** Overrides chart chrome colors (background, grid, axis labels, badges, tooltips, controls) without changing the series line palette. */
  chartColors?: ChartChromeColors;
  color?: string;
  /** Stroke width of the main line in pixels (default 2). */
  lineWidth?: number;
  grid?: boolean;
  fill?: boolean;
  badge?: boolean;
  badgeVariant?: BadgeVariant;
  referenceLine?: ReferenceLine;
  lineTrailGlow?: boolean;
  gradientLineColoring?: boolean;
  /** Tighter Y-axis padding (matches upstream `exaggerate`). */
  exaggerate?: boolean;
  height?: number;
  emptyText?: string;
  loading?: boolean;
  style?: ViewStyle;
  contentInset?: Partial<ChartPadding>;

  /* ------------------------------------------------------------------ */
  /*  Draw animation (NEW — static-only)                                 */
  /* ------------------------------------------------------------------ */
  /** Duration of the left-to-right draw animation in ms (default 1200). */
  drawDuration?: number;
  /** Easing curve for the draw animation (default 'ease-out'). */
  drawEasing?: 'ease-out' | 'linear' | 'ease-in-out';
  /** Callback fired when the draw animation completes and scrub becomes active. */
  onDrawComplete?: () => void;

  /* ------------------------------------------------------------------ */
  /*  Scrub (enabled only after draw animation completes)                */
  /* ------------------------------------------------------------------ */
  scrub?: boolean;
  scrubNumberFlow?: boolean;
  snapToPointScrubbing?: boolean;
  scrubHaptics?: boolean;
  pinchToZoom?: boolean;
  /** Vertical offset for the scrub tooltip from the top padding (default 14). */
  tooltipY?: number;
  /** Draw a subtle outline behind scrub tooltip text (default true). */
  tooltipOutline?: boolean;

  /* ------------------------------------------------------------------ */
  /*  Window selection                                                   */
  /* ------------------------------------------------------------------ */
  window?: number;
  windows?: WindowOption[];
  onWindowChange?: (secs: number) => void;
  windowStyle?: LiveLineWindowStyle;

  /* ------------------------------------------------------------------ */
  /*  Candle-specific                                                    */
  /* ------------------------------------------------------------------ */
  mode?: 'line' | 'candle';
  /** When `mode === 'candle'`, morph toward a close-value line. */
  lineMode?: boolean;
  /** Max candle body width in px (>= 12). */
  candleWidth?: number;
  /** Show Line / Candle pills above the chart. */
  showBuiltInModeToggle?: boolean;
  /** When `mode === 'candle'`, show Bars / Morph pills. */
  showBuiltInMorphToggle?: boolean;

  /* ------------------------------------------------------------------ */
  /*  Format                                                             */
  /* ------------------------------------------------------------------ */
  formatValue?: (value: number) => string;
  formatTime?: (time: number) => string;

  /* ------------------------------------------------------------------ */
  /*  Callbacks                                                          */
  /* ------------------------------------------------------------------ */
  onHover?: (point: HoverPoint | null) => void;
  onModeChange?: (mode: 'line' | 'candle') => void;
  onLineModeChange?: (lineMode: boolean) => void;
}
