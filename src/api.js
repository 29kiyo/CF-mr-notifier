import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import * as db from './db.js';
import { platforms, getOptions, PROJECT_TYPES, isPolledSource, ghLatestPayloads } from './platforms.js';
import { guildMeta, searchMembers, resolveMembers, sendToChannel, explainSendError, botInGuild, inviteUrl } from './bot.js';
import { requireAuth, requireGuild } from './auth.js';
import { DEFAULT_DISPLAY, LINK_KINDS, buildMessage } from './embed.js';
import { GH_EVENTS, DEFAULT_GH_EVENTS, buildGithubMessage, samplePayload } from './github-events.js';
import { processProject, primeSource, groupReleases, sameVersion } from './poller.js';
import { colorFromString } from './util.js';
import { publicUrl } from './config.js';

const SNOW = /^\d{15,25}$/;
const MAX_PROJECTS_PER_GUILD = 30;
const MAX_SOURCES = 6;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status, expose: true });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ログインしている人ごとの回数制限(検索・変更・Discordへの送信の連打を防ぐ)
const byUser = (max, windowMs, message) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.sub || 'anonymous'),
    message: { error: message },
  });
const searchLimit = byUser(40, 60_000, '検索が多すぎます。少し待ってからお試しください');
const writeLimit = byUser(60, 60_000, '操作が多すぎます。少し待ってからお試しください');
const sendLimit = byUser(10, 60_000, 'メッセージの送信が多すぎます。1分ほど待ってからお試しください');

