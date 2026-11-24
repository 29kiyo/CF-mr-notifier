import { cleanChangelog, truncate } from './util.js';
import { mentionParts } from './embed.js';

// ダッシュボードで選べるGitHubのイベント
export const GH_EVENTS = ['push', 'release', 'issues', 'pull_request', 'issue_comment', 'create', 'delete', 'fork', 'star', 'workflow_run'];
export const DEFAULT_GH_EVENTS = ['push', 'release'];

const firstLine = (s) => String(s || '').split('\n')[0];
const globToRe = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const branchOk = (branches, b) => !branches?.length || branches.some((g) => globToRe(g).test(b));

// GitHubのWebhookの内容(payload)を、Discordのメッセージに変換する。対象外のイベントは null を返す。
export function buildGithubMessage(project, source, event, p, { test = false } = {}) {
  const d = project.display || {};
  const ja = d.language !== 'en';
  const L = (a, b) => (ja ? a : b);
  const cfg = source.config || {};
  if (!(cfg.events || DEFAULT_GH_EVENTS).includes(event)) return null;

  const repo = p.repository?.full_name || source.external_id;
  const body = (s, n) => (d.show_changelog === false ? '' : truncate(cleanChangelog(s), Math.min(n, Number(d.changelog_max_chars ?? n))));
  const embed = {
    color: Number.isInteger(project.color) ? project.color : 0x5865f2,
    footer: { text: repo + (test ? ` • ${L('テスト送信', 'Test')}` : '') },
    timestamp: new Date().toISOString(),
  };
  if (p.sender?.login) embed.author = { name: p.sender.login, icon_url: p.sender.avatar_url, url: p.sender.html_url };

  switch (event) {
    case 'push': {
      if (!p.ref || p.ref.startsWith('refs/tags/') || p.deleted) return null;
      const branch = p.ref.replace(/^refs\/heads\//, '');
      if (!branchOk(cfg.branches, branch)) return null;
      const commits = p.commits || [];
      if (!commits.length) return null;
      const n = commits.length;
      embed.title = truncate(
        `[${p.repository?.name || repo}:${branch}] ${L(`${n}件の新しいコミット`, `${n} new commit${n > 1 ? 's' : ''}`)}${p.forced ? L('(強制プッシュ)', ' (force pushed)') : ''}`,
        256,
      );
      embed.url = n === 1 ? commits[0].url : p.compare;
      embed.description = truncate(
        commits
          .slice(0, 5)
          .map((c) => `[\`${String(c.id).slice(0, 7)}\`](${c.url}) ${truncate(firstLine(c.message), 72)} - ${c.author?.username || c.author?.name || ''}`)
          .join('\n') + (n > 5 ? `\n${L(`他${n - 5}件`, `and ${n - 5} more`)}` : ''),
        4000,
      );
      break;
    }
    case 'release': {
      if (p.action !== 'published') return null;
      const r = p.release;
      embed.title = truncate(`🚀 ${L('新しいリリース', 'New release')}: ${r.name || r.tag_name}`, 256);
      embed.url = r.html_url;
      const b = body(r.body, 500);
      embed.description = `**${r.tag_name}**${r.prerelease ? ` (${L('プレリリース', 'pre-release')})` : ''}${b ? `\n\n${b}` : ''}`;
      break;
    }
    case 'issues': {
      if (!['opened', 'closed', 'reopened'].includes(p.action)) return null;
      const i = p.issue;
      const verb = { opened: L('作成', 'opened'), closed: L('クローズ', 'closed'), reopened: L('再オープン', 'reopened') }[p.action];
      embed.title = truncate(`${p.action === 'closed' ? '✅' : '🐛'} Issue #${i.number} ${verb}: ${i.title}`, 256);
      embed.url = i.html_url;
      if (p.action === 'opened') embed.description = body(i.body, 300) || undefined;
      break;
    }
    case 'pull_request': {
      const pr = p.pull_request;
      let act = p.action;
      if (act === 'closed' && pr.merged) act = 'merged';
      if (!['opened', 'closed', 'reopened', 'ready_for_review', 'merged'].includes(act)) return null;
      const verb = {
        opened: L('作成', 'opened'),
        closed: L('クローズ', 'closed'),
        reopened: L('再オープン', 'reopened'),
        ready_for_review: L('レビュー準備完了', 'ready for review'),
        merged: L('マージ', 'merged'),
      }[act];
      const emoji = act === 'merged' ? '🟣' : act === 'closed' ? '🔴' : '🟢';
      embed.title = truncate(`${emoji} PR #${pr.number} ${verb}: ${pr.title}`, 256);
      embed.url = pr.html_url;
      embed.description = `\`${pr.head?.ref}\` → \`${pr.base?.ref}\`` + (act === 'opened' && pr.body ? `\n\n${body(pr.body, 300)}` : '');
      break;
    }
    case 'issue_comment': {
      if (p.action !== 'created') return null;
      const i = p.issue;
      embed.title = truncate(`💬 ${i.pull_request ? 'PR' : 'Issue'} #${i.number} ${L('へのコメント', 'comment')}: ${i.title}`, 256);
      embed.url = p.comment?.html_url;
      embed.description = body(p.comment?.body, 400) || undefined;
      break;
    }
    case 'create':
    case 'delete': {
      if (!['branch', 'tag'].includes(p.ref_type)) return null;
      if (p.ref_type === 'branch' && !branchOk(cfg.branches, p.ref)) return null;
      const made = event === 'create';
      const what = p.ref_type === 'tag' ? L('タグ', 'tag') : L('ブランチ', 'branch');
      embed.title = truncate(`${p.ref_type === 'tag' ? '🏷️' : '🌿'} ${what}${made ? L('が作成されました', ' created') : L('が削除されました', ' deleted')}: ${p.ref}`, 256);
      embed.url = made ? `${p.repository?.html_url}/tree/${encodeURIComponent(p.ref)}` : p.repository?.html_url;
      break;
    }
    case 'fork': {
      embed.title = truncate(`🍴 ${L('フォークされました', 'Forked')}: ${p.forkee?.full_name}`, 256);
      embed.url = p.forkee?.html_url;
      break;
    }
    case 'star': {
      if (p.action !== 'created') return null;
      embed.title = `⭐ ${L('スターが付きました', 'New star')}`;
      embed.url = p.repository?.html_url;
      embed.description = `${L('合計', 'Total')}: ${p.repository?.stargazers_count ?? '-'}`;
      break;
    }
    case 'workflow_run': {
      if (p.action !== 'completed') return null;
      const w = p.workflow_run;
      if (w.head_branch && !branchOk(cfg.branches, w.head_branch)) return null;
      const emoji = { success: '✅', failure: '❌', cancelled: '⚪', timed_out: '⏰' }[w.conclusion] || '🔵';
      embed.title = truncate(`${emoji} ${w.name}: ${w.conclusion}`, 256);
      embed.url = w.html_url;
      embed.description = `\`${w.head_branch}\` ${firstLine(w.head_commit?.message)}`.trim();
      break;
    }
    default:
      return null;
  }

  if (test) {
    return { content: L('🧪 テスト送信です(サンプルの内容・メンションなし)', '🧪 Test message (sample data, no mentions)'), embeds: [embed], allowedMentions: { parse: [] } };
  }
  const m = mentionParts(project);
  return { content: m.content, embeds: [embed], allowedMentions: m.allowedMentions };
}

// テスト送信用のサンプルデータ
export function samplePayload(event, repo) {
  const [owner, name] = repo.split('/');
  const base = {
    repository: { full_name: repo, name: name || repo, html_url: `https://github.com/${repo}`, stargazers_count: 42 },
    sender: { login: owner, avatar_url: `https://github.com/${owner}.png`, html_url: `https://github.com/${owner}` },
  };
  const url = base.repository.html_url;
  switch (event) {
    case 'push':
      return {
        ...base,
        ref: 'refs/heads/main',
        compare: `${url}/compare/a...b`,
        commits: [
          { id: 'a1b2c3d4e5f6', url: `${url}/commit/a1b2c3d`, message: 'サンプル: 新機能を追加', author: { username: owner } },
          { id: 'f6e5d4c3b2a1', url: `${url}/commit/f6e5d4c`, message: 'サンプル: バグを修正', author: { username: owner } },
        ],
      };
    case 'release':
      return { ...base, action: 'published', release: { tag_name: 'v1.2.3', name: 'v1.2.3', html_url: `${url}/releases`, prerelease: false, body: '## 変更点\n- サンプルの更新内容です' } };
    case 'issues':
      return { ...base, action: 'opened', issue: { number: 12, title: 'サンプルのIssue', html_url: `${url}/issues`, body: 'サンプルの本文です。' } };
    case 'pull_request':
      return { ...base, action: 'opened', pull_request: { number: 34, title: 'サンプルのPR', html_url: `${url}/pulls`, merged: false, head: { ref: 'feature' }, base: { ref: 'main' }, body: 'サンプルの説明です。' } };
    case 'issue_comment':
      return { ...base, action: 'created', issue: { number: 12, title: 'サンプルのIssue' }, comment: { html_url: `${url}/issues`, body: 'サンプルのコメントです。' } };
    case 'create':
      return { ...base, ref_type: 'branch', ref: 'feature/sample' };
    case 'delete':
      return { ...base, ref_type: 'branch', ref: 'feature/sample' };
    case 'fork':
      return { ...base, forkee: { full_name: `someone/${name}`, html_url: `https://github.com/someone/${name}` } };
    case 'star':
      return { ...base, action: 'created' };
    case 'workflow_run':
      return { ...base, action: 'completed', workflow_run: { name: 'CI', conclusion: 'success', html_url: `${url}/actions`, head_branch: 'main', head_commit: { message: 'サンプル: ビルド' } } };
    default:
      return base;
  }
}
