import { api } from '../../../api/client';
import { saveBlob } from '../../../lib/exporter';
import { useL, fmtDate, fmtBytes, useBanner, Switch, ROLE_LABELS } from '../meetingsControl/shared';

export { useL, fmtDate, fmtBytes, useBanner, Switch, ROLE_LABELS };

export const BASE = '/api/v1/admin/drive/control';

/** Download an authenticated file through the shared client (Bearer + refresh) and hand it to the browser. */
export async function downloadFrom(path, params, fallbackName) {
  const res = await api.blob(path, params);
  const cd = res.headers?.get?.('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/i.exec(cd);
  let name = fallbackName;
  if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
  saveBlob(await res.blob(), name || 'download');
}

/** Open a file inline in a new tab (blob URL, so the Bearer header is used). */
export async function previewFrom(path, params) {
  const w = window.open('', '_blank'); // opened synchronously so popup blockers allow it
  try {
    const res = await api.blob(path, { ...params, inline: 1 });
    const url = URL.createObjectURL(await res.blob());
    if (w) { w.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 120000); } else { window.location.href = url; }
  } catch (e) {
    if (w) w.close();
    throw e;
  }
}

export const DRIVE_STATUS = {
  active: ['Active', 'نشط', 'badge-success'],
  readonly: ['Read-only', 'قراءة فقط', 'badge-warning'],
  blocked: ['Blocked', 'محظور', 'badge-danger'],
};

export function StatusBadge({ status }) {
  const { ar } = useL();
  const s = DRIVE_STATUS[status] || DRIVE_STATUS.active;
  return <span className={`badge ${s[2]}`}>{ar ? s[1] : s[0]}</span>;
}

export const CATEGORY_LABELS = {
  image: ['Images', 'صور'], video: ['Video', 'فيديو'], audio: ['Audio', 'صوت'], document: ['Documents', 'مستندات'],
  spreadsheet: ['Spreadsheets', 'جداول'], presentation: ['Presentations', 'عروض'], pdf: ['PDF', 'PDF'],
  archive: ['Archives', 'أرشيف'], code: ['Code', 'كود'], text: ['Text', 'نصوص'], other: ['Other', 'أخرى'],
};
export const catLabel = (c, ar) => (CATEGORY_LABELS[c] ? CATEGORY_LABELS[c][ar ? 1 : 0] : c);

/** Storage bar: green < 75%, amber < 90%, red above. Unlimited quota shows only the used text. */
export function UsageBar({ used, quota, percent, unlimited, quotaHuman, usedHuman }) {
  const { L } = useL();
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const tone = p >= 90 ? 'is-danger' : p >= 75 ? 'is-warn' : '';
  return (
    <div className="dvc-usage">
      <div className="dvc-usage__bar"><i className={tone} style={{ width: `${unlimited ? 0 : p}%` }} /></div>
      <small className="mtc-muted">{usedHuman || fmtBytes(used)} / {unlimited ? L('Unlimited', 'بلا حد') : (quotaHuman || fmtBytes(quota))}{!unlimited && ` · ${p}%`}</small>
    </div>
  );
}

