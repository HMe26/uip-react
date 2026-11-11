import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { fmtBytes } from '../../lib/postMedia';
import { zipSync } from 'fflate';
import { useSandbox } from '../zipbench/runner/useSandbox';
import { Alert, COMMENT_MODES, PAvatar, VIS, useTt } from './shared';
import LinkCard, { parseLink } from './LinkCard';
import EmojiButton, { insertAtCaret } from './EmojiButton';

const CODE_EXT = ['py', 'js', 'ts', 'html', 'css', 'php', 'java', 'c', 'cpp', 'cs', 'go', 'rb', 'sh', 'sql', 'json', 'yml', 'md'];
const SandboxTerminal = lazy(() => import('./SandboxTerminal'));
const VoiceMessage = lazy(() => import('../messaging/VoiceMessage'));
let seq = 0;

/**
 * Shown under an attached code file: (1) whether other people may run it, (2) the author's own run — "Run now" executes it once on the
 * author's side and the printed output is published together with the code, so readers see the result without running anything.
 */
function CodeRunBox({ item, allowRun, onAllowRun, onOutput, tt }) {
  const m = item.media;
  const runner = m.meta?.runner || 'none';
  const sandbox = useSandbox(`post-${m.id}`, `/api/v1/posts/media/${m.id}/run-token`);
  const [err, setErr] = useState('');
  const [fetching, setFetching] = useState(false);
  const live = sandbox.phase === 'running' || sandbox.phase === 'exited';
  const busy = fetching || (sandbox.busy && !live);

  const runNow = async () => {
    setErr(''); setFetching(true);
    try {
      const d = await postsApi.mediaText(m.id);
      const name = m.original_name && /^[\w.\- ]+$/.test(m.original_name) ? m.original_name : `main.${m.extension || 'txt'}`;
      sandbox.start({ kind: 'lang', entry: name, zip: zipSync({ [name]: new TextEncoder().encode(d.text) }, { level: 1 }), cols: 100, rows: 10 });
    } catch (e) { setErr(errorMessage(e)); } finally { setFetching(false); }
  };
  const useOutput = () => { onOutput(sandbox.getOutput?.() || ''); sandbox.stop(); };

  return (
    <div className="pp-runbox">
      <label className="pp-check"><input type="checkbox" checked={!!allowRun} onChange={(e) => onAllowRun(e.target.checked)} /> {tt('Let readers run this code', 'السماح للقرّاء بتشغيل الكود')}</label>
      <small className="pp-muted">{allowRun
        ? tt('Each run uses server resources. You can also publish the output below instead.', 'كل تشغيل بيستهلك موارد السيرفر. ممكن كمان تنشر الناتج هنا بدل ما كل واحد يشغّل.')
        : tt('Readers will only see the code and the output you attach below.', 'القرّاء هيشوفوا الكود والناتج اللي ترفقه تحت بس.')}</small>
      {runner === 'sandbox' && (
        <>
          <div className="pp-row">
            {live
              ? <button type="button" className="pp-btn is-primary" onClick={useOutput}>{tt('Use this output', 'استخدم الناتج ده')}</button>
              : <button type="button" className="pp-btn" onClick={runNow} disabled={busy}><Icon name="play" size={13} /> {busy ? tt('Starting…', 'بيبدأ…') : tt('Run now & attach the output', 'شغّله دلوقتي وأرفق الناتج')}</button>}
            {live && <button type="button" className="pp-btn" onClick={() => sandbox.stop()}>{tt('Stop', 'إيقاف')}</button>}
          </div>
          {(live || busy || sandbox.phase === 'error') && (
            <div className="pp-runbox__term">
              {sandbox.error && <p className="pp-code__err">{sandbox.error}</p>}
              <Suspense fallback={<div className="pp-skel" style={{ height: 120 }} />}><SandboxTerminal sandbox={sandbox} /></Suspense>
            </div>
          )}
        </>
      )}
      {err && <small className="pp-err">{err}</small>}
      <label className="pp-runbox__lbl">{tt('Output shown under the code (optional)', 'الناتج اللي يظهر تحت الكود (اختياري)')}
        <textarea className="pp-input pp-input--code" dir="ltr" rows={4} maxLength={8000} spellCheck={false} value={item.output ?? ''} onChange={(e) => onOutput(e.target.value)} placeholder="Hello, world!" />
      </label>
    </div>
  );
}