function strArr(a, max, maxLen, re) {
  if (!Array.isArray(a)) return [];
  const out = [];
  for (const x of a) {
    const s = String(x).trim();
    if (!s || s.length > maxLen || (re && !re.test(s)) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseColor(c, fallbackName) {
  if (typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim())) return parseInt(c.trim().replace('#', ''), 16);
  if (Number.isInteger(c)) return clamp(c, 0, 0xffffff);
  return colorFromString(fallbackName);
}

function cleanInput(b, meta, partial = false) {
  const out = {};
  const has = (k) => !partial || b[k] !== undefined;

  if (has('name')) {
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) throw bad('プロジェクト名を入力してください');
    out.name = name;
  }
  if (has('channel_id')) {
    if (!SNOW.test(String(b.channel_id || ''))) throw bad('通知チャンネルを選んでください');
    if (!meta.channels.some((c) => c.id === b.channel_id)) throw bad('そのチャンネルは見つかりません');
    out.channel_id = b.channel_id;
  }
  if (has('color')) out.color = parseColor(b.color, out.name || 'project');
  if (has('enabled')) out.enabled = b.enabled !== false;
  if (has('merge_platforms')) out.merge_platforms = b.merge_platforms !== false;
  if (has('merge_variants')) out.merge_variants = b.merge_variants !== false;
  if (has('merge_wait_minutes')) out.merge_wait_minutes = clamp(parseInt(b.merge_wait_minutes ?? 15, 10) || 0, 0, 120);
  if (has('mention_everyone')) out.mention_everyone = b.mention_everyone === true;
  if (has('mention_here')) out.mention_here = b.mention_here === true;
  if (has('mention_role_ids')) {
    out.mention_role_ids = strArr(b.mention_role_ids, 10, 25, SNOW).filter((id) => meta.roles.some((r) => r.id === id));
  }
  if (has('mention_user_ids')) out.mention_user_ids = strArr(b.mention_user_ids, 10, 25, SNOW);
  if (has('filters')) {
    const f = b.filters || {};
    out.filters = {
      game_versions: strArr(f.game_versions, 60, 40),
      loaders: strArr(f.loaders, 20, 40),
      version_types: strArr(f.version_types, 3).filter((t) => ['release', 'beta', 'alpha'].includes(t)),
    };
  }
  if (has('display')) {
    const d = b.display || {};
    const disp = { language: d.language === 'en' ? 'en' : 'ja' };
    for (const k of Object.keys(DEFAULT_DISPLAY)) {
      if (k === 'language' || k === 'changelog_max_chars' || k === 'project_link_kinds') continue;
      disp[k] = d[k] === undefined ? DEFAULT_DISPLAY[k] : !!d[k];
    }
    const mc = parseInt(d.changelog_max_chars ?? DEFAULT_DISPLAY.changelog_max_chars, 10);
    disp.changelog_max_chars = clamp(Number.isNaN(mc) ? DEFAULT_DISPLAY.changelog_max_chars : mc, 0, 3500);
    disp.project_link_kinds = d.project_link_kinds === undefined ? [...LINK_KINDS] : strArr(d.project_link_kinds, 10, 20).filter((k) => LINK_KINDS.includes(k));
    out.display = disp;
  }
  return out;
}

// 通知元ごとの設定。GitHubは mode で「Webhook(できごと通知)」と「release(従来のバージョン通知)」を切り替える。
function cleanSourceConfig(platform, raw) {
  if (platform !== 'github') return {};
  const events = strArr(raw?.events, 20, 30).filter((e) => GH_EVENTS.includes(e));
  return {
    mode: raw?.mode === 'release' ? 'release' : 'webhook',
    events: events.length ? events : [...DEFAULT_GH_EVENTS],
    branches: strArr(raw?.branches, 20, 100),
  };
}

async function resolveSource(s) {
  if (!s || !platforms[s.platform]) throw bad('不明なプラットフォームです');
  const id = String(s.external_id || '').trim();
  if (!id || id.length > 200) throw bad('プロジェクトIDが正しくありません');
  try {
    const info = await platforms[s.platform].fetchInfo(id);
    const config = cleanSourceConfig(s.platform, s.config);
    if (s.platform === 'github') config.webhook_secret = crypto.randomBytes(24).toString('hex');
    return { platform: s.platform, external_id: info.id, display_name: info.name, icon_url: info.iconUrl, project_type: info.projectType, config };
  } catch (e) {
    if (e.expose) throw e;
    throw bad(`${s.platform} でプロジェクトが見つかりません(${id})`);
  }
}

async function ownedProject(gid, pid) {
  const p = await db.getProject(pid);
  if (!p || p.guild_id !== gid) throw bad('プロジェクトが見つかりません', 404);
  return p;
}

function publicSource(s) {
  const out = {
    id: s.id,
    platform: s.platform,
    external_id: s.external_id,
    display_name: s.display_name,
    icon_url: s.icon_url,
    project_type: s.project_type,
    last_checked_at: s.last_checked_at,
    last_error: s.last_error,
  };
  if (s.platform === 'github') {
    out.config = { mode: s.config?.mode === 'release' ? 'release' : 'webhook', events: s.config?.events || [...DEFAULT_GH_EVENTS], branches: s.config?.branches || [] };
    out.webhook = { url: `${publicUrl()}/webhooks/github/${s.id}`, secret: s.config?.webhook_secret || null };
  }
  return out;
}

function publicProject(p) {
  return {
    id: p.id,
    guild_id: p.guild_id,
    name: p.name,
    channel_id: p.channel_id,
    color: p.color,
    color_hex: '#' + p.color.toString(16).padStart(6, '0'),
    enabled: p.enabled,
    merge_platforms: p.merge_platforms,
    merge_wait_minutes: p.merge_wait_minutes,
    merge_variants: p.merge_variants !== false,
    mention_everyone: !!p.mention_everyone,
    mention_here: !!p.mention_here,
    mention_role_ids: p.mention_role_ids,
    mention_user_ids: p.mention_user_ids,
    filters: { game_versions: [], loaders: [], version_types: [], ...(p.filters || {}) },
    display: { ...DEFAULT_DISPLAY, ...(p.display || {}) },
    last_sent_at: p.last_sent_at,
    last_error: p.last_error,
    created_at: p.created_at,
    sources: (p.sources || []).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(publicSource),
  };
}

// 定期チェック型の通知元から、それぞれの最新バージョンを取る(同時に公開された別ローダー・別ファイルも含める)
async function newestReleases(p) {
  const out = [];
  for (const s of p.sources.filter(isPolledSource)) {
    try {
      const { candidates, load } = await platforms[s.platform].fetchRecent(s.external_id);
      const rels = await load(candidates);
      rels.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      if (!rels[0]) continue;
      out.push(rels[0]);
      if (p.merge_variants !== false) {
        for (const r of rels.slice(1)) {
          if (sameVersion(rels[0], r, true) && Math.abs(new Date(rels[0].publishedAt) - new Date(r.publishedAt)) <= 3 * 3600e3) out.push(r);
        }
      }
    } catch (e) {
      throw bad(`${s.platform} から取得できませんでした: ${e.message}`, 502);
    }
  }
  return out;
}

async function buildPolledMessages(project, releases, opts) {
  const groups = groupReleases(releases, { crossPlatform: !!project.merge_platforms, variants: project.merge_variants !== false });
  const out = [];
  for (const g of groups) {
    for (const r of g) await platforms[r.platform].hydrate(r);
    out.push(buildMessage(project, g, opts));
  }
  return out;
}

async function deliver(project, messages) {
  if (!messages.length) throw bad('送信できる内容がありません');
  try {
    for (const m of messages) await sendToChannel(project.channel_id, m);
  } catch (e) {
    throw bad(explainSendError(e), 502);
  }
}

export const apiRouter = express.Router();
apiRouter.use(express.json({ limit: '100kb' }));
apiRouter.use(requireAuth);

apiRouter.get('/me', (req, res) => {
  const guilds = req.user.guilds
    .map((g) => ({
      id: g.id,
      name: g.name,
      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
      botInGuild: botInGuild(g.id),
      inviteUrl: botInGuild(g.id) ? null : inviteUrl(g.id),
    }))
    .sort((a, b) => Number(b.botInGuild) - Number(a.botInGuild));
  res.json({ user: { id: req.user.sub, name: req.user.name, avatarUrl: req.user.avatar }, guilds });
});

// 絞り込み・検索用の候補(対応バージョン / ローダー / 種類 / GitHubのイベント)
apiRouter.get(
  '/options',
  wrap(async (req, res) => {
    res.json({
      ...(await getOptions()),
      githubEvents: GH_EVENTS,
      defaults: { display: DEFAULT_DISPLAY, merge_wait_minutes: 15, githubEvents: DEFAULT_GH_EVENTS },
    });
  }),
);

apiRouter.get(
  '/search',
  searchLimit,
  wrap(async (req, res) => {
    const platform = String(req.query.platform || '');
    const type = PROJECT_TYPES.includes(String(req.query.type)) ? String(req.query.type) : 'mod';
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (!platforms[platform]) throw bad('不明なプラットフォームです');
    try {
      res.json({ results: await platforms[platform].search(q, type) });
    } catch (e) {
      if (e.expose) throw e;
      throw bad('検索に失敗しました。少し待ってからもう一度お試しください', 502);
    }
  }),
);

// 追加した作品(Modrinth / CurseForge)が対応しているローダー・ゲームバージョンの一覧(絞り込みの候補用)
apiRouter.post(
  '/sources/options',
  searchLimit,
  wrap(async (req, res) => {
    const list = (Array.isArray(req.body?.sources) ? req.body.sources : []).slice(0, MAX_SOURCES);
    const loaders = new Set();
    const versions = new Set();
    let known = 0;
    await Promise.all(
      list.map(async (s) => {
        if (!s || !['modrinth', 'curseforge'].includes(s.platform)) return;
        const id = String(s.external_id || '').slice(0, 200);
        if (!id) return;
        try {
          const o = await platforms[s.platform].fetchOptions(id);
          known++;
          o.loaders.forEach((l) => loaders.add(String(l).toLowerCase()));
          o.gameVersions.forEach((v) => versions.add(String(v)));
        } catch {
          /* 取得できなかった作品は無視する */
        }
      }),
    );
    const all = await getOptions();
    const order = new Map([...all.gameVersions, ...all.snapshots].map((v, i) => [v, i]));
    const gameVersions = [...versions].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || b.localeCompare(a));
    res.json({ known: known > 0, loaders: [...loaders], gameVersions });
  }),
);

