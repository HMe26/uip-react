import { parseServerDate } from '../../utils/serverDate';
/**
 * Ported 1:1 from public/assets/js/ai/assistant.js (the PHP-app AI
 * Assistant widget): the bilingual string table and the tiny
 * copyright-safe markdown renderer it uses for message bubbles. No
 * wording or behavior changed — only converted from an IIFE closure into
 * plain exports for the React port (AiAssistantWidget.jsx).
 */

export const AI_STRINGS = {
  en: {
    title: 'UIPE AI Assistant', newChat: 'New chat', search: 'Search chats', searchPlaceholder: 'Search conversations…',
    placeholder: 'Ask the UIPE AI Assistant… (Shift+Enter for new line)', send: 'Send', stop: 'Stop generating',
    welcomeTitle: 'How can I help you today?', welcomeBody: 'I understand your role, portal and current page — ask me anything about your work on UIPE.',
    pinned: 'Pinned', recent: 'Recent', rename: 'Rename', pin: 'Pin', unpin: 'Unpin', archive: 'Archive', unarchive: 'Unarchive',
    del: 'Delete', exportChat: 'Export', share: 'Share', copy: 'Copy', copied: 'Copied!', regenerate: 'Regenerate', edit: 'Edit',
    recCancel: 'Discard recording', recPause: 'Pause', recResume: 'Resume', recDone: 'Finish and attach', recListening: 'Recording…', recPaused: 'Paused',
    recDenied: 'Microphone access is blocked. Allow it in your browser settings and try again.', recNoMic: 'No microphone found.', recUnsupported: 'Voice recording is not supported in this browser.', recShort: 'Recording too short — hold on a little longer.',
    ncLabel: 'Noise cancel', ncHint: 'Noise cancelling: filters background noise and hum for a cleaner voice',
    editVideo: 'Edit video', nrStrength: 'Noise removal', nrRun: 'Remove noise', nrAgain: 'Clean again', nrWorking: 'Cleaning the sound…', cancel: 'Cancel',
    nr_low: 'Light', nr_med: 'Medium', nr_high: 'Strong', nrBefore: 'Original', nrAfter: 'Cleaned', nrCompare: 'Compare original and cleaned sound',
    nrErr_unsupported: 'This browser cannot clean audio.', nrErr_too_large: 'The file is too large to clean on this device.', nrErr_too_long: 'The recording is too long to clean (8 min max).', nrErr_no_audio: 'No sound was found in this file.', nrErr_failed: 'Could not clean the sound. Try again or use a lighter strength.',
    trEdited: 'Edited', trReset: 'Restore original', trRedo: 'Transcribe again', trManual: 'Type what was said (optional)…', trEditHint: 'Wrong word? Edit it here — the assistant reads exactly this text.',
    bookmark: 'Bookmark', bookmarked: 'Bookmarked', react: 'React', attach: 'Attach files', voice: 'Record voice message',
    recording: 'Recording… click to stop', empty: 'No conversations yet', confirmDelete: 'Delete this conversation? This cannot be undone.',
    unavailable: 'The AI Assistant is not configured yet. Ask your platform admin to add an AI provider in Admin → AI Controls.',
    rateLimited: 'You are sending messages too fast. Please wait a moment.', errorGeneric: 'Something went wrong. Please try again.',
    timeoutError: 'This is taking longer than expected and the server stopped responding. Please try again.',
    you: 'You', assistant: 'UIPE AI Assistant', renamePrompt: 'New conversation title', typing: 'Thinking…', dragDrop: 'Drop files to attach',
    close: 'Close', backToList: 'Back to conversations', newChatShort: 'New',
    expand: 'Expand chat', collapseSize: 'Collapse chat', fullScreen: 'Full screen', exitFullScreen: 'Exit full screen',
    select: 'Select', cancelSelect: 'Cancel', selectAll: 'Select all', clearSelection: 'Clear selection', deleteSelected: 'Delete selected', deleteAll: 'Delete all',
    selectedCount: '{n} selected', confirmDeleteMany: 'Delete {n} conversation(s)? This cannot be undone.', bulkDeleteFailed: '{n} conversation(s) could not be deleted. Please try again.',
    hideHistory: 'Hide chat list', showHistory: 'Show chat list', background: 'Chat background',
    wall_none: 'Clean', wall_aurora: 'Aurora', wall_lagoon: 'Lagoon', wall_forest: 'Forest', wall_rose: 'Rose', wall_amber: 'Amber', wall_graphite: 'Graphite', wall_midnight: 'Midnight', menu: 'Menu',
    myPhotos: 'My photos', uploadBg: 'Upload a photo as background', useBg: 'Use this photo', deleteBg: 'Delete this photo',
    bgNotImage: 'Choose an image file.', bgTooBig: 'This image is larger than 15 MB.', bgLimit: 'You reached the limit of 12 saved backgrounds — delete one first.', bgStorage: 'Could not save this image on this device.',
    subtitle: 'Ask about your UIPE workspace', newChatLabel: 'New Chat', tryAsking: 'Try asking', suggestionsCount: 'suggestions',
    disclaimer: 'UIPE AI can make mistakes. Review important information.', history: 'History', conversationHistory: 'Conversation history',
    recentChats: 'Recent chats', today: 'Today', yesterday: 'Yesterday', previous7: 'Previous 7 days', older: 'Older',
    helpful: 'Helpful', analyzing: 'UIPE AI is analyzing…', streamingResponse: 'Streaming response', stopShort: 'Stop',
    errorTitle: 'Error', permissionTitle: 'No Permission', serviceTitle: 'Service Error', retry: 'Retry', tryAgain: 'Try Again',
    permissionText: "I can't access that information. Your current account doesn't have permission to view this data.",
    expandedWorkspace: 'Expanded AI Workspace', followUp: 'Ask a follow-up question…', ago: 'ago',
    greetMorning: 'Good morning', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening', hi: 'Hi',
    transcript: 'Auto transcript', showMore: 'Show more', showLess: 'Show less', uploading: 'Uploading…',
    transcribing: 'Transcribing', transcribed: 'Transcript ready', noSpeech: 'No clear speech found', transcribeOff: 'Transcription is not enabled — sent as audio only',
    transcribeFailed: 'Transcription failed', voiceNote: 'Voice message', remove: 'Remove', waitTranscribe: 'Transcribing the recording… it will be sent with the message',
    playVideo: 'Play video', loadFailed: 'Could not load — tap to retry', download: 'Download',
  },
  ar: {
    title: 'مساعد UIPE الذكي', newChat: 'محادثة جديدة', search: 'بحث في المحادثات', searchPlaceholder: 'ابحث في المحادثات…',
    placeholder: 'اسأل مساعد UIPE… (Shift+Enter لسطر جديد)', send: 'إرسال', stop: 'إيقاف التوليد',
    welcomeTitle: 'كيف يمكنني مساعدتك اليوم؟', welcomeBody: 'أنا أفهم دورك والبوابة الحالية وصفحتك — اسألني عن أي شيء يخص عملك على UIPE.',
    pinned: 'مثبتة', recent: 'الأحدث', rename: 'إعادة تسمية', pin: 'تثبيت', unpin: 'إلغاء التثبيت', archive: 'أرشفة', unarchive: 'إلغاء الأرشفة',
    del: 'حذف', exportChat: 'تصدير', share: 'مشاركة', copy: 'نسخ', copied: 'تم النسخ!', regenerate: 'إعادة توليد', edit: 'تعديل',
    recCancel: 'إلغاء التسجيل', recPause: 'إيقاف مؤقت', recResume: 'متابعة', recDone: 'إنهاء وإرفاق', recListening: 'جارٍ التسجيل…', recPaused: 'متوقف مؤقتًا',
    recDenied: 'الوصول إلى الميكروفون محظور. اسمح به من إعدادات المتصفح ثم حاول مرة أخرى.', recNoMic: 'لم يتم العثور على ميكروفون.', recUnsupported: 'التسجيل الصوتي غير مدعوم في هذا المتصفح.', recShort: 'التسجيل قصير جدًا — استمر قليلًا.',
    ncLabel: 'عزل الضوضاء', ncHint: 'عزل الضوضاء: يقلل ضجيج الخلفية والطنين لصوت أنقى',
    editVideo: 'تعديل الفيديو', nrStrength: 'عزل الضوضاء', nrRun: 'عزل الضوضاء', nrAgain: 'تنظيف مرة أخرى', nrWorking: 'جارٍ تنظيف الصوت…', cancel: 'إلغاء',
    nr_low: 'خفيف', nr_med: 'متوسط', nr_high: 'قوي', nrBefore: 'الأصلي', nrAfter: 'المنظّف', nrCompare: 'قارن بين الصوت الأصلي والمنظّف',
    nrErr_unsupported: 'هذا المتصفح لا يدعم تنظيف الصوت.', nrErr_too_large: 'الملف أكبر من أن يُنظَّف على هذا الجهاز.', nrErr_too_long: 'التسجيل أطول من اللازم للتنظيف (8 دقائق كحد أقصى).', nrErr_no_audio: 'لا يوجد صوت في هذا الملف.', nrErr_failed: 'تعذّر تنظيف الصوت. حاول مرة أخرى أو اختر قوة أخف.',
    trEdited: 'معدَّل', trReset: 'استرجاع الأصلي', trRedo: 'إعادة التفريغ', trManual: 'اكتب ما قيل في التسجيل (اختياري)…', trEditHint: 'كلمة غلط؟ عدّلها هنا — المساعد بيقرأ هذا النص بالضبط.',
    bookmark: 'حفظ', bookmarked: 'محفوظة', react: 'تفاعل', attach: 'إرفاق ملفات', voice: 'تسجيل رسالة صوتية',
    recording: 'جارٍ التسجيل… اضغط للإيقاف', empty: 'لا توجد محادثات بعد', confirmDelete: 'حذف هذه المحادثة؟ لا يمكن التراجع.',
    unavailable: 'لم يتم تفعيل المساعد الذكي بعد. اطلب من مسؤول المنصة إضافة مزوّد ذكاء اصطناعي من لوحة التحكم.',
    rateLimited: 'أنت ترسل رسائل بسرعة كبيرة. الرجاء الانتظار قليلاً.', errorGeneric: 'حدث خطأ ما. حاول مرة أخرى.',
    timeoutError: 'الاستجابة تأخرت أكثر من المتوقع وتوقف الخادم عن الرد. حاول مرة أخرى.',
    you: 'أنت', assistant: 'مساعد UIPE الذكي', renamePrompt: 'عنوان المحادثة الجديد', typing: 'يفكر…', dragDrop: 'أفلت الملفات هنا للإرفاق',
    close: 'إغلاق', backToList: 'العودة للمحادثات', newChatShort: 'جديد',
    expand: 'تكبير نافذة المحادثة', collapseSize: 'تصغير نافذة المحادثة', fullScreen: 'ملء الشاشة', exitFullScreen: 'الخروج من ملء الشاشة',
    select: 'تحديد', cancelSelect: 'إلغاء', selectAll: 'تحديد الكل', clearSelection: 'إلغاء التحديد', deleteSelected: 'حذف المحدد', deleteAll: 'حذف الكل',
    selectedCount: 'تم تحديد {n}', confirmDeleteMany: 'تحذف {n} محادثة؟ مش هتقدر ترجعها تاني.', bulkDeleteFailed: '{n} محادثة معرفتش أحذفها. جرّب تاني.',
    hideHistory: 'إخفاء قائمة المحادثات', showHistory: 'إظهار قائمة المحادثات', background: 'خلفية المحادثة',
    wall_none: 'نظيف', wall_aurora: 'شفق', wall_lagoon: 'بحيرة', wall_forest: 'غابة', wall_rose: 'وردي', wall_amber: 'كهرماني', wall_graphite: 'جرافيت', wall_midnight: 'منتصف الليل', menu: 'القائمة',
    myPhotos: 'صوري', uploadBg: 'ارفع صورة كخلفية', useBg: 'استخدم الصورة دي', deleteBg: 'امسح الصورة دي',
    bgNotImage: 'اختار ملف صورة.', bgTooBig: 'الصورة أكبر من 15 ميجا.', bgLimit: 'وصلت للحد الأقصى (12 خلفية محفوظة) — امسح واحدة الأول.', bgStorage: 'مقدرتش أحفظ الصورة على الجهاز ده.',
    subtitle: 'اسأل عن مساحة عملك في UIPE', newChatLabel: 'محادثة جديدة', tryAsking: 'جرّب أن تسأل', suggestionsCount: 'اقتراحات',
    disclaimer: 'قد يخطئ مساعد UIPE. راجع المعلومات المهمة.', history: 'السجل', conversationHistory: 'سجل المحادثات',
    recentChats: 'المحادثات الأخيرة', today: 'اليوم', yesterday: 'أمس', previous7: 'آخر 7 أيام', older: 'أقدم',
    helpful: 'مفيد', analyzing: 'مساعد UIPE يحلّل…', streamingResponse: 'جارٍ كتابة الرد', stopShort: 'إيقاف',
    errorTitle: 'خطأ', permissionTitle: 'لا توجد صلاحية', serviceTitle: 'خطأ في الخدمة', retry: 'إعادة المحاولة', tryAgain: 'حاول مجددًا',
    permissionText: 'لا أستطيع الوصول إلى هذه المعلومات. حسابك الحالي لا يملك صلاحية عرض هذه البيانات.',
    expandedWorkspace: 'مساحة المساعد الموسّعة', followUp: 'اسأل سؤال متابعة…', ago: '',
    greetMorning: 'صباح الخير', greetAfternoon: 'مساء الخير', greetEvening: 'مساء الخير', hi: 'أهلًا',
    transcript: 'تفريغ نصي تلقائي', showMore: 'عرض المزيد', showLess: 'عرض أقل', uploading: 'جارٍ الرفع…',
    transcribing: 'جارٍ التفريغ', transcribed: 'التفريغ جاهز', noSpeech: 'مفيش كلام واضح في التسجيل', transcribeOff: 'التفريغ مش مفعّل — هيتبعت كصوت بس',
    transcribeFailed: 'فشل التفريغ', voiceNote: 'رسالة صوتية', remove: 'إزالة', waitTranscribe: 'جارٍ تفريغ التسجيل… هيتبعت مع الرسالة',
    playVideo: 'تشغيل الفيديو', loadFailed: 'تعذّر التحميل — اضغط للإعادة', download: 'تحميل',
  },
};

