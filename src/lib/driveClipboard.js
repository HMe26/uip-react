import { useSyncExternalStore } from 'react';

/**
 * One copy/cut clipboard shared by every "My PC" surface (the Explorer window and the desktop icons), so you can
 * copy in the Explorer and paste on the desktop (and back). Shape: { ids: number[], mode: 'copy' | 'cut' } | null.
 */
let clip = null;
const subs = new Set();
export const getClip = () => clip;
export function setSharedClip(v) {
  clip = typeof v === 'function' ? v(clip) : v;
  subs.forEach((f) => f());
}
const subscribe = (f) => { subs.add(f); return () => { subs.delete(f); }; };
export function useSharedClip() {
  return [useSyncExternalStore(subscribe, getClip, getClip), setSharedClip];
}
