/**
 * Protection layer for the public share page (/s/:token).
 *
 * Honest scope: a web page can never be fully locked — whatever the browser can show, a determined person can
 * capture (a phone camera, for one). What this does is make casual copying, saving, inspecting and printing hard,
 * and — the part that actually matters — REMOVE the content from the page the moment developer tools are detected.
 *
 *  - blocks right-click, text selection, drag, copy/cut, print, "save as", view-source and the devtools shortcuts;
 *  - detects devtools (a real `debugger` statement timing probe + a console getter probe — no eval/new Function,
 *    so it still works under our strict CSP) and calls onLock(true), after which the page drops every file;
 *  - blanks the clipboard on PrintScreen.
 */
import { isDevtoolsShortcut } from './examDevtoolsGuard';

// set only while a visible "Copy" button (shown when the owner allowed downloads) runs its execCommand fallback
let copyAllowed = false;

/**
 * Copies text for the "Copy" button of a link that allows downloading. Uses the async clipboard API; when that is
 * unavailable it falls back to a hidden textarea + execCommand, letting that one `copy` event through the guard.
 */
export async function copyPlain(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  copyAllowed = true;
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  copyAllowed = false;
  ta.remove();
  return ok;
}

const BLOCKED_CTRL = new Set(['KeyS', 'KeyP', 'KeyU', 'KeyC', 'KeyX', 'KeyA', 'KeyO']);

function debuggerProbe() {
  try {
    const t0 = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    return performance.now() - t0 > 100;
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

/** Starts the guard; returns a cleanup function. `onLock(true|false)` fires only on transitions. */
export function startSharedGuard({ onLock, onCapture, intervalMs = 800 } = {}) {
  const stop = (e) => {
    if (copyAllowed && e.type === 'copy') return;
    // search boxes inside the viewers still need to select their own text
    if (e.type === 'selectstart' && /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || e.target?.parentElement?.tagName || '')) return;
    e.preventDefault(); e.stopPropagation();
  };
  // screenshot shortcuts: PrintScreen, Win+Shift+S (Snipping Tool), Cmd+Shift+3/4/5 (macOS), Ctrl+Shift+S (Firefox)
  const isCapture = (e) => {
    const code = e.code || '';
    if (code === 'PrintScreen' || e.key === 'PrintScreen') return true;
    if (e.shiftKey && (e.metaKey || e.ctrlKey) && ['Digit3', 'Digit4', 'Digit5', 'KeyS'].includes(code)) return true;
    return false;
  };
  const onKey = (e) => {
    const code = e.code || '';
    const ctrl = e.ctrlKey || e.metaKey;
    if (isCapture(e)) onCapture?.();
    if (isDevtoolsShortcut(e) || (ctrl && BLOCKED_CTRL.has(code)) || code === 'PrintScreen' || code === 'F12') {
      stop(e);
      if (code === 'PrintScreen') { try { navigator.clipboard?.writeText(' '); } catch { /* ignore */ } }
    }
  };
  const onKeyUp = (e) => {
    if (isCapture(e)) onCapture?.(); // on Windows the PrintScreen key often only reports keyup
    if (e.code === 'PrintScreen') { try { navigator.clipboard?.writeText(' '); } catch { /* ignore */ } }
  };

  const opts = { capture: true };
  const events = ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart', 'beforeprint'];
  events.forEach((n) => document.addEventListener(n, stop, opts));
  document.addEventListener('keydown', onKey, opts);
  document.addEventListener('keyup', onKeyUp, opts);

  let open = false;
  let hits = 0;
  let misses = 0;
  const tick = () => {
    if (document.hidden) return;
    const detected = debuggerProbe() || consoleProbe();
    if (detected) { hits += 1; misses = 0; } else { misses += 1; hits = 0; }
    if (!open && hits >= 2) { open = true; onLock?.(true); }
    else if (open && misses >= 3) { open = false; onLock?.(false); }
  };
  const timer = setInterval(tick, intervalMs);

  return () => {
    clearInterval(timer);
    events.forEach((n) => document.removeEventListener(n, stop, opts));
    document.removeEventListener('keydown', onKey, opts);
    document.removeEventListener('keyup', onKeyUp, opts);
  };
}

/** Burns a tiled, rotated watermark into a canvas (so a screenshot of the canvas carries it, and it can't be removed from the DOM). */
export function burnWatermark(canvas, text) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !text) return;
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(14, Math.round(Math.min(w, h) / 34));
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#6b7280';
  ctx.font = `600 ${size}px system-ui, "Segoe UI", Tahoma, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.rotate(-Math.PI / 7);
  const stepX = ctx.measureText(text).width + size * 4;
  const stepY = size * 6;
  const reach = Math.hypot(w, h);
  for (let y = -reach; y < reach; y += stepY) {
    for (let x = -reach; x < reach; x += stepX) {
      ctx.fillText(text, x + (Math.round(y / stepY) % 2 ? stepX / 2 : 0), y);
    }
  }
  ctx.restore();
}
