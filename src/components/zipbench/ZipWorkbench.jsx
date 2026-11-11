import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync, zipSync } from 'fflate';
import Icon from '../Icon';
import SearchPanel from './SearchPanel';
import Menu from './Menus';
import RunPanel from './RunPanel';
import SandboxPanel from './SandboxPanel';
import { detectApps, defaultApp, LANGS } from './runner/detectApps';
import { useRunner } from './runner/useRunner';
import { useSandbox } from './runner/useSandbox';
import { useAiFix } from './ai/useAiFix';
import AiFixPanel from './ai/AiFixPanel';
import AiChatPanel from './ai/AiChatPanel';
import { useAiChat } from './ai/useAiChat';
import { fetchCompletion } from './ai/ghostComplete';
import { CONVERT_TARGETS, applyEdit, guessErrorFile, languageOf, looksLikeError, suggestFileName, tailOutput } from './ai/aiFixUtils';
import { useAuth } from '../../context/AuthContext';
import { RUNNER_URL } from '../../config/runner';
import { DEFAULT_THEME, THEMES, themeById, themeVars } from './zipThemes';
import {
  MAX_UPLOAD_FILE, MAX_UPLOAD_TOTAL, cleanRel, itemsFromFileList, readDataTransfer, uniquePath,
} from './zipImport';
import {
  IMAGE_MIME, MAX_EDIT_BYTES, STORE_EXT, badgeOf, baseName, buildTree, dirName, extOf, fmtBytes, isBinary, languageName,
} from './zipUtils';
import useAutoDraft, { DraftChip } from '../../lib/useAutoDraft';
import { askUnsaved } from '../../lib/saveCenter';
import { agoText, discardDraft, getDraft } from '../../lib/draftStore';
import { restoreDraft, sigOf, snapshotDraft } from './zipDraft';
import { DROP_EVENT, hasDriveIds, nodesToImportItems, readDragNodes } from '../../lib/driveDnd';
import '../../styles/css/drafts.css';
import '../../styles/css/zip-workbench.css';
import '../../styles/css/zip-markdown.css';

const CodeEditor = lazy(() => import('./CodeEditor'));
const NO_GHOST_EXT = new Set(['md', 'txt', 'csv', 'tsv', 'log']); // prose / data files: no AI autocomplete
import { isEditableJson } from './jsonCheck';
import '../../styles/css/zip-polish.css'; // unified type scale + AI chat / console / terminal polish (must stay the last stylesheet import)
const CsvGrid = lazy(() => import('./CsvGrid'));
const JsonEdit = lazy(() => import('./JsonEdit'));
const isGridPath = (p) => /\.(csv|tsv)$/i.test(p || '');
const isJsonFile = (p) => /\.json$/i.test(p || '');
const MarkdownView = lazy(() => import('./MarkdownView'));
const isMdFile = (p) => /\.(md|markdown|mdown|mkd)$/i.test(p || '');

const MAX_ZIP_BYTES = 150 * 1024 * 1024;
const MAX_TOTAL_UNPACKED = 600 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 200;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');
const isNoise = (name) => name.startsWith('__MACOSX/') || baseName(name) === '.DS_Store';

// folder part of a tree path, always with a trailing "/" ('' = archive root)
const dirOf = (path) => {
  if (!path) return '';
  if (path.endsWith('/')) return path;
  const d = dirName(path);
  return d ? `${d}/` : '';
};

function Badge({ path }) {
  const [label, color] = badgeOf(path);
  return <span className="zb-badge" style={{ '--k': color }}>{label}</span>;
}

/**
 * VS Code–style ZIP workbench: explorer tree, tabs, CodeMirror editor, status bar — and "Download ZIP"
 * which rebuilds the archive (with edits / new / renamed / deleted files) entirely in the browser.
 *
 * When the parent passes `onSave(blob, { force })`, a "Save" button (and Ctrl+S) also appears: it rebuilds
 * the archive the same way and uploads it as the new version of the file on the server, so everyone on
 * the project sees the edits (the previous version stays in the file's version history).
 * Without `onSave` (reviewers, locked projects) the archive stays read-only on the server.
 */
const MAX_SAVE_BYTES = 50 * 1024 * 1024; // matches the server's upload limit

/**
 * Permissions (set by the caller, e.g. a post's attachment viewer):
 *   readOnly     — viewing only: no edit / add / rename / delete / move / save and NO AI (assistant, chat, autocomplete). Only the owner gets the full workbench.
 *   canDownload  — shows "Download ZIP" / per-file / per-folder downloads (the publisher decides this for everyone else)
 *   canRun       — shows the Run button and "Run this file"
 */
