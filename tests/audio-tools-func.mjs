/* video-to-mp3 / audio-trim 실기능 검증 — 실브라우저 + 실제 ffmpeg.wasm.
   페이지 안 엔진으로 테스트 입력(영상+사인파 오디오)을 만들고 → 드롭 → 변환 → 출력 유효성 확인. */
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

const fails = [];
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); }

const ENGINE = `location.origin + '${PREFIX}/video/assets/vendor/ffmpeg/'`;

/** 페이지 컨텍스트에서 엔진으로 파일을 만들어 드롭존에 주입 */
async function makeAndDrop(page, args, outName, fileName, mime) {
  return page.evaluate(async ([ffArgs, out, fname, type, enginePrefix]) => {
    const f = new FFmpegWASM.FFmpeg();
    const toBlobURL = async (url, t) => {
      const r = await fetch(url); const b = await r.blob();
      return URL.createObjectURL(new Blob([b], { type: t }));
    };
    await f.load({
      coreURL: await toBlobURL(enginePrefix + 'ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL(enginePrefix + 'ffmpeg-core.wasm', 'application/wasm'),
      classWorkerURL: enginePrefix + '814.ffmpeg.js',
    });
    await f.exec(ffArgs);
    const data = await f.readFile(out);
    const file = new File([data], fname, { type });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('dz').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    return data.length;
  }, [args, outName, fileName, mime, eval(ENGINE.replace('location.origin', JSON.stringify(base.replace(PREFIX, ''))))]);
}

function isMp3(buf) {
  // ID3 태그 또는 MPEG 프레임 싱크(0xFF 0xEx/0xFx)로 시작해야 유효
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;      // "ID3"
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

// ── 1) video-to-mp3 ──
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/video/video-to-mp3/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.FFmpegWASM !== 'undefined' && typeof window.mdtlDropzone === 'function');

  // 영상(VP8) + 오디오(vorbis) webm 생성 후 드롭
  const made = await makeAndDrop(page,
    ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=15',
     '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
     '-c:v', 'libvpx', '-b:v', '150k', '-c:a', 'libvorbis', '-shortest', 'gen.webm'],
    'gen.webm', 'lecture_clip.webm', 'video/webm');
  ok(made > 1000, `테스트 영상+오디오 생성 (${made} bytes)`);

  await page.waitForFunction(() => !document.querySelector('#dz') || document.querySelectorAll('button').length > 0);
  // 변환 버튼(=disabled 해제된 주 버튼) 대기 후 클릭
  await page.waitForFunction(() => {
    const bs = Array.from(document.querySelectorAll('.btn'));
    return bs.some((b) => b.tagName === 'BUTTON' && !b.disabled && !/clear|제거|지우/i.test(b.textContent));
  }, null, { timeout: 90000 });
  const dl = page.waitForEvent('download', { timeout: 180000 });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button.btn'))
      .find((x) => !x.disabled && !/clear|제거|지우/i.test(x.textContent));
    b.click();
  });
  const download = await dl;
  ok(/\.mp3$/.test(download.suggestedFilename()), `파일명 ${download.suggestedFilename()}`);
  const buf = readFileSync(await download.path());
  ok(buf.length > 2000, `출력 크기 유효 (${buf.length} bytes)`);
  ok(isMp3(buf), '출력이 실제 MP3 형식(ID3/프레임싱크)');
  ok(errs.length === 0, 'video-to-mp3 JS 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await page.close();
}

// ── 2) audio-trim ──
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/video/audio-trim/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.FFmpegWASM !== 'undefined' && typeof window.mdtlDropzone === 'function');

  const made = await makeAndDrop(page,
    ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', '-b:a', '128k', 'gen.mp3'],
    'gen.mp3', 'song.mp3', 'audio/mpeg');
  ok(made > 1000, `테스트 오디오 생성 (${made} bytes)`);

  // 슬라이더로 0~1.5초 구간 설정 — 반드시 메타데이터 로드(max=실제 길이로 갱신) 이후에.
  // 페이지는 loadedmetadata에서 endRange.value를 전체 길이로 덮어쓰므로, 그 전에 설정하면
  // 전체 구간 트림이 되어 출력==원본 크기로 간헐 실패한다(2026-08-21 CI 실사례).
  await page.waitForFunction(() => {
    const e = document.getElementById('endRange');
    return e && parseFloat(e.max) > 2 && parseFloat(e.max) < 100; // 기본 max=100 → 4초 길이로 갱신 대기
  }, null, { timeout: 60000 });
  await page.evaluate(() => {
    const s = document.getElementById('startRange'), e = document.getElementById('endRange');
    s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true }));
    e.value = 1.5; e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('endRange').value === '1.5', null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const bs = Array.from(document.querySelectorAll('button.btn'));
    return bs.some((b) => !b.disabled && !/clear|제거|지우/i.test(b.textContent));
  }, null, { timeout: 90000 });
  const dl = page.waitForEvent('download', { timeout: 180000 });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button.btn'))
      .find((x) => !x.disabled && !/clear|제거|지우/i.test(x.textContent));
    b.click();
  });
  const download = await dl;
  ok(/_trim\./.test(download.suggestedFilename()), `파일명 ${download.suggestedFilename()}`);
  const buf = readFileSync(await download.path());
  ok(buf.length > 500 && buf.length < made, `잘린 출력이 원본보다 작음 (${buf.length} < ${made})`);
  ok(isMp3(buf), '출력이 실제 MP3 형식');
  ok(errs.length === 0, 'audio-trim JS 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await page.close();
}

await browser.close(); server.close();
console.log('\n' + (fails.length ? `❌ ${fails.length} 실패` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
