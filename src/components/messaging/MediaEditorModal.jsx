import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../context/LanguageContext';
import { lockScroll } from '../../lib/scrollLock';
import { AutoSubError, generateAutoSubtitles, getAutoSubtitleStatus } from '../../lib/autoSubtitles';
import { parseCues } from '../VideoPlayer';
import { NR_LEVELS, NoiseError, decodeForDenoise, denoiseBuffer, getDenoiseInfo } from '../../lib/noiseReduce';
import { fmtBytes, fmtClock } from './format';
import { reportClientIssue } from '../../api/client';

/**
 * Pre-send media editor for the messaging composer (WhatsApp / Telegram style).
 *
 *  - Images : crop (free / 1:1 / 4:3 / 3:4 / 16:9 / 9:16), rotate, flip, freehand
 *             drawing, text stamps, colour filters + brightness / contrast /
 *             saturation, output size (resolution + JPEG quality), undo / reset.
 *  - Videos : trim (drag handles over a frame strip), crop the picture, rotate,
 *             flip, colour filters + adjustments, smaller output size (720p /
 *             480p / 360p), mute, and subtitles (automatic Arabic / English /
 *             original, or .srt/.vtt) burned into the video. Everything runs
 *             on the device — no server work. Fast path: WebCodecs (hardware
 *             decode/encode, faster than playback, same code in the browser and
 *             the APK); fallback: real-time canvas + MediaRecorder.
 *  - Both   : caption field, "Done" (back to composer) or "Send" right away.
 *
 * Output is always a plain `File`, so the existing upload flow
 * (Messages.jsx -> /conversations/{id}/messages) is unchanged.
 */

const TEXTS = {
  en: {
    title: 'Edit before sending',
    titleSave: 'Edit file',
    save: 'Save',
    newText: 'New text',
    addText: 'Add',
    hintTextPhone: 'Type your text, then drag it with your finger to where you want it.',
    subTabStyle: 'Style',
    subTabText: 'Edit text',
    subAutoShort: 'Automatic',
    subNoTranslate: 'No translation',
    subPick: 'Pick the subtitle language',
    tools: 'Tools',
    previewTitle: 'Preview',
    close: 'Close',
    draw: 'Draw',
    crop: 'Crop',
    text: 'Text',
    rotate: 'Rotate',
    flip: 'Flip',
    undo: 'Undo',
    redo: 'Redo',
    reset: 'Reset',
    free: 'Free',
    size: 'Size',
    applyCrop: 'Apply crop',
    cancelCrop: 'Cancel',
    typeHere: 'Type text, press Enter',
    caption: 'Add a caption…',
    done: 'Done',
    send: 'Send',
    working: 'Processing…',
    loadFail: 'Could not open this file.',
    gifNote: 'Animated GIFs are sent as they are (editing would remove the animation).',
    trim: 'Trim',
    start: 'Start',
    end: 'End',
    length: 'Length',
    mute: 'Remove sound',
    muted: 'Sound removed',
    play: 'Play',
    pause: 'Pause',
    exporting: 'Preparing the video… keep this tab open',
    cancel: 'Cancel',
    remaining: (s) => (s >= 60 ? `about ${Math.ceil(s / 60)} min left` : `about ${Math.max(1, s)} s left`),
    unsupported: 'This browser cannot trim videos. The original video will be sent.',
    trimFail: 'Could not process the video. Try a shorter clip or another browser.',
    hintDraw: 'Draw on the picture with your finger or mouse.',
    hintText: 'Tap where you want to add text. Drag a text to move it, double-tap to edit.',
    move: 'Move', resize: 'Drag to resize', del: 'Delete text', hintMove: 'Tap a text, then drag it to move it. Double-tap to edit.',
    hintCrop: 'Drag the frame or its handles to choose the area to keep.',
    hintTrim: 'Drag the yellow handles to keep only the part you want.',
    frame: 'Frame',
    filters: 'Filters',
    size2: 'Size',
    brightness: 'Brightness',
    contrast: 'Contrast',
    saturation: 'Saturation',
    presets: { none: 'None', vivid: 'Vivid', warm: 'Warm', cool: 'Cool', vintage: 'Vintage', fade: 'Fade', bw: 'B&W', noir: 'Noir', sepia: 'Sepia' },
    vq: { orig: 'Original', p720: '720p', p480: '480p', p360: '360p' },
    iq: { orig: 'Original', hd: 'High', sd: 'Medium', xs: 'Small' },
    hintFrame: 'Drag the frame or its handles to choose the part of the picture to keep. Rotate / flip are next to it.',
    hintFilter: 'Pick a look or fine-tune brightness, contrast and colour.',
    hintSizeImg: 'A smaller size uploads faster and takes less space.',
    hintQuality: 'Smaller size = lower resolution and bitrate, so it uploads faster. Sizes shown are estimates.',
    subs: 'Subtitles',
    subsOn: 'Subtitles added',
    subArabic: 'Arabic',
    subEnglish: 'English',
    subOriginal: 'Original',
    subOriginalTitle: 'Original language (no translation)',
    subFile: 'Add .srt / .vtt',
    subEdit: 'Edit text',
    subEditHint: 'Tap a line to jump to it in the video, fix any mistakes, or delete a line. Changes are burned in when you send.',
    subGoto: 'Show this moment',
    subDelCue: 'Delete this line',
    subRemove: 'Remove',
    subStyle: 'Subtitle style',
    stFont: 'Font', stSize: 'Size', stColor: 'Colour', stBg: 'Background', stPos: 'Position', stReset: 'Reset', stCustom: 'Pick any colour',
    stFonts: { def: 'Default', cairo: 'Cairo', amiri: 'Amiri', mono: 'Typewriter', tajawal: 'Tajawal', lalezar: 'Lalezar', kufi: 'Kufi', bebas: 'Bebas', script: 'Script', serif: 'Serif' },
    stPreset: 'Designs', stAccent: 'Accent', stAuto: 'Auto',
    stPresets: { classic: 'Classic', bold: 'Bold', neon: 'Neon', neonPink: 'Pink neon', marker: 'Marker', pill: 'Pill', glass: 'Glass', retro: 'Retro 3D', fire: 'Fire', elegant: 'Elegant', underline: 'Underline', typewriter: 'Typewriter', script: 'Script', mint: 'Mint', kufi: 'Kufi 3D', impact: 'Impact' },
    stSizes: { s: 'Small', m: 'Medium', l: 'Large' },
    stBgs: { outline: 'Outline', box: 'Box', shadow: 'Shadow', neon: 'Neon', marker: 'Marker', block3d: '3D', sticker: 'Sticker', gradient: 'Gradient', pill: 'Pill', glass: 'Glass', underline: 'Underline' },
    stPoss: { top: 'Top', middle: 'Middle', bottom: 'Bottom' },
    noise: 'Noise',
    noiseOn: 'Noise removed',
    nrLevel: 'Strength',
    nrLevels: { low: 'Light', med: 'Medium', high: 'Strong' },
    nrRun: 'Remove noise',
    nrWorking: 'Cleaning the sound…',
    nrBefore: 'Before (original)',
    nrAfter: 'After (cleaned)',
    nrHint: 'Removes background noise with an AI voice-cleaning model: keyboard, fans, AC, hiss, hum, wind, street and crowd noise. The voice keeps its volume. Pick a strength, press the button, then play the video to hear it.',
    nrReady: 'Play the video and switch between Before and After to compare. Whatever is selected is what gets sent.',
    nrMuted: 'The sound is removed from this video, so there is nothing to clean.',
    nrMusic: 'This sound has music or other non-speech sounds, so a gentler mode was used to keep them intact. Play the video and compare Before and After.',
    nrErrors: {
      no_audio: 'This video has no sound the browser can read',
      too_large: 'The video is too large to clean in the browser (max 300 MB)',
      too_long: 'The video is too long to clean in the browser (max 8 minutes)',
      unsupported: 'This browser cannot process the sound',
      failed: 'Could not clean the sound. Please try again.',
    },
    subReady: (n) => `Subtitles ready (${n} lines) — they will be burned into the video when you send it.`,
    subHint: 'Pick a language and the speech is transcribed and translated automatically.',
    subNoFile: 'No subtitles found in that file',
    subDownload: 'Reading the video…',
    subDecode: 'Reading the audio…',
    subTranscribe: (d, t) => `Transcribing… ${d}/${t}`,
    subPartial: 'Stopped early — part of the subtitles are missing',
    subUntranslated: 'Some lines could not be translated and stay in the original language',
    subErrors: {
      unavailable: 'Automatic subtitles are not enabled on the server',
      unsupported: 'This browser cannot read the video audio',
      fetch_failed: 'Could not read the video for analysis',
      too_large: 'The video is too large to analyse in the browser (max 300 MB)',
      decode_failed: 'Could not read the audio of this video (it may have no sound)',
      no_audio: 'This video has no audio track',
      no_speech: 'No clear speech was found in the video',
      rate_limited: 'Too many requests — wait a moment and try again',
      failed: 'Automatic subtitles failed. Please try again.',
    },
  },
  ar: {
    title: 'تعديل قبل الإرسال',
    titleSave: 'تعديل الملف',
    save: 'حفظ',
    newText: 'نص جديد',
    addText: 'إضافة',
    hintTextPhone: 'اكتب النص وبعدين اسحبه بإصبعك للمكان اللي عايزه.',
    subTabStyle: 'الشكل',
    subTabText: 'تعديل النص',
    subAutoShort: 'تلقائي',
    subNoTranslate: 'من غير ترجمة',
    subPick: 'اختار لغة الترجمة',
    tools: 'الأدوات',
    previewTitle: 'معاينة',
    close: 'إغلاق',
    draw: 'رسم',
    crop: 'قص',
    text: 'نص',
    rotate: 'تدوير',
    flip: 'قلب',
    undo: 'تراجع',
    redo: 'إعادة',
    reset: 'إعادة ضبط',
    free: 'حر',
    size: 'الحجم',
    applyCrop: 'تطبيق القص',
    cancelCrop: 'إلغاء',
    typeHere: 'اكتب النص ثم Enter',
    caption: 'أضف تعليقًا…',
    done: 'تم',
    send: 'إرسال',
    working: 'جارٍ المعالجة…',
    loadFail: 'تعذّر فتح الملف.',
    gifNote: 'صور GIF المتحركة بتتبعت زي ما هي (التعديل بيشيل الحركة).',
    trim: 'قص الفيديو',
    start: 'البداية',
    end: 'النهاية',
    length: 'المدة',
    mute: 'حذف الصوت',
    muted: 'تم حذف الصوت',
    play: 'تشغيل',
    pause: 'إيقاف',
    exporting: 'جارٍ تجهيز الفيديو… سيب التبويب مفتوح',
    cancel: 'إلغاء',
    remaining: (s) => (s >= 60 ? `متبقي حوالي ${Math.ceil(s / 60)} د` : `متبقي حوالي ${Math.max(1, s)} ث`),
    unsupported: 'المتصفح ده مش بيدعم قص الفيديو. هيتبعت الفيديو الأصلي.',
    trimFail: 'تعذّرت معالجة الفيديو. جرّب مقطع أقصر أو متصفح تاني.',
    hintDraw: 'ارسم على الصورة بإصبعك أو بالماوس.',
    hintText: 'اضغط على المكان اللي عايز تكتب فيه. اسحب النص عشان تحركه، ودوس مرتين عليه عشان تعدّله.',
    move: 'تحريك', resize: 'اسحب لتكبير النص وتصغيره', del: 'حذف النص', hintMove: 'اضغط على النص وبعدين اسحبه عشان تحركه. دوس مرتين عليه للتعديل.',
    hintCrop: 'اسحب الإطار أو مقابضه لاختيار الجزء اللي هيتحفظ.',
    hintTrim: 'اسحب المقابض الصفراء علشان تسيب الجزء اللي عايزه بس.',
    frame: 'الإطار',
    filters: 'فلتر',
    size2: 'الحجم',
    brightness: 'السطوع',
    contrast: 'التباين',
    saturation: 'التشبع',
    presets: { none: 'بدون', vivid: 'زاهي', warm: 'دافئ', cool: 'بارد', vintage: 'قديم', fade: 'باهت', bw: 'أبيض وأسود', noir: 'نوار', sepia: 'سيبيا' },
    vq: { orig: 'الأصلي', p720: '720p', p480: '480p', p360: '360p' },
    iq: { orig: 'الأصلي', hd: 'عالي', sd: 'متوسط', xs: 'صغير' },
    hintFrame: 'اسحب الإطار أو مقابضه لاختيار الجزء اللي هيفضل من الصورة. التدوير والقلب جنبه.',
    hintFilter: 'اختار شكل جاهز أو اظبط السطوع والتباين والألوان.',
    hintSizeImg: 'الحجم الأصغر بيترفع أسرع وبياخد مساحة أقل.',
    hintQuality: 'حجم أصغر = دقة وجودة أقل، فبيترفع أسرع. الأحجام المعروضة تقديرية.',
    subs: 'ترجمة',
    subsOn: 'تمت إضافة الترجمة',
    subArabic: 'عربي',
    subEnglish: 'English',
    subOriginal: 'الأصلية',
    subOriginalTitle: 'اللغة الأصلية (من غير ترجمة)',
    subFile: 'ملف .srt / .vtt',
    subEdit: 'تعديل النص',
    subEditHint: 'اضغط على السطر للانتقال إليه في الفيديو، صحّح أي خطأ أو احذف السطر. التعديلات تُدمج في الفيديو عند الإرسال.',
    subGoto: 'عرض هذه اللحظة',
    subDelCue: 'حذف هذا السطر',
    subRemove: 'إزالة',
    subStyle: 'شكل الترجمة',
    stFont: 'الخط', stSize: 'الحجم', stColor: 'اللون', stBg: 'الخلفية', stPos: 'المكان', stReset: 'الافتراضي', stCustom: 'اختار أي لون',
    stFonts: { def: 'عادي', cairo: 'كايرو', amiri: 'أميري', mono: 'آلة كاتبة', tajawal: 'تجوال', lalezar: 'لالزار', kufi: 'ريم كوفي', bebas: 'بيباس', script: 'خط يدوي', serif: 'سيريف' },
    stPreset: 'تصاميم جاهزة', stAccent: 'اللون الثاني', stAuto: 'تلقائي',
    stPresets: { classic: 'كلاسيك', bold: 'عريض', neon: 'نيون', neonPink: 'نيون وردي', marker: 'هايلايت', pill: 'كبسولة', glass: 'زجاجي', retro: 'ريترو 3D', fire: 'نار', elegant: 'أنيق', underline: 'خط سفلي', typewriter: 'آلة كاتبة', script: 'خط يدوي', mint: 'نعناع', kufi: 'كوفي 3D', impact: 'إمباكت' },
    stSizes: { s: 'صغير', m: 'وسط', l: 'كبير' },
    stBgs: { outline: 'إطار', box: 'صندوق', shadow: 'ظل', neon: 'نيون', marker: 'هايلايت', block3d: 'ثلاثي الأبعاد', sticker: 'ستيكر', gradient: 'تدرج', pill: 'كبسولة', glass: 'زجاجي', underline: 'خط سفلي' },
    stPoss: { top: 'فوق', middle: 'النص', bottom: 'تحت' },
    noise: 'عزل الضوضاء',
    noiseOn: 'تم عزل الضوضاء',
    nrLevel: 'القوة',
    nrLevels: { low: 'خفيف', med: 'متوسط', high: 'قوي' },
    nrRun: 'عزل الضوضاء',
    nrWorking: 'بننضّف الصوت…',
    nrBefore: 'قبل (الأصلي)',
    nrAfter: 'بعد (بدون ضوضاء)',
    nrHint: 'بيشيل ضوضاء الخلفية بموديل ذكاء اصطناعي لتنضيف الصوت: كيبورد، مروحة، تكييف، فشّ، همهمة، هواء، شارع وزحمة. وصوتك بيفضل بنفس مستواه. اختار القوة واضغط الزرار وبعدها شغّل الفيديو واسمع.',
    nrReady: 'شغّل الفيديو وبدّل بين قبل وبعد عشان تقارن. اللي مختاره هو اللي هيتبعت.',
    nrMuted: 'الصوت متشال من الفيديو ده، فمفيش حاجة تتنضّف.',
    nrMusic: 'الصوت ده فيه موسيقى أو أصوات مش كلام، فاستخدمنا وضع أخف عشان منضيّعهاش. شغّل الفيديو وقارن بين قبل وبعد.',
    nrErrors: {
      no_audio: 'الفيديو ده مفيهوش صوت المتصفح يقدر يقرأه',
      too_large: 'الفيديو كبير أوي على التنضيف في المتصفح (الحد 300 ميجا)',
      too_long: 'الفيديو طويل أوي على التنضيف في المتصفح (الحد 8 دقايق)',
      unsupported: 'المتصفح ده مش بيقدر يعالج الصوت',
      failed: 'معرفناش ننضّف الصوت. جرّب تاني.',
    },
    subReady: (n) => `الترجمة جاهزة (${n} سطر) — هتتكتب على الفيديو نفسه لما تبعته.`,
    subHint: 'اختار اللغة وهيتم تفريغ الكلام وترجمته أوتوماتيك.',
    subNoFile: 'مفيش ترجمة في الملف ده',
    subDownload: 'بنقرأ الفيديو…',
    subDecode: 'بنقرأ الصوت…',
    subTranscribe: (d, t) => `بنكتب الكلام… ${d}/${t}`,
    subPartial: 'اتوقفت بدري — جزء من الترجمة ناقص',
    subUntranslated: 'في سطور معرفتش أترجمها وفضلت بلغتها الأصلية',
    subErrors: {
      unavailable: 'الترجمة التلقائية مش مفعّلة على السيرفر',
      unsupported: 'المتصفح ده مش بيقدر يقرأ صوت الفيديو',
      fetch_failed: 'مقدرتش أقرأ الفيديو عشان أحلله',
      too_large: 'الفيديو كبير أوي ومينفعش يتحلل في المتصفح (الحد 300MB)',
      decode_failed: 'مقدرتش أقرأ صوت الفيديو ده (يمكن مفيهوش صوت)',
      no_audio: 'الفيديو ده مفيهوش صوت',
      no_speech: 'مفيش كلام واضح في الفيديو',
      rate_limited: 'طلبات كتير — استنى شوية وجرّب تاني',
      failed: 'الترجمة التلقائية فشلت. جرّب تاني.',
    },
  },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ icons */
const ICONS = {
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  rotate: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  flip: 'M12 3v18M8 7 3 12l5 5V7ZM16 7l5 5-5 5V7Z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  send: 'm22 2-11 11M22 2 15 22l-4-9-9-4Z',
  play: 'M7 4v16l13-8Z',
  pause: 'M8 4v16M16 4v16',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  volumeOff: 'M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6',
  volume: 'M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  size: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  noise: 'M2 12h3M7 7v10M12 3v18M17 7v10M22 12h-3',
  cc: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM10.4 10.3a2.3 2.3 0 1 0 0 3.4M17 10.3a2.3 2.3 0 1 0 0 3.4',
};

function EdIcon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}


