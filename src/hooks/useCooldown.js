import { useCallback, useEffect, useState } from 'react';

/**
 * Seconds-left countdown for "resend code" buttons that SURVIVES a page refresh.
 *
 * The end time (not the seconds left) is stored in localStorage under `storageKey`, so reloading or
 * reopening the page continues the same countdown instead of starting again from the beginning.
 * The server enforces the real limit; this only keeps the UI honest.
 *
 *   useCooldown(initial, storageKey)
 *     initial     seconds to start with the FIRST time this key is seen (e.g. the code was just sent);
 *                 once a record exists (even an expired one) a refresh never restarts it.
 *     start(n)    (re)start with n seconds — call after a successful/handled resend.
 */
const PREFIX = 'uip:cooldown:';

const readUntil = (key) => {
  try { return Number(localStorage.getItem(PREFIX + key)) || 0; } catch { return 0; }
};
const writeUntil = (key, until) => {
  try { localStorage.setItem(PREFIX + key, String(until)); } catch { /* private mode: in-memory only */ }
};

/** Key for an e-mail based flow, e.g. cooldownKey('reset', 'A@b.com'). */
export const cooldownKey = (purpose, email) => `${purpose}:${String(email || '').trim().toLowerCase()}`;

/** Start/refresh a stored cooldown from outside a component (e.g. right after "send code" on the previous page). */
export const setCooldown = (key, seconds) => writeUntil(key, Date.now() + Math.max(0, seconds) * 1000);

const secondsLeft = (until) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

export default function useCooldown(initial = 0, storageKey = null) {
  const [until, setUntil] = useState(() => {
    if (!storageKey) return initial > 0 ? Date.now() + initial * 1000 : 0;
    const stored = readUntil(storageKey);
    if (stored) return stored;
    if (initial > 0) {
      const u = Date.now() + initial * 1000;
      writeUntil(storageKey, u);
      return u;
    }
    return 0;
  });
  const [left, setLeft] = useState(() => secondsLeft(until));

  // The e-mail (and so the key) can change while the page is open: follow the stored record for it.
  useEffect(() => {
    if (!storageKey) return;
    setUntil(readUntil(storageKey));
  }, [storageKey]);

  useEffect(() => {
    setLeft(secondsLeft(until));
    if (until <= Date.now()) return undefined;
    const id = setInterval(() => {
      const l = secondsLeft(until);
      setLeft(l);
      if (l <= 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [until]);

  const start = useCallback((n = 60) => {
    const u = Date.now() + Math.max(0, Number(n) || 0) * 1000;
    if (storageKey) writeUntil(storageKey, u);
    setUntil(u);
  }, [storageKey]);

  return [left, start];
}