export const SETTING_META = {
  feature_drive: { en: 'My PC system', ar: 'نظام جهازي', hint_en: 'Master switch. When off nobody can open My PC.', hint_ar: 'المفتاح الرئيسي. لما يتقفل محدش يقدر يفتح جهازي.' },
  maintenance_message: { en: 'Maintenance message', ar: 'رسالة الصيانة', hint_en: 'Shown while My PC is off. Empty = default text.', hint_ar: 'بتظهر وقت القفل. فاضي = النص الافتراضي.' },
  allowed_roles: { en: 'Who can use My PC', ar: 'مين يقدر يستخدم جهازي', hint_en: 'Tick the account types allowed. None ticked = everyone.', hint_ar: 'علّم على أنواع الحسابات المسموحة. ولا واحد = الكل.' },
  quota_mb: { en: 'Default storage quota', ar: 'الحصة الافتراضية', hint_en: 'Per user, in MB. Overridden by role or per-user quota.', hint_ar: 'لكل مستخدم بالميجا. بتتغلّب بحصة الدور أو حصة المستخدم.', unit: 'MB' },
  role_quota_mb: { en: 'Quota per account type', ar: 'الحصة لكل نوع حساب', hint_en: 'MB per role. 0 = unlimited. Empty = use the default quota.', hint_ar: 'ميجا لكل دور. 0 = بلا حد. فاضي = الحصة الافتراضية.' },
  max_file_mb: { en: 'Max file size', ar: 'أقصى حجم للملف', unit: 'MB' },
  max_zip_mb: { en: 'Max ZIP size', ar: 'أقصى حجم لملف ZIP', hint_en: 'For archive downloads and extraction.', hint_ar: 'للتنزيل كأرشيف وفك الضغط.', unit: 'MB' },
  max_nodes: { en: 'Max items per user', ar: 'أقصى عدد عناصر للمستخدم', hint_en: 'Files + folders.', hint_ar: 'ملفات + مجلدات.' },
  max_depth: { en: 'Max folder depth', ar: 'أقصى عمق للمجلدات' },
  max_text_edit_kb: { en: 'Max text-edit size', ar: 'أقصى حجم لتعديل النص', unit: 'KB' },
  trash_days: { en: 'Recycle bin retention', ar: 'مدة بقاء المحذوفات', hint_en: 'Deleted items are purged after this many days.', hint_ar: 'العناصر المحذوفة بتتمسح نهائيًا بعد المدة دي.', unit: 'day' },
  max_versions: { en: 'Versions kept per file', ar: 'عدد النسخ المحفوظة لكل ملف', hint_en: '0 = versioning off.', hint_ar: '0 = إيقاف النسخ.' },
  version_max_mb: { en: 'Max size of a kept version', ar: 'أقصى حجم لنسخة محفوظة', unit: 'MB' },
  versions_mb: { en: 'Versions storage per user', ar: 'مساحة النسخ لكل مستخدم', unit: 'MB' },
  feature_uploads: { en: 'Uploads', ar: 'الرفع', hint_en: 'Off = nobody can upload or create files.', hint_ar: 'مقفول = محدش يرفع أو ينشئ ملفات.' },
  feature_sharing: { en: 'Sharing links', ar: 'روابط المشاركة', hint_en: 'Off = no new links and existing public links stop working.', hint_ar: 'مقفول = مفيش روابط جديدة والروابط الحالية بتقف.' },
  feature_archive: { en: 'ZIP / archive tools', ar: 'أدوات ZIP والأرشيف' },
  feature_terminal: { en: 'Terminal & code runner', ar: 'الترمينال وتشغيل الكود' },
  feature_vscode: { en: 'VS Code (code-server)', ar: 'VS Code (code-server)', hint_en: 'Off = the “Open with VS Code” buttons and the VS Code app stop working.', hint_ar: 'مقفول = زراير "فتح بـ VS Code" وتطبيق VS Code بيقفوا.' },
  feature_browser: { en: 'Browser app', ar: 'تطبيق المتصفح', hint_en: 'Off = the desktop Browser app, web search and the cloud browser stop working.', hint_ar: 'مقفول = المتصفح والبحث والمتصفح السحابي بيقفوا.' },
  web_search_provider: { en: 'Search provider', ar: 'مزوّد البحث', hint_en: 'SearXNG is free and self-hosted (no key). Serper / Brave / Google CSE need an API key.', hint_ar: 'SearXNG مجاني وعلى سيرفرك (من غير مفتاح). Serper و Brave و Google CSE محتاجين مفتاح API.' },
  web_search_url: { en: 'SearXNG address', ar: 'عنوان SearXNG', hint_en: 'Where your SearXNG runs, e.g. http://127.0.0.1:8888. It must have json under search.formats in settings.yml.', hint_ar: 'عنوان SearXNG عندك، مثال http://127.0.0.1:8888. لازم يكون json متفعّل في search.formats جوة settings.yml.', placeholder: 'http://127.0.0.1:8888', showWhen: ['searxng'] },
  web_search_key: { en: 'API key', ar: 'مفتاح الـ API', hint_en: 'Stored encrypted and never shown again. Empty = use the .env value.', hint_ar: 'بيتخزّن مشفّر ومبيتعرضش تاني. فاضي = قيمة .env.', showWhen: ['serper', 'brave', 'google_cse'] },
  web_search_cx: { en: 'Search engine ID (cx)', ar: 'معرّف محرك البحث (cx)', hint_en: 'Google Custom Search only.', hint_ar: 'لـ Google Custom Search بس.', showWhen: ['google_cse'] },
  blocked_extensions: { en: 'Blocked file extensions', ar: 'الامتدادات الممنوعة', hint_en: 'One per line or comma-separated, e.g. exe, bat, apk.', hint_ar: 'واحد في كل سطر أو بفاصلة، مثال: exe, bat, apk.' },
  share_max_active_per_user: { en: 'Max active links per user', ar: 'أقصى روابط نشطة للمستخدم' },
  share_max_expiry_days: { en: 'Max link lifetime', ar: 'أقصى مدة للرابط', unit: 'day' },
  share_allow_never: { en: 'Allow links that never expire', ar: 'السماح بروابط بدون انتهاء' },
  admin_can_download: { en: 'Admins can open / download user files', ar: 'الأدمن يقدر يفتح وينزّل ملفات المستخدمين', hint_en: 'Every open and download is logged. Off = view only metadata.', hint_ar: 'كل فتح وتنزيل بيتسجّل. مقفول = بيانات الملفات بس.' },
  admin_can_delete: { en: 'Admins can delete user files', ar: 'الأدمن يقدر يحذف ملفات المستخدمين' },
};

