import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { api, getTokens } from '../api/client';
import { getReverbConfig } from './reverbConfig';

/**
 * Round 3 (Signaling) + Round 4 (WebRTC Core). Reverb speaks the Pusher
 * wire protocol (see config/broadcasting.php's docblock), so `pusher-js`
 * is the right client even though the server is Reverb, not Pusher's own
 * service — `laravel-echo` is just a thin, Laravel-flavoured wrapper
 * around it (`.join()`, `.here()/.joining()/.leaving()`,
 * `.listenForWhisper()`) that we'd otherwise hand-roll.
 *
 * The channel-auth handshake is NOT Laravel's default `/broadcasting/auth`
 * — the backend's own auth lives at
 * `POST /api/v1/meetings/{uuid}/signaling/auth` (uip.auth.optional, so a
 * guest_token works too — see MeetingsSignalingApiController::
 * authorizeChannel()'s docblock for why). That's why `authorizer` below is
 * a custom function instead of Echo's default axios-based one: it reuses
 * this app's own `api` client (Bearer token handling, refresh-on-401,
 * etc.) and hits that non-standard path. The endpoint's response body is
 * the raw `{auth, channel_data?}` pair pusher-js's authorizer callback
 * expects — no `{success, data}` envelope (see the controller's own
 * comment on why) — so it can be handed to `callback()` as-is.
 *
 * Round 5 (Live Collaboration) additions: channelSafeKey()/
 * personalChannelName() (بند 8 — every actor's own private inbox
 * channel, subscribed via Echo.private() elsewhere), signalingApi.hand/
 * reaction/screenSharePolicy/screenShareParticipantPolicy/
 * screenShareStop (بند 11 + بند 9), and the new chatApi (بند 7/8) — kept
 * as its own export rather than folded into signalingApi, mirroring the
 * backend's own MeetingsChatApiController/MeetingsSignalingApiController
 * split (see that controller's docblock for why).
 *
 * Round 6 (Host Controls) addition: hostControlApi (بند 5 — Participants
 * Panel: mute/disable-camera/remove/promote/demote/transfer-host/lock).
 * Its own export too, same reasoning — mirrors
 * MeetingsHostControlApiController being a controller of its own rather
 * than folded into MeetingsSignalingApiController. Unlike signalingApi's
 * calls, these never take a guestToken: MeetingsHostControlApiController
 * is registered under plain uip.auth (see its own docblock) — only a
 * signed-in host/co-host can ever call it, never a guest.
 *
 * Round 7 (Collaboration Extras) addition: attendanceApi (بند 17 —
 * Attendance Tracking). Same "no guestToken, plain uip.auth" shape as
 * hostControlApi above (see MeetingsAttendanceApiController's own
 * docblock — a guest never gets to view attendance data). Lives outside
 * the live room entirely (MeetingDetails.jsx, host/co-host only) rather
 * than in useMeetingRoom, so it's exported here but never wired into that
 * hook.
 */

window.Pusher = window.Pusher || Pusher;

/**
 * One id per page load (never persisted: a duplicated tab copies sessionStorage, a reload must get a fresh id). The server allows ONE live
 * session per person per meeting — a second tab / browser / device sends a different id and is refused (HTTP 409, code `already_in_meeting`).
 */
export const MEETING_SESSION_ID = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** True for the 409 the server answers when the same person is already in this meeting from another tab / device. */
export function isAlreadyInMeetingError(err) {
  const e = err && (err.error || err);
  const blob = [e?.payload?.errors?.code, e?.message, err?.message, (() => { try { return JSON.stringify(err); } catch { return ''; } })()].join(' ');
  return /already_in_meeting|already in this meeting/i.test(blob);
}
/** True when THIS tab's live session was taken over by another one (heartbeat answered 409 `session_replaced`). */
export function isSessionReplacedError(err) {
  return !!err && (err.status === 409 || /session_replaced|another tab or device/i.test(`${err.message || ''} ${err.payload?.errors?.code || ''}`));
}

