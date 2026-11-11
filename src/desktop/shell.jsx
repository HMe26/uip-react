import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import BrandWordmark from '../components/BrandWordmark';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { drive, fetchDriveBlob } from '../lib/driveApi';
import { desktopApi, lockError } from './desktopApi';
import { APPS } from './apps';
import { winTitle } from './wm';
import { AppGlyph, FileGlyph, FolderGlyph } from './OsIcons';
import ContentMatches from '../components/ContentMatches';
import { useContentSearch } from '../lib/useContentSearch';
import './lock.css';

export const extOf = (n) => { const s = String(n || ''); const i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; };
const EXT_COLOR = { pdf: '#e5484d', doc: '#2b6cdf', docx: '#2b6cdf', txt: '#64748b', md: '#64748b', xls: '#16a34a', xlsx: '#16a34a', csv: '#0d9488', tsv: '#0d9488', ppt: '#ea580c', pptx: '#ea580c', zip: '#d4a017', rar: '#d4a017', png: '#8b5cf6', jpg: '#8b5cf6', jpeg: '#8b5cf6', gif: '#8b5cf6', webp: '#8b5cf6', svg: '#f59e0b', mp4: '#ec4899', mp3: '#14b8a6', js: '#eab308', ts: '#3b82f6', py: '#3b82f6', html: '#e34c26', css: '#2563eb', json: '#ca8a04', c: '#5b9bd5', cpp: '#00599c', java: '#e76f00', cs: '#8e44ad', go: '#00add8', rs: '#c2410c', php: '#6d78c4', rb: '#cc342d', kt: '#a97bff', dart: '#00b4ab', lua: '#2c2d72', pl: '#39457e', r: '#276dc3', jl: '#9558b2', sh: '#4eaa25', sql: '#e38c00', hs: '#5e5086', f90: '#734f96', pas: '#e3a51f' };
/* ── real previews for pictures and videos, so they are told apart at a glance (every other file keeps its coloured type icon) ── */
const THUMB_IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);
const THUMB_VID = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
/* Phones (and any touch device): no video previews, small images only — a preview must never cost more than the icon is worth. */
const isPhone = () => {
  try { const f = localStorage.getItem('uip.os.layout'); if (f === 'mobile') return true; if (f === 'desktop') return false; } catch { /* storage blocked */ }
  return !!window.matchMedia?.('(max-width: 820px), (pointer: coarse) and (max-height: 520px)').matches;
};
const THUMB_MAX_DESK = { image: 12 * 1024 * 1024, video: 24 * 1024 * 1024 }; // bigger files keep the type icon (no huge downloads for an icon)
const THUMB_MAX_PHONE = { image: 4 * 1024 * 1024, video: 0 };
const thumbMax = (kind) => (isPhone() ? THUMB_MAX_PHONE : THUMB_MAX_DESK)[kind];
const THUMBS = new Map(); // key -> data URL ('' = no preview possible)
const THUMB_JOBS = new Map(); // key -> Promise
let thumbRunning = 0; const thumbQueue = [];
const thumbLimit = () => (isPhone() ? 1 : 2);
const thumbSlot = () => new Promise((res) => { const go = () => { thumbRunning += 1; res(); }; if (thumbRunning < thumbLimit()) go(); else thumbQueue.push(go); });
const thumbFree = () => { thumbRunning -= 1; thumbQueue.shift()?.(); };
const thumbKey = (n) => `${n.id}:${n.size_bytes ?? ''}:${n.updated_at ?? n.version ?? ''}`;
/** Wait for an idle moment, so generating previews never competes with scrolling / opening an app. */
const idle = () => new Promise((res) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => res(), { timeout: 1500 }); else setTimeout(res, 60); });

/* Previews are remembered on this device (IndexedDB 'uip-thumbs'): the full file is downloaded ONCE, not on every visit.
   The key holds id + size + modified time, so an edited file gets a new preview. "Sign out and erase" removes the database. */
let thumbDb = null;
const openThumbDb = () => {
  if (!thumbDb) {
    thumbDb = new Promise((res) => {
      try {
        const rq = indexedDB.open('uip-thumbs', 1);
        rq.onupgradeneeded = () => { try { rq.result.createObjectStore('t'); } catch { /* exists */ } };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
      } catch { res(null); }
    });
  }
  return thumbDb;
};
const cacheGet = async (key) => {
  const db = await openThumbDb(); if (!db) return undefined;
  return new Promise((res) => { try { const rq = db.transaction('t').objectStore('t').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(undefined); } catch { res(undefined); } });
};
const cachePut = async (key, val) => {
  const db = await openThumbDb(); if (!db || !val) return;
  try { db.transaction('t', 'readwrite').objectStore('t').put(val, key); } catch { /* quota / closed: the preview is simply regenerated next time */ }
};

