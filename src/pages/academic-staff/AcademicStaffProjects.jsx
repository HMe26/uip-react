import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { api, errorMessage } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead, StaffKpi, PersonAvatar } from '../../components/staff/stfUi';
import { Pill, EmptyState, Skeleton } from '../../components/student/stUi';

export const PROJECT_STATUS = {
  draft:     { tone: 'neutral', en: 'Changes requested', ar: 'بانتظار تعديل الطالب' },
  submitted: { tone: 'warning', en: 'Pending Review',    ar: 'بانتظار المراجعة' },
  approved:  { tone: 'success', en: 'Approved',          ar: 'معتمد' },
  published: { tone: 'success', en: 'Published',         ar: 'منشور' },
  rejected:  { tone: 'danger',  en: 'Rejected',          ar: 'مرفوض' },
};

/** Students' projects linked to this doctor / TA (GET /api/v1/academic-staff/projects). */
export default function AcademicStaffProjects() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/academic-staff/projects')
      .then((j) => setRows(j.data || []))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  const TABS = [
    { key: 'all', en: 'All', ar: 'الكل' },
    { key: 'submitted', ...PROJECT_STATUS.submitted },
    { key: 'draft', ...PROJECT_STATUS.draft },
    { key: 'approved', ...PROJECT_STATUS.approved },
    { key: 'published', ...PROJECT_STATUS.published },
    { key: 'rejected', ...PROJECT_STATUS.rejected },
  ];
  const countOf = (k) => (k === 'all' ? rows.length : rows.filter((r) => r.status === k).length);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (tab === 'all' || r.status === tab)
    && (!q || `${r.title_en || ''} ${r.title_ar || ''} ${r.owner_name || ''}`.toLowerCase().includes(q)));

  return (
    <div className="st-page">
      <StaffHead
        crumbs={[{ label: ar ? 'لوحة التحكم' : 'Dashboard', to: '/academic-staff/dashboard' }, { label: ar ? 'مشاريع الطلبة' : "Students' Projects" }]}
        title={ar ? 'مشاريع الطلبة' : "Students' Projects"}
        subtitle={ar ? 'المشاريع التي تم تسميتك فيها كمشرف أو كعضو في الفريق.' : 'Projects where you are named as the supervisor or a team advisor.'}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

      <div className="stf-kpis">
        <StaffKpi value={rows.length} label={ar ? 'كل المشاريع' : 'All Projects'} icon="folder" />
        <StaffKpi value={countOf('submitted')} label={ar ? 'بانتظار المراجعة' : 'Pending Review'} icon="clock" tone="warn" />
        <StaffKpi value={countOf('draft')} label={ar ? 'بانتظار تعديل الطالب' : 'Awaiting student'} icon="edit" />
        <StaffKpi value={countOf('published')} label={ar ? 'معتمدة' : 'Approved'} icon="check-circle" tone="good" />
      </div>

      <div className="st-tabs" role="tablist">
        {TABS.map((tb) => (
          <button key={tb.key} type="button" role="tab" aria-selected={tab === tb.key} className={`st-tab${tab === tb.key ? ' is-active' : ''}`} onClick={() => setTab(tb.key)}>
            {ar ? tb.ar : tb.en}{tb.key !== 'all' && <span className="st-tab__count">{countOf(tb.key)}</span>}
          </button>
        ))}
      </div>

      <div className="stf-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" placeholder={ar ? 'ابحث عن مشروع أو طالب…' : 'Search projects or students…'} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {loading ? <Skeleton h={64} count={4} /> : shown.length === 0 ? (
        <EmptyState icon="folder" title={rows.length === 0
          ? (ar ? 'لا توجد مشاريع مرتبطة بك بعد.' : 'No student projects are linked to you yet.')
          : (ar ? 'لا توجد مشاريع مطابقة' : 'No matching projects')} />
      ) : (
        <div className="stf-table-card st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                <th>{ar ? 'المشروع' : 'Project'}</th>
                <th>{ar ? 'دوري' : 'My role'}</th>
                <th>{ar ? 'الحالة' : 'Status'}</th>
                <th style={{ textAlign: 'end' }}>{ar ? 'الإجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const sm = PROJECT_STATUS[p.status] || PROJECT_STATUS.draft;
                // زرار المراجعة الأساسي بس لما فعلًا دور المشرف (ربط رسمي + المرحلة المنتظرة supervisor_review).
                const myTurn = p.status === 'submitted' && p.is_official && p.awaiting === 'supervisor_review';
                const title = ar ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar);
                return (
                  <tr key={p.uuid}>
                    <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                      <div className="stf-person"><PersonAvatar name={p.owner_name || title} /><div><strong>{title}</strong><small>{p.owner_name || ''}</small></div></div>
                    </td>
                    <td><Pill tone={p.is_official ? 'success' : 'neutral'}>{p.is_official ? (ar ? 'مشرف (تقييم رسمي)' : 'Supervisor (official grade)') : (ar ? 'معيد (تقييم استشاري)' : 'TA (advisory grade)')}</Pill></td>
                    <td><Pill tone={sm.tone}>{ar ? sm.ar : sm.en}</Pill></td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Link to={`/academic-staff/projects/${encodeURIComponent(p.uuid)}`} className={myTurn ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                          <Icon name={myTurn ? 'check' : 'eye'} size={14} /> {myTurn ? (ar ? 'مراجعة' : 'Review') : (ar ? 'فتح' : 'Open')}
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
