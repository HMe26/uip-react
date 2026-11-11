import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../api/client';
import { roleHome } from '../../config/roleHome';
import { useLanguage } from '../../context/LanguageContext';
import { getGoogleConfig } from '../../lib/googleAuth';
import GoogleSignInButton from './GoogleSignInButton';
import MicrosoftSignInButton from './MicrosoftSignInButton';
import GithubSignInButton from './GithubSignInButton';

/**
 * The "or continue with Google" block used on Login and Register.
 *  - existing account  -> signed in, straight to its portal (or the 2FA step);
 *  - no account yet    -> /auth/google/complete, where the student fills in what Google couldn't give us.
 * Renders nothing when Google sign-in isn't configured.
 */
export default function GoogleAuthSection({ onError, placement = 'after' }) {
  const { loginWithGoogle, loginWithMicrosoft, loginWithGithub } = useAuth();
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [msEnabled, setMsEnabled] = useState(false);
  const [ghEnabled, setGhEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    getGoogleConfig().then((c) => { if (alive) setEnabled(c.enabled); });
    return () => { alive = false; };
  }, []);

  async function handleToken(idToken, provider = 'google') {
    onError?.(null);
    setBusy(true);
    try {
      // google / microsoft hand us an ID token to send to the API; github's pop-up flow already returns the API's answer.
      const r = await (provider === 'github' ? loginWithGithub : provider === 'microsoft' ? loginWithMicrosoft : loginWithGoogle)(idToken);
      if (r.needsRegistration) {
        navigate('/auth/google/complete', { state: { registration: r } });
      } else if (r.requiresTwoFactor) {
        navigate('/auth/two-factor', { state: { challengeToken: r.challengeToken } });
      } else {
        navigate(roleHome(r.role), { replace: true });
      }
    } catch (err) {
      onError?.(err instanceof ApiError ? errorMessage(err) : (locale === 'ar' ? 'حصل خطأ. جرّب تاني.' : 'Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const any = enabled || msEnabled || ghEnabled;

  const divider = (
    <div className="auth-divider" role="separator"><span>{locale === 'ar' ? 'أو' : 'or'}</span></div>
  );
  return (
    <div className={`auth-google-section auth-google-section--${placement}`} hidden={!any}>
      {any && placement === 'after' && divider}
      <GoogleSignInButton onToken={(t) => handleToken(t, 'google')} onError={onError} disabled={busy} />
      <MicrosoftSignInButton onToken={(t) => handleToken(t, 'microsoft')} onError={onError} disabled={busy} onAvailable={setMsEnabled} />
      <GithubSignInButton onResult={(d) => handleToken(d, 'github')} onError={onError} disabled={busy} onAvailable={setGhEnabled} />
      {any && placement === 'before' && divider}
    </div>
  );
}
