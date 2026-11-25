import { useState } from 'react';
import { api, errorMessage } from './lib.js';
import { toast, CopyButton } from './ui.jsx';

// GitHubで通知できる「できごと」
export const GH_EVENTS = [
  ['push', 'プッシュ(コミット)', '🔨'],
  ['release', 'リリース公開', '🚀'],
  ['issues', 'Issue(作成・クローズ)', '🐛'],
  ['pull_request', 'プルリクエスト', '🟣'],
  ['issue_comment', 'コメント', '💬'],
  ['create', 'ブランチ・タグの作成', '🌿'],
  ['delete', 'ブランチ・タグの削除', '🗑️'],
  ['fork', 'フォーク', '🍴'],
  ['star', 'スター', '⭐'],
  ['workflow_run', 'CIの結果(GitHub Actions)', '✅'],
];
export const DEFAULT_GH_CONFIG = { mode: 'webhook', events: ['push', 'release'], branches: [] };

function CopyRow({ label, value }) {
  return (
    <div className="copyrow">
      <span className="clabel">{label}</span>
      <input readOnly className="mono grow" value={value} onFocus={(e) => e.target.select()} />
      <CopyButton text={value} />
    </div>
  );
}

/* ---- GitHub通知元の設定: 通知の方法(Webhook / 従来のリリース通知)を切り替える ---- */
export default function GithubConfig({ s, onChange, saved, gid, pid, onWebhook }) {
  const cfg = { ...DEFAULT_GH_CONFIG, ...(s.config || {}) };
  const mode = cfg.mode === 'release' ? 'release' : 'webhook';
  const setMode = (m) => onChange({ config: { ...cfg, mode: m } });
  const canRotate = !!(pid && s.id && s.webhook?.secret);

  async function rotate() {
    if (!confirm('Secretを作り直します。GitHubのWebhook設定のSecretも新しい値に更新しないと、通知が届かなくなります。続けますか？')) return;
    try {
      const r = await api(`/api/guilds/${gid}/projects/${pid}/sources/${s.id}/rotate-secret`, { method: 'POST' });
      onWebhook(s, r.webhook);
      toast('Secretを作り直しました。GitHubのWebhook設定も新しいSecretに更新してください', 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="ghbox">
      <div className="flabel">通知の方法</div>
      <div className="modegrid" role="radiogroup" aria-label="GitHubの通知の方法">
        <label className={'modeopt' + (mode === 'webhook' ? ' on' : '')}>
          <input type="radio" name={`mode-${s.external_id}`} checked={mode === 'webhook'} onChange={() => setMode('webhook')} />
          <span>
            <strong>できごとを通知(Webhook)</strong>
            <span className="muted small">コミット・プルリク・リリースなどを、すぐに知らせます。GitHub側の設定が必要です。</span>
          </span>
        </label>
        <label className={'modeopt' + (mode === 'release' ? ' on' : '')}>
          <input type="radio" name={`mode-${s.external_id}`} checked={mode === 'release'} onChange={() => setMode('release')} />
          <span>
            <strong>リリースのバージョンを通知(従来)</strong>
            <span className="muted small">新しいリリースが公開されたら、バージョン付きで知らせます(5分ごとに確認)。GitHub側の設定は不要です。</span>
          </span>
        </label>
      </div>

      {mode === 'release' ? (
        <p className="hint">ModrinthやCurseForgeと同じ見た目で通知します。バージョンタイプ(リリースのみ など)の絞り込みと表示設定がそのまま使えます。プレリリースは「ベータ」として扱います。</p>
      ) : (
        <WebhookSettings s={s} cfg={cfg} onChange={onChange} saved={saved} canRotate={canRotate} rotate={rotate} />
      )}
    </div>
  );
}

function WebhookSettings({ s, cfg, onChange, saved, canRotate, rotate }) {
  const [bq, setBq] = useState('');
  const toggle = (ev) => onChange({ config: { ...cfg, events: cfg.events.includes(ev) ? cfg.events.filter((x) => x !== ev) : [...cfg.events, ev] } });
  const addBranch = () => {
    const v = bq.trim();
    if (v && !cfg.branches.includes(v)) onChange({ config: { ...cfg, branches: [...cfg.branches, v] } });
    setBq('');
  };
  return (
    <>
      <div className="flabel">通知する内容</div>
      <div className="evgrid">
        {GH_EVENTS.map(([id, label, emoji]) => (
          <label key={id} className={'evopt' + (cfg.events.includes(id) ? ' on' : '')}>
            <input type="checkbox" checked={cfg.events.includes(id)} onChange={() => toggle(id)} />
            <span>
              {emoji} {label}
            </span>
          </label>
        ))}
      </div>
      <div className="flabel">ブランチを絞る(任意)</div>
      <div className="chips">
        {cfg.branches.map((b) => (
          <span key={b} className="rchip">
            {b}
            <button type="button" aria-label={`${b}を外す`} onClick={() => onChange({ config: { ...cfg, branches: cfg.branches.filter((x) => x !== b) } })}>
              ×
            </button>
          </span>
        ))}
        {cfg.branches.length === 0 && <span className="muted small">すべてのブランチ</span>}
      </div>
      <div className="row">
        <input
          className="grow"
          value={bq}
          onChange={(e) => setBq(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addBranch();
            }
          }}
          placeholder="例: main や release/* (入力して Enter)"
        />
        <button type="button" className="btn small" onClick={addBranch} disabled={!bq.trim()}>
          追加
        </button>
      </div>
      <p className="hint">プッシュ・CI・ブランチ作成/削除の通知に使われます。</p>

      <div className="webhook">
        <div className="flabel">GitHub側の設定(Webhook)</div>
        {s.webhook?.secret ? (
          <>
            <p className="hint">
              GitHubのリポジトリで <b>Settings → Webhooks → Add webhook</b> を開き、次のとおり入力します。
            </p>
            <CopyRow label="Payload URL" value={s.webhook.url} />
            <div className="copyrow">
              <span className="clabel">Content type</span>
              <code>application/json</code>
            </div>
            <CopyRow label="Secret" value={s.webhook.secret} />
            <div className="copyrow">
              <span className="clabel">イベント</span>
              <span className="small">「Send me everything」を選べばOK(ボットが上で選んだものだけ通知します)</span>
            </div>
            <p className="hint">入力して「Add webhook」を押すと、GitHubが確認のメッセージを送ります。リポジトリの管理者権限が必要です。</p>
            {canRotate && (
              <div className="copyrow">
                <button type="button" className="btn small" onClick={rotate}>
                  🔑 Secretを作り直す
                </button>
                <span className="hint">Secretが漏れた可能性があるときに使います。GitHub側も更新が必要です。</span>
              </div>
            )}
          </>
        ) : (
          <p className="hint">保存すると、GitHubに入力するWebhookの設定値(URLとSecret)が表示されます。</p>
        )}
      </div>
    </>
  );
}
