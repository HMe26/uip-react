import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import TotpQrCode, { ManualKey } from '../../components/TotpQrCode';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Shared building blocks for every portal's Settings page.
 *
 * Every card below is a thin React wrapper around a real
 * /api/v1/{portal}/settings/* endpoint — same fields, same validation,
 * same business rules as the matching Api\*SettingsApiController (see
 * routes/api.php). Nothing here invents a field or an endpoint that
 * doesn't already exist on the backend; a portal that doesn't expose a
 * given endpoint
 * simply doesn't render that card.
 *
 * Ported from the same admin/settings.php + settings.js patterns already
 * used for src/pages/admin/AdminSettings.jsx — kept here instead of
 * duplicated per-portal so every card and every account-security flow
 * (password change, TOTP enrollment, team invite/role/activate/
 * deactivate/delete) works identically everywhere it appears.
 */

export const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' };
export const ROW_BETWEEN = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };

// -- Text for the cards below (English / Arabic) -----------------------------
const SHARED_TEXT = {
  en: {
    saved: 'Saved', saving: 'Saving…', verifying: 'Verifying…',
    notifTitle: 'Notification Preferences', notifHint: 'Control which kinds of notifications reach you, and when.',
    categories: 'Categories', emailFreq: 'Email frequency',
    immediate: 'Immediate (with every notification)', daily: 'Daily digest', weekly: 'Weekly digest',
    quiet: 'Quiet hours (no email during this window)', from: 'From', to: 'To', quietHint: 'Leave both empty to disable quiet hours.',
    savePrefs: 'Save Preferences',
    changePw: 'Change Password', currentPw: 'Current Password', newPw: 'New Password', confirmPw: 'Confirm New Password',
    security: 'Security', sessionTimeout: 'Session Timeout', minutes: 'minutes',
    twoFa: 'Two-Factor Authentication', twoFaEnabledMsg: 'Two-factor authentication enabled. Save these recovery codes — shown only once:',
    enabled: 'Enabled', currentPwPlaceholder: 'Current password', disable: 'Disable', disableConfirm: 'Disable two-factor authentication?',
    scan: 'Scan this into your authenticator app, or enter the key manually:', code6: '6-digit code', confirm: 'Confirm',
    twoFaHint: 'Adds an authenticator-app code at sign-in.', enable: 'Enable',
    changeEmail: 'Change Email', currentEmail: 'Current email', newEmail: 'New email',
    sendLink: 'Send confirmation link', emailHint: 'We send a confirmation link to the new address. Your email only changes after you open it.',
    emailSent: 'Confirmation link sent to', emailSentHint: 'Open the link in that inbox to finish. Until then your email stays the same.',
    pendingFor: 'Waiting for confirmation of', cancelChange: 'Cancel request',
  },
  ar: {
    saved: 'تم الحفظ', saving: 'جارٍ الحفظ…', verifying: 'جارٍ التحقق…',
    notifTitle: 'تفضيلات الإشعارات', notifHint: 'تحكّم في أنواع الإشعارات التي تصلك ووقت وصولها.',
    categories: 'الفئات', emailFreq: 'تكرار البريد الإلكتروني',
    immediate: 'فوري (مع كل إشعار)', daily: 'ملخص يومي', weekly: 'ملخص أسبوعي',
    quiet: 'ساعات الهدوء (بدون بريد خلال هذه الفترة)', from: 'من', to: 'إلى', quietHint: 'اترك الحقلين فارغين لإيقاف ساعات الهدوء.',
    savePrefs: 'حفظ التفضيلات',
    changePw: 'تغيير كلمة المرور', currentPw: 'كلمة المرور الحالية', newPw: 'كلمة المرور الجديدة', confirmPw: 'تأكيد كلمة المرور الجديدة',
    security: 'الأمان', sessionTimeout: 'مهلة الجلسة', minutes: 'دقيقة',
    twoFa: 'المصادقة الثنائية', twoFaEnabledMsg: 'تم تفعيل المصادقة الثنائية. احفظ رموز الاسترداد هذه — تظهر مرة واحدة فقط:',
    enabled: 'مفعّلة', currentPwPlaceholder: 'كلمة المرور الحالية', disable: 'إيقاف', disableConfirm: 'هل تريد إيقاف المصادقة الثنائية؟',
    scan: 'امسح الرمز بتطبيق المصادقة، أو أدخل المفتاح يدوياً:', code6: 'رمز من 6 أرقام', confirm: 'تأكيد',
    twoFaHint: 'يضيف رمزاً من تطبيق المصادقة عند تسجيل الدخول.', enable: 'تفعيل',
    changeEmail: 'تغيير البريد الإلكتروني', currentEmail: 'البريد الحالي', newEmail: 'البريد الجديد',
    sendLink: 'إرسال رابط التفعيل', emailHint: 'هنبعت رابط تفعيل على البريد الجديد. بريدك مش هيتغير غير بعد ما تفتح الرابط.',
    emailSent: 'تم إرسال رابط التفعيل إلى', emailSentHint: 'افتح الرابط من صندوق البريد ده لإتمام التغيير. لحد ما تفعّله بريدك يفضل زي ما هو.',
    pendingFor: 'في انتظار تفعيل', cancelChange: 'إلغاء الطلب',
  },
};

