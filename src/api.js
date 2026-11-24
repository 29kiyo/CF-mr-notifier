import express from 'express';
import * as db from './db.js';
import { platforms, getOptions, PROJECT_TYPES } from './platforms.js';
import { guildMeta, searchMembers, sendToChannel, explainSendError, botInGuild, inviteUrl } from './bot.js';
import { requireAuth, requireGuild } from './auth.js';
import { DEFAULT_DISPLAY, buildMessage } from './embed.js';
import { processProject, primeSource } from './poller.js';
import { colorFromString } from './util.js';

const SNOW = /^\d{15,25}$/;
const MAX_PROJECTS_PER_GUILD = 30;
const MAX_SOURCES = 6;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status, expose: true });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

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
  if (has('merge_wait_minutes')) out.merge_wait_minutes = clamp(parseInt(b.merge_wait_minutes ?? 15, 10) || 0, 0, 120);
  if (has('mention_role_ids')) {
    out.mention_role_ids = strArr(b.mention_role_ids, 10, 25, SNOW).filter((id) => meta.roles.some((r) => r.id === id) || id === meta.id);
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
      if (k === 'language' || k === 'changelog_max_chars') continue;
      disp[k] = d[k] === undefined ? DEFAULT_DISPLAY[k] : !!d[k];
    }
    const mc = parseInt(d.changelog_max_chars ?? DEFAULT_DISPLAY.changelog_max_chars, 10);
    disp.changelog_max_chars = clamp(Number.isNaN(mc) ? DEFAULT_DISPLAY.changelog_max_chars : mc, 0, 3500);
    out.display = disp;
  }
  return out;
}

async function resolveSource(s) {
  if (!s || !platforms[s.platform]) throw bad('不明なプラットフォームです');
  const id = String(s.external_id || '').trim();
  if (!id || id.length > 200) throw bad('プロジェクトIDが正しくありません');
  try {
    const info = await platforms[s.platform].fetchInfo(id);
    return { platform: s.platform, external_id: info.id, display_name: info.name, icon_url: info.iconUrl, project_type: info.projectType };
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
    mention_role_ids: p.mention_role_ids,
    mention_user_ids: p.mention_user_ids,
    filters: { game_versions: [], loaders: [], version_types: [], ...(p.filters || {}) },
    display: { ...DEFAULT_DISPLAY, ...(p.display || {}) },
    last_sent_at: p.last_sent_at,
    last_error: p.last_error,
    created_at: p.created_at,
    sources: (p.sources || [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((s) => ({
        id: s.id,
        platform: s.platform,
        external_id: s.external_id,
        display_name: s.display_name,
        icon_url: s.icon_url,
        project_type: s.project_type,
        last_checked_at: s.last_checked_at,
        last_error: s.last_error,
      })),
  };
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

// 絞り込み・検索用の候補(対応バージョン / ローダー / 種類)
apiRouter.get(
  '/options',
  wrap(async (req, res) => {
    res.json({ ...(await getOptions()), defaults: { display: DEFAULT_DISPLAY, merge_wait_minutes: 15 } });
  }),
);

apiRouter.get(
  '/search',
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

const guild = express.Router({ mergeParams: true });
apiRouter.use('/guilds/:gid', requireGuild, guild);

guild.get(
  '/meta',
  wrap(async (req, res) => res.json(await guildMeta(req.params.gid))),
);

guild.get(
  '/members',
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
      const row = await db.addSource({ project_id: p.id, ...r });
      await primeSource(row).catch(() => {});
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
          continue;
        }
        const r = await resolveSource(s);
        const dup = p.sources.find((x) => x.platform === r.platform && x.external_id === r.external_id);
        if (dup) {
          keep.add(dup.id);
          continue;
        }
        const row = await db.addSource({ project_id: p.id, ...r });
        keep.add(row.id);
        await primeSource(row).catch(() => {});
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

// テスト送信: 更新がなくても、今の設定で最新バージョンを通知チャンネルに送る(メンションなし)
guild.post(
  '/projects/:pid/test',
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    // 保存前の設定でも試せるよう、リクエストに設定が含まれていれば上書きして使う
    const meta = await guildMeta(req.params.gid);
    const override = req.body && Object.keys(req.body).length ? cleanInput(req.body, meta, true) : {};
    const project = { ...p, ...override };

    const newest = [];
    for (const s of p.sources) {
      try {
        const { candidates, load } = await platforms[s.platform].fetchRecent(s.external_id);
        const rels = await load(candidates);
        rels.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        if (rels[0]) newest.push(rels[0]);
      } catch (e) {
        throw bad(`${s.platform} から取得できませんでした: ${e.message}`, 502);
      }
    }
    if (!newest.length) throw bad('取得できるバージョンがありません');
    const groups = project.merge_platforms ? [newest] : newest.map((r) => [r]);
    try {
      for (const g of groups) {
        for (const r of g) await platforms[r.platform].hydrate(r);
        await sendToChannel(project.channel_id, buildMessage(project, g, { test: true }));
      }
    } catch (e) {
      throw bad(explainSendError(e), 502);
    }
    res.json({ ok: true, sent: groups.length });
  }),
);

// 今すぐチェック
guild.post(
  '/projects/:pid/check',
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    res.json(await processProject(p));
  }),
);

apiRouter.use((err, req, res, next) => {
  if (!err.expose) console.error('[api]', req.method, req.path, err.message);
  res.status(err.expose ? err.status || 400 : 500).json({ error: err.expose ? err.message : 'サーバー内部エラーが発生しました' });
});