/** Tab closing / reloading: tell the server right away (keepalive survives the unload) so the next load is not refused by our own stale session. */
export function leaveOnUnload(meetingUuid, guestToken) {
  try {
    const { accessToken } = getTokens();
    fetch(`/api/v1/meetings/${meetingUuid}/signaling/release-session`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ session_id: MEETING_SESSION_ID, ...(guestToken ? { guest_token: guestToken } : {}) }),
    }).catch(() => {});
  } catch { /* the server's session timeout is the fallback */ }
}

export async function createMeetingEcho(meetingUuid, guestToken) {
  const { key, host, port, scheme } = await getReverbConfig();
  const tls = scheme === 'https';

  return new Echo({
    broadcaster: 'reverb',
    key,
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: tls ? ['ws', 'wss'] : ['ws'],
    authorizer: (channel) => ({
      authorize: (socketId, callback) => {
        api.post(`/api/v1/meetings/${meetingUuid}/signaling/auth`, {
          socket_id: socketId,
          channel_name: channel.name,
          guest_token: guestToken || undefined,
          session_id: MEETING_SESSION_ID,
        })
          .then((payload) => callback(false, payload))
          .catch((err) => callback(true, err));
      },
    }),
  });
}

export function presenceChannelName(meetingUuid) {
  return `meeting.${meetingUuid}`;
}

/** بند 8 (Private Chat) — لازم تطابق MeetingSignalingService::channelSafeKey() بالظبط (':' -> '-'). */
export function channelSafeKey(actorKey) {
  return actorKey.replace(/:/g, '-');
}

/** بند 8 — قناة الإنبوكس الشخصية بتاعة الـ actor نفسه، بدون الـ 'private-' prefix (Echo.private() بيضيفه). راجع docblock MeetingSignalingService::personalChannelName(). */
export function personalChannelName(meetingUuid, actorKey) {
  return `meeting.${meetingUuid}.inbox.${channelSafeKey(actorKey)}`;
}

// ---- plain REST calls the room needs alongside the socket -------------

function withGuestToken(guestToken, body) {
  return guestToken ? { ...body, guest_token: guestToken } : body;
}

/**
 * Cloudflare Realtime SFU (MeetingsSfuApiController). كلها بتعدّي على لارافيل — مفتاح Cloudflare مش في المتصفح.
 * الـ GETs بتبعت guest_token في الـ query، الباقي في الـ body (زي signalingApi).
 */
const gq = (guestToken) => (guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '');
export const sfuApi = {
  config: (meetingUuid, guestToken) => api.get(`/api/v1/meetings/${meetingUuid}/sfu/config${gq(guestToken)}`),
  peers: (meetingUuid, guestToken) => api.get(`/api/v1/meetings/${meetingUuid}/sfu/peers${gq(guestToken)}`),
  session: (meetingUuid, guestToken, role) =>
    api.post(`/api/v1/meetings/${meetingUuid}/sfu/session`, withGuestToken(guestToken, { role })),
  tracks: (meetingUuid, guestToken, sessionId, body) =>
    api.post(`/api/v1/meetings/${meetingUuid}/sfu/sessions/${sessionId}/tracks`, withGuestToken(guestToken, body)),
  renegotiate: (meetingUuid, guestToken, sessionId, body) =>
    api.put(`/api/v1/meetings/${meetingUuid}/sfu/sessions/${sessionId}/renegotiate`, withGuestToken(guestToken, body)),
  closeTracks: (meetingUuid, guestToken, sessionId, body) =>
    api.put(`/api/v1/meetings/${meetingUuid}/sfu/sessions/${sessionId}/tracks/close`, withGuestToken(guestToken, body)),
  report: (meetingUuid, guestToken, body) =>
    api.post(`/api/v1/meetings/${meetingUuid}/sfu/report`, withGuestToken(guestToken, body)),
  leave: (meetingUuid, guestToken) =>
    api.post(`/api/v1/meetings/${meetingUuid}/sfu/leave`, withGuestToken(guestToken, {})),
};

