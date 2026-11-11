import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

const STR = {
  en: {
    title: 'Integrity review', close: 'Close', loading: 'Loading…',
    session: 'Session & device', ip: 'IP address', lastSeen: 'Last seen', claims: 'Times the session was issued', none: '—',
    log: 'Session log', event: 'Event', device: 'Device', when: 'When',
    events: { claim: 'Opened', resume: 'Resumed', takeover: 'Taken over', blocked: 'Blocked' },
    identity: 'Identity check', idStatus: { none: 'Not required', pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' },
    approve: 'Approve', reject: 'Reject', noteLabel: 'Note (required when rejecting)', noteReviewed: 'Reviewer note',
    photos: 'Camera snapshots', noPhotos: 'No snapshots were taken.', flagged: 'flagged',
    flags: { too_dark: 'Too dark', blank: 'Blank', no_face: 'No face', multiple_faces: 'Several faces' },
    kinds: { identity: 'Identity', id_card: 'ID card', periodic: 'Periodic' },
    hint: 'Flags are computed in the student\'s browser and are only hints for your review — they are not proof and never count as violations by themselves. Faces are not matched automatically.',
    waiver: 'Camera exemption', waived: 'This student is exempt from camera monitoring.', notWaived: 'Camera monitoring applies to this student.',
    waive: 'Exempt student', unwaive: 'Restore monitoring', waiveReason: 'Reason (optional)',
    more: 'more snapshots not shown',
  },
  ar: {
    title: 'مراجعة النزاهة', close: 'إغلاق', loading: 'جارٍ التحميل…',
    session: 'الجلسة والجهاز', ip: 'عنوان IP', lastSeen: 'آخر ظهور', claims: 'عدد مرات إصدار الجلسة', none: '—',
    log: 'سجل الجلسات', event: 'الحدث', device: 'الجهاز', when: 'الوقت',
    events: { claim: 'فتح', resume: 'استكمال', takeover: 'استلام', blocked: 'تم الحجب' },
    identity: 'التحقق من الهوية', idStatus: { none: 'غير مطلوب', pending: 'بانتظار المراجعة', approved: 'مقبولة', rejected: 'مرفوضة' },
    approve: 'قبول', reject: 'رفض', noteLabel: 'ملاحظة (إجبارية عند الرفض)', noteReviewed: 'ملاحظة المراجع',
    photos: 'لقطات الكاميرا', noPhotos: 'لم تُلتقط أي لقطات.', flagged: 'مُعلَّمة',
    flags: { too_dark: 'مظلمة', blank: 'فارغة', no_face: 'لا يوجد وجه', multiple_faces: 'أكثر من وجه' },
    kinds: { identity: 'هوية', id_card: 'بطاقة', periodic: 'دورية' },
    hint: 'العلامات تُحسب في متصفح الطالب وهي مجرد مؤشرات لمساعدتك في المراجعة — ليست دليلاً ولا تُحتسب مخالفة بنفسها. لا تتم مطابقة الوجوه تلقائياً.',
    waiver: 'إعفاء من الكاميرا', waived: 'هذا الطالب معفى من مراقبة الكاميرا.', notWaived: 'مراقبة الكاميرا مطبّقة على هذا الطالب.',
    waive: 'إعفاء الطالب', unwaive: 'إعادة المراقبة', waiveReason: 'السبب (اختياري)',
    more: 'لقطات أخرى غير معروضة',
  },
};

const MAX_THUMBS = 60;
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

/** Authenticated image: snapshots are private (Bearer-protected), so they are fetched as blobs. */
function SnapImage({ path, alt, onUrl }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let created = null;
    api.blob(path)
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return;
        created = URL.createObjectURL(b);
        setUrl(created);
        onUrl?.(created);
      })
      .catch(() => {});
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return url ? <img src={url} alt={alt} /> : <div style={{ aspectRatio: '4 / 3', background: '#e5e7eb' }} />;
}

