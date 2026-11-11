import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Shared building blocks for the Security portal (Control Center design).
 * Colors come from the --sev-* tokens in variables.css, so light and dark
 * both work. Every helper degrades to a readable fallback for unknown values
 * (a severity/status the API adds later still renders, it just looks neutral).
 */

const LEVELS = ['critical', 'high', 'medium', 'low', 'info'];

const label = (v) => String(v ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Severity pill — text is already translated by the caller via `text`. */
export function SevBadge({ level, text }) {
  const key = LEVELS.includes(level) ? level : 'neutral';
  return <span className={`sev sev--${key}`}>{text && text !== level ? text : label(level)}</span>;
}

/**
 * Workflow-status pill. Statuses are their own scale (never reuse the
 * severity colors — "Medium" under STATUS was a mock-up bug): open = red,
 * in-flight = amber, contained/acknowledged = indigo, done = green,
 * closed/accepted = neutral.
 */
const STATUS_TONE = {
  open: 'danger', escalated: 'danger', failed: 'danger',
  investigating: 'warn', in_progress: 'warn', warning: 'warn',
  contained: 'info', mitigated: 'info', acknowledged: 'info',
  resolved: 'good', success: 'good', active: 'good',
  closed: 'neutral', accepted_risk: 'neutral',
};
export function StatusPill({ status, text }) {
  return <span className={`pill pill--${STATUS_TONE[status] || 'neutral'}`}>{text && text !== status ? text : label(status)}</span>;
}

export function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="sec-head">
      <div className="sec-head__text">
        {eyebrow && <div className="sec-head__eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="sec-head__actions">{actions}</div>}
    </header>
  );
}

/** KPI tile: label, big value, colored meta line. `to` makes it a link-like tile. */
export function SecKpi({ label: l, value, meta, tone = 'neutral', icon = 'arrow-up', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`sec-kpi${onClick ? ' is-clickable' : ''}`} onClick={onClick}>
      <span className="sec-kpi__top"><span>{l}</span><Icon name={icon} size={13} style={{ transform: 'rotate(45deg)' }} /></span>
      <strong className="sec-kpi__value">{value}</strong>
      {meta && <span className={`sec-kpi__meta tone--${tone}`}>{meta}</span>}
    </Tag>
  );
}

/**
 * Labelled <select>. Always renders a visible value (the "All …" option is
 * the empty value), so a filter never shows as a blank box.
 */
export function FilterSelect({ label: l, value, onChange, options, allLabel, disabled, className = '' }) {
  const id = useId();
  return (
    <div className={`sec-select ${className}`}>
      {l && <label htmlFor={id}>{l}</label>}
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={l || allLabel}>
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} />
    </div>
  );
}

/**
 * Search box used in every toolbar. Renders a <div role="search"> (never a
 * nested <form>: several toolbars are already inside a form). Inside a form,
 * Enter submits that form natively; standalone, pass `onSubmit` to react to Enter.
 */
export function SearchBox({ value, onChange, placeholder, onSubmit }) {
  return (
    <div className="sec-search" role="search">
      <Icon name="search" size={15} />
      <input
        type="search" value={value} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(); } }}
      />
    </div>
  );
}

/**
 * Centered dialog. Closes on Escape and on backdrop click; locks nothing else,
 * so the page behind stays put. `tone="danger"` is used for destructive confirms.
 *
 * Rendered through a portal into `.app-shell` (where the theme tokens live), NOT inside the card that opened it:
 * cards get `transform: translateY(-3px)` on hover (motion.css), and a transformed ancestor becomes the containing
 * block of `position: fixed`, which squeezed the overlay into the card and made the page flicker as hover toggled.
 */
export function Modal({ open, title, eyebrow = 'UIPE Security', onClose, children, footer, tone, wide }) {
  const { locale } = useLanguage();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sec-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`sec-modal${wide ? ' sec-modal--wide' : ''}${tone ? ` sec-modal--${tone}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sec-modal__head">
          <div>
            <div className="sec-modal__eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={locale === 'ar' ? 'إغلاق' : 'Close'}><Icon name="x" size={16} /></button>
        </header>
        <div className="sec-modal__body">{children}</div>
        {footer && <footer className="sec-modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.querySelector('.app-shell') || document.body,
  );
}

/** Definition grid used inside detail modals. */
export function DetailGrid({ items }) {
  return (
    <dl className="sec-detail">
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>
      ))}
    </dl>
  );
}

export function EmptyState({ icon = 'inbox', children }) {
  return (
    <div className="sec-empty">
      <span><Icon name={icon} size={22} /></span>
      <p>{children}</p>
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="sec-error" role="alert"><Icon name="alert" size={16} /> {children}</div>;
}

/** Table skeleton rows while loading — avoids a layout jump. */
export function TableSkeleton({ cols = 6, rows = 5 }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="sec-skel-row">
          {Array.from({ length: cols }).map((__, c) => <td key={c}><span className="sec-skel" style={{ width: `${50 + ((r + c) % 4) * 12}%` }} /></td>)}
        </tr>
      ))}
    </tbody>
  );
}

export function useGreeting() {
  const { locale } = useLanguage();
  const h = new Date().getHours();
  if (locale === 'ar') return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء الخير' : 'مساء الخير';
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const fmtDateTime = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');
/** Compact for dense tables: 09-29 12:23 (year omitted). */
export const fmtShort = (v) => (v ? String(v).replace('T', ' ').slice(5, 16) : '—');
export const fmtDate = (v) => (v ? String(v).slice(0, 10) : '—');
export const titleCase = label;

/** t() that falls back to Title Case for keys with no Arabic entry (English mode returns the raw key). */
export const tl = (t) => (k) => { const v = t(k); return v === k ? label(k) : v; };

export function Pagination({ page, totalPages, onPage }) {
  const { locale } = useLanguage();
  if (totalPages <= 1) return null;
  const rtl = locale === 'ar';
  return (
    <nav className="sec-pager" aria-label={rtl ? 'ترقيم الصفحات' : 'Pagination'}>
      <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={rtl ? 'السابق' : 'Previous'}>
        <Icon name={rtl ? 'chevron-right' : 'chevron-left'} size={16} />
      </button>
      <span>{rtl ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}</span>
      <button type="button" className="icon-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label={rtl ? 'التالي' : 'Next'}>
        <Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={16} />
      </button>
    </nav>
  );
}
