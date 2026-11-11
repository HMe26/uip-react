/**
 * Per-portal flavour for the shared "Insight Platform" shell.
 *
 * Every portal now renders the same shell (sidebar, topbar, Messages,
 * Notifications, Settings — see styles/css/insight-portal.css). The only
 * things that differ per portal live here, so a portal is customised by
 * editing one entry instead of forking components:
 *
 *   sub        brand subtitle under "UIPE" in the sidebar
 *   promo      the tinted card at the bottom of the sidebar
 *              ({ text, cta, to } — `to: null` hides the link, `promo: null`
 *              hides the whole card)
 *   search     topbar search placeholder + optional results route
 *   avatar     GET endpoint returning the signed-in person's avatar_path
 *              (read defensively: any failure falls back to the initial)
 *   messages   subtitle under the Messages page title
 *   notifications  subtitle under the Notifications page title
 *
 * All strings are { en, ar }.
 */

const t = (en, ar) => ({ en, ar });

const BRAND = {
  student: {
    sub: t('Student Portal', 'بوابة الطالب'),
    // The Student design puts the user card under the brand and a theme
    // switch + "UIPE AI Assistant" button at the bottom instead of a promo.
    shell: 'student',
    roleLabel: t('Student', 'طالب'),
    promo: null,
    search: { placeholder: t('Search...', 'بحث...') },
    avatar: '/api/v1/students/me',
    messages: t('Conversations with supervisors and faculty.', 'محادثاتك مع المشرفين وأعضاء هيئة التدريس.'),
    notifications: t('Deadlines, approvals and updates on your projects.', 'المواعيد النهائية والاعتمادات وتحديثات مشاريعك.'),
  },
  university: {
    sub: t('University Portal', 'بوابة الجامعة'),
    // Same design as the Faculty portal: student-style chrome (page title in
    // the topbar, user card + theme switch + AI assistant in the sidebar), no promo.
    shell: 'faculty',
    roleLabel: t('University', 'الجامعة'),
    promo: null,
    search: { placeholder: t('Search anything', 'ابحث عن أي شيء') },
    avatar: '/api/v1/universities/me',
    messages: t('Talk with students, faculties and staff in one place.', 'تواصل مع الطلاب والكليات وأعضاء هيئة التدريس في مكان واحد.'),
    notifications: t('Approvals, join requests and university activity.', 'الاعتمادات وطلبات الانضمام ونشاط الجامعة.'),
  },
  faculty: {
    sub: t('Faculty Portal', 'بوابة الكلية'),
    // New Faculty design: same chrome as the Student shell (theme switch +
    // "UIPE AI Assistant" at the bottom, page title in the topbar), no promo.
    shell: 'faculty',
    roleLabel: t('Faculty', 'الكلية'),
    promo: null,
    search: { placeholder: t('Search anything', 'ابحث عن أي شيء') },
    avatar: '/api/v1/faculty/me',
    messages: t('Talk with students, staff and the university in one place.', 'تواصل مع الطلاب والهيئة التدريسية والجامعة في مكان واحد.'),
    notifications: t('Approvals, graduation and faculty updates.', 'الاعتمادات والتخرج وتحديثات الكلية.'),
  },
  // Academic Staff design: "U" tile + "Academic Staff Portal / UIPE", user card at
  // the bottom, no promo. Both roles that make up the academic-staff side of
  // the platform share it (supervisor = students/projects, academic_staff =
  // exams); each keeps its own pages, nav and API.
  supervisor: {
    shell: 'staff',
    title: t('Academic Staff Portal', 'بوابة الهيئة التدريسية'),
    sub: t('UIPE', 'UIPE'),
    roleLabel: t('Supervisor', 'مشرف'),
    promo: null,
    search: { placeholder: t('Search exams, questions, students…', 'ابحث عن امتحانات، أسئلة، طلاب…'), route: '/academic-staff/search' },
    avatar: '/api/v1/supervisor/settings',
    messages: t('Talk with your students and the faculty in one place.', 'تواصل مع طلابك والكلية في مكان واحد.'),
    notifications: t('Exam activity, grading and student updates.', 'نشاط الامتحانات والتصحيح وتحديثات الطلاب.'),
  },
  academic_staff: {
    shell: 'staff',
    title: t('Academic Staff Portal', 'بوابة الهيئة التدريسية'),
    sub: t('UIPE', 'UIPE'),
    roleLabel: t('Academic Staff', 'هيئة تدريس'),
    promo: null,
    search: { placeholder: t('Search exams, questions, students…', 'ابحث عن امتحانات، أسئلة، طلاب…'), route: '/academic-staff/search' },
    avatar: '/api/v1/academic-staff/settings',
    messages: t('Talk with students and colleagues in one place.', 'تواصل مع الطلاب والزملاء في مكان واحد.'),
    notifications: t('Exam activity, grading and course updates.', 'نشاط الامتحانات والتصحيح وتحديثات المقررات.'),
  },
  admin: {
    sub: t('Admin', 'الإدارة'),
    // New Admin design: student-style chrome (breadcrumb topbar, "Ask AI",
    // theme switch + AI assistant at the bottom of the sidebar), no promo.
    shell: 'admin',
    roleLabel: t('Super Admin', 'مشرف النظام'),
    promo: null,
    search: { placeholder: t('Search users, projects, universities…', 'ابحث عن مستخدمين، مشاريع، جامعات…'), route: '/admin/search' },
    avatar: '/api/v1/admin/settings',
    messages: t('Talk with universities, staff and users in one place.', 'تواصل مع الجامعات والفريق والمستخدمين في مكان واحد.'),
    notifications: t('Platform alerts, approvals and system events.', 'تنبيهات المنصة والاعتمادات وأحداث النظام.'),
  },
  security_admin: {
    name: { strong: 'UIPE', light: 'Security' },
    sub: t('Control Center', 'مركز التحكم'),
    roleLabel: t('Security Admin', 'مسؤول الأمان'),
    userCard: true,
    promo: null,
    search: { placeholder: t('Search incidents, alerts, logs…', 'ابحث في الحوادث والتنبيهات والسجلات…'), route: '/security/search' },
    avatar: '/api/v1/security/settings',
    messages: t('Coordinate with the security team in one place.', 'نسّق مع فريق الأمان في مكان واحد.'),
    notifications: t('Alerts, incidents and security events.', 'التنبيهات والحوادث والأحداث الأمنية.'),
  },
  data_analyst: {
    sub: t('Insight Platform', 'منصة الرؤى'),
    promo: {
      text: t('Turn your data into your next decision.', 'حوّل بياناتك إلى قرارك القادم.'),
      cta: t('Ask UIPE AI', 'اسأل UIPE AI'),
      to: '/data-analysis/ai-insights',
    },
    search: { placeholder: t('Search exams, students, doctors, projects…', 'ابحث في الامتحانات والطلاب والدكاترة والمشاريع…'), route: '/data-analysis/search' },
    avatar: '/api/v1/data-analysis/settings',
    messages: t('Talk with universities and the data team in one place.', 'تواصل مع الجامعات وفريق البيانات في مكان واحد.'),
    notifications: t('Reports, exports and data-quality alerts.', 'التقارير والتصدير وتنبيهات جودة البيانات.'),
  },
};

BRAND.security_officer = { ...BRAND.security_admin, roleLabel: t('Security Officer', 'ضابط الأمان') };

const FALLBACK = BRAND.student;

/** Brand entry for a role (falls back to the student entry). */
export function getPortalBrand(role) {
  return BRAND[role] || FALLBACK;
}

/** Picks the current locale from an { en, ar } pair. */
export function pick(pair, locale) {
  if (!pair) return '';
  return pair[locale] || pair.en || '';
}
