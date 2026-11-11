/** Fired after EVERY successful write to My PC (save / upload / ZIP sync). The Save Center shows the "Saved" toast, the cloud backup engine reacts. */
export const DRIVE_SAVED = 'uip-drive-saved';

/** detail: { id, name, kind: 'replace' | 'upload' | 'sync', size?, silent? } — silent writes (the account-settings file) stay quiet. */
export function emitDriveSaved(detail) {
  try { window.dispatchEvent(new CustomEvent(DRIVE_SAVED, { detail })); } catch { /* no window (SSR / tests) */ }
}

/** Fired when an upload to My PC fails for good (not when the student cancels it). Feeds the desktop notification center. */
export const DRIVE_FAILED = 'uip-drive-failed';

/** detail: { name, kind: 'upload', message? } */
export function emitDriveFailed(detail) {
  try { window.dispatchEvent(new CustomEvent(DRIVE_FAILED, { detail })); } catch { /* no window (SSR / tests) */ }
}

/**
 * Listen to 'uip-drive-changed', coalesced: one create / save / move fires the event several times (local write, realtime echo,
 * every open Explorer window, the desktop), and each listener used to re-fetch immediately. Now a burst becomes ONE reload.
 * Returns the unsubscribe function.
 */
export function onDriveChanged(fn, wait = 250) {
  let t = 0;
  const h = (e) => { clearTimeout(t); t = setTimeout(() => fn(e), wait); };
  window.addEventListener('uip-drive-changed', h);
  return () => { clearTimeout(t); window.removeEventListener('uip-drive-changed', h); };
}
