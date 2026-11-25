import { platforms, isPolledSource } from './platforms.js';
import * as db from './db.js';
import { buildMessage } from './embed.js';
import { sendToChannel, explainSendError } from './bot.js';
import { sleep, matchVersion } from './util.js';

/* ---------- フィルタ ---------- */
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

/* ---------- 同じバージョンの通知を1つにまとめる ---------- */
// 別サイト(Modrinth / CurseForge)や、別ローダー・別ファイル(Fabric版 / NeoForge版 など)を同じバージョンとして扱う
const LOADER_WORDS = /neoforge|forge|fabric|quilt|liteloader|rift|cauldron|bukkit|spigot|paper|purpur|folia|velocity|bungeecord|waterfall|sponge|iris|optifine|canvas|vanilla/g;
const norm = (v) =>
  String(v || '')
    .toLowerCase()
    .replace(LOADER_WORDS, '')
    .replace(/^[^a-z0-9]*v(?=\d)/, '')
    .replace(/[^a-z0-9.]+/g, '');

// strict=true は同じサイト内のファイル同士の比較(完全一致のみ)。別サイト同士は表記ゆれがあるので部分一致も許す。
export function sameVersion(a, b, strict = false) {
  const x = norm(a.versionNumber);
  const y = norm(b.versionNumber);
  if (!x || !y) return false;
  if (x === y) return true;
  return !strict && x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
}

const VARIANT_WINDOW_MS = 3 * 60 * 60 * 1000;

function canJoin(x, r, o) {
  if (x.platform !== r.platform) return o.crossPlatform && sameVersion(x, r);
  if (!o.variants || x.versionId === r.versionId) return false;
  return sameVersion(x, r, true) && Math.abs(new Date(x.publishedAt) - new Date(r.publishedAt)) <= VARIANT_WINDOW_MS;
}

export function groupReleases(rels, { crossPlatform = true, variants = true } = {}) {
  const groups = [];
  for (const r of rels) {
    const g = groups.find((g) => g.some((x) => canJoin(x, r, { crossPlatform, variants })));
    if (g) g.push(r);
    else groups.push([r]);
  }
  return groups;
}

const errText = (e) => String(e?.message || e).slice(0, 200);
const lc = (a) => (a || []).map((l) => String(l).toLowerCase());

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
  const polled = project.sources.filter(isPolledSource);

  for (const s of polled) {
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

  const variants = project.merge_variants !== false;
  let groups = groupReleases(pass, { crossPlatform: !!project.merge_platforms, variants });

  // まとめ表示: 他のサイトや別ローダーのファイルが少し遅れて公開されることがあるので、揃うまで少しだけ待つ
  const waitMs = (project.merge_wait_minutes ?? 15) * 60 * 1000;
  if (waitMs > 0 && (project.merge_platforms || variants)) {
    const platformCount = new Set(polled.map((s) => s.platform)).size;
    groups = groups.filter((g) => {
      const platformsDone = !project.merge_platforms || platformCount <= 1 || new Set(g.map((r) => r.platform)).size >= platformCount;
      let loadersDone = true;
      if (variants) {
        // 作品が対応しているローダー(絞り込みがあればその中だけ)のファイルが揃ったら待たずに通知する
        const supported = new Set(g.flatMap((r) => lc(r.info?.loaders)));
        const wanted = lc(project.filters?.loaders);
        const expected = wanted.length ? [...supported].filter((l) => wanted.includes(l)) : [...supported];
        const have = new Set(g.flatMap((r) => lc(r.loaders)));
        loadersDone = expected.length <= 1 || expected.every((l) => have.has(l));
      }
      const age = Date.now() - Math.min(...g.map((r) => new Date(r.publishedAt).getTime()));
      return (platformsDone && loadersDone) || age >= waitMs;
    });
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
