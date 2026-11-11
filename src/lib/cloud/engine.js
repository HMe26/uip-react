import { useSyncExternalStore } from 'react';
import { isNative } from '../../native';
import { drive, driveConfig, fetchDriveBlob } from '../driveApi';
import { DRIVE_SAVED } from '../driveEvents';
import { CloudAuthError, CloudQuotaError, CloudRetryError } from './errors';
import { BACKUP_LAYOUT, categoryOf } from './categories';
import { google } from './google';
import { microsoft } from './microsoft';

/**
 * Cloud backup engine (Google Drive / OneDrive). Google Drive and OneDrive can both be linked at once.
 *
 *  - "My PC" on the UIPE server stays the FINAL copy (sharing, exams, the sandbox and the AI all read it).
 *  - This engine keeps a BACKUP copy on the student's own cloud drive, in a folder "UIP-NUB", sorted into one sub-folder per kind of file (Code, Documents, Images …).
 *  - It runs in the browser (tokens never reach the server; they live in sessionStorage) and is incremental: a file is uploaded
 *    again only when its signature (name / folder / sha1 / size / updated_at) changed. Deleted files are NOT removed from the
 *    cloud (a backup keeps them).
 *  - Triggers: a save in My PC (debounced), every 10 minutes while the tab is visible, coming back online, "Back up now".
 */
const PROVIDERS = { google, microsoft };
const SKIP_NAMES = new Set(['.uip-account.json']); // the settings-sync file is not student work
const EVERY_MS = 10 * 60 * 1000;
const PARALLEL = 2;

const dbKey = (uid) => `uip_cloud_v1:${uid}`;
const tokKey = (uid, id) => `uip_cloud_tok:${uid}:${id}`;
const readJson = (store, key) => { try { return JSON.parse(store.getItem(key) || 'null'); } catch { return null; } };
const writeJson = (store, key, v) => { try { if (v == null) store.removeItem(key); else store.setItem(key, JSON.stringify(v)); } catch { /* storage full / blocked */ } };

const S = {
  uid: null, cfg: null, ready: false, auto: true,
  // one entry per linked cloud — Google Drive and OneDrive can both be linked at the same time
  // link = { account, server, lastOk, lastError, retried, forceTok, status, progress, db: { rootId, folders, files } }
  links: {},
  lastError: '', status: 'idle', progress: { done: 0, total: 0 },
};
const newDb = () => ({ rootId: null, folders: {}, files: {} });
const linkIds = () => Object.keys(S.links).filter((id) => PROVIDERS[id]);
let snap = null;
const subs = new Set();
const emit = () => { snap = null; subs.forEach((f) => f()); };
const persist = () => writeJson(localStorage, dbKey(S.uid), {
  v: 2, auto: S.auto, layout: BACKUP_LAYOUT,
  links: Object.fromEntries(linkIds().map((id) => { const l = S.links[id]; return [id, { account: l.account, picture: l.picture, server: l.server, lastOk: l.lastOk, db: l.db }]; })),
});
/** One status for the whole backup: the most urgent state of any linked cloud. */
function aggregate() {
  const ls = linkIds().map((id) => S.links[id]);
  const pick = (st) => ls.find((l) => l.status === st);
  const st = ['running', 'needs-auth', 'error', 'offline'].find((x) => pick(x)) || 'idle';
  const bad = pick('needs-auth') || pick('error');
  return { status: st, lastError: bad?.lastError || '', progress: { done: ls.reduce((n, l) => n + (l.progress?.done || 0), 0), total: ls.reduce((n, l) => n + (l.progress?.total || 0), 0) } };
}
const snapshot = () => {
  if (!snap) {
    const ids = linkIds();
    const ag = aggregate();
    const oks = ids.map((id) => S.links[id].lastOk || 0);
    snap = {
      ready: S.ready, provider: ids[0] || '', providers: ids, auto: S.auto, account: ids[0] ? S.links[ids[0]].account : '',
      links: Object.fromEntries(ids.map((id) => { const l = S.links[id]; return [id, { account: l.account, picture: l.picture || '', lastOk: l.lastOk, status: l.status, lastError: l.lastError, progress: l.progress }]; })),
      lastOk: oks.length ? Math.min(...oks) : 0, lastError: ag.lastError, status: ag.status, progress: ag.progress, cfg: S.cfg,
    };
  }
  return snap;
};

let timer = 0; let again = false; let running = false; let inited = false;

function setLink(id, status, extra) { const l = S.links[id]; if (!l) return; l.status = status; Object.assign(l, extra || {}); emit(); }

async function getToken(id) {
  const P = PROVIDERS[id]; const l = S.links[id];
  const sess = readJson(sessionStorage, tokKey(S.uid, id));
  if (!l.forceTok && sess?.tok && sess.tok.expiresAt > Date.now()) return sess.tok;
  const force = l.forceTok; l.forceTok = false;
  const r = await P.refresh(S.cfg[id], id === 'google' ? l.account : sess?.refreshToken, { server: l.server, force });
  const tok = r.tok || r;
  writeJson(sessionStorage, tokKey(S.uid, id), { tok, refreshToken: r.refreshToken || sess?.refreshToken || null });
  return tok;
}

