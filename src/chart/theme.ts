import type { ChartPalette, LiveLineTheme } from './types';

/** Parse any CSS color string to [r, g, b]. Handles hex (#rgb, #rrggbb). */
export function parseColorRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return [128, 128, 128];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Parse alpha from hex / rgb / rgba strings for blending. */
function parseRgbaComponents(color: string): [number, number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  const rgbaM = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)/);
  if (rgbaM) return [+rgbaM[1], +rgbaM[2], +rgbaM[3], +rgbaM[4]];
  const rgbM = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbM) return [+rgbM[1], +rgbM[2], +rgbM[3], 1];
  return [128, 128, 128, 1];
}

/** Lerp between two CSS colors including alpha (matches upstream Liveline draw/line). */
export function blendColorCss(c1: string, c2: string, t: number): string {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const [r1, g1, b1, a1] = parseRgbaComponents(c1);
  const [r2, g2, b2, a2] = parseRgbaComponents(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  const a = a1 + (a2 - a1) * t;
  if (a >= 0.995) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/**
 * Derive a full palette from a single accent color + theme mode.
 * Matches upstream Liveline resolveTheme exactly.
 */
export function resolvePalette(
  accent: string,
  theme: LiveLineTheme,
  lineWidth?: number,
): ChartPalette {
  const [r, g, b] = parseColorRgb(accent);
  const isDark = theme === 'dark';

  return {
    // Core
    accent,
    background: isDark ? '#0a0a0a' : '#ffffff',
    surface: isDark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.022)',
    plotSurface: isDark ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.014)',
    border: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',

    // Line
    lineWidth: lineWidth ?? 2,

    // Fill gradient
    accentFillTop: rgba(r, g, b, isDark ? 0.12 : 0.08),
    accentFillBottom: rgba(r, g, b, 0),

    // Grid
    gridLine: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    gridLabel: isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.35)',

    // Axis
    axisLine: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
    timeLabel: isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.3)',

    // Dot — always semantic
    dotUp: '#22c55e',
    dotDown: '#ef4444',
    dotFlat: accent,
    glowUp: 'rgba(34, 197, 94, 0.18)',
    glowDown: 'rgba(239, 68, 68, 0.18)',
    glowFlat: rgba(r, g, b, 0.12),

    // Badge
    badgeOuterBg: isDark
      ? 'rgba(40, 40, 40, 0.95)'
      : 'rgba(255, 255, 255, 0.95)',
    badgeOuterShadow: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.15)',
    badgeBg: accent,
    badgeText: '#ffffff',

    // Dash line
    dashLine: rgba(r, g, b, 0.4),
    refLine: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
    refLabel: isDark ? 'rgba(255, 255, 255, 0.42)' : 'rgba(0, 0, 0, 0.38)',

    // Crosshair
    crosshair: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.12)',
    tooltipBg: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    tooltipText: isDark ? '#e5e5e5' : '#1a1a1a',
    tooltipMuted: isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.3)',

    // Background RGB for edge fading
    bgRgb: isDark
      ? ([10, 10, 10] as [number, number, number])
      : ([255, 255, 255] as [number, number, number]),

    // Live dot
    liveDot: accent,
    accentGlow: rgba(r, g, b, isDark ? 0.18 : 0.14),
    pulse: rgba(r, g, b, isDark ? 0.16 : 0.14),

    // Left edge fade — matches background
    fadeLeftStart: isDark ? 'rgba(18, 18, 18, 0.98)' : 'rgba(248, 248, 248, 0.98)',
    fadeLeftEnd: isDark ? 'rgba(18, 18, 18, 0)' : 'rgba(248, 248, 248, 0)',
  };
}
