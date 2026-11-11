import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcPanel, AcField, AcNums } from './acKit';

/**
 * إدارة التسجيل الصيفي (الجامعة / الكلية): فصول صيفية (فترة تسجيل + ساعات + قيد الرسوب) + المواد المعروضة بسعة
 * + صندوق طلبات الطلاب (موافقة / رفض). الكلية تدير فصول كليتها وطلاب كليتها بس.
 * Backend: /api/v1/summer/{terms, terms/{id}/offerings, requests, requests/{id}/approve|reject}.
 */

const EMPTY = { name: '', opens_at: '', closes_at: '', starts_on: '', ends_on: '', max_hours: 9, only_failed: false };
const toInput = (s) => (s ? String(s).slice(0, 16).replace(' ', 'T') : '');
const ST = { pending: ['قيد المراجعة', 'Pending', ''], approved: ['معتمد', 'Approved', 'success'], rejected: ['مرفوض', 'Rejected', 'warning'], cancelled: ['ملغي', 'Cancelled', 'neutral'] };

export default function SummerManager({ role = 'university' }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [terms, setTerms] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [offerTerm, setOfferTerm] = useState(null);
  const [offers, setOffers] = useState({});
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState({});

  const loadTerms = useCallback(() => api.get('/api/v1/summer/terms', { locale }).then((j) => setTerms(j.data || [])), [locale]);
  const loadReqs = useCallback(() => api.get('/api/v1/summer/requests', { locale, ...(status ? { status } : {}) }).then((j) => setReqs(j.data || [])), [locale, status]);
  useEffect(() => { loadTerms().catch((e) => setError(errorMessage(e))); }, [loadTerms]);
  useEffect(() => { loadReqs().catch((e) => setError(errorMessage(e))); }, [loadReqs]);
  useEffect(() => { api.get('/api/v1/courses', { locale }).then((j) => setCourses(j.data || [])).catch(() => {}); }, [locale]);

  const run = async (fn, after) => {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); setNotice(j?.message || null); after?.(); await Promise.all([loadTerms(), loadReqs()]); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const saveTerm = () => run(
    () => (editId ? api.put(`/api/v1/summer/terms/${editId}`, { ...form, locale }) : api.post('/api/v1/summer/terms', { ...form, locale })),
    () => { setEditId(null); setForm(EMPTY); },
  );
  const delTerm = (id) => window.confirm(ar ? 'حذف الفصل الصيفي؟' : 'Delete this summer term?') && run(() => api.del(`/api/v1/summer/terms/${id}?locale=${locale}`));

  const openOffers = (t) => {
    setOfferTerm(t.id);
    setOffers(Object.fromEntries(t.offerings.map((o) => [o.course_id, o.capacity ?? ''])));
  };
  const toggle = (id) => setOffers((o) => { const n = { ...o }; if (id in n) delete n[id]; else n[id] = ''; return n; });
  const saveOffers = () => run(
    () => api.put(`/api/v1/summer/terms/${offerTerm}/offerings`, { offerings: Object.entries(offers).map(([cid, cap]) => ({ course_id: Number(cid), capacity: cap === '' ? null : Number(cap) })), locale }),
    () => setOfferTerm(null),
  );

  const act = (id, what) => {
    const note = (notes[id] || '').trim();
    if (what === 'reject' && !note) { setError(ar ? 'اكتب سبب الرفض.' : 'Please give a reason for the rejection.'); return; }
    run(() => api.post(`/api/v1/summer/requests/${id}/${what}`, { note, locale }));
  };

  return (
    <AcPage>
      <AcHead
        title={ar ? 'التسجيل الصيفي' : 'Summer registration'}
        text={role === 'faculty' ? (ar ? 'فصول كليتك الصيفية وطلبات طلابها.' : "Your faculty's summer terms and its students' requests.") : (ar ? 'افتح فصل صيفي واعرض المواد وراجع الطلبات.' : 'Open a summer term, offer courses and review requests.')}
      />
      <AcAlerts error={error} notice={notice} />

      <AcPanel title={editId ? (ar ? 'تعديل فصل صيفي' : 'Edit summer term') : (ar ? 'فصل صيفي جديد' : 'New summer term')} flush>
        <form className="acx-form" style={{ borderTop: 0 }} onSubmit={(e) => { e.preventDefault(); saveTerm(); }}>
          <div className="acx-form__grid">
            <AcField label={ar ? 'اسم الفصل' : 'Name'}><input className="acx-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></AcField>
            <AcField label={ar ? 'فتح التسجيل' : 'Registration opens'}><input className="acx-input" type="datetime-local" value={form.opens_at} onChange={(e) => setForm({ ...form, opens_at: e.target.value })} /></AcField>
            <AcField label={ar ? 'قفل التسجيل' : 'Registration closes'}><input className="acx-input" type="datetime-local" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} /></AcField>
            <AcField label={ar ? 'بداية الدراسة' : 'Classes start'}><input className="acx-input" type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></AcField>
            <AcField label={ar ? 'نهاية الدراسة' : 'Classes end'}><input className="acx-input" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></AcField>
            <AcField label={ar ? 'أقصى ساعات' : 'Max hours'}><input className="acx-input" type="number" min="1" max="30" value={form.max_hours} onChange={(e) => setForm({ ...form, max_hours: e.target.value })} /></AcField>
          </div>
          <label className="acx-check"><input type="checkbox" checked={form.only_failed} onChange={(e) => setForm({ ...form, only_failed: e.target.checked })} />{ar ? 'للمواد اللي الطالب راسب فيها بس' : 'Only courses the student failed'}</label>
          <div className="acx-form__actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !form.name || !form.opens_at || !form.closes_at}>{editId ? (ar ? 'حفظ' : 'Save') : (ar ? 'إضافة الفصل' : 'Add term')}</button>
            {editId && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditId(null); setForm(EMPTY); }}>{ar ? 'إلغاء' : 'Cancel'}</button>}
          </div>
        </form>
      </AcPanel>

      {!terms && !error ? <Skeleton h={80} count={2} /> : terms && terms.length === 0 ? (
        <AcPanel><EmptyState icon="calendar" title={ar ? 'لا توجد فصول صيفية' : 'No summer terms yet'} /></AcPanel>
      ) : terms && terms.map((t) => (
        <AcPanel
          key={t.id}
          title={<><b>{t.name}</b><small>{String(t.opens_at).slice(0, 16)} → {String(t.closes_at).slice(0, 16)}</small></>}
          tools={(
            <>
              <span className={`st-pill${t.open ? ' st-pill--success' : ' st-pill--neutral'}`}>{t.open ? (ar ? 'مفتوح' : 'Open') : (ar ? 'غير مفتوح' : 'Not open')}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => openOffers(t)}>{ar ? 'المواد المعروضة' : 'Offered courses'}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditId(t.id); setForm({ name: t.name, opens_at: toInput(t.opens_at), closes_at: toInput(t.closes_at), starts_on: t.starts_on || '', ends_on: t.ends_on || '', max_hours: t.max_hours, only_failed: t.only_failed }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{ar ? 'تعديل' : 'Edit'}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => delTerm(t.id)}>{ar ? 'حذف' : 'Delete'}</button>
            </>
          )}
        >
          <div className="acx-stack">
            <AcNums inline items={[
              [ar ? 'أقصى ساعات' : 'Max hours', t.max_hours],
              [ar ? 'طلبات معلّقة' : 'Pending', t.pending],
              ...(t.only_failed ? [[ar ? 'النوع' : 'Type', ar ? 'رسوب فقط' : 'Failed only']] : []),
            ]} />
            {t.offerings.length > 0 && (
              <div className="acx-pills">
                {t.offerings.map((o) => <span key={o.course_id} className="st-pill">{o.code} · {o.approved}{o.capacity !== null ? `/${o.capacity}` : ''}</span>)}
              </div>
            )}
          </div>
          {offerTerm === t.id && (
            <div className="acx-stack" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
              <div className="acx-stack" style={{ maxHeight: 280, overflow: 'auto', gap: 6 }}>
                {courses.map((c) => (
                  <div key={c.id} className="acx-actions" style={{ flexWrap: 'nowrap' }}>
                    <label className="acx-check" style={{ flex: 1, minWidth: 0 }}>
                      <input type="checkbox" checked={c.id in offers} onChange={() => toggle(c.id)} />
                      <span>{c.code} — {c.name}</span>
                    </label>
                    {c.id in offers && <input className="acx-input" style={{ width: 130 }} type="number" min="1" placeholder={ar ? 'السعة (اختياري)' : 'Capacity'} value={offers[c.id]} onChange={(e) => setOffers({ ...offers, [c.id]: e.target.value })} />}
                  </div>
                ))}
              </div>
              <div className="acx-form__actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveOffers}>{ar ? 'حفظ المواد' : 'Save courses'}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setOfferTerm(null)}>{ar ? 'إغلاق' : 'Close'}</button>
              </div>
            </div>
          )}
        </AcPanel>
      ))}

      <AcPanel title={ar ? 'طلبات الطلاب' : 'Student requests'} flush
        tools={(
          <select className="acx-input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
            {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
          </select>
        )}>
        {reqs.length === 0 ? <div className="acx-empty"><EmptyState icon="inbox" title={ar ? 'لا توجد طلبات' : 'No requests'} /></div> : (
          <div>
            {reqs.map((r) => {
              const st = ST[r.status];
              return (
                <article key={r.id} className="acx-item">
                  <div className="acx-item__head">
                    <div style={{ minWidth: 0 }}>
                      <div className="acx-item__title">{r.student.name} <span className="acx-muted">({r.student.number})</span></div>
                      <div className="acx-muted">{r.course.code} — {r.course.name} · {r.term}</div>
                    </div>
                    <span className={`st-pill${st[2] ? ` st-pill--${st[2]}` : ''}`}>{ar ? st[0] : st[1]}</span>
                  </div>
                  {r.message && <p className="acx-item__body">{r.message}</p>}
                  {r.decision_note && r.status !== 'pending' && <div className="acx-muted">{ar ? 'ملاحظة: ' : 'Note: '}{r.decision_note}</div>}
                  {r.status === 'pending' && (
                    <div className="acx-actions">
                      <input className="acx-input" style={{ flex: '1 1 220px', width: 'auto' }} value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder={ar ? 'ملاحظة (إلزامية عند الرفض)' : 'Note (required when rejecting)'} />
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(r.id, 'approve')}>{ar ? 'موافقة' : 'Approve'}</button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(r.id, 'reject')}>{ar ? 'رفض' : 'Reject'}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </AcPanel>
    </AcPage>
  );
}
