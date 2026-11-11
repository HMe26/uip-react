import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { StaffHead, StaffKpi, PersonAvatar } from '../../components/staff/stfUi';
import { Pill, EmptyState, Skeleton } from '../../components/student/stUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/supervisor/students';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/supervisor/students.php, talking to the real JSON API
 * (GET /api/v1/supervisor/students — SupervisorStudentsApiController::index(),
 * a JSON port of Supervisor\SupervisorStudentController::index()). Read-only
 * over SupervisorAssignmentRepository::scopedStudents() — only the students
 * within the faculty/department/academic-year/group/project scope the
 * inviting university actually assigned. Two real gate states from the old
 * view are preserved: no 'view_students' permission, and no scope assigned
 * yet — neither is fabricated, both come from meta.can_view/meta.has_scope.
 */

export default function SupervisorStudents() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ can_view: false, has_scope: false });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/api/v1/supervisor/students', { search: search || undefined, per_page: 100 })
      .then((json) => {
        if (cancelled) return;
        setRows(json.data || []);
        setMeta(json.meta || {});
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search]);

  const ar = locale === 'ar';
  const total = rows.length;
  const activeCount = rows.filter((r) => r.account_status === 'active').length;
  const withProjects = rows.filter((r) => Number(r.projects_count) > 0).length;
  const projectsTotal = rows.reduce((n, r) => n + (Number(r.projects_count) || 0), 0);

  return (
    <div className="st-page">
      <StaffHead
        crumbs={[{ label: ar ? 'لوحة التحكم' : 'Dashboard', to: '/supervisor/dashboard' }, { label: t('My Students') }]}
        title={t('My Students')}
        subtitle={t('Only the students within the scope your university assigned you.')}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      {!error && !meta.can_view && !loading && (
        <EmptyState icon="users" title={ar ? 'ليس لديك صلاحية عرض الطلاب' : "You don't have permission to view students"} text={ar ? 'تواصل مع جامعتك لتفعيلها.' : 'Ask your university to grant it.'} />
      )}

      {!error && meta.can_view && !meta.has_scope && !loading && (
        <EmptyState icon="users" title={ar ? 'لم يتم إسناد أي نطاق لك بعد.' : "You haven't been assigned a scope yet."} />
      )}

      {!error && meta.can_view && meta.has_scope && (
        <>
          <div className="stf-kpis">
            <StaffKpi value={total} label={ar ? 'إجمالي الطلاب' : 'Total Students'} icon="users" />
            <StaffKpi value={activeCount} label={ar ? 'طلاب نشطون' : 'Active Students'} icon="check-circle" tone="good" />
            <StaffKpi value={withProjects} label={ar ? 'لديهم مشاريع' : 'With Projects'} icon="folder" tone="warn" />
            <StaffKpi value={projectsTotal} label={ar ? 'إجمالي المشاريع' : 'Total Projects'} icon="layers" />
          </div>

          <div className="stf-toolbar">
            <label className="st-search">
              <Icon name="search" size={16} />
              <input className="form-input" type="search" placeholder={ar ? 'ابحث بالاسم أو الرقم الجامعي…' : 'Search by name or student ID…'} value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>

          {loading ? <Skeleton h={64} count={4} /> : rows.length === 0 ? (
            <EmptyState icon="users" title={t('No students currently fall within your scope.')} />
          ) : (
            <div className="stf-table-card st-table-wrap">
              <table className="st-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الطالب' : 'Student'}</th>
                    <th>{ar ? 'الكلية' : 'Faculty'}</th>
                    <th>{ar ? 'القسم' : 'Department'}</th>
                    <th>{ar ? 'السنة' : 'Year'}</th>
                    <th>{ar ? 'المشاريع' : 'Projects'}</th>
                    <th>{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><div className="stf-person"><PersonAvatar name={r.full_name} /><div><strong>{r.full_name}</strong>{r.email && <small>{r.email}</small>}</div></div></td>
                      <td className="st-muted">{r.faculty || '—'}</td>
                      <td className="st-muted">{r.department || '—'}</td>
                      <td className="st-muted">{r.academic_year || '—'}</td>
                      <td>{r.projects_count}</td>
                      <td><Pill tone={r.account_status === 'active' ? 'success' : 'neutral'}>{r.account_status === 'active' ? t('Active') : (ar ? 'غير نشط' : 'Inactive')}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
  );
}
