/* 회원 상태 레이어 — 모든 페이지에 로드(벤더 없이 localStorage만 읽음, ~4KB).
   Convex 클라이언트(assets/vendor/convex.js, 18KB)는 /login /signup /account /admin 에서만 로드한다.

   2026-07-26 Supabase → Convex Auth 이관.
   토큰 규약은 @convex-dev/auth의 React 클라이언트와 동일하다(auth:signIn 액션이
   {tokens:{token, refreshToken}} 또는 OAuth의 {redirect, verifier}를 돌려준다).
   비밀번호 해싱·세션 회전·OAuth 코드교환은 전부 라이브러리(서버측)에 있고,
   여기 있는 건 "토큰을 어디에 두고 언제 갱신하느냐"는 저장/수명 관리뿐이다.

   ⚠️ 4개 브랜드(/pdf /img /calc /video)가 한 오리진이라 세션은 브랜드 간 공유된다 — 의도된 동작
      (한 계정으로 네 사이트를 쓴다). 도메인을 분리하면 이 공유가 깨진다:
      docs/2026-07-26-namespace-plan.md 5-2 참조. */
(function () {
  'use strict';

  var K_JWT = 'mdtl-auth-jwt';
  var K_REFRESH = 'mdtl-auth-refresh';
  var K_VERIFIER = 'mdtl-auth-verifier';
  var K_PLAN = 'mdtl-plan';

  function cfg() { return window.MDTL_CONVEX && window.MDTL_CONVEX.url ? window.MDTL_CONVEX : null; }
  function lang() { return (document.documentElement.lang || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko'; }
  function prefix() { return (window.MDTL_BASE || '') + (lang() === 'ko' ? '/ko' : ''); }

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* JWT의 exp를 읽는다(서명 검증은 서버 몫 — 여기선 "언제 갱신할지" 판단에만 쓴다). */
  function jwtExp(token) {
    try {
      var p = token.split('.')[1];
      var json = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
      return (JSON.parse(json).exp || 0) * 1000;
    } catch (e) { return 0; }
  }

  /* 로그인 여부 — 리프레시 토큰이 있으면 로그인 상태로 본다.
     (액세스 토큰은 짧게 만료되므로 그것만 보면 새로고침 직후 로그아웃처럼 보인다.) */
  window.mdtlLoggedIn = function () { return !!get(K_REFRESH); };

  /* 프리미엄 여부 — 계정 페이지가 갱신하는 로컬 캐시 기반.
     광고 숨김 같은 '표시 편의' 판정 전용. 실제 유료 기능 게이트는 서버 검증으로 별도 구현할 것. */
  window.mdtlIsPremium = function () {
    if (!window.mdtlLoggedIn()) return false;
    try {
      var raw = get(K_PLAN);
      if (!raw) return false;
      var p = JSON.parse(raw);
      if (p.plan !== 'premium') return false;
      return !p.expires || new Date(p.expires) > new Date();
    } catch (e) { return false; }
  };
  window.mdtlCachePlan = function (plan, expires) {
    set(K_PLAN, JSON.stringify({ plan: plan || 'free', expires: expires || null }));
  };
  window.mdtlClearAuthCache = function () { del(K_PLAN); };

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

  /* ── 여기부터는 벤더(assets/vendor/convex.js) 선로드가 필요한 회원 페이지 전용 ── */

  function client() {
    var c = cfg();
    if (!c || typeof MDTLConvexLib === 'undefined') return null;
    if (!window.__mdtlCx) {
      // .convex.site(HTTP action)와 .convex.cloud(함수 호출)는 다른 호스트다.
      window.__mdtlCx = new MDTLConvexLib.ConvexHttpClient(c.url.replace('.convex.site', '.convex.cloud'));
    }
    return window.__mdtlCx;
  }
  window.mdtlAuthClient = client;

  function storeTokens(tokens) {
    if (!tokens) { del(K_JWT); del(K_REFRESH); return false; }
    set(K_JWT, tokens.token);
    if (tokens.refreshToken) set(K_REFRESH, tokens.refreshToken);
    return true;
  }

  /* 유효한 액세스 토큰 확보. 만료 30초 전부터 리프레시 토큰으로 교환한다.
     갱신 요청이 겹치지 않도록 진행 중 Promise를 재사용한다(탭 하나 안에서의 경쟁 방지). */
  var refreshing = null;
  function accessToken() {
    var cx = client();
    if (!cx) return Promise.resolve(null);
    var jwt = get(K_JWT);
    if (jwt && jwtExp(jwt) - Date.now() > 30000) return Promise.resolve(jwt);
    var rt = get(K_REFRESH);
    if (!rt) return Promise.resolve(null);
    if (refreshing) return refreshing;
    refreshing = cx.action('auth:signIn', { refreshToken: rt })
      .then(function (r) {
        // 리프레시 토큰은 1회용이라, 교환에 실패하면 세션을 버리고 재로그인시킨다.
        if (!r || !r.tokens) { storeTokens(null); return null; }
        storeTokens(r.tokens);
        return r.tokens.token;
      })
      .catch(function () { storeTokens(null); return null; })
      .then(function (t) { refreshing = null; return t; });
    return refreshing;
  }
  window.mdtlAccessToken = accessToken;

  /* 인증이 붙은 호출. kind = 'query' | 'mutation' | 'action' */
  window.mdtlCall = function (kind, name, args) {
    var cx = client();
    if (!cx) return Promise.reject(new Error('auth-not-ready'));
    return accessToken().then(function (t) {
      if (t) cx.setAuth(t); else cx.clearAuth();
      return cx[kind](name, args || {});
    });
  };

  /* 비밀번호 정책 — convex/auth.ts의 validatePasswordRequirements와 같은 규칙을 클라이언트에도 둔다.
     이유는 UX다: Convex는 운영 환경에서 서버 예외 메시지를 감추므로(정보 노출 방지) 서버만 검사하면
     사용자는 "무엇이 잘못됐는지" 알 수 없다. 강제력은 서버에 있고, 여기 있는 건 안내용 사본이다.
     ⚠️ 규칙을 바꿀 땐 양쪽을 같이 고칠 것. */
  window.mdtlPasswordProblem = function (pw) {
    pw = String(pw || '');
    if (pw.length < 8) return 'short';
    if (pw.length > 128) return 'long';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'simple';
    return null;
  };

  /* 이메일+비밀번호. flow: 'signUp' | 'signIn' */
  window.mdtlSignInWithPassword = function (email, password, flow) {
    var cx = client();
    if (!cx) return Promise.reject(new Error('auth-not-ready'));
    cx.clearAuth();
    return cx.action('auth:signIn', {
      provider: 'password',
      params: { email: String(email || '').trim().toLowerCase(), password: password, flow: flow || 'signIn' },
    }).then(function (r) {
      if (!r || !r.tokens) throw new Error('no_tokens');
      storeTokens(r.tokens);
      return true;
    });
  };

  /* 구글 OAuth. 인가코드 교환은 서버(Convex)에서 일어나고, 브라우저는 verifier만 보관한다(PKCE). */
  window.mdtlSignInWithGoogle = function (redirectPath) {
    var cx = client();
    if (!cx) return Promise.reject(new Error('auth-not-ready'));
    cx.clearAuth();
    var back = location.origin + (window.MDTL_BASE || '') + (redirectPath || (lang() === 'ko' ? '/ko/account/' : '/account/'));
    return cx.action('auth:signIn', { provider: 'google', params: { redirectTo: back } })
      .then(function (r) {
        if (r && r.redirect) {
          set(K_VERIFIER, r.verifier);
          location.href = r.redirect;
          return true;
        }
        throw new Error('no_redirect');
      });
  };

  /* OAuth 복귀 처리 — URL의 ?code= 를 토큰으로 교환하고 주소창을 정리한다.
     교환 성공 여부를 Promise<boolean>으로 돌려준다(code가 없으면 false). */
  window.mdtlHandleOAuthReturn = function () {
    var code = null;
    try { code = new URLSearchParams(location.search).get('code'); } catch (e) {}
    if (!code) return Promise.resolve(false);
    var cx = client();
    if (!cx) return Promise.resolve(false);
    var verifier = get(K_VERIFIER) || undefined;
    del(K_VERIFIER);
    // 코드는 1회용이라 재시도/재실행으로 두 번 쓰이지 않도록 주소창에서 먼저 지운다.
    try {
      var u = new URL(location.href);
      u.searchParams.delete('code');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    cx.clearAuth();
    return cx.action('auth:signIn', { params: { code: code }, verifier: verifier })
      .then(function (r) { return storeTokens(r && r.tokens); })
      .catch(function () { return false; });
  };

  window.mdtlSignOut = function () {
    var cx = client();
    var done = function () {
      storeTokens(null);
      window.mdtlClearAuthCache();
      if (cx) cx.clearAuth();
    };
    if (!cx) { done(); return Promise.resolve(); }
    return accessToken()
      .then(function (t) { if (t) cx.setAuth(t); return cx.action('auth:signOut', {}); })
      .catch(function () { /* 이미 로그아웃 상태 등은 무시 */ })
      .then(done);
  };

  /* 로그인 직후/계정 페이지에서 서버 상태를 읽어 로컬 캐시를 갱신 */
  window.mdtlRefreshPlan = function () {
    return window.mdtlCall('query', 'account:me').then(function (me) {
      if (!me) { window.mdtlClearAuthCache(); return null; }
      window.mdtlCachePlan(me.plan, me.planExpiresAt ? new Date(me.planExpiresAt).toISOString() : null);
      return me;
    });
  };
})();
