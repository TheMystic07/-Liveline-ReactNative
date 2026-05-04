import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// Store original if not already stored
if (!pkg._originalMain) {
  pkg._originalMain = pkg.main;
  pkg._originalModule = pkg.module;
  pkg._originalReactNative = pkg['react-native'];
  pkg._originalTypes = pkg.types;
}

// Rewrite to dist entries for publishing
pkg.main = './dist/index.cjs';
pkg.module = './dist/index.js';
pkg['react-native'] = './src/index.ts';
pkg.types = './dist/index.d.ts';

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Rewrote package.json for publish (dist entries).');
