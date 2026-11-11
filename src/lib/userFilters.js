// Advanced filter model for /admin/users.
// One flat `filters` object <-> URL query string <-> API params. Keep the three in sync here only.

export const EMPTY_FILTERS = {
  q: '',
  role: [],            // multi
  status: [],          // multi ('deleted' is exclusive)
  university_id: '',
  faculty_id: '',
  department_id: '',
  academic_year: '',
  affiliation: '',     // '' | 'none' | 'has'
  invitation: '',      // '' | pending | accepted | expired | none
  verified: '',        // '' | yes | no
  two_factor: '',      // '' | yes | no
  locked: '',          // '' | yes | no
  joined: '',          // preset key, see JOINED_PRESETS
  joined_from: '',
  joined_to: '',
  login: '',           // preset key, see LOGIN_PRESETS
  login_from: '',
  login_to: '',
  email_domain: '',
  has_phone: '',
  has_avatar: '',
  sort: 'created_at',
  dir: 'desc',
  per_page: '20',
};

const MULTI = ['role', 'status'];
const DEFAULT_KEYS = { sort: 'created_at', dir: 'desc', per_page: '20' };

/** Date presets. value -> API params. */
export const JOINED_PRESETS = {
  d1:  { joined_within_days: 1 },
  d7:  { joined_within_days: 7 },
  d30: { joined_within_days: 30 },
  d90: { joined_within_days: 90 },
  y1:  { joined_before_days: 365 },   // joined more than a year ago
};
export const LOGIN_PRESETS = {
  never:      { last_login: 'never' },
  d1:         { active_within_days: 1 },
  d7:         { active_within_days: 7 },
  d30:        { active_within_days: 30 },
  inactive30: { inactive_days: 30 },
  inactive90: { inactive_days: 90 },
};

export const SORT_FIELDS = ['created_at', 'last_login_at', 'full_name', 'email', 'status', 'role'];

/** Read filters from a URLSearchParams (also understands the legacy ?status=&q=&university_id= links). */
export function filtersFromParams(sp) {
  const f = { ...EMPTY_FILTERS };
  for (const k of Object.keys(EMPTY_FILTERS)) {
    const v = sp.get(k);
    if (v == null || v === '') continue;
    f[k] = MULTI.includes(k) ? v.split(',').filter(Boolean) : v;
  }
  if (f.university_id === 'none') { f.university_id = ''; f.affiliation = 'none'; }
  if (!SORT_FIELDS.includes(f.sort)) f.sort = 'created_at';
  if (!['asc', 'desc'].includes(f.dir)) f.dir = 'desc';
  if (!['20', '50', '100'].includes(String(f.per_page))) f.per_page = '20';
  f.per_page = String(f.per_page);
  return f;
}

/** Only non-default values go in the URL so links stay short and shareable. */
export function filtersToParams(f) {
  const p = {};
  for (const [k, v] of Object.entries(f)) {
    if (MULTI.includes(k)) { if (v.length) p[k] = v.join(','); continue; }
    if (v === '' || v == null) continue;
    if (k in DEFAULT_KEYS && String(v) === DEFAULT_KEYS[k]) continue;
    p[k] = String(v);
  }
  return p;
}

/** Filters -> /api/v1/admin/users query params. */
export function filtersToApi(f, page) {
  const p = { page, per_page: Number(f.per_page) || 20, sort: f.sort, dir: f.dir };
  if (f.q.trim()) p.q = f.q.trim();
  if (f.role.length) p.role = f.role.join(',');
  if (f.status.length) p.status = f.status.join(',');
  for (const k of ['university_id', 'faculty_id', 'department_id', 'academic_year', 'affiliation', 'two_factor', 'locked', 'email_domain', 'has_phone', 'has_avatar']) {
    if (f[k]) p[k] = f[k];
  }
  if (f.invitation) p.invitation_status = f.invitation;
  if (f.verified) p.email_verified = f.verified;
  if (f.joined === 'custom') { if (f.joined_from) p.joined_from = f.joined_from; if (f.joined_to) p.joined_to = f.joined_to; }
  else if (JOINED_PRESETS[f.joined]) Object.assign(p, JOINED_PRESETS[f.joined]);
  if (f.login === 'custom') { if (f.login_from) p.last_login_from = f.login_from; if (f.login_to) p.last_login_to = f.login_to; }
  else if (LOGIN_PRESETS[f.login]) Object.assign(p, LOGIN_PRESETS[f.login]);
  return p;
}

