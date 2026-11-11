import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis } from './acKit';
import { Field, FormModal, FormSection } from '../people/formUi';

/**
 * جدول المحاضرات (Study Time Table).
 * Backend: GET /api/v1/courses/timetable (role-aware), POST/PATCH/DELETE /api/v1/courses/{id}/sessions.
 *  - Student: read-only weekly view of the courses they are enrolled in; overlapping sessions are flagged.
 *  - Doctor / TA / faculty / university: weekly view of the courses they manage + add / edit / delete
 *    (the API decides per row via `can_edit`; room and teacher double-booking is rejected by the server).
 * Days are ISO numbers (1 = Monday … 7 = Sunday); the week is shown Saturday → Friday.
 */

const WEEK = [6, 7, 1, 2, 3, 4, 5];
const DAY = {
  1: { ar: 'الاثنين', en: 'Monday' }, 2: { ar: 'الثلاثاء', en: 'Tuesday' }, 3: { ar: 'الأربعاء', en: 'Wednesday' },
  4: { ar: 'الخميس', en: 'Thursday' }, 5: { ar: 'الجمعة', en: 'Friday' }, 6: { ar: 'السبت', en: 'Saturday' }, 7: { ar: 'الأحد', en: 'Sunday' },
};
export const SESSION_KINDS = [
  { key: 'lecture', ar: 'محاضرة', en: 'Lecture' },
  { key: 'section', ar: 'سكشن', en: 'Section' },
  { key: 'lab', ar: 'معمل', en: 'Lab' },
  { key: 'tutorial', ar: 'تمرين', en: 'Tutorial' },
];
const kindLabel = (k, ar) => { const m = SESSION_KINDS.find((x) => x.key === k); return m ? (ar ? m.ar : m.en) : k; };

const todayIso = () => { const d = new Date().getDay(); return d === 0 ? 7 : d; };
const toMin = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + m; };
const fmtHours = (mins, ar) => {
  const h = Math.floor(mins / 60); const m = mins % 60;
  if (!m) return ar ? `${h} ساعة` : `${h} h`;
  return ar ? `${h}س ${m}د` : `${h}h ${m}m`;
};

