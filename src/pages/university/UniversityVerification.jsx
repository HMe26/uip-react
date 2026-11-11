import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Alert, Field, Pill, Skeletons } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/verification';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/verification.php. Data comes from
 * GET /api/v1/university/verification (App\Controllers\Api\
 * UniversityVerificationApiController::index() -> UniversityVerificationService
 * ::statusFor() + UniversityReverificationLogRepository::forUniversity()).
 * Document upload posts multipart to .../documents — never itself changes
 * verification_status; that stays an Admin decision.
 *
 * Design: um- system (styles/css/university-manage.css) — status hero, documents
 * panel with a drop zone, history + re-verification in the aside.
 */

const STATUS_META = {
  verified: { tone: 'success', icon: 'shield', en: 'Verified', ar: 'موثقة' },
  pending: { tone: 'warning', icon: 'clock', en: 'Pending', ar: 'قيد المراجعة' },
  rejected: { tone: 'danger', icon: 'x-circle', en: 'Rejected', ar: 'مرفوضة' },
  unverified: { tone: 'muted', icon: 'shield', en: 'Unverified', ar: 'غير موثقة' },
};
const DOC_STATUS_META = {
  approved: { tone: 'success', en: 'Approved', ar: 'معتمد' },
  pending: { tone: 'warning', en: 'Pending', ar: 'قيد المراجعة' },
  rejected: { tone: 'danger', en: 'Rejected', ar: 'مرفوض' },
};
const REVERIF_EVENT_META = {
  notified: { tone: 'primary', icon: 'bell', en: 'Expiry warning sent', ar: 'إرسال تنبيه بالانتهاء' },
  auto_renewed: { tone: 'success', icon: 'check-circle', en: 'Auto-renewed', ar: 'تجديد تلقائي' },
  reverted_pending: { tone: 'danger', icon: 'x-circle', en: 'Reverted to pending', ar: 'رجوع لقيد المراجعة' },
  failed: { tone: 'danger', icon: 'alert-triangle', en: 'Re-verification failed', ar: 'فشل إعادة التحقق' },
};

function timeAgo(dateStr, locale) {
  if (!dateStr) return '—';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return locale === 'ar' ? 'اليوم' : 'today';
  if (days === 1) return locale === 'ar' ? 'منذ يوم' : '1 day ago';
  return locale === 'ar' ? `منذ ${days} يوم` : `${days} days ago`;
}