export const signalingApi = {
  claimSession: (meetingUuid, guestToken) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/claim-session`, withGuestToken(guestToken, { session_id: MEETING_SESSION_ID })),
  iceServers: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/signaling/ice-servers${qs}`);
  },
  roster: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/signaling/roster${qs}`);
  },
  mediaState: (meetingUuid, guestToken, state) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/media-state`, withGuestToken(guestToken, state)),
  connectionState: (meetingUuid, guestToken, connectionState) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/connection-state`, withGuestToken(guestToken, { connection_state: connectionState })),
  connectionQuality: (meetingUuid, guestToken, connectionQuality) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/connection-quality`, withGuestToken(guestToken, { connection_quality: connectionQuality })),
  heartbeat: (meetingUuid, guestToken) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/heartbeat`, withGuestToken(guestToken, { session_id: MEETING_SESSION_ID })),
  leave: (meetingUuid, guestToken) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/leave`, withGuestToken(guestToken, { session_id: MEETING_SESSION_ID })),
  reportFailure: (meetingUuid, guestToken, failureType, message) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/failure`, withGuestToken(guestToken, { failure_type: failureType, message })),

  // Round 5 (Live Collaboration) — بند 11 (Raise Hand & Reactions).
  hand: (meetingUuid, guestToken, raised) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/hand`, withGuestToken(guestToken, { raised })),
  reaction: (meetingUuid, guestToken, type, emoji) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/reaction`, withGuestToken(guestToken, { type, emoji })),

  // Round 5 — بند 9 (Screen Sharing host controls). host/co-host بس على الباك اند.
  screenSharePolicy: (meetingUuid, guestToken, locked) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/screen-share-policy`, withGuestToken(guestToken, { locked })),
  screenShareParticipantPolicy: (meetingUuid, guestToken, participantKey, allowed) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/screen-share-policy/participant`, withGuestToken(guestToken, { participant_key: participantKey, allowed })),
  screenShareStop: (meetingUuid, guestToken, participantKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/signaling/screen-share/stop`, withGuestToken(guestToken, { participant_key: participantKey })),
};

/**
 * Round 5 (Live Collaboration) — بند 7 (Meeting Chat)، بند 8 (Private
 * Chat). منفصل عن signalingApi عمدًا، بنفس منطق فصل
 * MeetingsChatApiController عن MeetingsSignalingApiController في الباك
 * اند (راجع docblock هناك) — كيان بيانات له تاريخ (list/send) بعكس حالة
 * signaling اللحظية البحتة.
 */
