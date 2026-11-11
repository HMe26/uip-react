import Icon from '../Icon';

/**
 * Presentational helpers shared by the redesigned Exams pages (Academic Staff +
 * Student). Styles: styles/css/exam-portal.css (`ex-*`, token-driven, so they
 * follow whichever portal shell they render in).
 */

export const EXAM_TYPES = [
  { key: 'midterm', en: 'Midterm', ar: 'نصفي' },
  { key: 'final', en: 'Final', ar: 'نهائي' },
  { key: 'quiz', en: 'Quiz', ar: 'اختبار قصير' },
  { key: 'practice', en: 'Practice', ar: 'تدريبي' },
];

export const examTypeLabel = (key, ar) => {
  const m = EXAM_TYPES.find((x) => x.key === key);
  return m ? (ar ? m.ar : m.en) : (key || '—');
};

export const QUESTION_TYPES = {
  mcq: { en: 'Multiple choice', ar: 'اختيار من متعدد', short: { en: 'MCQ', ar: 'اختيار' } },
  multi_select: { en: 'Multi-select', ar: 'اختيار متعدد', short: { en: 'Multi', ar: 'متعدد' } },
  true_false: { en: 'True / False', ar: 'صح / خطأ', short: { en: 'True/False', ar: 'صح/خطأ' } },
  short_answer: { en: 'Short answer', ar: 'إجابة قصيرة', short: { en: 'Short answer', ar: 'قصيرة' } },
  essay: { en: 'Essay', ar: 'مقالي', short: { en: 'Essay', ar: 'مقالي' } },
};

export const questionTypeLabel = (type, ar, short = false) => {
  const m = QUESTION_TYPES[type];
  if (!m) return type || '';
  const v = short ? m.short : m;
  return ar ? v.ar : v.en;
};

/* ---- Dates ------------------------------------------------------------------------- */
/**
 * The API stores and returns UTC. Values normally arrive as ISO with "Z"; a naive
 * "YYYY-MM-DD HH:MM:SS" (raw DB value) is UTC too, so tag it explicitly — otherwise the
 * browser would read it as local time and every exam time would shift by the UTC offset.
 */
const parse = (iso) => {
  if (!iso) return null;
  let s = String(iso).trim().replace(' ', 'T');
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const loc = (ar) => (ar ? 'ar-EG' : 'en-US');
export const toDate = parse;
export const fmtDate = (iso, ar) => {
  const d = parse(iso);
  return d ? d.toLocaleDateString(loc(ar), { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
};
export const fmtTime = (iso, ar) => {
  const d = parse(iso);
  return d ? d.toLocaleTimeString(loc(ar), { hour: '2-digit', minute: '2-digit' }) : '—';
};
export const fmtDateTime = (iso, ar) => {
  const d = parse(iso);
  return d ? `${fmtDate(iso, ar)} · ${fmtTime(iso, ar)}` : '—';
};
export const fmtNum = (n, digits = 1) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(digits).replace(/\.0+$/, '');
};

/** yyyy-mm-dd / HH:MM parts for <input type=date|time> from an ISO/SQL datetime. */
export const dateInput = (iso) => {
  const d = parse(iso);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const timeInput = (iso) => {
  const d = parse(iso);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
/**
 * Combine the date + time inputs (the user's LOCAL wall-clock time) into a UTC instant
 * ("2026-09-15T06:00:00.000Z") so the server stores the exact moment the doctor meant,
 * whatever timezone the server runs in. '' → null.
 */
export const combineDateTime = (date, time) => {
  if (!date) return null;
  const d = new Date(`${date}T${time || '00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/* ---- Exam phase (what the design calls Draft / Scheduled / Live / Completed) ------------ */
export const PHASES = {
  draft: { en: 'Draft', ar: 'مسودة' },
  scheduled: { en: 'Scheduled', ar: 'مجدول' },
  live: { en: 'Live', ar: 'جارٍ' },
  completed: { en: 'Completed', ar: 'مكتمل' },
};

/**
 * Raw statuses (draft, scheduled, published, active, closed, grading, graded,
 * archived) + the exam window → the four design phases. A published exam whose
 * window hasn't opened yet reads as Scheduled; one whose window closed reads as
 * Completed, even if the backend status wasn't flipped to closed yet.
 */
export function examPhase(exam, now = new Date()) {
  const s = exam?.status;
  if (s === 'draft') return 'draft';
  if (['closed', 'grading', 'graded', 'archived'].includes(s)) return 'completed';
  const start = parse(exam?.start_at);
  const end = parse(exam?.end_at);
  if (end && end < now) return 'completed';
  if (s === 'scheduled' || (start && start > now)) return 'scheduled';
  return 'live';
}

export function PhasePill({ phase, ar }) {
  const m = PHASES[phase] || PHASES.draft;
  return <span className={`ex-status ex-status--${phase}`}>{ar ? m.ar : m.en}</span>;
}

/** Student-side status of one attempt / one exam. */
export const ATTEMPT_STATUS = {
  in_progress: { cls: 'progress', en: 'In progress', ar: 'جارٍ' },
  submitted: { cls: 'submitted', en: 'Submitted', ar: 'تم التسليم' },
  auto_submitted: { cls: 'submitted', en: 'Auto-submitted', ar: 'تسليم تلقائي' },
  grading: { cls: 'scheduled', en: 'Grading', ar: 'قيد التصحيح' },
  graded: { cls: 'graded', en: 'Graded', ar: 'تم التصحيح' },
  expired: { cls: 'idle', en: 'Expired', ar: 'منتهي' },
  cancelled: { cls: 'idle', en: 'Cancelled', ar: 'ملغي' },
  not_started: { cls: 'idle', en: 'Not started', ar: 'لم يبدأ' },
};

export function AttemptPill({ status, ar }) {
  const m = ATTEMPT_STATUS[status] || ATTEMPT_STATUS.not_started;
  return <span className={`ex-status ex-status--${m.cls}`}>{ar ? m.ar : m.en}</span>;
}

/* ---- Small building blocks --------------------------------------------------------------- */
export function ExKpi({ label, value, sub, icon, tone = '' }) {
  return (
    <div className="ex-kpi">
      <div>
        <div className="ex-kpi__label">{label}</div>
        <div className="ex-kpi__value">{value}</div>
        {sub && <div className="ex-kpi__sub">{sub}</div>}
      </div>
      {icon && <span className={`ex-kpi__icon${tone ? ` ex-kpi__icon--${tone}` : ''}`}><Icon name={icon} size={18} /></span>}
    </div>
  );
}

/** Accessible on/off switch row. */
export function ToggleRow({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="ex-toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label}
        className="ex-switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Segmented({ options, value, onChange, ar, label }) {
  return (
    <div className="ex-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {ar ? o.ar : o.en}
        </button>
      ))}
    </div>
  );
}

/** conic-gradient ring: slices = [{ value, color }]. */
export function ringStyle(slices) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (!total) return { background: 'var(--bg-muted)' };
  let acc = 0;
  const stops = slices.map((s) => {
    const from = (acc / total) * 100;
    acc += s.value;
    return `${s.color} ${from}% ${(acc / total) * 100}%`;
  });
  return { background: `conic-gradient(${stops.join(', ')})` };
}

export function Note({ tone = '', icon = 'info', children }) {
  return (
    <div className={`ex-note${tone ? ` ex-note--${tone}` : ''}`}>
      <Icon name={icon} size={16} />
      <div>{children}</div>
    </div>
  );
}
