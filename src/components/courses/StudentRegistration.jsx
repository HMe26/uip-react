import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';
import CourseRequestDialog from './CourseRequestDialog';

/**
 * التسجيل الأكاديمي (الطالب): حالة فترة التسجيل، ساعاتك الحالية والحد الأقصى (حسب المعدل)، وكتالوج المواد
 * مع المتطلبات السابقة وسبب عدم الأهلية. الطلب نفسه بيتبعت زي الأول (يتنفّذ بموافقة الجامعة/الكلية/مدرّس المادة).
 * Backend: GET /api/v1/registration/status · POST /api/v1/courses/{id}/enroll.
 */

const fmt = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

export default function StudentRegistration() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [q, setQ] = useState('');
  const [onlyEligible, setOnlyEligible] = useState(false);

  const load = useCallback(() => api.get('/api/v1/registration/status', { locale }).then((j) => setData(j.data)), [locale]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    return data.catalog.filter((c) => (!onlyEligible || c.eligible) && (!n || `${c.code} ${c.name}`.toLowerCase().includes(n)));
  }, [data, q, onlyEligible]);

  const h = data?.hours;
  const used = h ? h.enrolled + h.pending : 0;
  const period = data?.period;

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التسجيل الأكاديمي' : 'Academic Registration'}
        text={ar ? 'اختار موادك حسب الساعات المتاحة والمتطلبات السابقة. الطلب بيتنفّذ بموافقة الجامعة أو الكلية أو مدرّس المادة.'
          : 'Pick your courses within your credit-hour limit and prerequisites. Requests are applied once the university, faculty or course staff approves.'}
      />
      <AcAlerts error={error} notice={notice} />

      {!data && !error ? <Skeleton h={100} count={3} /> : data && (
        <>
          <AcKpis items={[
            { label: ar ? 'فترة التسجيل' : 'Registration period', value: period.open ? (ar ? 'مفتوحة' : 'Open') : (ar ? 'مقفولة' : 'Closed'), icon: 'calendar', tone: period.open ? 'good' : 'warn',
              meta: period.current[0] ? `${ar ? 'تقفل' : 'Closes'} ${fmt(period.current[0].closes_at)}` : (period.enforced ? '' : (ar ? 'غير مقيّدة بفترة' : 'Not restricted')) },
            { label: ar ? 'ساعاتك الحالية' : 'Current hours', value: `${used} / ${h.max}`, icon: 'layers', meta: h.pending ? `${h.pending} ${ar ? 'ساعة قيد المراجعة' : 'pending'}` : '' },
            { label: ar ? 'المعدل التراكمي' : 'Cumulative GPA', value: h.gpa ?? '—', icon: 'award' },
          ]} />

          {period.enforced && !period.open && (
            <div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={16} /><span>{ar ? 'التسجيل غير متاح دلوقتي — استنى فتح فترة التسجيل.' : 'Registration is not available right now — wait for a registration period to open.'}</span></div>
          )}

          <AcPanel
            flush
            title={ar ? 'كتالوج المواد' : 'Course catalog'}
            sub={`${rows.length} ${ar ? 'مادة' : 'courses'}`}
          >
            <div className="acx-toolbar">
              <input className="acx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث بالكود أو الاسم…' : 'Search by code or name…'} />
              <label className="acx-check">
                <input type="checkbox" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} />
                {ar ? 'المتاح ليا بس' : 'Eligible only'}
              </label>
            </div>

            {rows.length === 0 ? <div className="acx-empty"><EmptyState icon="layers" title={ar ? 'لا توجد مواد' : 'No courses'} /></div> : (
              <AcTable>
                <thead><tr>
                  <th>{ar ? 'الكود' : 'Code'}</th><th>{ar ? 'المادة' : 'Course'}</th><th>{ar ? 'الساعات' : 'Hours'}</th>
                  <th>{ar ? 'المتطلبات' : 'Prerequisites'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th />
                </tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td dir="ltr" className="is-num"><b>{c.code}</b></td>
                      <td>{c.name}</td>
                      <td className="is-num">{c.credit_hours ?? '—'}</td>
                      <td>{c.prerequisites.length === 0 ? '—' : (
                        <span className="acx-pills">{c.prerequisites.map((p) => (
                          <span key={p.id} className={`st-pill ${p.passed ? 'st-pill--success' : 'st-pill--warning'}`}>{p.code}</span>
                        ))}</span>
                      )}</td>
                      <td>
                        {c.enrolled ? <span className="st-pill st-pill--success">{ar ? 'مسجّل' : 'Enrolled'}</span>
                          : c.pending ? <span className="st-pill">{ar ? 'قيد المراجعة' : 'Pending'}</span>
                            : c.eligible ? <span className="st-pill st-pill--success">{ar ? 'متاح' : 'Eligible'}</span>
                              : <span className="acx-muted">{c.reasons.map((r) => r.text).join(' ')}</span>}
                      </td>
                      <td className="is-end">
                        {!c.enrolled && !c.pending && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={!c.eligible} onClick={() => setDialog({ course: { id: c.id, code: c.code, name: c.name }, type: 'enroll' })}>
                            {ar ? 'طلب تسجيل' : 'Request'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AcTable>
            )}
          </AcPanel>
        </>
      )}

      {dialog && (
        <CourseRequestDialog course={dialog.course} type={dialog.type} onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); setNotice(msg); load().catch(() => {}); }} />
      )}
    </AcPage>
  );
}
