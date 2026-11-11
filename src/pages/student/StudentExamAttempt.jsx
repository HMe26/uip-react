import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { examErrorCode, getExamSession, setExamSession } from '../../lib/examSession';
import useExamProctoring from '../../hooks/useExamProctoring';
import useNativeExamLock from '../../hooks/useNativeExamLock'; // [ANDROID]
import { isNative } from '../../native'; // [ANDROID]
import { isDevtoolsShortcut, watchDevtools } from '../../lib/examDevtoolsGuard';
import Icon from '../../components/Icon';
import QuestionImage from '../../components/exam/QuestionImage';
import ExamCameraBadge from '../../components/exam/ExamCameraBadge';
import ExamThemeSwitch from '../../components/exam/ExamThemeSwitch';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import { useExamLock } from '../../context/ExamLockContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/my-exams';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Round 3 (Attempts + Timer + Auto-save) — GET /api/v1/exam-system/attempts/{id}
 * (ExamAttemptApiController::show -> ExamAttemptService::attemptDetail()).
 * The timer is server-truth (Phase 11: "must be enforced by the backend, do
 * NOT rely only on JavaScript") — this page counts down locally between
 * syncs purely for UX smoothness, but re-fetches attempt detail on an
 * interval and whenever the local countdown hits 0, so a server-side
 * auto-submit (expired timer, or Round 5's violation-based auto-submit)
 * is always picked up and reflected here, not just assumed client-side.
 *
 * Auto-save: PUT attempts/{id}/answers/{examQuestionId} on every answer
 * change, debounced per-question so fast typing (short_answer/essay)
 * doesn't fire a request per keystroke. An empty answer clears it (DELETE)
 * rather than saving an empty payload, matching the API's own "auto-save:
 * create/update" vs "explicit delete" split.
 *
 * Round 5 (Secure Exam Mode + Security Events) — when the exam has
 * `secure_mode_enabled`, this page gates the questions behind an explicit
 * "Enter Secure Mode" action (fullscreen request needs a user gesture in
 * every browser anyway) and then, for the rest of the attempt, listens for
 * fullscreen-exit / tab-switch / window-blur and reports each (copy/paste/cut
 * are blocked but NOT reported; ESC is key-locked and never counts) via POST attempts/{id}/security-events (ExamSecurityApiController::
 * recordEvent -> ExamSecurityService::recordClientEvent(), see
 * ExamSecurityService::CLIENT_EVENTS for the exact reportable set — this
 * page never invents an event type outside that list). Per Phase 15's own
 * docblock this is browser-level only, not real proctoring, so the banner
 * says exactly that rather than overselling it.
 *
 * Every response carries the authoritative violations_count/max_violations/
 * threshold_exceeded — if `auto_submitted` comes back true the attempt is
 * already `auto_submitted` server-side in that same request, so this page
 * just re-syncs and routes to the result page, the same as the timer
 * running out does.
 *
 * Exam lock-down (all exams): while the attempt is in progress the portal
 * shell is locked by ExamLockContext/DashboardLayout (no sidebar, topbar,
 * bottom nav or AI assistant; every other route redirects back here). This
 * page adds: a beforeunload prompt, a history trap for the Back button, a
 * blocking overlay when fullscreen is left in secure mode, a final "Review &
 * Submit" screen (answered / unanswered / flagged per question) with an
 * explicit confirmation, and a real flush of pending auto-saves before
 * submitting. The ONLY ways out are Submit, the server timer, or the
 * server-side violation limit — all of which end the attempt.
 */

const SAVE_DEBOUNCE_MS = 900;
const SYNC_INTERVAL_MS = 20000;

const TYPE_LABELS = {
  mcq: 'Multiple Choice',
  multi_select: 'Multi-select',
  true_false: 'True / False',
  short_answer: 'Short Answer',
  essay: 'Essay',
};

const STR = {
  en: {
    prev: 'Previous', next: 'Next', noBack: 'You cannot go back to previous questions.',
    flag: 'Flag for review', unflag: 'Remove flag',
    reviewSubmit: 'Review & Submit',
    reviewTitle: 'Review your answers',
    reviewSub: 'Check every question before you submit. You cannot change anything after submitting.',
    answered: 'Answered', unanswered: 'Not answered', flagged: 'Flagged', current: 'Current',
    missingTitle: 'You have unanswered questions',
    missingBody: 'Questions without an answer:',
    flaggedBody: 'Questions you flagged for review:',
    allDone: 'All questions are answered.',
    locked: 'Locked', lockedHint: 'Earlier questions cannot be reopened in this exam.',
    backToExam: 'Back to exam', submitFinal: 'Submit final answers',
    confirmTitle: 'Submit your exam?',
    confirmBody: 'This is final. You will not be able to return to the exam or change any answer.',
    confirmMissing: (n) => `${n} question(s) are still unanswered and will be marked as blank.`,
    confirmCancel: 'Keep working', confirmYes: 'Yes, submit now',
    submitting: 'Submitting…',
    saveFailed: 'Some answers could not be saved. Check your connection and try again — your exam has not been submitted.',
    fsTitle: 'Fullscreen is required',
    fsBody: 'You left fullscreen. This was recorded as a violation. The exam is hidden until you return to fullscreen; the timer keeps running.',
    fsBtn: 'Return to fullscreen',
    dtTitle: 'Developer tools detected',
    dtBody: 'Developer tools are not allowed during the exam. This was recorded as a violation. Close them to continue; the exam stays hidden and the timer keeps running.',
    leavePrompt: 'The exam is still in progress.',
    retry: 'Retry',
    timeLeft: 'Time left',
    graceLeft: 'Grace period left',
    graceBanner: (pct) => `Time is up. You are in the grace period${pct > 0 ? ` — ${pct}% will be deducted from your score` : ''}. Submit now.`,
    sessReplacedTitle: 'This exam is open somewhere else',
    sessReplacedBody: 'Another tab or device took over this attempt, so this window is paused. Continue here to take it back.',
    sessRequiredTitle: 'Continue the exam on this device',
    sessRequiredBody: 'This attempt must be opened from this device before you can continue.',
    sessConflictTitle: 'The exam is open on another device',
    sessConflictBody: 'Your attempt is currently active on another device. You can take it over here, but this is recorded as a violation and the other device will be locked out.',
    sessContinue: 'Continue here', sessTakeover: 'Take over (counts as a violation)', sessWorking: 'Please wait…',
    camTitle: 'Camera required', camBody: 'This exam requires your camera to stay on. The exam is hidden until the camera is working.',
    camStarting: 'Starting the camera…', camRetry: 'Try the camera again',
    camDenied: 'Camera access was blocked. Allow it in your browser settings.', camMissing: 'No camera was found.',
    camBusy: 'The camera is used by another app.', camLost: 'The camera stopped.', camUnsupported: 'This browser cannot access the camera.',
  },
  ar: {
    prev: 'السابق', next: 'التالي', noBack: 'لا يمكن الرجوع إلى الأسئلة السابقة.',
    flag: 'تمييز للمراجعة', unflag: 'إزالة التمييز',
    reviewSubmit: 'مراجعة وتسليم',
    reviewTitle: 'راجع إجاباتك',
    reviewSub: 'تأكد من كل سؤال قبل التسليم. لا يمكنك تغيير أي شيء بعد التسليم.',
    answered: 'تمت الإجابة', unanswered: 'بدون إجابة', flagged: 'مميّز للمراجعة', current: 'الحالي',
    missingTitle: 'لديك أسئلة لم تُجب عنها',
    missingBody: 'أسئلة بدون إجابة:',
    flaggedBody: 'أسئلة ميّزتها للمراجعة:',
    allDone: 'تمت الإجابة عن كل الأسئلة.',
    locked: 'مغلق', lockedHint: 'لا يمكن إعادة فتح الأسئلة السابقة في هذا الامتحان.',
    backToExam: 'العودة للامتحان', submitFinal: 'تسليم الإجابات نهائياً',
    confirmTitle: 'تسليم الامتحان؟',
    confirmBody: 'هذا القرار نهائي. لن تتمكن من العودة للامتحان أو تغيير أي إجابة.',
    confirmMissing: (n) => `${n} سؤال لم تُجب عنه وسيُحتسب فارغاً.`,
    confirmCancel: 'متابعة الامتحان', confirmYes: 'نعم، سلّم الآن',
    submitting: 'جارٍ التسليم…',
    saveFailed: 'تعذّر حفظ بعض الإجابات. تحقق من الاتصال وحاول مرة أخرى — لم يتم تسليم الامتحان.',
    fsTitle: 'وضع ملء الشاشة مطلوب',
    fsBody: 'خرجت من وضع ملء الشاشة وتم تسجيل ذلك كمخالفة. الامتحان مخفي حتى تعود لملء الشاشة، والوقت مستمر.',
    fsBtn: 'العودة لملء الشاشة',
    dtTitle: 'تم اكتشاف أدوات المطوّر',
    dtBody: 'أدوات المطوّر (F12) غير مسموحة أثناء الامتحان، وتم تسجيل ذلك كمخالفة. أغلقها للمتابعة؛ الامتحان مخفي والوقت مستمر.',
    leavePrompt: 'الامتحان لا يزال جارياً.',
    retry: 'إعادة المحاولة',
    timeLeft: 'الوقت المتبقي',
    graceLeft: 'متبقي من فترة السماح',
    graceBanner: (pct) => `انتهى وقت الامتحان. أنت الآن في فترة السماح${pct > 0 ? ` — سيُخصم ${pct}% من درجتك` : ''}. سلّم الآن.`,
    sessReplacedTitle: 'الامتحان مفتوح في مكان آخر',
    sessReplacedBody: 'تبويب أو جهاز آخر استلم هذه المحاولة، لذلك تم إيقاف هذه النافذة. اضغط للمتابعة هنا لاستعادتها.',
    sessRequiredTitle: 'تابع الامتحان على هذا الجهاز',
    sessRequiredBody: 'يجب فتح هذه المحاولة من هذا الجهاز أولاً قبل المتابعة.',
    sessConflictTitle: 'الامتحان مفتوح على جهاز آخر',
    sessConflictBody: 'محاولتك نشطة حالياً على جهاز آخر. يمكنك استلامها هنا، لكن يُسجَّل ذلك كمخالفة ويُقفل الجهاز الآخر.',
    sessContinue: 'المتابعة هنا', sessTakeover: 'استلام المحاولة (تُحتسب مخالفة)', sessWorking: 'يرجى الانتظار…',
    camTitle: 'الكاميرا مطلوبة', camBody: 'هذا الامتحان يتطلب بقاء الكاميرا مفعّلة. الامتحان مخفي حتى تعمل الكاميرا.',
    camStarting: 'جارٍ تشغيل الكاميرا…', camRetry: 'إعادة تشغيل الكاميرا',
    camDenied: 'تم حظر الكاميرا. اسمح بها من إعدادات المتصفح.', camMissing: 'لم يتم العثور على كاميرا.',
    camBusy: 'الكاميرا مستخدمة في تطبيق آخر.', camLost: 'توقفت الكاميرا.', camUnsupported: 'هذا المتصفح لا يدعم الكاميرا.',
  },
};

function formatTime(totalSeconds) {
  if (totalSeconds == null) return '--:--';
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function isAnswered(question) {
  const a = question.my_answer;
  if (!a) return false;
  if (a.selected_option_ids && a.selected_option_ids.length > 0) return true;
  if (a.answer_text && a.answer_text.trim() !== '') return true;
  return false;
}

function exitFullscreen() {
  try {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
    if (document.fullscreenElement && fn) Promise.resolve(fn.call(document)).catch(() => {});
  } catch { /* ignore */ }
}

/**
 * Chromium-only (Chrome/Edge/Opera): the Keyboard Lock API makes a plain ESC
 * press reach the page instead of exiting fullscreen (the browser then only
 * exits on a long ESC hold). Needs fullscreen + a secure context; Firefox and
 * Safari don't implement it and no web page can intercept ESC there.
 */
function lockEscapeKey() {
  try {
    if (document.fullscreenElement && navigator.keyboard?.lock) {
      Promise.resolve(navigator.keyboard.lock(['Escape'])).catch(() => {});
    }
  } catch { /* unsupported */ }
}

export default function StudentExamAttempt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const S = STR[locale === 'ar' ? 'ar' : 'en'];
  const examLock = useExamLock();

  const [cur, setCur] = useState(0);
  const [attempt, setAttempt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  // Late-submission policy: main time is over but the exam allows a grace period (counted down separately).
  const [graceLeft, setGraceLeft] = useState(0);
  // Single-session guard: null | 'session_required' | 'session_replaced' | 'session_conflict'
  const [sessionIssue, setSessionIssue] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // examQuestionId -> 'idle' | 'saving' | 'saved' | 'error'
  const [saveState, setSaveState] = useState({});
  const saveTimers = useRef({});
  const pendingRef = useRef({});
  const autoSubmitTriggered = useRef(false);

  // Client-side "flag for review" marks, kept per attempt so a reload keeps them.
  const flagKey = `uip-exam-flags-${id}`;
  const [flagged, setFlagged] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(flagKey) || '[]'); } catch { return []; }
  });
  const toggleFlag = (qid) => setFlagged((f) => {
    const next = f.includes(qid) ? f.filter((x) => x !== qid) : [...f, qid];
    try { sessionStorage.setItem(flagKey, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  /** True if `err` was a single-session rejection (another tab/device owns the attempt) and has been handled. */
  const handleSessionError = useCallback((err) => {
    const code = examErrorCode(err);
    if (err?.status === 409 && (code === 'session_required' || code === 'session_replaced' || code === 'session_conflict')) {
      setSessionIssue(code);
      return true;
    }
    return false;
  }, []);

  const load = useCallback(() => {
    return api.get(`/api/v1/exam-system/attempts/${id}`).then((json) => {
      setSessionIssue(null);
      setAttempt(json.data);
      setSecondsLeft(json.data.time_remaining_seconds);
      setGraceLeft(json.data.in_grace ? (json.data.grace_remaining_seconds || 0) : 0);
      // entering the grace period re-arms the "time is really up" re-sync
      if (json.data.in_grace) autoSubmitTriggered.current = false;
    }).catch((err) => {
      if (handleSessionError(err)) return;
      throw err;
    });
  }, [id, handleSessionError]);

  /** Re-claim the single session for this attempt from this tab (optionally taking over from another device). */
  const claimSession = useCallback(async (takeover) => {
    setClaiming(true);
    try {
      let examId = getExamSession(id)?.examId;
      if (!examId) {
        const a = await api.get('/api/v1/exam-system/active-attempt');
        if (!a?.data?.active || Number(a.data.attempt_id) !== Number(id)) throw new Error(t('Attempt is not active.'));
        examId = a.data.exam_id;
      }
      const j = await api.post(`/api/v1/exam-system/my-exams/${examId}/attempts`, takeover ? { takeover: true } : {});
      setExamSession(j.data.id, j.data.session?.token, examId);
      setSessionIssue(null);
      await load();
    } catch (err) {
      if (examErrorCode(err) === 'session_conflict') setSessionIssue('session_conflict');
      else setError(errorMessage(err));
    } finally {
      setClaiming(false);
    }
  }, [id, load, t]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [load]);

  const questions = useMemo(() => attempt?.questions || [], [attempt]);
  const answeredCount = useMemo(() => questions.filter(isAnswered).length, [questions]);
  const isActive = attempt?.status === 'in_progress';

  // Switch the portal lock-down on while the attempt is live, off once it is over.
  const { engage, release } = examLock;
  useEffect(() => {
    if (!attempt) return;
    if (isActive) engage(id, attempt.exam?.title);
    else { release(); exitFullscreen(); }
  }, [attempt, isActive, id, engage, release]);

  // ---- Round 3: saving ----------------------------------------------
  const persistAnswer = useCallback((examQuestionId, payload) => {
    setSaveState((s) => ({ ...s, [examQuestionId]: 'saving' }));
    const isEmpty = (!payload.selected_option_ids || payload.selected_option_ids.length === 0)
      && (!payload.answer_text || payload.answer_text.trim() === '');

    const req = isEmpty
      ? api.del(`/api/v1/exam-system/attempts/${id}/answers/${examQuestionId}`)
      : api.put(`/api/v1/exam-system/attempts/${id}/answers/${examQuestionId}`, payload);

    return req
      .then((json) => {
        setSaveState((s) => ({ ...s, [examQuestionId]: 'saved' }));
        if (json?.data?.time_remaining_seconds != null) {
          setSecondsLeft(json.data.time_remaining_seconds);
          setGraceLeft(json.data.in_grace ? (json.data.grace_remaining_seconds || 0) : 0);
        }
        if (json?.data?.status && json.data.status !== 'in_progress') {
          // Server decided the attempt is no longer active (timer ran out
          // mid-save) — re-sync fully to pick up the new state.
          load().catch(() => {});
        }
        return true;
      })
      .catch((err) => {
        handleSessionError(err);
        setSaveState((s) => ({ ...s, [examQuestionId]: 'error' }));
        // Keep the payload so the next flush retries it (unless a newer edit exists).
        if (!pendingRef.current[examQuestionId]) pendingRef.current[examQuestionId] = payload;
        return false;
      });
  }, [id, load, handleSessionError]);

  const scheduleSave = useCallback((examQuestionId, payload) => {
    pendingRef.current[examQuestionId] = payload;
    clearTimeout(saveTimers.current[examQuestionId]);
    saveTimers.current[examQuestionId] = setTimeout(() => {
      const p = pendingRef.current[examQuestionId];
      delete pendingRef.current[examQuestionId];
      if (p) persistAnswer(examQuestionId, p);
    }, SAVE_DEBOUNCE_MS);
  }, [persistAnswer]);

  /** Save everything still waiting (debounced or previously failed). Resolves true only if all succeeded. */
  const flushSaves = useCallback(async () => {
    const entries = Object.entries(pendingRef.current);
    pendingRef.current = {};
    entries.forEach(([qid]) => clearTimeout(saveTimers.current[qid]));
    const results = await Promise.all(entries.map(([qid, p]) => persistAnswer(Number(qid), p)));
    return results.every(Boolean);
  }, [persistAnswer]);

  // Periodic re-sync with the server (source of truth for the timer and
  // for any server-side auto-submit that happened elsewhere), plus a retry
  // of any answer whose save failed.
  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return undefined;
    const iv = setInterval(() => {
      load().catch(() => {});
      if (Object.keys(pendingRef.current).length) flushSaves();
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [attempt, load, flushSaves]);

  // Single-session heartbeat: keeps this device's session alive and notices quickly if another tab/device took over.
  const HEARTBEAT_MS = (attempt?.session?.heartbeat_seconds || 30) * 1000;
  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || sessionIssue) return undefined;
    const iv = setInterval(() => {
      api.post(`/api/v1/exam-system/attempts/${id}/heartbeat`)
        .then((json) => { if (json?.data?.status && json.data.status !== 'in_progress') load().catch(() => {}); })
        .catch((err) => { handleSessionError(err); });
    }, HEARTBEAT_MS);
    return () => clearInterval(iv);
  }, [attempt?.status, sessionIssue, id, load, handleSessionError, HEARTBEAT_MS]);

  // Local 1s countdown for a smooth display between syncs. Main time first, then the grace period (if the
  // exam has one); when everything is over, re-sync once so the server-side auto-submit is picked up.
  useEffect(() => {
    if (attempt?.status !== 'in_progress' || secondsLeft == null) return undefined;
    if (secondsLeft <= 0) {
      if (graceLeft > 0) {
        const graceTick = setTimeout(() => setGraceLeft((g) => Math.max(0, g - 1)), 1000);
        return () => clearTimeout(graceTick);
      }
      if (!autoSubmitTriggered.current) {
        autoSubmitTriggered.current = true;
        load().catch(() => {});
      }
      return undefined;
    }
    const timeout = setTimeout(() => setSecondsLeft((s) => (s == null ? s : s - 1)), 1000);
    return () => clearTimeout(timeout);
  }, [attempt?.status, secondsLeft, graceLeft, load]);

  // ---- Round 5: Secure Exam Mode ----------------------------------
  const secureModeEnabled = attempt?.exam?.secure_mode_enabled;
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [secureModeEntered, setSecureModeEntered] = useState(false);
  const secureModeEnteredRef = useRef(false);
  const lastEscapeRef = useRef(0);
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const reportSecurityEvent = useCallback((eventType, metadata) => {
    if (!isActiveRef.current) return;
    api.post(`/api/v1/exam-system/attempts/${id}/security-events`, { event_type: eventType, metadata: metadata || null })
      .then((json) => {
        if (json?.data) {
          setAttempt((prev) => (prev ? { ...prev, violations_count: json.data.violations_count, violations_remaining: json.data.violations_remaining } : prev));
        }
        if (json?.data?.auto_submitted) {
          isActiveRef.current = false;
          release();
          exitFullscreen();
          navigate(`/student/exam-attempt/${id}/result`, { replace: true });
        }
      })
      .catch((err) => { handleSessionError(err); });
  }, [id, navigate, release, handleSessionError]);

  // [ANDROID] full screen + screen pinning for the whole attempt (does nothing in the browser).
  // Un-pinning counts like leaving fullscreen (secure-mode exams only, same as the web version).
  const nativeLock = useNativeExamLock({
    active: isActive,
    onLost: () => { if (secureModeEnabled && secureModeEnteredRef.current) reportSecurityEvent('fullscreen_exited', { source: 'screen_unpinned' }); },
  });

  // ---- Camera monitoring (optional / required) — configured per student by the server (waivers included) ----
  const proctorCfg = attempt?.proctoring;
  const proctor = useExamProctoring({
    attemptId: id,
    mode: proctorCfg?.mode || 'off',
    intervalSeconds: proctorCfg?.snapshot_interval_seconds,
    active: isActive && !sessionIssue,
    reportEvent: reportSecurityEvent,
  });

  const handleEnterSecureMode = () => {
    if (isNative) { // [ANDROID] the WebView has no usable Fullscreen API; (re)start the native lock instead
      Promise.resolve(nativeLock.reenter()).finally(() => {
        const first = !secureModeEnteredRef.current;
        secureModeEnteredRef.current = true;
        setSecureModeEntered(true);
        if (first) reportSecurityEvent('fullscreen_entered');
      });
      return;
    }
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    Promise.resolve(req ? req.call(el) : null)
      .catch(() => {})
      .finally(() => {
        const first = !secureModeEnteredRef.current;
        secureModeEnteredRef.current = true;
        setSecureModeEntered(true);
        setIsFullscreen(!!document.fullscreenElement);
        lockEscapeKey();
        if (first) reportSecurityEvent('fullscreen_entered');
      });
  };

  useEffect(() => {
    if (!secureModeEnabled || !isActive) return undefined;

    const onFullscreenChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (fs) { lockEscapeKey(); return; }
      // Leaving fullscreen right after an Escape press is the student hitting
      // ESC, not trying to leave: no violation. The "return to fullscreen"
      // overlay still shows so the exam stays hidden until they come back.
      const viaEscape = Date.now() - lastEscapeRef.current < 1500;
      if (secureModeEnteredRef.current && isActiveRef.current && !viaEscape) reportSecurityEvent('fullscreen_exited');
    };
    const onVisibilityChange = () => {
      if (document.hidden && secureModeEnteredRef.current) reportSecurityEvent('tab_switch');
    };
    const onBlur = () => { if (secureModeEnteredRef.current) reportSecurityEvent('window_blur'); };
    const onFocus = () => { if (secureModeEnteredRef.current) reportSecurityEvent('window_focus'); };
    // Copy / paste / cut are BLOCKED but deliberately NOT reported: students
    // select text with the mouse while reading (or hit Ctrl+C by reflex),
    // which must never count toward the violation limit.
    const onCopy = (e) => { if (secureModeEnteredRef.current) e.preventDefault(); };
    const onPaste = (e) => { if (secureModeEnteredRef.current) e.preventDefault(); };
    const onCut = (e) => { if (secureModeEnteredRef.current) e.preventDefault(); };
    const onContextMenu = (e) => { if (secureModeEnteredRef.current) e.preventDefault(); };
    const onKeyDown = (e) => {
      if (!secureModeEnteredRef.current) return;
      if (e.key === 'Escape') { lastEscapeRef.current = Date.now(); e.preventDefault(); return; }
      const k = String(e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(k)) e.preventDefault();
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('cut', onCut);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      try { navigator.keyboard?.unlock?.(); } catch { /* ignore */ }
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [secureModeEnabled, isActive, reportSecurityEvent]);

  // ---- DevTools guard: block the shortcuts, detect an open panel, hide the exam and report it ----
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const lastDevtoolsKeyRef = useRef(0);
  useEffect(() => {
    if (!isActive) { setDevtoolsOpen(false); return undefined; }
    const onKeyDown = (e) => {
      if (!isDevtoolsShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastDevtoolsKeyRef.current > 3000) {
        lastDevtoolsKeyRef.current = now;
        reportSecurityEvent('devtools_attempt', { key: e.code || e.key });
      }
    };
    const onContextMenu = (e) => e.preventDefault();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', onContextMenu);
    const stopWatching = watchDevtools({
      onChange: (open) => {
        setDevtoolsOpen(open);
        if (open) reportSecurityEvent('devtools_opened');
      },
    });
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('contextmenu', onContextMenu);
      stopWatching();
    };
  }, [isActive, reportSecurityEvent]);

  // ---- Lock-down: no way out except Submit / timer / violation limit ----
  useEffect(() => {
    if (!isActive) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = S.leavePrompt; return S.leavePrompt; };
    // History trap: every Back press lands on the same entry again.
    const trap = () => window.history.pushState(null, '', window.location.href);
    trap();
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', trap);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', trap);
    };
  }, [isActive, S.leavePrompt]);

  const updateLocalAnswer = useCallback((examQuestionId, patch) => {
    setAttempt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => (
          q.exam_question_id === examQuestionId
            ? { ...q, my_answer: { ...(q.my_answer || { selected_option_ids: [], answer_text: null }), ...patch } }
            : q
        )),
      };
    });
  }, []);

  const handleOptionChange = (question, optionId, multi) => {
    if (question.type === 'true_false') {
      // True/false is stored server-side as answer_text 'true' | 'false' (not option ids).
      updateLocalAnswer(question.exam_question_id, { answer_text: String(optionId), selected_option_ids: null });
      scheduleSave(question.exam_question_id, { answer_text: String(optionId), selected_option_ids: null });
      return;
    }
    const current = question.my_answer?.selected_option_ids || [];
    let next;
    if (multi) {
      next = current.includes(optionId) ? current.filter((o) => o !== optionId) : [...current, optionId];
    } else {
      next = [optionId];
    }
    updateLocalAnswer(question.exam_question_id, { selected_option_ids: next });
    scheduleSave(question.exam_question_id, { selected_option_ids: next, answer_text: null });
  };

  const handleTextChange = (question, text) => {
    updateLocalAnswer(question.exam_question_id, { answer_text: text });
    scheduleSave(question.exam_question_id, { answer_text: text, selected_option_ids: null });
  };

  const openReview = () => {
    flushSaves();
    setSubmitError(null);
    setReviewing(true);
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const saved = await flushSaves();
    if (!saved) {
      setSubmitError(S.saveFailed);
      setSubmitting(false);
      setConfirming(false);
      return;
    }
    try {
      await api.post(`/api/v1/exam-system/attempts/${id}/submit`);
      isActiveRef.current = false;
      release();
      exitFullscreen();
      navigate(`/student/exam-attempt/${id}/result`, { replace: true });
    } catch (err) {
      // The request may have reached the server even though the reply was lost: re-check the real status
      // before telling the student anything went wrong.
      let alreadySubmitted = false;
      try {
        const chk = await api.get(`/api/v1/exam-system/attempts/${id}`);
        alreadySubmitted = !!chk?.data?.status && chk.data.status !== 'in_progress';
      } catch { /* still offline — fall through to the error message */ }
      if (alreadySubmitted) {
        isActiveRef.current = false;
        release();
        exitFullscreen();
        navigate(`/student/exam-attempt/${id}/result`, { replace: true });
        return;
      }
      if (!handleSessionError(err)) setSubmitError(errorMessage(err));
      setSubmitting(false);
      setConfirming(false);
    }
  };

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (sessionIssue) {
    const title = sessionIssue === 'session_conflict' ? S.sessConflictTitle : sessionIssue === 'session_required' ? S.sessRequiredTitle : S.sessReplacedTitle;
    const body = sessionIssue === 'session_conflict' ? S.sessConflictBody : sessionIssue === 'session_required' ? S.sessRequiredBody : S.sessReplacedBody;
    return (
      <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 480, margin: '40px auto', alignItems: 'center', textAlign: 'center' }}>
        <Icon name="lock" size={32} />
        <h1 className="text-h3" style={{ margin: 0 }}>{title}</h1>
        <p className="text-small" style={{ margin: 0 }}>{body}</p>
        {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
        {sessionIssue === 'session_conflict' ? (
          <button type="button" className="btn btn-danger" disabled={claiming} onClick={() => claimSession(true)}>{claiming ? S.sessWorking : S.sessTakeover}</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={claiming} onClick={() => claimSession(false)}>{claiming ? S.sessWorking : S.sessContinue}</button>
        )}
      </div>
    );
  }
  if (error) {
    return (
      <div className="card glass-panel" style={{ maxWidth: 480, margin: '40px auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p className="form-error" style={{ margin: 0 }}>{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{S.retry}</button>
      </div>
    );
  }
  if (!attempt) return null;

  if (!isActive) {
    return (
      <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 480, margin: '40px auto' }}>
        <p className="text-small" style={{ margin: 0 }}>{t('This attempt has already been submitted.')}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate(`/student/exam-attempt/${id}/result`)}>
          {t('View Result')}
        </button>
      </div>
    );
  }

  // Camera: small live preview badge + a blocking overlay when the camera is required but not working.
  const camBlocked = proctor.enabled && proctorCfg?.mode === 'required' && !proctor.ok;
  const camMsg = { denied: S.camDenied, missing: S.camMissing, busy: S.camBusy, lost: S.camLost, unsupported: S.camUnsupported }[proctor.status];
  const cameraUi = proctor.enabled ? (
    <>
      {proctor.ok && <ExamCameraBadge videoRef={proctor.setVideoEl} />}
      {camBlocked && (
        <div className="ex-fs-overlay" role="alertdialog" aria-modal="true">
          <div className="ex-fs-overlay__box">
            <Icon name="eye" size={34} />
            <h2>{S.camTitle}</h2>
            <p>{proctor.status === 'starting' ? S.camStarting : (camMsg || S.camBody)}</p>
            {proctor.status !== 'starting' && <p className="ex-card__sub">{S.camBody}</p>}
            {proctor.status !== 'starting' && <button type="button" className="btn btn-primary" onClick={proctor.retry}>{S.camRetry}</button>}
          </div>
        </div>
      )}
    </>
  ) : null;

  const timeCritical = secondsLeft != null && secondsLeft <= 60;

  if (secureModeEnabled && !secureModeEntered) {
    return (
      <>
      <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 480, margin: '40px auto', alignItems: 'center', textAlign: 'center' }}>
        <Icon name="shield" size={32} />
        <h1 className="text-h3" style={{ margin: 0 }}>{t('Secure Exam Mode')}</h1>
        <p className="text-small" style={{ margin: 0 }}>
          {t('This exam is monitored: fullscreen exits and tab switches will be recorded as violations. Copy and paste are blocked.')}
        </p>
        {attempt.exam.max_violations != null && (
          <p className="text-caption" style={{ margin: 0 }}>
            {t('Maximum violations allowed')}: {attempt.exam.max_violations}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={handleEnterSecureMode}>
          {t('Enter Secure Mode & Continue')}
        </button>
        <ExamThemeSwitch />
      </div>
      {cameraUi}
      </>
    );
  }

  const allowBack = !!attempt.exam.allow_back_navigation;
  const last = questions.length - 1;
  const idx = Math.min(cur, Math.max(last, 0));
  const q = questions[idx];
  const state = q ? saveState[q.exam_question_id] : null;
  const goTo = (n) => {
    if (n >= 0 && n <= last && (allowBack || n >= idx)) {
      flushSaves();
      setCur(n);
    }
  };
  const missing = questions.map((x, n) => (isAnswered(x) ? null : n + 1)).filter(Boolean);
  const flaggedNums = questions.map((x, n) => (flagged.includes(x.exam_question_id) ? n + 1 : null)).filter(Boolean);
  const fullscreenOk = isNative ? !nativeLock.lost : isFullscreen; // [ANDROID]
  const fsBlocked = secureModeEnabled && secureModeEntered && !fullscreenOk;
  const inGrace = isActive && secondsLeft === 0 && graceLeft > 0;
  const latePenalty = Number(attempt.exam.late_penalty_percent) || 0;

  const header = (
    <div className="ex-card ex-attempt-bar">
      <div>
        <h1 dir="auto">{attempt.exam.title}</h1>
        <p className="ex-card__sub"><bdi dir="ltr">{answeredCount} / {questions.length}</bdi> {t('Answered').toLowerCase()}</p>
      </div>
      <div className="ex-attempt-bar__meta">
        <ExamThemeSwitch />
        {secureModeEnabled && (
          <span className="ex-inline" title={t('Violations')}>
            <Icon name={fullscreenOk ? 'shield' : 'lock'} size={16} />
            <bdi dir="ltr">{attempt.violations_count ?? 0}{attempt.exam.max_violations != null ? ` / ${attempt.exam.max_violations}` : ''}</bdi>
          </span>
        )}
        <span className={`ex-timer${timeCritical || inGrace ? ' is-critical' : ''}`} title={inGrace ? S.graceLeft : S.timeLeft} aria-live="off">
          <Icon name="clock" size={16} /><bdi dir="ltr">{formatTime(inGrace ? graceLeft : secondsLeft)}</bdi>
        </span>
      </div>
    </div>
  );

  // ================== Review & Submit screen ==================
  if (reviewing) {
    return (
      <div className="ex-page ex-page--narrow" style={{ paddingBottom: 'var(--space-6)' }}>
        {header}

        <div className="ex-card ex-card__pad ex-final">
          <h2 className="ex-final__title">{S.reviewTitle}</h2>
          <p className="ex-card__sub">{S.reviewSub}</p>

          <div className="ex-final__stats">
            <div className="ex-final__stat is-answered"><strong>{answeredCount}</strong><span>{S.answered}</span></div>
            <div className="ex-final__stat is-missing"><strong>{missing.length}</strong><span>{S.unanswered}</span></div>
            <div className="ex-final__stat is-flagged"><strong>{flaggedNums.length}</strong><span>{S.flagged}</span></div>
          </div>

          <div className="ex-final__grid" role="group" aria-label={S.reviewTitle}>
            {questions.map((x, n) => {
              const done = isAnswered(x);
              const flag = flagged.includes(x.exam_question_id);
              const locked = !allowBack && n < idx;
              return (
                <button
                  key={x.exam_question_id}
                  type="button"
                  disabled={locked}
                  className={`ex-final__tile${done ? ' is-answered' : ' is-missing'}${flag ? ' is-flagged' : ''}`}
                  onClick={() => { setCur(n); setReviewing(false); }}
                  aria-label={`${t('Question')} ${n + 1} — ${done ? S.answered : S.unanswered}${flag ? ` — ${S.flagged}` : ''}${locked ? ` — ${S.locked}` : ''}`}
                >
                  <span className="ex-final__num">{n + 1}</span>
                  <span className="ex-final__state">
                    <Icon name={done ? 'check-circle' : 'x-circle'} size={14} />
                    {done ? S.answered : S.unanswered}
                  </span>
                  {flag && <Icon name="bookmark" size={14} className="ex-final__flag" />}
                </button>
              );
            })}
          </div>
          {!allowBack && <p className="ex-card__sub" style={{ marginTop: 8 }}>{S.lockedHint}</p>}

          {missing.length > 0 ? (
            <div className="ex-note ex-note--warn" style={{ marginTop: 16 }}>
              <Icon name="alert-triangle" size={16} />
              <div><strong>{S.missingTitle}</strong><br />{S.missingBody} {missing.join('، ')}</div>
            </div>
          ) : (
            <div className="ex-note ex-note--good" style={{ marginTop: 16 }}>
              <Icon name="check-circle" size={16} /><div>{S.allDone}</div>
            </div>
          )}
          {flaggedNums.length > 0 && (
            <div className="ex-note" style={{ marginTop: 10 }}>
              <Icon name="bookmark" size={16} /><div>{S.flaggedBody} {flaggedNums.join('، ')}</div>
            </div>
          )}
          {submitError && <div className="ex-note ex-note--bad" style={{ marginTop: 10 }}><Icon name="alert-triangle" size={16} /><div>{submitError}</div></div>}

          <div className="ex-footer">
            <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => setReviewing(false)}>
              <Icon name="arrow-left" size={14} className="icon-flip" /> {S.backToExam}
            </button>
            <div className="ex-footer__right">
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => setConfirming(true)}>
                {S.submitFinal}
              </button>
            </div>
          </div>
        </div>

        {confirming && (
          <div className="ex-modal-scrim" role="presentation">
            <div className="ex-modal" role="alertdialog" aria-modal="true" aria-labelledby="ex-confirm-title">
              <h3 id="ex-confirm-title">{S.confirmTitle}</h3>
              <p>{S.confirmBody}</p>
              {missing.length > 0 && <p className="ex-modal__warn">{S.confirmMissing(missing.length)}</p>}
              <div className="ex-modal__actions">
                <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => setConfirming(false)}>{S.confirmCancel}</button>
                <button type="button" className="btn btn-primary" disabled={submitting} onClick={doSubmit}>
                  {submitting ? S.submitting : S.confirmYes}
                </button>
              </div>
            </div>
          </div>
        )}

        {fsBlocked && <FullscreenOverlay S={S} onReturn={handleEnterSecureMode} />}
      {devtoolsOpen && <DevtoolsOverlay S={S} />}
      {cameraUi}
      </div>
    );
  }

  // ================== Question screen ==================
  const isFlagged = q ? flagged.includes(q.exam_question_id) : false;

  return (
    <div className="ex-page ex-page--narrow" style={{ paddingBottom: 'var(--space-6)' }}>
      {header}
      {inGrace && (
        <div className="st-alert st-alert--warning" role="alert">
          <Icon name="clock" size={16} />
          <span>{S.graceBanner(latePenalty)}</span>
        </div>
      )}

      {submitError && <div className="ex-note ex-note--bad"><Icon name="alert-triangle" size={16} /><div>{submitError}</div></div>}

      {idx === 0 && attempt.exam.instructions && (
        <div className="ex-note"><Icon name="info" size={16} /><div style={{ whiteSpace: 'pre-wrap' }}>{attempt.exam.instructions}</div></div>
      )}

      <div className="ex-palette" role="group" aria-label={t('Question')}>
        {questions.map((x, n) => (
          <button
            key={x.exam_question_id}
            type="button"
            className={`ex-palette__dot${n === idx ? ' is-current' : ''}${isAnswered(x) ? ' is-answered' : ''}${flagged.includes(x.exam_question_id) ? ' is-flagged' : ''}`}
            disabled={!allowBack && n < idx}
            onClick={() => goTo(n)}
            aria-label={`${t('Question')} ${n + 1}`}
            aria-current={n === idx ? 'step' : undefined}
          >{n + 1}</button>
        ))}
      </div>

      {q && (
        <div className="ex-card ex-card__pad">
          <div className="ex-q__top" style={{ marginBottom: 6 }}>
            <span className="ex-q__no">{t('Question')} <bdi dir="ltr">{idx + 1} / {questions.length}</bdi></span>
            <span>·</span>
            <span>{t(TYPE_LABELS[q.type] || q.type)}</span>
            <span>·</span>
            <span><bdi dir="ltr">{q.marks}</bdi> {t('Marks')}</span>
            <span className="ex-q__tools">
              <button
                type="button"
                className={`ex-flag-btn${isFlagged ? ' is-on' : ''}`}
                onClick={() => toggleFlag(q.exam_question_id)}
                aria-pressed={isFlagged}
              >
                <Icon name="bookmark" size={14} /> {isFlagged ? S.unflag : S.flag}
              </button>
              <span className={`ex-status ${isAnswered(q) ? 'ex-status--graded' : 'ex-status--idle'}`}>{isAnswered(q) ? t('Answered') : t('Not answered')}</span>
            </span>
          </div>

          <p className="ex-q__prompt" dir="auto" style={{ fontSize: 16 }}>{q.prompt}</p>
          <QuestionImage url={q.image_url} maxHeight={420} inline />

          {(q.type === 'mcq' || q.type === 'true_false' || q.type === 'multi_select') && (
            <div className="ex-opts">
              {(q.options || []).map((opt) => {
                const multi = q.type === 'multi_select';
                const checked = q.type === 'true_false'
                  ? String(q.my_answer?.answer_text ?? '').trim().toLowerCase() === String(opt.id)
                  : (q.my_answer?.selected_option_ids || []).includes(opt.id);
                return (
                  <label key={opt.id} className={`ex-choice${checked ? ' is-selected' : ''}`}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`q-${q.exam_question_id}`}
                      checked={checked}
                      onChange={() => handleOptionChange(q, opt.id, multi)}
                    />
                    <span dir="auto" className="ex-choice__text">{q.type === 'true_false' ? t(opt.option_text) : opt.option_text}</span>
                  </label>
                );
              })}
            </div>
          )}

          {(q.type === 'short_answer' || q.type === 'essay') && (
            <textarea
              className="ex-textarea"
              dir="auto"
              rows={q.type === 'essay' ? 10 : 4}
              placeholder={t('Write your answer here…')}
              value={q.my_answer?.answer_text || ''}
              onChange={(e) => handleTextChange(q, e.target.value)}
            />
          )}

          <p className="ex-card__sub" style={{ marginTop: 10, minHeight: 18, color: state === 'error' ? 'var(--color-danger)' : undefined }}>
            {state === 'saving' && t('Saving…')}
            {state === 'saved' && t('Saved')}
            {state === 'error' && t('Save failed — will retry')}
          </p>

          <div className="ex-footer">
            {allowBack ? (
              <button type="button" className="btn btn-outline" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
                <Icon name="arrow-left" size={14} className="icon-flip" /> {S.prev}
              </button>
            ) : <span className="ex-card__sub">{S.noBack}</span>}
            <div className="ex-footer__right">
              {idx < last ? (
                <button type="button" className="btn btn-primary" onClick={() => goTo(idx + 1)}>
                  {S.next} <Icon name="arrow-right" size={14} className="icon-flip" />
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={openReview}>
                  {S.reviewSubmit}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {idx < last && (
        <div style={{ textAlign: 'end' }}>
          <button type="button" className="ex-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={openReview}>{S.reviewSubmit}</button>
        </div>
      )}

      {fsBlocked && <FullscreenOverlay S={S} onReturn={handleEnterSecureMode} />}
      {devtoolsOpen && <DevtoolsOverlay S={S} />}
      {cameraUi}
    </div>
  );
}

/** Covers the whole exam while developer tools are open — nothing is readable until they are closed. */
function DevtoolsOverlay({ S }) {
  return (
    <div className="ex-fs-overlay" style={{ zIndex: 10001 }} role="alertdialog" aria-modal="true" aria-labelledby="ex-dt-title">
      <div className="ex-fs-overlay__box">
        <Icon name="lock" size={34} />
        <h2 id="ex-dt-title">{S.dtTitle}</h2>
        <p>{S.dtBody}</p>
      </div>
    </div>
  );
}

/** Covers the whole exam when fullscreen was left in secure mode — nothing is readable or clickable until the student returns. */
function FullscreenOverlay({ S, onReturn }) {
  return (
    <div className="ex-fs-overlay" role="alertdialog" aria-modal="true" aria-labelledby="ex-fs-title">
      <div className="ex-fs-overlay__box">
        <Icon name="lock" size={34} />
        <h2 id="ex-fs-title">{S.fsTitle}</h2>
        <p>{S.fsBody}</p>
        <button type="button" className="btn btn-primary" onClick={onReturn}>{S.fsBtn}</button>
      </div>
    </div>
  );
}
