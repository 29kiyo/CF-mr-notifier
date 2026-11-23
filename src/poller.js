import { platforms } from './platforms.js';
import * as db from './db.js';
import { buildMessage } from './embed.js';
import { sendToChannel, explainSendError } from './bot.js';
import { sleep } from './util.js';

/* ---------- フィルタ ---------- */
function matchVersion(v, g) {
  if (g.endsWith('.*')) return v === g.slice(0, -2) || v.startsWith(g.slice(0, -1));
  return v === g;
}

export function passesFilters(rel, f = {}) {
  const gv = f.game_versions || [];
  const ld = (f.loaders || []).map((l) => l.toLowerCase());
  const vt = f.version_types || [];
  if (vt.length && !vt.includes(rel.versionType)) return false;
  // ローダー/バージョン情報が無い通知(GitHubなど)は判断できないので通す
  if (ld.length && rel.loaders.length && !rel.loaders.some((l) => ld.includes(l.toLowerCase()))) return false;
  if (gv.length && rel.gameVersions.length && !rel.gameVersions.some((v) => gv.some((g) => matchVersion(v, g)))) return false;
  return true;
}

/* ---------- Modrinth と CurseForge を1つにまとめる ---------- */
const norm = (v) => String(v || '').toLowerCase().replace(/^v/, '').replace(/[^a-z0-9.]+/g, '');
function sameVersion(a, b) {
  const x = norm(a.versionNumber);
  const y = norm(b.versionNumber);
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)));
}

export function groupReleases(rels) {
  const groups = [];
  for (const r of rels) {
    const g = groups.find((g) => !g.some((x) => x.platform === r.platform) && g.some((x) => sameVersion(x, r)));
    if (g) g.push(r);
    else groups.push([r]);
  }
  return groups;
}

const errText = (e) => String(e?.message || e).slice(0, 200);

async function markReleases(rels) {
  const by = new Map();
  for (const r of rels) {
    if (!by.has(r.sourceId)) by.set(r.sourceId, []);
    by.get(r.sourceId).push(r.versionId);
  }
  for (const [sid, ids] of by) await db.markSeen(sid, ids);
}

// 新しく追加したプロジェクトは、過去の更新を通知しないように「既読」にしておく
export async function primeSource(source) {
  const { ids } = await platforms[source.platform].fetchRecent(source.external_id);
  await db.markSeen(source.id, ids);
  await db.updateSource(source.id, { primed: true, last_checked_at: new Date().toISOString(), last_error: null });
}

export async function processProject(project) {
  const fresh = [];
  const now = () => new Date().toISOString();

  for (const s of project.sources) {
    try {
      const { info, ids, load } = await platforms[s.platform].fetchRecent(s.external_id);
      if (!s.primed) {
        await db.markSeen(s.id, ids);
        await db.updateSource(s.id, { primed: true, last_checked_at: now(), last_error: null });
        continue;
      }
      const seen = await db.getSeenIds(s.id);
      let newIds = ids.filter((i) => !seen.has(i));
      await db.updateSource(s.id, {
        display_name: info.name,
        icon_url: info.iconUrl,
        project_type: info.projectType,
        last_checked_at: now(),
        last_error: null,
      });
      if (!newIds.length) continue;
      if (newIds.length > 30) {
        // 長期間止まっていた等で大量にある場合は、両端だけ読み込み残りは既読にする
        const keep = [...newIds.slice(0, 15), ...newIds.slice(-15)];
        await db.markSeen(s.id, newIds.filter((i) => !keep.includes(i)));
        newIds = keep;
      }
      for (const r of await load(newIds)) {
        r.sourceId = s.id;
        fresh.push(r);
      }
    } catch (e) {
      await db.updateSource(s.id, { last_error: errText(e), last_checked_at: now() }).catch(() => {});
    }
  }
  if (!fresh.length) return { sent: 0 };

  fresh.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

  // フィルタに合わないものは通知せず既読にする
  const pass = [];
  const skip = [];
  for (const r of fresh) (passesFilters(r, project.filters) ? pass : skip).push(r);
  await markReleases(skip);

  let groups = project.merge_platforms ? groupReleases(pass) : pass.map((r) => [r]);

  // まとめ表示: 片方のプラットフォームが遅れて公開されることがあるので、少しだけ待つ
  if (project.merge_platforms) {
    const platformCount = new Set(project.sources.map((s) => s.platform)).size;
    const waitMs = (project.merge_wait_minutes ?? 15) * 60 * 1000;
    if (platformCount > 1 && waitMs > 0) {
      groups = groups.filter((g) => {
        const complete = new Set(g.map((r) => r.platform)).size >= platformCount;
        const age = Date.now() - Math.min(...g.map((r) => new Date(r.publishedAt).getTime()));
        return complete || age >= waitMs;
      });
    }
  }

  // 一度に大量に送らない(最新5件まで)
  const MAX = 5;
  if (groups.length > MAX) {
    await markReleases(groups.slice(0, groups.length - MAX).flat());
    groups = groups.slice(-MAX);
  }

  let sent = 0;
  for (const g of groups) {
    try {
      for (const r of g) await platforms[r.platform].hydrate(r);
      await sendToChannel(project.channel_id, buildMessage(project, g));
      await markReleases(g);
      await db.updateProject(project.id, { last_sent_at: now(), last_error: null });
      sent++;
    } catch (e) {
      await db.updateProject(project.id, { last_error: explainSendError(e).slice(0, 200) }).catch(() => {});
      break;
    }
  }
  return { sent };
}

let running = false;
export async function runCycle() {
  if (running) return;
  running = true;
  try {
    const projects = await db.listEnabledProjects();
    for (const p of projects) {
      try {
        await processProject(p);
      } catch (e) {
        console.error(`[poller] ${p.name}:`, errText(e));
      }
      await sleep(300);
    }
  } catch (e) {
    console.error('[poller] cycle failed:', errText(e));
  } finally {
    running = false;
  }
}
