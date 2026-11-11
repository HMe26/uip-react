import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { Skeleton } from '../student/stUi';

/**
 * نظام الدرجات (التقديرات / النقاط / الحرمان / الاعتماد) — الأدمن (عام) والجامعة (جامعتها + كل كلية) والكلية (كليتها).
 * الأولوية للمادة: الكلية ← الجامعة ← الأدمن ← الافتراضي. المسح بيرجّع للموروث.
 * Backend: GET/PUT/DELETE /api/v1/grading/scale[?faculty_id=].
 */

const BASE = '/api/v1/grading/scale';
const LEVEL = { global: ['النظام العام (كل الجامعات)', 'Global scale (all universities)'], university: ['نظام الجامعة', 'University scale'], faculty: ['نظام الكلية', 'Faculty scale'] };

export default function GradingScaleEditor() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [facultyId, setFacultyId] = useState('');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((d) => {
    setData(d);
    const s = d.own || d.effective;
    setForm({
      name: s.name || '', bands: s.bands.map((b) => ({ ...b })), deprivation_fails: s.deprivation_fails,
      deprivation_letter: s.deprivation_letter, require_approval: s.require_approval, gpa_decimals: s.gpa_decimals,
    });
  }, []);

  const load = useCallback(() => api.get(BASE, { locale, ...(facultyId ? { faculty_id: facultyId } : {}) }).then((j) => apply(j.data)), [locale, facultyId, apply]);
  useEffect(() => { setData(null); load().catch((e) => setError(errorMessage(e))); }, [load]);

  const q = facultyId ? { faculty_id: facultyId } : {};
  const qs = facultyId ? `?faculty_id=${facultyId}` : '';

  async function run(fn) {
    setSaving(true); setError(null); setNotice(null);
    try { const j = await fn(); apply(j.data); setNotice(j.message); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  const save = () => run(() => api.put(BASE + qs, { ...form, ...q, locale }));
  const reset = () => window.confirm(ar ? 'مسح النظام والرجوع للموروث؟' : 'Remove this scale and inherit?') && run(() => api.del(BASE + qs));
  const useDefaults = () => apply({ ...data, own: null, effective: data.defaults });

  const setBand = (i, k, v) => setForm((f) => ({ ...f, bands: f.bands.map((b, j) => (j === i ? { ...b, [k]: v } : b)) }));
  const addBand = () => setForm((f) => ({ ...f, bands: [...f.bands, { letter: '', min_percent: '', points: '', is_fail: false }] }));
  const delBand = (i) => setForm((f) => ({ ...f, bands: f.bands.filter((_, j) => j !== i) }));

  const target = facultyId ? 'faculty' : data?.level;

  const mins = form ? form.bands.map((x) => (x.min_percent === '' || Number.isNaN(Number(x.min_percent)) ? null : Number(x.min_percent))) : [];
  const rangeOf = (i) => {
    const lo = mins[i];
    if (lo == null) return '—';
    const higher = mins.filter((m, j) => m != null && j !== i && m > lo);
    const hi = higher.length ? Math.min(...higher) : null;
    return hi == null ? `${lo} – 100` : `${lo} – ${Math.round((hi - 0.1) * 10) / 10}`;
  };
  const scale = form ? form.bands
    .map((x, i) => ({ letter: x.letter, fail: !!x.is_fail, lo: mins[i] }))
    .filter((x) => x.lo != null && x.letter)
    .sort((x, y) => x.lo - y.lo)
    .map((x, k, arr) => { const hi = k + 1 < arr.length ? arr[k + 1].lo : 100; return { ...x, hi, span: hi - x.lo }; }) : [];

  return (
    <div className="ex-page">
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>{ar ? 'نظام الدرجات' : 'Grading scale'}</h1>
        <p className="is-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{ar ? 'حدّد التقديرات ونقاط الـ GPA وسياسة الحرمان والاعتماد. الأقرب للمادة (كلية ← جامعة ← عام) هو اللي بيتطبّق.' : 'Define grades, GPA points, deprivation and approval policy. The closest level to the course wins (faculty → university → global).'}</p>
      </div>
      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}

      {!data || !form ? <Skeleton h={120} count={3} /> : (
        <div className="gsc">
          <section className="gsc-card">
            <header className="gsc-head">
              <div className="gsc-head__title">
                <b>{LEVEL[target]?.[ar ? 0 : 1]}</b>
                <span className={`att-pill att-pill--${data.own ? 'present' : 'excused'}`}>{data.own ? (ar ? 'نظام خاص' : 'Custom') : (ar ? 'موروث / افتراضي' : 'Inherited / default')}</span>
              </div>
              {data.faculties && (
                <select className="ex-select gsc-level" value={facultyId} onChange={(e) => setFacultyId(e.target.value)} aria-label={ar ? 'المستوى' : 'Level'}>
                  <option value="">{ar ? 'نظام الجامعة' : 'University scale'}</option>
                  {data.faculties.map((f) => <option key={f.id} value={f.id}>{ar ? (f.name_ar || f.name_en) : (f.name_en || f.name_ar)}{f.has_own ? ' ✓' : ''}</option>)}
                </select>
              )}
            </header>

            <div className="gsc-sec-title">
              <h2>{ar ? 'التقديرات' : 'Grades'}</h2>
              <span>{ar ? 'لازم يكون فيه تقدير يبدأ من 0%.' : 'One grade must start at 0%.'}</span>
            </div>

            {scale.length > 0 && (
              <div className="gsc-strip" aria-hidden="true">
                {scale.map((x, k) => (
                  <div key={k} className={`gsc-strip__seg${x.fail ? ' is-fail' : ''}`} style={{ flexGrow: Math.min(Math.max(x.span, 4), 18) }} title={`${x.letter} · ${x.lo}–${x.hi}%`}>{x.letter}</div>
                ))}
              </div>
            )}

            <div className="gsc-table" role="table">
              <div className="gsc-row gsc-row--head" role="row">
                <span>{ar ? 'التقدير' : 'Grade'}</span>
                <span>{ar ? 'من نسبة' : 'From %'}</span>
                <span>{ar ? 'المدى' : 'Range'}</span>
                <span>GPA</span>
                <span>{ar ? 'رسوب' : 'Fail'}</span>
                <span />
              </div>
              {form.bands.map((b, i) => {
                const r = rangeOf(i);
                return (
                  <div key={i} className={`gsc-row${b.is_fail ? ' is-fail' : ''}`} role="row">
                    <input className="gsc-cell gsc-cell--letter" maxLength={8} value={b.letter} placeholder="A" aria-label={ar ? 'التقدير' : 'Grade'} onChange={(e) => setBand(i, 'letter', e.target.value)} />
                    <input className="gsc-cell" type="number" min="0" max="100" step="0.5" value={b.min_percent} aria-label={ar ? 'من نسبة' : 'Min %'} onChange={(e) => setBand(i, 'min_percent', e.target.value)} />
                    <span className="gsc-range">{r}</span>
                    <input className="gsc-cell" type="number" min="0" max="10" step="0.1" value={b.points} aria-label="GPA" onChange={(e) => setBand(i, 'points', e.target.value)} />
                    <label className="gsc-failbox" title={ar ? 'تقدير رسوب' : 'Failing grade'}>
                      <input type="checkbox" checked={!!b.is_fail} onChange={(e) => setBand(i, 'is_fail', e.target.checked)} />
                      <span />
                    </label>
                    <button type="button" className="gsc-del" onClick={() => delBand(i)} aria-label={ar ? 'حذف' : 'Delete'} title={ar ? 'حذف' : 'Delete'}><Icon name="trash" size={14} /></button>
                  </div>
                );
              })}
              <button type="button" className="gsc-add" onClick={addBand}><Icon name="plus" size={14} /><span>{ar ? 'إضافة تقدير' : 'Add grade'}</span></button>
            </div>
          </section>

          <section className="gsc-card">
            <div className="gsc-sec-title"><h2>{ar ? 'السياسة' : 'Policy'}</h2></div>
            <div className="gsc-fields">
              <label className="gsc-field gsc-field--wide">
                <span>{ar ? 'اسم النظام (اختياري)' : 'Scale name (optional)'}</span>
                <div className="gsc-input"><input maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </label>
              <label className="gsc-field">
                <span>{ar ? 'خانات المعدل العشرية' : 'GPA decimals'}</span>
                <div className="gsc-input"><input type="number" min="0" max="4" value={form.gpa_decimals} onChange={(e) => setForm({ ...form, gpa_decimals: e.target.value })} /></div>
              </label>
              <label className="gsc-field">
                <span>{ar ? 'تقدير الحرمان' : 'Deprivation grade'}</span>
                <div className="gsc-input"><input maxLength={8} value={form.deprivation_letter} onChange={(e) => setForm({ ...form, deprivation_letter: e.target.value })} /></div>
              </label>
            </div>
            <label className="gsc-switch">
              <input type="checkbox" checked={form.deprivation_fails} onChange={(e) => setForm({ ...form, deprivation_fails: e.target.checked })} />
              <span className="gsc-switch__track" aria-hidden="true" />
              <span className="gsc-switch__text">{ar ? 'الطالب المحروم (حد الغياب) يرسب تلقائيًا في المادة' : 'Deprived students (absence limit) automatically fail the course'}</span>
            </label>
            <label className="gsc-switch">
              <input type="checkbox" checked={form.require_approval} onChange={(e) => setForm({ ...form, require_approval: e.target.checked })} />
              <span className="gsc-switch__track" aria-hidden="true" />
              <span className="gsc-switch__text">{ar ? 'نتيجة المادة تحتاج اعتماد الكلية/الجامعة قبل النشر (الدكتور/المعيد يرفعها للاعتماد فقط)' : 'Course results need faculty/university approval before publishing (instructors can only submit)'}</span>
            </label>
          </section>

          <div className="gsc-actions">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14} /> {ar ? 'حفظ' : 'Save'}</button>
            <button type="button" className="btn btn-outline" disabled={saving} onClick={useDefaults}>{ar ? 'تحميل القيم الافتراضية' : 'Load defaults'}</button>
            {data.own && <button type="button" className="btn btn-ghost" disabled={saving} onClick={reset}><Icon name="trash" size={14} /> {ar ? 'مسح والرجوع للموروث' : 'Remove & inherit'}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
