import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  external: [
    'react',
    'react-native',
    'react-native-gesture-handler',
    'react-native-reanimated',
    '@shopify/react-native-skia',
    'number-flow-react-native',
    'number-flow-react-native/skia',
    'expo-haptics',
  ],
});