/* ================================================================ PHONE UI (app-style editor) */

/** Bottom tool rail: big labelled tiles. `on` puts a dot on a tool that already changed something. */
function PhoneRail({ items, onPick, label }) {
  return (
    <nav className="mx-ph__rail" aria-label={label}>
      {items.map(([k, icon, text, on]) => (
        <button key={k} type="button" className={`mx-ph__tool${on ? ' has-on' : ''}`} onClick={() => onPick(k)}>
          <span className="mx-ph__tile"><EdIcon name={icon} size={22} /></span>
          <span className="mx-ph__lbl">{text}</span>
        </button>
      ))}
    </nav>
  );
}

/** Bottom sheet that holds ONE tool's controls. The picture stays visible above it. */
function PhoneSheet({ title, onOk, onCancel, tall, closeLabel, okLabel, children }) {
  return (
    <section className={`mx-sheet${tall ? ' is-tall' : ''}`} aria-label={title}>
      <div className="mx-sheet__head">
        {onCancel && (
          <button type="button" className="mx-sheet__btn" onClick={onCancel} aria-label={closeLabel} title={closeLabel}><EdIcon name="x" size={18} /></button>
        )}
        <strong>{title}</strong>
        <button type="button" className="mx-sheet__btn mx-sheet__btn--ok" onClick={onOk} aria-label={okLabel} title={okLabel}><EdIcon name="check" size={20} /></button>
      </div>
      <div className="mx-sheet__body">{children}</div>
    </section>
  );
}

/* ================================================================ SHARED: colour filters */

const DEFAULT_ADJ = { preset: 'none', b: 100, c: 100, s: 100 };
const PRESETS = [
  { k: 'none', f: '' },
  { k: 'vivid', f: 'saturate(1.5) contrast(1.1)' },
  { k: 'warm', f: 'sepia(.25) saturate(1.35) hue-rotate(-8deg)' },
  { k: 'cool', f: 'hue-rotate(12deg) saturate(1.1) brightness(1.04)' },
  { k: 'vintage', f: 'sepia(.45) contrast(1.1) saturate(1.2) brightness(.95)' },
  { k: 'fade', f: 'contrast(.85) brightness(1.1) saturate(.8)' },
  { k: 'bw', f: 'grayscale(1)' },
  { k: 'noir', f: 'grayscale(1) contrast(1.35) brightness(.9)' },
  { k: 'sepia', f: 'sepia(1)' },
];
const adjIsDefault = (a) => a.preset === 'none' && a.b === 100 && a.c === 100 && a.s === 100;
/** CSS / canvas `filter` string for a preset + brightness / contrast / saturation sliders (percent). */
const adjCss = (a) => {
  if (adjIsDefault(a)) return 'none';
  const pf = PRESETS.find((p) => p.k === a.preset)?.f || '';
  return [pf, `brightness(${a.b / 100})`, `contrast(${a.c / 100})`, `saturate(${a.s / 100})`].filter(Boolean).join(' ');
};
// Canvas 2D `filter` is missing in Safari: without it we hide the filter tools rather than send an unfiltered picture.
const canFilter = () => typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

function FilterPanel({ adj, setAdj, tx }) {
  return (
    <div className="mx-flt">
      <div className="mx-ed__chips mx-flt__presets">
        {PRESETS.map((p) => (
          <button key={p.k} type="button" className={adj.preset === p.k ? 'is-on' : ''} onClick={() => setAdj({ ...adj, preset: p.k })}>{tx.presets[p.k]}</button>
        ))}
      </div>
      <div className="mx-flt__sliders">
        {[['b', tx.brightness], ['c', tx.contrast], ['s', tx.saturation]].map(([k, label]) => (
          <label key={k} className="mx-ed__range">
            <span>{label}</span>
            <input type="range" min="50" max="150" value={adj[k]} onChange={(e) => setAdj({ ...adj, [k]: Number(e.target.value) })} />
          </label>
        ))}
        <button type="button" className="mx-ed__chipbtn" disabled={adjIsDefault(adj)} onClick={() => setAdj(DEFAULT_ADJ)}>{tx.reset}</button>
      </div>
    </div>
  );
}

/** Image output sizes: longest side (px) + JPEG quality. */
const IMG_Q = [
  { k: 'orig', max: 2048, q: 0.9 },
  { k: 'hd', max: 1600, q: 0.8 },
  { k: 'sd', max: 1024, q: 0.7 },
  { k: 'xs', max: 640, q: 0.6 },
];

/* ================================================================ IMAGE */

const MAX_DIM = 2048; // working resolution cap (keeps undo history light)
const MAX_HISTORY = 8;
const COLORS = ['#ffffff', '#111111', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
const ASPECTS = [
  { k: 'free', r: null },
  { k: '1:1', r: 1 },
  { k: '4:3', r: 4 / 3 },
  { k: '3:4', r: 3 / 4 },
  { k: '16:9', r: 16 / 9 },
  { k: '9:16', r: 9 / 16 },
];
const MIN_CROP = 0.05;

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
function rotateCanvas(src, dir) {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((dir * Math.PI) / 2);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
function flipCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext('2d');
  x.translate(c.width, 0);
  x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  return c;
}
function drawStroke(ctx, pts, color, width) {
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i += 1) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load'));
    };
    im.src = url;
  });
}

/** Resize a crop rect (fractions of the image) while dragging a handle. */
function resizeCrop(start, handle, dx, dy, ratio, W, H) {
  let { x, y, w, h } = start;
  if (handle === 'move') {
    return { x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h), w, h };
  }
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  if (ratio && (hasW || hasE) && (hasN || hasS)) {
    // Locked aspect: corners only, anchored on the opposite corner.
    const ax = hasW ? x + w : x;
    const ay = hasN ? y + h : y;
    let nw = clamp(w + (hasW ? -dx : dx), MIN_CROP, hasW ? ax : 1 - ax);
    let nh = (nw * W) / (ratio * H);
    const maxH = hasN ? ay : 1 - ay;
    if (nh > maxH) {
      nh = maxH;
      nw = (nh * ratio * H) / W;
    }
    return { x: hasW ? ax - nw : ax, y: hasN ? ay - nh : ay, w: nw, h: nh };
  }
  if (hasW) {
    const nx = clamp(x + dx, 0, x + w - MIN_CROP);
    w = x + w - nx;
    x = nx;
  }
  if (hasE) w = clamp(w + dx, MIN_CROP, 1 - x);
  if (hasN) {
    const ny = clamp(y + dy, 0, y + h - MIN_CROP);
    h = y + h - ny;
    y = ny;
  }
  if (hasS) h = clamp(h + dy, MIN_CROP, 1 - y);
  return { x, y, w, h };
}

function fitRatio(ratio, W, H) {
  // Largest centred rect with the given pixel aspect ratio.
  let w = 1;
  let h = (W / (ratio * H));
  if (h > 1) {
    h = 1;
    w = (ratio * H) / W;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Text layers stay editable (move / resize / recolour / delete) until another tool or the export bakes them in. */
const textFont = (t) => `700 ${t.px}px system-ui, "Segoe UI", Tahoma, Arial, sans-serif`;
function drawTextObj(x, t) {
  x.save();
  x.font = textFont(t);
  x.textBaseline = 'top';
  x.textAlign = 'left';
  x.direction = /[\u0590-\u08FF]/.test(t.value) ? 'rtl' : 'ltr';
  x.lineJoin = 'round';
  x.lineWidth = Math.max(2, t.px / 7);
  x.strokeStyle = isLight(t.color) ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.9)';
  x.fillStyle = t.color;
  x.strokeText(t.value, t.fx * x.canvas.width, t.fy * x.canvas.height);
  x.fillText(t.value, t.fx * x.canvas.width, t.fy * x.canvas.height);
  x.restore();
}
let measureCtx = null;
function textWidth(t) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = textFont(t);
  return measureCtx.measureText(t.value).width;
}
function withTexts(canvas, list) {
  if (!list.length) return canvas;
  const c = cloneCanvas(canvas);
  const x = c.getContext('2d');
  list.forEach((t) => drawTextObj(x, t));
  return c;
}

