import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Pager } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/featured-projects';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/featured-projects.php, talking to the real JSON
 * API (app/Controllers/Api/AdminFeaturedProjectsApiController.php — new,
 * added alongside this page; reuses the exact same
 * ProjectRepository::publishedForFeaturedAdmin()/setFeatured() calls the
 * Blade view already made). Manual curation of which published projects
 * show in the landing page's "Featured Projects" section, and in what
 * order — nothing here is invented.
 */

function StatCard({ label, value, icon, note }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__top">{label} <Icon name={icon} size={16} /></div>
      <div className="adm-kpi__value">{value}</div>
      {note && <div className="adm-kpi__note">{note}</div>}
    </div>
  );
}

export default function AdminFeaturedProjects() {
  const t = useTranslations(translations);
  const [projects, setProjects] = useState([]);
  const [featuredCount, setFeaturedCount] = useState(0);
  const [maxFeatured, setMaxFeatured] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyUuid, setBusyUuid] = useState(null);

  const [search, setSearch] = useState('');
  const [universityFilter, setUniversityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/featured-projects')
      .then((json) => {
        setProjects(json.data || []);
        setFeaturedCount(json.meta?.featuredCount ?? 0);
        setMaxFeatured(json.meta?.maxFeatured ?? 6);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAction(uuid, promise) {
    setActionError(null);
    setBusyUuid(uuid);
    try {
      await promise;
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyUuid(null);
    }
  }

  const featured = projects
    .filter((p) => Number(p.is_featured) === 1)
    .sort((a, b) => Number(a.featured_order) - Number(b.featured_order));
  const notFeatured = projects.filter((p) => Number(p.is_featured) !== 1);

  // Filter options are derived from whatever is actually in the (not-yet-featured)
  // list, so the dropdowns never show a university/category with zero results.
  const universityOptions = useMemo(() => {
    const seen = new Map();
    notFeatured.forEach((p) => {
      const name = L(t, p.university_name_en, p.university_name_ar);
      if (name && !seen.has(name)) seen.set(name, name);
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [notFeatured]);

  const categoryOptions = useMemo(() => {
    const seen = new Set();
    notFeatured.forEach((p) => { if (p.category) seen.add(p.category); });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [notFeatured]);

  const filteredNotFeatured = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notFeatured.filter((p) => {
      if (universityFilter && (L(t, p.university_name_en, p.university_name_ar)) !== universityFilter) {
        return false;
      }
      if (categoryFilter && p.category !== categoryFilter) {
        return false;
      }
      if (q) {
        const haystack = [p.title_en, p.title_ar, p.university_name_en, p.university_name_ar, p.category]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [notFeatured, search, universityFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredNotFeatured.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pagedNotFeatured = filteredNotFeatured.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const filtersActive = Boolean(search || universityFilter || categoryFilter);
  function clearFilters() {
    setSearch('');
    setUniversityFilter('');
    setCategoryFilter('');
    setPage(1);
  }
  function updateSearch(value) { setSearch(value); setPage(1); }
  function updateUniversityFilter(value) { setUniversityFilter(value); setPage(1); }
  function updateCategoryFilter(value) { setCategoryFilter(value); setPage(1); }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Featured Projects')}</h1>
          <p className="text-small">
            {t('Pick which published projects show in the landing page\'s "Featured Projects" section, and set their order. A project that gets unpublished drops off the homepage automatically, even while still flagged.')}
          </p>
        </div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}
      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : (
        <>
          <div className="adm-kpis">
            <StatCard label={t('Currently Featured')} value={`${featuredCount} / ${maxFeatured}`} icon="sparkles" note={featuredCount >= maxFeatured ? t('Limit reached') : `${maxFeatured - featuredCount} ${t('slots left')}`} />
            <StatCard label={t('Published Projects')} value={projects.length} icon="projects" />
          </div>

          <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Live on the homepage now')}</h2>
          {featured.length === 0 ? (
            <div className="adm-panel" style={{ textAlign: 'center', marginBottom: 24 }}>
              <p className="adm-empty">{t('No featured projects yet — pick some from the list below.')}</p>
            </div>
          ) : (
            <div className="adm-table-wrap" style={{ marginBottom: 24 }}>
              <table className="adm-table">
                <thead>
                  <tr><th>{t('Order')}</th><th>{t('Project')}</th><th>{t('University')}</th><th>{t('Views')}</th><th>{t('Action')}</th></tr>
                </thead>
                <tbody>
                  {featured.map((p, i) => (
                    <tr key={p.uuid}>
                      <td><span className="badge badge-primary">#{i + 1}</span></td>
                      <td><strong>{L(t, p.title_en, p.title_ar)}</strong></td>
                      <td>{L(t, p.university_name_en, p.university_name_ar) || '—'}</td>
                      <td>{Number(p.views_count)}</td>
                      <td className="adm-actions">
                        <div style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                          <button
                            type="button" className="btn btn-ghost btn-sm" title={t('Move up')}
                            disabled={i === 0 || busyUuid === p.uuid}
                            style={i === 0 ? { opacity: 0.3 } : undefined}
                            onClick={() => runAction(p.uuid, api.post(`/api/v1/admin/featured-projects/${p.uuid}/order`, { direction: 'up' }))}
                          >
                            <Icon name="arrow-up" size={14} />
                          </button>
                          <button
                            type="button" className="btn btn-ghost btn-sm" title={t('Move down')}
                            disabled={i === featured.length - 1 || busyUuid === p.uuid}
                            style={i === featured.length - 1 ? { opacity: 0.3 } : undefined}
                            onClick={() => runAction(p.uuid, api.post(`/api/v1/admin/featured-projects/${p.uuid}/order`, { direction: 'down' }))}
                          >
                            <Icon name="arrow-down" size={14} />
                          </button>
                          <a
                            className="btn btn-ghost btn-sm" title={t('View')} target="_blank" rel="noreferrer"
                            href={`/projects/${encodeURIComponent(p.slug || p.uuid)}`}
                          >
                            <Icon name="eye" size={14} />
                          </a>
                          <button
                            type="button" className="btn btn-outline btn-sm" title={t('Remove from homepage')}
                            disabled={busyUuid === p.uuid}
                            onClick={() => runAction(p.uuid, api.post(`/api/v1/admin/featured-projects/${p.uuid}/unfeature`))}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 8, marginBottom: 'var(--space-3)' }}>
            <h2 className="text-h3" style={{ margin: 0 }}>{t('All published projects')}</h2>
            {notFeatured.length > 0 && (
              <span className="text-caption">
                {filteredNotFeatured.length === notFeatured.length
                  ? `${notFeatured.length} ${t('projects')}`
                  : `${filteredNotFeatured.length} / ${notFeatured.length} ${t('projects')}`}
              </span>
            )}
          </div>

          {notFeatured.length === 0 ? (
            <div className="adm-panel" style={{ textAlign: 'center' }}>
              <p className="adm-empty">{t('Every published project is already featured.')}</p>
            </div>
          ) : (
            <>
              <div className="adm-filters">
                <div className="adm-filters__search">
                <Icon name="search" size={16} />
                <input
                  className="form-input"
                  placeholder={t('Search title or university…')}
                  value={search}
                  onChange={(e) => updateSearch(e.target.value)}
                />
                </div>
                <select
                  className="form-input"
                  value={universityFilter}
                  onChange={(e) => updateUniversityFilter(e.target.value)}
                  style={{ maxWidth: 220 }}
                >
                  <option value="">{t('All universities')}</option>
                  {universityOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                {categoryOptions.length > 0 && (
                  <select
                    className="form-input"
                    value={categoryFilter}
                    onChange={(e) => updateCategoryFilter(e.target.value)}
                    style={{ maxWidth: 180 }}
                  >
                    <option value="">{t('All categories')}</option>
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {filtersActive && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                    {t('Clear filters')}
                  </button>
                )}
              </div>

              {filteredNotFeatured.length === 0 ? (
                <div className="adm-panel" style={{ textAlign: 'center' }}>
                  <p className="adm-empty">{t('No projects match this search.')}</p>
                </div>
              ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr><th>{t('Project')}</th><th>{t('University')}</th><th>{t('Views')}</th><th>{t('Action')}</th></tr>
                </thead>
                <tbody>
                  {pagedNotFeatured.map((p) => (
                    <tr key={p.uuid}>
                      <td><strong>{L(t, p.title_en, p.title_ar)}</strong></td>
                      <td>{L(t, p.university_name_en, p.university_name_ar) || '—'}</td>
                      <td>{Number(p.views_count)}</td>
                      <td className="adm-actions">
                        <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                          <a
                            className="btn btn-ghost btn-sm" title={t('View')} target="_blank" rel="noreferrer"
                            href={`/projects/${encodeURIComponent(p.slug || p.uuid)}`}
                          >
                            <Icon name="eye" size={14} />
                          </a>
                          {featuredCount < maxFeatured ? (
                            <button
                              type="button" className="btn btn-primary btn-sm"
                              disabled={busyUuid === p.uuid}
                              onClick={() => runAction(p.uuid, api.post(`/api/v1/admin/featured-projects/${p.uuid}/feature`))}
                            >
                              <Icon name="sparkles" size={14} /> {t('Feature')}
                            </button>
                          ) : (
                            <span className="text-caption">{t('Limit reached')}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}

              {filteredNotFeatured.length > 0 && <Pager page={currentPage} setPage={setPage} total={filteredNotFeatured.length} perPage={PER_PAGE} />}
            </>
          )}
        </>
      )}
    </>
  );
}
