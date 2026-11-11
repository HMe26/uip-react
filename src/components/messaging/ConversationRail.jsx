import Icon from '../Icon';
import MsgIcon from './msgIcons';
import { useEffect, useRef, useState } from 'react';
import { initials, fmtTime, peerLabel, avatarUrl, previewLabel } from './format';
import { systemLine } from './groupText';
import { callLine } from '../../lib/calls/callText';
import { useLanguage } from '../../context/LanguageContext';
import StoriesStrip from './stories/StoriesStrip';

const FILTERS = [
  { key: 'all', label: 'All', ar: 'الكل' },
  { key: 'unread', label: 'Unread', ar: 'غير المقروءة' },
  { key: 'favorite', label: 'Favorites', ar: 'المفضلة' },
  { key: 'pinned', label: 'Pinned', ar: 'المثبّتة' },
  { key: 'group', label: 'Groups', ar: 'المجموعات' },
];

// Stable pastel tone per person (0-4) so each avatar keeps its color.
function toneOf(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 5;
  return h;
}

/**
 * Round avatar. `src` is an avatar_path from the API; when it is missing
 * (no photo, or the person hid it in chat privacy) or fails to load, the
 * initials tile is shown instead.
 */
function Avatar({ name, isGroup, size, src, saved }) {
  const [failed, setFailed] = useState(false);
  const url = !failed ? avatarUrl(src) : null;
  if (saved) {
    // "Saved messages": my own photo when I have one (with a small bookmark badge), otherwise the bookmark tile
    if (url) {
      return (
        <span className={`msg-avatar msg-avatar--saved-photo${size === 'sm' ? ' msg-avatar--sm' : ''}`}>
          <img src={url} alt="" onError={() => setFailed(true)} />
          <span className="msg-avatar__badge" aria-hidden="true"><Icon name="bookmark" size={size === 'sm' ? 8 : 11} /></span>
        </span>
      );
    }
    return (
      <span className={`msg-avatar msg-avatar--saved${size === 'sm' ? ' msg-avatar--sm' : ''}`}>
        <Icon name="bookmark" size={size === 'sm' ? 16 : 22} />
      </span>
    );
  }
  return (
    <span className={`msg-avatar msg-avatar--tone-${toneOf(name)}${isGroup ? ' msg-avatar--group' : ''}${size === 'sm' ? ' msg-avatar--sm' : ''}`}>
      {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}

/** Same filtering rules as filteredConversations() in messaging.js. */
export function filterConversations(conversations, filter, categoryFilter) {
  return conversations.filter((c) => {
    if (filter === 'unread' && !c.is_unread) return false;
    if (filter === 'favorite' && !c.is_favorite) return false;
    if (filter === 'pinned' && !c.is_pinned) return false;
    if (filter === 'group' && !c.is_group) return false;
    if (filter === 'archived' && !c.is_archived) return false;
    if (filter !== 'archived' && c.is_archived) return false;
    if (categoryFilter && c.category !== categoryFilter) return false;
    return true;
  });
}

export default function ConversationRail({
  conversations,
  categories,
  filter,
  setFilter,
  categoryFilter,
  setCategoryFilter,
  activeId,
  onOpen,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  searchResults,
  onOpenSearchResult,
  onNewDirect,
  onNewGroup,
  loading,
  myUserId,
  onDeleteConversations,
  trashCount = 0,
  onOpenSettings,
  initialSelecting = false,
}) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const list = filterConversations(conversations, filter, categoryFilter);

  // Multi-select: pick several chats (or all of them) and delete them in one go.
  const [selecting, setSelecting] = useState(Boolean(initialSelecting));
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  // Touch: long-press a chat to start selecting (replaces the hover delete button on phones).
  const pressRef = useRef({ timer: null, fired: false });
  const startPress = (e, id) => {
    if (selecting || e.pointerType !== 'touch') return;
    pressRef.current.fired = false;
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = setTimeout(() => {
      pressRef.current.fired = true;
      setSelecting(true);
      setSelected(new Set([id]));
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
    }, 480);
  };
  const cancelPress = () => clearTimeout(pressRef.current.timer);
  const unreadChats = conversations.filter((c) => c.is_unread && !c.is_archived).length;
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };
  // Chats that disappear (deleted elsewhere / filtered away) drop out of the selection.
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(list.map((c) => c.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, filter, categoryFilter]);
  const allSelected = list.length > 0 && selected.size === list.length;
  const toggleSel = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const runDelete = async (ids, all) => {
    if (!onDeleteConversations) return;
    setBusy(true);
    try {
      if (await onDeleteConversations(ids, all)) exitSelect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="msg-rail" data-msg-rail>
      <header className="mr-head">
        <div className="mr-head__row">
          <h2 className="mr-title">{t('Messages', 'الرسائل')}</h2>
          <div className="mr-head__actions">
            <button type="button" className="mr-new" onClick={onNewDirect}>
              <Icon name="plus" size={16} />
              <span>{t('New chat', 'محادثة جديدة')}</span>
            </button>
            {onNewGroup && (
              <button type="button" className="mr-iconbtn" aria-label={t('New group', 'مجموعة جديدة')} title={t('New group', 'مجموعة جديدة')} onClick={onNewGroup}>
                <Icon name="users" size={18} />
              </button>
            )}
            {onOpenSettings && (
              <button type="button" className="mr-iconbtn mr-settings" aria-label={t('Chat settings', 'إعدادات الشات')} title={t('Chat settings', 'إعدادات الشات')} onClick={onOpenSettings}>
                <Icon name="settings" size={18} />
                {trashCount > 0 && <i className="mr-dot" />}
              </button>
            )}
          </div>
        </div>

        <label className="mr-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            data-inbox-search
            placeholder={t('Search chats and messages', 'ابحث في المحادثات والرسائل')}
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(e.target.value.trim() !== ''); }}
          />
          {searchQuery && (
            <button type="button" className="mr-search__clear" aria-label={t('Clear search', 'مسح البحث')} onClick={() => { setSearchQuery(''); setSearchOpen(false); }}>
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
      </header>

      {!(searchOpen && searchQuery) && !selecting && <StoriesStrip />}

      {searchOpen && searchQuery && (
        <div className="msg-search-results" data-search-results>
          {searchResults.length === 0 ? (
            <div className="msg-empty-state">{t('No messages found.', 'لا توجد رسائل مطابقة.')}</div>
          ) : (
            searchResults.slice(0, 25).map((m) => (
              <button
                type="button"
                className="msg-conv"
                key={m.id}
                onClick={() => onOpenSearchResult(m)}
              >
                <Avatar name={m.sender_name} />
                <span className="msg-conv__meta">
                  <span className="msg-conv__row1">
                    <span className="msg-conv__name">{m.sender_name}</span>
                    <span className="msg-conv__time">{fmtTime(m.created_at)}</span>
                  </span>
                  <span className="msg-conv__preview">{(m.body || '').slice(0, 90)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {selecting && (
        <div className="msg-select-bar" role="toolbar" aria-label={t('Selection actions', 'إجراءات التحديد')}>
          <label className="msg-check">
            <input type="checkbox" checked={allSelected} disabled={list.length === 0} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((c) => c.id)))} />
            <span>{selected.size ? t(`${selected.size} selected`, `تم تحديد ${selected.size}`) : t('Select all', 'تحديد الكل')}</span>
          </label>
          <span className="msg-select-bar__spacer" />
          {selected.size > 0 ? (
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => runDelete([...selected], false)}>
              <Icon name="trash" size={14} /> {t(`Delete (${selected.size})`, `حذف (${selected.size})`)}
            </button>
          ) : (
            <button type="button" className="btn btn-danger btn-sm" disabled={busy || conversations.length === 0} onClick={() => runDelete([], true)}>
              <Icon name="trash" size={14} /> {t('Delete all chats', 'حذف كل المحادثات')}
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={exitSelect}>{t('Cancel', 'إلغاء')}</button>
        </div>
      )}

      <div className="mr-filters" data-filter-tabs role="tablist" aria-label={t('Filter chats', 'تصفية المحادثات')}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`mr-filter${filter === f.key ? ' is-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            <span>{t(f.label, f.ar)}</span>
            {f.key === 'unread' && unreadChats > 0 && <b>{unreadChats > 99 ? '99+' : unreadChats}</b>}
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="msg-rail__categories" data-category-chips>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`msg-chip${categoryFilter === c ? ' is-active' : ''}`}
              onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="msg-rail__list" data-conversation-list>
        {loading ? (
          <div className="msg-skeleton-list" data-conversation-skeleton>
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="msg-skeleton-row" key={i}>
                <span className="msg-skeleton-avatar" />
                <span className="msg-skeleton-lines">
                  <i />
                  <i />
                </span>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="msg-empty-state">{t('No conversations here yet.', 'لا توجد محادثات هنا بعد.')}</div>
        ) : (
          list.map((c) => {
            const badges = [];
            if (c.is_pinned) badges.push(<span className="msg-conv__pin" key="pin"><MsgIcon name="pin" size={12} /></span>);
            if (c.is_muted)
              badges.push(
                <span className="msg-mini-icon" key="mute">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                </span>
              );
            if (c.is_unread) {
              const n = Number(c.unread_count || 0);
              badges.push(n > 0
                ? <span className="msg-unread-count" key="unread">{n > 99 ? '99+' : n}</span>
                : <span className="msg-unread-dot" key="unread" />);
            }
            const isSel = selected.has(c.id);
            return (
              <div className={`msg-conv-row${isSel ? ' is-selected' : ''}`} key={c.id}>
                <button
                  type="button"
                  title={c.peer_email || undefined}
                  className={`msg-conv${c.is_unread ? ' is-unread' : ''}${String(c.id) === String(activeId) && !selecting ? ' is-active' : ''}${c.peer_deleted ? ' is-deleted' : ''}`}
                  aria-pressed={selecting ? isSel : undefined}
                  onPointerDown={(e) => startPress(e, c.id)}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onPointerMove={cancelPress}
                  onContextMenu={(e) => { if (pressRef.current.fired || e.pointerType === 'touch') e.preventDefault(); }}
                  onClick={() => {
                    if (pressRef.current.fired) { pressRef.current.fired = false; return; }
                    if (selecting) toggleSel(c.id); else onOpen(c.id);
                  }}
                >
                  {selecting && <span className="msg-check msg-check--box"><input type="checkbox" tabIndex={-1} readOnly checked={isSel} /></span>}
                  <Avatar name={peerLabel(c)} isGroup={c.is_group} saved={c.is_saved} src={c.is_saved ? c.saved_avatar : (c.is_group ? c.group_avatar : (c.peer_deleted ? null : c.peer_avatar))} />
                  <span className="msg-conv__meta">
                    <span className="msg-conv__row1">
                      <span className="msg-conv__name">{peerLabel(c)}{c.peer_deleted && <em className="msg-conv__deleted">{t('Deleted account', 'حساب محذوف')}</em>}</span>
                      <span className="msg-conv__time">{fmtTime(c.time)}</span>
                    </span>
                    <span className="msg-conv__row2">
                      <span className={`msg-conv__preview${!c.preview && c.preview_kind ? ' is-media' : ''}`}>{(c.preview_type === 'system' && c.preview_meta ? systemLine(c.preview_meta, myUserId) : c.preview_type === 'call' && c.preview_meta ? callLine(c.preview_meta, myUserId, locale === 'ar').text : previewLabel(c, locale)) || t('No messages yet', 'لا توجد رسائل بعد')}</span>
                      <span className="msg-conv__badges">{badges}</span>
                    </span>
                  </span>
                </button>
                {onDeleteConversations && !selecting && (
                  <button
                    type="button"
                    className="msg-conv__del"
                    title={t('Delete chat (kept 30 days in Trash)', 'حذف المحادثة (تبقى 30 يومًا في المحذوفات)')}
                    aria-label={t('Delete chat', 'حذف المحادثة')}
                    onClick={() => onDeleteConversations([c.id], false)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

export { Avatar };
