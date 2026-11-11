/**
 * Exam DevTools guard (client side).
 *
 * A browser can never be fully locked down from a web page — this makes opening
 * developer tools hard, and when it still happens it is DETECTED, hidden behind an
 * overlay and reported to the server as a violation (devtools_opened).
 *
 *  - isDevtoolsShortcut(e): F12, Ctrl/Cmd+Shift+I/J/C/K/E/M, Cmd+Opt+I/J/C/U, Ctrl+U.
 *    Uses e.code (physical key) so it also works with an Arabic keyboard layout.
 *  - watchDevtools({ onChange }): polls while the tab is visible. Combines
 *      1) a `debugger` timing probe (a paused debugger = devtools open), and
 *      2) a console getter probe (the console reads an element's `id` only when open).
 *    onChange(true|false) fires only on transitions, after 2 consecutive hits (no flicker).
 */

const LETTER_CODES = ['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyE', 'KeyM'];
const MAC_ALT_CODES = ['KeyI', 'KeyJ', 'KeyC', 'KeyU'];

export function isDevtoolsShortcut(e) {
  if (!e) return false;
  const code = e.code || '';
  if (code === 'F12' || String(e.key || '').toLowerCase() === 'f12') return true;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && LETTER_CODES.includes(code)) return true;
  if (e.metaKey && e.altKey && MAC_ALT_CODES.includes(code)) return true;
  if (e.ctrlKey && !e.shiftKey && code === 'KeyU') return true; // view-source
  return false;
}

function debuggerProbe() {
  try {
    const t0 = performance.now();
    // eslint-disable-next-line no-new-func
    new Function('debugger')();
    return performance.now() - t0 > 120;
  } catch {
    return false;
  }
}

function consoleProbe() {
  try {
    let hit = false;
    const el = new Image();
    Object.defineProperty(el, 'id', { get() { hit = true; return ''; } });
    // eslint-disable-next-line no-console
    console.log(el);
    // eslint-disable-next-line no-console
    if (console.clear) console.clear();
    return hit;
  } catch {
    return false;
  }
}

export function watchDevtools({ onChange, intervalMs = 1000 }) {
  let open = false;
  let hits = 0;
  let misses = 0;

  const tick = () => {
    if (document.hidden) return; // throttled timers in background tabs would fake a "pause"
    const detected = debuggerProbe() || consoleProbe();
    if (detected) { hits += 1; misses = 0; } else { misses += 1; hits = 0; }
    if (!open && hits >= 2) { open = true; onChange(true); }
    else if (open && misses >= 2) { open = false; onChange(false); }
  };

  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
