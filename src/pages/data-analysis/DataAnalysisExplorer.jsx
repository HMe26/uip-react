import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/explorer/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/explorer/index.php, talking to the
 * real JSON API (app/Controllers/Api/DataAnalysisExplorerApiController.php,
 * /api/v1/data-analysis/data-explorer — new, thin wrapper reusing
 * App\Services\DataExplorerService exactly as the server-rendered view
 * already does — live row counts + per-user favorite/recently-opened
 * state over the six allow-listed catalog datasets).
 */
export default function DataAnalysisExplorer() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [datasets, setDatasets] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingKey, setTogglingKey] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/data-explorer')
      .then((json) => {
        setDatasets(json.data?.datasets || []);
        setRecent(json.data?.recent || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleFavorite = (key) => {
    setTogglingKey(key);
    api.post(`/api/v1/data-analysis/data-explorer/${encodeURIComponent(key)}/favorite`, {})
      .then((json) => {
        setDatasets((prev) => prev.map((d) => (d.key === key ? { ...d, is_favorite: json.data?.is_favorite } : d)));
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setTogglingKey(null));
  };

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Data Explorer')}</h1>
          <p className="text-small">{t("Browse the platform's core datasets: preview, columns, relationships, and metadata.")}</p>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <h2 className="text-h4" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <Icon name="clock" size={16} /> {t('Recently Opened')}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {recent.map((d) => (
              <Link key={d.key} to={`/data-analysis/data-explorer/${d.key}`} className="btn btn-ghost btn-sm">
                <Icon name={d.icon || 'grid'} size={14} /> {d.label?.[locale] || d.label?.en}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 'var(--space-4)' }}>
        {datasets.map((d) => (
          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} key={d.key}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Icon name={d.icon || 'grid'} size={20} />
                <h2 className="text-h4" style={{ margin: 0 }}>{d.label?.[locale] || d.label?.en}</h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title={t('Favorite')}
                disabled={togglingKey === d.key}
                style={{ color: d.is_favorite ? 'var(--color-warning, #f5a623)' : 'inherit' }}
                onClick={() => toggleFavorite(d.key)}
              >
                <Icon name="star" size={16} />
              </button>
            </div>
            <p className="text-small" style={{ flex: 1, color: 'var(--text-secondary)' }}>{d.description?.[locale] || d.description?.en}</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="badge badge-neutral">{Number(d.row_count || 0).toLocaleString()} {t('rows')}</span>
              <Link to={`/data-analysis/data-explorer/${d.key}`} className="btn btn-primary btn-sm">
                <Icon name="eye" size={14} /> {t('Open')}
              </Link>
            </div>
          </div>
        ))}
      </div>

      {datasets.length === 0 && (
        <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <p className="text-h3">{t('No datasets available')}</p>
        </div>
      )}
    </>
  );
}
