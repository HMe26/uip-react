import { Fragment, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';
import { downloadAuthed } from '../../lib/download';

/**
 * كشف الدرجات والـ GPA (الطالب): النتايج المنشورة بس، لكل فصل وتراكمي + تفاصيل مكوّنات كل مادة + PDF.
 * Backend: GET /api/v1/grading/transcript · GET /api/v1/grading/transcript/pdf.
 */

const TYPE = { exam: ['امتحان', 'Exam'], assignment: ['تكليف', 'Assignment'], attendance: ['حضور', 'Attendance'], manual: ['أعمال فصلية', 'Coursework'] };

export default function StudentGrades() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get('/api/v1/grading/transcript', { locale }).then((j) => setData(j.data)).catch((e) => setError(errorMessage(e)));
  }, [locale]);

  const cum = data?.cumulative;

  return (
    <AcPage>
      <AcHead
        title={ar ? 'كشف الدرجات والمعدل' : 'Grades & GPA'}
        text={ar ? 'نتايج موادك بعد ما يتم نشرها، والمعدل لكل فصل وتراكمي.' : 'Your published course results with term and cumulative GPA.'}
      >
        <button type="button" className="btn btn-outline" disabled={!cum?.courses} onClick={() => downloadAuthed('/api/v1/grading/transcript/pdf', 'transcript.pdf', { locale }).catch((e) => setError(errorMessage(e)))}>
          <Icon name="download" size={14} /> {ar ? 'تحميل PDF' : 'Download PDF'}
        </button>
      </AcHead>

      <AcAlerts error={error} />
      {!data && !error ? <Skeleton h={100} count={3} /> : data && (
        <>
          <AcKpis items={[
            { label: ar ? 'المعدل التراكمي' : 'Cumulative GPA', value: cum.gpa ?? '—', icon: 'award', tone: 'good' },
            { label: ar ? 'الساعات المسجّلة' : 'Attempted hours', value: cum.attempted_hours, icon: 'layers' },
            { label: ar ? 'الساعات المنجزة' : 'Earned hours', value: cum.earned_hours, icon: 'check-circle' },
            { label: ar ? 'مواد ظاهرة نتيجتها' : 'Graded courses', value: cum.courses, icon: 'file' },
          ]} />

          {data.terms.length === 0 ? (
            <EmptyState icon="award" title={ar ? 'لا توجد نتائج منشورة بعد' : 'No published results yet'} />
          ) : data.terms.map((t) => (
            <AcPanel
              key={`${t.academic_year}-${t.semester}`}
              flush
              title={`${t.academic_year ? `${ar ? 'السنة' : 'Year'} ${t.academic_year}` : (ar ? 'مواد أخرى' : 'Other courses')}${t.semester ? ` — ${ar ? 'الترم' : 'Semester'} ${t.semester}` : ''}`}
              tools={<AcNums inline items={[[ar ? 'معدل الفصل' : 'Term GPA', t.gpa ?? '—'], [ar ? 'التراكمي' : 'Cumulative', t.cumulative_gpa ?? '—'], [ar ? 'الساعات' : 'Hours', t.attempted_hours]]} />}
            >
              <AcTable>
                <thead><tr><th>{ar ? 'الكود' : 'Code'}</th><th>{ar ? 'المادة' : 'Course'}</th><th>{ar ? 'الساعات' : 'Hours'}</th><th>%</th><th>{ar ? 'التقدير' : 'Grade'}</th><th>{ar ? 'النقاط' : 'Points'}</th><th /></tr></thead>
                <tbody>
                  {t.courses.map((c) => (
                    <Fragment key={c.course_id}>
                      <tr>
                        <td dir="ltr" className="is-num">{c.code}</td>
                        <td>{c.name}{!c.counted && <span className="acx-sub">{ar ? 'بدون ساعات — خارج المعدل' : 'No hours — excluded from GPA'}</span>}</td>
                        <td className="is-num">{c.credit_hours ?? '—'}</td><td className="is-num">{c.percentage}</td>
                        <td>
                          <span className={`st-pill st-pill--${c.is_fail ? 'danger' : 'success'}`}>{c.letter}</span>
                          {c.deprived && <span className="acx-sub">{ar ? 'محروم' : 'Deprived'}</span>}
                        </td>
                        <td className="is-num">{c.grade_points.toFixed(2)}</td>
                        <td className="is-end"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(open === c.course_id ? null : c.course_id)}>{open === c.course_id ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'التفاصيل' : 'Details')}</button></td>
                      </tr>
                      {open === c.course_id && (
                        <tr className="is-detail"><td colSpan={7}>
                          <AcNums inline items={(c.breakdown || []).map((b) => [`${TYPE[b.type]?.[ar ? 0 : 1] || b.type} · ${b.title}`, `${b.points} / ${b.weight}${b.percentage != null ? ` (${b.percentage}%)` : ''}`])} />
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </AcTable>
            </AcPanel>
          ))}

          {data.in_progress.length > 0 && (
            <AcPanel title={ar ? 'مواد لم تظهر نتيجتها بعد' : 'Results pending'}>
              <AcNums inline items={data.in_progress.map((c) => [c.code, c.name])} />
            </AcPanel>
          )}

          <AcPanel title={ar ? 'نظام التقديرات المعتمد' : 'Grading scale'}>
            <AcNums inline items={data.scale.bands.map((b) => [b.letter, `≥ ${b.min_percent}% = ${b.points.toFixed(2)}`])} />
          </AcPanel>
        </>
      )}
    </AcPage>
  );
}
