import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { printPage } from '../../native';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nPage from '../../i18n/student/graduation-transcript';

/**
 * Mirrors app/Views/student/graduation-transcript.php — a standalone,
 * printer-friendly page (no sidebar/header), same convention as
 * security/logs-print.php. Data comes from GET /api/v1/graduation/{studentId}
 * (App\Controllers\Api\GraduationApiController::show(), returning
 * GraduationService::transcriptFor() exactly as
 * Student\StudentGraduationController::transcript() does). studentId is
 * resolved from the caller's own eligibility record via GET
 * /api/v1/graduation first, since a student can only ever view their own.
 */
export default function StudentGraduationTranscript() {
  const t = useTranslations(i18nPage);
  const { locale } = useLanguage();

  const [student, setStudent] = useState(null);
  const [grades, setGrades] = useState([]);
  const [graduation, setGraduation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/graduation')
      .then((eligJson) => {
        const studentId = eligJson.data?.student?.id;
        if (!studentId) throw new Error(locale === 'ar' ? 'لم يتم العثور على بيانات الطالب.' : 'Student record not found.');
        return api.get(`/api/v1/graduation/${studentId}`);
      })
      .then((json) => {
        if (cancelled) return;
        setStudent(json.data.transcript?.student ?? null);
        setGrades(json.data.transcript?.grades ?? []);
        setGraduation(json.data.transcript?.graduation ?? null);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';

  const styles = {
    body: { fontFamily: 'Arial, Tahoma, sans-serif', margin: 32, color: '#111', direction: dir },
    h1: { fontSize: 20, marginBottom: 2 },
    h2: { fontSize: 14, margin: '24px 0 8px', borderBottom: '1px solid #ccc', paddingBottom: 4 },
    meta: { color: '#555', fontSize: 12, marginBottom: 20 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: { border: '1px solid #ccc', padding: '6px 8px', textAlign: align, background: '#f2f2f2' },
    td: { border: '1px solid #ccc', padding: '6px 8px', textAlign: align },
    field: { marginBottom: 4, fontSize: 13 },
    fieldLabel: { display: 'inline-block', minWidth: 160 },
    toolbar: { marginBottom: 20 },
  };

  if (loading) {
    return <div style={styles.body}>{locale === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  }

  return (
    <div style={styles.body} dir={dir}>
      <div className="no-print" style={styles.toolbar}>
        <button type="button" onClick={() => printPage({ name: 'Transcript' })} style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>
          {t('Print')}
        </button>
      </div>

      <h1 style={styles.h1}>{t('Academic Transcript')}</h1>
      <p style={styles.meta}>{t('Issued')}: {new Date().toISOString().slice(0, 16).replace('T', ' ')}</p>

      {error || !student ? (
        <p>{t('Student data could not be found.')}</p>
      ) : (
        <>
          <h2 style={styles.h2}>{t('Student Information')}</h2>
          <div style={styles.field}><strong style={styles.fieldLabel}>{t('Name')}:</strong> {student.full_name || '—'}</div>
          <div style={styles.field}><strong style={styles.fieldLabel}>{t('Student number')}:</strong> {student.student_number || '—'}</div>
          <div style={styles.field}>
            <strong style={styles.fieldLabel}>{t('Faculty')}:</strong>{' '}
            {(locale === 'ar' ? student.faculty_name_ar : student.faculty_name_en) || student.faculty || '—'}
          </div>
          <div style={styles.field}>
            <strong style={styles.fieldLabel}>{t('Department')}:</strong>{' '}
            {(locale === 'ar' ? student.department_name_ar : student.department_name_en) || student.department || '—'}
          </div>
          <div style={styles.field}><strong style={styles.fieldLabel}>{t('Current GPA')}:</strong> {student.gpa !== null && student.gpa !== undefined ? String(student.gpa) : '—'}</div>

          <h2 style={styles.h2}>{t('Finalized Grades')}</h2>
          {grades.length === 0 ? (
            <p>{t('No finalized grades yet.')}</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t('Project')}</th>
                  <th style={styles.th}>{t('Score')}</th>
                  <th style={styles.th}>{t('Letter')}</th>
                  <th style={styles.th}>{t('Graded At')}</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{g[`title_${locale}`] || g.title_en || g.title_ar}</td>
                    <td style={styles.td}>{g.total_score}/{g.max_score}</td>
                    <td style={styles.td}>{g.letter_grade || '—'}</td>
                    <td style={styles.td}>{g.graded_at || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {graduation && (
            <>
              <h2 style={styles.h2}>{t('Graduation')}</h2>
              <div style={styles.field}><strong style={styles.fieldLabel}>{t('Status')}:</strong> {graduation.status === 'graduated' ? t('Graduated') : t('Revoked')}</div>
              <div style={styles.field}><strong style={styles.fieldLabel}>{t('Graduation date')}:</strong> {String(graduation.graduation_date)}</div>
              <div style={styles.field}><strong style={styles.fieldLabel}>{t('Final GPA')}:</strong> {graduation.final_gpa !== null && graduation.final_gpa !== undefined ? String(graduation.final_gpa) : '—'}</div>
              <div style={styles.field}><strong style={styles.fieldLabel}>{t('Certificate number')}:</strong> {String(graduation.certificate_number)}</div>
            </>
          )}
        </>
      )}

      <style>{'@media print { .no-print { display: none; } }'}</style>
    </div>
  );
}
