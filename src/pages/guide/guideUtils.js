import { getNavConfig, SECTION_TITLES } from '../../config/navConfig';

/** Guide portal slug -> the role whose sidebar (navConfig) describes that portal. */
export const PORTAL_ROLE = {
  student: 'student',
  university: 'university',
  faculty: 'faculty',
  'academic-staff': 'academic_staff',
  supervisor: 'supervisor',
  'data-analysis': 'data_analyst',
  security: 'security_admin',
  admin: 'admin',
};

export const PORTAL_NAMES = {
  student: { ar: 'بوابة الطالب', en: 'Student portal' },
  university: { ar: 'بوابة الجامعة', en: 'University portal' },
  faculty: { ar: 'بوابة الكلية', en: 'Faculty portal' },
  'academic-staff': { ar: 'بوابة عضو هيئة التدريس', en: 'Academic staff portal' },
  supervisor: { ar: 'بوابة المشرف', en: 'Supervisor portal' },
  'data-analysis': { ar: 'بوابة تحليل البيانات', en: 'Data analysis portal' },
  security: { ar: 'بوابة الأمان', en: 'Security portal' },
  admin: { ar: 'لوحة تحكم المشرف', en: 'Admin dashboard' },
};

/** Roles an audience can be limited to (matches ROLE_LABELS in navConfig / config('roles.available')). */
export const ROLE_OPTIONS = [
  { key: 'student', ar: 'طالب', en: 'Student' },
  { key: 'university', ar: 'جامعة', en: 'University' },
  { key: 'faculty', ar: 'كلية', en: 'Faculty' },
  { key: 'academic_staff', ar: 'عضو هيئة تدريس', en: 'Academic staff' },
  { key: 'supervisor', ar: 'مشرف', en: 'Supervisor' },
  { key: 'data_analyst', ar: 'محلل بيانات', en: 'Data analyst' },
  { key: 'security_admin', ar: 'مدير الأمان', en: 'Security admin' },
  { key: 'security_officer', ar: 'ضابط الأمان', en: 'Security officer' },
  { key: 'admin', ar: 'مشرف المنصة', en: 'Platform admin' },
];

export const SECTION_KINDS = ['overview', 'group', 'tasks', 'faq', 'custom'];

/** Icons the editor offers (all exist in components/Icon.jsx). */
export const GUIDE_ICONS = [
  'book-open', 'help-circle', 'compass', 'target', 'route', 'list-checks', 'graduation-cap', 'flag', 'info',
  'dashboard', 'projects', 'folder', 'file', 'users', 'user', 'building', 'layers', 'grid', 'calendar', 'clock',
  'award', 'chart', 'bar-chart', 'trend', 'pulse', 'sparkles', 'star', 'globe', 'search', 'filter',
  'message', 'chat', 'mail', 'bell', 'inbox', 'send', 'video', 'phone',
  'shield', 'lock', 'key', 'alert', 'eye', 'history', 'note', 'archive', 'download', 'upload',
  'settings', 'wrench', 'terminal', 'github', 'monitor', 'smartphone', 'hard-drive', 'cloud', 'dollar', 'briefcase', 'home', 'link',
];

/** Picks the text for the active language, falling back to the other one. */
export const pickText = (obj, base, locale) => {
  const primary = obj?.[`${base}_${locale}`];
  if (primary) return primary;
  return obj?.[`${base}_${locale === 'ar' ? 'en' : 'ar'}`] || '';
};
export const pickPair = (pair, locale) => (pair ? (pair[locale] || pair[locale === 'ar' ? 'en' : 'ar'] || '') : '');

export const slugify = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

/** Route without query / hash — used to match guide items against sidebar entries. */
export const bareRoute = (route) => String(route || '').split(/[?#]/)[0].replace(/\/+$/, '');

/** Every sidebar entry of a portal (unfiltered by permissions), tagged with its group. */
export function portalNavItems(portal) {
  const role = PORTAL_ROLE[portal];
  if (!role) return [];
  const sections = getNavConfig(role);
  const out = [];
  Object.entries(sections).forEach(([groupKey, items]) => {
    items.forEach((item) => {
      if (!item.route) return;
      out.push({
        key: item.key,
        route: item.route,
        icon: item.icon,
        perm: item.perm || '',
        en: item.en,
        ar: item.ar,
        groupKey,
        groupTitle: SECTION_TITLES[groupKey] || { en: groupKey, ar: groupKey },
      });
    });
  });
  return out;
}

/** Sidebar entries that no guide item points at yet — "pages nobody explained". */
export function undocumentedPages(portal, guide) {
  const covered = new Set();
  (guide?.sections || []).forEach((s) => (s.items || []).forEach((it) => {
    if (it.route) covered.add(bareRoute(it.route));
  }));
  const seen = new Set();
  return portalNavItems(portal).filter((n) => {
    const r = bareRoute(n.route);
    if (covered.has(r) || seen.has(r)) return false;
    seen.add(r);
    return true;
  });
}

/** Plain-text blob of an item (for the search box). */
export function itemHaystack(it, section) {
  return [
    it.title_ar, it.title_en, it.summary_ar, it.summary_en, it.body_ar, it.body_en, it.route, it.key,
    ...(it.steps || []).flatMap((s) => [s.ar, s.en]),
    ...(it.tips || []).flatMap((s) => [s.ar, s.en]),
    section?.title_ar, section?.title_en,
  ].filter(Boolean).join(' \n ').toLowerCase();
}
