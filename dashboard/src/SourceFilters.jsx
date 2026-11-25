import { useEffect, useMemo, useState } from 'react';
import { api } from './lib.js';
import { Chip, Switch } from './ui.jsx';
import { withLineChips, isLineChip } from './versionLines.js';

const LOADER_LABEL = { neoforge: 'NeoForge', liteloader: 'LiteLoader', bungeecord: 'BungeeCord', optifine: 'OptiFine' };
const loaderLabel = (n) => LOADER_LABEL[n] || n.charAt(0).toUpperCase() + n.slice(1);

// 追加した作品ごとに、ローダー・ゲームバージョンを個別に指定する。
// 指定しない項目は、全体の「絞り込み」の設定がそのまま使われる。
export default function SourceFilters({ s, onChange, globalFilters, options }) {
  const own = { loaders: [], game_versions: [], ...(s.config?.filters || {}) };
  const [open, setOpen] = useState(own.loaders.length > 0 || own.game_versions.length > 0);
  const [vq, setVq] = useState('');
  const [rel, setRel] = useState({ loading: false, known: false, loaders: [], gameVersions: [] });

  // この作品が対応しているローダー・バージョンを取得する
  useEffect(() => {
    if (!open) return;
    let dead = false;
    setRel((r) => ({ ...r, loading: true }));
    api('/api/sources/options', { method: 'POST', body: { sources: [{ platform: s.platform, external_id: s.external_id }] } })
      .then((d) => !dead && setRel({ loading: false, known: !!d.known, loaders: d.loaders || [], gameVersions: d.gameVersions || [] }))
      .catch(() => !dead && setRel({ loading: false, known: false, loaders: [], gameVersions: [] }));
    return () => {
      dead = true;
    };
  }, [open, s.platform, s.external_id]);

  const set = (patch) => onChange({ config: { ...(s.config || {}), filters: { ...own, ...patch } } });
  const toggle = (key, val) => set({ [key]: own[key].includes(val) ? own[key].filter((x) => x !== val) : [...own[key], val] });
  const turn = (on) => {
    setOpen(on);
    if (!on) set({ loaders: [], game_versions: [] });
  };

  const releaseSet = useMemo(() => new Set(options.gameVersions), [options]);
  const versions = useMemo(() => (rel.known ? rel.gameVersions.filter((v) => releaseSet.has(v)) : options.gameVersions), [rel, options, releaseSet]);
  const loaderNames = useMemo(() => {
    const global = options.loaders.map((l) => l.name);
    if (!rel.known) return global;
    return [...global.filter((n) => rel.loaders.includes(n)), ...rel.loaders.filter((n) => !global.includes(n))];
  }, [rel, options]);

  const list = withLineChips(versions).filter((v) => v.toLowerCase().includes(vq.trim().toLowerCase())).slice(0, 80);
  const custom = vq.trim();
  const canAddCustom = custom && !own.game_versions.includes(custom) && !versions.includes(custom);
  const summary = (arr, empty) => (arr.length ? arr.join(', ') : empty);

  return (
    <div className="srcfilter">
      <div className="switchrow compact">
        <span>
          <strong>この作品だけ、ローダー・バージョンを指定する</strong>
          <span className="hint" style={{ display: 'block' }}>
            {open ? '指定しない項目は、下の「絞り込み」(全体)の設定が使われます。' : `指定なし(全体の絞り込みを使用 — ローダー: ${summary(globalFilters.loaders.map(loaderLabel), 'すべて')} / バージョン: ${summary(globalFilters.game_versions, 'すべて')})`}
          </span>
        </span>
        <Switch checked={open} onChange={turn} label={`${s.name || s.external_id}を個別に指定する`} />
      </div>

      {open && (
        <div className="srcfilter-body">
          {rel.loading && <p className="muted small">この作品が対応しているものを調べています…</p>}
          <div className="flabel">ローダー {own.loaders.length === 0 && <span className="muted">(未指定 = 全体の設定)</span>}</div>
          <div className="chips">
            {rel.known && loaderNames.length === 0 && own.loaders.length === 0 && <span className="muted small">この作品にはローダーの情報がありません</span>}
            {[...new Set([...loaderNames, ...own.loaders])].map((name) => (
              <Chip key={name} selected={own.loaders.includes(name)} onClick={() => toggle('loaders', name)}>
                {loaderLabel(name)}
              </Chip>
            ))}
          </div>

          <div className="flabel">ゲームのバージョン {own.game_versions.length === 0 && <span className="muted">(未指定 = 全体の設定)</span>}</div>
          <div className="chips">
            {own.game_versions.map((v) => (
              <span key={v} className="rchip">
                {v}
                <button type="button" aria-label={`${v}を外す`} onClick={() => toggle('game_versions', v)}>
                  ×
                </button>
              </span>
            ))}
            {own.game_versions.length === 0 && <span className="muted small">指定なし</span>}
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
            placeholder="バージョンを検索 / 「26.1.x」のように入力して Enter で追加"
          />
          <div className="verlist" role="group" aria-label={`${s.name || s.external_id}のバージョン一覧`}>
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
              <button key={v} type="button" aria-pressed={own.game_versions.includes(v)} className={'ver' + (own.game_versions.includes(v) ? ' sel' : '') + (isLineChip(v) ? ' linechip' : '')} onClick={() => toggle('game_versions', v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
