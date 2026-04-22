# Liveline Native

React Native Liveline-style charts built with Expo, Skia, Gesture Handler, and Reanimated.

This repo exposes a native `LiveLineChart` component with:

- live line mode
- candlestick mode
- multi-series mode
- scrubbing and crosshair hover
- badge and scrub number-flow rendering
- window switching
- optional orderbook stream overlay

## Status

- iOS / Android: supported
- Web: fallback placeholder only

The chart is wired for the native Skia/Reanimated pipeline. On web, `LiveLineChart` renders a fallback card instead of the live chart.

## Run The Demo

```bash
npm install
npm start
```

## Install As A Package

Once published:

```bash
npm install @gurshabad90/liveline-native
```

Required peer dependencies in the consuming app:

```bash
npm install react react-native react-native-gesture-handler react-native-reanimated @shopify/react-native-skia number-flow-react-native expo-haptics
```

This package is intended for native React Native / Expo apps. Web still falls back to a placeholder view.

## Import

Inside this repo, import from `src/chart`:

```tsx
import { LiveLineChart, type LiveLinePoint } from './src/chart';
```

From the published package:

```tsx
import { LiveLineChart, type LiveLinePoint } from '@gurshabad90/liveline-native';
```

## Minimal Example

```tsx
import { LiveLineChart, type LiveLinePoint } from './src/chart';

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

## Data Model

`LiveLineChart` expects unix time in seconds, not milliseconds.

Line points:

```ts
type LiveLinePoint = {
  time: number;
  value: number;
};
```

Candle points:

```ts
type CandlePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
```

Multi-series entries:

```ts
type LiveLineSeries = {
  id: string;
  data: LiveLinePoint[];
  value: number;
  color: string;
  label?: string;
};
```

Orderbook snapshot:

```ts
type LiveOrderbookSnapshot = {
  bids: readonly [price: number, size: number][];
  asks: readonly [price: number, size: number][];
};
```

## Common Usage

### Line Chart

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

### Candlestick Mode

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

Notes:

- `mode="candle"` switches the native chart renderer into candle mode.
- `candles` should contain the visible historical buckets.
- `liveCandle` is the current in-progress bucket.
- `lineMode` enables the candle-to-line morph overlay.

### Multi-Series Mode

```tsx
<LiveLineChart
  data={primary.data}
  value={primary.value}
  series={[
    primary,
    hedge,
    benchmark,
  ]}
  theme="dark"
  grid
  badge
  scrub
/>
```

Notes:

- Passing `series` switches to the multi-series renderer.
- `data` and `value` should still describe the primary series.

### Orderbook Stream Overlay

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

This renders floating size labels behind the chart line. It is only meaningful on native.

## Props You'll Use Most

Core:

- `data`: line points
- `value`: latest live value
- `theme`: `'dark' | 'light'`
- `color`: accent color
- `height`: chart height
- `window`: active visible time range in seconds
- `windows`: selector options
- `onWindowChange`: callback for built-in window controls

Interactivity:

- `scrub`: enable panning / hover tooltip
- `snapToPointScrubbing`: snap hover to nearest real point
- `pinchToZoom`: temporary pinch zoom
- `scrubHaptics`: native haptics while scrubbing
- `onHover`: receive the current hover point

Visual options:

- `grid`
- `fill`
- `badge`
- `badgeVariant`
- `pulse`
- `momentum`
- `referenceLine`
- `liveDotGlow`
- `lineTrailGlow`
- `gradientLineColoring`
- `tooltipOutline`

Mode selection:

- `mode`: `'line' | 'candle'`
- `series`: enables multi-series mode
- `candles`
- `liveCandle`
- `lineMode`
- `lineData`
- `lineValue`

## Number Flow Notes

`badgeNumberFlow` and `scrubNumberFlow` use `number-flow-react-native` for rolling digits.

They work best when your formatter matches the default two-decimal output:

```ts
(value) => value.toFixed(2)
```

If you use a custom `formatValue` that does not behave like `toFixed(2)`, the chart falls back to plain text for those slots.

## Native Setup Notes

This repo already has the required dependencies installed:

- `expo`
- `@shopify/react-native-skia`
- `react-native-gesture-handler`
- `react-native-reanimated`
- `number-flow-react-native`

If you move the chart into another app, keep the usual native setup for:

- `react-native-gesture-handler`
- `react-native-reanimated`
- `@shopify/react-native-skia`

## Build And Publish

Build the package:

```bash
npm run build
```

The package build outputs:

- `dist/index.js`
- `dist/index.cjs`
- `dist/index.d.ts`

Publish to npm:

```bash
npm login
npm publish --access public
```

Before the first publish, verify:

- the package name in [package.json](/D:/Code/YEET/LivelineRewriteCODEX/liveline-native/package.json:1) is available on npm
- the npm account has access to the `@gurshabad90` scope, or change the package name to one you control

## Demo Reference

The demo app uses the chart here:

- [App.tsx](/D:/Code/YEET/LivelineRewriteCODEX/liveline-native/App.tsx:1)

Public exports live here:

- [src/chart/index.ts](/D:/Code/YEET/LivelineRewriteCODEX/liveline-native/src/chart/index.ts:1)
- [src/chart/types.ts](/D:/Code/YEET/LivelineRewriteCODEX/liveline-native/src/chart/types.ts:1)
