import { AuthField } from './AuthField';

export const OTP_LENGTH = 6;

/** Keeps only digits (so a pasted "123 456" works) and caps the length. */
export const cleanOtp = (v) => String(v || '').replace(/\D+/g, '').slice(0, OTP_LENGTH);

/**
 * Pulls the code out of whatever was pasted: "123456", "123 456", "123-456" or a whole
 * sentence such as "Your reset code is 123456, valid for 15 minutes".
 */
export const extractOtp = (text) => {
  const raw = String(text || '');
  const m = raw.match(/(?<!\d)\d{6}(?!\d)/) || raw.match(/(?<!\d)(\d{3})[\s-](\d{3})(?!\d)/);
  return m ? m.slice(m.length > 1 && m[1] ? 1 : 0).join('').slice(0, OTP_LENGTH) : cleanOtp(raw);
};

/** onPaste handler: always accepts the paste, whatever its length or formatting. */
export const handleOtpPaste = (setValue) => (e) => {
  const text = e.clipboardData?.getData('text') || e.clipboardData?.getData('text/plain') || '';
  if (!text) return; // let the browser paste normally
  e.preventDefault();
  // normalise Arabic-Indic digits and invisible direction marks that e-mail clients add when copying
  const normalised = text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  setValue(extractOtp(normalised));
};

/**
 * One-time-code input for the email codes: numeric keypad on phones, OS autofill
 * from the SMS/mail suggestion, always LTR, large monospaced digits.
 */
export default function OtpField({ id = 'otp', label, value, onChange, error, hint, autoFocus }) {
  return (
    <AuthField
      id={id}
      label={label}
      icon="lock"
      ltr
      value={value}
      onChange={(e) => onChange(e.target.value.length > OTP_LENGTH ? extractOtp(e.target.value) : cleanOtp(e.target.value))}
      placeholder="••••••"
      inputMode="numeric"
      autoComplete="one-time-code"
      data-allow-clipboard="true"
      pattern="[0-9]*"
      onPaste={handleOtpPaste(onChange)}
      className="auth-otp-field"
      error={error}
      hint={hint}
      required
      autoFocus={autoFocus}
    />
  );
}
