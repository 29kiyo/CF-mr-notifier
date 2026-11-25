import { useEffect, useMemo, useState } from 'react';
import { api } from './lib.js';
import { Chip, Section, Field } from './ui.jsx';

const VTYPES = [
  ['release', 'リリース', '🟢'],
  ['beta', 'ベータ', '🟡'],
  ['alpha', 'アルファ', '🔴'],
];
const LOADER_LABEL = { neoforge: 'NeoForge', liteloader: 'LiteLoader', bungeecord: 'BungeeCord', optifine: 'OptiFine' };
const loaderLabel = (n) => LOADER_LABEL[n] || n.charAt(0).toUpperCase() + n.slice(1);
const isPack = (s) => s.platform === 'modrinth' || s.platform === 'curseforge';
const isPolled = (s) => s.platform !== 'github' || s.config?.mode === 'release';

/* ================= 絞り込み ================= */
// 追加したModrinth・CurseForgeの作品が対応しているローダー・バージョンだけを候補に出す。
// 作品を追加していないときは、すべて表示する。
export default function FiltersSection({ form, setFilter, options }) {
  const [vq, setVq] = useState('');
  const [snap, setSnap] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const f = form.filters;
  const onlyGithub = form.sources.length > 0 && form.sources.every((s) => !isPolled(s));

  // 追加した作品が対応しているローダー・バージョンを取得する
  const packs = form.sources.filter(isPack);
  const packKey = packs.map((s) => `${s.platform}:${s.external_id}`).sort().join(',');
  const [rel, setRel] = useState({ loading: false, known: false, loaders: [], gameVersions: [] });
  useEffect(() => {
    if (!packKey) {
      setRel({ loading: false, known: false, loaders: [], gameVersions: [] });
      return;
    }
    let dead = false;
    setRel((r) => ({ ...r, loading: true }));
    api('/api/sources/options', { method: 'POST', body: { sources: packs.map((s) => ({ platform: s.platform, external_id: s.external_id })) } })
      .then((d) => !dead && setRel({ loading: false, known: !!d.known, loaders: d.loaders || [], gameVersions: d.gameVersions || [] }))
      .catch(() => !dead && setRel({ loading: false, known: false, loaders: [], gameVersions: [] }));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packKey]);

  const narrowed = rel.known && !showAll;
  const releaseSet = useMemo(() => new Set(options.gameVersions), [options]);
  const relVersionSet = useMemo(() => new Set(rel.gameVersions), [rel]);

  const all = useMemo(() => {
    if (narrowed) return snap ? rel.gameVersions : rel.gameVersions.filter((v) => releaseSet.has(v));
    return snap ? [...options.gameVersions, ...options.snapshots] : options.gameVersions;
  }, [narrowed, snap, rel, options, releaseSet]);

  const loaderNames = useMemo(() => {
    const global = options.loaders.map((l) => l.name);
    if (!narrowed) return global;
    const known = global.filter((n) => rel.loaders.includes(n));
    return [...known, ...rel.loaders.filter((n) => !global.includes(n))];
  }, [narrowed, rel, options]);

  const toggle = (key, val) => setFilter(key, f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val]);
  const list = all.filter((v) => v.toLowerCase().includes(vq.trim().toLowerCase())).slice(0, 80);
  const custom = vq.trim();
  const canAddCustom = custom && !f.game_versions.includes(custom) && !all.includes(custom);

  // 選択中だが、追加した作品が対応していないもの
  const stale = narrowed
    ? [...f.loaders.filter((l) => !rel.loaders.includes(l)).map(loaderLabel), ...f.game_versions.filter((v) => !v.includes('*') && !relVersionSet.has(v))]
    : [];

  return (
    <Section
      id="filters"
      icon="🎯"
      title="絞り込み"
      desc={onlyGithub ? 'この絞り込みはModrinth・CurseForgeの通知用です(GitHubのブランチ指定は「通知元」で設定します)。' : '条件に合わない更新は通知されません。何も選ばなければ、すべて通知します。(Modrinth・CurseForge用)'}
    >
      {packKey && (
        <div className="relnote" role="status">
          {rel.loading && <span>追加した作品に合わせて、候補を絞り込んでいます…</span>}
          {!rel.loading && rel.known && (
            <>
              <span>追加した作品が対応している、ローダーとバージョンだけを表示しています。</span>
              <label className="check">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> すべて表示する
              </label>
            </>
          )}
          {!rel.loading && !rel.known && <span>作品の情報を取得できなかったため、すべて表示しています。</span>}
        </div>
      )}
      {stale.length > 0 && (
        <p className="alert" role="alert">
          ⚠ 次の選択は、追加した作品が対応していないため、通知されない可能性があります: {stale.join('、')}
        </p>
      )}

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
            <button
              type="button"
              className="ver add"
              onClick={() => {
                toggle('game_versions', custom);
                setVq('');
              }}
            >
              「{custom}」を追加
            </button>
          )}
          {list.length === 0 && !canAddCustom && <span className="muted small">該当するバージョンがありません</span>}
          {list.map((v) => (
            <button key={v} type="button" aria-pressed={f.game_versions.includes(v)} className={'ver' + (f.game_versions.includes(v) ? ' sel' : '')} onClick={() => toggle('game_versions', v)}>
              {v}
            </button>
          ))}
        </div>
      </Field>

      <Field label="ローダー" hint="選んだローダー向けの更新だけを通知します。">
        <div className="chips">
          {narrowed && loaderNames.length === 0 && f.loaders.length === 0 && <span className="muted small">この作品にはローダーの情報がありません</span>}
          {[...new Set([...loaderNames, ...f.loaders])].map((name) => (
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
