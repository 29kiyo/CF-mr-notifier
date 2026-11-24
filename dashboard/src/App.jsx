import { lazy, Suspense, useState } from 'react';
import {
  api,
  errorMessage,
  getAuthMessage,
  getLastGuild,
  getToken,
  go,
  isWaking,
  setLastGuild,
  setToken,
  startLogin,
  useAsync,
  useRoute,
  useStore,
} from './lib.js';
import { Toaster, toast, Switch, Spinner, GuildIcon, PlatformBadge, Modal, fmtRelative } from './ui.jsx';

const Editor = lazy(() => import('./Editor.jsx'));
const APP_NAME = '更新おしらせボット';

export default function App() {
  useStore();
  const route = useRoute();
  const token = getToken();
  return (
    <>
      {isWaking() && (
        <div className="waking" role="status">
          <span className="spin small" /> ボットを起動しています…(最大1分ほどかかります)
        </div>
      )}
      {!token ? (
        <Login message={getAuthMessage()} />
      ) : (
        <Suspense fallback={<Spinner text="読み込んでいます…" />}>
          {route.page === 'home' && <Home />}
          {route.page === 'server' && <ServerLayout gid={route.gid} view="list" />}
          {route.page === 'editor' && <ServerLayout gid={route.gid} view="editor" pid={route.pid} />}
        </Suspense>
      )}
      <Toaster />
    </>
  );
}

/* ================= ログイン ================= */
function Login({ message }) {
  const [help, setHelp] = useState(false);
  return (
    <main className="login">
      <div className="login-box">
        <div className="brand big">🔔</div>
        <h1>{APP_NAME}</h1>
        <p className="muted">Minecraftの Mod・リソースパック・シェーダーなどの更新を、Discordに自動でお知らせします。</p>
        {message && (
          <div className="alert" role="alert">
            {message}
          </div>
        )}
        <button className="btn primary huge" onClick={startLogin}>
          Discordでログイン
        </button>
        <p className="muted small">サーバーの管理権限があるアカウントでログインしてください。</p>
        <button className="btn ghost small" onClick={() => setHelp(true)}>
          使い方
        </button>
      </div>
      {help && <Help onClose={() => setHelp(false)} />}
    </main>
  );
}

