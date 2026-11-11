import { useLanguage } from '../../context/LanguageContext';
import { validateNames, NAME_MAX } from '../../utils/bilingualName';

/**
 * Two required inputs: the name in Arabic and the name in English.
 * Use for every person (student, doctor, supervisor, admin…) or institution
 * (university) the user types in.
 *
 *   <BilingualNameFields nameAr={ar} nameEn={en} onChange={(patch) => ...} />
 *
 * `onChange` receives `{ name_ar }` or `{ name_en }` — merge it into state.
 * `Field` (optional) is the page's own labelled-field wrapper
 * (`<Field label required>`); without it plain `.form-group` blocks are used.
 * `entity="university"` switches the labels to "University name".
 */
export default function BilingualNameFields({
  nameAr = '', nameEn = '', onChange, Field, entity = 'person', errors = {}, disabled = false, autoFocus = false,
}) {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const uni = entity === 'university';
  const labelAr = uni ? (isAr ? 'اسم الجامعة (بالعربي)' : 'University name (Arabic)') : (isAr ? 'الاسم بالعربي' : 'Name (Arabic)');
  const labelEn = uni ? (isAr ? 'اسم الجامعة (بالإنجليزي)' : 'University name (English)') : (isAr ? 'الاسم بالإنجليزي' : 'Name (English)');
  const phAr = uni ? 'جامعة القاهرة' : 'هيثم محمد كامل';
  const phEn = uni ? 'Cairo University' : 'Haitham Mohamed Kamel';

  const input = (value, key, ph, dir) => (
    <input
      className="form-input"
      value={value}
      onChange={(e) => onChange && onChange({ [key]: e.target.value })}
      placeholder={ph}
      dir={dir}
      lang={dir === 'rtl' ? 'ar' : 'en'}
      maxLength={NAME_MAX}
      required
      disabled={disabled}
      autoFocus={autoFocus && key === 'name_ar'}
      aria-invalid={errors[key] ? 'true' : undefined}
      style={dir === 'rtl' ? { textAlign: 'right' } : { textAlign: 'left' }}
    />
  );
  const err = (key) => (errors[key] ? <div className="form-error" style={{ color: 'var(--danger, #d33)', fontSize: 12, marginTop: 4 }}>{errors[key]}</div> : null);

  if (Field) {
    return (
      <>
        <Field label={labelAr} required>{input(nameAr, 'name_ar', phAr, 'rtl')}{err('name_ar')}</Field>
        <Field label={labelEn} required>{input(nameEn, 'name_en', phEn, 'ltr')}{err('name_en')}</Field>
      </>
    );
  }
  return (
    <>
      <div className="form-group">
        <label className="form-label">{labelAr} <span aria-hidden="true">*</span></label>
        {input(nameAr, 'name_ar', phAr, 'rtl')}{err('name_ar')}
      </div>
      <div className="form-group">
        <label className="form-label">{labelEn} <span aria-hidden="true">*</span></label>
        {input(nameEn, 'name_en', phEn, 'ltr')}{err('name_en')}
      </div>
    </>
  );
}

/** Convenience: validate before submit; returns the error message (or '') and sets field errors. */
export function checkNames(nameAr, nameEn, locale, setErrors) {
  const v = validateNames(nameAr, nameEn, locale);
  if (setErrors) setErrors(v.errors);
  return v.ok ? '' : Object.values(v.errors)[0];
}
