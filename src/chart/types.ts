import type { ViewStyle } from 'react-native';

export interface LiveLinePoint {
  time: number;
  value: number;
}

export type LiveLineTheme = 'dark' | 'light';

/** Segmented control look for the time-window row (matches upstream Liveline). */
export type LiveLineWindowStyle = 'default' | 'rounded' | 'text';
export type BadgeVariant = 'default' | 'minimal';

export interface WindowOption {
  label: string;
  secs: number;
}

export interface ReferenceLine {
  value: number;
  label?: string;
}

export interface DegenOptions {
  /** Multiplier for particle count and size (default 1). */
  scale?: number;
  /** Allow degen bursts on down-momentum swings (default false). */
  downMomentum?: boolean;
}

export interface HoverPoint {
  time: number;
  value: number;
  x: number;
  y: number;
}

export interface LiveLineSeries {
  id: string;
  data: LiveLinePoint[];
  value: number;
  color: string;
  label?: string;
}

export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** One orderbook level: `[price, size]`. */
export type OrderbookPriceSize = readonly [price: number, size: number];

/** Snapshot of bids and asks for the Kalshi-style stream (sizes float upward behind the line). */
export interface LiveOrderbookSnapshot {
  bids: readonly OrderbookPriceSize[];
  asks: readonly OrderbookPriceSize[];
}

/** Single drifting label for internal stream rendering (`size` drives SkiaNumberFlow value mode). */
export interface OrderbookStreamLabel {
  id: number;
  x: number;
  y: number;
  /** Raw level size for SkiaNumberFlow `value` (avoids shared/scrubbing path inside Canvas). */
  size: number;
  rgb: readonly [number, number, number];
  baseAlpha: number;
  /** Row opacity 0–1 (fade in / drift out). */
  opacity: number;
  lastTs: number;
}

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartPalette {
  // Core
  accent: string;
  background: string;
  surface: string;
  plotSurface: string;
  border: string;

  // Line
  lineWidth: number;

  // Fill gradient
  accentFillTop: string;
  accentFillBottom: string;

  // Grid
  gridLine: string;
  gridLabel: string;

  // Axis
  axisLine: string;
  timeLabel: string;

  // Dot
  dotUp: string;
  dotDown: string;
  dotFlat: string;
  glowUp: string;
  glowDown: string;
  glowFlat: string;

  // Badge
  badgeOuterBg: string;
  badgeOuterShadow: string;
  badgeBg: string;
  badgeText: string;

  // Dash line
  dashLine: string;
  refLine: string;
  refLabel: string;

  // Crosshair
  crosshair: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipMuted: string;

  // Background
  bgRgb: [number, number, number];

  // Live dot
  liveDot: string;
  accentGlow: string;
  pulse: string;

  // Left edge fade
  fadeLeftStart: string;
  fadeLeftEnd: string;
}

export type ChartChromeColors = Partial<
  Pick<
    ChartPalette,
    | 'background'
    | 'surface'
    | 'plotSurface'
    | 'border'
    | 'gridLine'
    | 'gridLabel'
    | 'axisLine'
    | 'timeLabel'
    | 'badgeOuterBg'
    | 'badgeOuterShadow'
    | 'badgeBg'
    | 'badgeText'
    | 'dashLine'
    | 'refLine'
    | 'refLabel'
    | 'crosshair'
    | 'tooltipBg'
    | 'tooltipText'
    | 'tooltipMuted'
    | 'bgRgb'
    | 'fadeLeftStart'
    | 'fadeLeftEnd'
  >
> & {
  controlBarBg?: string;
  controlIndicatorBg?: string;
  controlActiveText?: string;
  controlInactiveText?: string;
  controlDisabledText?: string;
};

