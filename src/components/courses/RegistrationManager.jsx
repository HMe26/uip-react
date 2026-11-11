import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcPanel, AcTable, AcField } from './acKit';

/**
 * إدارة التسجيل الأكاديمي (الجامعة / الكلية): فترات التسجيل + سياسة القواعد (فترة / متطلبات / ساعات / تعارض)
 * + المتطلبات السابقة لكل مادة. السياسة الفارغة (—) بتورّث من الأعلى ثم القيم الافتراضية.
 * Backend: /api/v1/registration/{manage,policy,periods,courses/{id}/prerequisites}.
 */

const KINDS = { both: ['تسجيل وحذف', 'Enrol & drop'], enroll: ['تسجيل', 'Enrol'], drop: ['حذف', 'Drop'] };
const FLAGS = [
  ['enforce_period', 'التسجيل بفترة مفتوحة بس', 'Only inside an open period'],
  ['enforce_prerequisites', 'اشتراط المتطلبات السابقة', 'Require prerequisites'],
  ['enforce_hours', 'حد أقصى للساعات', 'Credit-hour limit'],
  ['enforce_conflicts', 'منع تعارض المواعيد', 'Block schedule conflicts'],
];
const NUMS = [
  ['max_hours', 'الحد الأقصى العادي', 'Normal max hours'],
  ['low_gpa_threshold', 'معدل منخفض أقل من', 'Low GPA below'],
  ['low_gpa_max_hours', 'ساعات المعدل المنخفض', 'Low-GPA max hours'],
  ['high_gpa_threshold', 'معدل مرتفع من', 'High GPA from'],
  ['high_gpa_max_hours', 'ساعات المعدل المرتفع', 'High-GPA max hours'],
];
const toInput = (s) => (s ? String(s).slice(0, 16).replace(' ', 'T') : '');