function drawThumb(src, w, h) {
  const max = isPhone() ? 150 : 220; const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', isPhone() ? 0.7 : 0.82);
}
async function imageThumb(blob) {
  // decode straight to a small bitmap: a 12 MP photo is never fully decoded (that is what froze phones)
  if (typeof createImageBitmap === 'function') {
    try {
      const max = isPhone() ? 150 : 220;
      const probe = await createImageBitmap(blob);
      const k = Math.min(1, max / Math.max(probe.width, probe.height));
      const w = Math.max(1, Math.round(probe.width * k)); const h = Math.max(1, Math.round(probe.height * k));
      probe.close?.();
      const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
      const out = drawThumb(bmp, bmp.width, bmp.height); bmp.close?.();
      return out;
    } catch { /* fall back to <img> below (e.g. svg / unsupported option) */ }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { try { resolve(drawThumb(img, img.naturalWidth, img.naturalHeight)); } catch { resolve(''); } URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}
function videoThumb(blob, ext) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([blob], { type: blob.type && blob.type.startsWith('video/') ? blob.type : (ext === 'webm' ? 'video/webm' : 'video/mp4') }));
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'metadata';
    let done = false;
    const end = (out) => { if (done) return; done = true; clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(out); };
    const t = setTimeout(() => end(''), 9000);
    v.onerror = () => end('');
    v.onloadedmetadata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 10); } catch { end(''); } };
    v.onseeked = () => { try { end(v.videoWidth ? drawThumb(v, v.videoWidth, v.videoHeight) : ''); } catch { end(''); } };
    v.src = url;
  });
}
function getThumb(node, kind, ext, key) {
  if (THUMBS.has(key)) return Promise.resolve(THUMBS.get(key));
  if (!THUMB_JOBS.has(key)) {
    const job = (async () => {
      const saved = await cacheGet(key);
      if (saved) { THUMBS.set(key, saved); THUMB_JOBS.delete(key); return saved; }
      await thumbSlot();
      try {
        await idle();
        const blob = await fetchDriveBlob(node.id);
        const out = kind === 'video' ? await videoThumb(blob, ext) : await imageThumb(blob);
        THUMBS.set(key, out); cachePut(key, out); return out;
      } catch { THUMBS.set(key, ''); return ''; } finally { thumbFree(); THUMB_JOBS.delete(key); }
    })();
    THUMB_JOBS.set(key, job);
  }
  return THUMB_JOBS.get(key);
}

function MediaThumb({ node, size, kind, ext, color }) {
  const ref = useRef(null);
  const key = thumbKey(node);
  const [src, setSrc] = useState(() => THUMBS.get(key) || '');
  useEffect(() => {
    if (THUMBS.has(key)) { setSrc(THUMBS.get(key)); return undefined; }
    setSrc('');
    let dead = false; let io = null;
    const run = () => getThumb(node, kind, ext, key).then((u) => { if (!dead) setSrc(u); });
    if (typeof IntersectionObserver === 'undefined' || !ref.current) run();
    else { io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); run(); } }); io.observe(ref.current); }
    return () => { dead = true; io?.disconnect(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = Math.round(size * 0.94);
  return (
    <span ref={ref} style={{ display: 'grid', placeItems: 'center', width: size, height: size }}>
      {!src ? <FileGlyph size={size} label={ext} color={color} /> : (
        <span style={{ position: 'relative', width: card, height: card, borderRadius: 9, overflow: 'hidden', background: '#111', border: '2.5px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,.35)' }}>
          <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          {kind === 'video' && (
            <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(transparent 55%, rgba(0,0,0,.45))' }}>
              <span style={{ width: card * 0.38, height: card * 0.38, borderRadius: '50%', background: 'rgba(0,0,0,.55)', border: '1.5px solid rgba(255,255,255,.85)', display: 'grid', placeItems: 'center' }}>
                <svg width={card * 0.17} height={card * 0.17} viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="#fff" /></svg>
              </span>
            </span>
          )}
          <span style={{ position: 'absolute', insetInlineEnd: 3, bottom: 3, padding: '1px 4px', borderRadius: 4, background: color, color: '#fff', fontSize: Math.max(7, card * 0.14), fontWeight: 800, lineHeight: 1.25, letterSpacing: '.3px' }}>{ext.slice(0, 4).toUpperCase()}</span>
        </span>
      )}
    </span>
  );
}

export function NodeGlyph({ node, size }) {
  if (node.type === 'folder') return <FolderGlyph size={size} project={node.kind === 'project'} />;
  const e = extOf(node.name);
  const color = EXT_COLOR[e] || '#64748b';
  const kind = THUMB_IMG.has(e) ? 'image' : THUMB_VID.has(e) ? 'video' : null;
  const phone = isPhone();
  // phone: only the big home-screen icons get a real preview (small rows in sheets / search keep the type icon), and never videos
  const room = size >= (phone ? 44 : 30);
  const big = kind ? (kind === 'video' && phone) || Number(node.size_bytes) > thumbMax(kind) : false;
  if (kind && room && !big) return <MediaThumb node={node} size={size} kind={kind} ext={e} color={color} />;
  return <FileGlyph size={size} label={e} color={color} />;
}

export function Clock({ ar, big, dateToo, bar }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), big ? 1000 : 15000); return () => clearInterval(h); }, [big]);
  const lc = ar ? 'ar-EG' : 'en-US';
  const time = now.toLocaleTimeString(lc, { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString(lc, big ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'numeric', year: 'numeric' });
  if (bar) { // menu-bar style: "Tue Oct 20  1:01 AM"
    const d = now.toLocaleDateString(lc, { weekday: 'short', month: 'short', day: 'numeric' });
    return <div className="os-clock os-clock--bar"><span>{d}</span><b>{time}</b></div>;
  }
  return big
    ? <div className="os-clock os-clock--big"><b>{time}</b><span>{date}</span></div>
    : <div className="os-clock"><b>{time}</b>{dateToo && <span>{date}</span>}</div>;
}

