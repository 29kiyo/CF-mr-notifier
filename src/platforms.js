import { http, memo, cleanChangelog } from './util.js';

const MR = 'https://api.modrinth.com/v2';
const CF = 'https://api.curseforge.com/v1';
const GH = 'https://api.github.com';
const enc = encodeURIComponent;

export const PROJECT_TYPES = ['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'plugin'];
const CF_CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945, plugin: 5 };
const CF_CLASS_REV = Object.fromEntries(Object.entries(CF_CLASS).map(([k, v]) => [v, k]));
const PLUGIN_LOADERS = ['bukkit', 'spigot', 'paper', 'purpur', 'folia', 'velocity', 'bungeecord', 'waterfall', 'sponge'];
const LOADER_RE = /^(fabric|forge|neoforge|quilt|liteloader|rift|cauldron)$/i;

/* ------------------------------------------------------------------ */
/* Modrinth                                                            */
/* ------------------------------------------------------------------ */
function mrInfo(p) {
  return {
    platform: 'modrinth',
    id: p.id,
    slug: p.slug,
    name: p.title,
    description: p.description,
    iconUrl: p.icon_url || null,
    downloads: p.downloads ?? null,
    projectType: p.project_type,
    url: `https://modrinth.com/project/${p.slug}`,
  };
}

async function mrSearch(q, type) {
  const facets = [];
  if (type === 'datapack') facets.push(['categories:datapack']);
  else if (type === 'plugin') facets.push(PLUGIN_LOADERS.map((l) => `categories:${l}`));
  else if (PROJECT_TYPES.includes(type)) facets.push([`project_type:${type}`]);
  const url =
    `${MR}/search?query=${enc(q || '')}&limit=10&index=${q ? 'relevance' : 'downloads'}` +
    (facets.length ? `&facets=${enc(JSON.stringify(facets))}` : '');
  const r = await http(url);
  return r.hits.map((h) => ({
    platform: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    name: h.title,
    description: h.description,
    iconUrl: h.icon_url || null,
    downloads: h.downloads,
    projectType: h.project_type,
    author: h.author,
    url: `https://modrinth.com/project/${h.slug}`,
  }));
}

async function mrFetchInfo(id) {
  return mrInfo(await http(`${MR}/project/${enc(id)}`));
}

function mrRelease(v, info) {
  return {
    platform: 'modrinth',
    versionId: v.id,
    versionNumber: v.version_number,
    name: v.name || v.version_number,
    changelog: v.changelog || '',
    versionType: v.version_type, // release / beta / alpha
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    rawDeps: (v.dependencies || []).map((d) => ({ id: d.project_id, type: d.dependency_type })),
    dependencies: [],
    downloads: v.downloads ?? null,
    publishedAt: v.date_published,
    url: `https://modrinth.com/project/${info.slug}/version/${v.id}`,
    info,
  };
}

async function mrRecent(id) {
  const p = await http(`${MR}/project/${enc(id)}`);
  const info = mrInfo(p);
  const ids = [...(p.versions || [])];
  // 並び順が古い順/新しい順のどちらでも新しいものを拾えるよう両端を候補にする
  const candidates = [...new Set([...ids.slice(-6), ...ids.slice(0, 4)])];
  return {
    info,
    ids,
    candidates,
    load: async (want) => {
      if (!want.length) return [];
      const vs = await http(`${MR}/versions?ids=${enc(JSON.stringify(want))}`);
      return vs.map((v) => mrRelease(v, info));
    },
  };
}

async function mrHydrate(rel) {
  const ids = [...new Set(rel.rawDeps.filter((d) => d.id).map((d) => d.id))];
  const byId = {};
  if (ids.length) {
    try {
      const ps = await http(`${MR}/projects?ids=${enc(JSON.stringify(ids))}`);
      for (const p of ps) byId[p.id] = p;
    } catch {
      /* 依存関係の名前が取れなくても通知は続ける */
    }
  }
  rel.dependencies = rel.rawDeps
    .filter((d) => d.id)
    .map((d) => ({
      type: d.type,
      name: byId[d.id]?.title || d.id,
      url: byId[d.id] ? `https://modrinth.com/project/${byId[d.id].slug}` : null,
    }));
}

/* ------------------------------------------------------------------ */
/* CurseForge                                                          */
/* ------------------------------------------------------------------ */
function cfHeaders() {
  if (!process.env.CURSEFORGE_API_KEY) {
    const e = new Error('CurseForgeのAPIキーが未設定です(Renderの環境変数 CURSEFORGE_API_KEY)');
    e.expose = true;
    e.status = 503;
    throw e;
  }
  return { 'x-api-key': process.env.CURSEFORGE_API_KEY };
}
const cf = (path, opts = {}) => http(`${CF}${path}`, { ...opts, headers: cfHeaders() });

