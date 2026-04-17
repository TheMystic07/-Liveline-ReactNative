# Liveline Native

React Native re-implementation of the interaction model from [Liveline](https://github.com/benjitaylor/liveline), built with Expo, Skia, Gesture Handler, and Reanimated.

## What is implemented

- Real-time streaming line chart
- Smooth tip interpolation between ticks
- Gradient fill under the line
- Live pulse dot
- Scrub crosshair with interpolated hover values
- Floating live value badge
- Window selector and demo controls
- Dark/light theme switching

## Stack

- `expo`
- `@shopify/react-native-skia`
- `react-native-gesture-handler`
- `react-native-reanimated`

## Run

```bash
npm install
npm start
```

## Current parity gaps vs upstream Liveline

- Candlestick mode is not implemented yet.
- Multi-series mode is not implemented yet.
- The chart model still runs on the React side; for production parity, move the data windowing and path construction into shared values/worklets.
- Skia web preview needs its own web-specific setup; the target for this scaffold is native iOS/Android.
