import { safeHref } from '../../lib/safeUrl';
import Icon from '../Icon';
import { parseServerDate } from '../../utils/serverDate';

export const KIND_ICON = { image: 'image', video: 'play', pdf: 'file', file: 'file', link: 'link' };
export const CATS = {
  academic: { en: 'Academic', ar: 'أكاديمي' }, event: { en: 'Event', ar: 'فعالية' },
  competition: { en: 'Competition', ar: 'مسابقة' }, deadline: { en: 'Deadline', ar: 'موعد نهائي' },
  training: { en: 'Training', ar: 'تدريب' }, workshop: { en: 'Workshop', ar: 'ورشة عمل' },
  research: { en: 'Research', ar: 'بحث' },
};
export const catLabel = (k, locale) => CATS[k]?.[locale] || CATS[k]?.en || k;
export const initials = (n) => (n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export function ago(v, locale) {
  if (!v) return '';
  const s = (Date.now() - parseServerDate(v).getTime()) / 1000;
  const ar = locale === 'ar';
  if (s < 60) return ar ? 'الآن' : 'just now';
  const u = ar ? [[31536000, 'سنة'], [2592000, 'شهر'], [86400, 'يوم'], [3600, 'ساعة'], [60, 'دقيقة']]
    : [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [secs, l] of u) if (s >= secs) { const n = Math.floor(s / secs); return ar ? `منذ ${n} ${l}` : `${n}${l} ago`; }
  return '';
}

export function fmtWhen(v, locale) {
  if (!v) return '';
  const d = parseServerDate(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The page's signature: a calendar "stub" showing day + month. */
export function DateTile({ value, locale, tone }) {
  const d = parseServerDate(value);
  const ok = value && !Number.isNaN(d.getTime());
  const loc = locale === 'ar' ? 'ar-EG' : 'en-GB';
  return (
    <span className={`fd-tile${tone ? ` fd-tile--${tone}` : ''}`} aria-hidden="true">
      <b>{ok ? d.toLocaleDateString(loc, { day: 'numeric' }) : '–'}</b>
      <small>{ok ? d.toLocaleDateString(loc, { month: 'short' }) : ''}</small>
    </span>
  );
}

export function Avatar({ name, size = 40 }) {
  return <span className="fd-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>;
}

export function Attachments({ items = [], t }) {
  const imgs = items.filter((a) => a.kind === 'image');
  const rest = items.filter((a) => a.kind !== 'image');
  return (
    <>
      {imgs.length > 0 && (
        <div className={`fd-media fd-media--${Math.min(imgs.length, 3)}`}>
          {imgs.slice(0, 4).map((a, i) => (
            <a key={a.id ?? i} href={`/${a.file_path}`} target="_blank" rel="noopener noreferrer">
              <img src={`/${a.file_path}`} alt={a.original_name || t?.('Post attachment image') || ''} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="fd-files">
          {rest.map((a, i) => (
            <a key={a.id ?? i} className="fd-file" target="_blank" rel="noopener noreferrer"
              href={a.kind === 'link' ? safeHref(a.external_url) : `/${a.file_path}`}>
              <Icon name={KIND_ICON[a.kind] || 'file'} size={14} />
              <span>{a.kind === 'link' ? (a.link_title || a.external_url) : (a.original_name || a.kind)}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export function Pager({ page, pages, setPage, locale }) {
  if (pages <= 1) return null;
  return (
    <nav className="fd-pager">
      <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon name="chevron-left" size={16} className="icon-flip" /></button>
      <span>{locale === 'ar' ? `${page} من ${pages}` : `${page} / ${pages}`}</span>
      <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}><Icon name="chevron-right" size={16} className="icon-flip" /></button>
    </nav>
  );
}

export function Skeletons({ n = 3, h = 120 }) {
  return <div className="fd-stack" aria-busy="true">{Array.from({ length: n }).map((_, i) => <div key={i} className="st-skel" style={{ height: h, borderRadius: 18 }} />)}</div>;
}

/** Friendly empty state: icon, headline, hint and an optional action. */
export function Empty({ icon = 'inbox', title, text, children }) {
  return (
    <div className="fd-empty">
      <span className="fd-empty__ico"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

/** Error banner with a retry button. */
export function FeedAlert({ children, onRetry, locale }) {
  return (
    <div className="fd-alert" role="alert">
      <Icon name="alert-triangle" size={16} />
      <span>{children}</span>
      {onRetry && <button type="button" className="fd-more" onClick={onRetry}>{locale === 'ar' ? 'حاول مرة أخرى' : 'Try again'}</button>}
    </div>
  );
}

/** Search box (submit-on-enter) used by every feed page. */
export function SearchBox({ value, onChange, onSubmit, placeholder, label }) {
  return (
    <form className="fd-search" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <Icon name="search" size={17} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} />
    </form>
  );
}

/** Category chips (colour-coded). `value` is a category key or 'all'. */
export function CategoryChips({ value, onChange, locale, allLabel, label }) {
  return (
    <div className="fd-chips" role="group" aria-label={label}>
      {['all', ...Object.keys(CATS)].map((k) => (
        <button key={k} type="button" aria-pressed={value === k} data-cat={k === 'all' ? undefined : k} className={`fd-chip${value === k ? ' is-active' : ''}`} onClick={() => onChange(k)}>
          {k !== 'all' && <i />}{k === 'all' ? allLabel : catLabel(k, locale)}
        </button>
      ))}
    </div>
  );
}

/** Clickable stat cards that double as tab filters (university pages). */
export function StatTabs({ items, value, onChange }) {
  return (
    <div className="fd-statbar" role="tablist" style={{ '--n': items.length }}>
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" aria-selected={value === it.key} data-tone={it.tone} className={`fd-stat${value === it.key ? ' is-active' : ''}`} onClick={() => onChange(it.key)}>
          <span className="fd-stat__ico"><Icon name={it.icon} size={19} /></span>
          <span className="fd-stat__txt"><b>{it.count ?? '–'}</b><span>{it.label}</span></span>
        </button>
      ))}
    </div>
  );
}
