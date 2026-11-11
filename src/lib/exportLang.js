/**
 * Language of the file being exported (Arabic / English) — chosen in the export menu.
 *
 * While an export runs (withExportLang), the api client sends `lang=<code>` and
 * `X-Locale` for every request, so the server writes the report title / column
 * names in that language and client-side builders pick the matching direction.
 */
const KEY = 'uip_export_lang';
let active = null;

export const getExportLang = () => active;

export async function withExportLang(lang, fn) {
  const prev = active;
  active = lang === 'ar' ? 'ar' : 'en';
  try { return await fn(); } finally { active = prev; }
}

/** Starts from the platform language; remembers the last pick only while the platform language is unchanged. */
export function getPreferredExportLang(platformLang) {
  try {
    const [forLocale, lang] = String(localStorage.getItem(KEY) || '').split(':');
    if (forLocale === platformLang && (lang === 'ar' || lang === 'en')) return lang;
  } catch { /* storage unavailable */ }
  return platformLang;
}

export function setPreferredExportLang(platformLang, lang) {
  try { localStorage.setItem(KEY, `${platformLang}:${lang}`); } catch { /* ignore */ }
}
