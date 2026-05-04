import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const distPath = path.join(root, 'dist', 'index.js');
const srcEntryPath = path.join(root, 'src', 'index.ts');

const requiredPaths = [
  pkg.main,
  pkg.module,
  pkg.types,
  pkg['react-native'],
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

const distJs = readFileSync(distPath, 'utf8');

// Verify worklets were compiled (should NOT contain raw 'worklet' strings)
const rawWorkletCount = (distJs.match(/'worklet'/g) || []).length;
if (rawWorkletCount > 0) {
  throw new Error(`Bundle contains ${rawWorkletCount} raw 'worklet' strings. The worklets plugin did not run.`);
}

// Verify worklet hash markers exist (proof the plugin actually compiled them)
if (!distJs.includes('__workletHash')) {
  throw new Error('Bundle missing compiled worklet markers (__workletHash).');
}

console.log(`Package verification passed. (${rawWorkletCount} raw worklets, __workletHash present)`);
