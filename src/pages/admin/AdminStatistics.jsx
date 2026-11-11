import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import { L, LO } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/innovation-statistics';
import i18nKit from '../../i18n/admin/page-kit';
import AdminPage, { ErrorState, Kpi, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nKit, ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/innovation-statistics.php, talking to the real
 * JSON API (app/Controllers/Api/AnalyticsApiController.php::
 * innovationStatistics() — already built, reuses AnalyticsService +
 * AIAnalysisRepository exactly as
 * Admin\AdminInnovationStatisticsController already does; university_count/
 * universities/departments dropdown data added to that same endpoint
 * alongside this page since the Blade view needed them too). Nothing here
 * is invented.
 */

function StatCard({ label, value, icon }) {
  return <Kpi icon={icon} title={label} value={value} />;
}

function Bar({ label, value, max, count }) {
  const pct = max ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="adm-bar" style={{ gridTemplateColumns: 'minmax(90px, 140px) 1fr auto' }}>
      <span title={label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${pct}%` }} /></span>
      <span className="adm-bar__num">{value}{count !== undefined ? ` (${count})` : ''}</span>
    </div>
  );
}

export default function AdminStatistics() {
  const t = useTranslations(translations);
  const [universityId, setUniversityId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback((filters) => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/analytics/innovation-statistics', filters)
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load({}); }, [load]);

  function applyFilters(e) {
    e.preventDefault();
    load({ university_id: universityId, department_id: departmentId, date_from: dateFrom, date_to: dateTo });
  }

  function resetFilters() {
    setUniversityId(''); setDepartmentId(''); setDateFrom(''); setDateTo('');
    load({});
  }

  function onUniversityChange(id) {
    setUniversityId(id);
    setDepartmentId('');
    load({ university_id: id, date_from: dateFrom, date_to: dateTo });
  }

  const page = {
    icon: 'chart',
    title: t('Innovation Statistics'),
    subtitle: t('Cross-university comparisons and the platform\'s fastest-growing fields.'),
  };
  if (loading && !data) return <AdminPage {...page}><Skeleton rows={6} cols={4} /></AdminPage>;
  if (error) return <AdminPage {...page}><ErrorState error={error} onRetry={() => load({})} /></AdminPage>;
  if (!data) return null;

  const leaderboard = data.university_leaderboard || [];
  const fields = data.category_distribution || [];
  const uniCount = data.university_count || 0;
  const growthMap = data.university_growth_map || {};
  const topTrend = data.top_trend || null;
  const avgReadiness = data.avg_readiness_by_university || {};
  const readiness = data.readiness_summary || { analyzedCount: 0, average: null, highest: null, lowest: null, distribution: [] };
  const byFaculty = data.readiness_by_faculty || [];
  const bySemester = data.readiness_by_semester || [];
  const successRate = data.success_rate || { rate: null, successful: 0, total: 0 };
  const universities = data.universities || [];
  const departments = data.departments || [];

  const maxTrend = fields.length ? Math.max(1, ...fields.map((f) => f.value)) : 1;
  const maxBucket = readiness.distribution.length ? Math.max(1, ...readiness.distribution.map((b) => b.count)) : 1;
  const maxFaculty = byFaculty.length ? Math.max(1, ...byFaculty.map((f) => f.avg_score)) : 1;
  const maxSemester = bySemester.length ? Math.max(1, ...bySemester.map((s) => s.avg_score)) : 1;

  return (
    <AdminPage {...page}>
      <div className="adm-filters">
        <form onSubmit={applyFilters} className="ap-filter-grid">
          <label className="ap-field">
            <span>{t('University')}</span>
            <select className="form-input" value={universityId} onChange={(e) => onUniversityChange(e.target.value)}>
              <option value="">{t('All Universities')}</option>
              {universities.map((u) => <option key={u.id} value={u.id}>{L(t, u.official_name_en, u.official_name_ar)}</option>)}
            </select>
          </label>
          <label className="ap-field">
            <span>{t('Department')}</span>
            <select className="form-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} disabled={!universityId}>
              <option value="">{universityId ? t('All Departments') : t('Pick a university first')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{L(t, d.name_en, d.name_ar)}</option>)}
            </select>
          </label>
          <label className="ap-field">
            <span>{t('From')}</span>
            <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="ap-field">
            <span>{t('To')}</span>
            <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <div className="ap-filter-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>{t('Reset')}</button>
            <button type="submit" className="btn btn-primary btn-sm">{t('Filter')}</button>
          </div>
        </form>
      </div>

      <div className="sa-kpis">
        <StatCard label={t('Universities on Platform')} value={uniCount} icon="building" />
        <StatCard label={t('Most Common Field')} value={LO(t, fields[0]?.label) || '—'} icon="sparkles" />
        <StatCard label={t('Most Active University')} value={LO(t, leaderboard[0]?.university) || '—'} icon="trend" />
        <StatCard label={t('Fields Tracked')} value={fields.length} icon="grid" />
      </div>

      <div className="sa-kpis">
        <StatCard label={t('Projects Analyzed')} value={readiness.analyzedCount} icon="sparkles" />
        <StatCard label={t('Avg. Readiness Score')} value={readiness.average !== null ? readiness.average : '—'} icon="award" />
        <StatCard label={t('Highest Score')} value={readiness.highest !== null ? readiness.highest.score : '—'} icon="trend" />
        <StatCard label={t('Lowest Score')} value={readiness.lowest !== null ? readiness.lowest.score : '—'} icon="alert-triangle" />
      </div>

      <div className="sa-kpis">
        <StatCard label={t('Success / Completion Rate')} value={successRate.rate !== null ? `${successRate.rate}%` : '—'} icon="check-circle" />
        <StatCard label={t('Approved/Published')} value={successRate.successful} icon="award" />
        <StatCard label={t('Decided Projects')} value={successRate.total} icon="grid" />
      </div>

      <div className="adm-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div className="adm-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('Most Common Fields')}</h2>
            {fields.length ? (
<div className="adm-bars">{fields.map((f, i) => (
              <Bar key={i} label={LO(t, f.label)} value={f.value} max={maxTrend} />
))}</div>
) : <p className="text-caption">{t('No categorized projects yet.')}</p>}
          </div>

          <div className="adm-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('University Comparison')}</h2>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>{t('University')}</th><th>{t('Projects')}</th><th>{t('Avg. Readiness Score')}</th><th>{t('Growth (6 mo.)')}</th></tr></thead>
                <tbody>
                  {leaderboard.map((u) => {
                    const growth = growthMap[u.id];
                    const avgScore = avgReadiness[u.id];
                    return (
                      <tr key={u.id}>
                        <td>{LO(t, u.university)}</td>
                        <td>{u.projects}</td>
                        <td>{avgScore == null ? <span className="badge badge-neutral">{t('No data')}</span> : <span className="badge badge-primary">{avgScore}</span>}</td>
                        <td>
                          {(!growth || growth.growth_pct === null)
                            ? <span className="badge badge-neutral">{t('New')}</span>
                            : <span className={`badge ${growth.growth_pct >= 0 ? 'badge-success' : 'badge-danger'}`}>{growth.growth_pct >= 0 ? '+' : ''}{growth.growth_pct}%</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {leaderboard.length === 0 && <tr><td colSpan={4} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No data.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="adm-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('Readiness Score Distribution')}</h2>
            {readiness.analyzedCount > 0 ? (
              <div className="adm-bars">
                {readiness.distribution.map((bucket, i) => (
                  <Bar key={i} label={bucket.label} value={bucket.count} max={maxBucket} />
                ))}
              </div>
            ) : <p className="text-caption">{t('No analyzed projects yet.')}</p>}
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div className="adm-panel">
            <h3 className="text-h3" style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Icon name="users" size={16} /> {t('Faculty Comparison')}</h3>
            {byFaculty.length ? (
<div className="adm-bars">{byFaculty.map((f, i) => (
              <Bar key={i} label={f.faculty} value={f.avg_score} max={maxFaculty} count={f.count} />
))}</div>
) : <p className="text-caption">{t('Not enough data yet to compare by faculty.')}</p>}
          </div>

          <div className="adm-panel">
            <h3 className="text-h3" style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Icon name="calendar" size={16} /> {t('Semester Comparison')}</h3>
            {bySemester.length ? (
<div className="adm-bars">{bySemester.map((s, i) => (
              <Bar key={i} label={`${t('Semester')} ${s.semester}`} value={s.avg_score} max={maxSemester} count={s.count} />
))}</div>
) : <p className="text-caption">{t('Universities haven\'t set students\' current semester yet.')}</p>}
          </div>

          <div className="adm-panel">
            <h3 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Trend Analysis')}</h3>
            {topTrend && topTrend.growth_pct !== null ? (
              <>
                <p className="text-small">{t('The fastest-growing field across every university in the last 30 days:')}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-3)' }}>
                  <span className="text-h3">{LO(t, topTrend.label)}</span>
                  <span className={`badge ${topTrend.growth_pct >= 0 ? 'badge-success' : 'badge-danger'}`}><Icon name="trend" size={12} /> {topTrend.growth_pct >= 0 ? '+' : ''}{topTrend.growth_pct}%</span>
                </div>
                <Link to="/admin/analytics" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-4)', width: '100%', justifyContent: 'center' }}>{t('View All Trends')}</Link>
              </>
            ) : <p className="text-caption">{t('Not enough data yet to compute trends.')}</p>}
          </div>
        </aside>
      </div>
    </AdminPage>
  );
}
