import { useCallback, useEffect, useRef } from 'react';
import { zipSync, strToU8 } from 'fflate';
import Icon from '../components/Icon';
import { UipMark } from './OsIcons';
import { useSandbox } from '../components/zipbench/runner/useSandbox';
import { enableFastRenderer } from '../lib/termRenderer';

/** One real shell per student, in an isolated container on the uip-sandbox gateway (same gateway the code editor uses). */
const TOKEN_PATH = '/api/v1/drive/terminal-token';

const STATE = {
  idle: ['Ready', 'جاهز'], connecting: ['Connecting…', 'جاري الاتصال…'], starting: ['Starting…', 'جاري التشغيل…'],
  running: ['Connected', 'متصل'], exited: ['Session ended', 'انتهت الجلسة'], error: ['Failed', 'فشل'],
  closed: ['Closed', 'اتقفل'], disconnected: ['Disconnected', 'انقطع الاتصال'],
};

const THEME = {
  background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0d1117', selectionBackground: 'rgba(88,166,255,.3)',
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
};

export default function TerminalApp({ tt }) {
  const sbx = useSandbox('terminal', TOKEN_PATH);
  const sbxRef = useRef(sbx);
  sbxRef.current = sbx;
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const { phase, busy, statusText, error } = sbx;

  const size = useCallback(() => ({ cols: termRef.current?.cols || 100, rows: termRef.current?.rows || 28 }), []);
  // an empty workspace: the gateway wants a ZIP for every session, a shell just starts in it
  const begin = useCallback(() => {
    const { cols, rows } = size();
    const zip = zipSync({ 'README.txt': strToU8('UIPE Terminal workspace.\nFiles here live only as long as this session.\n') });
    sbxRef.current.start({ kind: 'shell', entry: '', zip, cols, rows });
  }, [size]);

  useEffect(() => {
    let disposed = false; let ro = null; let term = null;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
      if (disposed || !hostRef.current) return;
      term = new Terminal({ fontFamily: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace", fontSize: 13, cursorBlink: true, scrollback: 5000, lineHeight: 1.25, cursorStyle: 'bar', cursorWidth: 2, theme: THEME });
      const fit = new FitAddon();
      term.loadAddon(fit); term.open(hostRef.current);
      enableFastRenderer(term); // GPU renderer: the default DOM renderer is what made long output freeze the page
      termRef.current = term; fitRef.current = fit;
      const doFit = () => { try { fit.fit(); } catch { /* hidden */ } };
      doFit();
      term.onData((d) => sbxRef.current.input(d));
      term.onResize(({ cols, rows }) => sbxRef.current.resize(cols, rows));
      sbxRef.current.attach(term);
      ro = new ResizeObserver(doFit); ro.observe(hostRef.current);
      term.focus();
      // a refresh within a few minutes re-attaches to the shell that is still alive; otherwise open a new one
      if (!sbxRef.current.resumeSaved(term.cols, term.rows)) begin();
    })().catch(() => { /* chunk failed to load */ });
    return () => { disposed = true; ro?.disconnect(); sbxRef.current.attach(null); term?.dispose(); termRef.current = null; fitRef.current = null; };
  }, [begin]);

  const label = STATE[phase] || STATE.idle;
  const dead = phase === 'exited' || phase === 'closed' || phase === 'error' || phase === 'idle';
  const dot = phase === 'running' ? '#3fb950' : busy ? '#d29922' : '#ff7b72';

  return (
    <div className="os-term" onMouseDown={() => termRef.current?.focus()}>
      <div className="os-term__bar">
        <span className="os-term__brand"><UipMark size={15} />UIPE Terminal</span>
        <span className="os-term__st"><i style={{ background: dot }} />{tt(label[0], label[1])}{statusText ? ` — ${statusText}` : ''}</span>
        <span className="os-term__sp" />
        {phase === 'disconnected' && <button type="button" onClick={() => sbx.reconnect(size().cols, size().rows)}><Icon name="refresh" size={14} />{tt('Reconnect', 'إعادة الاتصال')}</button>}
        {phase === 'running' && <button type="button" onClick={() => sbx.restart(size().cols, size().rows)}><Icon name="refresh" size={14} />{tt('Restart', 'إعادة تشغيل')}</button>}
        {dead && <button type="button" onClick={begin}><Icon name="play" size={14} />{tt('New session', 'جلسة جديدة')}</button>}
        {(phase === 'running' || busy) && <button type="button" onClick={() => { sbx.reset(); }}><Icon name="stop" size={14} />{tt('Stop', 'إيقاف')}</button>}
      </div>
      {phase === 'error' && <div className="os-term__err" role="alert">{error || tt('Could not start the terminal.', 'معرفتش أشغّل الترمينال.')}</div>}
      <div className="os-term__host" ref={hostRef} dir="ltr" />
    </div>
  );
}
