import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

if (pkg._originalMain) {
  pkg.main = pkg._originalMain;
  pkg.module = pkg._originalModule;
  pkg['react-native'] = pkg._originalReactNative;
  pkg.types = pkg._originalTypes;
  delete pkg._originalMain;
  delete pkg._originalModule;
  delete pkg._originalReactNative;
  delete pkg._originalTypes;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Restored package.json for local development.');
} else {
  console.log('No original entries to restore.');
}
