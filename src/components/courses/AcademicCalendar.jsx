import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcPanel, AcField } from './acKit';

/**
 * التقويم الأكاديمي (كل الأدوار): أحداث الجامعة وكليتك + فترات التسجيل والفصول الصيفية (تلقائي).
 * الجامعة بتدير أي حدث (للجامعة كلها أو لكلية)، والكلية بتدير أحداث كليتها؛ باقي الأدوار قراءة فقط.
 * Backend: GET /api/v1/academic-calendar · POST · PUT /{id} · DELETE /{id}.
 */

const KINDS = {
  term: ['الدراسة', 'Term', 'success'],
  exams: ['امتحانات', 'Exams', 'warning'],
  holiday: ['إجازة', 'Holiday', 'neutral'],
  deadline: ['موعد نهائي', 'Deadline', 'warning'],
  registration: ['تسجيل', 'Registration', ''],
  other: ['أخرى', 'Other', 'neutral'],
};
const EMPTY = { title: '', kind: 'term', starts_on: '', ends_on: '', note: '', faculty_id: '' };
const today = () => new Date().toISOString().slice(0, 10);

export default function AcademicCalendar() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(() => api.get('/api/v1/academic-calendar', { locale, ...(kind ? { kind } : {}) }).then((j) => setData(j.data)), [locale, kind]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); setNotice(j?.message || null); await load(); return true; } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  };

  const t = today();
  const groups = useMemo(() => {
    const list = (data?.events || []).filter((e) => showPast || (e.ends_on || e.starts_on) >= t);
    const out = [];
    list.forEach((e) => {
      const key = e.starts_on.slice(0, 7);
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, items: [] }; out.push(g); }
      g.items.push(e);
    });
    return out;
  }, [data, showPast, t]);

  const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' });
  const range = (e) => (e.ends_on && e.ends_on !== e.starts_on ? `${e.starts_on} → ${e.ends_on}` : e.starts_on);
  const facultyName = (id) => { const f = data?.faculties?.find((x) => x.id === id); return f ? (ar ? f.name_ar : f.name_en) : (ar ? 'كلية' : 'Faculty'); };

  const start = (e) => {
    if (!e) { setEditing('new'); setForm(EMPTY); return; }
    setEditing(e.id); setForm({ title: e.title, kind: e.kind, starts_on: e.starts_on, ends_on: e.ends_on || '', note: e.note || '', faculty_id: e.faculty_id || '' });
  };
  const save = async (ev) => {
    ev.preventDefault();
    const body = { ...form, ends_on: form.ends_on || null, faculty_id: form.faculty_id ? Number(form.faculty_id) : null, locale };
    if (await run(() => (editing === 'new' ? api.post('/api/v1/academic-calendar', body) : api.put(`/api/v1/academic-calendar/${editing}`, body)))) setEditing(null);
  };
  const remove = (e) => { if (window.confirm(ar ? `حذف "${e.title}"؟` : `Delete "${e.title}"?`)) run(() => api.delete(`/api/v1/academic-calendar/${e.id}`, { locale })); };

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التقويم الأكاديمي' : 'Academic calendar'}
        text={ar ? 'مواعيد الدراسة والامتحانات والإجازات والمواعيد النهائية، مع فترات التسجيل والفصول الصيفية.' : 'Term dates, exams, holidays and deadlines, plus registration periods and summer terms.'}
      >
        {data?.can_manage && <button type="button" className="btn btn-primary btn-sm" onClick={() => start(null)}><Icon name="plus" size={14} /> {ar ? 'حدث جديد' : 'New event'}</button>}
      </AcHead>
      <AcAlerts error={error} notice={notice} />

      {data?.can_manage && editing !== null && (
        <AcPanel title={editing === 'new' ? (ar ? 'حدث جديد' : 'New event') : (ar ? 'تعديل الحدث' : 'Edit event')} flush>
          <form className="acx-form" style={{ borderTop: 0 }} onSubmit={save}>
            <div className="acx-form__grid">
              <AcField label={ar ? 'العنوان' : 'Title'}><input className="acx-input" required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></AcField>
              <AcField label={ar ? 'النوع' : 'Type'}>
                <select className="acx-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
                </select>
              </AcField>
              <AcField label={ar ? 'من' : 'From'}><input className="acx-input" type="date" required value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></AcField>
              <AcField label={ar ? 'إلى (اختياري)' : 'To (optional)'}><input className="acx-input" type="date" min={form.starts_on || undefined} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></AcField>
              {editing === 'new' && data.faculties.length > 0 && (
                <AcField label={ar ? 'النطاق' : 'Scope'}>
                  <select className="acx-input" value={form.faculty_id} onChange={(e) => setForm({ ...form, faculty_id: e.target.value })}>
                    <option value="">{ar ? 'الجامعة كلها' : 'Whole university'}</option>
                    {data.faculties.map((f) => <option key={f.id} value={f.id}>{ar ? f.name_ar : f.name_en}</option>)}
                  </select>
                </AcField>
              )}
            </div>
            <AcField label={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}><textarea className="acx-input" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></AcField>
            <div className="acx-form__actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{ar ? 'حفظ' : 'Save'}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>{ar ? 'إلغاء' : 'Cancel'}</button>
            </div>
          </form>
        </AcPanel>
      )}

      <AcPanel flush>
        <div className="acx-toolbar">
          <select className="acx-input" style={{ flex: '0 1 200px' }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
          </select>
          <label className="acx-check"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> {ar ? 'إظهار المنتهية' : 'Show past events'}</label>
        </div>

        {!data && !error ? <div className="acx-panel__body"><Skeleton h={50} count={4} /></div> : groups.length === 0 ? <div className="acx-empty"><EmptyState icon="calendar" title={ar ? 'لا توجد أحداث' : 'No events'} /></div> : (
          <div>
            {groups.map((g) => (
              <section key={g.key}>
                <div className="acx-panel__head" style={{ background: 'var(--bg-canvas)', padding: '9px 18px' }}>
                  <div className="acx-panel__title"><b style={{ fontSize: 13 }}>{monthLabel(g.key)}</b></div>
                  <span className="acx-muted">{g.items.length}</span>
                </div>
                {g.items.map((e) => {
                  const k = KINDS[e.kind] || KINDS.other;
                  const ongoing = e.starts_on <= t && (e.ends_on || e.starts_on) >= t;
                  return (
                    <article key={e.id} className="acx-item">
                      <div className="acx-item__head">
                        <div style={{ minWidth: 0 }}>
                          <div className="acx-item__title">{e.title}</div>
                          <div className="acx-muted" dir="ltr" style={{ textAlign: 'start' }}>{range(e)}</div>
                          {e.note && <div className="acx-muted">{e.note}</div>}
                          {e.faculty_id && <div className="acx-muted">{facultyName(e.faculty_id)}</div>}
                        </div>
                        <div className="acx-actions">
                          {ongoing && <span className="st-pill st-pill--success">{ar ? 'جارٍ الآن' : 'Ongoing'}</span>}
                          <span className={`st-pill${k[2] ? ` st-pill--${k[2]}` : ''}`}>{ar ? k[0] : k[1]}</span>
                          {e.editable && <>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => start(e)}>{ar ? 'تعديل' : 'Edit'}</button>
                            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => remove(e)}>{ar ? 'حذف' : 'Delete'}</button>
                          </>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </AcPanel>
    </AcPage>
  );
}
