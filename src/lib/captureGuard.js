/**
 * Screenshot / screen-recording watcher for meetings and calls.
 *
 * What can really be detected (be honest about it):
 *  - Android app (Capacitor): native/android/ScreenCapturePlugin.java reports a real screenshot (Android 14+) and a
 *    screen recording that shows this app (Android 15+). Older Android versions report nothing.
 *  - Browser / PWA: a web page cannot see a screenshot or a recording made by the OS. The only thing it can catch is the
 *    keyboard shortcut (PrintScreen, Win+Shift+S, Cmd+Shift+3/4/5), so this is a best-effort warning, not a guarantee.
 *    Photos taken with another phone are never detectable.
 *
 * watchScreenCapture(cb) calls cb('screenshot' | 'recording') and returns a stop() function.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../native';

const ScreenCapture = isNative ? registerPlugin('ScreenCapture') : null;
const COOLDOWN_MS = 4000;

export function watchScreenCapture(onCapture) {
  let last = 0;
  const fire = (kind) => {
    const now = Date.now();
    if (now - last < COOLDOWN_MS) return; // one shortcut can raise keydown + keyup + the native event
    last = now;
    try { onCapture(kind); } catch { /* ignore */ }
  };

  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const onKey = (e) => {
    const code = e.code || '';
    const key = e.key || '';
    if (key === 'PrintScreen' || code === 'PrintScreen') return fire('screenshot');
    if (isMac) {
      if (e.metaKey && e.shiftKey && (code === 'Digit3' || code === 'Digit4')) return fire('screenshot');
      if (e.metaKey && e.shiftKey && code === 'Digit5') return fire('recording');
    } else if (e.metaKey && e.shiftKey && code === 'KeyS') {
      return fire('screenshot'); // Windows snipping tool
    } else if (e.metaKey && e.altKey && code === 'KeyR') {
      return fire('recording'); // Windows Game Bar recording
    }
    return undefined;
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  const handles = [];
  if (ScreenCapture) {
    ScreenCapture.addListener('screenshot', () => fire('screenshot')).then((h) => handles.push(h)).catch(() => {});
    ScreenCapture.addListener('recording', () => fire('recording')).then((h) => handles.push(h)).catch(() => {});
    ScreenCapture.start().catch(() => {}); // plugin missing from an old APK: nothing to do
  }

  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    handles.forEach((h) => { try { h.remove(); } catch { /* ignore */ } });
    if (ScreenCapture) ScreenCapture.stop().catch(() => {});
  };
}