function useSharedText() {
  const { locale } = useLanguage();
  return { tx: SHARED_TEXT[locale] || SHARED_TEXT.en, locale };
}

export function SavedBadge({ show }) {
  const { tx } = useSharedText();
  if (!show) return null;
  return (
    <span className="badge badge-success" style={{ marginInlineStart: 'var(--space-2)' }}>
      <Icon name="check-circle" size={12} /> {tx.saved}
    </span>
  );
}

// -- Appearance / Language / Email toggle (Insight-style tiles) --------------
// Shared by every portal's Settings page. Theme and language are applied to
// the page immediately (ThemeContext / LanguageContext). `persist` is the
// portal's own "save to my account" call — pass it ONLY when that portal's
// API has such an endpoint; without it the choice is still applied live and
// remembered by the contexts (localStorage), exactly like the topbar toggles.

const PREF_TEXT = {
  en: {
    appearance: 'Appearance', appearanceHint: 'Choose how UIPE looks for you — it applies to every page and is remembered on this device.', theme: 'Theme', light: 'Light', classic: 'Classic', dark: 'Dark',
    lightHint: 'Clean white', classicHint: 'Indigo on soft blue-grey', darkHint: 'Easy on the eyes at night',
    language: 'Language', languageHint: 'Interface language for the whole portal.',
    email: 'Email Notifications', emailHint: 'Get emailed about important activity.',
  },
  ar: {
    appearance: 'المظهر', appearanceHint: 'اختر شكل UIPE المناسب لك — يُطبَّق على كل الصفحات ويُحفظ على هذا الجهاز.', theme: 'السمة', light: 'فاتح', classic: 'كلاسيكي', dark: 'داكن',
    lightHint: 'أبيض نظيف', classicHint: 'نيلي على رمادي مزرق هادئ', darkHint: 'مريح للعين ليلاً',
    language: 'اللغة', languageHint: 'لغة الواجهة في البوابة كلها.',
    email: 'إشعارات البريد', emailHint: 'استلم رسائل بريد عن النشاط المهم.',
  },
};

// Runs `persist(value)` (if any) and tracks saving/saved/error for the card.
function usePersist(persist) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  async function run(value) {
    if (!persist) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      await persist(value);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  return { saving, saved, error, run };
}

// The platform's three looks (same swatches as the topbar menu and sidebar switch, so all three always agree).
// `sw` = [accent, canvas] for the mini preview; the dark tile is drawn by .theme-option--dark in CSS.
const LOOKS = [
  { mode: 'light', theme: 'light', textKey: 'light', hintKey: 'lightHint', sw: ['#515FFF', '#FBFBFC'] },
  { mode: 'classic', theme: 'light', textKey: 'classic', hintKey: 'classicHint', sw: ['#515FFF', '#EEF0FF'] },
  { mode: 'dark', theme: 'dark', textKey: 'dark', hintKey: 'darkHint' },
];

