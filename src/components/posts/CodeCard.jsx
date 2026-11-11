import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { zipSync } from 'fflate';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import { postsApi } from '../../api/postsApi';
import { useSandbox } from '../zipbench/runner/useSandbox';
import { fmtBytes, mediaBaseOf } from '../../lib/postMedia';
import { highlight } from './highlight';

const SandboxTerminal = lazy(() => import('./SandboxTerminal'));
const MAX_LINES = 14;
/** Thin scrollbars inside the preview frame instead of the OS default ones. */
const SB_CSS = '<style>html{scrollbar-width:thin;scrollbar-color:#94a3b8 transparent}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#94a3b8;border-radius:8px}::-webkit-scrollbar-track{background:transparent}</style>';

/** HTML/CSS/JS runs in a locked-down iframe (no same-origin → can't touch the UIPE session). */
function htmlDoc(text, lang) {
  if (lang === 'html') return /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (m) => m + SB_CSS) : SB_CSS + text;
  if (lang === 'css') return `<!doctype html><meta charset="utf-8">${SB_CSS}<style>${text}</style><body><h1>Heading</h1><p>Paragraph with <a href="#">link</a>.</p><button>Button</button>`;
  return `<!doctype html><meta charset="utf-8">${SB_CSS}<body><pre id="out" style="font:13px monospace"></pre><script>
const out=document.getElementById('out');const w=(...a)=>{out.textContent+=a.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' ')+'\\n'};
console.log=w;console.error=(...a)=>w('Error:',...a);window.onerror=(m)=>w('Error:',m);
</script><script>${text.replace(/<\/script/gi, '<\\/script')}</script>`;
}

/** Full-screen preview of a runnable HTML snippet. */
function PreviewModal({ title, doc, onClose, tt }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="pp-pv" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="pp-pv__box" dir="ltr" onClick={(e) => e.stopPropagation()}>
        <div className="pp-pv__bar">
          <span className="pp-run__title"><i className="pp-run__live" />{title}</span>
          <button type="button" className="pp-code__btn" onClick={onClose}><Icon name="x" size={14} /> {tt('Close', 'إغلاق')}</button>
        </div>
        <iframe title={title} className="pp-pv__frame" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={doc} />
      </div>
    </div>, document.body);
}

