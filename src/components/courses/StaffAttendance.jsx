import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcTable, AcField } from './acKit';
import { geoErrorText, getPosition } from '../../lib/geo';

/**
 * الحضور والغياب (الدكتور / المعيد / الكلية / الجامعة).
 *  - فتح تحضير: بيلتقط موقعك الحالي (مرجع الجيوفنس) ويعرض QR بيتغيّر كل ~30 ثانية.
 *  - الطالب لازم يكون جوه نطاق الكلية ونطاق مكانك، وجهاز واحد = طالب واحد.
 *  - تقرير الغياب والحرمان، تعديل يدوي، وتحديد موقع الكلية (للكلية / الجامعة).
 * Backend: /api/v1/attendance/* (CourseAttendanceApiController).
 */

const REC = {
  present: { ar: 'حاضر', en: 'Present' }, late: { ar: 'متأخر', en: 'Late' },
  absent: { ar: 'غائب', en: 'Absent' }, excused: { ar: 'بعذر', en: 'Excused' }, pending: { ar: 'لم يحضر بعد', en: 'Not yet' },
};
const TONE = { late: 'warning', absent: 'danger', excused: '', present: 'success', pending: 'neutral' };
const pill = (t) => `st-pill${TONE[t] ? ` st-pill--${TONE[t]}` : ''}`;
const STATE = { ok: { ar: 'منتظم', en: 'OK' }, warning: { ar: 'تحذير', en: 'Warning' }, deprived: { ar: 'حرمان', en: 'Deprived' } };

