import { useState } from 'react';
import Icon from '../Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nShared from '../../i18n/auth/shared';

/**
 * Labelled input with a leading icon, an optional trailing adornment, a
 * hint and an inline error. Every auth form is built from these so spacing,
 * focus rings, RTL mirroring and touch targets are identical everywhere.
 * Text-like values (email, code…) are forced LTR inside an RTL page so an
 * address such as name@example.com never renders reversed.
 */
export function AuthField({
  id, label, icon, hint, error, labelAside, trailing, ltr = false, className = '', ...inputProps
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`auth-field ${error ? 'has-error' : ''} ${className}`}>
      {(label || labelAside) && (
        <div className="auth-field__head">
          {label && <label className="auth-field__label" htmlFor={id}>{label}</label>}
          {labelAside}
        </div>
      )}
      <div className="auth-field__control">
        {icon && <span className="auth-field__icon"><Icon name={icon} size={18} /></span>}
        <input
          id={id}
          name={id}
          className={`auth-field__input ${icon ? 'has-start' : ''} ${trailing ? 'has-end' : ''}`}
          dir={ltr ? 'ltr' : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          {...inputProps}
        />
        {trailing}
      </div>
      {hint && !error && <span className="auth-field__hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="auth-field__error" id={`${id}-error`} role="alert">{error}</span>}
    </div>
  );
}

/** Same shell as AuthField but wrapping a native <select>. */
export function AuthSelect({ id, label, icon, hint, children, ...selectProps }) {
  return (
    <div className="auth-field">
      {label && (
        <div className="auth-field__head">
          <label className="auth-field__label" htmlFor={id}>{label}</label>
        </div>
      )}
      <div className="auth-field__control">
        {icon && <span className="auth-field__icon"><Icon name={icon} size={18} /></span>}
        <select
          id={id}
          name={id}
          className={`auth-field__input auth-field__select ${icon ? 'has-start' : ''}`}
          {...selectProps}
        >
          {children}
        </select>
        <span className="auth-field__chevron"><Icon name="chevron-down" size={16} /></span>
      </div>
      {hint && <span className="auth-field__hint">{hint}</span>}
    </div>
  );
}

/** Rough, advisory-only strength score (0-4). The server stays the authority. */
function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  return s;
}

/**
 * Password input with show/hide, optional caps-lock notice and optional
 * strength meter. Drop-in for AuthField (same props).
 */
export function PasswordField({ showStrength = false, showCapsWarning = false, value, ...props }) {
  const t = useTranslations(i18nShared);
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const score = scorePassword(value);
  const labels = ['', t('Weak'), t('Fair'), t('Good'), t('Strong')];

  return (
    <div>
      <AuthField
        {...props}
        value={value}
        type={visible ? 'text' : 'password'}
        icon="lock"
        ltr
        onKeyUp={showCapsWarning ? (e) => setCaps(e.getModifierState?.('CapsLock') ?? false) : undefined}
        onBlur={() => setCaps(false)}
        trailing={
          <button
            type="button"
            className="auth-field__toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t('Hide password') : t('Show password')}
            aria-pressed={visible}
          >
            <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
          </button>
        }
      />
      {showCapsWarning && caps && (
        <p className="auth-caps" role="status">
          <Icon name="alert-triangle" size={14} /> {t('Caps Lock is on')}
        </p>
      )}
      {showStrength && value && (
        <div className="auth-strength" data-level={score} aria-live="polite">
          <div className="auth-strength__bars" aria-hidden="true"><i /><i /><i /><i /></div>
          <span className="auth-strength__label">{t('Password strength')}: {labels[Math.max(score, 1)]}</span>
        </div>
      )}
    </div>
  );
}
