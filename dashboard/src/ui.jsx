import { Fragment, useEffect, useRef, useState } from 'react';

/* ---------- トースト ---------- */
const toasts = [];
const subs = new Set();
const notify = () => subs.forEach((f) => f());
export function toast(text, kind = 'info') {
  const t = { id: Math.random(), text, kind };
  toasts.push(t);
  notify();
  setTimeout(() => {
    const i = toasts.indexOf(t);
    if (i >= 0) toasts.splice(i, 1);
    notify();
  }, 4500);
}
export function Toaster() {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- 部品 ---------- */
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={'switch' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Chip({ selected, onClick, children }) {
  return (
    <button type="button" aria-pressed={selected} className={'chip' + (selected ? ' sel' : '')} onClick={onClick}>
      {children}
    </button>
  );
}

export function Section({ id, icon, title, desc, children }) {
  return (
    <section id={id} className="card section">
      <h2>
        <span className="sec-icon" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {desc && <p className="muted">{desc}</p>}
      <div className="stack">{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, required, children }) {
  return (
    <div className="field">
      <label className="flabel">
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="ferr" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="hint">{hint}</p>
      )}
    </div>
  );
}

export function Spinner({ text }) {
  return (
    <div className="center-pad">
      <div className="spin" />
      {text && <p className="muted">{text}</p>}
    </div>
  );
}

export function GuildIcon({ name, url, size = 48 }) {
  const style = { width: size, height: size, fontSize: size * 0.36 };
  if (url) return <img className="gicon" style={style} src={url} alt="" loading="lazy" />;
  return (
    <span className="gicon ph" style={style} aria-hidden>
      {Array.from(name || '?').slice(0, 2).join('')}
    </span>
  );
}

export function Avatar({ name, url, size = 28 }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (url) return <img className="av" style={style} src={url} alt="" loading="lazy" />;
  return (
    <span className="av ph" style={style} aria-hidden>
      {Array.from(name || '?')[0]}
    </span>
  );
}

export function PlatformBadge({ platform }) {
  const label = { modrinth: 'Modrinth', curseforge: 'CurseForge', github: 'GitHub' }[platform] || platform;
  return <span className={'pbadge ' + platform}>{label}</span>;
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'コピー' }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch {
      toast('コピーできませんでした。手動で選択してコピーしてください', 'error');
    }
  }
  return (
    <button type="button" className="btn small" onClick={copy}>
      {ok ? '✓ コピーしました' : label}
    </button>
  );
}

/* ---------- 角の丸いプルダウン(標準の選択ボックスの代わり) ---------- */
// options: [{ value, label, disabled?, group? }]
export function Select({ value, onChange, options, placeholder = '選んでください', ariaLabel, className = '', disabled }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  const root = useRef(null);
  const pop = useRef(null);
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const f = (e) => {
      if (root.current && !root.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) pop.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function toggle() {
    if (disabled) return;
    if (!open) {
      const r = root.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      setUp(below < 300 && r.top > below);
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    }
    setOpen((o) => !o);
  }
  function pick(i) {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    root.current?.querySelector('button')?.focus();
  }
  function move(dir) {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) return setActive(i);
    }
  }
  function onKey(e) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), pick(active));
    else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div className={'select ' + className} ref={root}>
      <button type="button" className="select-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={toggle} onKeyDown={onKey}>
        <span className={'select-val' + (cur ? '' : ' ph')}>{cur ? cur.label : placeholder}</span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={'select-pop' + (up ? ' up' : '')} role="listbox" ref={pop}>
          {options.map((o, i) => (
            <Fragment key={String(o.value)}>
              {o.group && o.group !== options[i - 1]?.group && (
                <li className="select-group" role="presentation">
                  {o.group}
                </li>
              )}
              <li
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                data-i={i}
                className={'select-opt' + (o.value === value ? ' sel' : '') + (i === active ? ' act' : '') + (o.disabled ? ' dis' : '')}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                {o.label}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

export const fmtNum = (n) => (n == null ? '-' : Number(n).toLocaleString('ja-JP'));
export function fmtRelative(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`;
  return d.toLocaleDateString('ja-JP');
}
