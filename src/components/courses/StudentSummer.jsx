import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';

/**
 * التسجيل الصيفي (الطالب): الفصول الصيفية المتاحة، المواد المعروضة (سعة / ساعات / سبب عدم الأهلية)، وحالة طلباتك.
 * الطلب بتوافق عليه الكلية أو الجامعة، والموافقة بتسجّلك في المادة.
 * Backend: GET /api/v1/summer/status · POST /api/v1/summer/register · POST /api/v1/summer/registrations/{id}/cancel.
 */

const REG = { pending: ['قيد المراجعة', 'Pending', ''], approved: ['معتمد', 'Approved', 'success'] };
const fmt = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

export default function StudentSummer() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get('/api/v1/summer/status', { locale }).then((j) => setTerms(j.data || [])), [locale]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); setNotice(j?.message || null); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التسجيل الصيفي' : 'Summer registration'}
        text={ar ? 'قدّم على المواد المعروضة في الفصل الصيفي. الكلية أو الجامعة بتوافق، والموافقة بتسجّلك في المادة.' : 'Apply for the courses offered in the summer term. The faculty or university approves, and approval enrols you.'}
      />
      <AcAlerts error={error} notice={notice} />

      {!terms && !error ? <Skeleton h={100} count={2} /> : terms && terms.length === 0 ? (
        <EmptyState icon="calendar" title={ar ? 'لا توجد فصول صيفية متاحة' : 'No summer terms available'} />
      ) : terms && terms.map((t) => (
        <AcPanel
          key={t.id}
          flush
          title={t.name}
          sub={`${ar ? 'التسجيل: ' : 'Registration: '}${fmt(t.opens_at)} → ${fmt(t.closes_at)}${t.starts_on ? ` · ${ar ? 'الدراسة' : 'Classes'} ${t.starts_on} → ${t.ends_on || ''}` : ''}`}
          tools={(
            <>
              <AcNums inline items={[[ar ? 'الساعات' : 'Hours', `${t.hours_used} / ${t.max_hours}`]]} />
              <span className={`st-pill${t.open ? ' st-pill--success' : ' st-pill--neutral'}`}>{t.open ? (ar ? 'مفتوح' : 'Open') : (ar ? 'غير مفتوح' : 'Not open')}</span>
            </>
          )}
        >
          {t.only_failed && <div className="acx-panel__body"><div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={15} /><span>{ar ? 'التسجيل متاح للمواد اللي رسبت فيها بس.' : 'Only for courses you previously failed.'}</span></div></div>}

          {t.offerings.length === 0 ? <div className="acx-empty"><EmptyState icon="layers" title={ar ? 'لا توجد مواد معروضة' : 'No courses offered'} /></div> : (
            <AcTable>
              <thead><tr><th>{ar ? 'الكود' : 'Code'}</th><th>{ar ? 'المادة' : 'Course'}</th><th>{ar ? 'الساعات' : 'Hours'}</th><th>{ar ? 'المقاعد' : 'Seats'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th /></tr></thead>
              <tbody>
                {t.offerings.map((o) => {
                  const r = o.registration;
                  const rs = r ? REG[r.status] : null;
                  return (
                    <tr key={o.course_id}>
                      <td dir="ltr" className="is-num"><b>{o.code}</b></td><td>{o.name}</td><td className="is-num">{o.credit_hours ?? '—'}</td>
                      <td className="is-num">{o.seats_left === null ? (ar ? 'مفتوح' : 'Unlimited') : o.seats_left}</td>
                      <td>
                        {rs ? <span className={`st-pill${rs[2] ? ` st-pill--${rs[2]}` : ''}`}>{ar ? rs[0] : rs[1]}</span>
                          : o.eligible ? <span className="st-pill st-pill--success">{ar ? 'متاح' : 'Eligible'}</span>
                            : <span className="acx-muted">{o.reasons.join(' ')}</span>}
                      </td>
                      <td className="is-end">
                        {!r && <button type="button" className="btn btn-primary btn-sm" disabled={busy || !o.eligible} onClick={() => run(() => api.post('/api/v1/summer/register', { term_id: t.id, course_id: o.course_id, locale }))}>{ar ? 'تقديم' : 'Apply'}</button>}
                        {r && r.status === 'pending' && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => api.post(`/api/v1/summer/registrations/${r.id}/cancel`, { locale }))}>{ar ? 'إلغاء' : 'Cancel'}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </AcTable>
          )}
          {t.history.length > 0 && (
            <div className="acx-panel__foot acx-muted">
              {ar ? 'طلبات مرفوضة: ' : 'Rejected: '}{t.history.map((h) => `${t.offerings.find((o) => o.course_id === h.course_id)?.code || h.course_id}${h.note ? ` (${h.note})` : ''}`).join('، ')}
            </div>
          )}
        </AcPanel>
      ))}
    </AcPage>
  );
}
