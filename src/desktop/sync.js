import { useEffect, useMemo, useRef, useState } from 'react';
import { desktopApi, readLockCache, writeLockCache } from './desktopApi';
import { migratePrefs } from './prefs';

/**
 * Desktop settings that follow the student to every device — stored on the SERVER (table `desktop_settings`,
 * see DesktopSettingsApiController), not in this browser:
 *   wallpaper (ready-made or the student's own picture), accent, icon size, taskbar, where every icon sits,
 *   light/dark mode, language — and whether a lock password is set.
 * localStorage stays as the instant, offline cache. Newest `updatedAt` wins. A device pushes ~1 s after a change
 * (and immediately when the tab is hidden / closed — phones kill background tabs) and pulls when the window
 * regains focus and every 45 s.
 */

// Legacy hidden files of the old drive-based sync: still hidden from the desktop / My PC listings.
export const SETTINGS_NAME = '.uip-desktop.json';
export const WALLPAPER_NAME = '.uip-desktop-wallpaper.json';
const SYSTEM = /^\.uip-(desktop(-wallpaper)?|account)( \(\d+\))?\.json$/;
export const isSystemNode = (n) => n?.type === 'file' && SYSTEM.test(n.name || '');

const metaKey = (uid) => `uip_desktop_sync_v2_${uid ?? 'anon'}`;
const readMeta = (uid) => { try { const m = JSON.parse(localStorage.getItem(metaKey(uid)) || '{}'); return { updatedAt: Number(m.updatedAt) || 0, wp: String(m.wp || '') }; } catch { return { updatedAt: 0, wp: '' }; } };
const writeMeta = (uid, patch) => { try { localStorage.setItem(metaKey(uid), JSON.stringify({ ...readMeta(uid), ...patch })); } catch { /* private mode */ } };

export function hashStr(s) {
  if (!s) return '';
  let h = 5381;
  const step = Math.max(1, Math.floor(s.length / 4096));
  for (let i = 0; i < s.length; i += step) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}
const sigOf = (st, wp) => JSON.stringify({ p: { ...st.prefs, customWallpaper: undefined }, wp, i: st.icons, m: st.mode, l: st.locale });

/**
 * @param state  { prefs, icons, mode, locale } — what is synced
 * @param apply  ({ prefs, icons, mode, locale }) => void — adopt settings that came from another device
 * @returns { synced, lockEnabled, setLockEnabled }  synced = first pull/push finished; lockEnabled = null until known
 */
