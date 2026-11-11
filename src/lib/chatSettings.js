import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Chat settings (privacy, bio, wallpapers, notifications, typing…) — ONE store shared by the messenger, the
 * settings page, the story composer and the thread. Source of truth is the account (GET/PATCH
 * /api/v1/messaging/settings), so the choices follow the person to every device and the SERVER enforces them
 * (who can see my photo / bio / last seen / stories, who can message / call / add me).
 *
 *   const { settings, loaded, patch } = useChatSettings();
 *   await patch({ privacy: { avatar: { audience: 'contacts' } } });   // optimistic, rolled back on error
 */

const PATH = '/api/v1/messaging/settings';

export const AUDIENCES = ['everyone', 'contacts', 'contacts_except', 'only', 'nobody'];
export const PRIVACY_FIELDS = ['avatar', 'bio', 'last_seen', 'stories', 'messages', 'calls', 'groups', 'messages_contacts', 'calls_contacts'];

const open = { audience: 'everyone', ids: [] };
export const DEFAULT_SETTINGS = {
  privacy: {
    avatar: open, bio: open, last_seen: open, stories: { audience: 'contacts', ids: [] }, messages: open, calls: open, groups: open, messages_contacts: open, calls_contacts: open,
  },
  // availability timer: others can reach me only inside these hours (applies_to: new | contacts | all)
  schedule: { enabled: false, days: [0, 1, 2, 3, 4], start: '09:00', end: '16:00', tz: 'Africa/Cairo', applies_to: 'all', affects: { messages: true, calls: true } },
  read_receipts_enabled: true,
  typing_indicator: true,
  discoverable: true,
  notify_messages: true,
  notify_preview: true,
  stories_allow_replies: true,
  stories_expiry_hours: 24,
  enter_to_send: true,
  font_size: 'md',
  sounds: true,
  wallpaper: { default: 'dots', per_chat: {}, anim: false },
  bio: '',
  bio_style: 'classic',
  bio_max: 190,
  people: {},
  initialized: true,
};

let state = { ownerId: null, loaded: false, data: DEFAULT_SETTINGS, error: '' };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;

/** Server → client shape (the server sends `per_chat`/`people` as objects, and [] when empty). */
function normalize(d) {
  const data = { ...DEFAULT_SETTINGS, ...(d || {}) };
  data.privacy = { ...DEFAULT_SETTINGS.privacy, ...(d?.privacy || {}) };
  data.schedule = { ...DEFAULT_SETTINGS.schedule, ...(d?.schedule || {}), affects: { ...DEFAULT_SETTINGS.schedule.affects, ...(d?.schedule?.affects || {}) } };
  const per = d?.wallpaper?.per_chat;
  data.wallpaper = { ...DEFAULT_SETTINGS.wallpaper, ...(d?.wallpaper || {}), per_chat: per && !Array.isArray(per) ? per : {} };
  data.people = d?.people && !Array.isArray(d.people) ? d.people : {};
  return data;
}

/** Same merge rules as the server, so the optimistic update looks exactly like what comes back. */
function mergePatch(cur, patch) {
  const next = { ...cur };
  Object.keys(patch).forEach((k) => {
    if (k === 'privacy') {
      next.privacy = { ...cur.privacy };
      Object.keys(patch.privacy).forEach((f) => { next.privacy[f] = { ...cur.privacy[f], ...patch.privacy[f] }; });
    } else if (k === 'schedule') {
      next.schedule = { ...cur.schedule, ...patch.schedule, affects: { ...cur.schedule.affects, ...(patch.schedule.affects || {}) } };
    } else if (k === 'wallpaper') {
      const w = { ...cur.wallpaper, per_chat: { ...cur.wallpaper.per_chat } };
      if ('default' in patch.wallpaper) w.default = patch.wallpaper.default;
      if ('anim' in patch.wallpaper) w.anim = !!patch.wallpaper.anim;
      Object.entries(patch.wallpaper.per_chat || {}).forEach(([cid, id]) => {
        if (id === null || id === '' || id === 'default') delete w.per_chat[cid]; else w.per_chat[cid] = id;
      });
      next.wallpaper = w;
    } else {
      next[k] = patch[k];
    }
  });
  return next;
}

let inflight = null;
export function loadChatSettings(force = false) {
  if (inflight) return inflight;
  if (state.loaded && !force) return Promise.resolve(state.data);
  inflight = api.get(PATH)
    .then((res) => {
      state = { ...state, loaded: true, error: '', data: normalize(res.data) };
      emit();
      return state.data;
    })
    .catch((err) => {
      state = { ...state, error: err?.message || 'error' };
      emit();
      return state.data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Forget everything (another account signed in). */
export function resetChatSettings(ownerId = null) {
  state = { ownerId, loaded: false, data: DEFAULT_SETTINGS, error: '' };
  inflight = null;
  emit();
}

let saving = Promise.resolve();
export function patchChatSettings(patch) {
  const before = state.data;
  state = { ...state, data: mergePatch(state.data, patch) }; // optimistic
  emit();
  // serialize writes so two quick taps can't land out of order
  const run = saving.then(() => api.patch(PATH, patch)).then((res) => {
    state = { ...state, data: normalize(res.data) };
    emit();
    return state.data;
  }).catch((err) => {
    state = { ...state, data: before };
    emit();
    throw err;
  });
  saving = run.catch(() => {});
  return run;
}

export function useChatSettings() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (uid == null) return;
    if (state.ownerId !== uid) resetChatSettings(uid);
    loadChatSettings();
  }, [uid]);

  const patch = useCallback((p) => patchChatSettings(p), []);
  const reload = useCallback(() => loadChatSettings(true), []);
  return { settings: snap.data, loaded: snap.loaded, error: snap.error, patch, reload };
}

/** Wallpaper that applies to a chat: its own choice, else the account default. */
export function wallFor(settings, conversationId) {
  const own = conversationId != null ? settings.wallpaper.per_chat[String(conversationId)] : null;
  return own || settings.wallpaper.default || 'dots';
}

/** Audience helpers shared by the settings page and the story composer. */
export const STORY_AUDIENCE_OF = { everyone: 'everyone', contacts: 'contacts', contacts_except: 'except', only: 'selected' };
