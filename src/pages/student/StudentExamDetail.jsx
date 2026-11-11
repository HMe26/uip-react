import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import { examErrorCode, setExamSession } from '../../lib/examSession';
import StartCameraDialog from '../../components/exam/StartCameraDialog';
import ExamPasswordDialog from '../../components/exam/ExamPasswordDialog';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { Skeleton } from '../../components/student/stUi';
import {
  AttemptPill, Note, PhasePill, examPhase, examTypeLabel, fmtDateTime, fmtNum,
} from '../../components/exam/examUi';

/**
 * Student exam detail: GET my-exams/{id} (metadata only) + GET my-exams/{id}/attempts.
 * Question content is never fetched here — it only exists once an attempt starts.
 */

const VISIBILITY = {
  immediate: { en: 'Immediately after submission', ar: 'فور التسليم' },
  after_close: { en: 'After the exam closes', ar: 'بعد إغلاق الامتحان' },
  manual: { en: 'When your instructor publishes them', ar: 'عندما ينشرها أستاذك' },
};

export default function StudentExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  // Camera / identity check shown before the attempt starts (when the server asks for a start photo).
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState(null);
  // Optional exam password (only when the instructor set one). Kept in memory just for this start flow.
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdError, setPwdError] = useState(null);
  const pwdRef = useRef('');

  const loadAttempts = useCallback(() => api.get(`/api/v1/exam-system/my-exams/${id}/attempts`).then((j) => setAttempts(j.data || [])), [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/api/v1/exam-system/my-exams/${id}`).then((j) => { if (!cancelled) setExam(j.data); }),
      loadAttempts().catch(() => {}),
    ]).catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, loadAttempts]);

  const startPath = `/api/v1/exam-system/my-exams/${id}/attempts`;

  const finishStart = (j) => {
    // Keep this tab's single-session token; client.js sends it with every call on this attempt.
    setExamSession(j.data.id, j.data.session?.token, Number(id));
    navigate(`/student/exam-attempt/${j.data.id}`);
  };

  const handleStartError = (err, fromDialog) => {
    const code = examErrorCode(err);
    if (code === 'exam_password_required' || code === 'exam_password_invalid' || code === 'exam_password_locked') {
      pwdRef.current = '';
      setCamOpen(false);
      setPwdError(code === 'exam_password_required' ? null : errorMessage(err));
      setPwdOpen(true);
      setStarting(false);
      return;
    }
    if (code === 'start_photo_required' && !fromDialog) {
      setPwdOpen(false);
      setStarting(false);
      setCamError(null);
      setCamOpen(true);
      return;
    }
    if (code === 'session_conflict') {
      // Open on another device: the attempt page explains and offers to take over (counts as a violation).
      setCamOpen(false);
      api.get('/api/v1/exam-system/active-attempt')
        .then((j) => { if (j?.data?.attempt_id) navigate(`/student/exam-attempt/${j.data.attempt_id}`); else setStarting(false); })
        .catch(() => setStarting(false));
      return;
    }
    if (fromDialog) setCamError(errorMessage(err)); else setError(errorMessage(err));
    setStarting(false);
  };

  const handleStart = () => {
    if (!window.confirm(ar ? 'بدء الامتحان الآن؟ يبدأ العدّاد فورًا ولا يمكن إيقافه.' : 'Start this exam now? The timer starts immediately and cannot be paused.')) return;
    setError(null);
    if (exam?.requires_password) {
      // Ask for the exam password first; the server verifies it before anything else happens.
      pwdRef.current = '';
      setPwdError(null);
      setPwdOpen(true);
      return;
    }
    setStarting(true);
    api.post(startPath).then(finishStart).catch((err) => handleStartError(err, false));
  };

  const startWithPassword = (password) => {
    pwdRef.current = password;
    setPwdError(null);
    setStarting(true);
    return api.post(startPath, { access_password: password })
      .then((j) => { setPwdOpen(false); finishStart(j); })
      .catch((err) => handleStartError(err, false));
  };

  // Resuming also goes through POST so this device/tab claims the single session (and gets its token).
  const handleResume = () => {
    setStarting(true);
    setError(null);
    api.post(startPath).then(finishStart).catch((err) => handleStartError(err, false));
  };

  const startWithPhoto = ({ photo, idCard, flags }) => {
    setStarting(true);
    setCamError(null);
    const fd = new FormData();
    fd.append('start_photo', photo, 'start.jpg');
    if (idCard) fd.append('id_card', idCard);
    if (flags?.length) fd.append('photo_flags', JSON.stringify(flags));
    if (pwdRef.current) fd.append('access_password', pwdRef.current);
    return api.postForm(startPath, fd).then(finishStart).catch((err) => handleStartError(err, true));
  };

  if (loading) return <div className="ex-page"><Skeleton h={100} count={3} /></div>;
  if (!exam) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error || (ar ? 'الامتحان غير موجود.' : 'Exam not found.')}</span></div>;

  const phase = examPhase(exam);
  const inProgress = attempts.find((a) => a.status === 'in_progress');
  // The instructor can grant extra attempts / reopen the exam for this student (retake).
  const maxAttempts = exam.max_attempts_effective ?? exam.max_attempts;
  const maxedOut = maxAttempts != null && attempts.length >= maxAttempts && !inProgress;
  const retakeOpen = !!exam.retake_allowed;
  const notOpen = phase === 'scheduled' && !retakeOpen;
  const closed = phase === 'completed' && !retakeOpen;
  const canStart = !inProgress && !maxedOut && !notOpen && !closed;

  const used = attempts.length;
  const pct = maxAttempts ? Math.min(100, Math.round((used / maxAttempts) * 100)) : 0;
  const vis = VISIBILITY[exam.result_visibility];
  const scored = attempts.filter((a) => a.percentage != null);
  const best = scored.length ? Math.max(...scored.map((a) => a.percentage)) : null;
  const passMark = exam.passing_score != null ? Number(exam.passing_score) : null;
  const totalMarks = Number(exam.total_marks || 0);
  const didPass = (pctVal) => passMark == null || (pctVal / 100) * totalMarks >= passMark;

  const stats = [
    ['clock', ar ? 'المدة' : 'Duration', `${exam.duration_minutes} ${ar ? 'دقيقة' : 'min'}`],
    ['layers', ar ? 'عدد الأسئلة' : 'Questions', exam.question_count],
    ['award', ar ? 'الدرجة الكلية' : 'Total points', fmtNum(totalMarks)],
    ['check-circle', ar ? 'درجة النجاح' : 'Passing score', passMark != null ? fmtNum(passMark) : (ar ? 'غير محددة' : 'Not set')],
  ];

  // One line explaining why the button is missing / what happens next.
  const ctaHint = inProgress
    ? (ar ? 'عندك محاولة جارية — كمّلها قبل انتهاء الوقت.' : 'You have an attempt in progress — finish it before time runs out.')
    : notOpen
      ? (ar ? `يفتح ${fmtDateTime(exam.start_at, ar)}` : `Opens ${fmtDateTime(exam.start_at, ar)}`)
      : maxedOut
        ? (ar ? 'استنفدت كل المحاولات.' : "You've used all your attempts.")
        : closed
          ? (ar ? 'الامتحان مغلق.' : 'This exam is closed.')
          : (ar ? 'العدّاد يبدأ فور الضغط على ابدأ.' : 'The timer starts as soon as you press Start.');

  const rules = [
    { icon: 'clock', text: ar ? 'يبدأ العدّاد فور بدء المحاولة ولا يمكن إيقافه.' : 'The timer starts when you begin and cannot be paused.' },
    { icon: 'arrow-left', flip: true, text: exam.allow_back_navigation ? (ar ? 'يمكنك الرجوع إلى الأسئلة السابقة.' : 'You can go back to previous questions.') : (ar ? 'لا يمكن الرجوع إلى سؤال سابق بعد تجاوزه.' : 'You cannot return to a question once you move on.') },
    { icon: 'check-circle', text: exam.auto_submit_on_timeout ? (ar ? 'يُسلَّم الامتحان تلقائيًا عند انتهاء الوقت.' : 'The exam is submitted automatically when time runs out.') : (ar ? 'سيُغلق الامتحان عند انتهاء الوقت.' : 'The exam closes when time runs out.') },
    exam.late_grace_minutes > 0 && { icon: 'clock', warn: true, text: ar
      ? `بعد انتهاء الوقت لديك فترة سماح ${exam.late_grace_minutes} دقيقة للتسليم${exam.late_penalty_percent > 0 ? `، ويُخصم ${exam.late_penalty_percent}% من درجتك عند التسليم خلالها` : ''}.`
      : `After time ends you have a ${exam.late_grace_minutes}-minute grace period to submit${exam.late_penalty_percent > 0 ? `, and ${exam.late_penalty_percent}% is deducted from your score if you submit during it` : ''}.` },
    vis && { icon: 'eye', text: `${ar ? 'تظهر النتيجة: ' : 'Results appear: '}${ar ? vis.ar : vis.en}` },
    exam.secure_mode_enabled && { icon: 'shield', warn: true, text: ar ? 'وضع آمن: يُراقَب ملء الشاشة وتبديل التبويبات.' : 'Secure mode: fullscreen and tab switching are monitored.' },
    exam.single_session_enabled !== false && { icon: 'lock', text: ar ? 'لا يمكن فتح الامتحان من جهازين في نفس الوقت.' : 'The exam cannot be open on two devices at the same time.' },
    exam.requires_password && { icon: 'lock', text: ar ? 'هذا الامتحان محمي بباسورد — اطلبه من مدرّس المادة.' : 'This exam is password protected — ask your instructor for the password.' },
    exam.identity_check_required && { icon: 'eye', warn: true, text: ar ? 'مطلوب التحقق من الهوية بالكاميرا قبل البدء.' : 'An identity check with your camera is required before you start.' },
    !exam.identity_check_required && exam.proctoring_mode === 'required' && { icon: 'eye', warn: true, text: ar ? 'الكاميرا إلزامية وتُلتقط صور دورية أثناء الامتحان.' : 'Your camera is required and periodic photos are taken during the exam.' },
    !exam.identity_check_required && exam.proctoring_mode === 'optional' && { icon: 'eye', text: ar ? 'تُلتقط صور دورية بالكاميرا إن سمحت بها.' : 'Periodic camera photos are taken if you allow your camera.' },
  ].filter(Boolean);

  return (
    <div className="ex-page exd">
      <BackLink to="/student/my-exams" className="ex-back"><Icon name="chevron-left" size={14} className="icon-flip" /> {ar ? 'العودة إلى الامتحانات' : 'Back to Exams'}</BackLink>

      <section className="exd-hero">
        <div className="exd-hero__main">
          <div className="exd-hero__tags">
            <PhasePill phase={phase} ar={ar} />
            {exam.subject && <span className="st-tag">{exam.subject}</span>}
            {exam.exam_type && <span className="exd-chip">{examTypeLabel(exam.exam_type, ar)}</span>}
          </div>
          <h1>{exam.title}</h1>
          {exam.description && <p className="exd-hero__desc">{exam.description}</p>}
          <div className="exd-stats">
            {stats.map(([icon, label, value]) => (
              <div className="exd-stat" key={label}>
                <span className="exd-stat__icon"><Icon name={icon} size={16} /></span>
                <div>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="exd-cta">
          <div className="exd-cta__attempts">
            <div className="exd-cta__row">
              <span>{ar ? 'المحاولات' : 'Attempts'}</span>
              <strong>{used}/{maxAttempts ?? '∞'}</strong>
            </div>
            {maxAttempts ? (
              <div className="st-ecard__bar" role="progressbar" aria-valuemin={0} aria-valuemax={maxAttempts} aria-valuenow={used}>
                <span className={pct >= 100 ? 'is-full' : ''} style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>

          {inProgress ? (
            <button type="button" className="btn btn-primary exd-cta__btn" disabled={starting} onClick={handleResume}>
              <Icon name="play" size={16} /> {ar ? 'متابعة المحاولة' : 'Resume Attempt'}
            </button>
          ) : canStart ? (
            <button type="button" className="btn btn-primary exd-cta__btn" disabled={starting} onClick={handleStart}>
              <Icon name="play" size={16} /> {starting ? '…' : (ar ? 'ابدأ الامتحان' : 'Start Exam')}
            </button>
          ) : (
            <button type="button" className="btn btn-outline exd-cta__btn" disabled>
              <Icon name="lock" size={16} /> {ar ? 'غير متاح الآن' : 'Not available'}
            </button>
          )}
          <p className="exd-cta__hint">{ctaHint}</p>

          {best != null && (
            <div className={`st-ecard__score ${didPass(best) ? 'is-pass' : 'is-fail'}`}>
              <Icon name="award" size={14} />
              <span>{ar ? 'أفضل نتيجة' : 'Best score'}</span>
              <strong>{fmtNum(best)}%</strong>
            </div>
          )}
        </aside>
      </section>

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {pwdOpen && (
        <ExamPasswordDialog
          ar={ar}
          busy={starting}
          error={pwdError}
          onCancel={() => { setPwdOpen(false); setStarting(false); pwdRef.current = ''; }}
          onSubmit={startWithPassword}
        />
      )}
      {camOpen && (
        <StartCameraDialog
          ar={ar}
          identity={!!exam.identity_check_required}
          busy={starting}
          error={camError}
          onCancel={() => { setCamOpen(false); setStarting(false); }}
          onSubmit={startWithPhoto}
        />
      )}
      {notOpen && <Note tone="warn" icon="clock">{ar ? 'هذا الامتحان لم يفتح بعد. ستتمكن من بدئه في الموعد المحدد.' : 'This exam has not opened yet. You will be able to start it at the scheduled time.'}</Note>}
      {closed && attempts.length === 0 && <Note tone="bad" icon="alert-triangle">{ar ? 'أُغلق هذا الامتحان ولا توجد لديك محاولة.' : 'This exam is closed and you have no attempt.'}</Note>}
      {retakeOpen && !maxedOut && <Note tone="warn" icon="info">{ar ? 'سمح لك أستاذك بإعادة هذا الامتحان.' : 'Your instructor allowed you to retake this exam.'}{exam.retake_available_until ? ` ${ar ? 'متاح حتى' : 'Available until'} ${fmtDateTime(exam.retake_available_until, ar)}.` : ''}</Note>}
      {maxedOut && <Note icon="info">{ar ? 'استنفدت الحد الأقصى من المحاولات.' : 'You have used the maximum number of attempts.'}</Note>}

      <div className="exd-grid">
        <section className="ex-card exd-card">
          <h3 className="exd-card__title"><Icon name="file" size={16} /> {ar ? 'قبل ما تبدأ' : 'Before you start'}</h3>
          {exam.instructions ? (
            <div className="exd-instructions">{exam.instructions}</div>
          ) : (
            <p className="exd-muted">{ar ? 'لا توجد تعليمات إضافية من الأستاذ.' : 'No additional instructions from your instructor.'}</p>
          )}
          <ul className="exd-rules">
            {rules.map((r, i) => (
              <li key={i} className={r.warn ? 'is-warn' : ''}>
                <span className="exd-rules__icon"><Icon name={r.icon} size={15} className={r.flip ? 'icon-flip' : undefined} /></span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="exd-side">
          <section className="ex-card exd-card">
            <h3 className="exd-card__title"><Icon name="calendar" size={16} /> {ar ? 'المواعيد' : 'Schedule'}</h3>
            <ol className="exd-timeline">
              <li>
                <span className="exd-timeline__dot is-start" />
                <div>
                  <small>{ar ? 'يفتح' : 'Opens'}</small>
                  <strong>{exam.start_at ? fmtDateTime(exam.start_at, ar) : (ar ? 'فورًا' : 'Immediately')}</strong>
                </div>
              </li>
              <li>
                <span className="exd-timeline__dot is-end" />
                <div>
                  <small>{ar ? 'يغلق' : 'Closes'}</small>
                  <strong>{exam.end_at ? fmtDateTime(exam.end_at, ar) : (ar ? 'بلا موعد' : 'No end date')}</strong>
                </div>
              </li>
            </ol>
          </section>

          <section className="ex-card exd-card">
            <h3 className="exd-card__title"><Icon name="refresh" size={16} /> {ar ? 'محاولاتك' : 'Your attempts'}</h3>
            {attempts.length === 0 ? (
              <p className="exd-muted">{ar ? 'لا توجد محاولات بعد.' : 'No attempts yet.'}</p>
            ) : (
              <ul className="exd-attempts">
                {attempts.map((a, idx) => {
                  const num = a.attempt_number ?? (attempts.length - idx);
                  const when = a.submitted_at || a.started_at;
                  const hasPct = a.percentage != null;
                  return (
                    <li key={a.id}>
                      <span className="exd-attempts__num">{num}</span>
                      <div className="exd-attempts__body">
                        <div className="exd-attempts__top">
                          <AttemptPill status={a.status} ar={ar} />
                          {hasPct && <strong className={didPass(a.percentage) ? 'is-pass' : 'is-fail'}>{fmtNum(a.percentage)}%</strong>}
                        </div>
                        {when && <small>{fmtDateTime(when, ar)}</small>}
                      </div>
                      {a.status === 'in_progress'
                        ? <Link className="ex-link" to={`/student/exam-attempt/${a.id}`}>{ar ? 'متابعة' : 'Resume'}</Link>
                        : a.status === 'cancelled'
                          ? <small className="exd-muted">{ar ? 'أُلغيت' : 'Cancelled'}</small>
                          : <Link className="ex-link" to={`/student/exam-attempt/${a.id}/result`}>{ar ? 'النتيجة' : 'Result'}</Link>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