const ImageEditor = forwardRef(function ImageEditor({ file, tx, onReady, onError, phone = false }, ref) {
  const [base, setBase] = useState(null); // original (downscaled) canvas
  const [history, setHistory] = useState([]); // edited snapshots (newest last)
  const [tool, setTool] = useState(phone ? 'move' : 'draw'); // phone: no tool is armed until one is opened from the rail
  const [sheet, setSheet] = useState(null); // phone: which tool's bottom sheet is open
  const [color, setColor] = useState('#ef4444');
  const [brush, setBrush] = useState(6);
  const [aspect, setAspect] = useState('free');
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [textBox, setTextBox] = useState(null); // { fx, fy, value }
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [adj, setAdj] = useState(DEFAULT_ADJ);
  const [qk, setQk] = useState('orig');
  const filtOk = canFilter();
  // Undo also steps back filters / brightness / contrast / saturation / output size, one change at a time, in the order they were made
  const adjStack = useRef([{ adj: DEFAULT_ADJ, qk: 'orig' }]);
  const opsRef = useRef([]); // 'px' (a picture edit) | 'adj' (a filter / size change), oldest first
  const adjTimer = useRef(null);
  const adjNow = useRef(null);
  adjNow.current = { adj, qk };
  const [adjN, setAdjN] = useState(0);
  const commitAdj = useCallback(() => {
    clearTimeout(adjTimer.current); adjTimer.current = null;
    const n = adjNow.current; const top = adjStack.current[adjStack.current.length - 1];
    if (JSON.stringify(top) === JSON.stringify(n)) return;
    adjStack.current.push(n); opsRef.current.push('adj'); setAdjN((v) => v + 1);
  }, []);
  useEffect(() => { adjTimer.current = setTimeout(commitAdj, 300); return () => clearTimeout(adjTimer.current); }, [adj, qk, commitAdj]);

  const stageRef = useRef(null);
  const wrapRef = useRef(null);
  const mainRef = useRef(null);
  const ovRef = useRef(null);
  const strokeRef = useRef(null);
  const dragRef = useRef(null);
  const textRef = useRef(null);
  const textInputRef = useRef(null);
  // Phones: typing inside the picture made the stage resize under the finger when the keyboard opened, which blurred
  // the box (committing it) and closed the keyboard again. On touch screens the text is typed in a docked bar instead.
  const [coarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  const [texts, setTexts] = useState([]);   // committed text layers { id, fx, fy, value, color, px }
  const [selId, setSelId] = useState(null);
  const textsRef = useRef([]);
  const selRef = useRef(null);
  const tdrag = useRef(null);
  const tres = useRef(null);
  const ptrs = useRef(new Map());   // active touch points on the stage (for two-finger pinch on a text)
  const pinch = useRef(null);
  selRef.current = selId;
  const updateTexts = useCallback((fn) => {
    textsRef.current = typeof fn === 'function' ? fn(textsRef.current) : fn;
    setTexts(textsRef.current);
  }, []);
  const updateTextBox = (v) => {
    textRef.current = v;
    setTextBox(v);
  };

  const cur = history.length ? history[history.length - 1] : base;
  const W = cur?.width || 1;
  const H = cur?.height || 1;

  // ---- load
  useEffect(() => {
    let alive = true;
    loadImage(file)
      .then((im) => {
        if (!alive) return;
        const k = Math.min(1, MAX_DIM / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(im, 0, 0, c.width, c.height);
        setBase(c);
        onReady?.();
      })
      .catch(() => alive && onError?.());
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // ---- stage size
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = cur && box.w && box.h ? Math.min(box.w / W, box.h / H) : 0;
  const dw = Math.max(1, Math.floor(W * scale));
  const dh = Math.max(1, Math.floor(H * scale));

  // ---- paint current snapshot
  useEffect(() => {
    if (!cur || !mainRef.current || !ovRef.current) return;
    const m = mainRef.current;
    m.width = cur.width;
    m.height = cur.height;
    const mx = m.getContext('2d');
    mx.drawImage(cur, 0, 0);
    texts.forEach((t) => drawTextObj(mx, t));
    ovRef.current.width = cur.width;
    ovRef.current.height = cur.height;
  }, [cur, texts]);

  /** Flatten the text layers into the picture (before crop / rotate / draw / filters, which work on pixels). */
  const bake = () => {
    const list = textsRef.current;
    if (!list.length || !cur) return cur;
    const c = withTexts(cur, list);
    updateTexts([]);
    setSelId(null);
    push(c);
    return c;
  };

  const push = useCallback((canvas) => {
    opsRef.current.push('px');
    setHistory((h) => [...h, canvas].slice(-MAX_HISTORY));
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setAspect('free');
  }, []);

  const undo = useCallback(() => {
    textRef.current = null;
    setTextBox(null);
    commitAdj(); // a filter change made a moment ago counts as its own step
    if (textsRef.current.length) { // newest text layer goes first
      updateTexts((l) => l.slice(0, -1));
      setSelId(null);
      return;
    }
    const last = opsRef.current.pop();
    if (last === 'adj') { // undo just that filter / size change
      adjStack.current.pop();
      const prev = adjStack.current[adjStack.current.length - 1];
      setAdj(prev.adj); setQk(prev.qk); setAdjN((v) => v + 1);
      return;
    }
    setHistory((h) => h.slice(0, -1));
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
  }, [updateTexts, commitAdj]);
  const reset = () => {
    textRef.current = null;
    setTextBox(null);
    updateTexts([]);
    setSelId(null);
    setHistory([]);
    opsRef.current = opsRef.current.filter((o) => o === 'adj');
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setAspect('free');
    setAdj(DEFAULT_ADJ); // "Reset" also removes the colour filter (it is still one undo step away)
  };
  const canUndo = history.length > 0 || texts.length > 0 || (adjN >= 0 && adjStack.current.length > 1);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        undo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const id = selRef.current;
        updateTexts((l) => l.filter((t) => t.id !== id));
        setSelId(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, updateTexts]);

  useImperativeHandle(ref, () => ({
    cancel() {},
    isDirty() { return history.length > 0 || textsRef.current.length > 0 || (filtOk && !adjIsDefault(adj)) || qk !== 'orig'; },
    async getResult() {
      const filtered = filtOk && !adjIsDefault(adj);
      const flat = cur ? withTexts(cur, textsRef.current) : cur;
      if (!cur || (!history.length && !textsRef.current.length && !filtered && qk === 'orig')) return file;
      const q = IMG_Q.find((z) => z.k === qk) || IMG_Q[0];
      const k = Math.min(1, q.max / Math.max(cur.width, cur.height));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(cur.width * k));
      out.height = Math.max(1, Math.round(cur.height * k));
      const x = out.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, out.width, out.height);
      x.imageSmoothingQuality = 'high';
      if (filtered) x.filter = adjCss(adj);
      x.drawImage(flat, 0, 0, out.width, out.height);
      const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', q.q));
      if (!blob) throw new Error('encode');
      const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '-edited.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    },
  }), [history.length, cur, file, adj, qk, filtOk]);

  // ---- pointer -> canvas coords
  const toCanvas = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  const brushPx = () => (brush * Math.max(W, H)) / 900;
  const hitText = (p) => {
    const pad = Math.max(8, (coarse ? 22 : 12) / (scale || 1));
    const list = textsRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const t = list[i];
      const x0 = t.fx * W; const y0 = t.fy * H;
      if (p.x >= x0 - pad && p.x <= x0 + textWidth(t) + pad && p.y >= y0 - pad && p.y <= y0 + t.px * 1.25 + pad) return t;
    }
    return null;
  };
  const startTextDrag = (e, t) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toCanvas(e);
    tdrag.current = { id: t.id, ox: p.x - t.fx * W, oy: p.y - t.fy * H };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const startTextResize = (e, t) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toCanvas(e);
    tres.current = { id: t.id, x: p.x, px: t.px, w: Math.max(20, textWidth(t)) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onStageDoubleClick = (e) => {
    if ((tool !== 'text' && tool !== 'move') || !wrapRef.current) return;
    const t = hitText(toCanvas(e));
    if (!t) return;
    updateTexts((l) => l.filter((x) => x.id !== t.id));
    setSelId(null);
    setTool('text');
    updateTextBox({ id: t.id, fx: t.fx, fy: t.fy, value: t.value, col: t.color, px: t.px, t: Date.now() });
    setTimeout(() => textInputRef.current?.focus(), 0);
  };
  const pickColor = (c) => {
    setColor(c);
    if (selId && (tool === 'text' || tool === 'move')) updateTexts((l) => l.map((t) => (t.id === selId ? { ...t, color: c } : t)));
  };
  const pickBrush = (v) => {
    setBrush(v);
    if (selId && (tool === 'text' || tool === 'move')) {
      const px = (v * 6 * Math.max(W, H)) / 900;
      updateTexts((l) => l.map((t) => (t.id === selId ? { ...t, px } : t)));
    }
  };
  const removeSelected = () => {
    if (!selId) return;
    updateTexts((l) => l.filter((t) => t.id !== selId));
    setSelId(null);
  };

  const redrawOverlay = () => {
    const ov = ovRef.current;
    if (!ov) return;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (strokeRef.current) drawStroke(ctx, strokeRef.current.pts, color, brushPx());
  };

  // two-finger pinch on the picture resizes the selected text (like Instagram / WhatsApp)
  const trackDown = (e) => {
    if (tool !== 'text' && tool !== 'move') return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && selRef.current) {
      const [a, b] = [...ptrs.current.values()];
      const t = textsRef.current.find((x) => x.id === selRef.current);
      if (t) {
        tdrag.current = null; tres.current = null;
        pinch.current = { id: t.id, d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), px0: t.px };
      }
    }
  };
  const trackMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const px = clamp(pz.px0 * (Math.hypot(a.x - b.x, a.y - b.y) / pz.d0), 10, Math.max(W, H) * 0.5);
      updateTexts((l) => l.map((t) => (t.id === pz.id ? { ...t, px } : t)));
      setBrush(clamp(Math.round((px * 150) / Math.max(W, H)), 2, 24));
    }
  };
  const trackUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
  };

  const onStagePointerDown = (e) => {
    if (!cur) return;
    if (ptrs.current.size > 1) return; // second finger = pinch, never a new text
    if (tool === 'draw') {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      strokeRef.current = { pts: [toCanvas(e)] };
      redrawOverlay();
    } else if (tool === 'text' || tool === 'move') {
      if (e.target.tagName === 'INPUT') return;
      // stop the browser's default mousedown focus change, which would blur the new input at once (and discard it)
      e.preventDefault();
      const p = toCanvas(e);
      commitText();
      const hit = hitText(p);
      if (hit) { // grab an existing text: select it and start dragging
        setSelId(hit.id);
        setColor(hit.color);
        setBrush(clamp(Math.round((hit.px * 150) / Math.max(W, H)), 2, 24));
        updateTexts((l) => [...l.filter((t) => t.id !== hit.id), hit]); // bring to front
        tdrag.current = { id: hit.id, ox: p.x - hit.fx * W, oy: p.y - hit.fy * H };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      setSelId(null);
      if (tool === 'move') return;
      updateTextBox({ id: Date.now(), fx: p.x / W, fy: p.y / H, value: '', t: Date.now() });
      setTimeout(() => textInputRef.current?.focus(), 0);
    }
  };
  const onStagePointerMove = (e) => {
    if (pinch.current) return;
    const rz = tres.current;
    if (rz) {
      const p = toCanvas(e);
      const px = clamp(rz.px * ((rz.w + (p.x - rz.x)) / rz.w), 10, Math.max(W, H) * 0.5);
      updateTexts((l) => l.map((t) => (t.id === rz.id ? { ...t, px } : t)));
      setBrush(clamp(Math.round((px * 150) / Math.max(W, H)), 2, 24));
      return;
    }
    const d = tdrag.current;
    if (d) {
      const p = toCanvas(e);
      updateTexts((l) => l.map((t) => (t.id === d.id ? { ...t, fx: clamp((p.x - d.ox) / W, -0.05, 1), fy: clamp((p.y - d.oy) / H, -0.05, 1) } : t)));
      return;
    }
    if (tool !== 'draw' || !strokeRef.current) return;
    strokeRef.current.pts.push(toCanvas(e));
    redrawOverlay();
  };
  const onStagePointerUp = () => {
    tdrag.current = null;
    tres.current = null;
    if (tool !== 'draw' || !strokeRef.current) return;
    const { pts } = strokeRef.current;
    strokeRef.current = null;
    const next = cloneCanvas(cur);
    drawStroke(next.getContext('2d'), pts, color, brushPx());
    push(next);
    ovRef.current?.getContext('2d').clearRect(0, 0, W, H);
  };

  // ---- text
  const fontPx = () => (brush * 6 * Math.max(W, H)) / 900;
  function commitText(onlyId) {
    const tb = textRef.current;
    if (!tb || (onlyId && tb.id !== onlyId)) return;
    updateTextBox(null); // idempotent: blur after Enter finds nothing to commit
    if (!tb.value.trim() || !cur) return;
    const t = { id: tb.id, fx: tb.fx, fy: tb.fy, value: tb.value, color: tb.col || color, px: tb.px || fontPx() };
    updateTexts((l) => [...l, t]);
    setSelId(t.id);
  }

  // ---- crop
  const chooseAspect = (k) => {
    setAspect(k);
    const r = ASPECTS.find((a) => a.k === k)?.r;
    setCrop(r ? fitRatio(r, W, H) : { x: 0, y: 0, w: 1, h: 1 });
  };
  const cropRatio = ASPECTS.find((a) => a.k === aspect)?.r || null;
  const cropHandlers = (handle) => ({
    onPointerDown: (e) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { handle, sx: e.clientX, sy: e.clientY, rect: crop };
    },
    onPointerMove: (e) => {
      const d = dragRef.current;
      if (!d || d.handle !== handle) return;
      const dx = (e.clientX - d.sx) / dw;
      const dy = (e.clientY - d.sy) / dh;
      setCrop(resizeCrop(d.rect, handle, dx, dy, cropRatio, W, H));
    },
    onPointerUp: () => {
      dragRef.current = null;
    },
    onPointerCancel: () => {
      dragRef.current = null;
    },
  });
  const applyCrop = () => {
    const sx = Math.round(crop.x * W);
    const sy = Math.round(crop.y * H);
    const sw = Math.max(1, Math.round(crop.w * W));
    const sh = Math.max(1, Math.round(crop.h * H));
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d').drawImage(cur, sx, sy, sw, sh, 0, 0, sw, sh);
    push(c);
  };
  const cropChanged = crop.w < 0.999 || crop.h < 0.999;

  const switchTool = (t) => {
    commitText();
    if (t !== 'text' && t !== 'move') bake();
    setTool(t);
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setAspect('free');
  };

  const hint = tool === 'draw' ? tx.hintDraw : tool === 'text' ? tx.hintText : tool === 'move' ? tx.hintMove : tool === 'filter' ? tx.hintFilter : tool === 'size' ? tx.hintSizeImg : tx.hintCrop;
  const HANDLES = cropRatio ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const dock = coarse || phone;
  // ---- phone: open / close a tool's sheet
  const newText = () => {
    updateTextBox({ id: Date.now(), fx: 0.22, fy: 0.4, value: '', t: Date.now() });
    setTimeout(() => textInputRef.current?.focus(), 60);
  };
  const openSheet = (k) => {
    switchTool(k);
    setSheet(k);
    if (k === 'text') newText();
  };
  const closeSheet = (apply) => {
    commitText();
    if (sheet === 'crop' && apply && cropChanged) applyCrop();
    switchTool('move');
    setSheet(null);
  };

  const stageEl = (
      <div className="mx-ed__stage" ref={stageRef} dir="ltr">
        {cur && scale > 0 && (
          <div
            className={`mx-ed__canvaswrap is-${tool}`}
            ref={wrapRef}
            style={{ width: dw, height: dh }}
            onPointerDownCapture={trackDown}
            onPointerMoveCapture={trackMove}
            onPointerUpCapture={trackUp}
            onPointerCancelCapture={trackUp}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
            onDoubleClick={onStageDoubleClick}
          >
            <canvas ref={mainRef} className="mx-ed__canvas" style={{ width: dw, height: dh, filter: filtOk ? adjCss(adj) : 'none' }} />
            <canvas ref={ovRef} className="mx-ed__canvas mx-ed__canvas--ov" style={{ width: dw, height: dh }} />

            {tool === 'crop' && (
              <div className="mx-crop" style={{ left: crop.x * dw, top: crop.y * dh, width: crop.w * dw, height: crop.h * dh }} {...cropHandlers('move')}>
                <span className="mx-crop__grid" />
                {HANDLES.map((h) => (
                  <span key={h} className={`mx-crop__h mx-crop__h--${h}`} {...cropHandlers(h)} />
                ))}
              </div>
            )}

            {(tool === 'text' || tool === 'move') && (() => {
              const t = texts.find((x) => x.id === selId);
              if (!t || textBox) return null;
              // never smaller than the three handles need, so a tiny text doesn't end up buried under them
              const fw = Math.max(48, textWidth(t) * scale + 8);
              const fh = Math.max(30, t.px * 1.25 * scale + 8);
              const below = t.fy * dh < 34;
              return (
                <span
                  key={t.id}
                  className="mx-ed__textsel"
                  style={{ left: `${(t.fx * 100)}%`, top: `${(t.fy * 100)}%`, width: fw, height: fh }}
                  onPointerDown={(e) => startTextDrag(e, t)}
                  title={tx.hintMove}
                >
                  <span className={`mx-ed__grip${below ? ' is-below' : ''}`} aria-hidden="true"><EdIcon name="move" size={14} /></span>
                  <button type="button" className="mx-ed__tdel" title={tx.del} aria-label={tx.del} onPointerDown={(e) => e.stopPropagation()} onClick={removeSelected}><EdIcon name="x" size={12} /></button>
                  <i className="mx-ed__tres" title={tx.resize} onPointerDown={(e) => startTextResize(e, t)} />
                </span>
              );
            })()}

            {tool === 'text' && textBox && dock && (
              <span
                className="mx-ed__textinput mx-ed__textghost"
                dir="auto"
                style={{ left: `${textBox.fx * 100}%`, top: `${textBox.fy * 100}%`, color: textBox.col || color, fontSize: Math.max(14, (textBox.px || fontPx()) * scale) }}
              >
                {textBox.value || tx.typeHere}
              </span>
            )}
            {tool === 'text' && textBox && !dock && (
              <input
                className="mx-ed__textinput"
                ref={textInputRef}
                autoFocus
                dir="auto"
                value={textBox.value}
                placeholder={tx.typeHere}
                style={{ left: `${textBox.fx * 100}%`, top: `${textBox.fy * 100}%`, color: textBox.col || color, fontSize: Math.max(14, (textBox.px || fontPx()) * scale) }}
                onChange={(e) => updateTextBox({ ...textRef.current, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    commitText(textBox.id);
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    updateTextBox(null);
                  }
                }}
                onBlur={() => {
                  // a blur right after the box appears is the pointer-up settling focus, not the user leaving
                  if (textRef.current && Date.now() - (textRef.current.t || 0) < 400) { setTimeout(() => textInputRef.current?.focus(), 0); return; }
                  commitText(textBox.id);
                }}
              />
            )}
          </div>
        )}
      </div>
  );

  if (phone) {
    const sheetTitle = { text: tx.text, draw: tx.draw, crop: tx.crop, filter: tx.filters, size: tx.size2 }[sheet];
    const railItems = [
      ['text', 'type', tx.text, texts.length > 0],
      ['draw', 'pen', tx.draw, false],
      ['crop', 'crop', tx.crop, false],
      ...(filtOk ? [['filter', 'sliders', tx.filters, !adjIsDefault(adj)]] : []),
      ['size', 'size', tx.size2, qk !== 'orig'],
    ];
    const colorsEl = (
      <>
        <div className="mx-ed__colors">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`mx-ed__color${color === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => pickColor(c)} />
          ))}
        </div>
        <label className="mx-ed__range">
          <span>{tx.size}</span>
          <input type="range" min="2" max="24" value={brush} onChange={(e) => pickBrush(Number(e.target.value))} />
        </label>
      </>
    );
    return (
      <>
        {stageEl}
        <div className="mx-ph__float">
          <button type="button" className="mx-ph__round" title={tx.undo} aria-label={tx.undo} disabled={!canUndo} onClick={undo}><EdIcon name="undo" size={20} /></button>
          <button type="button" className="mx-ph__round" title={tx.rotate} aria-label={tx.rotate} onClick={() => cur && push(rotateCanvas(bake() || cur, 1))}><EdIcon name="rotate" size={20} /></button>
          <button type="button" className="mx-ph__round" title={tx.flip} aria-label={tx.flip} onClick={() => cur && push(flipCanvas(bake() || cur))}><EdIcon name="flip" size={20} /></button>
        </div>
        {sheet ? (
          <PhoneSheet title={sheetTitle} closeLabel={tx.cancel} okLabel={tx.done} onOk={() => closeSheet(true)} onCancel={sheet === 'crop' ? () => closeSheet(false) : null}>
            {sheet === 'text' && (
              <>
                {textBox ? (
                  <div className="mx-ed__textdock">
                    <input
                      ref={textInputRef}
                      dir="auto"
                      enterKeyHint="done"
                      autoComplete="off"
                      value={textBox.value}
                      placeholder={tx.typeHere}
                      onChange={(e) => updateTextBox({ ...textRef.current, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                          e.preventDefault();
                          commitText(textBox.id);
                        }
                      }}
                    />
                    <button type="button" className="mx-ph__add" onPointerDown={(e) => e.preventDefault()} onClick={() => commitText(textBox.id)}>{tx.addText}</button>
                  </div>
                ) : (
                  <div className="mx-ed__chips">
                    <button type="button" className="is-primary" onClick={newText}>＋ {tx.newText}</button>
                    {selId && <button type="button" onClick={removeSelected}><EdIcon name="trash" size={15} /> {tx.del}</button>}
                  </div>
                )}
                {colorsEl}
                <p className="mx-ed__hint">{tx.hintTextPhone}</p>
              </>
            )}
            {sheet === 'draw' && (<>{colorsEl}<p className="mx-ed__hint">{tx.hintDraw}</p></>)}
            {sheet === 'crop' && (
              <>
                <div className="mx-ed__chips">
                  {ASPECTS.map((a) => (
                    <button key={a.k} type="button" className={aspect === a.k ? 'is-on' : ''} onClick={() => chooseAspect(a.k)}>{a.k === 'free' ? tx.free : a.k}</button>
                  ))}
                </div>
                <p className="mx-ed__hint">{tx.hintCrop}</p>
              </>
            )}
            {sheet === 'filter' && filtOk && <FilterPanel adj={adj} setAdj={setAdj} tx={tx} />}
            {sheet === 'size' && (
              <>
                <div className="mx-ed__chips mx-q__list">
                  {IMG_Q.map((q) => {
                    const k = Math.min(1, q.max / Math.max(W, H));
                    return (
                      <button key={q.k} type="button" className={qk === q.k ? 'is-on' : ''} onClick={() => setQk(q.k)}>
                        <b>{tx.iq[q.k]}</b>
                        <small dir="ltr">{Math.round(W * k)}×{Math.round(H * k)}</small>
                      </button>
                    );
                  })}
                </div>
                <p className="mx-ed__hint">{tx.hintSizeImg}</p>
              </>
            )}
          </PhoneSheet>
        ) : (
          <PhoneRail items={railItems} onPick={openSheet} label={tx.tools} />
        )}
      </>
    );
  }

  return (
    <>
      {stageEl}
      <div className="mx-ed__tools">
        <div className="mx-ed__sticky">
        {tool === 'text' && textBox && dock && (
          <div className="mx-ed__textdock">
            <input
              ref={textInputRef}
              dir="auto"
              enterKeyHint="done"
              autoComplete="off"
              value={textBox.value}
              placeholder={tx.typeHere}
              onChange={(e) => updateTextBox({ ...textRef.current, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  commitText(textBox.id);
                }
              }}
            />
            <button type="button" className="mx-ed__iconbtn" aria-label={tx.done} title={tx.done} onPointerDown={(e) => e.preventDefault()} onClick={() => commitText(textBox.id)}><EdIcon name="check" size={18} /></button>
            <button type="button" className="mx-ed__iconbtn" aria-label={tx.cancel} title={tx.cancel} onPointerDown={(e) => e.preventDefault()} onClick={() => updateTextBox(null)}><EdIcon name="x" size={18} /></button>
          </div>
        )}
        <div className="mx-ed__toolrow">
          <div className="mx-ed__seg" role="tablist">
            <button type="button" className={tool === 'draw' ? 'is-on' : ''} onClick={() => switchTool('draw')}><EdIcon name="pen" size={18} /><span>{tx.draw}</span></button>
            <button type="button" className={tool === 'text' ? 'is-on' : ''} onClick={() => switchTool('text')}><EdIcon name="type" size={18} /><span>{tx.text}</span></button>
            <button type="button" className={tool === 'move' ? 'is-on' : ''} onClick={() => switchTool('move')}><EdIcon name="move" size={18} /><span>{tx.move}</span></button>
            <button type="button" className={tool === 'crop' ? 'is-on' : ''} onClick={() => switchTool('crop')}><EdIcon name="crop" size={18} /><span>{tx.crop}</span></button>
            {filtOk && <button type="button" className={tool === 'filter' ? 'is-on' : ''} onClick={() => switchTool('filter')}><EdIcon name="sliders" size={18} /><span>{tx.filters}</span></button>}
            <button type="button" className={tool === 'size' ? 'is-on' : ''} onClick={() => switchTool('size')}><EdIcon name="size" size={18} /><span>{tx.size2}</span></button>
          </div>
          <div className="mx-ed__actions">
            <button type="button" className="mx-ed__iconbtn" title={tx.rotate} aria-label={tx.rotate} onClick={() => cur && push(rotateCanvas(bake() || cur, 1))}><EdIcon name="rotate" /></button>
            <button type="button" className="mx-ed__iconbtn" title={tx.flip} aria-label={tx.flip} onClick={() => cur && push(flipCanvas(bake() || cur))}><EdIcon name="flip" /></button>
            <button type="button" className="mx-ed__iconbtn" title={tx.undo} aria-label={tx.undo} disabled={!canUndo} onClick={undo}><EdIcon name="undo" /></button>
            <button type="button" className="mx-ed__iconbtn" title={tx.reset} aria-label={tx.reset} disabled={!history.length && !texts.length && adjIsDefault(adj)} onClick={reset}><EdIcon name="reset" /></button>
          </div>
        </div>

        </div>

        {(tool === 'draw' || tool === 'text' || (tool === 'move' && selId)) && (
          <div className="mx-ed__toolrow">
            <div className="mx-ed__colors">
              {COLORS.map((c) => (
                <button key={c} type="button" className={`mx-ed__color${color === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => pickColor(c)} />
              ))}
            </div>
            <label className="mx-ed__range">
              <span>{tx.size}</span>
              <input type="range" min="2" max="24" value={brush} onChange={(e) => pickBrush(Number(e.target.value))} />
            </label>
            {selId && tool !== 'draw' && (
              <button type="button" className="mx-ed__iconbtn" title={tx.del} aria-label={tx.del} onClick={removeSelected}><EdIcon name="trash" size={18} /></button>
            )}
          </div>
        )}

        {tool === 'crop' && (
          <div className="mx-ed__toolrow">
            <div className="mx-ed__chips">
              {ASPECTS.map((a) => (
                <button key={a.k} type="button" className={aspect === a.k ? 'is-on' : ''} onClick={() => chooseAspect(a.k)}>
                  {a.k === 'free' ? tx.free : a.k}
                </button>
              ))}
            </div>
            <div className="mx-ed__chips">
              <button type="button" className="is-primary" disabled={!cropChanged} onClick={applyCrop}>{tx.applyCrop}</button>
            </div>
          </div>
        )}
        {tool === 'filter' && filtOk && <FilterPanel adj={adj} setAdj={setAdj} tx={tx} />}

        {tool === 'size' && (
          <div className="mx-q">
            <div className="mx-ed__chips mx-q__list">
              {IMG_Q.map((q) => {
                const k = Math.min(1, q.max / Math.max(W, H));
                return (
                  <button key={q.k} type="button" className={qk === q.k ? 'is-on' : ''} onClick={() => setQk(q.k)}>
                    <b>{tx.iq[q.k]}</b>
                    <small dir="ltr">{Math.round(W * k)}×{Math.round(H * k)}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="mx-ed__hint">{hint}</p>
      </div>
    </>
  );
});

/* ================================================================ VIDEO */

const MIN_TRIM = 0.5;
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** WebCodecs available (secure context: https / localhost / Capacitor)? The heavy module loads only when an export runs. */
const canFastExport = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext !== false &&
  typeof VideoEncoder === 'function' &&
  typeof VideoDecoder === 'function' &&
  typeof VideoFrame === 'function' &&
  typeof OffscreenCanvas === 'function';

const canTrimVideo = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function';

const once = (el, ev, ms = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      el.removeEventListener(ev, ok);
      reject(new Error('timeout'));
    }, ms);
    function ok() {
      clearTimeout(t);
      resolve();
    }
    el.addEventListener(ev, ok, { once: true });
  });

