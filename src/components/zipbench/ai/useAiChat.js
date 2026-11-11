import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from '../../../api/client';
import { streamPost, aiLocale } from './sse';
import { wireText } from './quote';

const URL = '/api/v1/ai-code/chat';
const CHATS = '/api/v1/ai-code/chats';
const FLUSH_MS = 90;     // batch streamed tokens into one render (fewer renders = no UI jank)
const HISTORY = 12;      // messages sent back to the server (it keeps the last 10 anyway)
const SAVE_MS = 700;     // debounce for saving the conversation to the account

/** Messages for the failures the server can answer with before the stream starts. */
function httpMessage(status, serverMsg, tt) {
  if (status === 403) return tt('You do not have permission to use the AI code assistant (or it is locked during an exam).', 'مفيش عندك صلاحية لاستخدام مساعد الكود (أو هو مقفول أثناء الامتحان).');
  if (status === 429) return tt('Too many requests. Please wait a moment and try again.', 'طلبات كتير. استنى شوية وجرّب تاني.');
  if (status === 413) return tt('The files are too large for the assistant. Turn off some context and try again.', 'الملفات كبيرة على المساعد. قفّل جزء من السياق وجرّب تاني.');
  if (status === 503) return tt('The AI chat is not available right now.', 'شات الذكاء الاصطناعي مش متاح دلوقتي.');
  return serverMsg || tt('Something went wrong. Please try again.', 'حصلت مشكلة. جرّب تاني.');
}

// Ids must be unique across sessions now (a reopened conversation keeps its ids): prefix with the time the page loaded.
const PREFIX = Date.now().toString(36);
let uid = 0;
const nextId = () => { uid += 1; return `m${PREFIX}${uid}`; };

