import { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { getMicrosoftConfig, microsoftSignInToken } from '../../lib/microsoftAuth';

const MicrosoftLogo = () => (
  <svg width="20" height="20" viewBox="0 0 23 23" aria-hidden="true">
    <path fill="#f25022" d="M1 1h10v10H1z" /><path fill="#7fba00" d="M12 1h10v10H12z" />
    <path fill="#00a4ef" d="M1 12h10v10H1z" /><path fill="#ffb900" d="M12 12h10v10H12z" />
  </svg>
);

/**
 * "Continue with Microsoft". Opens Microsoft's sign-in in a pop-up and calls onToken(idToken); the caller sends it to the API.
 * Renders nothing when Microsoft sign-in isn't configured on the backend (MS_CLIENT_ID) or inside the Android app.
 */
export default function MicrosoftSignInButton({ onToken, onError, disabled = false, onAvailable }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getMicrosoftConfig().then((c) => { if (alive) { setEnabled(!!c.enabled); onAvailable?.(!!c.enabled); } });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  async function click() {
    onError?.(null);
    setBusy(true);
    try {
      const idToken = await microsoftSignInToken();
      await onToken(idToken);
    } catch (e) {
      // closing the pop-up / pressing "cancel" is not an error worth showing
      if (!['popup_closed', 'access_denied'].includes(e?.code)) {
        onError?.(e?.message || (ar ? 'مقدرناش نسجّل الدخول بمايكروسوفت. جرّب تاني.' : "Couldn't sign in with Microsoft. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="auth-google auth-microsoft" onClick={click} disabled={disabled || busy}>
      <MicrosoftLogo />
      <span>{ar ? 'المتابعة بحساب مايكروسوفت' : 'Continue with Microsoft'}</span>
    </button>
  );
}
