import { defineConfig } from 'tsup';
import babel from 'esbuild-plugin-babel';

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
  esbuildPlugins: [
    babel({
      filter: /\.(ts|tsx)$/,
      config: {
        plugins: ['react-native-worklets/plugin'],
      },
    }),
  ],
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