/** Remote control of a shared screen (Zoom-style). The screen owner must approve; one controller at a time. */
export const remoteControlApi = {
  request: (meetingUuid, guestToken, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/remote-control/request`, withGuestToken(guestToken, { target_key: targetKey })),
  respond: (meetingUuid, guestToken, controllerKey, allow) =>
    api.post(`/api/v1/meetings/${meetingUuid}/remote-control/respond`, withGuestToken(guestToken, { controller_key: controllerKey, allow })),
  stop: (meetingUuid, guestToken) =>
    api.post(`/api/v1/meetings/${meetingUuid}/remote-control/stop`, withGuestToken(guestToken, {})),
  input: (meetingUuid, guestToken, events) =>
    api.post(`/api/v1/meetings/${meetingUuid}/remote-control/input`, withGuestToken(guestToken, { events })),
};

export const chatApi = {
  /** history عند فتح شاشة الاجتماع/بعد إعادة اتصال. الرد بالفعل مفلتر من الباك اند لبس اللي الـ actor ده مسموحله يشوفه (عام + خاص بعته/استلمه). */
  list: (meetingUuid, guestToken, afterId) => {
    const qs = new URLSearchParams();
    if (guestToken) qs.set('guest_token', guestToken);
    if (afterId) qs.set('after_id', String(afterId));
    const s = qs.toString();
    return api.get(`/api/v1/meetings/${meetingUuid}/chat${s ? `?${s}` : ''}`);
  },
  /** رسالة عامة (recipient_key فاضي) أو خاصة (recipient_key = actor key المستقبل). */
  send: (meetingUuid, guestToken, data) => {
    // With an attachment the request is multipart (any file type; the server scans it before accepting it).
    if (data && data.file) {
      const form = new FormData();
      form.append('file', data.file);
      if (data.body) form.append('body', data.body);
      if (data.recipient_key) form.append('recipient_key', data.recipient_key);
      if (data.reply_to_message_id) form.append('reply_to_message_id', String(data.reply_to_message_id));
      if (guestToken) form.append('guest_token', guestToken);
      return api.postForm(`/api/v1/meetings/${meetingUuid}/chat`, form);
    }
    return api.post(`/api/v1/meetings/${meetingUuid}/chat`, withGuestToken(guestToken, data));
  },
  /** Delete a message for EVERYONE: its sender, or a host/co-host (public messages). */
  destroy: (meetingUuid, guestToken, messageId) =>
    api.del(`/api/v1/meetings/${meetingUuid}/chat/${messageId}`, withGuestToken(guestToken, {})),
  /** toggle: نفس الإيموجي تاني من نفس الشخص بيشيلها. */
  react: (meetingUuid, guestToken, messageId, emoji) =>
    api.post(`/api/v1/meetings/${meetingUuid}/chat/${messageId}/react`, withGuestToken(guestToken, { emoji })),
};

/**
 * Round 6 (Host Controls) — بند 5 (Participants Panel). `targetKey` is
 * always an actor key ('user:5' or 'guest:12'), resolved server-side via
 * MeetingSignalingService::resolveTargetActor() — exact same shape as
 * screenShareStop() above. See MeetingsHostControlApiController's
 * docblock for the 403-vs-404 distinction on failure (not modeled here —
 * the caller just surfaces err.message from the api client as-is).
 */
/** POST /meetings/{uuid}/end — host/co-host only: closes the meeting for EVERYONE (everybody gets the "meeting ended" screen). */
export const meetingLifecycleApi = {
  end: (meetingUuid) => api.post(`/api/v1/meetings/${meetingUuid}/end`, {}),
};

export const hostControlApi = {
  lock: (meetingUuid, locked) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/lock`, { locked }),
  mute: (meetingUuid, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/mute`, { participant_key: targetKey }),
  disableCamera: (meetingUuid, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/disable-camera`, { participant_key: targetKey }),
  remove: (meetingUuid, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/remove`, { participant_key: targetKey }),
  promote: (meetingUuid, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/promote`, { participant_key: targetKey }),
  demote: (meetingUuid, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/demote`, { participant_key: targetKey }),
  transferHost: (meetingUuid, targetKey) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/transfer-host`, { participant_key: targetKey }),
  /** Live chat policy: { chat_enabled?: bool, chat_history?: 'keep' | 'hide' }. */
  chatSettings: (meetingUuid, changes) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/chat-settings`, changes),
  /** Silence / un-silence one person in the chat. */
  chatMute: (meetingUuid, targetKey, muted) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/chat-mute`, { participant_key: targetKey, muted }),
  /** Wipe the public chat for everybody. */
  chatClear: (meetingUuid) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/chat-clear`, {}),
  /** Mute every participant except moderators. */
  muteAll: (meetingUuid) =>
    api.post(`/api/v1/meetings/${meetingUuid}/host-controls/mute-all`, {}),
};

/**
 * Round 7 (Collaboration Extras) — بند 19 (File Sharing)، بند 20
 * (Meeting Notes + Action Items)، بند 21 (Polls). Same uip.auth.optional
 * shape as chatApi (guests who were admitted can read/act on all three —
 * see each controller's own docblock for the write-side restrictions
 * MeetingFileService/MeetingNotesService/MeetingPollService enforce
 * server-side regardless of what the UI shows).
 *
 * filesApi.store() is the one call here that isn't JSON — `file` is a
 * browser File object, boxed into FormData so the browser sets its own
 * multipart boundary; `api.postForm` (see api/client's own helper) skips
 * the client's default `Content-Type: application/json` for exactly this
 * reason.
 */
export const filesApi = {
  list: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/files${qs}`);
  },
  store: (meetingUuid, guestToken, file) => {
    const form = new FormData();
    form.append('file', file);
    if (guestToken) form.append('guest_token', guestToken);
    return api.postForm(`/api/v1/meetings/${meetingUuid}/files`, form);
  },
  destroy: (meetingUuid, guestToken, fileId) =>
    api.del(`/api/v1/meetings/${meetingUuid}/files/${fileId}`, withGuestToken(guestToken, {})),
};

