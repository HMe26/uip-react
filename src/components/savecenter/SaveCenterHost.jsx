import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { cloud, useCloud } from '../../lib/cloud/engine';
import { saveCenter, useSaveCenter } from '../../lib/saveCenter';
import { CloudPanel, cloudSummary } from '../../desktop/CloudSettings';
import '../../styles/css/save-center.css';

/** Where a document ends up, as one sentence (used by the "Save changes?" dialog and the reminders). */
function whereText(where, cl, tt) {
  if (where === 'project') return tt('Saving updates the file for everyone on the project.', 'الحفظ بيحدّث الملف لكل أعضاء المشروع.');
  const name = cl.providers.map((i) => cloud.providers[i].label).join(' + ');
  const base = tt('Saving stores it in My PC — the final copy on the university server.', 'الحفظ بيخزّنه في جهازي — النسخة النهائية على سيرفر الجامعة.');
  if (where !== 'mypc') return base;
  return cl.provider && cl.auto ? `${base} ${tt(`A backup copy then goes to your ${name}.`, `وبعدها بتتنسخ نسخة احتياطية على ${name} بتاعك.`)}` : base;
}

function BackupLine({ at, cl, tt }) {
  if (!cl.provider) {
    return (
      <span className="sc-line sc-line--off">
        <Icon name="cloud-off" size={13} /> {tt('No cloud backup yet', 'مفيش نسخ احتياطي سحابي لسه')}
        {(cloud.available('google') || cloud.available('microsoft')) && <button type="button" className="sc-link" onClick={() => saveCenter.openCloudSettings()}>{tt('Set up', 'فعّله')}</button>}
      </span>
    );
  }
  const name = cl.providers.map((i) => cloud.providers[i].label).join(' + ');
  if (!cl.auto) return <span className="sc-line sc-line--off"><Icon name="cloud-off" size={13} /> {tt(`${name} backup is paused`, `نسخ ${name} متوقف`)}</span>;
  if (cl.status === 'needs-auth') return <span className="sc-line sc-line--warn"><Icon name="alert-triangle" size={13} /> {tt(`Sign in to ${name} to back up`, `سجّل الدخول لـ ${name} عشان النسخ`)}<button type="button" className="sc-link" onClick={() => saveCenter.openCloudSettings()}>{tt('Sign in', 'دخول')}</button></span>;
  if (cl.status === 'offline') return <span className="sc-line sc-line--warn"><Icon name="cloud-off" size={13} /> {tt('Offline — the backup will follow when you reconnect', 'أوفلاين — النسخ هيكمل لما الإنترنت يرجع')}</span>;
  if (cl.status === 'error') return <span className="sc-line sc-line--bad"><Icon name="alert-triangle" size={13} /> {cl.lastError || tt('Backup problem', 'مشكلة في النسخ')}</span>;
  if (cl.status === 'running') return <span className="sc-line"><Icon name="cloud-up" size={13} /> {tt(`Backing up to ${name}… ${cl.progress.done}/${cl.progress.total}`, `جاري النسخ على ${name}… ${cl.progress.done}/${cl.progress.total}`)}</span>;
  if (cl.lastOk >= at) return <span className="sc-line sc-line--ok"><Icon name="cloud-check" size={13} /> {tt(`Backup copy saved to ${name}`, `النسخة الاحتياطية اتحفظت على ${name}`)}</span>;
  return <span className="sc-line"><Icon name="cloud" size={13} /> {tt(`Backing up to ${name} in a few seconds…`, `هيتنسخ على ${name} بعد ثواني…`)}</span>;
}

