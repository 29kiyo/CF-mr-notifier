import { useEffect, useMemo, useRef, useState } from 'react';
import SendLatestModal from './SendLatest.jsx';
import FiltersSection from './Filters.jsx';
import { api, errorMessage, go, useAsync, useDebounced } from './lib.js';
import { toast, Switch, Chip, Section, Field, Spinner, PlatformBadge, Select, Avatar, CopyButton, fmtNum } from './ui.jsx';

const PRESETS = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#F47B67', '#1BD96A', '#F16436', '#00A8FC', '#9B59B6', '#1ABC9C', '#95A5A6'];
const PLATFORMS = [
  ['modrinth', 'Modrinth'],
  ['curseforge', 'CurseForge'],
  ['github', 'GitHub'],
];
const TYPES = [
  ['mod', 'Mod'],
  ['modpack', 'Modパック'],
  ['resourcepack', 'リソースパック'],
  ['shader', 'シェーダー'],
  ['datapack', 'データパック'],
  ['plugin', 'プラグイン'],
];
const TYPE_OPTIONS = TYPES.map(([value, label]) => ({ value, label }));
const LANG_OPTIONS = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
];
const VTYPES = [
  ['release', 'リリース', '🟢'],
  ['beta', 'ベータ', '🟡'],
  ['alpha', 'アルファ', '🔴'],
];
import GithubConfig, { GH_EVENTS, DEFAULT_GH_CONFIG } from './GithubConfig.jsx';
const MAX_SOURCES = 6;
// 定期チェックする通知元か(GitHubは「従来のリリース通知」に切り替えたときだけ)
const isPolled = (s) => s.platform !== 'github' || s.config?.mode === 'release';
const BASE_DISPLAY = {
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
  project_link_kinds: ['website', 'wiki', 'source', 'issues', 'discord', 'donation'],
};
const LOADER_LABEL = { neoforge: 'NeoForge', liteloader: 'LiteLoader', bungeecord: 'BungeeCord', optifine: 'OptiFine' };
const loaderLabel = (n) => LOADER_LABEL[n] || n.charAt(0).toUpperCase() + n.slice(1);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isNaN(Number(n)) ? lo : Math.round(Number(n))));
const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
const isSnowflake = (v) => /^\d{15,25}$/.test(v.trim());
const repoRe = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

function defaultForm(options) {
  return {
    name: '',
    channel_id: '',
    color: PRESETS[Math.floor(Math.random() * PRESETS.length)],
    enabled: true,
    merge_platforms: true,
    merge_variants: true,
    merge_wait_minutes: options?.defaults?.merge_wait_minutes ?? 15,
    mention_everyone: false,
    mention_here: false,
    mention_role_ids: [],
    mention_user_ids: [],
    filters: { game_versions: [], loaders: [], version_types: [] },
    display: { ...BASE_DISPLAY, ...(options?.defaults?.display || {}) },
    sources: [],
  };
}
function projectToForm(p) {
  return {
    name: p.name,
    channel_id: p.channel_id,
    color: (p.color_hex || '#5865F2').toUpperCase(),
    enabled: p.enabled,
    merge_platforms: p.merge_platforms,
    merge_variants: p.merge_variants !== false,
    merge_wait_minutes: p.merge_wait_minutes,
    mention_everyone: !!p.mention_everyone,
    mention_here: !!p.mention_here,
    mention_role_ids: [...(p.mention_role_ids || [])],
    mention_user_ids: [...(p.mention_user_ids || [])],
    filters: {
      game_versions: [...(p.filters?.game_versions || [])],
      loaders: [...(p.filters?.loaders || [])],
      version_types: [...(p.filters?.version_types || [])],
    },
    display: { ...BASE_DISPLAY, ...(p.display || {}) },
    sources: (p.sources || []).map((s) => ({
      platform: s.platform,
      external_id: s.external_id,
      id: s.id,
      name: s.display_name,
      iconUrl: s.icon_url,
      ...(s.platform === 'github' ? { config: { mode: s.config?.mode === 'release' ? 'release' : 'webhook', events: [...(s.config?.events || [])], branches: [...(s.config?.branches || [])] }, webhook: s.webhook } : {}),
    })),
  };
}
function formToInput(f) {
  return {
    name: f.name.trim(),
    channel_id: f.channel_id,
    color: f.color.toUpperCase(),
    enabled: f.enabled,
    merge_platforms: f.merge_platforms,
    merge_variants: f.merge_variants,
    merge_wait_minutes: clamp(f.merge_wait_minutes, 0, 120),
    mention_everyone: f.mention_everyone,
    mention_here: f.mention_here,
    mention_role_ids: f.mention_role_ids,
    mention_user_ids: f.mention_user_ids,
    filters: f.filters,
    display: { ...f.display, changelog_max_chars: clamp(f.display.changelog_max_chars, 0, 3500) },
    sources: f.sources.map((s) => ({ platform: s.platform, external_id: s.external_id, ...(s.platform === 'github' ? { config: s.config } : {}) })),
  };
}
function validate(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'プロジェクト名を入力してください';
  if (!f.channel_id) e.channel_id = '通知を送るチャンネルを選んでください';
  if (f.sources.length === 0) e.sources = '通知元を1つ以上追加してください';
  if (f.sources.some((s) => s.platform === 'github' && !s.config?.events?.length)) e.sources = 'GitHubの通知する内容を1つ以上選んでください';
  if (!isHex(f.color)) e.color = '色は #RRGGBB の形で入力してください';
  return e;
}

