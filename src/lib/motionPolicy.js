import { api } from '../api/client';
import { isNative } from '../native.js';

// Platform-wide "animations" switch (Admin -> Platform Policy -> "Platform animations").
// The server value is public (GET /api/v1/platform/status) and applied as <html data-motion="on|off">;
// styles/css/ambient.css turns every animation off for "off". The last known value is cached so the
// page starts in the right state on the next visit, with no flash of motion.
const KEY = 'uip_motion';
const RECHECK_MS = 5 * 60 * 1000;
let lastCheck = 0;

export function applyMotion(on) {
  if (isNative) { document.documentElement.dataset.motion = 'off'; return; } // [ANDROID-PERF] animations stay off in the app
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

async function refresh() {
  lastCheck = Date.now();
  try {
    const json = await api.get('/api/v1/platform/status');
    const on = json?.data?.animations_enabled;
    if (typeof on === 'boolean') applyMotion(on);
  } catch { /* offline / old API without the flag: keep the cached value (default = on) */ }
}

export function initMotionPolicy() {
  if (isNative) document.documentElement.dataset.motion = 'off';
  try { if (localStorage.getItem(KEY) === '0') document.documentElement.dataset.motion = 'off'; } catch { /* ignore */ }
  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > RECHECK_MS) refresh();
  });
}