export default function StaffAttendance({ role }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const canSetCampus = role === 'faculty' || role === 'university';

  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [tab, setTab] = useState('live');
  const [windows, setWindows] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    api.get('/api/v1/courses', { locale })
      .then((j) => {
        const list = (j.data || []).filter((c) => c.can_manage && c.status === 'active');
        setCourses(list);
        if (list[0]) setCourseId(String(list[0].id));
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [locale]);

  const loadWindows = useCallback(async () => {
    if (!courseId) return;
    const j = await api.get(`/api/v1/attendance/courses/${courseId}/windows`, { locale });
    const list = j.data || [];
    setWindows(list);
    const open = list.find((w) => w.status === 'open');
    setActiveId((cur) => (open ? open.id : (list.some((w) => w.id === cur) ? cur : null)));
  }, [courseId, locale]);

  useEffect(() => {
    setActiveId(null);
    setWindows([]);
    setSessions([]);
    if (!courseId) return;
    loadWindows().catch((e) => setError(errorMessage(e)));
    api.get(`/api/v1/courses/${courseId}/sessions`, { locale })
      .then((j) => setSessions(Array.isArray(j.data) ? j.data : (j.data?.sessions || [])))
      .catch(() => {});
  }, [courseId, loadWindows, locale]);

  const openNow = windows.find((w) => w.status === 'open');

  async function openWindow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    let pos = {};
    let geoWarn = null;
    try { pos = await getPosition(); } catch (e) { geoWarn = geoErrorText(e, ar); }
    try {
      const j = await api.post(`/api/v1/attendance/courses/${courseId}/windows`, {
        locale, minutes: Number(minutes) || 15, session_id: sessionId ? Number(sessionId) : null, ...pos,
      });
      setNotice(j.message);
      setActiveId(j.data.id);
      setTab('live');
      await loadWindows();
    } catch (e) {
      setError(`${errorMessage(e)}${geoWarn ? ` — ${geoWarn}` : ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AcPage>
      <AcHead
        title={ar ? 'الحضور والغياب' : 'Attendance'}
        text={ar ? 'افتح تحضير للمحاضرة واعرض الـ QR. الحضور مقيّد بنطاق الكلية ومكانك، والكود بيتغيّر كل نصف دقيقة.' : 'Open attendance for a lecture and show the QR. Check-in is limited to the campus and your location, and the code rotates every 30 s.'}
      />
      <AcAlerts error={error} notice={notice} />

      {loading ? <Skeleton h={120} count={2} /> : courses.length === 0 && !canSetCampus ? (
        <AcPanel><EmptyState icon="layers" title={ar ? 'لا توجد مواد تديرها' : 'No courses to manage'} /></AcPanel>
      ) : (
        <AcPanel flush>
          <div className="acx-tabs" role="tablist">
            {[['live', ar ? 'التحضير' : 'Live'], ['history', ar ? 'السجل' : 'History'], ['report', ar ? 'تقرير الغياب' : 'Absence report'], ...(canSetCampus ? [['campus', ar ? 'موقع الكلية' : 'Campus location']] : [])].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab !== 'campus' && (
            <div className="acx-toolbar">
              <select className="acx-input" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label={ar ? 'المادة' : 'Course'}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
          )}

          {tab === 'live' && courseId && (
            openNow ? (
              <LiveWindow key={openNow.id} id={openNow.id} ar={ar} locale={locale} onChanged={loadWindows} setError={setError} setNotice={setNotice} />
            ) : (
              <div className="acx-form" style={{ borderTop: 0 }}>
                <div className="acx-form__grid">
                  <AcField label={ar ? 'المدة (دقيقة)' : 'Minutes'}>
                    <input className="acx-input" type="number" min="1" max="120" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                  </AcField>
                  <AcField label={ar ? 'الحصة' : 'Session'}>
                    <select className="acx-input" value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label={ar ? 'الحصة' : 'Session'}>
                      <option value="">{ar ? 'بدون ربط بحصة' : 'Not tied to a session'}</option>
                      {sessions.map((s) => <option key={s.id} value={s.id}>{(ar ? ['', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'] : ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])[s.day_of_week]} {s.start_time}–{s.end_time} {s.room || ''}</option>)}
                    </select>
                  </AcField>
                </div>
                <div className="acx-form__actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || !courseId} onClick={openWindow}>
                    <Icon name="map-pin" size={14} /> {ar ? 'فتح التحضير (يستخدم موقعك)' : 'Open attendance (uses your location)'}
                  </button>
                </div>
              </div>
            )
          )}

          {tab === 'history' && <History windows={windows} ar={ar} activeId={activeId} onPick={setActiveId} locale={locale} setError={setError} />}
          {tab === 'report' && courseId && <Report courseId={courseId} ar={ar} locale={locale} />}
          {tab === 'campus' && <Campus ar={ar} locale={locale} setError={setError} setNotice={setNotice} />}
        </AcPanel>
      )}
    </AcPage>
  );
}

/* ---------------------------------------------------------------------------- live window */

function LiveWindow({ id, ar, locale, onChanged, setError, setNotice }) {
  const [qr, setQr] = useState(null);       // { img, expires_in }
  const [detail, setDetail] = useState(null);
  const [left, setLeft] = useState(0);
  const timer = useRef(null);
  const [closing, setClosing] = useState(false);

  const loadDetail = useCallback(() => api.get(`/api/v1/attendance/windows/${id}`, { locale }).then((j) => setDetail(j.data)), [id, locale]);

  useEffect(() => {
    let dead = false;
    async function cycle() {
      try {
        const j = await api.get(`/api/v1/attendance/windows/${id}/qr`, { locale });
        const img = await QRCode.toDataURL(j.data.token, { errorCorrectionLevel: 'M', margin: 1, width: 400 });
        if (dead) return;
        setQr({ img, step: j.data.step, checkedIn: j.data.checked_in });
        setLeft(j.data.expires_in);
        timer.current = setTimeout(cycle, Math.max(2000, (j.data.expires_in - 1) * 1000));
      } catch (e) {
        if (dead) return;
        if (e?.status === 410) { onChanged(); return; }
        timer.current = setTimeout(cycle, 4000);
      }
    }
    cycle();
    loadDetail().catch(() => {});
    const poll = setInterval(() => loadDetail().catch(() => {}), 5000);
    const tick = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => { dead = true; clearTimeout(timer.current); clearInterval(poll); clearInterval(tick); };
  }, [id, locale, loadDetail, onChanged]);

  async function close() {
    if (!window.confirm(ar ? 'قفل التحضير؟ هيتسجّل غياب لكل من لم يحضر.' : 'Close attendance? Everyone who has not checked in will be marked absent.')) return;
    setClosing(true);
    try {
      const j = await api.post(`/api/v1/attendance/windows/${id}/close`, { locale });
      setNotice(j.message);
      await onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setClosing(false); }
  }

  const s = detail?.summary;
  return (
    <>
      <div className="acx-qr">
        {qr ? <img src={qr.img} alt="QR" /> : <Skeleton h={300} count={1} />}
        <div className="acx-bar" aria-hidden style={{ width: 'min(100%, 320px)' }}><i style={{ width: `${qr ? (left / qr.step) * 100 : 0}%`, background: 'var(--color-primary)' }} /></div>
        <p className="acx-note">{ar ? `الكود بيتغيّر خلال ${left} ث — اعرضه على الشاشة، ومتبعتش صورته` : `Code changes in ${left}s — show it live, don't share a screenshot`}</p>
        <div className="acx-qr__count">{(s?.present || 0) + (s?.late || 0)}<small> / {s?.total ?? '—'}</small></div>
        <button type="button" className="btn btn-outline btn-sm" disabled={closing} onClick={close}><Icon name="lock" size={14} /> {ar ? 'قفل التحضير' : 'Close attendance'}</button>
      </div>
      {detail && <Roster detail={detail} ar={ar} locale={locale} reload={loadDetail} setError={setError} />}
    </>
  );
}

function Roster({ detail, ar, locale, reload, setError }) {
  async function mark(sid, status) {
    try {
      await api.put(`/api/v1/attendance/windows/${detail.id}/students/${sid}`, { status, locale });
      await reload();
    } catch (e) { setError(errorMessage(e)); }
  }
  return (
    <AcTable>
      <thead><tr><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الرقم' : 'No.'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'المسافة' : 'Distance'}</th><th>{ar ? 'تعديل' : 'Set'}</th></tr></thead>
      <tbody>
        {detail.students.map((r) => (
          <tr key={r.student_id}>
            <td>{r.full_name || '—'}</td>
            <td dir="ltr" style={{ textAlign: 'start' }}>{r.student_number || '—'}</td>
            <td><span className={pill(r.status || 'pending')}>{ar ? REC[r.status || 'pending'].ar : REC[r.status || 'pending'].en}</span>{r.method === 'manual' ? ' ✎' : ''}</td>
            <td dir="ltr" style={{ textAlign: 'start' }} className="is-num">{r.distance_m != null ? `${r.distance_m} m` : '—'}</td>
            <td>
              <select className="acx-input" style={{ width: 120 }} value="" onChange={(e) => e.target.value && mark(r.student_id, e.target.value)} aria-label={ar ? 'تعديل الحالة' : 'Set status'}>
                <option value="">…</option>
                {['present', 'late', 'absent', 'excused'].map((k) => <option key={k} value={k}>{ar ? REC[k].ar : REC[k].en}</option>)}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </AcTable>
  );
}

/* ---------------------------------------------------------------------------- history / report / campus */

function History({ windows, ar, activeId, onPick, locale, setError }) {
  const [detail, setDetail] = useState(null);
  const reload = useCallback(() => (activeId ? api.get(`/api/v1/attendance/windows/${activeId}`, { locale }).then((j) => setDetail(j.data)).catch((e) => setError(errorMessage(e))) : Promise.resolve()), [activeId, locale, setError]);
  useEffect(() => { setDetail(null); reload(); }, [reload]);
  if (!windows.length) return <div className="acx-empty"><EmptyState icon="calendar" title={ar ? 'لا يوجد تحضيرات بعد' : 'No attendance sessions yet'} /></div>;
  return (
    <>
      <AcTable>
        <thead><tr><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'الحالة' : 'State'}</th><th>{ar ? 'حاضر' : 'Present'}</th><th>{ar ? 'غائب' : 'Absent'}</th><th /></tr></thead>
        <tbody>
          {windows.map((w) => (
            <tr key={w.id} className={w.id === activeId ? 'is-detail' : ''}>
              <td dir="ltr" style={{ textAlign: 'start' }} className="is-num">{String(w.opens_at).slice(0, 16)}</td>
              <td><span className={pill(w.status === 'open' ? 'present' : 'neutral')}>{w.status === 'open' ? (ar ? 'مفتوح' : 'Open') : (ar ? 'مقفول' : 'Closed')}</span></td>
              <td className="is-num">{(w.summary?.present || 0) + (w.summary?.late || 0)}</td>
              <td className="is-num">{w.summary?.absent || 0}</td>
              <td className="is-end"><button type="button" className="btn btn-outline btn-sm" onClick={() => onPick(w.id)}>{ar ? 'عرض' : 'View'}</button></td>
            </tr>
          ))}
        </tbody>
      </AcTable>
      {detail && <div style={{ borderTop: '1px solid var(--border-subtle)' }}><Roster detail={detail} ar={ar} locale={locale} reload={reload} setError={setError} /></div>}
    </>
  );
}

function Report({ courseId, ar, locale }) {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setRep(null);
    api.get(`/api/v1/attendance/courses/${courseId}/report`, { locale }).then((j) => setRep(j.data)).catch((e) => setErr(errorMessage(e)));
  }, [courseId, locale]);
  if (err) return <div className="acx-panel__body"><div className="st-alert st-alert--danger"><span>{err}</span></div></div>;
  if (!rep) return <div className="acx-panel__body"><Skeleton h={80} count={3} /></div>;
  return (
    <>
      <div className="acx-panel__body acx-stack">
        <AcKpis items={[
          { label: ar ? 'تحضيرات مقفولة' : 'Closed sessions', value: rep.sessions_held, icon: 'calendar' },
          { label: ar ? 'محرومين' : 'Deprived', value: rep.deprived_count, icon: 'alert-triangle', tone: rep.deprived_count ? 'bad' : 'good' },
        ]} />
        <p className="acx-note">{ar ? `حد الحرمان ${rep.limits.max_absence_percent}% · تحذير ${rep.limits.warn_absence_percent}%` : `Deprivation ${rep.limits.max_absence_percent}% · warning ${rep.limits.warn_absence_percent}%`}</p>
      </div>
      <AcTable>
        <thead><tr><th>{ar ? 'الطالب' : 'Student'}</th><th>{ar ? 'الرقم' : 'No.'}</th><th>{ar ? 'حضور' : 'Present'}</th><th>{ar ? 'تأخير' : 'Late'}</th><th>{ar ? 'غياب' : 'Absent'}</th><th>{ar ? 'بعذر' : 'Excused'}</th><th>{ar ? 'نسبة الغياب' : 'Absence %'}</th><th>{ar ? 'الحالة' : 'State'}</th></tr></thead>
        <tbody>
          {rep.students.map((r) => (
            <tr key={r.student_id}>
              <td>{r.full_name || '—'}</td><td dir="ltr" style={{ textAlign: 'start' }}>{r.student_number || '—'}</td>
              <td className="is-num">{r.present}</td><td className="is-num">{r.late}</td><td className="is-num">{r.absent}</td><td className="is-num">{r.excused}</td>
              <td className="is-num">{r.percent_absent}%</td>
              <td><span className={pill(r.state === 'deprived' ? 'absent' : r.state === 'warning' ? 'late' : 'present')}>{ar ? STATE[r.state].ar : STATE[r.state].en}</span></td>
            </tr>
          ))}
        </tbody>
      </AcTable>
    </>
  );
}

function Campus({ ar, locale, setError, setNotice }) {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [radius, setRadius] = useState({});
  const load = useCallback(() => api.get('/api/v1/attendance/locations', { locale }).then((j) => setRows(j.data || [])), [locale]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load, setError]);
  const rad = useMemo(() => radius, [radius]);

  async function useHere(f) {
    setBusyId(f.faculty_id);
    setError(null);
    try {
      const pos = await getPosition();
      const j = await api.put(`/api/v1/attendance/locations/${f.faculty_id}`, { lat: pos.lat, lng: pos.lng, radius_m: Number(rad[f.faculty_id] ?? f.radius_m), locale });
      setNotice(j.message);
      await load();
    } catch (e) { setError(e?.code ? geoErrorText(e, ar) : errorMessage(e)); } finally { setBusyId(null); }
  }

  if (!rows) return <div className="acx-panel__body"><Skeleton h={60} count={2} /></div>;
  return (
    <>
      <div className="acx-panel__body">
        <p className="acx-note">
          {ar ? 'قف في منتصف الكلية واضغط "استخدم موقعي الحالي". أي طالب خارج النطاق لن يُقبل حضوره حتى لو معه الـ QR.' : 'Stand in the middle of the campus and press “Use my current location”. Students outside the radius are rejected even with a valid QR.'}
        </p>
      </div>
      <AcTable>
        <thead><tr><th>{ar ? 'الكلية' : 'Faculty'}</th><th>{ar ? 'الإحداثيات' : 'Coordinates'}</th><th>{ar ? 'النطاق (متر)' : 'Radius (m)'}</th><th /></tr></thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.faculty_id}>
              <td><b>{f.name}</b></td>
              <td dir="ltr" style={{ textAlign: 'start' }}>{f.is_set ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}` : <span className="st-pill st-pill--warning">{ar ? 'غير محدد' : 'Not set'}</span>}</td>
              <td><input className="acx-input" style={{ width: 100 }} type="number" min="50" max="5000" value={rad[f.faculty_id] ?? f.radius_m} onChange={(e) => setRadius({ ...rad, [f.faculty_id]: e.target.value })} /></td>
              <td className="is-end">{f.can_edit && <button type="button" className="btn btn-primary btn-sm" disabled={busyId === f.faculty_id} onClick={() => useHere(f)}><Icon name="map-pin" size={13} /> {ar ? 'استخدم موقعي الحالي' : 'Use my current location'}</button>}</td>
            </tr>
          ))}
        </tbody>
      </AcTable>
    </>
  );
}
