import { useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { generatePassword } from './credentials';

/**
 * Shared look for the "Add …" dialogs (student / doctor-TA / supervisor).
 * Styles: styles/css/people-forms.css (`pf-*`).
 */

export function FormModal({ title, subtitle, icon = 'users', onClose, onSubmit, saving, submitLabel, submitDisabled, error, children }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="pf-modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <header className="pf-head">
          <span className="pf-head__icon"><Icon name={icon} size={20} /></span>
          <div className="pf-head__text">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="pf-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="x" size={18} /></button>
        </header>

        <div className="pf-body">
          {children}
          {error && (
            <div className="pf-error" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>
          )}
        </div>

        <footer className="pf-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" className="btn btn-primary" disabled={saving || submitDisabled}>
            {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function FormSection({ title, hint, children }) {
  return (
    <section className="pf-section">
      <div className="pf-section__head">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function FieldGrid({ children }) {
  return <div className="pf-grid">{children}</div>;
}

export function Field({ label, hint, required, wide, children }) {
  return (
    <div className={`pf-field${wide ? ' is-wide' : ''}`}>
      <label className="pf-label">{label}{required && <i aria-hidden="true">*</i>}</label>
      {children}
      {hint && <small className="pf-hint">{hint}</small>}
    </div>
  );
}

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  return s;
}

/**
 * "Login access" block: auto-generate (backend generates it; shown to the admin after saving)
 * or set a password manually (show/hide, generate, copy, strength meter).
 * `password` is '' in auto mode. Pass onSendEmail to also offer "email the login details".
 */
export function LoginAccess({ password, onPassword, sendEmail, onSendEmail, who }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [manual, setManual] = useState(!!password);
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const pw = password || '';
  const score = strength(pw);
  const labels = ar ? ['ضعيفة', 'ضعيفة', 'متوسطة', 'جيدة', 'قوية'] : ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];

  function pick(isManual) {
    setManual(isManual);
    onPassword(isManual ? generatePassword() : '');
    setVisible(true);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(pw); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  return (
    <div className="pf-login">
      <div className="pf-opts" role="radiogroup" aria-label={ar ? 'كلمة السر' : 'Password'}>
        <button type="button" role="radio" aria-checked={!manual} className={`pf-opt${!manual ? ' is-on' : ''}`} onClick={() => pick(false)}>
          <Icon name="refresh" size={16} />
          <b>{ar ? 'توليد تلقائي' : 'Auto-generate'}</b>
          <small>{ar ? 'نولّد كلمة سر قوية ونعرضها لك بعد الحفظ.' : 'A strong password is generated and shown to you after saving.'}</small>
        </button>
        <button type="button" role="radio" aria-checked={manual} className={`pf-opt${manual ? ' is-on' : ''}`} onClick={() => pick(true)}>
          <Icon name="key" size={16} />
          <b>{ar ? 'أحدده بنفسي' : 'Set it myself'}</b>
          <small>{ar ? 'اكتب كلمة السر التي تريد تسليمها.' : 'Type the password you want to hand over.'}</small>
        </button>
      </div>

      {manual && (
        <div className="pf-pw">
          <div className="pf-pw__row">
            <input
              className="form-input"
              type={visible ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={8}
              maxLength={64}
              value={pw}
              onChange={(e) => onPassword(e.target.value)}
              placeholder={ar ? 'كلمة السر (8 أحرف على الأقل)' : 'Password (min. 8 characters)'}
              style={{ fontFamily: 'ui-monospace, monospace' }}
            />
            <button type="button" className="pf-iconbtn" onClick={() => setVisible((v) => !v)} title={visible ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'إظهار' : 'Show')}>
              <Icon name={visible ? 'eye-off' : 'eye'} size={16} />
            </button>
            <button type="button" className="pf-iconbtn" onClick={() => onPassword(generatePassword())} title={ar ? 'توليد جديد' : 'Generate new'}>
              <Icon name="refresh" size={16} />
            </button>
            <button type="button" className="pf-iconbtn" onClick={copy} title={ar ? 'نسخ' : 'Copy'} disabled={!pw}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
            </button>
          </div>
          <div className="pf-meter" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => <i key={i} className={i <= score ? `on s${score}` : ''} />)}
            <span>{pw ? labels[score] : ''}</span>
          </div>
          {pw && pw.length < 8 && <small className="pf-hint pf-hint--bad">{ar ? 'يجب ألا تقل عن 8 أحرف.' : 'Must be at least 8 characters.'}</small>}
        </div>
      )}

      {onSendEmail && (
        <label className="pf-check">
          <input type="checkbox" checked={!!sendEmail} onChange={(e) => onSendEmail(e.target.checked)} />
          <span>
            <b>{ar ? `إرسال بيانات الدخول إلى بريد ${who}` : `Email the login details to ${who}`}</b>
            <small>{ar ? 'اتركه مفعّلًا إن كان إعداد البريد يعمل. وفي كل الأحوال ستظهر لك البيانات بعد الحفظ.' : 'Leave on if email is configured. Either way you will see the credentials after saving.'}</small>
          </span>
        </label>
      )}
    </div>
  );
}
