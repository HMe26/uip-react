import { useState } from 'react';
import { Modal } from './modals';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Small confirmation dialog for destructive chat actions.
 * onConfirm may be async; the buttons lock while it runs and the dialog closes itself when it resolves.
 */
export default function ConfirmDialog({ title, message, confirmLabel, danger = true, onConfirm, onClose }) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={run} disabled={busy} autoFocus>
            {busy ? t('Working…', 'جارٍ التنفيذ…') : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-small" style={{ margin: 0, lineHeight: 1.7 }}>{message}</p>
    </Modal>
  );
}
