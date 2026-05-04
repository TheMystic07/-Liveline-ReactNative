import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, 'dist');
const cjsPath = path.join(distDir, 'index.js');
const esmPath = path.join(distDir, 'index.mjs');

function patchFile(filePath, replacer) {
  const original = readFileSync(filePath, 'utf8');
  const next = replacer(original);
  if (next !== original) {
    writeFileSync(filePath, next);
  }
}

patchFile(cjsPath, (source) =>
  source.replace(
    /var inter_number_flow_default = "\.\/(inter-number-flow-[A-Z0-9]+\.ttf)";/,
    `var inter_number_flow_default = require("./$1");`,
  ),
);

patchFile(esmPath, (source) =>
  source.replace(
    /var inter_number_flow_default = "\.\/(inter-number-flow-[A-Z0-9]+\.ttf)";/,
    `import inter_number_flow_default from "./$1";`,
  ),
);

console.log('Patched dist font asset references for React Native consumers.');
