import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, go, useAsync, useDebounced } from './lib.js';
import { toast, Switch, Chip, Section, Field, Spinner, PlatformBadge, fmtNum } from './ui.jsx';

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
const VTYPES = [
  ['release', 'リリース', '🟢'],
  ['beta', 'ベータ', '🟡'],
  ['alpha', 'アルファ', '🔴'],
];
const MAX_SOURCES = 6;
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
};
const LOADER_LABEL = { neoforge: 'NeoForge', liteloader: 'LiteLoader', bungeecord: 'BungeeCord', optifine: 'OptiFine' };
const loaderLabel = (n) => LOADER_LABEL[n] || n.charAt(0).toUpperCase() + n.slice(1);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isNaN(Number(n)) ? lo : Math.round(Number(n))));
const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
const isSnowflake = (v) => /^\d{15,25}$/.test(v.trim());

function defaultForm(options) {
  return {
    name: '',
    channel_id: '',
    color: PRESETS[Math.floor(Math.random() * PRESETS.length)],
    enabled: true,
    merge_platforms: true,
    merge_wait_minutes: options?.defaults?.merge_wait_minutes ?? 15,
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
    merge_wait_minutes: p.merge_wait_minutes,
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
      name: s.display_name,
      iconUrl: s.icon_url,
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
    merge_wait_minutes: clamp(f.merge_wait_minutes, 0, 120),
    mention_role_ids: f.mention_role_ids,
    mention_user_ids: f.mention_user_ids,
    filters: f.filters,
    display: { ...f.display, changelog_max_chars: clamp(f.display.changelog_max_chars, 0, 3500) },
    sources: f.sources.map((s) => ({ platform: s.platform, external_id: s.external_id })),
  };
}
function validate(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'プロジェクト名を入力してください';
  if (!f.channel_id) e.channel_id = '通知を送るチャンネルを選んでください';
  if (f.sources.length === 0) e.sources = '通知元を1つ以上追加してください';
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
  const [names, setNames] = useState({}); // ユーザーID → 表示名(検索で見つかったもの)
  const dirty = JSON.stringify(form) !== initial.current;

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, ...(k === 'channel_id' ? {} : {}) }));
  };
  const setDisplay = (k, v) => setForm((f) => ({ ...f, display: { ...f.display, [k]: v } }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, filters: { ...f.filters, [k]: v } }));

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
      const first = document.querySelector('.ferr');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      const { sources, enabled, mention_role_ids, mention_user_ids, ...rest } = formToInput(form);
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
          <SourcesSection form={form} set={set} error={errors.sources} />
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
        <button
          className="btn"
          onClick={sendTest}
          disabled={!pid || busy !== ''}
          title={pid ? '' : '先に保存するとテスト送信できます'}
        >
          {busy === 'test' ? '送信中…' : '🧪 テスト送信'}
        </button>
        <button className="btn primary" onClick={save} disabled={busy !== ''}>
          {busy === 'save' ? '保存中…' : '保存'}
        </button>
      </div>
      {!pid && <p className="muted small center nopad">※ テスト送信は、一度保存したあとで使えます。</p>}
    </>
  );
}

