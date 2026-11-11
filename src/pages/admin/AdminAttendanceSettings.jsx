import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { Skeleton } from '../../components/student/stUi';
import { getPosition, geoErrorText } from '../../lib/geo';

/**
 * Admin → إعدادات الحضور والغياب.
 * Backend: GET/PUT/DELETE /api/v1/admin/attendance-settings · PUT /api/v1/admin/attendance-settings/faculties/{id}.
 * القيم هنا بتغطّي على الـ .env (فاضي = الافتراضي)، والتغيير بيسري فورًا من غير deploy.
 */

const BASE = '/api/v1/admin/attendance-settings';

const GROUPS = [
  {
    ar: 'الغياب والحرمان', en: 'Absence & deprivation',
    items: [
      { key: 'max_absence_percent', ar: 'حد الحرمان (% غياب)', en: 'Deprivation limit (% absence)', hint_ar: 'الطالب اللي نسبة غيابه توصل لده يتحسب معرّض للحرمان.', hint_en: 'A student whose absence reaches this is flagged as at risk of deprivation.', unit: '%' },
      { key: 'warn_absence_percent', ar: 'حد التحذير (% غياب)', en: 'Warning threshold (% absence)', hint_ar: 'بيوصله إشعار تحذير لما يوصل لده.', hint_en: 'The student is notified when absence reaches this.', unit: '%' },
    ],
  },
  {
    ar: 'التحضير', en: 'Attendance session',
    items: [
      { key: 'default_minutes', ar: 'مدة التحضير الافتراضية', en: 'Default open time', hint_ar: 'المدة اللي بيتفتح بيها التحضير لو الدكتور ما حدّدش.', hint_en: 'How long attendance stays open by default.', unit: 'min' },
      { key: 'max_minutes', ar: 'أقصى مدة للتحضير', en: 'Maximum open time', unit: 'min' },
      { key: 'late_after_minutes', ar: 'التأخير بعد', en: 'Late after', hint_ar: 'اللي يسجّل بعد الوقت ده من فتح التحضير يتحسب متأخر.', hint_en: 'Check-ins after this are marked late.', unit: 'min' },
      { key: 'qr_step_seconds', ar: 'تغيير الـ QR كل', en: 'QR rotates every', hint_ar: 'كل ما كان أقل، صورة الـ QR المسرّبة بتموت أسرع.', hint_en: 'Shorter = a leaked QR photo dies faster.', unit: 's' },
    ],
  },
  {
    ar: 'الموقع (الجيوفنس)', en: 'Location (geofence)',
    items: [
      { key: 'geofence_enabled', ar: 'تفعيل ربط الحضور بالموقع', en: 'Enforce location check', hint_ar: 'لو مقفول، الحضور بيتقبل من أي مكان. اقفله للتجربة بس.', hint_en: 'When off, check-in is accepted from anywhere. For testing only.', bool: true },
      { key: 'default_campus_radius_m', ar: 'نطاق الكلية الافتراضي', en: 'Default campus radius', hint_ar: 'بيتطبّق لو الكلية ما حدّدتش نطاق خاص بيها.', hint_en: 'Used when a faculty has no radius of its own.', unit: 'm' },
      { key: 'doctor_radius_m', ar: 'نطاق مكان الدكتور', en: 'Radius around the instructor', hint_ar: 'الطالب لازم يكون جوه المسافة دي من مكان الدكتور وقت فتح التحضير.', hint_en: 'Students must be within this distance of where the instructor opened attendance.', unit: 'm' },
      { key: 'max_accuracy_m', ar: 'أقصى خطأ GPS مقبول', en: 'Max GPS error accepted', hint_ar: 'لو دقة الموقع أضعف من كده بيترفض.', hint_en: 'Locations less precise than this are rejected.', unit: 'm' },
    ],
  },
  {
    ar: 'الأجهزة', en: 'Devices',
    items: [
      { key: 'one_device_per_student', ar: 'جهاز واحد لكل طالب في التحضير', en: 'One device per student', hint_ar: 'يمنع تسجيل حضور طالبين من نفس الجهاز.', hint_en: 'Blocks one device from checking in two students.', bool: true },
    ],
  },
];

