import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../layouts/AuthLayout';
import Icon from '../components/Icon';
import { cleanOtp } from '../components/auth/OtpField';
import { useTranslations } from '../context/LanguageContext';

const translations = {
  'Your code': 'الرمز بتاعك',
  'Tap the button to copy the code, then paste it where it is asked.': 'اضغط الزرار لنسخ الرمز، وبعدها الصقه في المكان المطلوب.',
  'Copy code': 'نسخ الرمز',
  'Copied!': 'تم النسخ!',
  'Continue': 'متابعة',
  'Copy and continue': 'انسخ وكمّل',
  'Code copied. Taking you to the next step…': 'تم نسخ الرمز. جاري نقلك للخطوة الجاية…',
  'The code is missing or invalid. Open the link from the email again.': 'الرمز مش موجود أو غير صالح. افتح اللينك من الإيميل تاني.',
  'Back to sign in': 'رجوع لتسجيل الدخول',
};

/**
 * Opened from the "Copy code" button in the code e-mails (e-mail clients can't run scripts, so the
 * copy happens here). The code travels in the URL *fragment* (#code=123456): browsers never send
 * the fragment to a server, so it doesn't reach access logs or analytics.
 */
export default function CopyCode() {
  const t = useTranslations(translations);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [code] = useState(() => cleanOtp(new URLSearchParams(window.location.hash.replace(/^#/, '')).get('code')));
  const [copied, setCopied] = useState(false);
  const redirectTimer = useRef(null);
  const next = params.get('next') || ''; // optional: where to go after copying (same-origin path only)
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '';

  // Go to the next step with the code in the fragment, so the next page pre-fills it (never sent to a server).
  function goNext() {
    if (safeNext) navigate(`${safeNext}#code=${encodeURIComponent(code)}`, { replace: true });
  }

  async function copy(auto = false) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(code);
      ok = true;
    } catch {
      const el = document.getElementById('copy-code-value');
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        try { ok = document.execCommand('copy'); } catch { /* selected: the user can copy manually */ }
      }
    }
    if (!ok && auto) return; // browser wants a tap first: the button below does it
    setCopied(true);
    if (ok && safeNext) {
      // Copied: move on to the next step shortly (the code is on the clipboard and pre-filled there).
      redirectTimer.current = setTimeout(goNext, auto ? 1400 : 600);
    } else {
      setTimeout(() => setCopied(false), 2500);
    }
  }

  // Copy straight away when the page opens, so the e-mail button feels like a direct copy.
  useEffect(() => {
    if (code) copy(true);
    return () => clearTimeout(redirectTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the code out of history/screenshots of the address bar once it is read.
  useEffect(() => {
    if (code) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [code]);

  return (
    <AuthLayout
      title={t('Your code')}
      subtitle={code ? t('Tap the button to copy the code, then paste it where it is asked.') : undefined}
      error={code ? null : t('The code is missing or invalid. Open the link from the email again.')}
    >
      {code && (
        <>
          <div
            id="copy-code-value" dir="ltr"
            style={{ textAlign: 'center', fontFamily: 'var(--font-mono, ui-monospace, Consolas, monospace)', fontWeight: 800, fontSize: '2.4rem', letterSpacing: '0.35em', paddingInlineStart: '0.35em', padding: '18px 0', margin: '4px 0 18px', border: '2px dashed var(--a-line, #cbd5e1)', borderRadius: 16, userSelect: 'all' }}
          >
            {code}
          </div>
          <button type="button" className="auth-btn" onClick={() => copy(false)}>
            <span>{copied ? t('Copied!') : (safeNext ? t('Copy and continue') : t('Copy code'))}</span>
            <span className="auth-dir-icon"><Icon name={copied ? 'check' : 'copy'} size={18} /></span>
          </button>
          {safeNext && copied && (
            <p className="auth-footer-link" role="status" style={{ marginTop: 12 }}>{t('Code copied. Taking you to the next step…')}</p>
          )}
          {safeNext && (
            <div className="auth-footer-link">
              <a
                href={`${safeNext}#code=${encodeURIComponent(code)}`} className="auth-link"
                onClick={(e) => { e.preventDefault(); clearTimeout(redirectTimer.current); goNext(); }}
              >{t('Continue')}</a>
            </div>
          )}
        </>
      )}
      <div className="auth-footer-link">
        <Link to="/auth/login" className="auth-link auth-back">
          <span className="auth-dir-icon"><Icon name="arrow-left" size={16} /></span> {t('Back to sign in')}
        </Link>
      </div>
    </AuthLayout>
  );
}