/** Backs the manifest up to ONE linked cloud. Failures of one cloud never stop the other. */
async function runOne(id, items) {
  const P = PROVIDERS[id]; const l = S.links[id];
  let fatal = null; let done = 0; let failed = 0; let locked = 0; let firstErr = '';
  try {
    setLink(id, 'running', { progress: { done: 0, total: 0 }, lastError: '' });
    const tok = await getToken(id);
    // files from different My PC folders now share one kind-folder: a repeated name gets " (2)", " (3)" … so nothing is overwritten
    const cloudName = new Map();
    { const seen = new Map();
      [...items].filter((n) => n.type === 'file').sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })).forEach((n) => {
        const key = `${categoryOf(n.name)}/${n.name.toLowerCase()}`;
        const k = (seen.get(key) || 0) + 1; seen.set(key, k);
        cloudName.set(n.id, k === 1 ? n.name : n.name.replace(/(\.[^.\/]+)?$/, ` (${k})$1`));
      }); }
    const sigOf = (n) => `${cloudName.get(n.id) || n.name}|${categoryOf(n.name)}|${n.sha1 || ''}|${n.size_bytes}|${n.updated_at || ''}`;
    const todo = items.filter((n) => n.type === 'file' && !SKIP_NAMES.has(n.name) && l.db.files[n.id]?.sig !== sigOf(n));
    l.progress = { done: 0, total: todo.length }; emit();

    const rootRemote = todo.length ? await P.ensureRoot(tok, l.db) : null;
    // one sub-folder per kind of file ("Code", "Documents", "Images" …) directly under the backup root — not a copy of the My PC tree
    // (memoised per run: the two upload workers must not both create the same kind-folder)
    const folderOnce = new Map();
    const remoteFolder = (node) => {
      const kind = categoryOf(node.name);
      if (!folderOnce.has(kind)) folderOnce.set(kind, P.ensureFolder(tok, l.db, `kind:${kind}`, kind, rootRemote).catch((e) => { folderOnce.delete(kind); throw e; }));
      return folderOnce.get(kind);
    };

    let next = 0;
    const worker = async () => {
      while (next < todo.length && !fatal) {
        const n = todo[next]; next += 1;
        try {
          const blob = await fetchDriveBlob(n.id);
          const parentRemote = await remoteFolder(n);
          const prev = l.db.files[n.id];
          const sameFolder = prev && prev.parent === parentRemote;
          const remoteId = await P.put(tok, { remoteId: sameFolder ? prev.remoteId : null, name: cloudName.get(n.id) || n.name, parentRemoteId: parentRemote, blob });
          l.db.files[n.id] = { sig: sigOf(n), remoteId, parent: parentRemote };
          done += 1;
        } catch (e) {
          if (e instanceof CloudAuthError || e instanceof CloudQuotaError) { fatal = e; } else {
            failed += 1;
            if (e instanceof CloudRetryError && e.status === 409) locked += 1; // the cloud still holds an earlier, unfinished upload of this file
            if (!firstErr) firstErr = e?.message || '';
            if (e?.status === 404) { l.db.rootId = null; l.db.folders = {}; } // the cloud folder was deleted: rebuild it next time
          }
        }
        l.progress = { done: done + failed, total: todo.length }; emit();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    persist();
    if (fatal) throw fatal;
    if (failed && failed === locked) { setLink(id, 'error', { lastError: 'The cloud is still finishing an earlier upload of some files. Trying again in a few minutes.' }); schedule(3 * 60 * 1000); }
    else if (failed) setLink(id, 'error', { lastError: firstErr || 'Some files could not be copied. They will be tried again.' });
    else { l.lastOk = Date.now(); l.retried = false; persist(); setLink(id, 'idle', { lastError: '' }); }
  } catch (e) {
    if (e instanceof CloudAuthError && e.code === 'expired' && l.server && !l.retried) {
      l.retried = true; l.forceTok = true; again = true; // the provider refused our cached token: ask the server for a brand-new one and go again
      writeJson(sessionStorage, tokKey(S.uid, id), null);
    } else if (e instanceof CloudAuthError) { l.retried = false; setLink(id, 'needs-auth', { lastError: e.message }); }
    else if (e instanceof CloudQuotaError) setLink(id, 'error', { lastError: e.message });
    else if (e instanceof CloudRetryError && e.status === 0) setLink(id, 'offline');
    else setLink(id, 'error', { lastError: e?.message || 'Backup failed.' });
  }
}

