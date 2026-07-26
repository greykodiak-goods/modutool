/* video-to-gif / video-compress 실기능 검증 — 실브라우저 + 실제 ffmpeg.wasm.
   audio-tools-func.mjs와 같은 방식(페이지 안 엔진으로 입력 영상을 만들어 드롭)이지만
   대상 도구가 다르다. 두 도구 모두 지금까지 "페이지가 열린다"만 확인돼 있었다.

   ⚠️ 헤드리스 크로미움엔 H.264가 없어 입력은 VP8/WebM으로 만든다.
      출력 검증은 확장자가 아니라 매직바이트로 한다(GIF89a / WebM EBML). */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
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
const enginePrefix = `${base}/video/assets/vendor/ffmpeg/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

/* 페이지 안 ffmpeg으로 테스트 영상을 만들어 드롭존에 떨군다 */
async function makeAndDrop(page, ffArgs, outName, fileName, mime) {
  return page.evaluate(async ([args, out, fname, type, prefix]) => {
    const f = new FFmpegWASM.FFmpeg();
    const toBlobURL = async (url, t) => {
      const r = await fetch(url); const b = await r.blob();
      return URL.createObjectURL(new Blob([b], { type: t }));
    };
    await f.load({
      coreURL: await toBlobURL(prefix + 'ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL(prefix + 'ffmpeg-core.wasm', 'application/wasm'),
      classWorkerURL: prefix + '814.ffmpeg.js',
    });
    await f.exec(args);
    const data = await f.readFile(out);
    const file = new File([data], fname, { type });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('dz').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    return data.length;
  }, [ffArgs, outName, fileName, mime, enginePrefix]);
}

const isGif = (b) => b.slice(0, 6).toString() === 'GIF89a' || b.slice(0, 6).toString() === 'GIF87a';
const isWebm = (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;   // EBML
const isMp4 = (b) => b.slice(4, 8).toString() === 'ftyp';

async function readDownload(dl) { return readFileSync(await dl.path()); }

/* ── video-to-gif ── */
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/video/video-to-gif/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.FFmpegWASM !== 'undefined' && typeof window.mdtlDropzone === 'function');

  const made = await makeAndDrop(page,
    ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=15',
     '-c:v', 'libvpx', '-b:v', '150k', 'gen.webm'],
    'gen.webm', 'clip.webm', 'video/webm');
  ok(made > 1000, `[gif] 테스트 영상 생성 (${made} bytes)`);

  await page.waitForSelector('#gifBtn:not([disabled])', { timeout: 90000 });
  const dl = page.waitForEvent('download', { timeout: 240000 });
  await page.click('#gifBtn');
  const download = await dl;
  ok(/\.gif$/.test(download.suggestedFilename()), `[gif] 파일명 ${download.suggestedFilename()}`);
  const buf = await readDownload(download);
  ok(isGif(buf), `[gif] 출력이 실제 GIF 형식 (헤더: ${buf.slice(0, 6).toString()})`);
  ok(buf.length > 1000, `[gif] 출력 크기 유효 (${buf.length} bytes)`);
  ok(errs.length === 0, 'video-to-gif JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── video-compress ── */
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/video/video-compress/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.FFmpegWASM !== 'undefined' && typeof window.mdtlDropzone === 'function');

  // 일부러 비트레이트를 높게 줘서 "줄일 여지"가 있는 입력을 만든다
  const made = await makeAndDrop(page,
    ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=20',
     '-c:v', 'libvpx', '-b:v', '2000k', 'gen.webm'],
    'gen.webm', 'clip.webm', 'video/webm');
  ok(made > 5000, `[compress] 테스트 영상 생성 (${made} bytes)`);

  await page.waitForSelector('#compBtn:not([disabled])', { timeout: 90000 });
  let downloaded = null;
  page.once('download', (d) => { downloaded = d; });
  await page.click('#compBtn');

  // ⚠️ #result.show 는 진행 중("⏳ Re-encoding…")에도 켜진다. 그것만 기다리면 아직 인코딩이
  //    끝나지도 않았는데 통과해버려 검증 가치가 0이 된다. 종료 상태(다운로드 발생 또는
  //    ⏳가 사라진 최종 문구)까지 기다린다.
  await page.waitForFunction(() => {
    const el = document.getElementById('result');
    const t = el ? el.textContent : '';
    return !!window.__dl || (el && el.classList.contains('show') && t.trim() && !/⏳/.test(t));
  }, null, { timeout: 600000 }).catch(() => {});
  // 다운로드가 늦게 떨어지는 경우를 위해 잠깐 여유
  if (!downloaded) await page.waitForTimeout(3000);
  const msg = (await page.locator('#result').innerText()).replace(/\s+/g, ' ');
  ok(!/⏳/.test(msg), `[compress] 인코딩이 끝난 최종 상태 도달 — "${msg.slice(0, 70)}"`);

  if (downloaded) {
    const buf = await readDownload(downloaded);
    ok(isMp4(buf) || isWebm(buf), `[compress] 출력이 유효한 영상 컨테이너 (${downloaded.suggestedFilename()})`);
    ok(buf.length > 1000, `[compress] 출력 크기 유효 (${buf.length} bytes)`);
    ok(buf.length < made, `[compress] 실제로 작아짐 (${made} → ${buf.length} bytes)`);
  } else {
    // 못 줄이는 입력이면 "왜 안 줄었는지"를 반드시 알려야 한다 — 조용히 끝나면 안 된다.
    ok(msg.length > 0, `[compress] 줄일 수 없을 때 사유 안내 — "${msg.slice(0, 90)}"`);
  }
  ok(errs.length === 0, 'video-compress JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(fails === 0 ? '\n영상 도구 2종 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
