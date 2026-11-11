/** Shared labels for chat reports (used by the chat UI and the reports follow-up page). */

export const REPORT_REASONS = [
  { key: 'harassment', en: 'Harassment or bullying', ar: 'تحرّش أو تنمّر' },
  { key: 'threat', en: 'Threats or violence', ar: 'تهديد أو عنف' },
  { key: 'inappropriate', en: 'Inappropriate content', ar: 'محتوى غير لائق' },
  { key: 'spam', en: 'Spam or scam', ar: 'رسائل مزعجة أو احتيال' },
  { key: 'impersonation', en: 'Impersonation', ar: 'انتحال شخصية' },
  { key: 'other', en: 'Something else', ar: 'سبب آخر' },
];

export const REPORT_STATUSES = [
  { key: 'pending', en: 'Pending', ar: 'جديد', badge: 'badge-warning' },
  { key: 'reviewing', en: 'Under review', ar: 'قيد المراجعة', badge: 'badge-info' },
  { key: 'resolved', en: 'Resolved', ar: 'تمت المعالجة', badge: 'badge-success' },
  { key: 'dismissed', en: 'Dismissed', ar: 'مرفوض', badge: 'badge-neutral' },
];

export const reasonLabel = (key, locale) => {
  const r = REPORT_REASONS.find((x) => x.key === key);
  return r ? (locale === 'ar' ? r.ar : r.en) : key;
};

export const statusMeta = (key) => REPORT_STATUSES.find((x) => x.key === key) || { key, en: key, ar: key, badge: 'badge-neutral' };
