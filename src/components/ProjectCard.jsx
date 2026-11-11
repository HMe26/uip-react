import { Link } from 'react-router-dom';
import Icon from './Icon';

function livePreviewUrl(liveUrl) {
  if (!liveUrl || !/^https?:\/\//i.test(liveUrl)) return null;
  return `https://s0.wp.com/mshots/v1/${encodeURIComponent(liveUrl)}?w=640&h=400`;
}

/**
 * Port of components/card-project-public.php — same "browser window"
 * preview card, same classes (.pp-*), so it renders identically to the
 * PHP version. `showUniversity` mirrors the PHP param (false when every
 * card in the grid already belongs to the same university).
 */
export default function ProjectCard({ project: p, locale = 'en', index = 0, showUniversity = true }) {
  const isAr = locale === 'ar';
  const title = (isAr ? p.title_ar : p.title_en) || p.title_en || p.title_ar || '';
  const uniName = isAr ? p.university_name_ar : p.university_name_en;
  const tags = Array.isArray(p.tags) ? p.tags : JSON.parse(p.tags || '[]');
  const technologies = Array.isArray(p.technologies) ? p.technologies : JSON.parse(p.technologies || '[]');
  const chips = [...technologies, ...tags].slice(0, 4);
  const slug = p.slug || p.uuid;
  const liveUrl = p.live_demo_url || '';
  const cover = p.cover_image_path || '';
  const livePreview = cover ? null : livePreviewUrl(liveUrl);
  const initial = (title || 'U').charAt(0).toUpperCase();
  const delay = Math.min(index, 8) * 60;
  const viewsCount = Number(p.views_count || 0);
  const likesCount = Number(p.likes_count || 0);
  const catLabel = isAr ? (p.category_name_ar || p.category || '') : (p.category_name_en || p.category || '');

  return (
    <Link
      to={`/projects/${encodeURIComponent(slug)}`}
      className="pp-card animate-rise-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="pp-window">
        <div className="pp-window__bar">
          <span className="pp-dot pp-dot--r" /><span className="pp-dot pp-dot--y" /><span className="pp-dot pp-dot--g" />
          {liveUrl && <span className="pp-live"><span className="pp-live__dot" />{isAr ? 'شغّال' : 'Live'}</span>}
        </div>
        <div className="pp-window__screen">
          {cover ? (
            <img className="pp-window__img" src={`/${cover.replace(/^\//, '')}`} alt={title || (isAr ? 'صورة المشروع' : 'Project cover image')} loading="lazy" />
          ) : livePreview ? (
            <img
              className="pp-window__img"
              src={livePreview}
              alt={`${title || (isAr ? 'المشروع' : 'Project')}${isAr ? ' — معاينة حية' : ' — live preview'}`}
              loading="lazy"
              onError={(e) => {
                const div = document.createElement('div');
                div.className = 'pp-window__placeholder';
                div.setAttribute('aria-hidden', 'true');
                div.innerHTML = `<span>${initial}</span>`;
                e.currentTarget.replaceWith(div);
              }}
            />
          ) : (
            <div className="pp-window__placeholder" aria-hidden="true"><span>{initial}</span></div>
          )}
          <div className="pp-window__overlay">
            <span className="btn btn-primary btn-sm">{isAr ? 'افتح المشروع' : 'View project'} <Icon name="arrow-right" size={14} /></span>
          </div>
        </div>
      </div>

      <div className="pp-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', minHeight: 22 }}>
          {catLabel ? (
            <span className="badge badge-neutral">
              {p.category_icon && <Icon name={p.category_icon} size={12} />} {catLabel}
            </span>
          ) : <span />}
          {liveUrl && (
            <span
              className="pp-live-link"
              title={isAr ? 'زيارة الموقع المباشر' : 'Open live site'}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(liveUrl, '_blank', 'noopener'); }}
            >
              <Icon name="globe" size={14} />
            </span>
          )}
        </div>

        <h3 className="text-h3 pp-title">{title}</h3>
        <p className="text-small pp-summary">{(p.summary || '').slice(0, 130)}</p>

        {chips.length > 0 && (
          <div className="pp-chips">
            {chips.map((tag, i) => <span key={i} className="badge badge-neutral">{String(tag)}</span>)}
          </div>
        )}

        <div className="pp-meta">
          {showUniversity && uniName ? (
            p.university_slug ? (
              <span
                className="pp-meta__uni"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/universities/${encodeURIComponent(p.university_slug)}`; }}
              >
                <Icon name="building" size={13} /> {uniName}
              </span>
            ) : (
              <span className="pp-meta__uni pp-meta__uni--static"><Icon name="building" size={13} /> {uniName}</span>
            )
          ) : <span />}
          <span className="pp-meta__stats">
            {likesCount > 0 && <span><Icon name="heart" size={13} /> {likesCount}</span>}
            <span><Icon name="eye" size={13} /> {viewsCount}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
