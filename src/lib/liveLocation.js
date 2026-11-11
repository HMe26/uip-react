/**
 * Live-location sharing manager (module singleton, so sharing continues while the person
 * navigates between pages of the app).
 *
 * One position watcher feeds every active share; each share is a chat message id that the
 * server updates (POST /messaging/messages/{id}/live-location). Active shares are remembered in
 * localStorage so they resume after a page reload / app restart (until they expire).
 */
import { api } from '../api/client';
import { watchLive } from './geo';

const BASE = '/api/v1/messaging';
const KEY = 'uip_live_shares';
const MIN_GAP_MS = 5000;      // never post more often than this
const MAX_GAP_MS = 25000;     // post at least this often (keeps "last updated" fresh)
const MIN_MOVE_M = 8;         // ...or when the person moved this far

const shares = new Map();     // messageId -> { id, expiresAt (ms), conversationId }
const lastSent = new Map();   // messageId -> { t, lat, lng }
const listeners = new Set();
let stopWatch = null;
let starting = null;
let labels = {};

const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...shares.values()])); } catch { /* storage blocked */ } };

function meters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const isSharing = (messageId) => shares.has(String(messageId));
export const sharingCount = () => shares.size;

async function post(id, pos) {
  try {
    const res = await api.post(`${BASE}/messages/${id}/live-location`, { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
    if (res?.data?.metadata?.ended) drop(id);
    return res?.data || null;
  } catch (e) {
    // 422 = message deleted / not ours any more / not found -> stop; network errors are retried on the next fix.
    if (e && (e.status === 422 || e.status === 404 || e.status === 403)) drop(id);
    return null;
  }
}

function onPosition(pos) {
  const now = Date.now();
  for (const [id, s] of [...shares.entries()]) {
    if (now >= s.expiresAt) { stopShare(id); continue; }
    const last = lastSent.get(id);
    const gap = last ? now - last.t : Infinity;
    const moved = last ? meters(last, pos) : Infinity;
    if (gap < MIN_GAP_MS) continue;
    if (gap < MAX_GAP_MS && moved < MIN_MOVE_M) continue;
    lastSent.set(id, { t: now, lat: pos.lat, lng: pos.lng });
    post(id, pos);
  }
}

async function ensureWatcher() {
  if (stopWatch || starting) return starting;
  starting = watchLive(onPosition, () => {}, {
    title: labels.title || 'Sharing live location',
    message: labels.message || 'Your location is being shared in a chat.',
  })
    .then((stop) => { stopWatch = stop; if (!shares.size) { stop(); stopWatch = null; } })
    .catch(() => { /* permission revoked etc.: shares just stop updating and expire */ })
    .finally(() => { starting = null; });
  return starting;
}

function drop(id) {
  const key = String(id);
  shares.delete(key);
  lastSent.delete(key);
  save();
  if (!shares.size && stopWatch) { try { stopWatch(); } catch { /* ignore */ } stopWatch = null; }
  emit();
}

/** Begin updating message `id` until `expiresAtMs`. */
export async function startShare({ id, expiresAt, conversationId, initial, text }) {
  if (text) labels = text;
  const key = String(id);
  // the server ends an earlier live share of mine in the same chat when a new one starts
  for (const s of [...shares.values()]) if (String(s.conversationId) === String(conversationId) && s.id !== key) drop(s.id);
  shares.set(key, { id: key, expiresAt, conversationId });
  if (initial) lastSent.set(key, { t: Date.now(), lat: initial.lat, lng: initial.lng });
  save();
  emit();
  await ensureWatcher();
}

/** End the share (also tells the server, so the other side sees "ended"). */
export async function stopShare(id) {
  const key = String(id);
  drop(key);
  try { return (await api.delete(`${BASE}/messages/${key}/live-location`))?.data || null; } catch { return null; }
}

/** Call when the messaging page opens: restarts shares that were running before a reload. */
export function resumeShares(text) {
  if (text) labels = text;
  if (shares.size) { ensureWatcher(); return; }
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { saved = []; }
  const now = Date.now();
  saved.filter((s) => s && s.id && s.expiresAt > now).forEach((s) => shares.set(String(s.id), s));
  save();
  if (shares.size) { emit(); ensureWatcher(); }
}
