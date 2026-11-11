import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import ShareDialog, { copyText } from '../components/ShareDialog';
import { StModal, timeAgo } from '../components/student/stUi';
import { errorMessage } from '../api/client';
import { drive, fetchDownload, fetchDriveBlob } from '../lib/driveApi';
import { useDriveMarks, tagColor } from '../lib/driveMarks';
import { extOf } from '../lib/driveFileKinds';
import { SMART_PRESETS, cleanRules, matchSmart, newSmartId, useLibraryPrefs } from '../lib/libraryPrefs';
import { KINDS, KIND_BY_KEY, LANGS, fmtSize, hostOf, kindOf, makeLinkFile, normalizeUrl, parseLinkFile, safeName } from '../lib/libraryKinds';
import { myPcPath } from '../config/myPc';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { usePageMeta } from '../context/PageMetaContext';
import '../styles/css/my-library.css';

/**
 * My Library (مكتبتي): one page that sorts everything in My PC by type — images, videos, audio, documents, notes, links, code…
 * — so you can find, preview, share (link or QR), move and organise it from one place. You can also add things here
 * directly (upload files, save a link, write a note, paste a code snippet); they are stored as ordinary My PC files
 * under "My Library/<type>", so they show up in My PC too and every sharing option works on them.
 */
const LIB_ROOT = 'My Library';
/** The element that actually scrolls the page (the app shell scrolls inside a container, not the window). */
const scrollParent = (el) => {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
};
const PREVIEW_TEXT_MAX = 200000;
const THUMB_MAX_BYTES = 4 * 1024 * 1024;
const NO_THUMB = new Set(['heic', 'heif', 'tif', 'tiff', 'ico']);
const idOf = (r) => (r?.data ?? r)?.id;

// ---- thumbnails: at most 3 downloads at a time ----
let activeThumbs = 0;
const thumbQueue = [];
function runThumb(job) {
  return new Promise((resolve, reject) => {
    const go = () => { activeThumbs += 1; job().then(resolve, reject).finally(() => { activeThumbs -= 1; const n = thumbQueue.shift(); if (n) n(); }); };
    if (activeThumbs < 3) go(); else thumbQueue.push(go);
  });
}

function Thumb({ node, kind }) {
  const ref = useRef(null);
  const [url, setUrl] = useState('');
  const can = kind === 'image' && node.size_bytes <= THUMB_MAX_BYTES && !NO_THUMB.has(extOf(node.name));
  useEffect(() => {
    if (!can || !ref.current) return undefined;
    let off = false; let made = '';
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      runThumb(() => fetchDriveBlob(node.id)).then((b) => { if (off) return; made = URL.createObjectURL(b); setUrl(made); }).catch(() => {});
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => { off = true; io.disconnect(); if (made) URL.revokeObjectURL(made); };
  }, [can, node.id]);
  const k = KIND_BY_KEY[kind];
  return (
    <div ref={ref} className="lib-thumb" style={{ '--k': k.color }}>
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name={k.icon} size={30} />}
    </div>
  );
}

function Modal({ title, onClose, children, actions }) { return <StModal title={title} onClose={onClose} actions={actions}>{children}</StModal>; }

