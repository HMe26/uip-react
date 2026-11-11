import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { drive, fetchDriveBlob } from './driveApi';
import { hasMyPc } from '../config/myPc';

/**
 * Per-account UI settings that follow the student to every device.
 *
 * Everything the app used to remember only in this browser (chat wallpaper, AI-assistant wallpaper, code-editor theme,
 * My PC view, sounds, motion…) is mirrored to ONE hidden file in the student's Desktop folder (My PC drive, so no backend
 * change): `.uip-account.json` = { v, updatedAt, data: { <localStorage key>: <string> } }.
 * (Theme / language already follow the account through the settings API; desktop wallpaper, accent and icon positions
 *  have their own file, see desktop/sync.js.)
 *
 * Only the keys in SYNCED_KEYS are ever read or written — never tokens or anything device-specific.
 * localStorage stays the instant cache. Newest `updatedAt` wins; the first time a device meets an existing file the two
 * sets are merged (remote wins on a clash) so nothing set only on this device is lost.
 * After a remote change is applied a `uip-account-settings` event is fired on `window`.
 */
export const ACCOUNT_FILE = '.uip-account.json';
export const SYNCED_KEYS = [
  'uip_msg_wallpaper', 'uip_msg_wallpaper_anim', 'uip_msg_style',       // chat background + bubble style
  'uip_ai_wallpaper', 'uip_ai_history_hidden',                          // AI assistant
  'zb-theme',                                                           // code editor theme
  'mp-view',                                                            // My PC: grid / list
  'uip_sound_enabled', 'uip_motion',                                    // sounds, reduced motion
];
const MAX_VALUE = 2000;

const metaKey = (uid) => `uip_account_sync_v1_${uid}`;
const readMeta = (uid) => { try { return Number(localStorage.getItem(metaKey(uid))) || 0; } catch { return 0; } };
const writeMeta = (uid, v) => { try { localStorage.setItem(metaKey(uid), String(v)); } catch { /* private mode */ } };
const unwrap = (r) => (r && r.data !== undefined ? r.data : r);
const tok = (n) => `${n?.id}:${n?.updated_at || ''}:${n?.size_bytes ?? ''}`;

export function readLocal() {
  const o = {};
  SYNCED_KEYS.forEach((k) => {
    try { const v = localStorage.getItem(k); if (v !== null && v.length <= MAX_VALUE) o[k] = v; } catch { /* ignore */ }
  });
  return o;
}
const sigOf = (o) => JSON.stringify(SYNCED_KEYS.map((k) => (o[k] === undefined ? null : o[k])));

/** Write `data` into localStorage (keys missing from it are removed). Returns true when something changed. */
function applyLocal(data) {
  let changed = false;
  SYNCED_KEYS.forEach((k) => {
    const want = Object.prototype.hasOwnProperty.call(data, k) && data[k] != null ? String(data[k]).slice(0, MAX_VALUE) : null;
    try {
      if (localStorage.getItem(k) === want) return;
      if (want === null) localStorage.removeItem(k); else localStorage.setItem(k, want);
      changed = true;
    } catch { /* ignore */ }
  });
  return changed;
}

async function findDesktop() {
  const root = await drive.list(null);
  let f = (unwrap(root).items || []).find((n) => n.type === 'folder' && n.name === 'Desktop');
  if (!f) f = unwrap(await drive.createFolder(null, 'Desktop'));
  return f.id;
}

function createEngine(uid) {
  let stopped = false; let busy = false; let again = false; let timer = null;
  let deskId = null; let fileId = null; let token = ''; let lastSig = null;
  let dirtyAt = 0; // when this device first changed something that is not pushed yet

  const push = async (data) => {
    const body = JSON.stringify({ v: 1, updatedAt: readMeta(uid) || Date.now(), data });
    const blob = new Blob([body], { type: 'application/json' });
    let node;
    if (fileId) node = unwrap(await drive.replace(fileId, blob, ACCOUNT_FILE, { silent: true }));
    else node = unwrap(await drive.createFile(deskId, ACCOUNT_FILE, body));
    fileId = node?.id ?? fileId; token = tok(node?.id ? node : { id: fileId });
  };

  const run = async () => {
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true; again = false;
    try {
      if (!deskId) deskId = await findDesktop();
      const listing = unwrap(await drive.list(deskId));
      const node = (listing.items || []).find((n) => n.type === 'file' && n.name === ACCOUNT_FILE) || null;
      fileId = node?.id ?? null;
      let local = readLocal();
      let remoteData; // undefined = not fetched / unusable
      if (node && (tok(node) !== token || lastSig === null)) {
        let remote = null;
        try { remote = JSON.parse(await (await fetchDriveBlob(node.id)).text()); } catch { remote = null; }
        token = tok(node);
        if (remote && remote.v === 1 && remote.data && typeof remote.data === 'object') {
          remoteData = remote.data;
          const at = Number(remote.updatedAt) || 0;
          const meta = readMeta(uid);
          if (meta === 0 || (at > meta && !(dirtyAt > at))) { // a newer local change is not overwritten by an older remote one
            // first contact: merge (remote wins on a clash, local-only keys are kept); later: the newer remote wins
            const changed = applyLocal(meta === 0 ? { ...local, ...remote.data } : remote.data);
            writeMeta(uid, at);
            if (changed) window.dispatchEvent(new Event('uip-account-settings'));
            local = readLocal();
            if (meta !== 0) lastSig = sigOf(local); // fully adopted -> nothing to push
          }
        }
      }
      // baseline for "did this device change something": the remote state, or empty when there is no usable file
      if (lastSig === null) lastSig = sigOf(remoteData ?? {});
      const sig = sigOf(local);
      if (sig !== lastSig) {
        writeMeta(uid, Date.now());
        await push(local);
        lastSig = sig; dirtyAt = 0;
      }
    } catch { /* offline / drive unavailable: retried on the next tick */ } finally {
      busy = false;
      if (again && !stopped) { clearTimeout(timer); timer = setTimeout(run, 800); }
    }
  };

  // a change made on this device (cheap localStorage compare; network only when something changed)
  const watch = () => {
    if (stopped || lastSig === null || busy) return;
    if (sigOf(readLocal()) !== lastSig) { if (!dirtyAt) dirtyAt = Date.now(); run(); }
  };

  let lastBack = 0; // focus + visibilitychange both fire when the tab returns: sync once, not more than every 20 s
  const back = () => { if (document.visibilityState !== 'visible' || Date.now() - lastBack < 20000) return; lastBack = Date.now(); run(); };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
  window.addEventListener('pagehide', watch);
  const w = setInterval(watch, 2500);
  const p = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 180000); // lists the whole Desktop folder: every 3 min, visible tab only
  run();
  return () => {
    stopped = true; clearTimeout(timer); clearInterval(w); clearInterval(p);
    document.removeEventListener('visibilitychange', back);
    window.removeEventListener('focus', back);
    window.removeEventListener('pagehide', watch);
  };
}

/** Mount once inside <AuthProvider>; renders nothing. Every role that owns a My PC drive (all portals). */
export default function AccountSettingsSync() {
  const { user } = useAuth();
  const uid = hasMyPc(user?.role) ? user.id : null;
  useEffect(() => (uid ? createEngine(uid) : undefined), [uid]);
  return null;
}
