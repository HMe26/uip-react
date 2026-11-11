import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { RUNNER_URL } from '../../config/runner';
import { AppPicker, ModeSwitch } from './RunPicker';

const REASONS = {
  'php-server': ['Laravel / PHP needs a real PHP server (PHP, Composer and a database). Running it inside the IDE is the next phase — for now you can edit, save and download it.', 'Laravel / PHP محتاج سيرفر PHP حقيقي (PHP و Composer وقاعدة بيانات). تشغيله جوه المحرر هو المرحلة الجاية — دلوقتي تقدر تعدّل وتحفظ وتنزّل.'],
  'node-server': ['This is a Node.js server project (Express/Next/…). It needs a real Node server, which is planned for the next phase.', 'ده مشروع Node.js سيرفر (Express/Next/…). محتاج سيرفر Node حقيقي، وده في المرحلة الجاية.'],
  'lang-server': ['This language / project runs on the sandbox server, which is not available here. You can still edit, save and download it.', 'اللغة / المشروع ده بيشتغل على سيرفر الـ sandbox وهو مش متاح هنا. تقدر تعدّل وتحفظ وتنزّل عادي.'],
  'py-server': ['Python web frameworks (Flask/Django/FastAPI) need a real server. Plain Python scripts run fine here.', 'فريم ورك الويب في Python (Flask/Django/FastAPI) محتاج سيرفر حقيقي. سكربتات Python العادية بتشتغل هنا عادي.'],
};

const STATE_LABEL = {
  idle: ['Ready', 'جاهز'], building: ['Starting…', 'جاري التشغيل…'], running: ['Running', 'شغّال'],
  input: ['Waiting for input', 'في انتظار إدخال'], done: ['Finished', 'انتهى'], error: ['Failed', 'فشل'], stopped: ['Stopped', 'اتوقف'],
};

const TB_HEAD = /^Traceback \(most recent call last\):/;
const TB_FILE = /^(\s*)File "(.*)", line (\d+)(.*)$/;
const TB_ERR = /^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit))(:?)(.*)$/;

/** One console entry. Python tracebacks (stderr) get a readable structure: header, file/line, the code line, and a bold error name. */
function LogLine({ l }) {
  const plain = Array.isArray(l.echo)
    ? <div className={`zb-log zb-log--${l.level}`}>{l.text.slice(0, l.echo[0])}<span className="zb-log__echo">{l.text.slice(l.echo[0], l.echo[1])}</span>{l.text.slice(l.echo[1])}</div>
    : <div className={`zb-log zb-log--${l.level}`}>{l.text}</div>;
  if (l.level !== 'stderr' && l.level !== 'error') return plain;
  const lines = String(l.text).replace(/\n$/, '').split('\n');
  if (!lines.some((s) => TB_HEAD.test(s) || TB_FILE.test(s))) return plain;
  let prev = '';
  return (
    <>
      {lines.map((s, i) => {
        let kind = 'plain'; let body = s;
        const f = TB_FILE.exec(s); const e = TB_ERR.exec(s);
        if (TB_HEAD.test(s)) kind = 'head';
        else if (f) { kind = 'file'; body = <>{f[1]}File “{f[2]}”, line <b>{f[3]}</b>{f[4]}</>; }
        else if (e && !/^\s/.test(s)) { kind = 'err'; body = <>{e[1]}{e[2]}<i>{e[3]}</i></>; }
        else if (/^\s+\S/.test(s) && (prev === 'file' || prev === 'code')) kind = 'code';
        prev = kind;
        return <div key={i} className={`zb-log zb-log--${l.level}${kind === 'plain' ? '' : ` zb-log--tb-${kind}`}`}>{body}{'\n'}</div>;
      })}
    </>
  );
}

