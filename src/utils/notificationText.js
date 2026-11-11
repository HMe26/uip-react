/**
 * Client-side Arabic rendering of notifications.
 *
 * The API stores notification title/body as plain strings in whatever
 * language the originating service used (mostly English). Until the API
 * returns translation keys, we recognise the known English templates here
 * and render them in Arabic. Dynamic parts (exam / project / university
 * names, user-written text) are never translated — they are wrapped in
 * Unicode bidi isolates so an English name inside an Arabic sentence can't
 * scramble the word order or punctuation around it.
 *
 * Unknown strings are returned unchanged.
 */

const FSI = '⁨';
const PDI = '⁩';
const iso = (s) => (s ? `${FSI}${s}${PDI}` : s);

const STAGE_AR = { '1 hour': 'ساعة', '24 hours': '24 ساعة' };
const DECISION_AR = { accepted: 'تم قبول', rejected: 'تم رفض' };

// [regex, (matchGroups...) => arabic]
const TITLES = [
  [/^New announcement from (.+)$/, (u) => `إعلان جديد من ${iso(u)}`],
  [/^New post from (.+)$/, (u) => `منشور جديد من ${iso(u)}`],
  [/^New message from (.+)$/, (u) => `رسالة جديدة من ${iso(u)}`],
  [/^Exam available: (.+)$/, (t) => `امتحان متاح: ${iso(t)}`],
  [/^Exam scheduled: (.+)$/, (t) => `تمت جدولة امتحان: ${iso(t)}`],
  [/^New exam assigned: (.+)$/, (t) => `تم تعيين امتحان جديد: ${iso(t)}`],
  [/^You can retake: (.+)$/, (t) => `يمكنك إعادة الامتحان: ${iso(t)}`],
  [/^Exam attempt cancelled: (.+)$/, (t) => `تم إلغاء محاولة الامتحان: ${iso(t)}`],
  [/^Exam opens in (1 hour|24 hours): (.+)$/, (s, t) => `يبدأ الامتحان خلال ${STAGE_AR[s]}: ${iso(t)}`],
  [/^Exam closes in (1 hour|24 hours): (.+)$/, (s, t) => `ينتهي الامتحان خلال ${STAGE_AR[s]}: ${iso(t)}`],
  [/^Grade updated: (.+)$/, (t) => `تم تحديث الدرجة: ${iso(t)}`],
  [/^Result published: (.+)$/, (t) => `تم نشر النتيجة: ${iso(t)}`],
  [/^New grade appeal: (.+)$/, (t) => `تظلّم جديد على الدرجة: ${iso(t)}`],
  [/^Appeal (accepted|rejected): (.+)$/, (d, t) => `${d === 'accepted' ? 'تم قبول التظلّم' : 'تم رفض التظلّم'}: ${iso(t)}`],
  [/^Your university joined request was approved$/, () => 'تمت الموافقة على طلب انضمامك للجامعة'],
  [/^Your university joined request was declined$/, () => 'تم رفض طلب انضمامك للجامعة'],
  [/^New student join request$/, () => 'طلب انضمام طالب جديد'],
  [/^Your account was linked to a university$/, () => 'تم ربط حسابك بجامعة'],
  [/^New project submitted for review$/, () => 'مشروع جديد بانتظار المراجعة'],
  [/^"(.+)" was approved and published$/, (t) => `تمت الموافقة على ${iso(`"${t}"`)} ونشره`],
  [/^"(.+)" was approved by the (supervisor|faculty)$/, (t, s) => `تم اعتماد ${iso(`"${t}"`)} من ${s === 'supervisor' ? 'الدكتور المشرف' : 'الكلية'}`],
  [/^"(.+)" was approved$/, (t) => `تم اعتماد ${iso(`"${t}"`)} نهائيًا`],
  [/^"(.+)" was published$/, (t) => `تم نشر ${iso(`"${t}"`)} للعامة`],
  [/^"(.+)" was unpublished$/, (t) => `تم سحب ${iso(`"${t}"`)} من النشر العام`],
  [/^"(.+)" was rejected$/, (t) => `تم رفض ${iso(`"${t}"`)}`],
  [/^Changes requested on "(.+)"$/, (t) => `مطلوب تعديلات على ${iso(`"${t}"`)}`],
  [/^Your project "(.+)" was graded$/, (t) => `تم تقييم مشروعك ${iso(`"${t}"`)}`],
  [/^Invitation to join a project team$/, () => 'دعوة للانضمام لفريق مشروع'],
  [/^Congratulations, your graduation was approved!$/, () => 'تهانينا، تم اعتماد تخرجك!'],
  [/^Your graduation approval was revoked$/, () => 'تم إلغاء اعتماد تخرجك'],
  [/^Your graduation certificate was updated$/, () => 'تم تحديث بيانات شهادة تخرجك'],
  [/^Your academic (affiliation|details) (?:was|were) updated$/, () => 'تم تحديث بياناتك الأكاديمية'],
  [/^(.+) joined your meeting: (.+)$/, (p, m) => `${iso(p)} انضم إلى اجتماعك: ${iso(m)}`],
  [/^You have been invited to a meeting: (.+)$/, (m) => `تمت دعوتك إلى اجتماع: ${iso(m)}`],
  [/^Meeting starting soon: (.+)$/, (m) => `الاجتماع يبدأ قريباً: ${iso(m)}`],
  [/^Meeting rescheduled: (.+)$/, (m) => `تمت إعادة جدولة الاجتماع: ${iso(m)}`],
  [/^Meeting cancelled: (.+)$/, (m) => `تم إلغاء الاجتماع: ${iso(m)}`],
  [/^Meeting ended: (.+)$/, (m) => `انتهى الاجتماع: ${iso(m)}`],
  [/^Host started the meeting: (.+)$/, (m) => `بدأ المضيف الاجتماع: ${iso(m)}`],
  [/^New comment on: (.+)$/, (t) => `تعليق جديد على: ${iso(t)}`],
  [/^You were mentioned in: (.+)$/, (t) => `تمت الإشارة إليك في: ${iso(t)}`],
  [/^Your comment was resolved$/, () => 'تم حل تعليقك'],
];