export default function CodeCard({ media, onRunStart, canRun = true }) {
  const { locale } = useLanguage();
  const tt = (en, ar) => (locale === 'ar' ? ar : en);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);       // expanded
  const [mode, setMode] = useState('code');      // code | run
  const [copied, setCopied] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [device, setDevice] = useState('desktop'); // desktop | mobile
  const [full, setFull] = useState(false);
  const sandbox = useSandbox(`post-${media.id}`, `/api/v1/posts/media/${media.id}/run-token`);
  const textRef = useRef('');

  useEffect(() => {
    let dead = false;
    postsApi.mediaText(media.id, mediaBaseOf(media)).then((d) => { if (!dead) { setData(d); textRef.current = d.text; } }).catch(() => { if (!dead) setErr(tt('Could not load the code.', 'تعذّر تحميل الكود.')); });
    return () => { dead = true; };
  }, [media.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lang = data?.language || media.extension || 'text';
  const runner = canRun ? (data?.runner || media.meta?.runner || 'none') : 'none';
  const output = (media.meta?.output?.text || '').trim();
  const [outOpen, setOutOpen] = useState(false);
  const outLines = output ? output.split('\n') : [];
  const lines = useMemo(() => (data?.text || '').split('\n'), [data]);
  const longCode = lines.length > MAX_LINES;
  const shown = useMemo(() => (open ? lines : lines.slice(0, MAX_LINES)), [lines, open]);
  const html = useMemo(() => highlight(shown.join('\n'), lang), [shown, lang]);
  const gutter = useMemo(() => shown.map((_, i) => i + 1).join('\n'), [shown]);

  const copy = async () => { try { await navigator.clipboard.writeText(textRef.current); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* blocked */ } };

  const runSandbox = () => {
    setMode('run');
    onRunStart?.();
    const name = media.original_name && /^[\w.\- ]+$/.test(media.original_name) ? media.original_name : `main.${media.extension || 'txt'}`;
    const zip = zipSync({ [name]: new TextEncoder().encode(textRef.current) }, { level: 1 });
    sandbox.start({ kind: 'lang', entry: name, zip, cols: 100, rows: 14 });
  };
  const run = () => { if (runner === 'html') { setMode('run'); setFrameKey((k) => k + 1); } else if (runner === 'sandbox') runSandbox(); };
  const stop = () => { if (runner === 'sandbox') sandbox.stop(); setMode('code'); setFull(false); };

  const download = async () => {
    try {
      const res = await api.blob(media.urls.download);
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = media.original_name || 'code.txt'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { /* blocked by author */ }
  };

  const previewDoc = mode === 'run' && runner === 'html' ? htmlDoc(textRef.current, String(lang).toLowerCase()) : '';
  const stLabel = sandbox.busy && sandbox.statusText ? sandbox.statusText : sandbox.phase === 'running' ? tt('Running', 'شغّال') : sandbox.phase === 'exited' ? tt('Finished', 'خلص') : sandbox.phase === 'error' ? tt('Failed', 'فشل') : tt('Connecting…', 'جاري الاتصال…');

  return (
    <div className="pp-code">
      <div className="pp-code__bar">
        <span className="pp-code__dots"><i /><i /><i /></span>
        <strong dir="ltr" className="pp-code__name">{media.original_name}</strong>
        <span className="pp-code__lang">{lang}</span>
        <span className="pp-code__sp" />
        {data && <span className="pp-code__meta">{lines.length} {tt('lines', 'سطر')}</span>}
        {runner !== 'none' && (mode === 'run'
          ? <button type="button" className="pp-code__btn is-stop" onClick={stop}><Icon name="stop" size={12} /> {tt('Stop', 'إيقاف')}</button>
          : <button type="button" className="pp-code__btn is-run" onClick={run} disabled={!data}><Icon name="play" size={12} /> {tt('Run', 'تشغيل')}</button>)}
        <button type="button" className="pp-code__btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? tt('Copied', 'اتنسخ') : tt('Copy', 'نسخ')}</button>
        {media.urls?.download && <button type="button" className="pp-code__btn is-icon" onClick={download} title={`${tt('Download', 'تنزيل')} · ${fmtBytes(media.size_bytes)}`} aria-label={tt('Download', 'تنزيل')}><Icon name="download" size={14} /></button>}
      </div>

      {err && <p className="pp-code__err">{err}</p>}
      {!data && !err && <div className="pp-skel" style={{ height: 120, borderRadius: 0 }} />}
      {data && (
        <div className="pp-code__wrap">
          <div className={`pp-code__scroll${open ? ' is-open' : ''}`}>
            <pre className="pp-code__ln" aria-hidden="true">{gutter}</pre>
            <pre className="pp-code__pre" dir="ltr"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
          </div>
          {!open && longCode && <div className="pp-code__fade" />}
        </div>
      )}
      {data && (longCode || data.truncated) && (
        <button type="button" className="pp-code__more" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
          {open ? tt('Show less', 'عرض أقل') : tt(`Show all ${lines.length} lines`, `عرض كل ${lines.length} سطر`)}
        </button>
      )}
      {output && (
        <div className="pp-out">
          <div className="pp-out__bar"><span><Icon name="terminal" size={12} /> {tt('Output', 'الناتج')} <em>{tt('· run by the author', '· شغّله الكاتب')}</em></span></div>
          <pre className={`pp-out__pre${outOpen ? ' is-open' : ''}`} dir="ltr">{outOpen ? output : outLines.slice(0, 10).join('\n')}</pre>
          {outLines.length > 10 && <button type="button" className="pp-code__more" onClick={() => setOutOpen((o) => !o)}><Icon name={outOpen ? 'chevron-up' : 'chevron-down'} size={14} />{outOpen ? tt('Show less', 'عرض أقل') : tt(`Show all ${outLines.length} lines`, `عرض كل ${outLines.length} سطر`)}</button>}
        </div>
      )}
      {!canRun && !output && data && (data.runner !== 'none' || media.meta?.runner) && <p className="pp-code__note">{tt('The author turned off running for this code.', 'الكاتب قفل تشغيل الكود ده.')}</p>}
      {data?.truncated && open && <p className="pp-code__note">{tt('Large file — only the first part is shown. Download it to see everything.', 'ملف كبير — الجزء الأول بس معروض. نزّله عشان تشوفه كله.')}</p>}

      {mode === 'run' && runner === 'html' && (
        <div className="pp-run">
          <div className="pp-run__bar">
            <span className="pp-run__title"><i className="pp-run__live" />{tt('Live preview', 'معاينة مباشرة')}</span>
            <span className="pp-run__tools">
              <button type="button" className={`pp-code__ibtn${device === 'desktop' ? ' is-on' : ''}`} onClick={() => setDevice('desktop')} title={tt('Desktop', 'كمبيوتر')} aria-label={tt('Desktop', 'كمبيوتر')} aria-pressed={device === 'desktop'}><Icon name="monitor" size={14} /></button>
              <button type="button" className={`pp-code__ibtn${device === 'mobile' ? ' is-on' : ''}`} onClick={() => setDevice('mobile')} title={tt('Mobile', 'موبايل')} aria-label={tt('Mobile', 'موبايل')} aria-pressed={device === 'mobile'}><Icon name="smartphone" size={14} /></button>
              <i className="pp-run__sep" />
              <button type="button" className="pp-code__ibtn" onClick={() => setFrameKey((k) => k + 1)} title={tt('Reload', 'إعادة تحميل')} aria-label={tt('Reload', 'إعادة تحميل')}><Icon name="refresh" size={14} /></button>
              <button type="button" className="pp-code__ibtn" onClick={() => setFull(true)} title={tt('Full screen', 'ملء الشاشة')} aria-label={tt('Full screen', 'ملء الشاشة')}><Icon name="maximize" size={14} /></button>
            </span>
          </div>
          <div className={`pp-run__stage is-${device}`}>
            <iframe key={frameKey} title={media.original_name} className="pp-run__frame" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={previewDoc} />
          </div>
        </div>
      )}
      {full && <PreviewModal title={tt('Live preview', 'معاينة مباشرة')} doc={previewDoc} onClose={() => setFull(false)} tt={tt} />}
      {mode === 'run' && runner === 'sandbox' && (
        <div className="pp-run">
          <div className="pp-run__bar">
            <span className={`pp-run__title pp-run__st is-${sandbox.phase}`}><i />{stLabel}</span>
            {(sandbox.phase === 'running' || sandbox.phase === 'exited') && <button type="button" className="pp-code__btn" onClick={() => sandbox.restart(100, 14)}><Icon name="refresh" size={13} /> {tt('Run again', 'شغّل تاني')}</button>}
          </div>
          {sandbox.error && <p className="pp-code__err">{sandbox.error}</p>}
          <Suspense fallback={<div className="pp-skel" style={{ height: 180, borderRadius: 0 }} />}><SandboxTerminal sandbox={sandbox} /></Suspense>
          {sandbox.previewUrl && <iframe title="preview" className="pp-run__frame" src={sandbox.previewUrl} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />}
        </div>
      )}
    </div>
  );
}
