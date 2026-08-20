/* video-trim 기능 검증 — 실브라우저에서 실제 ffmpeg.wasm 엔진으로:
   ① 페이지의 엔진이 테스트 영상(mp4, 2초, testsrc)을 직접 생성 ② 드롭존에 주입
   ③ 슬라이더로 1초 구간 설정 ④ 잘라서 다운로드 → 출력 크기·파일명 검증 */
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
const chromium = loadChromium();
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = distDir();
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

const fails = [];
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); }

await page.goto(`${base}/video/video-trim/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.FFmpegWASM !== 'undefined' && typeof window.mdtlDropzone === 'function');
ok(true, 'ffmpeg.js 로더 로드됨(FFmpegWASM 전역)');

// ① 페이지 컨텍스트에서 엔진으로 테스트 mp4 생성 → ② 드롭
const made = await page.evaluate(async () => {
  const f = new FFmpegWASM.FFmpeg();
  const toBlobURL = async (url, type) => {
    const r = await fetch(url); const b = await r.blob();
    return URL.createObjectURL(new Blob([b], { type }));
  };
  await f.load({
    coreURL: await toBlobURL(location.origin + '/modutool/video/assets/vendor/ffmpeg/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL(location.origin + '/modutool/video/assets/vendor/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
    classWorkerURL: location.origin + '/modutool/video/assets/vendor/ffmpeg/814.ffmpeg.js',
  });
  // 헤드리스 Chromium은 H.264 미탑재 → VP8/WebM으로 생성(실크롬에선 mp4도 동작)
  await f.exec(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=15',
    '-c:v', 'libvpx', '-b:v', '200k', 'gen.webm']);
  const data = await f.readFile('gen.webm');
  const file = new File([data], 'sample_clip.webm', { type: 'video/webm' });
  const dt = new DataTransfer(); dt.items.add(file);
  document.getElementById('dz').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  return data.length;
});
ok(made > 1000, `엔진으로 테스트 mp4 생성됨 (${made} bytes)`);

// 메타데이터 로드 → 슬라이더 세팅 (0.0 ~ 1.0초)
await page.waitForSelector('.vt-stage.show', { timeout: 60000 });
await page.evaluate(() => {
  const s = document.getElementById('startRange'), e = document.getElementById('endRange');
  s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true }));
  e.value = 1.0; e.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(() => !document.getElementById('trimBtn').disabled);
ok(true, '구간 설정 → 버튼 활성');

const dl = page.waitForEvent('download', { timeout: 120000 });
await page.click('#trimBtn');
const download = await dl;
ok(/_trim\.webm$/.test(download.suggestedFilename()), `파일명 ${download.suggestedFilename()}`);
const outSize = statSync(await download.path()).size;
ok(outSize > 500 && outSize < made, `출력 유효 크기 (${outSize} bytes, 원본 ${made}보다 작음)`);
ok(errs.length === 0, 'JS 오류 없음' + (errs.length ? ': ' + errs[0] : ''));

await browser.close(); server.close();
console.log('\n' + (fails.length ? `❌ ${fails.length} 실패` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
