/**
 * Ticket from POST /api/v1/auth/staff-gate (a correct access code was entered).
 * Kept in sessionStorage only: it dies with the tab and the server expires it anyway (config/staff_gate.php).
 * The browser never learns the codes or which group a code opened — the server checks everything.
 */
const KEY = 'uip_staff_gate';
export const STAFF_GATE_LOST_EVENT = 'uip:staff-gate-lost';

export function getGateToken() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (raw && raw.token && raw.exp > Date.now()) return raw.token;
    sessionStorage.removeItem(KEY);
  } catch { /* storage blocked: the gate simply asks again */ }
  return null;
}

export function setGateToken(token, expiresInSeconds) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ token, exp: Date.now() + Math.max(30, expiresInSeconds - 15) * 1000 })); } catch { /* ignore */ }
}

export function clearGateToken() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STAFF_GATE_LOST_EVENT));
}
