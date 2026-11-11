import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { ApiError } from '../../context/AuthContext';
import { getGateToken, setGateToken, STAFF_GATE_LOST_EVENT } from '../../config/staffGate';
import Icon from '../Icon';
import StaffShell, { useStaffText } from './StaffShell';

/**
 * Access-code screen in front of the hidden staff pages. Children (the sign-in form) are not rendered
 * at all until the server has accepted a code; the server also refuses the sign-in request without the
 * ticket it hands back, so skipping this screen gets nobody anywhere.
 */
export default function StaffGate({ children }) {
  const t = useStaffText();
  const [passed, setPassed] = useState(() => !!getGateToken());
  const [required, setRequired] = useState(true);
  const [checking, setChecking] = useState(!getGateToken());
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [wait, setWait] = useState(0); // seconds left of a lock-out
  const [shake, setShake] = useState(0); // bumps on a wrong code so the field shakes again

  // Is the gate switched off on the server (STAFF_GATE_ENABLED=false)?
  useEffect(() => {
    if (passed) return undefined;
    let alive = true;
    api.get('/api/v1/auth/staff-gate')
      .then((json) => { if (alive && json?.data?.required === false) { setRequired(false); setPassed(true); } })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [passed]);

  // The sign-in request was refused for a missing / expired ticket: ask for the code again.
  useEffect(() => {
    const lost = () => { setPassed(false); setRequired(true); setCode(''); };
    window.addEventListener(STAFF_GATE_LOST_EVENT, lost);
    return () => window.removeEventListener(STAFF_GATE_LOST_EVENT, lost);
  }, []);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait]);

  async function submit(e) {
    e.preventDefault();
    if (!code.trim() || wait > 0) return;
    setBusy(true); setError(null);
    try {
      const json = await api.post('/api/v1/auth/staff-gate', { code: code.trim() });
      if (json.data?.gate_token) setGateToken(json.data.gate_token, json.data.expires_in || 1800);
      setPassed(true);
    } catch (err) {
      const d = err instanceof ApiError ? err.payload?.data : null;
      setCode('');
      setShake((n) => n + 1);
      if (d?.retry_after > 0) setWait(Number(d.retry_after));
      setError(err instanceof ApiError ? errorMessage(err) : t('Something went wrong. Try again.', 'حصل خطأ. جرّب تاني.'));
    } finally {
      setBusy(false);
    }
  }

  if (passed || !required) return children;
  if (checking) return <StaffShell><p className="sl-form__lead">…</p></StaffShell>;

  const mins = Math.floor(wait / 60);
  const secs = String(wait % 60).padStart(2, '0');

  return (
    <StaffShell>
      <h1 id="sl-title">{t('Access code', 'كود الدخول')}</h1>
      <p className="sl-form__lead">{t('Enter the access code to continue.', 'اكتب كود الدخول للمتابعة.')}</p>

      {error && <div className="sl-error" role="alert"><Icon name="alert-triangle" size={17} /> <span>{error}</span></div>}
      {wait > 0 && <div className="sl-error" role="status"><Icon name="lock" size={17} /> <span>{t('Locked. Try again in', 'تم القفل. حاول تاني بعد')} {mins}:{secs}</span></div>}

      <form onSubmit={submit}>
        <label className="sl-field sl-field--code">
          <span>{t('Code', 'الكود')}</span>
          <span key={shake} className={`sl-pass ${shake ? 'is-shaking' : ''}`}>
            <input
              type={show ? 'text' : 'password'} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)}
              autoComplete="off" inputMode="numeric" spellCheck={false} maxLength={64}
              placeholder="••••" required autoFocus disabled={wait > 0}
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide code', 'إخفاء الكود') : t('Show code', 'إظهار الكود')}>
              <Icon name={show ? 'eye-off' : 'eye'} size={18} />
            </button>
          </span>
        </label>
        <button type="submit" className="sl-submit" disabled={busy || wait > 0 || !code.trim()}>
          {busy ? t('Checking…', 'جارٍ التحقق…') : t('Continue', 'متابعة')}
          {!busy && <Icon name="arrow-right" size={18} />}
        </button>
      </form>

      <div className="sl-foot">
        <p>{t('Not staff, or opened this page by mistake? Students, universities and teaching staff sign in from the main page.', 'مش من فريق المنصة أو فتحت الصفحة بالغلط؟ الطلاب والجامعات وأعضاء هيئة التدريس بيدخلوا من الصفحة الرئيسية.')}</p>
        <Link to="/auth/login" className="sl-alt">
          {t('Go to the main sign-in', 'الذهاب لصفحة الدخول الرئيسية')}
          <Icon name="arrow-right" size={16} />
        </Link>
      </div>
    </StaffShell>
  );
}
