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

if (/\bReact\.createElement\b/.test(distEsm) || /\bReact\.Fragment\b/.test(distEsm)) {
  throw new Error('ESM bundle still references bare React.* symbols.');
}

if (/\bReact\.createElement\b/.test(distCjs) || /\bReact\.Fragment\b/.test(distCjs)) {
  throw new Error('CJS bundle still references bare React.* symbols.');
}

console.log('Package verification passed.');