const guild = express.Router({ mergeParams: true });
apiRouter.use('/guilds/:gid', requireGuild, guild);

// 変更系の操作は回数を制限し、誰が何をしたか記録する(内容は記録しない)
guild.use((req, res, next) => {
  if (req.method === 'GET') return next();
  console.log(`[audit] user=${req.user.sub} ${req.method} ${req.originalUrl.split('?')[0]}`);
  writeLimit(req, res, next);
});

guild.get(
  '/meta',
  wrap(async (req, res) => res.json(await guildMeta(req.params.gid))),
);

guild.get(
  '/members/resolve',
  wrap(async (req, res) => {
    const ids = strArr(String(req.query.ids || '').split(','), 10, 25, SNOW);
    res.json({ members: await resolveMembers(req.params.gid, ids) });
  }),
);

guild.get(
  '/members',
  searchLimit,
  wrap(async (req, res) => {
    try {
      res.json({ members: await searchMembers(req.params.gid, String(req.query.q || '').slice(0, 50)) });
    } catch {
      throw bad('メンバー検索に失敗しました(Developer Portalで「Server Members Intent」をONにしてください)。ユーザーIDの直接入力は使えます', 502);
    }
  }),
);

guild.get(
  '/projects',
  wrap(async (req, res) => res.json({ projects: (await db.listProjects(req.params.gid)).map(publicProject) })),
);

