import { cleanChangelog, truncate, matchVersion } from './util.js';

export const LINK_KINDS = ['website', 'wiki', 'source', 'issues', 'discord', 'donation'];

export const DEFAULT_DISPLAY = {
  language: 'ja',
  show_changelog: true,
  changelog_max_chars: 500,
  show_version_type: true,
  show_loaders: true,
  show_game_versions: true,
  show_dependencies: true,
  show_icon: true,
  show_downloads: true,
  show_links: true,
  show_project_links: false,
  project_link_kinds: [...LINK_KINDS],
};

const PLAT = { modrinth: 'Modrinth', curseforge: 'CurseForge', github: 'GitHub' };
const PLAT_ORDER = ['modrinth', 'curseforge', 'github'];
const TYPE_EMOJI = { release: '🟢', beta: '🟡', alpha: '🔴' };
const LOADER_WORDS = /neoforge|forge|fabric|quilt|liteloader|rift|cauldron|bukkit|spigot|paper|purpur|folia|velocity|bungeecord|waterfall|sponge|iris|optifine|canvas|vanilla/gi;

const LABEL = {
  ja: {
    release: 'リリース',
    beta: 'ベータ',
    alpha: 'アルファ',
    versionType: 'バージョンタイプ',
    loaders: 'ローダー',
    gameVersions: '対応バージョン',
    downloads: 'ダウンロード数',
    deps: '依存関係',
    required: '必須',
    optional: '任意',
    incompatible: '非互換',
    links: 'リンク',
    projectLinks: '作品のリンク',
    version: 'このバージョン',
    project: 'プロジェクト',
    kind: { website: 'Webサイト', wiki: 'Wiki', source: 'ソースコード', issues: '不具合報告', discord: 'Discord' },
    testNote: '🧪 テスト送信です(メンションなし・通知履歴には影響しません)',
    test: 'テスト送信',
    more: '他',
  },
  en: {
    release: 'Release',
    beta: 'Beta',
    alpha: 'Alpha',
    versionType: 'Version type',
    loaders: 'Loaders',
    gameVersions: 'Game versions',
    downloads: 'Downloads',
    deps: 'Dependencies',
    required: 'Required',
    optional: 'Optional',
    incompatible: 'Incompatible',
    links: 'Links',
    projectLinks: 'Project links',
    version: 'This version',
    project: 'Project',
    kind: { website: 'Website', wiki: 'Wiki', source: 'Source', issues: 'Issues', discord: 'Discord' },
    testNote: '🧪 Test message (no mentions, does not affect history)',
    test: 'Test',
    more: 'more',
  },
};

const nf = new Intl.NumberFormat('en-US');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fmtLoader = (l) => ({ neoforge: 'NeoForge', liteloader: 'LiteLoader', bungeecord: 'BungeeCord', optifine: 'OptiFine' })[l.toLowerCase()] || cap(l);
const uniq = (a) => [...new Set(a)];

function versionDesc(a, b) {
  const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function compactVersions(list, more, max = 12) {
  const sorted = uniq(list).sort(versionDesc);
  if (sorted.length <= max) return sorted.join(', ');
  return `${sorted.slice(0, max).join(', ')} … +${sorted.length - max}${more}`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u).replace(/\s/g, '%20').replace(/\)/g, '%29') : null);

// 別ローダー・別ファイルをまとめたとき、タイトル用にローダー名を取り除いたバージョン表記にする
function titleVersion(group, main) {
  const v = main.versionNumber || main.name || '';
  if (group.length < 2) return v;
  const cleaned = String(v).replace(LOADER_WORDS, '').replace(/[-_+\s]{2,}/g, '-').replace(/^[-_+\s]+|[-_+\s]+$/g, '');
  return cleaned || v;
}