/** Right-click menu. items: { label, icon, onClick, danger, disabled, hint } | 'sep' */
export function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) });
  }, [menu]);
  useEffect(() => {
    const first = ref.current?.querySelector('button:not(:disabled)'); first?.focus();
    const k = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const b = [...ref.current.querySelectorAll('button:not(:disabled)')];
        const i = b.indexOf(document.activeElement);
        b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length]?.focus();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <ul ref={ref} className="os-ctx" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()}>
      {menu.items.map((m, i) => (m === 'sep'
        ? <li key={`s${i}`} className="os-ctx__sep" role="separator" />
        : (
          <li key={m.label} role="none">
            <button type="button" role="menuitem" disabled={m.disabled} className={m.danger ? 'is-danger' : ''} onClick={() => { onClose(); m.onClick?.(); }}>
              <span className="os-ctx__ic">{m.icon && <Icon name={m.icon} size={15} />}</span><span>{m.label}</span>{m.hint && <kbd>{m.hint}</kbd>}
            </button>
          </li>
        )))}
    </ul>
  );
}

/** Prompt / confirm dialog (promise-based from DesktopOS). */
export function OsDialog({ dlg, tt, onDone }) {
  const [v, setV] = useState(dlg.value || '');
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.focus();
    const dot = v.lastIndexOf('.');
    el.setSelectionRange?.(0, dlg.selectAll || dot <= 0 ? v.length : dot);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = () => { if (dlg.kind === 'prompt') { if (!v.trim()) return; onDone(v.trim()); } else onDone(true); };
  return (
    <div className="os-scrim" onPointerDown={() => onDone(null)}>
      <div className={`os-dlg${dlg.icon ? ' os-dlg--confirm' : ''}`} role="dialog" aria-modal="true" aria-label={dlg.title} onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(null); } if (e.key === 'Enter' && dlg.kind === 'confirm') ok(); }}>
        {dlg.icon && <span className={`os-dlg__ico${dlg.danger ? ' is-danger' : ''}`} aria-hidden="true"><Icon name={dlg.icon} size={26} /></span>}
        <h3>{dlg.title}</h3>
        {dlg.kind === 'prompt' ? (
          <label><span>{dlg.label}</span>
            <input ref={ref} value={v} maxLength={200} dir="auto" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} />
          </label>
        ) : <p>{dlg.text}</p>}
        {dlg.kind === 'choice' && (
          <div className="os-choices">
            {dlg.choices.map((c, i) => (
              <button key={c.id} type="button" autoFocus={i === dlg.focus} className={`os-choice${c.danger ? ' is-danger' : ''}`} onClick={() => onDone(c.id)}>
                <Icon name={c.icon || 'logout'} size={20} />
                <span><b dir="auto">{c.label}</b><small dir="auto">{c.hint}</small></span>
              </button>
            ))}
          </div>
        )}
        {dlg.kind === 'choice' && dlg.note && <p className="os-dlg__note" dir="auto">{dlg.note}</p>}
        <footer className={dlg.kind === 'choice' ? 'os-dlg__foot1' : undefined}>
          <button type="button" className="os-btn" onClick={() => onDone(null)}>{tt('Cancel', 'إلغاء')}{dlg.icon && <kbd>Esc</kbd>}</button>
          {dlg.kind !== 'choice' && <button type="button" autoFocus={dlg.kind === 'confirm'} className={`os-btn ${dlg.danger ? 'os-btn--danger' : 'os-btn--primary'}`} onClick={ok}>{dlg.action}{dlg.icon && <kbd>↵</kbd>}</button>}
        </footer>
      </div>
    </div>
  );
}

const RUN_ITEMS = [
  { cmd: 'explorer', en: 'This PC', ar: 'جهازي', glyph: 'explorer' },
  { cmd: 'settings', en: 'Settings', ar: 'الإعدادات', glyph: 'settings' },
  { cmd: 'personalize', en: 'Personalize', ar: 'التخصيص', glyph: 'personalize' },
  { cmd: 'taskmgr', en: 'Task Manager', ar: 'مدير المهام', glyph: 'taskmgr' },
  { cmd: 'bin', en: 'Recycle Bin', ar: 'سلة المحذوفات', glyph: 'bin' },
  { cmd: 'shortcuts', en: 'Keyboard shortcuts', ar: 'اختصارات الكيبورد', glyph: 'shortcuts' },
  { cmd: 'notes', en: 'Notes', ar: 'الملاحظات', glyph: 'notes' },
  { cmd: 'calendar', en: 'Calendar', ar: 'التقويم', glyph: 'calendar' },
  { cmd: 'calculator', en: 'Calculator', ar: 'الآلة الحاسبة', glyph: 'calculator' },
  { cmd: 'terminal', en: 'UIPE Terminal', ar: 'ترمينال UIPE', glyph: 'terminal' },
  { cmd: 'vscode', en: 'VS Code', ar: 'VS Code', glyph: 'vscode' },
  { cmd: 'browser', en: 'Browser', ar: 'المتصفح', glyph: 'browser' },
  { cmd: 'lock', en: 'Lock screen', ar: 'قفل الشاشة', glyph: 'lock' },
  { cmd: 'portal', en: 'Back to portal', ar: 'الرجوع للموقع', glyph: 'portal' },
  { cmd: 'logout', en: 'Sign out', ar: 'تسجيل الخروج', glyph: 'logout' },
];

