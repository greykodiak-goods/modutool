#!/usr/bin/env node
/* assets/vendor/convex.js 재생성 — 사이트 자체는 무빌드이므로 산출물을 커밋해 둔다.
   사용: node scripts/build-vendor-convex.mjs */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'assets/vendor/convex.js');
await build({
  entryPoints: [join(root, 'scripts/vendor-src/convex-entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'MDTLConvexLib',
  target: ['es2019'],
  minify: true,
  legalComments: 'none',
  outfile: out,
});
console.log(`convex 벤더 번들 → ${out} (${(statSync(out).size / 1024).toFixed(0)}KB)`);