/** Keys that count as "a filter" (everything except sort/paging). */
const FILTER_KEYS = Object.keys(EMPTY_FILTERS).filter((k) => !(k in DEFAULT_KEYS));

export function isFilterActive(f, k) {
  const v = f[k];
  return MULTI.includes(k) ? v.length > 0 : v !== '' && v != null;
}

export function activeFilterKeys(f) {
  // joined_from/to and login_from/to are folded into their preset chip.
  return FILTER_KEYS.filter((k) => isFilterActive(f, k) && !['joined_from', 'joined_to', 'login_from', 'login_to'].includes(k)
    && !(k === 'joined' && f.joined === 'custom' && !f.joined_from && !f.joined_to)
    && !(k === 'login' && f.login === 'custom' && !f.login_from && !f.login_to));
}

export function activeFilterCount(f) { return activeFilterKeys(f).length; }

/** Clear one filter key (handles dependent keys). */
export function clearKey(f, k) {
  const n = { ...f, [k]: MULTI.includes(k) ? [] : '' };
  if (k === 'university_id') { n.faculty_id = ''; n.department_id = ''; }
  if (k === 'faculty_id') { n.department_id = ''; }
  if (k === 'joined') { n.joined_from = ''; n.joined_to = ''; }
  if (k === 'login') { n.login_from = ''; n.login_to = ''; }
  return n;
}

/** One-click smart views. `patch` is merged into the filters; a view is "on" when all its patch keys match. */
export const QUICK_VIEWS = [
  { id: 'not_joined',  icon: 'mail',          en: 'Invited, not joined yet', ar: 'مدعوّين ولسه ماانضموش', patch: { invitation: 'pending' } },
  { id: 'unverified',  icon: 'alert-triangle', en: 'Email not verified',      ar: 'إيميل غير مُفعَّل',      patch: { verified: 'no' } },
  { id: 'new7',        icon: 'sparkles',      en: 'Joined last 7 days',      ar: 'انضموا آخر 7 أيام',      patch: { joined: 'd7' } },
  { id: 'old1y',       icon: 'history',       en: 'Joined over a year ago',  ar: 'منضمّين من أكتر من سنة', patch: { joined: 'y1' } },
  { id: 'never',       icon: 'eye-off',       en: 'Never signed in',         ar: 'ماسجّلوش دخول أبدًا',    patch: { login: 'never' } },
  { id: 'dormant',     icon: 'clock',         en: 'Inactive 30+ days',       ar: 'غير نشطين +30 يوم',      patch: { login: 'inactive30' } },
  { id: 'no_uni',      icon: 'building',      en: 'No university',           ar: 'بدون جامعة',             patch: { affiliation: 'none' } },
  { id: 'locked',      icon: 'lock',          en: 'Locked accounts',         ar: 'حسابات مقفولة',          patch: { locked: 'yes' } },
  { id: 'no2fa',       icon: 'shield',        en: 'No two-factor',           ar: 'بدون تحقق بخطوتين',      patch: { two_factor: 'no' } },
];

export function quickViewActive(f, v) {
  return Object.entries(v.patch).every(([k, val]) => f[k] === val);
}

/** Saved views live in this browser only. */
const VIEWS_KEY = 'uip_admin_users_saved_views';
export function loadSavedViews() {
  try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function storeSavedViews(list) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* storage blocked: views just won't persist */ }
}

/** "3 days ago" / "منذ 3 أيام" from an API datetime ("YYYY-MM-DD HH:MM:SS"). */
export function relativeTime(value, locale) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  for (const [unit, sec] of units) {
    if (Math.abs(diffSec) >= sec) return rtf.format(Math.round(diffSec / sec), unit);
  }
  return rtf.format(0, 'second');
}
