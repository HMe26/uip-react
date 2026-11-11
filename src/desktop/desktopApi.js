import { api, errorMessage } from '../api/client';

/**
 * Desktop ("My PC") settings + lock-screen password — thin wrappers over /api/v1/desktop/*
 * (App\Http\Controllers\Api\DesktopSettingsApiController). Everything lives on the server, so it follows the
 * student to every device (phone, laptop…).
 */
const B = '/api/v1/desktop';
const unwrap = (r) => (r && r.data !== undefined ? r.data : r);

export const desktopApi = {
  access: async () => unwrap(await api.get(`${B}/access`)), // is My PC open for this account? { allowed, code, message, readonly }
  settings: async () => unwrap(await api.get(`${B}/settings`)),
  saveSettings: async (body) => unwrap(await api.put(`${B}/settings`, body)),
  wallpaper: async () => unwrap(await api.get(`${B}/wallpaper`)),
  saveWallpaper: async (dataUrl) => unwrap(await api.put(`${B}/wallpaper`, { dataUrl })),
  lockSet: async (body) => unwrap(await api.post(`${B}/lock/set`, body)),
  lockVerify: async (password) => unwrap(await api.post(`${B}/lock/verify`, { password })),
  lockDisable: async (password) => unwrap(await api.post(`${B}/lock/disable`, { password })),
  lockOtp: async () => unwrap(await api.post(`${B}/lock/otp`, {})),
  resetStatus: async () => unwrap(await api.get(`${B}/reset`)),
  resetPc: async (body) => unwrap(await api.post(`${B}/reset`, body)),
  resetUndo: async () => unwrap(await api.post(`${B}/reset/undo`, {})),
  lockReset: async (code, password) => unwrap(await api.post(`${B}/lock/reset`, { code, password })),
  // Security & devices — DesktopSecurityApiController
  security: async () => unwrap(await api.get(`${B}/security`)),
  saveSecurity: async (patch) => unwrap(await api.put(`${B}/security`, patch)),
  pulse: async () => unwrap(await api.get(`${B}/security/pulse`)),
  logoutDevice: async (id) => unwrap(await api.post(`${B}/security/devices/${id}/logout`, {})),
  lockDevice: async (id) => unwrap(await api.post(`${B}/security/devices/${id}/lock`, {})),
  logoutOthers: async () => unwrap(await api.post(`${B}/security/devices/logout-others`, {})),
  lockOthers: async () => unwrap(await api.post(`${B}/security/devices/lock-others`, {})),
};

/** The server's own (already localized) message — the generic field-error join of errorMessage() would print codes like "invalid". */
export const lockError = (e) => (e && e.message && e.status ? e.message : errorMessage(e));

const lockKey = (uid) => `uip_desktop_lock_v1_${uid ?? 'anon'}`;
/** Last known "is a lock password set?" (so a reload while locked does not flash the wrong screen). */
export function readLockCache(uid) { try { const v = localStorage.getItem(lockKey(uid)); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } }
export function writeLockCache(uid, on) { try { localStorage.setItem(lockKey(uid), on ? '1' : '0'); } catch { /* private mode */ } }

const lockedKey = (uid) => `uip_desktop_locked_v1_${uid ?? 'anon'}`;
/** The screen stays locked across a page reload (per tab session) when a lock password is set. */
const unlockedKey = (uid) => `uip_desktop_unlocked_v1_${uid ?? 'anon'}`;
/** True once the lock password was entered (or none was needed) in THIS browser tab session: a new device/tab starts locked. */
export function readUnlockedFlag(uid) { try { return sessionStorage.getItem(unlockedKey(uid)) === '1'; } catch { return false; } }
export function writeUnlockedFlag(uid, on) { try { if (on) sessionStorage.setItem(unlockedKey(uid), '1'); else sessionStorage.removeItem(unlockedKey(uid)); } catch { /* private mode */ } }
const heldKey = (uid) => `uip_desktop_held_v1_${uid ?? 'anon'}`;
/** True while the screen was LOCKED in this tab (manual / idle / sleep / remote lock). A reload must never drop it, whatever the local caches say. */
export function readHeldFlag(uid) { try { return sessionStorage.getItem(heldKey(uid)) === '1' || sessionStorage.getItem(heldKey(undefined)) === '1'; } catch { return false; } }
export function writeHeldFlag(uid, on) { try { if (on) sessionStorage.setItem(heldKey(uid), '1'); else { sessionStorage.removeItem(heldKey(uid)); sessionStorage.removeItem(heldKey(undefined)); } } catch { /* private mode */ } }
export function readLockedFlag(uid) { try { return sessionStorage.getItem(lockedKey(uid)) === '1'; } catch { return false; } }
export function writeLockedFlag(uid, on) { try { if (on) sessionStorage.setItem(lockedKey(uid), '1'); else sessionStorage.removeItem(lockedKey(uid)); } catch { /* private mode */ } }