/* ================= エディタ本体 ================= */
export default function Editor({ gid, pid }) {
  const opts = useAsync(() => api('/api/options'), []);
  const meta = useAsync(() => api(`/api/guilds/${gid}/meta`), [gid]);
  const projects = useAsync(() => (pid ? api(`/api/guilds/${gid}/projects`) : Promise.resolve(null)), [gid, pid]);

  if (opts.error || meta.error || projects.error)
    return (
      <main className="page">
        <div className="card errbox">
          <p>{errorMessage(opts.error || meta.error || projects.error)}</p>
          <button className="btn" onClick={() => go(`/servers/${gid}`)}>
            一覧に戻る
          </button>
        </div>
      </main>
    );
  if (opts.loading || meta.loading || projects.loading) return <Spinner text="読み込んでいます…" />;

  const project = pid ? projects.data.projects.find((p) => p.id === pid) : null;
  if (pid && !project)
    return (
      <main className="page">
        <div className="card errbox">
          <p>プロジェクトが見つかりません。</p>
          <button className="btn" onClick={() => go(`/servers/${gid}`)}>
            一覧に戻る
          </button>
        </div>
      </main>
    );
  return <EditorForm gid={gid} pid={pid} options={opts.data} meta={meta.data} project={project} />;
}

function EditorForm({ gid, pid, options, meta, project }) {
  const [form, setForm] = useState(() => (project ? projectToForm(project) : defaultForm(options)));
  const initial = useRef(JSON.stringify(form));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  const [latestOpen, setLatestOpen] = useState(false);
  const [names, setNames] = useState({}); // ユーザーID → { name, avatarUrl }
  const dirty = JSON.stringify(form) !== initial.current;

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const setDisplay = (k, v) => setForm((f) => ({ ...f, display: { ...f.display, [k]: v } }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, filters: { ...f.filters, [k]: v } }));
  // Secretを作り直したあとの表示更新(保存済みの内容と同じ扱いにして「未保存」にならないようにする)
  const onWebhook = (src, webhook) => {
    const patch = (f) => ({ ...f, sources: f.sources.map((x) => (x.platform === src.platform && x.external_id === src.external_id ? { ...x, webhook } : x)) });
    setForm(patch);
    try {
      initial.current = JSON.stringify(patch(JSON.parse(initial.current)));
    } catch {
      /* そのまま */
    }
  };

  // 保存済みのメンション相手の名前とアイコンを取得
  useEffect(() => {
    const ids = form.mention_user_ids.filter((id) => !names[id]);
    if (!ids.length) return;
    api(`/api/guilds/${gid}/members/resolve?ids=${ids.join(',')}`)
      .then((d) =>
        setNames((n) => {
          const next = { ...n };
          for (const m of d.members) next[m.id] = { name: m.displayName || m.username, avatarUrl: m.avatarUrl };
          return next;
        }),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const f = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', f);
    return () => removeEventListener('beforeunload', f);
  }, [dirty]);

  const back = () => {
    if (dirty && !confirm('保存していない変更があります。破棄して戻りますか？')) return;
    go(`/servers/${gid}`);
  };

  async function save() {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast('入力内容を確認してください', 'error');
      setTimeout(() => document.querySelector('.ferr')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    setBusy('save');
    try {
      const body = formToInput(form);
      if (pid) await api(`/api/guilds/${gid}/projects/${pid}`, { method: 'PUT', body });
      else await api(`/api/guilds/${gid}/projects`, { method: 'POST', body });
      initial.current = JSON.stringify(form);
      toast('保存しました', 'ok');
      go(`/servers/${gid}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  }

  async function sendTest() {
    const errs = validate(form);
    if (errs.channel_id || errs.name) {
      setErrors(errs);
      toast('名前とチャンネルを入力してください', 'error');
      return;
    }
    setBusy('test');
    try {
      const { sources, enabled, mention_role_ids, mention_user_ids, mention_everyone, mention_here, ...rest } = formToInput(form);
      const r = await api(`/api/guilds/${gid}/projects/${pid}/test`, { method: 'POST', body: rest });
      toast(`テストメッセージを${r.sent}件送りました(メンションなし)`, 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <header className="topbar">
        <button className="btn ghost" onClick={back}>
          ← 戻る
        </button>
        <h1 className="topttl">{pid ? 'プロジェクトを編集' : '新しいプロジェクト'}</h1>
      </header>
      <main className="page editor">
        <div className="editor-main">
          <BasicSection form={form} set={set} errors={errors} channels={meta.channels} />
          <SourcesSection form={form} set={set} error={errors.sources} options={options} saved={!!pid} gid={gid} pid={pid} onWebhook={onWebhook} />
          <MergeSection form={form} set={set} />
          <FiltersSection form={form} setFilter={setFilter} options={options} />
          <MentionsSection form={form} set={set} meta={meta} gid={gid} names={names} setNames={setNames} />
          <DisplaySection form={form} setDisplay={setDisplay} />
        </div>
        <aside className="editor-side">
          <Preview form={form} meta={meta} names={names} />
        </aside>
      </main>
      <div className="actionbar">
        <button className="btn ghost" onClick={back}>
          キャンセル
        </button>
        <span className="spacer" />
        {dirty && <span className="muted small">未保存の変更があります</span>}
        <button className="btn" onClick={() => setLatestOpen(true)} disabled={!pid || busy !== '' || dirty} title={!pid ? '先に保存すると送信できます' : dirty ? '先に保存してください(保存済みの設定で送ります)' : ''}>
          📤 最新を送信
        </button>
        <button className="btn" onClick={sendTest} disabled={!pid || busy !== ''} title={pid ? '' : '先に保存するとテスト送信できます'}>
          {busy === 'test' ? '送信中…' : '🧪 テスト送信'}
        </button>
        <button className="btn primary" onClick={save} disabled={busy !== ''}>
          {busy === 'save' ? '保存中…' : '保存'}
        </button>
      </div>
      {latestOpen && <SendLatestModal gid={gid} p={{ id: pid, name: form.name }} onClose={() => setLatestOpen(false)} />}
      {!pid && <p className="muted small center nopad">※ テスト送信は、一度保存したあとで使えます。</p>}
    </>
  );
}

/* ================= 基本 ================= */
function BasicSection({ form, set, errors, channels }) {
  const chanOptions = useMemo(() => {
    const m = new Map();
    for (const c of channels) {
      const k = c.category || 'カテゴリなし';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return [...m.entries()].flatMap(([cat, list]) =>
      list.map((c) => ({
        value: c.id,
        group: cat,
        disabled: !c.canSend,
        label: `${c.canSend ? '# ' : '🔒 '}${c.name}${c.canSend ? '' : '(ボットに権限がありません)'}`,
      })),
    );
  }, [channels]);
  return (
    <Section id="basic" icon="⚙️" title="基本" desc="プロジェクトの名前と、通知を送る場所を決めます。">
      <Field label="プロジェクト名" required error={errors.name} hint="通知メッセージのタイトルに使われます。例: Sodium">
        <input value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="例: Sodium" />
      </Field>
      <Field label="通知チャンネル" required error={errors.channel_id} hint="更新のお知らせを送るチャンネルです。🔒がついたチャンネルにはボットが書き込めません。">
        <Select value={form.channel_id} onChange={(v) => set('channel_id', v)} options={chanOptions} placeholder="チャンネルを選んでください" ariaLabel="通知チャンネル" />
      </Field>
      <Field label="メッセージの色" error={errors.color} hint="通知メッセージの左側の線の色です。プロジェクトごとに変えると見分けやすくなります。">
        <div className="swatches" role="radiogroup" aria-label="色のプリセット">
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={form.color.toUpperCase() === c}
              aria-label={c}
              className={'swatch' + (form.color.toUpperCase() === c ? ' on' : '')}
              style={{ background: c }}
              onClick={() => set('color', c)}
            />
          ))}
        </div>
        <div className="row">
          <input type="color" className="colorpick" value={isHex(form.color) ? form.color : '#5865F2'} onChange={(e) => set('color', e.target.value.toUpperCase())} aria-label="色を自由に選ぶ" />
          <input
            className="mono short"
            value={form.color}
            onChange={(e) => {
              let v = e.target.value.trim();
              if (v && !v.startsWith('#')) v = '#' + v;
              set('color', v.toUpperCase().slice(0, 7));
            }}
          />
        </div>
      </Field>
    </Section>
  );
}

/* ================= 通知元 ================= */
function SourcesSection({ form, set, error, saved, gid, pid, onWebhook }) {
  const [platform, setPlatform] = useState('modrinth');
  const [type, setType] = useState('mod');
  // 検索欄はサイトごとに別々に持つ(追加したらその欄だけ空にする)
  const [qs, setQs] = useState({ modrinth: '', curseforge: '', github: '' });
  const q = qs[platform];
  const setQ = (v) => setQs((s) => ({ ...s, [platform]: v }));
  const dq = useDebounced(q, 450);
  const [res, setRes] = useState({ loading: false, items: [], error: null });

  useEffect(() => {
    let dead = false;
    if (platform === 'github' && !dq.trim()) {
      setRes({ loading: false, items: [], error: null });
      return;
    }
    setRes((r) => ({ ...r, loading: true, error: null }));
    api(`/api/search?platform=${platform}&type=${type}&q=${encodeURIComponent(dq)}`)
      .then((d) => !dead && setRes({ loading: false, items: d.results, error: null }))
      .catch((e) => !dead && setRes({ loading: false, items: [], error: errorMessage(e) }));
    return () => {
      dead = true;
    };
  }, [platform, type, dq]);

  const has = (it) => form.sources.some((s) => s.platform === it.platform && s.external_id === it.id);
  function add(it) {
    if (form.sources.length >= MAX_SOURCES) return toast(`通知元は最大${MAX_SOURCES}個までです`, 'error');
    if (has(it)) return;
    const src = { platform: it.platform, external_id: it.id, name: it.name, iconUrl: it.iconUrl };
    if (it.platform === 'github') src.config = { ...DEFAULT_GH_CONFIG, events: [...DEFAULT_GH_CONFIG.events], branches: [] };
    set('sources', [...form.sources, src]);
    setQ('');
  }
  const updateSource = (target, patch) => set('sources', form.sources.map((s) => (s === target ? { ...s, ...patch } : s)));

  const direct = platform === 'github' ? q.trim().match(repoRe) : null;
  const directId = direct ? `${direct[1]}/${direct[2]}` : null;
  const items = directId && !res.items.some((r) => r.id.toLowerCase() === directId.toLowerCase()) ? [{ platform: 'github', id: directId, name: directId, iconUrl: `https://github.com/${direct[1]}.png`, description: 'このリポジトリを直接追加(非公開リポジトリもOK)', direct: true }, ...res.items] : res.items;

  return (
    <Section
      id="sources"
      icon="🔎"
      title="通知元"
      desc="通知したい作品やリポジトリを検索して追加します。同じ作品がModrinthとCurseForgeの両方にある場合は、両方追加すると1つのプロジェクトとして扱えます。"
    >
      {error && (
        <p className="ferr" role="alert">
          {error}
        </p>
      )}
      <div className="chosen">
        {form.sources.length === 0 && <p className="muted small">まだ追加されていません</p>}
        {form.sources.map((s) => (
          <div key={s.platform + s.external_id} className="srcwrap">
            <div className="src">
              {s.iconUrl ? <img src={s.iconUrl} alt="" /> : <span className="src-ph" />}
              <span className="src-name">{s.name || s.external_id}</span>
              <PlatformBadge platform={s.platform} />
              <button type="button" className="x" aria-label={`${s.name}を外す`} onClick={() => set('sources', form.sources.filter((x) => x !== s))}>
                ×
              </button>
            </div>
            {s.platform === 'github' && <GithubConfig s={s} onChange={(patch) => updateSource(s, patch)} saved={saved} gid={gid} pid={pid} onWebhook={onWebhook} />}
          </div>
        ))}
      </div>

      <div className="tabs" role="tablist">
        {PLATFORMS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={platform === id} className={'tab' + (platform === id ? ' on' : '')} onClick={() => setPlatform(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="row">
        {platform !== 'github' && <Select className="short" value={type} onChange={setType} options={TYPE_OPTIONS} ariaLabel="種類" />}
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={platform === 'github' ? 'owner/repo か GitHub のURLを入力' : '名前で検索(空欄なら人気順)'} />
      </div>
      {platform === 'curseforge' && <p className="hint">CurseForgeの検索には、ボット側でAPIキーの設定が必要です。</p>}
      {platform === 'github' && <p className="hint">GitHubは、リリースのバージョン通知ではなく、コミットやプルリクなどの「できごと」をWebhookで通知します。</p>}
      <div className="results" aria-busy={res.loading}>
        {res.loading && <p className="muted small">検索中…</p>}
        {res.error && <p className="ferr">{res.error}</p>}
        {!res.loading && !res.error && items.length === 0 && <p className="muted small">{platform === 'github' ? 'リポジトリを入力してください' : '見つかりませんでした'}</p>}
        {items.map((it) => (
          <div key={it.platform + it.id} className="result">
            {it.iconUrl ? <img src={it.iconUrl} alt="" loading="lazy" /> : <span className="src-ph" />}
            <div className="grow">
              <div className="rname">{it.name}</div>
              <div className="muted small clamp">{it.description}</div>
              <div className="muted small">
                {it.downloads != null && `⬇ ${fmtNum(it.downloads)}`}
                {it.stars != null && `★ ${fmtNum(it.stars)}`}
              </div>
            </div>
            <button className="btn small" disabled={has(it)} onClick={() => add(it)}>
              {has(it) ? '追加済み' : '追加'}
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ================= まとめ表示 ================= */
function MergeSection({ form, set }) {
  const platCount = new Set(form.sources.filter(isPolled).map((s) => s.platform)).size;
  const waiting = form.merge_platforms || form.merge_variants;
  return (
    <Section id="merge" icon="🧩" title="まとめ表示" desc="同じバージョンの通知を、1つのメッセージにまとめます。">
      <div className="switchrow">
        <div>
          <strong>複数サイトの通知を1つにまとめる</strong>
          <p className="hint">
            {platCount > 1
              ? 'ModrinthとCurseForgeに同じバージョンが公開されたら、1つのメッセージで知らせます。'
              : 'ModrinthとCurseForgeの両方を追加すると効果があります。(GitHubは、通知の方法が「リリースのバージョンを通知」のときだけまとめられます)'}
          </p>
        </div>
        <Switch checked={form.merge_platforms} onChange={(v) => set('merge_platforms', v)} label="複数サイトの通知を1つにまとめる" />
      </div>
      <div className="switchrow">
        <div>
          <strong>別ローダー・別ファイルも1つにまとめる</strong>
          <p className="hint">FabricとNeoForgeなど、同じバージョンが別々のファイルとして公開されたときも、1つのメッセージにまとめます。</p>
        </div>
        <Switch checked={form.merge_variants} onChange={(v) => set('merge_variants', v)} label="別ローダー・別ファイルも1つにまとめる" />
      </div>
      {waiting && (
        <Field label="揃うまで待つ時間(分)" hint="別のサイトや、別ローダーのファイルは、少し遅れて公開されることがあります。そのとき、この時間だけ待ってからまとめて通知します。作品が対応するローダー(絞り込みで選んだ場合はその中)のファイルが全部揃えば、待たずに通知します。0なら待ちません。">
          <input type="number" min={0} max={120} className="short" value={form.merge_wait_minutes} onChange={(e) => set('merge_wait_minutes', e.target.value === '' ? '' : clamp(e.target.value, 0, 120))} />
        </Field>
      )}
    </Section>
  );
}

/* ================= 絞り込み ================= */
/* ================= メンション ================= */
function MentionsSection({ form, set, meta, gid, names, setNames }) {
  const [rq, setRq] = useState('');
  const [mq, setMq] = useState('');
  const dmq = useDebounced(mq, 450);
  const [members, setMembers] = useState({ loading: false, items: [], error: null });
  const [rawId, setRawId] = useState('');

  useEffect(() => {
    let dead = false;
    if (!dmq.trim()) {
      setMembers({ loading: false, items: [], error: null });
      return;
    }
    setMembers((m) => ({ ...m, loading: true, error: null }));
    api(`/api/guilds/${gid}/members?q=${encodeURIComponent(dmq)}`)
      .then((d) => !dead && setMembers({ loading: false, items: d.members.filter((m) => !m.bot), error: null }))
      .catch((e) => !dead && setMembers({ loading: false, items: [], error: errorMessage(e) }));
    return () => {
      dead = true;
    };
  }, [dmq, gid]);

  const roles = meta.roles.filter((r) => r.name.toLowerCase().includes(rq.trim().toLowerCase()));
  const roleById = Object.fromEntries(meta.roles.map((r) => [r.id, r]));
  const toggleRole = (id) => set('mention_role_ids', form.mention_role_ids.includes(id) ? form.mention_role_ids.filter((x) => x !== id) : [...form.mention_role_ids, id]);
  const addUser = (m) => {
    setNames((n) => ({ ...n, [m.id]: { name: m.displayName || m.username, avatarUrl: m.avatarUrl } }));
    if (!form.mention_user_ids.includes(m.id)) set('mention_user_ids', [...form.mention_user_ids, m.id]);
  };
  const total = form.mention_role_ids.length + form.mention_user_ids.length + (form.mention_everyone ? 1 : 0) + (form.mention_here ? 1 : 0);

  return (
    <Section id="mentions" icon="📣" title="メンション" desc="更新のお知らせと一緒に、知らせたい相手に通知(メンション)を送ります。">
      <div className="chips">
        {total === 0 && <span className="muted small">メンションなし</span>}
        {form.mention_everyone && (
          <span className="rchip role">
            @everyone
            <button type="button" aria-label="外す" onClick={() => set('mention_everyone', false)}>
              ×
            </button>
          </span>
        )}
        {form.mention_here && (
          <span className="rchip role">
            @here
            <button type="button" aria-label="外す" onClick={() => set('mention_here', false)}>
              ×
            </button>
          </span>
        )}
        {form.mention_role_ids.map((id) => (
          <span key={id} className="rchip role" style={{ borderColor: roleById[id]?.color || undefined }}>
            @{roleById[id]?.name || '不明なロール'}
            <button type="button" aria-label="外す" onClick={() => toggleRole(id)}>
              ×
            </button>
          </span>
        ))}
        {form.mention_user_ids.map((id) => (
          <span key={id} className="rchip role">
            <Avatar name={names[id]?.name} url={names[id]?.avatarUrl} size={18} />@{names[id]?.name || `ユーザー(${id.slice(-4)})`}
            <button type="button" aria-label="外す" onClick={() => set('mention_user_ids', form.mention_user_ids.filter((x) => x !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="toggles">
        <div className="switchrow compact">
          <span>
            <strong>@everyone</strong> <span className="muted small">サーバーの全員</span>
          </span>
          <Switch checked={form.mention_everyone} onChange={(v) => set('mention_everyone', v)} label="@everyone" />
        </div>
        <div className="switchrow compact">
          <span>
            <strong>@here</strong> <span className="muted small">今オンラインの人</span>
          </span>
          <Switch checked={form.mention_here} onChange={(v) => set('mention_here', v)} label="@here" />
        </div>
      </div>
      {(form.mention_everyone || form.mention_here) && (
        <p className="alert">
          ⚠ 更新のたびに大勢に通知が飛びます。{!meta.canMentionAll && 'また、ボットに「@everyone・@here・全てのロールにメンション」の権限がないため、通知されない可能性があります。'}
        </p>
      )}

      <Field label="ロールを選ぶ" hint={!meta.canMentionAll ? 'ロールにメンションできない場合は、ボットの権限(「全員宛メンション」など)を確認してください。' : undefined}>
        <input value={rq} onChange={(e) => setRq(e.target.value)} placeholder="ロール名で検索" />
        <div className="verlist roles">
          {roles.length === 0 && <span className="muted small">該当するロールがありません</span>}
          {roles.map((r) => (
            <button key={r.id} type="button" aria-pressed={form.mention_role_ids.includes(r.id)} className={'ver' + (form.mention_role_ids.includes(r.id) ? ' sel' : '')} onClick={() => toggleRole(r.id)}>
              <span className="dot" style={{ background: r.color || '#99aab5' }} />
              {r.name}
            </button>
          ))}
        </div>
      </Field>

      <Field label="人を選ぶ" hint="名前の一部を入力して検索します。">
        <input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="ユーザー名で検索" />
        {members.loading && <p className="muted small">検索中…</p>}
        {members.error && <p className="ferr">{members.error}</p>}
        <div className="verlist">
          {members.items.map((m) => (
            <button key={m.id} type="button" className={'ver member' + (form.mention_user_ids.includes(m.id) ? ' sel' : '')} onClick={() => addUser(m)}>
              <Avatar name={m.displayName} url={m.avatarUrl} size={24} />
              <span>{m.displayName}</span>
              <span className="muted small">@{m.username}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <input className="grow mono" value={rawId} onChange={(e) => setRawId(e.target.value)} placeholder="ユーザーIDを直接入力(数字17〜20桁)" />
          <button
            className="btn small"
            disabled={!isSnowflake(rawId)}
            onClick={() => {
              const id = rawId.trim();
              if (!form.mention_user_ids.includes(id)) set('mention_user_ids', [...form.mention_user_ids, id]);
              setRawId('');
            }}
          >
            追加
          </button>
        </div>
      </Field>
    </Section>
  );
}

/* ================= 表示設定 ================= */
const LINK_KINDS = [
  ['website', 'Webサイト'],
  ['wiki', 'Wiki'],
  ['source', 'ソースコード'],
  ['issues', '不具合報告'],
  ['discord', 'Discord'],
  ['donation', '寄付'],
];
const TOGGLES = [
  ['show_changelog', 'チェンジログ(更新内容)'],
  ['show_version_type', 'バージョンタイプ'],
  ['show_loaders', 'ローダー'],
  ['show_game_versions', '対応バージョン'],
  ['show_dependencies', '依存関係'],
  ['show_icon', 'アイコン'],
  ['show_downloads', 'ダウンロード数'],
  ['show_links', 'リンク'],
  ['show_project_links', '作品の登録リンク(Wiki・ソース等)'],
];
function DisplaySection({ form, setDisplay }) {
  const d = form.display;
  return (
    <Section id="display" icon="🎨" title="表示設定" desc="通知メッセージに表示する内容を選びます。右側のプレビューにすぐ反映されます。(GitHubの通知では、チェンジログと言語の設定が使われます)">
      <div className="toggles">
        {TOGGLES.map(([k, label]) => (
          <div key={k} className="switchrow compact">
            <span>{label}</span>
            <Switch checked={d[k]} onChange={(v) => setDisplay(k, v)} label={label} />
          </div>
        ))}
      </div>
      {d.show_project_links && (
        <Field label="表示するリンクの種類" hint="作品(ModrinthやCurseForge)に登録されているリンクのうち、選んだものだけを表示します。登録がないものは出ません。">
          <div className="chips">
            {LINK_KINDS.map(([k, label]) => {
              const kinds = d.project_link_kinds || LINK_KINDS.map((x) => x[0]);
              return (
                <Chip key={k} selected={kinds.includes(k)} onClick={() => setDisplay('project_link_kinds', kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>
                  {label}
                </Chip>
              );
            })}
          </div>
        </Field>
      )}
      <Field label="チェンジログの最大文字数" hint="長い更新内容はここで切り詰めます。0〜3500文字。">
        <div className="row">
          <input type="range" min={0} max={3500} step={50} className="grow" value={d.changelog_max_chars} onChange={(e) => setDisplay('changelog_max_chars', Number(e.target.value))} disabled={!d.show_changelog} />
          <input type="number" min={0} max={3500} className="short" value={d.changelog_max_chars} onChange={(e) => setDisplay('changelog_max_chars', e.target.value === '' ? '' : clamp(e.target.value, 0, 3500))} disabled={!d.show_changelog} />
        </div>
      </Field>
      <Field label="メッセージの言語" hint="通知メッセージ内の項目名(「ローダー」など)の言語です。">
        <Select className="short" value={d.language} onChange={(v) => setDisplay('language', v)} options={LANG_OPTIONS} ariaLabel="メッセージの言語" />
      </Field>
    </Section>
  );
}

/* ================= Discord風プレビュー ================= */
const SAMPLE_CHANGELOG =
  '## 変更点\n- 新しい設定画面を追加しました\n- パフォーマンスを改善しました(最大20%高速化)\n- いくつかのクラッシュを修正しました\n\n## 既知の問題\n- 一部のシェーダーで表示が乱れることがあります。次のバージョンで修正予定です。';
const L = {
  ja: { vt: 'バージョンタイプ', ld: 'ローダー', gv: '対応バージョン', dl: 'ダウンロード数', dep: '依存関係', req: '必須', ln: 'リンク', pl: '作品のリンク', ver: 'このバージョン', pr: 'プロジェクト', rel: 'リリース', beta: 'ベータ', alpha: 'アルファ' },
  en: { vt: 'Version type', ld: 'Loaders', gv: 'Game versions', dl: 'Downloads', dep: 'Dependencies', req: 'Required', ln: 'Links', pl: 'Project links', ver: 'This version', pr: 'Project', rel: 'Release', beta: 'Beta', alpha: 'Alpha' },
};
const PNAME = { modrinth: 'Modrinth', curseforge: 'CurseForge', github: 'GitHub' };

function GhSample(event, repo, ja) {
  const t = (a, b) => (ja ? a : b);
  const r = repo.split('/')[1] || repo;
  switch (event) {
    case 'push':
      return { title: `[${r}:main] ${t('2件の新しいコミット', '2 new commits')}`, desc: '`a1b2c3d` サンプル: 新機能を追加 - user\n`f6e5d4c` サンプル: バグを修正 - user' };
    case 'release':
      return { title: `🚀 ${t('新しいリリース', 'New release')}: v1.2.3`, desc: '**v1.2.3**\n\n' + (ja ? '更新内容のサンプルです' : 'Sample release notes') };
    case 'issues':
      return { title: `🐛 Issue #12 ${t('作成', 'opened')}: ${t('サンプルのIssue', 'Sample issue')}`, desc: '' };
    case 'pull_request':
      return { title: `🟢 PR #34 ${t('作成', 'opened')}: ${t('サンプルのPR', 'Sample PR')}`, desc: '`feature` → `main`' };
    case 'issue_comment':
      return { title: `💬 Issue #12 ${t('へのコメント', 'comment')}: ${t('サンプルのIssue', 'Sample issue')}`, desc: t('サンプルのコメントです。', 'A sample comment.') };
    case 'create':
      return { title: `🌿 ${t('ブランチが作成されました', 'branch created')}: feature/sample`, desc: '' };
    case 'delete':
      return { title: `🌿 ${t('ブランチが削除されました', 'branch deleted')}: feature/sample`, desc: '' };
    case 'fork':
      return { title: `🍴 ${t('フォークされました', 'Forked')}: someone/${r}`, desc: '' };
    case 'star':
      return { title: `⭐ ${t('スターが付きました', 'New star')}`, desc: `${t('合計', 'Total')}: 42` };
    default:
      return { title: `✅ CI: success`, desc: '`main` サンプル: ビルド' };
  }
}

function MentionLine({ form, roleById, names }) {
  const items = [
    ...(form.mention_everyone ? [{ key: 'e', text: '@everyone' }] : []),
    ...(form.mention_here ? [{ key: 'h', text: '@here' }] : []),
    ...form.mention_role_ids.map((id) => ({ key: id, text: '@' + (roleById[id]?.name || 'ロール'), color: roleById[id]?.color })),
    ...form.mention_user_ids.map((id) => ({ key: id, text: '@' + (names[id]?.name || 'ユーザー') })),
  ];
  if (!items.length) return null;
  return (
    <div className="mline">
      {items.map((m) => (
        <span key={m.key} className="mention" style={m.color ? { color: m.color } : undefined}>
          {m.text}
        </span>
      ))}
    </div>
  );
}

function Preview({ form, meta, names }) {
  const d = form.display;
  const t = L[d.language === 'en' ? 'en' : 'ja'];
  const packSources = form.sources.filter(isPolled);
  const ghSources = form.sources.filter((s) => !isPolled(s));
  const showPack = packSources.length > 0 || ghSources.length === 0;
  const plats = [...new Set(packSources.map((s) => s.platform))];
  const shown = plats.length ? plats : ['modrinth', 'curseforge'];
  const icon = packSources.find((s) => s.iconUrl)?.iconUrl;
  const roleById = Object.fromEntries(meta.roles.map((r) => [r.id, r]));
  const changelog = d.changelog_max_chars <= 0 ? '' : SAMPLE_CHANGELOG.length > d.changelog_max_chars ? SAMPLE_CHANGELOG.slice(0, Math.max(0, d.changelog_max_chars - 1)).trimEnd() + '…' : SAMPLE_CHANGELOG;
  const vtypes = form.filters.version_types.length ? form.filters.version_types : ['release'];
  const emoji = { release: '🟢', beta: '🟡', alpha: '🔴' };
  const name = form.name.trim() || 'プロジェクト名';
  const loaders = form.filters.loaders.length ? form.filters.loaders.map(loaderLabel) : ['Fabric', 'NeoForge'];
  const gvs = form.filters.game_versions.length ? form.filters.game_versions : ['1.21.4', '1.21.3'];
  const color = isHex(form.color) ? form.color : '#5865F2';

  return (
    <div className="preview card">
      <h3>プレビュー</h3>
      <p className="muted small">実際の通知メッセージのイメージです(内容はサンプル)。</p>

      {showPack && (
        <div className="dmsg">
          <div className="bot-av">🔔</div>
          <div className="dbody">
            <div className="dhead">
              <strong>更新おしらせボット</strong> <span className="dtag">BOT</span> <span className="muted small">今日 12:00</span>
            </div>
            <MentionLine form={form} roleById={roleById} names={names} />
            <div className="embed" style={{ borderLeftColor: color }}>
              {d.show_icon && <div className="thumb">{icon ? <img src={icon} alt="" /> : <span>🧱</span>}</div>}
              <div className="etitle">{name} 1.2.3</div>
              {d.show_changelog && changelog && <div className="edesc">{changelog}</div>}
              <div className="efields">
                {d.show_version_type && (
                  <div className="ef">
                    <b>{t.vt}</b>
                    {vtypes.map((v) => `${emoji[v]} ${t[v === 'release' ? 'rel' : v]}`).join(' / ')}
                  </div>
                )}
                {d.show_loaders && (
                  <div className="ef">
                    <b>{t.ld}</b>
                    {loaders.join(', ')}
                  </div>
                )}
                {d.show_game_versions && (
                  <div className="ef">
                    <b>{t.gv}</b>
                    {gvs.join(', ')}
                  </div>
                )}
                {d.show_downloads && (
                  <div className="ef">
                    <b>{t.dl}</b>
                    {shown.map((p, i) => (
                      <div key={p}>
                        {PNAME[p]}: {(i ? 2345678 : 1234567).toLocaleString('en-US')}
                      </div>
                    ))}
                  </div>
                )}
                {d.show_dependencies && (
                  <div className="ef full">
                    <b>{t.dep}</b>
                    <span>
                      <b className="inl">{t.req}</b>: <span className="link">Fabric API</span>
                    </span>
                  </div>
                )}
                {d.show_project_links && (
                  <div className="ef full">
                    <b>{t.pl}</b>
                    <span>
                      <span className="link">Wiki</span> · <span className="link">{d.language === 'en' ? 'Source' : 'ソースコード'}</span> · <span className="link">Discord</span>
                    </span>
                  </div>
                )}
                {d.show_links && (
                  <div className="ef full">
                    <b>{t.ln}</b>
                    {shown.map((p) => (
                      <div key={p}>
                        <b className="inl">{PNAME[p]}</b> <span className="link">{t.ver}</span> · <span className="link">{t.pr}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="efoot">{shown.map((p) => PNAME[p]).join(' + ')}</div>
            </div>
          </div>
        </div>
      )}

      {ghSources.map((s) => {
        const ev = s.config?.events?.[0] || 'push';
        const sm = GhSample(ev, s.external_id, d.language !== 'en');
        const evLabel = GH_EVENTS.find((e) => e[0] === ev)?.[1];
        return (
          <div key={s.external_id} className="dmsg">
            <div className="bot-av">🔔</div>
            <div className="dbody">
              <div className="dhead">
                <strong>更新おしらせボット</strong> <span className="dtag">BOT</span> <span className="muted small">今日 12:00</span>
              </div>
              <MentionLine form={form} roleById={roleById} names={names} />
              <div className="embed gh" style={{ borderLeftColor: color }}>
                <div className="eauthor">
                  <img src={`https://github.com/${s.external_id.split('/')[0]}.png`} alt="" /> {s.external_id.split('/')[0]}
                </div>
                <div className="etitle">{sm.title}</div>
                {sm.desc && <div className="edesc">{sm.desc}</div>}
                <div className="efoot">{s.external_id}</div>
              </div>
              {evLabel && <p className="muted small">例: 「{evLabel}」の通知</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
