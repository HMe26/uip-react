import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';
import AttachMenu from '../../messaging/AttachMenu';
import CameraCaptureModal from '../../messaging/CameraCaptureModal';
import MediaEditorModal, { isEditableMedia } from '../../messaging/MediaEditorModal';
import MeetingFilePreview, { fileKind, fileIcon, formatSize, sameOriginUrl } from './MeetingFilePreview';

const translations = { ...i18nCommon, ...i18nMeetings };

const QUICK_REACTIONS = ['👍', '❤️', '😂', '👏', '🎉'];
const GROUP_WINDOW_MS = 3 * 60 * 1000; // consecutive messages from one person within 3 minutes share one name/avatar

const AVATAR_HUES = [231, 262, 291, 330, 12, 32, 152, 188, 205];
function avatarColor(name) {
  let h = 0;
  const s = String(name || '?');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 28) % 360} 70% 46%))`;
}

/**
 * Round 5 (Live Collaboration) — بند 7 (Meeting Chat)، بند 8 (Private Chat). Slide-in panel, mounted alongside the video grid in
 * MeetingRoomShell (not a modal — the call keeps running behind it).
 *
 * Layout: messages are grouped per sender (one name + avatar per run, a time on the last bubble of the run), system lines are
 * centred chips, the quick-reaction bar appears on hover / focus (always visible on touch screens), and the composer is a
 * single rounded field (Enter sends, Shift+Enter adds a line) with the "who sees this" choice shown as a chip above it.
 * Everything uses logical properties and `dir="auto"` on message text, so Arabic and English messages both align correctly
 * whichever language the room is in.
 *
 * `recipientOptions` is the roster (local + remote) the "Everyone / private to X" selector is built from — sourced from the
 * same `tiles` list MeetingRoomShell already derives for the video grid, not fetched separately here.
 *
 * Reactions here reuse chat's own toggleReaction (بند 7 "Message reactions") — a completely different mechanism from بند 11's
 * ephemeral ParticipantReactionSent floaters (see useMeetingRoom's sendReaction) — these are *attached to a specific message*
 * and persist in history.
 */
export default function ChatPanel({
  messages, unreadCount, enabled, myKey, recipientOptions, isOpen, onClose, onSend, onReact, onMarkRead,
  isManager = false, chatHistory = 'keep', iAmMuted = false,
  onDelete = null, onSetEnabled = null, onSetHistory = null, onClear = null,
}) {
  const t = useTranslations(translations);
  const [body, setBody] = useState('');
  const [recipientKey, setRecipientKey] = useState('');
  const [sendError, setSendError] = useState(null);
  const [sending, setSending] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [picked, setPicked] = useState(null); // file waiting to be sent with the next message
  const [previewFile, setPreviewFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // message waiting for "Delete for everyone?" confirmation
  const [deletingId, setDeletingId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false); // host / co-host chat controls popover
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyControl, setBusyControl] = useState(false);
  const [pickedUrl, setPickedUrl] = useState(null);
  const [editFile, setEditFile] = useState(null); // image / video open in the media editor (same editor as the platform chat)
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef(null);
  const mediaInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stickRef = useRef(true); // true while the reader is at (or near) the bottom — only then do new messages auto-scroll

  useEffect(() => {
    if (isOpen) onMarkRead?.();
  }, [isOpen, messages.length, onMarkRead]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    stickRef.current = true;
    setShowJump(false);
  }, []);

  // opening the panel -> straight to the newest message
  useLayoutEffect(() => {
    if (isOpen) scrollToBottom(false);
  }, [isOpen, scrollToBottom]);

  // new message: follow it if the reader was at the bottom (or it is mine), otherwise offer a "new messages" jump chip
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!isOpen || !lastMessage) return;
    if (stickRef.current || lastMessage?.sender_key === myKey) scrollToBottom(true);
    else setShowJump(true);
  }, [isOpen, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // grow the composer with its text (up to ~5 lines)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [body, isOpen]);

  // thumbnail of the picked image
  useEffect(() => {
    if (!picked || !picked.type?.startsWith('image/')) { setPickedUrl(null); return undefined; }
    const url = URL.createObjectURL(picked);
    setPickedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picked]);

  if (!isOpen) return null;

  const nameFor = (key) => recipientOptions.find((p) => p.key === key)?.displayName || key;
  const locale = t.locale === 'ar' ? 'ar-EG' : 'en-US';
  const timeOf = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  };

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stickRef.current = atBottom;
    if (atBottom) setShowJump(false);
  }

  function pickFile(file, { edit = true } = {}) {
    if (!file) return;
    setSendError(null);
    // images and videos go through the media editor first (crop / filters / text / subtitles / noise reduction), like the platform chat
    if (edit && isEditableMedia(file)) { setEditFile(file); return; }
    setPicked(file);
    inputRef.current?.focus();
  }

  function handlePaste(e) {
    const f = Array.from(e.clipboardData?.files || [])[0];
    if (f) { e.preventDefault(); pickFile(f); }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    pickFile(Array.from(e.dataTransfer?.files || [])[0]);
  }

  async function submit(overrideBody = null, overrideFile = null) {
    const text = overrideBody !== null ? overrideBody : body;
    const file = overrideFile || picked;
    if ((!text.trim() && !file) || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(text, { recipientKey: recipientKey || null, file: file || null });
      setBody('');
      setPicked(null);
      stickRef.current = true;
    } catch (err) {
      setSendError(err?.message || t('Could not send this message.'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    submit();
  }

  async function confirmDelete(id) {
    if (!onDelete || deletingId) return;
    setDeletingId(id);
    setSendError(null);
    try {
      await onDelete(id);
    } catch (err) {
      setSendError(err?.message || t('Could not delete this message.'));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function control(action) {
    if (busyControl) return;
    setBusyControl(true);
    setSendError(null);
    try {
      await action();
    } catch (err) {
      setSendError(err?.message || t('This action could not be completed.'));
    } finally {
      setBusyControl(false);
    }
  }

  function handleKeyDown(e) {
    // Enter sends, Shift+Enter = new line; never while an IME (Arabic/CJK keyboards) is still composing a word
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  // decide, per message, whether it starts a new run (shows name + avatar) and whether it ends one (shows the time)
  const sameRun = (a, b) => a && b && a.type !== 'system' && b.type !== 'system'
    && a.sender_key === b.sender_key && !!a.is_private === !!b.is_private
    && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < GROUP_WINDOW_MS;
  // Live emoji reactions are floating effects only — they are NOT written into the chat. (Reactions on a message stay on it.)
  const timeline = messages;
  const sharedFiles = messages.filter((m) => m.attachment && m.attachment.download_url).map((m) => m.attachment);
  const dayKey = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toDateString(); };
  const dayLabel = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    if (d.toDateString() === today.toDateString()) return t('Today');
    if (d.toDateString() === yesterday.toDateString()) return t('Yesterday');
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  };
  const rows = timeline.map((m, i) => {
    const special = m.type === 'system';
    return {
      m, isSystem: special,
      newDay: i === 0 || dayKey(timeline[i - 1].created_at) !== dayKey(m.created_at),
      first: !special && !sameRun(timeline[i - 1], m), last: !special && !sameRun(m, timeline[i + 1]),
    };
  });

  return (
    <div
      className={`meeting-chat-panel ${dragOver ? 'is-dragover' : ''}`}
      onDragOver={(e) => { if (enabled && Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={enabled ? handleDrop : undefined}
    >
      {dragOver && <div className="meeting-chat-panel__drop"><Icon name="upload" size={22} /> {t('Drop a file to share it')}</div>}
      <div className="meeting-chat-panel__header">
        <span className="meeting-chat-panel__header-ico" aria-hidden="true"><Icon name="message-square" size={16} /></span>
        <strong>{t('Chat')}</strong>
        {unreadCount > 0 && <span className="badge badge-primary">{unreadCount}</span>}
        {isManager && (
          <button
            type="button"
            className={`meeting-room__control-btn mc-ctl-btn ${settingsOpen ? 'is-on' : ''}`}
            style={{ marginInlineStart: 'auto' }}
            onClick={() => { setSettingsOpen((o) => !o); setConfirmClear(false); }}
            title={t('Chat controls')}
            aria-label={t('Chat controls')}
            aria-expanded={settingsOpen}
          >
            <Icon name="settings" size={16} />
          </button>
        )}
        <button type="button" className="meeting-room__control-btn" style={isManager ? undefined : { marginInlineStart: 'auto' }} onClick={onClose} title={t('Close')} aria-label={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {isManager && settingsOpen && (
        <div className="mc-ctl" role="group" aria-label={t('Chat controls')}>
          <label className="mc-ctl__row">
            <span><strong>{t('Allow chat')}</strong><em>{t('Turn it off to stop everyone from posting.')}</em></span>
            <input type="checkbox" checked={!!enabled} disabled={busyControl} onChange={(e) => control(() => onSetEnabled(e.target.checked))} />
          </label>
          <div className="mc-ctl__row mc-ctl__row--col">
            <span><strong>{t('Earlier messages for people who join later')}</strong></span>
            <div className="mc-ctl__seg" role="radiogroup" aria-label={t('Earlier messages for people who join later')}>
              <button type="button" role="radio" aria-checked={chatHistory !== 'hide'} className={chatHistory !== 'hide' ? 'is-on' : ''} disabled={busyControl} onClick={() => chatHistory === 'hide' && control(() => onSetHistory('keep'))}>
                <Icon name="eye" size={13} /> {t('Keep visible')}
              </button>
              <button type="button" role="radio" aria-checked={chatHistory === 'hide'} className={chatHistory === 'hide' ? 'is-on' : ''} disabled={busyControl} onClick={() => chatHistory !== 'hide' && control(() => onSetHistory('hide'))}>
                <Icon name="eye-off" size={13} /> {t('Hide')}
              </button>
            </div>
          </div>
          <div className="mc-ctl__row">
            {confirmClear ? (
              <>
                <span><strong>{t('Clear the chat for everyone?')}</strong></span>
                <span className="mc-ctl__btns">
                  <button type="button" onClick={() => setConfirmClear(false)}>{t('Cancel')}</button>
                  <button type="button" className="is-danger" disabled={busyControl} onClick={() => control(async () => { await onClear(); setConfirmClear(false); })}>{t('Clear')}</button>
                </span>
              </>
            ) : (
              <button type="button" className="mc-ctl__clear" onClick={() => setConfirmClear(true)}>
                <Icon name="trash" size={14} /> {t('Clear chat for everyone')}
              </button>
            )}
          </div>
        </div>
      )}

      {chatHistory === 'hide' && (
        <p className="mc-note"><Icon name="eye-off" size={12} /> {isManager ? t('Earlier messages are hidden from people who join later.') : t('You only see messages sent after you joined.')}</p>
      )}

      <div className="meeting-chat-panel__list" ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="meeting-chat-panel__empty">
            <span className="meeting-chat-panel__empty-ico"><Icon name="message-square" size={26} /></span>
            <p>{t('No messages yet — say hello.')}</p>
          </div>
        )}

        {rows.map(({ m, isSystem, first, last, newDay }) => {
          const day = newDay && dayLabel(m.created_at)
            ? <div className="meeting-chat-day"><span>{dayLabel(m.created_at)}</span></div>
            : null;
          if (isSystem) {
            return (
              <Fragment key={m.id}>
                {day}
                <div className="meeting-chat-sys">
                  <span dir="auto">{m.body}</span>
                  {isManager && onDelete && (
                    <button type="button" className="mc-del mc-del--sys" onClick={() => confirmDelete(m.id)} disabled={deletingId === m.id} title={t('Delete')} aria-label={t('Delete')}>
                      <Icon name="x" size={11} />
                    </button>
                  )}
                </div>
              </Fragment>
            );
          }
          const mine = m.sender_key === myKey;
          const canDelete = !!onDelete && (mine || (isManager && !m.is_private));
          const cls = ['meeting-chat-msg', mine ? 'is-mine' : '', first ? 'is-first' : '', last ? 'is-last' : '', m.is_private ? 'is-private' : ''].filter(Boolean).join(' ');
          return (
            <Fragment key={m.id}>
            {day}
            <div className={cls}>
              {!mine && (
                <span className="meeting-chat-msg__avatar" style={first ? { background: avatarColor(m.sender_display_name) } : undefined} aria-hidden="true">
                  {first ? ((m.sender_display_name || '?').trim().charAt(0).toUpperCase() || '?') : ''}
                </span>
              )}
              <div className="meeting-chat-msg__col">
                {first && (
                  <div className="meeting-chat-msg__meta">
                    <span className="meeting-chat-msg__name">{mine ? t('You') : m.sender_display_name}</span>
                    {m.is_private && (
                      <span className="meeting-chat-msg__private">
                        <Icon name="lock" size={10} />
                        {mine ? `${t('Private to')} ${nameFor(m.recipient_key)}` : t('Private message')}
                      </span>
                    )}
                  </div>
                )}

                <div className="meeting-chat-msg__bubble-wrap" tabIndex={-1}>
                  {(m.body || !m.attachment) && <div className="meeting-chat-msg__body" dir="auto">{m.body}</div>}
                  {m.attachment && <ChatAttachment file={m.attachment} onOpen={() => setPreviewFile(m.attachment)} t={t} />}
                  <div className="meeting-chat-msg__quick-react" role="group" aria-label={t('React')}>
                    {QUICK_REACTIONS.map((emoji) => (
                      <button key={emoji} type="button" onClick={(e) => { onReact(m.id, emoji); e.currentTarget.blur(); }} title={t('React')}>{emoji}</button>
                    ))}
                    {canDelete && (
                      <button type="button" className="mc-del" onClick={(e) => { setConfirmDeleteId(m.id); e.currentTarget.blur(); }} title={mine ? t('Delete for everyone') : t('Delete this message (moderator)')} aria-label={t('Delete for everyone')}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {confirmDeleteId === m.id && (
                  <div className="mc-confirm" role="alertdialog" aria-label={t('Delete for everyone?')}>
                    <span>{t('Delete for everyone?')}</span>
                    <button type="button" onClick={() => setConfirmDeleteId(null)} disabled={deletingId === m.id}>{t('Cancel')}</button>
                    <button type="button" className="is-danger" onClick={() => confirmDelete(m.id)} disabled={deletingId === m.id}>{deletingId === m.id ? '…' : t('Delete')}</button>
                  </div>
                )}

                {m.reactions.length > 0 && (
                  <div className="meeting-chat-msg__reactions">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={`meeting-chat-msg__reaction ${r.actor_keys.includes(myKey) ? 'is-mine' : ''}`}
                        onClick={() => onReact(m.id, r.emoji)}
                      >
                        {r.emoji} <span>{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                {last && <span className="meeting-chat-msg__time">{timeOf(m.created_at)}</span>}
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>

      {showJump && (
        <button type="button" className="meeting-chat-panel__jump" onClick={() => scrollToBottom(true)}>
          <Icon name="arrow-down" size={14} /> {t('New messages')}
        </button>
      )}

      {sendError && !(enabled && !(iAmMuted && !isManager)) && <p className="form-error meeting-chat-panel__error" style={{ margin: '0 12px 8px' }}>{sendError}</p>}

      {enabled && iAmMuted && !isManager ? (
        <p className="meeting-chat-panel__disabled">
          <Icon name="lock" size={13} /> {t('The host has turned off your chat.')}
        </p>
      ) : enabled ? (
        <form className="meeting-chat-panel__compose" onSubmit={handleSubmit}>
          {sendError && <p className="form-error meeting-chat-panel__error">{sendError}</p>}

          {recipientOptions.length > 0 && (
            <RecipientPicker t={t} value={recipientKey} onChange={setRecipientKey} options={recipientOptions} />
          )}

          {picked && (
            <div className="meeting-chat-panel__picked">
              {pickedUrl ? <img src={pickedUrl} alt="" /> : <span className="meeting-chat-panel__picked-ico"><Icon name={fileIcon({ name: picked.name, mime_type: picked.type })} size={18} /></span>}
              <span className="meeting-chat-panel__picked-name" dir="auto" title={picked.name}>{picked.name}<em>{formatSize(picked.size)}</em></span>
              {isEditableMedia(picked) && (
                <button type="button" onClick={() => setEditFile(picked)} title={t('Edit')} aria-label={t('Edit')}><Icon name="edit" size={14} /></button>
              )}
              <button type="button" onClick={() => setPicked(null)} title={t('Remove')} aria-label={t('Remove')}><Icon name="x" size={14} /></button>
            </div>
          )}

          <div className="meeting-chat-panel__field">
            <input ref={fileInputRef} type="file" hidden onChange={(e) => { pickFile(e.target.files && e.target.files[0], { edit: false }); e.target.value = ''; }} />
            <input ref={mediaInputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { pickFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            <input ref={cameraInputRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { pickFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            <AttachMenu
              ar={t.locale === 'ar'}
              title={t('Attach a file')}
              canFiles
              canMedia
              onPickFiles={() => fileInputRef.current?.click()}
              onPickMedia={() => mediaInputRef.current?.click()}
              onPickCamera={() => {
                if (navigator.mediaDevices?.getUserMedia) setShowCamera(true);
                else cameraInputRef.current?.click();
              }}
            />
            <textarea
              ref={inputRef}
              rows={1}
              dir="auto"
              placeholder={recipientKey ? `${t('Private message to')} ${nameFor(recipientKey)}…` : t('Type a message…')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              maxLength={4000}
            />
            <button type="submit" className="meeting-chat-panel__send" disabled={sending || (!body.trim() && !picked)} title={t('Send')} aria-label={t('Send')}>
              <Icon name="send" size={16} />
            </button>
          </div>
        </form>
      ) : (
        <p className="meeting-chat-panel__disabled">
          <Icon name="lock" size={13} /> {t('Chat is disabled for this meeting.')}
        </p>
      )}

      {showCamera && (
        <CameraCaptureModal
          ar={t.locale === 'ar'}
          onClose={() => setShowCamera(false)}
          onCapture={(file) => { setShowCamera(false); pickFile(file); }}
        />
      )}

      {editFile && (
        <MediaEditorModal
          key={`${editFile.name}-${editFile.size}-${editFile.lastModified}`}
          file={editFile}
          initialCaption={body}
          onCancel={() => setEditFile(null)}
          onDone={(f, cap) => { setPicked(f); setBody(cap || ''); setEditFile(null); inputRef.current?.focus(); }}
          onSend={(f, cap) => { setEditFile(null); submit(cap || '', f); }}
        />
      )}

      {previewFile && <MeetingFilePreview file={previewFile} files={sharedFiles} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}

/** "To: Everyone ⌄" — a dark popover (the browser's own <select> list opened as a white box over the dark room). */
function RecipientPicker({ t, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  // two people with the same display name get a "(2)" so they can be told apart
  const seen = {};
  const list = options.map((p) => {
    const n = (seen[p.displayName] = (seen[p.displayName] || 0) + 1);
    return { ...p, label: p.displayName, n };
  });
  const dupes = list.filter((p) => list.filter((q) => q.label === p.label).length > 1);
  const labelOf = (p) => (dupes.includes(p) ? `${p.label} (${p.n})` : p.label);
  const current = list.find((p) => p.key === value);
  const pick = (k) => { onChange(k); setOpen(false); };

  return (
    <div className={`mc-to ${value ? 'is-private' : ''}`} ref={wrap}>
      <button type="button" className="mc-to__btn" aria-haspopup="listbox" aria-expanded={open} aria-label={t('To')} onClick={() => setOpen((o) => !o)}>
        <Icon name={value ? 'lock' : 'users'} size={14} />
        <span className="mc-to__lbl">{t('To')}</span>
        <strong dir="auto">{current ? labelOf(current) : t('Everyone')}</strong>
        <Icon name="chevron-up" size={14} />
      </button>
      {value && <em>{t('Only they will see this')}</em>}
      {open && (
        <ul className="mc-to__menu" role="listbox">
          <li>
            <button type="button" role="option" aria-selected={!value} className={!value ? 'is-on' : ''} onClick={() => pick('')}>
              <span className="mc-to__av mc-to__av--all"><Icon name="users" size={14} /></span>
              <span className="mc-to__name">{t('Everyone')}</span>
              {!value && <Icon name="check" size={16} />}
            </button>
          </li>
          {list.map((p) => (
            <li key={p.key}>
              <button type="button" role="option" aria-selected={value === p.key} className={value === p.key ? 'is-on' : ''} onClick={() => pick(p.key)}>
                <span className="mc-to__av" style={{ background: avatarColor(p.displayName) }}>{(p.displayName || '?').trim().charAt(0).toUpperCase() || '?'}</span>
                <span className="mc-to__name" dir="auto">{labelOf(p)}</span>
                <small><Icon name="lock" size={11} /> {t('Private')}</small>
                {value === p.key && <Icon name="check" size={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const extBadge = (file) => {
  const ext = (file?.extension || (/\.([a-z0-9]+)$/i.exec(file?.original_name || '') || [])[1] || '').toLowerCase();
  return ext ? <b className="meeting-chat-att__ext">{ext.slice(0, 4)}</b> : <Icon name={fileIcon(file)} size={20} />;
};

/** A file shared in the chat: images / video / audio show inline, everything else is a file card. Click opens the full preview. */
function ChatAttachment({ file, onOpen, t }) {
  const kind = fileKind(file);
  const url = sameOriginUrl(file.download_url);
  const name = file.original_name || 'file';
  if (kind === 'image') {
    return (
      <button type="button" className="meeting-chat-att is-image" onClick={onOpen} title={name}>
        <img src={url} alt={name} loading="lazy" />
      </button>
    );
  }
  if (kind === 'video') {
    return (
      <button type="button" className="meeting-chat-att is-image is-video" onClick={onOpen} title={name}>
        <video src={url} preload="metadata" muted playsInline />
        <span className="meeting-chat-att__play"><Icon name="play" size={28} /></span>
      </button>
    );
  }
  return (
    <div className="meeting-chat-att is-file">
      <button type="button" className="meeting-chat-att__main" onClick={onOpen} title={t('Preview')}>
        <span className="meeting-chat-att__ico" aria-hidden="true">{extBadge(file)}</span>
        <span className="meeting-chat-att__name" dir="auto">{name}<em>{formatSize(file.size_bytes)}</em></span>
      </button>
      <a className="meeting-chat-att__dl" href={url} download={name} title={t('Download')} aria-label={t('Download')}><Icon name="download" size={16} /></a>
    </div>
  );
}