export function RunDialog({ ar, tt, onRun, onClose, recents = [], onOpenRecent, onRemoveRecent, onClearRecents }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const q = v.trim().toLowerCase();
  const items = useMemo(() => RUN_ITEMS.filter((i) => !q || `${i.cmd} ${i.en} ${i.ar}`.toLowerCase().includes(q)), [q]);
  // recently opened files / folders come first (filtered by what is typed)
  const recentRows = useMemo(() => recents.filter((r) => !q || r.name.toLowerCase().includes(q)).slice(0, 6), [recents, q]);
  const content = useContentSearch(v); // matches inside file text (2+ characters)
  const contentRows = useMemo(() => content.items.slice(0, 6), [content.items]);
  const rows = useMemo(() => [...recentRows.map((r) => ({ key: `r:${r.id}`, recent: r })), ...items.map((it) => ({ key: it.cmd, cmd: it })), ...contentRows.map((c) => ({ key: `c:${c.id}`, content: c }))], [recentRows, items, contentRows]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { setSel((i) => Math.min(i, Math.max(0, rows.length - 1))); }, [rows.length]);
  useEffect(() => { listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const run = (text) => { const r = onRun(text); if (r === false) setErr(tt('Nothing matches that.', 'مش لاقي الأمر ده.')); };
  const pick = (row) => { if (row.recent) onOpenRecent?.(row.recent); else if (row.content) onOpenRecent?.({ id: row.content.id, name: row.content.name, type: 'file', size_bytes: row.content.size_bytes }); else run(row.cmd.cmd); };
  const go = () => { if (rows[sel]) pick(rows[sel]); else run(v.trim()); };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
    else if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Delete' && e.shiftKey && rows[sel]?.recent) { e.preventDefault(); onRemoveRecent?.(rows[sel].recent.id); } // Shift+Del forgets a recent item
  };
  const when = (ts) => { // "5m" / "2h" / date
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return tt('now', 'الآن');
    if (m < 60) return tt(`${m}m ago`, `من ${m} د`);
    if (m < 1440) return tt(`${Math.round(m / 60)}h ago`, `من ${Math.round(m / 60)} س`);
    return new Date(ts).toLocaleDateString(ar ? 'ar-EG' : undefined, { month: 'short', day: 'numeric' });
  };
  return (
    <div className="os-scrim os-scrim--run" onPointerDown={onClose}>
      <div className="os-dlg os-dlg--run" role="dialog" aria-modal="true" aria-label={tt('Spotlight', 'بحث سريع')} onPointerDown={(e) => e.stopPropagation()}>
        <div className="os-spot__field">
          <Icon name="search" size={20} />
          <input autoFocus value={v} placeholder={tt('Spotlight Search', 'بحث سريع')} dir="auto" spellCheck={false} autoComplete="off"
            onChange={(e) => { setV(e.target.value); setErr(''); }} onKeyDown={onKey} />
          <kbd>Esc</kbd>
        </div>
        {err && <p className="os-set__err">{err}</p>}
        {rows.length > 0 ? (
          <ul className="os-spot__list" ref={listRef} role="listbox">
            {rows.map((row, i) => {
              const r = row.recent; const it = row.cmd; const c = row.content;
              return (
                <li key={row.key} className={r ? 'os-spot__item os-spot__item--recent' : 'os-spot__item'}>
                  {i === 0 && r && (
                    <div className="os-spot__head">
                      <span>{tt('Recent', 'آخر ما فتحته')}</span>
                      {!q && onClearRecents && <button type="button" onClick={onClearRecents}>{tt('Clear', 'مسح')}</button>}
                    </div>
                  )}
                  {c && i === recentRows.length + items.length && <div className="os-spot__head"><span>{tt('Inside your files', 'داخل ملفاتك')}</span></div>}
                  {it && i === recentRows.length && recentRows.length > 0 && <div className="os-spot__head"><span>{tt('Apps & commands', 'التطبيقات والأوامر')}</span></div>}
                  <button type="button" role="option" aria-selected={i === sel} className={i === sel ? 'is-sel' : ''} onPointerEnter={() => setSel(i)} onClick={() => pick(row)}>
                    {r || c ? <NodeGlyph node={r || c} size={34} /> : <AppGlyph app={it.glyph} size={34} />}
                    {r
                      ? <span className="os-spot__txt"><b dir="auto">{r.name}</b><small>{r.type === 'folder' ? tt('Folder', 'مجلد') : tt('File', 'ملف')} · {when(r.ts)}</small></span>
                      : c
                        ? <span className="os-spot__txt"><b dir="auto">{c.name}</b><small dir="auto">{c.matches?.[0] ? `${c.matches[0].line}: ${c.matches[0].text.trim()}` : c.path}</small></span>
                        : <span className="os-spot__txt"><b>{ar ? it.ar : it.en}</b><small>{ar ? it.en : it.ar}</small></span>}
                    <kbd className="os-spot__enter" aria-hidden="true">↵</kbd>
                  </button>
                  {r && onRemoveRecent && <button type="button" className="os-spot__forget" title={tt('Remove from recent (Shift+Del)', 'إزالة من الأخيرة (Shift+Del)')} aria-label={tt('Remove from recent', 'إزالة من الأخيرة')} onClick={() => onRemoveRecent(r.id)}><Icon name="x" size={13} /></button>}
                </li>
              );
            })}
          </ul>
        ) : <p className="os-spot__none">{tt('No results', 'مفيش نتايج')}</p>}
        <footer className="os-spot__foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd>{tt('Navigate', 'تنقّل')}</span>
          <span><kbd>↵</kbd>{tt('Open', 'فتح')}</span>
          <span><kbd>Esc</kbd>{tt('Close', 'إغلاق')}</span>
        </footer>
      </div>
    </div>
  );
}

/** Launchpad: every app, search across apps + your files, user, lock / exit. */
export function StartMenu({ ar, tt, user, apps, desktopItems, onOpenApp, onOpenNode, onFound, onLock, onPortal, onLogout, onClose }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const content = useContentSearch(q); // text inside your files
  const name = user?.full_name || user?.email || tt('User', 'مستخدم');
  const list = useMemo(() => apps.filter((a) => `${a.en} ${a.ar} ${a.id}`.toLowerCase().includes(q.trim().toLowerCase())), [apps, q]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setFound([]); return undefined; }
    let dead = false;
    const h = setTimeout(async () => { try { const r = await drive.search(t); if (!dead) setFound((r.data || []).slice(0, 6)); } catch { if (!dead) setFound([]); } }, 260);
    return () => { dead = true; clearTimeout(h); };
  }, [q]);
  const submit = () => { if (list[0]) onOpenApp(list[0]); else if (found[0]) onFound(found[0]); };
  return (
    <div className="os-start" role="dialog" aria-label={tt('Launchpad', 'لوحة التطبيقات')} onPointerDown={(e) => { e.stopPropagation(); if (!e.target.closest('button, input, .os-start__search, .os-start__foot')) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="os-start__search"><Icon name="search" size={16} />
        <input autoFocus value={q} dir="auto" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={tt('Search apps and your files…', 'ابحث في التطبيقات وملفاتك…')} />
      </div>
      <div className="os-start__body">
        {/* apps may carry a `group` ({en, ar}): the platform's pages and the system apps get their own headings */}
        {(() => {
          const sections = [];
          list.forEach((a) => {
            const k = a.group ? a.group.en : '';
            let sec = sections.find((x) => x.k === k);
            if (!sec) { sec = { k, title: a.group, items: [] }; sections.push(sec); }
            sec.items.push(a);
          });
          if (!sections.length) return <><h4>{q ? tt('Apps', 'التطبيقات') : tt('Applications', 'التطبيقات')}</h4><div className="os-start__grid"><p className="os-start__empty">{tt('No matching apps.', 'مفيش تطبيقات مطابقة.')}</p></div></>;
          return sections.map((sec, i) => (
            <div key={sec.k || 'sys'}>
              <h4>{sec.title ? (ar ? sec.title.ar : sec.title.en) : (i === 0 && !q ? tt('Applications', 'التطبيقات') : q ? tt('Apps', 'التطبيقات') : tt('System', 'النظام'))}</h4>
              <div className="os-start__grid">
                {sec.items.map((a) => (
                  <button key={a.id} type="button" onClick={() => onOpenApp(a)}><AppGlyph app={a.glyph} size={64} /><span dir="auto">{ar ? a.ar : a.en}</span></button>
                ))}
              </div>
            </div>
          ));
        })()}
        {q.trim().length >= 2 && (
          <>
            <h4>{tt('My PC files', 'ملفات جهازي')}</h4>
            <div className="os-start__files">
              {found.map((n) => (
                <button key={n.id} type="button" onClick={() => onFound(n)}><NodeGlyph node={n} size={26} /><span dir="auto">{n.name}</span><small dir="auto">{n.path}</small></button>
              ))}
              {!found.length && !content.items.length && !content.loading && <p className="os-start__empty">{tt('Nothing found.', 'مفيش نتائج.')}</p>}
            </div>
            <ContentMatches res={content} tt={tt} compact max={8} onOpen={onFound} />
          </>
        )}
        {!q && desktopItems.length > 0 && (
          <>
            <h4>{tt('On your desktop', 'على سطح المكتب')}</h4>
            <div className="os-start__files">
              {desktopItems.slice(0, 4).map((n) => <button key={n.id} type="button" onClick={() => onOpenNode(n)}><NodeGlyph node={n} size={26} /><span dir="auto">{n.name}</span></button>)}
            </div>
          </>
        )}
      </div>
      <footer className="os-start__foot">
        <span className="os-start__user"><i>{String(name).trim().charAt(0).toUpperCase()}</i><span dir="auto">{name}</span></span>
        <span>
          <button type="button" title={tt('Lock (Alt+L)', 'قفل (Alt+L)')} onClick={onLock}><Icon name="lock" size={17} /></button>
          <button type="button" title={tt('Back to the portal', 'الرجوع للبوابة')} onClick={onPortal}><Icon name="home" size={17} /></button>
          {onLogout && <button type="button" className="is-danger" title={tt('Sign out', 'تسجيل الخروج')} onClick={onLogout}><Icon name="logout" size={17} /></button>}
        </span>
      </footer>
    </div>
  );
}

export function TaskView({ list, ar, tt, onPick, onClose, onCloseWin, desk = 0, desks = 1, maxDesks = 6, onDesk, onAddDesk, onRemoveDesk, onMove }) {
  const onThis = list.filter((w) => (w.d || 0) === desk);
  const countOf = (n) => list.filter((w) => (w.d || 0) === n).length;
  const card = (w) => (
    <div key={w.id} className="os-tv-card" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', w.id); e.dataTransfer.effectAllowed = 'move'; }}
      onPointerDown={(e) => e.stopPropagation()} onClick={() => onPick(w.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(w.id); }}>
      <header><AppGlyph app={w.app} size={18} /><span dir="auto">{winTitle(w, APPS, ar)}</span>
        <button type="button" aria-label={tt('Close', 'إغلاق')} onClick={(e) => { e.stopPropagation(); onCloseWin(w.id); }}><Icon name="x" size={13} /></button>
      </header>
      <div className="os-tv-card__body"><AppGlyph app={w.app} size={64} /></div>
    </div>
  );
  const dropOn = (n) => ({
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) onMove?.(id, n); },
  });
  return (
    <div className="os-taskview" onPointerDown={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} tabIndex={-1} ref={(el) => el?.focus()}>
      <div className="os-spaces" onPointerDown={(e) => e.stopPropagation()} role="tablist" aria-label={tt('Desktops', 'مساحات العمل')}>
        {Array.from({ length: desks }, (_, n) => (
          <div key={n} className={`os-space${n === desk ? ' is-on' : ''}`} {...dropOn(n)}>
            <button type="button" role="tab" aria-selected={n === desk} onClick={() => onDesk?.(n)}>
              <b>{tt(`Desktop ${n + 1}`, `مساحة ${n + 1}`)}</b><small>{countOf(n)}</small>
            </button>
            {desks > 1 && <button type="button" className="os-space__x" aria-label={tt('Remove desktop', 'حذف المساحة')} title={tt('Remove desktop (its windows move to the previous one)', 'حذف المساحة (نوافذها بتروح للي قبلها)')} onClick={() => onRemoveDesk?.(n)}><Icon name="x" size={12} /></button>}
          </div>
        ))}
        {desks < maxDesks && <button type="button" className="os-space os-space--add" {...dropOn('new')} onClick={onAddDesk} aria-label={tt('New desktop', 'مساحة جديدة')}><Icon name="plus" size={15} /></button>}
      </div>
      {onThis.length === 0 && <p className="os-taskview__empty">{tt('No open windows on this desktop.', 'مفيش نوافذ مفتوحة في المساحة دي.')}</p>}
      <div className="os-taskview__grid">{onThis.map(card)}</div>
      {desks > 1 && <p className="os-taskview__tip">{tt('Drag a window onto another desktop to move it there.', 'اسحب النافذة على مساحة تانية عشان تنقلها.')}</p>}
    </div>
  );
}

