/** Feature keys the backend can grant (AccountAccessGate::FEATURES) -> [en, ar]. */
export const FEATURE_LABELS = {
  messaging: ['Messaging & calls', 'الرسائل والمكالمات'],
  meetings: ['Meetings', 'الاجتماعات'],
  projects: ['Projects', 'المشاريع'],
  my_pc: ['My PC (drive & desktop)', 'جهازي (الملفات والسطح)'],
  learning: ['Courses & exams', 'المواد والامتحانات'],
  social: ['Feed & stories', 'الفيد والستوريز'],
  ai: ['AI assistant', 'المساعد الذكي'],
  all: ['Everything', 'كل المميزات'],
};

export const featureLabel = (k, ar) => (FEATURE_LABELS[k] ? FEATURE_LABELS[k][ar ? 1 : 0] : k);

export const GRANT_STATE = {
  active: { tone: 'badge-success', en: 'Active', ar: 'شغالة' },
  pending: { tone: 'badge-warning', en: 'Awaiting payment', ar: 'في انتظار الدفع' },
  expired: { tone: 'badge-neutral', en: 'Expired', ar: 'منتهية' },
  revoked: { tone: 'badge-danger', en: 'Withdrawn', ar: 'مسحوبة' },
};

export const money = (price, currency) => (Number(price) > 0 ? `${Number(price).toLocaleString()} ${currency}` : null);
