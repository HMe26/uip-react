import { useEffect } from 'react';
import Icon from '../Icon';
import { parseServerDate } from '../../utils/serverDate';

/**
 * Small presentational helpers for the Student portal design
 * (styles live in styles/css/student-portal.css, scoped to .app-shell--student).
 */

// Real workflow statuses (Project::toResearchCardArray()): draft, submitted,
// under_review, rejected, approved (معتمد، مش منشور), published, archived. The design's "Changes
// Requested" is the backend's `rejected` (the student must act on it).
export const STATUS_META = {
  draft: { tone: 'neutral', en: 'Draft', ar: 'مسودة' },
  submitted: { tone: '', en: 'Submitted', ar: 'تم التقديم' },
  under_review: { tone: '', en: 'Under Review', ar: 'قيد المراجعة' },
  rejected: { tone: 'warning', en: 'Changes Requested', ar: 'مطلوب تعديلات' },
  approved: { tone: 'success', en: 'Approved', ar: 'معتمد' },
  published: { tone: 'success', en: 'Published', ar: 'منشور' },
  archived: { tone: 'neutral', en: 'Archived', ar: 'مؤرشف' },
};

export function statusLabel(status, locale) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return m[locale] || m.en;
}

export function StatusPill({ status, locale }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return <span className={`st-pill${m.tone ? ` st-pill--${m.tone}` : ''}`}>{m[locale] || m.en}</span>;
}

export function Pill({ tone = '', children }) {
  return <span className={`st-pill${tone ? ` st-pill--${tone}` : ''}`}>{children}</span>;
}

/** Localised {en, ar} object → string. */
export const loc = (v, locale) => (v && typeof v === 'object' ? (v[locale] || v.en || v.ar || '') : (v || ''));

export function Kpi({ label, value, meta, featured, small, good }) {
  const cls = `st-kpi${featured ? ' is-featured' : ''}${small ? ' st-kpi--small' : ''}`;
  return (
    <div className={cls}>
      <span className="st-kpi__label">{label}</span>
      <span className="st-kpi__value">{value}</span>
      {meta != null && meta !== '' && <span className={`st-kpi__meta${good ? ' is-good' : ''}`}>{meta}</span>}
    </div>
  );
}

export function EmptyState({ icon = 'folder', title, text, children }) {
  return (
    <div className="st-empty">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function Score({ value = 0, large }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <span className={`st-score${large ? ' st-score--lg' : ''}${v >= 75 ? ' st-score--good' : ''}`} style={{ '--p': v }} aria-label={`${v}/100`}>
      <span>{v}</span>
    </span>
  );
}

/**
 * Stepper. steps: [{label}], current: index of the active step,
 * done: indices before `current` are shown as done. `warn` marks the current
 * step in the warning tone (e.g. changes requested).
 */
export function Stepper({ steps, current, warn = false, wizard = false }) {
  return (
    <ol className={`st-stepper${wizard ? ' st-stepper--wizard' : ''}`}>
      {steps.map((s, i) => {
        const state = i < current ? 'is-done' : i === current ? `is-current${warn ? ' is-warn' : ''}` : '';
        return (
          <li key={s.key || i} className={`st-step ${state}`} aria-current={i === current ? 'step' : undefined}>
            <span className="st-step__dot">{i < current ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="st-step__label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Centered confirm/form modal used across the student pages. */
export function StModal({ title, children, actions, onClose, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="st-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`st-modal${wide ? ' st-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="st-modal__body">{children}</div>
        {actions && <div className="st-modal__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ h = 90, count = 1 }) {
  return (
    <div className="st-stack">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="st-skel" style={{ height: h }} />)}
    </div>
  );
}

/** Relative time ("2 days ago") from an ISO date; falls back to the raw string. */
export function timeAgo(value, locale) {
  if (!value) return '';
  const d = parseServerDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return locale === 'ar' ? 'اليوم' : 'Today';
  if (days === 1) return locale === 'ar' ? 'أمس' : 'Yesterday';
  if (days < 14) return locale === 'ar' ? `منذ ${days} أيام` : `${days} days ago`;
  if (days < 60) { const w = Math.floor(days / 7); return locale === 'ar' ? `منذ ${w} أسابيع` : `${w} weeks ago`; }
  const m = Math.floor(days / 30);
  return locale === 'ar' ? `منذ ${m} أشهر` : `${m} months ago`;
}

/** Days until a date (negative when past); null when unparseable. */
export function daysUntil(value) {
  const d = parseServerDate(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