export default function RegistrationManager() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [policy, setPolicy] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState({ name: '', kind: 'both', opens_at: '', closes_at: '' });
  const [editId, setEditId] = useState(null);
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [pre, setPre] = useState([]);

  const apply = (j) => { setData(j.data); setPolicy(j.data.own_policy); };
  const load = useCallback(() => api.get('/api/v1/registration/manage', { locale }).then(apply), [locale]);
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
    api.get('/api/v1/courses', { locale }).then((j) => setCourses(j.data || [])).catch(() => {});
  }, [load, locale]);

  const run = async (fn, after) => {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); if (j?.data?.level) apply(j); setNotice(j?.message || null); after?.(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const savePolicy = () => run(() => api.put('/api/v1/registration/policy', { ...policy, locale }));
  const savePeriod = () => run(
    () => (editId ? api.put(`/api/v1/registration/periods/${editId}`, { ...period, locale }) : api.post('/api/v1/registration/periods', { ...period, locale })),
    () => { setEditId(null); setPeriod({ name: '', kind: 'both', opens_at: '', closes_at: '' }); },
  );
  const delPeriod = (id) => window.confirm(ar ? 'حذف الفترة؟' : 'Delete this period?') && run(() => api.del(`/api/v1/registration/periods/${id}?locale=${locale}`));

  const pickCourse = (id) => {
    setCourseId(id); setPre([]);
    if (!id) return;
    api.get(`/api/v1/registration/courses/${id}/prerequisites`, { locale }).then((j) => setPre((j.data?.prerequisite_ids || []).map(String))).catch(() => {});
  };
  const savePre = () => run(() => api.put(`/api/v1/registration/courses/${courseId}/prerequisites`, { prerequisite_ids: pre.map(Number), locale }));

  if (!data && !error) return <AcPage><Skeleton h={100} count={3} /></AcPage>;

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التسجيل الأكاديمي' : 'Academic Registration'}
        text={ar ? 'حدّد فترات التسجيل وقواعده. موافقتك على طلب طالب بتعدّي القواعد دي.' : 'Set registration periods and rules. Approving a student request overrides these rules.'}
      />
      <AcAlerts error={error} notice={notice} />

      {data && (
        <>
          <AcPanel title={ar ? 'فترات التسجيل' : 'Registration periods'} sub={editId ? (ar ? 'بتعدّل فترة موجودة' : 'Editing an existing period') : undefined} flush>
            <form className="acx-form" style={{ borderTop: 0 }} onSubmit={(e) => { e.preventDefault(); savePeriod(); }}>
              <div className="acx-form__grid">
                <AcField label={ar ? 'اسم الفترة' : 'Name'}><input className="acx-input" value={period.name} onChange={(e) => setPeriod({ ...period, name: e.target.value })} /></AcField>
                <AcField label={ar ? 'النوع' : 'Type'}>
                  <select className="acx-input" value={period.kind} onChange={(e) => setPeriod({ ...period, kind: e.target.value })}>
                    {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
                  </select>
                </AcField>
                <AcField label={ar ? 'تبدأ' : 'Opens'}><input className="acx-input" type="datetime-local" value={period.opens_at} onChange={(e) => setPeriod({ ...period, opens_at: e.target.value })} /></AcField>
                <AcField label={ar ? 'تنتهي' : 'Closes'}><input className="acx-input" type="datetime-local" value={period.closes_at} onChange={(e) => setPeriod({ ...period, closes_at: e.target.value })} /></AcField>
              </div>
              <div className="acx-form__actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !period.name || !period.opens_at || !period.closes_at}>
                  {editId ? (ar ? 'حفظ التعديل' : 'Save') : (ar ? 'إضافة فترة' : 'Add period')}
                </button>
                {editId && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditId(null); setPeriod({ name: '', kind: 'both', opens_at: '', closes_at: '' }); }}>{ar ? 'إلغاء' : 'Cancel'}</button>}
              </div>
            </form>
            {data.periods.length === 0 ? <div className="acx-empty"><EmptyState icon="calendar" title={ar ? 'لا توجد فترات' : 'No periods yet'} /></div> : (
              <AcTable>
                <thead><tr><th>{ar ? 'الاسم' : 'Name'}</th><th>{ar ? 'النوع' : 'Type'}</th><th>{ar ? 'من' : 'From'}</th><th>{ar ? 'إلى' : 'To'}</th><th /></tr></thead>
                <tbody>{data.periods.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td><span className="st-pill">{ar ? KINDS[p.kind][0] : KINDS[p.kind][1]}</span></td>
                    <td className="is-num">{String(p.opens_at).slice(0, 16)}</td><td className="is-num">{String(p.closes_at).slice(0, 16)}</td>
                    <td className="is-end">
                      <div className="acx-actions" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditId(p.id); setPeriod({ name: p.name, kind: p.kind, opens_at: toInput(p.opens_at), closes_at: toInput(p.closes_at) }); }}>{ar ? 'تعديل' : 'Edit'}</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => delPeriod(p.id)}>{ar ? 'حذف' : 'Delete'}</button>
                      </div>
                    </td>
                  </tr>))}</tbody>
              </AcTable>
            )}
          </AcPanel>

          <AcPanel title={ar ? 'قواعد التسجيل' : 'Registration rules'} sub={ar ? '"موروث" = بياخد قيمة المستوى الأعلى أو الافتراضي.' : '"Inherit" uses the higher level or the default.'}
            foot={<button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={savePolicy}>{ar ? 'حفظ القواعد' : 'Save rules'}</button>}>
            <div className="acx-form__grid">
              {FLAGS.map(([k, a, e]) => (
                <AcField key={k} label={ar ? a : e}>
                  <select className="acx-input" value={policy[k] === null || policy[k] === undefined ? '' : policy[k] ? '1' : '0'}
                    onChange={(ev) => setPolicy({ ...policy, [k]: ev.target.value === '' ? null : ev.target.value === '1' })}>
                    <option value="">{ar ? `موروث (${data.effective_policy[k] ? 'مفعّل' : 'متوقف'})` : `Inherit (${data.effective_policy[k] ? 'on' : 'off'})`}</option>
                    <option value="1">{ar ? 'مفعّل' : 'On'}</option><option value="0">{ar ? 'متوقف' : 'Off'}</option>
                  </select>
                </AcField>
              ))}
              {NUMS.map(([k, a, e]) => (
                <AcField key={k} label={ar ? a : e}>
                  <input className="acx-input" type="number" step={k.includes('threshold') ? '0.1' : '1'} value={policy[k] ?? ''}
                    placeholder={String(data.effective_policy[k])} onChange={(ev) => setPolicy({ ...policy, [k]: ev.target.value === '' ? null : ev.target.value })} />
                </AcField>
              ))}
            </div>
          </AcPanel>

          <AcPanel title={ar ? 'المتطلبات السابقة للمواد' : 'Course prerequisites'} sub={ar ? 'اختار المادة وبعدها المواد اللي لازم تتنجح قبلها (Ctrl/⌘ لاختيار أكتر من مادة).' : 'Pick a course, then the courses that must be passed first (Ctrl/⌘ to select several).'}
            foot={courseId ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={savePre}>{ar ? 'حفظ المتطلبات' : 'Save prerequisites'}</button> : undefined}>
            <div className="acx-stack">
              <select className="acx-input" value={courseId} onChange={(e) => pickCourse(e.target.value)}>
                <option value="">{ar ? 'اختار المادة…' : 'Choose a course…'}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
              {courseId && (
                <select className="acx-input" multiple size={Math.min(8, Math.max(3, courses.length))} value={pre} onChange={(e) => setPre(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                  {courses.filter((c) => String(c.id) !== String(courseId)).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              )}
            </div>
          </AcPanel>
        </>
      )}
    </AcPage>
  );
}