export default function MyLibrary() {
  const { user } = useAuth();
  const uid = user?.id;
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  const navigate = useNavigate();
  usePageMeta(tt('My Library', 'مكتبتي'), tt('Everything in My PC, sorted by type — find, preview, share and move it from one place.', 'كل اللي في جهازي مرتّب حسب النوع — دوّر وشوف وشارك وانقل من مكان واحد.'));
  const marks = useDriveMarks(uid);

  const [nodes, setNodes] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const prefs = useLibraryPrefs(uid); // hidden items, source, view and smart folders — synced to the server
  const { source, view, hidden, smart } = prefs; // source: all = whole My PC · lib = only what lives in "My Library"
  const { setSource, setView } = prefs;
  const [sort, setSort] = useState('new');
  const [smartEdit, setSmartEdit] = useState(null); // smart folder being created / edited
  const [sel, setSel] = useState(() => new Set());
  const [shareNodes, setShareNodes] = useState(null);
  const [preview, setPreview] = useState(null);
  const [adding, setAdding] = useState(null); // 'link' | 'note' | 'code'
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [linkUrls, setLinkUrls] = useState({}); // id -> address read from the .url file
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const toastT = useRef(0);
  useEffect(() => () => clearTimeout(toastT.current), []);

  const say = useCallback((msg, kind) => {
    setToast({ msg, kind, id: Date.now() });
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), kind === 'error' ? 4500 : 2500);
  }, []);

  const load = useCallback(async () => {
    try { setError(''); const r = await drive.manifest(); setNodes(r?.items || []); } catch (e) { setError(errorMessage(e)); setNodes((p) => p || []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (cat.startsWith('smart:') && !smart.some((x) => `smart:${x.id}` === cat)) setCat('all'); }, [cat, smart]);

  // ---- structure ----
  const byId = useMemo(() => new Map((nodes || []).map((n) => [n.id, n])), [nodes]);
  const libRoot = useMemo(() => (nodes || []).find((n) => n.type === 'folder' && n.parent_id == null && n.name === LIB_ROOT) || null, [nodes]);
  const inLib = useCallback((n) => { if (!libRoot) return false; for (let c = n, i = 0; c && i < 40; i += 1) { if (c.parent_id === libRoot.id) return true; c = byId.get(c.parent_id); } return false; }, [libRoot, byId]);
  const pathOf = useCallback((n) => { const p = []; for (let c = byId.get(n.parent_id), i = 0; c && i < 30; i += 1) { p.unshift(c.name); c = byId.get(c.parent_id); } return p.length ? p.join(' / ') : tt('My PC', 'جهازي'); }, [byId, tt]);

  const all = useMemo(() => (nodes || []).filter((n) => n.type !== 'folder').map((n) => ({ ...n, kind: kindOf(n.name) })), [nodes]);
  const visible = useMemo(() => all.filter((n) => (source === 'all' || inLib(n))), [all, source, inLib]);
  const shown = useMemo(() => visible.filter((n) => !hidden.has(n.id)), [visible, hidden]);
  const hiddenItems = useMemo(() => visible.filter((n) => hidden.has(n.id)), [visible, hidden]);

  const counts = useMemo(() => { const c = {}; shown.forEach((n) => { c[n.kind] = (c[n.kind] || 0) + 1; }); return c; }, [shown]);
  const favCount = useMemo(() => shown.filter((n) => marks.isFav(n.id)).length, [shown, marks.favs]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekAgo = Date.now() - 7 * 864e5;
  const recentCount = useMemo(() => shown.filter((n) => Date.parse(n.updated_at) >= weekAgo).length, [shown, weekAgo]);

  const smartCtx = useMemo(() => ({ isFav: marks.isFav, tagsOf: marks.tagsOf, now: Date.now() }), [marks.favs, marks.tagsMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const smartCounts = useMemo(() => Object.fromEntries(smart.map((x) => [x.id, shown.filter((n) => matchSmart(x.rules, n, smartCtx)).length])), [smart, shown, smartCtx]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = cat === 'hidden' ? hiddenItems : shown;
    if (cat === 'fav') r = r.filter((n) => marks.isFav(n.id));
    else if (cat === 'recent') r = r.filter((n) => Date.parse(n.updated_at) >= weekAgo);
    else if (cat.startsWith('smart:')) { const sf = smart.find((x) => `smart:${x.id}` === cat); r = sf ? r.filter((n) => matchSmart(sf.rules, n, smartCtx)) : r; }
    else if (KIND_BY_KEY[cat]) r = r.filter((n) => n.kind === cat);
    if (needle) r = r.filter((n) => n.name.toLowerCase().includes(needle) || marks.tagsOf(n.id).some((t) => t.toLowerCase().includes(needle)) || (linkUrls[n.id] || '').toLowerCase().includes(needle));
    const s = [...r];
    if (sort === 'name') s.sort((a, b) => a.name.localeCompare(b.name, locale));
    else if (sort === 'size') s.sort((a, b) => b.size_bytes - a.size_bytes);
    else if (sort === 'old') s.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    else s.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    return s;
  }, [cat, shown, hiddenItems, q, sort, marks.favs, marks.tagsMap, linkUrls, locale, weekAgo, smart, smartCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // addresses of saved links (read lazily, a few at a time)
  useEffect(() => {
    const need = all.filter((n) => n.kind === 'link' && linkUrls[n.id] === undefined && n.size_bytes < 8192).slice(0, 80);
    if (!need.length) return undefined;
    let off = false;
    (async () => {
      for (const n of need) {
        if (off) return;
        try { const t = await (await fetchDriveBlob(n.id)).text(); if (!off) setLinkUrls((p) => ({ ...p, [n.id]: parseLinkFile(t) })); } catch { if (!off) setLinkUrls((p) => ({ ...p, [n.id]: '' })); }
      }
    })();
    return () => { off = true; };
  }, [all, linkUrls]);

  // drop selections that are no longer on screen
  useEffect(() => { setSel((p) => { const ids = new Set(list.map((n) => n.id)); const n = new Set([...p].filter((x) => ids.has(x))); return n.size === p.size ? p : n; }); }, [list]);

  const selected = useMemo(() => list.filter((n) => sel.has(n.id)), [list, sel]);
  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // ---- selection: click / Shift+click ranges / drag across cards / long-press on touch / Ctrl+A / Esc ----
  const [pick, setPick] = useState(false); // "Select" mode: tapping a card selects it instead of opening it
  const selMode = pick || sel.size > 0;
  const listRef = useRef(list);
  const selModeRef = useRef(selMode);
  listRef.current = list;
  selModeRef.current = selMode;
  const anchorRef = useRef(null); // last item selected, start of a Shift+click range
  const swallowClick = useRef(false); // the click that ends a drag / long-press must not toggle a second time
  const pressT = useRef(0);
  useEffect(() => () => clearTimeout(pressT.current), []);

  const clearSel = useCallback(() => { setSel(new Set()); setPick(false); anchorRef.current = null; }, []);
  const applyIds = (ids, on) => setSel((p) => { const n = new Set(p); ids.forEach((x) => (on ? n.add(x) : n.delete(x))); return n; });
  const rangeIds = (a, b) => {
    const L = listRef.current;
    const i = L.findIndex((n) => n.id === a);
    const j = L.findIndex((n) => n.id === b);
    if (i < 0 || j < 0) return [b];
    return L.slice(Math.min(i, j), Math.max(i, j) + 1).map((n) => n.id);
  };
  const pickItem = (id, e) => {
    if (e?.shiftKey && anchorRef.current && anchorRef.current !== id) applyIds(rangeIds(anchorRef.current, id), true);
    else toggle(id);
    anchorRef.current = id;
  };
  const onCardClick = (n, e) => {
    if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey || selMode) { e.preventDefault(); pickItem(n.id, e); return; }
    setPreview(n);
  };
  const onCheckClick = (n, e) => {
    if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); return; }
    pickItem(n.id, e);
  };
  const startPress = (n, e) => {
    swallowClick.current = false;
    if (e.target.closest?.('.lib-card__act')) return;
    clearTimeout(pressT.current);
    if (e.pointerType === 'touch') {
      // long-press a card to start selecting
      const x0 = e.clientX; const y0 = e.clientY;
      const off = () => { window.removeEventListener('pointermove', cancel); window.removeEventListener('pointerup', cancel); window.removeEventListener('pointercancel', cancel); }; // eslint-disable-line no-use-before-define
      function cancel(ev) { if (ev.type === 'pointermove' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return; clearTimeout(pressT.current); off(); }
      window.addEventListener('pointermove', cancel); window.addEventListener('pointerup', cancel); window.addEventListener('pointercancel', cancel);
      pressT.current = setTimeout(() => { off(); swallowClick.current = true; setPick(true); pickItem(n.id); navigator.vibrate?.(12); }, 450);
      return;
    }
    if (e.button !== 0) return;
    const onCheck = !!e.target.closest?.('.lib-check');
    if (!onCheck && !selMode) return; // a plain click on a card still just opens it
    // mouse / pen: press and drag across cards to select (or un-select) a whole run
    const startId = n.id;
    const to = !sel.has(startId);
    const sp = scrollParent(e.currentTarget);
    let lastId = startId; let moved = false;
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); }; // eslint-disable-line no-use-before-define
    function move(ev) {
      if (!(ev.buttons & 1)) { end(); return; }
      const top = sp === document.scrollingElement || sp === document.documentElement ? 0 : sp.getBoundingClientRect().top;
      const bottom = sp === document.scrollingElement || sp === document.documentElement ? window.innerHeight : sp.getBoundingClientRect().bottom;
      if (ev.clientY < top + 70) sp.scrollTop -= 18; else if (ev.clientY > bottom - 70) sp.scrollTop += 18;
      const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-lib-id]')?.getAttribute('data-lib-id');
      if (!id || id === lastId) return;
      if (!moved) { moved = true; swallowClick.current = true; applyIds([startId], to); }
      applyIds(rangeIds(lastId, id), to);
      lastId = id; anchorRef.current = id;
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  };

  const modalOpen = !!(shareNodes || preview || adding || moving || smartEdit);
  useEffect(() => {
    const onKey = (e) => {
      if (modalOpen) return;
      const t = e.target; const tag = t?.tagName;
      if ((tag === 'INPUT' && t.type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        if (!listRef.current.length) return;
        e.preventDefault();
        setSel(new Set(listRef.current.map((n) => n.id)));
      } else if (e.key === 'Escape' && selModeRef.current) clearSel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen, clearSel]);

  // ---- actions ----
  const ensureFolder = useCallback(async (kindKey) => idOf(await drive.ensurePath(null, `${LIB_ROOT}/${KIND_BY_KEY[kindKey].folder}`)), []);

  const uploadFiles = useCallback(async (files) => {
    const fl = [...files].filter(Boolean);
    if (!fl.length) return;
    let done = 0; let failed = 0;
    for (const f of fl) {
      setBusy(tt(`Uploading ${done + 1} of ${fl.length}…`, `جارِ رفع ${done + 1} من ${fl.length}…`));
      try { const pid = await ensureFolder(kindOf(f.name)); await drive.upload(pid, f); done += 1; } catch (e) { failed += 1; if (fl.length === 1) say(errorMessage(e), 'error'); }
    }
    setBusy('');
    await load();
    if (done) say(tt(`${done} added to your library.`, `تمت إضافة ${done} للمكتبة.`) + (failed ? tt(` ${failed} failed.`, ` وفشل ${failed}.`) : ''), failed ? 'error' : undefined);
    else if (fl.length > 1) say(tt('Nothing was uploaded.', 'ماتم رفع أي حاجة.'), 'error');
  }, [ensureFolder, load, say, tt]);

  const saveText = useCallback(async (kindKey, name, content) => {
    setBusy(tt('Saving…', 'جارِ الحفظ…'));
    try {
      const pid = await ensureFolder(kindKey);
      await drive.createFile(pid, name, content);
      await load();
      say(tt('Saved to your library.', 'تم الحفظ في المكتبة.'));
      return true;
    } catch (e) { say(errorMessage(e), 'error'); return false; } finally { setBusy(''); }
  }, [ensureFolder, load, say, tt]);

  const hide = (ids) => { prefs.hide(ids); setSel(new Set()); say(tt('Hidden from the library (still in My PC).', 'اتخفى من المكتبة (لسه موجود في جهازي).')); };
  const unhide = (ids) => { prefs.unhide(ids); setSel(new Set()); };
  const download = async (n) => {
    try { setBusy(tt('Preparing download…', 'جارِ تجهيز التنزيل…')); const r = await fetchDownload(n); const u = URL.createObjectURL(r.blob); const a = document.createElement('a'); a.href = u; a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch (e) { say(errorMessage(e), 'error'); } finally { setBusy(''); }
  };
  const moveTo = async (targetId) => {
    const ids = selected.map((n) => n.id);
    setBusy(tt('Moving…', 'جارِ النقل…'));
    try { await drive.move(ids, targetId); setMoving(false); setSel(new Set()); await load(); say(tt(`Moved ${ids.length}.`, `تم نقل ${ids.length}.`)); } catch (e) { say(errorMessage(e), 'error'); } finally { setBusy(''); }
  };
  const autoSort = async () => {
    setBusy(tt('Sorting…', 'جارِ الترتيب…'));
    try {
      const groups = {}; selected.forEach((n) => { (groups[n.kind] = groups[n.kind] || []).push(n.id); });
      for (const k of Object.keys(groups)) { await drive.move(groups[k], await ensureFolder(k)); }
      setMoving(false); setSel(new Set()); await load(); say(tt('Sorted into My Library by type.', 'تم ترتيبهم في مكتبتي حسب النوع.'));
    } catch (e) { say(errorMessage(e), 'error'); } finally { setBusy(''); }
  };

  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files); };
  const sources = [{ k: 'all', en: 'All My PC', ar: 'كل جهازي' }, { k: 'lib', en: 'Added here only', ar: 'المضاف هنا فقط' }];
  const chips = [
    { key: 'all', icon: 'layers', en: 'All', ar: 'الكل', n: shown.length },
    { key: 'recent', icon: 'clock', en: 'Recent', ar: 'الأحدث', n: recentCount },
    { key: 'fav', icon: 'star', en: 'Favorites', ar: 'المفضلة', n: favCount },
    ...KINDS.filter((k) => counts[k.key]).map((k) => ({ key: k.key, icon: k.icon, en: k.en, ar: k.ar, n: counts[k.key], color: k.color })),
    ...(hiddenItems.length ? [{ key: 'hidden', icon: 'eye-off', en: 'Hidden', ar: 'المخفي', n: hiddenItems.length }] : []),
  ];

  return (
    <div className="lib" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}>
      {drag && <div className="lib-drop"><Icon name="upload" size={34} /><b>{tt('Drop to add to your library', 'سيب الملفات هنا لإضافتها للمكتبة')}</b></div>}

      <header className="lib-top">
        <div className="lib-search">
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search names, tags and links…', 'ابحث في الأسماء والتاجات واللينكات…')} aria-label={tt('Search', 'بحث')} />
        </div>
        <div className="lib-add">
          <button type="button" className="lib-btn is-primary" onClick={() => fileRef.current?.click()}><Icon name="upload" size={15} /><span>{tt('Upload', 'رفع')}</span></button>
          <button type="button" className="lib-btn" onClick={() => setAdding('link')}><Icon name="link" size={15} /><span>{tt('Link', 'لينك')}</span></button>
          <button type="button" className="lib-btn" onClick={() => setAdding('note')}><Icon name="note" size={15} /><span>{tt('Note', 'ملاحظة')}</span></button>
          <button type="button" className="lib-btn" onClick={() => setAdding('code')}><Icon name="terminal" size={15} /><span>{tt('Code', 'كود')}</span></button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </header>

      <div className="lib-bar">
        <div className="lib-seg" role="radiogroup" aria-label={tt('What appears here', 'إيه اللي يظهر هنا')}>
          {sources.map((s) => <button key={s.k} type="button" role="radio" aria-checked={source === s.k} className={source === s.k ? 'is-on' : ''} onClick={() => setSource(s.k)}>{ar ? s.ar : s.en}</button>)}
        </div>
        <span className="lib-spacer" />
        <select className="lib-sel" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tt('Sort', 'ترتيب')}>
          <option value="new">{tt('Newest', 'الأحدث')}</option><option value="old">{tt('Oldest', 'الأقدم')}</option>
          <option value="name">{tt('Name', 'الاسم')}</option><option value="size">{tt('Size', 'الحجم')}</option>
        </select>
        <div className="lib-seg lib-seg--icons">
          <button type="button" className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')} aria-label={tt('Grid', 'شبكة')}><Icon name="grid" size={15} /></button>
          <button type="button" className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')} aria-label={tt('List', 'قائمة')}><Icon name="ed-list" size={15} /></button>
        </div>
        <button type="button" className={`lib-btn${selMode ? ' is-on' : ''}`} onClick={() => (selMode ? clearSel() : setPick(true))} aria-pressed={selMode} title={tt('Select items (or press and drag across them)', 'تحديد عناصر (أو اضغط واسحب عليها)')}><Icon name="check-circle" size={15} /><span>{selMode ? tt('Done', 'تم') : tt('Select', 'تحديد')}</span></button>
        <button type="button" className="lib-btn" onClick={load} title={tt('Refresh', 'تحديث')} aria-label={tt('Refresh', 'تحديث')}><Icon name="refresh" size={15} /></button>
      </div>

      <nav className="lib-chips" aria-label={tt('Categories', 'التصنيفات')}>
        {chips.map((c) => (
          <button key={c.key} type="button" className={`lib-chip${cat === c.key ? ' is-on' : ''}`} style={c.color ? { '--k': c.color } : undefined} onClick={() => setCat(c.key)}>
            <Icon name={c.icon} size={14} /><span>{ar ? c.ar : c.en}</span><b>{c.n}</b>
          </button>
        ))}
      </nav>

      <div className="lib-smart" aria-label={tt('Smart folders', 'المجلدات الذكية')}>
        <span className="lib-smart__lbl"><Icon name="sparkles" size={14} />{tt('Smart folders', 'مجلدات ذكية')}</span>
        {smart.map((x) => (
          <span key={x.id} className={`lib-sf${cat === `smart:${x.id}` ? ' is-on' : ''}`}>
            <button type="button" className="lib-sf__main" onClick={() => setCat(`smart:${x.id}`)}><Icon name="filter" size={13} /><span>{x.name}</span><b>{smartCounts[x.id] ?? 0}</b></button>
            <button type="button" className="lib-sf__edit" onClick={() => setSmartEdit({ id: x.id, name: x.name, rules: x.rules })} aria-label={`${tt('Edit', 'تعديل')} ${x.name}`}><Icon name="edit" size={12} /></button>
          </span>
        ))}
        <button type="button" className="lib-sf__new" onClick={() => setSmartEdit({ id: null, name: '', rules: cleanRules({}) })}><Icon name="plus" size={13} /><span>{tt('New smart folder', 'مجلد ذكي جديد')}</span></button>
      </div>

      {error && <div className="lib-err" role="alert">{error} <button type="button" className="lib-link" onClick={load}>{tt('Retry', 'إعادة المحاولة')}</button></div>}
      {source === 'lib' && nodes && !libRoot && <div className="lib-note">{tt('Nothing was added here yet. Upload a file, save a link or write a note — or switch to “All My PC”.', 'لسه مفيش حاجة اتضافت هنا. ارفع ملف أو احفظ لينك أو اكتب ملاحظة — أو غيّر لـ "كل جهازي".')}</div>}

      {nodes === null ? (
        <div className="lib-grid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="lib-skel" />)}</div>
      ) : list.length === 0 ? (
        <div className="lib-empty"><Icon name={cat === 'fav' ? 'star' : 'layers'} size={34} /><b>{q ? tt('No matches.', 'مفيش نتائج.') : tt('Nothing here yet.', 'مفيش حاجة هنا لسه.')}</b><small>{tt('Everything in My PC is sorted here automatically, and you can add more with the buttons above.', 'كل حاجة في جهازي بتتصنف هنا تلقائيًا، وتقدر تضيف أكتر من الأزرار فوق.')}</small></div>
      ) : (
        <div className={view === 'grid' ? 'lib-grid' : 'lib-rows'} role="list">
          {list.map((n) => {
            const k = KIND_BY_KEY[n.kind];
            const on = sel.has(n.id);
            const url = linkUrls[n.id];
            const tags = marks.tagsOf(n.id);
            return (
              <article key={n.id} role="listitem" data-lib-id={n.id} className={`lib-card${on ? ' is-sel' : ''}`} style={{ '--k': k.color }} onPointerDown={(e) => startPress(n, e)} onDragStart={(e) => e.preventDefault()}>
                <button type="button" className="lib-card__open" onClick={(e) => onCardClick(n, e)} aria-pressed={selMode ? on : undefined} aria-label={`${selMode ? tt('Select', 'تحديد') : tt('Open', 'فتح')} ${n.name}`}>
                  {view === 'grid' && (n.kind === 'link' ? <div className="lib-thumb" style={{ '--k': k.color }}><Icon name="link" size={30} /><small dir="ltr">{url ? hostOf(url) : ''}</small></div> : <Thumb node={n} kind={n.kind} />)}
                  {view === 'list' && <span className="lib-ico"><Icon name={k.icon} size={18} /></span>}
                  <span className="lib-card__txt">
                    <strong title={n.name}>{n.kind === 'link' ? n.name.replace(/\.(url|webloc)$/i, '') : n.name}</strong>
                    <small>{ar ? k.ar : k.en} · {fmtSize(n.size_bytes)} · {timeAgo(n.updated_at, locale)}</small>
                    {view === 'list' && <small className="lib-path" title={pathOf(n)}>{pathOf(n)}</small>}
                    {tags.length > 0 && <span className="lib-tags">{tags.slice(0, 3).map((t) => <i key={t} style={{ '--t': tagColor(t) }}>{t}</i>)}</span>}
                  </span>
                </button>
                <label className="lib-check" title={tt('Select', 'تحديد')}><input type="checkbox" checked={on} onChange={() => {}} onClick={(e) => onCheckClick(n, e)} aria-label={`${tt('Select', 'تحديد')} ${n.name}`} /></label>
                <div className="lib-card__act">
                  <button type="button" className={marks.isFav(n.id) ? 'is-on' : ''} onClick={() => marks.setFav([n.id], !marks.isFav(n.id))} aria-label={tt('Favorite', 'مفضلة')} aria-pressed={marks.isFav(n.id)}><Icon name="star" size={14} /></button>
                  <button type="button" onClick={() => setShareNodes([n])} aria-label={tt('Share', 'مشاركة')}><Icon name="share" size={14} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selMode && (
        <div className="lib-sel-bar" role="toolbar" aria-label={tt('Selected items', 'العناصر المحددة')}>
          {selected.length > 0 ? <b>{selected.length} {tt('selected', 'محدد')}</b> : <b className="lib-sel-hint">{tt('Tap items to select · press and drag to select many', 'اضغط على العناصر لتحديدها · اضغط واسحب لتحديد أكتر من عنصر')}</b>}
          <button type="button" onClick={() => setSel(selected.length === list.length ? new Set() : new Set(list.map((n) => n.id)))}>{selected.length === list.length && list.length > 0 ? tt('Deselect all', 'إلغاء تحديد الكل') : tt('Select all', 'تحديد الكل')}</button>
          <span className="lib-spacer" />
          {selected.length > 0 && (cat === 'hidden'
            ? <button type="button" onClick={() => unhide(selected.map((n) => n.id))}><Icon name="eye" size={15} /><span>{tt('Show again', 'إظهار')}</span></button>
            : (
              <>
                <button type="button" className="is-primary" onClick={() => setShareNodes(selected)}><Icon name="share" size={15} /><span>{tt('Share', 'مشاركة')}{selected.length > 1 ? tt(' in one link', ' في رابط واحد') : ''}</span></button>
                <button type="button" onClick={() => setMoving(true)}><Icon name="folder-up" size={15} /><span>{tt('Move', 'نقل')}</span></button>
                <button type="button" onClick={() => { const on = !selected.every((n) => marks.isFav(n.id)); marks.setFav(selected.map((n) => n.id), on); }}><Icon name="star" size={15} /><span>{tt('Favorite', 'مفضلة')}</span></button>
                <button type="button" onClick={() => hide(selected.map((n) => n.id))}><Icon name="eye-off" size={15} /><span>{tt('Hide', 'إخفاء')}</span></button>
              </>
            ))}
          <button type="button" onClick={clearSel} aria-label={tt('Clear selection', 'إلغاء التحديد')}><Icon name="x" size={15} /></button>
        </div>
      )}

      {busy && <div className="lib-busy" role="status"><Icon name="refresh" size={15} /><span>{busy}</span></div>}
      {toast && <div key={toast.id} className={`lib-toast${toast.kind === 'error' ? ' is-error' : ''}`} role="status"><Icon name={toast.kind === 'error' ? 'alert' : 'check-circle'} size={16} /><span>{toast.msg}</span></div>}

      {shareNodes && <ShareDialog nodes={shareNodes.map((n) => ({ id: n.id, name: n.name, type: n.type }))} ar={ar} locale={locale} onClose={() => setShareNodes(null)} onToast={say} />}
      {preview && !shareNodes && (
        <Preview node={preview} ar={ar} locale={locale} tt={tt} url={linkUrls[preview.id]} marks={marks} path={pathOf(preview)} onClose={() => setPreview(null)} onToast={say}
          onShare={() => { setShareNodes([preview]); setPreview(null); }} onDownload={() => download(preview)} onOpenPc={() => navigate(myPcPath(user?.role))}
          onHide={() => { hide([preview.id]); setPreview(null); }} />
      )}
      {adding && <AddDialog kind={adding} tt={tt} onClose={() => setAdding(null)} onSave={async (k, name, content) => { if (await saveText(k, name, content)) setAdding(null); }} busy={!!busy} />}
      {smartEdit && (
        <SmartDialog tt={tt} ar={ar} init={smartEdit} tagsAll={marks.allTags} nodes={shown} ctx={smartCtx} canDelete={!!smartEdit.id} onClose={() => setSmartEdit(null)}
          onDelete={() => { prefs.removeSmart(smartEdit.id); if (cat === `smart:${smartEdit.id}`) setCat('all'); setSmartEdit(null); say(tt('Smart folder deleted (your files are untouched).', 'اتمسح المجلد الذكي (ملفاتك زي ما هي).')); }}
          onSave={(name, rules) => { const id = smartEdit.id || newSmartId(); prefs.saveSmart({ id, name, rules }); setSmartEdit(null); setCat(`smart:${id}`); say(tt('Smart folder saved.', 'تم حفظ المجلد الذكي.')); }} />
      )}
      {moving && <MoveDialog tt={tt} nodes={nodes || []} count={selected.length} onClose={() => setMoving(false)} onPick={moveTo} onAuto={autoSort} />}
    </div>
  );
}

// ---------------------------------------------------------------- preview
function Preview({ node, ar, locale, tt, url, marks, path, onClose, onToast, onShare, onDownload, onOpenPc, onHide }) {
  const kind = node.kind;
  const [src, setSrc] = useState('');
  const [text, setText] = useState(null);
  const [err, setErr] = useState('');
  const [tag, setTag] = useState('');
  const ext = extOf(node.name);
  const media = kind === 'image' || kind === 'video' || kind === 'audio' || ext === 'pdf';
  const textual = kind === 'note' || kind === 'code' || kind === 'data';

  useEffect(() => {
    let off = false; let made = '';
    setSrc(''); setText(null); setErr('');
    if (!media && !textual) return undefined;
    fetchDriveBlob(node.id).then(async (b) => {
      if (off) return;
      if (textual) setText((await b.slice(0, PREVIEW_TEXT_MAX).text()) + (b.size > PREVIEW_TEXT_MAX ? '\n…' : ''));
      else { made = URL.createObjectURL(b.type || ext !== 'pdf' ? b : new Blob([b], { type: 'application/pdf' })); setSrc(made); }
    }).catch((e) => { if (!off) setErr(errorMessage(e)); });
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [node.id, media, textual, ext]);

  const tags = marks.tagsOf(node.id);
  const addTag = () => { const t = tag.trim(); if (t) marks.setTags(node.id, [...tags, t]); setTag(''); };
  const k = KIND_BY_KEY[kind];
  const link = kind === 'link' ? url : '';

  return (
    <StModal wide title={node.name} onClose={onClose} actions={(
      <>
        <button type="button" className="btn btn-ghost" onClick={onHide}><Icon name="eye-off" size={15} /><span>{tt('Hide', 'إخفاء')}</span></button>
        <button type="button" className="btn btn-ghost" onClick={onOpenPc}><Icon name="monitor" size={15} /><span>{tt('Open My PC', 'افتح جهازي')}</span></button>
        <button type="button" className="btn btn-ghost" onClick={onDownload}><Icon name="download" size={15} /><span>{tt('Download', 'تنزيل')}</span></button>
        <button type="button" className="btn btn-primary" onClick={onShare}><Icon name="share" size={15} /><span>{tt('Share', 'مشاركة')}</span></button>
      </>
    )}>
      <div className="lib-pv">
        <div className="lib-pv__meta"><span style={{ '--k': k.color }} className="lib-pv__kind"><Icon name={k.icon} size={13} />{ar ? k.ar : k.en}</span><small>{fmtSize(node.size_bytes)} · {timeAgo(node.updated_at, locale)} · {path}</small></div>
        {err && <div className="lib-err" role="alert">{err}</div>}
        {kind === 'image' && (src ? <img className="lib-pv__img" src={src} alt={node.name} /> : !err && <div className="lib-pv__ph">{tt('Loading…', 'جارِ التحميل…')}</div>)}
        {kind === 'video' && (src ? <video className="lib-pv__img" src={src} controls playsInline /> : !err && <div className="lib-pv__ph">{tt('Loading…', 'جارِ التحميل…')}</div>)}
        {kind === 'audio' && (src ? <audio src={src} controls style={{ width: '100%' }} /> : !err && <div className="lib-pv__ph">{tt('Loading…', 'جارِ التحميل…')}</div>)}
        {ext === 'pdf' && (src ? <iframe className="lib-pv__pdf" src={src} title={node.name} /> : !err && <div className="lib-pv__ph">{tt('Loading…', 'جارِ التحميل…')}</div>)}
        {textual && (text === null ? (!err && <div className="lib-pv__ph">{tt('Loading…', 'جارِ التحميل…')}</div>) : (
          <>
            <pre className="lib-pv__text" dir="auto">{text}</pre>
            <button type="button" className="lib-btn" onClick={async () => onToast(await copyText(text) ? tt('Copied.', 'تم النسخ.') : tt('Could not copy.', 'تعذّر النسخ.'), undefined)}><Icon name="copy" size={14} /><span>{tt('Copy text', 'نسخ النص')}</span></button>
          </>
        ))}
        {kind === 'link' && (
          <div className="lib-pv__link">
            {link ? (
              <>
                <a href={link} target="_blank" rel="noopener noreferrer nofollow" dir="ltr">{link}</a>
                <div className="lib-add">
                  <a className="lib-btn is-primary" href={link} target="_blank" rel="noopener noreferrer nofollow"><Icon name="external-link" size={14} /><span>{tt('Open link', 'فتح اللينك')}</span></a>
                  <button type="button" className="lib-btn" onClick={async () => onToast(await copyText(link) ? tt('Link copied.', 'تم نسخ اللينك.') : tt('Could not copy.', 'تعذّر النسخ.'))}><Icon name="copy" size={14} /><span>{tt('Copy', 'نسخ')}</span></button>
                </div>
              </>
            ) : <div className="lib-pv__ph">{url === '' ? tt('This shortcut has no address.', 'الاختصار ده مفيهوش عنوان.') : tt('Loading…', 'جارِ التحميل…')}</div>}
          </div>
        )}
        {!media && !textual && kind !== 'link' && <div className="lib-pv__ph"><Icon name={k.icon} size={34} /><span>{tt('No preview for this type — download it or open it in My PC.', 'مفيش معاينة للنوع ده — نزّله أو افتحه من جهازي.')}</span></div>}
        <div className="lib-pv__tags">
          <span className="lib-pv__lbl">{tt('Tags', 'التاجات')}</span>
          {tags.map((t) => <button key={t} type="button" className="lib-tag" style={{ '--t': tagColor(t) }} onClick={() => marks.setTags(node.id, tags.filter((x) => x !== t))} title={tt('Remove', 'إزالة')}>{t} ×</button>)}
          <input value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder={tt('Add a tag…', 'أضف تاج…')} aria-label={tt('Add a tag', 'أضف تاج')} />
        </div>
      </div>
    </StModal>
  );
}

// ---------------------------------------------------------------- add link / note / code
function AddDialog({ kind, tt, onClose, onSave, busy }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [lang, setLang] = useState('js');
  const [err, setErr] = useState('');
  const heading = kind === 'link' ? tt('Save a link', 'احفظ لينك') : kind === 'note' ? tt('New note', 'ملاحظة جديدة') : tt('Code snippet', 'مقطع كود');
  const submit = () => {
    setErr('');
    if (kind === 'link') {
      const u = normalizeUrl(body);
      if (!u) { setErr(tt('Enter a valid web address (https://…).', 'اكتب عنوان موقع صحيح (https://…).')); return; }
      onSave('link', `${safeName(title, hostOf(u) || 'link')}.url`, makeLinkFile(u));
    } else if (!body.trim()) { setErr(tt('Write something first.', 'اكتب حاجة الأول.')); }
    else if (kind === 'note') onSave('note', `${safeName(title, tt('Note', 'ملاحظة'))}.md`, body);
    else onSave('code', `${safeName(title, 'snippet')}.${lang}`, body);
  };
  return (
    <Modal title={heading} onClose={onClose} actions={(
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{tt('Save', 'حفظ')}</button>
      </>
    )}>
      <div className="lib-form">
        <label><span>{tt('Name (optional)', 'الاسم (اختياري)')}</span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
        {kind === 'code' && (
          <label><span>{tt('Language', 'اللغة')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l.ext} value={l.ext}>{l.label}</option>)}</select>
          </label>
        )}
        <label><span>{kind === 'link' ? tt('Address', 'العنوان') : kind === 'note' ? tt('Note', 'الملاحظة') : tt('Code', 'الكود')}</span>
          {kind === 'link'
            ? <input dir="ltr" value={body} placeholder="https://…" onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            : <textarea dir={kind === 'code' ? 'ltr' : 'auto'} rows={10} spellCheck={kind === 'note'} value={body} onChange={(e) => setBody(e.target.value)} className={kind === 'code' ? 'is-mono' : ''} />}
        </label>
        {err && <div className="lib-err" role="alert">{err}</div>}
        <small>{tt('Saved as a normal file in My PC → My Library, so you can share it with a link or QR like any other file.', 'بيتحفظ كملف عادي في جهازي ← My Library، فتقدر تشاركه برابط أو QR زي أي ملف.')}</small>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- move
function MoveDialog({ tt, nodes, count, onClose, onPick, onAuto }) {
  const folders = useMemo(() => {
    const kids = new Map();
    nodes.filter((n) => n.type === 'folder').forEach((n) => { const k = n.parent_id ?? 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); });
    const out = [];
    const walk = (pid, depth) => { (kids.get(pid) || []).sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => { out.push({ ...f, depth }); if (depth < 8) walk(f.id, depth + 1); }); };
    walk(0, 0);
    return out;
  }, [nodes]);
  const [f, setF] = useState('');
  const shownF = f.trim() ? folders.filter((x) => x.name.toLowerCase().includes(f.trim().toLowerCase())) : folders;
  return (
    <Modal title={tt(`Move ${count} item(s)`, `نقل ${count} عنصر`)} onClose={onClose} actions={<button type="button" className="btn btn-ghost" onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>}>
      <div className="lib-move">
        <button type="button" className="lib-move__auto" onClick={onAuto}><Icon name="sparkles" size={16} /><span><b>{tt('Sort automatically', 'ترتيب تلقائي')}</b><small>{tt('Put each item in My Library / its type (Images, Videos, Notes…)', 'حط كل عنصر في My Library / نوعه (صور، فيديوهات، ملاحظات…)')}</small></span></button>
        <input value={f} onChange={(e) => setF(e.target.value)} placeholder={tt('Find a folder…', 'دوّر على مجلد…')} aria-label={tt('Find a folder', 'دوّر على مجلد')} />
        <ul>
          {!f.trim() && <li><button type="button" onClick={() => onPick(null)}><Icon name="monitor" size={15} />{tt('My PC (top level)', 'جهازي (الرئيسي)')}</button></li>}
          {shownF.map((x) => <li key={x.id} style={{ paddingInlineStart: f.trim() ? 0 : x.depth * 16 }}><button type="button" onClick={() => onPick(x.id)}><Icon name="folder" size={15} />{x.name}</button></li>)}
          {shownF.length === 0 && <li className="lib-move__none">{tt('No folders.', 'مفيش مجلدات.')}</li>}
        </ul>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- smart folders
function SmartDialog({ tt, ar, init, tagsAll, nodes, ctx, canDelete, onClose, onSave, onDelete }) {
  const [name, setName] = useState(init.name);
  const [r, setR] = useState(init.rules);
  const set = (patch) => setR((p) => ({ ...p, ...patch }));
  const rules = useMemo(() => cleanRules(r), [r]);
  const n = useMemo(() => nodes.filter((x) => matchSmart(rules, x, ctx)).length, [nodes, rules, ctx]);
  const toggleKind = (k) => set({ kinds: r.kinds.includes(k) ? r.kinds.filter((x) => x !== k) : [...r.kinds, k] });
  const periods = [['any', 'Any time', 'أي وقت'], ['today', 'Today', 'النهارده'], ['7d', 'Last 7 days', 'آخر 7 أيام'], ['30d', 'Last 30 days', 'آخر 30 يوم'], ['month', 'This month', 'هذا الشهر'], ['year', 'This year', 'هذه السنة']];
  const empty = !rules.kinds.length && rules.period === 'any' && rules.min_mb === null && rules.max_mb === null && !rules.tag && !rules.fav && !rules.contains;
  const bad = rules.min_mb !== null && rules.max_mb !== null && rules.min_mb > rules.max_mb;
  const can = name.trim() && !empty && !bad;
  return (
    <Modal title={init.id ? tt('Edit smart folder', 'تعديل المجلد الذكي') : tt('New smart folder', 'مجلد ذكي جديد')} onClose={onClose} actions={(
      <>
        {canDelete && <button type="button" className="btn btn-ghost lib-danger" onClick={onDelete}><Icon name="trash" size={15} /><span>{tt('Delete', 'حذف')}</span></button>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>
        <button type="button" className="btn btn-primary" disabled={!can} onClick={() => onSave(name.trim(), rules)}>{tt('Save', 'حفظ')}</button>
      </>
    )}>
      <div className="lib-form">
        {!init.id && (
          <div className="lib-presets">
            <span>{tt('Start from', 'ابدأ من')}</span>
            {SMART_PRESETS.map((p) => <button key={p.en} type="button" className="lib-chip" onClick={() => { setName(ar ? p.ar : p.en); setR(cleanRules(p.rules)); }}>{ar ? p.ar : p.en}</button>)}
          </div>
        )}
        <label><span>{tt('Name', 'الاسم')}</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div className="lib-form__grp"><span>{tt('Types (none = all)', 'الأنواع (من غير اختيار = الكل)')}</span>
          <div className="lib-presets">{KINDS.map((k) => <button key={k.key} type="button" className={`lib-chip${r.kinds.includes(k.key) ? ' is-on' : ''}`} style={{ '--k': k.color }} aria-pressed={r.kinds.includes(k.key)} onClick={() => toggleKind(k.key)}><Icon name={k.icon} size={13} /><span>{ar ? k.ar : k.en}</span></button>)}</div>
        </div>
        <div className="lib-form__row">
          <label><span>{tt('Modified', 'آخر تعديل')}</span><select value={r.period} onChange={(e) => set({ period: e.target.value })}>{periods.map((x) => <option key={x[0]} value={x[0]}>{ar ? x[2] : x[1]}</option>)}</select></label>
          <label><span>{tt('Min size (MB)', 'أقل حجم (ميجا)')}</span><input type="number" min="0" dir="ltr" value={r.min_mb ?? ''} onChange={(e) => set({ min_mb: e.target.value })} /></label>
          <label><span>{tt('Max size (MB)', 'أكبر حجم (ميجا)')}</span><input type="number" min="0" dir="ltr" value={r.max_mb ?? ''} onChange={(e) => set({ max_mb: e.target.value })} aria-invalid={bad} /></label>
        </div>
        <div className="lib-form__row">
          <label><span>{tt('Name contains', 'الاسم يحتوي')}</span><input value={r.contains} maxLength={60} onChange={(e) => set({ contains: e.target.value })} /></label>
          <label><span>{tt('Tag', 'التاج')}</span><input list="lib-tags-dl" value={r.tag} maxLength={24} onChange={(e) => set({ tag: e.target.value })} /><datalist id="lib-tags-dl">{tagsAll.map((t) => <option key={t.name} value={t.name} />)}</datalist></label>
        </div>
        <label className="lib-form__check"><input type="checkbox" checked={r.fav} onChange={(e) => set({ fav: e.target.checked })} /><span>{tt('Favorites only', 'المفضلة فقط')}</span></label>
        {bad && <div className="lib-err" role="alert">{tt('Min size is bigger than max size.', 'أقل حجم أكبر من أكبر حجم.')}</div>}
        <small className="lib-form__count">{empty ? tt('Pick at least one rule.', 'اختار شرط واحد على الأقل.') : tt(`${n} item(s) match right now — the folder updates by itself as files change.`, `${n} عنصر مطابق دلوقتي — والمجلد بيتحدث لوحده لما الملفات تتغير.`)}</small>
      </div>
    </Modal>
  );
}