export function AppearanceCard({ persist }) {
  const { locale } = useLanguage();
  const tx = PREF_TEXT[locale] || PREF_TEXT.en;
  const { theme, mode, setMode } = useTheme();
  const { saving, saved, error, run } = usePersist(persist);
  const choose = (o) => {
    setMode(o.mode);                                   // applies live to every page, remembered on this device
    if (o.theme !== theme) run(o.theme);               // the account only stores light / dark
  };
  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 4 }}>{tx.appearance} <SavedBadge show={saved} /></h2>
      <p className="text-small" style={{ marginBottom: 20 }}>{tx.appearanceHint}</p>
      <div className="theme-options" role="radiogroup" aria-label={tx.theme}>
        {LOOKS.map((o) => (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={mode === o.mode}
            disabled={saving}
            className={`theme-option theme-option--${o.theme} theme-option--${o.mode}${mode === o.mode ? ' is-selected' : ''}`}
            onClick={() => choose(o)}
          >
            <span className="theme-option__preview" style={o.sw ? { '--pv-a': o.sw[0], '--pv-b': `color-mix(in srgb, ${o.sw[0]} 22%, #fff)`, '--pv-bg': o.sw[1] } : undefined}><i /><i /></span>
            <span className="theme-option__label">{tx[o.textKey]}</span>
            <span className="theme-option__hint">{tx[o.hintKey]}</span>
          </button>
        ))}
      </div>
      {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}

export function LanguageCard({ persist }) {
  const { locale, setLocale } = useLanguage();
  const tx = PREF_TEXT[locale] || PREF_TEXT.en;
  const { saving, saved, error, run } = usePersist(persist);
  const choose = (value) => {
    if (value === locale) return;
    setLocale(value);
    run(value);
  };
  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 4 }}>{tx.language} <SavedBadge show={saved} /></h2>
      <p className="text-small" style={{ marginBottom: 20 }}>{tx.languageHint}</p>
      <div className="theme-options" role="radiogroup" aria-label={tx.language}>
        {[['en', 'English'], ['ar', 'العربية']].map(([value, name]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={locale === value}
            disabled={saving}
            className={`theme-option${locale === value ? ' is-selected' : ''}`}
            onClick={() => choose(value)}
          >
            <span className="theme-option__label" style={{ fontSize: 18 }}>{name}</span>
          </button>
        ))}
      </div>
      {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}

export function EmailToggleCard({ initial, persist, description }) {
  const { locale } = useLanguage();
  const tx = PREF_TEXT[locale] || PREF_TEXT.en;
  const [on, setOn] = useState(!!initial);
  const { saving, saved, error, run } = usePersist(persist);
  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 16 }}>{tx.email} <SavedBadge show={saved} /></h2>
      <ul className="pref-list">
        <li className="pref-item">
          <label htmlFor="pref-email-toggle" className="pref-item__label">{description || tx.emailHint}</label>
          <span className="switch">
            <input
              id="pref-email-toggle"
              type="checkbox"
              disabled={saving}
              checked={on}
              onChange={(e) => { setOn(e.target.checked); run(e.target.checked); }}
            />
            <span className="switch__track" aria-hidden="true" />
          </span>
        </li>
      </ul>
      {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}

// -- Notification category / digest / quiet-hours preferences ---------------
// Same shape + endpoint suffix ("/notifications") on every portal that has
// it: admin, student.