guild.post(
  '/projects',
  wrap(async (req, res) => {
    const gid = req.params.gid;
    if ((await db.countProjects(gid)) >= MAX_PROJECTS_PER_GUILD) throw bad(`1サーバーにつき${MAX_PROJECTS_PER_GUILD}件までです`);
    const meta = await guildMeta(gid);
    const input = cleanInput(req.body || {}, meta);
    const list = Array.isArray(req.body?.sources) ? req.body.sources : [];
    if (!list.length) throw bad('通知元(Modrinth / CurseForge / GitHub)を1つ以上選んでください');
    if (list.length > MAX_SOURCES) throw bad(`通知元は${MAX_SOURCES}件までです`);
    const resolved = [];
    for (const s of list) {
      const r = await resolveSource(s);
      if (!resolved.some((x) => x.platform === r.platform && x.external_id === r.external_id)) resolved.push(r);
    }
    const p = await db.createProject({ guild_id: gid, created_by: req.user.sub, ...input });
    for (const r of resolved) {
      const polled = isPolledSource(r);
      const row = await db.addSource({ project_id: p.id, ...r, primed: !polled });
      if (polled) await primeSource(row).catch(() => {});
    }
    res.json({ project: publicProject(await db.getProject(p.id)) });
  }),
);

guild.put(
  '/projects/:pid',
  wrap(async (req, res) => {
    const gid = req.params.gid;
    const p = await ownedProject(gid, req.params.pid);
    const meta = await guildMeta(gid);
    const input = cleanInput(req.body || {}, meta, true);

    if (Array.isArray(req.body?.sources)) {
      const list = req.body.sources;
      if (!list.length) throw bad('通知元を1つ以上選んでください');
      if (list.length > MAX_SOURCES) throw bad(`通知元は${MAX_SOURCES}件までです`);
      const keep = new Set();
      for (const s of list) {
        const existing = p.sources.find((x) => x.platform === s.platform && x.external_id === String(s.external_id));
        if (existing) {
          keep.add(existing.id);
          if (existing.platform === 'github' && s.config) {
            const nc = cleanSourceConfig('github', s.config);
            const patch = { config: { ...(existing.config || {}), ...nc } };
            // Webhook型 → 従来のリリース通知に切り替えたときは、過去のリリースを一度に通知しないよう「既読」から始め直す
            if (nc.mode === 'release' && existing.config?.mode !== 'release') patch.primed = false;
            await db.updateSource(existing.id, patch);
          }
          continue;
        }
        const r = await resolveSource(s);
        const dup = p.sources.find((x) => x.platform === r.platform && x.external_id === r.external_id);
        if (dup) {
          keep.add(dup.id);
          continue;
        }
        const polled = isPolledSource(r);
        const row = await db.addSource({ project_id: p.id, ...r, primed: !polled });
        keep.add(row.id);
        if (polled) await primeSource(row).catch(() => {});
      }
      for (const s of p.sources) if (!keep.has(s.id)) await db.deleteSource(s.id);
    }
    if (Object.keys(input).length) await db.updateProject(p.id, input);
    res.json({ project: publicProject(await db.getProject(p.id)) });
  }),
);

