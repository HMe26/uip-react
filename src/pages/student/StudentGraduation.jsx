import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { Pill, Skeleton } from '../../components/student/stUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/graduation';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/student/graduation.php, talking to GET /api/v1/graduation
 * (App\Controllers\Api\GraduationApiController::index(), which for a
 * student caller returns exactly GraduationService::checkEligibility() —
 * the same call Student\StudentGraduationController::index() makes).
 * Read-only end-to-end, same as the Blade view — every mutation
 * (approve/revoke) is a University/Faculty-portal action.
 *
 * "View Transcript" / "View / Print Certificate" link to the two
 * standalone printer-friendly pages (StudentGraduationTranscript.jsx /
 * StudentGraduationCertificate.jsx), same as the Blade view's links to
 * /student/graduation/transcript and /student/graduation/certificate.
 */
export default function StudentGraduation() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  usePageMeta(locale === 'ar' ? 'متطلبات التخرج' : 'Graduation Requirements', locale === 'ar' ? 'تابع المتطلبات اللازمة لإكمال رحلة مشروع التخرج.' : 'Track the requirements needed to complete your graduation project journey.');

  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v1/graduation')
      .then((json) => setEligibility(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton h={90} count={3} />;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!eligibility) return null;

  const record = eligibility.existing_record;

  return (
    <div className="st-page">

      {eligibility.already_graduated && record ? (
        <div className="st-panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <span className="badge badge-success" style={{ fontSize: 14 }}>{t('Graduated')}</span>
            <span className="text-small text-muted">{t('Graduation date: ')}<strong>{String(record.graduation_date)}</strong></span>
          </div>
          <p className="text-small" style={{ marginBottom: 4 }}>{t('Certificate number: ')}<strong>{String(record.certificate_number)}</strong></p>
          {record.final_gpa !== null && record.final_gpa !== undefined && (
            <p className="text-small" style={{ marginBottom: 4 }}>{t('Final GPA: ')}<strong>{String(record.final_gpa)}</strong></p>
          )}
          {(() => {
            const degreeTitle = locale === 'ar' ? (record.degree_title_ar || record.degree_title_en) : (record.degree_title_en || record.degree_title_ar);
            return degreeTitle ? (
              <p className="text-small" style={{ marginBottom: 'var(--space-3)' }}>{t('Degree: ')}<strong>{degreeTitle}</strong></p>
            ) : null;
          })()}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Link to="/student/graduation/transcript" className="btn btn-outline">{t('View Transcript')}</Link>
            <Link to="/student/graduation/certificate" className="btn btn-primary">{t('View / Print Certificate')}</Link>
          </div>
        </div>
      ) : eligibility.revoked && record ? (
        <div className="st-panel" style={{ marginBottom: 16 }}>
          <span className="badge badge-danger" style={{ fontSize: 14 }}>{t('Graduation approval revoked')}</span>
          {record.revoke_reason && (
            <p className="text-small text-muted" style={{ marginTop: 'var(--space-2)' }}>{t('Reason: ')}{String(record.revoke_reason)}</p>
          )}
          <p className="text-small text-muted" style={{ marginTop: 'var(--space-2)' }}>{t('Contact your university for more details.')}</p>
        </div>
      ) : (
        <>
          {(() => {
            const checks = eligibility.checks || [];
            const done = checks.filter((c) => c.met).length;
            const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;
            const ar = locale === 'ar';
            return (
              <div className="st-stack">
                <section className="st-panel">
                  <div className="st-row" style={{ marginBottom: 10 }}>
                    <strong style={{ fontSize: 14 }}>{ar ? `اكتمل ${done} من ${checks.length} متطلبات` : `${done} of ${checks.length} requirements completed`}</strong>
                    <span className="st-muted" style={{ fontSize: 13, fontWeight: 700 }}>{pct}%</span>
                  </div>
                  <div className="st-progress"><span style={{ width: `${pct}%` }} /></div>
                  {done < checks.length && (
                    <p style={{ fontSize: 12.5, marginTop: 10, color: 'var(--color-warning)' }}>
                      {ar ? `${checks.length - done} متطلبات تحتاج إلى انتباه.` : `${checks.length - done} requirement${checks.length - done > 1 ? 's' : ''} need attention.`}
                    </p>
                  )}
                </section>
                {checks.map((check) => (
                  <div key={check.key} className="st-req">
                    <span className={`st-req__icon${check.met ? '' : ' is-pending'}`}><Icon name={check.met ? 'check-circle' : 'alert-triangle'} size={22} /></span>
                    <div className="st-req__body"><strong>{check.label?.[locale] || check.label?.en}</strong></div>
                    <Pill tone={check.met ? 'success' : 'warning'}>{check.met ? (ar ? 'مكتمل' : 'Completed') : (ar ? 'معلّق' : 'Pending')}</Pill>
                  </div>
                ))}
                <p className="st-muted" style={{ fontSize: 12.5 }}>{t('Once every requirement is met, your university will review and approve your graduation.')}</p>
              </div>
            );
          })()}

          {eligibility.finalized_grade && (
            <div className="st-panel" style={{ marginTop: 16 }}>
              <h2 className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>{t('Graduation project grade')}</h2>
              <p className="text-small">
                {eligibility.finalized_grade[`title_${locale}`] || eligibility.finalized_grade.title_en} —{' '}
                <strong>{eligibility.finalized_grade.total_score}/{eligibility.finalized_grade.max_score}</strong>
                {eligibility.finalized_grade.letter_grade ? ` (${eligibility.finalized_grade.letter_grade})` : ''}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