function cfInfo(m) {
  return {
    platform: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    name: m.name,
    description: m.summary,
    iconUrl: m.logo?.thumbnailUrl || m.logo?.url || null,
    downloads: m.downloadCount ?? null,
    projectType: CF_CLASS_REV[m.classId] || 'mod',
    url: m.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
  };
}

async function cfSearch(q, type) {
  const classId = CF_CLASS[type] ?? CF_CLASS.mod;
  const r = await cf(
    `/mods/search?gameId=432&classId=${classId}&searchFilter=${enc(q || '')}&sortField=2&sortOrder=desc&pageSize=10`,
  );
  return r.data.map(cfInfo);
}

async function cfFetchInfo(id) {
  const r = await cf(`/mods/${enc(id)}`);
  return cfInfo(r.data);
}

const CF_RELEASE_TYPE = { 1: 'release', 2: 'beta', 3: 'alpha' };
const CF_REL = { 1: 'embedded', 2: 'optional', 3: 'required', 4: 'tool', 5: 'incompatible', 6: 'embedded' };

function cfVersionNumber(f) {
  const re = /\d+(?:\.\d+)+[\w.+-]*/;
  const m =
    (f.displayName || '').match(re) || (f.fileName || '').replace(/\.(jar|zip)$/i, '').match(re);
  return m ? m[0] : f.displayName || f.fileName || String(f.id);
}

function cfRelease(f, info) {
  const gv = f.gameVersions || [];
  return {
    platform: 'curseforge',
    versionId: String(f.id),
    versionNumber: cfVersionNumber(f),
    name: f.displayName || f.fileName,
    changelog: '',
    versionType: CF_RELEASE_TYPE[f.releaseType] || 'release',
    gameVersions: gv.filter((x) => /^\d/.test(x)),
    loaders: gv.filter((x) => LOADER_RE.test(x)).map((x) => x.toLowerCase()),
    rawDeps: (f.dependencies || []).map((d) => ({ id: String(d.modId), type: CF_REL[d.relationType] || 'optional' })),
    dependencies: [],
    downloads: f.downloadCount ?? null,
    publishedAt: f.fileDate,
    url: `${info.url}/files/${f.id}`,
    info,
  };
}

async function cfRecent(id) {
  const [mod, files] = await Promise.all([cf(`/mods/${enc(id)}`), cf(`/mods/${enc(id)}/files?pageSize=20`)]);
  const info = cfInfo(mod.data);
  // 並び順が保証されないので「ファイル一覧」と「最新ファイル」を合わせて新しい順に並べ直す
  const map = new Map();
  for (const f of [...(files.data || []), ...(mod.data.latestFiles || [])]) map.set(String(f.id), f);
  const all = [...map.values()].sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
  const ids = all.map((f) => String(f.id));
  return {
    info,
    ids,
    candidates: ids.slice(0, 8),
    load: async (want) => {
      const set = new Set(want);
      return all.filter((f) => set.has(String(f.id))).map((f) => cfRelease(f, info));
    },
  };
}

async function cfHydrate(rel) {
  try {
    const r = await cf(`/mods/${rel.info.id}/files/${rel.versionId}/changelog`);
    rel.changelog = cleanChangelog(r.data || '');
  } catch {
    /* チェンジログが取れなくても通知は続ける */
  }
  const ids = [...new Set(rel.rawDeps.map((d) => d.id))];
  if (!ids.length) return;
  try {
    const r = await cf('/mods', { method: 'POST', body: { modIds: ids.map(Number) } });
    const byId = Object.fromEntries((r.data || []).map((m) => [String(m.id), m]));
    rel.dependencies = rel.rawDeps.map((d) => ({
      type: d.type,
      name: byId[d.id]?.name || d.id,
      url: byId[d.id]?.links?.websiteUrl || null,
    }));
  } catch {
    rel.dependencies = rel.rawDeps.map((d) => ({ type: d.type, name: d.id, url: null }));
  }
}

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */
const ghGet = (path) =>
  http(`${GH}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });

function parseRepo(s) {
  const m = String(s).trim().match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

function ghInfo(r) {
  return {
    platform: 'github',
    id: r.full_name,
    slug: r.full_name,
    name: r.name,
    description: r.description,
    iconUrl: r.owner?.avatar_url || null,
    downloads: null,
    stars: r.stargazers_count,
    projectType: 'github',
    url: r.html_url,
  };
}

async function ghSearch(q) {
  if (!q) return [];
  const direct = /^[\w.-]+\/[\w.-]+$/.test(q.trim()) || /github\.com\//i.test(q) ? parseRepo(q) : null;
  if (direct) {
    try {
      return [ghInfo(await ghGet(`/repos/${direct}`))];
    } catch {
      /* 見つからなければ通常検索へ */
    }
  }
  const r = await ghGet(`/search/repositories?q=${enc(q)}&per_page=10`);
  return r.items.map(ghInfo);
}

async function ghFetchInfo(id) {
  const repo = parseRepo(id);
  if (!repo) {
    const e = new Error('GitHubのリポジトリは「owner/repo」の形式で指定してください');
    e.expose = true;
    e.status = 400;
    throw e;
  }
  return memo(`gh:${repo}`, 30 * 60 * 1000, async () => {
    try {
      return ghInfo(await ghGet(`/repos/${repo}`));
    } catch (e) {
      if (e.status !== 404 && e.status !== 403) throw e;
      return { platform: 'github', id: repo, slug: repo, name: repo.split('/')[1], description: null, iconUrl: `https://github.com/${repo.split('/')[0]}.png`, downloads: null, projectType: 'github', url: `https://github.com/${repo}` };
    }
  });
}

