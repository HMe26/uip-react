import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import { L, LO } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/analytics';
import i18nKit from '../../i18n/admin/page-kit';
import AdminPage, { ErrorState, Kpi, KpiGrid, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nKit, ...i18nCommon, ...i18nPage };

/**
 * Platform Analytics — Admin design. Same real endpoints as before:
 *   GET /api/v1/analytics/overview  (platform KPIs, user growth, users by role, ecosystem,
 *                                    university / faculty / department leaderboards, most viewed / interacted)
 *   GET /api/v1/analytics/trends    (category growth, last 30 days)
 * Nothing here is invented.
 */

function Ranking({ title, rows, nameOf, subOf }) {
  const t = useTranslations(translations);
  const max = rows.length ? Math.max(1, ...rows.map((r) => r.projects)) : 1;
  return (
    <div className="adm-panel">
      <div className="adm-panel__head"><div><h3>{title}</h3></div></div>
      {rows.length === 0 && <p className="adm-empty">{t('Not enough data yet.')}</p>}
      {rows.map((r, i) => (
        <div key={i} className="adm-rank">
          <span>{nameOf(r)}{subOf && subOf(r) && <small className="ap-sub">{subOf(r)}</small>}</span>
          <span className="adm-bar__num">{r.projects}</span>
          <span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${Math.max(3, (r.projects / max) * 100)}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

function ProjectList({ title, rows, metric, icon, empty }) {
  const t = useTranslations(translations);
  return (
    <div className="adm-panel">
      <div className="adm-panel__head"><div><h3>{title}</h3></div></div>
      {rows.length === 0 && <p className="adm-empty">{empty}</p>}
      {rows.map((p) => {
        const uni = L(t, p.university_name_en, p.university_name_ar);
        return (
          <div key={p.uuid} className="adm-trend">
            <span>
              <a href={`/projects/${p.slug || p.uuid}`} style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}>{L(t, p.title_en, p.title_ar) || ''}</a>
              {uni && <small>{uni}</small>}
            </span>
            <span className="badge badge-neutral"><Icon name={icon} size={13} /> {Number(p[metric] || 0).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminAnalyticsDashboard() {
  const t = useTranslations(translations);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/api/v1/analytics/overview')
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const page = {
    icon: 'trend',
    title: t('Platform Analytics'),
    subtitle: t('An overview of platform performance across every role and university.'),
    actions: <Link to="/admin/statistics" className="btn btn-outline"><Icon name="chart" size={16} /> {t('Full Innovation Statistics')}</Link>,
  };
  if (loading) return <AdminPage {...page}><Skeleton rows={6} cols={4} /></AdminPage>;
  if (error) return <AdminPage {...page}><ErrorState error={error} onRetry={() => window.location.reload()} /></AdminPage>;
  if (!data) return null;

  const overview = data.platform || {};
  const eco = data.ecosystem || {};
  const growth = (data.user_growth || []).map((p) => ({ label: LO(t, p.label) || '', value: p.value }));
  const usersByRole = data.users_by_role || [];
  const roleMax = usersByRole.length ? Math.max(1, ...usersByRole.map((p) => p.value)) : 1;
  const n = (v) => Number(v || 0).toLocaleString();

  return (
    <AdminPage {...page}>
      <KpiGrid>
        <Kpi title={t('Registered users')} value={n(overview.total_users)} icon="users" />
        <Kpi title={t('New users (this month)')} value={n(overview.new_users_this_month)} icon="trend" />
        <Kpi title={t('Platform approval rate')} value={`${overview.approval_rate || 0}%`} icon="check-circle" />
        <Kpi title={t('Verified universities')} value={n(overview.verified_universities)} icon="building" />
      </KpiGrid>

      <div className="adm-grid">
        <div className="adm-panel">
          <div className="adm-panel__head"><div><h2>{t('New User Growth per Month')}</h2><p>{t('Registrations over time')}</p></div></div>
          <AreaChart points={growth} />
        </div>
        <div className="adm-panel">
          <div className="adm-panel__head"><div><h2>{t('Users by Role')}</h2><p>{t('Role adoption')}</p></div></div>
          {usersByRole.length === 0 && <p className="adm-empty">{t('No users yet.')}</p>}
          <div className="adm-bars">
            {usersByRole.map((p, i) => (
              <div key={i} className="adm-bar">
                <span>{LO(t, p.label)}</span>
                <span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${Math.max(3, (p.value / roleMax) * 100)}%` }} /></span>
                <span className="adm-bar__num">{Number(p.value).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2 className="ap-section-title">{t('UIPE Project Ecosystem')}</h2>
      <KpiGrid>
        <Kpi title={t('Total projects')} value={n(eco.total_projects)} icon="folder" />
        <Kpi title={t('Published')} value={n(eco.published_projects)} icon="check-circle" />
        <Kpi title={t('Pending')} value={n(eco.pending_projects)} icon="clock" />
        <Kpi title={t('Categories')} value={n(eco.project_categories)} icon="layers" />
        <Kpi title={t('Universities')} value={n(eco.universities)} icon="building" />
        <Kpi title={t('Faculties')} value={n(eco.faculties)} icon="grid" />
        <Kpi title={t('Departments')} value={n(eco.departments)} icon="layers" />
        <Kpi title={t('Students')} value={n(eco.students)} icon="users" />
      </KpiGrid>

      <div className="adm-grid ap-flow">
        <Ranking title={t('Universities Ranked by Project Volume')} rows={data.university_leaderboard || []} nameOf={(r) => LO(t, r.university)} />
        <Ranking title={t('Most Active Faculties')} rows={data.faculty_leaderboard || []} nameOf={(r) => LO(t, r.name)} subOf={(r) => LO(t, r.university)} />
        <Ranking title={t('Most Active Departments')} rows={data.department_leaderboard || []} nameOf={(r) => LO(t, r.name)} subOf={(r) => [LO(t, r.faculty), LO(t, r.university)].filter(Boolean).join(' · ')} />
      </div>

      <div className="adm-grid ap-flow">
        <ProjectList title={t('Most Viewed (Platform-wide)')} rows={data.most_viewed_projects || []} metric="views_count" icon="eye" empty={t('No views recorded yet.')} />
        <ProjectList title={t('Most Interacted (Platform-wide)')} rows={data.most_interacted_projects || []} metric="interactions" icon="link" empty={t('No interactions recorded yet.')} />
        <div className="adm-panel">
          <div className="adm-panel__head"><div><h3>{t('Growth Trends (30 days)')}</h3><p>{t('Submissions vs. the prior 30-day period, by category.')}</p></div></div>
          <TrendsPanel />
        </div>
      </div>
    </AdminPage>
  );
}

function TrendsPanel() {
  const t = useTranslations(translations);
  const [trends, setTrends] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/analytics/trends', { days: 30, limit: 5 })
      .then((json) => setTrends(json.data?.category_trends || []))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (trends === null) return <p className="adm-empty">{t('Loading…')}</p>;
  if (trends.length === 0) return <p className="adm-empty">{t('Not enough data yet to compute trends.')}</p>;

  return trends.map((row, i) => {
    const g = row.growth_pct;
    return (
      <div key={i} className="adm-trend">
        <span>{LO(t, row.label)}<small>{row.current} {t('vs')} {row.previous}</small></span>
        {g === null ? (
          <span className="badge badge-neutral">{t('New')}</span>
        ) : (
          <span className={`badge ${g >= 0 ? 'badge-success' : 'badge-danger'}`}>{g >= 0 ? '+' : ''}{g}%</span>
        )}
      </div>
    );
  });
}
