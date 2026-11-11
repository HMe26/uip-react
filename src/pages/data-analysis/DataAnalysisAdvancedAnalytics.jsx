import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { GroupedBars, HBarChart, KpiCard, Panel, fmt } from '../../components/insight/charts';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/advanced-analytics/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/advanced-analytics/index.php, talking
 * to the real JSON API (DataAnalysisAdvancedAnalyticsApiController::
 * index(), /api/v1/data-analysis/advanced-analytics — reuses
 * AdvancedAnalyticsService exactly as the server-rendered view). The
 * Leaflet map from the PHP view is intentionally left out here (React
 * SPA has no server-side <script> injection point for it); the same
 * per-country data is still shown as a ranked bar list.
 */
const TABS = ['geo', 'cohort', 'compare'];

// Retention heat cell: color strength follows the value, and the label flips
// to white on dark cells so it stays readable (contrast fix).
function heat(pct) {
  if (pct === null || pct === undefined) return { background: 'var(--bg-canvas)', color: 'var(--text-secondary)' };
  const a = 0.12 + (Math.max(0, Math.min(100, pct)) / 100) * 0.88;
  return { background: `rgba(var(--color-primary-rgb), ${a.toFixed(2)})`, color: a > 0.5 ? '#fff' : 'var(--text-primary)' };
}