function ghRelease(r, info) {
  return {
    platform: 'github',
    versionId: String(r.id),
    versionNumber: r.tag_name,
    name: r.name || r.tag_name,
    changelog: r.body || '',
    versionType: r.prerelease ? 'beta' : 'release',
    gameVersions: [],
    loaders: [],
    rawDeps: [],
    dependencies: [],
    downloads: (r.assets || []).reduce((n, a) => n + (a.download_count || 0), 0),
    publishedAt: r.published_at || r.created_at,
    url: r.html_url,
    info,
  };
}

async function ghRecent(id) {
  const repo = parseRepo(id);
  const info = await ghFetchInfo(repo);
  const rels = (await ghGet(`/repos/${repo}/releases?per_page=15`)).filter((r) => !r.draft);
  const ids = rels.map((r) => String(r.id));
  return {
    info,
    ids,
    candidates: ids.slice(0, 5),
    load: async (want) => {
      const set = new Set(want);
      return rels.filter((r) => set.has(String(r.id))).map((r) => ghRelease(r, info));
    },
  };
}

/* ------------------------------------------------------------------ */
export const platforms = {
  modrinth: { search: mrSearch, fetchInfo: mrFetchInfo, fetchRecent: mrRecent, hydrate: mrHydrate },
  curseforge: { search: cfSearch, fetchInfo: cfFetchInfo, fetchRecent: cfRecent, hydrate: cfHydrate },
  github: { search: ghSearch, fetchInfo: ghFetchInfo, fetchRecent: ghRecent, hydrate: async () => {} },
};

// ダッシュボードの「候補」用: 対応バージョン一覧・ローダー一覧(Modrinthから取得)
export function getOptions() {
  return memo('options', 60 * 60 * 1000, async () => {
    const [gv, ld] = await Promise.all([http(`${MR}/tag/game_version`), http(`${MR}/tag/loader`)]);
    return {
      gameVersions: gv.filter((v) => v.version_type === 'release').map((v) => v.version),
      snapshots: gv.filter((v) => v.version_type !== 'release').slice(0, 30).map((v) => v.version),
      loaders: ld.map((l) => ({ name: l.name, projectTypes: l.supported_project_types })),
      versionTypes: ['release', 'beta', 'alpha'],
      projectTypes: PROJECT_TYPES,
    };
  });
}


// 定期チェック(ポーリング)する通知元か?
// GitHubは通常Webhookで受け取る。config.mode が 'release' のときだけ従来どおりリリースを定期チェックする。
export const isPolledSource = (s) => s.platform !== 'github' || s.config?.mode === 'release';

// 「最新の情報を送る」用: GitHubのWebhook型の通知元から、最新のリリースと最新のコミットを取得してWebhook形式にそろえる
export async function ghLatestPayloads(repoId, events = []) {
  const repo = parseRepo(repoId);
  const out = [];
  const info = await ghFetchInfo(repo);
  const repository = { full_name: repo, name: repo.split('/')[1], html_url: info.url, stargazers_count: info.stars };
  const fallback = !events.includes('push') && !events.includes('release');
  if (events.includes('release') || fallback) {
    const rels = (await ghGet(`/repos/${repo}/releases?per_page=3`)).filter((r) => !r.draft);
    if (rels[0]) out.push({ event: 'release', payload: { action: 'published', release: rels[0], repository, sender: rels[0].author } });
  }
  if (events.includes('push') || fallback) {
    const data = await ghGet(`/repos/${repo}`);
    const branch = data.default_branch || 'main';
    const cs = await ghGet(`/repos/${repo}/commits?sha=${enc(branch)}&per_page=3`);
    if (cs.length) {
      out.push({
        event: 'push',
        payload: {
          ref: `refs/heads/${branch}`,
          compare: `${info.url}/commits/${branch}`,
          commits: [...cs].reverse().map((c) => ({ id: c.sha, url: c.html_url, message: c.commit?.message || '', author: { username: c.author?.login, name: c.commit?.author?.name } })),
          repository,
          sender: cs[0].author,
        },
      });
    }
  }
  return out;
}