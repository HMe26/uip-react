import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import ExportMenu from '../ExportMenu';
import { exportTable, saveBlob } from '../../lib/exporter';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Shared helpers for adding people manually (students, supervisors, faculty logins):
 * the admin can type a password or generate one, and always sees the final credentials —
 * email delivery is not guaranteed (MAIL_MAILER=log by default), so they can hand them over.
 */

const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SPECIAL = '!@#$%';

/** Random password that satisfies the platform policy (upper + lower + digit + special, 8+). */
export function generatePassword(length = 12) {
  const rnd = new Uint32Array(length + 8);
  (window.crypto || window.msCrypto).getRandomValues(rnd);
  let i = 0;
  const pick = (set) => set[rnd[i++] % set.length];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGIT;
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates shuffle with the same random source
  for (let k = chars.length - 1; k > 0; k -= 1) {
    const j = rnd[(i + k) % rnd.length] % (k + 1);
    [chars[k], chars[j]] = [chars[j], chars[k]];
  }
  return chars.join('');
}

const tr = (locale, ar, en) => (locale === 'ar' ? ar : en);

/** Read-only value + copy button. */
export function CopyField({ label, value, mono = true }) {
  const { locale } = useLanguage();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input className="form-input" readOnly value={value} style={mono ? { fontFamily: 'monospace' } : undefined} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-outline btn-sm" onClick={copy} title={tr(locale, 'نسخ', 'Copy')}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
        </button>
      </div>
    </div>
  );
}

/** Password input with a "Generate" button. `optional` explains the empty-field behaviour. */
export function PasswordInput({ value, onChange, optional = true, label }) {
  const { locale } = useLanguage();
  return (
    <div className="form-group">
      <label className="form-label">{label || tr(locale, 'كلمة السر', 'Password')}</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          className="form-input"
          type="text"
          autoComplete="new-password"
          minLength={8}
          maxLength={64}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={optional ? tr(locale, 'اتركها فارغة للتوليد التلقائي', 'Leave empty to auto-generate') : ''}
          style={{ fontFamily: 'monospace' }}
        />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange(generatePassword())} title={tr(locale, 'توليد', 'Generate')}>
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <p className="text-caption">{tr(locale, '8 أحرف على الأقل.', 'At least 8 characters.')}</p>
    </div>
  );
}

/** Shown after a person was created: email + password to copy, plus what happened with the email. */
export function CredentialsModal({ title, email, password, message, onClose }) {
  const { locale } = useLanguage();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{title}</h2>
        {message && <p className="text-small">{message}</p>}
        <CopyField label={tr(locale, 'البريد الإلكتروني', 'Email')} value={email} mono={false} />
        {password && <CopyField label={tr(locale, 'كلمة السر', 'Password')} value={password} />}
        <p className="text-caption">{tr(locale, 'احتفظ ببيانات الدخول الآن — يمكنك تغيير كلمة السر لاحقًا من زر المفتاح في الصف.', 'Keep these login details now — you can change the password later from the key button on the row.')}</p>
        <div className="modal-box__actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>{tr(locale, 'تم', 'Done')}</button>
        </div>
      </div>
    </div>
  );
}

/** Key button modal: set a custom password or regenerate one. PATCH {endpoint} {password}. */
export function SetPasswordModal({ title, endpoint, onClose }) {
  const { locale } = useLanguage();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const json = await api.patch(endpoint, { password: password.trim() || null });
      setDone(json.data?.password || password.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{title}</h2>
        {done ? (
          <>
            <p className="text-small">{tr(locale, 'تم تحديث كلمة السر. سلّمها للمستخدم:', 'Password updated. Hand it to the user:')}</p>
            <CopyField label={tr(locale, 'كلمة السر الجديدة', 'New password')} value={done} />
            <div className="modal-box__actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>{tr(locale, 'تم', 'Done')}</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <PasswordInput value={password} onChange={setPassword} />
            {error && <p className="form-error">{error}</p>}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{tr(locale, 'إلغاء', 'Cancel')}</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : tr(locale, 'تحديث كلمة السر', 'Update password')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Result of a bulk import ({imported, skipped, errors, results[]}) + a credentials CSV download. */
export function ImportResult({ result }) {
  const { locale } = useLanguage();
  const withPasswords = (result.results || []).filter((r) => r.success && r.password);

  function downloadCredentials(format) {
    return exportTable({
      headers: ['email', 'password'],
      rows: withPasswords.map((r) => [r.email, r.password]),
      format, filename: 'imported-credentials', title: tr(locale, 'بيانات الدخول', 'Login details'), rtl: locale === 'ar',
    });
  }

  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <p className="text-small">
        {tr(locale, `تم استيراد ${result.imported}، وتخطي ${result.skipped}.`, `Imported ${result.imported}, skipped ${result.skipped}.`)}
      </p>
      {withPasswords.length > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <ExportMenu className="btn btn-outline btn-sm" iconSize={14} onExport={downloadCredentials}
            label={tr(locale, 'تنزيل بيانات الدخول', 'Download login details')} />
        </div>
      )}
      {result.errors?.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', color: 'var(--color-danger)', marginTop: 'var(--space-2)' }}>
          {result.errors.map((e, i) => <p key={i} className="text-caption" style={{ margin: 0 }}>{e}</p>)}
        </div>
      )}
    </div>
  );
}

/** Downloadable CSV template for a bulk import. */
export function downloadTemplate(filename, headers, sample) {
  const blob = new Blob(['\uFEFF' + headers.join(',') + '\n' + sample.join(',') + '\n'], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, filename);
}