/**
 * Lock screen. No lock password set -> click / any key unlocks (as before).
 * Lock password set (Settings > Lock screen) -> the password is checked on the server; "Forgot password?" sends a
 * 6-digit code to the account's e-mail and lets the student choose a new password with it.
 */
export function LockScreen({ ar, tt, user, lockEnabled, onUnlock, onPortal, hideDetails }) {
  const name = hideDetails ? tt('Locked', 'مقفول') : (user?.full_name || user?.email || '');
  const needPw = lockEnabled !== false; // unknown (offline, first load) is treated as locked: the server answers "no password" if there is none
  const [view, setView] = useState('pw'); // 'pw' | 'reset'
  const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [np, setNp] = useState(''); const [np2, setNp2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('');
  const [wait, setWait] = useState(0);
  const [show, setShow] = useState(false); const [caps, setCaps] = useState(false); const [shake, setShake] = useState(0);
  const first = useRef(null);
  const { toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const night = theme === 'dark';
  useEffect(() => {
    if (needPw) return undefined;
    const k = (e) => { e.preventDefault(); onUnlock(); };
    const t = setTimeout(() => window.addEventListener('keydown', k, true), 150);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k, true); };
  }, [onUnlock, needPw]);
  useEffect(() => { if (needPw) first.current?.focus(); }, [needPw, view]);
  useEffect(() => { if (wait <= 0) return undefined; const h = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(h); }, [wait]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !pw) return;
    setBusy(true); setErr('');
    try { await desktopApi.lockVerify(pw); onUnlock(); } catch (x) { setErr(lockError(x)); setPw(''); setShake((n) => n + 1); first.current?.focus(); } finally { setBusy(false); }
  };
  const sendCode = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await desktopApi.lockOtp();
      setInfo(tt(`We sent a 6-digit code to ${r?.email || 'your e-mail'}.`, `بعتنا رمز من 6 أرقام على ${r?.email || 'إيميلك'}.`));
      setWait(Number(r?.retry_after) || 60); setView('reset');
    } catch (x) { setErr(lockError(x)); } finally { setBusy(false); }
  };
  const reset = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (np.length < 4) { setErr(tt('The password must be at least 4 characters.', 'الباسورد لازم يكون 4 حروف/أرقام على الأقل.')); return; }
    if (np !== np2) { setErr(tt('The two passwords do not match.', 'الباسوردين مش متطابقين.')); return; }
    setBusy(true); setErr('');
    try { await desktopApi.lockReset(code.trim(), np); onUnlock(); } catch (x) { setErr(lockError(x)); } finally { setBusy(false); }
  };

  const sub = !hideDetails && user?.email && user.email !== name ? user.email : '';
  const dir = ar ? 'rtl' : 'ltr';
  const capsKey = (e) => setCaps(!!e.getModifierState?.('CapsLock'));
  const initial = hideDetails ? null : String(name || '?').trim().charAt(0).toUpperCase();
  const features = [
    { icon: 'briefcase', t: tt('Project management', 'إدارة المشاريع'), s: tt('Track • Evaluate • Collaborate', 'متابعة • تقييم • تعاون') },
    { icon: 'file', t: tt('Online exams', 'الامتحانات الإلكترونية'), s: tt('Secure • Smart • Accurate', 'بأمان • ذكاء • دقة') },
    { icon: 'ai-spark', t: tt('AI assistant', 'الذكاء الاصطناعي'), s: tt('Helping you at every step', 'مساعدك في كل خطوة') },
    { icon: 'shield', t: tt('Safe & trusted', 'بيئة آمنة وموثوقة'), s: tt('Your data and privacy, protected', 'لحماية بياناتك وخصوصيتك') },
  ];
  const identity = (
    <div className="lk-id">
      <i className="lk-avatar" aria-hidden="true">{initial || <Icon name="lock" size={22} />}</i>
      <b dir="auto">{name}</b>
      {sub && <small dir="ltr">{sub}</small>}
    </div>
  );
  const shell = (card, extra = {}) => (
    <div className="lk" dir={dir} data-night={night ? '1' : '0'} {...extra}>
      <div className="lk-bg" aria-hidden="true">
        <i className="lk-bg__a" /><i className="lk-bg__b" /><i className="lk-bg__c" />
        <i className="lk-bg__photo" />
        <svg className="lk-bg__wave" viewBox="0 0 1200 260" preserveAspectRatio="none"><defs><linearGradient id="lkw" x1="0" x2="1"><stop offset="0" stopColor="#2563eb" stopOpacity=".05" /><stop offset=".55" stopColor="#3b82f6" stopOpacity=".55" /><stop offset="1" stopColor="#7c3aed" stopOpacity="0" /></linearGradient></defs><path d="M0 150C220 70 430 60 640 120S1020 210 1200 150V260H0Z" fill="url(#lkw)" /><path d="M0 150C220 70 430 60 640 120S1020 210 1200 150" fill="none" stroke="#93c5fd" strokeOpacity=".55" strokeWidth="2" /></svg>
      </div>
      <div className="lk-scroll">
        <header className="lk-top">
          <div className="lk-brand">
            <BrandWordmark onDark className="lk-brand__mark" width={112} height={44} />
            <span className="lk-brand__txt"><small>Unified Integrated Platform Ecosystem</small></span>
          </div>
          <div className="lk-clock" dir={dir}><Clock ar={ar} big /></div>
          <div className="lk-tools" dir="ltr">
            <button type="button" className="lk-seg" onClick={toggleTheme} aria-label={night ? tt('Light mode', 'الوضع النهاري') : tt('Dark mode', 'الوضع الليلي')} title={night ? tt('Light mode', 'الوضع النهاري') : tt('Dark mode', 'الوضع الليلي')}>
              <span className={night ? '' : 'is-on'}><Icon name="sun" size={15} /></span><span className={night ? 'is-on' : ''}><Icon name="moon" size={15} /></span>
            </button>
            <button type="button" className="lk-seg lk-seg--lang" onClick={toggleLocale} aria-label={tt('Switch language', 'تغيير اللغة')}>{ar ? 'AR' : 'EN'}<Icon name="globe" size={16} /></button>
          </div>
        </header>
        <div className="lk-main">
          <aside className="lk-hero" dir={dir}>
            <h2>{tt('From an idea', 'من فكرة')} .. {tt('to', 'إلى')} <em>{tt('achievement', 'إنجاز')}</em></h2>
            <p>{tt('A smart platform for university projects and online exams, in one place.', 'منصة ذكية تجمع بين إدارة المشاريع الجامعية والامتحانات الإلكترونية، في مكان واحد.')}</p>
            <ul>{features.map((f) => (
              <li key={f.icon}><span><Icon name={f.icon} size={20} /></span><div><b>{f.t}</b><small>{f.s}</small></div></li>
            ))}</ul>
          </aside>
          <main className="lk-card" dir={dir}>{card}</main>
          <span className="lk-sign" aria-hidden="true">Build Your Future</span>
        </div>
        <footer className="lk-foot">
          <span className="lk-pill"><Icon name="lock" size={14} />{tt('Locked', 'مقفول')}</span>
          <button type="button" className="lk-pill lk-pill--btn" onClick={toggleTheme}><Icon name={night ? 'sun' : 'moon'} size={14} />{night ? tt('Light mode', 'الوضع النهاري') : tt('Dark mode', 'الوضع الليلي')}</button>
          {onPortal && <button type="button" className="lk-pill lk-pill--btn" onClick={onPortal}>{tt('Back to portal', 'العودة للبوابة')}</button>}
        </footer>
      </div>
    </div>
  );
  const head = (
    <>
      <h1 className="lk-title">{tt('Welcome back', 'مرحباً بك مجدداً')}</h1>
      <p className="lk-sub">{tt('Enter your password to continue', 'اكتب كلمة المرور للمتابعة')}</p>
      {identity}
    </>
  );
  if (!needPw) {
    return shell(
      <>
        <h1 className="lk-title">{tt('Welcome back', 'مرحباً بك مجدداً')}</h1>
        {identity}
        <button type="button" className="lk-go" onClick={onUnlock} autoFocus>{tt('Unlock', 'فتح القفل')}<Icon name={ar ? 'arrow-left' : 'arrow-right'} size={18} /></button>
        <p className="lk-hint">{tt('Or press any key', 'أو اضغط أي زر')}</p>
      </>,
      { role: 'dialog', 'aria-modal': true, 'aria-label': tt('Locked', 'مقفول') },
    );
  }
  return shell(
    view === 'pw' ? (
      <>
        {head}
        <form className="lk-form" onSubmit={submit}>
          <div key={shake} className={`lk-row${shake ? ' is-shake' : ''}`}>
            <div className={`lk-field${err ? ' is-err' : ''}`}>
              <Icon name="lock" size={17} />
              <input ref={first} type={show ? 'text' : 'password'} value={pw} onChange={(e) => { setPw(e.target.value); if (err) setErr(''); }} onKeyDown={capsKey} onKeyUp={capsKey} onBlur={() => setCaps(false)}
                placeholder={tt('Enter your password', 'اكتب كلمة المرور')} aria-label={tt('Password', 'كلمة المرور')} autoComplete="current-password" maxLength={72} dir="auto" />
              <button type="button" className="lk-eye" onClick={() => setShow((v) => !v)} aria-label={show ? tt('Hide password', 'إخفاء الباسورد') : tt('Show password', 'إظهار الباسورد')} aria-pressed={show} tabIndex={-1}><Icon name={show ? 'eye-off' : 'eye'} size={17} /></button>
            </div>
            <button type="submit" className="lk-round" disabled={busy || !pw} aria-label={tt('Unlock', 'فتح القفل')}>{busy ? <span className="mp-spin" /> : <Icon name={ar ? 'arrow-left' : 'arrow-right'} size={20} />}</button>
          </div>
          {caps && <p className="lk-note is-warn"><Icon name="alert-triangle" size={13} />{tt('Caps Lock is on', 'زر Caps Lock مفعّل')}</p>}
          {err && <p className="lk-note is-err" role="alert">{err}</p>}
          <button type="button" className="lk-link" onClick={sendCode} disabled={busy}>{tt('Forgot password?', 'نسيت كلمة المرور؟')}</button>
          <button type="submit" className="lk-go" disabled={busy || !pw}>{busy ? <span className="mp-spin" /> : <>{tt('Unlock', 'فتح القفل')}<Icon name={ar ? 'arrow-left' : 'arrow-right'} size={18} /></>}</button>
        </form>
      </>
    ) : (
      <>
        <h1 className="lk-title">{tt('Reset your password', 'إعادة تعيين كلمة المرور')}</h1>
        <p className="lk-sub">{info}</p>
        <form className="lk-form" onSubmit={reset}>
          <input className="lk-input" ref={first} type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={tt('6-digit code', 'الرمز (6 أرقام)')} aria-label={tt('6-digit code', 'الرمز (6 أرقام)')} maxLength={6} dir="ltr" />
          <input className="lk-input" type="password" value={np} onChange={(e) => setNp(e.target.value)} placeholder={tt('New password', 'كلمة مرور جديدة')} autoComplete="new-password" maxLength={72} aria-label={tt('New password', 'كلمة مرور جديدة')} dir="auto" />
          <input className="lk-input" type="password" value={np2} onChange={(e) => setNp2(e.target.value)} placeholder={tt('Repeat new password', 'كرر كلمة المرور الجديدة')} autoComplete="new-password" maxLength={72} aria-label={tt('Repeat new password', 'كرر كلمة المرور الجديدة')} dir="auto" />
          {err && <p className="lk-note is-err" role="alert">{err}</p>}
          <button type="submit" className="lk-go" disabled={busy || code.length < 6 || !np}>{busy ? <span className="mp-spin" /> : tt('Reset password & unlock', 'غيّر كلمة المرور وافتح')}</button>
          <div className="lk-links">
            <button type="button" className="lk-link" onClick={sendCode} disabled={busy || wait > 0}>{wait > 0 ? tt(`Resend code (${wait}s)`, `إعادة إرسال الرمز (${wait}ث)`) : tt('Resend code', 'إعادة إرسال الرمز')}</button>
            <button type="button" className="lk-link" onClick={() => { setView('pw'); setErr(''); setCode(''); setNp(''); setNp2(''); }}>{tt('Back', 'رجوع')}</button>
          </div>
        </form>
      </>
    ),
    { role: 'dialog', 'aria-modal': true, 'aria-label': tt('Locked', 'مقفول') },
  );
}

/** Last minute before the automatic sign-out (Settings ▸ Security & devices ▸ Automatic sign-out). */
export function IdleWarning({ tt, left, onStay, onSignOut }) {
  return (
    <div className="os-scrim os-scrim--top">
      <div className="os-dlg os-idle" role="alertdialog" aria-modal="true" aria-label={tt('Signing out soon', 'هيتسجّل خروجك قريب')}>
        <h3><Icon name="clock" size={18} /> {tt('Still there?', 'لسه معانا؟')}</h3>
        <p>{tt(`You will be signed out for inactivity in ${left} s.`, `هيتسجّل خروجك بسبب الخمول بعد ${left} ثانية.`)}</p>
        <footer>
          <button type="button" className="os-btn" onClick={onSignOut}>{tt('Sign out now', 'خروج دلوقتي')}</button>
          <button type="button" autoFocus className="os-btn os-btn--primary" onClick={onStay}>{tt('Stay signed in', 'خلّيني مسجّل')}</button>
        </footer>
      </div>
    </div>
  );
}
