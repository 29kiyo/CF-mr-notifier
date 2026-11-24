import { useSyncExternalStore, useEffect, useState, useCallback } from 'react';

// ボットのAPIの場所(変えたい場合はここだけ)
export const API_BASE = 'https://cf-mr-notifier.onrender.com';

const TOKEN_KEY = 'notifier.token';
const LAST_GUILD_KEY = 'notifier.lastGuild';

/* ---------- 小さなストア(ログイン状態 / 起動待ち表示) ---------- */
let version = 0;
let waking = 0;
let authMessage = null;
const subs = new Set();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
export const useStore = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const isWaking = () => waking > 0;
export const getAuthMessage = () => authMessage;
export function setToken(t, message = null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
  authMessage = message;
  emit();
}
export const getLastGuild = () => localStorage.getItem(LAST_GUILD_KEY);
export const setLastGuild = (id) => localStorage.setItem(LAST_GUILD_KEY, id);

const LOGIN_ERRORS = {
  access_denied: 'ログインがキャンセルされました。もう一度お試しください。',
  login_failed: 'ログインに失敗しました。少し時間をおいてもう一度お試しください。',
};

// ログイン後に戻ってきたとき URL の #token=... を受け取る
export function consumeAuthHash() {
  const h = location.hash;
  if (!h.startsWith('#token=') && !h.startsWith('#error=')) return;
  const p = new URLSearchParams(h.slice(1));
  if (p.get('token')) setToken(p.get('token'));
  else authMessage = LOGIN_ERRORS[p.get('error')] || LOGIN_ERRORS.login_failed;
  history.replaceState(null, '', location.pathname + location.search + '#/');
}

export function startLogin() {
  const ret = encodeURIComponent(location.origin + location.pathname);
  location.href = `${API_BASE}/auth/login?return=${ret}`;
}

/* ---------- API呼び出し(無料サーバーの起動待ちを自動でリトライ) ---------- */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export const errorMessage = (e) => (e && e.message) || 'エラーが発生しました';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONNECT_FAILED = 'ボットに接続できませんでした。しばらくしてからもう一度お試しください。';

export async function api(path, { method = 'GET', body, timeoutMs = 90000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let slowShown = false;
  const slowTimer = setTimeout(() => {
    slowShown = true;
    waking++;
    emit();
  }, 2500);
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ApiError(CONNECT_FAILED, 0);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), remaining);
      const headers = { Accept: 'application/json' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let res;
      try {
        res = await fetch(API_BASE + path, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
      } catch {
        clearTimeout(t);
        if (deadline - Date.now() > 3000) {
          await sleep(3000);
          continue;
        }
        throw new ApiError(CONNECT_FAILED, 0);
      }
      clearTimeout(t);
      if ([502, 503, 504].includes(res.status) && deadline - Date.now() > 3000) {
        await sleep(3000);
        continue;
      }
      if (res.status === 401) {
        const msg = 'ログインの有効期限が切れました。もう一度ログインしてください。';
        setToken(null, msg);
        throw new ApiError(msg, 401);
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* 本文なし */
      }
      if (!res.ok) throw new ApiError((data && data.error) || `エラーが発生しました (${res.status})`, res.status);
      return data;
    }
  } finally {
    clearTimeout(slowTimer);
    if (slowShown) {
      waking = Math.max(0, waking - 1);
      emit();
    }
  }
}

/* ---------- データ取得フック ---------- */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => !dead && setState({ loading: false, data, error: null }))
      .catch((error) => !dead && setState({ loading: false, data: null, error }));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ---------- ルーティング(#/ 形式。GitHub Pagesで更新しても404にならない) ---------- */
export const go = (path) => {
  location.hash = '#' + path;
};
export function parseRoute(hash) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'servers' && p[1]) {
    if (p[2] === 'new') return { page: 'editor', gid: p[1] };
    if (p[2] === 'edit' && p[3]) return { page: 'editor', gid: p[1], pid: p[3] };
    return { page: 'server', gid: p[1] };
  }
  return { page: 'home' };
}
export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return parseRoute(hash);
}