// group = 同じバージョンのリリース(各プラットフォーム・各ローダーのファイル。1件以上)
export function buildMessage(project, group, { test = false } = {}) {
  const d = { ...DEFAULT_DISPLAY, ...(project.display || {}) };
  const L = LABEL[d.language === 'en' ? 'en' : 'ja'];
  const rels = [...group].sort((a, b) => PLAT_ORDER.indexOf(a.platform) - PLAT_ORDER.indexOf(b.platform));
  const main = rels[0];

  // 絞り込みで選んだローダー・バージョンがあれば、それに関するものだけを表示する
  const wantLoaders = (project.filters?.loaders || []).map((l) => l.toLowerCase());
  const wantVersions = project.filters?.game_versions || [];
  const loadersOf = (r) => (r.loaders || []).filter((l) => !wantLoaders.length || wantLoaders.includes(l.toLowerCase()));
  const versionsOf = (r) => (r.gameVersions || []).filter((v) => !wantVersions.length || wantVersions.some((g) => matchVersion(v, g)));

  const embed = {
    title: truncate(`${project.name || main.info.name} ${titleVersion(rels, main)}`.trim(), 256),
    url: main.url,
    color: Number.isInteger(project.color) ? project.color : 0x5865f2,
    footer: { text: uniq(rels.map((r) => PLAT[r.platform])).join(' + ') + (test ? ` • ${L.test}` : '') },
  };
  const ts = new Date(main.publishedAt);
  if (!Number.isNaN(ts.getTime())) embed.timestamp = ts.toISOString();

  if (d.show_icon) {
    const icon = rels.find((r) => r.info.iconUrl)?.info.iconUrl;
    if (icon) embed.thumbnail = { url: icon };
  }

  if (d.show_changelog) {
    const raw = rels.map((r) => cleanChangelog(r.changelog)).find(Boolean) || '';
    const body = truncate(raw, clamp(Number(d.changelog_max_chars) || 0, 0, 3500));
    if (body) embed.description = body;
  }

  const fields = [];
  if (d.show_version_type) {
    const types = uniq(rels.map((r) => r.versionType));
    fields.push({
      name: L.versionType,
      value: types.map((t) => `${TYPE_EMOJI[t] || '⚪'} ${L[t] || t}`).join(' / '),
      inline: true,
    });
  }
  if (d.show_loaders) {
    const ls = uniq(rels.flatMap(loadersOf));
    if (ls.length) fields.push({ name: L.loaders, value: truncate(ls.map(fmtLoader).join(', '), 1024), inline: true });
  }
  if (d.show_game_versions) {
    const gv = rels.flatMap(versionsOf);
    if (gv.length) fields.push({ name: L.gameVersions, value: truncate(compactVersions(gv, L.more), 1024), inline: true });
  }
  if (d.show_downloads) {
    const byPlat = new Map();
    for (const r of rels) if (r.info.downloads != null && !byPlat.has(r.platform)) byPlat.set(r.platform, r.info.downloads);
    const lines = [...byPlat].map(([p, n]) => `${PLAT[p]}: ${nf.format(n)}`);
    if (lines.length) fields.push({ name: L.downloads, value: lines.join('\n'), inline: true });
  }
  if (d.show_dependencies) {
    const seen = new Set();
    const by = { required: [], optional: [], incompatible: [] };
    for (const r of rels) {
      for (const dep of r.dependencies || []) {
        if (!by[dep.type]) continue;
        const key = `${dep.type}:${dep.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        by[dep.type].push(dep.url ? `[${dep.name}](${dep.url})` : dep.name);
      }
    }
    const lines = Object.entries(by)
      .filter(([, v]) => v.length)
      .map(([k, v]) => `**${L[k]}**: ${v.join(', ')}`);
    if (lines.length) fields.push({ name: L.deps, value: truncate(lines.join('\n'), 1024) });
  }
  if (d.show_links) {
    // 同じサイトのファイルが複数あるとき(Fabric版・NeoForge版など)は、ローダー名で見分けられるようにする
    const perPlat = {};
    for (const r of rels) perPlat[r.platform] = (perPlat[r.platform] || 0) + 1;
    const seenProject = new Set();
    const lines = rels.map((r) => {
      const tag = perPlat[r.platform] > 1 ? ` (${loadersOf(r).map(fmtLoader).join('/') || r.versionNumber})` : '';
      const projectLink = seenProject.has(r.platform) ? '' : ` · [${L.project}](${r.info.url})`;
      seenProject.add(r.platform);
      return `**${PLAT[r.platform]}**${tag} [${L.version}](${r.url})${projectLink}`;
    });
    fields.push({ name: L.links, value: truncate(lines.join('\n'), 1024) });
  }
  if (d.show_project_links) {
    const kinds = Array.isArray(d.project_link_kinds) ? d.project_link_kinds : LINK_KINDS;
    const seen = new Set();
    const items = [];
    for (const r of rels) {
      for (const l of r.info.links || []) {
        const url = safeUrl(l.url);
        if (!url || !kinds.includes(l.kind) || seen.has(url)) continue;
        seen.add(url);
        items.push({ kind: l.kind, text: l.kind === 'donation' ? `💖 ${l.label}` : L.kind[l.kind] || l.label, url });
      }
    }
    items.sort((a, b) => LINK_KINDS.indexOf(a.kind) - LINK_KINDS.indexOf(b.kind));
    if (items.length) fields.push({ name: L.projectLinks, value: truncate(items.map((i) => `[${i.text}](${i.url})`).join(' · '), 1024) });
  }
  if (fields.length) embed.fields = fields;

  if (test) {
    return { content: L.testNote, embeds: [embed], allowedMentions: { parse: [] } };
  }
  const m = mentionParts(project);
  return { content: m.content, embeds: [embed], allowedMentions: m.allowedMentions };
}

export function mentionParts(project) {
  const roles = project.mention_role_ids || [];
  const users = project.mention_user_ids || [];
  const ev = !!project.mention_everyone;
  const here = !!project.mention_here;
  const parts = [
    ...(ev ? ['@everyone'] : []),
    ...(here ? ['@here'] : []),
    ...roles.map((id) => `<@&${id}>`),
    ...users.map((id) => `<@${id}>`),
  ];
  return {
    content: parts.join(' ') || undefined,
    allowedMentions: { parse: ev || here ? ['everyone'] : [], roles, users },
  };
}
