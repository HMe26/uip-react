import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useResizeGrip } from './useResizeGrip';
import { AppPicker, ModeSwitch } from './RunPicker';
import { enableFastRenderer } from '../../lib/termRenderer';

const STATE_LABEL = {
  idle: ['Ready', 'جاهز'], connecting: ['Connecting…', 'جاري الاتصال…'], starting: ['Starting…', 'جاري التشغيل…'],
  running: ['Running', 'شغّال'], exited: ['Process ended', 'انتهت العملية'], error: ['Failed', 'فشل'],
  closed: ['Sandbox closed', 'اتقفلت البيئة'], disconnected: ['Disconnected', 'انقطع الاتصال'],
};
const KIND_NOTE = {
  laravel: ['Laravel runs on a real PHP server with SQLite. The first run installs Composer packages and can take a few minutes.', 'Laravel بيشتغل على سيرفر PHP حقيقي مع SQLite. أول تشغيل بيثبّت حزم Composer وممكن ياخد كام دقيقة.'],
  node: ['A real npm install + dev server runs in an isolated container. The first run can take a few minutes.', 'npm install حقيقي وسيرفر تطوير في حاوية معزولة. أول تشغيل ممكن ياخد كام دقيقة.'],
  python: ['A real terminal: input() waits for you to type, and Flask/Django servers run here too.', 'تيرمنال حقيقي: input() بيستنى وإنت تكتب، وسيرفرات Flask/Django بتشتغل هنا كمان.'],
};

/**
 * Bottom panel for projects that need a real server (Laravel, Node, Flask/Django) or an interactive terminal.
 * The project runs inside an isolated container on the uip-sandbox gateway; this panel shows its terminal (xterm.js)
 * and the live preview (an iframe on the sandbox's own preview domain — never on the UIPE origin).
 */
