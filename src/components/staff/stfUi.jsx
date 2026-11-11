import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { parseServerDate } from '../../utils/serverDate';

/**
 * Presentational pieces for the Academic Staff design (styles: styles/css/staff-portal.css,
 * scoped to .app-shell--staff). Shared panels/tables/pills come from stUi.jsx + student-portal.css.
 */

/** Breadcrumb + big title + subtitle + right-aligned actions. */
export function StaffHead({ crumbs = [], title, subtitle, eyebrow, actions }) {
  const { locale } = useLanguage();
  return (
    <div className="stf-head">
      <div className="stf-head__main">
        {crumbs.length > 0 && (
          <nav className="stf-crumbs" aria-label={locale === 'ar' ? 'مسار التنقل' : 'Breadcrumb'}>
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', gap: 6 }}>
                {i > 0 && <span aria-hidden="true">›</span>}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <strong>{c.label}</strong>}
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <div className="stf-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="stf-head__actions">{actions}</div>}
    </div>
  );
}

/** KPI card — tone: '' | 'warn' | 'good' | 'bad'. */
export function StaffKpi({ value, label, icon, tone = '' }) {
  return (
    <div className="stf-kpi">
      <div>
        <div className="stf-kpi__value">{value}</div>
        <div className="stf-kpi__label">{label}</div>
      </div>
      {icon && <span className={`stf-kpi__icon${tone ? ` stf-kpi__icon--${tone}` : ''}`}><Icon name={icon} size={19} /></span>}
    </div>
  );
}

export function initialsOf(name) {
  const parts = String(name || '').replace(/^(Dr\.?|Prof\.?|د\.?)\s*/i, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

const AVATAR_COLORS = ['#4353FF', '#6F7CFF', '#12A37A', '#F59E0B', '#E5484D', '#5B6275'];
export function PersonAvatar({ name, size }) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return <span className="stf-avatar" style={{ background: AVATAR_COLORS[h], ...(size ? { width: size, height: size } : {}) }}>{initialsOf(name)}</span>;
}

/** "Tomorrow · 10:00 AM" / "3 days · 09:00 AM" / "Sep 30 · 10:00 AM". */
export function whenLabel(iso, locale) {
  if (!iso) return '';
  const d = parseServerDate(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  const ar = locale === 'ar';
  const time = d.toLocaleTimeString(ar ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOf(d) - startOf(new Date())) / 86400000);
  let day;
  if (days === 0) day = ar ? 'اليوم' : 'Today';
  else if (days === 1) day = ar ? 'غدًا' : 'Tomorrow';
  else if (days > 1 && days < 7) day = ar ? `بعد ${days} أيام` : `${days} days`;
  else day = d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

/** Page numbers with ellipsis: [1, '…', 4, 5, 6, '…', 20]. */
function pageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const set = new Set([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) { set.add(2); set.add(3); set.add(4); }
  if (page >= totalPages - 2) { set.add(totalPages - 1); set.add(totalPages - 2); set.add(totalPages - 3); }
  const nums = [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/** Numbered pagination under a table: « 1 2 [3] 4 … 20 » + "Showing 21–30 of 193". */
export function StaffPagination({ page, totalPages, total = 0, perPage = 10, onPage }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  if (!total || totalPages <= 1) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const fmt = (n) => (ar ? n.toLocaleString('ar-EG') : n.toLocaleString('en-US'));
  return (
    <div className="stf-pager">
      <span className="stf-pager__info">
        {ar ? `عرض ${fmt(from)}–${fmt(to)} من ${fmt(total)}` : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
      </span>
      <nav className="stf-pager__nav" aria-label={ar ? 'ترقيم الصفحات' : 'Pagination'}>
        <button type="button" className="stf-pager__btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={ar ? 'السابق' : 'Previous'}>
          <Icon name={ar ? 'chevron-right' : 'chevron-left'} size={16} />
        </button>
        {pageWindow(page, totalPages).map((n, i) => (n === '…'
          ? <span key={`e${i}`} className="stf-pager__gap">…</span>
          : (
            <button key={n} type="button" className={`stf-pager__btn${n === page ? ' is-active' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
              {fmt(n)}
            </button>
          )))}
        <button type="button" className="stf-pager__btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label={ar ? 'التالي' : 'Next'}>
          <Icon name={ar ? 'chevron-left' : 'chevron-right'} size={16} />
        </button>
      </nav>
    </div>
  );
}
