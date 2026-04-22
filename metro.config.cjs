// @ts-check
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Ensure .cjs files are treated as source (not just assets)
config.resolver = {
  ...config.resolver,
  sourceExts: [...(config.resolver.sourceExts ?? ['ts', 'tsx', 'js', 'jsx', 'json']), 'cjs'],
  assetExts: (config.resolver.assetExts ?? []).filter((ext) => ext !== 'cjs'),
};

// Improve startup time by deferring module evaluation until first use
config.transformer = {
  ...config.transformer,
  inlineRequires: true,
};

module.exports = config;
