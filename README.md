# Liveline Native

React Native Liveline-style charts built with Expo, Skia, Gesture Handler, and Reanimated.

**Package:** [`@gurshabad90/liveline-native`](https://www.npmjs.com/package/@gurshabad90/liveline-native) (see `package.json` for the current `version`).

This repo exposes:

- **`LiveLineChart`** — real-time line, candle, or multi-series rendering with the live Skia engine
- **`StaticChart`** — the same look for **non-streaming** data: a left-to-right **draw-on-load** animation, then full **scrub** (crosshair, tooltip, haptics) on native; no momentum, particles, or orderbook

Also included:

- scrubbing, crosshair, and hover callbacks
- badge and optional Skia number-flow for badge / scrub
- time window controls (`window` / `windows` / `onWindowChange`)
- optional orderbook stream overlay (live line mode, native)
- **`chartColors`** (live + static) to override **chrome** (background, grid, axes, tooltips, controls) while keeping the series accent from `color`

## Status

- **iOS / Android:** supported (Skia + Reanimated)
- **Web:** `LiveLineChart` and `StaticChart` render a **small fallback** card (`WebFallbackChart`) because the full native pipeline is not wired for web in this build

## Run the demo

```bash
npm install
npm start
```

## Install as a package

```bash
npm install @gurshabad90/liveline-native
```

Required peer dependencies in the consuming app (align versions with your Expo / RN stack):

```bash
npm install react react-native react-native-gesture-handler react-native-reanimated react-native-worklets @shopify/react-native-skia number-flow-react-native expo-haptics
```

The published package ships:

- `src/**` for the React Native entry, so Metro compiles the original hooks / worklets code in the consumer app
- `dist/**` for ESM, CJS, and `.d.ts`

## Import

**In this repo** (app / demo), you can import from the chart entry:

```tsx
import { LiveLineChart, StaticChart, type LiveLinePoint } from './src/chart';
```

**From npm:**

```tsx
import { LiveLineChart, StaticChart, type LiveLinePoint, type StaticChartProps } from '@gurshabad90/liveline-native';
```

### Public exports (high level)

- **Components:** `LiveLineChart`, `StaticChart`, `LivelineTransition`, `BadgeSkiaNumberFlow`, `ScrubSkiaNumberFlow`
- **Types:** `LiveLineChartProps`, `StaticChartProps`, `LiveLinePoint`, `CandlePoint`, `LiveLineSeries`, `ChartPalette`, `ChartChromeColors`, `HoverPoint`, `ReferenceLine`, `WindowOption`, `LiveLineTheme`, `LiveLineWindowStyle`, and related types from the package

## Minimal example — live line

```tsx
import { LiveLineChart, type LiveLinePoint } from '@gurshabad90/liveline-native';

const data: LiveLinePoint[] = [
  { time: 1713430800, value: 101.2 },
  { time: 1713430810, value: 101.8 },
  { time: 1713430820, value: 101.6 },
];

export function Example() {
  const latest = data[data.length - 1]?.value ?? 0;

  return (
    <LiveLineChart
      data={data}
      value={latest}
      color="#3b82f6"
      theme="dark"
      height={320}
      window={30}
      grid
      fill
      badge
      scrub
      momentum
    />
  );
}
```

## Static chart (`StaticChart`)

Use **`StaticChart`** when you have a **complete** series in memory and want Liveline-style visuals **without** the live engine (no per-tick smoothing, no degen / particles / orderbook). Typical uses: **screenshots**, **history** panels, or **export** views.

Behavior on **native**:

1. The line (or candle / multi series) **draws left to right** once (`drawDuration`, `drawEasing`).
2. When the draw finishes, **`onDrawComplete`** runs and **scrub** becomes active (pan, crosshair, tooltip, optional haptics) — same interaction model as the live chart, without streaming updates.

**Web** uses the same placeholder as `LiveLineChart`.

```tsx
import { StaticChart, type LiveLinePoint } from '@gurshabad90/liveline-native';

const data: LiveLinePoint[] = [/* ... */];
const value = data[data.length - 1]!.value;

export function HistoryPanel() {
  return (
    <StaticChart
      data={data}
      value={value}
      color="#3b82f6"
      theme="dark"
      height={320}
      window={30}
      grid
      fill
      badge
      drawDuration={1200}
      drawEasing="ease-out"
      onDrawComplete={() => console.log('ready to scrub')}
      scrub
      snapToPointScrubbing
    />
  );
}
```

Mode routing matches the live API:

- **Line (default):** `data` + `value` only
- **Multi-series:** pass **`series`**
- **Candles:** set **`mode="candle"`** and provide **`candles`** (and optional `lineMode`, toggles, etc. — see `StaticChartProps` in `src/chart/staticTypes.ts`)

`StaticChartProps` is a **subset** of the live prop surface, plus **draw** controls (`drawDuration`, `drawEasing`, `onDrawComplete`) and without live-only flags such as `degen` / `orderbook` / `paused` streaming.

## Data model

`LiveLineChart` / `StaticChart` use **Unix time in seconds** (not milliseconds) on the time axis.

**Line points:**

```ts
type LiveLinePoint = {
  time: number;
  value: number;
};
```

**Candle points:**

```ts
type CandlePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
```

**Multi-series:**

```ts
type LiveLineSeries = {
  id: string;
  data: LiveLinePoint[];
  value: number;
  color: string;
  label?: string;
};
```

**Orderbook snapshot (live line overlay):**

```ts
type LiveOrderbookSnapshot = {
  bids: readonly [price: number, size: number][];
  asks: readonly [price: number, size: number][];
};
```

## Common usage

### Line chart (live)

```tsx
<LiveLineChart
  data={data}
  value={latest}
  color="#3b82f6"
  theme="dark"
  window={30}
  windows={[
    { label: '15s', secs: 15 },
    { label: '30s', secs: 30 },
    { label: '60s', secs: 60 },
  ]}
  onWindowChange={setWindow}
  windowStyle="rounded"
  grid
  fill
  badge
  pulse
  scrub
  momentum
/>
```

### Candlestick mode (live)

```tsx
<LiveLineChart
  data={ticks}
  value={latest}
  mode="candle"
  candles={candles}
  liveCandle={liveCandle}
  lineMode={false}
  showBuiltInModeToggle
  showBuiltInMorphToggle
  onModeChange={setMode}
  onLineModeChange={setLineMode}
  badge
  scrub
/>
```

- `mode="candle"` switches the native renderer to candles.
- `candles` — visible history buckets; `liveCandle` — current in-progress bucket.
- `lineMode` toggles the candle-to-line morph overlay.

### Multi-series (live)

```tsx
<LiveLineChart
  data={primary.data}
  value={primary.value}
  series={[primary, hedge, benchmark]}
  theme="dark"
  grid
  badge
  scrub
/>
```

Passing **`series`** selects the multi-series native renderer. `data` / `value` should still describe the **primary** series.

### Orderbook stream overlay (live line)

```tsx
<LiveLineChart
  data={data}
  value={latest}
  orderbook={{
    bids: [
      [101.12, 14],
      [101.1, 21],
    ],
    asks: [
      [101.18, 11],
      [101.2, 19],
    ],
  }}
/>
```

Floating size labels draw behind the line (native, meaningful in line mode with a feed).

## Chart chrome: `chartColors` (`ChartChromeColors`)

Both **`LiveLineChart`** and **`StaticChart`** accept optional **`chartColors`**: partial overrides for **UI chrome** (background, grid, axis labels, badges, tooltips, fade, ref/dash tints, etc.) and optional **control bar** token strings (`controlBarBg`, `controlActiveText`, …). The **series stroke** still comes from **`color`** (and per-series `color` in multi mode).

```tsx
<LiveLineChart
  data={points}
  value={latest}
  color="#22c55e"
  theme="dark"
  chartColors={{
    surface: 'transparent',
    plotSurface: '#050505',
    gridLine: 'rgba(255,255,255,0.045)',
    gridLabel: 'rgba(255,255,255,0.42)',
    timeLabel: 'rgba(255,255,255,0.32)',
    crosshair: 'rgba(255,255,255,0.22)',
    tooltipBg: 'rgba(8,8,8,0.96)',
    controlBarBg: 'rgba(255,255,255,0.03)',
  }}
/>
```

See **`ChartChromeColors`** in `src/chart/types.ts` for the full key set.

## Props you will use most (live `LiveLineChart`)

**Core**

- `data`, `value`, `theme`, `color`, `chartColors`, `height`
- `window`, `windows`, `onWindowChange`, `windowStyle`

**Interactivity**

- `scrub`, `snapToPointScrubbing`, `pinchToZoom`, `scrubHaptics`, `scrubNumberFlow`, `onHover`, `paused`

**Visual**

- `grid`, `fill`, `badge`, `badgeVariant`, `badgeNumberFlow`, `pulse`, `momentum`, `referenceLine`
- `liveDotGlow`, `lineTrailGlow`, `gradientLineColoring`, `tooltipY`, `tooltipOutline`, `exaggerate`, `lineWidth`

**Mode**

- `mode`, `series`, `candles`, `liveCandle`, `lineMode`, `lineData`, `lineValue`, `showBuiltInModeToggle`, `showBuiltInMorphToggle`, `candleWidth`, `onModeChange`, `onLineModeChange`

**Extras**

- `orderbook`, `degen`, `loading`, `formatValue`, `formatTime`, `contentInset`, `style`

## Number Flow

`badgeNumberFlow` and `scrubNumberFlow` use `number-flow-react-native` for rolling digits. They work best with the default two-decimal formatter:

```ts
(value: number) => value.toFixed(2);
```

Custom `formatValue` that does not follow that pattern falls back to plain text in those slots.

## Native setup in another app

Standard React Native / Expo setup is still required:

- import `react-native-gesture-handler` first in the app entry
- wrap the app root with `GestureHandlerRootView`
- keep the usual `react-native-reanimated`, `react-native-worklets`, and Skia Babel / Metro setup from your app stack

No `patch-package` changes should be needed in the consuming app for `@gurshabad90/liveline-native`.

## Build and publish

Build:

```bash
npm run build
```

Outputs (published in the npm package):

- `src/index.ts` (React Native entry)
- `dist/index.js` (ESM)
- `dist/index.cjs` (CJS)
- `dist/index.d.ts` (types)

Release (maintainers):

```bash
npm login
npm version patch   # or minor / major; creates a git tag
npm publish --access public
```

`prepack` runs `npm run build && npm run verify:package` automatically, and `npm run check` bundles the package validation steps for CI.

**Before the first publish:** confirm the package name in `package.json` and scope (`@gurshabad90`) on npm, and that you are logged in with access to that scope.

## Repository layout (reference)

- Demo app: `App.tsx`
- Chart exports: `src/chart/index.ts`
- Live + shared types: `src/chart/types.ts`
- Static API: `src/chart/staticTypes.ts`, `src/chart/StaticChart.tsx`
