// Locale-aware pickers for bilingual API data.
//   L(t, en, ar)   -> name_en / name_ar style pairs
//   LO(t, {en, ar}) -> objects the API returns as { en, ar }
// `t` is the function returned by useTranslations(); it carries `t.locale`.
export const L = (t, en, ar) => ((t && t.locale === 'ar') ? (ar || en || '') : (en || ar || ''));
export const LO = (t, o) => {
  if (o == null) return '';
  if (typeof o !== 'object') return String(o);
  return L(t, o.en, o.ar);
};