function newUuid() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* old browser */ }
  const h = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${h(3)}-${h(12)}`;
}

/** What the model is told about the changes it suggested earlier (the visible text has the edit blocks stripped). */
function editsNote(m) {
  const eds = m.edits || [];
  if (!eds.length) return '';
  const word = { applied: 'applied by the student', rejected: 'rejected by the student', pending: 'not applied yet', stale: 'could not be applied' };
  return `\n\n[Changes you suggested in this reply: ${eds.map((e) => `${e.kind === 'create' ? 'new file' : e.rewrite ? 'rewrite of' : 'edit of'} ${e.path} (${word[e.state] || e.state})`).join('; ')}]`;
}

/** Earlier questions that had code pinned to them: keep a short copy of it in the history sent to the model. */
function refsNote(m) {
  const rs = Array.isArray(m.refs) ? m.refs : [];
  if (!rs.length) return '';
  return `\n\n[Code the student pinned to this question: ${rs.map((r) => `${r.path || 'code'} lines ${r.from}-${r.to}:\n${String(r.text || '').slice(0, 1200)}`).join('\n---\n')}]`;
}

const unwrap = (res) => (res && res.data) || res || {};

/**
 * A tiny external store. The streaming state lives HERE, not in React state of the workbench: ZipWorkbench is a ~1700 line
 * component (editor, explorer, terminal, search...) and re-rendering all of it for every streamed token was what froze the
 * page. Only the panel subscribes (see useAiChatState), so a token re-renders the chat and nothing else.
 */
function createStore() {
  let state = { messages: [], chatId: null, chats: null, listError: false, saveState: 'idle' }; // saveState: idle | saving | saved | error
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => { subs.delete(f); }; },
  };
}

/** Subscribe a component (the chat panel) to the chat state: { messages, chatId, chats, listError, saveState }. */
export function useAiChatState(chat) {
  return useSyncExternalStore(chat.store.subscribe, chat.store.get, chat.store.get);
}

/**
 * Side-panel chat state, saved on the student's account.
 *
 *   const chat = useAiChat({ tt, scope, label });
 *   chat.send({ text, mode, buildRequest })   // buildRequest() -> { active_path, files, tree, sel_from, sel_to, error } (read at send time)
 *   useAiChatState(chat).messages  // (read inside the panel only — the workbench itself does not re-render per token) [{ id, role: 'user'|'assistant', content, phase?: 'streaming'|'done'|'error'|'stopped', edits?: [{…, id, state}], error? }]
 *   useAiChatState(chat).chats     // saved conversations [{ id, title, message_count, updated_at, label }] (null until loaded)
 *   chat.newChat() / chat.openChat(id) / chat.renameChat(id, title) / chat.deleteChat(id) / chat.clearAll()
 *
 * The context (open file, selection, terminal output, other tabs) is rebuilt on EVERY send and only the question text is
 * kept in the history, so a saved conversation does not carry file contents. A conversation is created on the first
 * question and re-saved (debounced) whenever it changes — including when the student applies or rejects a suggested change.
 */
export function useAiChat({ tt, scope = '', label = '', enabled = true }) {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createStore();
  const store = storeRef.current;
  const setMessages = useCallback((v) => store.set((cur) => ({ messages: typeof v === 'function' ? v(cur.messages) : v })), [store]);
  const setChats = useCallback((v) => store.set((cur) => ({ chats: typeof v === 'function' ? v(cur.chats) : v })), [store]);
  const setChatId = useCallback((chatId) => store.set({ chatId }), [store]);
  const setListError = useCallback((listError) => store.set({ listError }), [store]);
  const setSaveState = useCallback((saveState) => store.set({ saveState }), [store]);
  const getMessages = useCallback(() => store.get().messages, [store]);
  const idRef = useRef(null);
  const modeRef = useRef(null);
  const dirty = useRef(false);   // the messages changed by the student's action (not by loading a saved chat)
  const saveT = useRef(0);
  const abortRef = useRef(null);
  const seqRef = useRef(0);
  const ttRef = useRef(tt);
  ttRef.current = tt;
  const metaRef = useRef({ scope, label });
  metaRef.current = { scope, label };

  const abort = useCallback(() => {
    seqRef.current += 1;
    try { abortRef.current?.abort(); } catch { /* already done */ }
    abortRef.current = null;
  }, []);
  useEffect(() => abort, [abort]);

  // ---- saved conversations -------------------------------------------------------------------------------------
  const loadChats = useCallback(async () => {
    if (!enabled) return;
    try {
      const d = unwrap(await api.get(CHATS));
      setChats(Array.isArray(d.chats) ? d.chats : []);
      setListError(false);
    } catch { setListError(true); setChats((c) => c || []); }
  }, [enabled, setChats, setListError]);

  const upsertSummary = useCallback((s) => {
    setChats((cur) => [s, ...(cur || []).filter((c) => c.id !== s.id)]);
  }, [setChats]);

  const saveNow = useCallback(async () => {
    clearTimeout(saveT.current);
    const id = idRef.current;
    const msgs = store.get().messages;
    if (!enabled || !id || !dirty.current || !msgs.length || msgs.some((m) => m.phase === 'streaming')) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      const body = {
        mode: modeRef.current || undefined,
        scope: metaRef.current.scope || undefined,
        label: metaRef.current.label || undefined,
        messages: msgs.map((m) => (m.role === 'user'
          ? { id: m.id, role: 'user', content: m.content }
          : { id: m.id, role: 'assistant', content: m.content, phase: m.phase, mode: m.mode, error: m.error, edits: m.edits })),
      };
      const d = unwrap(await api.put(`${CHATS}/${id}`, body));
      if (d.chat) upsertSummary(d.chat);
      setSaveState('saved');
    } catch {
      dirty.current = true; // try again on the next change / retry
      setSaveState('error');
    }
  }, [enabled, upsertSummary, store, setSaveState]);

  // debounce: save a moment after the last change, never while a reply is streaming
  useEffect(() => {
    let prev = store.get().messages;
    const off = store.subscribe(() => {
      const cur = store.get().messages;
      if (cur === prev) return;
      prev = cur;
      if (!dirty.current || !idRef.current || !cur.length || cur.some((m) => m.phase === 'streaming')) return;
      clearTimeout(saveT.current);
      saveT.current = setTimeout(saveNow, SAVE_MS);
    });
    return () => { off(); clearTimeout(saveT.current); };
  }, [store, saveNow]);
  // leaving the page / closing the panel must not lose the last answer
  useEffect(() => () => { saveNow(); }, [saveNow]);

  const run = useCallback(async ({ history, mode, buildRequest }) => {
    abort();
    const seq = seqRef.current;
    const t = (en, ar) => ttRef.current(en, ar);
    const id = nextId();
    const live = () => seq === seqRef.current;
    const patch = (p) => { if (live()) setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, ...p } : m))); };

    if (!idRef.current) { const n = newUuid(); idRef.current = n; setChatId(n); }
    modeRef.current = mode;
    dirty.current = true;
    setMessages([...history, { id, role: 'assistant', content: '', phase: 'streaming', edits: [], mode }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let buf = ''; let flushT = 0;
    const flush = () => { flushT = 0; if (buf) { const add = buf; buf = ''; if (live()) setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, content: m.content + add } : m))); } };

    let finished = false;
    const onEvent = (evt) => {
      switch (evt.type) {
        case 'token': buf += evt.delta || ''; if (!flushT) flushT = setTimeout(flush, FLUSH_MS); break;
        case 'edits': patch({ edits: Array.isArray(evt.edits) ? evt.edits.map((e, i) => ({ ...e, id: `${id}e${i}`, state: 'pending' })) : [] }); break;
        case 'done': clearTimeout(flushT); flush(); finished = true; patch({ phase: 'done', ...(typeof evt.content === 'string' && evt.content ? { content: evt.content } : {}) }); break;
        case 'error': clearTimeout(flushT); flush(); finished = true; patch({ phase: 'error', error: evt.message || t('Something went wrong. Please try again.', 'حصلت مشكلة. جرّب تاني.') }); break;
        default: break;
      }
    };

    // code parts the student pinned to THIS question travel as `refs`; the ones pinned to earlier questions are folded into
    // that question's text so a follow-up ("and what about the second one?") still has what it refers to
    const lastUser = history[history.length - 1];
    const refs = (lastUser && lastUser.role === 'user' && Array.isArray(lastUser.refs) ? lastUser.refs : [])
      .map((r) => ({ path: r.path, from: r.from, to: r.to, text: String(r.text || '').slice(0, 4000) }));
    const wire = history
      .filter((m) => m.content && m.phase !== 'error')
      .slice(-HISTORY)
      .map((m) => ({ role: m.role, content: m.role === 'assistant' ? `${m.content}${editsNote(m)}` : (m !== lastUser ? `${wireText(m.content)}${refsNote(m)}` : wireText(m.content)) }));

    try {
      await streamPost(URL, { ...buildRequest(), ...(refs.length ? { refs } : {}), messages: wire, mode, locale: aiLocale() }, { signal: ctrl.signal, onEvent });
      clearTimeout(flushT); flush();
      if (!finished) patch({ phase: 'done' }); // the stream ended without done/error: keep what we have
    } catch (err) {
      clearTimeout(flushT); flush();
      if (!live()) return;
      if (err && err.name === 'AbortError') { patch({ phase: 'stopped' }); return; }
      if (err && err.timeout) { patch({ phase: 'error', error: t('The assistant took too long to answer. Please try again.', 'المساعد اتأخر في الرد. جرّب تاني.') }); return; }
      patch({ phase: 'error', error: err && err.status ? httpMessage(err.status, err.serverMessage, t) : ((err && err.message) || t('Something went wrong. Please try again.', 'حصلت مشكلة. جرّب تاني.')) });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [abort, setMessages, setChatId]);

  const send = useCallback(({ text, mode, buildRequest, refs }) => {
    const q = String(text || '').trim();
    if (!q) return;
    run({ history: [...store.get().messages, { id: nextId(), role: 'user', content: q, ...(refs && refs.length ? { refs } : {}) }], mode, buildRequest });
  }, [run, store]);

  /** Drop this question and everything after it (the panel puts its text back in the box to edit and send again). */
  const rewind = useCallback((msgId) => {
    const cur = store.get().messages;
    const i = cur.findIndex((m) => m.id === msgId);
    if (i < 0) return;
    abort();
    dirty.current = true;
    setMessages(cur.slice(0, i));
  }, [abort, setMessages, store]);

  /** Ask the last question again (after an error, a stop, or when the mode was switched). */
  const retry = useCallback(({ mode, buildRequest }) => {
    const cur = store.get().messages;
    let i = cur.length - 1;
    while (i >= 0 && cur[i].role !== 'user') i -= 1;
    if (i < 0) return;
    run({ history: cur.slice(0, i + 1), mode, buildRequest });
  }, [run, store]);

  const stop = useCallback(() => { abort(); dirty.current = true; setMessages((cur) => cur.map((m) => (m.phase === 'streaming' ? { ...m, phase: 'stopped' } : m))); }, [abort, setMessages]);

  /** Start an empty conversation (the old one stays saved in the list). */
  const newChat = useCallback(() => {
    saveNow();
    abort();
    dirty.current = false;
    idRef.current = null;
    setChatId(null);
    setMessages([]);
    setSaveState('idle');
  }, [abort, saveNow]);

  const openChat = useCallback(async (id) => {
    if (id === idRef.current) return true;
    await saveNow();
    abort();
    try {
      const d = unwrap(await api.get(`${CHATS}/${id}`));
      const c = d.chat;
      if (!c || !Array.isArray(c.messages)) throw new Error('bad chat');
      dirty.current = false;
      idRef.current = c.id;
      setChatId(c.id);
      setMessages(c.messages.map((m) => (m.role === 'assistant' ? { ...m, edits: m.edits || [] } : m)));
      setSaveState('idle');
      return true;
    } catch {
      setChats((cur) => (cur || []).filter((x) => x.id !== id)); // deleted from another device
      return false;
    }
  }, [abort, saveNow]);

  const renameChat = useCallback(async (id, title) => {
    const v = String(title || '').trim().slice(0, 120);
    if (!v) return false;
    try {
      await api.patch(`${CHATS}/${id}`, { title: v });
      setChats((cur) => (cur || []).map((c) => (c.id === id ? { ...c, title: v } : c)));
      return true;
    } catch { return false; }
  }, []);

  const deleteChat = useCallback(async (id) => {
    try { await api.del(`${CHATS}/${id}`); } catch (e) { if (!e || e.status !== 404) return false; }
    setChats((cur) => (cur || []).filter((c) => c.id !== id));
    if (id === idRef.current) { abort(); dirty.current = false; idRef.current = null; setChatId(null); setMessages([]); }
    return true;
  }, [abort]);

  /** Delete several saved conversations at once. Resolves { deleted, failed } (ids). A 404 counts as deleted (already gone). */
  const deleteMany = useCallback(async (ids) => {
    const list = [...new Set(ids)];
    const results = await Promise.all(list.map(async (id) => {
      try { await api.del(`${CHATS}/${id}`); return [id, true]; } catch (e) { return [id, !!e && e.status === 404]; }
    }));
    const deleted = results.filter(([, ok]) => ok).map(([id]) => id);
    const failed = results.filter(([, ok]) => !ok).map(([id]) => id);
    if (deleted.length) {
      const gone = new Set(deleted);
      setChats((cur) => (cur || []).filter((c) => !gone.has(c.id)));
      if (idRef.current && gone.has(idRef.current)) { abort(); dirty.current = false; idRef.current = null; setChatId(null); setMessages([]); }
    }
    return { deleted, failed };
  }, [abort]);

  const clearAll = useCallback(async () => {
    try { await api.del(CHATS); } catch { return false; }
    abort(); dirty.current = false; idRef.current = null; setChatId(null); setMessages([]); setChats([]);
    return true;
  }, [abort]);

  const mark = useCallback((msgId, editId, state) => {
    dirty.current = true;
    setMessages((cur) => cur.map((m) => (m.id === msgId && m.edits ? { ...m, edits: m.edits.map((e) => (e.id === editId ? { ...e, state } : e)) } : m)));
  }, []);

  return {
    store, getMessages,
    send, retry, stop, mark, rewind,
    loadChats, newChat, openChat, renameChat, deleteChat, deleteMany, clearAll,
    retrySave: saveNow,
    /** kept for callers that used the old name */
    clear: newChat,
  };
}
