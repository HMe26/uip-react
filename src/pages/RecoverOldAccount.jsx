import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import Icon from '../components/Icon';

/**
 * "Recover old account data" — for someone signed in with an email that used to belong to a DELETED account.
 *   GET  /auth/account-recovery/merge/candidates          -> deleted accounts of this email + what each can move
 *   POST /auth/account-recovery/merge/send    { deleted_uuid }
 *   POST /auth/account-recovery/merge/confirm { deleted_uuid, otp, groups[] }
 * The old account stays deleted; only the chosen groups of data move to this account.
 * Passwords, 2FA, sessions, roles and security logs never move.
 */
export default function RecoverOldAccount() {
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [picked, setPicked] = useState(null); // candidate
  const [groups, setGroups] = useState([]);
  const [step, setStep] = useState('pick'); // 'pick' | 'verify' | 'done'
  const [otp, setOtp] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/api/v1/auth/account-recovery/merge/candidates')
      .then((json) => setCandidates(json.data?.candidates || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  function choose(c) {
    setPicked(c);
    setGroups(c.groups.filter((g) => g.default && g.count > 0).map((g) => g.key));
  }

  const toggle = (key) => setGroups((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const json = await api.post('/api/v1/auth/account-recovery/merge/send', { deleted_uuid: picked.uuid });
      setMaskedEmail(json.data?.email || '');
      setCooldown(Number(json.data?.retry_after) || 60);
      setStep('verify');
    } catch (err) {
      const wait = err?.payload?.errors?.retry_after;
      if (wait) setCooldown(Number(wait));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const json = await api.post('/api/v1/auth/account-recovery/merge/confirm', { deleted_uuid: picked.uuid, otp, groups });
      setResult(json.data);
      setStep('done');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const movedTotal = result ? Object.values(result.moved || {}).reduce((a, b) => a + b, 0) : 0;
  const leftTotal = result ? Object.values(result.left_behind || {}).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="card glass-panel" style={{ maxWidth: 720, margin: '24px auto', padding: 24 }}>
      <h1 className="text-h3" style={{ marginTop: 0 }}>{tr('Recover old account data', 'استرجاع بيانات الحساب القديم')}</h1>
      <p>{tr(
        'If an account with your email was deleted before, you can move its data into this account. The old account stays deleted.',
        'لو كان عليه حساب بنفس إيميلك واتحذف قبل كده، تقدر تنقل بياناته للحساب ده. الحساب القديم بيفضل محذوف.'
      )}</p>
      {error && <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      {loading && <p>{tr('Loading…', 'جارٍ التحميل…')}</p>}

      {!loading && step === 'pick' && candidates.length === 0 && (
        <p>{tr('There is no deleted account for your email that can be recovered here. If you think there should be one, contact support.', 'مفيش حساب محذوف بإيميلك ينفع يتسترجع من هنا. لو شايف إن المفروض يكون فيه، كلّم الدعم.')}</p>
      )}

      {!loading && step === 'pick' && candidates.length > 0 && (
        <>
          {candidates.map((c) => (
            <label key={c.uuid} style={{ display: 'block', margin: '8px 0', cursor: 'pointer' }}>
              <input type="radio" name="old" checked={picked?.uuid === c.uuid} onChange={() => choose(c)} />{' '}
              <strong>{c.name}</strong> — {tr('deleted on', 'اتحذف في')} {String(c.deleted_at).slice(0, 10)}
            </label>
          ))}
          {picked && (
            <>
              <h2 className="text-h4">{tr('What do you want to move?', 'عايز تنقل إيه؟')}</h2>
              {picked.groups.map((g) => (
                <label key={g.key} style={{ display: 'block', margin: '6px 0', opacity: g.count ? 1 : 0.5 }}>
                  <input type="checkbox" disabled={!g.count} checked={groups.includes(g.key)} onChange={() => toggle(g.key)} />{' '}
                  {g.label} <small>({g.count})</small>
                </label>
              ))}
              <p style={{ fontSize: 13, opacity: 0.8 }}>{tr(
                'Passwords, two-factor, sessions, roles and security logs are never moved.',
                'كلمات السر والتحقق بخطوتين والجلسات والأدوار وسجلات الأمان مبتتنقلش أبدًا.'
              )}</p>
              <button type="button" className="btn btn-primary" disabled={busy || groups.length === 0} onClick={sendCode}>
                <Icon name="mail" size={16} /> {busy ? '…' : tr('Email me a code', 'ابعتلي الرمز على الإيميل')}
              </button>
            </>
          )}
        </>
      )}

      {step === 'verify' && (
        <form onSubmit={confirm}>
          <p>{tr('Code sent to', 'الرمز اتبعت إلى')} <strong dir="ltr">{maskedEmail}</strong></p>
          <input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="00000000"
            value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required autoFocus
            style={{ padding: 10, fontSize: 18, letterSpacing: 4, width: 220 }} />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || otp.length !== 8}>
              {busy ? '…' : tr('Move my data', 'انقل بياناتي')}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy || cooldown > 0} onClick={sendCode}>
              {cooldown > 0 ? `${tr('Resend in', 'إعادة الإرسال بعد')} ${cooldown}s` : tr('Resend the code', 'أعد إرسال الرمز')}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div role="status">
          <p><Icon name="check-circle" size={18} /> {tr(`Done. ${movedTotal} item(s) were moved to this account.`, `تمام. اتنقل ${movedTotal} عنصر للحساب ده.`)}</p>
          {leftTotal > 0 && <p>{tr(`${leftTotal} item(s) could not be moved because this account already has similar data; they stay with the old account.`, `${leftTotal} عنصر مااتنقلوش لأن الحساب ده عنده بيانات شبههم؛ فضلوا مع الحساب القديم.`)}</p>}
        </div>
      )}
    </div>
  );
}