export default function AdminAttendanceSettings() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [facDraft, setFacDraft] = useState({});
  const [busyFac, setBusyFac] = useState(null);

  const apply = (d) => { setData(d); setDraft({}); setFacDraft({}); };
  const load = useCallback(() => api.get(BASE, { locale }).then((j) => apply(j.data)), [locale]);

  useEffect(() => { load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false)); }, [load]);

  const val = (k) => (k in draft ? draft[k] : data.values[k].value);
  const dirty = Object.keys(draft).length > 0;

  async function run(fn, doneMsg) {
    setError(null); setNotice(null);
    try { const j = await fn(); apply(j.data); setNotice(doneMsg || j.message); } catch (e) { setError(errorMessage(e)); }
  }

  async function save() {
    setSaving(true);
    await run(() => api.put(BASE, { values: draft }));
    setSaving(false);
  }

  async function resetOne(k) {
    await run(() => api.put(BASE, { values: { [k]: null } }), ar ? 'تم الرجوع للافتراضي.' : 'Reset to default.');
  }

  async function resetAll() {
    if (!window.confirm(ar ? 'إرجاع كل إعدادات الحضور للقيم الافتراضية؟' : 'Reset all attendance settings to their defaults?')) return;
    setSaving(true);
    await run(() => api.del(BASE));
    setSaving(false);
  }

  const fv = (f, k) => (facDraft[f.id]?.[k] !== undefined ? facDraft[f.id][k] : (f[k] ?? ''));
  const setFv = (f, k, v) => setFacDraft((d) => ({ ...d, [f.id]: { ...(d[f.id] || {}), [k]: v } }));

  async function saveFaculty(f) {
    setBusyFac(f.id);
    await run(() => api.put(`${BASE}/faculties/${f.id}`, { lat: fv(f, 'lat') === '' ? null : fv(f, 'lat'), lng: fv(f, 'lng') === '' ? null : fv(f, 'lng'), radius_m: fv(f, 'radius_m') === '' ? null : fv(f, 'radius_m') }));
    setBusyFac(null);
  }

  async function hereFaculty(f) {
    setError(null);
    try {
      const p = await getPosition();
      setFacDraft((d) => ({ ...d, [f.id]: { ...(d[f.id] || {}), lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) } }));
    } catch (e) { setError(geoErrorText(e, ar)); }
  }

  const faculties = (data?.faculties || []).filter((f) => {
    const n = q.trim().toLowerCase();
    return !n || `${f.name_ar} ${f.name_en} ${f.university_ar} ${f.university_en}`.toLowerCase().includes(n);
  });

  return (
    <div className="ex-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>{ar ? 'إعدادات الحضور والغياب' : 'Attendance settings'}</h1>
          <p className="is-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            {ar ? 'عدّل حدود الحرمان ومدة التحضير والـ QR والجيوفنس ومواقع الكليات. التغيير بيسري فورًا.' : 'Tune the deprivation limits, session timing, QR rotation, geofence and campus locations. Changes apply immediately.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-outline" disabled={saving || loading} onClick={resetAll}><Icon name="refresh" size={14} /> {ar ? 'إرجاع الكل للافتراضي' : 'Reset all'}</button>
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}><Icon name="check" size={14} /> {ar ? 'حفظ' : 'Save'}</button>
        </div>
      </div>

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}

      {loading || !data ? <Skeleton h={120} count={3} /> : (
        <>
          {GROUPS.map((g) => (
            <div className="ex-card" key={g.en} style={{ padding: '16px 20px' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{ar ? g.ar : g.en}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {g.items.map((it) => {
                  const meta = data.values[it.key];
                  return (
                    <div key={it.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ fontWeight: 700, fontSize: 13 }} htmlFor={`att-${it.key}`}>{ar ? it.ar : it.en}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {it.bool ? (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input id={`att-${it.key}`} type="checkbox" checked={!!val(it.key)} onChange={(e) => setDraft({ ...draft, [it.key]: e.target.checked })} />
                            <span>{val(it.key) ? (ar ? 'مفعّل' : 'On') : (ar ? 'مقفول' : 'Off')}</span>
                          </label>
                        ) : (
                          <>
                            <input id={`att-${it.key}`} className="ex-input" type="number" step={meta.type === 'float' ? '0.5' : '1'} min={meta.min} max={meta.max} value={val(it.key)} onChange={(e) => setDraft({ ...draft, [it.key]: e.target.value })} style={{ maxWidth: 140 }} />
                            <span className="is-muted" style={{ fontSize: 12 }}>{it.unit === 'min' ? (ar ? 'دقيقة' : 'min') : it.unit === 's' ? (ar ? 'ثانية' : 'sec') : it.unit === 'm' ? (ar ? 'متر' : 'm') : '%'}</span>
                          </>
                        )}
                        {meta.overridden && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetOne(it.key)} title={ar ? 'رجّع الافتراضي' : 'Reset to default'}>
                            <Icon name="refresh" size={12} /> {ar ? 'الافتراضي' : 'Default'}: {meta.type === 'bool' ? (meta.default ? (ar ? 'مفعّل' : 'On') : (ar ? 'مقفول' : 'Off')) : meta.default}
                          </button>
                        )}
                      </div>
                      {(ar ? it.hint_ar : it.hint_en) && <small className="is-muted">{ar ? it.hint_ar : it.hint_en}</small>}
                      {!it.bool && <small className="is-muted">{ar ? `من ${meta.min} إلى ${meta.max}` : `${meta.min} – ${meta.max}`}</small>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="ex-card">
            <div className="att-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16 }}>{ar ? 'مواقع الكليات' : 'Campus locations'}</h2>
                <small className="is-muted">{ar ? 'اكتب الإحداثيات أو استخدم موقعك الحالي. فاضي = الكلية لسه ما حدّدتش موقعها (الحضور هيعتمد على مكان الدكتور بس).' : 'Type coordinates or use your current location. Empty = not set (attendance then relies on the instructor’s location only).'}</small>
              </div>
              <input className="ex-input" style={{ maxWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'بحث…' : 'Search…'} />
            </div>
            <div className="ex-table-wrap">
              <table className="ex-table">
                <thead><tr><th>{ar ? 'الكلية' : 'Faculty'}</th><th>{ar ? 'خط العرض' : 'Latitude'}</th><th>{ar ? 'خط الطول' : 'Longitude'}</th><th>{ar ? 'النطاق (م)' : 'Radius (m)'}</th><th /></tr></thead>
                <tbody>
                  {faculties.length === 0 && <tr><td colSpan={5} className="is-muted">{ar ? 'لا توجد كليات' : 'No faculties'}</td></tr>}
                  {faculties.map((f) => (
                    <tr key={f.id}>
                      <td><strong>{ar ? f.name_ar : f.name_en}</strong><br /><small className="is-muted">{ar ? f.university_ar : f.university_en}</small></td>
                      <td><input className="ex-input" dir="ltr" style={{ width: 130 }} value={fv(f, 'lat')} onChange={(e) => setFv(f, 'lat', e.target.value)} placeholder="29.0661" /></td>
                      <td><input className="ex-input" dir="ltr" style={{ width: 130 }} value={fv(f, 'lng')} onChange={(e) => setFv(f, 'lng', e.target.value)} placeholder="31.0994" /></td>
                      <td><input className="ex-input" type="number" min="50" max="5000" style={{ width: 100 }} value={fv(f, 'radius_m')} onChange={(e) => setFv(f, 'radius_m', e.target.value)} placeholder={String(data.values.default_campus_radius_m.value)} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => hereFaculty(f)}><Icon name="map-pin" size={13} /> {ar ? 'موقعي' : 'Here'}</button>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busyFac === f.id || !facDraft[f.id]} onClick={() => saveFaculty(f)}>{ar ? 'حفظ' : 'Save'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
