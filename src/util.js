export const UA = 'CF-mr-notifier/1.0 (+https://github.com/29kiyo/CF-mr-notifier)';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function http(url, { method = 'GET', headers = {}, body, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} (${new URL(url).host})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

const cache = new Map();
export async function memo(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  return val;
}

// チェンジログ(Markdown/HTML)をDiscordの埋め込みに入れやすい形に整える
export function cleanChangelog(text = '') {
  return String(text)
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(s, n) {
  s = String(s ?? '');
  if (n <= 0) return '';
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

function hslToInt(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

// プロジェクト名から安定した色を作る(色を指定しなかった場合の初期値)
export function colorFromString(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return hslToInt(h % 360, 0.65, 0.55);
}

// ゲームバージョンの指定(例: "1.21.4" / "1.21.*")に一致するか
export function matchVersion(v, g) {
  if (g.endsWith('.*')) return v === g.slice(0, -2) || v.startsWith(g.slice(0, -1));
  return v === g;
}
// 作品(通知元)ごとの個別指定があればそれを使い、なければプロジェクト全体の絞り込みを使う
export function effectiveFilters(project, sourceId) {
  const base = project.filters || {};
  const own = (project.sources || []).find((s) => s.id === sourceId)?.config?.filters || {};
  return {
    ...base,
    loaders: own.loaders?.length ? own.loaders : base.loaders || [],
    game_versions: own.game_versions?.length ? own.game_versions : base.game_versions || [],
  };
}