export const notesApi = {
  show: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/notes${qs}`);
  },
  update: (meetingUuid, guestToken, body) =>
    api.put(`/api/v1/meetings/${meetingUuid}/notes`, withGuestToken(guestToken, { body })),
  listItems: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/action-items${qs}`);
  },
  createItem: (meetingUuid, guestToken, data) =>
    api.post(`/api/v1/meetings/${meetingUuid}/action-items`, withGuestToken(guestToken, data)),
  updateItem: (meetingUuid, guestToken, itemId, data) =>
    api.patch(`/api/v1/meetings/${meetingUuid}/action-items/${itemId}`, withGuestToken(guestToken, data)),
  deleteItem: (meetingUuid, guestToken, itemId) =>
    api.del(`/api/v1/meetings/${meetingUuid}/action-items/${itemId}`, withGuestToken(guestToken, {})),
};

/**
 * Round 7 (Collaboration Extras) — بند 17 (Attendance Tracking). `export`
 * returns a raw CSV `Response` (not JSON — see the controller's
 * `Response::make(..., 'Content-Type' => 'text/csv')`), same shape
 * `api.get()`'s own rawRequest() already falls back to for a non-JSON
 * content-type, so the caller does `(await attendanceApi.export(...)).blob()`
 * — same idiom as AdminAuditLogs.jsx's own CSV export, just routed
 * through the shared `api` client instead of a bare `fetch()` since this
 * one already carries the Bearer token that way.
 */
export const attendanceApi = {
  report: (meetingUuid) => api.get(`/api/v1/meetings/${meetingUuid}/attendance/report`),
  export: (meetingUuid) => api.get(`/api/v1/meetings/${meetingUuid}/attendance/export`),
};

/**
 * Round 8 (Invitations & Calendar) addition. بند 13 (single invite already
 * existed since Round 1 as MeetingsApiController::storeInvitation/
 * myInvitations/respondToInvitation — grouped here now instead of split
 * across ad-hoc api.* calls, same "one export per feature surface"
 * convention as attendanceApi/hostControlApi above; bulk() is the new
 * MeetingsInvitationsApiController::bulk() endpoint, see
 * MeetingInvitationService's own docblock for the targets[] shapes it
 * accepts) and بند 14 (calendarApi). Both plain `uip.auth`, no
 * guestToken — a guest never sees invitations or the calendar (no portal
 * to show it in), same shape as hostControlApi/attendanceApi.
 */
