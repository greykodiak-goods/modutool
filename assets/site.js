/* 모두의툴 공용 스크립트 — 테마, 드롭존, 파일 유틸, 광고 로더. 의존성 없음. */
(function () {
  'use strict';
  var BASE = window.MDTL_BASE || '';   // 서브패스 배포(gh-pages 등) 지원 — 빌드가 주입

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
      mark: 'T', site: 'ThisIsMyPDF', home: '/',
      footer: '© ThisIsMyPDF — 모든 처리는 브라우저 안에서 이뤄지며 파일은 서버로 전송되지 않습니다.',
      links: [['/pricing/', '프리미엄'], ['/about/', '소개'], ['/privacy/', '개인정보처리방침'], ['/terms/', '이용약관']],
      themeLabel: '다크모드 전환',
      suggest: '🌐 View this page in English', stay: '한국어로 계속'
    },
    en: {
      mark: 'T', site: 'ThisIsMyPDF', home: '/en/',
      footer: '© ThisIsMyPDF — Everything runs inside your browser. Your files are never uploaded to any server.',
      links: [['/en/pricing/', 'Premium'], ['/en/about/', 'About'], ['/en/privacy/', 'Privacy'], ['/en/terms/', 'Terms']],
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

  document.addEventListener('DOMContentLoaded', function () {
    if (window.mdtlAutoShell !== false) window.mdtlShell();
    if (window.mdtlAuthHeader) window.mdtlAuthHeader();
    if (!(window.mdtlIsPremium && window.mdtlIsPremium())) window.mdtlInitAds();  // 프리미엄 = 광고 제거
    window.mdtlLangBanner();
  });
})();
