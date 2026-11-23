import { cleanChangelog, truncate } from './util.js';

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
};

const PLAT = { modrinth: 'Modrinth', curseforge: 'CurseForge', github: 'GitHub' };
const PLAT_ORDER = ['modrinth', 'curseforge', 'github'];
const TYPE_EMOJI = { release: '🟢', beta: '🟡', alpha: '🔴' };

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
    version: 'このバージョン',
    project: 'プロジェクト',
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
    version: 'This version',
    project: 'Project',
    testNote: '🧪 Test message (no mentions, does not affect history)',
    test: 'Test',
    more: 'more',
  },
};

const nf = new Intl.NumberFormat('en-US');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fmtLoader = (l) => ({ neoforge: 'NeoForge', liteloader: 'LiteLoader' })[l] || cap(l);

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
  const sorted = [...new Set(list)].sort(versionDesc);
  if (sorted.length <= max) return sorted.join(', ');
  return `${sorted.slice(0, max).join(', ')} … +${sorted.length - max}${more}`;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// group = 同じバージョンの各プラットフォームのリリース(1件以上)
export function buildMessage(project, group, { test = false } = {}) {
  const d = { ...DEFAULT_DISPLAY, ...(project.display || {}) };
  const L = LABEL[d.language === 'en' ? 'en' : 'ja'];
  const rels = [...group].sort((a, b) => PLAT_ORDER.indexOf(a.platform) - PLAT_ORDER.indexOf(b.platform));
  const main = rels[0];

  const embed = {
    title: truncate(`${project.name || main.info.name} ${main.versionNumber || main.name}`.trim(), 256),
    url: main.url,
    color: Number.isInteger(project.color) ? project.color : 0x5865f2,
    footer: { text: rels.map((r) => PLAT[r.platform]).join(' + ') + (test ? ` • ${L.test}` : '') },
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
    const types = [...new Set(rels.map((r) => r.versionType))];
    fields.push({
      name: L.versionType,
      value: types.map((t) => `${TYPE_EMOJI[t] || '⚪'} ${L[t] || t}`).join(' / '),
      inline: true,
    });
  }
  if (d.show_loaders) {
    const ls = [...new Set(rels.flatMap((r) => r.loaders))];
    if (ls.length) fields.push({ name: L.loaders, value: truncate(ls.map(fmtLoader).join(', '), 1024), inline: true });
  }
  if (d.show_game_versions) {
    const gv = rels.flatMap((r) => r.gameVersions);
    if (gv.length) fields.push({ name: L.gameVersions, value: truncate(compactVersions(gv, L.more), 1024), inline: true });
  }
  if (d.show_downloads) {
    const lines = rels.filter((r) => r.info.downloads != null).map((r) => `${PLAT[r.platform]}: ${nf.format(r.info.downloads)}`);
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
    const lines = rels.map((r) => `**${PLAT[r.platform]}** [${L.version}](${r.url}) · [${L.project}](${r.info.url})`);
    fields.push({ name: L.links, value: truncate(lines.join('\n'), 1024) });
  }
  if (fields.length) embed.fields = fields;

  const roles = project.mention_role_ids || [];
  const users = project.mention_user_ids || [];
  if (test) {
    return { content: L.testNote, embeds: [embed], allowedMentions: { parse: [] } };
  }
  const mentions = [...roles.map((id) => `<@&${id}>`), ...users.map((id) => `<@${id}>`)];
  return {
    content: mentions.join(' ') || undefined,
    embeds: [embed],
    allowedMentions: { parse: [], roles, users },
  };
}