export default function DataAnalysisAdvancedAnalytics() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('geo');
  const [country, setCountry] = useState(null);
  const [leaders, setLeaders] = useState(null); // lazily loaded for the compare tab

  useEffect(() => {
    api.get('/api/v1/data-analysis/advanced-analytics')
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'compare' || leaders !== null) return;
    api.get('/api/v1/data-analysis/dashboard')
      .then((json) => setLeaders(json.data?.leaderboard || []))
      .catch(() => setLeaders([]));
  }, [tab, leaders]);

  const datasets = data?.datasets || [];
  const geographic = useMemo(() => (data?.geographic || []).slice().sort((a, b) => (b.project_count || 0) - (a.project_count || 0)), [data]);
  const cohort = data?.cohort || [];

  const cohortStats = useMemo(() => {
    const at = (row, o) => {
      const p = row.offsets?.[o];
      return p && p.pct !== null && p.pct !== undefined ? Number(p.pct) : null;
    };
    const avg = (o) => {
      const vals = cohort.map((r) => at(r, o)).filter((v) => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    // Best cohort = highest retention at the latest offset every cohort has data for.
    let best = null;
    [3, 2, 1].some((o) => {
      const scored = cohort.map((r) => ({ r, v: at(r, o) })).filter((x) => x.v !== null);
      if (!scored.length) return false;
      best = scored.sort((a, b) => b.v - a.v)[0].r.cohort_month;
      return true;
    });
    let drop = null;
    for (let o = 0; o < 5; o += 1) {
      const a = avg(o); const b = avg(o + 1);
      if (a !== null && b !== null && (!drop || a - b > drop.by)) drop = { from: o, to: o + 1, by: a - b };
    }
    return { best, m3: avg(3), m5: avg(5), drop };
  }, [cohort]);

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  const totalProjects = geographic.reduce((s, r) => s + (r.project_count || 0), 0);
  const selected = geographic.find((r) => r.country === country) || geographic[0];
  const tabLabel = { geo: t('Geographic Distribution'), cohort: t('Cohort Retention'), compare: t('Comparative Analysis') };
  const pctText = (v) => (v === null ? '—' : `${v.toFixed(1)}%`);

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Advanced Analytics')}</h1>
          <p>{t('Statistical, correlation, and pivot analysis over live platform data, with time series, comparisons, and drill-through into Data Explorer.')}</p>
        </div>
      </div>

      {datasets.length > 0 && (
        <div className="insight-grid insight-grid--kpi" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {datasets.map((ds) => (
            <Link key={ds.key} to={`/data-analysis/advanced-analytics/${ds.key}`} className="kpi-card animate-rise-in" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="kpi-card__top"><strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{ds.label?.[locale] || ds.label?.en}</strong><Icon name={ds.icon || 'grid'} size={18} style={{ color: 'var(--color-primary)' }} /></div>
              <p style={{ margin: 0, fontSize: 14, flex: 1 }}>{ds.description?.[locale] || ds.description?.en}</p>
              <span style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: 14 }}>{t('Analyze →')}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab-link${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{tabLabel[k]}</button>
        ))}
      </div>

      {tab === 'geo' && (
        <div className="insight-grid insight-grid--main animate-rise-in">
          <Panel title={t('Geographic Distribution')} subtitle={t('Universities and projects by country (real data from the universities table).')}>
            {geographic.length === 0 ? <p className="chart-empty">{t('No country data recorded yet.')}</p> : (
              <ul className="hbars" style={{ gap: 6 }}>
                {geographic.map((row) => {
                  const share = totalProjects ? Math.round((row.project_count / totalProjects) * 100) : 0;
                  const active = selected?.country === row.country;
                  return (
                    <li key={row.country} style={{ gridTemplateColumns: '1fr', gap: 6 }}>
                      <button
                        type="button" onClick={() => setCountry(row.country)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'block', padding: '10px 12px', borderRadius: 14, background: active ? 'rgba(var(--color-primary-rgb), .08)' : 'transparent' }}
                      >
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                          <strong>{row.country}{!row.has_coordinates && <span className="text-caption"> ({t('no coordinates')})</span>}</strong>
                          <span className="num">{share}%</span>
                        </span>
                        <span className="hbars__track" style={{ display: 'block' }}><span style={{ width: `${Math.max(3, share)}%`, background: 'var(--color-primary)' }} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title={t('Selected country')} className="panel--soft">
            {selected ? (
              <>
                <h3 style={{ fontSize: 26, margin: '0 0 20px', fontWeight: 600 }}>{selected.country}</h3>
                <div className="insight-grid" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
                  <div><div className="text-caption">{t('Universities')}</div><strong style={{ fontSize: 24 }}>{fmt(selected.university_count)}</strong></div>
                  <div><div className="text-caption">{t('Projects')}</div><strong style={{ fontSize: 24 }}>{fmt(selected.project_count)}</strong></div>
                  <div><div className="text-caption">{t('Share of projects')}</div><strong style={{ fontSize: 24 }}>{totalProjects ? Math.round((selected.project_count / totalProjects) * 100) : 0}%</strong></div>
                </div>
              </>
            ) : <p className="chart-empty">{t('No country data recorded yet.')}</p>}
          </Panel>
        </div>
      )}

      {tab === 'cohort' && (
        <div className="animate-rise-in">
          {cohort.length === 0 ? <Panel><p className="chart-empty">{t('Not enough data yet.')}</p></Panel> : (
            <>
              <div className="insight-grid insight-grid--kpi">
                <KpiCard label={t('Best Cohort')} value={cohortStats.best || '—'} tone="success" />
                <KpiCard label={t('Avg M3 Retention')} value={pctText(cohortStats.m3)} tone="primary" />
                <KpiCard label={t('Avg M5 Retention')} value={pctText(cohortStats.m5)} tone="info" />
                <KpiCard label={t('Largest Drop-off')} value={cohortStats.drop ? `M${cohortStats.drop.from} → M${cohortStats.drop.to}` : '—'} tone="danger" note={cohortStats.drop ? `−${cohortStats.drop.by.toFixed(1)} ${t('pts')}` : undefined} />
              </div>
              <Panel title={t('Cohort Retention (Students)')} subtitle={t('Share of each monthly signup cohort that submitted at least one project in the following months.')} className="panel--flat">
                <div className="table-responsive" style={{ padding: '0 28px 24px' }}>
                  <table className="data-table" style={{ borderSpacing: 6, borderCollapse: 'separate' }}>
                    <thead>
                      <tr><th>{t('Cohort')}</th><th>{t('Size')}</th>{Array.from({ length: 6 }, (_, o) => <th key={o} style={{ textAlign: 'center' }}>M{o}</th>)}</tr>
                    </thead>
                    <tbody>
                      {cohort.map((row) => (
                        <tr key={row.cohort_month}>
                          <td><strong>{row.cohort_month}</strong></td>
                          <td className="num">{fmt(row.cohort_size)}</td>
                          {Array.from({ length: 6 }, (_, o) => {
                            const point = row.offsets?.[o];
                            const v = point && point.pct !== null && point.pct !== undefined ? Number(point.pct) : null;
                            return (
                              <td key={o} className="num" style={{ ...heat(v), textAlign: 'center', borderRadius: 12, fontWeight: 700, padding: '14px 10px', borderBottom: 'none' }}>
                                {v === null ? '—' : `${Math.round(v)}%`}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </div>
      )}

      {tab === 'compare' && (
        <Panel className="animate-rise-in" title={t('Compare universities')} subtitle={t('Projects submitted per university (top universities by volume).')}>
          {leaders === null ? <p className="text-small">{t('Loading…')}</p> : (
            <GroupedBars
              emptyText={t('No projects submitted yet.')}
              series={[{ key: 'projects', label: t('Projects'), color: 'var(--color-primary)' }]}
              items={leaders.map((u) => ({ label: u.university?.[locale] || u.university?.en || '', projects: u.projects }))}
            />
          )}
        </Panel>
      )}
    </>
  );
}
