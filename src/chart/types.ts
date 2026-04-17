import type { ViewStyle } from 'react-native';

export interface LiveLinePoint {
  time: number;
  value: number;
}

export type LiveLineTheme = 'dark' | 'light';

/** Segmented control look for the time-window row (matches upstream Liveline). */
export type LiveLineWindowStyle = 'default' | 'rounded' | 'text';

export interface WindowOption {
  label: string;
  secs: number;
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

export interface LiveLineChartProps {
  data: LiveLinePoint[];
  value: number;
  theme?: LiveLineTheme;
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
  pulse?: boolean;
  scrub?: boolean;
  momentum?: boolean;
  degen?: boolean;
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
  /**
   * Base smoothing speed for live value + Y-axis (fraction per ~16.67ms frame at 60fps).
   * Matches upstream Liveline default `0.08`.
   */
  lerpSpeed?: number;
  style?: ViewStyle;
  contentInset?: Partial<ChartPadding>;
}

export interface ScreenPoint {
  x: number;
  y: number;
  time: number;
  value: number;
}