async function run({ manual = false } = {}) {
  if (!S.uid || !linkIds().length || (!S.auto && !manual)) return;
  if (running) { again = true; return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { linkIds().forEach((id) => { S.links[id].status = 'offline'; }); emit(); return; }
  running = true; again = false;
  try {
    const items = (await drive.manifest()).items || [];
    // the clouds are independent: each one is tried even if another one needs a new sign-in or has an error
    for (const id of linkIds()) { if (S.links[id] && S.links[id].status !== 'needs-auth') await runOne(id, items); }
  } catch (e) {
    linkIds().forEach((id) => { S.links[id].status = e instanceof CloudRetryError && e.status === 0 ? 'offline' : 'error'; if (S.links[id].status === 'error') S.links[id].lastError = e?.message || 'Backup failed.'; });
    emit();
  } finally {
    running = false;
    if (again) schedule(2000);
  }
}

function schedule(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => run(), ms);
}

function installListeners() {
  if (inited) return;
  inited = true;
  window.addEventListener(DRIVE_SAVED, (e) => { if (!e.detail?.silent) schedule(4000); });
  window.addEventListener('online', () => schedule(1000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - S.lastOk > EVERY_MS) schedule(1500); });
  setInterval(() => { if (document.visibilityState === 'visible') run(); }, EVERY_MS);
}

export const cloud = {
  providers: PROVIDERS,

  /** Call once per signed-in student. Loads the server config + this student's saved links. */
  async init(uid) {
    if (!uid) return;
    if (S.uid === uid && S.ready) return;
    S.uid = uid; S.ready = false; S.links = {}; emit();
    const saved = readJson(localStorage, dbKey(uid));
    if (saved) {
      S.auto = saved.auto !== false;
      const fresh = saved.layout === BACKUP_LAYOUT;
      if (saved.links) Object.entries(saved.links).forEach(([id, l]) => { S.links[id] = { account: l.account || '', picture: l.picture, server: !!l.server, lastOk: l.lastOk || 0, db: fresh && l.db ? l.db : newDb() }; });
      else if (saved.provider) S.links[saved.provider] = { account: saved.account || '', server: !!saved.server, lastOk: saved.lastOk || 0, db: fresh && saved.db ? saved.db : newDb() }; // old single-cloud format
      Object.entries(S.links).forEach(([id, l]) => { Object.assign(l, { status: 'idle', lastError: '', retried: false, forceTok: false, progress: { done: 0, total: 0 } }); if (!PROVIDERS[id]) delete S.links[id]; });
    }
    const cfg = await driveConfig();
    S.cfg = cfg?.cloud || {};
    S.ready = true;
    installListeners();
    if (linkIds().length) schedule(3500);
    emit();
  },
  stop() { clearTimeout(timer); S.uid = null; S.ready = false; S.links = {}; emit(); },

  available(id) { return !isNative && !!PROVIDERS[id] && PROVIDERS[id].enabled(S.cfg?.[id]); }, // the Android app can't open the OAuth pop-ups yet

  /** From a click. Linking one cloud never unlinks the other. */
  async connect(id) {
    const P = PROVIDERS[id];
    if (!P || !this.available(id)) throw new Error('This cloud is not set up on the server yet.');
    const prev = S.links[id];
    const r = await P.connect(S.cfg[id], id === 'google' ? prev?.account : undefined);
    const account = r.account || '';
    const sameAccount = prev && prev.account === account;
    S.links[id] = { account, picture: sameAccount ? prev.picture : undefined, server: !!r.server, lastOk: sameAccount ? prev.lastOk : 0, db: sameAccount ? prev.db : newDb(), status: 'idle', lastError: '', retried: false, forceTok: false, progress: { done: 0, total: 0 } };
    S.auto = true;
    writeJson(sessionStorage, tokKey(S.uid, id), { tok: r.tok, refreshToken: r.refreshToken || null });
    persist(); emit();
    schedule(300);
    this.ensureAvatars();
  },
  /** Fetches the profile photo of every linked cloud that has not been looked up yet (best effort, never throws). */
  async ensureAvatars() {
    for (const id of linkIds()) {
      const l = S.links[id];
      if (l.picture !== undefined || !PROVIDERS[id].profile) continue;
      try {
        const tok = await getToken(id);
        const { picture } = await PROVIDERS[id].profile(tok);
        if (S.links[id] === l) { l.picture = picture || ''; persist(); emit(); }
      } catch { /* needs sign-in again, offline… — the letter avatar stays; tried again next time the panel opens */ }
    }
  },
  /** Unlink one cloud (id) — or all of them when no id is given. */
  disconnect(id) {
    (id ? [id] : linkIds()).forEach((x) => {
      if (x === 'google' && S.links[x]?.server) PROVIDERS.google.disconnectServer();
      delete S.links[x];
      writeJson(sessionStorage, tokKey(S.uid, x), null);
    });
    persist(); emit();
  },
  setAuto(on) { S.auto = !!on; persist(); emit(); if (on) schedule(500); },
  runNow() { clearTimeout(timer); return run({ manual: true }); },
};

export function useCloud() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, snapshot, snapshot);
}