export const GROUP_META = {
  system: { en: 'System', ar: 'النظام', icon: 'shield' },
  access: { en: 'Who can use it', ar: 'مين يستخدمه', icon: 'users' },
  limits: { en: 'Quota & limits', ar: 'الحصص والحدود', icon: 'hard-drive' },
  versions: { en: 'File versions', ar: 'نسخ الملفات', icon: 'history' },
  features: { en: 'Feature switches', ar: 'مفاتيح الميزات', icon: 'settings' },
  uploads: { en: 'Uploads', ar: 'الرفع', icon: 'upload' },
  sharing: { en: 'Sharing', ar: 'المشاركة', icon: 'share' },
  tools: { en: 'VS Code, browser & search', ar: 'VS Code والمتصفح والبحث', icon: 'globe' },
  admin: { en: 'Admin permissions', ar: 'صلاحيات الأدمن', icon: 'key' },
};

export const SEARCH_PROVIDER_LABELS = {
  searxng: ['SearXNG (free, self-hosted)', 'SearXNG (مجاني، على سيرفرك)'],
  serper: ['Serper (Google results, API key)', 'Serper (نتائج Google، بمفتاح)'],
  brave: ['Brave Search (API key)', 'Brave Search (بمفتاح)'],
  google_cse: ['Google Custom Search (legacy key)', 'Google Custom Search (مفتاح قديم)'],
};

export const ACTION_LABELS = {
  'admin.drive.settings_updated': ['Settings changed', 'تغيير الإعدادات'], 'admin.drive.settings_reset': ['Settings reset', 'إرجاع الإعدادات'],
  'admin.drive.limits_updated': ['User limits changed', 'تغيير حدود مستخدم'], 'admin.drive.limits_reset': ['User limits reset', 'إرجاع حدود مستخدم'],
  'admin.drive.file_viewed': ['File opened', 'فتح ملف'], 'admin.drive.file_downloaded': ['File downloaded', 'تنزيل ملف'],
  'admin.drive.archive_downloaded': ['ZIP downloaded', 'تنزيل ZIP'], 'admin.drive.files_trashed': ['Moved to bin', 'نقل للمحذوفات'],
  'admin.drive.files_restored': ['Restored', 'استرجاع'], 'admin.drive.files_purged': ['Deleted permanently', 'حذف نهائي'],
  'admin.drive.trash_emptied': ['Bin emptied', 'تفريغ المحذوفات'], 'admin.drive.drive_wiped': ['Whole My PC wiped', 'مسح جهازي بالكامل'],
  'admin.drive.share_pause': ['Link paused', 'إيقاف رابط'], 'admin.drive.share_resume': ['Link resumed', 'استئناف رابط'],
  'admin.drive.share_revoke': ['Link revoked', 'إلغاء رابط'], 'admin.drive.share_delete': ['Link deleted', 'حذف رابط'],
  'admin.drive.share_reset_claim': ['Link reset', 'إعادة ضبط رابط'], 'admin.drive.share_clear_activity': ['Link activity cleared', 'مسح نشاط رابط'],
  'admin.drive.revoke_all_shares': ['All links revoked', 'إلغاء كل الروابط'], 'admin.drive.purge_expired_trash': ['Expired bin purged', 'مسح المحذوفات المنتهية'],
};
export function actionLabel(action, ar) {
  const l = ACTION_LABELS[action];
  if (l) return l[ar ? 1 : 0];
  if (/^admin\.drive\.shares_bulk_/.test(action)) return ar ? 'إجراء جماعي على الروابط' : 'Bulk link action';
  return action;
}

export const SHARE_STATUS = {
  active: ['Active', 'نشط', 'badge-success'], paused: ['Paused', 'متوقف', 'badge-warning'],
  expired: ['Expired', 'منتهي', 'badge-neutral'], revoked: ['Revoked', 'ملغي', 'badge-danger'], consumed: ['Used', 'مستخدم', 'badge-neutral'],
};
