import { Link } from 'react-router-dom';
import Icon from './Icon';

/**
 * 1:1 port of uip_breadcrumb() (app/Views/components/breadcrumb.php),
 * styled by the .breadcrumb / .breadcrumb__sep / .breadcrumb__current
 * rules already in styles/css/app-shell.css (ported over but never
 * consumed by any React component until now).
 *
 * `items`: array of { en, ar, url? } — same shape uip_breadcrumb()
 * takes, just flattened (label.en/label.ar -> en/ar). The last item,
 * or any item with no `url`, renders as plain (non-link) current-page
 * text — same rule as the PHP helper ($i < $count - 1 && has url).
 *
 * `locale`: 'en' | 'ar' — falls back to `en` if the `ar` label is
 * missing, same as the PHP helper.
 */
export default function Breadcrumb({ items, locale = 'en' }) {
  const sep = <Icon name={locale === 'ar' ? 'chevron-left' : 'chevron-right'} size={14} />;
  return (
    <nav className="breadcrumb">
      {items.map((item, i) => {
        const label = locale === 'ar' ? (item.ar || item.en) : item.en;
        const isLast = i === items.length - 1;
        return (
          <span key={`${label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {i > 0 && <span className="breadcrumb__sep">{sep}</span>}
            {item.url && !isLast ? (
              <Link to={item.url}>{label}</Link>
            ) : (
              <span className="breadcrumb__current">{label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
