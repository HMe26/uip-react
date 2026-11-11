import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/advanced-analytics/show';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/advanced-analytics/show.php, talking
 * to the real JSON API (DataAnalysisAdvancedAnalyticsApiController::
 * show(), /api/v1/data-analysis/advanced-analytics/{key} — reuses
 * AdvancedAnalyticsService exactly as the server-rendered view: real
 * Pearson correlation, real pivot aggregation, real time series/
 * comparative counts). Pivot cell drill-through links into Data
 * Explorer's preview tab with the same filter_column/filter_op/
 * filter_value query params the PHP view already builds.
 */

const TABS = ['statistics', 'correlation', 'pivot', 'timeseries', 'comparative'];
const TAB_ICON = { statistics: 'bar-chart', correlation: 'grid', pivot: 'layers', timeseries: 'trend', comparative: 'chart' };
const TAB_LABEL = { statistics: 'Statistics', correlation: 'Correlation', pivot: 'Pivot Table', timeseries: 'Time Series', comparative: 'Comparative' };

function heatColor(r) {
  if (r === null || r === undefined) return 'transparent';
  const alpha = Math.min(1, Math.abs(r));
  return r >= 0 ? `rgba(37,150,120,${alpha})` : `rgba(214,90,90,${alpha})`;
}

export default function DataAnalysisAdvancedAnalyticsShow() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { key } = useParams();

  const [tab, setTab] = useState('statistics');
  const [column, setColumn] = useState('');
  const [rowDim, setRowDim] = useState('');
  const [colDim, setColDim] = useState('');
  const [valueCol, setValueCol] = useState('');
  const [aggFn, setAggFn] = useState('count');
  const [dateColumn, setDateColumn] = useState('');
  const [days, setDays] = useState(30);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const buildParams = useCallback(() => {
    const params = { tab };
    if (tab === 'statistics' && column) params.column = column;
    if (tab === 'pivot') {
      if (rowDim) params.row_dim = rowDim;
      if (colDim) params.col_dim = colDim;
      if (valueCol) params.value_col = valueCol;
      params.agg_fn = aggFn;
    }
    if (tab === 'timeseries' && dateColumn) params.date_column = dateColumn;
    if (tab === 'comparative') {
      if (dateColumn) params.date_column = dateColumn;
      params.days = days;
    }
    return params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, column, rowDim, colDim, valueCol, aggFn, dateColumn, days]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/data-analysis/advanced-analytics/${encodeURIComponent(key)}`, { params: { tab } })
      .then((json) => {
        setData(json.data);
        if (tab === 'statistics' && json.data?.column) setColumn(json.data.column);
        if (tab === 'pivot' && json.data?.pivot_params) {
          if (json.data.pivot_params.row_dim) setRowDim(json.data.pivot_params.row_dim);
          if (json.data.pivot_params.col_dim) setColDim(json.data.pivot_params.col_dim);
        }
        if ((tab === 'timeseries' || tab === 'comparative') && json.data?.date_column) setDateColumn(json.data.date_column);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tab]);

  useEffect(() => { load(); }, [load]);

  const runWithParams = () => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/data-analysis/advanced-analytics/${encodeURIComponent(key)}`, { params: buildParams() })
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  if (loading && !data) return <p className="text-small">{t('Loading…')}</p>;
  if (error && !data) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return null;

  const { dataset, options = { numeric: [], date: [], categorical: [] } } = data;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <Link to="/data-analysis/advanced-analytics" className="text-caption">&larr; {t('Advanced Analytics')}</Link>
          <h1 className="text-h1" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Icon name={dataset.icon || 'grid'} size={22} /> {dataset.label?.[locale] || dataset.label?.en}
          </h1>
          <p className="text-small">{dataset.description?.[locale] || dataset.description?.en}</p>
        </div>
      </div>

      <div className="tabs" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            className={`tab-link ${tab === tb ? 'is-active' : ''}`}
            onClick={() => setTab(tb)}
          >
            <Icon name={TAB_ICON[tb]} size={14} /> {t(TAB_LABEL[tb])}
          </button>
        ))}
      </div>

      {error && <p style={{ color: 'var(--color-danger)', marginTop: 'var(--space-3)' }}>{error}</p>}

      {tab === 'statistics' && (
        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Numeric column')}</label>
              <select className="form-select" value={column} onChange={(e) => setColumn(e.target.value)}>
                {options.numeric.map((c) => <option value={c} key={c}>{c}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={runWithParams}><Icon name="refresh" size={14} /> {t('Update')}</button>
          </div>

          {options.numeric.length === 0 ? (
            <p className="text-small text-muted">{t('No numeric columns in this dataset.')}</p>
          ) : data.stats ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 'var(--space-4)' }}>
              {[['count', t('Count')], ['min', t('Min')], ['max', t('Max')], ['mean', t('Mean')], ['median', t('Median')], ['stddev', t('Std Dev')]].map(([k, label]) => (
                <div key={k}>
                  <div className="text-caption text-muted">{label}</div>
                  <div className="text-h2" style={{ margin: 0 }}>{data.stats[k] !== null && data.stats[k] !== undefined ? Number(data.stats[k]).toFixed(k === 'count' ? 0 : 2) : '—'}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {tab === 'correlation' && (
        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)', overflowX: 'auto' }}>
          <h2 className="text-h3" style={{ margin: '0 0 var(--space-1) 0' }}>{t('Correlation Heat Map')}</h2>
          <p className="text-caption text-muted" style={{ margin: '0 0 var(--space-3) 0' }}>{t('Pearson correlation between every pair of numeric columns (real sample, up to 3,000 rows).')}</p>
          {(() => {
            const matrix = data.matrix || {};
            const cols = Object.keys(matrix);
            if (cols.length < 2) return <p className="text-small text-muted">{t('Needs at least two numeric columns.')}</p>;
            return (
              <div className="table-responsive">
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: 'var(--space-2)' }} />
                      {cols.map((c) => <th style={{ padding: 'var(--space-2)' }} className="text-caption" key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cols.map((rowKey) => (
                      <tr key={rowKey}>
                        <td style={{ padding: 'var(--space-2)' }} className="text-caption text-mono">{rowKey}</td>
                        {cols.map((c) => {
                          const r = matrix[rowKey]?.[c];
                          return (
                            <td key={c} style={{ padding: 'var(--space-2)', textAlign: 'center', background: heatColor(r), borderRadius: 'var(--radius-sm)' }} className="text-caption text-mono">
                              {r === null || r === undefined ? '—' : Number(r).toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'pivot' && (
        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Rows')}</label>
              <select className="form-select" value={rowDim} onChange={(e) => setRowDim(e.target.value)}>
                {options.categorical.map((c) => <option value={c} key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Columns')}</label>
              <select className="form-select" value={colDim} onChange={(e) => setColDim(e.target.value)}>
                {options.categorical.map((c) => <option value={c} key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Aggregate')}</label>
              <select className="form-select" value={aggFn} onChange={(e) => setAggFn(e.target.value)}>
                <option value="count">{t('COUNT')}</option>
                <option value="sum">{t('SUM')}</option>
                <option value="avg">{t('AVG')}</option>
              </select>
            </div>
            {options.numeric.length > 0 && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">{t('Value column (for SUM/AVG)')}</label>
                <select className="form-select" value={valueCol} onChange={(e) => setValueCol(e.target.value)}>
                  {options.numeric.map((c) => <option value={c} key={c}>{c}</option>)}
                </select>
              </div>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={runWithParams}><Icon name="refresh" size={14} /> {t('Update')}</button>
          </div>

          {options.categorical.length === 0 ? (
            <p className="text-small text-muted">{t('No categorical columns available for a pivot.')}</p>
          ) : data.pivot?.row_keys?.length ? (
            <div className="table-responsive">
              <table className="data-table" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th />
                    {data.pivot.col_keys.map((ck) => <th className="text-caption" key={ck}>{ck}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.pivot.row_keys.map((rk) => (
                    <tr key={rk}>
                      <td className="text-caption text-mono">{rk}</td>
                      {data.pivot.col_keys.map((ck) => {
                        const v = data.pivot.cells?.[rk]?.[ck];
                        return (
                          <td className="text-mono text-caption" key={ck}>
                            {v !== null && v !== undefined ? (
                              <Link
                                to={`/data-analysis/data-explorer/${key}?tab=preview&filter_column=${encodeURIComponent(rowDim)}&filter_op=eq&filter_value=${encodeURIComponent(rk)}`}
                                title={t('View records')}
                              >
                                {Number(v).toFixed(1)}
                              </Link>
                            ) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-small text-muted">{t('Not enough data for this combination.')}</p>
          )}
        </div>
      )}

      {tab === 'timeseries' && (
        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-4)' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Date column')}</label>
              <select className="form-select" value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                {options.date.map((c) => <option value={c} key={c}>{c}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={runWithParams}><Icon name="refresh" size={14} /> {t('Update')}</button>
          </div>

          {options.date.length === 0 ? (
            <p className="text-small text-muted">{t('No date columns in this dataset.')}</p>
          ) : data.series ? (
            (() => {
              const max = Math.max(1, ...data.series.map((p) => p.value || 0));
              return (
                <div className="chart-bars" style={{ alignItems: 'flex-end' }}>
                  {data.series.map((point) => {
                    const h = Math.max(4, Math.round((point.value / max) * 100));
                    return (
                      <div className="chart-bars__col" key={point.month}>
                        <span className="text-caption text-mono">{Number(point.value).toFixed(0)}</span>
                        <div style={{ width: '100%', maxWidth: 28, height: `${h}%`, borderRadius: 'var(--radius-md) var(--radius-md) 0 0', background: 'var(--color-primary)' }} />
                        <span className="text-caption">{point.month}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : null}
        </div>
      )}

      {tab === 'comparative' && (
        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Date column')}</label>
              <select className="form-select" value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                {options.date.map((c) => <option value={c} key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{t('Period length (days)')}</label>
              <select className="form-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[7, 30, 90].map((d) => <option value={d} key={d}>{d}</option>)}
              </select>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={runWithParams}><Icon name="refresh" size={14} /> {t('Update')}</button>
          </div>

          {options.date.length === 0 ? (
            <p className="text-small text-muted">{t('No date columns in this dataset.')}</p>
          ) : data.comparative ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 'var(--space-4)' }}>
              <div>
                <div className="text-caption text-muted">{locale === 'ar' ? `آخر ${data.comparative.days} يوم` : `Last ${data.comparative.days} days`}</div>
                <div className="text-h2" style={{ margin: 0 }}>{Number(data.comparative.recent_period).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-caption text-muted">{locale === 'ar' ? `الـ${data.comparative.days} يوم قبلها` : `Prior ${data.comparative.days} days`}</div>
                <div className="text-h2" style={{ margin: 0 }}>{Number(data.comparative.prior_period).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-caption text-muted">{t('Change')}</div>
                <div className="text-h2" style={{ margin: 0, color: data.comparative.change_pct === null ? 'inherit' : (data.comparative.change_pct >= 0 ? 'var(--uip-teal-600)' : 'var(--uip-coral-600)') }}>
                  {data.comparative.change_pct === null ? '—' : `${data.comparative.change_pct >= 0 ? '+' : ''}${Number(data.comparative.change_pct).toFixed(1)}%`}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
