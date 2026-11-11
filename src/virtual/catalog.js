import { getNavConfig, SECTION_TITLES } from '../config/navConfig';

/**
 * Catalog of the virtual mode: every page of the student portal becomes an APP of the desktop.
 * It is derived from navConfig (the sidebar), so a page added to the sidebar shows up as an app without touching this file.
 *
 *   id        'vm:courses'                       (the window / Dock / icon key)
 *   route     '/student/courses'                 (the app's home; sub-pages like /student/courses/5/content stay in the same window)
 *   group     { en, ar }                         (the heading in the Start menu / Launchpad)
 */
export const VM_PREFIX = 'vm:';
export const vmId = (key) => `${VM_PREFIX}${key}`;
export const isVmApp = (id) => typeof id === 'string' && id.startsWith(VM_PREFIX);

/** Pages that belong to the portal but have no sidebar entry. */
const EXTRA = [
  { key: 'profile', en: 'My Profile', ar: 'ملفي الشخصي', icon: 'user', route: '/student/profile', section: 'account' },
];

/** Window size per app (defaults to a roomy 1120×720; the desktop clamps to the screen). */
const SIZES = {
  messages: { w: 1180, h: 740 }, dashboard: { w: 1180, h: 760 }, 'group-chat': { w: 1100, h: 720 },
  'my-exams': { w: 1100, h: 720 }, notifications: { w: 900, h: 700 }, settings: { w: 1000, h: 720 },
};
const DEFAULT_SIZE = { w: 1120, h: 720 };

/** Squircle colours per group (same look as the system apps). */
const GROUP_COLORS = {
  main: ['#60a5fa', '#2563eb'],
  academics: ['#a78bfa', '#6d28d9'],
  community: ['#34d399', '#059669'],
  social: ['#22d3ee', '#0891b2'],
  files: ['#94a3b8', '#475569'],
  account: ['#fbbf24', '#d97706'],
};
/** A few apps get their own colour so the Dock reads at a glance. */
const OWN_COLORS = {
  messages: ['#4ade80', '#16a34a'], 'my-exams': ['#fb7185', '#e11d48'], grades: ['#fbbf24', '#f59e0b'], notifications: ['#f87171', '#dc2626'],
  courses: ['#818cf8', '#4f46e5'], dashboard: ['#38bdf8', '#0284c7'], projects: ['#c084fc', '#9333ea'], meetings: ['#22d3ee', '#0891b2'],
  settings: ['#a1a6b0', '#6b7280'],
};

function build() {
  const nav = getNavConfig('student');
  const list = [];
  const seen = new Set();
  const push = (section, it) => {
    if (!it.route || it.key === 'my-pc' || seen.has(it.key)) return;
    seen.add(it.key);
    list.push({
      key: it.key, id: vmId(it.key), en: it.en, ar: it.ar, icon: it.icon, route: it.route, perm: it.perm || null, section,
      group: SECTION_TITLES[section] || SECTION_TITLES.main,
      colors: OWN_COLORS[it.key] || GROUP_COLORS[section] || GROUP_COLORS.main,
      size: SIZES[it.key] || DEFAULT_SIZE,
    });
  };
  Object.entries(nav).forEach(([section, items]) => items.forEach((it) => push(section, it)));
  EXTRA.forEach((it) => push(it.section, it));
  return list;
}

/** Every app of the virtual mode, in sidebar order. */
export const VM_APPS = build();
export const VM_BY_KEY = Object.fromEntries(VM_APPS.map((a) => [a.key, a]));
export const VM_BY_ID = Object.fromEntries(VM_APPS.map((a) => [a.id, a]));

/** Icons on the desktop and pinned in the Dock while the mode is on (the rest live in Start / Launchpad). */
export const VM_DESKTOP = ['dashboard', 'courses', 'my-exams', 'grades', 'projects', 'messages'];
export const VM_DOCK = ['dashboard', 'courses', 'my-exams', 'messages', 'notifications'];

export const deskIconKey = (key) => `sys:vm-${key}`;
export const isVmDeskKey = (k) => typeof k === 'string' && k.startsWith('sys:vm-');
/** [key, en, ar, glyph] rows in the same shape as DESK_ICONS / DOCK_ICONS (prefs.js) so Settings ▸ Icons can restore them. */
export const VM_DESK_ICONS = VM_DESKTOP.filter((k) => VM_BY_KEY[k]).map((k) => [deskIconKey(k), VM_BY_KEY[k].en, VM_BY_KEY[k].ar, vmId(k)]);
export const VM_DOCK_ICONS = VM_DOCK.filter((k) => VM_BY_KEY[k]).map((k) => [vmId(k), VM_BY_KEY[k].en, VM_BY_KEY[k].ar, vmId(k)]);

/** The app that owns a portal URL (longest matching route wins), or null. */
export function appForPath(path) {
  const p = String(path || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  let best = null;
  for (const a of VM_APPS) {
    if ((p === a.route || p.startsWith(`${a.route}/`)) && (!best || a.route.length > best.route.length)) best = a;
  }
  return best;
}

const MY_PC = /^\/student\/my-pc(\/|$)/;
const EXAM_ATTEMPT = /^\/student\/exam-attempt\/[^/]+\/?$/; // the exam itself (the result page below it is a normal window page)
const MEETING_ROOM = /^\/[a-z-]+\/meetings\/[^/]+\/room\/?$/;
const PRINT_PAGE = /^\/student\/graduation\/(transcript|certificate)\/?$/;

/**
 * What should a link do from inside the virtual mode?
 *   { kind: 'app', app }   a page of the portal → that app's window (opened / brought to the front)
 *   { kind: 'explorer' }   My PC → the desktop's "This PC"
 *   { kind: 'page' }       a real full page (the exam, a meeting room, anything outside the student portal) → the desktop is left
 *   { kind: 'tab' }        a print layout → a new browser tab
 */
export function resolveTarget(path) {
  const p = String(path || '').split(/[?#]/)[0];
  if (MY_PC.test(p)) return { kind: 'explorer' };
  if (/^\/student\/?$/.test(p) && VM_BY_KEY.dashboard) return { kind: 'app', app: VM_BY_KEY.dashboard }; // the bare portal root is the dashboard, never a real page
  if (EXAM_ATTEMPT.test(p) || MEETING_ROOM.test(p)) return { kind: 'page' };
  if (PRINT_PAGE.test(p)) return { kind: 'tab' };
  const app = appForPath(p);
  return app ? { kind: 'app', app } : { kind: 'page' };
}

/** Should the portal page at this URL be shown INSIDE the desktop while the mode is on? (guard used by DashboardLayout) */
export function belongsInDesktop(pathname) {
  return resolveTarget(pathname).kind === 'app';
}