function Help({ onClose }) {
  const steps = [
    ['サーバーを選ぶ', 'ボットが入っているサーバーを選びます。まだなら「ボットを招待」から追加できます。'],
    ['プロジェクトを作る', '「新しいプロジェクト」を押し、名前と通知を送るチャンネルを決めます。'],
    ['通知元を追加する', 'Modrinth・CurseForge・GitHubで作品を検索して「追加」します。同じ作品が両方のサイトにあれば、両方追加すると1つにまとまります。'],
    ['保存してテスト', '保存したら「テスト送信」で見た目を確認しましょう。あとは更新があるたびに自動でお知らせします。'],
  ];
  return (
    <Modal title="使い方" onClose={onClose}>
      <ol className="steps">
        {steps.map(([t, b], i) => (
          <li key={t}>
            <span className="num">{i + 1}</span>
            <div>
              <strong>{t}</strong>
              <p className="muted small">{b}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="right">
        <button className="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}

function UserMenu() {
  const me = useAsync(() => api('/api/me'), []);
  const [help, setHelp] = useState(false);
  const u = me.data?.user;
  return (
    <div className="usermenu">
      <button className="btn ghost small" onClick={() => setHelp(true)}>
        ❓ 使い方
      </button>
      {u && <GuildIcon name={u.name} url={u.avatarUrl} size={28} />}
      <span className="uname">{u?.name}</span>
      <button
        className="btn ghost small"
        onClick={() => {
          setToken(null);
          toast('ログアウトしました', 'ok');
        }}
      >
        ログアウト
      </button>
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

/* ================= サーバー選択 ================= */
function Home() {
  const me = useAsync(() => api('/api/me'), []);
  const last = getLastGuild();
  const guilds = me.data?.guilds || [];
  const lastG = guilds.find((g) => g.id === last && g.botInGuild);
  return (
    <div className="shell-col">
      <header className="topbar">
        <span className="brand">🔔</span>
        <span className="topttl">{APP_NAME}</span>
        <span className="spacer" />
        <UserMenu />
      </header>
      <main className="page">
        <div className="row between">
          <div>
            <h1>サーバーを選んでください</h1>
            <p className="muted">あなたが管理しているサーバーが表示されます。通知を設定したいサーバーを選びましょう。</p>
          </div>
          <button className="btn small" onClick={me.reload}>
            一覧を更新
          </button>
        </div>
        {lastG && (
          <button className="card lastbox" onClick={() => go(`/servers/${lastG.id}`)}>
            <GuildIcon name={lastG.name} url={lastG.iconUrl} size={40} />
            <div>
              <div className="muted small">前回ひらいたサーバー</div>
              <strong>{lastG.name}</strong>
            </div>
            <span>→</span>
          </button>
        )}
        {me.loading && <Spinner text="サーバー一覧を読み込んでいます…" />}
        {me.error && <ErrBox error={me.error} onRetry={me.reload} />}
        {me.data && guilds.length === 0 && (
          <div className="card empty">
            <p>管理できるサーバーがありません</p>
            <p className="muted small">「サーバー管理」の権限があるサーバーだけが表示されます。</p>
          </div>
        )}
        <div className="grid4">
          {guilds.map((g) =>
            g.botInGuild ? (
              <button key={g.id} className="card gcard" onClick={() => go(`/servers/${g.id}`)}>
                <GuildIcon name={g.name} url={g.iconUrl} size={80} />
                <strong className="clamp">{g.name}</strong>
                <span className="link">設定をひらく →</span>
              </button>
            ) : (
              <div key={g.id} className="card gcard off">
                <GuildIcon name={g.name} url={g.iconUrl} size={80} />
                <strong className="clamp">{g.name}</strong>
                <a className="btn small" href={g.inviteUrl} target="_blank" rel="noopener noreferrer">
                  ボットを招待
                </a>
                <span className="muted small">招待後にこのページを更新してください</span>
              </div>
            ),
          )}
        </div>
      </main>
    </div>
  );
}

function ErrBox({ error, onRetry }) {
  return (
    <div className="card errbox">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          もう一度試す
        </button>
      )}
    </div>
  );
}

/* ================= サーバー画面(左にサーバー一覧) ================= */
function ServerLayout({ gid, view, pid }) {
  const me = useAsync(() => api('/api/me'), []);
  const [railOpen, setRailOpen] = useState(false);
  setLastGuild(gid);
  const guilds = (me.data?.guilds || []).filter((g) => g.botInGuild);
  const cur = me.data?.guilds.find((g) => g.id === gid);
  return (
    <div className="shell">
      <aside className={'rail' + (railOpen ? ' open' : '')}>
        <button className="rail-btn home" onClick={() => go('/')} title="サーバー選択" aria-label="サーバー選択に戻る">
          🏠
        </button>
        <div className="rail-sep" />
        {guilds.map((g) => (
          <button key={g.id} className={'rail-btn' + (g.id === gid ? ' on' : '')} onClick={() => { setRailOpen(false); go(`/servers/${g.id}`); }} title={g.name} aria-label={g.name}>
            <GuildIcon name={g.name} url={g.iconUrl} size={48} />
          </button>
        ))}
      </aside>
      <div className="shell-col">
        {view === 'list' && (
          <header className="topbar">
            <button className="btn ghost small menu-btn" onClick={() => setRailOpen((v) => !v)} aria-label="サーバーを切り替える">
              ☰
            </button>
            {cur && <GuildIcon name={cur.name} url={cur.iconUrl} size={32} />}
            <span className="topttl">{cur?.name || ''}</span>
            <span className="spacer" />
            <button className="btn primary small" onClick={() => go(`/servers/${gid}/new`)}>
              ＋ 新しいプロジェクト
            </button>
            <UserMenu />
          </header>
        )}
        {view === 'list' ? <ProjectList gid={gid} /> : <Editor key={gid + (pid || 'new')} gid={gid} pid={pid} />}
      </div>
    </div>
  );
}

/* ================= プロジェクト一覧 ================= */
function ProjectList({ gid }) {
  const projects = useAsync(() => api(`/api/guilds/${gid}/projects`), [gid]);
  const meta = useAsync(() => api(`/api/guilds/${gid}/meta`), [gid]);
  const list = projects.data?.projects || [];
  return (
    <main className="page">
      <h1>通知プロジェクト</h1>
      <p className="muted">
        {projects.data ? `${list.length}件のプロジェクト(うち${list.filter((p) => p.enabled).length}件が通知オン)` : 'このサーバーで設定している更新通知の一覧です。'}
      </p>
      {projects.loading && <Spinner text="プロジェクトを読み込んでいます…" />}
      {projects.error && <ErrBox error={projects.error} onRetry={projects.reload} />}
      {projects.data && list.length === 0 && (
        <div className="card empty">
          <div className="brand big">🔔</div>
          <h2>まだ通知プロジェクトがありません</h2>
          <p className="muted">「プロジェクト」は、1つの作品の更新をお知らせする設定です。まずは1つ作ってみましょう。</p>
          <button className="btn primary" onClick={() => go(`/servers/${gid}/new`)}>
            ＋ 新しいプロジェクト
          </button>
        </div>
      )}
      <div className="grid3">
        {list.map((p) => (
          <ProjectCard key={p.id} gid={gid} p={p} channels={meta.data?.channels} onChanged={projects.reload} />
        ))}
      </div>
    </main>
  );
}

function ProjectCard({ gid, p, channels, onChanged }) {
  const [busy, setBusy] = useState('');
  const [del, setDel] = useState(false);
  const ch = channels?.find((c) => c.id === p.channel_id);
  const warn = p.last_error || p.sources.find((s) => s.last_error)?.last_error;
  const run = async (kind, fn, ok) => {
    setBusy(kind);
    try {
      const r = await fn();
      toast(ok(r), 'ok');
      onChanged();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  };
  const base = `/api/guilds/${gid}/projects/${p.id}`;
  return (
    <article className="card pcard">
      <span className="stripe" style={{ background: p.color_hex }} />
      <div className="pbody">
        <div className="row between">
          <div className="grow">
            <h3 className="clamp">{p.name}</h3>
            <div className="muted small"># {ch ? ch.name : 'チャンネル未設定'}</div>
          </div>
          <span className="muted small">{p.enabled ? 'オン' : 'オフ'}</span>
          <Switch
            checked={p.enabled}
            label={`${p.name}の通知をオン/オフ`}
            disabled={busy === 'toggle'}
            onChange={(v) => run('toggle', () => api(base, { method: 'PUT', body: { enabled: v } }), () => (v ? '通知をオンにしました' : '通知をオフにしました'))}
          />
        </div>
        <div className="srcs">
          {p.sources.map((s) => (
            <span key={s.id} className="srcpill">
              {s.icon_url ? <img src={s.icon_url} alt="" /> : <span className="src-ph sm" />}
              <span className="clamp">{s.display_name}</span>
              <PlatformBadge platform={s.platform} />
            </span>
          ))}
        </div>
        {warn && (
          <div className="alert" role="alert">
            ⚠ {warn}
          </div>
        )}
        <div className="muted small">🕒 {p.last_sent_at ? `最後の通知: ${fmtRelative(p.last_sent_at)}` : 'まだ通知していません'}</div>
      </div>
      <div className="pactions">
        <button className="btn ghost small" onClick={() => go(`/servers/${gid}/edit/${p.id}`)}>
          ✏️ 編集
        </button>
        <button className="btn ghost small" disabled={!!busy} onClick={() => run('test', () => api(`${base}/test`, { method: 'POST', body: {} }), (r) => `テストメッセージを${r.sent}件送りました`)}>
          {busy === 'test' ? '送信中…' : '🧪 テスト送信'}
        </button>
        <button className="btn ghost small" disabled={!!busy} onClick={() => run('check', () => api(`${base}/check`, { method: 'POST' }), (r) => (r.sent > 0 ? `${r.sent}件の更新をお知らせしました` : '新しい更新はありませんでした'))}>
          {busy === 'check' ? '確認中…' : '🔄 今すぐチェック'}
        </button>
        <span className="spacer" />
        <button className="btn ghost small danger" onClick={() => setDel(true)}>
          🗑 削除
        </button>
      </div>
      {del && (
        <Modal title={`「${p.name}」を削除しますか？`} onClose={() => setDel(false)}>
          <p className="muted">このプロジェクトの通知は届かなくなります。削除すると元に戻せません。</p>
          <div className="right row">
            <button className="btn" onClick={() => setDel(false)}>
              キャンセル
            </button>
            <button
              className="btn danger-fill"
              onClick={() => {
                setDel(false);
                run('del', () => api(base, { method: 'DELETE' }), () => `「${p.name}」を削除しました`);
              }}
            >
              削除する
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