export default function UniversityVerification() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [university, setUniversity] = useState(null);
  const [verification, setVerification] = useState({ status: 'unverified', documents: [], history: [] });
  const [reverifLog, setReverifLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploaded, setUploaded] = useState(false);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/university/verification')
      .then((json) => {
        setUniversity(json.data?.university || null);
        setVerification(json.data?.verification || { status: 'unverified', documents: [], history: [] });
        setReverifLog(json.data?.reverification_log || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploaded(false);
    try {
      const formData = new FormData();
      formData.append('document', file);
      if (notes) formData.append('notes', notes);
      await api.postForm('/api/v1/university/verification/documents', formData);
      setFile(null);
      setNotes('');
      setUploaded(true);
      load();
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="um-page"><Skeletons n={3} h={130} /></div>;
  if (error && !university) return <div className="um-page"><Alert>{error}</Alert></div>;

  const meta = STATUS_META[verification.status] || STATUS_META.unverified;
  const name = university ? (locale === 'ar' ? (university.official_name_ar || university.official_name_en) : (university.official_name_en || university.official_name_ar)) : '—';
  const ar = locale === 'ar';
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB');

  const expiresAt = university?.verification_expires_at || null;
  const autoOn = university ? Number(university.auto_reverify_enabled ?? 1) === 1 : false;
  const daysLeft = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : null;
  const expTone = daysLeft === null ? 'muted' : daysLeft < 0 ? 'danger' : daysLeft <= 30 ? 'warning' : 'success';

  function pickFile(f) { if (f) { setFile(f); setUploaded(false); } }

  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <h1>{t('University Verification')}</h1>
          <p>{t("Your university's verification status on the platform, and its supporting documents.")}</p>
        </div>
      </header>

      {error && <Alert>{error}</Alert>}

      <div className="um-layout">
        <div className="um-stack">
          <section className="um-hero vf-hero" data-tone={meta.tone}>
            <span className="vf-hero__badge"><Icon name={meta.icon} size={30} /></span>
            <div className="um-hero__text">
              <span><Pill tone={meta.tone}>{meta[locale]}</Pill></span>
              <h1>{name}</h1>
              {verification.verified_at ? (
                <p className="um-hero__desc">
                  {t('On')} {fmt(verification.verified_at)}{verification.verified_by ? ` · ${verification.verified_by}` : ''}
                </p>
              ) : (
                <p className="um-hero__desc">
                  {verification.status === 'pending'
                    ? (ar ? 'مستنداتك قيد المراجعة من فريق المنصة.' : 'Your documents are being reviewed by the platform team.')
                    : (ar ? 'ارفع مستندات التوثيق ليراجعها فريق المنصة.' : 'Upload your verification documents for the platform team to review.')}
                </p>
              )}
            </div>
          </section>

          <section className="um-panel um-panel--flush">
            <div className="um-panel__head">
              <h2>{t('Submitted Documents')}</h2>
              <span className="um-count">{verification.documents.length}</span>
            </div>
            {verification.documents.length === 0 ? (
              <p className="um-panel__sub" style={{ padding: '18px 20px', margin: 0 }}>{t('No documents submitted yet.')}</p>
            ) : (
              <div className="um-rows">
                {verification.documents.map((doc) => {
                  const dm = DOC_STATUS_META[doc.status] || DOC_STATUS_META.pending;
                  return (
                    <div key={doc.id} className="um-row">
                      <span className="vf-file"><Icon name="file" size={18} /></span>
                      <div className="um-row__main">
                        <p className="um-row__name">{doc.notes || t('Verification document')}</p>
                        <p className="um-row__sub"><span className="um-fact"><Icon name="calendar" size={13} /> {t('Uploaded')} {timeAgo(doc.created_at, locale)}</span></p>
                      </div>
                      <div className="um-row__end"><Pill tone={dm.tone}>{dm[locale]}</Pill></div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Upload Document')}</h2></div>
            <form className="um-form" onSubmit={handleUpload}>
              {uploadError && <Alert>{uploadError}</Alert>}
              {uploaded && <Alert tone="ok">{ar ? 'تم رفع المستند وهو الآن قيد المراجعة.' : 'Document uploaded and queued for review.'}</Alert>}
              <Field label={t('Document description (optional)')}>
                <input className="form-input" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <label
                className={`vf-drop${dragging ? ' is-over' : ''}${file ? ' has-file' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]); }}
              >
                <span className="vf-drop__ico"><Icon name={file ? 'file' : 'upload'} size={22} /></span>
                {file ? (
                  <strong>{file.name}</strong>
                ) : (
                  <>
                    <strong>{t('Drag & drop a document here')}</strong>
                    <span>{t('or click to browse (PDF, DOC, DOCX)')}</span>
                  </>
                )}
                <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              </label>
              <div className="um-form__foot">
                <button type="submit" className="btn btn-primary" disabled={!file || uploading}>
                  <Icon name="upload" size={16} /> {uploading ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : t('Upload Document')}
                </button>
                {file && !uploading && (
                  <button type="button" className="btn btn-ghost" onClick={() => setFile(null)}>{ar ? 'إزالة الملف' : 'Remove file'}</button>
                )}
              </div>
            </form>
          </section>
        </div>

        <aside className="um-aside">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Verification History')}</h2></div>
            {verification.history.length === 0 ? (
              <p className="um-panel__sub">{ar ? 'لا يوجد سجل بعد.' : 'No history yet.'}</p>
            ) : (
              <ol className="um-flow">
                {verification.history.map((h, i) => (
                  <li key={i} className="is-done">
                    <span className="um-flow__dot"><Icon name="check" size={14} /></span>
                    <span>
                      {h.label}
                      <small className="vf-date">{fmt(h.date)}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Automatic Re-verification')}</h2></div>
            {verification.status === 'verified' && expiresAt ? (
              <>
                <div className="um-meter">
                  <b>{daysLeft >= 0 ? daysLeft : 0}</b>
                  <span>{ar ? 'يوم متبقٍ' : 'days left'}</span>
                  <span style={{ marginInlineStart: 'auto' }}><Pill tone={expTone}>{daysLeft < 0 ? t('expired') : fmt(expiresAt)}</Pill></span>
                </div>
                <p className="um-panel__sub">
                  {t('Current verification expires on')} <strong>{fmt(expiresAt)}</strong>.{' '}
                  {autoOn
                    ? (ar ? 'سيتم التجديد تلقائيًا عند الانتهاء طالما لا توجد مشاكل قائمة.' : "It will renew automatically at expiry as long as there's nothing outstanding.")
                    : t('Auto-renew is off for your university — at expiry it will need a manual admin review.')}
                </p>
              </>
            ) : (
              <p className="um-panel__sub">
                {ar ? 'تُفعَّل إعادة التحقق التلقائي بعد أول توثيق للجامعة.' : "Automatic re-verification activates once your university's first verification is approved."}
              </p>
            )}

            {reverifLog.length > 0 && (
              <div className="vf-log">
                {reverifLog.map((ev, i) => {
                  const em = REVERIF_EVENT_META[ev.event] || REVERIF_EVENT_META.notified;
                  return (
                    <div key={i} className="vf-log__row">
                      <Pill tone={em.tone} dot={false}><Icon name={em.icon} size={12} /> {em[locale]}</Pill>
                      <span className="vf-date">{fmt(ev.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
