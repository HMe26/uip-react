import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/explorer/show';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/explorer/show.php, talking to the real
 * JSON API (DataAnalysisExplorerApiController::show(), /api/v1/data-
 * analysis/data-explorer/{key} — reuses DataExplorerService exactly as
 * the server-rendered view). Filters/sort/group/sample/pagination are
 * client-side React state translated into the same GET params the PHP
 * controller already reads, re-fetched on every change.
 */

const TABS = [
  { key: 'preview', icon: 'eye' },
  { key: 'columns', icon: 'layers' },
  { key: 'relationships', icon: 'link' },
  { key: 'metadata', icon: 'file' },
];

export default function DataAnalysisExplorerShow() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { key } = useParams();

  const [tab, setTab] = useState('preview');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState('desc');
  const [groupBy, setGroupBy] = useState('');
  const [sample, setSample] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [favLoading, setFavLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/data-analysis/data-explorer/${encodeURIComponent(key)}`, {
      params: { tab, q, sort, dir, group_by: groupBy, sample: sample ? 1 : '', page, per_page: 25 },
    })
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tab, q, sort, dir, groupBy, sample, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, q, sort, dir, groupBy, sample]);

  const toggleFavorite = () => {
    setFavLoading(true);
    api.post(`/api/v1/data-analysis/data-explorer/${encodeURIComponent(key)}/favorite`, {})
      .then((json) => setData((d) => (d ? { ...d, dataset: { ...d.dataset, is_favorite: json.data?.is_favorite } } : d)))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setFavLoading(false));
  };

  if (loading && !data) return <p className="text-small">{t('Loading…')}</p>;
  if (error && !data) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return null;

  const { dataset, columns = [], preview, relationships = [], metadata } = data;

  const totalPages = preview && preview.mode !== 'grouped'
    ? Math.max(1, Math.ceil((preview.total || 0) / (preview.per_page || 25)))
    : 1;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <Link to="/data-analysis/data-explorer" className="text-caption">&larr; {t('Data Explorer')}</Link>
          <h1 className="text-h1" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Icon name={dataset.icon || 'grid'} size={24} /> {dataset.label?.[locale] || dataset.label?.en}
          </h1>
          <p className="text-small">{dataset.description?.[locale] || dataset.description?.en}</p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={favLoading}
            style={{ color: dataset.is_favorite ? 'var(--color-warning, #f5a623)' : 'inherit' }}
            onClick={toggleFavorite}
          >
            <Icon name="star" size={16} /> {t('Favorite')}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            className={`tab-link ${tab === tb.key ? 'is-active' : ''}`}
            onClick={() => setTab(tb.key)}
          >
            <Icon name={tb.icon} size={14} /> {t(tb.key.charAt(0).toUpperCase() + tb.key.slice(1))}
          </button>
        ))}
      </div>

      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>{error}</p>}

      {tab === 'preview' && (
        <>
          <form
            className="glass-panel animate-rise-in"
            style={{ padding: 'var(--space-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-4)' }}
            onSubmit={(e) => { e.preventDefault(); load(); }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Search')}</label>
              <input className="form-input" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search across text columns...')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Sort by')}</label>
              <select className="form-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                {columns.map((c) => <option value={c.name} key={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Direction')}</label>
              <select className="form-select" value={dir} onChange={(e) => setDir(e.target.value)}>
                <option value="desc">{t('Descending')}</option>
                <option value="asc">{t('Ascending')}</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Group by')}</label>
              <select className="form-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">{t('No grouping')}</option>
                {columns.map((c) => <option value={c.name} key={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0 }}>
                <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
                {t('Random sample')}
              </label>
            </div>
            <button type="submit" className="btn btn-secondary"><Icon name="filter" size={16} /> {t('Apply')}</button>
          </form>

          {preview?.mode === 'grouped' ? (
            <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <p className="text-small" style={{ marginBottom: 'var(--space-3)' }}>{t('Grouped by')} <strong>{preview.group_by}</strong></p>
              <div className="table-responsive">
                <table className="data-table">
                  <thead><tr><th>{t('Value')}</th><th>{t('Count')}</th></tr></thead>
                  <tbody>
                    {(preview.rows || []).map((r, i) => (
                      <tr key={i}><td>{r.group_value ?? '—'}</td><td>{r.group_count}</td></tr>
                    ))}
                    {(!preview.rows || preview.rows.length === 0) && (
                      <tr><td colSpan={2} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No data')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : preview && (
            <>
              <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
                <p className="text-caption" style={{ marginBottom: 'var(--space-3)' }}>{t('Total matching rows:')} {Number(preview.total || 0).toLocaleString()}</p>
                <div className="table-responsive">
                  <table className="data-table">
                    <thead><tr>{(preview.columns || []).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {(preview.rows || []).map((row, i) => (
                        <tr key={i}>{(preview.columns || []).map((c) => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>
                      ))}
                      {(!preview.rows || preview.rows.length === 0) && (
                        <tr><td colSpan={(preview.columns || []).length || 1} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No matching rows')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-5)', alignItems: 'center' }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><Icon name="chevron-left" size={16} /></button>
                  <span className="text-small">{page} / {totalPages}</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><Icon name="chevron-right" size={16} /></button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'columns' && (
        <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Column')}</th><th>{t('Type')}</th><th>{t('Nullable')}</th><th>{t('Primary Key')}</th><th>{t('Sensitive')}</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => {
                  const isSensitive = (dataset.sensitive_columns || []).includes(c.name);
                  return (
                    <tr key={c.name}>
                      <td><code>{c.name}</code></td>
                      <td><span className="badge badge-neutral">{c.type}</span></td>
                      <td>{c.nullable ? t('Yes') : t('No')}</td>
                      <td>{c.is_primary ? <Icon name="key" size={14} /> : ''}</td>
                      <td>{isSensitive ? <span className="badge badge-warning">{t('Redacted')}</span> : ''}</td>
                    </tr>
                  );
                })}
                {columns.length === 0 && (
                  <tr><td colSpan={5} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No columns')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'relationships' && (
        <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
          {relationships.length === 0 ? (
            <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('No relationships declared for this dataset.')}</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead><tr><th>{t('Column')}</th><th></th><th>{t('Dataset')}</th><th>{t('Description')}</th></tr></thead>
                <tbody>
                  {relationships.map((r, i) => (
                    <tr key={i}>
                      <td><code>{r.column}</code></td>
                      <td><Icon name="arrow-right" size={14} /></td>
                      <td><Link to={`/data-analysis/data-explorer/${r.references}`}>{r.references}.{r.references_column}</Link></td>
                      <td>{r.label?.[locale] || r.label?.en}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'metadata' && metadata && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 'var(--space-4)' }}>
          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
            <p className="text-caption">{t('Row Count')}</p>
            <p className="text-h2">{Number(metadata.row_count || 0).toLocaleString()}</p>
          </div>
          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
            <p className="text-caption">{t('Column Count')}</p>
            <p className="text-h2">{Number(metadata.column_count || 0).toLocaleString()}</p>
          </div>
          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
            <p className="text-caption">{t('Redacted Sensitive Columns')}</p>
            <p className="text-h2">{Number(metadata.sensitive_count || 0).toLocaleString()}</p>
          </div>
          {metadata.earliest_at && (
            <>
              <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
                <p className="text-caption">{t('Earliest Record')}</p>
                <p className="text-small">{metadata.earliest_at}</p>
              </div>
              <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
                <p className="text-caption">{t('Latest Record')}</p>
                <p className="text-small">{metadata.latest_at}</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
