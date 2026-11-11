import { useEffect, useRef } from 'react';
import { enableFastRenderer } from '../../lib/termRenderer';

/** Minimal xterm host for the uip-sandbox gateway (same theme/wiring as zipbench/SandboxPanel). `sandbox` = useSandbox() result. */
export default function SandboxTerminal({ sandbox }) {
  const hostRef = useRef(null);
  const sbRef = useRef(sandbox);
  sbRef.current = sandbox;
  useEffect(() => {
    let disposed = false; let ro = null; let term = null;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
      if (disposed || !hostRef.current) return;
      term = new Terminal({
        fontFamily: "'JetBrains Mono', Consolas, Menlo, monospace", fontSize: 13, cursorBlink: true, scrollback: 3000, lineHeight: 1.4, cursorStyle: 'bar',
        theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', selectionBackground: 'rgba(88,166,255,.3)' },
      });
      const fit = new FitAddon();
      term.loadAddon(fit); term.open(hostRef.current);
      enableFastRenderer(term);
      const doFit = () => { try { fit.fit(); } catch { /* hidden */ } };
      doFit();
      term.onData((d) => sbRef.current.input(d));
      term.onResize(({ cols, rows }) => sbRef.current.resize(cols, rows));
      sbRef.current.attach(term);
      ro = new ResizeObserver(doFit); ro.observe(hostRef.current);
    })().catch(() => { /* terminal chunk failed to load */ });
    return () => { disposed = true; ro?.disconnect(); sbRef.current.attach(null); term?.dispose(); };
  }, []);
  return <div ref={hostRef} className="pp-term" dir="ltr" />;
}
