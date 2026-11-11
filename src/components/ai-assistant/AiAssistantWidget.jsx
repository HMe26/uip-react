import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useBackLayer } from '../../lib/backStack';
import { api, getTokens, errorMessage } from '../../api/client';
import { attachmentUrl } from '../messaging/format';
import Icon from '../Icon';
import { saveBlob, exportTable } from '../../lib/exporter';
import ExportMenu from '../ExportMenu';
import { RecorderBar, useVoiceRecorder } from './aiRecorder';
import { useCustomWallpapers, isCustomWall, customWallId } from '../../lib/customWallpapers';
import { AiAttachment, NoiseError, PendingFileChip, PendingMediaCard, TranscriptCard, denoiseAudioFile, hasSpeech, mediaKindOf, isTranscribable, splitTranscripts, transcribeFile, transcriptBlock, useAbortRegistry } from './aiMedia';

// the same editor the people-to-people chat uses (trim, subtitles, noise removal, mute…) — loaded only when someone opens it
const MediaEditorModal = lazy(() => import('../messaging/MediaEditorModal'));
import { AI_STRINGS, isTempId, renderMarkdown, fmtTime, roleContent, greeting, groupConversations, relTime } from './aiAssistantUtils';

const API = '/api/v1/ai-assistant';
const AI_WALLS = ['none', 'aurora', 'lagoon', 'forest', 'rose', 'amber', 'graphite', 'midnight'];
// themes saved by the previous version keep working
const AI_WALL_LEGACY = { dots: 'none', sunset: 'amber', night: 'midnight', mint: 'forest', ocean: 'lagoon' };
const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

// Hosts that buffer/kill long-lived responses can drop an SSE connection
// with zero bytes ever reaching the browser. Without a watchdog the
// assistant bubble would be left showing the typing indicator forever —
// same two timers as the vanilla widget (STALL_TIMEOUT_MS / MAX_TURN_MS).
const STALL_TIMEOUT_MS = 45000;
const MAX_TURN_MS = 120000;

/** Portal alias map — mirrors layouts/footer.php's $__aiPortalMap so the
 *  badge/context this widget sends never disagrees with what the server
 *  would derive from the same role. */
const PORTAL_MAP = {
  security_admin: 'security', security_officer: 'security',
  data_analyst: 'data_analysis',
};

/** Maps a failure to one of the design's three states. */
function errorKindOf(status, timeout) {
  if (status === 403) return 'permission';
  if (timeout || status >= 500) return 'service';
  return 'error';
}

function currentLocale() {
  const attr = document.documentElement.getAttribute('lang');
  return attr === 'ar' ? 'ar' : 'en';
}