const LANG_NAMES = { py: 'Python', js: 'JavaScript', ts: 'TypeScript', html: 'HTML', css: 'CSS', php: 'PHP', java: 'Java', c: 'C', cpp: 'C++', cs: 'C#', go: 'Go', rb: 'Ruby', sh: 'Shell', sql: 'SQL', json: 'JSON', yml: 'YAML', md: 'Markdown' };

/** Guess the language from what was pasted (only used until the author picks one by hand). */
function detectLang(t) {
  const s = t.trim().slice(0, 1500);
  if (!s) return null;
  if (/^<!doctype html|^<html[\s>]|^<(div|section|main|header|body|head|style|script|ul|p|h[1-6])[\s>]/i.test(s)) return 'html';
  if (/^<\?php/.test(s)) return 'php';
  if (/^#include\s*[<"]/m.test(s)) return /std::|cout|using namespace|class\s+\w+\s*[{:]/.test(s) ? 'cpp' : 'c';
  if (/^package\s+main|^func\s+\w+\(/m.test(s)) return 'go';
  if (/public\s+(static\s+)?(class|void)|System\.out\.print/.test(s)) return 'java';
  if (/^\s*(select|insert\s+into|update|create\s+table)\b[\s\S]*\b(from|into|set|\()/i.test(s)) return 'sql';
  if (/^#!\/bin\/(ba)?sh|^\s*(echo|sudo|apt|npm|cd)\s/m.test(s)) return 'sh';
  if (/:\s*(string|number|boolean)\b|^interface\s+\w+|^type\s+\w+\s*=/m.test(s)) return 'ts';
  if (/\bconsole\.log\(|\bconst\s+\w+\s*=|\blet\s+\w+\s*=|=>\s*[{(]|^\s*function\s+\w+\(|\brequire\(|^import\s.+from\s/m.test(s)) return 'js';
  if (/^\s*def\s+\w+\(.*\):|^\s*print\(|^\s*(import\s+\w+|from\s+\w+\s+import)|^\s*class\s+\w+.*:/m.test(s)) return 'py';
  if (/^[.#]?[\w-]+\s*\{[^}]*:[^}]*;/m.test(s)) return 'css';
  if (/^\s*[{[]/.test(s) && /"\s*:/.test(s)) return 'json';
  return null;
}

function fileKind(i) {
  if (i.media?.kind) return i.media.kind;
  const f = i.file; const t = f?.type || ''; const ext = String(i.name || '').split('.').pop().toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (CODE_EXT.includes(ext)) return 'code';
  if (ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'file';
}
const KIND_ICON = { image: 'image', video: 'video', audio: 'audio-wave', code: 'terminal', pdf: 'file', archive: 'folder', file: 'file' };

/** A blob: URL for a local File that is released when the row goes away. */
function useObjectUrl(file, enabled) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file || !enabled) { setUrl(null); return undefined; }
    const u = URL.createObjectURL(file); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, enabled]);
  return url;
}

function FileRow({ i, tt, onRemove, onRetry, children }) {
  const kind = fileKind(i);
  const thumb = useObjectUrl(i.file, kind === 'image');
  const audio = useObjectUrl(i.file, kind === 'audio');
  const pct = Math.round(i.progress || 0);
  return (
    <li className={`pp-fi is-${i.status}`} data-kind={kind}>
      <span className="pp-fi__ico">{thumb ? <img src={thumb} alt="" /> : <Icon name={KIND_ICON[kind] || 'file'} size={20} />}</span>
      <div className="pp-fi__main">
        <strong className="pp-fi__name"><bdi dir="ltr">{i.name}</bdi></strong>
        <span className="pp-fi__meta">
          <bdi dir="ltr">{fmtBytes(i.size)}</bdi>
          {i.status === 'up' && <><i>•</i><b>{tt('Uploading', 'جارٍ الرفع')} <bdi dir="ltr">{pct}%</bdi></b></>}
          {i.status === 'done' && <><i>•</i><b className="is-ok"><Icon name="check" size={12} /> {tt('Ready', 'تم الرفع')}</b></>}
          {i.status === 'err' && <><i>•</i><b className="is-err">{i.error}</b></>}
        </span>
        {i.status === 'up' && <i className="pp-bar"><b style={{ width: `${pct}%` }} /></i>}
      </div>
      {i.status === 'err' && i.file && <button type="button" className="pp-icon" onClick={() => onRetry(i)} aria-label={tt('Retry', 'إعادة المحاولة')}><Icon name="refresh" size={15} /></button>}
      <button type="button" className="pp-icon" onClick={() => onRemove(i)} aria-label={tt('Remove', 'إزالة')}><Icon name="x" size={15} /></button>
      {kind === 'audio' && audio && (
        <div className="pp-fi__audio"><Suspense fallback={<div className="pp-skel" style={{ height: 44 }} />}><VoiceMessage src={audio} name={i.name} downloadable={false} /></Suspense></div>
      )}
      {children}
    </li>
  );
}

/** Language picker: a themed listbox rendered in a portal (so the composer's overflow never clips it) that flips upward near the screen edge. */
function LangSelect({ value, options, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const room = window.innerHeight - r.bottom;
    const up = room < 280 && r.top > room;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 232)), minWidth: Math.max(r.width, 210), ...(up ? { bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(300, r.top - 16) } : { top: r.bottom + 6, maxHeight: Math.min(300, room - 16) }) });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    setCur(Math.max(0, options.indexOf(value)));
    const down = (e) => { if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) close(); };
    const scroll = (e) => { if (!list.current?.contains(e.target)) close(); };
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) list.current?.children[cur]?.scrollIntoView({ block: 'nearest' }); }, [cur, open, pos]);

  const pick = (v) => { onChange(v); close(); btn.current?.focus(); };
  const key = (e) => {
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); } return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); setCur((i) => Math.min(options.length - 1, i + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((i) => Math.max(0, i - 1)); } else if (e.key === 'Home') { e.preventDefault(); setCur(0); } else if (e.key === 'End') { e.preventDefault(); setCur(options.length - 1); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[cur]); }
  };
  return (
    <div className="pp-sel" dir="ltr">
      <button type="button" ref={btn} className="pp-sel__btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} onKeyDown={key}>
        <span><b>{value}</b>{LANG_NAMES[value] && <em>{LANG_NAMES[value]}</em>}</span><Icon name="chevron-down" size={14} />
      </button>
      {open && pos && createPortal(
        <ul className="pp-sel__list is-fixed" dir="ltr" role="listbox" ref={list} aria-label={label} style={pos}>
          {options.map((o, idx) => (
            <li key={o} role="option" aria-selected={o === value} className={`pp-sel__opt${o === value ? ' is-on' : ''}${idx === cur ? ' is-cur' : ''}`} onMouseEnter={() => setCur(idx)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <span><b>{o}</b>{LANG_NAMES[o] && <em>{LANG_NAMES[o]}</em>}</span>{o === value && <Icon name="check" size={14} />}
            </li>
          ))}
        </ul>, document.body)}
    </div>
  );
}

/** Code editor for the snippet: line numbers, Tab key, language auto-detect, counters. */
function CodeEditor({ code, setCode, onAttach, onCancel, tt }) {
  const ta = useRef(null);
  const gut = useRef(null);
  const lines = useMemo(() => code.text.split('\n').length, [code.text]);
  const rows = Math.min(22, Math.max(9, lines));
  const nums = useMemo(() => Array.from({ length: Math.max(lines, rows) }, (_, n) => n + 1).join('\n'), [lines, rows]);
  const change = (text) => setCode((c) => ({ ...c, text, ...(!c.touched ? { ext: detectLang(text) || c.ext } : {}) }));
  const onKey = (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget; const { selectionStart: a, selectionEnd: b } = el;
      change(`${code.text.slice(0, a)}  ${code.text.slice(b)}`);
      requestAnimationFrame(() => { el.selectionStart = a + 2; el.selectionEnd = a + 2; });
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && code.text.trim()) { e.preventDefault(); onAttach(); }
  };
  return (
    <div className="pp-ide">
      <div className="pp-ide__bar">
        <span className="pp-ide__dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="pp-ide__file" dir="ltr">snippet.{code.ext}</span>
        <span className="pp-sp" />
        <LangSelect value={code.ext} options={CODE_EXT} label={tt('Language', 'اللغة')} onChange={(ext) => setCode((c) => ({ ...c, ext, touched: true }))} />
      </div>
      <p className="pp-ide__hint"><Icon name="play" size={11} /> {tt('Runnable languages get a Run button on the post.', 'اللغات القابلة للتشغيل يظهر لها زر تشغيل.')}</p>
      <div className="pp-ide__body" dir="ltr">
        <pre className="pp-ide__ln" ref={gut} aria-hidden="true" style={{ height: `calc(${rows} * 1.65 * 13px + 28px)` }}>{nums}</pre>
        <textarea ref={ta} className="pp-ide__ta" style={{ '--rows': rows }} rows={rows} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" autoFocus value={code.text}
          onChange={(e) => change(e.target.value)} onKeyDown={onKey} onScroll={(e) => { if (gut.current) gut.current.scrollTop = e.currentTarget.scrollTop; }}
          placeholder={'// ' + tt('Paste or type your code here', 'ألصق الكود أو اكتبه هنا')} aria-label={tt('Code', 'الكود')} />
      </div>
      <div className="pp-ide__foot">
        <small>{lines} {tt('lines', 'سطر')} · {code.text.length.toLocaleString()} {tt('chars', 'حرف')}</small>
        <span className="pp-sp" />
        <button type="button" className="pp-btn" onClick={onCancel}>{tt('Cancel', 'إلغاء')}</button>
        <button type="button" className="pp-btn is-primary" onClick={onAttach} disabled={!code.text.trim()}><Icon name="check" size={14} /> {tt('Attach code', 'إرفاق الكود')}</button>
      </div>
    </div>
  );
}

const BARS = 40;
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Voice-note recorder: live level waveform, timer, pause / resume, discard, done. Starts the microphone on mount. */
function Recorder({ tt, onDone, onCancel, onError }) {
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const wave = useRef(null);
  const h = useRef({ mr: null, discard: false, ms: 0, t0: 0, paused: false });

  useEffect(() => {
    const s = h.current;
    let dead = false; let raf = 0; let ctx = null; let stream = null; let last = 0; let timer = 0;
    const levels = new Array(BARS).fill(0);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        const mime = pickMime();
        const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        const type = mr.mimeType || mime || 'audio/webm';
        const ext = /ogg/.test(type) ? 'ogg' : /mp4/.test(type) ? 'm4a' : 'weba';
        const chunks = [];
        mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        mr.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (s.discard || !chunks.length) return;
          const total = Math.round((s.ms + (s.t0 ? performance.now() - s.t0 : 0)) / 1000);
          onDone(new File([new Blob(chunks, { type })], `voice-${Date.now()}.${ext}`, { type }), total);
        };
        s.mr = mr; mr.start(250); s.t0 = performance.now(); setReady(true);
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ctx = new AC();
          const an = ctx.createAnalyser(); an.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const loop = (t) => {
            raf = requestAnimationFrame(loop);
            if (s.paused || t - last < 70) return;
            last = t; an.getByteTimeDomainData(buf);
            let sum = 0; for (let k = 0; k < buf.length; k += 1) { const d = (buf[k] - 128) / 128; sum += d * d; }
            levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 5)); levels.shift();
            const kids = wave.current?.children;
            if (kids) for (let k = 0; k < kids.length; k += 1) kids[k].style.transform = `scaleY(${0.1 + levels[k] * 0.9})`;
          };
          raf = requestAnimationFrame(loop);
        }
        timer = setInterval(() => { if (!s.paused && s.t0) setSecs(Math.floor((s.ms + performance.now() - s.t0) / 1000)); }, 200);
      } catch { if (!dead) onError(); }
    })();
    return () => {
      dead = true; cancelAnimationFrame(raf); clearInterval(timer);
      if (s.mr && s.mr.state !== 'inactive') { s.discard = true; s.mr.stop(); }
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close?.().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePause = () => {
    const s = h.current; if (!s.mr) return;
    if (s.paused) { s.mr.resume(); s.t0 = performance.now(); s.paused = false; setPaused(false); }
    else { s.mr.pause(); s.ms += performance.now() - s.t0; s.t0 = 0; s.paused = true; setPaused(true); }
  };
  const discard = () => { const s = h.current; s.discard = true; if (s.mr && s.mr.state !== 'inactive') s.mr.stop(); onCancel(); };
  const finish = () => { const s = h.current; if (!s.mr || saving) return; setSaving(true); s.discard = false; if (s.mr.state !== 'inactive') s.mr.stop(); };

  return (
    <div className="pp-rec" role="group" aria-label={tt('Voice note recorder', 'تسجيل صوتي')}>
      <button type="button" className="pp-rec__btn is-discard" onClick={discard} title={tt('Discard', 'حذف التسجيل')} aria-label={tt('Discard', 'حذف التسجيل')}><Icon name="trash" size={18} /></button>
      <span className={`pp-rec__dot${paused || !ready ? ' is-paused' : ''}`} aria-hidden="true" />
      <span className="pp-rec__time" dir="ltr">{mmss(secs)}</span>
      <div className={`pp-rec__wave${paused ? ' is-paused' : ''}`} ref={wave} aria-hidden="true">{Array.from({ length: BARS }, (_, k) => <i key={k} />)}</div>
      <button type="button" className="pp-rec__btn" onClick={togglePause} disabled={!ready || saving} title={paused ? tt('Resume', 'استكمال') : tt('Pause', 'إيقاف مؤقت')} aria-label={paused ? tt('Resume', 'استكمال') : tt('Pause', 'إيقاف مؤقت')}><Icon name={paused ? 'mic' : 'pause'} size={18} /></button>
      <button type="button" className="pp-rec__done" onClick={finish} disabled={!ready || saving || secs < 1}><Icon name="check" size={16} /> {tt('Done', 'تم')}</button>
    </div>
  );
}