/** Mounted once (App.jsx): toasts, the "Save changes?" dialog, and the backup engine's start-up for students. */
export default function SaveCenterHost() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const tt = (en, a) => (ar ? a : en);
  const sc = useSaveCenter();
  const cl = useCloud();

  useEffect(() => {
    if (user?.id && user.role === 'student') cloud.init(user.id);
    else cloud.stop();
  }, [user?.id, user?.role]);

  // Esc = Cancel on the dialog
  useEffect(() => {
    if (!sc.modal) return undefined;
    const h = (e) => { if (e.key === 'Escape') saveCenter.modalCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sc.modal]);

  if (!user?.id) return null;
  const m = sc.modal;
  const sum = cloudSummary(cl, tt);

  return createPortal(
    <div className="sc-root" dir={ar ? 'rtl' : 'ltr'}>
      {sc.toasts.length > 0 && (
        <div className="sc-toasts" role="status" aria-live="polite">
          {sc.toasts.map((t) => (
            <div key={t.id} className={`sc-toast sc-toast--${t.kind}`}>
              <span className="sc-toast__ic"><Icon name={t.kind === 'saved' ? 'check-circle' : 'save'} size={18} /></span>
              <div className="sc-toast__body">
                {t.kind === 'saved' ? (
                  <>
                    <b>{t.name ? tt(`Saved — ${t.name}`, `تم الحفظ — ${t.name}`) : tt('Saved', 'تم الحفظ')}</b>
                    <span className="sc-line"><Icon name="hard-drive" size={13} /> {tt('Final copy: My PC (university server)', 'النسخة النهائية: جهازي (سيرفر الجامعة)')}</span>
                    <BackupLine at={t.at} cl={cl} tt={tt} />
                  </>
                ) : (
                  <>
                    <b>{tt(`“${t.name || 'File'}” has unsaved changes`, `“${t.name || 'ملف'}” فيه تعديلات لم تُحفظ`)}</b>
                    <span className="sc-line">{whereText(t.where, cl, tt)}</span>
                    <div className="sc-toast__act">
                      <button type="button" className="sc-btn sc-btn--primary" onClick={() => { saveCenter.dismiss(t.id); saveCenter.saveDoc(t.key); }}>{tt('Save now', 'احفظ دلوقتي')}</button>
                      <button type="button" className="sc-btn" onClick={() => saveCenter.dismiss(t.id)}>{tt('Later', 'بعدين')}</button>
                    </div>
                  </>
                )}
              </div>
              <button type="button" className="sc-x" aria-label={tt('Close', 'إغلاق')} onClick={() => saveCenter.dismiss(t.id)}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {m && (
        <div className="sc-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) saveCenter.modalCancel(); }}>
          <div className="sc-dlg" role="alertdialog" aria-modal="true" aria-labelledby="sc-dlg-t">
            <h3 id="sc-dlg-t"><Icon name="save" size={20} /> {tt('Save changes?', 'تحفظ التعديلات؟')}</h3>
            <p className="sc-dlg__name" dir="auto">{m.name}</p>
            <p>{whereText(m.where, cl, tt)}</p>
            {m.where === 'mypc' && cl.provider && <p className="sc-dlg__sub">{sum.text}</p>}
            {m.error && <p className="sc-dlg__err">{tt('Could not save. Your changes are still kept as a draft on this device.', 'تعذّر الحفظ. تعديلاتك لسه محفوظة كمسودة على جهازك.')}</p>}
            <div className="sc-dlg__btns">
              <button type="button" className="sc-btn sc-btn--primary" autoFocus disabled={m.saving} onClick={() => saveCenter.modalSave()}>{m.saving ? tt('Saving…', 'جارٍ الحفظ…') : tt('Save', 'حفظ')}</button>
              <button type="button" className="sc-btn sc-btn--danger" disabled={m.saving} onClick={() => saveCenter.modalDiscard()}>{tt("Don't save", 'لا تحفظ')}</button>
              <button type="button" className="sc-btn" disabled={m.saving} onClick={() => saveCenter.modalCancel()}>{tt('Cancel', 'إلغاء')}</button>
            </div>
          </div>
        </div>
      )}

      {sc.cloudDialog && (
        <div className="sc-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) saveCenter.closeCloudDialog(); }}>
          <div className="sc-dlg sc-dlg--wide os-set__main">
            <button type="button" className="sc-x sc-x--abs" aria-label={tt('Close', 'إغلاق')} onClick={() => saveCenter.closeCloudDialog()}><Icon name="x" size={16} /></button>
            <CloudPanel tt={tt} usage={null} />
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
