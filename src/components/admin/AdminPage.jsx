import { useEffect, useRef } from 'react';
import Icon from '../Icon';
import { useTranslations } from '../../context/LanguageContext';
import kitI18n from '../../i18n/admin/page-kit';
import { observeTables } from '../../lib/labelTables';

/**
 * Shared page shell for the admin portal pages (same language as System Activity):
 *   hero (icon · title · subtitle · actions) → content.
 * Tables inside turn into cards on phones (see lib/labelTables.js).
 */
export default function AdminPage({ icon = 'grid', title, subtitle, actions, children }) {
  const ref = useRef(null);
  useEffect(() => (ref.current ? observeTables(ref.current) : undefined), []);
  return (
    <div className="sa-page ap-page" ref={ref}>
      <header className="sa-hero ap-hero">
        <span className="sa-hero__icon" aria-hidden="true"><Icon name={icon} size={26} /></span>
        <div className="sa-hero__text">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="ap-hero__actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

/** KPI tile (icon tile + title + value + optional note). tone: critical | warning | ok */
export function Kpi({ icon, title, value, note, tone }) {
  return (
    <div className={`sa-kpi${tone ? ` sa-kpi--${tone}` : ''}${String(value ?? '').length > 9 ? ' sa-kpi--text' : ''}`}>
      <span className="sa-kpi__icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <div className="sa-kpi__body">
        <span className="sa-kpi__title">{title}</span>
        <strong className="sa-kpi__value">{value}</strong>
        {note && <span className="sa-kpi__note">{note}</span>}
      </div>
    </div>
  );
}

export function KpiGrid({ children }) {
  return <div className="sa-kpis">{children}</div>;
}

/** Segmented filter chips. options: [[value, label, tone?]] */
export function Chips({ value, onChange, options, label }) {
  return (
    <div className="sa-chips" role="group" aria-label={label}>
      {options.map(([v, name, tone]) => (
        <button key={v || 'all'} type="button" aria-pressed={value === v}
          className={`sa-chip${value === v ? ' is-active' : ''}${tone ? ` sa-chip--${tone}` : ''}`} onClick={() => onChange(v)}>{name}</button>
      ))}
    </div>
  );
}

/** Loading skeleton while a list/page loads. */
export function Skeleton({ rows = 6, cols = 4 }) {
  const t = useTranslations(kitI18n);
  return (
    <div className="sa-card ap-skel-card">
      <div className="sa-skel" aria-busy="true" aria-label={t('Loading…')}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="sa-skel__row">{Array.from({ length: cols }).map((__, j) => <i key={j} />)}</div>
        ))}
      </div>
    </div>
  );
}

/** Friendly error block with a retry button. */
export function ErrorState({ error, onRetry }) {
  const t = useTranslations(kitI18n);
  return (
    <div className="sa-card">
      <div className="sa-state sa-state--error" role="alert">
        <Icon name="alert-triangle" size={28} /><strong>{t('Could not load this page')}</strong><p>{error}</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry || (() => window.location.reload())}>{t('Try again')}</button>
      </div>
    </div>
  );
}

/** Empty state card for lists. */
export function EmptyState({ icon = 'inbox', title, hint }) {
  return (
    <div className="sa-state"><Icon name={icon} size={28} /><strong>{title}</strong>{hint && <p>{hint}</p>}</div>
  );
}