export const invitationsApi = {
  /** GET /api/v1/meetings/invitations — current user's own pending invitations, across every meeting. */
  mine: () => api.get('/api/v1/meetings/invitations'),
  /** GET /api/v1/meetings/{uuid}/invitations — host/co-host only (canManage). */
  listFor: (meetingUuid) => api.get(`/api/v1/meetings/${meetingUuid}/invitations`),
  /** POST .../invitations — single invite by user_id, host/co-host only. */
  send: (meetingUuid, data) => api.post(`/api/v1/meetings/${meetingUuid}/invitations`, data),
  /** POST .../invitations/bulk — {targets: array[], message?}, host/co-host only. */
  bulk: (meetingUuid, data) => api.post(`/api/v1/meetings/${meetingUuid}/invitations/bulk`, data),
  /** POST .../invitations/{id}/respond — {accept: bool}, invited user only. */
  respond: (meetingUuid, invitationId, accept) =>
    api.post(`/api/v1/meetings/${meetingUuid}/invitations/${invitationId}/respond`, { accept }),
};

/** بند 14 — Calendar (Day/Week/Month). The view granularity is a frontend-only concept (MeetingCalendar.jsx computes start/end); the API itself just takes a date range. */
export const calendarApi = {
  forRange: (start, end) => api.get('/api/v1/meetings/calendar', { start, end }),
};

export const pollsApi = {
  list: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/polls${qs}`);
  },
  create: (meetingUuid, guestToken, data) =>
    api.post(`/api/v1/meetings/${meetingUuid}/polls`, withGuestToken(guestToken, data)),
  vote: (meetingUuid, guestToken, pollId, optionIds) =>
    api.post(`/api/v1/meetings/${meetingUuid}/polls/${pollId}/vote`, withGuestToken(guestToken, { option_ids: optionIds })),
  close: (meetingUuid, guestToken, pollId) =>
    api.post(`/api/v1/meetings/${meetingUuid}/polls/${pollId}/close`, withGuestToken(guestToken, {})),
};

/**
 * Round 9 (Recording) — بند 18. Same uip.auth.optional shape as filesApi/
 * notesApi/pollsApi above (a guest who was admitted can list/start/stop —
 * see MeetingsRecordingsApiController's own docblock; start/stop/destroy
 * are re-gated host/co-host-only server-side regardless of what the room
 * UI shows, same "these are UI affordances only" note as every other
 * manager-only action in useMeetingRoom).
 *
 * stop() is the one call here shaped like filesApi.store() — `file` is
 * the Blob MediaRecorder produced client-side (see useMeetingRoom's own
 * "بند 18" section for why the actual recording never touches the
 * backend until the browser is done producing it), boxed into FormData
 * the same way.
 */
export const recordingsApi = {
  list: (meetingUuid, guestToken) => {
    const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
    return api.get(`/api/v1/meetings/${meetingUuid}/recordings${qs}`);
  },
  start: (meetingUuid, guestToken, kind) =>
    api.post(`/api/v1/meetings/${meetingUuid}/recordings`, withGuestToken(guestToken, { kind })),
  stop: (meetingUuid, guestToken, recordingId, blob, filename) => {
    const form = new FormData();
    form.append('file', blob, filename);
    if (guestToken) form.append('guest_token', guestToken);
    return api.postForm(`/api/v1/meetings/${meetingUuid}/recordings/${recordingId}/stop`, form);
  },
  destroy: (meetingUuid, guestToken, recordingId) =>
    api.del(`/api/v1/meetings/${meetingUuid}/recordings/${recordingId}`, withGuestToken(guestToken, {})),
};

/**
 * Round 10 (Admin & Docs) — بند 15. Plain `uip.auth`, no guestToken — a
 * guest never lands on MeetingDetails.jsx (no portal to show it in), same
 * reasoning as invitationsApi/attendanceApi above. Server-side re-gated to
 * host/co-host only (MeetingsAnalyticsApiController::forMeeting() ->
 * MeetingPolicyService::canManage()), so this is just the one call —
 * MeetingDetails.jsx hides the card entirely rather than showing a 403.
 */
export const analyticsApi = {
  forMeeting: (meetingUuid) => api.get(`/api/v1/meetings/${meetingUuid}/analytics`),
};
