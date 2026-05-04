import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distEsmPath = path.join(root, 'dist', 'index.js');
const distCjsPath = path.join(root, 'dist', 'index.cjs');

// Verify dist files exist
if (!existsSync(distEsmPath)) {
  throw new Error('Missing dist/index.js');
}
if (!existsSync(distCjsPath)) {
  throw new Error('Missing dist/index.cjs');
}

const distEsm = readFileSync(distEsmPath, 'utf8');
const distCjs = readFileSync(distCjsPath, 'utf8');

// Verify worklets were compiled (should NOT contain raw 'worklet' strings)
const esmRawWorkletCount = (distEsm.match(/'worklet'/g) || []).length;
if (esmRawWorkletCount > 0) {
  throw new Error(`ESM bundle contains ${esmRawWorkletCount} raw 'worklet' strings.`);
}

const cjsRawWorkletCount = (distCjs.match(/'worklet'/g) || []).length;
if (cjsRawWorkletCount > 0) {
  throw new Error(`CJS bundle contains ${cjsRawWorkletCount} raw 'worklet' strings.`);
}

// Verify worklet hash markers exist
if (!distEsm.includes('__workletHash')) {
  throw new Error('ESM bundle missing compiled worklet markers.');
}
if (!distCjs.includes('__workletHash')) {
  throw new Error('CJS bundle missing compiled worklet markers.');
}

console.log(`Package verification passed. (0 raw worklets, __workletHash present in both ESM and CJS)`);
