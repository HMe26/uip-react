import { useBackLayer } from '../lib/backStack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, reportClientIssue } from '../api/client';
import { onRealtime } from '../lib/realtime';
import { useAuth } from '../context/AuthContext';
import ConversationRail from '../components/messaging/ConversationRail';
import ConfirmDialog from '../components/messaging/ConfirmDialog';
import ThreadPanel from '../components/messaging/ThreadPanel';
import InfoPanel from '../components/messaging/InfoPanel';
import InfoResizer, { INFO_W_KEY, INFO_W_DEFAULT, RAIL_W_KEY, readInfoWidth, readRailWidth } from '../components/messaging/InfoResizer';
import { useCustomWallpapers, isCustomWall, customWallId } from '../lib/customWallpapers';
import { useWallStyle, wallStyleVars } from '../lib/wallStyle';
import { useChatSettings, wallFor } from '../lib/chatSettings';
import GroupSettingsModal from '../components/messaging/GroupSettingsModal';
import { PinDurationModal, PinnedMessagesModal } from '../components/messaging/PinnedUi';
import { localizeError } from '../components/messaging/groupText';
import {
  NewDirectModal,
  NewGroupModal,
  AddMemberModal,
  ForwardModal,
  BulkDeleteModal,
  PollModal,
  VideoViewer,
  Lightbox,
} from '../components/messaging/modals';
import { ReportModal } from '../components/messaging/SafetyModals';
import { fmtTime } from '../components/messaging/format';
import { parseServerDate } from '../utils/serverDate';
import { useLanguage } from '../context/LanguageContext';
import { getPortalBrand, pick } from '../config/portalBrand';
import { usePageMeta } from '../context/PageMetaContext';
import { playSound } from '../lib/notificationSound';
import { startShare, stopShare, resumeShares } from '../lib/liveLocation';
import { applyChatStyle } from '../lib/chatStyle';
import { uploadChunked, forgetUpload, CHUNKED_MIN_BYTES } from '../lib/chunkedUpload';
import { needsShrink, shrinkImages } from '../lib/shrinkImage';
import { autoSaveAvailable, autoSaveMessages, isAutoSaveOn, setAutoSaveOn } from '../lib/autoSaveMedia';

/**
 * React port of public/assets/js/messaging.js + app/Views/messaging/app.php.
 * THE single messaging UI for every portal — there is exactly one backend
 * API (/api/v1/messaging/*, App\Controllers\Common\MessagingController) and
 * this is its one React client, mounted at every role's `/*\/messages` route
 * (see navConfig.js's COMMON_ACCOUNT_ITEMS + App.jsx) instead of being
 * duplicated per portal.
 *
 * No WebSocket server on the current deployment, so new messages/typing/
 * presence are delivered by short-interval polling — same cadence as the
 * old JS (config/messaging.php's poll_interval_ms, default 4000ms):
 *   - pollActiveConversation: every pollMs
 *   - heartbeat: every pollMs * 2
 *   - loadInbox: every pollMs * 3
 *
 * Bugfix carried over from the earlier backend/API audit: the *old*
 * messaging.js read res.messages / res.typing straight off the poll
 * response, but MessagingController wraps every response as
 * {success, data: {...}} via its safe() helper — so this reads
 * res.data.messages / res.data.typing instead (the old JS's poll silently
 * never delivered live messages because of this).
 *
 * Voice recording, message forwarding, poll creation, and lightbox
 * zoom/rotate/navigation are all wired (ported from startRecording()/
 * stopRecording(), openForwardModal(), openPollModal(), and
 * openLightbox()/renderLightbox() in the old messaging.js) — along with
 * everything else (send/edit/delete, attachments, reactions, pins,
 * mentions, groups, presence, typing, search, categories,
 * favorite/mute/archive, poll voting).
 *
 * The composer has the WhatsApp-style picker: emoji, GIF (Giphy through the API) and stickers (personal library +
 * "New sticker" maker). Text, stickers and GIFs are sent optimistically: the bubble appears instantly and is settled by
 * the response (or marked failed with Retry).
 */

const BASE = '/api/v1/messaging';

// The open chat survives a page refresh: remembered per browser tab (sessionStorage) and per account, and
// forgotten as soon as the person goes back to the list or leaves the Messages page.
const OPEN_KEY = 'uip.msg.open';
const readOpen = (uid) => {
  try {
    const o = JSON.parse(sessionStorage.getItem(OPEN_KEY) || 'null');
    return o && o.c && String(o.u) === String(uid) ? o.c : null;
  } catch { return null; }
};
const writeOpen = (uid, id) => { try { sessionStorage.setItem(OPEN_KEY, JSON.stringify({ u: uid, c: id })); } catch { /* not remembered */ } };
const clearOpen = () => { try { sessionStorage.removeItem(OPEN_KEY); } catch { /* nothing to clear */ } };
const POLL_MS = 2500;

function conversationsEqual(oldList, newList) {
  return JSON.stringify(oldList) === JSON.stringify(newList);
}

