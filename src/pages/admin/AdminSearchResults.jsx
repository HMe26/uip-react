import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/search-results';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/search-results.php (backing the topbar search
 * box — previously a dead no-op form). Talks to the ONE shared
 * /api/v1/search endpoint (App\Controllers\Api\SearchApiController ->
 * App\Services\SearchService::globalSearch()), scoped to the same three
 * types AdminSearchController::index() covered: users, projects,
 * universities — nothing invented, just wired to the existing generic
 * search surface instead of duplicating a new admin-only one.
 */

const SECTIONS = [
  { type: 'users', titleEn: 'Users', icon: 'users', viewAll: (q) => `/admin/users?q=${encodeURIComponent(q)}`, viewAllLabel: 'View all in Users & Roles', rowLink: null },
  { type: 'projects', titleEn: 'Projects', icon: 'folder', viewAll: (q) => `/admin/projects?q=${encodeURIComponent(q)}`, viewAllLabel: 'View all in Projects & Moderation', rowLink: (r) => `/admin/projects/${r.id}` },
  { type: 'universities', titleEn: 'Universities', icon: 'building', viewAll: (q) => `/admin/universities?q=${encodeURIComponent(q)}`, viewAllLabel: 'View all in Institutions', rowLink: (r) => `/admin/universities/${r.id}` },
];

export default function AdminSearchResults() {
  const t = useTranslations(translations);
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';

  const [results, setResults] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (q.trim() === '') {
      setResults({});
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    api.get('/api/v1/search', { q, types: 'users,projects,universities' })
      .then((json) => {
        setResults(json.data || {});
        setTotal(json.meta?.total || 0);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Search results')}</h1>
          <p className="text-small">
            {q.trim() === ''
              ? t('Type something in the search box above to get started.')
              : `${total} ${total === 1 ? t('result') : t('results')} ${t('for')} "${q}"`}
          </p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <Skeleton rows={6} cols={4} />}

      {!loading && q.trim() !== '' && total === 0 && !error && (
        <div className="adm-panel" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <p className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>{t('No matching results')}</p>
          <p className="text-small">{t('Search covers users, projects, and universities platform-wide.')}</p>
        </div>
      )}

      {SECTIONS.map(({ type, titleEn, icon, viewAll, viewAllLabel, rowLink }) => {
        const rows = results[type] || [];
        if (!rows.length) return null;
        return (
          <section key={type} style={{ marginBottom: 'var(--space-5)' }}>
            <div className="adm-panel__head">
              <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
                <Icon name={icon} size={18} /> {t(titleEn)} <span className="adm-muted">({rows.length})</span>
              </h2>
              <Link to={viewAll(q)} className="adm-link-back">{t(viewAllLabel)}</Link>
            </div>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>{t('Name')}</th><th>{t('Details')}</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.type}-${r.id}`}>
                      <td><strong>{r.title || '—'}</strong></td>
                      <td className="adm-muted">{r.subtitle || '—'}</td>
                      <td className="adm-actions">
                        {rowLink && r.id != null && <Link to={rowLink(r)} className="btn btn-ghost btn-sm">{t('View')}</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