export default function ZipWorkbench({ blob, fileName, tt, guardRef, onSave, projectId, sandboxTokenPath, draftKey, readOnly = false, canDownload = true, canRun = true }) {
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [vfs, setVfs] = useState(() => new Map()); // path -> { path, dir, size, origPath, isNew }
  const [deletedCount, setDeletedCount] = useState(0);
  const [dirty, setDirty] = useState(() => new Set());
  const [open, setOpen] = useState(() => new Set());
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const [editorDoc, setEditorDoc] = useState(null); // { path, docId, text }
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  // identical reports must not re-render this big component
  const onCursorMove = useCallback((c) => setCursor((p) => (p.line === c.line && p.col === c.col && p.sel?.from === c.sel?.from && p.sel?.to === c.sel?.to ? p : c)), []);
  const [wrap, setWrap] = useState(false);
  const [ghostPref, setGhostPref] = useState(() => { try { return window.localStorage.getItem('zb-ghost') !== '0'; } catch { return true; } }); // AI autocomplete on/off (per browser)
  const [ghostDead, setGhostDead] = useState(false); // the server refused (permission / exam lock / unavailable): stay off until reload
  const [fontSize, setFontSize] = useState(13.5);
  const [explorer, setExplorer] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 760px)').matches);
  const [dlg, setDlg] = useState(null); // { type: 'new'|'rename'|'delete'|'reset', path?, value? }
  const [busy, setBusy] = useState(false);
  const [rawText, setRawText] = useState(() => new Set()); // csv / tsv tabs the user switched to the plain-text view
  const [mdMode, setMdMode] = useState(() => new Map()); // markdown tab -> 'preview' | 'split' | 'text'
  const [mdTick, setMdTick] = useState(0); // bumped (debounced) while typing so the split preview follows the editor
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [sideTab, setSideTab] = useState('files'); // files | search
  const [searchFocus, setSearchFocus] = useState(0);
  const [sel, setSel] = useState(''); // selected tree entry ('' = archive root) -> where "new / upload" goes
  const [menu, setMenu] = useState(null); // { x, y, items, title }
  const [dropDir, setDropDir] = useState(null); // folder currently hovered by a drag (null = no drag)
  const [importing, setImporting] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { const v = window.localStorage.getItem('zb-theme'); return THEMES.some((t) => t.id === v) ? v : DEFAULT_THEME; } catch { return DEFAULT_THEME; }
  });
  const [reveal, setReveal] = useState(null); // { key, path, line, col, len, spec } -> jump-to-match in the editor
  const [runOpen, setRunOpen] = useState(false); // bottom "Run" panel (Python / React / HTML in the browser)
  const [runChoice, setRunChoice] = useState(null); // user's explicit pick in the app dropdown (null = automatic)
  const [runBig, setRunBig] = useState(false);
  const [draftReady, setDraftReady] = useState(false); // archive loaded and a stored draft applied: only now may drafts be written
  const [restoredInfo, setRestoredInfo] = useState(null); // { count, at, exact }
  const baseSig = useRef('');
  const baseMapRef = useRef(new Map());
  const pendingTabs = useRef(null); // { tabs, active } to reopen once the workbench is on screen
  const touchRef = useRef(() => {});
  const saveRef = useRef(null); // the Save Center saves this archive through it (reminders, "Save changes?")
  const deletedRef = useRef(0);
  const runner = useRunner();
  const sandbox = useSandbox(projectId, sandboxTokenPath); // real server / terminal on the uip-sandbox gateway (needs a project id)
  const { can } = useAuth();
  const ai = useAiFix({ enabled: !readOnly && can('ai.code_assist'), tt, projectId }); // projectId: the supervising doctor may have set this project's AI mode
  const chat = useAiChat({ tt, scope: projectId || '', label: fileName || '', enabled: !readOnly && !!ai.chatAvailable }); // side-panel chat (saved on the account): knows the open file, selection, terminal output and the other open tabs
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRefs, setChatRefs] = useState([]); // code parts pinned to the next question: [{ id, path, from, to, text }] (max 5)
  const [chatCtx, setChatCtx] = useState({ file: true, selection: true, others: true, output: false }); // what the chat sends as context
  const [chatMode, setChatMode] = useState(null); // null = the server's default mode // "explain / fix this error" (needs the ai.code_assist permission)

  const toggleGhost = useCallback(() => {
    setGhostPref((v) => { const n = !v; try { window.localStorage.setItem('zb-ghost', n ? '1' : '0'); } catch { /* storage unavailable */ } return n; });
  }, []);
  const ghostOpts = useMemo(() => ({
    enabled: ai.autocompleteAvailable && ghostPref && !ghostDead && !NO_GHOST_EXT.has(extOf(editorDoc?.path || '')),
    request: (c, retried) => fetchCompletion({ ...c, projectId }, retried),
    onDisable: () => setGhostDead(true),
  }), [ai.autocompleteAvailable, ghostPref, ghostDead, editorDoc?.path, projectId]);

  useEffect(() => { if (ai.panel) setChatOpen(false); }, [ai.panel]);

  const zipBytes = useRef(null);
  const ownBlob = useRef(null); // the archive we just saved ourselves — a re-delivered copy of it must not reload the workbench
  const vfsRef = useRef(vfs);
  vfsRef.current = vfs;
  const edits = useRef(new Map()); // path -> edited text (only when different from the original)
  const origTexts = useRef(new Map());
  const newData = useRef(new Map()); // path -> Uint8Array (files created here)
  const cache = useRef(new Map()); // origPath -> Uint8Array (decompressed)
  const docs = useRef(new Map()); // path -> { kind, url?, size }
  const gens = useRef(new Map());
  const activeRef = useRef(null);
  activeRef.current = active;
  const editorDocRef = useRef(null);
  editorDocRef.current = editorDoc;
  const tabsRef = useRef([]);
  tabsRef.current = tabs;
  const toastTimer = useRef(0);
  const mdTimer = useRef(0);
  const mdUrls = useRef(new Map()); // image path -> { url, sig } (images referenced from a markdown file)
  const revealSeq = useRef(0);
  const rootRef = useRef(null);
  const fileInput = useRef(null);
  const dirInput = useRef(null);
  const uploadBase = useRef('');
  const defaultSel = useRef('');
  const dragSrc = useRef(null); // tree path being dragged inside the explorer
  const mainRef = useRef(null); // .zb-main — receives pointer-dragged desktop icons (DROP_EVENT)

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  // ---- load archive -------------------------------------------------------------------------------
  useEffect(() => {
    if (ownBlob.current === blob) return undefined; // our own save coming back from the server: state is already in sync
    let dead = false;
    // a different archive was delivered (e.g. a newer version saved by someone else): start clean
    docs.current.forEach((d) => { if (d.url) URL.revokeObjectURL(d.url); });
    docs.current.clear(); edits.current.clear(); origTexts.current.clear(); newData.current.clear(); cache.current.clear();
    setTabs([]); setActive(null); setEditorDoc(null); setDirty(new Set()); setDeletedCount(0);
    setDraftReady(false); setRestoredInfo(null);
    (async () => {
      try {
        if (blob.size > MAX_ZIP_BYTES) throw new Error(tt('This archive is too large to open here — download it instead.', 'الأرشيف كبير جدًا للفتح هنا — نزّله بدل ذلك.'));
        const u8 = new Uint8Array(await blob.arrayBuffer());
        const list = [];
        let total = 0;
        unzipSync(u8, { filter: (f) => { if (!isNoise(f.name)) { list.push({ path: f.name, size: f.originalSize }); total += f.originalSize; } return false; } });
        if (total > MAX_TOTAL_UNPACKED) throw new Error(tt('This archive expands to too much data to open here.', 'الأرشيف بعد فك الضغط كبير جدًا للفتح هنا.'));
        if (dead) return;
        zipBytes.current = u8;
        const map = new Map();
        list.forEach((e) => map.set(e.path, { path: e.path, dir: e.path.endsWith('/'), size: e.size, origPath: e.path, isNew: false }));
        baseSig.current = sigOf([...map.values()]);
        baseMapRef.current = map;
        let startMap = map;
        let applied = null;
        try {
          const snap = draftKey ? await getDraft(draftKey) : null;
          if (snap && !dead) applied = restoreDraft(snap, map, u8, baseSig.current);
          if (applied && !dead) {
            edits.current = applied.edits; newData.current = applied.newData; origTexts.current = applied.origTexts;
            startMap = applied.map;
            setDirty(applied.dirty); setDeletedCount(applied.deletedCount);
            pendingTabs.current = { tabs: applied.tabs, active: applied.active };
            if (applied.count > 0) setRestoredInfo({ count: applied.count, at: snap.at, exact: applied.exact });
          }
        } catch { /* a damaged draft must never stop the archive from opening */ }
        if (dead) return;
        setVfs(startMap);
        const tops = [...new Set(list.map((e) => e.path.split('/')[0]).filter((n) => list.some((x) => x.path.startsWith(`${n}/`))))];
        setOpen(new Set(tops.length === 1 ? [`${tops[0]}/`] : []));
        defaultSel.current = tops.length === 1 ? `${tops[0]}/` : ''; // single project folder -> add things inside it by default
        setSel(defaultSel.current);
        setPhase('ready');
        setDraftReady(true);
      } catch (err) {
        if (!dead) { setError(String(err?.message || err)); setPhase('error'); }
      }
    })();
    return () => { dead = true; };
  }, [blob, tt, draftKey]);

  useEffect(() => () => {
    docs.current.forEach((d) => { if (d.url) URL.revokeObjectURL(d.url); });
    mdUrls.current.forEach((m) => URL.revokeObjectURL(m.url));
    clearTimeout(toastTimer.current);
    clearTimeout(mdTimer.current);
  }, []);

  // ---- content access -----------------------------------------------------------------------------
  const getBytes = useCallback((path) => {
    if (edits.current.has(path)) return enc.encode(edits.current.get(path));
    const n = vfsRef.current.get(path);
    if (!n || n.dir) return new Uint8Array();
    if (n.isNew || !n.origPath) return newData.current.get(path) || new Uint8Array();
    if (cache.current.has(n.origPath)) return cache.current.get(n.origPath);
    const out = unzipSync(zipBytes.current, { filter: (f) => f.name === n.origPath })[n.origPath] || new Uint8Array();
    cache.current.set(n.origPath, out);
    return out;
  }, []);

  const markDirty = useCallback((path, on) => {
    setDirty((prev) => {
      if (prev.has(path) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(path); else next.delete(path);
      return next;
    });
  }, []);

  const onEdit = useCallback((text) => {
    const doc = editorDocRef.current;
    if (!doc) return;
    const orig = origTexts.current.get(doc.path) ?? '';
    if (text === orig) { edits.current.delete(doc.path); markDirty(doc.path, false); } else { edits.current.set(doc.path, text); markDirty(doc.path, true); }
    touchRef.current();
    if (isMdFile(doc.path)) { clearTimeout(mdTimer.current); mdTimer.current = setTimeout(() => setMdTick((t) => t + 1), 180); }
  }, [markDirty]);

  const setTextFor = useCallback((path, text) => {
    const orig = origTexts.current.get(path) ?? '';
    if (text === orig) { edits.current.delete(path); markDirty(path, false); } else { edits.current.set(path, text); markDirty(path, true); }
    touchRef.current();
  }, [markDirty]);
  const switchView = useCallback((path, toText) => {
    setRawText((prev) => { const n = new Set(prev); if (toText) n.add(path); else n.delete(path); return n; });
    if (toText) { // the code editor must start from the text the grid produced
      gens.current.set(path, (gens.current.get(path) || 0) + 1);
      setEditorDoc({ path, docId: `${path}#${gens.current.get(path)}`, text: edits.current.get(path) ?? origTexts.current.get(path) ?? '' });
    }
  }, []);

  // ---- tabs ---------------------------------------------------------------------------------------
  const openFile = useCallback((path) => {
    const node = vfsRef.current.get(path);
    if (!node || node.dir) return;
    let doc = docs.current.get(path);
    if (!doc) {
      if (node.size > MAX_EDIT_BYTES && !node.isNew && !edits.current.has(path)) {
        doc = { kind: 'large', size: node.size };
      } else {
        const bytes = getBytes(path);
        if (isBinary(path, bytes)) {
          const mime = IMAGE_MIME[extOf(path)];
          doc = mime ? { kind: 'image', size: bytes.length, url: URL.createObjectURL(new Blob([bytes], { type: mime })) } : { kind: 'binary', size: bytes.length };
        } else {
          if (!origTexts.current.has(path)) origTexts.current.set(path, node.isNew ? '' : dec.decode(bytes));
          doc = { kind: 'text', size: bytes.length };
        }
      }
      docs.current.set(path, doc);
    }
    if (doc.kind === 'text') {
      const gen = gens.current.get(path) || 0;
      setEditorDoc({ path, docId: `${path}#${gen}`, text: edits.current.get(path) ?? origTexts.current.get(path) ?? '' });
    }
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
    if (window.matchMedia('(max-width: 760px)').matches) setExplorer(false);
  }, [getBytes]);

  // ---- markdown preview ---------------------------------------------------------------------------
  const setMdView = useCallback((path, mode) => {
    setMdMode((prev) => new Map(prev).set(path, mode));
  }, []);

  // opening a markdown file: rendered preview, unless the file is empty (then the editor, so a new note can be typed)
  useEffect(() => {
    if (!active || !isMdFile(active)) return;
    setMdMode((prev) => {
      if (prev.has(active)) return prev;
      const t = edits.current.get(active) ?? origTexts.current.get(active) ?? '';
      return new Map(prev).set(active, t.trim() ? 'preview' : 'text');
    });
  }, [active]);

  // a path written inside a markdown file ("img/logo.png", "../docs/a.md") -> the matching file of the archive (or null)
  const resolveMdPath = useCallback((mdPath, rel) => {
    let r = String(rel || '').split('#')[0].split('?')[0];
    try { r = decodeURI(r); } catch { /* keep as written */ }
    if (!r) return null;
    const out = [];
    for (const seg of (r.startsWith('/') ? r.slice(1) : `${dirOf(mdPath)}${r}`).split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    const p = out.join('/');
    const hit = vfsRef.current.get(p);
    if (hit && !hit.dir) return p;
    const low = p.toLowerCase();
    for (const [k, v] of vfsRef.current) if (!v.dir && k.toLowerCase() === low) return k;
    return null;
  }, []);

  // images referenced from a markdown file live inside the archive: hand the preview a blob URL for them
  const resolveMdAsset = useCallback((mdPath, src) => {
    const p = resolveMdPath(mdPath, src);
    const mime = p ? IMAGE_MIME[extOf(p)] : null;
    if (!p || !mime) return null;
    const sig = `${vfsRef.current.get(p)?.size}:${edits.current.get(p)?.length ?? ''}`;
    const hit = mdUrls.current.get(p);
    if (hit && hit.sig === sig) return hit.url;
    const url = URL.createObjectURL(new Blob([getBytes(p)], { type: mime }));
    mdUrls.current.set(p, { url, sig });
    return url;
  }, [getBytes, resolveMdPath]);

  const openMdLink = useCallback((mdPath, href) => {
    const p = resolveMdPath(mdPath, href);
    if (p) { setSel(p); openFile(p); } else flash(`${tt('File not found in this archive: ', 'الملف غير موجود في هذا الأرشيف: ')}${href}`);
  }, [resolveMdPath, openFile, flash, tt]);

  // clicking a task checkbox in the preview flips "[ ]" / "[x]" in the markdown source
  const toggleMdTask = useCallback((path, n) => {
    const cur = edits.current.get(path) ?? origTexts.current.get(path) ?? '';
    const lines = cur.split('\n');
    const re = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
    if (!re.test(lines[n] || '')) return;
    lines[n] = lines[n].replace(re, (_m, a, b, c) => `${a}${b === ' ' ? 'x' : ' '}${c}`);
    const next = lines.join('\n');
    setTextFor(path, next);
    gens.current.set(path, (gens.current.get(path) || 0) + 1);
    setEditorDoc({ path, docId: `${path}#${gens.current.get(path)}`, text: next });
    setMdTick((t) => t + 1);
  }, [setTextFor]);
  const mdResolve = useCallback((src) => resolveMdAsset(activeRef.current, src), [resolveMdAsset]);
  const mdOpen = useCallback((href) => openMdLink(activeRef.current, href), [openMdLink]);
  const mdToggle = useCallback((n) => toggleMdTask(activeRef.current, n), [toggleMdTask]);

  // reopen the tabs that were open before the refresh
  useEffect(() => {
    if (phase !== 'ready' || !pendingTabs.current) return;
    const { tabs: ts, active: act } = pendingTabs.current;
    pendingTabs.current = null;
    ts.filter((p) => p !== act).forEach((p) => openFile(p));
    if (act) openFile(act);
  }, [phase, openFile]);

  const closeTab = useCallback((path) => {
    const cur = tabsRef.current;
    const i = cur.indexOf(path);
    if (i < 0) return;
    const rest = cur.filter((p) => p !== path);
    gens.current.set(path, (gens.current.get(path) || 0) + 1);
    const d = docs.current.get(path);
    if (d?.url) URL.revokeObjectURL(d.url);
    docs.current.delete(path);
    setTabs(rest);
    if (activeRef.current === path) {
      const next = rest[Math.min(i, rest.length - 1)] || null;
      setActive(next);
      if (next) {
        const nd = docs.current.get(next);
        if (nd?.kind === 'text') setEditorDoc({ path: next, docId: `${next}#${gens.current.get(next) || 0}`, text: edits.current.get(next) ?? origTexts.current.get(next) ?? '' });
      }
    }
    if (!rest.some((p) => docs.current.get(p)?.kind === 'text')) setEditorDoc(null);
  }, []);

  const closeMany = useCallback((paths) => { paths.forEach((p) => closeTab(p)); }, [closeTab]);

  // ---- search in files ----------------------------------------------------------------------------
  const getSearchFiles = useCallback(() => {
    const out = [];
    vfsRef.current.forEach((v) => { if (!v.dir) out.push({ path: v.path, size: v.size }); });
    return out;
  }, []);

  // Decompresses a whole batch in one pass; unsaved edits and new files win over the archive copy.
  const readBatch = useCallback(async (paths) => {
    const out = new Map();
    const need = [];
    paths.forEach((p) => {
      if (edits.current.has(p)) { out.set(p, enc.encode(edits.current.get(p))); return; }
      const n = vfsRef.current.get(p);
      if (!n || n.dir) return;
      if (n.isNew || !n.origPath) { out.set(p, newData.current.get(p) || new Uint8Array()); return; }
      if (cache.current.has(n.origPath)) { out.set(p, cache.current.get(n.origPath)); return; }
      need.push([p, n.origPath]);
    });
    if (need.length) {
      const want = new Set(need.map((x) => x[1]));
      const got = unzipSync(zipBytes.current, { filter: (f) => want.has(f.name) });
      need.forEach(([p, o]) => { if (got[o]) out.set(p, got[o]); });
    }
    return out;
  }, []);

  const showSearch = useCallback(() => {
    setExplorer(true);
    setSideTab('search');
    setSearchFocus((k) => k + 1);
  }, []);

  const openMatch = useCallback((path, m, spec) => {
    openFile(path);
    revealSeq.current += 1;
    setReveal({ key: revealSeq.current, path, line: m.line, col: m.col, len: m.len, spec });
  }, [openFile]);

  // ---- file operations ----------------------------------------------------------------------------
  const exists = (p) => vfsRef.current.has(p) || vfsRef.current.has(`${p}/`) || [...vfsRef.current.keys()].some((k) => k.startsWith(`${p}/`));

  // true when some parent segment of `p` is a regular file (can't put things "inside" a file)
  const underFile = (p) => {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) { const v = vfsRef.current.get(parts.slice(0, i).join('/')); if (v && !v.dir) return true; }
    return false;
  };

  const expandTo = (path) => {
    const parts = path.split('/').filter(Boolean);
    setOpen((o) => { const n = new Set(o); for (let i = 1; i < parts.length; i += 1) n.add(`${parts.slice(0, i).join('/')}/`); return n; });
  };

  const createEntry = (raw, kind) => {
    let clean = raw.trim().replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (kind === 'folder' && clean && !clean.endsWith('/')) clean += '/';
    if (!clean || clean.split('/').some((s2) => s2 === '..' || s2 === '.')) return tt('Enter a valid path.', 'اكتب مسارًا صحيحًا.');
    const isDir = clean.endsWith('/');
    if (kind === 'file' && isDir) return tt('Type a file name after the folder path.', 'اكتب اسم الملف بعد مسار المجلد.');
    const path = clean;
    if (exists(isDir ? path.slice(0, -1) : path)) return tt('That name already exists.', 'الاسم موجود بالفعل.');
    if (underFile(path)) return tt('A file with that name is in the way.', 'يوجد ملف بنفس اسم أحد المجلدات في المسار.');
    const next = new Map(vfsRef.current);
    next.set(path, { path, dir: isDir, size: 0, origPath: null, isNew: true });
    if (!isDir) newData.current.set(path, new Uint8Array());
    setVfs(next);
    vfsRef.current = next; // several entries created in one go (AI chat) must see each other before the next render
    expandTo(path);
    if (isDir) setOpen((o) => new Set(o).add(path));
    setSel(path);
    if (!isDir) setTimeout(() => openFile(path), 0);
    return null;
  };

  // Moves / renames a file or folder (and everything inside it). Returns an error string or null.
  const relocate = (oldPath, newPath) => {
    const isDir = oldPath.endsWith('/');
    if (newPath === oldPath) return null;
    if (isDir && newPath.startsWith(oldPath)) return tt('A folder can’t be moved into itself.', 'لا يمكن نقل المجلد إلى داخل نفسه.');
    if (exists(isDir ? newPath.slice(0, -1) : newPath)) return tt('That name already exists.', 'الاسم موجود بالفعل.');
    if (underFile(newPath)) return tt('A file with that name is in the way.', 'يوجد ملف بنفس اسم أحد المجلدات في المسار.');
    const moved = [...vfsRef.current.keys()].filter((k) => (isDir ? k.startsWith(oldPath) : k === oldPath));
    closeMany(moved.filter((k) => tabsRef.current.includes(k)));
    const next = new Map();
    vfsRef.current.forEach((v, k) => {
      if (moved.includes(k)) {
        const nk = isDir ? newPath + k.slice(oldPath.length) : newPath;
        next.set(nk, { ...v, path: nk });
        [edits, origTexts, newData].forEach((m) => { if (m.current.has(k)) { m.current.set(nk, m.current.get(k)); m.current.delete(k); } });
        if (dirty.has(k)) { markDirty(k, false); markDirty(nk, true); }
      } else next.set(k, v);
    });
    setVfs(next);
    if (isDir) setOpen((o) => { const n = new Set(); o.forEach((p) => n.add(p.startsWith(oldPath) ? newPath + p.slice(oldPath.length) : p)); return n; });
    expandTo(newPath);
    setSel(newPath);
    return null;
  };

  const renameEntry = (oldPath, rawName) => {
    const isDir = oldPath.endsWith('/');
    const name = rawName.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!name || name.split('/').some((s2) => s2 === '..' || s2 === '.')) return tt('Enter a valid name.', 'اكتب اسمًا صحيحًا.');
    const parent = dirName(oldPath);
    return relocate(oldPath, `${parent ? `${parent}/` : ''}${name}${isDir ? '/' : ''}`);
  };

  const moveInto = (src, destDir) => {
    const isDir = src.endsWith('/');
    if (dirOf(src) === destDir && !(isDir && destDir === src)) return null; // already there
    return relocate(src, `${destDir}${baseName(src)}${isDir ? '/' : ''}`);
  };

  const duplicateFile = (path) => {
    const taken = (p) => exists(p);
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const guess = dot > slash + 1 ? `${path.slice(0, dot)} copy${path.slice(dot)}` : `${path} copy`;
    const target = taken(guess) ? uniquePath(guess, taken) : guess;
    const bytes = getBytes(path);
    const next = new Map(vfsRef.current);
    next.set(target, { path: target, dir: false, size: bytes.length, origPath: null, isNew: true });
    newData.current.set(target, bytes.slice());
    setVfs(next);
    expandTo(target);
    setSel(target);
    setTimeout(() => openFile(target), 0);
  };

  const deleteEntry = (path) => {
    const isDir = path.endsWith('/');
    const gone = [...vfsRef.current.keys()].filter((k) => (isDir ? k.startsWith(path) : k === path));
    closeMany(gone.filter((k) => tabsRef.current.includes(k)));
    const next = new Map(vfsRef.current);
    let removedOrig = 0;
    gone.forEach((k) => {
      const v = next.get(k);
      if (v && !v.isNew && !v.dir) removedOrig += 1;
      next.delete(k);
      edits.current.delete(k); origTexts.current.delete(k); newData.current.delete(k); markDirty(k, false);
    });
    setVfs(next);
    setDeletedCount((c) => c + removedOrig);
    setSel((cur) => (cur === path || (isDir && cur.startsWith(path)) ? dirOf(path.endsWith('/') ? dirName(path) : path) : cur));
  };

  const resetAll = () => {
    closeMany([...tabsRef.current]);
    edits.current.clear(); origTexts.current.clear(); newData.current.clear();
    const map = new Map();
    unzipSync(zipBytes.current, { filter: (f) => { if (!isNoise(f.name)) map.set(f.name, { path: f.name, dir: f.name.endsWith('/'), size: f.originalSize, origPath: f.name, isNew: false }); return false; } });
    setVfs(map); setDirty(new Set()); setDeletedCount(0); setEditorDoc(null); setSel(defaultSel.current);
  };

  // ---- change summary + download ------------------------------------------------------------------
  const changes = useMemo(() => {
    let n = deletedCount;
    vfs.forEach((v) => { if (!v.dir && (v.isNew || v.path !== v.origPath || dirty.has(v.path))) n += 1; });
    // dirty files that are also new/renamed were counted once above
    return n;
  }, [vfs, dirty, deletedCount]);

  deletedRef.current = deletedCount;
  const draft = useAutoDraft({
    draftKey, dirty: changes > 0, always: true, ready: draftReady && phase === 'ready', token: `${changes}|${tabs.join('\n')}|${active}`,
    build: () => snapshotDraft({ vfs: vfsRef.current, edits: edits.current, newData: newData.current, deletedCount: deletedRef.current, tabs: tabsRef.current, active: activeRef.current, sig: baseSig.current }),
    meta: { name: fileName },
    saver: onSave ? () => saveRef.current?.() : undefined,
  });
  touchRef.current = draft.touch;

  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = () => {
      if (changes === 0) return true;
      if (onSave) return askUnsaved({ key: draftKey, name: fileName, tt, discard: () => discardDraft(draftKey) }); // Promise<boolean>: Save / Don't save / Cancel
      return window.confirm(tt('You have unsaved edits in this archive. Close without downloading the new ZIP?', 'عندك تعديلات لم تُنزَّل على هذا الأرشيف. تقفل بدون تنزيل الـ ZIP الجديد؟')) && (discardDraft(draftKey), true);
    };
    return () => { guardRef.current = null; };
  }, [guardRef, changes, tt, onSave, draftKey, fileName]);

  const saveBlob = (data, name, type) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // the whole archive as it is right now (edits, new, renamed and deleted entries applied)
  const buildZipBytes = () => {
    const out = {};
    vfsRef.current.forEach((v) => {
      if (v.dir) { out[v.path] = new Uint8Array(); return; }
      out[v.path] = [getBytes(v.path), { level: STORE_EXT.has(extOf(v.path)) ? 0 : 6, mtime: new Date() }];
    });
    return zipSync(out);
  };

  const downloadZip = () => {
    if (!canDownload) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const stem = fileName.replace(/\.zip$/i, '');
        saveBlob(buildZipBytes(), `${stem}${changes ? '-edited' : ''}.zip`, 'application/zip');
        flash(tt('ZIP built and downloaded.', 'تم إنشاء الـ ZIP وتنزيله.'));
      } catch (err) {
        flash(tt('Could not build the ZIP: ', 'تعذّر إنشاء الـ ZIP: ') + String(err?.message || err));
      } finally { setBusy(false); }
    }, 30);
  };

  // After a successful save the saved archive becomes the new baseline: nothing is "changed" any more,
  // while open tabs, the selection and the editor contents stay exactly as they were.
  const rebase = (bytes) => {
    docs.current.forEach((d, p) => { if (d.kind === 'text') origTexts.current.set(p, edits.current.get(p) ?? origTexts.current.get(p) ?? ''); });
    edits.current.clear(); newData.current.clear(); cache.current.clear();
    zipBytes.current = bytes;
    const map = new Map();
    unzipSync(bytes, { filter: (f) => { if (!isNoise(f.name)) map.set(f.name, { path: f.name, dir: f.name.endsWith('/'), size: f.originalSize, origPath: f.name, isNew: false }); return false; } });
    baseSig.current = sigOf([...map.values()]); baseMapRef.current = map;
    setVfs(map); setDirty(new Set()); setDeletedCount(0); setRestoredInfo(null);
  };

  const doSave = async (force = false) => {
    if (!onSave || saving || busy) return false;
    if (changes === 0 && !force) { flash(tt('No changes to save.', 'لا توجد تعديلات للحفظ.')); return true; }
    setSaving(true);
    await new Promise((r) => { setTimeout(r, 30); }); // let the "Saving…" state paint before the heavy zip work
    let saveBlobData = null;
    try {
      const bytes = buildZipBytes();
      if (bytes.length > MAX_SAVE_BYTES) throw new Error(tt('The archive is larger than the 50MB upload limit — remove some files, or download it instead.', 'الأرشيف أكبر من حد الرفع (50MB) — احذف بعض الملفات أو نزّله بدل الحفظ.'));
      saveBlobData = new Blob([bytes], { type: 'application/zip' });
      ownBlob.current = saveBlobData; // set before the parent re-renders with the saved copy
      const saved = await onSave(saveBlobData, { force });
      rebase(bytes);
      flash(saved?.message || (saved?.version
        ? tt(`Saved — version ${saved.version} is now what everyone on the project sees.`, `تم الحفظ — النسخة ${saved.version} هي اللي هيشوفها كل أعضاء المشروع.`)
        : tt('Saved for everyone on the project.', 'تم الحفظ لكل أعضاء المشروع.')));
      return true;
    } catch (err) {
      if (ownBlob.current === saveBlobData) ownBlob.current = null;
      if (err?.status === 409) setDlg({ type: 'overwrite' });
      else flash(tt('Could not save: ', 'تعذّر الحفظ: ') + String(err?.message || err));
      return false;
    } finally { setSaving(false); }
  };
  saveRef.current = () => doSave(false);

  const downloadFile = (path) => {
    if (!canDownload) return;
    const bytes = getBytes(path);
    saveBlob(bytes, baseName(path), 'application/octet-stream');
  };

  const downloadFolder = (path) => {
    if (!canDownload) return;
    const root = baseName(path);
    const out = {};
    vfsRef.current.forEach((v, k) => {
      if (!k.startsWith(path)) return;
      const rel = `${root}/${k.slice(path.length)}`;
      if (v.dir) { out[rel.endsWith('/') ? rel : `${rel}/`] = new Uint8Array(); return; }
      out[rel] = [getBytes(k), { level: STORE_EXT.has(extOf(k)) ? 0 : 6, mtime: new Date() }];
    });
    saveBlob(zipSync(out), `${root}.zip`, 'application/zip');
  };

  // ---- adding files / folders ---------------------------------------------------------------------
  const commitImport = (read, dirs, mode) => {
    const next = new Map(vfsRef.current);
    const added = [];
    let replaced = 0;
    read.forEach(({ path, data }) => {
      let target = path;
      const cur = next.get(path);
      if (cur && !cur.dir) {
        if (mode === 'skip') return;
        if (mode === 'both') target = uniquePath(path, (p) => next.has(p) || next.has(`${p}/`));
        else {
          if (tabsRef.current.includes(path)) closeTab(path);
          edits.current.delete(path); origTexts.current.delete(path); markDirty(path, false);
          replaced += 1;
        }
      }
      next.set(target, { path: target, dir: false, size: data.length, origPath: null, isNew: true });
      newData.current.set(target, data);
      added.push(target);
    });
    dirs.forEach((d) => { if (!next.has(d)) next.set(d, { path: d, dir: true, size: 0, origPath: null, isNew: true }); });
    setVfs(next);
    setOpen((o) => {
      const n = new Set(o);
      [...added, ...dirs].forEach((p) => { const parts = p.split('/').filter(Boolean); for (let i = 1; i < parts.length; i += 1) n.add(`${parts.slice(0, i).join('/')}/`); });
      dirs.forEach((d) => n.add(d));
      return n;
    });
    if (added.length) setSel(added[added.length - 1]);
    else if (dirs.length) setSel(dirs[0]);
    if (added.length === 1 && !dirs.length) setTimeout(() => openFile(added[0]), 0);
    const parts = [];
    if (added.length) parts.push(tt(`${added.length} file${added.length === 1 ? '' : 's'} added`, `تمت إضافة ${added.length} ملف`));
    if (dirs.length && !added.length) parts.push(tt(`${dirs.length} folder${dirs.length === 1 ? '' : 's'} added`, `تمت إضافة ${dirs.length} مجلد`));
    if (replaced) parts.push(tt(`${replaced} replaced`, `${replaced} تم استبداله`));
    return parts.join(' · ');
  };

  const importItems = async (items, base, truncated) => {
    if (readOnly) return;
    if (!items.length) return;
    setImporting(true);
    try {
      const picked = [];
      const dirs = [];
      let skipped = truncated ? 1 : 0;
      let total = 0;
      items.forEach((it) => {
        const rel = cleanRel(it.rel);
        if (!rel) { skipped += 1; return; }
        const path = base + rel;
        if (underFile(path)) { skipped += 1; return; }
        if (it.dir || rel.endsWith('/')) { dirs.push(path.endsWith('/') ? path : `${path}/`); return; }
        if (it.file.size > MAX_UPLOAD_FILE || total + it.file.size > MAX_UPLOAD_TOTAL) { skipped += 1; return; }
        total += it.file.size;
        picked.push({ path, file: it.file });
      });
      const read = [];
      for (const f of picked) {
        // eslint-disable-next-line no-await-in-loop
        read.push({ path: f.path, data: new Uint8Array(await f.file.arrayBuffer()) });
      }
      // a file can't replace a folder of the same name
      const ok = read.filter((r) => { const blocked = vfsRef.current.has(`${r.path}/`) || [...vfsRef.current.keys()].some((k) => k.startsWith(`${r.path}/`)); if (blocked) skipped += 1; return !blocked; });
      const conflicts = ok.filter((r) => vfsRef.current.get(r.path)?.dir === false).map((r) => r.path);
      if (skipped) flash(tt(`${skipped} item${skipped === 1 ? ' was' : 's were'} skipped (too large, unsafe path, or a name clash).`, `تم تخطي ${skipped} عنصر (كبير جدًا أو مسار غير آمن أو تعارض أسماء).`));
      if (conflicts.length) { setDlg({ type: 'conflict', pack: { read: ok, dirs, conflicts } }); return; }
      const msg = commitImport(ok, dirs, 'replace');
      if (msg && !skipped) flash(msg);
    } catch (err) {
      flash(tt('Could not add files: ', 'تعذّرت إضافة الملفات: ') + String(err?.message || err));
    } finally { setImporting(false); }
  };

  const pickUpload = (kind, base) => {
    if (readOnly) return;
    uploadBase.current = base;
    const el = kind === 'dir' ? dirInput.current : fileInput.current;
    if (!el) return;
    el.value = '';
    el.click();
  };

  const onPicked = (e, keepFolders) => {
    const { items, truncated } = itemsFromFileList(e.target.files || [], keepFolders);
    e.target.value = '';
    importItems(items, uploadBase.current, truncated);
  };

  const startNew = (kind, base) => !readOnly && setDlg({ type: 'new', kind, value: base, base });

  // ---- drag & drop (files from the desktop, and moving entries inside the tree) --------------------
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files') || hasDriveIds(e.dataTransfer); // OS files, or My PC files dragged from an explorer window
  const destFromEvent = (e) => {
    if (e.target.closest?.('.zb-side')) {
      const row = e.target.closest('[data-dir]');
      return row ? row.getAttribute('data-dir') : '';
    }
    return dirOf(sel);
  };
  const onDragOver = (e) => {
    if (dragSrc.current) {
      if (!e.target.closest?.('.zb-side')) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropDir(destFromEvent(e)); return;
    }
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropDir(destFromEvent(e));
  };
  /** My PC files / folders (from an explorer window or a desktop icon) -> into the project, at `dest`. */
  const importDriveNodes = async (nodes, dest) => {
    if (readOnly) return;
    setImporting(true);
    try {
      const items = await nodesToImportItems(nodes);
      setImporting(false);
      await importItems(items, dest, false);
    } catch (err) {
      setImporting(false);
      flash(tt('Could not add files: ', 'تعذّرت إضافة الملفات: ') + String(err?.message || err));
    }
  };
  const dropRef = useRef(null);
  const destFromTarget = (t) => {
    if (t?.closest?.('.zb-side')) { const row = t.closest('[data-dir]'); return row ? row.getAttribute('data-dir') : ''; }
    return dirOf(sel);
  };
  dropRef.current = (nodes, t) => importDriveNodes(nodes, destFromTarget(t));
  useEffect(() => { // a desktop icon released over this window (see lib/driveDnd.js)
    const el = mainRef.current;
    if (!el) return undefined;
    const h = (e) => dropRef.current?.(e.detail?.nodes || [], e.detail?.target);
    el.addEventListener(DROP_EVENT, h);
    return () => el.removeEventListener(DROP_EVENT, h);
  }, [phase]);
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropDir(null); };
  const onDrop = async (e) => {
    if (readOnly) return;
    const src = dragSrc.current;
    if (src) {
      e.preventDefault();
      const dest = destFromEvent(e);
      dragSrc.current = null; setDropDir(null);
      const err = moveInto(src, dest);
      if (err) flash(err);
      return;
    }
    if (!isFileDrag(e)) return;
    e.preventDefault();
    const dest = destFromEvent(e);
    setDropDir(null);
    if (hasDriveIds(e.dataTransfer) && !e.dataTransfer.files?.length) { await importDriveNodes(readDragNodes(e.dataTransfer), dest); return; }
    const { items, truncated } = await readDataTransfer(e.dataTransfer);
    await importItems(items, dest, truncated);
  };

  // ---- menus --------------------------------------------------------------------------------------
  const copyPath = (p) => {
    const text = p.replace(/\/$/, '');
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => flash(tt('Path copied.', 'تم نسخ المسار.')), () => flash(text));
  };

  const addItems = (base) => readOnly ? [] : [
    { label: tt('New file', 'ملف جديد'), icon: 'file-plus', onClick: () => startNew('file', base) },
    { label: tt('New folder', 'مجلد جديد'), icon: 'folder-plus', onClick: () => startNew('folder', base) },
    { sep: true },
    { label: tt('Upload files…', 'رفع ملفات…'), icon: 'file-up', onClick: () => pickUpload('file', base) },
    { label: tt('Upload folder…', 'رفع مجلد…'), icon: 'folder-up', onClick: () => pickUpload('dir', base) },
  ];

  // "Run this file": open it, drop any earlier dropdown pick (which would override the file being looked at) and start it
  const runnableFile = (path) => !!LANGS[extOf(path)] || /\.html?$/i.test(path);
  const [pendingRun, setPendingRun] = useState(null);
  const runThisFile = (path) => {
    setPendingRun(path);
    setRunChoice(null); runner.stop(); sandbox.reset();
    openFile(path);
  };

  const menuFor = (path) => {
    const base = dirOf(path);
    if (!path) return addItems('');
    const isDir = path.endsWith('/');
    if (readOnly) {
      return [
        ...(isDir ? [] : [{ label: tt('Open', 'فتح'), icon: 'file', onClick: () => openFile(path) }]),
        ...(!isDir && canDownload ? [{ label: tt('Download', 'تنزيل'), icon: 'download', onClick: () => downloadFile(path) }] : []),
        ...(!isDir && canRun && runnableFile(path) ? [{ label: tt('Run this file', 'تشغيل هذا الملف'), icon: 'play', onClick: () => runThisFile(path) }] : []),
        ...(isDir && canDownload ? [{ label: tt('Download as ZIP', 'تنزيل كـ ZIP'), icon: 'archive', onClick: () => downloadFolder(path) }] : []),
        { label: tt('Copy path', 'نسخ المسار'), icon: 'link', onClick: () => copyPath(path) },
      ];
    }
    const items = isDir ? addItems(base) : [
      { label: tt('Open', 'فتح'), icon: 'file', onClick: () => openFile(path) },
      ...(canDownload ? [{ label: tt('Download', 'تنزيل'), icon: 'download', onClick: () => downloadFile(path) }] : []),
      { label: tt('Duplicate', 'تكرار'), icon: 'copy', onClick: () => duplicateFile(path) },
      ...(canRun && runnableFile(path) ? [{ label: tt('Run this file', 'تشغيل هذا الملف'), icon: 'play', onClick: () => runThisFile(path) }] : []),
    ];
    items.push({ sep: true });
    items.push({ label: tt('Rename', 'إعادة تسمية'), icon: 'edit', hint: 'F2', onClick: () => setDlg({ type: 'rename', path, value: baseName(path) }) });
    items.push({ label: tt('Delete', 'حذف'), icon: 'trash', danger: true, hint: 'Del', onClick: () => setDlg({ type: 'delete', path }) });
    items.push({ sep: true });
    if (isDir && canDownload) items.push({ label: tt('Download as ZIP', 'تنزيل كـ ZIP'), icon: 'archive', onClick: () => downloadFolder(path) });
    items.push({ label: tt('Copy path', 'نسخ المسار'), icon: 'link', onClick: () => copyPath(path) });
    return items;
  };

  const openCtx = (e, path) => {
    e.preventDefault(); e.stopPropagation();
    setSel(path);
    setMenu({ x: e.clientX, y: e.clientY, items: menuFor(path) });
  };
  const openMenuAt = (el, items, title) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items, title });
  };
  const pickTheme = (id) => {
    setTheme(id);
    try { window.localStorage.setItem('zb-theme', id); } catch { /* storage unavailable */ }
  };
  const themeItems = () => THEMES.map((th) => ({ label: th.name, hint: th.hint, swatch: [th.ui.bg, th.ui.accent, th.ed.keyword], checked: th.id === theme, onClick: () => pickTheme(th.id) }));

  // ---- run (Python / React / HTML run inside the browser, on the isolated runner origin) --------------
  const runApps = useMemo(() => {
    const paths = [];
    vfs.forEach((v) => { if (!v.dir) paths.push(v.path); });
    const readText = (p) => { if (!vfsRef.current.has(p)) return null; try { return dec.decode(getBytes(p)); } catch { return null; } };
    return detectApps(paths, { activePath: active, readText, sandbox: !!(projectId || sandboxTokenPath) });
  }, [vfs, active, getBytes, projectId, sandboxTokenPath]);
  const runApp = runApps.find((a) => a.id === runChoice) || runApps.find((a) => a.current) || defaultApp(runApps) || runApps[0] || null;

  // What gets shipped to the runner. A Python run only needs the script's own project folder (not the whole archive),
  // minus build output / dependency folders and big binaries — otherwise a Python file dropped into a big React
  // project would copy ~1000 unrelated files into the Python engine on every Run.
  const PY_SKIP_DIRS = /(^|\/)(node_modules|\.git|vendor|__pycache__|\.venv|venv|dist|build|\.next|\.cache|coverage|android|ios)\//;
  const collectRunFiles = (app) => {
    const files = {}; let total = 0; let skipped = 0;
    const py = app?.kind === 'python';
    const prefix = py && app.root ? app.root : '';
    const limit = py ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    vfsRef.current.forEach((v, path) => {
      if (v.dir || /(^|\/)(node_modules|\.git|vendor|__pycache__|\.venv|venv)\//.test(path)) return;
      if (py && ((prefix && !path.startsWith(prefix)) || PY_SKIP_DIRS.test(path.slice(prefix.length ? prefix.length - 1 : 0)))) return;
      const bytes = getBytes(path);
      if (bytes.length > limit) { skipped += 1; return; }
      total += bytes.length; files[path] = bytes;
    });
    // a loose JavaScript file runs in the browser tab: the runner gets a tiny page that loads it (prompt() / alert() / console work as in DevTools)
    if (app?.kind === 'web' && app.jsEntry && app.entry) {
      const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      files[(app.root || '') + 'index.html'] = enc.encode(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(app.entry)}</title></head><body><script src="./${encodeURI(app.entry)}"></script></body></html>`);
    }
    // a loose HTML page (not called index.html) is handed to the runner as the document to render
    if (app?.kind === 'web' && app.entry && /\.html?$/i.test(app.entry)) {
      const eb = vfsRef.current.has((app.root || '') + app.entry) ? getBytes((app.root || '') + app.entry) : null;
      if (eb) files[(app.root || '') + 'index.html'] = eb;
    }
    return { files, total, skipped };
  };

  // The sandbox gets the app's own folder as a zip (paths relative to the app root). Dependencies are installed THERE
  // (npm / composer / pip), so node_modules, vendor, virtualenvs and build output are left out.
  const SBX_SKIP = /(^|\/)(node_modules|\.git|vendor|__pycache__|\.venv|venv|\.next|\.cache|coverage|android|ios)\/|^\/(dist|build)\//; // (public/build of a Laravel app is kept)
  const SBX_MAX_TOTAL = 50 * 1024 * 1024;
  const collectSandboxZip = (app) => {
    const prefix = app.root || '';
    const entries = {}; let total = 0; let skipped = 0;
    vfsRef.current.forEach((v, path) => {
      if (v.dir || (prefix && !path.startsWith(prefix))) return;
      const rel = path.slice(prefix.length);
      if (!rel || SBX_SKIP.test(`/${rel}`)) return;
      const bytes = getBytes(path);
      if (bytes.length > 10 * 1024 * 1024) { skipped += 1; return; }
      total += bytes.length; entries[rel] = bytes;
    });
    return { zip: total > SBX_MAX_TOTAL ? null : zipSync(entries, { level: 1 }), total, skipped };
  };
  const startSandbox = ({ cols, rows } = {}) => {
    const { zip, skipped } = collectSandboxZip(runApp);
    if (!zip) { flash(tt('This project is too large for the sandbox (50 MB without dependencies).', 'المشروع كبير جدًا على الـ sandbox (50 ميجا من غير المكتبات).')); return; }
    if (skipped) flash(tt(`${skipped} large file(s) were left out of the run.`, `${skipped} ملف كبير اتستبعد من التشغيل.`));
    sandbox.start({ kind: runApp.sandbox, entry: runApp.entry || '', zip, cols, rows, choice: runChoice || '' });
  };

  const startRun = (opts = {}) => {
    setRunOpen(true);
    if (runApp?.kind === 'sandbox') { startSandbox(opts); return; }
    if (!runApp || runApp.kind === 'unsupported') return;
    const { files, total, skipped } = collectRunFiles(runApp);
    if (total > 80 * 1024 * 1024) { flash(tt('This project is too large to run in the browser.', 'المشروع كبير جدًا للتشغيل في المتصفح.')); return; }
    if (skipped) flash(tt(`${skipped} large file(s) were left out of the run.`, `${skipped} ملف كبير اتستبعد من التشغيل.`));
    runner.run({ kind: runApp.kind, files, root: runApp.root, entry: runApp.entry, stdin: opts.stdin || '' });
  };
  // run the file chosen with "Run this file" as soon as it leads the run list
  useEffect(() => {
    if (!pendingRun || active !== pendingRun || !runApp || !runApp.current) return;
    setPendingRun(null);
    startRun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun, active, runApp]);
  // a refresh while a server was running: re-attach to it instead of uploading + installing everything again
  const resumedOnce = useRef(false);
  useEffect(() => {
    if (phase !== 'ready' || resumedOnce.current || !draftKey) return;
    resumedOnce.current = true;
    const m = sandbox.resumable();
    if (!m) return;
    setRunChoice(m.choice || null);
    setRunOpen(true);
    sandbox.resumeSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, draftKey]);
  // a code file opens with its Run panel already showing (nothing is started until the student presses Run)
  const autoOpened = useRef(false);
  useEffect(() => {
    if (phase !== 'ready' || autoOpened.current || !runApp || runApp.kind === 'unsupported' || !runApp.entry) return;
    autoOpened.current = true;
    setRunOpen(true);
  }, [phase, runApp]);
  // ---- AI: explain / fix the error shown in the terminal / console --------------------------------------------------
  const textOf = (path) => {
    if (edits.current.has(path)) return edits.current.get(path);
    if (origTexts.current.has(path)) return origTexts.current.get(path);
    const n = vfsRef.current.get(path);
    if (!n || n.dir) return null;
    try { const b = getBytes(path); return isBinary(path, b) ? null : dec.decode(b); } catch { return null; }
  };
  const runOutput = () => (runApp?.kind === 'sandbox'
    ? sandbox.getOutput()
    : runner.logs.map((l) => (/\n$/.test(l.text) ? l.text : `${l.text}\n`)).join(''));
  const explainError = (mode) => {
    const error = tailOutput(runOutput(), ai.limits.max_error_chars || 6000);
    if (!error) { flash(tt('Run the code first — there is no output to explain yet.', 'شغّل الكود الأول — مفيش ناتج أشرحه لسه.')); return; }
    const paths = [];
    vfsRef.current.forEach((v) => { if (!v.dir) paths.push(v.path); });
    const hit = guessErrorFile(error, paths, activeRef.current);
    const path = hit?.path || (docs.current.get(activeRef.current)?.kind === 'text' ? activeRef.current : null);
    if (!path) { flash(tt('Open the file the error comes from, then press “Explain error” again.', 'افتح الملف اللي فيه الخطأ وبعدين اضغط «اشرح الخطأ» تاني.')); return; }
    const code = textOf(path);
    if (code == null || !code.trim()) { flash(tt('Could not read that file.', 'مقدرتش أقرا الملف ده.')); return; }
    const max = ai.limits.max_code_chars || 30000;
    if (code.length > max) { flash(tt(`This file is too large for the assistant (max ${max} characters).`, `الملف كبير على المساعد (الحد الأقصى ${max} حرف).`)); return; }
    ai.ask({ path, code, error, line: hit?.line || null, language: languageOf(path), filename: baseName(path), mode });
  };
  // ---- AI: right-click menu on the selected code (explain / fix / improve / comment / convert / tests) ----------------
  const askAssist = (action, o = {}) => {
    const path = o.path || activeRef.current;
    const code = path ? textOf(path) : null;
    if (code == null || !code.trim()) { flash(tt('Could not read that file.', 'مقدرتش أقرا الملف ده.')); return; }
    const max = ai.limits.max_code_chars || 30000;
    if (code.length > max) { flash(tt(`This file is too large for the assistant (max ${max} characters).`, `الملف كبير على المساعد (الحد الأقصى ${max} حرف).`)); return; }
    ai.ask({
      action, path, code, selFrom: o.fromLine || null, selTo: o.toLine || null, target: o.target || '', line: o.fromLine || null,
      language: languageOf(path), filename: baseName(path), mode: o.mode || ai.panel?.mode || ai.defaultMode,
    });
  };
  // "ask again" / mode switch in the panel: repeat the last question (an error explanation or a menu action)
  const rerunAi = (mode) => {
    const q = ai.panel?.question;
    if (q?.action) askAssist(q.action, { path: q.path, fromLine: q.selFrom, toLine: q.selTo, target: q.target, mode });
    else explainError(mode);
  };
  // right-click inside the editor: our own menu (undo / cut / copy / paste / select all, + the AI actions when something is selected)
  const onEditorContext = ({ x, y, empty, fromLine, toLine, text, edit }) => {
    const pasteBlocked = () => flash(tt('The browser blocked clipboard access — press Ctrl+V to paste.', 'المتصفح منع الوصول للحافظة — اضغط Ctrl+V للّصق.'));
    const items = [
      { label: tt('Undo', 'تراجع'), icon: 'ed-undo', disabled: !edit.canUndo || edit.readOnly, onClick: edit.undo },
      { label: tt('Redo', 'إعادة'), icon: 'ed-redo', disabled: !edit.canRedo || edit.readOnly, onClick: edit.redo },
      { sep: true },
      { label: tt('Cut', 'قص'), icon: 'cut', disabled: empty || edit.readOnly, onClick: () => { edit.cut(); } },
      { label: tt('Copy', 'نسخ'), icon: 'copy', disabled: empty, onClick: () => { edit.copy(); } },
      { label: tt('Paste', 'لصق'), icon: 'paste', disabled: edit.readOnly, onClick: () => { edit.paste().then((ok) => { if (!ok) pasteBlocked(); }); } },
      { sep: true },
      { label: tt('Select all', 'تحديد الكل'), icon: 'select-all', onClick: edit.selectAll },
    ];
    if (ai.available && !empty) {
      const path = activeRef.current;
      const cur = languageOf(path);
      const go = (action, target) => askAssist(action, { path, fromLine, toLine, target });
      const targets = CONVERT_TARGETS.filter((l) => l !== cur && !(cur === 'React JSX' && l === 'JavaScript')).slice(0, 4);
      items.push(
        { sep: true },
        { label: tt('Ask UIPE AI…', 'اسأل UIPE AI…'), icon: 'chat', onClick: () => openChat({ selection: true }) },
        { label: tt('Explain this code', 'اشرح الكود'), icon: 'sparkles', onClick: () => go('explain') },
        { label: tt('Fix bugs', 'صلّح الأخطاء'), icon: 'wrench', onClick: () => go('fix') },
        { label: tt('Improve', 'حسّن الكود'), icon: 'edit', onClick: () => go('improve') },
        { label: tt('Add comments', 'أضف تعليقات'), icon: 'note', onClick: () => go('comment') },
        { label: tt('Write tests', 'اكتب اختبارات'), icon: 'flask', onClick: () => go('test') },
        ...targets.map((l) => ({ label: tt(`Convert to ${l}`, `حوّل إلى ${l}`), icon: 'refresh', onClick: () => go('convert', l) })),
      );
    }
    setMenu({ x, y, items });
    return true;
  };
  // permanent ✨ button in the top bar: the AI features are discoverable without waiting for an error
  const openAiMenu = (el) => {
    const path = activeRef.current;
    const isText = !!path && docs.current.get(path)?.kind === 'text';
    const cur = isText ? languageOf(path) : '';
    const go = (action, target) => askAssist(action, { path, target });
    const targets = CONVERT_TARGETS.filter((l) => l !== cur && !(cur === 'React JSX' && l === 'JavaScript')).slice(0, 3);
    const items = [
      ...(ai.projectMode ? [{ label: tt(`Set by your supervisor: ${ai.projectMode === 'tutor' ? 'Tutor' : 'Assistant'} mode`, `الدكتور ضابط الوضع: ${ai.projectMode === 'tutor' ? 'مدرّس (تلميحات)' : 'مساعد (حلول)'}`), icon: 'lock', disabled: true }, { sep: true }] : []),
      ...(ai.chatAvailable ? [{ label: tt('Chat with AI', 'شات مع الذكاء الاصطناعي'), icon: 'chat', checked: chatOpen, onClick: () => (chatOpen ? closeChat() : openChat()) }, { sep: true }] : []),
      { label: tt('Explain this file', 'اشرح الملف'), icon: 'sparkles', disabled: !isText, onClick: () => go('explain') },
      { label: tt('Fix bugs', 'صلّح الأخطاء'), icon: 'wrench', disabled: !isText, onClick: () => go('fix') },
      { label: tt('Improve', 'حسّن الكود'), icon: 'edit', disabled: !isText, onClick: () => go('improve') },
      { label: tt('Add comments', 'أضف تعليقات'), icon: 'note', disabled: !isText, onClick: () => go('comment') },
      { label: tt('Write tests', 'اكتب اختبارات'), icon: 'flask', disabled: !isText, onClick: () => go('test') },
      ...targets.map((l) => ({ label: tt(`Convert to ${l}`, `حوّل إلى ${l}`), icon: 'refresh', disabled: !isText, onClick: () => go('convert', l) })),
      { sep: true },
      { label: tt('Explain the last error', 'اشرح آخر خطأ'), icon: 'alert-triangle', disabled: !aiOut, hint: aiOut ? undefined : tt('Run the code first', 'شغّل الكود الأول'), onClick: () => explainError(ai.panel?.mode || ai.defaultMode) },
    ];
    if (ai.autocompleteAvailable && !ghostDead) {
      items.push({ sep: true }, {
        label: tt('Autocomplete (Tab to accept)', 'الإكمال التلقائي (Tab للقبول)'), icon: 'ai-spark', checked: ghostPref, onClick: toggleGhost,
      });
    }
    openMenuAt(el, items, tt('AI assistant', 'مساعد الذكاء الاصطناعي'));
  };
  // the code block of a "convert" / "tests" answer becomes a new file next to the source file
  const newFileFromAi = (code) => {
    const p = ai.panel; if (!p) return;
    let path = suggestFileName(p.action, p.path, p.question?.target);
    if (exists(path)) path = uniquePath(path, exists);
    const err = createEntry(path, 'file');
    if (err) { flash(err); return; }
    setTextFor(path, code);
    flash(tt(`Created ${path}`, `اتعمل ${path}`));
  };
  // put new text into the editor (a fresh editor state: the old one still holds the previous text)
  const commitAiText = (path, text) => {
    setTextFor(path, text);
    gens.current.set(path, (gens.current.get(path) || 0) + 1);
    if (activeRef.current === path) setEditorDoc({ path, docId: `${path}#${gens.current.get(path)}`, text });
    else openFile(path);
  };
  const applyAi = (id) => {
    const p = ai.panel; const e = p?.edits.find((x) => x.id === id);
    if (!e) return;
    const cur = textOf(p.path);
    const r = cur == null ? { ok: false } : applyEdit(cur, e);
    if (!r.ok) { ai.mark(id, 'stale'); return; }
    commitAiText(p.path, r.text);
    ai.mark(id, 'applied');
  };
  const applyAllAi = () => {
    const p = ai.panel; if (!p) return;
    let cur = textOf(p.path); let changed = false;
    p.edits.filter((e) => e.state === 'pending').forEach((e) => {
      const r = cur == null ? { ok: false } : applyEdit(cur, e);
      if (r.ok) { cur = r.text; changed = true; ai.mark(e.id, 'applied'); } else ai.mark(e.id, 'stale');
    });
    if (changed) commitAiText(p.path, cur);
  };
  const gotoAi = () => {
    const p = ai.panel; if (!p) return;
    openFile(p.path);
    if (p.line) { revealSeq.current += 1; setReveal({ key: `ai${revealSeq.current}`, path: p.path, line: p.line, col: 0, len: 0 }); }
  };
  // ---- AI chat side panel: the context it sends, and applying the (multi-file) edits the student accepted -----------
  const chatModeNow = chatMode && ai.modes.includes(chatMode) ? chatMode : ai.defaultMode;
  const openChat = (o = {}) => {
    ai.close();
    setChatOpen(true);
    if (o.selection) { setChatCtx((c) => ({ ...c, selection: true })); const s = chatLiveSel(); if (s) pinChatRef(s); }
  };
  // the lines selected in the open file, with their text (what the "Attach selection" card shows)
  const chatLiveSel = () => {
    const p = chatActive();
    if (!p || !cursor.sel) return null;
    const t = textOf(p);
    if (t == null) return null;
    const from = Math.max(1, cursor.sel.from); const to = Math.max(from, cursor.sel.to);
    const text = t.split('\n').slice(from - 1, to).join('\n').slice(0, 4000);
    return text.trim() ? { id: `${p}:${from}-${to}`, path: p, from, to, text } : null;
  };
  const pinChatRef = (r) => {
    setChatRefs((cur) => (cur.some((x) => x.path === r.path && x.from === r.from && x.to === r.to) || cur.length >= 5 ? cur : [...cur, r]));
    setChatCtx((c) => ({ ...c, selection: false })); // it is attached as a quote now: do not send it twice
  };
  const gotoChatRef = (path, line) => {
    if (!path) return;
    openFile(path);
    if (line) { revealSeq.current += 1; setReveal({ key: `ai${revealSeq.current}`, path, line, col: 0, len: 0 }); }
  };
  const closeChat = () => { chat.stop(); setChatOpen(false); };
  const CHAT_FILE_MAX = 100000; // never ship more than this per file (the server clips to its own, smaller limits)
  const chatActive = () => { const p = activeRef.current; return p && docs.current.get(p)?.kind === 'text' ? p : null; };
  const chatSel = () => { const p = chatActive(); return p && cursor.sel && chatCtx.selection ? cursor.sel : null; };
  const buildChatRequest = () => {
    const active = chatActive();
    const files = [];
    if (active && chatCtx.file) { const t = textOf(active); if (t != null) files.push({ path: active, content: t.slice(0, CHAT_FILE_MAX) }); }
    if (chatCtx.others) {
      tabsRef.current.forEach((p) => {
        if (p === active || files.length >= 6) return;
        if (docs.current.get(p)?.kind !== 'text') return;
        const t = textOf(p);
        if (t != null && t.trim()) files.push({ path: p, content: t.slice(0, CHAT_FILE_MAX) });
      });
    }
    const tree = [];
    vfsRef.current.forEach((v) => { if (!v.dir) tree.push(v.path); });
    tree.sort();
    const sel = chatSel();
    const out = chatCtx.output ? tailOutput(runOutput(), ai.limits.max_error_chars || 6000) : '';
    return {
      active_path: active && chatCtx.file ? active : undefined,
      files, tree: tree.slice(0, 400),
      sel_from: sel ? sel.from : undefined, sel_to: sel ? sel.to : undefined,
      error: out || undefined,
      project_id: projectId || undefined,
    };
  };
  const sendChat = (text) => { chat.send({ text, mode: chatModeNow, buildRequest: buildChatRequest, refs: chatRefs }); setChatRefs([]); setChatCtx((c) => ({ ...c, selection: true })); };
  // "this needs Assistant mode": switch the mode and ask the same question again in it
  const switchAndRetryChat = () => { setChatMode('assistant'); chat.retry({ mode: 'assistant', buildRequest: buildChatRequest }); };
  // a code block of a chat answer becomes a new file (next to the open file unless the block names a folder)
  const chatNewFile = (code, suggested) => {
    let path = String(suggested || 'file.txt').replace(/^\/+/, '');
    if (!path.includes('/')) { const a = chatActive(); const dir = a && a.includes('/') ? a.slice(0, a.lastIndexOf('/') + 1) : ''; path = `${dir}${path}`; }
    if (exists(path)) path = uniquePath(path, exists);
    const err = createEntry(path, 'file');
    if (err) { flash(err); return; }
    setTextFor(path, code);
    flash(tt(`Created ${path}`, `اتعمل ${path}`));
  };
  const retryChat = () => chat.retry({ mode: chatModeNow, buildRequest: buildChatRequest });
  const chatChips = (() => {
    const active = chatActive();
    const others = tabs.filter((p) => p !== active && docs.current.get(p)?.kind === 'text').length;
    const chips = [];
    if (active) chips.push({ key: 'file', label: baseName(active), on: chatCtx.file });
    if (others > 0) chips.push({ key: 'others', label: tt(`${others} other tab${others > 1 ? 's' : ''}`, `${others} تاب تانية`), on: chatCtx.others });
    if (ai.available && runOpen && runOutput().trim()) chips.push({ key: 'output', label: tt('Terminal output', 'ناتج الـ terminal'), on: chatCtx.output });
    return chips;
  })();
  // one-tap questions about the attached / selected code (the ones that change files only make sense in Assistant mode)
  const chatQuick = (chatRefs.length || chatLiveSel()) ? [
    tt('Explain this code', 'اشرح الكود ده'), tt('Find bugs in it', 'دوّر على أخطاء فيه'), tt('How can I improve it?', 'أحسّنه إزاي؟'),
    ...(chatModeNow === 'assistant' ? [tt('Add comments to it', 'ضيف تعليقات عليه'), tt('Write tests for it', 'اكتب اختبارات ليه')] : []),
  ] : [];
  const chatSuggestions = chatActive()
    ? [tt('Explain this file', 'اشرح الملف ده'), tt('Find the bug', 'دوّر على الغلط'), tt('How can I improve it?', 'أحسّنه إزاي؟')]
    : [tt('How do I get started?', 'أبدأ منين؟')];
  // one edit → the new text of its file (null = it no longer matches / cannot be applied)
  const chatApplyOne = (e, texts) => {
    if (e.kind === 'create') {
      if (exists(e.path)) return { ok: false };
      const err = createEntry(e.path, 'file');
      if (err) return { ok: false };
      setTextFor(e.path, e.replace);
      return { ok: true, created: true };
    }
    const cur = texts.has(e.path) ? texts.get(e.path) : textOf(e.path);
    const r = cur == null ? { ok: false } : applyEdit(cur, e);
    if (!r.ok) return { ok: false };
    texts.set(e.path, r.text);
    return { ok: true };
  };
  const applyChatEdits = (msgId, ids) => {
    const m = chat.getMessages().find((x) => x.id === msgId); if (!m) return;
    const texts = new Map();
    (m.edits || []).filter((e) => ids.includes(e.id) && e.state === 'pending').forEach((e) => {
      const r = chatApplyOne(e, texts);
      chat.mark(msgId, e.id, r.ok ? 'applied' : 'stale');
    });
    texts.forEach((text, path) => commitAiText(path, text));
  };
  const openChatFile = (path) => { if (vfsRef.current.has(path)) openFile(path); else flash(tt('That file no longer exists.', 'الملف ده مبقاش موجود.')); };

  const aiOut = ai.available && runOpen ? (runApp?.kind === 'sandbox' ? sandbox.getOutput() : runner.logs.length ? 'x' : '') : '';
  const aiBtn = {
    show: ai.available && !!aiOut,
    hot: runApp?.kind === 'sandbox' ? (sandbox.phase === 'error' || looksLikeError(aiOut)) : (runner.state === 'error' || looksLikeError(runOutput())),
    busy: ai.streaming,
    onExplain: () => explainError(ai.panel?.mode || ai.defaultMode),
  };
  const closeRun = () => { runner.stop(); runner.reset(); sandbox.reset(); setRunOpen(false); };

  // ---- keyboard (VS Code habits) ------------------------------------------------------------------
  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (readOnly) flash(tt('This file is view-only for you.', 'الملف ده للعرض فقط بالنسبة لك.'));
      else if (onSave) doSave();
      else flash(tt('Edits are kept here — press “Download ZIP” to export them.', 'التعديلات محفوظة هنا — اضغط «تنزيل ZIP» لتصديرها.'));
    }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); showSearch(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setExplorer((v) => !v); }
    else if (e.altKey && e.key.toLowerCase() === 'w' && activeRef.current) { e.preventDefault(); closeTab(activeRef.current); }
    else if (!readOnly && (e.key === 'F2' || e.key === 'Delete') && sel && e.target.closest?.('.zb-side') && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
      e.preventDefault();
      setDlg(e.key === 'F2' ? { type: 'rename', path: sel, value: baseName(sel) } : { type: 'delete', path: sel });
    }
  };

  // ---- derived view -------------------------------------------------------------------------------
  const tree = useMemo(() => buildTree([...vfs.keys()]), [vfs]);
  const fileCount = useMemo(() => { let n = 0; vfs.forEach((v) => { if (!v.dir) n += 1; }); return n; }, [vfs]);
  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return null;
    const out = [];
    for (const v of vfs.values()) {
      if (!v.dir && v.path.toLowerCase().includes(needle)) { out.push(v); if (out.length >= MAX_SEARCH_RESULTS) break; }
    }
    return out;
  }, [needle, vfs]);

  const activeDoc = active ? docs.current.get(active) : null;
  const gridOn = !readOnly && !!(active && activeDoc?.kind === 'text' && isGridPath(active) && !rawText.has(active) && (edits.current.get(active) ?? origTexts.current.get(active) ?? '').length < 6000000);
  const jsonText = active && activeDoc?.kind === 'text' && isJsonFile(active) ? (edits.current.get(active) ?? origTexts.current.get(active) ?? '') : null;
  const jsonValid = !readOnly && jsonText !== null && isEditableJson(jsonText);
  const jsonOn = jsonValid && !rawText.has(active);
  const mdOn = !!(active && activeDoc?.kind === 'text' && isMdFile(active));
  const mdText = mdOn ? (edits.current.get(active) ?? origTexts.current.get(active) ?? '') : '';
  const mdView = mdOn ? (mdMode.get(active) || (mdText.trim() ? 'preview' : 'text')) : null;
  const cmShown = activeDoc?.kind === 'text' && !gridOn && !jsonOn && (!mdOn || mdView !== 'preview');
  void mdTick; // re-render trigger only
  const toggleDir = (p) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const keyAct = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

  const renderNode = (n, depth) => {
    const isOpen = open.has(n.path);
    const v = vfs.get(n.path);
    const added = !n.dir && !!v?.isNew;
    const changed = !n.dir && !added && (dirty.has(n.path) || (v && v.path !== v.origPath));
    const click = () => { setSel(n.path); if (n.dir) toggleDir(n.path); else openFile(n.path); };
    const rowCls = `zb-row${active === n.path ? ' is-active' : ''}${sel === n.path ? ' is-sel' : ''}${n.dir && dropDir === n.path ? ' is-drop' : ''}`;
    return (
      <li key={n.path}>
        <div
          className={rowCls}
          style={{ '--d': depth }}
          data-dir={n.dir ? n.path : dirOf(n.path)}
          draggable={!readOnly}
          onDragStart={(e) => { dragSrc.current = n.path; e.dataTransfer.setData('application/x-zb-path', n.path); e.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { dragSrc.current = null; setDropDir(null); }}
          onContextMenu={(e) => openCtx(e, n.path)}
        >
          <div role="button" tabIndex={0} className="zb-row__main" onClick={click} onKeyDown={keyAct(click)} title={n.path}>
            {n.dir ? (
              <>
                <span className={`zb-chev${isOpen ? ' is-open' : ''}`}><Icon name="chevron-right" size={13} /></span>
                <span className="zb-folder"><Icon name="folder" size={15} /></span>
              </>
            ) : <><span className="zb-chev zb-chev--none" /><Badge path={n.path} /></>}
            <span className={`zb-row__name${changed ? ' is-changed' : ''}${added ? ' is-added' : ''}`}>{n.name}</span>
            {(changed || added) && <span className={`zb-dot${added ? ' zb-dot--new' : ''}`} aria-hidden="true" />}
          </div>
          <span className="zb-row__acts">
            {readOnly ? null : n.dir ? (
              <>
                <button type="button" aria-label={tt('New file', 'ملف جديد')} title={tt('New file', 'ملف جديد')} onClick={() => startNew('file', n.path)}><Icon name="file-plus" size={14} /></button>
                <button type="button" aria-label={tt('New folder', 'مجلد جديد')} title={tt('New folder', 'مجلد جديد')} onClick={() => startNew('folder', n.path)}><Icon name="folder-plus" size={14} /></button>
                <button type="button" aria-label={tt('Upload files here', 'رفع ملفات هنا')} title={tt('Upload files here', 'رفع ملفات هنا')} onClick={() => pickUpload('file', n.path)}><Icon name="file-up" size={14} /></button>
              </>
            ) : (
              <>
                <button type="button" aria-label={tt('Rename', 'إعادة تسمية')} title={tt('Rename', 'إعادة تسمية')} onClick={() => setDlg({ type: 'rename', path: n.path, value: n.name })}><Icon name="edit" size={13} /></button>
                <button type="button" aria-label={tt('Delete', 'حذف')} title={tt('Delete', 'حذف')} onClick={() => setDlg({ type: 'delete', path: n.path })}><Icon name="trash" size={13} /></button>
              </>
            )}
            <button type="button" aria-label={tt('More actions', 'المزيد')} title={tt('More actions', 'المزيد')} onClick={(e) => { setSel(n.path); openMenuAt(e.currentTarget, menuFor(n.path)); }}><Icon name="more-horizontal" size={14} /></button>
          </span>
        </div>
        {n.dir && isOpen && n.list.length > 0 && <ul className="zb-tree">{n.list.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  if (phase === 'loading') return <div className="zb zb--center" dir="ltr" style={themeVars(theme)}><span className="st-fv-spinner" /><p>{tt('Opening archive…', 'جاري فتح الأرشيف…')}</p></div>;
  if (phase === 'error') return <div className="zb zb--center" dir="ltr" style={themeVars(theme)}><p className="zb-err">{error || tt('This archive could not be opened.', 'تعذّر فتح هذا الأرشيف.')}</p></div>;

  const crumbs = active ? active.split('/') : [];
  const target = dirOf(sel);
  const dlgTitle = dlg && ({
    new: dlg.kind === 'folder' ? tt('New folder', 'مجلد جديد') : tt('New file', 'ملف جديد'), rename: tt('Rename', 'إعادة تسمية'),
    delete: tt('Delete', 'حذف'), reset: tt('Discard all changes?', 'تجاهل كل التعديلات؟'), conflict: tt('Files already exist', 'ملفات موجودة بالفعل'),
    overwrite: tt('A newer version exists', 'فيه نسخة أحدث'),
  })[dlg.type];
  const th = themeById(theme);
  const draggingFiles = dropDir !== null && !dragSrc.current;

  return (
    <div
      ref={rootRef}
      className="zb"
      dir="ltr"
      data-theme={theme}
      style={{ ...themeVars(theme), '--zb-fs': fontSize }}
      onKeyDown={onKeyDown}
    >
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => onPicked(e, false)} />
      <input
        ref={(el) => { dirInput.current = el; if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); } }}
        type="file"
        multiple
        hidden
        onChange={(e) => onPicked(e, true)}
      />

      {restoredInfo && (
        <div className="uip-draftbar" role="status">
          <span>↺ <strong>{tt('Your unsaved work was restored', 'رجّعنا شغلك اللي ما اتحفظش')}</strong> · {tt(`${restoredInfo.count} change${restoredInfo.count === 1 ? '' : 's'}`, `${restoredInfo.count} تعديل`)} · {agoText(restoredInfo.at, !tt('a', 'b').startsWith('a'))}{restoredInfo.exact ? '' : ` — ${tt('the project changed meanwhile, only your text edits and new files were re-applied', 'المشروع اتغيّر في الأثناء، فرجّعنا تعديلات النصوص والملفات الجديدة بس')}`}</span>
          <span className="uip-draftbar__sp" />
          <button type="button" onClick={() => setRestoredInfo(null)}>{tt('OK', 'تمام')}</button>
        </div>
      )}

      {/* toolbar */}
      <div className="zb-top">
        <button type="button" className={`zb-ibtn${explorer && sideTab === 'files' ? ' is-on' : ''}`} onClick={() => { setSideTab('files'); setExplorer((v) => (sideTab === 'files' ? !v : true)); }} title={tt('Explorer (Ctrl+B)', 'المستكشف (Ctrl+B)')} aria-label={tt('Toggle explorer', 'إظهار/إخفاء المستكشف')}><Icon name="folder" size={17} /></button>
        <button type="button" className={`zb-ibtn${explorer && sideTab === 'search' ? ' is-on' : ''}`} onClick={showSearch} title={tt('Search in files (Ctrl+Shift+F)', 'بحث داخل الملفات (Ctrl+Shift+F)')} aria-label={tt('Search in files', 'بحث داخل الملفات')}><Icon name="search" size={17} /></button>
        <div className="zb-top__title"><strong>{fileName}</strong><small>{tt(`${fileCount} files`, `${fileCount} ملف`)}</small></div>
        <div className="zb-top__acts">
          {canRun && runApps.length > 0 && (
            <button type="button" className="zb-btn zb-btn--run" onClick={() => startRun()} disabled={runner.busy || sandbox.busy} title={runApp?.kind === 'sandbox' ? tt('Run the project on the sandbox server', 'شغّل المشروع على سيرفر الـ sandbox') : RUNNER_URL ? tt('Run the project in the browser', 'شغّل المشروع في المتصفح') : tt('The runner is not configured yet', 'الـ Runner لسه مش متظبط')}>
              <Icon name="play" size={15} /> <span>{tt('Run', 'تشغيل')}</span>
            </button>
          )}
          {!readOnly && <button type="button" className="zb-btn zb-btn--add" onClick={(e) => openMenuAt(e.currentTarget, addItems(target), target ? `/${target.replace(/\/$/, '')}` : tt('Archive root', 'جذر الأرشيف'))} title={tt('Add files or folders', 'إضافة ملفات أو مجلدات')} aria-haspopup="menu">
            <Icon name="plus" size={15} /> <span>{tt('Add', 'إضافة')}</span> <Icon name="chevron-down" size={12} />
          </button>}
          {ai.chatAvailable && (
            <button type="button" className={`zb-ibtn${chatOpen ? ' is-on' : ''}`} onClick={() => (chatOpen ? closeChat() : openChat())} title={tt('AI chat', 'شات الذكاء الاصطناعي')} aria-label={tt('AI chat', 'شات الذكاء الاصطناعي')} aria-pressed={chatOpen}><Icon name="chat" size={17} /></button>
          )}
          {ai.projectMode === 'off' && (
            <span className="zb-ibtn zb-ibtn--ai" style={{ opacity: .55, cursor: 'default' }} title={tt('Your supervisor turned the AI assistant off for this project', 'الدكتور المشرف قفل مساعد الذكاء الاصطناعي على المشروع ده')} role="img" aria-label={tt('AI assistant is off for this project', 'مساعد الذكاء الاصطناعي مقفول على المشروع ده')}><Icon name="lock" size={14} /></span>
          )}
          {ai.available && (
            <button type="button" className={`zb-ibtn zb-ibtn--ai${ai.streaming ? ' is-on' : ''}`} onClick={(e) => openAiMenu(e.currentTarget)} title={tt('AI assistant', 'مساعد الذكاء الاصطناعي')} aria-label={tt('AI assistant', 'مساعد الذكاء الاصطناعي')} aria-haspopup="menu">✨</button>
          )}
          <button type="button" className={`zb-ibtn zb-hide-sm${wrap ? ' is-on' : ''}`} onClick={() => setWrap((v) => !v)} title={tt('Word wrap', 'التفاف الأسطر')} aria-label={tt('Word wrap', 'التفاف الأسطر')}>↵</button>
          <button type="button" className="zb-ibtn zb-hide-sm" onClick={() => setFontSize((x) => Math.max(10, x - 1))} aria-label={tt('Smaller text', 'تصغير الخط')}>A−</button>
          <button type="button" className="zb-ibtn zb-hide-sm" onClick={() => setFontSize((x) => Math.min(22, x + 1))} aria-label={tt('Larger text', 'تكبير الخط')}>A+</button>
          <button type="button" className="zb-ibtn" onClick={(e) => openMenuAt(e.currentTarget, themeItems(), tt('Color theme', 'مظهر الألوان'))} title={`${tt('Color theme', 'مظهر الألوان')}: ${th.name}`} aria-label={tt('Color theme', 'مظهر الألوان')} aria-haspopup="menu"><Icon name="palette" size={17} /></button>
          {!readOnly && changes > 0 && <DraftChip draft={draft} tt={tt} />}
          {!readOnly && changes > 0 && <button type="button" className="zb-btn" onClick={() => setDlg({ type: 'reset' })}>{tt('Discard', 'تجاهل')}</button>}
          {!readOnly && onSave && (
            <button
              type="button"
              className="zb-btn zb-btn--primary"
              onClick={() => doSave()}
              disabled={saving || busy || changes === 0}
              title={changes === 0 ? tt('Nothing to save yet', 'مفيش تعديلات للحفظ') : tt('Save to the project for everyone (Ctrl+S)', 'احفظ في المشروع لكل الفريق (Ctrl+S)')}
            >
              <Icon name="save" size={15} /> <span>{saving ? tt('Saving…', 'جاري الحفظ…') : tt('Save', 'حفظ')}</span>{changes > 0 && <b className="zb-pill">{changes}</b>}
            </button>
          )}
          {canDownload && <button type="button" className={`zb-btn${onSave ? '' : ' zb-btn--primary'}`} onClick={downloadZip} disabled={busy || saving}>
            <Icon name="download" size={15} /> <span>{busy ? tt('Building…', 'جاري البناء…') : tt('Download ZIP', 'تنزيل ZIP')}</span>{!onSave && changes > 0 && <b className="zb-pill">{changes}</b>}
          </button>}
        </div>
      </div>

      <div className="zb-main" data-drive-drop="workbench" ref={mainRef} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        {explorer && <button type="button" className="zb-scrim" onClick={() => setExplorer(false)} aria-label={tt('Close explorer', 'إغلاق المستكشف')} />}
        <aside className={`zb-side${explorer ? ' is-open' : ''}${sideTab === 'search' ? ' is-wide' : ''}`}>
          <div className="zb-side__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={sideTab === 'files'} className={sideTab === 'files' ? 'is-on' : ''} onClick={() => setSideTab('files')}>{tt('EXPLORER', 'المستكشف')}</button>
            <button type="button" role="tab" aria-selected={sideTab === 'search'} className={sideTab === 'search' ? 'is-on' : ''} onClick={showSearch}>{tt('SEARCH', 'بحث')}</button>
          </div>
          <SearchPanel tt={tt} off={sideTab !== 'search'} getFiles={getSearchFiles} readBatch={readBatch} onOpen={openMatch} focusKey={searchFocus} />
          <div className={`zb-pane${sideTab === 'files' ? '' : ' is-off'}`}>
            {!readOnly && <div className="zb-xbar">
              <button type="button" onClick={() => startNew('file', target)} title={tt('New file', 'ملف جديد')} aria-label={tt('New file', 'ملف جديد')}><Icon name="file-plus" size={16} /></button>
              <button type="button" onClick={() => startNew('folder', target)} title={tt('New folder', 'مجلد جديد')} aria-label={tt('New folder', 'مجلد جديد')}><Icon name="folder-plus" size={16} /></button>
              <span className="zb-xbar__sep" />
              <button type="button" onClick={() => pickUpload('file', target)} title={tt('Upload files', 'رفع ملفات')} aria-label={tt('Upload files', 'رفع ملفات')}><Icon name="file-up" size={16} /></button>
              <button type="button" onClick={() => pickUpload('dir', target)} title={tt('Upload folder', 'رفع مجلد')} aria-label={tt('Upload folder', 'رفع مجلد')}><Icon name="folder-up" size={16} /></button>
              <span className="zb-xbar__sp" />
              <button type="button" onClick={() => setOpen(new Set())} title={tt('Collapse all', 'طيّ الكل')} aria-label={tt('Collapse all', 'طيّ الكل')}><Icon name="collapse-all" size={16} /></button>
            </div>}
            {!readOnly && <div className="zb-target" title={tt('New files and uploads go here — select a folder to change it.', 'الملفات الجديدة والمرفوعة تُضاف هنا — اختر مجلدًا لتغييره.')}>
              <Icon name="folder-plus" size={12} /> <span>{tt('Adding to', 'الإضافة إلى')}</span> <b>{target ? `/${target.replace(/\/$/, '')}` : tt('archive root', 'جذر الأرشيف')}</b>
            </div>}
            <div className="zb-search">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tt('Filter files by name…', 'ابحث عن ملف بالاسم…')} aria-label={tt('Search files', 'بحث عن ملف')} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={tt('Clear', 'مسح')}><Icon name="x" size={13} /></button>}
            </div>
            <div className="zb-side__scroll" onContextMenu={(e) => openCtx(e, '')} onClick={(e) => { if (e.target === e.currentTarget) setSel(''); }}>
              {results ? (
                results.length === 0 ? <p className="zb-hint">{tt('No matching files.', 'لا توجد ملفات مطابقة.')}</p> : (
                  <ul className="zb-tree">
                    {results.map((r) => (
                      <li key={r.path}>
                        <div className={`zb-row${active === r.path ? ' is-active' : ''}`} style={{ '--d': 0 }} onContextMenu={(e) => openCtx(e, r.path)}>
                          <div role="button" tabIndex={0} className="zb-row__main" onClick={() => { setSel(r.path); openFile(r.path); }} onKeyDown={keyAct(() => openFile(r.path))} title={r.path}>
                            <span className="zb-chev zb-chev--none" /><Badge path={r.path} />
                            <span className="zb-row__name zb-row__name--col"><b>{baseName(r.path)}</b><small>{dirName(r.path)}</small></span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  <div className={`zb-row zb-row--root${sel === '' ? ' is-sel' : ''}${dropDir === '' ? ' is-drop' : ''}`} data-dir="" onClick={() => setSel('')} onContextMenu={(e) => openCtx(e, '')}>
                    <div className="zb-row__main" title={fileName}><span className="zb-folder zb-folder--root"><Icon name="archive" size={15} /></span><span className="zb-row__name">{fileName}</span></div>
                  </div>
                  {tree.list.length === 0
                    ? (
                      <div className="zb-empty">
                        <Icon name="upload" size={26} />
                        <p>{tt('This archive is empty.', 'الأرشيف فارغ.')}</p>
                        <button type="button" className="zb-btn zb-btn--primary" onClick={() => pickUpload('file', '')}>{tt('Upload files', 'رفع ملفات')}</button>
                      </div>
                    )
                    : <ul className="zb-tree">{tree.list.map((n) => renderNode(n, 0))}</ul>}
                </>
              )}
            </div>
          </div>
        </aside>

        <section className="zb-editor">
          {tabs.length > 0 && (
            <>
              <div className="zb-tabs" role="tablist">
                {tabs.map((p) => (
                  <div key={p} role="tab" aria-selected={p === active} className={`zb-tab${p === active ? ' is-on' : ''}`}>
                    <button type="button" className="zb-tab__main" onClick={() => { setSel(p); openFile(p); }} title={p}><Badge path={p} /><span>{baseName(p)}</span></button>
                    <button type="button" className="zb-tab__x" onClick={() => closeTab(p)} aria-label={tt('Close tab', 'إغلاق التبويب')}>
                      {dirty.has(p) ? <span className="zb-dot zb-dot--tab" /> : null}<Icon name="x" size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="zb-crumbs">{crumbs.map((c, i) => <span key={i}>{i > 0 && <i>›</i>}{c}</span>)}
                {jsonValid && (
                  <button type="button" className="zb-crumbs__dl zb-crumbs__view" onClick={() => switchView(active, jsonOn)} title={jsonOn ? tt('Show as plain text', 'عرض كنص') : tt('Show as visual JSON editor', 'عرض كمحرر JSON مرئي')}>{jsonOn ? tt('Text', 'نص') : tt('Visual', 'مرئي')}</button>
                )}
                {activeDoc?.kind === 'text' && isGridPath(active) && (
                  <button type="button" className="zb-crumbs__dl zb-crumbs__view" onClick={() => switchView(active, gridOn)} title={gridOn ? tt('Show as plain text', 'عرض كنص') : tt('Show as spreadsheet', 'عرض كجدول')}>{gridOn ? tt('Text', 'نص') : tt('Table', 'جدول')}</button>
                )}
                {mdOn && (
                  <div className="zb-seg" role="group" aria-label={tt('Markdown view', 'طريقة عرض Markdown')}>
                    {[['preview', tt('Preview', 'معاينة')], ['split', tt('Split', 'مقسوم')], ['text', tt('Text', 'نص')]].map(([id, label]) => (
                      <button key={id} type="button" className={mdView === id ? 'is-on' : ''} onClick={() => setMdView(active, id)}>{label}</button>
                    ))}
                  </div>
                )}
                {canDownload && activeDoc && <button type="button" className="zb-crumbs__dl" onClick={() => downloadFile(active)} title={tt('Download this file', 'تنزيل هذا الملف')}><Icon name="download" size={13} /></button>}
              </div>
            </>
          )}

          <div className="zb-stage">
            {editorDoc && (
              <div className={`zb-cm-wrap${mdOn && mdView === 'split' ? ' zb-cm-wrap--split' : ''}`} style={{ display: cmShown ? 'block' : 'none' }}>
                <Suspense fallback={<div className="zb--center"><span className="st-fv-spinner" /></div>}>
                  <CodeEditor docId={editorDoc.docId} path={editorDoc.path} initialText={editorDoc.text} onChange={onEdit} onCursor={onCursorMove} onContext={onEditorContext} readOnly={readOnly} wrap={wrap} fontSize={fontSize} reveal={reveal} theme={theme} ghost={ghostOpts} />
                </Suspense>
              </div>
            )}
            {gridOn && (
              <div className="zb-cm-wrap" key={`${active}#${gens.current.get(active) || 0}`}>
                <Suspense fallback={<div className="zb--center"><span className="st-fv-spinner" /></div>}>
                  <CsvGrid path={active} text={edits.current.get(active) ?? origTexts.current.get(active) ?? ''} onText={(t) => setTextFor(active, t)} tt={tt} rtl={tt('', 'x') === 'x'} />
                </Suspense>
              </div>
            )}
            {jsonOn && (
              <div className="zb-cm-wrap" key={`${active}#${gens.current.get(active) || 0}`}>
                <Suspense fallback={<div className="zb--center"><span className="st-fv-spinner" /></div>}>
                  <JsonEdit path={active} text={jsonText} onText={(t) => setTextFor(active, t)} tt={tt} theme={theme} onTheme={pickTheme} onCode={() => switchView(active, true)} />
                </Suspense>
              </div>
            )}
            {mdOn && mdView !== 'text' && (
              <div className={`zb-md${mdView === 'split' ? ' zb-md--split' : ''}`}>
                <Suspense fallback={<div className="zb--center"><span className="st-fv-spinner" /></div>}>
                  <MarkdownView key={active} text={mdText} path={active} tt={tt} themeEd={themeById(theme).ed} resolveAsset={mdResolve} openPath={mdOpen} onToggleTask={mdToggle} rtl={tt('', 'x') === 'x'} />
                </Suspense>
              </div>
            )}
            {activeDoc?.kind === 'image' && <div className="zb-img"><img src={activeDoc.url} alt={baseName(active)} draggable={false} /></div>}
            {(activeDoc?.kind === 'binary' || activeDoc?.kind === 'large') && (
              <div className="zb--center zb-card">
                <Badge path={active} />
                <strong>{baseName(active)}</strong>
                <p>{activeDoc.kind === 'large'
                  ? tt(`This file is ${fmtBytes(activeDoc.size)} — too large to open in the editor.`, `حجم الملف ${fmtBytes(activeDoc.size)} — كبير جدًا للفتح في المحرر.`)
                  : tt(`Binary file (${fmtBytes(activeDoc.size)}) — it can’t be shown as text.`, `ملف ثنائي (${fmtBytes(activeDoc.size)}) — لا يمكن عرضه كنص.`)}</p>
                <button type="button" className="zb-btn zb-btn--primary" onClick={() => downloadFile(active)}><Icon name="download" size={15} /> {tt('Download file', 'تنزيل الملف')}</button>
              </div>
            )}
            {!activeDoc && (
              <div className="zb--center zb-welcome">
                <span className="zb-welcome__ico"><Icon name="archive" size={34} /></span>
                <strong>{fileName}</strong>
                <p>{tt('Pick a file from the explorer to read or edit it. Add files or whole folders with the Add button or by dragging them in. ' + (onSave ? 'Press “Save” to store your changes in the project for the whole team, or “Download ZIP” to keep a copy.' : 'Changes stay in your browser — use “Download ZIP” to export the updated archive.'), 'اختر ملفًا من المستكشف لقراءته أو تعديله. أضف ملفات أو مجلدات كاملة بزر «إضافة» أو بسحبها هنا. ' + (onSave ? 'اضغط «حفظ» لتخزين تعديلاتك في المشروع لكل الفريق، أو «تنزيل ZIP» لنسخة عندك.' : 'التعديلات تبقى في متصفحك — استخدم «تنزيل ZIP» لتصدير الأرشيف المحدّث.'))}</p>
                <div className="zb-welcome__acts">
                  <button type="button" className="zb-btn" onClick={() => startNew('file', target)}><Icon name="file-plus" size={15} /> <span>{tt('New file', 'ملف جديد')}</span></button>
                  <button type="button" className="zb-btn" onClick={() => pickUpload('file', target)}><Icon name="file-up" size={15} /> <span>{tt('Upload files', 'رفع ملفات')}</span></button>
                  <button type="button" className="zb-btn" onClick={() => pickUpload('dir', target)}><Icon name="folder-up" size={15} /> <span>{tt('Upload folder', 'رفع مجلد')}</span></button>
                </div>
                <ul className="zb-keys"><li><kbd>Ctrl</kbd>+<kbd>B</kbd> {tt('explorer', 'المستكشف')}</li><li><kbd>Ctrl</kbd>+<kbd>F</kbd> {tt('find in file', 'بحث في الملف')}</li><li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> {tt('search all files', 'بحث في كل الملفات')}</li><li><kbd>F2</kbd> {tt('rename', 'إعادة تسمية')}</li><li><kbd>Alt</kbd>+<kbd>W</kbd> {tt('close tab', 'إغلاق التبويب')}</li></ul>
              </div>
            )}
          </div>
        </section>

        {ai.panel && (
          <AiFixPanel
            tt={tt}
            panel={ai.panel}
            modes={ai.modes}
            canSwitchMode={ai.modes.length > 1 && !['explain', 'comment'].includes(ai.panel.action)}
            fileLabel={baseName(ai.panel.path)}
            onMode={rerunAi}
            onRetry={() => rerunAi(ai.panel.mode)}
            onNewFile={newFileFromAi}
            onClose={ai.close}
            onApply={applyAi}
            onApplyAll={applyAllAi}
            onReject={(id) => ai.mark(id, 'rejected')}
            onGoto={gotoAi}
          />
        )}

        {chatOpen && ai.chatAvailable && (
          <AiChatPanel
            tt={tt}
            chat={chat}
            modes={ai.modes}
            mode={chatModeNow}
            canSwitchMode={ai.modes.length > 1}
            onMode={setChatMode}
            chips={chatChips}
            onChip={(k) => setChatCtx((c) => ({ ...c, [k]: !c[k] }))}
            suggestions={chatSuggestions}
            onSend={sendChat}
            liveSel={chatLiveSel()}
            refs={chatRefs}
            onPin={pinChatRef}
            onUnpin={(id) => setChatRefs((cur) => cur.filter((r) => r.id !== id))}
            onGoto={gotoChatRef}
            quick={chatQuick}
            onRetry={retryChat}
            onSwitchAndRetry={switchAndRetryChat}
            onNewFile={chatNewFile}
            onClose={closeChat}
            onApply={(msgId, id) => applyChatEdits(msgId, [id])}
            onApplyAll={(msgId) => applyChatEdits(msgId, (chat.getMessages().find((x) => x.id === msgId)?.edits || []).map((e) => e.id))}
            onReject={(msgId, id) => chat.mark(msgId, id, 'rejected')}
            onOpen={openChatFile}
            activeLabel={chatActive() ? baseName(chatActive()) : ''}
          />
        )}

        {draggingFiles && (
          <div className="zb-dropzone" aria-hidden="true">
            <div><Icon name="upload" size={28} /><strong>{tt('Drop to add to', 'أفلت للإضافة إلى')} {dropDir ? `/${dropDir.replace(/\/$/, '')}` : tt('archive root', 'جذر الأرشيف')}</strong><small>{tt('Files and whole folders are supported', 'يدعم الملفات والمجلدات الكاملة')}</small></div>
          </div>
        )}
      </div>

      {runOpen && runApp?.kind === 'sandbox' && (
        <SandboxPanel
          tt={tt}
          sandbox={sandbox}
          apps={runApps.filter((a) => a.kind !== 'unsupported')}
          allApps={runApps}
          app={runApp}
          onSelect={(id) => { setRunChoice(id); runner.stop(); sandbox.reset(); }}
          onRun={startRun}
          onClose={closeRun}
          expanded={runBig}
          onToggleExpand={() => setRunBig((v) => !v)}
          ai={aiBtn}
          fontSize={fontSize}
        />
      )}
      {runOpen && runApp?.kind !== 'sandbox' && (
        <RunPanel
          tt={tt}
          runner={runner}
          apps={runApps}
          app={runApp}
          onSelect={(id) => { setRunChoice(id); runner.stop(); sandbox.reset(); }}
          onRun={startRun}
          onClose={closeRun}
          expanded={runBig}
          onToggleExpand={() => setRunBig((v) => !v)}
          ai={aiBtn}
        />
      )}

      {/* status bar */}
      <footer className="zb-status">
        <span>{importing ? tt('Adding files…', 'جاري إضافة الملفات…') : changes > 0 ? tt(`${changes} change${changes === 1 ? '' : 's'}`, `${changes} تعديل`) : tt('No changes', 'لا تعديلات')}</span>
        <span className="zb-status__sp" />
        {activeDoc?.kind === 'text' && <><span>{tt('Ln', 'سطر')} {cursor.line}, {tt('Col', 'عمود')} {cursor.col}</span><span className="zb-hide-sm">UTF-8</span><span>{languageName(active)}</span></>}
        {activeDoc && activeDoc.kind !== 'text' && <span>{fmtBytes(activeDoc.size)}</span>}
        <button type="button" className="zb-status__theme zb-hide-sm" onClick={(e) => openMenuAt(e.currentTarget, themeItems(), tt('Color theme', 'مظهر الألوان'))} title={tt('Color theme', 'مظهر الألوان')}><Icon name="palette" size={12} /> {th.name}</button>
      </footer>

      {toast && <div className="zb-toast" role="status">{toast}</div>}

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} title={menu.title} hostRef={rootRef} onClose={() => setMenu(null)} />}

      {dlg && (
        <div className="zb-dlg" onMouseDown={(e) => { if (e.target === e.currentTarget) setDlg(null); }}>
          <form className="zb-dlg__box" onSubmit={(e) => {
            e.preventDefault();
            if (dlg.type === 'conflict') return;
            let err = null;
            if (dlg.type === 'new') err = createEntry(dlg.value, dlg.kind);
            else if (dlg.type === 'rename') err = renameEntry(dlg.path, dlg.value);
            else if (dlg.type === 'delete') deleteEntry(dlg.path);
            else if (dlg.type === 'reset') resetAll();
            else if (dlg.type === 'overwrite') { setDlg(null); doSave(true); return; }
            if (err) setDlg({ ...dlg, error: err }); else setDlg(null);
          }}>
            <h3>{dlgTitle}</h3>
            {(dlg.type === 'new' || dlg.type === 'rename') && (
              <input
                autoFocus
                value={dlg.value}
                onChange={(e) => setDlg({ ...dlg, value: e.target.value, error: null })}
                onFocus={(e) => { if (dlg.type === 'new') { const l = e.target.value.length; e.target.setSelectionRange(l, l); } }}
                placeholder={dlg.type === 'new' ? (dlg.kind === 'folder' ? 'src/new-folder' : 'src/example.js') : ''}
                spellCheck={false}
              />
            )}
            {dlg.type === 'new' && <p className="zb-dlg__tip">{tt('Tip: type a path like folder/sub/file.js to create nested folders at once.', 'نصيحة: اكتب مسارًا مثل folder/sub/file.js لإنشاء المجلدات المتداخلة دفعة واحدة.')}</p>}
            {dlg.type === 'delete' && <p>{tt(`Delete “${baseName(dlg.path)}”${dlg.path.endsWith('/') ? ' and everything inside it' : ''}? You can undo this with “Discard”.`, `حذف «${baseName(dlg.path)}»${dlg.path.endsWith('/') ? ' وكل ما بداخله' : ''}؟ تقدر تتراجع عن ده من «تجاهل».`)}</p>}
            {dlg.type === 'overwrite' && <p>{tt('Someone else on the project saved a newer version of this ZIP while you were editing. If you save anyway, your version becomes the current one — theirs stays in the file’s version history.', 'حد تاني في المشروع حفظ نسخة أحدث من الـ ZIP ده وانت بتعدّل. لو حفظت دلوقتي نسختك هتبقى هي الحالية — ونسخته هتفضل في سجل إصدارات الملف.')}</p>}
            {dlg.type === 'reset' && <p>{tt('This restores the archive exactly as it was uploaded.', 'ده هيرجّع الأرشيف زي ما اترفع بالظبط.')}</p>}
            {dlg.type === 'conflict' && (
              <>
                <p>{tt(`${dlg.pack.conflicts.length} file${dlg.pack.conflicts.length === 1 ? '' : 's'} with the same name already ${dlg.pack.conflicts.length === 1 ? 'exists' : 'exist'} here. What should happen?`, `يوجد ${dlg.pack.conflicts.length} ملف بنفس الاسم بالفعل. ماذا تريد أن يحدث؟`)}</p>
                <ul className="zb-dlg__list">{dlg.pack.conflicts.slice(0, 5).map((c) => <li key={c}>{c}</li>)}{dlg.pack.conflicts.length > 5 && <li>…</li>}</ul>
              </>
            )}
            {dlg.error && <p className="zb-err">{dlg.error}</p>}
            {dlg.type === 'conflict' ? (
              <div className="zb-dlg__row zb-dlg__row--wrap">
                <button type="button" className="zb-btn" onClick={() => setDlg(null)}>{tt('Cancel', 'إلغاء')}</button>
                <button type="button" className="zb-btn" onClick={() => { const m = commitImport(dlg.pack.read, dlg.pack.dirs, 'skip'); setDlg(null); if (m) flash(m); }}>{tt('Skip existing', 'تخطي الموجود')}</button>
                <button type="button" className="zb-btn" onClick={() => { const m = commitImport(dlg.pack.read, dlg.pack.dirs, 'both'); setDlg(null); if (m) flash(m); }}>{tt('Keep both', 'الاحتفاظ بالاثنين')}</button>
                <button type="button" className="zb-btn zb-btn--primary" autoFocus onClick={() => { const m = commitImport(dlg.pack.read, dlg.pack.dirs, 'replace'); setDlg(null); if (m) flash(m); }}>{tt('Replace', 'استبدال')}</button>
              </div>
            ) : (
              <div className="zb-dlg__row">
                <button type="button" className="zb-btn" onClick={() => setDlg(null)}>{tt('Cancel', 'إلغاء')}</button>
                <button type="submit" className={`zb-btn zb-btn--primary${dlg.type === 'delete' || dlg.type === 'reset' ? ' zb-btn--danger' : ''}`}>{dlg.type === 'delete' ? tt('Delete', 'حذف') : dlg.type === 'reset' ? tt('Discard', 'تجاهل') : dlg.type === 'new' ? tt('Create', 'إنشاء') : dlg.type === 'overwrite' ? tt('Save anyway', 'احفظ على أي حال') : tt('OK', 'تأكيد')}</button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
