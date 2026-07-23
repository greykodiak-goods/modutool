/* 회원 상태 경량 레이어 — 모든 페이지에 로드(SDK 없이 localStorage만 읽음, ~3KB).
   Supabase SDK(204KB)는 /login /signup /account 페이지에서만 로드한다.
   활성화 조건: auth-config.js 가 window.MDTL_AUTH 를 정의했을 때. */
(function () {
  'use strict';

  function cfg() { return window.MDTL_AUTH && window.MDTL_AUTH.url ? window.MDTL_AUTH : null; }
  function lang() { return (document.documentElement.lang || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko'; }
  function prefix() { return (window.MDTL_BASE || '') + (lang() === 'ko' ? '/ko' : ''); }

  /* Supabase 세션 토큰 존재 여부 (SDK 없이 감지) */
  window.mdtlLoggedIn = function () {
    var c = cfg(); if (!c) return false;
    try {
      var ref = (c.url.match(/https:\/\/([a-z0-9]+)\./) || [])[1];
      return !!(ref && localStorage.getItem('sb-' + ref + '-auth-token'));
    } catch (e) { return false; }
  };

  /* 프리미엄 여부 — 로그인/계정 페이지가 갱신하는 로컬 캐시 기반.
     광고 숨김 등 '표시 편의' 판정 전용. 실제 유료 기능 게이트는 서버 검증으로 별도 구현할 것. */
  window.mdtlIsPremium = function () {
    if (!window.mdtlLoggedIn()) return false;
    try {
      var raw = localStorage.getItem('mdtl-plan');
      if (!raw) return false;
      var p = JSON.parse(raw);
      if (p.plan !== 'premium') return false;
      return !p.expires || new Date(p.expires) > new Date();
    } catch (e) { return false; }
  };

  window.mdtlCachePlan = function (plan, expires) {
    try { localStorage.setItem('mdtl-plan', JSON.stringify({ plan: plan || 'free', expires: expires || null })); } catch (e) {}
  };
  window.mdtlClearAuthCache = function () {
    try { localStorage.removeItem('mdtl-plan'); } catch (e) {}
  };

  /* 헤더에 프리미엄/로그인 버튼 주입 (site.js shell 이후 호출됨) */
  window.mdtlAuthHeader = function () {
    var inner = document.querySelector('#site-header .inner');
    if (!inner) return;
    var ko = lang() === 'ko';
    var themeBtn = inner.querySelector('.icon-btn');

    var prem = document.createElement('a');
    prem.href = prefix() + '/pricing/';
    prem.textContent = window.mdtlIsPremium() ? (ko ? '프리미엄 ✓' : 'Premium ✓') : (ko ? '프리미엄' : 'Premium');
    prem.setAttribute('style', 'font-size:14px;font-weight:700;color:var(--accent-text);margin-right:2px;');
    inner.insertBefore(prem, themeBtn);

    if (cfg()) {
      var acct = document.createElement('a');
      if (window.mdtlLoggedIn()) {
        acct.href = prefix() + '/account/';
        acct.textContent = ko ? '내 계정' : 'Account';
      } else {
        acct.href = prefix() + '/login/';
        acct.textContent = ko ? '로그인' : 'Log in';
      }
      acct.setAttribute('style', 'font-size:14px;font-weight:600;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:7px 12px;');
      inner.insertBefore(acct, themeBtn);
    }
  };

  /* 회원 페이지 전용: SDK 클라이언트 생성 (vendor/supabase.js 선로드 필요)
     보안 세션 설정:
     - flowType 'pkce': OAuth(구글) 인가코드 가로채기 방지(SPA 표준 보안 플로우)
     - autoRefreshToken: 액세스 토큰(기본 1h) 만료 전 자동 갱신 → 세션 유지
     - persistSession: 리프레시 토큰 보관(재방문 시 로그인 유지)
     - detectSessionInUrl: OAuth/매직링크 리다이렉트의 토큰을 URL에서 회수 후 주소창 정리 */
  window.mdtlAuthClient = function () {
    var c = cfg();
    if (!c || typeof supabase === 'undefined') return null;
    if (!window.__mdtlSb) {
      window.__mdtlSb = supabase.createClient(c.url, c.anonKey, {
        auth: {
          flowType: 'pkce',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      });
    }
    return window.__mdtlSb;
  };

  /* 구글 OAuth 로그인/가입 (같은 흐름 — 계정 없으면 자동 생성).
     ⚠️ Supabase 대시보드에서 Google 공급자를 활성화해야 동작(설정 전엔 friendly 에러). */
  window.mdtlSignInWithGoogle = async function (redirectPath) {
    var sb = window.mdtlAuthClient(); if (!sb) return { error: { message: 'auth-not-ready' } };
    return await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + (window.MDTL_BASE || '') + (redirectPath || (prefix() + '/account/')),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  };

  /* 로그인 직후 플랜 캐시 갱신 */
  window.mdtlRefreshPlan = async function () {
    var sb = window.mdtlAuthClient(); if (!sb) return null;
    var s = await sb.auth.getSession();
    var user = s && s.data && s.data.session && s.data.session.user;
    if (!user) { window.mdtlClearAuthCache(); return null; }
    var r = await sb.from('profiles').select('plan, plan_expires_at').eq('id', user.id).maybeSingle();
    var plan = (r && r.data && r.data.plan) || 'free';
    window.mdtlCachePlan(plan, r && r.data && r.data.plan_expires_at);
    return { user: user, plan: plan };
  };
})();
