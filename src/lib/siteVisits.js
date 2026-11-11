import { api } from '../api/client';

// Visitor counter client. EVERY time the platform link is opened (each page
// load) counts as one visit, using a random anonymous id kept in localStorage
// (used for the unique-visitors figure). Only a hash of that id reaches the DB.
const VISITOR_KEY = 'uip_visitor_id';

function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return (Math.random().toString(36).slice(2) + Date.now().toString(36)).padEnd(24, '0');
  }
}

function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

let pending = null;

/** Records this page-open as a visit (every load counts) and resolves with the counters. Called once per page load. */
export function registerVisit() {
  if (pending) return pending;
  pending = api.post('/api/v1/public/visits', { visitor_id: visitorId() })
    .then((json) => json.data || null)
    .catch(() => null);
  return pending;
}

/** Latest counters (waits for the in-flight registration so we never read before our own visit counts). */
export async function fetchVisitStats({ fresh = false } = {}) {
  if (!fresh) return registerVisit();
  await registerVisit();
  try { return (await api.get('/api/v1/public/visits')).data || null; } catch { return null; }
}