/* ================= 基本 ================= */
function BasicSection({ form, set, errors, channels }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of channels) {
      const k = c.category || 'カテゴリなし';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    return [...m.entries()];
  }, [channels]);
  return (
    <Section id="basic" icon="⚙️" title="基本" desc="プロジェクトの名前と、通知を送る場所を決めます。">
      <Field label="プロジェクト名" required error={errors.name} hint="通知メッセージのタイトルに使われます。例: Sodium">
        <input value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="例: Sodium" />
      </Field>
      <Field
        label="通知チャンネル"
        required
        error={errors.channel_id}
        hint="更新のお知らせを送るチャンネルです。🔒がついたチャンネルにはボットが書き込めません。"
      >
        <select value={form.channel_id} onChange={(e) => set('channel_id', e.target.value)}>
          <option value="">チャンネルを選んでください</option>
          {groups.map(([cat, list]) => (
            <optgroup key={cat} label={cat}>
              {list.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.canSend}>
                  {c.canSend ? '# ' : '🔒 '}
                  {c.name}
                  {c.canSend ? '' : '(ボットに権限がありません)'}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
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
          <input
            type="color"
            className="colorpick"
            value={isHex(form.color) ? form.color : '#5865F2'}
            onChange={(e) => set('color', e.target.value.toUpperCase())}
            aria-label="色を自由に選ぶ"
          />
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
function SourcesSection({ form, set, error }) {
  const [platform, setPlatform] = useState('modrinth');
  const [type, setType] = useState('mod');
  const [q, setQ] = useState('');
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
    set('sources', [...form.sources, { platform: it.platform, external_id: it.id, name: it.name, iconUrl: it.iconUrl }]);
  }

  return (
    <Section
      id="sources"
      icon="🔎"
      title="通知元"
      desc="更新を知らせたい作品を検索して追加します。同じ作品がModrinthとCurseForgeの両方にある場合は、両方追加すると1つのプロジェクトとして扱えます。"
    >
      {error && (
        <p className="ferr" role="alert">
          {error}
        </p>
      )}
      <div className="chosen">
        {form.sources.length === 0 && <p className="muted small">まだ追加されていません</p>}
        {form.sources.map((s) => (
          <div key={s.platform + s.external_id} className="src">
            {s.iconUrl ? <img src={s.iconUrl} alt="" /> : <span className="src-ph" />}
            <span className="src-name">{s.name || s.external_id}</span>
            <PlatformBadge platform={s.platform} />
            <button
              type="button"
              className="x"
              aria-label={`${s.name}を外す`}
              onClick={() => set('sources', form.sources.filter((x) => x !== s))}
            >
              ×
            </button>
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
        {platform !== 'github' && (
          <select className="short" value={type} onChange={(e) => setType(e.target.value)} aria-label="種類">
            {TYPES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        <input
          className="grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={platform === 'github' ? 'owner/repo か GitHub のURLを入力' : '名前で検索(空欄なら人気順)'}
        />
      </div>
      {platform === 'curseforge' && <p className="hint">CurseForgeの検索には、ボット側でAPIキーの設定が必要です。</p>}
      <div className="results" aria-busy={res.loading}>
        {res.loading && <p className="muted small">検索中…</p>}
        {res.error && <p className="ferr">{res.error}</p>}
        {!res.loading && !res.error && res.items.length === 0 && <p className="muted small">{platform === 'github' ? 'リポジトリを入力してください' : '見つかりませんでした'}</p>}
        {res.items.map((it) => (
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
  const platCount = new Set(form.sources.map((s) => s.platform)).size;
  return (
    <Section id="merge" icon="🧩" title="まとめ表示" desc="ModrinthとCurseForgeなど、複数のサイトの通知を1つのメッセージにまとめます。">
      <div className="switchrow">
        <div>
          <strong>複数サイトの通知を1つにまとめる</strong>
          <p className="hint">
            {platCount > 1
              ? '同じバージョンが両方に公開されたら、1つのメッセージで知らせます。'
              : '通知元に2つ以上のサイトを追加すると効果があります。'}
          </p>
        </div>
        <Switch checked={form.merge_platforms} onChange={(v) => set('merge_platforms', v)} label="複数サイトの通知を1つにまとめる" />
      </div>
      {form.merge_platforms && (
        <Field label="他のサイトを待つ時間(分)" hint="サイトによって公開のタイミングが違うため、片方だけ先に公開されたとき、この時間だけ待ってから通知します。0なら待ちません。">
          <input
            type="number"
            min={0}
            max={120}
            className="short"
            value={form.merge_wait_minutes}
            onChange={(e) => set('merge_wait_minutes', e.target.value === '' ? '' : clamp(e.target.value, 0, 120))}
          />
        </Field>
      )}
    </Section>
  );
}

/* ================= 絞り込み ================= */
function FiltersSection({ form, setFilter, options }) {
  const [vq, setVq] = useState('');
  const [snap, setSnap] = useState(false);
  const f = form.filters;
  const toggle = (key, val) => setFilter(key, f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val]);
  const all = useMemo(() => (snap ? [...options.gameVersions, ...options.snapshots] : options.gameVersions), [options, snap]);
  const list = all.filter((v) => v.toLowerCase().includes(vq.trim().toLowerCase())).slice(0, 80);
  const custom = vq.trim();
  const canAddCustom = custom && !f.game_versions.includes(custom) && !all.includes(custom);

  return (
    <Section id="filters" icon="🎯" title="絞り込み" desc="条件に合わない更新は通知されません。何も選ばなければ、すべて通知します。">
      <Field label="ゲームのバージョン" hint="例: 1.21.4。「1.21.*」のように * を使うと 1.21 系をまとめて指定できます(入力して Enter)。">
        <div className="chips">
          {f.game_versions.map((v) => (
            <span key={v} className="rchip">
              {v}
              <button type="button" aria-label={`${v}を外す`} onClick={() => toggle('game_versions', v)}>
                ×
              </button>
            </span>
          ))}
          {f.game_versions.length === 0 && <span className="muted small">すべてのバージョン</span>}
        </div>
        <input
          value={vq}
          onChange={(e) => setVq(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canAddCustom) {
              e.preventDefault();
              toggle('game_versions', custom);
              setVq('');
            }
          }}
          placeholder="バージョンを検索 / 入力して Enter で追加"
        />
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> スナップショットも表示する
        </label>
        <div className="verlist" role="group" aria-label="バージョン一覧">
          {canAddCustom && (
            <button type="button" className="ver add" onClick={() => { toggle('game_versions', custom); setVq(''); }}>
              「{custom}」を追加
            </button>
          )}
          {list.map((v) => (
            <button key={v} type="button" aria-pressed={f.game_versions.includes(v)} className={'ver' + (f.game_versions.includes(v) ? ' sel' : '')} onClick={() => toggle('game_versions', v)}>
              {v}
            </button>
          ))}
        </div>
      </Field>

      <Field label="ローダー" hint="選んだローダー向けの更新だけを通知します。">
        <div className="chips">
          {[...new Set([...options.loaders.map((l) => l.name), ...f.loaders])].map((name) => (
            <Chip key={name} selected={f.loaders.includes(name)} onClick={() => toggle('loaders', name)}>
              {loaderLabel(name)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="バージョンタイプ" hint="リリース=正式版 / ベータ=テスト版 / アルファ=開発中の版。リリースだけにすると、テスト版の通知を減らせます。">
        <div className="chips">
          {VTYPES.map(([id, label, emoji]) => (
            <Chip key={id} selected={f.version_types.includes(id)} onClick={() => toggle('version_types', id)}>
              {emoji} {label}
            </Chip>
          ))}
        </div>
      </Field>
    </Section>
  );
}

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
  const toggleRole = (id) =>
    set('mention_role_ids', form.mention_role_ids.includes(id) ? form.mention_role_ids.filter((x) => x !== id) : [...form.mention_role_ids, id]);
  const addUser = (m) => {
    setNames((n) => ({ ...n, [m.id]: m.displayName || m.username }));
    if (!form.mention_user_ids.includes(m.id)) set('mention_user_ids', [...form.mention_user_ids, m.id]);
  };

  return (
    <Section id="mentions" icon="📣" title="メンション" desc="更新のお知らせと一緒に、知らせたいロールや人に通知(メンション)を送ります。">
      <div className="chips">
        {form.mention_role_ids.length + form.mention_user_ids.length === 0 && <span className="muted small">メンションなし</span>}
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
            @{names[id] || `ユーザー(${id.slice(-4)})`}
            <button type="button" aria-label="外す" onClick={() => set('mention_user_ids', form.mention_user_ids.filter((x) => x !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>

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
            <button key={m.id} type="button" className={'ver' + (form.mention_user_ids.includes(m.id) ? ' sel' : '')} onClick={() => addUser(m)}>
              {m.displayName}
              <span className="muted small"> @{m.username}</span>
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
const TOGGLES = [
  ['show_changelog', 'チェンジログ(更新内容)'],
  ['show_version_type', 'バージョンタイプ'],
  ['show_loaders', 'ローダー'],
  ['show_game_versions', '対応バージョン'],
  ['show_dependencies', '依存関係'],
  ['show_icon', 'アイコン'],
  ['show_downloads', 'ダウンロード数'],
  ['show_links', 'リンク'],
];
function DisplaySection({ form, setDisplay }) {
  const d = form.display;
  return (
    <Section id="display" icon="🎨" title="表示設定" desc="通知メッセージに表示する内容を選びます。右側のプレビューにすぐ反映されます。">
      <div className="toggles">
        {TOGGLES.map(([k, label]) => (
          <div key={k} className="switchrow compact">
            <span>{label}</span>
            <Switch checked={d[k]} onChange={(v) => setDisplay(k, v)} label={label} />
          </div>
        ))}
      </div>
      <Field label="チェンジログの最大文字数" hint="長い更新内容はここで切り詰めます。0〜3500文字。">
        <div className="row">
          <input type="range" min={0} max={3500} step={50} className="grow" value={d.changelog_max_chars} onChange={(e) => setDisplay('changelog_max_chars', Number(e.target.value))} disabled={!d.show_changelog} />
          <input type="number" min={0} max={3500} className="short" value={d.changelog_max_chars} onChange={(e) => setDisplay('changelog_max_chars', e.target.value === '' ? '' : clamp(e.target.value, 0, 3500))} disabled={!d.show_changelog} />
        </div>
      </Field>
      <Field label="メッセージの言語" hint="通知メッセージ内の項目名(「ローダー」など)の言語です。">
        <select className="short" value={d.language} onChange={(e) => setDisplay('language', e.target.value)}>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
      </Field>
    </Section>
  );
}

/* ================= Discord風プレビュー ================= */
const SAMPLE_CHANGELOG =
  '## 変更点\n- 新しい設定画面を追加しました\n- パフォーマンスを改善しました(最大20%高速化)\n- いくつかのクラッシュを修正しました\n\n## 既知の問題\n- 一部のシェーダーで表示が乱れることがあります。次のバージョンで修正予定です。';
const L = {
  ja: { vt: 'バージョンタイプ', ld: 'ローダー', gv: '対応バージョン', dl: 'ダウンロード数', dep: '依存関係', req: '必須', ln: 'リンク', ver: 'このバージョン', pr: 'プロジェクト', rel: 'リリース', beta: 'ベータ', alpha: 'アルファ' },
  en: { vt: 'Version type', ld: 'Loaders', gv: 'Game versions', dl: 'Downloads', dep: 'Dependencies', req: 'Required', ln: 'Links', ver: 'This version', pr: 'Project', rel: 'Release', beta: 'Beta', alpha: 'Alpha' },
};
const PNAME = { modrinth: 'Modrinth', curseforge: 'CurseForge', github: 'GitHub' };

function Preview({ form, meta, names }) {
  const d = form.display;
  const t = L[d.language === 'en' ? 'en' : 'ja'];
  const plats = [...new Set(form.sources.map((s) => s.platform))];
  const shown = plats.length ? plats : ['modrinth', 'curseforge'];
  const icon = form.sources.find((s) => s.iconUrl)?.iconUrl;
  const roleById = Object.fromEntries(meta.roles.map((r) => [r.id, r]));
  const mentions = [
    ...form.mention_role_ids.map((id) => ({ key: id, text: '@' + (roleById[id]?.name || 'ロール'), color: roleById[id]?.color })),
    ...form.mention_user_ids.map((id) => ({ key: id, text: '@' + (names[id] || 'ユーザー') })),
  ];
  const changelog = d.changelog_max_chars <= 0 ? '' : SAMPLE_CHANGELOG.length > d.changelog_max_chars ? SAMPLE_CHANGELOG.slice(0, Math.max(0, d.changelog_max_chars - 1)).trimEnd() + '…' : SAMPLE_CHANGELOG;
  const vtypes = form.filters.version_types.length ? form.filters.version_types : ['release'];
  const emoji = { release: '🟢', beta: '🟡', alpha: '🔴' };
  const name = form.name.trim() || 'プロジェクト名';
  const loaders = form.filters.loaders.length ? form.filters.loaders.map(loaderLabel) : ['Fabric', 'NeoForge'];
  const gvs = form.filters.game_versions.length ? form.filters.game_versions : ['1.21.4', '1.21.3'];

  return (
    <div className="preview card">
      <h3>プレビュー</h3>
      <p className="muted small">実際の通知メッセージのイメージです(内容はサンプル)。</p>
      <div className="dmsg">
        <div className="bot-av">🔔</div>
        <div className="dbody">
          <div className="dhead">
            <strong>更新おしらせボット</strong> <span className="dtag">BOT</span> <span className="muted small">今日 12:00</span>
          </div>
          {mentions.length > 0 && (
            <div className="mline">
              {mentions.map((m) => (
                <span key={m.key} className="mention" style={m.color ? { color: m.color } : undefined}>
                  {m.text}
                </span>
              ))}
            </div>
          )}
          <div className="embed" style={{ borderLeftColor: isHex(form.color) ? form.color : '#5865F2' }}>
            {d.show_icon && <div className="thumb">{icon ? <img src={icon} alt="" /> : <span>🧱</span>}</div>}
            <div className="etitle">
              {name} 1.2.3
            </div>
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
                  {shown.filter((p) => p !== 'github').map((p, i) => (
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
    </div>
  );
}
