import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nPage from '../../i18n/student/graduation-certificate';
import CertificateView from '../../components/graduation/CertificateView';

/**
 * Mirrors app/Views/student/graduation-certificate.php — a standalone
 * printer-friendly landscape certificate page. Data comes from
 * GET /api/v1/graduation/{studentId}/certificate
 * (App\Controllers\Api\GraduationApiController::certificate(), which
 * 404s unless the graduation record's status is 'graduated' — exactly
 * as Student\StudentGraduationController::certificate() guards before
 * rendering). studentId is resolved from the caller's own eligibility
 * record via GET /api/v1/graduation first, same as the transcript page.
 */
export default function StudentGraduationCertificate() {
  const t = useTranslations(i18nPage);
  const { locale } = useLanguage();

  const [student, setStudent] = useState(null);
  const [graduation, setGraduation] = useState(null);
  const [university, setUniversity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/graduation')
      .then((eligJson) => {
        const studentId = eligJson.data?.student?.id;
        if (!studentId) throw new Error(locale === 'ar' ? 'لم يتم العثور على بيانات الطالب.' : 'Student record not found.');
        return api.get(`/api/v1/graduation/${studentId}/certificate`);
      })
      .then((json) => {
        if (cancelled) return;
        setStudent(json.data.student);
        setGraduation(json.data.graduation);
        setUniversity(json.data.university);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div style={{ padding: 60, fontFamily: 'Arial, sans-serif', textAlign: 'center' }}>{locale === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  }

  if (error || !graduation || !student) {
    return (
      <div style={{ padding: 60, fontFamily: 'Arial, sans-serif', textAlign: 'center' }}>
        {t('Certificate data could not be found.')}
      </div>
    );
  }

  return <CertificateView student={student} graduation={graduation} university={university} t={t} locale={locale} />;
}