export interface LiveLineChartProps {
  data: LiveLinePoint[];
  value: number;
  series?: LiveLineSeries[];
  theme?: LiveLineTheme;
  /** Overrides chart chrome colors (background, grid, axis labels, badges, tooltips, controls) without changing the series line palette. */
  chartColors?: ChartChromeColors;
  color?: string;
  /** Stroke width of the main line in pixels (default 2, matches upstream Liveline). */
  lineWidth?: number;
  window?: number;
  windows?: WindowOption[];
  onWindowChange?: (secs: number) => void;
  /** Visual style for the window selector (default: `'default'`). */
  windowStyle?: LiveLineWindowStyle;
  grid?: boolean;
  fill?: boolean;
  badge?: boolean;
  badgeVariant?: BadgeVariant;
  /** Freeze the chart at the current visible snapshot without dropping the live feed. */
  paused?: boolean;
  /**
   * Use SkiaNumberFlow for the live badge value (digit transitions, UI-thread updates).
   * When `formatValue` is not the default `toFixed(2)`, falls back to plain text.
   * @see https://number-flow-react-native.awingender.com/docs/components/skia-number-flow
   */
  badgeNumberFlow?: boolean;
  pulse?: boolean;
  scrub?: boolean;
  /**
   * Use SkiaNumberFlow for the scrub tooltip price while panning (digit roll, UI-thread updates).
   * Requires default `formatValue` (same rule as `badgeNumberFlow`).
   */
  scrubNumberFlow?: boolean;
  /** Snap the scrub crosshair to the nearest actual data point instead of interpolating between points. */
  snapToPointScrubbing?: boolean;
  /** Allow pinch gestures to temporarily zoom the active time window without changing the selected button. */
  pinchToZoom?: boolean;
  /** Light haptics when scrubbing starts and when the displayed price crosses another cent (default true). */
  scrubHaptics?: boolean;
  momentum?: boolean;
  degen?: boolean | DegenOptions;
  referenceLine?: ReferenceLine;
  liveDotGlow?: boolean;
  lineTrailGlow?: boolean;
  gradientLineColoring?: boolean;
  /** Tighter Y-axis padding (matches upstream `exaggerate`). */
  exaggerate?: boolean;
  /** Vertical offset for the scrub tooltip from the top padding (default 14). */
  tooltipY?: number;
  /** Draw a subtle outline behind scrub tooltip text (default true). */
  tooltipOutline?: boolean;
  height?: number;
  loading?: boolean;
  emptyText?: string;
  formatValue?: (value: number) => string;
  formatTime?: (time: number) => string;
  onHover?: (point: HoverPoint | null) => void;
  mode?: 'line' | 'candle';
  candles?: CandlePoint[];
  /**
   * Optional max candle **body** width in px (≥ 12). Width is otherwise derived from time spacing
   * like upstream Liveline (`candleDims`). Small values are ignored so demos do not squash candles.
   */
  candleWidth?: number;
  liveCandle?: CandlePoint;
  /** When `mode === 'candle'`, morph toward a tick-density line (upstream `lineMode`). */
  lineMode?: boolean;
  /** Optional tick stream for the morph line (defaults to `data`). */
  lineData?: LiveLinePoint[];
  /** Live tick value for morph line tip (defaults to `value`). */
  lineValue?: number;
  onModeChange?: (mode: 'line' | 'candle') => void;
  onLineModeChange?: (lineMode: boolean) => void;
  /** Renders Line / Candle pills above the chart (calls `onModeChange`). */
  showBuiltInModeToggle?: boolean;
  /** When `mode === 'candle'`, renders Bars / Morph pills (calls `onLineModeChange`). */
  showBuiltInMorphToggle?: boolean;
  /**
   * Optional orderbook: bid/ask levels as `[price, size]` tuples. When set, a Liveline-style
   * stream of `+size` labels drifts upward behind the series (green bids, red asks); speed reacts
   * to chart momentum and to how fast total bid/ask depth is changing.
   */
  orderbook?: LiveOrderbookSnapshot;
  onSeriesToggle?: (id: string, visible: boolean) => void;
  seriesToggleCompact?: boolean;
  /**
   * Base smoothing speed for live value + Y-axis (fraction per ~16.67ms frame at 60fps).
   * Matches upstream Liveline default `0.08`.
   */
  lerpSpeed?: number;
  /**
   * Artificial stream delay in seconds. When set to `1` or `3`, the chart renders
   * data from that many seconds ago and linearly interpolates between historical
   * points so the line stays flowy even with sparse ticks.
   */
  streamDelay?: 0 | 1 | 3;
  style?: ViewStyle;
  contentInset?: Partial<ChartPadding>;
}

export interface ScreenPoint {
  x: number;
  y: number;
  time: number;
  value: number;
}
