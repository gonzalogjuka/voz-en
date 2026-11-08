import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

await build({
  entryPoints: ['src/engine.js'],
  outfile: 'extension/engine.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome113',
  minify: true,
  logLevel: 'info',
});

mkdirSync('extension/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  cpSync(`node_modules/@huggingface/transformers/dist/${f}`, `extension/ort/${f}`);
}