/** Subtitle look (font / size / colour / background / position). Chosen in the Subtitles tool, remembered per browser. */
const CAP_FONTS = {
  def:     '"Segoe UI", system-ui, Tahoma, Arial, sans-serif',
  cairo:   'Cairo, "Segoe UI", Tahoma, sans-serif',
  amiri:   'Amiri, "Traditional Arabic", "Times New Roman", serif',
  mono:    '"Courier New", Courier, monospace',
  tajawal: 'Tajawal, Cairo, "Segoe UI", Tahoma, sans-serif',
  lalezar: 'Lalezar, Cairo, Impact, sans-serif',
  kufi:    '"Reem Kufi", Cairo, "Segoe UI", sans-serif',
  bebas:   '"Bebas Neue", Impact, "Arial Narrow", sans-serif',
  script:  'Pacifico, "Brush Script MT", cursive',
  serif:   '"Playfair Display", Georgia, "Times New Roman", serif',
};
/** Weight each family is really available in (asking for 700 of a 400-only font would be faked and blurry). */
const CAP_FW = { lalezar: 400, bebas: 400, script: 400, tajawal: 800 };
const capWeight = (k) => CAP_FW[k] || 700;
const CAP_SIZES = { s: 0.042, m: 0.055, l: 0.072 };
const CAP_COLORS = ['#ffffff', '#ffe14d', '#7dd3fc', '#86efac', '#000000'];
const CAP_BGS = ['outline', 'box', 'shadow', 'neon', 'marker', 'block3d', 'sticker', 'gradient', 'pill', 'glass', 'underline'];
/** Second colour used by the background styles (outline / box / glow / extrusion…). '' = automatic. */
const CAP_ACCENTS = ['', '#000000', '#ffffff', '#ffe14d', '#ef4444', '#f472b6', '#6366f1', '#22d3ee', '#22c55e'];
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
/** One-tap looks: font + colour + background + accent (size and position are kept). */
const CAP_PRESETS = [
  { id: 'classic', font: 'def', bg: 'outline', color: '#ffffff', accent: '' },
  { id: 'bold', font: 'tajawal', bg: 'sticker', color: '#ffe14d', accent: '#000000' },
  { id: 'neon', font: 'cairo', bg: 'neon', color: '#ffffff', accent: '#22d3ee' },
  { id: 'neonPink', font: 'cairo', bg: 'neon', color: '#ffffff', accent: '#f472b6' },
  { id: 'marker', font: 'tajawal', bg: 'marker', color: '#000000', accent: '#ffe14d' },
  { id: 'pill', font: 'cairo', bg: 'pill', color: '#ffffff', accent: '#6366f1' },
  { id: 'glass', font: 'cairo', bg: 'glass', color: '#ffffff', accent: '' },
  { id: 'retro', font: 'lalezar', bg: 'block3d', color: '#ffe14d', accent: '#ef4444' },
  { id: 'fire', font: 'lalezar', bg: 'gradient', color: '#ffe14d', accent: '#ef4444' },
  { id: 'elegant', font: 'amiri', bg: 'shadow', color: '#ffffff', accent: '' },
  { id: 'underline', font: 'cairo', bg: 'underline', color: '#ffffff', accent: '#f43f5e' },
  { id: 'typewriter', font: 'mono', bg: 'box', color: '#ffffff', accent: '#000000' },
  { id: 'script', font: 'script', bg: 'sticker', color: '#ffffff', accent: '#ec4899' },
  { id: 'mint', font: 'tajawal', bg: 'box', color: '#064e3b', accent: '#86efac' },
  { id: 'kufi', font: 'kufi', bg: 'block3d', color: '#ffffff', accent: '#6366f1' },
  { id: 'impact', font: 'bebas', bg: 'sticker', color: '#ffffff', accent: '#000000' },
];
const CAP_POS = ['top', 'middle', 'bottom'];
const CAP_DEFAULT = { font: 'def', size: 'm', color: '#ffffff', bg: 'outline', pos: 'bottom', accent: '' };
const CAP_STORE = 'uip_sub_style';

const loadCapStyle = () => {
  try {
    const o = JSON.parse(localStorage.getItem(CAP_STORE) || 'null') || {};
    return {
      font: CAP_FONTS[o.font] ? o.font : CAP_DEFAULT.font,
      size: CAP_SIZES[o.size] ? o.size : CAP_DEFAULT.size,
      color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color.toLowerCase() : CAP_DEFAULT.color,
      bg: CAP_BGS.includes(o.bg) ? o.bg : CAP_DEFAULT.bg,
      pos: CAP_POS.includes(o.pos) ? o.pos : CAP_DEFAULT.pos,
      accent: isHex(o.accent) ? o.accent.toLowerCase() : '',
    };
  } catch {
    return { ...CAP_DEFAULT };
  }
};
const saveCapStyle = (st) => { try { localStorage.setItem(CAP_STORE, JSON.stringify(st)); } catch { /* storage blocked */ } };

/** Web fonts (Cairo, Amiri) only paint on a canvas once the browser has actually loaded them. */
const loadCapFont = (key) => {
  const fam = CAP_FONTS[key] || CAP_FONTS.def;
  try {
    if (!document.fonts?.load) return Promise.resolve();
    return document.fonts.load(`${capWeight(key)} 24px ${fam}`, 'ابجد abc').catch(() => {});
  } catch {
    return Promise.resolve();
  }
};

