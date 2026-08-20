/* Playwright 로더 공용화 — 실행 환경(개발컨테이너/CI/로컬)별 설치 위치 차이를 한 곳에서 흡수한다.
   기존엔 각 테스트가 /opt/node22(개발컨테이너 전역 설치)를 하드코딩해 CI에서 돌 수 없었다.

   모듈 탐색 우선순위: PW_DIR 환경변수 → 레포 자체 node_modules → /opt/node22(개발컨테이너).
   브라우저 실행파일: CHROMIUM_PATH → /opt/pw-browsers/chromium → playwright 번들 크로미움. */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** playwright의 chromium 런처를 찾는다. 어디에도 없으면 설치 안내와 함께 던진다. */
export function loadChromium() {
  const candidates = [process.env.PW_DIR, repoRoot, '/opt/node22/lib/node_modules'].filter(Boolean);
  for (const dir of candidates) {
    try {
      const req = createRequire(join(dir, 'package.json'));
      return req('playwright').chromium;
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error('playwright를 찾지 못했습니다 — PW_DIR을 지정하거나 `npm install`을 먼저 실행하세요');
}

/** 빌드 산출물 dist/ 절대경로 — URL.pathname 방식은 윈도에서 `/C:/...`가 되어 fs가 못 읽는다. */
export function distDir() {
  return join(repoRoot, 'dist');
}

/** 레포 루트 절대경로 — 소스 트리를 직접 서빙하는 테스트용. */
export function repoDir() {
  return repoRoot;
}

/** chromium.launch(...)에 넘길 옵션 — 실행파일 위치를 환경에 맞게 정한다. */
export function launchOptions() {
  if (process.env.CHROMIUM_PATH) return { executablePath: process.env.CHROMIUM_PATH };
  if (existsSync('/opt/pw-browsers/chromium')) return { executablePath: '/opt/pw-browsers/chromium' };
  return {}; // playwright가 번들 브라우저를 알아서 찾는다 (`npx playwright install chromium`)
}
