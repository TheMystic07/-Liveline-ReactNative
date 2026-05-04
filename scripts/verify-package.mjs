import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const distEsmPath = path.join(root, 'dist', 'index.js');
const distCjsPath = path.join(root, 'dist', 'index.cjs');
const srcEntryPath = path.join(root, 'src', 'index.ts');

const requiredPaths = [
  pkg.main,
  pkg.module,
  pkg.types,
  pkg.source,
  pkg['react-native'],
  pkg.exports?.['.']?.types,
  pkg.exports?.['.']?.import,
  pkg.exports?.['.']?.require,
  pkg.exports?.['.']?.['react-native'],
].filter(Boolean);

for (const relPath of requiredPaths) {
  const absPath = path.join(root, relPath);
  if (!existsSync(absPath)) {
    throw new Error(`Package entry does not exist: ${relPath}`);
  }
}

if (!existsSync(srcEntryPath)) {
  throw new Error('Missing React Native source entry: src/index.ts');
}

const distEsm = readFileSync(distEsmPath, 'utf8');
const distCjs = readFileSync(distCjsPath, 'utf8');

// Verify worklets were compiled (should NOT contain raw 'worklet' strings)
const rawWorkletCount = (distEsm.match(/'worklet'/g) || []).length;
if (rawWorkletCount > 0) {
  throw new Error(`ESM bundle contains ${rawWorkletCount} raw 'worklet' strings. The worklets plugin did not run.`);
}

const cjsRawWorkletCount = (distCjs.match(/'worklet'/g) || []).length;
if (cjsRawWorkletCount > 0) {
  throw new Error(`CJS bundle contains ${cjsRawWorkletCount} raw 'worklet' strings. The worklets plugin did not run.`);
}

// Verify worklet hash markers exist (proof the plugin actually compiled them)
if (!distEsm.includes('__workletHash')) {
  throw new Error('ESM bundle missing compiled worklet markers (__workletHash).');
}

console.log(`Package verification passed. (${rawWorkletCount} raw worklets, __workletHash present)`);
