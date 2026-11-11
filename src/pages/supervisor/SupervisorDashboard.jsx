import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { StaffHead, StaffKpi } from '../../components/staff/stfUi';
import { Pill, EmptyState, Skeleton } from '../../components/student/stUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/supervisor/dashboard';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/supervisor/dashboard.php, talking to the real JSON API
 * (GET /api/v1/supervisor/dashboard — SupervisorDashboardApiController::index(),
 * a JSON port of Supervisor\SupervisorDashboardController::index()). Nothing
 * invented: KPIs (assigned students/projects/pending-review count) and the
 * scope badges come straight from SupervisorAssignmentRepository's real
 * scope queries via the supervisor's own roster row
 * (SupervisorRepository::findActiveByUserId()). An inactive/unassigned
 * account gets the same two empty-states the PHP view had, not a fabricated
 * dashboard.
 */

export default function SupervisorDashboard() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/supervisor/dashboard')
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="st-page"><Skeleton h={110} count={3} /></div>;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!data) return null;

  const supervisor = data.supervisor;
  const scopes = data.scopes || [];
  const permissions = data.permissions_list || [];
  const canManageProjects = permissions.includes('manage_projects');

  const scopeLabel = (s) => {
    if (s.scope_type === 'project') {
      return locale === 'ar' ? (s.project_title_ar || s.project_title_en || '') : (s.project_title_en || s.project_title_ar || '');
    }
    if (s.scope_type === 'faculty') return s.faculty_name ? (locale === 'ar' ? s.faculty_name_ar : s.faculty_name_en) : s.scope_value;
    if (s.scope_type === 'department') return s.department_name ? (locale === 'ar' ? s.department_name_ar : s.department_name_en) : s.scope_value;
    if (s.scope_type === 'group') return s.group_name || s.scope_value;
    return s.scope_value;
  };

  const ar = locale === 'ar';
  return (
    <div className="st-page">
      <StaffHead
        eyebrow={ar ? 'مرحبًا بعودتك' : 'Welcome back'}
        title={<>{supervisor?.full_name || t('Welcome')} <span aria-hidden="true">👋</span></>}
        subtitle={ar ? 'إليك ما يحتاج انتباهك اليوم.' : "Here's what needs your attention today."}
        actions={canManageProjects && (data.pending_count || 0) > 0 ? <Link to="/supervisor/projects" className="btn btn-primary">{ar ? 'مراجعة المشاريع' : 'Review Projects'}</Link> : null}
      />

      {!supervisor ? (
        <EmptyState icon="users" title={t('Your account is not currently active. Contact your university.')} />
      ) : scopes.length === 0 ? (
        <EmptyState
          icon="users"
          title={ar ? 'لم تُسند لك جامعتك أي نطاق بعد' : "You haven't been assigned a scope yet"}
          text={ar ? 'لم تُسند لك جامعتك أي كلية/قسم/سنة/مشروع بعد — لن ترى أي طلاب أو مشاريع حتى يتم ذلك.' : "Your university hasn't assigned you any faculty/department/year/project yet — you won't see any students or projects until they do."}
        />
      ) : (
        <>
          <div className="stf-kpis stf-kpis--3">
            <StaffKpi value={data.students_count || 0} label={ar ? 'الطلاب المُسندون' : 'Assigned Students'} icon="users" />
            <StaffKpi value={data.projects_count || 0} label={ar ? 'المشاريع المُسندة' : 'Assigned Projects'} icon="folder" tone="warn" />
            <StaffKpi value={data.pending_count || 0} label={ar ? 'بانتظار المراجعة' : 'Pending Review'} icon="clock" tone="bad" />
          </div>

          {!canManageProjects && (
            <div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={16} /><span>{ar ? 'ليس لديك صلاحية مراجعة المشاريع — تواصل مع جامعتك لتفعيلها.' : "You don't have the review-projects permission — ask your university to grant it."}</span></div>
          )}

          <section className="st-panel">
            <div className="st-panel__head"><h2>{t('Your Scope')}</h2></div>
            <div className="st-chips">
              {scopes.map((sc, i) => (
                <Pill key={i} tone="neutral">{sc.scope_type.charAt(0).toUpperCase() + sc.scope_type.slice(1)}: {scopeLabel(sc)}</Pill>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