export default function AiAssistantWidget({ role, user }) {
  const locale = currentLocale();
  const T = AI_STRINGS[locale] || AI_STRINGS.en;
  const t = useCallback((key) => T[key] || key, [T]);
  const portal = PORTAL_MAP[role] || role || 'student';
  const firstName = String(user?.full_name || user?.name || '').trim().split(/\s+/)[0] || '';

  const [fabVisible, setFabVisible] = useState(false);
  const [pulse, setPulse] = useState(true);
  const [available, setAvailable] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [size, setSize] = useState('compact'); // 'compact' | 'wide' | 'full' (full = whole platform)
  const isExpanded = size !== 'compact';
  const isMaximized = size === 'full';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  // Wide / full-screen: the chat list can be hidden (remembered per browser).
  const [historyHidden, setHistoryHidden] = useState(() => {
    const pref = readPref('uip_ai_history_hidden');
    if (pref === '1' || pref === '0') return pref === '1';
    return typeof window !== 'undefined' && window.innerWidth <= 860; // small screens: the list is a drawer, closed at first
  });
  const isNarrow = () => typeof window !== 'undefined' && window.innerWidth <= 860;
  const toggleHistory = () => setHistoryHidden((h) => { writePref('uip_ai_history_hidden', h ? '0' : '1'); return !h; });
  // Chat background theme (same idea as the people-to-people messenger).
  const [wall, setWall] = useState(() => { const raw = readPref('uip_ai_wallpaper'); const v = AI_WALL_LEGACY[raw] || raw; if (isCustomWall(v)) return v; return AI_WALLS.includes(v) ? v : 'none'; });
  const [wallOpen, setWallOpen] = useState(false);
  const wallWrapRef = useRef(null);
  const pickWall = (id) => { setWall(id); writePref('uip_ai_wallpaper', id); setWallOpen(false); };
  // The person's own photos: stay in the library until deleted, whichever theme is selected.
  const wallpapers = useCustomWallpapers();
  const customWallUrl = wallpapers.urlFor(wall);
  const shownWall = isCustomWall(wall) ? (customWallUrl ? 'custom' : 'none') : wall; // photo missing on this device -> clean look (saved choice is kept)
  const wallFileRef = useRef(null);
  const [wallBusy, setWallBusy] = useState(false);
  const [wallError, setWallError] = useState(null);
  const uploadWall = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setWallBusy(true); setWallError(null);
    try {
      const id = await wallpapers.add(file);
      pickWall(`img:${id}`);
    } catch (err) {
      const code = err && err.message;
      setWallError(t(code === 'not_image' ? 'bgNotImage' : code === 'too_big' ? 'bgTooBig' : code === 'limit' ? 'bgLimit' : 'bgStorage'));
    } finally { setWallBusy(false); }
  };
  const deleteWall = async (id) => {
    await wallpapers.remove(id);
    if (customWallId(wall) === id) { setWall('none'); writePref('uip_ai_wallpaper', 'none'); } // deleting the photo in use -> clean background
  };
  // Multi-select + bulk delete of conversations.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [banner, setBanner] = useState(null); // { text, kind }

  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);

  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const textareaRef = useRef(null);
  const messagesElRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortCtrlRef = useRef(null);
  const [editId, setEditId] = useState(null);     // pending video open in the full editor
  const revRef = useRef({});                      // tempId → upload revision (a replaced file must not be overwritten by a stale upload)
  const nrCtl = useRef({});                       // tempId → AbortController of a running noise removal
  const pendingRef = useRef([]);
  const trAbort = useAbortRegistry();   // running speech-to-text jobs, by pending-file id
  const searchTimerRef = useRef(null);
  const activeIdRef = useRef(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // -- Status (bug fix ported verbatim: check immediately on mount so the
  // FAB isn't stuck hidden waiting for a click that can never happen) --
  const checkStatus = useCallback(() => {
    api.get(`${API}/status`).then((res) => {
      const ok = !!(res.data && res.data.available);
      setAvailable(ok);
      if (!ok) setBanner({ text: t('unavailable'), kind: 'service' });
      setFabVisible(true);
    }).catch(() => setFabVisible(true));
  }, [t]);

  useEffect(() => { checkStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // -- Open / close --
  function open() {
    setPulse(false);
    setIsOpen(true);
    if (available === null) checkStatus();
    if (!loadedOnce) { loadConversations(); setLoadedOnce(true); }
    setTimeout(() => textareaRef.current && textareaRef.current.focus(), 250);
  }
  function close() { setIsOpen(false); }

  // Survive a page refresh: remember (per tab) that the assistant was open, its size and the conversation on screen,
  // and put the person back exactly there instead of dropping them on the bare platform page.
  const SESSION_KEY = 'uip_ai_session';
  const savedRef = useRef(null);
  if (savedRef.current === null) {
    let v = false;
    try { v = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'false'); } catch { /* ignore */ }
    savedRef.current = v && typeof v === 'object' ? v : false;
  }
  useEffect(() => {
    const saved = savedRef.current;
    if (!saved || !saved.open || (saved.uid && user?.id && String(saved.uid) !== String(user.id))) return;
    if (['wide', 'full'].includes(saved.size)) setSize(saved.size);
    setPulse(false);
    setIsOpen(true);
    if (!loadedOnce) { loadConversations(); setLoadedOnce(true); }
    if (saved.activeId) openConversation(saved.activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const restoredRef = useRef(false);
  useEffect(() => {
    // skip the very first render so the initial (closed) state doesn't overwrite what was saved
    if (!restoredRef.current) { restoredRef.current = true; return; }
    try {
      if (isOpen) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ open: true, size, activeId: isTempId(activeId) ? null : activeId, uid: user?.id || null }));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* not remembered */ }
  }, [isOpen, size, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Student sidebar's "UIPE AI Assistant" button (components/Sidebar.jsx)
  // fires this event so the floating button isn't the only way in.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onOpen = () => openRef.current();
    window.addEventListener('uip:open-ai-assistant', onOpen);
    return () => window.removeEventListener('uip:open-ai-assistant', onOpen);
  }, []);

  useBackLayer(isOpen, close);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && isOpen) close(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Close any open per-conversation menu on outside click.
  useEffect(() => {
    if (!openMenuId) return undefined;
    function onDocClick() { setOpenMenuId(null); }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openMenuId]);

  // -- Conversations --
  const loadConversations = useCallback((q) => {
    api.get(`${API}/conversations`, q ? { q } : undefined)
      .then((res) => setConversations(res.data || []))
      .catch(() => {});
  }, []);

  function onSearchChange(e) {
    const q = e.target.value;
    setSearch(q);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => loadConversations(q), 250);
  }

  function newChat() {
    stopStreaming();
    setActiveId(null);
    setMessages([]);
    setPendingFiles([]);
    setSidebarCollapsed(true);
    if (isNarrow()) setHistoryHidden(true);
    setDraft('');
    setTimeout(() => textareaRef.current && textareaRef.current.focus(), 0);
  }

  function openConversation(id) {
    stopStreaming();
    setActiveId(id);
    setSidebarCollapsed(true);
    if (isNarrow()) setHistoryHidden(true);
    setMessagesLoading(true);
    setBanner(null);
    api.get(`${API}/conversations/${id}`).then((res) => {
      setMessages((res.data && res.data.messages) || []);
      setMessagesLoading(false);
    }).catch((err) => {
      setMessages([]);
      setMessagesLoading(false);
      setBanner({ text: err?.status === 403 ? t('permissionText') : errorMessage(err), kind: errorKindOf(err?.status) });
    });
  }

  function ensureConversation() {
    if (activeIdRef.current) return Promise.resolve(activeIdRef.current);
    return api.post(`${API}/conversations`, {}).then((res) => {
      activeIdRef.current = res.data.id;
      setActiveId(res.data.id);
      setConversations((prev) => [res.data, ...prev]);
      return res.data.id;
    });
  }

  useEffect(() => {
    if (!wallOpen) return undefined;
    // Close on a press OUTSIDE the picker. (The old document 'click' listener was attached while the very click that opened the
    // picker was still bubbling, so it closed itself instantly — the themes "disappeared".)
    const off = (e) => { if (!wallWrapRef.current || !wallWrapRef.current.contains(e.target)) setWallOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setWallOpen(false); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', onKey); };
  }, [wallOpen]);

  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggleSelected(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function bulkDelete(ids) {
    if (!ids.length || bulkBusy) return;
    // eslint-disable-next-line no-alert
    if (!confirm(t('confirmDeleteMany').replace('{n}', String(ids.length)))) return;
    setBulkBusy(true);
    const failed = [];
    for (let i = 0; i < ids.length; i += 4) {
      const batch = ids.slice(i, i + 4);
      // eslint-disable-next-line no-await-in-loop
      const res = await Promise.allSettled(batch.map((id) => api.del(`${API}/conversations/${id}`)));
      res.forEach((r, j) => { if (r.status === 'rejected') failed.push(batch[j]); });
    }
    const done = ids.filter((id) => !failed.includes(id));
    setConversations((prev) => prev.filter((c) => !done.includes(c.id)));
    if (activeIdRef.current && done.includes(activeIdRef.current)) newChat();
    if (failed.length) {
      setSelected(new Set(failed));
      setBanner({ text: t('bulkDeleteFailed').replace('{n}', String(failed.length)), kind: 'error' });
    } else {
      exitSelect();
    }
    setBulkBusy(false);
    loadConversations(search);
  }

  function convAction(c, action) {
    if (action === 'rename') {
      // eslint-disable-next-line no-alert
      const title = prompt(t('renamePrompt'), c.title);
      if (title && title.trim()) {
        api.patch(`${API}/conversations/${c.id}`, { title: title.trim() }).then(() => loadConversations(search));
      }
    } else if (action === 'pin') {
      api.patch(`${API}/conversations/${c.id}`, { is_pinned: !c.is_pinned }).then(() => loadConversations(search));
    } else if (action === 'archive') {
      api.patch(`${API}/conversations/${c.id}`, { is_archived: !c.is_archived }).then(() => loadConversations(search));
    } else if (action === 'export') {
      // handled by the <ExportMenu> inside the menu
    } else if (action === 'delete') {
      // eslint-disable-next-line no-alert
      if (!confirm(t('confirmDelete'))) return;
      api.del(`${API}/conversations/${c.id}`).then(() => {
        if (activeIdRef.current === c.id) newChat();
        loadConversations(search);
      });
    }
  }

  // Export one conversation in any format the platform supports (PDF / Excel / CSV / JSON / Markdown / text), each with a
  // preview — ExportMenu runs this same routine for "preview" and intercepts the final save.
  async function exportConversation(c, format, fileLang) {
    const id = c.id;
    const ar = (fileLang || locale) === 'ar';
    try {
      if (format === 'md' || format === 'txt') {
        // the server already renders the conversation as Markdown
        const { accessToken } = getTokens();
        const res = await fetch(`${API}/conversations/${id}/export`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        saveBlob(await res.blob(), `conversation-${id}.${format}`);
        return;
      }
      const res = await api.get(`${API}/conversations/${id}`);
      const msgs = ((res.data && res.data.messages) || []).filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim());
      if (!msgs.length) throw new Error('empty');
      const who = (m) => (m.role === 'user' ? (ar ? 'أنت' : 'You') : 'UIPE AI');
      // very long answers are split over several rows so no PDF row is taller than a page
      const CHUNK = 1100;
      const plain = (txt) => String(txt).replace(/```[a-z0-9]*\n?/gi, '').replace(/[*_`#>]+/g, '').replace(/\n{3,}/g, '\n\n').trim();
      const rows = [];
      msgs.forEach((m) => {
        const body = format === 'pdf' || format === 'csv' || format === 'xlsx' ? plain(m.content) : m.content;
        if (format !== 'pdf' || body.length <= CHUNK) { rows.push([who(m), body, m.created_at || '']); return; }
        const parts = [];
        let rest = body;
        while (rest.length > CHUNK) {
          let cut = rest.lastIndexOf('\n', CHUNK);
          if (cut < CHUNK * 0.5) cut = rest.lastIndexOf(' ', CHUNK);
          if (cut < CHUNK * 0.5) cut = CHUNK;
          parts.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        if (rest) parts.push(rest);
        parts.forEach((part, i) => rows.push([i === 0 ? who(m) : '', part, i === 0 ? (m.created_at || '') : '']));
      });
      await exportTable({
        headers: ar ? ['المرسل', 'الرسالة', 'الوقت'] : ['From', 'Message', 'Time'],
        rows,
        format,
        filename: `conversation-${id}`,
        title: c.title || (ar ? 'محادثة' : 'Conversation'),
        rtl: ar,
        maxCell: 100000,
        meta: [{ label: ar ? 'عدد الرسائل' : 'Messages', value: String(msgs.length) }],
      });
    } catch {
      setBanner({ text: t('errorGeneric'), kind: 'error' });
    }
  }

  // -- Files --
  // Audio / video are also transcribed (browser decodes → server speech-to-text) in parallel with the upload, and the text goes
  // out with the message — so models that cannot hear recordings still get what was said.
  function patchPending(tempId, patch) {
    setPendingFiles((prev) => prev.map((f) => (f.tempId === tempId ? { ...f, ...patch } : f)));
  }

  function startTranscription(tempId, file) {
    const ctrl = new AbortController();
    trAbort.set(tempId, ctrl);
    patchPending(tempId, { tr: { state: 'running', pct: 0 } });
    transcribeFile(file, {
      signal: ctrl.signal,
      onProgress: (p) => patchPending(tempId, { tr: { state: 'running', pct: p.pct || 0 } }),
    }).then((r) => {
      // the text lands in an editable box: fix a wrong word BEFORE the assistant reads it
      patchPending(tempId, { tr: { state: 'done', lang: r.lang }, trText: r.text, trOrig: r.text, trEdited: false });
    }).catch((err) => {
      const code = err && err.code;
      if (code === 'cancelled') return;
      const state = (code === 'no_speech' || code === 'no_audio') ? 'none' : code === 'unavailable' ? 'off' : 'error';
      patchPending(tempId, { tr: { state, retryable: ['failed', 'fetch_failed', 'rate_limited'].includes(code) } });
    }).finally(() => trAbort.done(tempId, ctrl));
  }

  function runUpload(tempId, file) {
    const rev = (revRef.current[tempId] = (revRef.current[tempId] || 0) + 1);
    const stale = () => revRef.current[tempId] !== rev;
    ensureConversation().then((convId) => {
      const fd = new FormData();
      fd.append('file', file);
      // XHR upload (real WebView XHR inside the APK, with progress) — api.postForm goes through fetch with X-Locale, which the
      // API's CORS list rejects from the app's https://localhost origin → "Network error"
      return api.postFormProgress(`${API}/conversations/${convId}/attachments`, fd, (pct) => { if (!stale()) patchPending(tempId, { pct }); });
    }).then((res) => {
      if (!stale()) patchPending(tempId, { status: 'done', pct: 100, attachmentId: res.data.id });
    }).catch((err) => {
      if (stale()) return;
      const msg = errorMessage(err);
      trAbort.abort(tempId);
      patchPending(tempId, { status: 'error', errorMessage: msg, tr: null });
      setBanner({ text: `${file.name}: ${msg}`, kind: 'error' });
    });
  }

  function handleFiles(fileList) {
    Array.from(fileList).forEach((file) => {
      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const kind = mediaKindOf(file);
      const transcribable = isTranscribable(file);
      const localUrl = ['image', 'audio', 'video'].includes(kind) ? URL.createObjectURL(file) : null;
      setPendingFiles((prev) => [...prev, {
        tempId, name: file.name, size: file.size, status: 'uploading', kind, mime: file.type || null, localUrl,
        file: transcribable ? file : null,
        tr: transcribable ? { state: 'running', pct: 0 } : null,
        trText: '', trOrig: '', trEdited: false,
        nr: { status: 'idle', level: 'med', progress: 0 }, versions: null, active: 'orig',
      }]);
      if (transcribable) startTranscription(tempId, file);
      runUpload(tempId, file);
    });
  }

  /** Put a different file (cleaned / edited) in place of a pending one: new preview, new upload, optionally a new transcript. */
  function swapFile(tempId, file, { transcribe }) {
    setPendingFiles((prev) => prev.map((f) => {
      if (f.tempId !== tempId) return f;
      if (f.localUrl) URL.revokeObjectURL(f.localUrl);
      return {
        ...f, name: file.name, size: file.size, mime: file.type || null, kind: mediaKindOf(file), localUrl: URL.createObjectURL(file), file,
        status: 'uploading', pct: 0, attachmentId: null, errorMessage: null, tr: transcribe ? { state: 'running', pct: 0 } : f.tr,
      };
    }));
    if (transcribe) startTranscription(tempId, file);
    runUpload(tempId, file);
  }

  async function denoisePending(pf, level) {
    const id = pf.tempId;
    const src = (pf.versions && pf.versions.orig) || pf.file;
    if (!src) return;
    const ctl = new AbortController();
    nrCtl.current[id] = ctl;
    patchPending(id, { nr: { status: 'working', level, progress: 0 } });
    try {
      const clean = await denoiseAudioFile(src, level, {
        signal: ctl.signal,
        onProgress: (p) => patchPending(id, { nr: { status: 'working', level, progress: p } }),
      });
      const cur = pendingRef.current.find((f) => f.tempId === id);
      if (!cur) return;
      patchPending(id, { versions: { orig: src, clean }, active: 'clean', nr: { status: 'ready', level, progress: 1 } });
      swapFile(id, clean, { transcribe: !cur.trEdited });   // cleaner sound = better transcript (unless the user already corrected it)
    } catch (err) {
      const code = err instanceof NoiseError ? err.code : 'failed';
      if (code === 'cancelled') patchPending(id, { nr: { status: 'idle', level, progress: 0 } });
      else patchPending(id, { nr: { status: 'error', level, progress: 0, msg: t(`nrErr_${code}`) === `nrErr_${code}` ? t('nrErr_failed') : t(`nrErr_${code}`) } });
    } finally {
      delete nrCtl.current[id];
    }
  }

  const mediaHandlers = {
    remove: (id) => removePendingFile(id),
    editVideo: (pf) => setEditId(pf.tempId),
    denoise: (pf, level) => denoisePending(pf, level),
    cancelDenoise: (pf) => nrCtl.current[pf.tempId] && nrCtl.current[pf.tempId].abort(),
    setNrLevel: (pf, level) => patchPending(pf.tempId, { nr: { ...(pf.nr || {}), status: pf.nr && pf.nr.status === 'error' ? 'idle' : (pf.nr ? pf.nr.status : 'idle'), level } }),
    useVersion: (pf, which) => {
      const f = pf.versions && pf.versions[which];
      if (!f || pf.active === which) return;
      patchPending(pf.tempId, { active: which });
      swapFile(pf.tempId, f, { transcribe: false });
    },
    editTranscript: (pf, value) => patchPending(pf.tempId, {
      trText: value, trEdited: value !== pf.trOrig,
      tr: pf.tr && pf.tr.state !== 'running' && value.trim() ? { ...pf.tr, state: 'done' } : pf.tr,
    }),
    resetTranscript: (pf) => patchPending(pf.tempId, { trText: pf.trOrig, trEdited: false }),
    retranscribe: (pf) => pf.file && startTranscription(pf.tempId, pf.file),
  };

  function removePendingFile(tempId) {
    const pf = pendingFiles.find((f) => f.tempId === tempId);
    trAbort.abort(tempId);
    if (nrCtl.current[tempId]) nrCtl.current[tempId].abort();
    revRef.current[tempId] = (revRef.current[tempId] || 0) + 1;   // ignore a still-running upload
    if (pf && pf.localUrl) URL.revokeObjectURL(pf.localUrl);
    setPendingFiles((prev) => prev.filter((f) => f.tempId !== tempId));
  }

  function onFileInputChange(e) {
    handleFiles(e.target.files);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  // -- Voice recording (live waveform + timer + pause / discard — see aiRecorder.jsx) --
  const rec = useVoiceRecorder({
    onComplete: (file) => handleFiles([file]),
    onError: (code) => setBanner({ text: t({ denied: 'recDenied', nomic: 'recNoMic', unsupported: 'recUnsupported', short: 'recShort' }[code] || 'errorGeneric'), kind: 'error' }),
  });
  const recording = rec.state !== 'idle';

  // -- Textarea --
  function onTextareaInput(e) {
    setDraft(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  }
  function onTextareaKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function buildContextPayload() {
    const extra = window.UIP_AI_CONTEXT || {};
    return {
      portal,
      page: (document.title || location.pathname || '').slice(0, 200),
      route: `${location.pathname}`.slice(0, 200),
      locale,
      project: extra.project || undefined,
      dashboard: extra.dashboard || undefined,
    };
  }

  function submit(e) {
    if (e) e.preventDefault();
    if (streaming) { stopStreaming(); return; }
    send();
  }

  function send(textOverride) {
    if (available === false) { setBanner({ text: t('unavailable'), kind: 'service' }); return; }
    const typed = (typeof textOverride === 'string' ? textOverride : draft).trim();
    const doneFiles = pendingFiles.filter((f) => f.status === 'done');
    const attachmentIds = doneFiles.map((f) => f.attachmentId);
    if (!typed && !attachmentIds.length) return;
    if (pendingFiles.some((f) => f.status === 'uploading' || (f.tr && f.tr.state === 'running') || (f.nr && f.nr.status === 'working'))) return;
    // transcripts of recordings / videos travel inside the message text (any model can read them; they are shown as cards)
    const transcripts = doneFiles.filter((f) => hasSpeech(f.trText)).map((f) => transcriptBlock(f.name, f.trText));
    const content = [typed, ...transcripts].filter(Boolean).join('\n\n');

    if (typeof textOverride !== 'string') setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setPendingFiles([]);

    const tempId = `tmp_msg_${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      role: 'user',
      content,
      status: 'complete',
      attachments: doneFiles.map((f) => ({
        id: f.attachmentId, kind: f.kind, url: f.localUrl || `${API}/attachments/${f.attachmentId}/download`,
        original_name: f.name, mime_type: f.mime, size_bytes: f.size,
      })),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    ensureConversation().then((convId) => {
      streamTurn(convId, {
        content,
        attachment_ids: attachmentIds,
        ...buildContextPayload(),
      }, `${API}/conversations/${convId}/messages`, tempId);
    });
  }

  function regenerate(messageId) {
    if (streaming) return;
    streamTurn(activeIdRef.current, buildContextPayload(), `${API}/messages/${messageId}/regenerate`, null);
  }

  function stopStreaming() {
    if (abortCtrlRef.current) abortCtrlRef.current.abort();
  }

  function finalizeStreaming() {
    setStreaming(false);
    abortCtrlRef.current = null;
  }

  function handleSseEvent(evt, placeholderId, optimisticUserMsgId) {
    if (evt.type === 'user_message' && evt.message) {
      setMessages((prev) => {
        const tmpIdx = optimisticUserMsgId ? prev.findIndex((m) => m.id === optimisticUserMsgId) : -1;
        if (tmpIdx > -1) {
          const next = prev.slice();
          next[tmpIdx] = evt.message;
          return next;
        }
        const idx = prev.findIndex((m) => m.id === placeholderId);
        const next = prev.slice();
        next.splice(Math.max(idx, 0), 0, evt.message);
        return next;
      });
    } else if (evt.type === 'tool') {
      // The assistant is reading platform data on the server — show what it is doing.
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, toolLabel: evt.label || null } : m)));
    } else if (evt.type === 'reset') {
      // Text streamed before a tool call ("let me check…") is discarded.
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, content: '' } : m)));
    } else if (evt.type === 'token') {
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, content: (m.content || '') + evt.delta } : m)));
    } else if (evt.type === 'done') {
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, id: evt.message_id, content: evt.content, status: 'complete' } : m)));
    } else if (evt.type === 'error') {
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, status: 'error', errorKind: errorKindOf(evt.status, evt.timeout), content: evt.message || t('errorGeneric') } : m)));
    }
  }

  /** Shared SSE consumer for both send() and regenerate() — fetch()+
   *  ReadableStream rather than EventSource because the request needs a
   *  POST body, same reasoning as the vanilla widget. Authenticates via
   *  Bearer instead of the session+CSRF the PHP app used. */
  function streamTurn(convId, payload, url, optimisticUserMsgId) {
    setStreaming(true);
    abortCtrlRef.current = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const placeholderId = `streaming_${Date.now()}`;
    const isNewTurn = !!optimisticUserMsgId;
    const assistantMsg = {
      id: placeholderId, role: 'assistant', content: '', status: 'streaming', attachments: [],
      created_at: new Date().toISOString(),
      retryContent: isNewTurn ? (payload.content || '') : undefined,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    let settled = false;
    let userAborted = false;
    let watchdog;
    const runFetch = (retried) => {
      const { accessToken } = getTokens();
      watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (abortCtrlRef.current) abortCtrlRef.current.abort();
        handleSseEvent({ type: 'error', message: t('timeoutError'), timeout: true }, placeholderId);
        finalizeStreaming();
      }, MAX_TURN_MS);
      const bumpWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (settled) return;
          settled = true;
          if (abortCtrlRef.current) abortCtrlRef.current.abort();
          handleSseEvent({ type: 'error', message: t('timeoutError'), timeout: true }, placeholderId);
          finalizeStreaming();
        }, STALL_TIMEOUT_MS);
      };

      fetch(url, {
        method: 'POST',
        signal: abortCtrlRef.current ? abortCtrlRef.current.signal : undefined,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Requested-With': 'XMLHttpRequest',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      }).then((response) => {
        if (response.status === 401 && !retried) {
          // One transparent refresh-and-retry, same policy as api/client.js's
          // request(): redeem the refresh token via a trivial call through
          // the normal client (which owns the single-flight refresh logic),
          // then replay this stream once.
          clearTimeout(watchdog);
          return api.get(`${API}/status`).then(() => runFetch(true));
        }
        if (!response.ok || !response.body) {
          const status = response.status;
          const fail = (msg) => Object.assign(new Error(status === 403 ? t('permissionText') : msg), { status });
          return response.json ? response.json().then((j) => { throw fail((j && j.message) || t('errorGeneric')); }, () => { throw fail(t('errorGeneric')); })
            : Promise.reject(fail(t('errorGeneric')));
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        function pump() {
          return reader.read().then((res) => {
            if (settled) return undefined;
            if (res.done) return undefined;
            bumpWatchdog();
            buf += decoder.decode(res.value, { stream: true });
            const chunks = buf.split('\n\n');
            buf = chunks.pop();
            chunks.forEach((chunk) => {
              const line = chunk.split('\n').find((l) => l.indexOf('data:') === 0);
              if (!line) return;
              let evt;
              try { evt = JSON.parse(line.slice(5).trim()); } catch { return; }
              if (evt.type === 'done' || evt.type === 'error') { settled = true; clearTimeout(watchdog); }
              handleSseEvent(evt, placeholderId, optimisticUserMsgId);
            });
            return pump();
          });
        }
        return pump();
      }).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (err && err.name === 'AbortError') { userAborted = true; finalizeStreaming(); return; }
        handleSseEvent({ type: 'error', message: (err && err.message) || t('errorGeneric'), status: err && err.status }, placeholderId);
      }).then(() => {
        clearTimeout(watchdog);
        finalizeStreaming();
        // The stream can end (or be stopped) without a `done`/`error` event; don't leave
        // the bubble in "streaming" forever. Keep partial text, drop an empty placeholder.
        setMessages((prev) => prev.flatMap((m) => {
          if (m.id !== placeholderId || m.status !== 'streaming') return [m];
          if (m.content) return [{ ...m, status: 'complete' }];
          if (userAborted) return [];
          return [{ ...m, status: 'error', errorKind: 'service', content: t('errorGeneric') }];
        }));
        loadConversations(search);
      });
    };
    runFetch(false);
  }

  // -- Message actions --
  function copyText(text, id) {
    const done = () => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
      done();
    }
  }

  function messageAction(m, action) {
    const idDependent = { delete: 1, bookmark: 1, react: 1, edit: 1, regenerate: 1 };
    if (idDependent[action] && isTempId(m.id)) return;

    if (action === 'copy') {
      copyText(m.content, m.id);
    } else if (action === 'retry-send') {
      setDraft(m.retryContent || '');
      setTimeout(() => textareaRef.current && textareaRef.current.focus(), 0);
    } else if (action === 'delete') {
      api.del(`${API}/messages/${m.id}`).then(() => setMessages((prev) => prev.filter((x) => x.id !== m.id)));
    } else if (action === 'bookmark') {
      api.post(`${API}/messages/${m.id}/bookmark`, { bookmarked: !m.is_bookmarked }).then((res) => patchMessage(m.id, res.data));
    } else if (action === 'react') {
      api.post(`${API}/messages/${m.id}/react`, { emoji: '👍' }).then((res) => patchMessage(m.id, res.data));
    } else if (action === 'edit') {
      // eslint-disable-next-line no-alert
      const text = prompt(t('edit'), m.content);
      if (text != null && text.trim() && text !== m.content) {
        api.patch(`${API}/messages/${m.id}`, { content: text.trim() }).then((res) => patchMessage(m.id, res.data));
      }
    } else if (action === 'regenerate') {
      regenerate(m.id);
    }
  }

  function patchMessage(id, data) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...data } : m)));
  }

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (messagesElRef.current) messagesElRef.current.scrollTop = messagesElRef.current.scrollHeight;
  }, [messages]);

  if (!fabVisible && available === null) return null;

  const groups = groupConversations(conversations, t);
  pendingRef.current = pendingFiles;
  const editPf = editId ? pendingFiles.find((f) => f.tempId === editId && f.file && f.kind === 'video') : null;
  function finishVideoEdit(f, caption) {
    const pf = editPf;
    setEditId(null);
    if (caption && !draft.trim()) setDraft(caption);
    if (pf && f && f !== pf.file) swapFile(pf.tempId, f, { transcribe: !pf.trEdited });   // trimmed / subtitled / cleaned video → fresh transcript unless the user already fixed it
  }
  const transcribing = pendingFiles.some((f) => f.tr && f.tr.state === 'running');
  const filesBusy = transcribing || pendingFiles.some((f) => f.status === 'uploading' || (f.nr && f.nr.status === 'working'));
  const sendDisabled = streaming ? false : (filesBusy || (!draft.trim() && !pendingFiles.filter((f) => f.status !== 'error').length));
  const content = roleContent(role, locale);
  const showSidebar = isExpanded ? !historyHidden : !sidebarCollapsed;
  const activeConv = conversations.find((c) => c.id === activeId);
  const hasMessages = messages.length > 0;

  const renderGroups = () => (
    <>
      {conversations.length === 0 && <div className="ai-sidebar__empty">{t('empty')}</div>}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="ai-sidebar__group-label">{g.label}</div>
          {g.items.map((c) => (
            <ConvItem key={c.id} c={c} active={c.id === activeId} open={openMenuId === c.id}
              time={relTime(c, t, locale)}
              onOpenMenu={() => setOpenMenuId((id) => (id === c.id ? null : c.id))}
              selectMode={selectMode} selected={selected.has(c.id)}
              onSelect={() => (selectMode ? toggleSelected(c.id) : openConversation(c.id))} onAction={(act) => convAction(c, act)} onExport={exportConversation} t={t} />
          ))}
        </div>
      ))}
    </>
  );

  return (
    <div className="ai-assistant-root">
      <button
        type="button"
        className={`ai-fab${pulse ? ' ai-fab--pulse' : ''}`}
        aria-label={t('title')}
        hidden={!fabVisible}
        onClick={open}
      >
        <Icon name="sparkles" size={26} />
      </button>

      <div className={`ai-panel-scrim${isOpen ? ' is-open' : ''}`} onClick={close} />

      <div
        className={`ai-panel${isOpen ? ' is-open' : ''}${isExpanded ? ' is-fullscreen' : ''}${isMaximized ? ' is-maximized' : ''}`}
        role="dialog"
        aria-label={t('title')}
        data-wall={shownWall}
        style={customWallUrl && shownWall === 'custom' ? { '--ai-wall-img': `url("${customWallUrl}")` } : undefined}
      >
        <div className="ai-panel__header">
          {!isExpanded && (
            <button type="button" className={`ai-panel__icon-btn${!sidebarCollapsed ? ' is-on' : ''}`} aria-label={t('menu')} aria-pressed={!sidebarCollapsed} onClick={() => setSidebarCollapsed((c) => !c)}>
              <Icon name="menu" size={18} />
            </button>
          )}
          <div className="ai-panel__title">
            <span className="ai-avatar"><Icon name="sparkles" size={15} /></span>
            <div className="ai-panel__title-text">
              <strong>{isExpanded ? t('expandedWorkspace') : t('title')}</strong>
              {!isExpanded && <small>{t('subtitle')}</small>}
            </div>
          </div>
          <div className="ai-panel__header-actions">
            {isExpanded && (
              <button type="button" className={`ai-panel__icon-btn ai-history-toggle${!historyHidden ? ' is-on' : ''}`} aria-pressed={!historyHidden}
                aria-label={historyHidden ? t('showHistory') : t('hideHistory')} title={historyHidden ? t('showHistory') : t('hideHistory')} onClick={toggleHistory}>
                <Icon name="panel-left" size={17} />
              </button>
            )}
            <div className="ai-wall-wrap" ref={wallWrapRef}>
              <button type="button" className={`ai-panel__icon-btn${wallOpen ? ' is-on' : ''}`} aria-label={t('background')} title={t('background')} aria-expanded={wallOpen} onClick={() => setWallOpen((o) => !o)}>
                <Icon name="palette" size={17} />
              </button>
              {wallOpen && (
                <div className="ai-wall-pop" role="group" aria-label={t('background')}>
                  <strong>{t('background')}</strong>
                  <div className="ai-wall-picker">
                    {AI_WALLS.map((id) => (
                      <button key={id} type="button" className={`ai-wall-swatch ai-wall-swatch--${id}`} aria-pressed={wall === id} aria-label={t(`wall_${id}`)} title={t(`wall_${id}`)} onClick={() => pickWall(id)} />
                    ))}
                  </div>
                  <div className="ai-wall-mine">
                    <span className="ai-wall-mine__title">{t('myPhotos')}</span>
                    <div className="ai-wall-mine__grid">
                      <input ref={wallFileRef} type="file" accept="image/*" hidden onChange={uploadWall} />
                      <button type="button" className="ai-wall-add" onClick={() => wallFileRef.current?.click()} disabled={wallBusy} aria-label={t('uploadBg')} title={t('uploadBg')}>
                        <Icon name="plus" size={17} />
                      </button>
                      {wallpapers.items.map((w) => (
                        <div key={w.id} className="ai-wall-mine__item">
                          <button type="button" className="ai-wall-mine__pick" aria-pressed={wall === `img:${w.id}`} aria-label={t('useBg')} onClick={() => pickWall(`img:${w.id}`)} style={{ backgroundImage: `url("${w.url}")` }} />
                          <button type="button" className="ai-wall-mine__del" aria-label={t('deleteBg')} title={t('deleteBg')} onClick={() => deleteWall(w.id)}><Icon name="x" size={10} /></button>
                        </div>
                      ))}
                    </div>
                    {wallError && <p className="ai-wall-mine__err">{wallError}</p>}
                  </div>
                </div>
              )}
            </div>
            <button type="button" className="ai-panel__text-btn" aria-label={t('newChat')} onClick={newChat}>
              <Icon name="plus" size={15} /><span>{t('newChatLabel')}</span>
            </button>
            {!isMaximized && (
              <button
                type="button"
                className="ai-panel__icon-btn"
                aria-label={size === 'wide' ? t('collapseSize') : t('expand')}
                title={size === 'wide' ? t('collapseSize') : t('expand')}
                onClick={() => setSize((v) => (v === 'compact' ? 'wide' : 'compact'))}
              >
                <Icon name={size === 'wide' ? 'collapse' : 'expand'} size={17} />
              </button>
            )}
            <button
              type="button"
              className="ai-panel__icon-btn"
              aria-label={isMaximized ? t('exitFullScreen') : t('fullScreen')}
              title={isMaximized ? t('exitFullScreen') : t('fullScreen')}
              onClick={() => setSize((v) => (v === 'full' ? 'wide' : 'full'))}
            >
              <Icon name={isMaximized ? 'collapse' : 'maximize'} size={17} />
            </button>
            <button type="button" className="ai-panel__icon-btn" aria-label={t('close')} onClick={close}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="ai-panel__body">
          <aside className={`ai-sidebar${showSidebar ? '' : ' is-collapsed'}`} aria-hidden={!showSidebar}>
            <div className="ai-sidebar__head">
              <span className="ai-sidebar__eyebrow"><Icon name="history" size={13} /> {isExpanded ? t('recentChats') : t('history')}</span>
              {!isExpanded && <h3>{t('conversationHistory')}</h3>}
            </div>
            <div className="ai-sidebar__search">
              <span><Icon name="search" size={15} /></span>
              <input type="search" placeholder={t('searchPlaceholder')} value={search} onChange={onSearchChange} />
            </div>
            {conversations.length > 0 && (
              <div className="ai-bulkbar">
                {!selectMode ? (
                  <button type="button" className="ai-bulk-btn" onClick={() => setSelectMode(true)}><Icon name="check" size={13} /> {t('select')}</button>
                ) : (
                  <>
                    <span className="ai-bulkbar__count">{t('selectedCount').replace('{n}', String(selected.size))}</span>
                    <button type="button" className="ai-bulk-btn" onClick={() => setSelected(selected.size === conversations.length ? new Set() : new Set(conversations.map((c) => c.id)))}>
                      {selected.size === conversations.length ? t('clearSelection') : t('selectAll')}
                    </button>
                    <button type="button" className="ai-bulk-btn is-danger" disabled={!selected.size || bulkBusy} onClick={() => bulkDelete([...selected])}><Icon name="trash" size={13} /> {t('deleteSelected')}</button>
                    <button type="button" className="ai-bulk-btn is-danger" disabled={bulkBusy} onClick={() => bulkDelete(conversations.map((c) => c.id))}>{t('deleteAll')}</button>
                    <button type="button" className="ai-bulk-btn" onClick={exitSelect}>{t('cancelSelect')}</button>
                  </>
                )}
              </div>
            )}
            <div className="ai-sidebar__list">{renderGroups()}</div>
          </aside>

          <section className="ai-conversation">
            {isExpanded && hasMessages && activeConv && (
              <div className="ai-conversation__head">
                <span className="ai-avatar"><Icon name="sparkles" size={13} /></span>
                <strong>{activeConv.title}</strong>
              </div>
            )}
            <div className="ai-messages" ref={messagesElRef}>
              {banner && <AiBanner banner={banner} t={t} onRetry={banner.kind === 'service' || banner.kind === 'error' ? checkStatus : null} />}
              {messagesLoading && <MessagesSkeleton />}
              {!messagesLoading && !hasMessages && (
                <div className="ai-welcome">
                  <span className="ai-avatar ai-avatar--lg"><Icon name="sparkles" size={26} /></span>
                  <span className="ai-welcome__eyebrow">{content.eyebrow}</span>
                  <h3>{greeting(t, firstName)}</h3>
                  <p>{content.body}</p>
                  <div className="ai-welcome__head">
                    <strong>{t('tryAsking')}</strong>
                    <span>{content.suggestions.length} {t('suggestionsCount')}</span>
                  </div>
                  <div className="ai-welcome__suggestions">
                    {content.suggestions.map((sg) => (
                      <button key={sg} type="button" className="ai-suggestion-chip" onClick={() => send(sg)}>
                        <span>{sg}</span>
                        <Icon name={locale === 'ar' ? 'chevron-left' : 'chevron-right'} size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!messagesLoading && messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  t={t}
                  locale={locale}
                  copied={copiedId === m.id}
                  onStop={stopStreaming}
                  onAction={(action) => messageAction(m, action)}
                  onCopyCode={(code, btnEl) => {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(code).then(() => {
                        if (btnEl) { const orig = btnEl.textContent; btnEl.textContent = t('copied'); setTimeout(() => { btnEl.textContent = orig; }, 1200); }
                      }).catch(() => {});
                    }
                  }}
                />
              ))}
            </div>

            <form
              className="ai-composer"
              onSubmit={submit}
              onDragEnter={(e) => e.preventDefault()}
              onDragOver={(e) => e.preventDefault()}
            >
              {pendingFiles.length > 0 && (
                <div className="ai-composer__files">
                  {pendingFiles.map((pf) => (['audio', 'video'].includes(pf.kind) ? (
                    <PendingMediaCard key={pf.tempId} pf={pf} t={t} h={mediaHandlers} />
                  ) : (
                    <PendingFileChip
                      key={pf.tempId}
                      pf={pf}
                      t={t}
                      onRemove={removePendingFile}
                      onRetryTranscript={(f) => f.file && startTranscription(f.tempId, f.file)}
                    />
                  )))}
                </div>
              )}
              <div className={`ai-composer__box${recording ? ' is-recording' : ''}`} onDrop={onDrop}>
                {recording ? <RecorderBar rec={rec} t={t} /> : (
                  <>
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      placeholder={isExpanded && hasMessages ? t('followUp') : t('placeholder')}
                      value={draft}
                      onChange={onTextareaInput}
                      onKeyDown={onTextareaKeyDown}
                    />
                    <div className="ai-composer__bar">
                      <span className="ai-composer__hint">{transcribing ? t('waitTranscribe') : t('disclaimer')}</span>
                      <div className="ai-composer__tools">
                        <button type="button" className="ai-composer__btn" aria-label={t('attach')} title={t('attach')} onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                          <Icon name="paperclip" size={17} />
                        </button>
                        <input ref={fileInputRef} type="file" multiple hidden onChange={onFileInputChange} />
                        <button type="button" className="ai-composer__btn ai-composer__btn--mic" aria-label={t('voice')} title={t('voice')} onClick={rec.start}>
                          <Icon name="mic" size={17} />
                        </button>
                        <button
                          type="submit"
                          className={`ai-composer__btn ${streaming ? 'ai-composer__btn--stop' : 'ai-composer__btn--send'}`}
                          disabled={!streaming && sendDisabled}
                          aria-label={streaming ? t('stop') : t('send')}
                        >
                          <Icon name={streaming ? 'stop' : 'arrow-up'} size={16} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </form>
          </section>
        </div>
      </div>
      {editPf && (
        <Suspense fallback={null}>
          <MediaEditorModal
            key={`${editPf.tempId}-${editPf.file.size}`}
            file={editPf.file}
            initialCaption={draft}
            onCancel={() => setEditId(null)}
            onDone={finishVideoEdit}
            onSend={finishVideoEdit}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Error / No Permission / Service Error card (design's three states). */
function AiBanner({ banner, t, onRetry }) {
  const kind = ({ danger: 'error', warning: 'service' })[banner.kind] || banner.kind || 'error';
  const meta = {
    error: { title: t('errorTitle'), icon: 'alert', action: t('retry') },
    permission: { title: t('permissionTitle'), icon: 'info', action: null },
    service: { title: t('serviceTitle'), icon: 'refresh', action: t('tryAgain') },
  }[kind] || { title: t('errorTitle'), icon: 'alert', action: t('retry') };
  return (
    <div className={`ai-banner ai-banner--${kind}`} role="alert">
      <span className="ai-banner__icon"><Icon name={meta.icon} size={15} /></span>
      <div className="ai-banner__body"><strong>{meta.title}</strong><span>{banner.text}</span></div>
      {meta.action && onRetry && <button type="button" className="ai-banner__action" onClick={onRetry}>{meta.action}</button>}
    </div>
  );
}

function ConvItem({ c, active, open, time, selectMode, selected, onOpenMenu, onSelect, onAction, onExport, t }) {
  return (
    <div className={`ai-conv-item${active && !selectMode ? ' is-active' : ''}${selected ? ' is-selected' : ''}`} onClick={onSelect}>
      {selectMode
        ? <span className={`ai-conv-item__check${selected ? ' is-checked' : ''}`} role="checkbox" aria-checked={selected}>{selected && <Icon name="check" size={12} />}</span>
        : <span className="ai-conv-item__icon"><Icon name="message-square" size={15} /></span>}
      <span className="ai-conv-item__text">
        <span className="ai-conv-item__title">{c.title}</span>
        {time && <span className="ai-conv-item__time">{time}</span>}
      </span>
      {!selectMode && <button
        type="button"
        className={`ai-conv-item__menu-btn${open ? ' is-open' : ''}`}
        aria-label={t('menu')}
        onClick={(e) => { e.stopPropagation(); onOpenMenu(); }}
      >
        <Icon name="more-vertical" size={15} />
      </button>}
      <div className={`ai-conv-menu glass-panel${open && !selectMode ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => onAction('rename')}><Icon name="edit" size={14} />{t('rename')}</button>
        <button type="button" onClick={() => onAction('pin')}><Icon name="star" size={14} />{c.is_pinned ? t('unpin') : t('pin')}</button>
        <button type="button" onClick={() => onAction('archive')}><Icon name="archive" size={14} />{c.is_archived ? t('unarchive') : t('archive')}</button>
        <ExportMenu className="ai-conv-menu__export" iconSize={14} label={t('exportChat')} formats={['pdf', 'xlsx', 'csv', 'json', 'md', 'txt']} onExport={(format, lang) => onExport(c, format, lang)} />
        <button type="button" className="is-danger" onClick={() => onAction('delete')}><Icon name="trash" size={14} />{t('del')}</button>
      </div>
    </div>
  );
}

function MessagesSkeleton() {
  const rows = [
    { side: 'assistant', widths: ['85%', '60%'] },
    { side: 'user', widths: ['40%'] },
    { side: 'assistant', widths: ['70%', '90%', '35%'] },
  ];
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className={`ai-msg ai-msg--${row.side} ai-msg--skeleton`}>
          <div className="ai-msg__col">
            <div className="ai-bubble">
              {row.widths.map((w, j) => <div key={j} className="skeleton skeleton-line" style={{ width: w }} />)}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function MessageBubble({ m, t, locale, copied, onAction, onCopyCode, onStop }) {
  const isUser = m.role === 'user';
  const persisted = !isTempId(m.id);
  const canRetry = !persisted && !isUser && m.status === 'error' && m.retryContent != null;
  const reactions = m.reactions || {};
  const reactionKeys = Object.keys(reactions).filter((k) => reactions[k] && reactions[k].length);
  const isStreaming = m.status === 'streaming';
  const isError = m.status === 'error';
  const waiting = isStreaming && !m.content;
  // a user turn can carry transcripts of recordings: they are shown as cards under the text, not as raw markup
  const split = isUser ? splitTranscripts(m.content) : { text: m.content, transcripts: [] };
  const hasMedia = !!(m.attachments && m.attachments.length) || split.transcripts.length > 0;
  const showBubble = !isUser || !!split.text || !hasMedia;
  const bodyHtml = waiting ? null : renderMarkdown(split.text, t('copy'));

  function onBubbleClick(e) {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    const code = btn.nextElementSibling ? btn.nextElementSibling.textContent : '';
    onCopyCode(code, btn);
  }

  // Failed turn: the design's error card (Error / No Permission / Service Error).
  if (isError && !isUser) {
    const kind = m.errorKind || 'error';
    const title = { error: t('errorTitle'), permission: t('permissionTitle'), service: t('serviceTitle') }[kind];
    return (
      <div className="ai-msg ai-msg--assistant">
        <span className="ai-avatar ai-msg__avatar"><Icon name="sparkles" size={14} /></span>
        <div className="ai-msg__col">
          <div className={`ai-banner ai-banner--${kind} ai-banner--inline`} role="alert">
            <span className="ai-banner__icon"><Icon name={kind === 'permission' ? 'info' : kind === 'service' ? 'refresh' : 'alert'} size={15} /></span>
            <div className="ai-banner__body"><strong>{title}</strong><span>{m.content}</span></div>
            {canRetry && kind !== 'permission' && <button type="button" className="ai-banner__action" onClick={() => onAction('retry-send')}>{kind === 'service' ? t('tryAgain') : t('retry')}</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ai-msg ${isUser ? 'ai-msg--user' : 'ai-msg--assistant'}`}>
      {!isUser && <span className="ai-avatar ai-msg__avatar"><Icon name="sparkles" size={14} /></span>}
      <div className="ai-msg__col">
        {m.attachments && m.attachments.length > 0 && (
          <div className="ai-msg__attachments">{m.attachments.map((a, i) => <AiAttachment key={a.id || i} a={a} t={t} />)}</div>
        )}

        {waiting ? (
          <div className="ai-status"><strong>{m.toolLabel ? `${m.toolLabel}…` : t('analyzing')}</strong><div className="ai-typing"><span /><span /><span /></div></div>
        ) : (
          <>
            {isStreaming && (
              <div className="ai-status ai-status--stream">
                <span className="ai-status__label">{t('streamingResponse')}</span>
                <button type="button" className="ai-stop-pill" onClick={onStop}><span className="ai-stop-pill__sq" />{t('stopShort')}</button>
              </div>
            )}
            {showBubble && (
              <div className="ai-bubble" onClick={onBubbleClick}>
                <span dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                {isStreaming && <span className="ai-cursor" />}
              </div>
            )}
          </>
        )}

        {split.transcripts.map((x, i) => <TranscriptCard key={i} name={x.name} text={x.text} t={t} />)}

        {!waiting && !isStreaming && (
          <div className="ai-msg__meta">
            {isUser && <span>{t('you')}{m.edited_at ? ` · ${t('edit').toLowerCase()}` : ''} · {fmtTime(m.created_at, locale)}</span>}
            {!isUser && reactionKeys.length > 0 && <span>{reactionKeys.map((k) => `${k}${reactions[k].length}`).join(' ')}</span>}
            {isUser ? (
              <div className="ai-msg__actions">
                {m.content && <button type="button" onClick={() => onAction('copy')} title={t('copy')}><Icon name={copied ? 'check' : 'copy'} size={13} /></button>}
                {persisted && <button type="button" onClick={() => onAction('edit')} title={t('edit')}><Icon name="edit" size={13} /></button>}
                {persisted && <button type="button" onClick={() => onAction('delete')} title={t('del')}><Icon name="trash" size={13} /></button>}
              </div>
            ) : (
              <div className="ai-msg__toolbar">
                {m.content && (
                  <button type="button" onClick={() => onAction('copy')}><Icon name={copied ? 'check' : 'copy'} size={13} /><span>{copied ? t('copied') : t('copy')}</span></button>
                )}
                {persisted && (
                  <button type="button" className={reactionKeys.indexOf('👍') > -1 ? 'is-active' : ''} onClick={() => onAction('react')}><Icon name="thumbs-up" size={13} /><span>{t('helpful')}</span></button>
                )}
                {persisted && <button type="button" onClick={() => onAction('regenerate')}><Icon name="refresh" size={13} /><span>{t('regenerate')}</span></button>}
                {persisted && <button type="button" className={`ai-msg__icon-only${m.is_bookmarked ? ' is-active' : ''}`} onClick={() => onAction('bookmark')} title={t('bookmark')} aria-label={t('bookmark')}><Icon name="star" size={13} /></button>}
                {persisted && <button type="button" className="ai-msg__icon-only" onClick={() => onAction('delete')} title={t('del')} aria-label={t('del')}><Icon name="trash" size={13} /></button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
