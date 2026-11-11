import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import Markdown from './AiMarkdown';
import { Diff } from './AiFixPanel';
import { useAiChatState } from './useAiChat';
import { joinQuote, splitQuote, MAX_QUOTE } from './quote';
import '../../../styles/css/zip-ai-fix.css';
import '../../../styles/css/zip-ai-uip.css';

const WIDTH_KEY = 'zb-ai-w';
const DEF_W = 440;
const MIN_W = 320;
const KEEP_FOR_EDITOR = 280; // the editor always keeps at least this much room

const readWidth = () => { try { const n = Number(window.localStorage.getItem(WIDTH_KEY)); return n >= MIN_W ? n : null; } catch { return null; } };
const saveWidth = (w) => { try { if (w) window.localStorage.setItem(WIDTH_KEY, String(Math.round(w))); else window.localStorage.removeItem(WIDTH_KEY); } catch { /* storage unavailable */ } };

// "make me a file / change this / fix it" — asked while the chat is in Tutor mode (which never touches files)
const CHANGE_INTENT = /\b(create|make|add|write|generate|build|implement|fix|change|edit|update|modify|rewrite|refactor|rename|delete|remove)\b|انشئ|أنشئ|انشاء|إنشاء|اعمل|اعملي|عمل|ضيف|أضف|اضف|اكتب|اكتبلي|عدّل|عدل|غيّر|غير|صلّح|صلح|حوّل|حول|ابني|كوّن|احذف|امسح/i;

/** What a brand-new file looks like in the panel: its first lines, all "added". */
function NewFilePreview({ content, tt }) {
  const [all, setAll] = useState(false);
  const lines = String(content).split('\n');
  const shown = all ? lines : lines.slice(0, 14);
  return (
    <div className="zb-ai__diff" dir="ltr" role="group">
      {shown.map((s, i) => (
        <div key={i} className="zb-ai__row is-add">
          <span className="zb-ai__ln">{i + 1}</span>
          <span className="zb-ai__sign" aria-hidden="true">+</span>
          <span className="zb-ai__txt">{s || ' '}</span>
        </div>
      ))}
      {lines.length > shown.length && <button type="button" className="zb-ai__more" onClick={() => setAll(true)} dir="auto">{tt(`Show all ${lines.length} lines`, `عرض كل الـ ${lines.length} سطر`)}</button>}
    </div>
  );
}

const BRAND = 'UIPE AI';
const baseOf = (p) => String(p || '').split('/').pop() || '';

/** A quoted part of the code (file + lines + the first lines of it). Used in the composer (removable) and in the sent message. */
function RefCard({ r, tt, onRemove, onGoto, live }) {
  const lines = String(r.text || '').split('\n');
  const shown = lines.slice(0, 3);
  return (
    <div className={`zb-ref${live ? ' is-live' : ''}`}>
      <div className="zb-ref__head">
        <Icon name={live ? 'edit' : 'paperclip'} size={12} />
        <button type="button" className="zb-ref__where" dir="ltr" onClick={() => onGoto && onGoto(r.path, r.from)} disabled={!onGoto} title={tt('Go to this code', 'روح للكود ده')}>
          {baseOf(r.path) || tt('Code', 'كود')} <b>{r.from === r.to ? `L${r.from}` : `L${r.from}–${r.to}`}</b>
        </button>
        {onRemove && <button type="button" className="zb-ref__x" onClick={onRemove} aria-label={tt('Remove', 'إزالة')} title={tt('Remove', 'إزالة')}><Icon name="x" size={12} /></button>}
      </div>
      <pre className="zb-ref__code" dir="ltr">{shown.join('\n')}{lines.length > shown.length ? '\n…' : ''}</pre>
    </div>
  );
}

