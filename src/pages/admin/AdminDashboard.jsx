import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart } from '../../components/admin/adminUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/dashboard';
import { parseServerDate } from '../../utils/serverDate';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };
// 'Pending' etc. exist in common too; page keys win.

/**
 * Admin Dashboard — new design. Data comes from the same real endpoints as before:
 *   GET /api/v1/admin/dashboard  (KPIs, pending universities, recent activity, AI overview)
 *   GET /api/v1/admin/roles      (users_count per role, for "Users by Role")
 *   GET /api/v1/analytics/overview (user_growth, for the "Platform Growth" chart)
 * "Needs Your Attention" is built only from real counters.
 */

const AI_TYPE_LABELS = {
  readiness_score: 'Readiness Score',
  classification: 'Classification',
  startup_potential: 'Startup Potential',
  improvement_suggestions: 'Improvement Suggestions',
  summary: 'Project Summary',
};

function Kpi({ label, value, icon, note, tone, to }) {
  const t = useTranslations(translations);
  const body = (
    <>
      <div className="adm-kpi__top">{t(label)} <Icon name={icon} size={16} /></div>
      <div className="adm-kpi__value">{Number(value ?? 0).toLocaleString()}</div>
      {note && <div className={`adm-kpi__note${tone ? ` adm-kpi__note--${tone}` : ''}`}>{t(note)}</div>}
    </>
  );
  return to ? <Link to={to} className="adm-kpi">{body}</Link> : <div className="adm-kpi">{body}</div>;
}

