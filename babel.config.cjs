module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['@babel/preset-typescript', { jsx: 'react-jsx' }],
      '@babel/preset-react',
    ],
    plugins: [
      'react-native-worklets/plugin',
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
      ],
    ],
  };
};
