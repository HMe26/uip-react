import { useEffect, useState } from 'react';
import { api, clearTokens, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/**
 * "Delete my account" (student settings → Security). Three guarded steps so nobody deletes by accident:
 *   1. read the warning and start         2. password → we email a one-time code
 *   3. enter the code + tick the explicit confirmation → delete.
 * API: POST /student/settings/delete-account/send-otp, POST /student/settings/delete-account.
 * Google-created accounts that never set a password skip the password field (the email code is the proof).
 * The deletion is a soft delete: the data is kept and the account can be restored with the same email.
 */
export default function DeleteAccountCard({ base, passwordRequired = true }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [step, setStep] = useState(0); // 0 collapsed | 1 password | 2 code
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  function reset() {
    setStep(0); setPassword(''); setOtp(''); setConfirm(false); setError(null); setInfo(null);
  }

  async function sendCode(e) {
    e?.preventDefault();
    if (busy || wait > 0) return;
    setBusy(true);
    setError(null);
    try {
      const json = await api.post(`${base}/delete-account/send-otp`, { password, locale });
      setInfo(ar ? `أرسلنا كودًا إلى ${json.data?.email}` : `We sent a code to ${json.data?.email}`);
      setWait(json.data?.retry_after || 60);
      setStep(2);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e) {
    e.preventDefault();
    if (busy || !confirm || !otp.trim()) return;
    if (!window.confirm(ar ? 'تأكيد أخير: هل أنت متأكد من حذف حسابك الآن؟' : 'Final check: delete your account now?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/delete-account`, { password, otp: otp.trim(), confirm: true, locale });
      clearTokens();
      window.location.assign('/auth/login');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="card glass-panel" style={{ borderColor: 'var(--color-danger)' }}>
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-2)', color: 'var(--color-danger)' }}>
        <Icon name="trash" size={18} /> {ar ? 'حذف الحساب' : 'Delete account'}
      </h2>
      <p className="text-small" style={{ marginBottom: 'var(--space-3)' }}>
        {ar
          ? 'لو سجّلت بالغلط أو مش عايز الحساب، تقدر تحذفه من هنا. هتحتاج كلمة السر وكودًا يصل إلى إيميلك.'
          : 'Signed up by mistake or no longer need the account? You can delete it here. You need your password and a code sent to your email.'}
      </p>

      {step === 0 && (
        <>
          <div className="cr-warn cr-warn--danger" role="alert">
            <Icon name="alert-triangle" size={18} />
            <ul>
              <li>{ar ? 'سيتم تسجيل خروجك من كل الأجهزة فورًا ولن تستطيع الدخول.' : 'You are signed out of every device immediately and can no longer sign in.'}</li>
              <li>{ar ? 'تُحفظ بياناتك لفترة محدودة، ويمكنك استرجاع الحساب بالتسجيل بنفس الإيميل وتأكيد كود.' : 'Your data is kept for a limited period; you can restore the account by signing up with the same email and confirming a code.'}</li>
            </ul>
          </div>
          <button type="button" className="btn btn-outline" style={{ marginTop: 'var(--space-3)', color: 'var(--color-danger)' }} onClick={() => setStep(1)}>
            <Icon name="trash" size={16} /> {ar ? 'أريد حذف حسابي' : 'I want to delete my account'}
          </button>
        </>
      )}

      {step === 1 && (
        <form onSubmit={sendCode} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {passwordRequired && (
            <div className="form-group">
              <label className="form-label">{ar ? 'كلمة السر الحالية' : 'Current password'}</label>
              <input className="form-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          )}
          {error && <p className="text-caption" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '…' : (ar ? 'إرسال الكود إلى إيميلي' : 'Email me a code')}</button>
            <button type="button" className="btn btn-outline" onClick={reset}>{ar ? 'تراجع' : 'Cancel'}</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={remove} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {info && <p className="text-small">{info}</p>}
          <div className="form-group">
            <label className="form-label">{ar ? 'كود التحقق' : 'Verification code'}</label>
            <input className="form-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || wait > 0} onClick={sendCode} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
              {wait > 0 ? (ar ? `إعادة الإرسال بعد ${wait} ث` : `Resend in ${wait}s`) : (ar ? 'إعادة إرسال الكود' : 'Resend code')}
            </button>
          </div>
          <label className="cr-confirm">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>{ar ? 'أفهم أن حسابي سيُحذف وأنني سأخرج من كل الأجهزة.' : 'I understand my account will be deleted and I will be signed out everywhere.'}</span>
          </label>
          {error && <p className="text-caption" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="submit" className="btn btn-primary" disabled={busy || !confirm || otp.length < 8} style={{ background: 'var(--color-danger)' }}>
              <Icon name="trash" size={16} /> {busy ? '…' : (ar ? 'حذف حسابي نهائيًا' : 'Delete my account')}
            </button>
            <button type="button" className="btn btn-outline" onClick={reset}>{ar ? 'تراجع' : 'Cancel'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