/** Create (or edit, when `post` is given) a post: text, files of any kind (chunked when big), code snippet, voice note, audience & settings, schedule, draft. */
export default function Composer({ config, me, post, onSaved, onCancel }) {
  const { tt, locale } = useTt();
  const editing = !!post;
  const lim = config?.limits || {};
  const [title, setTitle] = useState(post?.title || '');
  const [body, setBody] = useState(post?.body || '');
  const bodyRef = useRef(null);
  const addEmoji = (e) => { const v = insertAtCaret(bodyRef.current, body, e, lim.max_body || 6000); if (v != null) setBody(v); };
  const [link, setLink] = useState(post?.link_url || '');
  const [vis, setVis] = useState(post?.visibility || (config?.visibilities?.includes('public') ? 'public' : 'followers'));
  const [mode, setMode] = useState(post?.comments_mode || 'everyone');
  const [opts, setOpts] = useState({ allow_download: post?.allow_download ?? true, allow_run: post?.allow_run ?? false, allow_repost: post?.allow_repost ?? true, hide_counts: post?.hide_counts ?? false, is_sensitive: post?.is_sensitive ?? false });
  const [items, setItems] = useState(() => (post?.media || []).map((m) => ({ key: `m${m.id}`, status: 'done', media: m, name: m.original_name, size: m.size_bytes, output: m.meta?.output?.text || '', outputTouched: false })));
  const [open, setOpen] = useState(editing || false);
  // (declared after `open`: reading it in the deps array before its declaration threw a ReferenceError and took the whole page down with the 500 screen)
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [body, open]);
  const [more, setMore] = useState(false);
  const [showTitle, setShowTitle] = useState(!!post?.title);
  const [showLink, setShowLink] = useState(!!post?.link_url);
  const [code, setCode] = useState(null); // { ext, text, touched }
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recOn, setRecOn] = useState(false);
  const fileRef = useRef(null);
  const ctl = useRef(new Map());

  useEffect(() => () => { ctl.current.forEach((c) => c.abort()); }, []);

  const uploading = items.some((i) => i.status === 'up');
  const upload = (file) => {
    const key = `u${++seq}`;
    const ac = new AbortController(); ctl.current.set(key, ac);
    setItems((p) => [...p, { key, status: 'up', progress: 0, name: file.name, size: file.size, file }]);
    const upd = (patch) => setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    postsApi.uploadMedia(file, { signal: ac.signal, onProgress: (pct) => upd({ progress: pct }) })
      .then((m) => upd({ status: 'done', media: m, progress: 100 }))
      .catch((e) => upd({ status: 'err', error: ac.signal.aborted ? tt('Cancelled', 'أُلغي') : errorMessage(e) }))
      .finally(() => ctl.current.delete(key));
  };
  const addFiles = (list) => {
    setOpen(true);
    const room = (lim.max_media_per_post || 20) - items.length;
    Array.from(list).slice(0, Math.max(0, room)).forEach((f) => {
      if (lim.max_file_mb && f.size > lim.max_file_mb * 1048576) { setErr(tt(`${f.name} is larger than ${lim.max_file_mb} MB.`, `${f.name} أكبر من ${lim.max_file_mb} ميجا.`)); return; }
      upload(f);
    });
  };
  const remove = (i) => {
    ctl.current.get(i.key)?.abort();
    if (i.status === 'done' && i.media && !i.media.post_id) postsApi.deleteMedia(i.media.id).catch(() => {});
    setItems((p) => p.filter((x) => x.key !== i.key));
  };
  const retry = (i) => { setItems((p) => p.filter((x) => x.key !== i.key)); if (i.file) upload(i.file); };

  const addCode = () => {
    if (!code?.text.trim()) return;
    upload(new File([code.text], `snippet.${code.ext}`, { type: 'text/plain' }));
    setCode(null);
  };
  const onPaste = (e) => { const fs = Array.from(e.clipboardData?.files || []); if (fs.length) { e.preventDefault(); addFiles(fs); } };
  const onDrop = (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } };

  const submit = async (draft = false) => {
    if (busy || uploading) return;
    setBusy(true); setErr('');
    const tags = Array.from(new Set((body.match(/#[\p{L}\p{N}_]{2,50}/gu) || []).map((t) => t.slice(1)))).slice(0, lim.max_hashtags || 10);
    const payload = {
      title, body, link_url: link, visibility: vis, comments_mode: mode, ...opts, tags,
      media_ids: items.filter((i) => i.status === 'done').map((i) => i.media.id),
      media_details: Object.fromEntries(items.filter((i) => i.status === 'done' && i.media.kind === 'code' && i.outputTouched).map((i) => [i.media.id, { output: i.output || '' }])),
      ...(draft ? { draft: true } : {}), ...(when ? { scheduled_at: new Date(when).toISOString() } : {}),
    };
    try {
      const saved = editing ? await postsApi.update(post.id, payload) : await postsApi.create(payload);
      onSaved?.(saved, { draft, scheduled: !!when });
      if (!editing) { setTitle(''); setBody(''); setLink(''); setItems([]); setWhen(''); setOpen(false); setShowTitle(false); setShowLink(false); }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  const empty = !title.trim() && !body.trim() && !link.trim() && !items.some((i) => i.status === 'done');
  const flag = (k, en, ar) => <label className="pp-check"><input type="checkbox" checked={!!opts[k]} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} /> {tt(en, ar)}</label>;

  return (
    <section className={`pp-composer${open ? ' is-open' : ''}`} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="pp-composer__top">
        <PAvatar user={me} />
        {!open
          ? <button type="button" className="pp-composer__fake" onClick={() => setOpen(true)}>{tt('Share a thought, a PDF, code, a video…', 'شارك فكرة أو PDF أو كود أو فيديو…')}</button>
          : (
            <div className="pp-composer__fields">
              {showTitle && <input className="pp-input pp-input--title" maxLength={lim.max_title || 180} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tt('Title', 'العنوان')} />}
              <textarea ref={bodyRef} className="pp-input pp-input--body" dir={body ? 'auto' : (locale === 'ar' ? 'rtl' : 'ltr')} rows={3} autoFocus maxLength={lim.max_body || 6000} value={body} onChange={(e) => setBody(e.target.value)} onPaste={onPaste}
                placeholder={tt("What's on your mind?", 'بماذا تفكر؟')} aria-label={tt('Post text', 'نص المنشور')} />
              {!body && <small className="pp-composer__hint">{tt('Add tags like', 'أضف وسومًا مثل')} <bdi dir="ltr">#design</bdi> <bdi dir="ltr">#project</bdi></small>}
              {showLink && (
                <div className="pp-linkfield">
                  <div className="pp-linkfield__row">
                    <Icon name="link" size={15} />
                    <input className="pp-input" dir="ltr" type="url" autoFocus={!link} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label={tt('Link', 'رابط')} />
                    <button type="button" className="pp-icon" onClick={() => { setLink(''); setShowLink(false); }} aria-label={tt('Remove link', 'إزالة الرابط')}><Icon name="x" size={15} /></button>
                  </div>
                  {parseLink(link) && <LinkCard url={link} compact />}
                </div>
              )}
            </div>
          )}
      </div>

      {open && (
        <>
          {items.length > 0 && (
            <ul className="pp-files">
              {items.map((i) => (
                <FileRow key={i.key} i={i} tt={tt} onRemove={remove} onRetry={retry}>
                  {i.status === 'done' && i.media?.kind === 'code' && (
                    <CodeRunBox item={i} tt={tt} allowRun={opts.allow_run} onAllowRun={(v) => setOpts((o) => ({ ...o, allow_run: v }))}
                      onOutput={(text) => setItems((p) => p.map((x) => (x.key === i.key ? { ...x, output: text, outputTouched: true } : x)))} />
                  )}
                </FileRow>
              ))}
            </ul>
          )}

          {code && <CodeEditor code={code} setCode={setCode} onAttach={addCode} onCancel={() => setCode(null)} tt={tt} />}

          {recOn ? (
            <Recorder tt={tt} onDone={(file) => { upload(file); setRecOn(false); }} onCancel={() => setRecOn(false)} onError={() => { setRecOn(false); setErr(tt('Microphone is not available.', 'الميكروفون غير متاح.')); }} />
          ) : (
            <div className="pp-composer__bar">
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              <button type="button" className="pp-icon" title={tt('Photos, videos, PDF, slides, files', 'صور، فيديو، PDF، عروض، ملفات')} aria-label={tt('Attach files', 'إرفاق ملفات')} onClick={() => fileRef.current?.click()}><Icon name="paperclip" size={18} /></button>
              <button type="button" className={`pp-icon${code ? ' is-on' : ''}`} title={tt('Code snippet', 'مقتطف كود')} aria-label={tt('Code snippet', 'مقتطف كود')} onClick={() => setCode(code ? null : { ext: 'py', text: '', touched: false })}><Icon name="terminal" size={18} /></button>
              <EmojiButton onPick={addEmoji} up />
              <button type="button" className="pp-icon" title={tt('Voice note', 'تسجيل صوتي')} aria-label={tt('Voice note', 'تسجيل صوتي')} onClick={() => { setErr(''); setRecOn(true); setOpen(true); }}><Icon name="mic" size={18} /></button>
              {!showTitle && <button type="button" className="pp-icon" title={tt('Add title', 'عنوان')} aria-label={tt('Add title', 'عنوان')} onClick={() => setShowTitle(true)}><Icon name="ed-type" size={18} /></button>}
              {!showLink && <button type="button" className="pp-icon" title={tt('Add link', 'رابط')} aria-label={tt('Add link', 'رابط')} onClick={() => setShowLink(true)}><Icon name="link" size={18} /></button>}
              <span className="pp-sp" />
              <select className="pp-input pp-input--sm" value={vis} onChange={(e) => setVis(e.target.value)} aria-label={tt('Audience', 'الجمهور')}>
                {(config?.visibilities || Object.keys(VIS)).filter((v) => v !== 'selected').map((v) => <option key={v} value={v}>{tt(VIS[v]?.en || v, VIS[v]?.ar || v)}</option>)}
              </select>
              <button type="button" className={`pp-icon${more ? ' is-on' : ''}`} title={tt('Settings', 'الإعدادات')} aria-label={tt('Settings', 'الإعدادات')} onClick={() => setMore((m) => !m)}><Icon name="settings" size={18} /></button>
            </div>
          )}

          {more && (
            <div className="pp-panel pp-settings">
              <label>{tt('Who can comment', 'من يمكنه التعليق')}
                <select className="pp-input" value={mode} onChange={(e) => setMode(e.target.value)}>{(config?.comments_modes || Object.keys(COMMENT_MODES)).map((m) => <option key={m} value={m}>{tt(COMMENT_MODES[m]?.en || m, COMMENT_MODES[m]?.ar || m)}</option>)}</select></label>
              {flag('allow_download', 'Allow downloading files', 'السماح بتنزيل الملفات')}
              {config?.allow_reposts !== false && flag('allow_repost', 'Allow reposts', 'السماح بإعادة النشر')}
              {flag('hide_counts', 'Hide reaction counts', 'إخفاء أعداد التفاعل')}
              {flag('is_sensitive', 'Mark media as sensitive', 'وسائط حساسة (تُخفى حتى الضغط)')}
              {config?.allow_scheduling && !editing && <label>{tt('Schedule for later', 'جدولة للنشر لاحقًا')}<input className="pp-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>}
            </div>
          )}

          {err && <Alert tt={tt}>{err}</Alert>}
          <div className="pp-composer__foot">
            {onCancel || !editing ? <button type="button" className="pp-btn" onClick={() => { if (onCancel) onCancel(); else setOpen(false); }}>{tt('Cancel', 'إلغاء')}</button> : null}
            <span className="pp-sp" />
            {!editing && <button type="button" className="pp-btn" disabled={busy || uploading || empty} onClick={() => submit(true)}>{tt('Save draft', 'حفظ كمسودة')}</button>}
            <button type="button" className="pp-btn is-primary" disabled={busy || uploading || empty} onClick={() => submit(false)}>
              {uploading ? tt('Uploading…', 'جارٍ الرفع…') : editing ? tt('Save changes', 'حفظ التعديلات') : when ? tt('Schedule', 'جدولة') : tt('Post', 'نشر')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
