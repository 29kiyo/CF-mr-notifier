import { useEffect, useState } from 'react';

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