guild.delete(
  '/projects/:pid',
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    await db.deleteProject(p.id);
    res.json({ ok: true });
  }),
);

// GitHub Webhook の Secret を作り直す(漏れた可能性があるとき用)。GitHub側の設定も更新が必要。
guild.post(
  '/projects/:pid/sources/:sid/rotate-secret',
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    const s = p.sources.find((x) => x.id === req.params.sid && x.platform === 'github');
    if (!s) throw bad('通知元が見つかりません', 404);
    const secret = crypto.randomBytes(24).toString('hex');
    await db.updateSource(s.id, { config: { ...(s.config || {}), webhook_secret: secret } });
    res.json({ webhook: { url: `${publicUrl()}/webhooks/github/${s.id}`, secret } });
  }),
);

// テスト送信: 見た目の確認用。「テスト送信」と明記し、メンションは付けない。GitHub(Webhook型)はサンプルの内容を送る。
guild.post(
  '/projects/:pid/test',
  sendLimit,
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    const meta = await guildMeta(req.params.gid);
    const override = req.body && Object.keys(req.body).length ? cleanInput(req.body, meta, true) : {};
    const project = { ...p, ...override };

    const messages = [];
    for (const s of p.sources.filter((x) => !isPolledSource(x))) {
      const ev = (s.config?.events || DEFAULT_GH_EVENTS)[0];
      const msg = buildGithubMessage(project, s, ev, samplePayload(ev, s.external_id), { test: true });
      if (msg) messages.push(msg);
    }
    messages.push(...(await buildPolledMessages(project, await newestReleases(p), { test: true })));
    await deliver(project, messages);
    res.json({ ok: true, sent: messages.length });
  }),
);

// 最新の情報を送る: 保存済みの設定で、実際の最新バージョン(GitHubは最新のリリースとコミット)を通常の通知として送る。
// body.mentions が true のときだけメンションも付ける。
guild.post(
  '/projects/:pid/send-latest',
  sendLimit,
  wrap(async (req, res) => {
    const project = await ownedProject(req.params.gid, req.params.pid);
    const withMentions = req.body?.mentions === true;

    const messages = [];
    for (const s of project.sources.filter((x) => !isPolledSource(x))) {
      let items;
      try {
        items = await ghLatestPayloads(s.external_id, s.config?.events || DEFAULT_GH_EVENTS);
      } catch (e) {
        throw bad(`GitHubから取得できませんでした(${s.external_id}): ${e.message}`, 502);
      }
      // 最新の情報は、通知する内容・ブランチの絞り込みに関係なくそのまま送る
      const all = { ...s, config: { ...(s.config || {}), events: [...GH_EVENTS], branches: [] } };
      for (const it of items) {
        const msg = buildGithubMessage(project, all, it.event, it.payload);
        if (msg) messages.push(msg);
      }
    }
    messages.push(...(await buildPolledMessages(project, await newestReleases(project), {})));
    const final = withMentions ? messages : messages.map((m) => ({ ...m, content: undefined, allowedMentions: { parse: [] } }));
    await deliver(project, final);
    await db.updateProject(project.id, { last_sent_at: new Date().toISOString(), last_error: null });
    res.json({ ok: true, sent: final.length });
  }),
);

// 今すぐチェック(新しい更新があれば通常どおり通知する)
guild.post(
  '/projects/:pid/check',
  sendLimit,
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    res.json(await processProject(p));
  }),
);

apiRouter.use((err, req, res, next) => {
  if (!err.expose) console.error('[api]', req.method, req.path, err.message);
  const status = err.expose ? err.status || 400 : err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: err.expose ? err.message : status === 500 ? 'サーバー内部エラーが発生しました' : '入力内容を処理できませんでした' });
});