/** Bottom panel of the workbench: pick what to run, Run / Stop, live preview (web) and console (stdout, stderr, errors). */
export default function RunPanel({ tt, runner, apps, app, onSelect, onRun, onClose, expanded, onToggleExpand, ai }) {
  const [tab, setTab] = useState('console');
  const [stdin, setStdin] = useState('');
  const [line, setLine] = useState('');
  const [copied, setCopied] = useState(false);
  const [height, setHeight] = useState(null); // px, set by dragging the grip; null = the default / "bigger" size
  const panelRef = useRef(null);
  const consoleRef = useRef(null);
  const { state, statusText, logs } = runner;
  const isWeb = app?.kind === 'web';
  const isPy = app?.kind === 'python';
  const errCount = logs.filter((l) => l.level === 'error' || l.level === 'stderr').length;

  // the right tab for the thing that runs: preview for web apps, console for python / build errors
  useEffect(() => { if (state === 'building') setTab(isWeb ? 'preview' : 'console'); }, [state, isWeb]);
  useEffect(() => { if (state === 'error') setTab('console'); }, [state]);
  // a prompt()/confirm() from the program is answered in the console (the IDE's own input line), never in a browser dialog
  useEffect(() => { if (state === 'input') setTab('console'); }, [state]);
  useEffect(() => { const el = consoleRef.current; if (el) el.scrollTop = el.scrollHeight; }, [logs.length, tab, state]);

  const startDrag = (e) => {
    const el = panelRef.current; const parent = el?.parentElement; if (!el || !parent) return;
    e.preventDefault();
    const y0 = e.clientY; const h0 = el.getBoundingClientRect().height; const max = parent.clientHeight - 64;
    const move = (ev) => setHeight(Math.max(110, Math.min(max, h0 + (y0 - ev.clientY))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const copyOutput = async () => {
    try { await navigator.clipboard.writeText(logs.map((l) => (/\n$/.test(l.text) ? l.text : `${l.text}\n`)).join('')); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };

  const running = state === 'building';
  const live = state === 'running' && isWeb;
  const stateText = STATE_LABEL[state] || STATE_LABEL.idle;
  const canRun = !!app && app.kind !== 'unsupported' && !!RUNNER_URL;

  return (
    <div ref={panelRef} className={`zb-run${expanded ? ' is-expanded' : ''}`} data-state={state} style={height && !expanded ? { height } : undefined}>
      <div className="zb-run__grip" onPointerDown={startDrag} onDoubleClick={() => setHeight(null)} role="separator" aria-orientation="horizontal" title={tt('Drag to resize', 'اسحب لتغيير الحجم')} />
      <div className="zb-run__bar">
        <div className="zb-run__main">
          <AppPicker tt={tt} apps={apps} app={app} onSelect={onSelect} />
          {running
            ? <button type="button" className="zb-btn zb-btn--danger" onClick={runner.stop}><Icon name="stop" size={14} /> <span>{tt('Stop', 'إيقاف')}</span></button>
            : <button type="button" className="zb-btn zb-btn--primary" onClick={() => onRun({ stdin })} disabled={!canRun} title={canRun ? undefined : tt('Nothing runnable is selected', 'مفيش حاجة قابلة للتشغيل متحددة')}><Icon name={live ? 'refresh' : 'play'} size={14} /> <span>{live ? tt('Reload', 'إعادة تحميل') : tt('Run', 'تشغيل')}</span></button>}
          {live && <button type="button" className="zb-btn" onClick={runner.stop}><Icon name="stop" size={14} /> <span>{tt('Stop', 'إيقاف')}</span></button>}
          {ai?.show && (
            <button type="button" className={`zb-btn zb-btn--ai${ai.hot ? ' is-hot' : ''}`} onClick={() => ai.onExplain()} disabled={ai.busy} title={tt('Ask the AI to explain the error in the output', 'اطلب من الذكاء الاصطناعي يشرح الخطأ اللي في الناتج')}><Icon name="sparkles" size={14} /> <span>{tt('Explain error', 'اشرح الخطأ')}</span></button>
          )}
          <span className={`zb-run__state is-${state}`} role="status" title={statusText && running ? statusText : tt(...stateText)}><i className="zb-run__dot" /><em>{statusText && running ? statusText : tt(...stateText)}</em></span>
        </div>
        <div className="zb-run__tools">
          <ModeSwitch tt={tt} apps={apps} app={app} onSelect={onSelect} />
          <div className="zb-seg" role="tablist">
            {isWeb && <button type="button" role="tab" aria-selected={tab === 'preview'} className={`zb-run__tab zb-seg__b${tab === 'preview' ? ' is-on' : ''}`} onClick={() => setTab('preview')} title={tt('Preview', 'المعاينة')}><Icon name="eye" size={13} /><span>{tt('Preview', 'المعاينة')}</span></button>}
            <button type="button" role="tab" aria-selected={tab === 'console'} className={`zb-run__tab zb-seg__b${tab === 'console' ? ' is-on' : ''}`} onClick={() => setTab('console')} title={tt('Console', 'الكونسول')}><Icon name="terminal" size={13} /><span>{tt('Console', 'الكونسول')}</span>{errCount > 0 && <b className="zb-run__bad">{errCount > 99 ? '99+' : errCount}</b>}</button>
          </div>
          <span className="zb-run__sp" />
          <div className="zb-run__acts">
            <button type="button" className="zb-ibtn" onClick={copyOutput} disabled={logs.length === 0} title={copied ? tt('Copied', 'تم النسخ') : tt('Copy output', 'نسخ الناتج')} aria-label={tt('Copy output', 'نسخ الناتج')}><Icon name={copied ? 'check' : 'copy'} size={15} /></button>
            <button type="button" className="zb-ibtn" onClick={runner.clearLogs} title={tt('Clear console', 'مسح الكونسول')} aria-label={tt('Clear console', 'مسح الكونسول')}><Icon name="trash" size={15} /></button>
            <button type="button" className="zb-ibtn" onClick={() => { setHeight(null); onToggleExpand(); }} title={expanded ? tt('Back to split view', 'رجوع للعرض المقسوم') : tt('Full page', 'ملء الصفحة')} aria-label={tt('Full page', 'ملء الصفحة')}><Icon name={expanded ? 'collapse' : 'maximize'} size={15} /></button>
            <button type="button" className="zb-ibtn" onClick={onClose} title={tt('Close', 'إغلاق')} aria-label={tt('Close run panel', 'إغلاق لوحة التشغيل')}><Icon name="x" size={15} /></button>
          </div>
        </div>
      </div>

      <div className="zb-run__body">
        {!RUNNER_URL ? (
          <div className="zb-run__msg"><p>{tt('The runner is not configured yet. Deploy the “uip-runner” site and set VITE_RUNNER_URL to its address.', 'الـ Runner لسه مش متظبط. انشر موقع «uip-runner» واضبط VITE_RUNNER_URL على عنوانه.')}</p></div>
        ) : (
          <>
            {/* The runner iframe stays mounted so the Python engine and the bundler stay warm between runs. */}
            <iframe
              ref={runner.frameRef}
              src={RUNNER_URL}
              onLoad={runner.onFrameLoad}
              title={tt('Project preview', 'معاينة المشروع')}
              className="zb-run__frame"
              hidden={!isWeb || tab !== 'preview'}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              referrerPolicy="no-referrer"
            />
            <div className="zb-run__console" hidden={isWeb && tab === 'preview'}>
              <div className="zb-run__log" ref={consoleRef}>
                {app?.kind === 'unsupported' && <div className="zb-log zb-log--system">{tt(...(REASONS[app.reason] || REASONS['php-server']))}</div>}
                {!app && <div className="zb-log zb-log--system">{tt('No runnable project or source file was found in this archive.', 'مفيش مشروع أو ملف كود قابل للتشغيل في الأرشيف ده.')}</div>}
                {logs.length === 0 && canRun && state === 'idle' && (
                  <div className="zb-run__empty"><Icon name="terminal" size={26} /><strong>{tt('Ready when you are', 'جاهز للتشغيل')}</strong><span>{tt('Press Run — the output appears here.', 'اضغط تشغيل — النتيجة هتظهر هنا.')}</span></div>
                )}
                {logs.map((l, i) => <LogLine key={i} l={l} />)}
              </div>
              {state === 'input' && (
                <form className="zb-run__prompt" onSubmit={(e) => { e.preventDefault(); const v = line; setLine(''); runner.submitInput(v); }}>
                  <span className="zb-run__chev" aria-hidden="true">❯</span>
                  <input autoFocus dir="ltr" value={line} onChange={(e) => setLine(e.target.value)} spellCheck={false} autoComplete="off" aria-label={tt('Input for the program', 'مدخل للبرنامج')} placeholder={tt('Type your answer…', 'اكتب إجابتك…')} />
                  <kbd>Enter ↵</kbd>
                </form>
              )}
              {isPy && (
                <details className="zb-run__stdin">
                  <summary>{tt('Pre-filled input (optional)', 'مدخلات جاهزة (اختياري)')}{stdin.trim() && <b>{stdin.split(/\r?\n/).length}</b>}</summary>
                  <textarea rows={2} value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false} placeholder={tt('One line per input() call — or just answer in the console when asked.', 'سطر لكل input() — أو جاوب في الكونسول وقت ما يسأل.')} />
                </details>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
