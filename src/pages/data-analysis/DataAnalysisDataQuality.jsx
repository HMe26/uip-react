import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, getTokens } from '../../api/client';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { exportFromCsvBlob } from '../../lib/exporter';
import { Drawer, Panel, fmt } from '../../components/insight/charts';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/data-quality/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Data Quality — Insight Platform layout.
 * Real data from /api/v1/data-analysis/data-quality (DataQualityService live
 * checks). Status labels, insight cards and the review drawer are all derived
 * from those real reports; the CSV export keeps the authenticated blob-fetch
 * pattern used elsewhere in this portal.
 */

const HEALTHY = 80;
const ATTENTION = 70;

function statusOf(score) {
  if (score === null || score === undefined) return 'unknown';
  if (score >= HEALTHY) return 'healthy';
  if (score >= ATTENTION) return 'attention';
  return 'critical';
}
const STATUS_CLASS = { healthy: 'badge-success', attention: 'badge-warning', critical: 'badge-danger', unknown: 'badge-neutral' };
const toneClass = (pct) => (pct === null || pct === undefined ? '' : pct >= 85 ? 'text-good' : pct >= 65 ? 'text-warn' : 'text-bad');
const pct = (v) => (v === null || v === undefined ? null : Number(v));
const showPct = (v) => (pct(v) === null ? '—' : `${Math.round(pct(v))}%`);

