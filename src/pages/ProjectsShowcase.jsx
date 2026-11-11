import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Icon from '../components/Icon';
import ProjectCard from '../components/ProjectCard';
import SiteFooter from '../components/SiteFooter';
import LandingNav from '../components/LandingNav';
import LandingBackdrop from '../components/LandingBackdrop';
import usePaperUnfold from '../hooks/usePaperUnfold';

const SORTS = [
  ['newest', 'Newest', 'الأحدث'],
  ['views', 'Most viewed', 'الأكثر مشاهدة'],
  ['oldest', 'Oldest', 'الأقدم'],
  ['az', 'Title A–Z', 'العنوان أ-ي'],
];
const CATS_COLLAPSED = 10;

/**
 * /projects — restyled in the Landing / Verify Certificate design language
 * (.lp2-* / .lp2-ex-*, see styles/css/landing.css). Same data + URL contract
 * as before: GET /api/v1/public/projects, filters live in the query string
 * (q, sort, category[], page) so filtered links stay shareable.
 * Layout: hero with search → category pills → toolbar (count + sort) → grid.
 */
export default function ProjectsShowcase() {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'newest';
  const selectedCategories = searchParams.getAll('category');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  const [qDraft, setQDraft] = useState(q);
  useEffect(() => { setQDraft(q); }, [q]);

  const [data, setData] = useState({ items: [], total: 0, total_pages: 1, categories: [] });
  const [loading, setLoading] = useState(true);
  const [showAllCats, setShowAllCats] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (sort !== 'newest') qs.set('sort', sort);
    selectedCategories.forEach((c) => qs.append('category[]', c));
    if (page > 1) qs.set('page', String(page));
    api.get(`/api/v1/public/projects${qs.toString() ? `?${qs.toString()}` : ''}`)
      .then((json) => { if (alive) setData(json.data); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, page, selectedCategories.join(',')]);

  const applyParams = useCallback((next) => {
    const merged = { q, sort, category: selectedCategories, page, ...next };
    const params = new URLSearchParams();
    if (merged.q) params.set('q', merged.q);
    if (merged.sort && merged.sort !== 'newest') params.set('sort', merged.sort);
    (merged.category || []).forEach((c) => params.append('category', c));
    if (merged.page && merged.page > 1) params.set('page', String(merged.page));
    setSearchParams(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, selectedCategories.join(','), page, setSearchParams]);

  // Live search: apply the draft ~400ms after the person stops typing.
  useEffect(() => {
    if (qDraft.trim() === q) return undefined;
    const id = setTimeout(() => applyParams({ q: qDraft.trim(), page: 1 }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  const toggleCategory = (slug) => {
    const next = selectedCategories.includes(slug)
      ? selectedCategories.filter((c) => c !== slug)
      : [...selectedCategories, slug];
    applyParams({ category: next, page: 1 });
  };
  const clearAll = () => { setQDraft(''); setSearchParams({}); };
  const goPage = (n) => {
    applyParams({ page: n });
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const allCategories = data.categories || [];
  const categoryLabel = {};
  allCategories.forEach((c) => { categoryLabel[c.slug] = isAr ? c.name_ar : c.name_en; });
  const hasFilters = selectedCategories.length > 0 || !!q;
  // Always keep selected categories visible even when the list is collapsed.
  const visibleCats = showAllCats
    ? allCategories
    : allCategories.filter((c, i) => i < CATS_COLLAPSED || selectedCategories.includes(c.slug));
  const hiddenCount = allCategories.length - visibleCats.length;
  const items = data.items || [];

  usePaperUnfold('.lp2-ex-grid:not([aria-hidden]), .lp2-ex-empty, .lp2-ex-pager');

  return (
    <div className="lp2 lp2-page lp2--fx">
      <LandingNav />

      <header className="lp2-ex-hero">
        <LandingBackdrop compact />
        <div className="lp2-shell">
          <div className="lp2-ex-hero__text animate-rise-in">
            <span className="lp2-pill"><Icon name="sparkles" size={14} /> {t('Published & university-approved', 'منشورة ومعتمدة من الجامعات')}</span>
            <h1>{t('Explore Student Projects', 'استكشف المشاريع الطلابية')}</h1>
            <p>{t('Browse published projects from participating universities — no account needed.', 'تصفح المشاريع المنشورة من الجامعات المشاركة — بدون تسجيل دخول.')}</p>
          </div>

          <form className="lp2-vc__form lp2-ex-search animate-rise-in" style={{ animationDelay: '.08s' }}
            role="search" onSubmit={(e) => { e.preventDefault(); applyParams({ q: qDraft.trim(), page: 1 }); }}>
            <div className="lp2-vc__field">
              <Icon name="search" size={16} />
              <input
                className="form-input" type="search" value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                placeholder={t('Search by project title or summary…', 'ابحث باسم المشروع أو الوصف…')}
                aria-label={t('Search projects', 'بحث في المشاريع')}
              />
            </div>
            <button type="submit" className="btn btn-primary">{t('Search', 'بحث')}</button>
          </form>

          {allCategories.length > 0 && (
            <div className="lp2-ex-cats animate-rise-in" style={{ animationDelay: '.14s' }} role="group" aria-label={t('Categories', 'التصنيفات')}>
              <button type="button" className={`lp2-chip${selectedCategories.length === 0 ? ' is-active' : ''}`}
                onClick={() => applyParams({ category: [], page: 1 })}>
                {t('All', 'الكل')}
              </button>
              {visibleCats.map((cat) => {
                const on = selectedCategories.includes(cat.slug);
                return (
                  <button type="button" key={cat.slug} className={`lp2-chip${on ? ' is-active' : ''}`}
                    aria-pressed={on} onClick={() => toggleCategory(cat.slug)}>
                    {isAr ? cat.name_ar : cat.name_en}
                    <span className="lp2-chip__count">{cat.total}</span>
                  </button>
                );
              })}
              {(hiddenCount > 0 || showAllCats) && allCategories.length > CATS_COLLAPSED && (
                <button type="button" className="lp2-chip lp2-chip--more" onClick={() => setShowAllCats((v) => !v)}>
                  {showAllCats ? t('Show less', 'عرض أقل') : t(`+${hiddenCount} more`, `+${hiddenCount} أخرى`)}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="lp2-shell lp2-ex-main" ref={resultsRef}>
        <div className="lp2-ex-toolbar">
          <p className="lp2-ex-count" aria-live="polite">
            {loading ? t('Loading projects…', 'جارِ تحميل المشاريع…') : (
              <><strong>{data.total || 0}</strong> {t(data.total === 1 ? 'project found' : 'projects found', 'مشروع متاح')}</>
            )}
          </p>
          <label className="lp2-ex-sort">
            <span>{t('Sort by', 'الترتيب')}</span>
            <span className="lp2-ex-sort__select">
              <select value={sort} onChange={(e) => applyParams({ sort: e.target.value, page: 1 })}>
                {SORTS.map(([value, en, ar]) => <option key={value} value={value}>{t(en, ar)}</option>)}
              </select>
              <Icon name="chevron-down" size={14} />
            </span>
          </label>
        </div>

        {hasFilters && (
          <div className="lp2-ex-active">
            {q && (
              <button type="button" className="lp2-tag" onClick={() => { setQDraft(''); applyParams({ q: '', page: 1 }); }}>
                “{q}” <Icon name="x" size={13} />
              </button>
            )}
            {selectedCategories.map((slug) => (
              <button type="button" className="lp2-tag" key={slug} onClick={() => toggleCategory(slug)}>
                {categoryLabel[slug] || slug} <Icon name="x" size={13} />
              </button>
            ))}
            <button type="button" className="lp2-ex-clear" onClick={clearAll}>{t('Clear all', 'مسح الكل')}</button>
          </div>
        )}

        {loading ? (
          <div className="public-projects-grid lp2-ex-grid" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="lp2-skel" key={i}>
                <div className="lp2-skel__img" />
                <div className="lp2-skel__line lp2-skel__line--s" />
                <div className="lp2-skel__line" />
                <div className="lp2-skel__line lp2-skel__line--m" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="lp2-card lp2-ex-empty">
            <span className="lp2-icon lp2-icon--lg"><Icon name="search" size={22} /></span>
            <h3>{t('No projects match your search', 'مفيش مشاريع مطابقة للبحث')}</h3>
            <p>{t('Try a different keyword or remove some filters.', 'جرّب كلمة تانية أو شيل بعض الفلاتر.')}</p>
            {hasFilters && <button type="button" className="btn btn-outline btn-sm" onClick={clearAll}>{t('Clear all filters', 'مسح كل الفلاتر')}</button>}
          </div>
        ) : (
          <>
            <div className="public-projects-grid lp2-ex-grid">
              {items.map((p, i) => (
                <ProjectCard key={p.uuid || p.slug || i} project={p} locale={locale} index={i} showUniversity />
              ))}
            </div>

            {data.total_pages > 1 && (
              <nav className="lp2-ex-pager" aria-label={t('Pagination', 'الصفحات')}>
                <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>
                  <Icon name={isAr ? 'chevron-right' : 'chevron-left'} size={14} /> {t('Previous', 'السابق')}
                </button>
                <span>{t(`Page ${page} of ${data.total_pages}`, `صفحة ${page} من ${data.total_pages}`)}</span>
                <button type="button" className="btn btn-outline btn-sm" disabled={page >= data.total_pages} onClick={() => goPage(page + 1)}>
                  {t('Next', 'التالي')} <Icon name={isAr ? 'chevron-left' : 'chevron-right'} size={14} />
                </button>
              </nav>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
