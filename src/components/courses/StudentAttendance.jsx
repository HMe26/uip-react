import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcNums } from './acKit';
import { deviceId, geoErrorText, getPosition } from '../../lib/geo';

/**
 * حضوري (الطالب): نسب الحضور/الغياب لكل مادة + تسجيل الحضور بمسح QR الدكتور.
 * Backend: GET /api/v1/attendance/my · POST /api/v1/attendance/check-in.
 * التسجيل بيبعت التوكن + موقع الطالب (GPS) + معرّف الجهاز؛ السيرفر بيرفض لو بعيد عن الكلية / مكان المحاضرة.
 */

const STATE_LABEL = {
  ok: { ar: 'منتظم', en: 'On track' },
  warning: { ar: 'تحذير غياب', en: 'Absence warning' },
  deprived: { ar: 'معرّض للحرمان', en: 'Deprivation risk' },
};
const REC_LABEL = {
  present: { ar: 'حاضر', en: 'Present' }, late: { ar: 'متأخر', en: 'Late' },
  absent: { ar: 'غائب', en: 'Absent' }, excused: { ar: 'بعذر', en: 'Excused' },
};

export default function StudentAttendance() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => api.get('/api/v1/attendance/my', { locale }).then((j) => setData(j.data)), [locale]);

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
    const t = setInterval(() => { load().catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const courses = data?.courses || [];
  const openNow = courses.filter((c) => c.open_now).length;
  const atRisk = courses.filter((c) => c.state !== 'ok').length;

  const REC_TONE = { present: 'success', late: 'warning', absent: 'danger', excused: '' };

  return (
    <AcPage>
      <AcHead
        title={ar ? 'الحضور والغياب' : 'Attendance'}
        text={ar ? 'سجّل حضورك بمسح الـ QR من شاشة الدكتور وانت داخل الكلية، وتابع نسبة غيابك.' : 'Check in by scanning the QR on your instructor’s screen while on campus, and track your absence rate.'}
      >
        <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setError(null); setScanning(true); }}>
          <Icon name="map-pin" size={14} /> {ar ? 'تسجيل حضور (مسح QR)' : 'Check in (scan QR)'}
        </button>
      </AcHead>

      <AcAlerts error={error} notice={notice} />

      {loading ? <Skeleton h={120} count={3} /> : (
        <>
          <AcKpis items={[
            { label: ar ? 'مواد' : 'Courses', value: courses.length, icon: 'layers' },
            { label: ar ? 'تحضير مفتوح الآن' : 'Open now', value: openNow, icon: 'clock', tone: openNow ? 'good' : '' },
            { label: ar ? 'مواد فيها تحذير' : 'At risk', value: atRisk, icon: 'alert-triangle', tone: atRisk ? 'bad' : 'good', meta: ar ? `الحد ${data?.limits?.max_absence_percent}% غياب` : `limit ${data?.limits?.max_absence_percent}% absence` },
          ]} />

          {courses.length === 0 ? (
            <EmptyState icon="check-circle" title={ar ? 'لا توجد مواد مسجّلة' : 'No enrolled courses'} />
          ) : (
            <div className="acx-courses">
              {courses.map((c) => (
                <article key={c.course.id} className={`acx-course is-${c.state}`}>
                  <div>
                    <span className="acx-code" dir="ltr">{c.course.code}</span>
                    <div className="acx-course__name">{c.course.name}</div>
                  </div>
                  {c.open_now && <span className="acx-live"><Icon name="clock" size={13} /> {ar ? 'التحضير مفتوح الآن' : 'Attendance open now'}</span>}
                  <div className="acx-bar" aria-hidden><i style={{ width: `${c.percent_attended ?? 100}%` }} /></div>
                  <AcNums inline items={[
                    [ar ? 'حضور' : 'Attended', c.percent_attended != null ? `${c.percent_attended}%` : '—'],
                    [ar ? 'غياب' : 'Absent', c.absent],
                    [ar ? 'تأخير' : 'Late', c.late],
                    [ar ? 'بعذر' : 'Excused', c.excused],
                  ]} />
                  {c.state !== 'ok' && (
                    <div className={`st-alert st-alert--${c.state === 'deprived' ? 'danger' : 'warning'}`}>
                      <Icon name="alert-triangle" size={15} />
                      <span>{ar ? STATE_LABEL[c.state].ar : STATE_LABEL[c.state].en} — {ar ? `غيابك ${c.percent_absent}%` : `absence ${c.percent_absent}%`}</span>
                    </div>
                  )}
                  {c.recent?.length > 0 && (
                    <span className="acx-pills">
                      {c.recent.slice(0, 6).map((r) => (
                        <span key={r.window_id} className={`st-pill${REC_TONE[r.status] ? ` st-pill--${REC_TONE[r.status]}` : ''}`} title={r.opens_at}>{ar ? REC_LABEL[r.status].ar : REC_LABEL[r.status].en}</span>
                      ))}
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {scanning && <ScanDialog ar={ar} locale={locale} onClose={() => setScanning(false)} onDone={(msg) => { setScanning(false); setNotice(msg); load().catch(() => {}); }} />}
    </AcPage>
  );
}

/* ----------------------------------------------------------------------------------------- */

function ScanDialog({ ar, locale, onClose, onDone }) {
  const videoRef = useRef(null);
  const stopRef = useRef(false);
  const busyRef = useRef(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [camOk, setCamOk] = useState(true);

  const submit = useCallback(async (token) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMsg(ar ? 'جارٍ تحديد موقعك…' : 'Getting your location…');
    try {
      const pos = await getPosition();
      setMsg(ar ? 'جارٍ تسجيل الحضور…' : 'Checking you in…');
      const j = await api.post('/api/v1/attendance/check-in', { token, ...pos, device_id: deviceId(), locale });
      stopRef.current = true;
      onDone(j.message);
    } catch (e) {
      setError(e?.code ? geoErrorText(e, ar) : errorMessage(e));
      setMsg(null);
      busyRef.current = false;
      setBusy(false);
    }
  }, [ar, locale, onDone]);

  useEffect(() => {
    let stream;
    let raf;
    let detector = null;
    let jsQR = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    stopRef.current = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setCamOk(false);
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      if (!detector) jsQR = (await import('jsqr')).default;
      let last = 0;
      const tick = async (t) => {
        if (stopRef.current) return;
        raf = requestAnimationFrame(tick);
        if (t - last < 200 || busyRef.current || v.readyState < 2) return;
        last = t;
        try {
          let text = null;
          if (detector) {
            const r = await detector.detect(v);
            text = r[0]?.rawValue || null;
          } else if (jsQR && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height)?.data || null;
          }
          if (text && text.startsWith('att.')) submit(text);
        } catch { /* ignore a frame */ }
      };
      raf = requestAnimationFrame(tick);
    }
    start();
    return () => {
      stopRef.current = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [submit]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pf-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <header className="pf-head">
          <span className="pf-head__icon"><Icon name="map-pin" size={20} /></span>
          <div className="pf-head__text">
            <h2>{ar ? 'تسجيل الحضور' : 'Check in'}</h2>
            <p>{ar ? 'وجّه الكاميرا على الـ QR. لازم تكون داخل الكلية والـ GPS شغّال.' : 'Point the camera at the QR. You must be on campus with GPS on.'}</p>
          </div>
          <button type="button" className="pf-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="x" size={18} /></button>
        </header>
        <div className="pf-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {camOk ? <div className="att-scan"><video ref={videoRef} playsInline muted /></div>
            : <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{ar ? 'تعذّر فتح الكاميرا. اسمح بالوصول للكاميرا أو الصق الكود يدويًا.' : 'Camera unavailable. Allow camera access or paste the code below.'}</span></div>}
          {msg && <div className="st-alert"><Icon name="clock" size={16} /><span>{msg}</span></div>}
          {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
          <details>
            <summary className="is-muted" style={{ fontSize: 12.5, cursor: 'pointer' }}>{ar ? 'الكاميرا مش شغالة؟ أدخل الكود يدويًا' : 'Camera not working? Enter the code'}</summary>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input className="acx-input" dir="ltr" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="att.12.3456789.abcdef…" />
              <button type="button" className="btn btn-primary" disabled={busy || !manual.trim()} onClick={() => submit(manual.trim())}>{ar ? 'تسجيل' : 'Submit'}</button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
