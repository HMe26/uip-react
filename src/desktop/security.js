import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopApi } from './desktopApi';
import { getIdleMs, getLastActivity, markActivity, setUserIdleMinutes } from '../api/client';

/**
 * Personal security of the desktop (Settings ▸ Security & devices). The server keeps the values
 * (desktop_settings.security, see DesktopSecurityService); this hook ENFORCES the on-device ones:
 *   auto-lock after N idle minutes · sleep after N idle minutes · lock when the tab is left · remote lock
 *   (another device pressed "Lock") · the "you will be signed out" countdown.
 * "Sign me out after N idle minutes" is enforced by AuthContext (api/client.js getIdleMs reads it) and by the server.
 */
export const SEC_DEFAULTS = {
  maxDevices: 0, deviceOverflow: 'replace_oldest',
  autoLockMinutes: 0, sleepMinutes: 0, lockOnHide: -1,
  lockOnStart: true, lockAfterSleep: true, autoLogoutMinutes: 0,
  alertNewDevice: true, hideLockDetails: false, sleepDimOnly: false,
};
export const OPT = {
  autoLock: [0, 1, 2, 3, 5, 10, 15, 30, 60],
  sleep: [0, 2, 5, 10, 15, 30, 60],
  autoLogout: [0, 15, 30, 60, 120, 240, 480, 1440, 4320, 10080],
  lockOnHide: [-1, 0, 1, 5, 15],
  maxDevices: [0, 1, 2, 3, 4, 5, 10],
};

const key = (uid) => `uip_desktop_sec_v1_${uid ?? 'anon'}`;
export function readSec(uid) {
  try { return { ...SEC_DEFAULTS, ...(JSON.parse(localStorage.getItem(key(uid)) || '{}') || {}) }; } catch { return { ...SEC_DEFAULTS }; }
}
function writeSec(uid, s) { try { localStorage.setItem(key(uid), JSON.stringify(s)); } catch { /* private mode */ } }

/** "5 min", "2 h", "3 d" — for the option lists. */
export function minLabel(m, tt) {
  if (m >= 1440 && m % 1440 === 0) { const d = m / 1440; return tt(`${d} ${d === 1 ? 'day' : 'days'}`, d === 1 ? 'يوم' : d === 2 ? 'يومين' : `${d} أيام`); }
  if (m >= 60 && m % 60 === 0) { const h = m / 60; return tt(`${h} ${h === 1 ? 'hour' : 'hours'}`, h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`); }
  return tt(`${m} min`, m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? `${m} دقايق` : `${m} دقيقة`);
}

const WARN_SECONDS = 60;

/**
 * @param uid        account id (settings are cached per account)
 * @param locked     is the lock screen up right now
 * @param onLock     (reason) => void — lock the desktop ('auto' | 'hide' | 'remote')
 */
export function useDesktopSecurity({ uid, locked, onLock }) {
  const [sec, setSecState] = useState(() => readSec(uid));
  const [asleep, setAsleep] = useState(false);
  const [idleLeft, setIdleLeft] = useState(null); // seconds until the automatic sign-out, shown only for the last minute
  const R = useRef({});
  R.current = { sec, locked, asleep, onLock, uid };
  const lastAct = useRef(Date.now());
  const hiddenAt = useRef(0);

  const applySec = useCallback((next) => {
    setSecState((cur) => {
      const merged = { ...cur, ...next };
      if (JSON.stringify(merged) === JSON.stringify(cur)) return cur;
      writeSec(R.current.uid, merged);
      return merged;
    });
  }, []);

  // the person's own "sign out when idle" feeds the same inactivity check the whole app already uses
  useEffect(() => { setUserIdleMinutes(sec.autoLogoutMinutes); }, [sec.autoLogoutMinutes]);

  // real interaction = pointer / keys / touch / wheel
  useEffect(() => {
    const touch = () => { lastAct.current = Date.now(); };
    const EV = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    EV.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    return () => EV.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
  }, []);

  // idle clock: auto-lock · sleep · sign-out countdown
  useEffect(() => {
    const tick = () => {
      const { sec: s, locked: lk, asleep: sl } = R.current;
      const idle = Date.now() - lastAct.current;
      if (s.autoLockMinutes > 0 && !lk && !sl && idle >= s.autoLockMinutes * 60000) R.current.onLock('auto');
      if (s.sleepMinutes > 0 && !sl && idle >= s.sleepMinutes * 60000) setAsleep(true);
      const ms = getIdleMs();
      if (ms > 0 && !sl) {
        const last = Math.max(getLastActivity(), lastAct.current);
        const left = Math.ceil((ms - (Date.now() - last)) / 1000);
        setIdleLeft(left <= WARN_SECONDS ? Math.max(0, left) : null);
      } else setIdleLeft((v) => (v === null ? v : null));
    };
    const h = setInterval(tick, 2000);
    return () => clearInterval(h);
  }, []);

  // lock when the tab / window is left
  useEffect(() => {
    const onVis = () => {
      const { sec: s, locked: lk } = R.current;
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (s.lockOnHide === 0 && !lk) R.current.onLock('hide');
      } else {
        if (s.lockOnHide > 0 && hiddenAt.current && !lk && Date.now() - hiddenAt.current >= s.lockOnHide * 60000) R.current.onLock('hide');
        hiddenAt.current = 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // pulse: remote lock command + settings changed on another device
  useEffect(() => {
    if (uid == null) return undefined;
    let dead = false;
    const beat = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const r = await desktopApi.pulse();
        if (dead || !r) return;
        if (r.settings) applySec(r.settings);
        if (r.lock) R.current.onLock('remote');
      } catch { /* offline: next beat */ }
    };
    beat();
    const h = setInterval(() => { beat(); }, 30000);
    let lastBeat = Date.now();
    const onVis = () => { if (document.visibilityState !== 'visible' || Date.now() - lastBeat < 15000) return; lastBeat = Date.now(); beat(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { dead = true; clearInterval(h); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [uid, applySec]);

  const sleep = useCallback(() => setAsleep(true), []);
  const wake = useCallback(() => { lastAct.current = Date.now(); markActivity(); setAsleep(false); }, []);
  const stay = useCallback(() => { lastAct.current = Date.now(); markActivity(); setIdleLeft(null); }, []);

  return { sec, applySec, asleep, sleep, wake, idleLeft, stay };
}