export default function SandboxPanel({ tt, sandbox, apps, allApps, app, onSelect, onRun, onClose, expanded, onToggleExpand, ai, fontSize = 13.5 }) {
  const fsRef = useRef(fontSize);
  fsRef.current = fontSize;
  const [tab, setTab] = useState('terminal');
  const [frameKey, setFrameKey] = useState(0);
  const { panelRef, height, setHeight, onGripDown } = useResizeGrip();
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const sandboxRef = useRef(sandbox);
  sandboxRef.current = sandbox;
  const { phase, busy, statusText, previewUrl, hint, error } = sandbox;
  const live = phase === 'running' || phase === 'exited';
  const label = STATE_LABEL[phase] || STATE_LABEL.idle;

  // xterm.js is loaded on demand (it is only needed when a sandbox is used)
  useEffect(() => {
    let disposed = false; let ro = null; let term = null;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
      if (disposed || !hostRef.current) return;
      term = new Terminal({ fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, 'Cairo', 'Noto Sans Arabic', monospace", fontSize: Math.round(fsRef.current - 0.5), cursorBlink: true, convertEol: false, scrollback: 5000, lineHeight: 1.45, letterSpacing: 0, cursorStyle: 'bar', cursorWidth: 2, theme: {
        background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0d1117', selectionBackground: 'rgba(88,166,255,.3)',
        black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
      } });
      const fit = new FitAddon();
      term.loadAddon(fit); term.open(hostRef.current);
      enableFastRenderer(term); // GPU renderer: the default DOM renderer is what made long output freeze the page
      termRef.current = term; fitRef.current = fit;
      const doFit = () => { try { fit.fit(); } catch { /* hidden */ } };
      doFit();
      term.onData((d) => sandboxRef.current.input(d));
      term.onResize(({ cols, rows }) => sandboxRef.current.resize(cols, rows));
      sandboxRef.current.attach(term);
      ro = new ResizeObserver(doFit); ro.observe(hostRef.current);
    })().catch(() => { /* chunk failed to load: the panel still shows status + preview */ });
    return () => { disposed = true; ro?.disconnect(); sandboxRef.current.attach(null); term?.dispose(); termRef.current = null; fitRef.current = null; };
  }, []);

  // A− / A+ in the toolbar also resizes the real terminal
  useEffect(() => { const t = termRef.current; if (!t) return; t.options.fontSize = Math.round(fontSize - 0.5); try { fitRef.current?.fit(); } catch { /* hidden */ } }, [fontSize]);

  const size = useCallback(() => ({ cols: termRef.current?.cols || 100, rows: termRef.current?.rows || 28 }), []);
  const run = () => { setTab('terminal'); onRun(size()); };

  // the preview is the most useful thing to look at once the app is up
  const shownUrl = useRef(null);
  useEffect(() => {
    if (previewUrl && previewUrl !== shownUrl.current) { setTab('preview'); setFrameKey((k) => k + 1); }
    shownUrl.current = previewUrl;
  }, [previewUrl]);
  useEffect(() => { if (tab === 'terminal') { const id = window.setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } termRef.current?.focus(); }, 30); return () => clearTimeout(id); } return undefined; }, [tab, expanded]);

  return (
    <div ref={panelRef} className={`zb-run zb-sbx${expanded ? ' is-expanded' : ''}`} data-state={phase === 'running' ? 'running' : phase === 'error' || phase === 'disconnected' ? 'error' : busy ? 'building' : 'idle'} style={height && !expanded ? { height } : undefined}>
      <div className="zb-run__grip" onPointerDown={onGripDown} onDoubleClick={() => setHeight(null)} role="separator" aria-orientation="horizontal" title={tt('Drag to resize', 'اسحب لتغيير الحجم')} />
      <div className="zb-run__bar">
        <div className="zb-run__main">
          <AppPicker tt={tt} apps={apps} app={app} onSelect={onSelect} />
          {busy ? (
            <button type="button" className="zb-btn zb-btn--danger" onClick={sandbox.reset}><Icon name="stop" size={14} /> <span>{tt('Cancel', 'إلغاء')}</span></button>
          ) : phase === 'disconnected' ? (
            <button type="button" className="zb-btn zb-btn--primary" onClick={() => sandbox.reconnect(size().cols, size().rows)}><Icon name="refresh" size={14} /> <span>{tt('Reconnect', 'إعادة الاتصال')}</span></button>
          ) : live ? (
            <>
              <button type="button" className="zb-btn" onClick={() => sandbox.restart(size().cols, size().rows)}><Icon name="refresh" size={14} /> <span>{tt('Restart', 'إعادة تشغيل')}</span></button>
              <button type="button" className="zb-btn zb-btn--danger" onClick={sandbox.stop}><Icon name="stop" size={14} /> <span>{tt('Stop', 'إيقاف')}</span></button>
            </>
          ) : (
            <button type="button" className="zb-btn zb-btn--primary" onClick={run}><Icon name="play" size={14} /> <span>{tt('Run', 'تشغيل')}</span></button>
          )}
          {ai?.show && (
            <button type="button" className={`zb-btn zb-btn--ai${ai.hot ? ' is-hot' : ''}`} onClick={() => ai.onExplain()} disabled={ai.busy} title={tt('Ask the AI to explain the error in the output', 'اطلب من الذكاء الاصطناعي يشرح الخطأ اللي في الناتج')}><Icon name="sparkles" size={14} /> <span>{tt('Explain error', 'اشرح الخطأ')}</span></button>
          )}
          <span className={`zb-run__state is-${phase === 'running' ? 'running' : phase === 'error' || phase === 'disconnected' ? 'error' : busy ? 'building' : phase === 'exited' ? 'done' : phase === 'closed' ? 'stopped' : 'idle'}`} role="status" title={busy && statusText ? statusText : tt(...label)}>
            <i className="zb-run__dot" /><em>{busy && statusText ? statusText : tt(...label)}</em>
          </span>
        </div>
        <div className="zb-run__tools">
          <ModeSwitch tt={tt} apps={allApps || apps} app={app} onSelect={onSelect} />
          <div className="zb-seg" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'terminal'} className={`zb-run__tab zb-seg__b${tab === 'terminal' ? ' is-on' : ''}`} onClick={() => setTab('terminal')} title={tt('Terminal', 'التيرمنال')}><Icon name="terminal" size={13} /><span>{tt('Terminal', 'التيرمنال')}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'preview'} className={`zb-run__tab zb-seg__b${tab === 'preview' ? ' is-on' : ''}`} onClick={() => setTab('preview')} title={tt('Preview', 'المعاينة')}><Icon name="eye" size={13} /><span>{tt('Preview', 'المعاينة')}</span>{previewUrl && <b className="zb-sbx__dot" aria-hidden="true" />}</button>
          </div>
          <span className="zb-run__sp" />
          <div className="zb-run__acts">
            {previewUrl && (
              <>
                <button type="button" className="zb-ibtn" onClick={() => setFrameKey((k) => k + 1)} title={tt('Reload preview', 'إعادة تحميل المعاينة')} aria-label={tt('Reload preview', 'إعادة تحميل المعاينة')}><Icon name="refresh" size={15} /></button>
                <a className="zb-ibtn" href={previewUrl} target="_blank" rel="noopener noreferrer" title={tt('Open in a new tab', 'فتح في تبويب جديد')} aria-label={tt('Open in a new tab', 'فتح في تبويب جديد')}><Icon name="link" size={15} /></a>
              </>
            )}
            <button type="button" className="zb-ibtn" onClick={() => { setHeight(null); onToggleExpand(); }} title={expanded ? tt('Back to split view', 'رجوع للعرض المقسوم') : tt('Full page', 'ملء الصفحة')} aria-label={tt('Full page', 'ملء الصفحة')}><Icon name={expanded ? 'collapse' : 'maximize'} size={15} /></button>
            <button type="button" className="zb-ibtn" onClick={onClose} title={tt('Close', 'إغلاق')} aria-label={tt('Close run panel', 'إغلاق لوحة التشغيل')}><Icon name="x" size={15} /></button>
          </div>
        </div>
      </div>

      {(error || hint) && (
        <div className={`zb-sbx__note${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || hint}</div>
      )}

      <div className="zb-run__body">
        <div className="zb-sbx__term" hidden={tab !== 'terminal'}>
          <div ref={hostRef} className="zb-sbx__xterm" dir="ltr" />
          {phase === 'idle' && !error && (
            <div className="zb-sbx__intro">
              <span className="zb-sbx__intro-ico"><Icon name="terminal" size={26} /></span>
              <strong>{tt('Real environment, one click away', 'بيئة تشغيل حقيقية بضغطة واحدة')}</strong>
              <p>{tt(...(KIND_NOTE[app?.sandbox] || KIND_NOTE.node))}</p>
              <ol className="zb-sbx__steps">
                <li><b>1</b>{tt('Install', 'تثبيت الحزم')}</li>
                <li><b>2</b>{tt('Start', 'تشغيل')}</li>
                <li><b>3</b>{tt('Preview', 'معاينة')}</li>
              </ol>
              <small>{tt('Runs in an isolated, temporary container that is deleted when you stop or leave.', 'بيشتغل في حاوية معزولة ومؤقتة بتتمسح لما توقف أو تخرج.')}</small>
            </div>
          )}
        </div>
        {tab === 'preview' && (
          previewUrl ? (
            <iframe
              key={frameKey}
              src={previewUrl}
              title={tt('Project preview', 'معاينة المشروع')}
              className="zb-run__frame"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="zb-run__msg"><p>{live ? tt('Waiting for the app to listen on a port… watch the terminal.', 'مستني التطبيق يفتح بورت… تابع التيرمنال.') : tt('Run the project to see the preview here.', 'شغّل المشروع عشان تظهر المعاينة هنا.')}</p></div>
          )
        )}
      </div>
    </div>
  );
}
