import { useSyncExternalStore } from 'react';
import { DRIVE_SAVED } from './driveEvents';

/**
 * Save Center — one place that tells the student what is saved, what is not, and WHERE.
 *
 *  - Editors report their unsaved state (lib/useAutoDraft.jsx → report()), together with a save() they can run.
 *  - Closing / leaving a document with unsaved changes opens a "Save changes?" dialog (askUnsaved) that names the final
 *    location (My PC) and the backup (Google Drive / OneDrive) instead of a bare browser confirm().
 *  - Every successful write to My PC (lib/driveEvents.js) raises a "Saved" toast with the same two lines + live backup progress.
 *  - Forgotten changes: after `remindAfter` seconds a reminder with a "Save now" button appears (or, in "auto" mode, the
 *    document is saved for the student). Local drafts (IndexedDB) keep protecting the work either way.
 */
const SETTINGS_KEY = 'uip_savecenter_v1';
const DEFAULTS = { mode: 'ask', remindAfter: 120 }; // mode: 'ask' | 'auto' | 'off'

const loadSettings = () => { try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; } catch { return { ...DEFAULTS }; } };

const docs = new Map(); // key → { key, name, dirty, since, save, where, remindedAt }
let settings = loadSettings();
let toasts = [];
let modal = null; // { id, key, name, where, saving, error, resolve }
let cloudDialog = false;
let seq = 0;
let snap = null;
const subs = new Set();
const emit = () => { snap = null; subs.forEach((f) => f()); };
const dirtyCount = () => [...docs.values()].filter((d) => d.dirty).length;

/** 'mypc' = the student's own file in My PC (server copy + cloud backup) · 'project' = a shared project file · 'other' */
const whereOf = (key) => (/^ed:[^:]*:drive:/.test(key) || /^zip:[^:]*:(folder|text):/.test(key) ? 'mypc' : /^ed:/.test(key) ? 'project' : 'other');

function pushToast(t) {
  const id = `t${(seq += 1)}`;
  toasts = [...toasts.filter((x) => !(t.group && x.group === t.group)), { id, at: Date.now(), ...t }].slice(-4);
  emit();
  if (t.ttl) setTimeout(() => saveCenter.dismiss(id), t.ttl);
  return id;
}

export const saveCenter = {
  /** An editor tells us about its state. Call with dirty:false (or release) when saved / closed. */
  report(key, { dirty, name, save }) {
    if (!key) return;
    const prev = docs.get(key);
    if (!dirty && !prev) return;
    docs.set(key, {
      key, where: whereOf(key), name: name || prev?.name || '', dirty: !!dirty,
      since: dirty ? (prev?.dirty ? prev.since : Date.now()) : 0, save: save || prev?.save, remindedAt: dirty ? prev?.remindedAt || 0 : 0,
    });
    if (!dirty) { toasts = toasts.filter((t) => !(t.kind === 'remind' && t.key === key)); }
    emit();
  },
  release(key) { if (docs.delete(key)) emit(); },
  doc: (key) => docs.get(key),

  setSettings(patch) { settings = { ...settings, ...patch }; try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } emit(); },

  dismiss(id) { const n = toasts.length; toasts = toasts.filter((t) => t.id !== id); if (toasts.length !== n) emit(); },
  toast: pushToast,

  /** Runs the document's own save(); resolves true when it is saved. */
  async saveDoc(key) {
    const d = docs.get(key);
    if (!d?.save) return false;
    try { return (await d.save()) !== false; } catch { return false; }
  },

  /** The "Save changes?" dialog. Resolves true = OK to leave (saved or discarded) · false = stay. */
  askUnsaved({ key, name, tt, discard }) {
    const d = docs.get(key);
    if (!d?.save) return Promise.resolve(window.confirm(tt('Discard your unsaved changes?', 'تتجاهل التعديلات اللي لسه ما اتحفظتش؟')) && (discard?.(), true));
    if (modal) return Promise.resolve(false);
    return new Promise((resolve) => {
      modal = { id: `m${(seq += 1)}`, key, where: d.where, name: name || d.name, saving: false, error: '', resolve: (ok) => { modal = null; if (ok) discard?.(); emit(); resolve(ok); } };
      emit();
    });
  },
  modalSave() {
    if (!modal || modal.saving) return;
    const m = modal; m.saving = true; m.error = ''; emit();
    saveCenter.saveDoc(m.key).then((ok) => {
      if (ok) { m.resolve(true); return; }
      m.saving = false; m.error = 'failed'; emit();
    });
  },
  modalDiscard() { modal?.resolve(true); },
  modalCancel() { if (modal && !modal.saving) modal.resolve(false); },

  /** Ask the desktop to open Settings ▸ Storage & backup; when there is no desktop, show the same panel in a dialog. */
  openCloudSettings() {
    const ev = new CustomEvent('uip-open-cloud-settings', { detail: { handled: false } });
    window.dispatchEvent(ev);
    if (!ev.detail.handled) { cloudDialog = true; emit(); }
  },
  closeCloudDialog() { cloudDialog = false; emit(); },
};

/** A guard answers true / false, or a Promise<boolean> (the "Save changes?" dialog). Runs fn() unless the answer is "stay". */
export function afterGuard(result, fn) {
  if (result && typeof result.then === 'function') { result.then((ok) => { if (ok !== false) fn(); }); return; }
  if (result !== false) fn();
}
export const askUnsaved = (o) => saveCenter.askUnsaved(o);

// "Saved" toast after every My PC write (uploads only back up; they are not "saves" the student is waiting on)
if (typeof window !== 'undefined') {
  window.addEventListener(DRIVE_SAVED, (e) => {
    const d = e.detail || {};
    if (d.silent || d.kind === 'upload') return;
    pushToast({ kind: 'saved', group: 'saved', name: d.name || '', ttl: 9000 });
  });
  // reminders / auto-save for forgotten changes
  setInterval(() => {
    if (settings.mode === 'off' || modal) return;
    const now = Date.now();
    docs.forEach((d) => {
      if (!d.dirty || !d.save || d.saving) return;
      const quiet = now - d.since;
      if (quiet < settings.remindAfter * 1000) return;
      if (now - d.remindedAt < settings.remindAfter * 1000) return;
      d.remindedAt = now;
      if (settings.mode === 'auto') {
        d.saving = true;
        Promise.resolve().then(() => d.save()).finally(() => { d.saving = false; });
      } else pushToast({ kind: 'remind', key: d.key, group: `remind:${d.key}`, name: d.name, where: d.where });
    });
  }, 15000);
}

const snapshot = () => {
  if (!snap) snap = { dirtyCount: dirtyCount(), toasts, modal, settings, cloudDialog };
  return snap;
};
export function useSaveCenter() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, snapshot, snapshot);
}
