import { bi } from './format';

/**
 * Shared bits for WhatsApp-style groups: the message types an admin can allow, localised system lines
 * ("Sara added Omar"), and a client-side classifier that mirrors the server's attachment kinds.
 */

export const BASE = '/api/v1/messaging';

/** Types shown in the settings UI. gif / sticker exist on the server but nothing in the composer sends them yet. */
export const GROUP_TYPES = [
  { key: 'text', icon: 'message', en: 'Text messages', ar: 'الرسائل النصية', hintEn: 'Plain messages, replies and emoji', hintAr: 'الرسائل العادية والردود والإيموجي' },
  { key: 'image', icon: 'image', en: 'Photos', ar: 'الصور', hintEn: 'JPG, PNG, WebP…', hintAr: 'JPG وPNG وWebP…' },
  { key: 'video', icon: 'play', en: 'Videos', ar: 'الفيديوهات', hintEn: 'MP4, WebM, MOV…', hintAr: 'MP4 وWebM وMOV…' },
  { key: 'audio', icon: 'mic', en: 'Voice messages & audio', ar: 'الرسائل الصوتية والصوتيات', hintEn: 'Recorded voice notes and audio files', hintAr: 'التسجيلات الصوتية وملفات الصوت' },
  { key: 'file', icon: 'file', en: 'Files & documents', ar: 'الملفات والمستندات', hintEn: 'PDF, Office, archives, code…', hintAr: 'PDF وOffice والمضغوطات والأكواد…' },
  { key: 'poll', icon: 'chart', en: 'Polls', ar: 'الاستطلاعات', hintEn: 'Questions with options to vote on', hintAr: 'أسئلة بخيارات للتصويت' },
];
/** Always sent along so the "everything allowed" state stays recognisable on the server. */
export const HIDDEN_TYPES = ['gif', 'sticker'];

const IMG = /\.(jpe?g|png|gif|webp|bmp|tiff?|svg)$/i;
const VID = /\.(mp4|webm|mov|avi|mkv)$/i;
const AUD = /\.(mp3|wav|ogg|m4a|aac|opus|weba)$/i;

/** image | video | audio | file — same buckets the server enforces. */
export function fileKind(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '');
  if (/^voice-message-/i.test(name) || type.startsWith('audio/') || AUD.test(name)) return 'audio';
  if (type.startsWith('image/') || IMG.test(name)) return 'image';
  if (type.startsWith('video/') || VID.test(name)) return 'video';
  return 'file';
}

export function typeLabel(key) {
  const t = GROUP_TYPES.find((x) => x.key === key);
  return t ? bi(t.en, t.ar) : key;
}

const SETTING_LABELS = {
  members_can_edit_info: ['Members can edit group info', 'يمكن للأعضاء تعديل بيانات المجموعة'],
  members_can_add: ['Members can add people', 'يمكن للأعضاء إضافة أشخاص'],
  join_approval: ['Admin approval to join', 'موافقة المشرف للانضمام'],
};

/**
 * Localised one-liner for a `system` message. `meta` is the message's metadata
 * (event, actor_id/actor_name, target_id/target_name, ...). `myId` turns the viewer's own name into "You".
 */
