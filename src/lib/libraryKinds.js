import { TEXT_EXT, extOf } from './driveFileKinds';

/**
 * "My Library" (مكتبتي): every My PC file is sorted into a category from its extension — nothing is stored or moved,
 * the categories are just a smarter view over the same files.
 */
const set = (s) => new Set(s.split(' '));
const IMAGE = set('jpg jpeg png gif webp bmp svg avif heic heif ico tif tiff');
const VIDEO = set('mp4 mov mkv webm avi m4v wmv flv mpg mpeg 3gp');
const AUDIO = set('mp3 wav ogg m4a aac flac opus wma amr');
const DOC = set('pdf doc docx ppt pptx xls xlsx odt ods odp rtf epub pages key numbers');
const NOTE = set('md markdown txt');
const LINK = set('url webloc');
const DATA = set('csv tsv json jsonl ndjson geojson xml yml yaml sqlite db');
const ARCHIVE = set('zip rar 7z tar gz tgz bz2 xz');

export const KINDS = [
  { key: 'image', icon: 'image', en: 'Images', ar: 'صور', color: '#ff9f0a', folder: 'Images' },
  { key: 'video', icon: 'video', en: 'Videos', ar: 'فيديوهات', color: '#ff375f', folder: 'Videos' },
  { key: 'audio', icon: 'audio-wave', en: 'Audio', ar: 'صوتيات', color: '#bf5af2', folder: 'Audio' },
  { key: 'doc', icon: 'file', en: 'Documents', ar: 'مستندات', color: '#0a84ff', folder: 'Documents' },
  { key: 'note', icon: 'note', en: 'Notes', ar: 'ملاحظات', color: '#ffd60a', folder: 'Notes' },
  { key: 'link', icon: 'link', en: 'Links', ar: 'لينكات', color: '#64d2ff', folder: 'Links' },
  { key: 'code', icon: 'terminal', en: 'Code', ar: 'أكواد', color: '#30d158', folder: 'Code' },
  { key: 'data', icon: 'bar-chart', en: 'Data', ar: 'بيانات', color: '#40c8e0', folder: 'Data' },
  { key: 'archive', icon: 'archive', en: 'Archives', ar: 'مضغوطات', color: '#8e8e93', folder: 'Archives' },
  { key: 'other', icon: 'paperclip', en: 'Other', ar: 'أخرى', color: '#a2845e', folder: 'Other' },
];
export const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k]));

/** One file name → one category key. */
export function kindOf(name) {
  const e = extOf(name);
  if (IMAGE.has(e)) return 'image';
  if (VIDEO.has(e)) return 'video';
  if (AUDIO.has(e)) return 'audio';
  if (LINK.has(e)) return 'link';
  if (NOTE.has(e)) return 'note';
  if (DOC.has(e)) return 'doc';
  if (DATA.has(e)) return 'data';
  if (ARCHIVE.has(e)) return 'archive';
  if (TEXT_EXT.has(e)) return 'code';
  return 'other';
}

export const LANGS = [
  { ext: 'js', label: 'JavaScript' }, { ext: 'ts', label: 'TypeScript' }, { ext: 'jsx', label: 'React (JSX)' }, { ext: 'py', label: 'Python' },
  { ext: 'php', label: 'PHP' }, { ext: 'java', label: 'Java' }, { ext: 'cpp', label: 'C++' }, { ext: 'c', label: 'C' }, { ext: 'cs', label: 'C#' },
  { ext: 'go', label: 'Go' }, { ext: 'rs', label: 'Rust' }, { ext: 'sql', label: 'SQL' }, { ext: 'html', label: 'HTML' }, { ext: 'css', label: 'CSS' },
  { ext: 'sh', label: 'Shell' }, { ext: 'json', label: 'JSON' }, { ext: 'txt', label: 'Text' },
];

/** ".url" shortcut text → the address (also reads macOS .webloc). */
export function parseLinkFile(text) {
  const s = String(text || '');
  const m = /^\s*URL\s*=\s*(\S+)/im.exec(s) || /<string>\s*(https?:\/\/[^<\s]+)\s*<\/string>/i.exec(s) || /(https?:\/\/\S+)/i.exec(s);
  return m ? m[1] : '';
}
export const makeLinkFile = (url) => `[InternetShortcut]\nURL=${url}\n`;

/** Adds https:// when missing; null unless it is a usable http(s) address. */
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; }
}
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** A safe file name from free text (keeps Arabic letters). */
export const safeName = (s, fallback = 'untitled') => (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback);

export function fmtSize(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; let v = n;
  do { v /= 1024; i += 1; } while (v >= 1024 && i < u.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