const isTmp = (id) => String(id).startsWith('tmp-');
/** A message cancelled with "Cancel" (undo send) leaves no tombstone at all, unlike "delete for everyone". */
const isUnsent = (m) => !!m.is_deleted && m.deleted_reason === 'unsent';
/** Highest server-assigned message id (ignores optimistic "uploading" bubbles). */
const lastRealId = (list, fallback = 0) => {
  for (let i = list.length - 1; i >= 0; i -= 1) if (!isTmp(list[i].id)) return list[i].id;
  return fallback;
};
const kindOfFile = (f) => {
  const t = f.type || '';
  if (/^voice-message-/i.test(f.name || '')) return 'audio'; // recorded voice notes are .webm but are audio
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'file';
};
const RAIL_KEY = 'uip_msg_rail_collapsed';
const INFO_KEY = 'uip_msg_info_open';
const WALL_KEY = 'uip_msg_wallpaper';
const WALL_ANIM_KEY = 'uip_msg_wallpaper_anim'; // animated wallpaper: off unless the person turns it on
const WIDE_INFO_MIN = 1480; // from this width the details panel is a real column, below it an overlay
const WALLPAPERS = ['dots', 'aurora', 'lagoon', 'forest', 'rose', 'amber', 'graphite', 'midnight'];
const WALL_LEGACY = { sunset: 'rose', night: 'midnight', mint: 'forest' }; // themes saved by the previous version keep working
const readInfoPref = () => {
  try {
    const v = localStorage.getItem(INFO_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage unavailable */ }
  return typeof window !== 'undefined' && window.innerWidth >= WIDE_INFO_MIN;
};
const readWall = () => {
  try {
    const raw = localStorage.getItem(WALL_KEY);
    const v = WALL_LEGACY[raw] || raw;
    if (isCustomWall(v)) return v; // the person's own photo (kept in this browser's library)
    return WALLPAPERS.includes(v) ? v : 'dots';
  } catch { return 'dots'; }
};
const readWallAnim = () => {
  try { return localStorage.getItem(WALL_ANIM_KEY) === '1'; } catch { return false; }
};
const readRailPref = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

export default function Messages() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const brand = getPortalBrand(user?.role);

  // Student-style header for EVERY portal: the title + subtitle live in the
  // topbar (see Topbar.jsx), so the page itself is just the chat card.
  // No in-page header at all: the page is just the chat card (title/subtitle
  // come from usePageMeta above, nav label is the fallback).
  usePageMeta(locale === 'ar' ? 'الرسائل' : 'Messages', pick(brand.messages, locale));

  const [conversations, setConversations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [filter, setFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Deep link: /{role}/messages/:conversationId (used by notification "View").
  const { conversationId: routeConversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const restoreIdRef = useRef(routeConversationId ? null : readOpen(user?.id)); // chat that was open before a refresh
  const [activeId, setActiveId] = useState(null);
  const [activeConversation, setActiveConversation] = useState(null);
  const [activeOthers, setActiveOthers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [presenceText, setPresenceText] = useState('');

  const [replyTarget, setReplyTarget] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);

  // Details panel: remembered across visits (and across conversations) so the chat can stay as wide as the user likes.
  const [infoOpen, setInfoOpen] = useState(readInfoPref);
  const rememberInfo = useCallback((next) => {
    setInfoOpen(next);
    try { localStorage.setItem(INFO_KEY, next ? '1' : '0'); } catch { /* not remembered */ }
  }, []);
  const toggleInfo = useCallback(() => {
    setInfoOpen((o) => {
      const next = !o;
      try { localStorage.setItem(INFO_KEY, next ? '1' : '0'); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  // Details panel width: the user drags the panel's inner edge; remembered per browser.
  const appRef = useRef(null);
  const [infoW, setInfoW] = useState(() => readInfoWidth() || INFO_W_DEFAULT);
  const onInfoWidth = useCallback((w, persist) => {
    setInfoW(w);
    if (persist) { try { localStorage.setItem(INFO_W_KEY, String(w)); } catch { /* not remembered */ } }
  }, []);
  // Conversation list width: null = the responsive CSS default until the user drags it.
  const [railW, setRailW] = useState(readRailWidth);
  const onRailWidth = useCallback((w, persist) => {
    setRailW(w);
    if (persist) { try { w == null ? localStorage.removeItem(RAIL_W_KEY) : localStorage.setItem(RAIL_W_KEY, String(w)); } catch { /* not remembered */ } }
  }, []);
  // Chat settings (account-wide, enforced by the server): wallpapers, sounds, enter-to-send, text size…
  const { settings: chatSettings, loaded: settingsLoaded, patch: patchSettings } = useChatSettings();
  // Chat wallpaper: this chat's own background if it has one, else the account default. Until the account's settings
  // arrive, the last default is shown from this browser so the chat doesn't flash the classic look.
  const localWall = useMemo(readWall, []);
  const defaultWall = settingsLoaded ? chatSettings.wallpaper.default : localWall;
  const ownWall = settingsLoaded && activeId != null ? chatSettings.wallpaper.per_chat[String(activeId)] || '' : '';
  const wall = ownWall || defaultWall;
  useEffect(() => { // keep a local copy of the default for the next first paint
    if (!settingsLoaded) return;
    try { localStorage.setItem(WALL_KEY, chatSettings.wallpaper.default); } catch { /* not remembered */ }
  }, [settingsLoaded, chatSettings.wallpaper.default]);
  // One-time move of the background this browser used before the settings lived on the account.
  const wallMigrated = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || wallMigrated.current) return;
    wallMigrated.current = true;
    if (chatSettings.initialized) return;
    const anim = readWallAnim();
    if (localWall !== 'dots' || anim) patchSettings({ wallpaper: { default: localWall, anim } }).catch(() => {});
  }, [settingsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // Picking in the details panel changes THIS chat only; "use default" removes its own background.
  const onWall = useCallback((id) => {
    if (activeId == null) return;
    patchSettings({ wallpaper: { per_chat: { [activeId]: id } } }).catch(() => {});
  }, [activeId, patchSettings]);
  const onWallUseDefault = useCallback(() => onWall(null), [onWall]);
  // The person's own photos: stay in the library until deleted, whichever theme is selected.
  const wallpapers = useCustomWallpapers();
  const customWallUrl = wallpapers.urlFor(wall);
  const customWallStyle = useWallStyle(customWallId(wall));
  const shownWall = isCustomWall(wall) ? (customWallUrl ? 'custom' : 'dots') : wall; // photo missing on this device -> default look (the saved choice is kept)
  const addCustomWall = useCallback(async (file, style) => { const id = await wallpapers.add(file, style); onWall(`img:${id}`); }, [wallpapers, onWall]);
  const removeCustomWall = useCallback(async (id) => {
    await wallpapers.remove(id);
    // every place that used the deleted photo falls back (default -> classic, chats -> default)
    const patch = {};
    if (chatSettings.wallpaper.default === `img:${id}`) patch.default = 'dots';
    const per = {};
    Object.entries(chatSettings.wallpaper.per_chat).forEach(([cid, w]) => { if (w === `img:${id}`) per[cid] = null; });
    if (Object.keys(per).length) patch.per_chat = per;
    if (Object.keys(patch).length) patchSettings({ wallpaper: patch }).catch(() => {});
  }, [wallpapers, chatSettings.wallpaper, patchSettings]);
  // arrived from "Select & delete chats" in the settings page: the rail already started selecting, drop the one-shot flag
  useEffect(() => {
    if (location.state?.selectChats) navigate(location.pathname, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Android app only: save media/files other people send to the phone (Pictures/Movies/Documents > UIPE).
  const [autoSave, setAutoSave] = useState(isAutoSaveOn);
  const onAutoSave = useCallback((on) => { setAutoSaveOn(on); setAutoSave(on); }, []);
  const wallAnim = settingsLoaded ? chatSettings.wallpaper.anim : readWallAnim();
  const onWallAnim = useCallback((on) => {
    try { localStorage.setItem(WALL_ANIM_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
    patchSettings({ wallpaper: { anim: on } }).catch(() => {});
  }, [patchSettings]);
  // Chat sounds follow the account setting (a ref: the inbox/thread pollers are long-lived callbacks).
  const soundsRef = useRef(true);
  soundsRef.current = chatSettings.sounds !== false;
  // Desktop only: hide the conversation list to give the thread the full width.
  const [railCollapsed, setRailCollapsed] = useState(readRailPref);
  const toggleRail = useCallback(() => {
    setRailCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — preference just isn't remembered */
      }
      return next;
    });
  }, []);
  // Full platform: the messenger covers the sidebar + top bar (like the AI assistant's full-screen mode).
  const [fullView, setFullView] = useState(() => { try { return localStorage.getItem('uip.msg.full') === '1'; } catch { return false; } });
  const toggleFull = useCallback(() => {
    setFullView((f) => {
      const next = !f;
      try { localStorage.setItem('uip.msg.full', next ? '1' : '0'); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  useEffect(() => {
    if (!fullView) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-overlay, .msg-lightbox')) toggleFull(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullView, toggleFull]);
  const [modal, setModal] = useState(null); // 'newDirect' | 'newGroup' | 'addMember' | 'pinned' | 'forward' | 'poll' | 'groupSettings'
  const [groupTab, setGroupTab] = useState('info');
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [videoView, setVideoView] = useState(null); // { src, poster, name }
  const [forwardMessageId, setForwardMessageId] = useState(null); // array of message ids
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const lastPollIdRef = useRef(0);
  // id of the conversation whose first page has finished loading. Polling waits for it: before that lastPollIdRef still holds
  // the PREVIOUS chat's id (or 0), so a poll would return the whole history as "new" messages and ring once per message.
  const threadReadyRef = useRef(null);
  // server clock echoed back as `changes_since` so the poll also reports older messages that were deleted / unsent / edited
  const pollClockRef = useRef(null);
  const activeIdRef = useRef(null);
  const typingTimerRef = useRef(null);

  useEffect(() => {
    activeIdRef.current = activeId;
    setSelectMode(false);
    setSelectedIds([]);
  }, [activeId]);

  useEffect(() => {
    if (activeId) writeOpen(user?.id, activeId);
  }, [activeId, user?.id]);

  // leaving the Messages page (not a refresh: a refresh never runs this) forgets the open chat
  useEffect(() => () => clearOpen(), []);

  // messaging-app.css locks .app-shell to the viewport height via this
  // body class (see its "Bugfix (2026-08-08)" comment — :has() isn't
  // supported everywhere) — the PHP view set it server-side; here it's
  // toggled for the lifetime of this page instead.
  useEffect(() => {
    document.body.classList.add('msg-page-active');
    return () => document.body.classList.remove('msg-page-active');
  }, []);

  // Mobile: while a thread is open the page chrome (title + bottom nav) is
  // hidden so the thread + composer get the whole screen (see messaging-mobile.css).
  useEffect(() => {
    document.body.classList.toggle('msg-thread-open', Boolean(activeId));
    return () => document.body.classList.remove('msg-thread-open');
  }, [activeId]);

  // Mobile browsers resize the visible area as the address / bottom bars slide in and out (and when the keyboard opens). Feed the real
  // visible height to the CSS so the open chat always fills exactly what the user sees (see messaging-mobile.css).
  useEffect(() => {
    if (!activeId) return undefined;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty('--vvh', `${Math.round(h)}px`);
      root.style.setProperty('--vvt', `${Math.round(vv ? vv.offsetTop : 0)}px`);
    };
    apply();
    if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      if (vv) { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); }
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvt');
    };
  }, [activeId]);

  const onBack = useCallback(() => {
    // Drop /:conversationId from the URL so re-opening the same link
    // (e.g. from a notification) works again.
    if (routeConversationId) navigate(location.pathname.replace(/\/\d+\/?$/, ''), { replace: true });
    clearOpen();
    setActiveId(null);
    setActiveConversation(null);
    setMessages([]);
    setReplyTarget(null);
    setInfoOpen(false);
  }, [routeConversationId, navigate, location.pathname]);

  // Phone: an opened thread is a full-screen layer; Back returns to the conversation list.
  useBackLayer(Boolean(activeId) && !routeConversationId, onBack, window.matchMedia('(max-width: 900px)').matches);
  // The details panel is a full overlay below the wide-screen breakpoint: Back closes it and returns to the chat.
  useBackLayer(infoOpen && Boolean(activeConversation), () => setInfoOpen(false), window.innerWidth < WIDE_INFO_MIN);

  const showError = (err) => {
    console.error(err);
    // No toast system ported yet — surface inline via a simple alert-free
    // fallback so failures aren't silent.
    setLastError(localizeError(err?.message) || (ar ? 'حدث خطأ ما.' : 'Something went wrong.'));
  };
  const [lastError, setLastError] = useState('');
  useEffect(() => {
    if (!lastError) return;
    const h = setTimeout(() => setLastError(''), 4000);
    return () => clearTimeout(h);
  }, [lastError]);

  // ------------------------------------------------------------- inbox
  const unreadSeenRef = useRef(null); // conversation id -> unread count (null until first load)
  const loadInbox = useCallback(async (q) => {
    try {
      const res = await api.get(BASE + '/inbox', q ? { q } : undefined);
      // Sound when another conversation (not the open one, not muted) got new unread messages.
      if (!q && Array.isArray(res.data)) {
        const next = {};
        let ring = false;
        res.data.forEach((c) => {
          const n = Number(c.unread_count || (c.is_unread ? 1 : 0));
          next[c.id] = n;
          const before = unreadSeenRef.current?.[c.id] ?? 0;
          if (unreadSeenRef.current && n > before && !c.is_muted && String(c.id) !== String(activeIdRef.current)) ring = true;
        });
        unreadSeenRef.current = next;
        if (ring && soundsRef.current) playSound('message');
      }
      setConversations((prev) => (conversationsEqual(prev, res.data) ? prev : res.data));
    } catch (err) {
      showError(err);
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  const loadInboxRef = useRef(null);
  useEffect(() => {
    loadInboxRef.current = loadInbox;
  }, [loadInbox]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.get(BASE + '/categories');
      setCategories(res.data || []);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    loadInbox();
    loadCategories();
  }, [loadInbox, loadCategories]);

  // Inbox refresh poll (pollMs * 3) — skipped while the rail search is
  // showing live results for a query, same as the original.
  useEffect(() => {
    const h = setInterval(() => {
      if (!searchOpen || !searchQuery) loadInbox();
    }, POLL_MS * 3);
    return () => clearInterval(h);
  }, [loadInbox, searchOpen, searchQuery]);

  // Rail search (conversations/messages), debounced.
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const h = setTimeout(async () => {
      try {
        const res = await api.get(BASE + '/search', { q: searchQuery.trim() });
        setSearchResults(res.data || []);
      } catch (err) {
        showError(err);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [searchOpen, searchQuery]);

  // ------------------------------------------------------------- thread
  const refreshPresence = useCallback(async (userIds) => {
    if (!userIds.length) return;
    try {
      const res = await api.post(BASE + '/presence/lookup', { user_ids: userIds });
      const p = res.data?.[userIds[0]];
      if (p) {
        setPresenceText(p.is_online ? (ar ? 'متصل' : 'Online') : p.last_seen_at ? `${ar ? 'آخر ظهور' : 'Last seen'} ${fmtTime(p.last_seen_at)}` : (ar ? 'غير متصل' : 'Offline'));
      } else {
        setPresenceText(''); // the person hides their last seen from me: show no status at all
      }
    } catch {
      /* non-critical */
    }
  }, []);

  const markConversationSeenLocally = (id) => {
    setConversations((prev) => prev.map((c) => (String(c.id) === String(id) ? { ...c, is_unread: false } : c)));
  };

  const loadThread = useCallback(async (id, beforeId, isInitial) => {
    try {
      const res = await api.get(BASE + '/conversations/' + id, beforeId ? { before_id: beforeId } : undefined);
      const conversation = res.data?.conversation;
      const others = res.data?.others || [];
      setActiveConversation(conversation);
      setActiveOthers(others);
      const batch = res.data?.messages || [];
      // the user already moved on to another chat while this page was loading: drop it
      if (!beforeId && String(activeIdRef.current) !== String(id)) return;
      if (!beforeId) pollClockRef.current = null;
      setMessages((prev) => {
        const next = beforeId ? [...batch, ...prev] : batch;
        lastPollIdRef.current = lastRealId(next, 0);
        return next;
      });
      if (!beforeId) threadReadyRef.current = id;
      setHasMoreOlder(beforeId ? batch.length > 0 : batch.length >= 50);
      if (!beforeId) autoSaveMessages(batch);

      if (isInitial) {
        api.post(BASE + '/conversations/' + id + '/read').catch(() => {});
        markConversationSeenLocally(id);
        api
          .get(BASE + '/conversations/' + id + '/pinned')
          .then((r) => setPinnedMessages(r.data || []))
          .catch(() => {});
        if (conversation && !conversation.is_group && others?.[0]) {
          setPresenceText(ar ? 'جارٍ تحميل الحالة…' : 'Loading status…');
          refreshPresence([others[0].id]);
        }
      }
    } catch (err) {
      showError(err);
      // the remembered chat is gone / not ours any more: fall back to the list instead of an empty thread
      if (isInitial && (err?.status === 403 || err?.status === 404)) {
        clearOpen();
        if (String(activeIdRef.current) === String(id)) {
          setActiveId(null);
          setActiveConversation(null);
          setMessages([]);
        }
      }
    }
  }, [refreshPresence]);

  const openConversation = useCallback((id) => {
    activeIdRef.current = id;
    threadReadyRef.current = null;
    lastPollIdRef.current = 0;
    pollClockRef.current = null;
    setActiveId(id);
    setActiveConversation(null);
    setMessages([]);
    setReplyTarget(null);
    // As an overlay (narrow screens) the panel closes when you switch chats; as a column it stays.
    if (window.innerWidth < WIDE_INFO_MIN) setInfoOpen(false);
    setPresenceText('');
    loadThread(id, null, true);
  }, [loadThread]);

  useEffect(() => {
    if (routeConversationId && String(routeConversationId) !== String(activeIdRef.current)) {
      openConversation(routeConversationId);
    }
  }, [routeConversationId, openConversation]);

  // After a refresh: reopen the chat that was open (a /:conversationId link in the URL wins over it).
  useEffect(() => {
    const id = restoreIdRef.current;
    if (!id || routeConversationId) return;
    restoreIdRef.current = null;
    openConversation(id);
  }, [routeConversationId, openConversation]);

  const onOpenSearchResult = (m) => {
    setSearchOpen(false);
    setSearchQuery('');
    openConversation(m.conversation_id);
  };

  const onLoadOlder = () => {
    if (!activeId || !messages.length) return;
    loadThread(activeId, messages[0].id, false);
  };

  // Active-conversation poll (new messages + typing).
  useEffect(() => {
    let busy = false;
    let again = false;
    const runPoll = () => {
      const id = activeIdRef.current;
      if (!id || document.hidden) return;
      if (String(threadReadyRef.current) !== String(id)) return; // first page not loaded yet: nothing to diff against
      // never two polls at once (they share since_id / the server clock); a ping that lands meanwhile re-polls right after
      if (busy) { again = true; return; }
      busy = true;
      const sinceSent = lastPollIdRef.current;
      api
        .get(BASE + '/conversations/' + id + '/poll', { since_id: sinceSent, ...(pollClockRef.current ? { changes_since: pollClockRef.current } : {}) })
        .then((res) => {
          if (String(activeIdRef.current) !== String(id) || String(threadReadyRef.current) !== String(id)) return;
          if (lastPollIdRef.current !== sinceSent) {
            // the thread was reloaded while this poll was in flight: its delta is stale (would replay old messages + sound)
            return;
          }
          if (res.data?.server_time) pollClockRef.current = res.data.server_time;
          const changed = res.data?.updated || [];
          if (changed.length) {
            // a message of the other person was deleted for everyone / cancelled / edited: replace it in place
            setMessages((prev) => {
              const gone = new Set(changed.filter(isUnsent).map((c) => String(c.id)));
              const byId = new Map(changed.map((c) => [String(c.id), c]));
              return prev.filter((m) => !gone.has(String(m.id))).map((m) => (byId.has(String(m.id)) ? { ...m, ...byId.get(String(m.id)) } : m));
            });
          }
          // reactions added / removed by the other side (compared by content so nothing re-renders when unchanged)
          const rx = res.data?.reactions;
          if (rx && Object.keys(rx).length) {
            setMessages((prev) => {
              let any = false;
              const next = prev.map((m) => {
                const cur = rx[m.id];
                if (!cur || isTmp(m.id)) return m;
                const key = (arr) => JSON.stringify((arr || []).map((r) => [r.emoji, r.count, (r.users || []).map((u) => u.id)]));
                if (key(cur) === key(m.reactions)) return m;
                any = true;
                return { ...m, reactions: cur };
              });
              return any ? next : prev;
            });
          }
          // votes cast by other people: refresh bars / counts / my vote (compared by content)
          const pl = res.data?.polls;
          if (pl && Object.keys(pl).length) {
            setMessages((prev) => {
              let any = false;
              const next = prev.map((m) => {
                const cur = pl[m.id];
                if (!cur || m.message_type !== 'poll' || isTmp(m.id)) return m;
                const same = JSON.stringify(cur.pollResults) === JSON.stringify(m.pollResults || {})
                  && (cur.myVote ?? null) === (m.myVote ?? null) && cur.pollTotal === m.pollTotal;
                if (same) return m;
                any = true;
                return { ...m, pollResults: cur.pollResults, pollTotal: cur.pollTotal, myVote: cur.myVote ?? null };
              });
              return any ? next : prev;
            });
          }
          const newMsgs = res.data?.messages || [];
          // a group event (settings changed, someone added/removed, you were made admin...): refresh the group block
          if (newMsgs.some((m) => m.message_type === 'system')) {
            api.get(BASE + '/conversations/' + id).then((r) => {
              if (String(activeIdRef.current) !== String(id) || !r.data) return;
              setActiveConversation(r.data.conversation);
              setActiveOthers(r.data.others || []);
            }).catch(() => {});
          }
          if (newMsgs.length) {
            autoSaveMessages(newMsgs);
            if (soundsRef.current && newMsgs.some((m) => !m.is_mine && !isTmp(m.id))) playSound('message');
            setMessages((prev) => {
              const byId = new Map(prev.map((m) => [String(m.id), m]));
              newMsgs.forEach((m) => byId.set(String(m.id), m));
              const merged = Array.from(byId.values());
              lastPollIdRef.current = lastRealId(merged, lastPollIdRef.current);
              return merged;
            });
            api.post(BASE + '/conversations/' + id + '/read').catch(() => {});
          }
          // ✓ / ✓✓ updates for my own messages (delivered / read by the other side)
          const rc = res.data?.receipts;
          if (rc && Object.keys(rc).length) {
            setMessages((prev) => {
              let changedAny = false;
              const next = prev.map((m) => {
                const st = m.is_mine ? rc[m.id] : null;
                if (st && m.receipt_status !== st) { changedAny = true; return { ...m, receipt_status: st }; }
                return m;
              });
              return changedAny ? next : prev;
            });
          }
          setTypingUsers(res.data?.typing || []);
        })
        .catch((err) => {
          // removed from the group (or it was deleted) while the chat was open: close it instead of polling forever
          // only a real "not found" means removed — any other 422 (e.g. a server/DB error) must not close the chat
          if (err?.status === 422 && /not found/i.test(err?.message || '') && String(activeIdRef.current) === String(id)) {
            activeIdRef.current = null;
            setActiveId(null);
            setActiveConversation(null);
            setMessages([]);
            setInfoOpen(false);
            loadInboxRef.current?.();
            setLastError(localizeError('Conversation not found.'));
          }
        })
        .finally(() => {
          busy = false;
          if (again) { again = false; runPoll(); }
        });
    };
    const h = setInterval(runPoll, POLL_MS); // safety net only — the socket below delivers in ~100 ms

    // Realtime (Reverb): the server pings every member of the conversation the moment anything changes in it
    // (new message, edit, delete, reaction, read receipt, poll vote, typing…); we fetch the delta immediately.
    let typingClear = null;
    let inboxTimer = null;
    const offRt = onRealtime('messaging', (d, topic) => {
      const cid = d?.conversation_id;
      if (topic === 'resync' || (cid && String(cid) === String(activeIdRef.current))) runPoll();
      if (d?.kind === 'typing' && cid && String(cid) === String(activeIdRef.current)) {
        // the typing flag expires on the server (~6 s) and "stopped typing" sends no ping: look again shortly after
        clearTimeout(typingClear);
        typingClear = setTimeout(runPoll, 4200);
      }
      if (d?.kind !== 'typing') {
        clearTimeout(inboxTimer);
        inboxTimer = setTimeout(() => loadInboxRef.current?.(), 80);
      }
    });
    return () => { clearInterval(h); offRt(); clearTimeout(typingClear); clearTimeout(inboxTimer); };
  }, []);

  // Presence heartbeat.
  useEffect(() => {
    const h = setInterval(() => {
      api.post(BASE + '/presence/heartbeat').catch(() => {});
    }, POLL_MS * 2);
    return () => clearInterval(h);
  }, []);

  const onNotifyTyping = useCallback(() => {
    if (!activeId) return;
    clearTimeout(typingTimerRef.current);
    api.post(BASE + '/presence/typing', { conversation_id: activeId }).catch(() => {});
    typingTimerRef.current = setTimeout(() => {
      api.post(BASE + '/presence/typing', { conversation_id: null }).catch(() => {});
    }, 3000);
  }, [activeId]);

  // ------------------------------------------------------------- composer
  const onAddFiles = (fileList) => {
    const files = Array.from(fileList).map((file) => ({
      file,
      // images AND videos get a local preview URL (tray thumbnail + editor)
      previewUrl: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null,
    }));
    setPendingFiles((prev) => [...prev, ...files]);
  };
  const onRemoveFile = (i) =>
    setPendingFiles((prev) => {
      const gone = prev[i];
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
  // Per-file "remove background noise" choice (audio / video only) — the server cleans the file after it is uploaded.
  const onToggleDenoise = (i) =>
    setPendingFiles((prev) => prev.map((pf, idx) => (idx === i ? { ...pf, denoise: !pf.denoise } : pf)));
  // The media editor (crop / draw / trim) hands back a new File for the same slot.
  const onReplaceFile = (i, file) =>
    setPendingFiles((prev) =>
      prev.map((pf, idx) => {
        if (idx !== i) return pf;
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
        if (pf.file?.uipView && file.uipView === undefined) file.uipView = pf.file.uipView; // view-once / timer survives editing
        return { file, denoise: !!pf.denoise, previewUrl: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null };
      })
    );

  // Messages with attachments show up immediately as an "uploading" bubble
  // (local preview + progress ring) and are swapped for the real message when
  // the server answers. Failed ones stay with Retry / Remove.
  const uploadsRef = useRef({}); // tmpId -> { convId, body, files, parentId }

  const patchTmp = (tmpId, patch) =>
    setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...m, ...patch } : m)));

  // ---- instant sends (text, stickers, GIFs): the bubble shows up immediately, the request settles it afterwards.
  const mkTmp = (extra) => ({
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    is_tmp: true,
    conversation_id: activeId,
    body: null,
    message_type: 'text',
    sender_id: user?.id,
    sender_name: user?.full_name || (ar ? 'أنت' : 'You'),
    is_mine: true,
    created_at: new Date().toISOString(),
    attachments: [],
    parent_message_id: null,
    reactions: [],
    mentions: [],
    ...extra,
  });
  const settleTmp = (tmpId, convId, real) => {
    if (String(activeIdRef.current) === String(convId)) {
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== tmpId);
        return without.some((m) => String(m.id) === String(real.id)) ? without : [...without, real];
      });
    }
    lastPollIdRef.current = Math.max(Number(lastPollIdRef.current) || 0, Number(real.id) || 0);
    loadInbox();
  };
  const runSend = async (tmpId) => {
    const job = uploadsRef.current[tmpId];
    if (!job?.send) return;
    patchTmp(tmpId, { failed: false, is_tmp: true, upload_error: null });
    try {
      const data = await job.send();
      delete uploadsRef.current[tmpId];
      settleTmp(tmpId, job.convId, { ...data, _sentAt: Date.now() });
    } catch (err) {
      patchTmp(tmpId, { failed: true, upload_error: err?.message || (ar ? 'تعذّر الإرسال.' : 'Could not send.') });
    }
  };
  const queueSend = (extra, send) => {
    const tmp = mkTmp(extra);
    uploadsRef.current[tmp.id] = { convId: activeId, send };
    setMessages((prev) => [...prev, tmp]);
    runSend(tmp.id);
  };

  const runUpload = async (tmpId) => {
    const job = uploadsRef.current[tmpId];
    if (!job) return;
    if (job.send) { runSend(tmpId); return; }
    // Photos are shrunk once, right before the first upload attempt (lib/shrinkImage.js); Retry reuses the result.
    if (!job.shrunk) {
      job.shrunk = true;
      if (job.files.some(needsShrink)) { try { job.files = await shrinkImages(job.files); } catch { /* send the originals */ } }
      if (!uploadsRef.current[tmpId]) return; // cancelled while shrinking
    }
    const { convId, body, files, parentId, denoise } = job;
    // Big files (> 4 MB) go up in 3 MB pieces first (lib/chunkedUpload.js), then the message is sent with their ids; small ones
    // stay in the normal request. The message lists the small files first, then the big ones (denoise[] follows that order).
    const isBig = (f) => (f?.size || 0) > CHUNKED_MIN_BYTES;
    const idx = files.map((_, i) => i);
    const smallIdx = idx.filter((i) => !isBig(files[i]));
    const bigIdx = idx.filter((i) => isBig(files[i]));
    const bigBytes = bigIdx.reduce((n, i) => n + files[i].size, 0);
    const allBytes = files.reduce((n, f) => n + (f.size || 0), 0) || 1;
    const bigShare = bigBytes / allBytes;
    const fd = new FormData();
    fd.append('body', body || '');
    if (parentId) fd.append('parent_message_id', parentId);
    smallIdx.forEach((i) => fd.append('attachments[]', files[i], files[i].name));
    const order = [...smallIdx, ...bigIdx];
    if (denoise && denoise.some(Boolean)) order.forEach((i) => fd.append('denoise[]', denoise[i] ? '1' : '0'));
    // view once / timer (camera shots): same order as the files; the server only honours it for photos and videos
    if (order.some((i) => files[i]?.uipView)) {
      order.forEach((i) => { const v = files[i]?.uipView; fd.append('view_mode[]', v ? v.mode : ''); fd.append('view_seconds[]', v?.seconds ? String(v.seconds) : ''); });
    }
    patchTmp(tmpId, { pending: true, failed: false, upload_progress: 0, upload_error: null });
    let lastPct = -1;
    const ctrl = new AbortController();
    job.ctrl = ctrl;
    try {
      if (bigIdx.length) {
        // big files go up two at a time (each one already sends 3 pieces at once); ids are appended in file order afterwards
        job.uploadedIds = job.uploadedIds || {};
        const sent = {};
        bigIdx.forEach((i) => { sent[i] = job.uploadedIds[i] ? files[i].size : 0; });
        const report = () => {
          const total = Object.values(sent).reduce((n, b) => n + b, 0);
          const pct = Math.min(99, Math.round((total / allBytes) * 100));
          if (pct !== lastPct) { lastPct = pct; patchTmp(tmpId, { upload_progress: pct }); }
        };
        let cursor = 0;
        let failure = null;
        const worker = async () => {
          while (!failure && cursor < bigIdx.length) {
            const i = bigIdx[cursor]; cursor += 1;
            if (job.uploadedIds[i]) continue;
            try {
              job.uploadedIds[i] = await uploadChunked(files[i], { base: BASE, signal: ctrl.signal, onProgress: (b) => { sent[i] = b; report(); } });
              sent[i] = files[i].size;
              report();
            } catch (e) { failure = failure || e; }
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, bigIdx.length) }, worker));
        if (failure) throw failure;
        bigIdx.forEach((i) => fd.append('uploaded_ids[]', job.uploadedIds[i]));
      }
      const res = await api.postFormProgress(BASE + '/conversations/' + convId + '/messages', fd, (pct) => {
        const shown = bigIdx.length ? Math.min(99, Math.round(bigShare * 100 + (pct * (1 - bigShare)))) : pct;
        if (shown === lastPct) return;
        lastPct = shown;
        patchTmp(tmpId, { upload_progress: shown });
      }, ctrl.signal);
      if (bigIdx.length) bigIdx.forEach((i) => forgetUpload(files[i]));
      const real = { ...res.data, _sentAt: Date.now() };
      if (real?.noise_reduction && real.noise_reduction.applied < real.noise_reduction.requested) {
        const why = {
          ffmpeg_missing: ['ffmpeg مش متثبت على السيرفر', 'ffmpeg is not installed on the server'],
          exec_disabled: ['دالة exec متقفلة في إعدادات PHP على السيرفر', 'PHP exec() is disabled on the server'],
          unsupported_format: ['صيغة الملف مش مدعومة لعزل الضوضاء', 'this file format is not supported for noise reduction'],
          timeout: ['المعالجة أخدت وقت أطول من المسموح', 'processing took too long'],
          filter_failed: ['فلتر ffmpeg فشل في معالجة الملف', 'the ffmpeg filter failed on this file'],
        }[real.noise_reduction.reason];
        showError(new Error(ar
          ? 'اتبعتت الرسالة، لكن عزل الضوضاء ماتطبّقش فاتبعت الملف الأصلي' + (why ? ' (' + why[0] + ')' : '') + '.'
          : 'Message sent, but noise reduction could not be applied, so the original file was sent' + (why ? ' (' + why[1] + ')' : '') + '.'));
      }
      (job.previews || []).forEach((u) => URL.revokeObjectURL(u));
      delete uploadsRef.current[tmpId];
      if (String(activeIdRef.current) === String(convId)) {
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== tmpId);
          return without.some((m) => String(m.id) === String(real.id)) ? without : [...without, real];
        });
        lastPollIdRef.current = Math.max(Number(lastPollIdRef.current) || 0, Number(real.id) || 0);
      }
      loadInbox();
    } catch (err) {
      if (ctrl.signal.aborted) return; // cancelled by the user: onCancelUpload already removed the bubble
      reportClientIssue('message_upload_failed', {
        path: BASE + '/conversations/' + convId + '/messages', status: err?.status || 0, message: err?.message || 'Upload failed',
        bytes: (job.files || []).reduce((n, f) => n + (f?.size || 0), 0),
        meta: { files: (job.files || []).map((f) => ({ name: f?.name, type: f?.type, size: f?.size })) },
      });
      patchTmp(tmpId, { pending: false, failed: true, upload_error: err?.message || (ar ? 'فشل الرفع.' : 'Upload failed.') });
    }
  };

  const sendWithFiles = ({ body, files, parentId, denoise }) => {
    const convId = activeId;
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const previews = [];
    const attachments = files.map((f) => {
      const url = URL.createObjectURL(f);
      previews.push(url);
      return { kind: kindOfFile(f), url, original_name: f.name, size_bytes: f.size, local: true };
    });
    uploadsRef.current[tmpId] = { convId, body, files, parentId, previews, denoise };
    setMessages((prev) => [
      ...prev,
      {
        id: tmpId,
        pending: true,
        upload_progress: 0,
        conversation_id: convId,
        body: body || null,
        message_type: 'text',
        sender_id: user?.id,
        sender_name: user?.full_name || (ar ? 'أنت' : 'You'),
        is_mine: true,
        created_at: new Date().toISOString(),
        attachments,
        parent_message_id: parentId || null,
        parent_body: replyTarget?.body || null,
        parent_sender_name: replyTarget?.sender_name || null,
        reactions: [],
        mentions: [],
      },
    ]);
    runUpload(tmpId);
  };

  const onRetryUpload = (tmpId) => runUpload(tmpId);
  // "Cancel" while a file is still uploading: abort the request and drop the bubble.
  const onCancelUpload = (tmpId) => {
    uploadsRef.current[tmpId]?.ctrl?.abort();
    onDiscardUpload(tmpId);
  };
  const onDiscardUpload = (tmpId) => {
    (uploadsRef.current[tmpId]?.previews || []).forEach((u) => URL.revokeObjectURL(u));
    delete uploadsRef.current[tmpId];
    setMessages((prev) => prev.filter((m) => m.id !== tmpId));
  };

  // `filesOverride` lets the media editor's "Send" button send the freshly
  // edited file immediately (state updates from onReplaceFile wouldn't be
  // visible in this render's closure yet).
  const onSend = async (body, filesOverride) => {
    if (!activeId) return;
    const files = filesOverride || pendingFiles.map((pf) => pf.file);
    const parentId = replyTarget ? replyTarget.id : null;
    if (files.length) {
      // sendWithFiles reads replyTarget from this render's closure (for the
      // quote preview), so call it before/independently of the state resets.
      sendWithFiles({ body, files, parentId, denoise: pendingFiles.map((pf) => !!pf.denoise) });
      const stale = pendingFiles.map((pf) => pf.previewUrl).filter(Boolean);
      setPendingFiles([]);
      setTimeout(() => stale.forEach((u) => URL.revokeObjectURL(u)), 1500);
      setReplyTarget(null);
      return;
    }
    const convId = activeId;
    const parent = replyTarget;
    setReplyTarget(null);
    queueSend(
      { body, parent_message_id: parent ? parent.id : null, parent_body: parent?.body || null, parent_sender_name: parent?.sender_name || null },
      async () => {
        const fd = new FormData();
        fd.append('body', body);
        if (parent) fd.append('parent_message_id', parent.id);
        return (await api.postForm(BASE + '/conversations/' + convId + '/messages', fd)).data;
      },
    );
  };

  // Stickers: from my library (sticker_id), a received/favourite one (attachment_id) or a freshly made file.
  const onSendSticker = (st) => {
    if (!activeId || !st) return;
    const convId = activeId;
    queueSend({ message_type: 'sticker', metadata: { url: st.url, kind: st.kind } }, async () => {
      const fd = new FormData();
      if (st.file) fd.append('sticker', st.file, st.file.name);
      else if (st.libId) fd.append('sticker_id', String(st.libId));
      else if (st.attId) fd.append('attachment_id', String(st.attId));
      return (await api.postForm(BASE + '/conversations/' + convId + '/sticker-message', fd)).data;
    });
  };
  const onSendGif = (g) => {
    if (!activeId || !g?.url) return;
    const convId = activeId;
    queueSend({ message_type: 'gif', metadata: { url: g.url, title: g.title || '' } }, async () => (
      (await api.post(BASE + '/conversations/' + convId + '/gif-message', { url: g.url, title: g.title || '', preview: g.preview || '' })).data
    ));
  };

  const onEditMessage = async (id, body) => {
    try {
      const res = await api.post(BASE + '/messages/' + id + '/edit', { body });
      setMessages((prev) => prev.map((m) => (m.id === id ? res.data : m)));
    } catch (err) {
      showError(err);
    }
  };

  const onRenameSaved = async (name) => {
    if (!activeId) return;
    try {
      const res = await api.post(BASE + '/conversations/' + activeId + '/saved-name', { name });
      const subject = res.data?.subject || null;
      const patch = { subject: subject || 'Saved Messages', saved_default_name: !subject };
      setConversations((prev) => prev.map((c) => (String(c.id) === String(activeId) ? { ...c, ...patch } : c)));
      setActiveConversation((c) => (c ? { ...c, ...patch } : c));
    } catch (err) {
      showError(err);
    }
  };

  // my photo changed from the saved-messages panel (null = removed): keep the rail, the header and the panel in sync
  const onSavedAvatar = (path) => {
    setConversations((prev) => prev.map((c) => (c.is_saved ? { ...c, saved_avatar: path } : c)));
    setActiveConversation((c) => (c && c.is_saved ? { ...c, me: { ...(c.me || {}), avatar_path: path } } : c));
  };

  const onDeleteMessage = async (id, mode) => {
    try {
      if (mode === 'for-everyone') await api.del(BASE + '/messages/' + id + '/for-everyone');
      else await api.del(BASE + '/messages/' + id + '/for-me');
      if (mode === 'for-everyone') {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, is_deleted: true, deleted_reason: null, body: null, attachments: [], metadata: null } : m)));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (err) {
      showError(err);
    }
  };

  // "Cancel" (undo send): only works for a short window after sending; the server wipes the message and the other
  // side is told through the poll, so nobody keeps a trace of it.
  const onUndoSend = async (id) => {
    try {
      await api.del(BASE + '/messages/' + id + '/undo-send');
      setMessages((prev) => prev.filter((m) => m.id !== id));
      loadInbox();
    } catch (err) {
      showError(err);
    }
  };

  const onReact = async (id, emoji) => {
    try {
      const res = await api.post(BASE + '/messages/' + id + '/react', { emoji });
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, reactions: res.data.reactions ?? res.data } : m)));
    } catch (err) {
      showError(err);
    }
  };

  // Pin flow: unpinned message -> duration dialog -> POST /pin {duration}; pinned message -> unpin straight away.
  const [pinTarget, setPinTarget] = useState(null);
  const [pinBusy, setPinBusy] = useState(false);
  const refreshPinned = useCallback(async (convId) => {
    const r = await api.get(BASE + '/conversations/' + convId + '/pinned');
    setPinnedMessages(r.data || []);
    return r.data || [];
  }, []);
  const syncPinFlags = useCallback((list) => {
    const byId = new Map(list.map((p) => [p.id, p]));
    setMessages((prev) => prev.map((x) => {
      const p = byId.get(x.id);
      if (p) return x.is_pinned && x.pinned_until === p.pinned_until ? x : { ...x, is_pinned: true, pinned_until: p.pinned_until ?? null };
      return x.is_pinned ? { ...x, is_pinned: false, pinned_until: null } : x;
    }));
  }, []);
  const onPin = (m) => {
    if (!m.is_pinned) { setPinTarget(m); return; }
    return unpinMessage(m);
  };
  // Unpin always asks first, so a stray tap on the "x" of the pinned bar can't drop a pin by accident.
  const unpinMessage = (m) => askConfirm({
    title: ar ? 'إلغاء تثبيت الرسالة؟' : 'Unpin this message?',
    message: ar ? 'هتتشال الرسالة من المثبّتات. تقدر تثبّتها تاني في أي وقت.' : 'It will be removed from the pinned messages. You can pin it again any time.',
    confirmLabel: ar ? 'إلغاء التثبيت' : 'Unpin',
    run: () => doUnpin(m),
  });
  const doUnpin = async (m) => {
    try {
      await api.post(BASE + '/messages/' + m.id + '/unpin');
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_pinned: false, pinned_until: null } : x)));
      setPinnedMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      showError(err);
    }
  };
  const confirmPin = async (duration) => {
    const m = pinTarget;
    if (!m) return;
    setPinBusy(true);
    try {
      await api.post(BASE + '/messages/' + m.id + '/pin', { duration });
      setPinTarget(null);
      syncPinFlags(await refreshPinned(activeId));
    } catch (err) {
      showError(err);
    } finally {
      setPinBusy(false);
    }
  };
  // when the soonest timed pin runs out, refresh so the bar and the message badges drop it without a reload
  useEffect(() => {
    const times = pinnedMessages.map((p) => (p.pinned_until ? parseServerDate(p.pinned_until).getTime() : 0)).filter((n) => n > 0);
    if (!times.length || !activeId) return undefined;
    const wait = Math.min(Math.max(Math.min(...times) - Date.now() + 1500, 1000), 2147000000);
    const h = setTimeout(() => { refreshPinned(activeId).then(syncPinFlags).catch(() => {}); }, wait);
    return () => clearTimeout(h);
  }, [pinnedMessages, activeId, refreshPinned, syncPinFlags]);

  // Star: personal (the other side never sees it). Optimistic, rolled back if the server refuses.
  const onStar = async (m, starred) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_starred: starred } : x)));
    try {
      await api.post(BASE + '/messages/' + m.id + '/star', { starred });
    } catch (err) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_starred: !starred } : x)));
      showError(err);
    }
  };

  const onVote = async (id, optionIndex) => {
    if (isTmp(id)) return;
    // optimistic: move / remove my vote right away so the tap is felt instantly
    const apply = (m, fn) => (String(m.id) === String(id) ? fn(m) : m);
    const before = messages.find((m) => String(m.id) === String(id));
    setMessages((prev) => prev.map((m) => apply(m, (x) => {
      const res = { ...(x.pollResults || {}) };
      const cur = x.myVote ?? null;
      if (cur !== null) res[cur] = Math.max(0, Number(res[cur] || 0) - 1);
      const next = cur === optionIndex ? null : optionIndex;
      if (next !== null) res[next] = Number(res[next] || 0) + 1;
      const total = Object.values(res).reduce((s, v) => s + Number(v || 0), 0);
      return { ...x, pollResults: res, myVote: next, pollTotal: total };
    })));
    try {
      const res = await api.post(BASE + '/messages/' + id + '/vote', { option_index: optionIndex });
      const d = res.data || {};
      setMessages((prev) => prev.map((m) => apply(m, (x) => ({ ...x, pollResults: d.pollResults ?? x.pollResults, pollTotal: d.pollTotal ?? x.pollTotal, myVote: d.myVote ?? null }))));
    } catch (err) {
      if (before) setMessages((prev) => prev.map((m) => apply(m, () => before)));
      showError(err);
    }
  };

  // ------------------------------------------------------------- voice
  // Ported from stopRecording(true)'s upload path in messaging.js.
  const onSendVoice = async (file) => {
    if (!activeId) return;
    sendWithFiles({ body: '', files: [file], parentId: null });
  };

  // ------------------------------------------------------------- forward
  // Ported from openForwardModal() in messaging.js.
  const onForwardMessage = (messageId) => {
    setForwardMessageId(Array.isArray(messageId) ? messageId : [messageId]);
    setModal('forward');
  };

  // Forward every chosen message (oldest first) to every chosen conversation.
  const submitForward = async (targetIds) => {
    const ids = [...(forwardMessageId || [])].sort((a, b) => Number(a) - Number(b));
    const targets = Array.isArray(targetIds) ? targetIds : [targetIds];
    for (const target of targets) {
      for (const mid of ids) {
        const fd = new FormData();
        fd.append('body', '');
        fd.append('forwarded_from_id', mid);
        // eslint-disable-next-line no-await-in-loop
        await api.postForm(BASE + '/conversations/' + target + '/messages', fd);
      }
    }
    setModal(null);
    setForwardMessageId(null);
    setSelectMode(false);
    setSelectedIds([]);
    loadInbox();
    if (targets.some((x) => String(x) === String(activeId))) {
      loadThread(activeId, null, false);
    }
  };

  // ------------------------------------------------------------- multi-select
  const selectable = (m) => m && m.message_type !== 'system' && !m.is_deleted && !m.pending && !m.failed && !isTmp(m.id);
  const onStartSelect = (m) => {
    if (!selectable(m)) return;
    setSelectMode(true);
    setSelectedIds([m.id]);
  };
  const onToggleSelect = (m) => {
    if (!selectable(m)) return;
    setSelectedIds((prev) => {
      const next = prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id];
      if (next.length === 0) setSelectMode(false);
      return next;
    });
  };
  const onExitSelect = () => { setSelectMode(false); setSelectedIds([]); };
  const selectedMessages = () => messages.filter((m) => selectedIds.includes(m.id));
  const onForwardSelected = () => { if (selectedIds.length) onForwardMessage(selectedIds); };
  const onDeleteSelected = () => { if (selectedIds.length) setModal('bulkDelete'); };
  const bulkCanAll = () => {
    const sel = selectedMessages();
    return sel.length > 0 && sel.every((m) => m.is_mine && (!m.created_at || Date.now() - parseServerDate(m.created_at).getTime() < 15 * 60000));
  };
  const submitBulkDelete = async (mode) => {
    const ids = [...selectedIds];
    const failed = [];
    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.del(BASE + '/messages/' + id + '/' + mode);
      } catch (err) {
        failed.push(id);
      }
    }
    const done = ids.filter((id) => !failed.includes(id));
    if (mode === 'for-everyone') {
      setMessages((prev) => prev.map((m) => (done.includes(m.id) ? { ...m, is_deleted: true, deleted_reason: null, body: null, attachments: [], metadata: null } : m)));
    } else {
      setMessages((prev) => prev.filter((m) => !done.includes(m.id)));
    }
    setModal(null);
    setSelectMode(false);
    setSelectedIds([]);
    loadInbox();
    if (failed.length) {
      setLastError(ar
        ? `تعذّر حذف ${failed.length} من ${ids.length} رسالة (ربما انتهت مهلة الحذف للجميع).`
        : `Could not delete ${failed.length} of ${ids.length} messages.`);
    }
  };

  // ------------------------------------------------------------- poll
  // Ported from openPollModal() in messaging.js.
  const createPoll = async ({ question, options }) => {
    if (!activeId) return;
    const res = await api.post(BASE + '/conversations/' + activeId + '/poll-message', { question, options });
    setMessages((prev) => [...prev, res.data]);
    lastPollIdRef.current = res.data.id;
    setModal(null);
  };

  // ------------------------------------------------------------- location
  // Current location = one message; live location = a message the sender keeps updating (src/lib/liveLocation.js).
  const liveText = () => ({
    title: locale === 'ar' ? 'مشاركة الموقع المباشر' : 'Sharing live location',
    message: locale === 'ar' ? 'يتم مشاركة موقعك في محادثة. اضغط لإيقاف المشاركة.' : 'Your location is being shared in a chat.',
  });
  useEffect(() => { resumeShares(liveText()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => { applyChatStyle(); }, []);

  const appendSent = (msg) => {
    setMessages((prev) => (prev.some((x) => String(x.id) === String(msg.id)) ? prev : [...prev, msg]));
    lastPollIdRef.current = Math.max(Number(lastPollIdRef.current) || 0, Number(msg.id) || 0);
    loadInbox();
  };

  const onSendLocation = async (pos) => {
    if (!activeId) return;
    const res = await api.post(BASE + '/conversations/' + activeId + '/location-message', { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
    appendSent(res.data);
  };

  const onStartLiveLocation = async (pos, minutes) => {
    if (!activeId) return;
    const res = await api.post(BASE + '/conversations/' + activeId + '/live-location', { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, minutes });
    const msg = res.data;
    appendSent(msg);
    await startShare({ id: msg.id, expiresAt: Number(msg.metadata?.expires_ts) * 1000, conversationId: activeId, initial: pos, text: liveText() });
  };

  const onStopLive = async (id) => {
    const data = await stopShare(id);
    setMessages((prev) => prev.map((m) => (String(m.id) === String(id)
      ? { ...m, ...data, metadata: data?.metadata || { ...m.metadata, ended: true } }
      : m)));
  };

  // All image attachments currently loaded in the thread, for the
  // lightbox's prev/next navigation — same source set as messaging.js's
  // querySelectorAll("[data-lightbox-src]").
  const lightboxImages = useMemo(
    () =>
      messages.flatMap((m) =>
        (m.attachments || []).filter((a) => a.kind === 'image' && a.url && !a.view_mode).map((a) => a.url)
      ),
    [messages]
  );

  // ------------------------------------------------------------- info panel
  const convMeta = conversations.find((c) => String(c.id) === String(activeId));

  const onToggleFlag = async (flag, value) => {
    if (!activeId) return;
    setConversations((prev) =>
      prev.map((c) => (String(c.id) === String(activeId) ? { ...c, [`is_${flag === 'favorite' ? 'favorite' : flag === 'pin' ? 'pinned' : flag === 'mute' ? 'muted' : 'archived'}`]: value } : c))
    );
    try {
      await api.post(BASE + '/conversations/' + activeId + '/flags/' + flag, { value });
    } catch (err) {
      showError(err);
      loadInbox();
    }
  };

  const onSetCategory = async (category) => {
    if (!activeId) return;
    try {
      await api.post(BASE + '/conversations/' + activeId + '/category', { category });
      loadInbox();
    } catch (err) {
      showError(err);
    }
  };

  // A group admin call returned the refreshed thread: update the header / info panel / composer rules.
  const applyGroupThread = useCallback((data) => {
    if (!data?.conversation) return;
    setActiveConversation(data.conversation);
    setActiveOthers(data.others || []);
    loadInbox();
  }, [loadInbox]);

  const onAddMember = async (userId) => {
    if (!activeId) return;
    await api.post(BASE + '/conversations/' + activeId + '/members', { user_id: userId });
    loadThread(activeId, null, false);
  };

  const closeActiveThread = () => {
    activeIdRef.current = null;
    clearOpen();
    setActiveId(null);
    setActiveConversation(null);
    setMessages([]);
    setInfoOpen(false);
    loadInbox();
  };

  const onMemberAction = async (action, member) => {
    if (!activeId) return;
    const base = BASE + '/conversations/' + activeId;
    try {
      if (action === 'remove') {
        if (!window.confirm(ar ? `إزالة ${member.full_name} من المجموعة؟` : `Remove ${member.full_name} from the group?`)) return;
        await api.del(base + '/members/' + member.id);
      } else if (action === 'promote' || action === 'demote') {
        await api.post(base + '/members/' + member.id + '/role', { role: action === 'promote' ? 'admin' : 'member' });
      } else if (action === 'restrict' || action === 'unrestrict') {
        await api.post(base + '/members/' + member.id + '/restrict', { value: action === 'restrict' });
      } else if (action === 'transfer') {
        if (!window.confirm(ar ? `نقل ملكية المجموعة إلى ${member.full_name}؟ ستصبح مشرفًا.` : `Make ${member.full_name} the group owner? You will become an admin.`)) return;
        await api.post(base + '/transfer-owner', { user_id: member.id });
      }
      loadThread(activeId, null, false);
    } catch (err) {
      showError(err);
    }
  };

  const onLeaveGroup = async () => {
    if (!activeId) return;
    if (!window.confirm(ar ? 'هل تريد مغادرة هذه المجموعة؟' : 'Leave this group?')) return;
    try {
      await api.post(BASE + '/conversations/' + activeId + '/leave');
      closeActiveThread();
    } catch (err) {
      showError(err);
    }
  };

  const onDeleteGroup = async () => {
    if (!activeId) return;
    if (!window.confirm(ar ? 'حذف المجموعة نهائيًا لكل الأعضاء؟ لا يمكن التراجع.' : 'Delete this group for everyone? This cannot be undone.')) return;
    try {
      await api.del(BASE + '/conversations/' + activeId + '/group');
      closeActiveThread();
    } catch (err) {
      showError(err);
    }
  };

  const openGroupSettings = (tab) => {
    setGroupTab(tab || 'info');
    setModal('groupSettings');
  };

  // ------------------------------------------------------------- modals
  const searchRecipients = async (q) => {
    const res = await api.get(BASE + '/recipients', { q });
    return res.data || [];
  };

  const createDirect = async ({ recipient_email, body }) => {
    const res = await api.post(BASE + '/conversations/direct', { recipient_email, body });
    setModal(null);
    loadInbox();
    setTimeout(() => openConversation(res.data.conversation.id), 150);
  };

  const createGroup = async ({ name, member_ids, description }) => {
    const res = await api.post(BASE + '/conversations/group', { name, member_ids, ...(description ? { description } : {}) });
    setModal(null);
    loadInbox();
    setTimeout(() => openConversation(res.data.conversation.id), 150);
  };

  const onShowPinned = async () => {
    if (!activeId) return;
    try {
      const res = await api.get(BASE + '/conversations/' + activeId + '/pinned');
      setPinnedMessages(res.data || []);
      setModal('pinned');
    } catch (err) {
      showError(err);
    }
  };

  const onGoToMessage = (id) => {
    setModal(null);
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el) { el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 1800); }
  };

  // ------------------------------------------------------------- safety (block / report)
  const [reportTarget, setReportTarget] = useState(null); // { messageId?, userId, name, conversationId, preview? }
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const h = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(h);
  }, [notice]);

  // ------------------------------------------------------------- delete / trash (kept 30 days)
  const [trashItems, setTrashItems] = useState([]);
  const retentionDays = 30;
  // Archived / Blocked / Reports / Trash are full pages: /{portal}/messages/{archived|blocked|reports|trash}
  const centerBase = location.pathname.replace(/\/messages(\/.*)?$/, '/messages');
  const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, run }
  const [undo, setUndo] = useState(null); // { text, ids }
  const BATCH = 200;

  const loadTrash = useCallback(async () => {
    try {
      const res = await api.get(BASE + '/trash');
      setTrashItems(res.data?.items || []);
    } catch {
      /* the count badge is non-critical */
    }
  }, []);

  useEffect(() => { loadTrash(); }, [loadTrash]);
  useEffect(() => {
    if (!undo) return undefined;
    const h = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(h);
  }, [undo]);

  /** POST a trash action for explicit ids (in batches of 200) or for everything (all: true). */
  const trashCall = async (action, ids, all) => {
    if (all) {
      await api.post(BASE + '/trash/' + action, { all: true });
      return;
    }
    for (let i = 0; i < ids.length; i += BATCH) {
      // eslint-disable-next-line no-await-in-loop
      await api.post(BASE + '/trash/' + action, { ids: ids.slice(i, i + BATCH) });
    }
  };

  /** Ask for confirmation; resolves true when the action ran, false when the person cancelled. */
  const askConfirm = (cfg) => new Promise((resolve) => {
    setConfirm({
      ...cfg,
      cancel: () => { setConfirm(null); resolve(false); },
      run: async () => {
        try {
          await cfg.run();
          setConfirm(null);
          resolve(true);
        } catch (err) {
          setConfirm(null);
          showError(err);
          resolve(false);
        }
      },
    });
  });

  const performDelete = async (ids, all) => {
    const before = conversations;
    const gone = new Set(ids.map(String));
    const hitActive = activeIdRef.current && (all || gone.has(String(activeIdRef.current)));
    // optimistic: the chats leave the list right away
    setConversations(all ? [] : before.filter((c) => !gone.has(String(c.id))));
    if (hitActive) onBack();
    try {
      await trashCall('delete', ids, all);
    } catch (err) {
      setConversations(before);
      throw err;
    }
    const n = all ? before.length : ids.length;
    setUndo({
      text: ar ? `تم نقل ${n} ${n === 1 ? 'محادثة' : 'محادثات'} إلى المحذوفات.` : `${n} chat${n === 1 ? '' : 's'} moved to Trash.`,
      ids: all ? before.map((c) => c.id) : ids,
    });
    loadInbox();
    loadTrash();
  };

  /** Called by the rail for one chat, a selection, or everything — always asks first. */
  const requestDelete = async (ids, all) => {
    const n = all ? conversations.length : ids.length;
    const one = !all && n === 1 ? conversations.find((c) => String(c.id) === String(ids[0])) : null;
    const keep = ar ? `تبقى في المحذوفات ${retentionDays} يومًا ويمكنك استرجاعها قبل حذفها نهائيًا. لن يتأثر الطرف الآخر.`
                    : `It stays in Trash for ${retentionDays} days and can be restored before it is deleted for good. Other people are not affected.`;
    let title; let message;
    if (all) {
      title = ar ? 'حذف كل المحادثات؟' : 'Delete all chats?';
      message = ar ? `سيتم نقل كل محادثاتك (${n}) إلى المحذوفات. ${keep}` : `All your chats (${n}) will move to Trash. ${keep}`;
    } else if (one) {
      const name = one.subject || (ar ? 'هذه المحادثة' : 'this chat');
      title = ar ? 'حذف المحادثة؟' : 'Delete this chat?';
      message = ar ? `سيتم نقل «${name}» إلى المحذوفات. ${keep}` : `"${name}" will move to Trash. ${keep}`;
    } else {
      title = ar ? 'حذف المحادثات المحددة؟' : 'Delete selected chats?';
      message = ar ? `سيتم نقل ${n} محادثات إلى المحذوفات. ${keep}` : `${n} chats will move to Trash. ${keep}`;
    }
    return askConfirm({
      title,
      message,
      confirmLabel: ar ? 'نقل إلى المحذوفات' : 'Move to Trash',
      run: () => performDelete(ids, all),
    });
  };

  const onUndoDelete = async () => {
    const u = undo;
    setUndo(null);
    if (!u) return;
    try {
      await trashCall('restore', u.ids, false);
      setNotice(ar ? 'تم استرجاع المحادثات.' : 'Chats restored.');
      loadInbox();
      loadTrash();
    } catch (err) {
      showError(err);
    }
  };

  // APK pull-to-refresh (native.js fires 'uip:pull-refresh'): reload the chat list + the open thread without reloading the app.
  useEffect(() => {
    const onPull = (e) => {
      const jobs = [loadInboxRef.current?.()];
      // a message still uploading lives only in this list: don't wipe its bubble
      if (activeIdRef.current && Object.keys(uploadsRef.current).length === 0) jobs.push(loadThread(activeIdRef.current, null, false));
      e.detail?.wait?.(Promise.all(jobs));
    };
    window.addEventListener('uip:pull-refresh', onPull);
    return () => window.removeEventListener('uip:pull-refresh', onPull);
  }, [loadThread]);

  // "Message" from the Stories viewers list: open that chat
  useEffect(() => {
    const onOpen = (e) => { const id = e.detail?.id; if (id) { loadInboxRef.current?.(); openConversation(id); } };
    window.addEventListener('uip-open-conversation', onOpen);
    return () => window.removeEventListener('uip-open-conversation', onOpen);
  }, [openConversation]);

  const refreshAfterSafety = () => {
    if (activeIdRef.current) loadThread(activeIdRef.current, null, false);
    loadInbox();
  };

  const onBlockUser = async (userId, name) => {
    const who = name || (ar ? 'هذا الشخص' : 'this person');
    const ok = window.confirm(ar
      ? `هل تريد حظر ${who}؟ لن تتمكن من مراسلته ولن يتمكن من مراسلتك، ويمكنك إلغاء الحظر في أي وقت من مركز الأمان.`
      : `Block ${who}? You won't be able to message each other. You can unblock from the Safety center at any time.`);
    if (!ok) return;
    try {
      await api.post(BASE + '/blocks', { user_id: userId });
      setNotice(ar ? 'تم الحظر.' : 'User blocked.');
      refreshAfterSafety();
    } catch (err) {
      showError(err);
    }
  };

  const onUnblockUser = async (u) => {
    const res = await api.del(BASE + '/blocks/' + u.id);
    refreshAfterSafety();
    return res.data;
  };

  const onReportMessage = (m) =>
    setReportTarget({
      messageId: m.id,
      userId: m.sender_id,
      name: m.sender_name,
      conversationId: m.conversation_id,
      preview: m.body ? String(m.body).slice(0, 300) : '',
    });
  const onReportUser = (userId, name) => setReportTarget({ userId, name, conversationId: activeId });

  const submitReport = async ({ reason, details, also_block }) => {
    const target = reportTarget;
    const body = target.messageId
      ? { message_id: target.messageId }
      : { user_id: target.userId, conversation_id: target.conversationId };
    await api.post(BASE + '/reports', { ...body, reason, details, also_block });
    setReportTarget(null);
    setNotice(ar ? 'تم إرسال البلاغ للإدارة والجامعة والكلية.' : 'Report sent to the admins, university and faculty.');
    if (also_block) refreshAfterSafety();
  };

  const visibleMessages = messages.filter((m) => !isUnsent(m));

  return (
    <>
    <div className={`msg-app${infoOpen && activeConversation ? ' has-info' : ''}${activeId ? ' thread-open' : ''}${railCollapsed && activeId ? ' rail-collapsed' : ''}${fullView ? ' is-full' : ''}`} data-msg-app data-wall={shownWall} data-wall-anim={wallAnim ? 'on' : 'off'} data-font={chatSettings.font_size} ref={appRef} style={{ '--msg-info-w': `${infoW}px`, ...(railW && !(railCollapsed && activeId) ? { '--msg-rail-w': `${railW}px` } : null), ...(customWallUrl && shownWall === 'custom' ? { '--msg-wall-img': `url("${customWallUrl}")`, ...wallStyleVars(customWallStyle) } : null) }}>
      {shownWall === 'custom' && (
        /* The person's own photo. Delivered from JS (not only from the stylesheet) with !important so no other wallpaper rule can paint over it. */
        <style>{`html body .msg-app[data-msg-app][data-wall="custom"] .msg-thread{background:linear-gradient(var(--wall-veil,transparent),var(--wall-veil,transparent)),var(--msg-wall-img) var(--msg-wall-pos,center) / var(--msg-wall-size,cover) no-repeat,var(--msg-wall-bgc,var(--bg-canvas))!important}`}</style>
      )}
      <ConversationRail
        onDeleteConversations={requestDelete}
        onOpenSettings={() => navigate(centerBase + '/settings')}
        initialSelecting={Boolean(location.state?.selectChats)}
        trashCount={trashItems.length}
        conversations={conversations}
        categories={categories}
        filter={filter}
        setFilter={setFilter}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        activeId={activeId}
        onOpen={openConversation}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        onOpenSearchResult={onOpenSearchResult}
        onNewDirect={() => setModal('newDirect')}
        onNewGroup={() => setModal('newGroup')}
        myUserId={user?.id}
        loading={loadingInbox}
      />

      <ThreadPanel
        conversation={activeConversation}
        others={activeOthers}
        messages={visibleMessages}
        hasMoreOlder={hasMoreOlder}
        onLoadOlder={onLoadOlder}
        pinnedMessages={pinnedMessages}
        onGoToMessage={onGoToMessage}
        onUnpin={unpinMessage}
        onShowPinned={onShowPinned}
        presenceText={presenceText}
        replyTarget={replyTarget}
        onSetReply={setReplyTarget}
        onCancelReply={() => setReplyTarget(null)}
        pendingFiles={pendingFiles}
        onAddFiles={onAddFiles}
        onRemoveFile={onRemoveFile}
        onReplaceFile={onReplaceFile}
        onToggleDenoise={onToggleDenoise}
        onSend={onSend}
        onEditMessage={onEditMessage}
        onDeleteMessage={onDeleteMessage}
        onUndoSend={onUndoSend}
        onCancelUpload={onCancelUpload}
        onReact={onReact}
        onPin={onPin}
        onStar={onStar}
        onVote={onVote}
        onStopLive={onStopLive}
        onSendLocation={onSendLocation}
        onStartLiveLocation={onStartLiveLocation}
        onSendSticker={onSendSticker}
        onSendGif={onSendGif}
        typingUsers={typingUsers}
        onOpenInfo={toggleInfo}
        infoOpen={infoOpen}
        onBack={onBack}
        onOpenLightbox={setLightboxSrc}
        onOpenVideo={setVideoView}
        onNotifyTyping={onNotifyTyping}
        onForwardMessage={onForwardMessage}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onStartSelect={onStartSelect}
        onToggleSelect={onToggleSelect}
        onExitSelect={onExitSelect}
        onForwardSelected={onForwardSelected}
        onDeleteSelected={onDeleteSelected}
        onReportMessage={onReportMessage}
        onUnblockUser={onUnblockUser}
        onOpenPollModal={() => setModal('poll')}
        onSendVoice={onSendVoice}
        onRetryUpload={onRetryUpload}
        onDiscardUpload={onDiscardUpload}
        railCollapsed={railCollapsed && Boolean(activeId)}
        onToggleRail={toggleRail}
        fullView={fullView}
        onToggleFull={toggleFull}
        onError={showError}
        enterToSend={chatSettings.enter_to_send !== false}
        myUserId={user?.id}
      />

      {!(railCollapsed && activeId) && <InfoResizer side="rail" appRef={appRef} width={railW} onWidth={onRailWidth} />}

      {infoOpen && activeConversation && (
        <InfoResizer side="info" appRef={appRef} width={infoW} onWidth={onInfoWidth} />
      )}

      {infoOpen && activeConversation && (
        <InfoPanel
          conversation={activeConversation}
          convMeta={convMeta}
          others={activeOthers}
          messages={visibleMessages}
          myUserId={user?.id}
          onToggleFlag={onToggleFlag}
          onSetCategory={onSetCategory}
          onAddMember={() => setModal('addMember')}
          onOpenGroupSettings={openGroupSettings}
          onMemberAction={onMemberAction}
          onLeaveGroup={onLeaveGroup}
          onDeleteGroup={onDeleteGroup}
          onRenameSaved={onRenameSaved}
          onSavedAvatar={onSavedAvatar}
          onBlockUser={onBlockUser}
          onUnblockUser={onUnblockUser}
          onReportUser={onReportUser}
          onClose={() => rememberInfo(false)}
          wall={wall}
          wallIsDefault={!ownWall}
          onWall={onWall}
          onWallUseDefault={onWallUseDefault}
          customWalls={wallpapers.items}
          onAddCustomWall={addCustomWall}
          onRemoveCustomWall={removeCustomWall}
          wallAnim={wallAnim}
          onWallAnim={onWallAnim}
          autoSave={autoSave}
          onAutoSave={autoSaveAvailable() ? onAutoSave : undefined}
        />
      )}

      {modal === 'newDirect' && (
        <NewDirectModal onClose={() => setModal(null)} onSearchRecipients={searchRecipients} onSubmit={createDirect} />
      )}
      {modal === 'newGroup' && (
        <NewGroupModal onClose={() => setModal(null)} onSearchRecipients={searchRecipients} onSubmit={createGroup} />
      )}
      {modal === 'addMember' && (
        <AddMemberModal onClose={() => setModal(null)} onSearchRecipients={searchRecipients} onSubmit={onAddMember} />
      )}
      {modal === 'groupSettings' && activeConversation?.is_group && (
        <GroupSettingsModal
          conversation={activeConversation}
          conversations={conversations}
          initialTab={groupTab}
          onClose={() => setModal(null)}
          onUpdated={applyGroupThread}
          onError={showError}
        />
      )}
      {modal === 'pinned' && (
        <PinnedMessagesModal pinned={pinnedMessages} onClose={() => setModal(null)} onGoToMessage={onGoToMessage} onUnpin={unpinMessage} />
      )}
      {pinTarget && (
        <PinDurationModal message={pinTarget} busy={pinBusy} onClose={() => setPinTarget(null)} onConfirm={confirmPin} />
      )}
      {modal === 'forward' && (
        <ForwardModal
          conversations={conversations}
          onClose={() => { setModal(null); setForwardMessageId(null); }}
          onForward={submitForward}
          count={(forwardMessageId || []).length || 1}
        />
      )}
      {modal === 'bulkDelete' && (
        <BulkDeleteModal count={selectedIds.length} canAll={bulkCanAll()} onClose={() => setModal(null)} onDelete={submitBulkDelete} />
      )}
      {reportTarget && <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} onSubmit={submitReport} />}
      {modal === 'poll' && <PollModal onClose={() => setModal(null)} onSubmit={createPoll} />}
      {videoView && <VideoViewer video={videoView} onClose={() => setVideoView(null)} />}
      {lightboxSrc && (
        <Lightbox images={lightboxImages} initialSrc={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {lastError && <div className="mr-toast is-error" role="alert">{lastError}</div>}
      {notice && !lastError && !undo && <div className="mr-toast" role="status">{notice}</div>}
      {undo && !lastError && (
        <div className="mr-toast" role="status">
          <span>{undo.text}</span>
          <button type="button" className="mr-toast__action" onClick={onUndoDelete}>{ar ? 'تراجع' : 'Undo'}</button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} onConfirm={confirm.run} onClose={confirm.cancel} />
      )}
    </div>
    </>
  );
}