export function systemLine(meta, myId) {
  if (!meta) return '';
  const you = bi('You', 'أنت');
  const who = (id, name) => (myId != null && String(id) === String(myId) ? you : (name || '…'));
  const a = who(meta.actor_id, meta.actor_name);
  const tg = who(meta.target_id, meta.target_name);
  const meActor = myId != null && String(meta.actor_id) === String(myId);
  const meTarget = myId != null && String(meta.target_id) === String(myId);
  switch (meta.event) {
    case 'created': return bi(`${a} created this group`, meActor ? 'أنشأت هذه المجموعة' : `${a} أنشأ هذه المجموعة`);
    case 'added': return bi(`${a} added ${tg}`, meActor ? `أضفت ${tg}` : meTarget ? `${a} أضافك` : `${a} أضاف ${tg}`);
    case 'removed': return bi(`${a} removed ${tg}`, meActor ? `أزلت ${tg}` : meTarget ? `${a} أزالك` : `${a} أزال ${tg}`);
    case 'left': return bi(`${a} left`, meActor ? 'غادرت المجموعة' : `${a} غادر المجموعة`);
    case 'joined_link': return bi(`${a} joined using the invite link`, meActor ? 'انضممت عبر رابط الدعوة' : `${a} انضم عبر رابط الدعوة`);
    case 'join_approved': return bi(`${a} approved ${tg}'s request to join`, `${a} وافق على انضمام ${tg}`);
    case 'renamed': return bi(`${a} changed the group name to “${meta.name || ''}”`, `${a} غيّر اسم المجموعة إلى «${meta.name || ''}»`);
    case 'description': return bi(`${a} changed the group description`, `${a} غيّر وصف المجموعة`);
    case 'avatar': return bi(`${a} changed the group photo`, `${a} غيّر صورة المجموعة`);
    case 'avatar_removed': return bi(`${a} removed the group photo`, `${a} أزال صورة المجموعة`);
    case 'promoted': return bi(`${a} made ${tg} an admin`, `${a} جعل ${tg} مشرفًا`);
    case 'demoted': return bi(`${a} removed ${tg} as admin`, `${a} أزال ${tg} من الإشراف`);
    case 'owner_transfer': return bi(`${a} made ${tg} the group owner`, `${a} نقل ملكية المجموعة إلى ${tg}`);
    case 'only_admins_on': return bi(`${a} closed the group — only admins can send messages`, `${a} أغلق المجموعة — المشرفون فقط يمكنهم الإرسال`);
    case 'only_admins_off': return bi(`${a} opened the group — everyone can send messages`, `${a} فتح المجموعة — يمكن للجميع الإرسال`);
    case 'types_changed': {
      const list = (meta.types || []).filter((k) => GROUP_TYPES.some((g) => g.key === k)).map(typeLabel).join(bi(', ', '، '));
      return bi(`${a} changed the allowed message types: ${list}`, `${a} غيّر أنواع الرسائل المسموحة: ${list}`);
    }
    case 'link_reset': return bi(`${a} reset the invite link`, `${a} أعاد تعيين رابط الدعوة`);
    case 'link_on': return bi(`${a} turned the invite link on`, `${a} فعّل رابط الدعوة`);
    case 'link_off': return bi(`${a} turned the invite link off`, `${a} أوقف رابط الدعوة`);
    case 'restricted': return bi(`${a} restricted ${tg} from sending messages`, `${a} منع ${tg} من إرسال الرسائل`);
    case 'unrestricted': return bi(`${a} allowed ${tg} to send messages again`, `${a} سمح لـ ${tg} بالإرسال مرة أخرى`);
    case 'settings': {
      const l = SETTING_LABELS[meta.key];
      const label = l ? bi(l[0], l[1]) : bi('a group setting', 'إعداد في المجموعة');
      return meta.value
        ? bi(`${a} turned on “${label}”`, `${a} فعّل «${label}»`)
        : bi(`${a} turned off “${label}”`, `${a} عطّل «${label}»`);
    }
    case 'account_deleted': return bi(`${a} deleted their account — you can no longer message them`, meActor ? 'حذفت حسابك' : `${a} حذف حسابه — لم يعد بإمكانك مراسلته`);
    case 'account_restored': return bi(`${a} restored their account`, meActor ? 'استرجعت حسابك' : `${a} استرجع حسابه`);
    default: return '';
  }
}

/** Server error strings (English) → Arabic, for the group endpoints. Unknown messages pass through. */
const AR_ERRORS = {
  'Only group admins can do that.': 'هذا الإجراء للمشرفين فقط.',
  'Only group admins can change the group settings.': 'تغيير إعدادات المجموعة للمشرفين فقط.',
  'Only group admins can edit the group info.': 'تعديل بيانات المجموعة للمشرفين فقط.',
  'Only group admins can add members.': 'إضافة الأعضاء للمشرفين فقط.',
  'Only group admins can share the invite link.': 'مشاركة رابط الدعوة للمشرفين فقط.',
  'Only admins can send messages in this group.': 'الإرسال في هذه المجموعة للمشرفين فقط.',
  'An admin has restricted you from sending messages in this group.': 'قام مشرف بمنعك من إرسال الرسائل في هذه المجموعة.',
  'This invite link is invalid or has been turned off.': 'رابط الدعوة غير صالح أو تم إيقافه.',
  'This group has reached its member limit.': 'وصلت المجموعة إلى الحد الأقصى للأعضاء.',
  'The group owner cannot be removed.': 'لا يمكن إزالة مالك المجموعة.',
  'Only the group owner can remove an admin.': 'إزالة المشرف من صلاحيات المالك فقط.',
  'Only the group owner can transfer ownership.': 'نقل الملكية من صلاحيات المالك فقط.',
  'Only the group owner can delete the group.': 'حذف المجموعة من صلاحيات المالك فقط.',
  'Group not found.': 'المجموعة غير موجودة.',
  'Group name is required.': 'اسم المجموعة مطلوب.',
  'Choose at least one allowed message type.': 'اختر نوع رسالة واحدًا على الأقل.',
  'That person is not in the group.': 'هذا الشخص ليس في المجموعة.',
  'Admins cannot be restricted. Remove their admin role first.': 'لا يمكن تقييد مشرف. أزل صلاحية الإشراف أولًا.',
  'This request was already handled.': 'تم التعامل مع هذا الطلب بالفعل.',
  'This person is not accepting new messages from you.': 'هذا الشخص لا يستقبل محادثات جديدة منك.',
  'This person is not accepting calls from you.': 'هذا الشخص لا يستقبل مكالمات منك.',
  'This person does not allow being added to groups by you.': 'هذا الشخص لا يسمح بإضافته للمجموعات من قبلك.',
  'Conversation not found.': 'المحادثة غير موجودة أو لم تعد عضوًا فيها.',
};
const AR_PREFIX = [
  ['This group does not allow ', (m) => `هذه المجموعة لا تسمح بـ ${m.replace('This group does not allow ', '').replace(/\.$/, '')}.`],
];

export function localizeError(message) {
  const m = String(message || '');
  if (bi('en', 'ar') === 'en') return m;
  if (AR_ERRORS[m]) return AR_ERRORS[m];
  for (const [prefix, fn] of AR_PREFIX) if (m.startsWith(prefix)) return fn(m);
  return m;
}
