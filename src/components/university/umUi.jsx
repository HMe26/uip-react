import { cloneElement, isValidElement, useId } from 'react';
import Icon from '../Icon';

/** Shared bits for the university management pages (um- styles → styles/css/university-manage.css). */

/** Stable accent hue (0–5) per record, so a faculty keeps its colour everywhere. */
export const hueOf = (id) => String(Math.abs(parseInt(id, 10) || 0) % 6);

export const initialOf = (name) => (name || '').trim().charAt(0).toUpperCase() || '؟';

export function Pill({ tone = 'muted', dot = true, children }) {
  return <span className={`um-pill${dot ? ' um-pill--dot' : ''}`} data-tone={tone}>{children}</span>;
}

/** Monogram tile — shows the logo when there is one, else the first letter. */
export function Mono({ name, src, hue = '0', size = '' }) {
  return (
    <span className={`um-mono${size ? ` um-mono--${size}` : ''}`} data-hue={hue} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initialOf(name)}
    </span>
  );
}

/** Stat tile; becomes a filter button when `onClick` is given. */
export function Stat({ icon, value, label, tone = 'primary', active, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  const extra = onClick ? { type: 'button', onClick, 'aria-pressed': !!active } : {};
  return (
    <Tag className={`um-stat${active ? ' is-active' : ''}`} data-tone={tone} {...extra}>
      <span className="um-stat__ico"><Icon name={icon} size={20} /></span>
      <span className="um-stat__txt"><b>{value ?? 0}</b><span>{label}</span></span>
    </Tag>
  );
}

/** tone: 'danger' (default) | 'ok' | 'warn' */
export function Alert({ tone = 'danger', children }) {
  const cls = tone === 'ok' ? ' um-alert--ok' : tone === 'warn' ? ' um-alert--warn' : '';
  const icon = tone === 'ok' ? 'check-circle' : 'alert-triangle';
  return (
    <div className={`um-alert${cls}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </div>
  );
}

/** Label + control (+ hint). The single child element gets the generated id. */
export function Field({ label, hint, wide, children }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children, { id: children.props.id || id }) : children;
  const forId = isValidElement(children) ? (children.props.id || id) : undefined;
  return (
    <div className={`um-field${wide ? ' is-wide' : ''}`}>
      <label htmlFor={forId}>{label}</label>
      {control}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder }) {
  return (
    <label className="um-search">
      <Icon name="search" size={18} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Switch({ on, onChange, disabled, onLabel, offLabel, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={`um-switch${on ? ' is-on' : ''}`} onClick={() => onChange?.(!on)}>
      <span className="um-switch__track"><span className="um-switch__thumb" /></span>
      {(onLabel || offLabel) && <span className="um-switch__label">{on ? onLabel : offLabel}</span>}
    </button>
  );
}

export function Empty({ icon = 'inbox', title, text, children }) {
  return (
    <div className="um-panel um-empty">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function Skeletons({ n = 3, h = 120 }) {
  return (
    <div className="um-stack" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="st-skel" style={{ height: h, borderRadius: 16 }} />)}
    </div>
  );
}
