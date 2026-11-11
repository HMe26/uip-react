import { parseServerDate } from '../../utils/serverDate';
/**
 * Formatting + text-render helpers for the messaging UI — ported 1:1 from
 * public/assets/js/messaging.js's fmtTime/fmtDayLabel/fmtBytes/fmtDuration/
 * fmtClock/initials/renderBody. Same logic, same edge cases; renderBody
 * returns React nodes instead of an HTML string since this is JSX-rendered
 * (no dangerouslySetInnerHTML needed — safer, and skips escapeHtml entirely
 * since React already escapes text content).
 *
 * These helpers are plain functions (not hooks), so they read the active
 * locale from <html lang> — LanguageProvider (context/LanguageContext.jsx)
 * keeps that attribute in sync, and every caller re-renders on a locale change.
 */

const isAr = () => typeof document !== 'undefined' && document.documentElement.getAttribute('lang') === 'ar';
const dl = () => (isAr() ? 'ar-EG' : 'en');
/** Tiny inline bilingual picker for non-hook helpers. */
export const bi = (en, ar) => (isAr() ? ar : en);

export function initials(name) {
  const n = (name || "?").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

export function fmtTime(iso) {
  if (!iso) return "";
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString(dl(), { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return bi("Yesterday", "أمس");
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 6) return d.toLocaleDateString(dl(), { weekday: "short" });
  return d.toLocaleDateString(dl(), { month: "short", day: "numeric" });
}

export function fmtDayLabel(iso) {
  const d = parseServerDate(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return bi("Today", "اليوم");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return bi("Yesterday", "أمس");
  return d.toLocaleDateString(dl(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtBytes(n) {
  if (!n && n !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * Attachment/thumbnail URLs come back from the API as root-relative paths
 * (e.g. "/uploads/messages/conv_5/xyz.webp") — same convention as the old
 * uploadsBase handling in messaging.js's attachmentUrl(). The React app can
 * be hosted on a different origin than the PHP backend (see api/client.js
 * docblock), so this prefixes with VITE_UPLOADS_BASE when set (e.g.
 * "https://api.example.com") and otherwise returns the path as-is for
 * same-origin / dev-proxy deployments.
 */
export function attachmentUrl(path) {
  if (!path) return path;
  const base = import.meta.env.VITE_UPLOADS_BASE || '';
  return path.startsWith('http') ? path : base + path;
}

/**
 * Profile-photo URL for a user's avatar_path (stored relative, e.g.
 * "uploads/avatars/x.jpg"). Returns null when there is no photo — either the
 * user has none, or they turned off "show my photo" in chat privacy (the API
 * nulls it then) — so <Avatar> falls back to initials.
 */
export function avatarUrl(path) {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return attachmentUrl('/' + String(path).replace(/^\/+/, ''));
}

const ROLE_LABELS = {
  student: ['Student', 'الطالب'],
  academic_staff: ['Academic staff', 'عضو هيئة التدريس'],
  faculty: ['Faculty', 'الكلية'],
  university: ['University', 'الجامعة'],
  supervisor: ['Supervisor', 'المشرف'],
  admin: ['Admin', 'مدير النظام'],
  security: ['Security', 'الأمان'],
  data_analyst: ['Data analyst', 'محلل البيانات'],
  data_analysis: ['Data analyst', 'محلل البيانات'],
};

/** Human label for an account-role slug ("data_analyst" -> "Data analyst"). */
export function roleLabel(slug) {
  if (!slug) return '';
  const known = ROLE_LABELS[slug];
  if (known) return bi(known[0], known[1]);
  return String(slug).replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function peerLabel(conv) {
  if (!conv) return "";
  if (conv.is_saved && conv.saved_default_name !== false) return bi("Saved Messages", "الرسائل المحفوظة");
  return conv.subject || (conv.is_group ? bi("Group", "مجموعة") : bi("Conversation", "محادثة"));
}

/**
 * Ported from renderBody() — same markdown-lite rules, same order of
 * operations (code block, inline code, bold, italic, links, hashtags,
 * mentions, then newlines), but building a React node array instead of an
 * HTML string. Kept intentionally simple/regex-based like the original —
 * not a real markdown parser.
 */
export function renderBody(rawBody, others) {
  if (rawBody == null) return null;
  const nodes = [];
  let key = 0;

  // Mention names get matched against the raw text before any markdown
  // splitting, same as the original (it ran regex replacements on an
  // escaped HTML string, mentions included) — build a lookup of names to
  // match against here instead.
  const mentionNames = (others || []).map((p) => p.full_name).filter(Boolean);

  // Split on the token types we care about, keeping the delimiters, so we
  // can walk the string once and emit alternating text/element nodes.
  const tokenRe =
    /(```[\s\S]+?```|`[^`]+?`|\*\*[^*]+?\*\*|(?:^|[\s(])_[^_]+?_(?:[\s).,!?]|$)|https?:\/\/[^\s]+|#[\p{L}0-9_]+)/gu;

  let lastIndex = 0;
  let match;
  const pushText = (text) => {
    if (!text) return;
    // Mentions inside plain text segments.
    if (mentionNames.length) {
      const re = new RegExp(
        "(" +
          mentionNames
            .map(escRe)
            .map((n) => "@" + n)
            .join("|") +
          ")",
        "g",
      );
      const parts = text.split(re);
      parts.forEach((part) => {
        if (mentionNames.some((n) => part === "@" + n)) {
          nodes.push(
            <span className="msg-mention" key={key++}>
              {part}
            </span>,
          );
        } else if (part) {
          nodes.push(...withLineBreaks(part, key));
          key += 1;
        }
      });
      return;
    }
    nodes.push(...withLineBreaks(text, key));
    key += 1;
  };

  while ((match = tokenRe.exec(rawBody)) !== null) {
    pushText(rawBody.slice(lastIndex, match.index));
    const tok = match[0];
    if (tok.startsWith("```")) {
      nodes.push(<pre key={key++}>{tok.slice(3, -3)}</pre>);
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("_") || / _/.test(tok) || tok[0] === "_") {
      // trims the captured leading/trailing space/punctuation the regex
      // needed to avoid matching mid-word underscores, same as original.
      const inner = tok.replace(/^([\s(])?_/, "").replace(/_([\s).,!?])?$/, "");
      const lead = /^[\s(]/.test(tok) ? tok[0] : "";
      const trail = /[\s).,!?]$/.test(tok) ? tok[tok.length - 1] : "";
      if (lead) nodes.push(lead);
      nodes.push(<em key={key++}>{inner}</em>);
      if (trail) nodes.push(trail);
    } else if (tok.startsWith("http")) {
      nodes.push(
        <a key={key++} href={tok} target="_blank" rel="noopener noreferrer">
          {tok}
        </a>,
      );
    } else if (tok.startsWith("#")) {
      nodes.push(
        <span className="msg-hashtag" key={key++}>
          {tok}
        </span>,
      );
    }
    lastIndex = tokenRe.lastIndex;
  }
  pushText(rawBody.slice(lastIndex));

  return nodes;
}

function withLineBreaks(text, keyBase) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyBase}-br-${i}`} />);
    if (line) out.push(line);
  });
  return out;
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PREVIEW_LABELS = {
  image:    { en: 'Photo',        ar: 'صورة',          enN: (n) => `${n} photos`,    arN: (n) => `${n} صور` },
  video:    { en: 'Video',        ar: 'فيديو',         enN: (n) => `${n} videos`,    arN: (n) => `${n} فيديوهات` },
  audio:    { en: 'Voice message', ar: 'رسالة صوتية',  enN: (n) => `${n} audio clips`, arN: (n) => `${n} مقاطع صوتية` },
  document: { en: 'Document',     ar: 'مستند',         enN: (n) => `${n} documents`, arN: (n) => `${n} مستندات` },
  archive:  { en: 'Archive',      ar: 'ملف مضغوط',     enN: (n) => `${n} archives`,  arN: (n) => `${n} ملفات مضغوطة` },
  code:     { en: 'Code file',    ar: 'ملف كود',       enN: (n) => `${n} code files`, arN: (n) => `${n} ملفات كود` },
  file:     { en: 'File',         ar: 'ملف',           enN: (n) => `${n} files`,     arN: (n) => `${n} ملفات` },
  poll:     { en: 'Poll',         ar: 'استطلاع رأي' },
  gif:      { en: 'GIF',          ar: 'صورة متحركة' },
  sticker:  { en: 'Sticker',      ar: 'ملصق' },
  location: { en: 'Location',     ar: 'الموقع' },
  live_location: { en: 'Live location', ar: 'الموقع المباشر' },
  deleted:  { en: 'This message was deleted', ar: 'تم حذف هذه الرسالة' },
};

/**
 * Text shown under a chat name in the inbox. Text messages show their body; messages without text
 * (photo / voice / file / poll...) show a readable label instead of the misleading "No messages yet".
 * Returns '' only when the chat really has no message (caller shows its own empty line).
 */
export function previewLabel(conv, locale) {
  if (conv?.preview) return conv.preview;
  const l = PREVIEW_LABELS[conv?.preview_kind];
  if (!l) return '';
  const ar = locale === 'ar';
  const n = Number(conv.preview_count || 0);
  if (n > 1 && (l.arN || l.enN)) return ar ? l.arN(n) : l.enN(n);
  return ar ? l.ar : l.en;
}