function ScoreRing({ score, label }) {
  const value = score ?? 0;
  const R = 52; const C = 2 * Math.PI * R;
  const tone = statusOf(score);
  const color = tone === 'healthy' ? 'var(--color-success)' : tone === 'attention' ? 'var(--color-accent)' : 'var(--color-danger)';
  return (
    <div className="score-ring">
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="10" />
        <circle cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(Math.min(value, 100) / 100) * C} ${C}`} transform="rotate(-90 60 60)" />
      </svg>
      <strong>{score === null || score === undefined ? '—' : Number(score).toFixed(1)}</strong>
    </div>
  );
}

export default function DataAnalysisDataQuality() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [reports, setReports] = useState([]);
  const [overallScore, setOverallScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportingKey, setExportingKey] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [review, setReview] = useState(null);

  useEffect(() => {
    api.get('/api/v1/data-analysis/data-quality')
      .then((json) => {
        setReports(json.data?.reports || []);
        setOverallScore(json.data?.overall_score ?? null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const name = (r) => r.label?.[locale] || r.label?.en || r.key;

  const handleExport = async (key, format = 'csv') => {
    setExportingKey(key);
    try {
      const { accessToken } = getTokens();
      const res = await fetch(`/api/v1/data-analysis/data-quality/${encodeURIComponent(key)}/export`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const report = reports.find((r) => r.key === key);
      await exportFromCsvBlob(await res.blob(), {
        format,
        filename: `data_quality_${key}`,
        title: `${t('Data Quality')} — ${report ? name(report) : key}`,
        rtl: locale === 'ar',
      });
    } catch (err) {
      setError(t(errorMessage(err)));
    } finally {
      setExportingKey(null);
    }
  };

  const rows = useMemo(() => {
    const list = reports.filter((r) => statusFilter === 'all' || statusOf(r.score) === statusFilter);
    const by = {
      name: (a, b) => name(a).localeCompare(name(b)),
      high: (a, b) => (b.score ?? -1) - (a.score ?? -1),
      low: (a, b) => (a.score ?? 101) - (b.score ?? 101),
    }[sort];
    return list.slice().sort(by);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, statusFilter, sort, locale]);

  // Insight cards: the weakest entities first, plus the strongest as an "info" card.
  const insights = useMemo(() => {
    const scored = reports.filter((r) => r.score !== null && r.score !== undefined);
    const weakest = scored.slice().sort((a, b) => a.score - b.score).filter((r) => statusOf(r.score) !== 'healthy').slice(0, 3);
    const best = scored.slice().sort((a, b) => b.score - a.score)[0];
    const cards = weakest.map((r) => ({ report: r, level: statusOf(r.score) === 'critical' ? 'critical' : 'warning' }));
    if (best && !cards.some((c) => c.report.key === best.key)) cards.push({ report: best, level: 'info' });
    return cards.slice(0, 4);
  }, [reports]);

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error && !reports.length) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  const overallTone = statusOf(overallScore);
  const overallLabel = { healthy: t('Good'), attention: t('Needs attention'), critical: t('Critical'), unknown: '—' }[overallTone];
  const STATUS_TEXT = { healthy: t('Healthy'), attention: t('Needs attention'), critical: t('Critical'), unknown: '—' };
  const LEVEL_TEXT = { critical: t('Critical'), warning: t('Warning'), info: t('Info') };
  const LEVEL_CLASS = { critical: 'text-bad', warning: 'text-warn', info: '' };

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Data Quality')}</h1>
          <p>{t('Live checks for completeness, duplicates, outliers, validity, and freshness.')}</p>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</p>}

      <Panel className="animate-rise-in" >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <ScoreRing score={overallScore} label={t('Overall score')} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{overallLabel}</h2>
            <p style={{ margin: '6px 0 0' }}>{t('Overall data health')}</p>
          </div>
          <span className="text-caption">{reports.length} {t('entities monitored')}</span>
        </div>
      </Panel>

      <div className="toolbar" style={{ marginTop: 24 }}>
        <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('Status')}>
          <option value="all">{t('All Statuses')}</option>
          <option value="healthy">{t('Healthy')}</option>
          <option value="attention">{t('Needs attention')}</option>
          <option value="critical">{t('Critical')}</option>
        </select>
        <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('Sort')}>
          <option value="name">{t('Entity A–Z')}</option>
          <option value="high">{t('Score: high to low')}</option>
          <option value="low">{t('Score: low to high')}</option>
        </select>
      </div>

      <Panel className="panel--flat animate-rise-in">
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('Entity')}</th><th>{t('Completeness')}</th><th>{t('Uniqueness')}</th><th>{t('Validity')}</th>
                <th>{t('Freshness')}</th><th>{t('Outliers')}</th><th>{t('Overall Score')}</th><th>{t('Status')}</th><th aria-label={t('Action')} />
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((r) => {
                const st = statusOf(r.score);
                const days = r.freshness?.days_since_last;
                return (
                  <tr key={r.key}>
                    <td>
                      <strong>{name(r)}</strong>
                      <div className="text-caption num">{fmt(r.total_rows)} {t('rows')}</div>
                    </td>
                    <td className={`num ${toneClass(r.completeness?.pct)}`}>{showPct(r.completeness?.pct)}</td>
                    <td className="num">
                      {showPct(r.duplicates?.pct)}
                      {r.duplicates?.group_count > 0 && <div className="text-caption">{r.duplicates.group_count} {t('dup groups')}</div>}
                    </td>
                    <td className={`num ${toneClass(r.validity?.pct)}`}>{showPct(r.validity?.pct)}</td>
                    <td className={`num ${days === null || days === undefined ? '' : days <= 7 ? 'text-good' : days <= 30 ? 'text-warn' : 'text-bad'}`}>
                      {days === null || days === undefined ? '—' : days === 0 ? t('Today') : (locale === 'ar' ? `منذ ${days} يوم` : `${days}d ago`)}
                    </td>
                    <td className="num">{(r.outliers || []).length} {t('column(s)')}</td>
                    <td className="num"><strong>{r.score !== null && r.score !== undefined ? Math.round(r.score) : '—'}</strong></td>
                    <td><span className={`badge ${STATUS_CLASS[st]}`}>{STATUS_TEXT[st]}</span></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title={t('Review issue')} aria-label={t('Review issue')} onClick={() => setReview(r)}><Icon name="eye" size={16} /></button>
                        <ExportMenu iconOnly busy={exportingKey === r.key} onExport={(f) => handleExport(r.key, f)} />
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={9}><p className="chart-empty" style={{ margin: 8 }}>{reports.length ? t('No entities match this filter.') : t('No data to check')}</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {insights.length > 0 && (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '36px 0 16px' }}>{t('Actionable insights')}</h2>
          <div className="insight-grid insight-grid--kpi" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {insights.map(({ report: r, level }) => (
              <div className="kpi-card" key={r.key} style={{ gap: 8 }}>
                <span className={`text-caption ${LEVEL_CLASS[level]}`} style={{ fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{LEVEL_TEXT[level]}</span>
                <strong style={{ fontSize: 19, fontWeight: 600 }}>{name(r)}</strong>
                <p style={{ margin: 0, flex: 1, fontSize: 14.5, lineHeight: 1.5 }}>
                  {(r.suggestions || [])[0] || (locale === 'ar' ? 'كل الأبعاد ضمن الحدود المقبولة.' : 'All dimensions are within acceptable limits.')}
                </p>
                <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', paddingInline: 0, color: 'var(--color-primary)' }} onClick={() => setReview(r)}>
                  {t('Review issue')} <Icon name={locale === 'ar' ? 'arrow-left' : 'arrow-right'} size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <Drawer
        open={!!review}
        title={review ? name(review) : ''}
        subtitle={t('Issue details')}
        onClose={() => setReview(null)}
      >
        {review && (
          <>
            <div className="drawer__hint">
              {t('Overall Score')}: <strong>{review.score !== null && review.score !== undefined ? Number(review.score).toFixed(1) : '—'}</strong>
              {' · '}{fmt(review.total_rows)} {t('rows')}
            </div>
            {review.completeness?.columns?.some((c) => c.missing_pct > 0) && (
              <>
                <h3 style={{ fontSize: 16, margin: '8px 0' }}>{t('Missing rate')}</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {review.completeness.columns.filter((c) => c.missing_pct > 0).map((c) => (
                    <span className="badge badge-neutral text-mono" key={c.column}>{c.column}: {c.missing_pct}%</span>
                  ))}
                </div>
              </>
            )}
            {(review.outliers || []).length > 0 && (
              <>
                <h3 style={{ fontSize: 16, margin: '8px 0' }}>{t('Outliers')}</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {review.outliers.map((o, i) => (
                    <span className="badge badge-warning text-mono" key={i}>{typeof o === 'string' ? o : (o.column || JSON.stringify(o))}</span>
                  ))}
                </div>
              </>
            )}
            <h3 style={{ fontSize: 16, margin: '8px 0' }}>{t('Suggestions')}</h3>
            {(review.suggestions || []).length ? (
              <ul className="insight-list">
                {review.suggestions.map((s, i) => (
                  <li key={i}><Icon name="flask" size={18} /><div><span style={{ marginTop: 0, color: 'var(--text-primary)' }}>{s}</span></div></li>
                ))}
              </ul>
            ) : <p>{t('No suggestions — this dataset looks clean.')}</p>}
            <div style={{ marginTop: 24, display: 'flex' }}>
              <ExportMenu
                className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
                busy={exportingKey === review.key} onExport={(f) => handleExport(review.key, f)}
              />
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