function EditCard({ e, tt, onApply, onReject, onOpen }) {
  const kindBadge = e.kind === 'create' ? tt('New file', 'ملف جديد') : e.rewrite ? tt('Rewrite', 'إعادة كتابة') : null;
  return (
    <div className={`zb-ai__edit is-${e.state}`}>
      <div className="zb-ai__efile">
        <Icon name={e.kind === 'create' ? 'file-plus' : 'file'} size={13} />
        <button type="button" className="zb-ai__file" onClick={() => onOpen(e.path)} title={tt('Open this file', 'افتح الملف ده')} dir="ltr">{e.path}</button>
        {kindBadge && <span className="zb-ai__badge">{kindBadge}</span>}
      </div>
      {e.kind === 'create' ? <NewFilePreview content={e.replace} tt={tt} /> : <Diff edit={e} tt={tt} />}
      <div className="zb-ai__edit-acts">
        {e.state === 'pending' && (
          <>
            <button type="button" className="zb-btn zb-btn--primary" onClick={() => onApply(e.id)}>
              <Icon name="check" size={14} /> <span>{e.kind === 'create' ? tt('Create', 'إنشاء') : tt('Apply', 'تطبيق')}</span>
            </button>
            <button type="button" className="zb-btn" onClick={() => onReject(e.id)}><Icon name="x" size={14} /> <span>{tt('Reject', 'رفض')}</span></button>
          </>
        )}
        {e.state === 'applied' && (
          <>
            <span className="zb-ai__tag is-ok"><Icon name="check" size={13} /> {e.kind === 'create' ? tt('Created', 'اتعمل') : tt('Applied — Ctrl+S to keep it', 'اتطبّق — Ctrl+S عشان تحفظه')}</span>
            <button type="button" className="zb-btn" onClick={() => onOpen(e.path)}><span>{tt('Open', 'افتح')}</span></button>
          </>
        )}
        {e.state === 'rejected' && <span className="zb-ai__tag">{tt('Rejected', 'مرفوض')}</span>}
        {e.state === 'stale' && (
          <span className="zb-ai__tag is-warn">
            {e.kind === 'create' ? tt('A file with that name already exists.', 'فيه ملف بنفس الاسم بالفعل.') : tt('The code changed since the suggestion — ask again.', 'الكود اتغيّر بعد الاقتراح — اسأل تاني.')}
          </span>
        )}
      </div>
    </div>
  );
}

const Message = memo(function Message({ m, prevUser, tt, canSwitch, onApply, onApplyAll, onReject, onOpen, onRetry, onSwitchAndRetry, onNewFile, onGoto, onEdit, isLast, isLastUser, busy }) {
  const [copied, setCopied] = useState(false);
  if (m.role === 'user') {
    return (
      <div className="zb-chat__ubox">
        <div className="zb-chat__user" dir="auto">
          {Array.isArray(m.refs) && m.refs.length > 0 && <div className="zb-chat__refs">{m.refs.map((r, i) => <RefCard key={i} r={r} tt={tt} onGoto={onGoto} />)}</div>}
          {(() => { const { text, quote } = splitQuote(m.content); return (<>{quote && <blockquote className="zb-chat__uquote" dir="auto">{quote}</blockquote>}{text}</>); })()}
        </div>
        {isLastUser && !busy && <button type="button" className="zb-ai__mini zb-chat__edit" onClick={() => onEdit(m)}><Icon name="edit" size={12} /> {tt('Edit', 'تعديل')}</button>}
      </div>
    );
  }
  const streaming = m.phase === 'streaming';
  const edits = m.edits || [];
  const pending = edits.filter((e) => e.state === 'pending');
  const files = new Set(edits.map((e) => e.path)).size;
  const needsAssistant = isLast && m.phase === 'done' && m.mode === 'tutor' && !edits.length && prevUser && CHANGE_INTENT.test(prevUser);
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ } };
  return (
    <div className="zb-chat__bot">
      <span className="zb-chat__avatar" aria-hidden="true"><Icon name="sparkles" size={13} /></span>
      <div className="zb-chat__botbody">
      <span className="zb-chat__who">{BRAND}</span>
      {streaming && !m.content && <div className="zb-ai__wait"><span className="zb-ai__dots" aria-hidden="true"><i /><i /><i /></span>{tt('UIPE AI is reading your code…', 'UIPE AI بيقرأ الكود…')}</div>}
      {m.content && <Markdown text={m.content} tt={tt} streaming={streaming} onNewFile={onNewFile} />}
      {streaming && m.content && <span className="zb-ai__cursor" aria-hidden="true" />}
      {m.phase === 'stopped' && <div className="zb-ai__tag">{tt('Stopped', 'اتوقّف')}</div>}

      {edits.length > 0 && (
        <div className="zb-ai__edits">
          <div className="zb-ai__edits-head">
            <strong>{tt('Suggested changes', 'التعديلات المقترحة')} ({edits.length}) {tt('in', 'في')} {files} {files === 1 ? tt('file', 'ملف') : tt('files', 'ملفات')}</strong>
            {pending.length > 1 && <button type="button" className="zb-btn zb-btn--primary" onClick={() => onApplyAll(m.id)}><Icon name="check" size={14} /> <span>{tt('Apply all', 'تطبيق الكل')}</span></button>}
          </div>
          {edits.map((e) => <EditCard key={e.id} e={e} tt={tt} onApply={(id) => onApply(m.id, id)} onReject={(id) => onReject(m.id, id)} onOpen={onOpen} />)}
        </div>
      )}

      {needsAssistant && (
        <div className="zb-ai__nudge" role="note">
          <Icon name="info" size={14} />
          <div>
            <strong>{tt('Tutor mode only explains — it can’t create or change files.', 'وضع «مدرّس» بيشرح بس — مش بيعمل ولا بيعدّل ملفات.')}</strong>
            {canSwitch
              ? <button type="button" className="zb-btn zb-btn--primary" onClick={onSwitchAndRetry} disabled={busy}><Icon name="sparkles" size={13} /> <span>{tt('Switch to Assistant and do it', 'حوّل لوضع «مساعد» ونفّذها')}</span></button>
              : <small>{tt('The mode is fixed here (by your supervisor or the platform).', 'الوضع ثابت هنا (من الدكتور المشرف أو المنصة).')}</small>}
          </div>
        </div>
      )}

      {m.phase === 'error' && (
        <div className="zb-ai__error" role="alert">
          <span>{m.error}</span>
          {isLast && <button type="button" className="zb-btn" onClick={onRetry}><Icon name="refresh" size={14} /> <span>{tt('Try again', 'حاول تاني')}</span></button>}
        </div>
      )}

      {(m.phase === 'done' || m.phase === 'stopped') && m.content && (
        <div className="zb-chat__msgacts">
          <button type="button" className="zb-ai__mini" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? tt('Copied', 'تم النسخ') : tt('Copy', 'نسخ')}</button>
          {isLast && <button type="button" className="zb-ai__mini" onClick={onRetry} disabled={busy}><Icon name="refresh" size={12} /> {tt('Regenerate', 'إعادة توليد')}</button>}
        </div>
      )}
      </div>
    </div>
  );
});