/** Role-aware welcome copy + suggested prompts (sent as ordinary messages). */
const STAFF_ROLES = ['supervisor', 'faculty', 'academic_staff'];
export function roleContent(role, locale) {
  const ar = locale === 'ar';
  if (role === 'student') {
    return {
      eyebrow: ar ? 'مساحة الطالب' : 'STUDENT SPACE',
      body: ar ? 'أستطيع مساعدتك في فهم مشروعك وملاحظاتك ودرجة الجاهزية وأعمالك القادمة.' : 'I can help you understand your project, feedback, readiness score, and upcoming work.',
      suggestions: ar
        ? ['حلّل مشروع تخرجي', 'كيف أحسّن درجة الجاهزية؟', 'اشرح لي آخر ملاحظات على مشروعي', 'اعرض مواعيدي القادمة']
        : ['Analyze my graduation project', 'How can I improve my readiness score?', 'Explain my latest project feedback', 'Show my upcoming deadlines'],
    };
  }
  if (STAFF_ROLES.includes(role)) {
    return {
      eyebrow: ar ? 'الهيئة الأكاديمية · المساعد الذكي' : 'ACADEMIC STAFF · AI ASSISTANT',
      body: ar ? 'أستطيع مساعدتك في مراجعة المشاريع ومتابعة تقدم الطلاب وتلخيص العمل الأكاديمي.' : 'I can help you review projects, follow student progress, and summarize academic work.',
      suggestions: ar
        ? ['أي المشاريع تحتاج انتباهي؟', 'لخّص حالة الطلاب الذين أشرف عليهم', 'اكتب ملاحظات على مشروع', 'اعرض امتحاناتي القادمة', 'لخّص التصحيح المعلّق']
        : ['Which projects need my attention?', 'Summarize my supervised students', 'Draft feedback for a project', 'Show my upcoming exams', 'Summarize pending grading'],
    };
  }
  const label = {
    admin: ['ADMIN', 'الإدارة'], university: ['UNIVERSITY', 'الجامعة'], data_analyst: ['DATA ANALYSIS', 'تحليل البيانات'],
    security_admin: ['SECURITY', 'الأمان'], security_officer: ['SECURITY', 'الأمان'],
  }[role] || ['UIPE', 'UIPE'];
  return {
    eyebrow: ar ? `${label[1]} · المساعد الذكي` : `${label[0]} · AI ASSISTANT`,
    body: ar ? 'أستطيع مساعدتك في فهم صفحتك الحالية ومتابعة عملك على UIPE.' : 'I can help you understand your current page and follow your work on UIPE.',
    suggestions: ar
      ? ['ما الذي يحتاج انتباهي اليوم؟', 'لخّص آخر النشاطات', 'اشرح لي هذه الصفحة']
      : ['What needs my attention today?', 'Summarize recent activity', 'Explain this page'],
  };
}

