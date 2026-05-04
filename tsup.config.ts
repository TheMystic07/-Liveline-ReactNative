import { defineConfig } from 'tsup';
import babel from 'esbuild-plugin-babel';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = 'react';
  },
  esbuildPlugins: [
    babel({
      config: {
        presets: [
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
        plugins: ['react-native-worklets/plugin'],
      },
      filter: /\.(ts|tsx)$/,
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