export default function CourseTimetable({ role }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const isStudent = role === 'student';

  const [sessions, setSessions] = useState([]);
  const [courses, setCourses] = useState([]); // manageable courses (staff roles) for the add dialog
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [courseFilter, setCourseFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [dialog, setDialog] = useState(null); // { session? } — null = closed
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const calls = [api.get('/api/v1/courses/timetable', { locale }).then((j) => setSessions(j.data?.sessions || []))];
    if (!isStudent) {
      calls.push(api.get('/api/v1/courses', { locale }).then((j) => setCourses((j.data || []).filter((c) => c.can_manage && c.status === 'active'))));
    }
    await Promise.all(calls);
  }, [locale, isStudent]);

  useEffect(() => {
    setLoading(true);
    load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [load]);

  const courseOptions = useMemo(() => {
    const m = new Map();
    sessions.forEach((s) => m.set(s.course.id, s.course));
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [sessions]);

  const shown = useMemo(() => sessions.filter((s) => (!courseFilter || String(s.course.id) === courseFilter) && (!kindFilter || s.kind === kindFilter)), [sessions, courseFilter, kindFilter]);

  const byDay = useMemo(() => {
    const m = {};
    WEEK.forEach((d) => { m[d] = []; });
    shown.forEach((s) => { (m[s.day_of_week] || (m[s.day_of_week] = [])).push(s); });
    Object.values(m).forEach((arr) => arr.sort((a, b) => a.start_time.localeCompare(b.start_time)));
    return m;
  }, [shown]);

  const weeklyMinutes = useMemo(() => shown.reduce((a, s) => a + Math.max(0, toMin(s.end_time) - toMin(s.start_time)), 0), [shown]);
  const clashCount = useMemo(() => shown.filter((s) => (s.clashes_with || []).length).length, [shown]);
  const activeDays = WEEK.filter((d) => byDay[d].length).length;

  async function remove(s) {
    if (!window.confirm(ar ? 'حذف هذه الحصة من الجدول؟ سيتم إشعار الطلاب.' : 'Delete this session from the timetable? Students will be notified.')) return;
    setBusyId(s.id);
    setError(null);
    setNotice(null);
    try {
      const j = await api.del(`/api/v1/courses/${s.course_id}/sessions/${s.id}`, { locale });
      setNotice(j.message);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const today = todayIso();

  return (
    <AcPage>
      <AcHead
        title={ar ? 'جدول المحاضرات' : 'Study Time Table'}
        text={isStudent
          ? (ar ? 'مواعيد محاضراتك وسكاشنك الأسبوعية للمواد المسجّل بها.' : 'Your weekly lectures and sections for the courses you are enrolled in.')
          : (ar ? 'الجدول الأسبوعي للمواد التي تديرها. يُمنع تعارض القاعة أو عضو هيئة التدريس.' : 'The weekly schedule of the courses you manage. Room and teacher double-booking is blocked.')}
      >
        <button type="button" className="btn btn-outline" onClick={() => window.print()}><Icon name="download" size={14} /> {ar ? 'طباعة' : 'Print'}</button>
        {!isStudent && (
          <button type="button" className="btn btn-primary" disabled={!courses.length} onClick={() => setDialog({})}>
            <Icon name="plus" size={14} /> {ar ? 'إضافة حصة' : 'Add session'}
          </button>
        )}
      </AcHead>

      <AcAlerts error={error} notice={notice} />

      <AcKpis items={[
        { label: ar ? 'عدد الحصص' : 'Sessions', value: shown.length, icon: 'calendar', meta: ar ? 'في الأسبوع' : 'per week' },
        { label: ar ? 'ساعات أسبوعيًا' : 'Hours / week', value: fmtHours(weeklyMinutes, ar), icon: 'clock', tone: 'good' },
        { label: ar ? 'أيام الدراسة' : 'Study days', value: activeDays, icon: 'layers' },
        ...(isStudent ? [{ label: ar ? 'تعارضات' : 'Clashes', value: clashCount, icon: 'alert-triangle', tone: clashCount ? 'bad' : 'good', meta: clashCount ? (ar ? 'حصص متداخلة' : 'overlapping sessions') : (ar ? 'لا يوجد' : 'none') }] : []),
      ]} />

      <section className="acx-panel">
        <div className="acx-toolbar">
          <select className="acx-input" style={{ flex: '0 1 260px' }} value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} aria-label={ar ? 'المادة' : 'Course'}>
            <option value="">{ar ? 'كل المواد' : 'All courses'}</option>
            {courseOptions.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
          <select className="acx-input" style={{ flex: '0 1 260px' }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label={ar ? 'النوع' : 'Type'}>
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {SESSION_KINDS.map((k) => <option key={k.key} value={k.key}>{ar ? k.ar : k.en}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="acx-panel__body"><Skeleton h={120} count={3} /></div>
        ) : !sessions.length ? (
          <EmptyState
            icon="calendar"
            title={ar ? 'لا توجد حصص في الجدول بعد' : 'No sessions in the timetable yet'}
            text={isStudent
              ? (ar ? 'سيظهر جدولك هنا عندما يضيف مدرّسو موادك المواعيد، أو بعد تسجيلك في مواد.' : 'Your timetable appears here once your course staff add the schedule, or after you enrol in courses.')
              : (ar ? 'ابدأ بإضافة أول حصة لإحدى موادك.' : 'Start by adding the first session for one of your courses.')}
          />
        ) : (
          <div className="tt-week">
            {WEEK.map((d) => (
              <section key={d} className={`tt-day${d === today ? ' is-today' : ''}`} aria-label={ar ? DAY[d].ar : DAY[d].en}>
                <div className="tt-day__head">
                  <span>{ar ? DAY[d].ar : DAY[d].en}</span>
                  {d === today && <small>{ar ? 'اليوم' : 'Today'}</small>}
                </div>
                {byDay[d].length === 0 && <div className="tt-day__empty">{ar ? 'لا محاضرات' : 'No classes'}</div>}
                {byDay[d].map((s) => (
                  <article key={s.id} className={`tt-card tt-card--${s.kind}${(s.clashes_with || []).length ? ' has-clash' : ''}`}>
                    <div className="tt-card__time">{s.start_time} – {s.end_time}</div>
                    <div className="tt-card__code">{s.course.code}</div>
                    <div className="tt-card__title">{s.course.name}</div>
                    <span className="tt-card__kind">{kindLabel(s.kind, ar)}{s.group_label ? ` · ${s.group_label}` : ''}</span>
                    {s.room && <div className="tt-card__meta"><Icon name="building" size={12} /> <bdi>{s.room}</bdi></div>}
                    {s.staff_name && <div className="tt-card__meta"><Icon name="user" size={12} /> <bdi>{s.staff_name}</bdi></div>}
                    {(s.starts_on || s.ends_on) && (
                      <div className="tt-card__meta"><Icon name="calendar" size={12} /> <bdi>{s.starts_on || '…'} → {s.ends_on || '…'}</bdi></div>
                    )}
                    {s.notes && <div className="tt-card__meta">{s.notes}</div>}
                    {(s.clashes_with || []).length > 0 && (
                      <div className="tt-card__clash"><Icon name="alert-triangle" size={12} /> {ar ? 'تعارض مع حصة أخرى' : 'Overlaps another session'}</div>
                    )}
                    {s.can_edit && (
                      <div className="tt-card__actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ session: s })}><Icon name="edit" size={13} /> {ar ? 'تعديل' : 'Edit'}</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === s.id} onClick={() => remove(s)}><Icon name="trash" size={13} /> {ar ? 'حذف' : 'Delete'}</button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </section>

      {dialog && (
        <SessionDialog
          session={dialog.session}
          courses={courses}
          defaultCourseId={courseFilter ? Number(courseFilter) : null}
          onClose={() => setDialog(null)}
          onDone={async (msg) => { setDialog(null); setNotice(msg); setError(null); try { await load(); } catch (e) { setError(errorMessage(e)); } }}
        />
      )}
    </AcPage>
  );
}

/* ------------------------------------------------------------------------------------------ */

function SessionDialog({ session, courses, defaultCourseId, onClose, onDone }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const editing = !!session;

  const [courseId, setCourseId] = useState(session ? session.course_id : (defaultCourseId && courses.some((c) => c.id === defaultCourseId) ? defaultCourseId : (courses[0]?.id ?? '')));
  const [kind, setKind] = useState(session?.kind || 'lecture');
  const [day, setDay] = useState(session?.day_of_week || 6);
  const [start, setStart] = useState(session?.start_time || '09:00');
  const [end, setEnd] = useState(session?.end_time || '10:30');
  const [room, setRoom] = useState(session?.room || '');
  const [group, setGroup] = useState(session?.group_label || '');
  const [staffId, setStaffId] = useState(session?.staff_id || '');
  const [startsOn, setStartsOn] = useState(session?.starts_on || '');
  const [endsOn, setEndsOn] = useState(session?.ends_on || '');
  const [notes, setNotes] = useState(session?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const course = courses.find((c) => c.id === Number(courseId));
  const staffOptions = course?.staff || [];

  function clientCheck() {
    if (!courseId) return ar ? 'اختر المادة.' : 'Choose a course.';
    if (!start || !end) return ar ? 'حدّد وقت البداية والنهاية.' : 'Set the start and end time.';
    if (toMin(end) <= toMin(start)) return ar ? 'وقت النهاية لازم يكون بعد وقت البداية.' : 'End time must be after the start time.';
    if (startsOn && endsOn && endsOn < startsOn) return ar ? 'تاريخ النهاية قبل تاريخ البداية.' : 'The end date is before the start date.';
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    const bad = clientCheck();
    if (bad) { setError(bad); return; }
    setSaving(true);
    setError(null);
    const body = {
      locale, kind, day_of_week: Number(day), start_time: start, end_time: end,
      room: room.trim() || null, group_label: group.trim() || null,
      academic_staff_id: staffId ? Number(staffId) : null,
      starts_on: startsOn || null, ends_on: endsOn || null, notes: notes.trim() || null,
    };
    try {
      const j = editing
        ? await api.patch(`/api/v1/courses/${session.course_id}/sessions/${session.id}`, body)
        : await api.post(`/api/v1/courses/${courseId}/sessions`, body);
      onDone(j?.message || (ar ? 'تم الحفظ.' : 'Saved.'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      title={editing ? (ar ? 'تعديل حصة' : 'Edit session') : (ar ? 'إضافة حصة للجدول' : 'Add timetable session')}
      subtitle={ar ? 'سيتم إشعار الطلاب المسجّلين بالمادة.' : 'Enrolled students will be notified.'}
      icon="calendar"
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      submitLabel={editing ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إضافة' : 'Add')}
      error={error}
    >
      <FormSection title={ar ? 'المادة والنوع' : 'Course & type'}>
        <Field label={ar ? 'المادة' : 'Course'} required wide>
          <select className="form-input" value={courseId} disabled={editing} onChange={(e) => { setCourseId(e.target.value); setStaffId(''); }}>
            {editing && !course && <option value={session.course_id}>{session.course.code} — {session.course.name}</option>}
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </Field>
        <Field label={ar ? 'نوع الحصة' : 'Session type'}>
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {SESSION_KINDS.map((k) => <option key={k.key} value={k.key}>{ar ? k.ar : k.en}</option>)}
          </select>
        </Field>
        <Field label={ar ? 'المجموعة / السكشن (اختياري)' : 'Group / section (optional)'}>
          <input className="form-input" value={group} maxLength={60} onChange={(e) => setGroup(e.target.value)} placeholder={ar ? 'مثال: سكشن 2' : 'e.g. Section 2'} />
        </Field>
      </FormSection>

      <FormSection title={ar ? 'الموعد' : 'Schedule'}>
        <Field label={ar ? 'اليوم' : 'Day'} required wide>
          <div className="tt-days" role="radiogroup" aria-label={ar ? 'اليوم' : 'Day'}>
            {WEEK.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={day === d} className={day === d ? 'is-on' : ''} onClick={() => setDay(d)}>{ar ? DAY[d].ar : DAY[d].en}</button>
            ))}
          </div>
        </Field>
        <Field label={ar ? 'من' : 'From'} required>
          <input className="form-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={ar ? 'إلى' : 'To'} required>
          <input className="form-input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label={ar ? 'القاعة / المعمل' : 'Room / lab'}>
          <input className="form-input" value={room} maxLength={120} onChange={(e) => setRoom(e.target.value)} placeholder={ar ? 'مثال: قاعة 204' : 'e.g. Hall 204'} />
        </Field>
        <Field label={ar ? 'عضو هيئة التدريس' : 'Teacher'}>
          <select className="form-input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">{ar ? '— غير محدد —' : '— Not set —'}</option>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </Field>
      </FormSection>

      <FormSection title={ar ? 'اختياري' : 'Optional'} hint={ar ? 'اترك التواريخ فارغة لتسري الحصة طوال الفصل.' : 'Leave the dates empty to run all semester.'}>
        <Field label={ar ? 'تبدأ في' : 'Starts on'}>
          <input className="form-input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label={ar ? 'تنتهي في' : 'Ends on'}>
          <input className="form-input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
        <Field label={ar ? 'ملاحظات' : 'Notes'} wide>
          <textarea className="form-input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </FormSection>
    </FormModal>
  );
}
