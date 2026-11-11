import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nPage from '../../i18n/student/graduation-certificate';
import CertificateView from '../../components/graduation/CertificateView';

/**
 * University/faculty view of one student's certificate — same printer-
 * friendly layout as pages/student/StudentGraduationCertificate.jsx (kept
 * as a separate file since it's parameterized by :studentId from the URL
 * instead of resolving "my own" record), reusing that page's translations
 * since the certificate content itself is identical either way. Data
 * comes from GET /api/v1/graduation/{studentId}/certificate
 * (App\Controllers\Api\GraduationApiController::certificate(), scoped to
 * the caller's own university/faculty via StudentRepository::findOwned()).
 */
export default function UniversityGraduationCertificate() {
  const { id } = useParams();
  const t = useTranslations(i18nPage);
  const { locale } = useLanguage();

  const [student, setStudent] = useState(null);
  const [graduation, setGraduation] = useState(null);
  const [university, setUniversity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/graduation/${id}/certificate`)
      .then((json) => {
        if (cancelled) return;
        setStudent(json.data.student);
        setGraduation(json.data.graduation);
        setUniversity(json.data.university);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

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