export function greeting(t, name) {
  const h = new Date().getHours();
  const base = h < 12 ? t('greetMorning') : h < 18 ? t('greetAfternoon') : t('greetEvening');
  return name ? `${base}, ${name}.` : `${base}.`;
}

function convDate(c) {
  const raw = c.updated_at || c.last_message_at || c.created_at;
  if (!raw) return null;
  const d = parseServerDate(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Relative time for the history list ("2h ago", "Yesterday", "Aug 30"). */
export function relTime(c, t, locale) {
  const d = convDate(c);
  if (!d) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  const ar = locale === 'ar';
  if (mins < 1) return ar ? 'الآن' : 'Just now';
  if (mins < 60) return ar ? `منذ ${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24 && d.toDateString() === new Date().toDateString()) return ar ? `منذ ${hrs} س` : `${hrs}h ago`;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 1) return t('yesterday');
  return d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
}

/** Pinned first, then Today / Yesterday / Previous 7 days / Older. Conversations
 *  with no usable date fall into one "Recent" group (the pre-redesign label). */
export function groupConversations(conversations, t) {
  const groups = [];
  const pinned = conversations.filter((c) => c.is_pinned);
  if (pinned.length) groups.push({ key: 'pinned', label: t('pinned'), items: pinned });
  const buckets = { today: [], yesterday: [], week: [], older: [], undated: [] };
  const now = new Date();
  conversations.filter((c) => !c.is_pinned).forEach((c) => {
    const d = convDate(c);
    if (!d) { buckets.undated.push(c); return; }
    const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (days <= 0) buckets.today.push(c);
    else if (days === 1) buckets.yesterday.push(c);
    else if (days <= 7) buckets.week.push(c);
    else buckets.older.push(c);
  });
  [['today', t('today')], ['yesterday', t('yesterday')], ['week', t('previous7')], ['older', t('older')], ['undated', t('recent')]]
    .forEach(([k, label]) => { if (buckets[k].length) groups.push({ key: k, label, items: buckets[k] }); });
  return groups;
}

export function isTempId(id) {
  return typeof id === 'string' && (id.indexOf('streaming_') === 0 || id.indexOf('tmp_msg_') === 0);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Own copyright-safe implementation; no CDN dep — ported verbatim. */
export function renderMarkdown(src, copyLabel) {
  src = String(src == null ? '' : src);
  const codeBlocks = [];
  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang, code: code.replace(/\n$/, '') });
    return '\u0000CODE' + idx + '\u0000';
  });

  const lines = esc(src).split('\n');
  const html = [];
  let inList = null;
  let inQuote = false;
  let tableBuf = [];

  function closeList() { if (inList) { html.push('</' + inList + '>'); inList = null; } }
  function closeQuote() { if (inQuote) { html.push('</blockquote>'); inQuote = false; } }
  function splitRow(l) { return l.replace(/^\s*\||\|\s*$/g, '').split('|').map((s) => s.trim()); }
  function flushTable() {
    if (!tableBuf.length) return;
    const rows = tableBuf.filter((l) => !/^\s*\|?\s*[-:| ]+\s*\|?\s*$/.test(l));
    html.push('<table><thead><tr>');
    splitRow(rows[0]).forEach((c) => html.push('<th>' + inline(c) + '</th>'));
    html.push('</tr></thead><tbody>');
    for (let i = 1; i < rows.length; i++) {
      html.push('<tr>');
      splitRow(rows[i]).forEach((c) => html.push('<td>' + inline(c) + '</td>'));
      html.push('</tr>');
    }
    html.push('</tbody></table>');
    tableBuf = [];
  }

  function inline(text) {
    // Remote images are NOT auto-loaded: a model reply (or an injected prompt) could otherwise leak chat data to any
    // server through the image URL. Shown as a normal link instead — the user decides whether to open it.
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) =>
      (/^https?:\/\//i.test(url) ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' + (alt || url) + '</a>' : m));
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, label, url) =>
      (/^https?:\/\//i.test(url) ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : m));
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return text;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) { closeList(); closeQuote(); tableBuf.push(line); continue; }
    if (tableBuf.length) { flushTable(); }

    if (/^\s*&gt;\s?/.test(line)) {
      closeList();
      if (!inQuote) { html.push('<blockquote>'); inQuote = true; }
      html.push('<p>' + inline(line.replace(/^\s*&gt;\s?/, '')) + '</p>');
      continue;
    }
    closeQuote();

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); html.push('<h' + (h[1].length + 2) + '>' + inline(h[2]) + '</h' + (h[1].length + 2) + '>'); continue; }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol) {
      if (inList !== 'ol') { closeList(); html.push('<ol>'); inList = 'ol'; }
      html.push('<li>' + inline(ol[1]) + '</li>');
      continue;
    }
    if (ul) {
      if (inList !== 'ul') { closeList(); html.push('<ul>'); inList = 'ul'; }
      html.push('<li>' + inline(ul[1]) + '</li>');
      continue;
    }
    closeList();

    if (line.trim() === '') { continue; }
    html.push('<p>' + inline(line) + '</p>');
  }
  closeList(); closeQuote(); flushTable();

  let out = html.join('\n');
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const blk = codeBlocks[parseInt(i, 10)];
    if (!blk) return '';
    return '<pre><button type="button" class="ai-code-copy" data-copy-code>' + (copyLabel || 'Copy') + '</button><code class="language-' + esc(blk.lang) + '">' + esc(blk.code) + '</code></pre>';
  });
  return out || '<p></p>';
}

export function fmtTime(iso, locale) {
  if (!iso) return '';
  try {
    const d = parseServerDate(iso);
    return d.toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
