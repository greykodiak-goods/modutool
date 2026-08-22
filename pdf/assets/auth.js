/* 회원 상태 레이어 — 모든 페이지에 로드(벤더 0, fetch + localStorage만, ~5KB).

   2026-08-22 Convex Auth → Supabase Auth 재이관 (docs/2026-08-22-tripod-supabase-편입검토.md).
   비밀번호 해싱·세션 회전·OAuth 코드교환은 전부 Supabase(GoTrue) 서버에 있고,
   여기 있는 건 "토큰을 어디에 두고 언제 갱신하느냐"는 저장/수명 관리와,
   기존 페이지 계약(window.mdtl*)을 그대로 유지하는 어댑터뿐이다.
   회원 페이지가 쓰던 Convex 함수명(mdtlCall 의 'account:me' 등)은 RPC_MAP 이
   Supabase RPC(tim_*)로 번역한다 — 페이지 코드는 이관 전후 동일.

   ⚠️ 4개 브랜드(/pdf /img /calc /video)가 한 오리진이라 세션은 브랜드 간 공유된다 — 의도된 동작
      (한 계정으로 네 사이트를 쓴다). 도메인을 분리하면 이 공유가 깨진다:
      docs/2026-07-26-namespace-plan.md 5-2 참조. */
(function () {
  'use strict';

  var K_JWT = 'mdtl-auth-jwt';
  var K_REFRESH = 'mdtl-auth-refresh';
  var K_VERIFIER = 'mdtl-auth-verifier';
  var K_PLAN = 'mdtl-plan';

  function cfg() {
    var c = window.MDTL_BACKEND;
    return c && c.url && c.key ? c : null;
  }
  function lang() { return (document.documentElement.lang || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko'; }
  function prefix() { return (window.MDTL_BASE || '') + (lang() === 'ko' ? '/ko' : ''); }

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* apikey 가 붙는 JSON 요청. 2xx 밖이면 body 를 담아 reject 한다. */
  function api(path, body, bearer) {
    var c = cfg();
    if (!c) return Promise.reject(new Error('auth-not-ready'));
    var headers = { 'Content-Type': 'application/json', apikey: c.key };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    return fetch(c.url.replace(/\/$/, '') + path, {
      method: 'POST', headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!res.ok) {
          var err = new Error((j && (j.error_code || j.msg || j.error_description || j.message)) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return j;
      });
    });
  }

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

  /* ── 여기부터는 회원 페이지 전용 ── */

  /* 과거엔 Convex 클라이언트 인스턴스를 돌려줬다. 페이지들은 truthy 여부만 본다
     ("백엔드 설정이 있어 회원 기능을 켤 수 있는가") — 설정 객체를 그대로 돌려준다. */
  window.mdtlAuthClient = cfg;

  function storeTokens(tokens) {
    if (!tokens) { del(K_JWT); del(K_REFRESH); return false; }
    set(K_JWT, tokens.token);
    if (tokens.refreshToken) set(K_REFRESH, tokens.refreshToken);
    return true;
  }
  function storeSession(j) {
    // GoTrue 응답({access_token, refresh_token}) → 내부 규약({token, refreshToken})
    if (!j || !j.access_token) return false;
    return storeTokens({ token: j.access_token, refreshToken: j.refresh_token });
  }

  /* 유효한 액세스 토큰 확보. 만료 30초 전부터 리프레시 토큰으로 교환한다.
     갱신 요청이 겹치지 않도록 진행 중 Promise를 재사용한다(탭 하나 안에서의 경쟁 방지). */
  var refreshing = null;
  function accessToken() {
    if (!cfg()) return Promise.resolve(null);
    var jwt = get(K_JWT);
    if (jwt && jwtExp(jwt) - Date.now() > 30000) return Promise.resolve(jwt);
    var rt = get(K_REFRESH);
    if (!rt) return Promise.resolve(null);
    if (refreshing) return refreshing;
    refreshing = api('/auth/v1/token?grant_type=refresh_token', { refresh_token: rt })
      .then(function (j) {
        // 리프레시 토큰은 회전(1회용)되므로, 교환에 실패하면 세션을 버리고 재로그인시킨다.
        if (!storeSession(j)) { storeTokens(null); return null; }
        return j.access_token;
      })
      .catch(function () { storeTokens(null); return null; })
      .then(function (t) { refreshing = null; return t; });
    return refreshing;
  }
  window.mdtlAccessToken = accessToken;

  /* 회원 페이지가 쓰던 Convex 함수명 → Supabase RPC(tim_*) 번역표.
     값은 [RPC 이름, 인자 변환]. 이름을 추가/변경하면 페이지와 이 표를 같이 고칠 것. */
  var RPC_MAP = {
    'account:ensureProfile': ['tim_ensure_profile', function () { return {}; }],
    'account:me': ['tim_me', function () { return {}; }],
    'account:deleteAccount': ['tim_delete_account', function (a) { return { p_confirm_email: (a && a.confirmEmail) || '' }; }],
    'dashboard:dashboard': ['tim_dashboard', function (a) { return { p_days: (a && a.days) || 30 }; }],
    'contact:list': ['tim_contact_list', function () { return {}; }],
    'contact:setHandled': ['tim_contact_set_handled', function (a) { return { p_id: Number(a && a.id), p_handled: !!(a && a.handled) }; }]
  };

  /* 인증이 붙은 호출. kind('query'|'mutation'|'action')는 Convex 시절 흔적 — 라우팅에는 안 쓴다. */
  window.mdtlCall = function (kind, name, args) {
    if (!cfg()) return Promise.reject(new Error('auth-not-ready'));
    if (name === 'account:signOutEverywhere') {
      // 모든 기기 로그아웃은 RPC 가 아니라 Auth 엔드포인트(scope=global)다.
      return accessToken().then(function (t) {
        if (!t) throw new Error('not_authenticated');
        return api('/auth/v1/logout?scope=global', {}, t);
      });
    }
    var m = RPC_MAP[name];
    if (!m) return Promise.reject(new Error('unknown-call: ' + name));
    return accessToken().then(function (t) {
      if (!t) throw new Error('not_authenticated');
      return api('/rest/v1/rpc/' + m[0], m[1](args), t);
    });
  };

  /* 비밀번호 정책 — 서버(Supabase 대시보드 정책)와 같은 규칙을 클라이언트에도 둔다.
     이유는 UX다: 서버 에러만으로는 "무엇이 잘못됐는지" 친절히 알려주기 어렵다.
     강제력은 서버에 있고, 여기 있는 건 안내용 사본이다. ⚠️ 규칙을 바꿀 땐 양쪽을 같이 고칠 것. */
  window.mdtlPasswordProblem = function (pw) {
    pw = String(pw || '');
    if (pw.length < 8) return 'short';
    if (pw.length > 128) return 'long';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'simple';
    return null;
  };

  /* 이메일+비밀번호. flow: 'signUp' | 'signIn' */
  window.mdtlSignInWithPassword = function (email, password, flow) {
    var em = String(email || '').trim().toLowerCase();
    var p = flow === 'signUp'
      ? api('/auth/v1/signup', { email: em, password: password })
      : api('/auth/v1/token?grant_type=password', { email: em, password: password });
    return p.then(function (j) {
      if (!storeSession(j)) {
        // 가입 응답에 세션이 없으면 이메일 확인(confirm) 설정이 켜져 있다는 뜻이다.
        throw new Error(j && j.user ? 'confirm_email_required' : 'no_tokens');
      }
      return true;
    });
  };

  /* 구글 OAuth (PKCE). 인가코드 교환은 서버에서 일어나고, 브라우저는 verifier만 보관한다.
     MDTL_BACKEND.google 이 false 면 공급자 미설정 상태 — 페이지의 .catch 가 안내문을 띄운다. */
  window.mdtlSignInWithGoogle = function (redirectPath) {
    var c = cfg();
    if (!c) return Promise.reject(new Error('auth-not-ready'));
    if (!c.google) return Promise.reject(new Error('google-disabled'));
    var back = location.origin + (window.MDTL_BASE || '') + (redirectPath || (lang() === 'ko' ? '/ko/account/' : '/account/'));
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    var verifier = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (buf) {
      var challenge = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      set(K_VERIFIER, verifier);
      location.href = c.url.replace(/\/$/, '') + '/auth/v1/authorize?provider=google'
        + '&redirect_to=' + encodeURIComponent(back)
        + '&code_challenge=' + challenge + '&code_challenge_method=s256';
      return true;
    });
  };

  /* OAuth 복귀 처리 — URL의 ?code= 를 토큰으로 교환하고 주소창을 정리한다.
     교환 성공 여부를 Promise<boolean>으로 돌려준다(code가 없으면 false). */
  window.mdtlHandleOAuthReturn = function () {
    var code = null;
    try { code = new URLSearchParams(location.search).get('code'); } catch (e) {}
    if (!code || !cfg()) return Promise.resolve(false);
    var verifier = get(K_VERIFIER) || '';
    del(K_VERIFIER);
    // 코드는 1회용이라 재시도/재실행으로 두 번 쓰이지 않도록 주소창에서 먼저 지운다.
    try {
      var u = new URL(location.href);
      u.searchParams.delete('code');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    return api('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier })
      .then(storeSession)
      .catch(function () { return false; });
  };

  window.mdtlSignOut = function () {
    var done = function () {
      storeTokens(null);
      window.mdtlClearAuthCache();
    };
    if (!cfg()) { done(); return Promise.resolve(); }
    return accessToken()
      .then(function (t) { if (t) return api('/auth/v1/logout', {}, t); })
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