function when(iso, tt) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return tt('just now', 'دلوقتي');
  if (min < 60) return tt(`${min} min ago`, `من ${min} دقيقة`);
  const h = Math.round(min / 60);
  if (h < 24) return tt(`${h} h ago`, `من ${h} ساعة`);
  const days = Math.round(h / 24);
  if (days < 7) return tt(`${days} d ago`, `من ${days} يوم`);
  return d.toLocaleDateString(tt('en-GB', 'ar-EG'), { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** The saved conversations of the account: open, rename, delete (one or all). */
function HistoryView({ tt, h, busy, onDone }) {
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState(null); // id
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(null);   // id | 'all' | 'many'
  const [selecting, setSelecting] = useState(false); // multi-select mode
  const [picked, setPicked] = useState(() => new Set());
  const anchor = useRef(null);
  const [bulkErr, setBulkErr] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (h.chats || []).filter((c) => !t || (c.title || '').toLowerCase().includes(t));
  }, [h.chats, q]);

  const open = async (id) => { if (busy) return; if (await h.onOpen(id)) onDone(); };
  const pickedIds = [...picked].filter((id) => (h.chats || []).some((c) => c.id === id));
  const exitSelect = () => { setSelecting(false); setPicked(new Set()); setConfirm(null); setBulkErr(''); anchor.current = null; };
  const toggle = (id, e) => {
    setBulkErr('');
    setPicked((cur) => {
      const next = new Set(cur);
      if (e?.shiftKey && anchor.current != null) {
        const a = list.findIndex((c) => c.id === anchor.current); const b = list.findIndex((c) => c.id === id);
        if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; list.slice(lo, hi + 1).forEach((c) => next.add(c.id)); return next; }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchor.current = id;
  };
  const allShown = list.length > 0 && list.every((c) => picked.has(c.id));
  const toggleAll = () => setPicked(allShown ? new Set() : new Set(list.map((c) => c.id)));
  const deleteSelected = async () => {
    setConfirm(null);
    const { failed } = await h.onDeleteMany(pickedIds);
    if (failed.length) { setPicked(new Set(failed)); setBulkErr(tt(`${failed.length} could not be deleted — try again.`, `${failed.length} محادثة معرفتش أحذفها — جرّب تاني.`)); } else exitSelect();
  };
  const commitRename = async () => { const id = renaming; setRenaming(null); if (id && draft.trim()) await h.onRename(id, draft); };

  return (
    <div className="zb-hist">
      <div className="zb-hist__top">
        <div className="zb-hist__search">
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search conversations…', 'ابحث في المحادثات…')} aria-label={tt('Search conversations', 'بحث في المحادثات')} dir="auto" />
        </div>
        <button type="button" className="zb-btn zb-btn--primary" onClick={() => { h.onNew(); onDone(); }} disabled={busy}><Icon name="plus" size={14} /> <span>{tt('New chat', 'محادثة جديدة')}</span></button>
      </div>

      {(h.chats || []).length > 0 && (
        <div className="zb-hist__tools">
          {!selecting
            ? <button type="button" className="zb-ai__mini" onClick={() => setSelecting(true)} disabled={busy}><Icon name="check" size={12} /> {tt('Select', 'تحديد')}</button>
            : (
              <>
                <label className="zb-hist__all"><input type="checkbox" checked={allShown} onChange={toggleAll} /> <span>{allShown ? tt('Clear selection', 'إلغاء التحديد') : tt('Select all', 'تحديد الكل')}</span></label>
                <span className="zb-hist__count" aria-live="polite">{tt(`${pickedIds.length} selected`, `${pickedIds.length} محدد`)}</span>
                {confirm === 'many'
                  ? (
                    <span className="zb-hist__confirm">
                      <span>{tt(`Delete ${pickedIds.length}?`, `حذف ${pickedIds.length}؟`)}</span>
                      <button type="button" className="zb-btn zb-btn--danger" onClick={deleteSelected}>{tt('Delete', 'حذف')}</button>
                      <button type="button" className="zb-btn" onClick={() => setConfirm(null)}>{tt('Cancel', 'إلغاء')}</button>
                    </span>
                  )
                  : (
                    <>
                      <button type="button" className="zb-btn zb-btn--danger" disabled={!pickedIds.length} onClick={() => setConfirm('many')}><Icon name="trash" size={13} /> <span>{tt('Delete selected', 'حذف المحدد')}</span></button>
                      <button type="button" className="zb-btn" onClick={exitSelect}>{tt('Done', 'تم')}</button>
                    </>
                  )}
              </>
            )}
          {bulkErr && <span className="zb-hist__err" role="alert">{bulkErr}</span>}
        </div>
      )}

      <div className="zb-hist__list">
        {h.chats === null && <div className="zb-ai__wait"><span className="zb-ai__dots" aria-hidden="true"><i /><i /><i /></span>{tt('Loading…', 'بحمّل…')}</div>}
        {h.listError && (
          <div className="zb-ai__error" role="alert"><span>{tt('Could not load your conversations.', 'مقدرتش أحمّل محادثاتك.')}</span><button type="button" className="zb-btn" onClick={h.onLoad}><Icon name="refresh" size={14} /> <span>{tt('Try again', 'حاول تاني')}</span></button></div>
        )}
        {h.chats && !h.listError && list.length === 0 && <p className="zb-hist__empty" dir="auto">{q ? tt('No conversation matches your search.', 'مفيش محادثة مطابقة للبحث.') : tt('No saved conversations yet. They are saved automatically when you start chatting.', 'مفيش محادثات محفوظة لسه. بتتحفظ تلقائيًا أول ما تبدأ تتكلم.')}</p>}
        {list.map((c) => (
          <div key={c.id} className={`zb-hist__item${c.id === h.activeId ? ' is-on' : ''}${selecting && picked.has(c.id) ? ' is-picked' : ''}`}>
            {selecting && <input type="checkbox" className="zb-hist__chk" checked={picked.has(c.id)} onChange={() => {}} onClick={(e) => toggle(c.id, e)} aria-label={tt('Select this conversation', 'تحديد المحادثة دي')} />}
            {renaming === c.id ? (
              <input className="zb-hist__rename" autoFocus value={draft} maxLength={120} dir="auto" onChange={(e) => setDraft(e.target.value)} onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} aria-label={tt('Conversation title', 'عنوان المحادثة')} />
            ) : (
              <button type="button" className="zb-hist__open" onClick={(e) => (selecting ? toggle(c.id, e) : open(c.id))} disabled={busy && !selecting}>
                <strong dir="auto">{c.title || tt('New chat', 'محادثة جديدة')}</strong>
                <small>{when(c.updated_at, tt)} · {tt(`${c.message_count} messages`, `${c.message_count} رسالة`)}{c.label ? ` · ${c.label}` : ''}</small>
              </button>
            )}
            {!selecting && renaming !== c.id && confirm !== c.id && (
              <span className="zb-hist__acts">
                <button type="button" className="zb-ibtn" onClick={() => { setRenaming(c.id); setDraft(c.title || ''); }} title={tt('Rename', 'إعادة تسمية')} aria-label={tt('Rename', 'إعادة تسمية')}><Icon name="edit" size={13} /></button>
                <button type="button" className="zb-ibtn" onClick={() => setConfirm(c.id)} title={tt('Delete', 'حذف')} aria-label={tt('Delete', 'حذف')}><Icon name="trash" size={13} /></button>
              </span>
            )}
            {confirm === c.id && (
              <span className="zb-hist__confirm">
                <span>{tt('Delete?', 'حذف؟')}</span>
                <button type="button" className="zb-btn zb-btn--danger" onClick={async () => { setConfirm(null); await h.onDelete(c.id); }}>{tt('Delete', 'حذف')}</button>
                <button type="button" className="zb-btn" onClick={() => setConfirm(null)}>{tt('Cancel', 'إلغاء')}</button>
              </span>
            )}
          </div>
        ))}
      </div>

      {!selecting && (h.chats || []).length > 1 && (
        <div className="zb-hist__foot">
          {confirm === 'all'
            ? (
              <span className="zb-hist__confirm">
                <span>{tt('Delete ALL conversations?', 'تحذف كل المحادثات؟')}</span>
                <button type="button" className="zb-btn zb-btn--danger" onClick={async () => { setConfirm(null); await h.onClearAll(); }}>{tt('Delete all', 'حذف الكل')}</button>
                <button type="button" className="zb-btn" onClick={() => setConfirm(null)}>{tt('Cancel', 'إلغاء')}</button>
              </span>
            )
            : <button type="button" className="zb-ai__mini" onClick={() => setConfirm('all')}><Icon name="trash" size={12} /> {tt('Delete all conversations', 'حذف كل المحادثات')}</button>}
        </div>
      )}
    </div>
  );
}

/**
 * Right-hand AI chat panel of the workbench. It knows the open file, the selected lines, the terminal output and the other
 * open tabs (the little chips above the box say which of those are sent — each can be turned off) and, in assistant mode,
 * answers with changes to one or SEVERAL files (and new files) shown as diffs. Nothing changes until the student presses Apply.
 * Conversations are saved on the account (History); the panel can be dragged wider / maximised.
 */
export default function AiChatPanel({
  tt, chat, modes, mode, canSwitchMode, onMode, chips, onChip, suggestions, onSend, onRetry, onSwitchAndRetry, onClose,
  onApply, onApplyAll, onReject, onOpen, onNewFile, activeLabel,
  liveSel, refs = [], onPin, onUnpin, onGoto, quick = [],
}) {
  // The chat state is read HERE (external store) so streamed tokens re-render only this panel, not the whole workbench.
  const st = useAiChatState(chat);
  const { messages, saveState } = st;
  const busy = useMemo(() => messages.some((m) => m.phase === 'streaming'), [messages]);
  const onStop = chat.stop;
  const onRetrySave = chat.retrySave;
  const history = useMemo(() => ({
    chats: st.chats, listError: st.listError, activeId: st.chatId,
    onLoad: chat.loadChats, onNew: chat.newChat, onOpen: chat.openChat, onRename: chat.renameChat, onDelete: chat.deleteChat, onDeleteMany: chat.deleteMany, onClearAll: chat.clearAll,
  }), [st.chats, st.listError, st.chatId, chat]);
  const [text, setText] = useState('');
  const [quote, setQuote] = useState('');   // a part of an earlier answer the next question is about
  const [ask, setAsk] = useState(null);     // floating "Ask about this" button: { x, y, text }
  const [view, setView] = useState('chat'); // chat | history
  const [width, setWidth] = useState(readWidth);
  const [maxed, setMaxed] = useState(false);
  const asideRef = useRef(null);
  const bodyRef = useRef(null);
  const stick = useRef(true);
  const boxRef = useRef(null);

  useEffect(() => {
    const el = bodyRef.current; if (!el || !stick.current) return undefined;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [messages, view]);
  const onScroll = () => { const el = bodyRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; setAsk(null); };

  // ---- select a part of an answer -> "Ask about this" (like Claude / ChatGPT) ----------------------------------------------
  const readSelection = () => {
    const sel = window.getSelection?.();
    const body = bodyRef.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !body) { setAsk(null); return; }
    const inBot = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!el && !!el.closest('.zb-chat__botbody') && body.contains(el); };
    if (!inBot(sel.anchorNode) || !inBot(sel.focusNode)) { setAsk(null); return; }
    const t = sel.toString().replace(/ /g, ' ').trim();
    if (t.length < 2) { setAsk(null); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) { setAsk(null); return; }
    const a = asideRef.current?.getBoundingClientRect();
    if (!a) { setAsk(null); return; }
    // position relative to the panel (an ancestor window may be transformed, which breaks position: fixed)
    const below = r.top - a.top <= 52;
    setAsk({ x: Math.min(Math.max(r.left + r.width / 2 - a.left, 70), a.width - 70), y: (below ? r.bottom : r.top) - a.top + (below ? 8 : -8), below, text: t });
  };
  useEffect(() => {
    // a selection made with the mouse is read on mouse-up; keyboard / touch selections on selectionchange (debounced)
    let t = 0;
    const onChange = () => { clearTimeout(t); t = setTimeout(() => { const sel = window.getSelection?.(); if (!sel || sel.isCollapsed) setAsk(null); else readSelection(); }, 180); };
    document.addEventListener('selectionchange', onChange);
    return () => { clearTimeout(t); document.removeEventListener('selectionchange', onChange); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const takeQuote = () => {
    if (!ask) return;
    setQuote(ask.text.slice(0, MAX_QUOTE));
    setAsk(null);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    setTimeout(() => boxRef.current?.focus(), 0);
  };
  useEffect(() => { if (view === 'chat') boxRef.current?.focus(); }, [view]);
  useEffect(() => { history.onLoad(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'history') history.onLoad(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // grow with the text, up to ~6 lines
    const el = boxRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [text, view]);

  // ---- resize (drag the edge facing the editor; arrows when focused; double-click = default width) --------------------
  const clampW = (w) => {
    const parent = asideRef.current?.parentElement;
    const max = parent ? Math.max(MIN_W, parent.clientWidth - KEEP_FOR_EDITOR) : 960;
    return Math.max(MIN_W, Math.min(max, w));
  };
  const side = () => { // is the panel on the right half of the workbench?
    const el = asideRef.current; const parent = el?.parentElement; if (!el || !parent) return true;
    const r = el.getBoundingClientRect(); const p = parent.getBoundingClientRect();
    return r.left + r.width / 2 > p.left + p.width / 2;
  };
  const onGripDown = (e) => {
    const el = asideRef.current; if (!el || maxed) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(); const right = side();
    let last = r.width;
    const move = (ev) => { last = clampW(right ? r.right - ev.clientX : ev.clientX - r.left); setWidth(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; document.body.style.cursor = ''; saveWidth(last); };
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onGripKey = (e) => {
    if (maxed) return;
    const step = e.shiftKey ? 80 : 24;
    const cur = asideRef.current?.getBoundingClientRect().width || DEF_W;
    const right = side();
    let next = null;
    if (e.key === 'ArrowLeft') next = right ? cur + step : cur - step;
    else if (e.key === 'ArrowRight') next = right ? cur - step : cur + step;
    else if (e.key === 'Home') next = MIN_W;
    else if (e.key === 'End') next = 9999;
    if (next == null) return;
    e.preventDefault();
    const w = clampW(next); setWidth(w); saveWidth(w);
  };
  const resetWidth = () => { setWidth(null); saveWidth(null); setMaxed(false); };

  const lastUserId = useMemo(() => { for (let k = messages.length - 1; k >= 0; k -= 1) if (messages[k].role === 'user') return messages[k].id; return null; }, [messages]);
  const editLast = (m) => { const p = splitQuote(m.content); chat.rewind(m.id); setText(p.text); setQuote(p.quote); setTimeout(() => boxRef.current?.focus(), 0); };
  const submit = (q) => {
    let v = String(q ?? text).trim();
    if ((!v && !quote) || busy) return;
    if (!v) v = tt('Explain this part.', 'اشرحلي الجزء ده.');
    stick.current = true;
    setView('chat');
    onSend(joinQuote(v, quote));
    setText('');
    setQuote('');
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const modeName = (m) => (m === 'assistant' ? tt('Assistant', 'مساعد') : tt('Tutor', 'مدرّس'));
  const modeHint = mode === 'assistant'
    ? tt('Answers, creates files and changes your code — you review every change before it is applied.', 'بيجاوب وبينشئ ملفات وبيعدّل كودك — وإنت بتراجع كل تعديل قبل ما يتطبّق.')
    : tt('Explains and gives hints — you write the code yourself. It does not create or change files.', 'بيشرح وبيدّيك تلميحات — وإنت اللي بتكتب الكود. مش بينشئ ولا بيعدّل ملفات.');

  const title = history.activeId && history.chats ? (history.chats.find((c) => c.id === history.activeId)?.title || '') : '';
  const recent = (history.chats || []).slice(0, 3);
  const lastUserBefore = (i) => { for (let k = i - 1; k >= 0; k -= 1) if (messages[k].role === 'user') return messages[k].content; return ''; };
  const style = maxed ? { width: '78%', maxWidth: 'none' } : (width ? { width: `${width}px` } : undefined);

  return (
    <aside ref={asideRef} className={`zb-ai zb-chat${maxed ? ' is-max' : ''}`} style={style} aria-label={tt('UIPE AI chat', 'شات UIPE AI')}>
      {!maxed && (
        <div className="zb-chat__grip" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={tt('Resize the chat panel', 'تغيير عرض لوحة الشات')}
          title={tt('Drag to resize — double-click to reset', 'اسحب لتغيير العرض — دبل كليك للرجوع للافتراضي')}
          onPointerDown={onGripDown} onKeyDown={onGripKey} onDoubleClick={resetWidth} />
      )}
      <header className="zb-ai__head">
        <span className="zb-ai__ico zb-ai__brandico"><Icon name="sparkles" size={15} /></span>
        <div className="zb-ai__title">
          <strong dir="auto">{view === 'history' ? tt('Conversations', 'المحادثات') : (title || BRAND)}</strong>
          {view === 'chat' && (title ? <span className="zb-ai__file" dir="ltr" style={{ cursor: 'default' }}>{BRAND}{activeLabel ? ` · ${activeLabel}` : ''}</span> : activeLabel && <span className="zb-ai__file" dir="ltr" style={{ cursor: 'default' }}>{activeLabel}</span>)}
        </div>
        {view === 'history'
          ? <button type="button" className="zb-btn zb-ai__back" onClick={() => setView('chat')}><Icon name="arrow-left" size={13} /> <span>{tt('Back', 'رجوع')}</span></button>
          : (
            <>
              <button type="button" className="zb-ibtn" onClick={() => { history.onNew(); setView('chat'); }} title={tt('New chat', 'محادثة جديدة')} aria-label={tt('New chat', 'محادثة جديدة')} disabled={busy || !messages.length}><Icon name="plus" size={16} /></button>
              <button type="button" className="zb-ibtn" onClick={() => setView('history')} title={tt('Conversations', 'المحادثات')} aria-label={tt('Conversations', 'المحادثات')}><Icon name="history" size={16} /></button>
            </>
          )}
        <button type="button" className="zb-ibtn zb-ai__maxbtn" onClick={() => setMaxed((v) => !v)} title={maxed ? tt('Restore size', 'الحجم العادي') : tt('Make wider', 'تكبير اللوحة')} aria-label={maxed ? tt('Restore size', 'الحجم العادي') : tt('Make wider', 'تكبير اللوحة')} aria-pressed={maxed}><Icon name={maxed ? 'collapse' : 'maximize'} size={15} /></button>
        <button type="button" className="zb-ibtn" onClick={onClose} title={tt('Close', 'إغلاق')} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={15} /></button>
      </header>

      {view === 'history' ? (
        <HistoryView tt={tt} h={history} busy={busy} onDone={() => setView('chat')} />
      ) : (
        <>
          {canSwitchMode && (
            <div className="zb-ai__modes" role="tablist" aria-label={tt('Assistant mode', 'وضع المساعد')}>
              {modes.map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} className={`zb-ai__mode${mode === m ? ' is-on' : ''}`} onClick={() => onMode(m)} disabled={busy}>{modeName(m)}</button>
              ))}
            </div>
          )}
          <p className="zb-ai__hint" dir="auto">{modeHint}</p>

          <div className="zb-ai__body" ref={bodyRef} onScroll={onScroll}>
            {messages.length === 0 && (
              <div className="zb-chat__empty">
                <div className="zb-chat__hello"><span className="zb-chat__bigico"><Icon name="sparkles" size={22} /></span><h3 dir="auto">{tt('Hi, I’m UIPE AI', 'أهلًا، أنا UIPE AI')}</h3></div>
                <p dir="auto">{tt('Your coding assistant inside UIPE. I can see the open file, the lines you select and the terminal output.', 'مساعد البرمجة بتاعك جوّه UIPE. شايف الملف المفتوح والسطور اللي بتحددها وناتج الـ terminal.')}</p>
                <p dir="auto" className="zb-chat__tip"><Icon name="paperclip" size={12} /> {tt('Select any part of the code and press “Attach selection” to ask about exactly that part. You can attach several parts.', 'حدّد أي جزء من الكود واضغط «إرفاق التحديد» عشان تسأل عن الجزء ده بالظبط. تقدر ترفق كذا جزء.')}</p>
                {mode === 'assistant' && <p dir="auto">{tt('Try: “create an index.html with a contact form” or “add input validation to this function”.', 'جرّب: «اعمل ملف index.html فيه فورم اتصال» أو «ضيف تحقق من المدخلات للدالة دي».')}</p>}
                <div className="zb-chat__sugg">
                  {suggestions.map((s) => <button key={s} type="button" className="zb-ai__mini" onClick={() => submit(s)} disabled={busy}>{s}</button>)}
                </div>
                {recent.length > 0 && (
                  <div className="zb-chat__recent">
                    <div className="zb-chat__recent-head"><strong>{tt('Recent conversations', 'آخر المحادثات')}</strong><button type="button" className="zb-ai__mini" onClick={() => setView('history')}>{tt('See all', 'عرض الكل')}</button></div>
                    {recent.map((c) => (
                      <button key={c.id} type="button" className="zb-chat__recent-item" onClick={() => history.onOpen(c.id)} disabled={busy}>
                        <span dir="auto">{c.title || tt('New chat', 'محادثة جديدة')}</span><small>{when(c.updated_at, tt)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <Message key={m.id} m={m} prevUser={lastUserBefore(i)} tt={tt} busy={busy} canSwitch={canSwitchMode && modes.includes('assistant')} isLast={i === messages.length - 1} isLastUser={m.id === lastUserId} onGoto={onGoto} onEdit={editLast}
                onApply={onApply} onApplyAll={onApplyAll} onReject={onReject} onOpen={onOpen} onRetry={onRetry} onSwitchAndRetry={onSwitchAndRetry} onNewFile={onNewFile} />
            ))}
          </div>

          <div className="zb-chat__composer">
            {quote && (
              <div className="zb-chat__qchip">
                <Icon name="message" size={13} />
                <span dir="auto">{quote}</span>
                <button type="button" onClick={() => setQuote('')} title={tt('Remove the quote', 'شيل الاقتباس')} aria-label={tt('Remove the quote', 'شيل الاقتباس')}><Icon name="x" size={13} /></button>
              </div>
            )}
            {(refs.length > 0 || liveSel) && (
              <div className="zb-chat__quotes">
                {refs.map((r) => <RefCard key={r.id} r={r} tt={tt} onGoto={onGoto} onRemove={() => onUnpin(r.id)} />)}
                {liveSel && !refs.some((r) => r.path === liveSel.path && r.from === liveSel.from && r.to === liveSel.to) && (
                  <div className="zb-ref-live">
                    <RefCard r={liveSel} tt={tt} live onGoto={onGoto} />
                    <button type="button" className="zb-btn zb-btn--primary" onClick={() => onPin(liveSel)} disabled={refs.length >= 5}><Icon name="paperclip" size={13} /> <span>{tt('Attach selection', 'إرفاق التحديد')}</span></button>
                  </div>
                )}
              </div>
            )}
            {quick.length > 0 && !busy && (
              <div className="zb-chat__quick" role="group" aria-label={tt('Quick actions', 'إجراءات سريعة')}>
                {quick.map((q) => <button key={q} type="button" className="zb-ai__mini" onClick={() => submit(q)}>{q}</button>)}
              </div>
            )}
            {chips.length > 0 && (
              <div className="zb-chat__chips" role="group" aria-label={tt('Context sent with your message', 'السياق اللي بيتبعت مع رسالتك')}>
                {chips.map((c) => (
                  <button key={c.key} type="button" className={`zb-chat__chip${c.on ? ' is-on' : ''}`} onClick={() => onChip(c.key)} aria-pressed={c.on} title={c.on ? tt('Sent with your message — click to turn off', 'بيتبعت مع رسالتك — اضغط لإيقافه') : tt('Not sent — click to include', 'مش بيتبعت — اضغط لتضمينه')}>
                    {c.on && <Icon name="check" size={11} />} <span dir="auto">{c.label}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="zb-chat__row">
              <textarea ref={boxRef} className="zb-chat__input" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} dir="auto" maxLength={6000}
                placeholder={quote ? tt('Ask about the quoted part…', 'اسأل عن الجزء المقتبس…') : refs.length || liveSel ? tt('Ask about this code…', 'اسأل عن الكود ده…') : tt('Ask UIPE AI…  (Enter to send, Shift+Enter for a new line)', 'اسأل UIPE AI…  (Enter للإرسال، Shift+Enter لسطر جديد)')} aria-label={tt('Message', 'الرسالة')} />
              {busy
                ? <button type="button" className="zb-btn zb-btn--primary zb-chat__send" onClick={onStop} title={tt('Stop', 'إيقاف')} aria-label={tt('Stop', 'إيقاف')}><Icon name="stop" size={15} /></button>
                : <button type="button" className="zb-btn zb-btn--primary zb-chat__send" onClick={() => submit()} disabled={!text.trim() && !quote} title={tt('Send', 'إرسال')} aria-label={tt('Send', 'إرسال')}><Icon name="send" size={15} /></button>}
            </div>
            <small className="zb-chat__note">
              {tt('UIPE AI can make mistakes — check the answer before relying on it.', 'UIPE AI ممكن يغلط — راجع الإجابة قبل ما تعتمد عليها.')}
              {saveState === 'saving' && <span className="zb-chat__save"> · {tt('Saving…', 'بيتحفظ…')}</span>}
              {saveState === 'saved' && <span className="zb-chat__save is-ok"> · {tt('Saved', 'اتحفظت')}</span>}
              {saveState === 'error' && <button type="button" className="zb-chat__save is-err" onClick={onRetrySave}> · {tt('Not saved — retry', 'ماتحفظتش — حاول تاني')}</button>}
            </small>
          </div>
        </>
      )}
      {ask && (
        <button type="button" className="zb-ask-float" style={{ left: ask.x, top: ask.y, transform: ask.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}
          onMouseDown={(e) => e.preventDefault()} onClick={takeQuote}>
          <Icon name="message" size={13} /> <span>{tt('Ask about this', 'اسأل عن ده')}</span>
        </button>
      )}
    </aside>
  );
}
