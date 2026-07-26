/* 오프라인 서비스워커 — 전 도구가 클라이언트 처리라, 한 번 방문한 뒤에는 인터넷 없이도 동작한다.
   업로드형 경쟁 사이트는 원리상 따라올 수 없는 지점.

   설계 메모:
   · BASE는 self.location에서 유도한다(빌드가 경로를 다시 쓸 필요 없음 — /modutool/pdf/ 같은 서브패스에서도 동작).
   · 캐시 이름에 빌드ID가 박혀 있어 배포마다 새 캐시가 생기고 activate에서 옛 캐시를 지운다
     (버전 고정 캐시의 고전적 사고 — 사용자가 옛 버전에 영구히 갇히는 것 — 을 막는다).
   · 엔진(ffmpeg 31MB·opencv 13MB)은 precache하지 않는다. 첫 방문에 수십 MB를 강제로 받게 하면
     안 쓰는 사용자에게 손해다. 대신 한 번 쓰면 런타임 캐시에 남아 다음부터는 오프라인에서도 즉시 동작.
   · API(수집 엔드포인트·인증)는 절대 캐시하지 않는다 — 오프라인이면 그냥 실패시키고 도구는 계속 쓰게 둔다. */
'use strict';

var BUILD = '7099e68d5221';
var BASE = new URL('./', self.location).pathname;      // 예: /modutool/pdf/

/* ⚠️ CacheStorage는 스코프가 아니라 "오리진" 단위로 공유된다.
   지금은 /pdf /img /calc /video 4개 브랜드가 한 오리진에 얹혀 있어서,
   캐시 이름을 'mdtl-<빌드ID>'로만 두면 /pdf의 activate가 /img의 캐시를 지운다
   (빌드ID가 사이트마다 다르므로 전부 "옛 캐시"로 보인다).
   → 캐시 이름에 스코프 경로를 넣고, 삭제도 같은 스코프 접두 안에서만 한다. */
var SCOPE = BASE.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root';
var PREFIX = 'mdtl-' + SCOPE + '-';
var CACHE = PREFIX + BUILD;

/* 첫 설치 때 미리 받아둘 최소 셸(가볍게 유지 — 무거운 건 런타임 캐시로) */
var PRECACHE = [
  BASE,
  BASE + 'assets/site.css',
  BASE + 'assets/site.js',
];

/* 캐시하면 안 되는 곳: 수집·인증 API */
function isApi(url) {
  return /(^|\.)convex\.(site|cloud)$/.test(url.hostname) ||
         /googlesyndication|doubleclick|daumcdn/.test(url.hostname);
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .catch(function () { /* 일부 실패해도 설치는 진행 */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(PREFIX) === 0 && k !== CACHE) return caches.delete(k);   // 같은 스코프의 옛 빌드만
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // 서드파티는 건드리지 않음
  if (isApi(url)) return;

  /* 문서(HTML): 네트워크 우선 — 항상 최신을 보여주되, 오프라인이면 캐시로 폴백 */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match(BASE);          // 캐시에 없으면 홈이라도
        });
      })
    );
    return;
  }

  /* 정적 자산·엔진: 캐시 우선 — 두 번째부터는 오프라인에서도 즉시 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(req, copy).catch(function () { /* 용량 초과 등은 조용히 무시 */ });
          });
        }
        return res;
      });
    })
  );
});
