import { useState } from 'react';
import Icon from '../../Icon';
import { useLanguage } from '../../../context/LanguageContext';

export const BASE = '/api/v1/admin/meetings/control';

/** Bilingual helper: const { ar, L } = useL(); L('English', 'عربي') */
export function useL() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  return { ar, L: (en, arText) => (ar ? arText : en) };
}

export function fmtDate(v, ar) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

export const STATUS_TONE = {
  live: 'badge-success', lobby: 'badge-warning', scheduled: 'badge-primary',
  ended: 'badge-neutral', cancelled: 'badge-danger', deleted: 'badge-danger',
};

export function StatusPill({ status, deleted }) {
  const { L } = useL();
  const key = deleted ? 'deleted' : status;
  const label = {
    live: L('Live', 'جارٍ'), lobby: L('Lobby', 'في الانتظار'), scheduled: L('Scheduled', 'مجدول'),
    ended: L('Ended', 'انتهى'), cancelled: L('Cancelled', 'ملغي'), deleted: L('Deleted', 'محذوف'),
  }[key] || key;
  return <span className={`badge ${STATUS_TONE[key] || 'badge-neutral'}`}>{label}</span>;
}

/** success / error banner state shared by every tab. */
export function useBanner() {
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const clear = () => { setNotice(null); setError(null); };
  const banner = (
    <>
      {error && <div className="st-alert st-alert--danger mtc-banner" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert mtc-banner" role="status"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}
    </>
  );
  return { notice, error, setNotice, setError, clear, banner };
}

export function Switch({ checked, onChange, disabled, id, label }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled}
      className={`mtc-switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="mtc-switch__knob" />
    </button>
  );
}

/** Per-setting labels / hints / units (key = catalog key in MeetingAdminSettings). */
export const SETTING_META = {
  feature_meetings: { en: 'Meetings system', ar: 'نظام الاجتماعات', hint_en: 'Master switch. When off nobody can create, start or join a meeting.', hint_ar: 'المفتاح الرئيسي. لما يتقفل محدش يقدر ينشئ أو يبدأ أو يدخل أي اجتماع.' },
  maintenance_message: { en: 'Maintenance message', ar: 'رسالة الصيانة', hint_en: 'Shown to users while the system is off. Empty = default text.', hint_ar: 'بتظهر للمستخدمين وقت القفل. فاضي = النص الافتراضي.' },

  allow_instant: { en: 'Allow instant meetings', ar: 'السماح بالاجتماعات الفورية', hint_en: 'Users can start a meeting right now.', hint_ar: 'المستخدم يقدر يبدأ اجتماع فورًا.' },
  allow_scheduled: { en: 'Allow scheduled meetings', ar: 'السماح بالاجتماعات المجدولة', hint_en: 'Users can schedule meetings for later.', hint_ar: 'المستخدم يقدر يجدول اجتماع لوقت لاحق.' },
  creator_roles: { en: 'Who can create meetings', ar: 'مين يقدر ينشئ اجتماعات', hint_en: 'Tick the account types allowed. None ticked = everyone.', hint_ar: 'علّم على أنواع الحسابات المسموحة. ولا واحد = الكل.' },
  max_active_meetings_per_user: { en: 'Max open meetings per user', ar: 'أقصى اجتماعات مفتوحة للمستخدم', hint_en: 'Instant/live meetings a user can have open at once. 0 = unlimited.', hint_ar: 'عدد الاجتماعات الفورية/الشغالة في نفس الوقت. 0 = بلا حد.' },
  max_scheduled_meetings_per_user: { en: 'Max scheduled meetings per user', ar: 'أقصى اجتماعات مجدولة للمستخدم', hint_en: '0 = unlimited.', hint_ar: '0 = بلا حد.' },
  max_schedule_ahead_days: { en: 'Max days to schedule ahead', ar: 'أقصى مدة جدولة قدّام', hint_en: '0 = no limit.', hint_ar: '0 = بلا حد.', unit: 'day' },
  require_password: { en: 'Require a password on every meeting', ar: 'إجبار كلمة سر على كل اجتماع', hint_en: 'Hosts cannot create or edit a meeting without a password.', hint_ar: 'الهوست مايقدرش ينشئ أو يعدّل اجتماع من غير كلمة سر.' },

  default_duration_minutes: { en: 'Default duration', ar: 'المدة الافتراضية', hint_en: 'Used when the host does not choose one.', hint_ar: 'بتتطبق لو الهوست ما حدّدش.', unit: 'min' },
  max_duration_minutes: { en: 'Maximum duration', ar: 'أقصى مدة', unit: 'min' },
  max_mesh_participants: { en: 'Max participants per meeting', ar: 'أقصى عدد مشاركين', hint_en: 'WebRTC mesh limit. Raising it a lot needs more bandwidth per user.', hint_ar: 'حد الـ mesh. رفعه كتير بيزوّد الضغط على نت كل مشارك.' },
  presence_stale_seconds: { en: 'Presence timeout', ar: 'مهلة اعتبار المشارك غير متصل', hint_en: 'A participant with no heartbeat for this long is dropped from the roster.', hint_ar: 'المشارك اللي مبعتش نبضة المدة دي بيتشال من القايمة.', unit: 'sec' },

  waiting_room_default: { en: 'Waiting room on by default', ar: 'غرفة الانتظار مفعّلة افتراضيًا' },
  force_waiting_room: { en: 'Force waiting room', ar: 'إجبار غرفة الانتظار', hint_en: 'Hosts cannot turn the waiting room off.', hint_ar: 'الهوست مايقدرش يقفل غرفة الانتظار.' },
  allow_guests_default: { en: 'Guests allowed by default', ar: 'الضيوف مسموحين افتراضيًا' },
  guest_session_ttl_minutes: { en: 'Guest session length', ar: 'مدة جلسة الضيف', unit: 'min' },
  invitation_expiry_hours: { en: 'Invitation validity', ar: 'صلاحية الدعوة', unit: 'hour' },
  reminder_minutes_before: { en: 'Reminder before start', ar: 'التذكير قبل البداية', hint_en: 'Minutes before a scheduled meeting to notify participants.', hint_ar: 'قبل الميعاد بكام دقيقة يتبعت إشعار.', unit: 'min' },

  feature_guests: { en: 'Guest access', ar: 'دخول الضيوف', hint_en: 'Off = nobody can join without signing in, whatever the meeting says.', hint_ar: 'مقفول = محدش يدخل من غير تسجيل دخول مهما كان إعداد الاجتماع.' },
  feature_invitations: { en: 'Invitations', ar: 'الدعوات', hint_en: 'Inviting users or emailing guests.', hint_ar: 'دعوة مستخدمين أو إرسال دعوات بالإيميل.' },
  feature_chat: { en: 'Meeting chat', ar: 'شات الاجتماع' },
  feature_private_chat: { en: 'Private messages', ar: 'الرسائل الخاصة' },
  feature_files: { en: 'File sharing', ar: 'مشاركة الملفات' },
  feature_recording: { en: 'Recording', ar: 'التسجيل' },
  feature_polls: { en: 'Polls', ar: 'الاستطلاعات' },
  feature_notes: { en: 'Notes & action items', ar: 'الملاحظات وبنود العمل' },
  feature_screen_share: { en: 'Screen sharing', ar: 'مشاركة الشاشة', hint_en: 'Off = nobody can share, including hosts.', hint_ar: 'مقفول = محدش يشارك شاشته حتى الهوست.' },
  feature_remote_control: { en: 'Remote control', ar: 'التحكم عن بعد' },
  feature_reactions: { en: 'Reactions', ar: 'التفاعلات' },
  feature_hand_raise: { en: 'Raise hand', ar: 'رفع اليد' },

  default_mute_on_entry: { en: 'Mute on entry', ar: 'كتم الميكروفون عند الدخول' },
  default_camera_on_entry: { en: 'Camera on at entry', ar: 'تشغيل الكاميرا عند الدخول' },
  default_allow_chat: { en: 'Chat enabled', ar: 'الشات مفعّل' },
  default_allow_file_sharing: { en: 'File sharing enabled', ar: 'مشاركة الملفات مفعّلة' },
  default_recording_enabled: { en: 'Recording allowed', ar: 'التسجيل مسموح' },

  sfu_enabled: { en: 'Large-meeting video server (Cloudflare SFU)', ar: 'سيرفر فيديو الاجتماعات الكبيرة (Cloudflare SFU)', hint_en: 'Off = direct connections (mesh) only, exactly like before.', hint_ar: 'مقفول = اتصال مباشر (mesh) بس، زي الأول بالظبط.' },
  sfu_mode: {
    en: 'When to use the video server', ar: 'امتى يستخدم سيرفر الفيديو',
    hint_en: 'Automatic picks mesh for small meetings and the server for big ones or weak connections.', hint_ar: 'تلقائي: mesh للاجتماعات الصغيرة، والسيرفر للكبيرة أو لما الشبكة تضعف.',
    options: { auto: { en: 'Automatic (recommended)', ar: 'تلقائي (موصى به)' }, sfu: { en: 'Always the video server', ar: 'دايمًا سيرفر الفيديو' }, mesh: { en: 'Never (direct only)', ar: 'أبدًا (مباشر بس)' } },
  },
  sfu_min_participants: { en: 'Switch to the server from', ar: 'التحويل للسيرفر من عدد', hint_en: 'Number of people in the meeting (including you). It always switches above the "Max participants" mesh limit.', hint_ar: 'عدد الحاضرين (شاملك). وبيتحول دايمًا لو العدد عدّى حد الـ mesh في "أقصى عدد مشاركين".', unit: 'people' },
  sfu_max_video_subscriptions: { en: 'Max videos each person receives', ar: 'أقصى فيديوهات بيستقبلها كل مشارك', hint_en: 'Voices always reach everyone; extra videos beyond this are skipped to protect weak devices.', hint_ar: 'الصوت بيوصل للكل دايمًا؛ الفيديوهات الزيادة بتتخطى عشان تحمي الأجهزة الضعيفة.', unit: 'video' },
  sfu_block_seconds: { en: 'Pause the server after failures', ar: 'إيقاف السيرفر بعد الفشل', hint_en: 'If it fails for many people, meetings fall back to direct connections for this long.', hint_ar: 'لو فشل عند ناس كتير، الاجتماعات بترجع للاتصال المباشر المدة دي.', unit: 'sec' },
  sfu_min_dwell_seconds: { en: 'Minimum time between switches', ar: 'أقل وقت بين تحويلين', hint_en: 'Prevents flip-flopping between direct and server.', hint_ar: 'يمنع التحويل المتكرر بين المباشر والسيرفر.', unit: 'sec' },
  sfu_app_id: { en: 'Cloudflare App ID', ar: 'Cloudflare App ID', hint_en: 'Empty = use CF_SFU_APP_ID from the server .env.', hint_ar: 'فاضي = استخدم CF_SFU_APP_ID من ملف .env.' },
  sfu_app_secret: { en: 'Cloudflare App Secret', ar: 'Cloudflare App Secret', hint_en: 'Stored encrypted and never shown again. Type a new one to replace it.', hint_ar: 'بيتخزن مشفّر ومابيظهرش تاني. اكتب واحد جديد عشان تغيّره.' },

  recording_max_kb: { en: 'Max recording size', ar: 'أقصى حجم للتسجيل', hint_en: 'In kilobytes (512000 ≈ 500 MB).', hint_ar: 'بالكيلوبايت (512000 ≈ 500 ميجا).', unit: 'KB' },
  recording_process_inline: { en: 'Process recordings immediately', ar: 'معالجة التسجيل فورًا', hint_en: 'Off = needs a running queue worker.', hint_ar: 'مقفول = محتاج queue worker شغال.' },
};

export const GROUP_META = {
  system: { en: 'System', ar: 'النظام', icon: 'shield' },
  creation: { en: 'Who can create & how', ar: 'الإنشاء ومين يقدر', icon: 'plus-circle' },
  limits: { en: 'Limits', ar: 'الحدود', icon: 'clock' },
  access: { en: 'Access & invitations', ar: 'الدخول والدعوات', icon: 'users' },
  features: { en: 'Feature switches', ar: 'مفاتيح الميزات', icon: 'settings' },
  defaults: { en: 'Defaults for new meetings', ar: 'افتراضيات الاجتماع الجديد', icon: 'video' },
  recording: { en: 'Recording storage', ar: 'تخزين التسجيل', icon: 'record-dot' },
  video: { en: 'Video servers (Cloudflare SFU)', ar: 'سيرفرات الفيديو (Cloudflare SFU)', icon: 'video' },
};

export const ROLE_LABELS = {
  student: ['Student', 'طالب'], university: ['University', 'جامعة'], admin: ['Admin', 'أدمن'],
  security_admin: ['Security admin', 'مدير أمن'], security_officer: ['Security officer', 'ضابط أمن'],
  data_analyst: ['Data analyst', 'محلل بيانات'], supervisor: ['Supervisor', 'مشرف'],
  academic_staff: ['Academic staff', 'هيئة أكاديمية'], faculty: ['Faculty', 'كلية'],
};

/** Human names for audit actions (falls back to the raw action key). [en, ar] */
export const ACTION_LABELS = {
  'meetings.meeting_created': ['Meeting created', 'إنشاء اجتماع'], 'meetings.meeting_ended': ['Meeting ended', 'إنهاء اجتماع'],
  'meetings.meeting_deleted': ['Meeting deleted', 'حذف اجتماع'], 'meetings.join_requested': ['Join requested', 'طلب انضمام'],
  'meetings.signaling_left': ['Left the meeting', 'مغادرة الاجتماع'], 'meetings.screen_share_started': ['Screen share started', 'بدء مشاركة الشاشة'],
  'meetings.screen_share_stopped': ['Screen share stopped', 'إيقاف مشاركة الشاشة'], 'meetings.connection_failure': ['Connection failure', 'فشل اتصال'],
  'meetings.locked': ['Meeting locked', 'قفل الاجتماع'], 'meetings.participant_removed': ['Participant removed', 'إزالة مشارك'],
  'meetings.join_failed_wrong_password': ['Wrong password attempt', 'محاولة باسورد خاطئ'],
};
export function actionLabel(action, ar) {
  const l = ACTION_LABELS[action];
  return l ? l[ar ? 1 : 0] : action;
}