const BODIES = [
  [/^Your grade appeal on "(.+)" was (accepted|rejected)\.$/, (t, d) => `${d === 'accepted' ? 'تم قبول' : 'تم رفض'} تظلّمك على درجة ${iso(`"${t}"`)}.`],
  [/^A student submitted a grade appeal on "(.+)"\.$/, (t) => `قدّم طالب تظلّماً على درجة ${iso(`"${t}"`)}.`],
  [/^"(.+)" is now available for you to take\.$/, (t) => `${iso(`"${t}"`)} متاح الآن لتؤدّيه.`],
  [/^"(.+)" has been scheduled(?: for (.+))?\.$/, (t, w) => `تمت جدولة ${iso(`"${t}"`)}${w ? ` بتاريخ ${iso(w)}` : ''}.`],
  [/^You have been added to the list of students for "(.+)"\.$/, (t) => `تمت إضافتك إلى قائمة طلاب ${iso(`"${t}"`)}.`],
  [/^"(.+)" opens at (.+)\.$/, (t, w) => `يبدأ ${iso(`"${t}"`)} في ${iso(w)}.`],
  [/^"(.+)" closes at (.+)\.$/, (t, w) => `ينتهي ${iso(`"${t}"`)} في ${iso(w)}.`],
  [/^One of your answers in "(.+)" was regraded\.$/, (t) => `أُعيد تصحيح إحدى إجاباتك في ${iso(`"${t}"`)}.`],
  [/^Your result for "(.+)" is now available\.$/, (t) => `نتيجتك في ${iso(`"${t}"`)} متاحة الآن.`],
  [/^Your attempt on "(.+?)" was cancelled by your instructor\.( You have been allowed to retake the exam\.)?$/, (t, r) => `ألغى المدرّس محاولتك في ${iso(`"${t}"`)}.${r ? ' يمكنك إعادة الامتحان.' : ''}`],
  [/^Your instructor allowed you another attempt on "(.+?)"\.(?: Available until (.+)\.)?$/, (t, u) => `سمح لك المدرّس بمحاولة أخرى في ${iso(`"${t}"`)}.${u ? ` متاح حتى ${iso(u)}.` : ''}`],
  [/^You are now linked to (.+)\.$/, (u) => `تم ربط حسابك بـ ${iso(u)}.`],
  [/^Your account is now linked to (.+)\.$/, (u) => `تم ربط حسابك بـ ${iso(u)}.`],
  [/^You can choose a different university and try again\.$/, () => 'يمكنك اختيار جامعة أخرى والمحاولة مرة أخرى.'],
  [/^(.+) was submitted for your approval\.$/, (t) => `تم تقديم ${iso(t)} لموافقتك.`],
  [/^Score: (.+)\.$/, (s) => `الدرجة: ${iso(s)}.`],
  [/^See the project page for the full breakdown\.$/, () => 'راجع تفاصيل التقييم من صفحة المشروع.'],
  [/^Reason: (.+)$/, (r) => `السبب: ${iso(r)}`],
  [/^Certificate number: (.+?)\. View your certificate and academic record on the Graduation page\.$/, (c) => `رقم الشهادة: ${iso(c)}. يمكنك عرض شهادتك وسجلك الأكاديمي من صفحة التخرج.`],
  [/^You've been invited as a team member on the project "(.+)"\.$/, (t) => `دعاك زميلك للانضمام كعضو فريق على مشروع ${iso(`"${t}"`)}.`],
  [/^A teammate commented on your report\.$/, () => 'علّق أحد زملائك على تقريرك.'],
  [/^A teammate mentioned you in a comment\.$/, () => 'أشار إليك أحد زملائك في تعليق.'],
  [/^The host rescheduled this meeting\.$/, () => 'أعاد المضيف جدولة هذا الاجتماع.'],
  [/^The host cancelled this meeting\.$/, () => 'ألغى المضيف هذا الاجتماع.'],
  [/^Starts at (.+)\.$/, (w) => `يبدأ في ${iso(w)}.`],
  [/^\(attachment\)$/, () => '(مرفق)'],
];

function run(rules, text) {
  if (!text) return text;
  for (const [re, fn] of rules) {
    const m = text.match(re);
    if (m) return fn(...m.slice(1));
  }
  return text;
}

/** Returns { title, body } localized for `locale` (only 'ar' changes anything). */
export function localizeNotification(n, locale) {
  if (locale !== 'ar') return { title: n.title, body: n.body };
  return { title: run(TITLES, n.title), body: run(BODIES, n.body) };
}
