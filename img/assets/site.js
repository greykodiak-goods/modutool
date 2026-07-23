/* 모두의툴 공용 스크립트 — 테마, 드롭존, 파일 유틸, 광고 로더. 의존성 없음. */
(function () {
  'use strict';
  var BASE = window.MDTL_BASE || '';   // 서브패스 배포(gh-pages 등) 지원 — 빌드가 주입
  var BRAND = window.MDTL_SITE_BRAND || 'ThisIsMyPDF';   // SITE 빌드가 주입(미지정 시 통합 브랜드)
  var MARK = window.MDTL_SITE_MARK || 'T';

  /* ── 테마 ── */
  var saved = null;
  try { saved = localStorage.getItem('mdtl-theme'); } catch (e) {}
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;

  window.mdtlToggleTheme = function () {
    var root = document.documentElement;
    var isDark = root.dataset.theme === 'dark' ||
      (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = isDark ? 'light' : 'dark';
    try { localStorage.setItem('mdtl-theme', root.dataset.theme); } catch (e) {}
  };

  /* ── 다국어 셸 문자열 (페이지 lang 속성으로 판별) ── */
  var LANGS = {
    ko: {
      mark: MARK, site: BRAND, home: '/ko/',
      footer: '© ' + BRAND + ' — 모든 처리는 브라우저 안에서 이뤄지며 파일은 서버로 전송되지 않습니다.',
      links: [['/ko/pricing/', '프리미엄'], ['/ko/about/', '소개'], ['/ko/privacy/', '개인정보처리방침'], ['/ko/terms/', '이용약관']],
      themeLabel: '다크모드 전환',
      suggest: '🌐 View this page in English', stay: '한국어로 계속'
    },
    en: {
      mark: MARK, site: BRAND, home: '/',
      footer: '© ' + BRAND + ' — Everything runs inside your browser. Your files are never uploaded to any server.',
      links: [['/pricing/', 'Premium'], ['/about/', 'About'], ['/privacy/', 'Privacy'], ['/terms/', 'Terms']],
      themeLabel: 'Toggle dark mode',
      suggest: '🌐 이 페이지를 한국어로 보기', stay: 'Continue in English'
    }
  };
  function pageLang() {
    var l = (document.documentElement.lang || 'ko').slice(0, 2);
    return LANGS[l] ? l : 'ko';
  }

  /* ── 헤더/푸터 주입 (페이지마다 중복 마크업 방지) ── */
  window.mdtlShell = function (opts) {
    opts = opts || {};
    var L = LANGS[pageLang()];
    var header = document.getElementById('site-header');
    if (header) {
      header.innerHTML =
        '<div class="inner">' +
        '<a class="logo" href="' + BASE + L.home + '"><span class="mark">' + L.mark + '</span>' + L.site + '</a>' +
        '<span class="header-spacer"></span>' +
        '<button class="icon-btn" onclick="mdtlToggleTheme()" aria-label="' + L.themeLabel + '" title="' + L.themeLabel + '">◐</button>' +
        '</div>';
    }
    var footer = document.getElementById('site-footer');
    if (footer) {
      footer.innerHTML =
        '<div class="inner">' +
        '<span>' + L.footer + '</span>' +
        L.links.map(function (a) { return '<a href="' + BASE + a[0] + '">' + a[1] + '</a>'; }).join('') +
        '</div>';
    }
  };

  /* ── 언어 제안 배너 ──
     IP 국가 기반 자동 리다이렉트는 SEO 안티패턴(구글봇이 미국에서 크롤)이라 쓰지 않는다.
     대신 브라우저 언어를 보고, head의 hreflang 대체 페이지가 있을 때만 "제안 배너"를 띄운다. */
  window.mdtlLangBanner = function () {
    var cur = pageLang();
    var pref = null;
    try { pref = localStorage.getItem('mdtl-lang'); } catch (e) {}
    if (pref === cur) return;                       // 이미 이 언어를 선택한 사용자
    var want = cur === 'ko' ? 'en' : 'ko';
    if (pref && pref !== want) return;
    if (!pref) {                                    // 선택 이력 없으면 브라우저 언어로 판단
      var nav = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'ko'])
        .map(function (s) { return String(s).slice(0, 2).toLowerCase(); });
      if (nav.indexOf(want) === -1) return;         // 반대 언어 선호 아님
      if (nav.indexOf(cur) !== -1 && nav.indexOf(cur) < nav.indexOf(want)) return; // 현재 언어를 더 선호
    }
    var alt = document.querySelector('link[rel="alternate"][hreflang="' + want + '"]');
    if (!alt) return;                               // 대체 언어 페이지가 없는 페이지
    var L = LANGS[cur];
    var bar = document.createElement('div');
    bar.setAttribute('style',
      'position:sticky;bottom:0;left:0;right:0;z-index:60;display:flex;gap:12px;align-items:center;justify-content:center;' +
      'padding:10px 14px;background:var(--accent);color:#fff;font-size:14px;');
    var link = document.createElement('a');
    link.href = alt.getAttribute('href');
    link.textContent = L.suggest;
    link.setAttribute('style', 'color:#fff;font-weight:700;text-decoration:underline;');
    link.addEventListener('click', function () {
      try { localStorage.setItem('mdtl-lang', want); } catch (e) {}
    });
    var stay = document.createElement('button');
    stay.textContent = L.stay;
    stay.setAttribute('style', 'background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;');
    stay.addEventListener('click', function () {
      try { localStorage.setItem('mdtl-lang', cur); } catch (e) {}
      bar.remove();
    });
    bar.appendChild(link); bar.appendChild(stay);
    document.body.appendChild(bar);
  };

  /* ── 파일 유틸 ── */
  window.mdtlFormatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  window.mdtlDownload = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  /* 드롭존: mdtlDropzone(el, { accept, multiple, onFiles }) */
  window.mdtlDropzone = function (el, opts) {
    var input = el.querySelector('input[type=file]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      el.appendChild(input);
    }
    if (opts.accept) input.accept = opts.accept;
    if (opts.multiple) input.multiple = true;

    el.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files && input.files.length) opts.onFiles(Array.from(input.files));
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      el.addEventListener(t, function (e) { e.preventDefault(); el.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.addEventListener(t, function (e) { e.preventDefault(); el.classList.remove('drag'); });
    });
    el.addEventListener('drop', function (e) {
      var files = Array.from(e.dataTransfer.files || []);
      if (opts.accept) {
        var pats = opts.accept.split(',').map(function (s) { return s.trim().toLowerCase(); });
        files = files.filter(function (f) {
          var name = f.name.toLowerCase(), type = (f.type || '').toLowerCase();
          return pats.some(function (p) {
            if (p.charAt(0) === '.') return name.slice(-p.length) === p;
            if (p.slice(-2) === '/*') return type.indexOf(p.slice(0, -1)) === 0;
            return type === p;
          });
        });
      }
      if (files.length) opts.onFiles(files);
    });
  };

  /* 결과 영역 헬퍼 */
  window.mdtlResult = function (el, html, isError) {
    el.className = 'result show' + (isError ? ' error' : '');
    el.innerHTML = html;
  };

  /* ── 광고 로더 ──
     assets/ads-config.js 가 window.MDTL_ADS 를 정의하면 슬롯을 활성화한다.
     승인 전에는 슬롯이 DOM에 자리조차 차지하지 않는다(CLS·정책 안전).
     예: window.MDTL_ADS = { provider: 'adsense', client: 'ca-pub-XXXX', slots: { top: '123', bottom: '456' } };
         window.MDTL_ADS = { provider: 'adfit', slots: { top: 'DAN-xxx', bottom: 'DAN-yyy' }, size: [320,100] }; */
  window.mdtlInitAds = function () {
    var cfg = window.MDTL_ADS;
    if (!cfg || !cfg.provider) return;
    var slots = document.querySelectorAll('.ad-slot');
    if (!slots.length) return;

    if (cfg.provider === 'adsense' && cfg.client) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + cfg.client;
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
      slots.forEach(function (el) {
        var slotId = cfg.slots && cfg.slots[el.dataset.slot];
        if (!slotId) return;
        el.classList.add('active');
        el.innerHTML = '<div class="ad-label">AD</div>' +
          '<ins class="adsbygoogle" style="display:block" data-ad-client="' + cfg.client +
          '" data-ad-slot="' + slotId + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      });
    } else if (cfg.provider === 'adfit') {
      slots.forEach(function (el) {
        var slotId = cfg.slots && cfg.slots[el.dataset.slot];
        if (!slotId) return;
        var size = (cfg.size || [320, 100]);
        el.classList.add('active');
        el.innerHTML = '<div class="ad-label">AD</div>' +
          '<ins class="kakao_ad_area" style="display:none" data-ad-unit="' + slotId +
          '" data-ad-width="' + size[0] + '" data-ad-height="' + size[1] + '"></ins>';
      });
      var k = document.createElement('script');
      k.async = true;
      k.src = 'https://t1.daumcdn.net/kas/static/ba.min.js';
      document.head.appendChild(k);
    }
  };

  /* ── 결과 텔레메트리(익명) ──
     고객이 원하는 결과를 못 얻은 순간(오류·미달성)을 비식별 메타로만 집계한다 → 백오피스 /admin/ (관리자만).
     ⚠️ 파일명·파일바이트·사용자가 입력한 값은 절대 전송하지 않는다("파일은 브라우저를 떠나지 않는다"는 약속 유지).
     조회·수정 정책이 없어 클라이언트로는 로그를 읽을 수도 없다(INSERT 전용). */
  function telAuth() { return window.MDTL_AUTH && window.MDTL_AUTH.url ? window.MDTL_AUTH : null; }
  function telLocal() {
    try { if (localStorage.getItem('mdtl-tel-force') === '1') return false; } catch (e) {}  // 로컬 검증용 강제 플래그
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '';
  }
  function telOptedOut() {
    try { return localStorage.getItem('mdtl-no-telemetry') === '1'; } catch (e) { return false; }
  }
  function telToolSlug() {
    var path = location.pathname;
    if (BASE && path.indexOf(BASE) === 0) path = path.slice(BASE.length);
    var parts = path.split('/').filter(Boolean);
    if (parts[0] === 'ko') parts.shift();
    return (parts[0] || 'home').slice(0, 40);
  }
  function telCategory(tool) {
    if (tool === 'img-to-pdf' || tool.indexOf('pdf') === 0) return 'pdf';
    if (tool.indexOf('image') === 0) return 'img';
    if (/(calculator|calc|char-count|dday|pyeong|percent|trig|age)/.test(tool)) return 'calc';
    return 'other';
  }
  function telLang() { return (document.documentElement.lang || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko'; }
  function telUa() {
    var u = navigator.userAgent || '';
    var m = /(Edg|OPR|SamsungBrowser|Chrome|Firefox|Safari)/.exec(u);
    var name = m ? (m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1]) : 'Other';
    var kind = /Mobi|Android|iPhone|iPad/.test(u) ? 'mobile' : 'desktop';
    return (name + '/' + kind).slice(0, 40);
  }
  function telSid() {
    try {
      var k = 'mdtl-sid', v = localStorage.getItem(k);
      if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); }
      return String(v).slice(0, 40);
    } catch (e) { return null; }
  }
  window.mdtlSizeBucket = function (bytes) {
    if (bytes == null || isNaN(bytes)) return null;
    var mb = bytes / 1048576;
    if (mb < 0.5) return '<0.5MB';
    if (mb < 1) return '0.5-1MB';
    if (mb < 5) return '1-5MB';
    if (mb < 10) return '5-10MB';
    if (mb < 20) return '10-20MB';
    if (mb < 50) return '20-50MB';
    return '50MB+';
  };
  /* meta 화이트리스트 — 비식별 수치/열거값만 통과(파일명·경로·텍스트 원문 차단) */
  var TEL_META_KEYS = ['pages', 'count', 'n', 'size_bucket', 'result_bucket', 'level',
    'saved_pct', 'err_name', 'width', 'height', 'format', 'quality'];
  function telCleanMeta(meta) {
    var out = {};
    if (meta && typeof meta === 'object') {
      TEL_META_KEYS.forEach(function (k) {
        var v = meta[k];
        if (v == null) return;
        if (typeof v === 'string') v = v.slice(0, 40);
        else if (typeof v === 'number') v = Math.round(v * 100) / 100;
        else if (typeof v !== 'boolean') return;
        out[k] = v;
      });
    }
    return out;
  }
  function telGuessReason(t) {
    t = (t || '').toLowerCase();
    if (/password|비밀번호|암호|잠긴|locked/.test(t)) return 'password_protected';
    if (/corrupt|손상|not a valid|유효한 pdf|열 수 없|cannot be opened|invalid/.test(t)) return 'invalid_file';
    if (/memory|메모리|too large|too big|너무 큰|너무 큼|용량/.test(t)) return 'too_large_or_oom';
    if (/browser|브라우저|not support|지원하지|unsupported/.test(t)) return 'browser_unsupported';
    if (/network|네트워크|failed to load|불러오지|다운로드/.test(t)) return 'load_failed';
    if (/select at least|파일을 선택|no file|하나 이상|골라|추가/.test(t)) return 'no_input';
    return 'error_generic';
  }

  var telLastKey = '', telLastAt = 0;
  /* mdtlLogEvent(tool, outcome, reason, meta)
     tool 생략 시 URL에서 유추. outcome: success|no_result|error|unsupported|cancelled */
  window.mdtlLogEvent = function (tool, outcome, reason, meta) {
    try {
      var a = telAuth();
      if (!a || telLocal() || telOptedOut()) return;
      var ALLOWED = { success: 1, no_result: 1, error: 1, unsupported: 1, cancelled: 1 };
      outcome = ALLOWED[outcome] ? outcome : 'error';
      tool = String(tool || telToolSlug()).slice(0, 40);
      reason = reason ? String(reason).slice(0, 60) : null;
      var key = tool + '|' + outcome + '|' + (reason || '');
      var now = new Date().getTime();
      if (key === telLastKey && now - telLastAt < 1500) return;   // 짧은 중복 억제
      telLastKey = key; telLastAt = now;

      var row = {
        tool: tool, outcome: outcome, reason: reason,
        lang: telLang(), site: telCategory(tool), ua: telUa(),
        session_id: telSid(), meta: telCleanMeta(meta)
      };
      var bearer = a.anonKey;
      try {
        var ref = (a.url.match(/https:\/\/([a-z0-9]+)\./) || [])[1];
        var tok = ref && JSON.parse(localStorage.getItem('sb-' + ref + '-auth-token') || 'null');
        if (tok && tok.access_token) bearer = tok.access_token;
      } catch (e) {}
      fetch(a.url.replace(/\/$/, '') + '/rest/v1/tool_events', {
        method: 'POST', keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'apikey': a.anonKey,
          'Authorization': 'Bearer ' + bearer,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
      }).catch(function () {});
    } catch (e) { /* 텔레메트리는 절대 UI를 막지 않는다 */ }
  };

  /* 전역 자동 캡처: 어떤 툴이든 mdtlResult(el, html, true)로 에러를 표시하면 자동 로깅.
     (페이지별 수정 없이 전 툴의 오류를 포착. no_result/success는 각 툴이 mdtlLogEvent로 명시.) */
  var telOrigResult = window.mdtlResult;
  window.mdtlResult = function (el, html, isError) {
    if (isError) {
      try {
        var text = String(html == null ? '' : html).replace(/<[^>]*>/g, ' ');
        window.mdtlLogEvent(null, 'error', telGuessReason(text), {});
      } catch (e) {}
    }
    return telOrigResult.apply(this, arguments);
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (window.mdtlAutoShell !== false) window.mdtlShell();
    if (window.mdtlAuthHeader) window.mdtlAuthHeader();
    if (!(window.mdtlIsPremium && window.mdtlIsPremium())) window.mdtlInitAds();  // 프리미엄 = 광고 제거
    window.mdtlLangBanner();
  });
})();
