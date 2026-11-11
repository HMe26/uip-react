// Every person/entity on the platform has an Arabic AND an English name.
// Mirrors App\Support\BilingualName on the API so mistakes show before submit.

export const NAME_MAX = 150;

export const hasArabic = (s) => /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(s || '');
export const hasLatin = (s) => /[A-Za-zÀ-ɏ]/.test(s || '');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** @returns {{ok:boolean, errors:{name_ar?:string,name_en?:string}, name_ar:string, name_en:string}} */
export function validateNames(nameAr, nameEn, locale = 'ar') {
  const isAr = locale === 'ar';
  const ar = clean(nameAr);
  const en = clean(nameEn);
  const errors = {};
  if (!ar) errors.name_ar = isAr ? 'الاسم بالعربي مطلوب.' : 'The Arabic name is required.';
  else if (ar.length < 2 || ar.length > NAME_MAX) errors.name_ar = isAr ? 'الاسم بالعربي لازم يكون من 2 إلى 150 حرف.' : 'The Arabic name must be 2–150 characters.';
  else if (!hasArabic(ar)) errors.name_ar = isAr ? 'اكتب الاسم بالحروف العربية.' : 'Write the Arabic name using Arabic letters.';
  if (!en) errors.name_en = isAr ? 'الاسم بالإنجليزي مطلوب.' : 'The English name is required.';
  else if (en.length < 2 || en.length > NAME_MAX) errors.name_en = isAr ? 'الاسم بالإنجليزي لازم يكون من 2 إلى 150 حرف.' : 'The English name must be 2–150 characters.';
  else if (hasArabic(en) || !hasLatin(en)) errors.name_en = isAr ? 'اكتب الاسم بالحروف الإنجليزية.' : 'Write the English name using English letters.';
  return { ok: !Object.keys(errors).length, errors, name_ar: ar, name_en: en };
}

/**
 * Name of a person/entity record in the viewer's language.
 * Works with API rows carrying name_ar / name_en (users, students, staff…),
 * falling back to the other language, then to the legacy single name.
 */
export function personName(row, locale = 'ar', fallback = '') {
  if (!row) return fallback;
  const ar = clean(row.name_ar);
  const en = clean(row.name_en);
  const primary = locale === 'ar' ? ar : en;
  const secondary = locale === 'ar' ? en : ar;
  return primary || secondary || clean(row.full_name) || clean(row.name) || fallback;
}
