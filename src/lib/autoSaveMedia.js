/**
 * WhatsApp-style auto-save of chat media inside the Android app.
 * Every attachment (photo / video / file / audio) of a message the OTHER person sent is saved to the phone into
 * Pictures / Movies / Music / Documents  >  "UIPE", once. Does nothing in a normal browser.
 *
 *  - only messages that arrived AFTER the feature was first used are saved, so opening an old chat never
 *    dumps its whole history onto the phone;
 *  - each attachment id is remembered (localStorage) so it is never saved twice;
 *  - recorded voice notes are skipped (they would only clutter the Music folder);
 *  - a failed save (offline, storage permission still pending...) is not remembered, so the next time the chat
 *    shows that message it tries again;
 *  - the person can turn it off from the chat details panel.
 */
import { isNative, nativeSaveUrl, showToast } from '../native';
import { resolveMediaUrl, isProtectedAttachmentUrl, loadAttachmentBlob } from './chatMedia';
import { parseServerDate } from '../utils/serverDate';

const PREF_KEY = 'uip_autosave_media';       // '0' = off, anything else = on
const SINCE_KEY = 'uip_autosave_since';       // ms timestamp: first time the feature ran on this phone
const DONE_KEY = 'uip_autosaved_ids';         // [attachment ids]
const DONE_MAX = 3000;
const CONCURRENCY = 2;

export const autoSaveAvailable = () => isNative;

export function isAutoSaveOn() {
  try { return localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
}
export function setAutoSaveOn(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
    // turning it back on must not pull in everything that arrived while it was off
    if (on) localStorage.setItem(SINCE_KEY, String(Date.now()));
  } catch { /* not remembered */ }
}

function since() {
  try {
    let v = Number(localStorage.getItem(SINCE_KEY));
    if (!v) { v = Date.now(); localStorage.setItem(SINCE_KEY, String(v)); }
    return v;
  } catch { return Date.now(); }
}

let done = null;
function doneSet() {
  if (done) return done;
  try { done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]').map(String)); } catch { done = new Set(); }
  return done;
}
function remember(id) {
  const set = doneSet();
  set.add(String(id));
  try { localStorage.setItem(DONE_KEY, JSON.stringify(Array.from(set).slice(-DONE_MAX))); } catch { /* not remembered */ }
}

const queue = [];
const queued = new Set();
let running = 0;

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running += 1;
    resolveMediaUrl(job.args.url)
      .then((url) => nativeSaveUrl({ ...job.args, url }))
      .then(() => remember(job.id))
      .catch(() => { /* try again next time the message is shown */ })
      .finally(() => { running -= 1; queued.delete(job.id); pump(); });
  }
}

/** Pass any list of messages (initial load or new poll results); it picks the ones worth saving. */
export function autoSaveMessages(messages) {
  if (!isNative || !isAutoSaveOn() || !Array.isArray(messages)) return;
  const from = since();
  const set = doneSet();
  messages.forEach((m) => {
    if (!m || m.is_mine || m.is_deleted || String(m.id).startsWith('tmp-')) return;
    const at = m.created_at ? parseServerDate(m.created_at).getTime() : 0;
    if (!at || at < from) return;
    (m.attachments || []).forEach((a) => {
      if (!a || !a.url || a.local) return;
      const id = String(a.id ?? a.url);
      if (set.has(id) || queued.has(id)) return;
      if (a.kind === 'audio' && /^voice-message-/i.test(a.original_name || '')) return;
      queued.add(id);
      queue.push({
        id,
        args: { url: a.url, filename: a.original_name || `UIPE-${id}`, mimeType: a.mime_type, kind: a.kind },
      });
    });
  });
  pump();
}

/* ------------------------------------------------------------------ manual "Save to phone" */
const isAr = () => { try { return document.documentElement.lang === 'ar' || localStorage.getItem('uip_locale') === 'ar'; } catch { return false; } };

async function webDownload(url, name) {
  try {
    const blob = await loadAttachmentBlob(url);
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name || 'file';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  } catch (e) {
    if (isProtectedAttachmentUrl(url)) throw e; // a private file cannot be opened without the token: report the failure
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * "Save to phone" from the message action bar (long press on a photo / video / file / voice note / audio).
 * In the app it goes to Pictures / Movies / Music / Documents > UIPE; in a browser it is a normal download.
 * Always saves, even if auto-save already did (the person asked for it).
 */
export async function saveAttachmentsToPhone(attachments) {
  const list = (attachments || []).filter((a) => a && a.url && !a.local);
  if (!list.length) return;
  const ar = isAr();
  let ok = 0;
  let permission = false;
  for (const a of list) {
    try {
      const url = a.url;
      if (isNative) {
        const signed = await resolveMediaUrl(url);
        await nativeSaveUrl({ url: signed, filename: a.original_name || `UIPE-${a.id ?? Date.now()}`, mimeType: a.mime_type, kind: a.kind });
        remember(String(a.id ?? a.url));
      } else {
        await webDownload(url, a.original_name);
      }
      ok += 1;
    } catch (e) {
      if (String(e?.message || e).includes('no_permission')) permission = true;
    }
  }
  if (permission) showToast(ar ? 'اسمح للتطبيق بالوصول للتخزين ثم جرّب تاني' : 'Allow storage access for the app, then try again');
  else if (!ok) showToast(ar ? 'تعذّر الحفظ، جرّب تاني' : 'Could not save, please try again');
  else if (isNative) showToast(ar ? `تم الحفظ في مجلد UIPE${ok > 1 ? ` (${ok} ملفات)` : ''}` : `Saved to the UIPE folder${ok > 1 ? ` (${ok} files)` : ''}`);
}
