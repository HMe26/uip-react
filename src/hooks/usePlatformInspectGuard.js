import { useEffect } from 'react';

/**
 * Platform-wide deterrent (NOT real security): blocks the keyboard shortcuts that open
 * "view source" and the DevTools panels, on every page of the app.
 *
 * Blocked:   Ctrl/Cmd+U (view source), Ctrl/Cmd+Shift+I / J / C / K / E / M (DevTools panels:
 *            elements, console, inspect-element picker, Firefox console / network / responsive),
 *            and the macOS Cmd+Option+I / J / U / C variants.
 * Left alone on purpose: F12, the right-click menu (including its "Inspect" item), and everything
 *            about copy / cut / paste / select-all (Ctrl+C / X / V / A, Ctrl+Shift+V, the context-menu
 *            Copy / Paste). Text selection is never touched either.
 *
 * Anyone determined can still open DevTools with F12 or the browser menu, or type view-source: in
 * the address bar, so real protection must stay on the server (validation, rate limits, auth).
 * Rich-text editors keep Ctrl+U = underline: the shortcut is ignored inside contenteditable areas.
 */
export default function usePlatformInspectGuard() {
  useEffect(() => {
    if (import.meta.env?.DEV) return undefined; // don't get in the way while developing

    const onKeyDown = (e) => {
      const k = String(e.key || '').toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const inEditor = !!(e.target && e.target.closest && e.target.closest('[contenteditable=""], [contenteditable="true"]'));

      const viewSource = ctrl && !e.shiftKey && !e.altKey && k === 'u' && !inEditor;
      const devtoolsPanels = ctrl && e.shiftKey && ['i', 'j', 'c', 'k', 'e', 'm'].includes(k);
      const macDevtools = e.metaKey && e.altKey && ['i', 'j', 'u', 'c'].includes(k);

      if (viewSource || devtoolsPanels || macDevtools) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
