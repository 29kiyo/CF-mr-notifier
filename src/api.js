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
    if (!name) throw bad('繝励Ο繧ｸ繧ｧ繧ｯ繝亥錐繧貞・蜉帙＠縺ｦ縺上□縺輔＞');
    out.name = name;
  }
  if (has('channel_id')) {
    if (!SNOW.test(String(b.channel_id || ''))) throw bad('騾夂衍繝√Ε繝ｳ繝阪Ν繧帝∈繧薙〒縺上□縺輔＞');
    if (!meta.channels.some((c) => c.id === b.channel_id)) throw bad('縺昴・繝√Ε繝ｳ繝阪Ν縺ｯ隕九▽縺九ｊ縺ｾ縺帙ｓ');
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
  if (!s || !platforms[s.platform]) throw bad('荳肴・縺ｪ繝励Λ繝・ヨ繝輔か繝ｼ繝縺ｧ縺・);
  const id = String(s.external_id || '').trim();
  if (!id || id.length > 200) throw bad('繝励Ο繧ｸ繧ｧ繧ｯ繝・D縺梧ｭ｣縺励￥縺ゅｊ縺ｾ縺帙ｓ');
  try {
    const info = await platforms[s.platform].fetchInfo(id);
    return { platform: s.platform, external_id: info.id, display_name: info.name, icon_url: info.iconUrl, project_type: info.projectType };
  } catch (e) {
    if (e.expose) throw e;
    throw bad(`${s.platform} 縺ｧ繝励Ο繧ｸ繧ｧ繧ｯ繝医′隕九▽縺九ｊ縺ｾ縺帙ｓ(${id})`);
  }
}

async function ownedProject(gid, pid) {
  const p = await db.getProject(pid);
  if (!p || p.guild_id !== gid) throw bad('繝励Ο繧ｸ繧ｧ繧ｯ繝医′隕九▽縺九ｊ縺ｾ縺帙ｓ', 404);
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

// 邨槭ｊ霎ｼ縺ｿ繝ｻ讀懃ｴ｢逕ｨ縺ｮ蛟呵｣・蟇ｾ蠢懊ヰ繝ｼ繧ｸ繝ｧ繝ｳ / 繝ｭ繝ｼ繝繝ｼ / 遞ｮ鬘・
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
    if (!platforms[platform]) throw bad('荳肴・縺ｪ繝励Λ繝・ヨ繝輔か繝ｼ繝縺ｧ縺・);
    try {
      res.json({ results: await platforms[platform].search(q, type) });
    } catch (e) {
      if (e.expose) throw e;
      throw bad('讀懃ｴ｢縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲ょｰ代＠蠕・▲縺ｦ縺九ｉ繧ゅ≧荳蠎ｦ縺願ｩｦ縺励￥縺縺輔＞', 502);
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
      throw bad('繝｡繝ｳ繝舌・讀懃ｴ｢縺ｫ螟ｱ謨励＠縺ｾ縺励◆(Developer Portal縺ｧ縲郡erver Members Intent縲阪ｒON縺ｫ縺励※縺上□縺輔＞)縲ゅΘ繝ｼ繧ｶ繝ｼID縺ｮ逶ｴ謗･蜈･蜉帙・菴ｿ縺医∪縺・, 502);
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
    if ((await db.countProjects(gid)) >= MAX_PROJECTS_PER_GUILD) throw bad(`1繧ｵ繝ｼ繝舌・縺ｫ縺､縺・{MAX_PROJECTS_PER_GUILD}莉ｶ縺ｾ縺ｧ縺ｧ縺兪);
    const meta = await guildMeta(gid);
    const input = cleanInput(req.body || {}, meta);
    const list = Array.isArray(req.body?.sources) ? req.body.sources : [];
    if (!list.length) throw bad('騾夂衍蜈・Modrinth / CurseForge / GitHub)繧・縺､莉･荳企∈繧薙〒縺上□縺輔＞');
    if (list.length > MAX_SOURCES) throw bad(`騾夂衍蜈・・${MAX_SOURCES}莉ｶ縺ｾ縺ｧ縺ｧ縺兪);
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
      if (!list.length) throw bad('騾夂衍蜈・ｒ1縺､莉･荳企∈繧薙〒縺上□縺輔＞');
      if (list.length > MAX_SOURCES) throw bad(`騾夂衍蜈・・${MAX_SOURCES}莉ｶ縺ｾ縺ｧ縺ｧ縺兪);
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

// 繝・せ繝磯∽ｿ｡: 譖ｴ譁ｰ縺後↑縺上※繧ゅ∽ｻ翫・險ｭ螳壹〒譛譁ｰ繝舌・繧ｸ繝ｧ繝ｳ繧帝夂衍繝√Ε繝ｳ繝阪Ν縺ｫ騾√ｋ(繝｡繝ｳ繧ｷ繝ｧ繝ｳ縺ｪ縺・
guild.post(
  '/projects/:pid/test',
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    // 菫晏ｭ伜燕縺ｮ險ｭ螳壹〒繧りｩｦ縺帙ｋ繧医≧縲√Μ繧ｯ繧ｨ繧ｹ繝医↓險ｭ螳壹′蜷ｫ縺ｾ繧後※縺・ｌ縺ｰ荳頑嶌縺阪＠縺ｦ菴ｿ縺・
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
        throw bad(`${s.platform} 縺九ｉ蜿門ｾ励〒縺阪∪縺帙ｓ縺ｧ縺励◆: ${e.message}`, 502);
      }
    }
    if (!newest.length) throw bad('蜿門ｾ励〒縺阪ｋ繝舌・繧ｸ繝ｧ繝ｳ縺後≠繧翫∪縺帙ｓ');
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

// 莉翫☆縺舌メ繧ｧ繝・け
guild.post(
  '/projects/:pid/check',
  wrap(async (req, res) => {
    const p = await ownedProject(req.params.gid, req.params.pid);
    res.json(await processProject(p));
  }),
);

apiRouter.use((err, req, res, next) => {
  if (!err.expose) console.error('[api]', req.method, req.path, err.message);
  res.status(err.expose ? err.status || 400 : 500).json({ error: err.expose ? err.message : '繧ｵ繝ｼ繝舌・蜀・Κ繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆' });
});
