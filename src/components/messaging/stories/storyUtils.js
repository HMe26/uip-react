import { parseServerDate } from '../../../utils/serverDate';
import { attachmentUrl, avatarUrl } from '../format';

export const API = '/api/v1/messaging/stories';

/** Gradient backgrounds for text stories. The key is stored in the DB — never rename a key. */
export const BACKGROUNDS = {
  violet: ['#6d28d9', '#c026d3'],
  ocean: ['#0ea5e9', '#1d4ed8'],
  sunset: ['#f97316', '#db2777'],
  forest: ['#059669', '#0f766e'],
  night: ['#1e293b', '#4338ca'],
  rose: ['#f43f5e', '#fb923c'],
  gold: ['#d97706', '#facc15'],
  slate: ['#334155', '#0f172a'],
};
export const bgCss = (key) => {
  const [a, b] = BACKGROUNDS[key] || BACKGROUNDS.violet;
  return `linear-gradient(160deg, ${a}, ${b})`;
};

export const FONTS = [
  { key: 'sans', title: ['Simple', 'عادي'] },
  { key: 'bold', title: ['Bold', 'عريض'] },
  { key: 'serif', title: ['Serif', 'كلاسيكي'] },
  { key: 'mono', title: ['Mono', 'كود'] },
];
export const EXPIRY = [6, 12, 24, 48];

/** Stored relative path ("uploads/messages/stories/x.jpg") -> URL. Reuses the chat's uploads-base handling. */
export const mediaUrl = (p) => avatarUrl(p);

/**
 * Story photo/video (kind 'file') or video poster (kind 'thumbnail').
 * Story files live in the private "messages" upload category, so /uploads/... answers 404 for them: the API sends a
 * short-lived signed link (media_url / thumbnail_url). The plain path is only a fallback for older API responses.
 */
export const storyMediaUrl = (story, kind = 'file') => {
  if (!story) return null;
  const signed = kind === 'thumbnail' ? story.thumbnail_url : story.media_url;
  if (signed) return attachmentUrl(signed);
  return mediaUrl(kind === 'thumbnail' ? story.thumbnail_path : story.media_path);
};

const ms = (iso) => {
  const d = parseServerDate(iso);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

/** "now" / "5m" / "3h" style label (or Arabic). */
export function ago(iso, ar) {
  const diff = Math.max(0, Date.now() - ms(iso));
  const m = Math.floor(diff / 60000);
  if (m < 1) return ar ? 'الآن' : 'Just now';
  if (m < 60) return ar ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return ar ? `منذ ${h} س` : `${h}h ago`;
  return ar ? 'أمس' : 'Yesterday';
}

/** Time left before the story disappears. */
export function endsIn(iso, ar) {
  const diff = ms(iso) - Date.now();
  if (diff <= 0) return ar ? 'انتهت' : 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 1) return ar ? `تختفي بعد ${h} س` : `Ends in ${h}h`;
  return ar ? `تختفي بعد ${Math.max(1, m)} د` : `Ends in ${Math.max(1, m)}m`;
}

/** How long a slide stays on screen (ms): text scales with length, images 5s, video its own length (3-30s, 90s hard cap). */
export function slideMs(story, videoSeconds) {
  if (story.type === 'video') {
    const s = videoSeconds || story.duration_seconds || 8;
    return Math.min(90, Math.max(3, s)) * 1000;
  }
  if (story.type === 'text') return Math.min(12000, 4500 + (story.body || '').length * 45);
  return 5000;
}

export function readPref(k, fallback) {
  try { return localStorage.getItem('uip.story.' + k) || fallback; } catch { return fallback; }
}
export function writePref(k, v) {
  try { localStorage.setItem('uip.story.' + k, v); } catch { /* private mode */ }
}

/** "Today, 3:44 pm" / "Yesterday, 11:51 pm" / a date — the way the viewers list reads in WhatsApp. */
export function when(iso, ar) {
  const d = parseServerDate(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(ar ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff <= 0) return `${ar ? 'اليوم' : 'Today'}, ${time}`;
  if (diff === 1) return `${ar ? 'أمس' : 'Yesterday'}, ${time}`;
  return `${d.toLocaleDateString(ar ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}, ${time}`;
}