// Arabic plural forms: 1 -> singular, 2 -> dual, 3-10 -> plural, 11+ -> singular accusative.
const AR_UNITS = {
  m: { one: 'منذ دقيقة', two: 'منذ دقيقتين', few: 'دقائق', many: 'دقيقة' },
  h: { one: 'منذ ساعة', two: 'منذ ساعتين', few: 'ساعات', many: 'ساعة' },
  d: { one: 'منذ يوم', two: 'منذ يومين', few: 'أيام', many: 'يومًا' },
};
function arAgo(n, u) {
  const f = AR_UNITS[u];
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  return `منذ ${n.toLocaleString('ar-EG')} ${n <= 10 ? f.few : f.many}`;
}
function timeAgo(iso, t, ar) {
  if (!iso) return '';
  const diffMs = Date.now() - parseServerDate(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('just now');
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const [n, u] = mins < 60 ? [mins, 'm'] : hours < 24 ? [hours, 'h'] : [days, 'd'];
  return ar ? arAgo(n, u) : `${n}${u} ago`;
}

// Raw audit keys ("user.joker_enable", "api_token.create") -> readable sentences.
const ACT_VERBS = {
  create: ['Created', 'إنشاء'], update: ['Updated', 'تعديل'], delete: ['Deleted', 'حذف'],
  login: ['Signed in', 'تسجيل دخول'], logout: ['Signed out', 'تسجيل خروج'],
  approve: ['Approved', 'اعتماد'], reject: ['Rejected', 'رفض'], suspend: ['Suspended', 'إيقاف'],
  activate: ['Activated', 'تنشيط'], enable: ['Enabled', 'تفعيل'], disable: ['Disabled', 'تعطيل'],
  revoke: ['Revoked', 'سحب'], grant: ['Granted', 'منح'], export: ['Exported', 'تصدير'],
};
const ACT_FULL = {
  joker_enable: ['Super Admin account enabled', 'تفعيل حساب سوبر أدمن'],
  joker_disable: ['Super Admin account disabled', 'إلغاء حساب سوبر أدمن'],
};
const ACT_ENTITIES = {
  user: ['user', 'مستخدم'], apitoken: ['API token', 'مفتاح API'], api_token: ['API token', 'مفتاح API'],
  university: ['university', 'جامعة'], project: ['project', 'مشروع'], role: ['role', 'دور'],
  company: ['company', 'شركة'], setting: ['setting', 'إعداد'], settings: ['settings', 'الإعدادات'],
};
const humanize = (x) => { const w = String(x || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim(); return w ? w[0].toUpperCase() + w.slice(1) : ''; };
function describeActivity(a, ar) {
  const i = ar ? 1 : 0;
  const parts = String(a.action || '').split('.');
  const verbKey = parts.length > 1 ? parts.slice(1).join('_') : parts[0];
  const entKey = String(a.entity_type || parts[0] || '').replace(/\s+/g, '').toLowerCase();
  const ent = (ACT_ENTITIES[entKey] || [])[i] || a.entity_type || '';
  let title;
  if (ACT_FULL[verbKey]) title = ACT_FULL[verbKey][i];
  else if (ACT_VERBS[verbKey]) title = `${ACT_VERBS[verbKey][i]} ${ent}`.trim();
  else title = humanize(a.action);
  const sub = [ent && ACT_FULL[verbKey] ? ent : '', a.entity_id != null ? `#${a.entity_id}` : ''].filter(Boolean).join(' ');
  return { title, sub };
}

export default function AdminDashboard() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [growth, setGrowth] = useState([]);
  const [visitors, setVisitors] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/admin/dashboard')
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api.get('/api/v1/admin/roles')
      .then((json) => { if (!cancelled) setRoles(json.data || []); })
      .catch(() => {});
    api.get('/api/v1/analytics/overview')
      .then((json) => { if (!cancelled) setGrowth((json.data?.user_growth || []).map((p) => ({ label: (ar ? p.label?.ar : p.label?.en) || p.label?.en || '', value: p.value }))); })
      .catch(() => {});
    api.get('/api/v1/admin/visitors?days=30')
      .then((json) => { if (!cancelled) setVisitors(json.data || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Skeleton rows={6} cols={4} />;
  if (loadError) return <ErrorState error={loadError} />;
  if (!data) return null;

  const ai = data.ai_overview || { completedRuns: 0, failedRuns: 0, analyzedProjects: 0, byType: {} };
  const pendingUnis = data.pending_universities || [];
  const activity = data.recent_activity || [];
  const roleRows = roles.filter((r) => (r.users_count ?? 0) > 0).sort((a, b) => b.users_count - a.users_count);
  const roleTotal = roleRows.reduce((n, r) => n + r.users_count, 0);
  const roleMax = roleRows[0]?.users_count || 1;

  // Real unique visitors: one point per day, label shown every 5th day to keep the axis readable.
  const visitorPoints = (visitors?.series || []).map((p, i, arr) => ({
    label: (arr.length - 1 - i) % 5 === 0 ? p.date.slice(5) : '',
    value: p.active,
  }));

  const attention = [
    { n: data.pending_approvals, text: t('approvals pending'), to: '/admin/approvals', tone: 'warn' },
    { n: pendingUnis.length, text: t('university applications awaiting review'), to: '/admin/universities', tone: 'warn' },
    { n: data.suspended_users, text: t('suspended accounts need manual review'), to: '/admin/users?status=suspended', tone: 'bad' },
    { n: ai.failedRuns, text: t('failed AI analysis runs'), to: '/admin/ai-code-review', tone: 'bad' },
  ].filter((x) => x.n > 0);

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Admin Dashboard')}</h1>
          <p className="text-small">{t('Monitor users, universities, approvals and platform health.')}</p>
        </div>
        <div className="page-header__actions">
          <Link to="/admin/universities" className="btn btn-primary">
            <Icon name="building" size={16} /> {t('Review University Applications')}
          </Link>
        </div>
      </div>


      <div className="adm-kpis">
        <Kpi label={t('Total Users')} value={data.total_users} icon="users" to="/admin/users" />
        <Kpi label={t('Verified Universities')} value={data.verified_universities} icon="building" to="/admin/universities" />
        <Kpi label={t('Published Projects')} value={data.published_projects} icon="folder" />
        <Kpi label={t('Pending Approvals')} value={data.pending_approvals} icon="shield" to="/admin/approvals"
          note={data.pending_approvals > 0 ? t('Needs review') : t('All clear')} tone={data.pending_approvals > 0 ? 'warn' : 'good'} />
        <Kpi label={t('Suspended Accounts')} value={data.suspended_users} icon="x-circle" to="/admin/users?status=suspended"
          note={data.suspended_users > 0 ? t('Needs review') : t('None')} tone={data.suspended_users > 0 ? 'bad' : 'good'} />
        <Kpi label={t('AI Runs Completed')} value={ai.completedRuns} icon="sparkles"
          note={ai.failedRuns > 0 ? `${ai.failedRuns.toLocaleString()} ${t('failed')}` : undefined} tone="bad" />
      </div>

      <div className="adm-grid">
        <div className="adm-panel">
          <div className="adm-panel__head">
            <div><h2>{t('Platform Growth')}</h2><p>{t('New users per month')}</p></div>
          </div>
          <AreaChart points={growth} />
        </div>
        <div className="adm-panel">
          <div className="adm-panel__head">
            <div><h2>{t('Users by Role')}</h2><p>{roleTotal.toLocaleString()} {t('total accounts')}</p></div>
          </div>
          {roleRows.length === 0 && <p className="adm-empty">{t('No role data yet.')}</p>}
          <div className="adm-bars">
            {roleRows.map((r) => (
              <div key={r.slug} className="adm-bar">
                <span>{(ar ? r.name_ar : r.name_en) || r.name_en || r.slug}</span>
                <span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${Math.max(3, (r.users_count / roleMax) * 100)}%` }} /></span>
                <span className="adm-bar__num">{r.users_count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {visitors && (
        <div className="adm-panel">
          <div className="adm-panel__head">
            <div>
              <h2>{t('Real Visitors')}</h2>
              <p>{t('Unique visitors only — each browser counts once per day, refreshes are not counted.')}</p>
            </div>
          </div>
          <div className="adm-kpis" style={{ marginBottom: 16 }}>
            <Kpi label={t('Unique Visitors (all time)')} value={visitors.unique_visitors} icon="users"
              note={`${Number(visitors.raw_page_loads ?? 0).toLocaleString()} ${t('raw page loads')}`} />
            <Kpi label={t('Active Today')} value={visitors.active_today} icon="eye" />
            <Kpi label={t('New Today')} value={visitors.new_today} icon="user" />
            <Kpi label={t('Active – Last 7 Days')} value={visitors.active_7d} icon="calendar" />
            <Kpi label={t('Active – Last 30 Days')} value={visitors.active_30d} icon="calendar" />
            <Kpi label={t('Returning Visitors')} value={visitors.returning} icon="refresh"
              note={visitors.unique_visitors > 0 ? `${Math.round((visitors.returning / visitors.unique_visitors) * 100)}% ${t('of all visitors')}` : undefined} />
          </div>
          <AreaChart points={visitorPoints} height={200} />
          <p className="adm-muted" style={{ marginTop: 8 }}>{t('Unique visitors per day — last 30 days')}</p>
        </div>
      )}

      <div className="adm-grid adm-grid--even">
        <div className="adm-panel adm-panel--fill">
          <div className="adm-panel__head">
            <div><h2>{t('Needs Your Attention')}</h2><p>{t('Open items across the platform')}</p></div>
          </div>
          {attention.length === 0 && (
            <div className="adm-allclear"><Icon name="check-circle" size={18} /> {t('Nothing needs attention right now.')}</div>
          )}
          <ul className="adm-list adm-attn-list">
            {attention.map((a) => (
              <li key={a.text}>
                <Link to={a.to} className={`adm-attn adm-attn--${a.tone || 'warn'}`}>
                  <span className="adm-attn__n">{a.n.toLocaleString()}</span>
                  <span className="adm-attn__t">{a.text}</span>
                  <Icon name="chevron-right" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="adm-panel adm-panel--fill">
          <div className="adm-panel__head">
            <div><h2>{t('Recent Activity')}</h2><p>{t('Latest admin actions')}</p></div>
            <Link to="/admin/audit-logs" className="btn btn-outline btn-sm">{t('View audit log')}</Link>
          </div>
          {activity.length === 0 && <p className="adm-empty">{t('No admin activity yet.')}</p>}
          <div className="adm-act-list">
            {activity.map((a) => {
              const d = describeActivity(a, ar);
              return (
                <div key={a.id} className="adm-act">
                  <span className="adm-act__dot" />
                  <div className="adm-act__body">
                    <strong>{d.title}</strong>
                    {d.sub && <small dir="auto">{d.sub}</small>}
                  </div>
                  <span className="adm-muted">{timeAgo(a.created_at, t, ar)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="adm-grid">
        <div className="adm-panel adm-panel--fill">
          <div className="adm-panel__head">
            <div><h2>{t('AI Analysis Overview')}</h2><p>{t('Platform-wide — real data from the analysis log')}</p></div>
          </div>
          {ai.completedRuns === 0 ? (
            <p className="adm-empty">{t('No AI analysis has been run on the platform yet.')}</p>
          ) : (
            <>
              <div className="adm-ai-stat">
                <span>{t('Projects analyzed')}</span>
                <strong>{ai.analyzedProjects.toLocaleString()} <em>/ {Number(data.published_projects || 0).toLocaleString()}</em></strong>
              </div>
              <span className="adm-bar__track">
                <span className="adm-bar__fill" style={{ width: `${data.published_projects > 0 ? Math.max(3, Math.min(100, (ai.analyzedProjects / data.published_projects) * 100)) : 0}%` }} />
              </span>
              {Object.keys(ai.byType || {}).length > 0 && (
                <div className="adm-chips">
                  {Object.entries(ai.byType).map(([type, cnt]) => (
                    <span key={type} className="adm-chip">{AI_TYPE_LABELS[type] ? t(AI_TYPE_LABELS[type]) : type}<b>{cnt}</b></span>
                  ))}
                </div>
              )}
            </>
          )}
          <Link to="/admin/ai-code-review" className="btn btn-outline btn-sm adm-wide-btn">
            {t('Open the reviews dashboard →')}
          </Link>
        </div>

        <div className="adm-panel adm-panel--fill adm-cta">
          <span className="adm-cta__icon"><Icon name="shield" size={22} /></span>
          <h2>{t('Security Logs')}</h2>
          <p>{t('Full incident and alert history lives in Security Logs.')}</p>
          <Link to="/admin/security-logs" className="btn btn-outline btn-sm adm-wide-btn">
            {t('View All Security Logs')}
          </Link>
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel__head">
          <div><h2>{t('Universities Awaiting Review')}</h2><p>{t('Latest university applications')}</p></div>
          <Link to="/admin/universities" className="btn btn-outline btn-sm">{t('View all')}</Link>
        </div>
        {pendingUnis.length === 0 ? (
          <p className="adm-empty">{t('No pending applications right now.')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table adm-table--dash">
              <thead><tr><th>{t('University')}</th><th>{t('Location')}</th><th>{t('Submitted')}</th><th>{t('Status')}</th><th /></tr></thead>
              <tbody>
                {pendingUnis.map((u) => (
                  <tr key={u.id}>
                    <td><span className="adm-person"><span className="adm-avatar">{String(L(t, u.official_name_en, u.official_name_ar) || '?').trim().charAt(0).toUpperCase()}</span><strong dir="auto">{L(t, u.official_name_en, u.official_name_ar)}</strong></span></td>
                    <td dir="auto">{[u.city, u.country].filter(Boolean).join(', ') || '—'}</td>
                    <td>{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                    <td><span className="badge badge-warning">{t('Pending')}</span></td>
                    <td className="adm-actions"><Link to="/admin/universities" className="btn btn-outline btn-sm">{t('Review')}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
