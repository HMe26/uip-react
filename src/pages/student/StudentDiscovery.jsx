import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import ProjectCard from '../../components/ProjectCard';
import { useLanguage } from '../../context/LanguageContext';

const SORTS = [
  ['newest', 'Newest', 'الأحدث'],
  ['views', 'Most viewed', 'الأكثر مشاهدة'],
  ['oldest', 'Oldest', 'الأقدم'],
  ['az', 'Title A–Z', 'العنوان أ-ي'],
];

/**
 * Student "Discovery" page (/student/discovery) — browse and search the
 * published projects of other students, inside the student portal shell.
 * Uses the same public listing API as the public showcase page:
 *   GET /api/v1/public/projects?q=&sort=&page=
 * Search / sort / page live in the URL so a discovery view can be shared
 * or bookmarked.
 */
export default function StudentDiscovery() {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'newest';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  const [qDraft, setQDraft] = useState(q);
  useEffect(() => { setQDraft(q); }, [q]);

  const [data, setData] = useState({ items: [], total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const applyParams = useCallback((patch) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === '' || v == null || (k === 'sort' && v === 'newest') || (k === 'page' && Number(v) <= 1)) next.delete(k);
      else next.set(k, String(v));
    });
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (sort !== 'newest') qs.set('sort', sort);
    if (page > 1) qs.set('page', String(page));
    api.get(`/api/v1/public/projects${qs.toString() ? `?${qs.toString()}` : ''}`)
      .then((json) => { if (alive) setData(json.data || { items: [], total: 0, total_pages: 1 }); })
      .catch((err) => { if (alive) setError(errorMessage(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q, sort, page]);

  const items = data.items || [];
  const totalPages = data.total_pages || 1;
  const boxStyle = { padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-secondary)', marginTop: 'var(--space-4)' };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="page-title">{t('Discovery', 'الاستكشاف')}</h1>
        <p className="text-small" style={{ color: 'var(--text-secondary)' }}>
          {t('Explore published projects from across the platform.', 'استكشف المشاريع المنشورة على المنصة.')}
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); applyParams({ q: qDraft.trim(), page: 1 }); }}
        style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          type="search"
          className="form-control"
          style={{ flex: '1 1 240px' }}
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
          placeholder={t('Search projects…', 'ابحث في المشاريع…')}
        />
        <select
          className="form-control"
          style={{ flex: '0 0 auto' }}
          value={sort}
          onChange={(e) => applyParams({ sort: e.target.value, page: 1 })}
          aria-label={t('Sort by', 'ترتيب حسب')}
        >
          {SORTS.map(([key, en, ar]) => <option key={key} value={key}>{t(en, ar)}</option>)}
        </select>
        <button type="submit" className="btn btn-primary">
          <Icon name="search" size={16} /> {t('Search', 'بحث')}
        </button>
      </form>

      {error ? (
        <div className="card glass-panel" style={{ ...boxStyle, color: 'var(--danger, #dc2626)' }}>{error}</div>
      ) : loading ? (
        <div className="card glass-panel" style={boxStyle}>{t('Loading…', 'جارِ التحميل…')}</div>
      ) : items.length === 0 ? (
        <div className="card glass-panel" style={boxStyle}>{t('No projects found.', 'لا توجد مشاريع.')}</div>
      ) : (
        <>
          <p className="text-body" style={{ marginTop: 'var(--space-4)' }}>
            <strong>{data.total || items.length}</strong> {t('projects found', 'مشروع متاح')}
          </p>
          <div className="public-projects-grid">
            {items.map((p, i) => (
              <ProjectCard key={p.uuid || p.slug || i} project={p} locale={locale} index={i} showUniversity />
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-6)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => applyParams({ page: page - 1 })}>
                <Icon name={isAr ? 'chevron-right' : 'chevron-left'} size={14} /> {t('Previous', 'السابق')}
              </button>
              <span className="text-small" style={{ color: 'var(--text-secondary)' }}>
                {t(`Page ${page} of ${totalPages}`, `صفحة ${page} من ${totalPages}`)}
              </span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => applyParams({ page: page + 1 })}>
                {t('Next', 'التالي')} <Icon name={isAr ? 'chevron-left' : 'chevron-right'} size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