export default function ExamIntegrityModal({ examId, attempt, studentName, onClose, onChanged }) {
  const { locale } = useLanguage();
  const S = STR[locale === 'ar' ? 'ar' : 'en'];
  const base = `/api/v1/exam-system/exams/${examId}/attempts/${attempt.id}`;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [zoom, setZoom] = useState(null);
  const urls = useRef({});

  const load = useCallback(() => api.get(`${base}/integrity`)
    .then((j) => setData(j.data))
    .catch((err) => setError(errorMessage(err))), [base]);

  useEffect(() => { load(); }, [load]);

  const review = (decision) => {
    setBusy(true);
    setError(null);
    api.post(`${base}/identity-review`, { decision, note: note || undefined })
      .then(() => { setNote(''); onChanged?.(); return load(); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const toggleWaiver = () => {
    const next = !data.exam.student_waived;
    setBusy(true);
    setError(null);
    api.put(`/api/v1/exam-system/exams/${examId}/students/${attempt.student_id}/proctoring-waiver`, { waived: next, reason: reason || undefined })
      .then(() => { setReason(''); return load(); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const snaps = data?.proctoring?.snapshots || [];
  const shown = snaps.slice(0, MAX_THUMBS);
  const idStatus = data?.identity?.status || 'none';
  const pillCls = { pending: 'ex-pill--warn', approved: 'ex-pill--good', rejected: 'ex-pill--bad' }[idStatus] || '';

  return (
    <div className="ex-modal-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ex-modal" style={{ maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', alignItems: 'stretch', textAlign: 'start' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0 }}>{S.title}{studentName ? ` — ${studentName}` : ''}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{S.close}</button>
        </div>
        {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
        {!data ? <p className="text-small">{S.loading}</p> : (
          <>
            <section>
              <h3 style={{ margin: '0 0 6px' }}>{S.session}</h3>
              <p className="text-small" style={{ margin: 0 }}>
                {S.ip}: <strong>{data.session.ip || S.none}</strong> · {S.lastSeen}: <strong>{fmt(data.session.last_seen_at)}</strong> · {S.claims}: <strong>{data.session.claims_count}</strong>
              </p>
              {data.session.log.length > 0 && (
                <div className="table-responsive" style={{ marginTop: 8 }}>
                  <table className="data-table">
                    <thead><tr><th>{S.event}</th><th>{S.device}</th><th>{S.ip}</th><th>{S.when}</th></tr></thead>
                    <tbody>
                      {data.session.log.map((l, i) => (
                        <tr key={`${l.at}-${i}`}>
                          <td><span className={`ex-pill ${l.event === 'takeover' || l.event === 'blocked' ? 'ex-pill--bad' : ''}`}>{S.events[l.event] || l.event}</span></td>
                          <td>{l.device_label || S.none}</td>
                          <td>{l.ip || S.none}</td>
                          <td>{fmt(l.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {(data.exam.identity_check_required || idStatus !== 'none') && (
              <section>
                <h3 style={{ margin: '0 0 6px' }}>{S.identity} <span className={`ex-pill ${pillCls}`}>{S.idStatus[idStatus]}</span></h3>
                {data.identity.note && <p className="text-small" style={{ margin: '0 0 6px' }}>{S.noteReviewed}: {data.identity.note}</p>}
                {idStatus !== 'none' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input className="form-input" style={{ flex: '1 1 220px' }} value={note} maxLength={500} placeholder={S.noteLabel} onChange={(e) => setNote(e.target.value)} />
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => review('approve')}>{S.approve}</button>
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => review('reject')}>{S.reject}</button>
                  </div>
                )}
              </section>
            )}

            <section>
              <h3 style={{ margin: '0 0 6px' }}>{S.photos} ({data.proctoring.snapshots_count}{data.proctoring.flags_count > 0 ? ` · ${data.proctoring.flags_count} ${S.flagged}` : ''})</h3>
              {snaps.length === 0 ? <p className="text-small" style={{ margin: 0 }}>{S.noPhotos}</p> : (
                <div className="ex-integrity-grid">
                  {shown.map((s) => (
                    <figure key={s.id} className={s.flags.length ? 'is-flagged' : ''} onClick={() => urls.current[s.id] && setZoom(urls.current[s.id])}>
                      <SnapImage path={`${base}/snapshots/${s.id}`} alt="" onUrl={(u) => { urls.current[s.id] = u; }} />
                      <figcaption>
                        <span>{S.kinds[s.kind] || s.kind}</span>
                        <span>{new Date(s.captured_at).toLocaleTimeString()}</span>
                      </figcaption>
                      {s.flags.length > 0 && <figcaption style={{ flexWrap: 'wrap' }}>{s.flags.map((f) => <span key={f} className="ex-pill ex-pill--warn">{S.flags[f] || f}</span>)}</figcaption>}
                    </figure>
                  ))}
                </div>
              )}
              {snaps.length > shown.length && <p className="text-caption">+{snaps.length - shown.length} {S.more}</p>}
              <p className="text-caption" style={{ marginTop: 8 }}>{S.hint}</p>
            </section>

            {data.exam.proctoring_mode !== 'off' && (
              <section>
                <h3 style={{ margin: '0 0 6px' }}>{S.waiver}</h3>
                <p className="text-small" style={{ margin: '0 0 6px' }}>{data.exam.student_waived ? S.waived : S.notWaived}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!data.exam.student_waived && <input className="form-input" style={{ flex: '1 1 220px' }} value={reason} maxLength={1000} placeholder={S.waiveReason} onChange={(e) => setReason(e.target.value)} />}
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={toggleWaiver}>{data.exam.student_waived ? S.unwaive : S.waive}</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {zoom && (
        <div className="ex-fs-overlay" onClick={(e) => { e.stopPropagation(); setZoom(null); }} style={{ cursor: 'zoom-out' }}>
          <img src={zoom} alt="" style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