const capSize = (w, h, st = CAP_DEFAULT) => Math.round(Math.min(w, h) * (CAP_SIZES[st.size] || CAP_SIZES.m));
const hasRtl = (t) => /[\u0590-\u08FF]/.test(t);
const cueAt = (cues, t) => {
  for (let i = 0; i < cues.length; i += 1) if (t >= cues[i].s && t < cues[i].e) return cues[i].text;
  return '';
};
const isLightHex = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 140;
};

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Paint one already-wrapped line in the chosen background style. `y` is the text baseline, `cx` the centre. */
function drawCapLine(ctx, l, cx, y, size, color, st) {
  const bg = st.bg;
  const acc = isHex(st.accent) ? st.accent : '';
  const light = isLightHex(color);
  const tw = ctx.measureText(l).width;
  const plate = (padX, fill, radius, stroke) => {
    const w = tw + padX * 2; const h = size * 1.3; const x = cx - w / 2; const top = y - size * 0.95;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, top, w, h, radius === 'full' ? h / 2 : radius); else ctx.rect(x, top, w, h);
    ctx.fill();
    if (stroke) { ctx.lineWidth = Math.max(1.5, size * 0.045); ctx.strokeStyle = stroke; ctx.stroke(); }
    ctx.fillStyle = color;
  };
  ctx.save();
  ctx.fillStyle = color;
  if (bg === 'box') {
    plate(size * 0.3, acc ? hexA(acc, 0.88) : (light ? 'rgba(0,0,0,.68)' : 'rgba(255,255,255,.82)'), size * 0.22);
    ctx.fillText(l, cx, y);
  } else if (bg === 'pill') {
    plate(size * 0.55, acc || '#6366f1', 'full');
    ctx.fillText(l, cx, y);
  } else if (bg === 'glass') {
    plate(size * 0.4, 'rgba(255,255,255,.2)', size * 0.3, 'rgba(255,255,255,.55)');
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.2;
    ctx.fillText(l, cx, y);
  } else if (bg === 'marker') {
    const w = tw + size * 0.4;
    ctx.fillStyle = acc || '#ffe14d';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - w / 2, y - size * 0.88, w, size * 1.1, size * 0.12); else ctx.rect(cx - w / 2, y - size * 0.88, w, size * 1.1);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(l, cx, y);
  } else if (bg === 'shadow') {
    ctx.shadowColor = acc ? hexA(acc, 0.95) : 'rgba(0,0,0,.9)';
    ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = size * 0.06;
    ctx.fillText(l, cx, y);
  } else if (bg === 'neon') {
    const glow = acc || color;
    ctx.shadowColor = glow;
    [0.95, 0.55, 0.25].forEach((k) => { ctx.shadowBlur = size * k; ctx.fillText(l, cx, y); });
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, size * 0.035); ctx.strokeStyle = glow;
    ctx.strokeText(l, cx, y);
    ctx.fillText(l, cx, y);
  } else if (bg === 'block3d') {
    const depth = Math.max(3, Math.round(size * 0.14));
    ctx.fillStyle = acc || '#111111';
    for (let i = depth; i >= 1; i -= 1) ctx.fillText(l, cx + i * 0.75, y + i * 0.75);
    ctx.lineWidth = Math.max(1.5, size * 0.05); ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeText(l, cx, y);
    ctx.fillStyle = color;
    ctx.fillText(l, cx, y);
  } else if (bg === 'sticker') {
    ctx.lineWidth = size * 0.34;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.strokeText(l, cx + size * 0.06, y + size * 0.09);
    ctx.strokeStyle = acc || '#000000';
    ctx.strokeText(l, cx, y);
    ctx.fillText(l, cx, y);
  } else if (bg === 'gradient') {
    const g = ctx.createLinearGradient(0, y - size * 0.9, 0, y + size * 0.2);
    g.addColorStop(0, color); g.addColorStop(1, acc || '#ef4444');
    ctx.lineWidth = Math.max(2, size * 0.14); ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(l, cx, y);
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = g;
    ctx.fillText(l, cx, y);
  } else if (bg === 'underline') {
    ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.05;
    ctx.fillText(l, cx, y);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = acc || color;
    const bh = Math.max(3, size * 0.1);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - tw / 2, y + size * 0.14, tw, bh, bh / 2); else ctx.rect(cx - tw / 2, y + size * 0.14, tw, bh);
    ctx.fill();
  } else { // outline
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 6);
    ctx.strokeStyle = acc || (light ? 'rgba(0,0,0,.88)' : 'rgba(255,255,255,.92)');
    ctx.strokeText(l, cx, y);
    ctx.fillText(l, cx, y);
  }
  ctx.restore();
}

/** Burn one subtitle (wrapped, in the chosen font / colour / background / position) into the canvas. */
function drawCaption(ctx, text, cw, ch, st = CAP_DEFAULT) {
  if (!text) return;
  const size = capSize(cw, ch, st);
  const maxW = cw * 0.88;
  const color = st.color || '#ffffff';
  ctx.save();
  ctx.font = `${capWeight(st.font)} ${size}px ${CAP_FONTS[st.font] || CAP_FONTS.def}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.direction = hasRtl(text) ? 'rtl' : 'ltr';
  ctx.lineJoin = 'round';
  const lines = [];
  text.split('\n').forEach((para) => {
    let line = '';
    para.split(/\s+/).filter(Boolean).forEach((w) => {
      const test = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
  });
  const shown = lines.slice(-4);
  const lh = size * (st.bg === 'pill' || st.bg === 'glass' ? 1.55 : 1.3);
  const block = (shown.length - 1) * lh;
  let y;
  if (st.pos === 'top') y = size * 1.7;
  else if (st.pos === 'middle') y = ch / 2 - block / 2 + size * 0.35;
  else y = ch - size * 0.8 - block;
  shown.forEach((l) => {
    drawCapLine(ctx, l, cw / 2, y, size, color, st);
    y += lh;
  });
  ctx.restore();
}

/** CSS approximation of a style, for the preset chips. */
function capChipCss(p) {
  const acc = p.accent;
  const base = { fontFamily: CAP_FONTS[p.font], fontWeight: capWeight(p.font), color: p.color, padding: '2px 8px', fontSize: 16, lineHeight: 1.35, borderRadius: 6, display: 'inline-block' };
  switch (p.bg) {
    case 'box': return { ...base, background: acc ? hexA(acc, 0.9) : 'rgba(0,0,0,.68)' };
    case 'pill': return { ...base, background: acc || '#6366f1', borderRadius: 999, padding: '2px 12px' };
    case 'glass': return { ...base, background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.5)' };
    case 'marker': return { ...base, background: acc || '#ffe14d' };
    case 'shadow': return { ...base, textShadow: '0 2px 6px rgba(0,0,0,.95)' };
    case 'neon': return { ...base, textShadow: `0 0 4px ${acc || p.color}, 0 0 10px ${acc || p.color}, 0 0 18px ${acc || p.color}` };
    case 'block3d': return { ...base, textShadow: `1px 1px 0 ${acc || '#111'}, 2px 2px 0 ${acc || '#111'}, 3px 3px 0 ${acc || '#111'}` };
    case 'sticker': return { ...base, WebkitTextStroke: `4px ${acc || '#000'}`, paintOrder: 'stroke fill' };
    case 'gradient': return { ...base, backgroundImage: `linear-gradient(${p.color}, ${acc || '#ef4444'})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' };
    case 'underline': return { ...base, textDecoration: 'underline', textDecorationColor: acc || p.color, textDecorationThickness: 3, textUnderlineOffset: 3, textShadow: '0 1px 4px rgba(0,0,0,.9)' };
    default: return { ...base, WebkitTextStroke: `3px ${acc || (isLightHex(p.color) ? '#000' : '#fff')}`, paintOrder: 'stroke fill' };
  }
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };
/** Output sizes: longest side + bitrates. Real encoded size is usually below the estimate. */
const VQ = [
  { k: 'orig', max: 1920, v: 4_000_000, a: 160_000 },
  { k: 'p720', max: 1280, v: 2_500_000, a: 128_000 },
  { k: 'p480', max: 854, v: 1_200_000, a: 96_000 },
  { k: 'p360', max: 640, v: 600_000, a: 96_000 },
];

/**
 * Largest edited video we hand to the uploader. Re-encoding in the browser is real-time at a fixed bitrate, so a long clip
 * used to come out far above the server limit (50 MB) and was rejected. The bitrate is lowered so the result always fits.
 * (The APK uploads through the WebView's own XHR/fetch, so it has the same budget as the website.)
 */
const MAX_OUT_BYTES = 45 * 1024 * 1024;
const capBitrate = (q, secs, mute = false) => {
  const a = mute ? 0 : q.a;
  const budget = (MAX_OUT_BYTES * 8 * 0.85) / Math.max(1, secs); // 15 % headroom: MediaRecorder only approximates the target
  return { ...q, a, v: Math.round(Math.max(150_000, Math.min(q.v, budget - a))) };
};

/** Draw one frame of <video> into ctx with rotate / flip / crop / colour filter applied (preview and export share this). */
function paintFrame(ctx, v, p, cw, ch) {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return;
  const swap = p.rot % 180 !== 0;
  const sw = swap ? vh : vw;
  const sh = swap ? vw : vh;
  const s = cw / Math.max(1, p.crop.w * sw);
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  if (p.filter && p.filter !== 'none') ctx.filter = p.filter;
  ctx.translate(-p.crop.x * sw * s, -p.crop.y * sh * s);
  ctx.scale(s, s);
  ctx.translate(sw / 2, sh / 2);
  if (p.flip) ctx.scale(-1, 1);
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.translate(-vw / 2, -vh / 2);
  ctx.drawImage(v, 0, 0);
  ctx.restore();
}

