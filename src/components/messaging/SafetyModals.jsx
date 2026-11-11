import { useEffect, useState } from 'react';
import { Modal } from './modals';
import { Avatar } from './ConversationRail';
import { REPORT_REASONS, reasonLabel, statusMeta } from './safety';
import { useLanguage } from '../../context/LanguageContext';

function useT() {
  const { locale } = useLanguage();
  return { t: (en, ar) => (locale === 'ar' ? ar : en), locale };
}

const errText = (err, fallback) => err?.message || fallback;

/**
 * Report a message (target.messageId) or a person (target.userId).
 * onSubmit({ reason, details, also_block }) → Promise. The report goes to the
 * platform admins and the reported person's university / faculty.
 */
export function ReportModal({ target, onClose, onSubmit }) {
  const { t } = useT();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!reason) {
      setError(t('Please choose a reason.', 'من فضلك اختر سبب البلاغ.'));
      return;
    }
    if (reason === 'other' && !details.trim()) {
      setError(t('Please describe the problem.', 'من فضلك اشرح المشكلة.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ reason, details: details.trim(), also_block: alsoBlock });
    } catch (err) {
      setError(errText(err, t('Could not send the report.', 'تعذّر إرسال البلاغ.')));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={target.messageId ? t('Report message', 'الإبلاغ عن رسالة') : t('Report user', 'الإبلاغ عن مستخدم')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={submit} disabled={busy}>{busy ? t('Sending…', 'جارٍ الإرسال…') : t('Send report', 'إرسال البلاغ')}</button>
        </>
      }
    >
      <p className="text-small" style={{ marginTop: 0 }}>
        {t('Your report goes to the platform admins and to the university and faculty of ', 'يصل بلاغك لإدارة المنصة ولجامعة وكلية ')}
        <strong>{target.name || t('this person', 'هذا الشخص')}</strong>
        {t('. The person is not told who reported them.', '. ولن يعرف الشخص من الذي أبلغ عنه.')}
      </p>

      {target.preview && (
        <blockquote className="text-small" style={{ margin: '0 0 var(--space-3)', padding: '8px 12px', borderInlineStart: '3px solid var(--color-danger, #e5484d)', background: 'rgba(127,127,127,.08)', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
          {target.preview}
        </blockquote>
      )}

      <div role="radiogroup" aria-label={t('Reason', 'السبب')} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {REPORT_REASONS.map((r) => (
          <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" name="report-reason" checked={reason === r.key} onChange={() => setReason(r.key)} />
            {t(r.en, r.ar)}
          </label>
        ))}
      </div>

      <textarea
        className="form-input"
        style={{ width: '100%', marginTop: 'var(--space-3)', minHeight: 80 }}
        maxLength={1000}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder={reason === 'other' ? t('Describe the problem (required)', 'اشرح المشكلة (مطلوب)') : t('Add details (optional)', 'أضف تفاصيل (اختياري)')}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'var(--space-3)', fontSize: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} />
        {t('Also block this person', 'احظر هذا الشخص أيضًا')}
      </label>

      {error && <p className="text-small" role="alert" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

/** "Safety center": blocked people (with Unblock) + my reports and their status. */
export function SafetyModal({ onClose, loadBlocked, onUnblock, loadMine, initialTab = 'blocked' }) {
  const { t, locale } = useT();
  const [tab, setTab] = useState(initialTab);
  const [blocked, setBlocked] = useState(null);
  const [mine, setMine] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    loadBlocked().then((d) => alive && setBlocked(d || [])).catch((e) => alive && setError(errText(e, t('Could not load.', 'تعذّر التحميل.'))));
    loadMine().then((d) => alive && setMine(d || [])).catch(() => alive && setMine([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unblock = async (u) => {
    setBusyId(u.id);
    setError('');
    try {
      const next = await onUnblock(u);
      setBlocked(Array.isArray(next) ? next : (blocked || []).filter((b) => b.id !== u.id));
    } catch (err) {
      setError(errText(err, t('Could not unblock.', 'تعذّر إلغاء الحظر.')));
    } finally {
      setBusyId(null);
    }
  };

  const tabBtn = (key, label, count) => (
    <button
      type="button"
      className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setTab(key)}
      aria-pressed={tab === key}
    >
      {label}{count != null ? ` (${count})` : ''}
    </button>
  );

  return (
    <Modal
      title={t('Safety center', 'مركز الأمان')}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{t('Done', 'تم')}</button>}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-3)' }}>
        {tabBtn('blocked', t('Blocked people', 'المحظورون'), blocked ? blocked.length : null)}
        {tabBtn('mine', t('My reports', 'بلاغاتي'), mine ? mine.length : null)}
      </div>

      {tab === 'blocked' && (
        <>
          {!blocked && !error && <p className="text-small text-muted">{t('Loading…', 'جارٍ التحميل…')}</p>}
          {blocked && blocked.length === 0 && (
            <p className="text-small text-muted">{t("You haven't blocked anyone. Blocked people can't message you and you can't message them.", 'لم تحظر أحدًا. المحظور لا يستطيع مراسلتك ولا تستطيع مراسلته.')}</p>
          )}
          {(blocked || []).map((u) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(127,127,127,.15)' }}>
              <Avatar name={u.full_name || ''} src={u.avatar_path} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.full_name}</strong>
                {u.email && <span className="text-small text-muted" dir="ltr" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === u.id} onClick={() => unblock(u)}>
                {t('Unblock', 'إلغاء الحظر')}
              </button>
            </div>
          ))}
        </>
      )}

      {tab === 'mine' && (
        <>
          {!mine && <p className="text-small text-muted">{t('Loading…', 'جارٍ التحميل…')}</p>}
          {mine && mine.length === 0 && <p className="text-small text-muted">{t("You haven't sent any reports.", 'لم ترسل أي بلاغات.')}</p>}
          {(mine || []).map((r) => {
            const st = statusMeta(r.status);
            return (
              <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(127,127,127,.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`badge ${st.badge}`}>{locale === 'ar' ? st.ar : st.en}</span>
                  <strong style={{ fontSize: 14 }}>{r.reported_name}</strong>
                  <span className="text-small text-muted">· {reasonLabel(r.reason, locale)} · {(r.created_at || '').slice(0, 10)}</span>
                </div>
                {r.message_snapshot && <p className="text-small" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{r.message_snapshot}</p>}
                {r.resolution_notes && <p className="text-small text-muted" style={{ margin: '6px 0 0' }}>{t('Reviewer note:', 'ملاحظة المراجع:')} {r.resolution_notes}</p>}
              </div>
            );
          })}
        </>
      )}

      {error && <p className="text-small" role="alert" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}
