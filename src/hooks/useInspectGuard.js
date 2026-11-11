import { useEffect } from 'react';

/**
 * Deterrent only (NOT real security): blocks the usual shortcuts for DevTools / view-source
 * and the right-click menu while an auth page is mounted. Anyone determined can still open
 * DevTools from the browser menu or type view-source: in the address bar, so real protection
 * must stay on the server (validation, rate limits, auth). Right-click is left alone inside
 * inputs so "Paste" in the context menu keeps working.
 */
export default function useInspectGuard() {
  useEffect(() => {
    if (import.meta.env?.DEV) return undefined; // don't get in the way while developing

    const onKeyDown = (e) => {
      const k = String(e.key || '').toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const blocked =
        e.key === 'F12' ||
        (ctrl && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) || // DevTools / console / inspect
        (ctrl && k === 'u') ||                                       // view source
        (e.metaKey && e.altKey && ['i', 'j', 'u', 'c'].includes(k)); // macOS variants
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onContextMenu = (e) => {
      const el = e.target;
      if (el && el.closest && el.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, []);
}
