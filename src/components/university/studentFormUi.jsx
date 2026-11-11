import { useEffect } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/** Shell + building blocks for the Add / Edit student dialogs (styles/css/university-student-form.css, prefix sf-). */

const initialOf = (name) => (name || '').trim().charAt(0).toUpperCase() || '؟';

export function SfModal({ mode = 'add', title, subtitle, name, onClose, onSubmit, saving, submitLabel, submitDisabled, error, children }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay sf-overlay" onClick={onClose}>
      <form className="sf-modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sf-head">
          <span className={`sf-avatar${name?.trim() ? ' has-name' : ''}`} aria-hidden="true">
            {name?.trim() ? initialOf(name) : <Icon name={mode === 'edit' ? 'edit' : 'plus'} size={22} />}
          </span>
          <div className="sf-head__text">
            <h2>{title}</h2>
            <p>{name?.trim() || subtitle}</p>
          </div>
          <button type="button" className="sf-close" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="x" size={18} /></button>
        </header>

        <div className="sf-body">
          {children}
          {error && (
            <div className="sf-error" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>
          )}
        </div>

        <footer className="sf-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" className="btn btn-primary" disabled={saving || submitDisabled}>
            <Icon name="check" size={16} /> {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function SfSection({ icon, title, hint, children }) {
  return (
    <section className="sf-section">
      <div className="sf-section__head">
        <span className="sf-section__ico"><Icon name={icon} size={17} /></span>
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SfGrid({ children }) {
  return <div className="sf-grid">{children}</div>;
}

export function SfField({ label, hint, required, wide, children }) {
  return (
    <div className={`sf-field${wide ? ' is-wide' : ''}`}>
      <label className="sf-label">{label}{required && <i aria-hidden="true">*</i>}</label>
      {children}
      {hint && <small className="sf-hint">{hint}</small>}
    </div>
  );
}

/** Pick-one chips (academic year 1–8, semester 1/2). Clicking the active chip clears it. */
export function SfChoice({ value, onChange, options, label }) {
  const cur = value === '' || value == null ? '' : String(value);
  return (
    <div className="sf-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = cur === String(o);
        return (
          <button key={o} type="button" role="radio" aria-checked={on} className={`sf-chip${on ? ' is-on' : ''}`} onClick={() => onChange(on ? '' : String(o))}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** Read-only value row (e.g. the email, which cannot be changed from here). */
export function SfReadonly({ icon = 'mail', value, note }) {
  return (
    <div className="sf-readonly">
      <Icon name={icon} size={16} />
      <span dir="ltr">{value}</span>
      {note && <em>{note}</em>}
    </div>
  );
}