/** Re-encode [start,end] of the video in real time: optional crop / rotate / flip / colour filter / burned-in subtitles / smaller size / no sound. */
async function exportVideo({ url, name, start, end, mute, cleanAudio = null, cues = [], subStyle = CAP_DEFAULT, params, quality, onProgress, abortRef, file = null }) {
  if (cues.length) await loadCapFont(subStyle.font);

  // Fast path: WebCodecs (hardware decode + encode, faster than playback). Anything that is not an abort / size problem
  // (no encoder on this device, odd codec, ...) falls through to the real-time recorder below.
  if (file && canFastExport()) {
    try {
      const { fastExportVideo } = await import('../../lib/fastVideoExport');
      return await fastExportVideo({
        file,
        start,
        end,
        mute,
        cleanAudio,
        params,
        quality,
        bits: capBitrate(quality, end - start, mute),
        drawOverlay: cues.length ? (ctx, t, w, h) => drawCaption(ctx, cueAt(cues, t), w, h, subStyle) : null,
        onProgress,
        abortRef,
        maxBytes: MAX_OUT_BYTES * 1.2,
        copyMaxBytes: MAX_OUT_BYTES,
      });
    } catch (e) {
      if (e?.name === 'AbortError' || e?.message === 'too_big') throw e;
      console.warn('[export] fast path unavailable, using real-time export:', e?.message || e);
      onProgress?.(0);
    }
  }
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.preload = 'auto';
  // inside the viewport (nearly invisible) on purpose: off-screen / 2px / opacity:0 media gets throttled by the browser, which put gaps in the recorded sound
  v.style.cssText = 'position:fixed;right:0;bottom:0;width:64px;height:36px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(v);

  let ac = null;
  let cleanSrc = null;
  let rec = null;
  let stream = null;
  let raf = 0;
  let aborted = false;
  abortRef.current = () => {
    aborted = true;
  };

  const cleanup = () => {
    cancelAnimationFrame(raf);
    try {
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch { /* already stopped */ }
    stream?.getTracks().forEach((t) => t.stop());
    ac?.close?.().catch(() => {});
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
  };

  try {
    await once(v, 'loadedmetadata');
    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 360;
    const swap = params.rot % 180 !== 0;
    const srcW = (swap ? vh : vw) * params.crop.w;
    const srcH = (swap ? vw : vh) * params.crop.h;
    const k = Math.min(1, quality.max / Math.max(srcW, srcH));
    const cw = Math.max(2, Math.round((srcW * k) / 2) * 2);
    const ch = Math.max(2, Math.round((srcH * k) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    v.currentTime = start;
    await once(v, 'seeked');
    paintFrame(ctx, v, params, cw, ch);

    const audioTracks = [];
    if (mute) {
      v.muted = true;
    } else {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        // 'playback' = bigger audio buffers: no dropouts while the main thread is busy painting frames
        try { ac = new AC({ latencyHint: 'playback' }); } catch { ac = new AC(); }
        await ac.resume().catch(() => {});
        const dest = ac.createMediaStreamDestination();
        if (cleanAudio) {
          // noise-reduced sound replaces the video's own: the element stays silent, the cleaned buffer is recorded instead
          v.muted = true;
          cleanSrc = ac.createBufferSource();
          cleanSrc.buffer = cleanAudio;
          cleanSrc.connect(dest);
        } else {
          ac.createMediaElementSource(v).connect(dest);
        }
        audioTracks.push(...dest.stream.getAudioTracks());
      }
    }

    stream = canvas.captureStream(30);
    audioTracks.forEach((t) => stream.addTrack(t));

    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const bits = capBitrate(quality, end - start, !audioTracks.length);
    rec = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: bits.v,
      ...(audioTracks.length ? { audioBitsPerSecond: bits.a } : {}),
    });
    const chunks = [];
    rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const stopped = new Promise((resolve) => {
      rec.onstop = resolve;
    });

    rec.start(1000);
    cleanSrc?.start(0, start);
    await v.play();

    await new Promise((resolve, reject) => {
      let lastPaint = 0;
      const tick = (now = performance.now()) => {
        if (aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const t = v.currentTime;
        // the canvas stream captures at 30 fps: painting at 60 fps only steals main-thread time from the audio
        if (now - lastPaint < 30 && t < end - 0.1) {
          raf = requestAnimationFrame(tick);
          return;
        }
        lastPaint = now;
        paintFrame(ctx, v, params, cw, ch);
        if (cues.length) drawCaption(ctx, cueAt(cues, t), cw, ch, subStyle);
        onProgress?.(clamp((t - start) / Math.max(0.1, end - start), 0, 1));
        if (t >= end - 0.03 || v.ended) {
          resolve();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      v.onerror = () => reject(new Error('playback'));
      raf = requestAnimationFrame(tick);
    });

    v.pause();
    if (rec.state !== 'inactive') rec.stop();
    await stopped;

    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    if (blob.size < 500) throw new Error('empty');
    if (blob.size > MAX_OUT_BYTES * 1.6) throw new Error('too_big'); // far over budget even after capping: better a clear error than a rejected upload
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const base = (name || 'video').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}-edited.${ext}`, { type });
  } finally {
    cleanup();
    abortRef.current = null;
  }
}

const VideoEditor = forwardRef(function VideoEditor({ file, tx, onReady, onError, onProgress, phone = false }, ref) {
  const [url, setUrl] = useState(null);
  const [dur, setDur] = useState(0);
  const [range, setRange] = useState([0, 0]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mute, setMute] = useState(false);
  const [thumbs, setThumbs] = useState([]);
  const [tool, setTool] = useState(null); // null | 'crop' | 'filter' | 'quality' | 'subs' | 'noise'
  const [vdim, setVdim] = useState({ w: 0, h: 0 });
  const [rot, setRot] = useState(0);
  const [flip, setFlip] = useState(false);
  const [crop, setCrop] = useState(FULL);
  const [aspect, setAspect] = useState('free');
  const [adj, setAdj] = useState(DEFAULT_ADJ);
  const [qk, setQk] = useState('orig');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [frameTick, setFrameTick] = useState(0);
  // subtitles (burned into the video on export)
  const [cues, setCues] = useState([]);
  const [auto, setAuto] = useState({ on: false });
  const [subMsg, setSubMsg] = useState({ kind: '', text: '' });
  const [subAvail, setSubAvail] = useState(true);
  // noise reduction (عزل الضوضاء): the cleaned sound is previewed live and replaces the original on export
  const [nr, setNr] = useState({ level: 'med', status: 'idle', progress: 0, msg: '', music: false });
  const [cleanBuf, setCleanBuf] = useState(null);
  const [cleanOn, setCleanOn] = useState(false);
  const origBufRef = useRef(null);
  const nrAbort = useRef(null);
  const [cueEdit, setCueEdit] = useState(false); // list of subtitle lines to fix typos before sending
  const [subTab, setSubTab] = useState('style'); // phone: 'style' | 'text' once subtitles exist
  const [styOpen, setStyOpen] = useState(false); // subtitle style panel: collapsed until asked for (it is tall)
  const [subStyle, setSubStyleRaw] = useState(loadCapStyle);
  const setSubStyle = (patch) => setSubStyleRaw((o) => { const n = { ...o, ...patch }; saveCapStyle(n); return n; });

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const pRef = useRef({});
  const cdrag = useRef(null);
  const subFileRef = useRef(null);
  const autoAbort = useRef(null);
  const vRef = useRef(null);
  const trackRef = useRef(null);
  const rangeRef = useRef([0, 0]);
  const dragRef = useRef(null);
  const abortRef = useRef(null);
  const trimOk = canTrimVideo();
  const filtOk = canFilter();

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    let alive = true;
    getAutoSubtitleStatus().then((st) => alive && setSubAvail(!!st?.available));
    return () => {
      alive = false;
      autoAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setRangeBoth = (r) => {
    rangeRef.current = r;
    setRange(r);
  };

  /* ---- undo / redo over EVERY edit (filter, brightness…, trim, frame, rotate, flip, sound, size, subtitles, clean sound) ----
     A snapshot is taken after each change settles (slider drags / handle drags count as one step), so any single edit can be undone on its own. */
  const histRef = useRef({ stack: [], idx: -1, timer: null });
  const [, setHistTick] = useState(0);
  const snapNow = () => ({ range: rangeRef.current, mute, rot, flip, crop, aspect, adj, qk, cues, cleanOn });
  const snapRef = useRef(snapNow);
  snapRef.current = snapNow;
  const commitHist = useCallback(() => {
    const h = histRef.current;
    clearTimeout(h.timer); h.timer = null;
    const sn = snapRef.current(); const k = JSON.stringify(sn);
    if (h.stack[h.idx]?.k === k) return;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push({ sn, k });
    if (h.stack.length > 100) h.stack.shift();
    h.idx = h.stack.length - 1;
    setHistTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!dur) return undefined;
    const h = histRef.current;
    if (h.idx < 0) { commitHist(); return undefined; } // the untouched video is the first step
    clearTimeout(h.timer);
    h.timer = setTimeout(commitHist, 250);
    return () => clearTimeout(h.timer);
  }, [dur, range, mute, rot, flip, crop, aspect, adj, qk, cues, cleanOn, commitHist]);
  const stepHist = (d) => {
    commitHist(); // flush an edit made a moment ago so it becomes its own step
    const h = histRef.current;
    const ni = h.idx + d;
    if (ni < 0 || ni >= h.stack.length) return;
    h.idx = ni;
    const sn = h.stack[ni].sn;
    setRangeBoth(sn.range); setMute(sn.mute); setRot(sn.rot); setFlip(sn.flip); setCrop(sn.crop); setAspect(sn.aspect);
    setAdj(sn.adj); setQk(sn.qk); setCues(sn.cues); setCleanOn(sn.cleanOn);
    setHistTick((n) => n + 1);
  };
  const stepRef = useRef(stepHist);
  stepRef.current = stepHist;
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (!(e.ctrlKey || e.metaKey) || tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); stepRef.current(e.shiftKey ? 1 : -1); }
      else if (k === 'y') { e.preventDefault(); stepRef.current(1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const canUndoV = histRef.current.idx > 0;
  const canRedoV = histRef.current.idx < histRef.current.stack.length - 1;

  const initDuration = (d) => {
    if (!d || !Number.isFinite(d)) {
      onError?.();
      return;
    }
    setDur(d);
    setRangeBoth([0, d]);
    onReady?.();
  };

  const onMeta = () => {
    const v = vRef.current;
    if (!v) return;
    setVdim({ w: v.videoWidth || 0, h: v.videoHeight || 0 });
    if (v.duration === Infinity) {
      // MediaRecorder output without a duration header: force the browser to compute it.
      const fix = () => {
        v.removeEventListener('timeupdate', fix);
        initDuration(v.duration);
        v.currentTime = 0;
      };
      v.addEventListener('timeupdate', fix);
      v.currentTime = 1e101;
    } else {
      initDuration(v.duration);
    }
  };

  // frame strip
  useEffect(() => {
    if (!url || !dur) return undefined;
    let alive = true;
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    const N = 10;
    const out = [];
    (async () => {
      try {
        await once(v, 'loadeddata');
        const c = document.createElement('canvas');
        c.width = 96;
        c.height = Math.max(32, Math.round((96 * (v.videoHeight || 9)) / (v.videoWidth || 16)));
        const x = c.getContext('2d');
        for (let i = 0; i < N && alive; i += 1) {
          v.currentTime = Math.min(dur - 0.05, (dur * (i + 0.5)) / N);
          await once(v, 'seeked', 3000);
          x.drawImage(v, 0, 0, c.width, c.height);
          out.push(c.toDataURL('image/jpeg', 0.55));
          if (alive) setThumbs([...out]);
        }
      } catch { /* the strip is cosmetic */ }
    })();
    return () => {
      alive = false;
      v.removeAttribute('src');
      v.load();
    };
  }, [url, dur]);

  /* ---- preview geometry: the canvas shows the picture exactly as it will be exported ---- */
  const rotated = rot % 180 !== 0;
  const sw = rotated ? vdim.h : vdim.w;
  const sh = rotated ? vdim.w : vdim.h;
  const viewCrop = tool === 'crop' ? FULL : crop; // while cropping, show the whole frame under the crop box
  const srcW = Math.max(1, sw * viewCrop.w);
  const srcH = Math.max(1, sh * viewCrop.h);
  const scale = vdim.w && box.w && box.h ? Math.min((box.w - 4) / srcW, (box.h - 4) / srcH) : 0;
  const dw = Math.max(1, Math.floor(srcW * scale));
  const dh = Math.max(1, Math.floor(srcH * scale));
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const filterCss = filtOk ? adjCss(adj) : 'none';

  pRef.current = { rot, flip, crop: viewCrop, filter: filterCss, cues, subStyle, ok: scale > 0 };

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const v = vRef.current;
    const P = pRef.current;
    if (!cv || !v || !P.ok) return;
    const ctx = cv.getContext('2d');
    paintFrame(ctx, v, P, cv.width, cv.height);
    if (P.cues?.length) drawCaption(ctx, cueAt(P.cues, v.currentTime), cv.width, cv.height, P.subStyle);
  }, []);

  // Preview of the noise-reduced sound: the <video> is muted and the cleaned buffer plays in sync with it.
  useEffect(() => {
    const v = vRef.current;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!v || !AC || !cleanBuf || !cleanOn || mute) return undefined;
    const ac = new AC();
    let src = null;
    let at = { ct: 0, mt: 0 };
    const stop = () => {
      if (!src) return;
      try { src.stop(); } catch { /* not started */ }
      try { src.disconnect(); } catch { /* already gone */ }
      src = null;
    };
    const start = () => {
      stop();
      if (v.paused) return;
      ac.resume().catch(() => {});
      const off = Math.min(Math.max(0, v.currentTime), Math.max(0, cleanBuf.duration - 0.01));
      src = ac.createBufferSource();
      src.buffer = cleanBuf;
      src.connect(ac.destination);
      src.start(0, off);
      at = { ct: ac.currentTime, mt: off };
    };
    const onTime = () => {
      if (!src || v.paused) return;
      if (Math.abs(at.mt + (ac.currentTime - at.ct) - v.currentTime) > 0.25) start(); // drifted: re-sync
    };
    const evs = [['play', start], ['playing', start], ['seeked', start], ['pause', stop], ['waiting', stop], ['timeupdate', onTime]];
    evs.forEach(([e, f]) => v.addEventListener(e, f));
    start();
    return () => {
      evs.forEach(([e, f]) => v.removeEventListener(e, f));
      stop();
      ac.close().catch(() => {});
    };
  }, [cleanBuf, cleanOn, mute]);

  useEffect(() => () => nrAbort.current?.abort(), []);

  // a web font (Cairo / Amiri) finishes loading after the first paint: repaint once it is ready
  useEffect(() => {
    let alive = true;
    loadCapFont(subStyle.font).then(() => alive && setFrameTick((k) => k + 1));
    return () => { alive = false; };
  }, [subStyle.font]);

  // repaint whenever something visible changed (paused state)
  useEffect(() => {
    draw();
  }, [draw, dw, dh, rot, flip, viewCrop.x, viewCrop.y, viewCrop.w, viewCrop.h, filterCss, cues, subStyle, t, frameTick, tool]);

  // while playing: paint every frame, update the clock ~10x/second
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = 0;
    const loop = (now) => {
      draw();
      if (now - last > 100) {
        last = now;
        const v = vRef.current;
        if (v) setT(v.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw]);

  const onTimeUpdate = () => {
    const v = vRef.current;
    if (!v) return;
    const [s, e] = rangeRef.current;
    if (!dragRef.current && v.currentTime >= e - 0.02 && !v.paused) {
      v.pause();
      v.currentTime = s;
    }
    setT(v.currentTime);
  };

  const togglePlay = () => {
    const v = vRef.current;
    if (!v) return;
    const [s, e] = rangeRef.current;
    if (v.paused) {
      if (v.currentTime < s || v.currentTime >= e - 0.05) v.currentTime = s;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const timeAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  };
  const startDrag = (which) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    vRef.current?.pause();
    dragRef.current = which;
  };
  const moveDrag = (which) => (e) => {
    if (dragRef.current !== which) return;
    const tm = timeAt(e.clientX);
    const [s, en] = rangeRef.current;
    const v = vRef.current;
    const minLen = Math.min(MIN_TRIM, dur);
    if (which === 'start') {
      const ns = clamp(tm, 0, en - minLen);
      setRangeBoth([ns, en]);
      if (v) v.currentTime = ns;
    } else {
      const ne = clamp(tm, s + minLen, dur);
      setRangeBoth([s, ne]);
      if (v) v.currentTime = Math.max(s, ne - 0.05);
    }
  };
  const endDrag = () => {
    dragRef.current = null;
    const v = vRef.current;
    if (v) v.currentTime = rangeRef.current[0];
  };
  const seekTrack = (e) => {
    const [s, en] = rangeRef.current;
    const v = vRef.current;
    if (v) v.currentTime = clamp(timeAt(e.clientX), s, en);
  };

  /* ---- frame tools ---- */
  const resetCrop = () => {
    setCrop(FULL);
    setAspect('free');
  };
  const rotate = () => {
    setRot((r) => (r + 90) % 360);
    resetCrop();
  };
  const doFlip = () => {
    setFlip((f) => !f);
    resetCrop();
  };
  const chooseAspect = (k) => {
    setAspect(k);
    const r = ASPECTS.find((a) => a.k === k)?.r;
    setCrop(r ? fitRatio(r, sw, sh) : FULL);
  };
  const cropRatio = ASPECTS.find((a) => a.k === aspect)?.r || null;
  const cropH = (handle) => ({
    onPointerDown: (e) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      cdrag.current = { handle, sx: e.clientX, sy: e.clientY, rect: crop };
    },
    onPointerMove: (e) => {
      const d = cdrag.current;
      if (!d || d.handle !== handle) return;
      setCrop(resizeCrop(d.rect, handle, (e.clientX - d.sx) / dw, (e.clientY - d.sy) / dh, cropRatio, sw, sh));
    },
    onPointerUp: () => {
      cdrag.current = null;
    },
    onPointerCancel: () => {
      cdrag.current = null;
    },
  });
  const HANDLES = cropRatio ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const cropChanged = crop.w < 0.999 || crop.h < 0.999;
  /* ---- noise reduction ---- */
  const runNr = async (level) => {
    if (nr.status === 'working') return;
    const ctl = new AbortController();
    nrAbort.current = ctl;
    setNr({ level, status: 'working', progress: 0, msg: '' });
    try {
      if (!origBufRef.current) origBufRef.current = await decodeForDenoise(file);
      const out = await denoiseBuffer(origBufRef.current, level, {
        signal: ctl.signal,
        onProgress: (p) => setNr((o) => (o.status === 'working' ? { ...o, progress: p } : o)),
      });
      setCleanBuf(out);
      setCleanOn(true);
      setNr({ level, status: 'ready', progress: 1, msg: '', music: !!getDenoiseInfo(out)?.music });
    } catch (err) {
      const code = err instanceof NoiseError ? err.code : 'failed';
      if (code === 'cancelled') setNr((o) => ({ ...o, status: 'idle', progress: 0, msg: '' }));
      else setNr((o) => ({ ...o, status: 'error', progress: 0, msg: tx.nrErrors[code] || tx.nrErrors.failed }));
    } finally {
      nrAbort.current = null;
    }
  };
  const removeNr = () => { setCleanBuf(null); setCleanOn(false); setNr((o) => ({ ...o, status: 'idle', progress: 0, msg: '' })); };

  const pickTool = (k) => setTool((cur) => (cur === k ? null : k));

  /* ---- subtitles ---- */
  const subError = (err) => {
    const code = err instanceof AutoSubError ? err.code : 'failed';
    return tx.subErrors[code] || tx.subErrors.failed;
  };
  const startAuto = async (target) => {
    if (auto.on || !url) return;
    setSubMsg({ kind: '', text: '' });
    const ctl = new AbortController();
    autoAbort.current = ctl;
    setAuto({ on: true, stage: 'download' });
    try {
      const res = await generateAutoSubtitles({
        src: url,
        file, // read the bytes straight from the File (fetching a blob: URL can be blocked)
        target,
        signal: ctl.signal,
        cache: false, // blob: URLs are one-off
        onProgress: (p) => setAuto({ on: true, ...p }),
        onCues: (c) => setCues(c),
      });
      setCues(res.cues);
      if (res.partial) setSubMsg({ kind: 'warn', text: tx.subPartial });
      else if (!res.translated && target !== 'orig') setSubMsg({ kind: 'warn', text: tx.subUntranslated });
    } catch (err) {
      if (!(err instanceof AutoSubError && err.code === 'cancelled')) setSubMsg({ kind: 'err', text: subError(err) });
    } finally {
      setAuto({ on: false });
      if (autoAbort.current === ctl) autoAbort.current = null;
    }
  };
  const editCue = (i, text) => setCues((l) => l.map((c, k) => (k === i ? { ...c, text } : c)));
  const deleteCue = (i) => setCues((l) => l.filter((_, k) => k !== i));
  const seekCue = (c) => {
    const v = vRef.current;
    if (!v) return;
    v.pause();
    try { v.currentTime = Math.min(c.e - 0.05, c.s + 0.05); } catch { /* not seekable yet */ }
  };
  const onSubFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = parseCues(await f.text());
      if (!parsed.length) setSubMsg({ kind: 'err', text: tx.subNoFile });
      else {
        setCues(parsed);
        setSubMsg({ kind: '', text: '' });
      }
    } catch {
      setSubMsg({ kind: 'err', text: tx.subNoFile });
    }
  };

  const [rs, re] = range;
  const trimmed = dur > 0 && (rs > 0.05 || re < dur - 0.05);
  const pct = (x) => (dur ? (x / dur) * 100 : 0);
  const quality = VQ.find((x) => x.k === qk) || VQ[0];
  const edited = trimmed || mute || (cleanOn && !!cleanBuf) || cues.length > 0 || rot !== 0 || flip || cropChanged || !adjIsDefault(adj) || qk !== 'orig';
  const secs = Math.max(0.1, re - rs);
  const estBytes = (q) => { const c = capBitrate(q, secs, mute); return Math.min(((c.v + c.a) * secs) / 8, file.size * (secs / Math.max(dur, 0.1))); };

  useImperativeHandle(ref, () => ({
    cancel() {
      abortRef.current?.();
    },
    isDirty() { return edited; },
    async getResult() {
      if (!edited || !trimOk) return file;
      return exportVideo({
        url,
        file,
        name: file.name,
        start: rs,
        end: re,
        mute,
        cleanAudio: cleanOn ? cleanBuf : null,
        cues,
        subStyle,
        params: { rot, flip, crop, filter: filtOk ? adjCss(adj) : 'none' },
        quality,
        onProgress,
        abortRef,
      });
    },
  }), [edited, trimOk, filtOk, file, url, rs, re, mute, cleanOn, cleanBuf, cues, subStyle, rot, flip, crop, adj, quality, onProgress]);

  const stageText = auto.stage === 'transcribe' ? `${tx.subTranscribe(auto.done || 0, auto.total || 1)} ${auto.pct ?? 0}%` : auto.stage === 'decode' ? tx.subDecode : tx.subDownload;
  const subPct = auto.stage === 'transcribe' ? Math.max(6, auto.pct ?? Math.round(((auto.done || 0) / (auto.total || 1)) * 100)) : 6;

  const stageEl = (
      <div className="mx-ed__stage mx-ed__stage--video" ref={stageRef} dir="ltr">
        {url && (
          <video
            ref={vRef}
            className="mx-ed__video mx-ed__video--src"
            src={url}
            playsInline
            preload="auto"
            muted={mute || (cleanOn && !!cleanBuf)}
            onLoadedMetadata={onMeta}
            onLoadedData={() => setFrameTick((n) => n + 1)}
            onSeeked={() => {
              if (vRef.current) setT(vRef.current.currentTime);
              setFrameTick((n) => n + 1);
            }}
            onError={() => onError?.()}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {scale > 0 && (
          <div className="mx-ed__canvaswrap" style={{ width: dw, height: dh, cursor: tool === 'crop' ? 'default' : 'pointer' }} onClick={tool === 'crop' ? undefined : togglePlay}>
            <canvas ref={canvasRef} className="mx-ed__canvas" width={Math.round(dw * dpr)} height={Math.round(dh * dpr)} style={{ width: dw, height: dh }} />
            {tool === 'crop' && (
              <div className="mx-crop" style={{ left: crop.x * dw, top: crop.y * dh, width: crop.w * dw, height: crop.h * dh }} {...cropH('move')}>
                <span className="mx-crop__grid" />
                {HANDLES.map((h) => (
                  <span key={h} className={`mx-crop__h mx-crop__h--${h}`} {...cropH(h)} />
                ))}
              </div>
            )}
          </div>
        )}
        {!playing && dur > 0 && tool !== 'crop' && (
          <button type="button" className="mx-ed__bigplay" onClick={togglePlay} aria-label={tx.play}>
            <EdIcon name="play" size={30} />
          </button>
        )}
      </div>
  );
  const cueListEl = (
              <div className="mx-sub__cues" aria-label={tx.subEdit}>
                <p className="mx-ed__hint">{tx.subEditHint}</p>
                {cues.map((c, i) => (
                  <div className="mx-sub__cue" key={i}>
                    <button type="button" className="mx-sub__cuetime" dir="ltr" title={tx.subGoto} onClick={() => seekCue(c)}>{fmtClock(c.s)}</button>
                    <textarea
                      dir="auto"
                      rows={Math.min(4, Math.max(1, Math.ceil(c.text.length / 34)))}
                      value={c.text}
                      onFocus={() => seekCue(c)}
                      onChange={(e) => editCue(i, e.target.value)}
                    />
                    <button type="button" className="mx-ed__iconbtn" aria-label={tx.subDelCue} title={tx.subDelCue} onClick={() => deleteCue(i)}><EdIcon name="x" size={14} /></button>
                  </div>
                ))}
              </div>
            );
  const styleEl = (
              <div className="mx-sub__style" aria-label={tx.subStyle}>
                <div className="mx-sub__presets">
                  <span className="mx-sub__lbl">{tx.stPreset}</span>
                  {CAP_PRESETS.map((p) => {
                    const on = subStyle.font === p.font && subStyle.bg === p.bg && subStyle.color === p.color && (subStyle.accent || '') === p.accent;
                    return (
                      <button key={p.id} type="button" className={`mx-sub__preset${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setSubStyle({ font: p.font, bg: p.bg, color: p.color, accent: p.accent })}>
                        <span className="mx-sub__sample" style={capChipCss(p)}>أبج Abc</span>
                        <small>{tx.stPresets[p.id]}</small>
                      </button>
                    );
                  })}
                </div>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.stFont}</span>
                  {Object.keys(CAP_FONTS).map((k) => (
                    <button key={k} type="button" className={`mx-ed__chipbtn${subStyle.font === k ? ' is-on' : ''}`} style={{ fontFamily: CAP_FONTS[k], fontWeight: capWeight(k) }} onClick={() => setSubStyle({ font: k })}>{tx.stFonts[k]}</button>
                  ))}
                </div>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.stSize}</span>
                  {Object.keys(CAP_SIZES).map((k) => (
                    <button key={k} type="button" className={`mx-ed__chipbtn${subStyle.size === k ? ' is-on' : ''}`} onClick={() => setSubStyle({ size: k })}>{tx.stSizes[k]}</button>
                  ))}
                </div>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.stColor}</span>
                  {CAP_COLORS.map((c) => (
                    <button key={c} type="button" className={`mx-sub__sw${subStyle.color === c ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={subStyle.color === c} onClick={() => setSubStyle({ color: c })} />
                  ))}
                  {/* any colour: the native colour picker sits invisibly on top of a rainbow (or the chosen) swatch */}
                  <label
                    className={`mx-sub__sw mx-sub__sw--custom${CAP_COLORS.includes(subStyle.color) ? '' : ' is-on'}`}
                    style={{ background: CAP_COLORS.includes(subStyle.color) ? undefined : subStyle.color }}
                    title={tx.stCustom}
                  >
                    <input type="color" value={subStyle.color} aria-label={tx.stCustom} onChange={(e) => setSubStyle({ color: e.target.value.toLowerCase() })} />
                  </label>
                </div>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.stBg}</span>
                  {CAP_BGS.map((k) => (
                    <button key={k} type="button" className={`mx-ed__chipbtn${subStyle.bg === k ? ' is-on' : ''}`} onClick={() => setSubStyle({ bg: k })}>{tx.stBgs[k]}</button>
                  ))}
                </div>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.stAccent}</span>
                  {CAP_ACCENTS.map((c) => (
                    <button key={c || 'auto'} type="button" className={c ? `mx-sub__sw${(subStyle.accent || '') === c ? ' is-on' : ''}` : `mx-ed__chipbtn${!subStyle.accent ? ' is-on' : ''}`} style={c ? { background: c } : undefined} aria-label={c || tx.stAuto} aria-pressed={(subStyle.accent || '') === c} onClick={() => setSubStyle({ accent: c })}>{c ? null : tx.stAuto}</button>
                  ))}
                  <label
                    className={`mx-sub__sw mx-sub__sw--custom${!subStyle.accent || CAP_ACCENTS.includes(subStyle.accent) ? '' : ' is-on'}`}
                    style={{ background: !subStyle.accent || CAP_ACCENTS.includes(subStyle.accent) ? undefined : subStyle.accent }}
                    title={tx.stCustom}
                  >
                    <input type="color" value={subStyle.accent || '#000000'} aria-label={tx.stCustom} onChange={(e) => setSubStyle({ accent: e.target.value.toLowerCase() })} />
                  </label>
                </div>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.stPos}</span>
                  {CAP_POS.map((k) => (
                    <button key={k} type="button" className={`mx-ed__chipbtn${subStyle.pos === k ? ' is-on' : ''}`} onClick={() => setSubStyle({ pos: k })}>{tx.stPoss[k]}</button>
                  ))}
                </div>
                <div className="mx-sub__srow">
                  <button type="button" className="mx-ed__chipbtn" onClick={() => setSubStyle({ ...CAP_DEFAULT })}>{tx.stReset}</button>
                </div>
              </div>
            );
  const panelEl = (
    <>
        {tool === 'crop' && (
          <div className="mx-ed__toolrow">
            <div className="mx-ed__chips">
              {ASPECTS.map((a) => (
                <button key={a.k} type="button" className={aspect === a.k ? 'is-on' : ''} onClick={() => chooseAspect(a.k)}>{a.k === 'free' ? tx.free : a.k}</button>
              ))}
            </div>
            <div className="mx-ed__actions">
              <button type="button" className="mx-ed__iconbtn" title={tx.rotate} aria-label={tx.rotate} onClick={rotate}><EdIcon name="rotate" /></button>
              <button type="button" className="mx-ed__iconbtn" title={tx.flip} aria-label={tx.flip} onClick={doFlip}><EdIcon name="flip" /></button>
              <button type="button" className="mx-ed__iconbtn" title={tx.reset} aria-label={tx.reset} disabled={!cropChanged && !rot && !flip && adjIsDefault(adj)} onClick={() => { setRot(0); setFlip(false); resetCrop(); setAdj(DEFAULT_ADJ); }}><EdIcon name="reset" /></button>
            </div>
          </div>
        )}

        {tool === 'filter' && filtOk && <FilterPanel adj={adj} setAdj={setAdj} tx={tx} />}

        {tool === 'quality' && (
          <div className="mx-q">
            <div className="mx-ed__chips mx-q__list">
              {VQ.map((q) => (
                <button key={q.k} type="button" className={qk === q.k ? 'is-on' : ''} onClick={() => setQk(q.k)}>
                  <b>{tx.vq[q.k]}</b>
                  <small dir="ltr">≈ {fmtBytes(estBytes(q))}</small>
                </button>
              ))}
            </div>
            <p className="mx-ed__hint">{tx.hintQuality}</p>
          </div>
        )}

        {tool === 'noise' && trimOk && (
          <div className="mx-sub mx-nr">
            {mute ? (
              <p className="mx-ed__hint">{tx.nrMuted}</p>
            ) : (
              <>
                <div className="mx-sub__srow">
                  <span className="mx-sub__lbl">{tx.nrLevel}</span>
                  {Object.keys(NR_LEVELS).map((k) => (
                    <button key={k} type="button" className={`mx-ed__chipbtn${nr.level === k ? ' is-on' : ''}`} disabled={nr.status === 'working'} onClick={() => (cleanBuf ? runNr(k) : setNr((o) => ({ ...o, level: k })))}>{tx.nrLevels[k]}</button>
                  ))}
                </div>
                {nr.status === 'working' ? (
                  <div className="mx-sub__row" role="status">
                    <span>{tx.nrWorking}</span>
                    <span className="mx-sub__bar"><i style={{ width: `${Math.max(6, Math.round(nr.progress * 100))}%` }} /></span>
                    <button type="button" className="mx-ed__chipbtn" onClick={() => nrAbort.current?.abort()}>{tx.cancel}</button>
                  </div>
                ) : (
                  <div className="mx-sub__row">
                    {!cleanBuf && <button type="button" className="mx-ed__chipbtn" onClick={() => runNr(nr.level)}>✨ {tx.nrRun}</button>}
                    {cleanBuf && (
                      <>
                        <button type="button" className={`mx-ed__chipbtn${!cleanOn ? ' is-on' : ''}`} aria-pressed={!cleanOn} onClick={() => setCleanOn(false)}>{tx.nrBefore}</button>
                        <button type="button" className={`mx-ed__chipbtn${cleanOn ? ' is-on' : ''}`} aria-pressed={cleanOn} onClick={() => setCleanOn(true)}>{tx.nrAfter}</button>
                        <button type="button" className="mx-ed__chipbtn" onClick={removeNr}>{tx.subRemove}</button>
                      </>
                    )}
                  </div>
                )}
                {nr.msg && <p className="mx-sub__msg is-error" role="alert">{nr.msg}</p>}
                {!nr.msg && nr.status !== 'working' && <p className="mx-ed__hint">{cleanBuf ? (nr.music ? tx.nrMusic : tx.nrReady) : tx.nrHint}</p>}
              </>
            )}
          </div>
        )}

        {tool === 'subs' && trimOk && (
          <div className="mx-sub">
            {auto.on ? (
              <div className="mx-sub__row" role="status">
                <span>{stageText}</span>
                <span className="mx-sub__bar"><i style={{ width: `${subPct}%`, transition: 'width .3s linear' }} /></span>
                <button type="button" className="mx-ed__chipbtn" onClick={() => autoAbort.current?.abort()}>{tx.cancel}</button>
              </div>
            ) : (
              <div className="mx-sub__row">
                {subAvail && (
                  <>
                    <button type="button" className="mx-ed__chipbtn" onClick={() => startAuto('ar')}>✨ {tx.subArabic}</button>
                    <button type="button" className="mx-ed__chipbtn" onClick={() => startAuto('en')}>✨ {tx.subEnglish}</button>
                    <button type="button" className="mx-ed__chipbtn" title={tx.subOriginalTitle} onClick={() => startAuto('orig')}>✨ {tx.subOriginal}</button>
                  </>
                )}
                <button type="button" className="mx-ed__chipbtn" onClick={() => subFileRef.current?.click()}>＋ <bdi dir="ltr">{tx.subFile}</bdi></button>
                {cues.length > 0 && (
                  <>
                    <button type="button" className={`mx-ed__chipbtn${cueEdit ? ' is-on' : ''}`} aria-expanded={cueEdit} onClick={() => setCueEdit((o) => !o)}>✏️ {tx.subEdit}</button>
                    <button type="button" className={`mx-ed__chipbtn${styOpen ? ' is-on' : ''}`} aria-expanded={styOpen} onClick={() => setStyOpen((o) => !o)}>🎨 {tx.subStyle}</button>
                    <button type="button" className="mx-ed__chipbtn" onClick={() => { setCues([]); setSubMsg({ kind: '', text: '' }); }}>{tx.subRemove}</button>
                  </>
                )}
              </div>
            )}
            <input ref={subFileRef} type="file" accept=".srt,.vtt,.txt,text/vtt" hidden onChange={onSubFile} />
            {subMsg.text && <p className={`mx-sub__msg is-${subMsg.kind}`} role="alert">{subMsg.text}</p>}
            {!auto.on && !subMsg.text && <p className="mx-ed__hint">{cues.length ? tx.subReady(cues.length) : tx.subHint}</p>}
            {cues.length > 0 && !auto.on && cueEdit && cueListEl}
            {cues.length > 0 && !auto.on && styOpen && styleEl}
          </div>
        )}

    </>
  );
  const trimEl = (
    <>
        {trimOk ? (
          <>
            <div className="mx-trim" dir="ltr">
              <div className="mx-trim__track" ref={trackRef} onPointerDown={seekTrack}>
                <div className="mx-trim__thumbs">
                  {thumbs.map((s, i) => (
                    <img key={i} src={s} alt="" draggable={false} />
                  ))}
                </div>
                <span className="mx-trim__dim" style={{ left: 0, width: `${pct(rs)}%` }} />
                <span className="mx-trim__dim" style={{ right: 0, width: `${100 - pct(re)}%` }} />
                <span className="mx-trim__sel" style={{ left: `${pct(rs)}%`, width: `${pct(re) - pct(rs)}%` }} />
                <span className="mx-trim__head" style={{ left: `${pct(clamp(t, rs, re))}%` }} />
                <span className="mx-trim__handle mx-trim__handle--start" style={{ left: `${pct(rs)}%` }} onPointerDown={startDrag('start')} onPointerMove={moveDrag('start')} onPointerUp={endDrag} onPointerCancel={endDrag} />
                <span className="mx-trim__handle mx-trim__handle--end" style={{ left: `${pct(re)}%` }} onPointerDown={startDrag('end')} onPointerMove={moveDrag('end')} onPointerUp={endDrag} onPointerCancel={endDrag} />
              </div>
            </div>
            <div className="mx-ed__toolrow mx-ed__trimmeta">
              <span><EdIcon name="scissors" size={14} /> {tx.start}: <b dir="ltr">{fmtClock(rs)}</b></span>
              <span>{tx.length}: <b dir="ltr">{fmtClock(re - rs)}</b></span>
              <span>{tx.end}: <b dir="ltr">{fmtClock(re)}</b></span>
            </div>
            <p className="mx-ed__hint">{tool === 'crop' ? tx.hintFrame : tx.hintTrim} · {fmtBytes(file.size)}</p>
          </>
        ) : (
          <p className="mx-ed__hint">{tx.unsupported}</p>
        )}
    </>
  );

  if (phone) {
    const sheetTitle = { subs: tx.subs, filter: tx.filters, crop: tx.frame, quality: tx.size2, noise: tx.noise }[tool];
    const railItems = [
      ['subs', 'cc', tx.subs, cues.length > 0],
      ['filter', 'sliders', tx.filters, !adjIsDefault(adj)],
      ['crop', 'crop', tx.frame, cropChanged || !!rot || flip],
      ['quality', 'size', tx.size2, qk !== 'orig'],
      ['noise', 'noise', tx.noise, cleanOn && !!cleanBuf],
    ].filter((r) => r[0] !== 'filter' || filtOk);
    const hasCues = cues.length > 0 && !auto.on;
    const subsEl = (
      <div className="mx-sub">
        {auto.on ? (
          <div className="mx-sub__row" role="status">
            <span>{stageText}</span>
            <span className="mx-sub__bar"><i style={{ width: `${subPct}%`, transition: 'width .3s linear' }} /></span>
            <button type="button" className="mx-ed__chipbtn" onClick={() => autoAbort.current?.abort()}>{tx.cancel}</button>
          </div>
        ) : hasCues ? (
          <div className="mx-ph__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={subTab === 'style'} className={subTab === 'style' ? 'is-on' : ''} onClick={() => setSubTab('style')}>🎨 {tx.subTabStyle}</button>
            <button type="button" role="tab" aria-selected={subTab === 'text'} className={subTab === 'text' ? 'is-on' : ''} onClick={() => setSubTab('text')}>✏️ {tx.subTabText}</button>
            <button type="button" className="is-danger" onClick={() => { setCues([]); setSubMsg({ kind: '', text: '' }); setSubTab('style'); }}>{tx.subRemove}</button>
          </div>
        ) : (
          <>
            {subAvail && (
              <>
                <p className="mx-ed__hint mx-ph__lead">{tx.subPick}</p>
                <div className="mx-ph__langs">
                  {[['ar', tx.subArabic, tx.subAutoShort], ['en', tx.subEnglish, tx.subAutoShort], ['orig', tx.subOriginal, tx.subNoTranslate]].map(([k, l, d]) => (
                    <button key={k} type="button" className="mx-ph__lang" onClick={() => startAuto(k)}>
                      <span aria-hidden="true">✨</span>
                      <b>{l}</b>
                      <small>{d}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button type="button" className="mx-ph__wide" onClick={() => subFileRef.current?.click()}>＋ <bdi dir="ltr">{tx.subFile}</bdi></button>
          </>
        )}
        <input ref={subFileRef} type="file" accept=".srt,.vtt,.txt,text/vtt" hidden onChange={onSubFile} />
        {subMsg.text && <p className={`mx-sub__msg is-${subMsg.kind}`} role="alert">{subMsg.text}</p>}
        {hasCues && subTab === 'text' && cueListEl}
        {hasCues && subTab === 'style' && styleEl}
      </div>
    );
    return (
      <>
        {stageEl}
        <div className="mx-ph__float">
          <button type="button" className={`mx-ph__round mx-ph__round--pill${mute ? ' is-warn' : ''}`} aria-pressed={mute} onClick={() => setMute((m) => !m)}>
            <EdIcon name={mute ? 'volumeOff' : 'volume'} size={20} />
            {mute && <span>{tx.muted}</span>}
          </button>
        </div>
        <div className="mx-ph__transport">
          <div className="mx-ph__tbar">
            <button type="button" className="mx-ph__play" onClick={togglePlay} aria-label={playing ? tx.pause : tx.play}><EdIcon name={playing ? 'pause' : 'play'} size={20} /></button>
            <span className="mx-ed__time" dir="ltr">{fmtClock(t)} / {fmtClock(dur)}</span>
            <button type="button" className="mx-ed__iconbtn" title={`${tx.undo} (Ctrl+Z)`} aria-label={tx.undo} disabled={!canUndoV} onClick={() => stepHist(-1)}><EdIcon name="undo" /></button>
            <button type="button" className="mx-ed__iconbtn" title={`${tx.redo} (Ctrl+Shift+Z)`} aria-label={tx.redo} disabled={!canRedoV} onClick={() => stepHist(1)}><EdIcon name="redo" /></button>
          </div>
          {trimEl}
        </div>
        {trimOk && (tool ? (
          <PhoneSheet title={sheetTitle} tall={tool === 'subs' && hasCues && subTab === 'text'} okLabel={tx.done} onOk={() => setTool(null)}>
            {tool === 'subs' ? subsEl : panelEl}
          </PhoneSheet>
        ) : (
          <PhoneRail items={railItems} onPick={pickTool} label={tx.tools} />
        ))}
      </>
    );
  }

  return (
    <>
      {stageEl}
      <div className="mx-ed__tools">
        <div className="mx-ed__sticky">
        <div className="mx-ed__toolrow">
          <div className="mx-ed__vctrl">
            <button type="button" className="mx-ed__iconbtn" onClick={togglePlay} aria-label={playing ? tx.pause : tx.play}>
              <EdIcon name={playing ? 'pause' : 'play'} />
            </button>
            <span className="mx-ed__time" dir="ltr">{fmtClock(t)} / {fmtClock(dur)}</span>
          </div>
          <button type="button" className={`mx-ed__chipbtn${mute ? ' is-on' : ''}`} onClick={() => setMute((m) => !m)}>
            <EdIcon name={mute ? 'volumeOff' : 'volume'} size={18} />
            <span>{mute ? tx.muted : tx.mute}</span>
          </button>
        </div>

        {trimOk && (
          <div className="mx-ed__toolrow">
            <div className="mx-ed__seg mx-ed__seg--scroll" role="tablist">
              <button type="button" className={tool === 'crop' ? 'is-on' : ''} onClick={() => pickTool('crop')}><EdIcon name="crop" size={18} /><span>{tx.frame}</span></button>
              {filtOk && <button type="button" className={tool === 'filter' ? 'is-on' : ''} onClick={() => pickTool('filter')}><EdIcon name="sliders" size={18} /><span>{tx.filters}</span></button>}
              <button type="button" className={tool === 'quality' ? 'is-on' : ''} onClick={() => pickTool('quality')}><EdIcon name="size" size={18} /><span>{tx.size2}</span></button>
              <button type="button" className={tool === 'noise' ? 'is-on' : ''} onClick={() => pickTool('noise')}><EdIcon name="noise" size={18} /><span>{cleanOn && cleanBuf ? tx.noiseOn : tx.noise}</span></button>
              <button type="button" className={tool === 'subs' ? 'is-on' : ''} onClick={() => pickTool('subs')}><EdIcon name="cc" size={18} /><span>{cues.length ? tx.subsOn : tx.subs}</span></button>
            </div>
          </div>
        )}
        </div>

        {panelEl}
        {trimEl}
      </div>
    </>
  );
});

/* ================================================================ SHELL */

const isGif = (f) => /gif$/i.test(f.type || '') || /\.gif$/i.test(f.name || '');
export const isEditableMedia = (f) => {
  const t = f?.type || '';
  return (t.startsWith('image/') && !isGif(f) && !/svg/.test(t)) || t.startsWith('video/');
};

/** Keeps a fixed full-screen layer exactly on the visible viewport, so an opening / closing keyboard (esp. iOS) does not push or jolt it. */
function useVisualViewportFit(ref) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return undefined;
    let base = vv.height;
    const fit = () => {
      base = Math.max(base, vv.height);
      el.dataset.kb = vv.height < base * 0.8 ? '1' : '0'; // keyboard open: the picture gets less room
      el.style.height = `${Math.round(vv.height)}px`;
      el.style.transform = vv.offsetTop ? `translateY(${Math.round(vv.offsetTop)}px)` : '';
      if (window.scrollY) window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, [ref]);
}

/** True on phone-sized screens: the editor then uses its own layout (fixed preview, scrolling tool sheet, stacked footer). */
function usePhone() {
  const q = '(max-width: 700px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const on = () => setPhone(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return phone;
}

/** `saveMode`: used outside chat (My PC viewer) — no caption / Send, the confirm button reads "Save" and calls onDone(file). */
export default function MediaEditorModal({ file, initialCaption = '', onCancel, onDone, onSend, saveMode = false, allowViewOnce = false }) {
  const { locale } = useLanguage();
  const tx = TEXTS[locale === 'ar' ? 'ar' : 'en'];
  const isVideo = (file.type || '').startsWith('video/');
  const gif = !isVideo && isGif(file);

  const [caption, setCaption] = useState(initialCaption);
  // "View once" / "timer" (same options as the camera): null = normal. Travels on the File as `uipView`, like camera shots.
  const [confirmClose, setConfirmClose] = useState(false);
  const [viewMode, setViewMode] = useState(file.uipView?.mode || null);
  const [viewSecs, setViewSecs] = useState(file.uipView?.seconds || 10);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState(null); // seconds left, shown once there is enough progress to estimate it
  const t0Ref = useRef(0);
  const [err, setErr] = useState('');
  const [gifUrl, setGifUrl] = useState(null);
  const edRef = useRef(null);
  const rootRef = useRef(null);
  const phone = usePhone();
  useVisualViewportFit(rootRef);

  useEffect(() => {
    if (!gif) return undefined;
    const u = URL.createObjectURL(file);
    setGifUrl(u);
    setReady(true);
    return () => URL.revokeObjectURL(u);
  }, [gif, file]);

  // X / Esc with unsaved edits asks first: one mis-tap used to throw away every edit and drop the user back in the chat.
  const requestClose = useCallback(() => {
    if (busy) return;
    if (edRef.current?.isDirty?.()) setConfirmClose(true); else onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy && document.activeElement?.tagName !== 'INPUT') requestClose();
    };
    document.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [busy, onCancel, requestClose]);

  const finish = async (send) => {
    if (busy) return;
    setErr('');
    setBusy(true);
    setProgress(0);
    setEta(null);
    t0Ref.current = performance.now();
    try {
      const out = gif ? file : await edRef.current.getResult();
      if (allowViewOnce && !saveMode) out.uipView = viewMode ? { mode: viewMode, seconds: viewMode === 'timer' ? viewSecs : null } : null;
      if (send) onSend(out, caption.trim());
      else onDone(out, caption.trim());
    } catch (e) {
      if (e?.name !== 'AbortError') {
        setErr(isVideo ? tx.trimFail : tx.loadFail);
        // App only: the export died on the phone (never reaches the server, so nothing else records it)
        reportClientIssue('media_export_failed', {
          method: 'LOCAL', path: '/media-editor', bytes: file?.size ?? null, message: e?.message || String(e),
          meta: { name: file?.name, type: file?.type, isVideo: !!isVideo, errName: e?.name, send: !!send },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReady = useCallback(() => setReady(true), []);
  const handleError = useCallback(() => setFailed(true), []);
  const handleProgress = useCallback((p) => {
    setProgress(p);
    const el = (performance.now() - t0Ref.current) / 1000;
    setEta(p >= 0.08 && p < 0.995 && el > 1.5 ? Math.round((el / p) * (1 - p)) : null);
  }, []);

  return createPortal(
    <div className={`mx-ed${phone ? ' mx-ed--phone' : ''}`} ref={rootRef} role="dialog" aria-modal="true" aria-label={tx.title}>
      {phone ? (
        <div className="mx-ph__top">
          <button type="button" className="mx-ph__round" onClick={requestClose} disabled={busy} aria-label={tx.close} title={tx.close}>
            <EdIcon name="x" size={22} />
          </button>
          <button type="button" className="mx-ph__pill" disabled={busy || failed || !ready} onClick={() => finish(false)}>
            <EdIcon name="check" size={16} /> {saveMode ? tx.save : tx.done}
          </button>
        </div>
      ) : (
        <header className="mx-ed__top">
          <button type="button" className="mx-ed__iconbtn" onClick={requestClose} disabled={busy} aria-label={tx.close} title={tx.close}>
            <EdIcon name="x" />
          </button>
          <strong className="mx-ed__title">{gif ? tx.previewTitle : saveMode ? tx.titleSave : tx.title}</strong>
          <span className="mx-ed__file" dir="ltr" title={file.name}>{file.name} · {fmtBytes(file.size)}</span>
        </header>
      )}

      {failed ? (
        <div className="mx-ed__fail">{tx.loadFail}</div>
      ) : gif ? (
        <>
          <div className="mx-ed__stage">{gifUrl && <img className="mx-ed__gif" src={gifUrl} alt="" />}</div>
          <div className="mx-ed__tools"><p className="mx-ed__hint">{tx.gifNote}</p></div>
        </>
      ) : isVideo ? (
        <VideoEditor ref={edRef} file={file} tx={tx} phone={phone} onReady={handleReady} onError={handleError} onProgress={handleProgress} />
      ) : (
        <ImageEditor ref={edRef} file={file} tx={tx} phone={phone} onReady={handleReady} onError={handleError} />
      )}

      {err && <div className="mx-ed__err" role="alert">{err}</div>}

      {allowViewOnce && !saveMode && (
        <div className="mx-ed__view" role="radiogroup" aria-label={locale === 'ar' ? 'طريقة العرض' : 'How it is opened'}
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 12px 0', justifyContent: 'center' }}>
          {[[null, locale === 'ar' ? 'عادي' : 'Normal'], ['once', `① ${locale === 'ar' ? 'مرة واحدة' : 'View once'}`], ['timer', `⏱ ${locale === 'ar' ? 'تايمر' : 'Timer'}`]].map(([m, label]) => (
            <button key={String(m)} type="button" role="radio" aria-checked={viewMode === m} disabled={busy} onClick={() => setViewMode(m)}
              style={{ border: 0, borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: viewMode === m ? '#e53e6b' : 'rgba(255,255,255,.12)', color: '#fff' }}>{label}</button>
          ))}
          {viewMode === 'timer' && [3, 5, 10, 30].map((n) => (
            <button key={n} type="button" disabled={busy} onClick={() => setViewSecs(n)}
              style={{ border: 0, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontSize: 13, background: viewSecs === n ? '#e53e6b' : 'rgba(255,255,255,.12)', color: '#fff' }}>{n}{locale === 'ar' ? 'ث' : 's'}</button>
          ))}
        </div>
      )}

      <footer className="mx-ed__foot">
        {saveMode ? <span style={{ flex: 1 }} /> : <input
          className="mx-ed__caption"
          dir="auto"
          value={caption}
          placeholder={tx.caption}
          disabled={busy}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              finish(true);
            }
          }}
        />}
        {saveMode ? (
          <button type="button" className="btn btn-primary mx-ed__btn" disabled={busy || failed || !ready} onClick={() => finish(false)}>
            <EdIcon name="check" size={16} /> {tx.save}
          </button>
        ) : phone ? (
          <button type="button" className="mx-ph__send" disabled={busy || failed || !ready} onClick={() => finish(true)} aria-label={tx.send} title={tx.send}>
            <EdIcon name="send" size={22} />
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-outline mx-ed__btn" disabled={busy || failed || !ready} onClick={() => finish(false)}>
          <EdIcon name="check" size={16} /> {tx.done}
        </button>
            <button type="button" className="btn btn-primary mx-ed__btn" disabled={busy || failed || !ready} onClick={() => finish(true)}>
          <EdIcon name="send" size={16} /> {tx.send}
        </button>
          </>
        )}
      </footer>

      {confirmClose && (
        <div className="mx-ed__busy" role="alertdialog" aria-modal="true" aria-label={locale === 'ar' ? 'تجاهل التعديلات؟' : 'Discard edits?'}>
          <div className="mx-ed__busy-card">
            <p>{locale === 'ar' ? 'تجاهل التعديلات؟' : 'Discard your edits?'}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary mx-ed__btn" autoFocus onClick={() => setConfirmClose(false)}>{locale === 'ar' ? 'متابعة التعديل' : 'Keep editing'}</button>
              <button type="button" className="btn btn-outline mx-ed__btn" onClick={onCancel}>{locale === 'ar' ? 'تجاهل وخروج' : 'Discard'}</button>
            </div>
          </div>
        </div>
      )}

      {busy && isVideo && (
        <div className="mx-ed__busy" role="status">
          <div className="mx-ed__busy-card">
            <p>{tx.exporting}</p>
            <div className="mx-ed__bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <small>{Math.round(progress * 100)}%{eta != null ? ` · ${tx.remaining(eta)}` : ''}</small>
            <button type="button" className="mx-ed__cancelbtn" onClick={() => edRef.current?.cancel()}>{tx.cancel}</button>
          </div>
        </div>
      )}
      {busy && !isVideo && <div className="mx-ed__busy"><div className="mx-ed__busy-card"><p>{tx.working}</p></div></div>}
    </div>,
    document.body
  );
}