export function useDesktopSync({ uid, state, apply }) {
  const [synced, setSynced] = useState(false);
  const [lockEnabled, setLockState] = useState(() => readLockCache(uid));
  const R = useRef({});
  R.current = { uid, state, apply };
  const lastSig = useRef(null);
  const lastWpData = useRef(null); // the custom picture the server is known to hold
  const timer = useRef(null);
  const busy = useRef(false); const pending = useRef(false); const pulling = useRef(false);

  const setLockEnabled = useMemo(() => (on) => { setLockState(!!on); writeLockCache(R.current.uid, !!on); }, []);

  const wp = useMemo(() => hashStr(state.prefs.customWallpaper || ''), [state.prefs.customWallpaper]);
  const sig = useMemo(() => sigOf(state, wp), [state, wp]);
  const sigRef = useRef(sig); sigRef.current = sig;

  const uploadWallpaper = async () => {
    const data = R.current.state.prefs.customWallpaper;
    if (!data) {
      // the picture was removed on this device: delete it on the server too, otherwise the next pull (or another device) would bring it back
      if (lastWpData.current) { await desktopApi.saveWallpaper(null); lastWpData.current = null; writeMeta(R.current.uid, { wp: '' }); }
      return;
    }
    if (data === lastWpData.current) return;
    const r = await desktopApi.saveWallpaper(data);
    lastWpData.current = data;
    writeMeta(R.current.uid, { wp: r?.wp || '' });
  };

  /** Adopt what the server holds (it is newer than this device). */
  const adopt = async (remote) => {
    const cur = R.current.state;
    let customWallpaper = cur.prefs.customWallpaper || null;
    const meta = readMeta(R.current.uid);
    if (remote.wp && remote.wp !== meta.wp) {
      try {
        const w = await desktopApi.wallpaper();
        if (w?.dataUrl) { customWallpaper = w.dataUrl; lastWpData.current = w.dataUrl; writeMeta(R.current.uid, { wp: w.wp || remote.wp }); }
      } catch { /* keep what we have; retried on the next pull */ return false; }
    } else if (remote.wp && remote.wp === meta.wp && customWallpaper) {
      lastWpData.current = customWallpaper;
    } else if (!remote.wp && meta.wp && customWallpaper) {
      // it was deleted on another device
      customWallpaper = null; lastWpData.current = null; writeMeta(R.current.uid, { wp: '' });
    }
    const next = {
      prefs: migratePrefs({ ...cur.prefs, ...(remote.prefs || {}), customWallpaper }),
      icons: remote.icons && typeof remote.icons === 'object' ? remote.icons : cur.icons,
      mode: remote.mode || cur.mode,
      locale: remote.locale || cur.locale,
    };
    if (next.prefs.wallpaper === 'custom' && !customWallpaper) next.prefs.wallpaper = cur.prefs.wallpaper === 'custom' ? 'aurora' : cur.prefs.wallpaper;
    lastSig.current = sigOf(next, hashStr(customWallpaper || ''));
    writeMeta(R.current.uid, { updatedAt: Number(remote.updatedAt) || 0 });
    R.current.apply(next);
    return true;
  };

  const push = async () => {
    if (busy.current) { pending.current = true; return; }
    busy.current = true; pending.current = false;
    const mySig = sigRef.current;
    try {
      await uploadWallpaper();
      const { uid: u, state: st } = R.current;
      const meta = readMeta(u);
      const res = await desktopApi.saveSettings({
        updatedAt: meta.updatedAt || Date.now(),
        prefs: { ...st.prefs, customWallpaper: undefined }, icons: st.icons, mode: st.mode, locale: st.locale,
      });
      if (res?.stale) { await adopt(res); pending.current = false; } // another device changed things after us
      else if (sigRef.current === mySig) pending.current = false;
      if (typeof res?.lockEnabled === 'boolean') setLockEnabled(res.lockEnabled);
    } catch (e) { pending.current = true; try { console.warn('[desktop-sync] push failed, will retry:', e?.status || '', e?.message || e); } catch { /* ignore */ } } // offline / server hiccup: retried by the 30 s timer below
    finally { busy.current = false; }
    if (pending.current && sigRef.current !== mySig) { clearTimeout(timer.current); timer.current = setTimeout(push, 600); }
  };
  const pushRef = useRef(push); pushRef.current = push;

  const pull = async (first) => {
    if (pulling.current) return;
    pulling.current = true;
    try {
      const remote = await desktopApi.settings();
      if (typeof remote?.lockEnabled === 'boolean') setLockEnabled(remote.lockEnabled);
      const meta = readMeta(R.current.uid);
      const lacksPicture = !!remote?.wp && remote.wp !== meta.wp && remote.prefs?.wallpaper === 'custom' && !R.current.state.prefs.customWallpaper;
      if (remote?.exists && (Number(remote.updatedAt) > meta.updatedAt || lacksPicture) && !pending.current) {
        await adopt(remote);
      } else if (first) {
        if (!remote?.exists || meta.updatedAt > Number(remote.updatedAt || 0)) { if (!meta.updatedAt) writeMeta(R.current.uid, { updatedAt: Date.now() }); await pushRef.current(); }
        else { try { await uploadWallpaper(); } catch { /* retried on the next change */ } }
        lastSig.current = sigRef.current;
      }
      if (first) setSynced(true);
    } catch (e) { try { console.warn('[desktop-sync] pull failed:', e?.status || '', e?.message || e); } catch { /* ignore */ } } finally { pulling.current = false; } // offline / not ready: the next focus / timer tick tries again
  };
  const pullRef = useRef(pull); pullRef.current = pull;

  // 1) first contact: take the newest of (this device, the server)
  useEffect(() => {
    if (uid == null || synced) return undefined;
    pullRef.current(true);
    const h = setInterval(() => pullRef.current(true), 5000); // still offline? keep trying
    return () => clearInterval(h);
  }, [uid, synced]);

  // 2) a change made on this device -> push shortly after
  useEffect(() => {
    if (!synced || sig === lastSig.current) return undefined;
    lastSig.current = sig;
    writeMeta(uid, { updatedAt: Date.now() }); pending.current = true;
    clearTimeout(timer.current); timer.current = setTimeout(() => pushRef.current(), 1000);
    return undefined;
  }, [sig, synced, uid]);

  // 3) pull when the tab / window comes back and every 45 s; retry unsent changes; flush when the tab is hidden or closed
  useEffect(() => {
    if (!synced) return undefined;
    const flush = () => { if (pending.current) { clearTimeout(timer.current); pushRef.current(); } };
    let lastBack = 0; // focus + visibilitychange both fire when the tab returns: pull once, and not more than every 20 s
    const back = () => { if (document.visibilityState === 'visible') { if (Date.now() - lastBack < 20000) return; lastBack = Date.now(); pullRef.current(false); } else flush(); };
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back); window.addEventListener('pagehide', flush);
    const tick = setInterval(() => { if (document.visibilityState !== 'visible') return; if (pending.current && !busy.current) pushRef.current(); else pullRef.current(false); }, 45000);
    const retry = setInterval(() => { if (pending.current && !busy.current) pushRef.current(); }, 30000);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); window.removeEventListener('pagehide', flush); clearInterval(tick); clearInterval(retry); clearTimeout(timer.current); };
  }, [synced]);

  return { synced, lockEnabled, setLockEnabled };
}