export function NotificationsCard({ base, path = '/notifications', categories, mutedInitial, digestInitial, quietHoursInitial }) {
  const { tx, locale } = useSharedText();
  const allKeys = Object.keys(categories || {});
  const [enabled, setEnabled] = useState(
    () => new Set(allKeys.filter((k) => !(mutedInitial || []).includes(k)))
  );
  const [digest, setDigest] = useState(digestInitial || 'immediate');
  const [quietStart, setQuietStart] = useState(quietHoursInitial?.start || '');
  const [quietEnd, setQuietEnd] = useState(quietHoursInitial?.end || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  function toggleCategory(key) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setSaved(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`${base}${path}`, {
        enabled_categories: Array.from(enabled),
        digest_frequency: digest,
        quiet_hours_start: quietStart,
        quiet_hours_end: quietEnd,
      });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>
        <Icon name="bell" size={18} /> {tx.notifTitle} <SavedBadge show={saved} />
      </h2>
      <p className="pref-hint" style={{ marginBottom: 'var(--space-5)' }}>
        {tx.notifHint}
      </p>
      <form onSubmit={handleSubmit}>
        <fieldset className="pref-group">
          <legend className="pref-group__title">{tx.categories}</legend>
          <ul className="pref-list">
            {allKeys.map((key) => {
              const id = `notif-cat-${key}`;
              return (
                <li key={key} className="pref-item">
                  <label htmlFor={id} className="pref-item__label">{categories[key]?.[locale] ?? categories[key]?.en ?? key}</label>
                  <span className="switch">
                    <input id={id} type="checkbox" checked={enabled.has(key)} onChange={() => toggleCategory(key)} />
                    <span className="switch__track" aria-hidden="true" />
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="pref-field">
          <label className="pref-group__title" htmlFor="notif-digest">{tx.emailFreq}</label>
          <select id="notif-digest" className="form-select" value={digest} onChange={(e) => { setDigest(e.target.value); setSaved(false); }}>
            <option value="immediate">{tx.immediate}</option>
            <option value="daily">{tx.daily}</option>
            <option value="weekly">{tx.weekly}</option>
          </select>
        </div>

        <div className="pref-field">
          <span className="pref-group__title">{tx.quiet}</span>
          <div className="pref-times">
            <label className="pref-time">
              <span>{tx.from}</span>
              <input className="form-input" type="time" value={quietStart} onChange={(e) => { setQuietStart(e.target.value); setSaved(false); }} />
            </label>
            <label className="pref-time">
              <span>{tx.to}</span>
              <input className="form-input" type="time" value={quietEnd} onChange={(e) => { setQuietEnd(e.target.value); setSaved(false); }} />
            </label>
          </div>
          <p className="pref-hint">{tx.quietHint}</p>
        </div>

        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Icon name="check" size={16} /> {saving ? tx.saving : tx.savePrefs}
        </button>
      </form>
    </div>
  );
}

// -- Email change ------------------------------------------------------------
// POST /api/v1/auth/email-change { new_email, current_password } -> confirmation link goes to the NEW address.
// The email only changes after that link is opened; otherwise it stays as is.

export function EmailChangeCard() {
  const { tx } = useSharedText();
  const [current, setCurrent] = useState('');
  const [pending, setPending] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/auth/email-change')
      .then((json) => { if (!cancelled) { setCurrent(json.data?.email || ''); setPending(json.data?.pending_email || null); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSentTo(null);
    try {
      const json = await api.post('/api/v1/auth/email-change', { new_email: newEmail.trim(), current_password: password });
      setSentTo(json.data?.pending_email || newEmail.trim());
      setPending(json.data?.pending_email || newEmail.trim());
      setNewEmail('');
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    try {
      await api.delete('/api/v1/auth/email-change');
      setPending(null);
      setSentTo(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{tx.changeEmail}</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div className="form-group">
          <label className="form-label">{tx.currentEmail}</label>
          <input className="form-input" type="email" dir="ltr" value={current} disabled readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">{tx.newEmail}</label>
          <input className="form-input" type="email" dir="ltr" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setSentTo(null); }} autoComplete="email" required />
        </div>
        <div className="form-group">
          <label className="form-label">{tx.currentPw}</label>
          <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <p className="text-caption">{tx.emailHint}</p>
        {sentTo && (
          <p className="text-caption" style={{ color: 'var(--color-success)' }}>
            {tx.emailSent} <strong dir="ltr">{sentTo}</strong>. {tx.emailSentHint}
          </p>
        )}
        {pending && !sentTo && (
          <p className="text-caption">
            {tx.pendingFor} <strong dir="ltr">{pending}</strong>{' '}
            <button type="button" className="btn btn-ghost" onClick={handleCancel}>{tx.cancelChange}</button>
          </p>
        )}
        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving || !newEmail.trim()} style={{ alignSelf: 'flex-start' }}>
          <Icon name="mail" size={16} /> {saving ? tx.saving : tx.sendLink}
        </button>
      </form>
    </div>
  );
}

// -- Password change ---------------------------------------------------------
// PATCH {base}/password — { current_password, new_password, new_password_confirmation }.

export function PasswordCard({ base }) {
  const { tx } = useSharedText();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`${base}/password`, {
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirmation: confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <EmailChangeCard />
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>
        {tx.changePw} <SavedBadge show={saved} />
      </h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div className="form-group">
          <label className="form-label">{tx.currentPw}</label>
          <input className="form-input" type="password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setSaved(false); }} required />
        </div>
        <div className="form-group">
          <label className="form-label">{tx.newPw}</label>
          <input className="form-input" type="password" value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setSaved(false); }} minLength={8} required />
        </div>
        <div className="form-group">
          <label className="form-label">{tx.confirmPw}</label>
          <input className="form-input" type="password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setSaved(false); }} minLength={8} required />
        </div>
        {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          <Icon name="lock" size={16} /> {saving ? tx.saving : tx.changePw}
        </button>
      </form>
    </div>
    </>
  );
}

// -- Two-Factor Authentication (TOTP + recovery codes) -----------------------
// POST {base}/2fa/setup, {base}/2fa/confirm, {base}/2fa/disable.

export function TwoFactorCard({ base, sessionMinutes, twoFactorInitial }) {
  const { tx } = useSharedText();
  const [twoFactor, setTwoFactor] = useState(twoFactorInitial);
  const [stage, setStage] = useState('idle'); // idle | setup | confirmed
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const json = await api.post(`${base}/2fa/setup`, {});
      setSetup(json.data);
      setStage('setup');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const json = await api.post(`${base}/2fa/confirm`, { code, setup_token: setup?.setup_token });
      setRecoveryCodes(json.data?.recovery_codes || []);
      setTwoFactor({ enabled: true, confirmed_at: new Date().toISOString() });
      setStage('confirmed');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(e) {
    e.preventDefault();
    if (!window.confirm(tx.disableConfirm)) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`${base}/2fa/disable`, { current_password: currentPassword });
      setTwoFactor({ enabled: false, confirmed_at: null });
      setCurrentPassword('');
      setStage('idle');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card glass-panel">
      <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{tx.security}</h2>
      {sessionMinutes != null && (
        <div className="form-group">
          <label className="form-label">{tx.sessionTimeout}</label>
          <input className="form-input" type="text" value={`${sessionMinutes} ${tx.minutes}`} disabled />
        </div>
      )}

      {stage === 'confirmed' && recoveryCodes && (
        <div className="form-group">
          <p className="text-small" style={{ fontWeight: 600 }}>
            {tx.twoFaEnabledMsg}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 'var(--text-small)' }}>
            {recoveryCodes.join('\n')}
          </pre>
        </div>
      )}

      {twoFactor?.enabled ? (
        <>
          <div className="form-group" style={ROW_BETWEEN}>
            <label className="form-label" style={{ margin: 0 }}>{tx.twoFa}</label>
            <span className="badge badge-success"><Icon name="check-circle" size={12} /> {tx.enabled}</span>
          </div>
          <form onSubmit={handleDisable} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <input
              className="form-input"
              type="password"
              placeholder={tx.currentPwPlaceholder}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            <button type="submit" className="btn btn-outline btn-sm" style={{ color: 'var(--color-danger)' }} disabled={busy}>
              {tx.disable}
            </button>
          </form>
        </>
      ) : stage === 'setup' && setup ? (
        <form onSubmit={confirmSetup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <p className="text-small">{tx.scan}</p>
          {setup.otpauth_uri && (
            <div style={{ textAlign: 'center', margin: 'var(--space-2) 0' }}>
              <TotpQrCode uri={setup.otpauth_uri} />
            </div>
          )}
          <ManualKey className="text-caption" style={{ fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center' }} value={setup.manual_key} />
          <input
            className="form-input text-mono"
            style={{ letterSpacing: '4px', textAlign: 'center' }}
            type="text"
            inputMode="numeric"
            placeholder={tx.code6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <p className="text-caption" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Icon name="shield" size={16} /> {busy ? tx.verifying : tx.confirm}
          </button>
        </form>
      ) : (
        <div className="form-group" style={ROW_BETWEEN}>
          <div>
            <label className="form-label" style={{ margin: 0 }}>{tx.twoFa}</label>
            <p className="text-caption" style={{ margin: '2px 0 0' }}>{tx.twoFaHint}</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={startSetup} disabled={busy}>
            <Icon name="shield" size={16} /> {tx.enable}
          </button>
        </div>
      )}
    </div>
  );
}
