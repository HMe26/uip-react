import { useCallback, useEffect, useRef, useState } from 'react';
import { attachNoiseSuppressor } from '../lib/calls/noiseSuppress';
import { attachEchoGate, echoGateEnabled, setRemoteAudio, clearRemoteAudio, tightenEchoGate } from '../lib/calls/echoGate';
import { createCameraFx, cameraFxSupported } from '../lib/cameraFx';
import { watchScreenCapture } from '../lib/captureGuard';
import { createMeetingEcho, presenceChannelName, personalChannelName, signalingApi, chatApi, hostControlApi, meetingLifecycleApi, filesApi, notesApi, pollsApi, recordingsApi, remoteControlApi, sfuApi, leaveOnUnload, isAlreadyInMeetingError, isSessionReplacedError } from '../lib/meetingSignaling';
import { REMOTE_CONTROL_CHANNEL } from '../lib/remoteControlReceiver';
import { createMeetingTransport } from '../lib/sfu/meetingTransport';

/**
 * Round 3 (Signaling) + Round 4 (WebRTC Core). Owns:
 *  - the local camera/mic MediaStream,
 *  - one RTCPeerConnection per other participant (mesh — every browser
 *    talks to every other browser directly, capped at
 *    MeetingPolicyService::maxMeshParticipants(), surfaced here as
 *    `meshCapacity` from GET .../roster),
 *  - the presence-channel subscription that tells us who else is here,
 *  - and SDP offer/answer/ICE-candidate exchange over that same channel's
 *    client events (`whisper`) — never through Laravel at all, per
 *    config/webrtc.php's docblock.
 *
 * Signaling glare avoidance: whoever *joins* second is the one who
 * offers. `here()` fires once, right after we join, with everyone
 * already in the room — we offer to each of them (we're the new
 * arrival). `joining()` fires later for people who arrive after us — we
 * do NOT offer to them (they'll offer to us, since from their `here()`
 * we're an existing member). This one-directional rule means no two
 * peers ever race to send simultaneous offers to each other.
 *
 * `guestToken` is null for a signed-in participant (Bearer token on the
 * `api` client covers auth) and the guest's short-lived token
 * (MeetingLobbyService::issueGuestToken) for a guest — every REST/whisper
 * call below just threads it through, same as Round 2's lobby calls.
 *
 * Round 5 (Live Collaboration) additions — بند 7/8 (Chat, public +
 * private), بند 11 (Raise Hand + ephemeral Reactions), بند 9 (Screen
 * Sharing host policies). Chat/hand/reaction/screen-share-policy events
 * all ride the *same* presence channel this hook already joins for
 * Round 3/4 (no second subscription there) — the one addition is a
 * private per-actor "inbox" channel (personalChannelName()) for private
 * chat messages addressed to us specifically (see
 * MeetingChatService::broadcast()'s docblock for why a private message
 * never touches the public presence channel at all).
 *
 * `isHost` gates the screen-share host-policy actions client-side (the
 * buttons simply don't render for non-hosts) — the backend is the real
 * authority and re-checks role on every one of those calls regardless
 * (MeetingSignalingService::setScreenSharingLock() and friends).
 *
 * Round 6 (Host Controls) additions — بند 5 (Participants Panel:
 * mute/disable-camera/remove/promote/demote/transfer-host/lock). `myRole`
 * tracks the local actor's own role live ('host'|'co_host'|'participant'
 * — a guest is never a manager, so it's never 'guest' here), seeded from
 * the `isHost` prop and kept current by the `.participant.role_changed`/
 * `.meeting.host_transferred` listeners below whenever *we* are the
 * target (promoted/demoted/handed the host role by someone else — the
 * same events patch other participants' `role` field in the
 * `participants` map when *they're* the target instead). `isManager`
 * (host or co-host) mirrors MeetingPolicyService::canManage() exactly —
 * gates mute/disable-camera/remove(non-co-host)/lock; the stricter
 * primary-host-only actions (remove a co-host, promote, demote, transfer
 * host) are gated with `myRole === 'host'` directly at the call site
 * instead, same asymmetry as MeetingHostControlService's own
 * requireManager()-vs-requirePrimaryHost() split. As with the screen-
 * share policies, the backend re-checks all of this regardless — these
 * are UI affordances only.
 *
 * Round 7 (Collaboration Extras) additions — بند 19 (File Sharing), بند
 * 20 (Meeting Notes + Action Items), بند 21 (Polls). All three fetch
 * their initial snapshot alongside roster/chat in `setup()` below, then
 * stay live off the same presence channel (no extra subscription, same
 * pattern as every Round 5/6 addition). Notes body edits and every
 * action-item/poll write are `isManager`-gated client-side exactly like
 * `myRole`/`isManager` above — MeetingNotesService/MeetingPollService
 * re-check on the backend regardless, these are UI affordances only.
 * Voting and file sharing themselves are open to any actor present
 * (including a guest) — only *creating/closing* a poll, *editing* notes/
 * action items, and *deleting someone else's file* are manager-gated.
 *
 * Round 9 (Recording) addition — بند 18. "Client-side recording as a
 * practical temporary solution (without SFU)" (see
 * MeetingRecordingService's own docblock): there is no media server
 * compositing anything, so *this browser* — specifically, whichever
 * manager's browser called `startRecording()` — renders every visible
 * tile onto a hidden `<canvas>` (mirroring MeetingRoomShell's own grid,
 * redrawn every animation frame off the *live* `participants`/
 * `localStream` state so newly-joined participants appear without
 * restarting anything) and mixes every stream's audio through a Web
 * Audio graph, `canvas.captureStream()` + the mixed audio track feed a
 * single `MediaRecorder`. Start/stop of the *server-side row*
 * (recordingsApi.start/stop, who may see the "Recording" indicator,
 * status transitions) is real-time for everyone via the presence
 * channel exactly like files/notes/polls above — but the recorded
 * bytes only ever exist in the browser that's actually running the
 * MediaRecorder, so `stopRecordingLocal()` (the one that uploads the
 * finished Blob) only ever makes sense from that same browser
 * (`isRecordingLocally`) — a *different* co-host sees the "Recording…"
 * indicator like everyone else but has no local Blob to stop with, so
 * RecordingsPanel doesn't offer them a stop button (see its own
 * docblock).
 */
// Rolling log, readable from the in-room "Diagnostics" panel (so a problem can be reported with one copy/paste, no devtools needed).
const logBuf = [];
export const meetingLog = () => logBuf.slice();
const dbg = (...a) => {
  try {
    const line = `${new Date().toTimeString().slice(0, 8)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
    logBuf.push(line);
    if (logBuf.length > 120) logBuf.shift();
    console.info('[meeting]', ...a);
  } catch { /* no console */ }
};

const REACTION_EMOJI = { thumbs_up: '👍', applause: '👏', laugh: '😂', heart: '❤️', celebrate: '🎉' };

// Noise isolation choice is shared with 1:1 calls (same key CallContext uses), so one switch governs both.
const NOISE_KEY = 'uip.call.noise';
const readNoisePref = () => { try { return localStorage.getItem(NOISE_KEY) !== '0'; } catch { return true; } };
const writeNoisePref = (on) => { try { localStorage.setItem(NOISE_KEY, on ? '1' : '0'); } catch { /* private mode */ } };

/**
 * Microphone constraints for a room. Echo cancellation is a hard `true` (the browser can't quietly skip it). Auto-gain is OFF
 * whenever neural isolation is available: AGC keeps raising a quiet mic, which turns room noise into hiss and makes two
 * nearby devices start whistling. The legacy goog* switches keep older Chromium / WebView builds on the same settings.
 */
function buildAudioConstraints(noise) {
  return {
    echoCancellation: true,
    noiseSuppression: noise,
    // ONE gain stage only. With neural isolation the leveler + make-up gain inside the isolation graph already lift a quiet mic, so the
    // browser's AGC must stay off: AGC + compressor + make-up stacked on top of each other made the voice pump, hiss and clip.
    autoGainControl: true, // same as 1:1 calls (which sound right): the browser's own echo canceller + noise suppressor + auto gain
    voiceIsolation: { ideal: noise },
    channelCount: { ideal: 1 },
  };
}

/**
 * Opus tuning on MY description (the other side's encoder reads it): in-band FEC (a lost packet is rebuilt instead of leaving a
 * gap), mono, 64 kbps max (plenty for speech), no DTX (DTX makes the voice "pump" next to noise isolation). Audio only — video
 * bitrate is handled per-peer by tuneSenders(). Anything unexpected returns the SDP untouched.
 */
function tuneAudioSdp(sdp) {
  if (typeof sdp !== 'string') return sdp;
  try {
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);
    const opus = lines.map((l) => /^a=rtpmap:(\d+) opus\/48000/i.exec(l)).filter(Boolean).map((m) => m[1]);
    if (!opus.length) return sdp;
    const extra = { useinbandfec: '1', stereo: '0', 'sprop-stereo': '0', usedtx: '0', maxaveragebitrate: '64000', maxplaybackrate: '48000' };
    const merge = (existing) => {
      const map = new Map(existing.split(';').filter(Boolean).map((x) => { const [k, ...v] = x.split('='); return [k.trim(), v.join('=')]; }));
      Object.entries(extra).forEach(([k, v]) => map.set(k, v));
      return Array.from(map.entries()).map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';');
    };
    const out = [];
    lines.forEach((ln) => {
      const f = /^a=fmtp:(\d+) (.*)$/.exec(ln);
      if (f && opus.includes(f[1])) { out.push(`a=fmtp:${f[1]} ${merge(f[2])}`); return; }
      out.push(ln);
      const r = /^a=rtpmap:(\d+) opus\/48000/i.exec(ln);
      if (r && !lines.some((x) => x.startsWith(`a=fmtp:${r[1]} `))) out.push(`a=fmtp:${r[1]} ${merge('')}`);
    });
    return out.join(eol);
  } catch { return sdp; }
}

/**
 * Per-peer sender limits. In a mesh every participant uploads one copy of their video PER other person, so without a cap two or
 * three 720p streams saturate a home uplink and the packet loss hits the voice first ("robotic" / cutting audio). Voice gets a
 * small fixed budget and top priority; video is capped and shrinks as the room grows. Must run after the local description is set.
 */
/**
 * Camera quality tier by room size. In a mesh the browser ENCODES the camera once per other person and DECODES one stream per other
 * person, so the cost grows with (n-1): at 5 people a laptop was running 4 x 720p30 encoders + 4 decoders, the CPU / uplink saturated,
 * packets were dropped and the voice froze for everybody. Tiles are small in a big room anyway, so the picture shrinks as people join
 * (360p at 3 peers, 240p at 4, 180p from 5) and the frame rate drops with it: ~15x less encoding work at 6 people than before.
 */
function cameraTier(peerCount) {
  if (peerCount <= 1) return { scale: 1, fps: 30, bps: 1_500_000 };   // 1:1 — full quality
  if (peerCount === 2) return { scale: 1.5, fps: 30, bps: 800_000 };  // 480p
  if (peerCount === 3) return { scale: 2, fps: 24, bps: 450_000 };    // 360p
  if (peerCount === 4) return { scale: 3, fps: 20, bps: 250_000 };    // 240p
  return { scale: 4, fps: 15, bps: 150_000 };                         // 180p, 5+ others
}

async function tuneSenders(pc, peerCount) {
  const tier = cameraTier(peerCount);
  for (const sender of pc.getSenders()) {
    try {
      if (!sender.track) continue;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      const enc = params.encodings[0];
      if (sender.track.kind === 'audio') {
        // the voice always gets its own small, high-priority budget so it survives when video has to back off
        enc.maxBitrate = 64000;
        enc.priority = 'high';
        enc.networkPriority = 'high';
      } else {
        const isScreen = sender.track.contentHint === 'detail'; // only the screen track is tagged 'detail'
        if (isScreen) {
          enc.maxBitrate = Math.max(600000, Math.min(2500000, Math.floor(3_000_000 / Math.max(1, peerCount))));
          enc.networkPriority = 'medium';
          enc.scaleResolutionDownBy = 1;          // text must stay readable
          enc.maxFramerate = peerCount >= 4 ? 12 : 24;
        } else {
          enc.maxBitrate = tier.bps;
          enc.networkPriority = 'low';
          enc.scaleResolutionDownBy = tier.scale;
          enc.maxFramerate = tier.fps;
          params.degradationPreference = peerCount <= 2 ? 'maintain-resolution' : 'balanced';
        }
      }
      await sender.setParameters(params);
    } catch (e) { dbg('sender tuning skipped', e?.message); }
  }
}

/** Keep video offers small: Chrome lists AV1/VP9/H264/VP8 + rtx/red/ulpfec variants, which can push an SDP past a signaling server's message limit. VP8/H264 are enough. */
function preferLightCodecs(pc) {
  try {
    const caps = RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities('video');
    if (!caps) return;
    const keep = ['video/vp8', 'video/h264', 'video/rtx', 'video/red', 'video/ulpfec'];
    const light = caps.codecs.filter((c) => keep.includes(c.mimeType.toLowerCase()));
    if (!light.some((c) => c.mimeType.toLowerCase() === 'video/vp8')) return;
    light.sort((a, b) => (b.mimeType.toLowerCase() === 'video/vp8') - (a.mimeType.toLowerCase() === 'video/vp8'));
    pc.getTransceivers().forEach((t) => {
      if (t.receiver && t.receiver.track && t.receiver.track.kind === 'video' && t.setCodecPreferences) t.setCodecPreferences(light);
    });
  } catch (e) { dbg('codec preferences skipped', e?.message); }
}

/**
 * A silent, black video track used when this participant has no camera (none attached, denied, busy) or hasn't turned one on yet.
 * Every peer connection then always has a real, replaceable video sender — which is what lets screen sharing work with the
 * camera off or missing (it used to piggy-back on the camera's sender and silently did nothing without one).
 */
function makePlaceholderVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const track = canvas.captureStream(1).getVideoTracks()[0];
  track.__placeholder = true;
  return track;
}

/** Single place that sends a signaling message, so size and delivery can be seen in the console. */
function sendSignal(channel, to, from, kind, data) {
  const payload = { to, from, kind, data };
  try {
    const size = JSON.stringify(payload).length;
    dbg('send', kind, 'to', to, `${size}B`);
    if (size > 9000) dbg('WARNING: signaling message is large; raise REVERB_APP_MAX_MESSAGE_SIZE on the Reverb service');
  } catch { /* ignore */ }
  channel?.whisper('signal', payload);
}

/** Echo gives presence callbacks the `user_info` object itself ({id, name, role, is_guest}) — not {id, info}. Accept both shapes. */
function normMember(m) {
  const info = (m && typeof m.info === 'object' && m.info) || m || {};
  return { id: m?.id ?? info.id ?? null, name: info.name || '', role: info.role || 'participant', isGuest: !!info.is_guest };
}

export function useMeetingRoom({
  meetingUuid, guestToken = null, myKey, myDisplayName, deviceDefaults,
  isHost = false, screenSharingLockedInitial = false, chatEnabledInitial = true, meetingLockedInitial = false,
}) {
  const [participants, setParticipants] = useState({}); // key -> {displayName, role, isHost, isGuest, micEnabled, cameraEnabled, screenSharing, handRaised, screenShareAllowed, connectionState, connectionQuality, remoteStream}
  const [localStream, setLocalStream] = useState(null);
  // Always join with the mic AND camera OFF — the person turns them on themselves (meeting-level defaults no longer force them on).
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const cameraEnabledRef = useRef(cameraEnabled);
  cameraEnabledRef.current = cameraEnabled;
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null); // local preview of what we are presenting (the camera stream is untouched)
  const [hasCamera, setHasCamera] = useState(true); // false when no real camera track exists (only the black placeholder)
  const [meshCapacity, setMeshCapacity] = useState(null);
  const [transport, setTransport] = useState('mesh'); // 'mesh' | 'sfu' — decided per room by the server (MeetingTransportService), see lib/sfu/meetingTransport.js
  const [hasTurn, setHasTurn] = useState(null); // null = unknown yet; false = server has no TURN relay configured
  const [status, setStatus] = useState('connecting'); // connecting | connected | error
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // transient toast-style message (e.g. "the host stopped your screen share")
  const [meetingStatus, setMeetingStatus] = useState(null);

  // Round 5 — بند 7/8 (Chat).
  const [chatMessages, setChatMessages] = useState([]); // ascending by id, already filtered server-side to what we're allowed to see
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  // Live chat policy (host-controlled, pushed over `.chat.settings.changed`): on/off, history for late joiners, who is silenced.
  const [chatEnabled, setChatEnabled] = useState(chatEnabledInitial);
  const [chatHistory, setChatHistory] = useState('keep'); // 'keep' | 'hide'
  const [chatMutedKeys, setChatMutedKeys] = useState([]);

  // Round 5 — بند 11 (Raise Hand + Reactions).
  const [handRaised, setHandRaised] = useState(false);
  const [reactions, setReactions] = useState([]); // ephemeral: [{id, key, displayName, type, emoji}], auto-pruned
  const [cameraLook, setCameraLookState] = useState({ filter: 'none', background: 'none' });
  const [reactionLog, setReactionLog] = useState([]); // same events, kept (capped) so the chat panel can list "X reacted 👍" like Zoom
  // Noise isolation (RNNoise) — `noiseOn` is the switch, `noiseAvailable` is whether the neural graph could be built here.
  const [noiseOn, setNoiseOn] = useState(readNoisePref);
  const [noiseAvailable, setNoiseAvailable] = useState(false);
  // "Speakers off" (same room): when two devices sit in one room each mic hears the other's speaker, which no software can cancel
  // (it is a different device's output, so the echo canceller has no reference). Cutting remote playback on this device breaks the loop.
  const [speakersMuted, setSpeakersMuted] = useState(false);

  // Round 5 — بند 9 (Screen Sharing host policies).
  const [screenSharingLocked, setScreenSharingLocked] = useState(!!screenSharingLockedInitial);
  const [myScreenShareAllowed, setMyScreenShareAllowed] = useState(null); // tri-state override: null=no override

  // Remote control of a shared screen (Zoom-style): who controls whom, requests waiting for my answer, my own pending request.
  const [remoteControl, setRemoteControl] = useState(null); // {controllerKey, controllerName, targetKey} while granted
  const [rcIncoming, setRcIncoming] = useState([]); // [{controllerKey, controllerName}] asking to control MY screen
  const [rcPendingTarget, setRcPendingTarget] = useState(null); // targetKey I asked, waiting for the answer
  const [rcNotice, setRcNotice] = useState(null); // 'denied' | 'stopped'
  const rcChannelRef = useRef(null);
  const remoteControlRef = useRef(null);
  remoteControlRef.current = remoteControl;

  // Round 6 — بند 5 (Host Controls / Participants Panel).
  const [myRole, setMyRole] = useState(isHost ? 'host' : 'participant'); // 'host' | 'co_host' | 'participant' — see docblock above for why co-host isn't seeded here
  const myRoleRef = useRef(isHost ? 'host' : 'participant');
  myRoleRef.current = myRole;
  const [meetingLocked, setMeetingLocked] = useState(!!meetingLockedInitial); // "Lock meeting" — blocks new joiners; doesn't affect anyone already in
  const [sessionConflict, setSessionConflict] = useState(null); // 'already_open' (this tab was refused) | 'replaced' (another tab took over) — one live session per person
  const [kicked, setKicked] = useState(null); // {byDisplayName} once WE were removed by a host/co-host — MeetingRoomShell renders a dedicated screen for this

  // Round 7 — بند 19 (File Sharing).
  const [files, setFiles] = useState([]); // descending by created_at isn't guaranteed server-side, so appended/removed in place instead of re-sorted

  // Round 7 — بند 20 (Meeting Notes + Action Items).
  const [notes, setNotes] = useState({ body: '', lastEditedByDisplayName: null, lastEditedAt: null });
  const [actionItems, setActionItems] = useState([]);

  // Round 7 — بند 21 (Polls). keyed by poll_id so `.listen('.meeting.poll_*')` can patch a single entry in place.
  const [polls, setPolls] = useState([]);

  // Round 9 — بند 18 (Recording). `recordings` mirrors the server-side rows
  // for everyone (status only); `isRecordingLocally` is true only in the
  // one browser actually running the MediaRecorder — see docblock above.
  const [recordings, setRecordings] = useState([]);
  const [isRecordingLocally, setIsRecordingLocally] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const localRecorderRef = useRef(null); // { id, kind, mediaRecorder, chunks, canvas, ctx, rafId, audioCtx, audioDest, audioSources: Map }
  const videoElsRef = useRef(new Map()); // key -> hidden <video>, kept in sync with localStream/participants[*].remoteStream regardless of whether a recording is running
  const hiddenContainerRef = useRef(null);
  const participantsRef = useRef({}); // live mirror of `participants` state, read from the rAF draw loop / audio reconnection below (both run outside React's render cycle)

  const echoRef = useRef(null);
  const channelRef = useRef(null);
  // Whiteboard transport: small client events ("whispers") on the same presence channel the calls use — no server round-trip, no DB.
  const wbHandlersRef = useRef(new Set());
  const wbSend = useCallback((payload) => { try { channelRef.current?.whisper('wb', payload); } catch { /* channel not ready yet */ } }, []);
  const wbOn = useCallback((fn) => { wbHandlersRef.current.add(fn); return () => wbHandlersRef.current.delete(fn); }, []);
  const personalChannelRef = useRef(null);
  const peersRef = useRef({}); // key -> RTCPeerConnection
  const pendingCandidatesRef = useRef({}); // key -> RTCIceCandidateInit[] queued before remote description is set
  const localStreamRef = useRef(null);
  const screenTrackRef = useRef(null); // the live screen-capture track while we present, else null
  const hasCameraRef = useRef(true);
  const cameraTrackSendersRef = useRef({}); // key -> RTCRtpSender, for screen-share track swapping
  const iceServersRef = useRef([]);
  // ---- mesh <-> SFU transport (Cloudflare Realtime SFU). Mesh stays the default and the automatic fallback.
  const transportRef = useRef('mesh');
  const transportMgrRef = useRef(null);   // createMeetingTransport() instance, null until the room is set up
  const sourceRef = useRef({});           // key -> 'mesh' | 'sfu': which transport the tile's remoteStream currently comes from
  const meshQualityRef = useRef('good');  // worst mesh connection quality of the last sample (fed to the server's mesh/SFU decision)
  const meshLimitRef = useRef(6);         // MeetingPolicyService::maxMeshParticipants, so a failed SFU only falls back to mesh when mesh is viable
  const switchingRef = useRef(false);
  const remoteStreamsRef = useRef({}); // key -> MediaStream (fallback when ontrack gives no stream)
  const offeredRef = useRef({}); // key -> true when WE sent the offer for that pair (only the offerer retries)
  const offerToRef = useRef(null);
  const leftRef = useRef(false);
  const seenChatIdsRef = useRef(new Set()); // dedupe — the sender gets their own message from the REST response, but also rides the same broadcast as everyone else on the presence channel (Round 5's ChatMessageSent doesn't use toOthers())
  const reactionSeqRef = useRef(0);
  const feedbackHitsRef = useRef([]); // timestamps of detected feedback whistles
  const onFeedbackRef = useRef(null);
  const pushReactionRef = useRef(null);
  const noiseRef = useRef(null); // { stream, setEnabled } from attachNoiseSuppressor()
  const rawCameraTrackRef = useRef(null); // the real camera track, kept alive while an effect track is being sent
  const cameraFxRef = useRef(null); // createCameraFx() instance (lazy: only built the first time an effect is chosen)

  const patchParticipant = useCallback((key, patch) => {
    setParticipants((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }, []);

  const appendChatMessage = useCallback((message) => {
    if (seenChatIdsRef.current.has(message.id)) return;
    seenChatIdsRef.current.add(message.id);
    setChatMessages((prev) => [...prev, message]);
  }, []);

  const applyChatReactionChange = useCallback((messageId, actorKey, emoji, added) => {
    setChatMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m;
      const reactions = m.reactions.map((r) => ({ ...r, actor_keys: [...r.actor_keys] }));
      let entry = reactions.find((r) => r.emoji === emoji);
      if (added) {
        if (!entry) { entry = { emoji, count: 0, actor_keys: [] }; reactions.push(entry); }
        if (!entry.actor_keys.includes(actorKey)) { entry.actor_keys.push(actorKey); entry.count++; }
      } else if (entry) {
        entry.actor_keys = entry.actor_keys.filter((k) => k !== actorKey);
        entry.count = entry.actor_keys.length;
      }
      return { ...m, reactions: reactions.filter((r) => r.count > 0) };
    }));
  }, []);


  /** A message was deleted (by its sender or a moderator): it vanishes from this screen for good. */
  const removeChatMessage = useCallback((messageId) => {
    setChatMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const applyChatSettings = useCallback((s) => {
    if (!s) return;
    if (typeof s.chat_enabled === 'boolean') setChatEnabled(s.chat_enabled);
    if (s.chat_history) setChatHistory(s.chat_history === 'hide' ? 'hide' : 'keep');
    if (Array.isArray(s.muted_keys)) setChatMutedKeys(s.muted_keys);
  }, []);

  // ---- بند 18 (Recording) — hidden compositing surface -------------------
  // Kept current at all times (not just while a recording is running) so
  // starting a recording never has to wait on a first sync, and a
  // participant joining mid-recording is picked up by the very next
  // animation frame with no special-casing.
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(div);
    hiddenContainerRef.current = div;
    return () => {
      videoElsRef.current.forEach((el) => { el.srcObject = null; });
      videoElsRef.current.clear();
      div.remove();
      hiddenContainerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wanted = new Map();
    if (screenStream || localStream) wanted.set('local', screenStream || localStream);
    Object.entries(participants).forEach(([key, p]) => { if (p.remoteStream) wanted.set(key, p.remoteStream); });

    for (const [key, el] of videoElsRef.current) {
      if (!wanted.has(key)) {
        el.srcObject = null;
        el.remove();
        videoElsRef.current.delete(key);
      }
    }
    wanted.forEach((stream, key) => {
      let el = videoElsRef.current.get(key);
      if (!el) {
        el = document.createElement('video');
        el.autoplay = true;
        el.playsInline = true;
        el.muted = true; // audio is captured separately through the Web Audio graph below — playing it here too would double it up in the recording
        hiddenContainerRef.current?.appendChild(el);
        videoElsRef.current.set(key, el);
      }
      if (el.srcObject !== stream) el.srcObject = stream;
      el.play?.().catch(() => {});
    });
  }, [localStream, screenStream, participants]);

  /** Re-syncs the Web Audio mix to whoever's actually here right now — called once at recording start, then again whenever `participants`/`localStream` change while a recording is running. */
  const syncRecordingAudioGraph = useCallback(() => {
    const rec = localRecorderRef.current;
    if (!rec || !rec.audioCtx) return;
    const wanted = new Map();
    if (localStreamRef.current) wanted.set('local', localStreamRef.current);
    Object.entries(participantsRef.current).forEach(([key, p]) => { if (p.remoteStream) wanted.set(key, p.remoteStream); });

    for (const [key, node] of rec.audioSources) {
      if (!wanted.has(key)) {
        try { node.disconnect(); } catch { /* already disconnected */ }
        rec.audioSources.delete(key);
      }
    }
    wanted.forEach((stream, key) => {
      if (rec.audioSources.has(key)) return;
      const track = stream.getAudioTracks()[0];
      if (!track) return;
      try {
        const src = rec.audioCtx.createMediaStreamSource(new MediaStream([track]));
        src.connect(rec.audioDest);
        rec.audioSources.set(key, src);
      } catch { /* a track that's already ended, etc. — skip it, the rest of the mix still works */ }
    });
  }, []);

  useEffect(() => {
    if (isRecordingLocally) syncRecordingAudioGraph();
  }, [isRecordingLocally, participants, localStream, syncRecordingAudioGraph]);

  const drawRecordingFrame = useCallback(() => {
    const rec = localRecorderRef.current;
    if (!rec) return;
    const { ctx, canvas } = rec;
    const entries = Array.from(videoElsRef.current.entries()).filter(([, el]) => el.readyState >= 2 && el.videoWidth > 0);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const n = entries.length || 1;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    entries.forEach(([, el], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const scale = Math.min(cellW / el.videoWidth, cellH / el.videoHeight);
      const dw = el.videoWidth * scale;
      const dh = el.videoHeight * scale;
      const dx = col * cellW + (cellW - dw) / 2;
      const dy = row * cellH + (cellH - dh) / 2;
      try { ctx.drawImage(el, dx, dy, dw, dh); } catch { /* a mid-frame track swap can throw once, harmless — next frame recovers */ }
    });
    rec.rafId = requestAnimationFrame(drawRecordingFrame);
  }, []);

  function pickRecorderMimeType() {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((c) => window.MediaRecorder?.isTypeSupported?.(c)) || '';
  }

  const teardownLocalRecorder = useCallback(() => {
    const rec = localRecorderRef.current;
    if (!rec) return;
    if (rec.rafId) cancelAnimationFrame(rec.rafId);
    rec.audioSources.forEach((node) => { try { node.disconnect(); } catch { /* already disconnected */ } });
    try { rec.audioCtx?.close(); } catch { /* already closed */ }
    rec.captureStream?.getTracks().forEach((t) => t.stop());
    localRecorderRef.current = null;
    setIsRecordingLocally(false);
  }, []);

  /** Manager-only (re-checked server-side by MeetingRecordingService::requireManager) — starts the server-side row, then this browser's own capture (see docblock above for why the two are separate). */
  const startRecording = useCallback(async (kind = 'video') => {
    if (localRecorderRef.current || recordingBusy) return;
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      const json = await recordingsApi.start(meetingUuid, guestToken, kind);
      const recordingId = json.data.id;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioDest = audioCtx.createMediaStreamDestination();

      let canvas = null;
      let ctx = null;
      let captureStream;
      if (kind === 'audio') {
        captureStream = new MediaStream(audioDest.stream.getAudioTracks());
      } else {
        canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        ctx = canvas.getContext('2d');
        const canvasStream = canvas.captureStream(15);
        captureStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDest.stream.getAudioTracks()]);
      }

      localRecorderRef.current = { id: recordingId, kind, canvas, ctx, audioCtx, audioDest, audioSources: new Map(), captureStream, rafId: null };
      if (kind !== 'audio') localRecorderRef.current.rafId = requestAnimationFrame(drawRecordingFrame);
      syncRecordingAudioGraph();

      const mimeType = pickRecorderMimeType();
      const mediaRecorder = new MediaRecorder(captureStream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      localRecorderRef.current.mediaRecorder = mediaRecorder;
      localRecorderRef.current.chunks = chunks;
      localRecorderRef.current.mimeType = mediaRecorder.mimeType || mimeType || 'video/webm';
      mediaRecorder.start(1000);
      setIsRecordingLocally(true);
    } catch (err) {
      teardownLocalRecorder();
      setRecordingError(err?.message || 'Recording could not be started.');
      throw err;
    } finally {
      setRecordingBusy(false);
    }
  }, [meetingUuid, guestToken, recordingBusy, drawRecordingFrame, syncRecordingAudioGraph, teardownLocalRecorder]);

  /** Stops *this browser's* MediaRecorder and uploads the finished Blob — only meaningful when `isRecordingLocally` (see docblock above). */
  const stopRecordingLocal = useCallback(async () => {
    const rec = localRecorderRef.current;
    if (!rec?.mediaRecorder) return;
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      const blob = await new Promise((resolve) => {
        rec.mediaRecorder.addEventListener('stop', () => resolve(new Blob(rec.chunks, { type: rec.mimeType })), { once: true });
        rec.mediaRecorder.stop();
      });
      const json = await recordingsApi.stop(meetingUuid, guestToken, rec.id, blob, `recording-${rec.id}.webm`);
      setRecordings((prev) => (prev.some((r) => r.id === json.data.id) ? prev.map((r) => (r.id === json.data.id ? json.data : r)) : [...prev, json.data]));
    } catch (err) {
      setRecordingError(err?.message || 'The recording could not be uploaded.');
      throw err;
    } finally {
      teardownLocalRecorder();
      setRecordingBusy(false);
    }
  }, [meetingUuid, guestToken, teardownLocalRecorder]);

  const deleteRecording = useCallback((recordingId) => {
    return recordingsApi.destroy(meetingUuid, guestToken, recordingId).then(() => {
      setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
    });
  }, [meetingUuid, guestToken]);


  // ---- peer connection lifecycle --------------------------------------
  const closePeer = useCallback((key) => {
    peersRef.current[key]?.close();
    delete peersRef.current[key];
    delete pendingCandidatesRef.current[key];
    delete cameraTrackSendersRef.current[key];
    delete remoteStreamsRef.current[key];
    delete offeredRef.current[key];
    setRemoteAudio(`meeting:${key}`, null); // the echo gate stops listening to this person
  }, []);

  const createPeer = useCallback((key) => {
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    } catch (e) {
      // a malformed TURN entry makes the constructor throw -> fall back to plain STUN rather than having no connection at all
      dbg('bad iceServers, using STUN only:', e?.message);
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    }
    peersRef.current[key] = pc;
    pendingCandidatesRef.current[key] = pendingCandidatesRef.current[key] || []; // keep candidates that raced ahead of the offer

    const local = localStreamRef.current;
    const hasKind = (kind) => !!local && local.getTracks().some((t) => t.kind === kind);
    if (local) {
      local.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, local);
        if (track.kind === 'video') {
          cameraTrackSendersRef.current[key] = sender;
          // someone joined while we are presenting: they must get the screen, not the camera
          if (screenTrackRef.current) sender.replaceTrack(screenTrackRef.current).catch(() => {});
        }
      });
    }
    // No camera/mic here (denied, or none attached)? We must still RECEIVE everyone else — an offer/answer with no media
    // sections would silently carry nothing in either direction.
    if (!hasKind('audio')) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (!hasKind('video')) pc.addTransceiver('video', { direction: 'recvonly' });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal(channelRef.current, key, myKey, 'ice', e.candidate.toJSON());
      }
    };

    pc.oniceconnectionstatechange = () => dbg('ice', key, pc.iceConnectionState);
    pc.ontrack = (e) => {
      dbg('track', key, e.track.kind);
      // One MediaStream per peer, whatever the browser hands us (some give an empty `streams`): keep adding tracks to it.
      let stream = e.streams && e.streams[0];
      if (!stream) {
        stream = remoteStreamsRef.current[key] || new MediaStream();
        if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      }
      remoteStreamsRef.current[key] = stream;
      if (e.track.kind === 'video' && e.receiver) {
        // smallest jitter buffer the browser allows -> a shared screen follows the presenter with minimal lag (Chrome 114+; no-op elsewhere)
        try { if ('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 0; } catch { /* unsupported */ }
        try { if ('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0; } catch { /* unsupported */ }
      }
      // echo gate: analysis-only copy of this person's voice, so our mic closes while they are audible
      // (only when the half-duplex gate is actually on — it is OFF by default, and without this check every remote voice still got a
      // WebAudio analyser + a getStats() poll every 60 ms: with 4 other people that is ~65 stats calls per second doing nothing.)
      if (e.track.kind === 'audio' && echoGateEnabled()) setRemoteAudio(`meeting:${key}`, new MediaStream([e.track]), e.receiver || null);
      // when the SFU already feeds this tile (room switched to SFU), a late mesh track must not steal it back
      const meshWins = () => !(transportRef.current === 'sfu' && sourceRef.current[key] === 'sfu');
      if (meshWins()) {
        if (transportRef.current === 'mesh') sourceRef.current[key] = 'mesh';
        patchParticipant(key, { remoteStream: stream });
      }
      // a track can be muted at first and unmute when media starts flowing — nudge React so tiles re-bind
      e.track.onunmute = () => { if (meshWins()) patchParticipant(key, { remoteStream: stream }); };
    };

    pc.onconnectionstatechange = () => {
      dbg('pc', key, pc.connectionState);
      const mapped = { connected: 'connected', connecting: 'connecting', new: 'connecting', disconnected: 'reconnecting', failed: 'disconnected', closed: 'disconnected' }[pc.connectionState] || 'connecting';
      patchParticipant(key, { connectionState: mapped });
      if (pc.connectionState === 'failed') {
        signalingApi.reportFailure(meetingUuid, guestToken, 'webrtc', `Peer connection to ${key} failed.`).catch(() => {});
        // we were the offerer for this pair -> start over with a fresh connection (the other side replaces its peer on any new offer)
        if (offeredRef.current[key] && !leftRef.current && channelRef.current) {
          setTimeout(() => { if (peersRef.current[key] === pc && !leftRef.current) offerToRef.current?.(key).catch(() => {}); }, 1500);
        }
      }
    };

    return pc;
  }, [meetingUuid, guestToken, myKey, patchParticipant]);

  const offerTo = useCallback(async (key) => {
    offeredRef.current[key] = true;
    closePeer(key);
    const pc = createPeer(key);
    preferLightCodecs(pc);
    const offer = await pc.createOffer();
    const tunedOffer = { type: offer.type, sdp: tuneAudioSdp(offer.sdp) };
    await pc.setLocalDescription(tunedOffer);
    tuneSenders(pc, Object.keys(peersRef.current).length).catch(() => {});
    sendSignal(channelRef.current, key, myKey, 'offer', tunedOffer);
  }, [createPeer, closePeer, myKey]);
  offerToRef.current = offerTo;

  const handleSignal = useCallback(async ({ to, from, kind, data }) => {
    if (to !== myKey || from === myKey) return;
    dbg('recv', kind, 'from', from);
    try {

    if (kind === 'offer') {
      // a new offer == that person (re)joined or restarted: never reuse an old, possibly dead, connection
      const queuedEarly = pendingCandidatesRef.current[from] || [];
      if (peersRef.current[from]) { peersRef.current[from].close(); delete peersRef.current[from]; }
      pendingCandidatesRef.current[from] = queuedEarly;
      delete offeredRef.current[from];
      const pc = createPeer(from);
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const queued = pendingCandidatesRef.current[from] || [];
      pendingCandidatesRef.current[from] = [];
      for (const cand of queued) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      preferLightCodecs(pc);
      const answer = await pc.createAnswer();
      const tunedAnswer = { type: answer.type, sdp: tuneAudioSdp(answer.sdp) };
      await pc.setLocalDescription(tunedAnswer);
      tuneSenders(pc, Object.keys(peersRef.current).length).catch(() => {});
      sendSignal(channelRef.current, from, myKey, 'answer', tunedAnswer);
    } else if (kind === 'answer') {
      const pc = peersRef.current[from];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const queued = pendingCandidatesRef.current[from] || [];
      pendingCandidatesRef.current[from] = [];
      for (const cand of queued) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    } else if (kind === 'ice') {
      const pc = peersRef.current[from];
      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current[from] = pendingCandidatesRef.current[from] || [];
        pendingCandidatesRef.current[from].push(data);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
    }
    } catch (err) {
      dbg('signal handling failed', kind, err?.message || String(err));
    }
  }, [myKey, createPeer]);

  // ---- transport switching (mesh <-> SFU), make-before-break ------------
  const onSfuRemote = useCallback((key, stream) => {
    if (transportRef.current !== 'sfu') return;
    sourceRef.current[key] = 'sfu';
    patchParticipant(key, { remoteStream: stream, connectionState: 'connected' });
  }, [patchParticipant]);

  /** Publish to the SFU, pull everyone, then drop the mesh connections whose SFU stream arrived. Resolves false when the SFU is unusable. */
  const switchToSfu = useCallback(async () => {
    const mgr = transportMgrRef.current;
    if (!mgr || transportRef.current === 'sfu') return transportRef.current === 'sfu';
    if (switchingRef.current) return false;
    switchingRef.current = true;
    try {
      const ok = await mgr.enterSfu(localStreamRef.current);
      if (!ok) { setNotice({ type: 'sfu_unavailable' }); return false; }
      transportRef.current = 'sfu';
      setTransport('sfu');
      if (screenTrackRef.current) mgr.replaceVideoTrack(screenTrackRef.current); // joined/switched while presenting
      await mgr.syncPeers();
      // mesh peers stay as a safety net until that person's SFU stream is really here
      [2500, 6000, 12000].forEach((ms) => setTimeout(() => {
        if (transportRef.current !== 'sfu') return;
        Object.keys(peersRef.current).forEach((k) => { if (mgr.hasPeerStream(k) && sourceRef.current[k] === 'sfu') closePeer(k); });
      }, ms));
      return true;
    } finally { switchingRef.current = false; }
  }, [closePeer]);

  /** Back to mesh. Only the side with the smaller key offers (both sides offering at once would cancel each other out). */
  const switchToMesh = useCallback(() => {
    if (transportRef.current === 'mesh') return;
    transportRef.current = 'mesh';
    setTransport('mesh');
    Object.keys(participantsRef.current).forEach((k) => {
      if (myKey < k) offerToRef.current?.(k).catch((err) => dbg('mesh offer failed', k, err?.message || String(err)));
    });
    setTimeout(() => { if (transportRef.current === 'mesh') transportMgrRef.current?.leaveSfu(); }, 8000);
  }, [myKey]);

  // ---- setup: local media, ICE servers, roster, presence channel -------
  useEffect(() => {
    let cancelled = false;
    leftRef.current = false;

    async function setup() {
      // one live session per person: claim it BEFORE touching camera/mic or the shared participant state
      try {
        await signalingApi.claimSession(meetingUuid, guestToken);
      } catch (err) {
        if (isAlreadyInMeetingError(err)) { if (!cancelled) setSessionConflict('already_open'); return; }
        // any other failure (old server without the endpoint, transient network): carry on, the channel auth still enforces it
      }
      if (cancelled) return;
      try {
        // echo cancellation + noise suppression are what stop the "voice coming back" echo and the whistle: ask for them explicitly
        const noisePref = readNoisePref();
        const audioC = buildAudioConstraints(noisePref);
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: audioC });
        } catch (firstErr) {
          // no camera (or it is busy)? still join with the mic — and vice versa — instead of joining with nothing
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: audioC }); }
          catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        // Neural noise isolation (RNNoise): always built when supported so the in-room switch can flip it instantly. If it is
        // unavailable we keep the browser's own suppression + echo cancellation (set above) — never break joining.
        // Plain browser microphone by default (exactly like 1:1 calls): routing it through WebAudio / RNNoise made rooms sound choppy.
        // Opt in with localStorage `uip.call.rnnoise` = '1'.
        let useRnn = false;
        try { useRnn = localStorage.getItem('uip.call.rnnoise') === '1'; } catch { /* private mode */ }
        if (useRnn && stream.getAudioTracks().length) {
          const ns = await attachNoiseSuppressor(stream, noisePref, { makeupGain: 1.8, onFeedback: (hz) => onFeedbackRef.current?.(hz) });
          if (cancelled) { (ns ? ns.stream : stream).getTracks().forEach((t) => t.stop()); return; }
          if (ns) { noiseRef.current = ns; stream = ns.stream; setNoiseAvailable(true); }
          dbg('noise isolation', ns ? 'on (RNNoise graph)' : 'unavailable, browser filter only');
        }
        if (stream.getVideoTracks().length === 0) {
          stream.addTrack(makePlaceholderVideoTrack());
          hasCameraRef.current = false;
          setHasCamera(false);
          setCameraEnabled(false);
          signalingApi.mediaState(meetingUuid, guestToken, { camera_enabled: false }).catch(() => {});
        }
        // Forced echo breaker (half-duplex gate, see lib/calls/echoGate.js): the mic is muted while anyone else is audible, so the
        // speaker can never leak back into what we send — no repeating voice, no whistle, even when the browser's canceller is inactive.
        if (stream.getAudioTracks().length && echoGateEnabled()) {
          const gate = await attachEchoGate(stream);
          if (cancelled) { (gate ? gate.stream : stream).getTracks().forEach((t) => t.stop()); return; }
          if (gate) stream = gate.stream;
          dbg('echo gate', gate ? 'on' : 'unavailable, plain mic');
        }
        stream.getVideoTracks().forEach((t) => { t.enabled = hasCameraRef.current ? cameraEnabled : false; });
        stream.getAudioTracks().forEach((t) => { t.enabled = micEnabled; });
        dbg('local media', stream.getTracks().map((t) => t.kind).join('+') || 'none');
        localStreamRef.current = stream;
        if (hasCameraRef.current) rawCameraTrackRef.current = stream.getVideoTracks()[0] || null;
        setLocalStream(stream);
      } catch (gumErr) {
        dbg('getUserMedia failed', gumErr?.name, gumErr?.message);
        signalingApi.reportFailure(meetingUuid, guestToken, 'camera', 'getUserMedia failed in the meeting room.').catch(() => {});
        // Still proceed without a camera/mic — a participant with devices denied should still be able to see + hear everyone
        // else, and to present their screen: give them the placeholder video track so there is a sender to present through.
        try {
          const fallback = new MediaStream([makePlaceholderVideoTrack()]);
          hasCameraRef.current = false;
          setHasCamera(false);
          setCameraEnabled(false);
          localStreamRef.current = fallback;
          setLocalStream(fallback);
        } catch { /* canvas capture unavailable: the old recv-only path below still works */ }
      }

      try {
        const [iceJson, rosterJson, chatJson, filesJson, notesJson, itemsJson, pollsJson, recordingsJson] = await Promise.all([
          signalingApi.iceServers(meetingUuid, guestToken),
          signalingApi.roster(meetingUuid, guestToken),
          chatApi.list(meetingUuid, guestToken).catch(() => ({ data: { messages: [] } })), // chat disabled or transient failure shouldn't block joining the room
          filesApi.list(meetingUuid, guestToken).catch(() => ({ data: { files: [] } })),
          notesApi.show(meetingUuid, guestToken).catch(() => ({ data: { body: '', last_edited_by_display_name: null, last_edited_at: null } })),
          notesApi.listItems(meetingUuid, guestToken).catch(() => ({ data: { action_items: [] } })),
          pollsApi.list(meetingUuid, guestToken).catch(() => ({ data: { polls: [] } })),
          recordingsApi.list(meetingUuid, guestToken).catch(() => ({ data: { recordings: [] } })),
        ]);
        if (cancelled) return;
        iceServersRef.current = iceJson.data.ice_servers || [];
        if (typeof iceJson.data.has_turn === 'boolean') setHasTurn(iceJson.data.has_turn);
        setMeshCapacity(rosterJson.data.mesh_capacity || null);
        if (rosterJson.data.mesh_capacity?.limit) meshLimitRef.current = rosterJson.data.mesh_capacity.limit;
        try {
          const mgr = createMeetingTransport({
            meetingUuid, guestToken, myKey, sfuApi, signalingApi,
            getChannel: () => channelRef.current,
            getIceServers: () => iceServersRef.current,
            getMeshQuality: () => meshQualityRef.current,
            getTransport: () => transportRef.current,
            onRemote: onSfuRemote,
            onServerMode: (mode) => { if (mode === 'sfu') switchToSfu(); else switchToMesh(); },
            onSfuLost: (kind) => {
              if (kind === 'retry') return localStreamRef.current;
              // gave up on the SFU: mesh is only a sane fallback when the room is small enough for it
              if (Object.keys(participantsRef.current).length + 1 <= meshLimitRef.current) switchToMesh();
              else setNotice({ type: 'sfu_unavailable' });
              return null;
            },
            log: dbg,
          });
          transportMgrRef.current = mgr;
          await mgr.init(); // GET sfu/config — failing here just means "mesh only"
        } catch (e) { dbg('sfu manager unavailable, mesh only', e?.message); transportMgrRef.current = null; }
        setFiles(filesJson.data?.files || []);
        setNotes({
          body: notesJson.data?.body || '',
          lastEditedByDisplayName: notesJson.data?.last_edited_by_display_name || null,
          lastEditedAt: notesJson.data?.last_edited_at || null,
        });
        setActionItems(itemsJson.data?.action_items || []);
        setPolls(pollsJson.data?.polls || []);
        setRecordings(recordingsJson.data?.recordings || []);

        const seeded = {};
        (rosterJson.data.roster || []).forEach((p) => {
          if (p.key === myKey) return;
          seeded[p.key] = {
            displayName: p.display_name,
            role: p.role,
            isHost: p.is_host,
            isGuest: p.type === 'guest',
            micEnabled: p.mic_enabled,
            cameraEnabled: p.camera_enabled,
            screenSharing: p.screen_sharing,
            handRaised: p.hand_raised,
            screenShareAllowed: p.screen_share_allowed,
            connectionState: 'connecting',
            connectionQuality: p.connection_quality || 'good',
            remoteStream: null,
          };
        });
        setParticipants(seeded);

        (chatJson.data?.messages || []).forEach((m) => {
          seenChatIdsRef.current.add(m.id);
        });
        setChatMessages(chatJson.data?.messages || []);
        if (chatJson.data?.settings) {
          setChatEnabled(!!chatJson.data.settings.chat_enabled);
          setChatHistory(chatJson.data.settings.chat_history === 'hide' ? 'hide' : 'keep');
          setChatMutedKeys(chatJson.data.settings.muted_keys || []);
        }
      } catch (err) {
        if (!cancelled) { setError(err); setStatus('error'); }
        return;
      }

      if (cancelled) return;

      const echo = await createMeetingEcho(meetingUuid, guestToken);
      if (cancelled) { try { echo.disconnect(); } catch { /* ignore */ } return; }
      echoRef.current = echo;
      try {
        const conn = echo.connector?.pusher?.connection;
        conn?.bind('state_change', (st) => dbg('socket', st.previous, '->', st.current));
        conn?.bind('error', (err) => dbg('socket error', JSON.stringify(err?.error || err || {}).slice(0, 200)));
      } catch { /* diagnostics only */ }
      const channel = echo.join(presenceChannelName(meetingUuid));
      channelRef.current = channel;

      // بند 8 — الإنبوكس الشخصي بتاعنا، للرسائل الخاصة اللي وصلانا بس
      // (راجع docblock MeetingChatService::broadcast()). private() هنا
      // بيضيف الـ 'private-' prefix تلقائيًا زي join() بيضيف 'presence-'.
      const personalChannel = echo.private(personalChannelName(meetingUuid, myKey));
      personalChannelRef.current = personalChannel;
      personalChannel.listen('.chat.message.sent', (e) => {
        appendChatMessage(e);
        setChatUnreadCount((n) => n + 1);
      });
      personalChannel.listen('.chat.message.deleted', (e) => removeChatMessage(e.message_id));

      channel
        .here((members) => {
          setStatus('connected');
          // The roster is a DB snapshot (can include people who closed their tab without leaving); the presence list is the truth.
          const present = members.map(normMember).filter((m) => m.id);
          // Tell everyone (and the server) what we are ACTUALLY sending. Until now this was only sent on a toggle, so the server
          // kept its defaults and other people saw "camera off / muted" for a perfectly working camera.
          {
            const ls = localStreamRef.current;
            const a = ls?.getAudioTracks()[0];
            const v = ls?.getVideoTracks()[0];
            signalingApi.mediaState(meetingUuid, guestToken, { mic_enabled: !!(a && a.enabled), camera_enabled: !!(v && v.enabled) }).catch(() => {});
          }
          dbg('presence here', present.map((m) => m.id).join(', ') || '(none with id)', 'me =', myKey);
          const presentIds = new Set(present.map((m) => m.id));
          if (presentIds.size > 0) {
            setParticipants((prev) => {
              const next = {};
              Object.keys(prev).forEach((k) => { if (presentIds.has(k)) next[k] = prev[k]; });
              return next;
            });
          }
          const goSfu = !!(transportMgrRef.current && transportMgrRef.current.state.enabled && transportMgrRef.current.state.mode === 'sfu');
          present.forEach((m) => {
            if (m.id === myKey) return;
            setParticipants((prev) => ({
              ...prev,
              [m.id]: prev[m.id] || {
                displayName: m.name || m.id, role: m.role, isHost: m.role === 'host',
                isGuest: m.isGuest, micEnabled: true, cameraEnabled: true, screenSharing: false, handRaised: false,
                screenShareAllowed: null, connectionState: 'connecting', connectionQuality: 'good', remoteStream: null,
              },
            }));
            if (!goSfu) offerTo(m.id).catch((err) => dbg('offer failed', m.id, err?.message || String(err)));
          });
          transportMgrRef.current?.startReporting(); // mesh quality feeds the server's mesh/SFU decision too
          if (goSfu) {
            // the room already runs on the SFU: join it; if that fails for me, fall back to the mesh offers right away
            switchToSfu().then((ok) => {
              if (ok) return;
              present.forEach((m) => { if (m.id !== myKey) offerTo(m.id).catch((err) => dbg('offer failed', m.id, err?.message || String(err))); });
            });
          }
        })
        .joining((raw) => {
          const m = normMember(raw);
          if (!m.id || m.id === myKey) return;
          closePeer(m.id); // same person rejoining (refresh / second tab): drop the old connection, their new offer is coming
          setParticipants((prev) => ({
            ...prev,
            [m.id]: prev[m.id]
              ? { ...prev[m.id], remoteStream: null, connectionState: 'connecting' }
              : {
                displayName: m.name || m.id, role: m.role, isHost: m.role === 'host',
                isGuest: m.isGuest, micEnabled: true, cameraEnabled: true, screenSharing: false, handRaised: false,
                screenShareAllowed: null, connectionState: 'connecting', connectionQuality: 'good', remoteStream: null,
              },
          }));
          // They initiate — we just wait for their offer (see docblock).
        })
        .leaving((raw) => {
          const m = normMember(raw);
          if (!m.id) return;
          closePeer(m.id);
          transportMgrRef.current?.dropPeer(m.id);
          delete sourceRef.current[m.id];
          setParticipants((prev) => {
            const next = { ...prev };
            delete next[m.id];
            return next;
          });
        })
        .listenForWhisper('signal', handleSignal)
        .listenForWhisper('sfu', (m) => transportMgrRef.current?.handleAnnounce(m))
        // Fallback for "end for everyone": the server's status broadcast can fail to reach the socket (e.g. API still on BROADCAST_CONNECTION=log).
        // Only a host / co-host that we know from the roster is trusted.
        .listenForWhisper('meeting-ended', (m) => {
          const role = participantsRef.current?.[m?.key]?.role;
          if (role === 'host' || role === 'co_host') setMeetingStatus('ended');
        })
        .listenForWhisper('wb', (e) => { wbHandlersRef.current.forEach((fn) => { try { fn(e); } catch { /* a bad whiteboard message must never break the call */ } }); })
        .listenForWhisper('capture', (e) => {
          // someone else's screenshot / recording warning (client event: it never goes through Laravel)
          if (!e || e.key === myKey) return;
          setNotice({ type: e.kind === 'recording' ? 'capture_other_recording' : 'capture_other_screenshot', by: String(e.name || '').slice(0, 80) });
        })
        .listen('.media.state.changed', (e) => {
          patchParticipant(e.participant_key, { micEnabled: e.mic_enabled, cameraEnabled: e.camera_enabled, screenSharing: e.screen_sharing });
        })
        .listen('.connection.state.changed', (e) => {
          patchParticipant(e.participant_key, { connectionState: e.connection_state });
        })
        .listen('.meeting.transport.changed', (e) => transportMgrRef.current?.applyServerMode(e))
        .listen('.connection.quality.changed', (e) => {
          patchParticipant(e.participant_key, { connectionQuality: e.connection_quality });
        })
        .listen('.participant.left', (e) => {
          closePeer(e.participant_key);
          transportMgrRef.current?.dropPeer(e.participant_key);
          delete sourceRef.current[e.participant_key];
          setParticipants((prev) => {
            const next = { ...prev };
            delete next[e.participant_key];
            return next;
          });
        })
        .listen('.meeting.status.changed', (e) => {
          setMeetingStatus(e.status);
        })
        // Round 5 — بند 7 (الشات العام بيتبعت هنا؛ الخاص على الإنبوكس
        // الشخصي فوق). المرسِل نفسه بياخد نسخته من رد REST المباشر
        // (راجع sendChatMessage) — الـ dedupe في appendChatMessage بيمنع
        // التكرار لو الـ broadcast رجع لنفس السوكيت كمان.
        .listen('.chat.message.sent', (e) => {
          appendChatMessage(e);
          if (e.sender_key !== myKey) setChatUnreadCount((n) => n + 1);
        })
        .listen('.chat.message.deleted', (e) => removeChatMessage(e.message_id))
        .listen('.chat.cleared', () => {
          // public chat wiped by a host; private messages stay
          setChatMessages((prev) => prev.filter((m) => m.is_private));
          setChatUnreadCount(0);
        })
        .listen('.chat.settings.changed', (e) => applyChatSettings(e))
        .listen('.meeting.mute_all', (e) => {
          // "mute everyone": moderators keep their mic, everybody else switches theirs off (and tells the room)
          if (e.muted_by_key === myKey) return;
          if (myRoleRef.current === 'host' || myRoleRef.current === 'co_host') return;
          localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
          setMicEnabled(false);
          signalingApi.mediaState(meetingUuid, guestToken, { mic_enabled: false }).catch(() => {});
          setNotice({ type: 'muted_by_host', by: e.muted_by_display_name });
        })
        .listen('.chat.message.reaction_changed', (e) => {
          applyChatReactionChange(e.message_id, e.actor_key, e.emoji, e.added);
        })
        // Round 5 — بند 11 (Raise Hand + Reactions).
        .listen('.hand.raised', (e) => {
          if (e.participant_key === myKey) return; // حالتي أنا بتتحدث محليًا في toggleHand مباشرة
          patchParticipant(e.participant_key, { handRaised: e.raised, handRaisedAt: e.hand_raised_at });
        })
        .listen('.reaction.sent', (e) => {
          // my own reaction was already shown instantly when I tapped it (sendReaction) — don't play it twice
          if (e.participant_key === myKey) return;
          pushReactionRef.current?.(e.participant_key, e.display_name, e.type, e.emoji);
        })
        // Round 5 — بند 9 (Screen Sharing host policies).
        .listen('.screen_share.policy.changed', (e) => {
          setScreenSharingLocked(e.locked);
        })
        .listen('.screen_share.participant_policy.changed', (e) => {
          if (e.participant_key === myKey) {
            setMyScreenShareAllowed(e.allowed);
          } else {
            patchParticipant(e.participant_key, { screenShareAllowed: e.allowed });
          }
        })
        .listen('.screen_share.force_stopped', (e) => {
          if (e.participant_key === myKey) {
            stopScreenShareTrackRef.current?.(true);
            setNotice({ type: 'screen_share_force_stopped', by: e.stopped_by_display_name });
          }
        })
        // Remote control (Zoom-style).
        .listen('.remote_control.requested', (e) => {
          if (e.target_key !== myKey) return;
          setRcIncoming((list) => (list.some((r) => r.controllerKey === e.controller_key) ? list : [...list, { controllerKey: e.controller_key, controllerName: e.controller_name }]));
        })
        .listen('.remote_control.changed', (e) => {
          const iAmTarget = e.target_key === myKey;
          const iAmController = e.controller_key === myKey;
          setRcIncoming((list) => list.filter((r) => r.controllerKey !== e.controller_key));
          if (e.status === 'granted') {
            setRemoteControl({ controllerKey: e.controller_key, controllerName: e.controller_name, targetKey: e.target_key });
            setRcPendingTarget(null);
            if (iAmTarget) rcChannelRef.current?.postMessage({ type: 'state', active: true, controllerName: e.controller_name });
          } else {
            setRemoteControl(null);
            if (iAmController) { setRcPendingTarget(null); setRcNotice(e.status); }
            if (iAmTarget) rcChannelRef.current?.postMessage({ type: 'state', active: false });
          }
        })
        .listen('.remote_control.input', (e) => {
          if (e.target_key !== myKey) return;
          rcChannelRef.current?.postMessage({ type: 'input', events: e.events });
        })
        // Round 6 — بند 5 (Host Controls / Participants Panel).
        .listen('.meeting.lock_changed', (e) => {
          setMeetingLocked(e.locked);
        })
        .listen('.participant.muted_by_host', (e) => {
          if (e.participant_key !== myKey) return; // other participants' mic state already rides .media.state.changed above
          localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
          setMicEnabled(false);
          setNotice({ type: 'muted_by_host', by: e.muted_by_display_name });
        })
        .listen('.participant.camera_disabled_by_host', (e) => {
          if (e.participant_key !== myKey) return;
          localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = false; });
          setCameraEnabled(false);
          setNotice({ type: 'camera_disabled_by_host', by: e.disabled_by_display_name });
        })
        .listen('.participant.removed', (e) => {
          if (e.participant_key === myKey) {
            leftRef.current = true; // نحن اتشلنا بالفعل من meeting_participants سيرفر-سايد — leave() على unmount هيبقى no-op مضر لو اتبعت
            setKicked({ byDisplayName: e.removed_by_display_name });
            return;
          }
          closePeer(e.participant_key);
          setParticipants((prev) => {
            const next = { ...prev };
            delete next[e.participant_key];
            return next;
          });
        })
        .listen('.participant.role_changed', (e) => {
          if (e.participant_key === myKey) {
            setMyRole(e.new_role);
          } else {
            patchParticipant(e.participant_key, { role: e.new_role, isHost: e.new_role === 'host' });
          }
        })
        .listen('.meeting.host_transferred', (e) => {
          if (e.new_host_key === myKey) setMyRole('host');
          else if (e.previous_host_key === myKey) setMyRole('co_host');
          if (e.new_host_key !== myKey) patchParticipant(e.new_host_key, { role: 'host', isHost: true });
          if (e.previous_host_key !== myKey) patchParticipant(e.previous_host_key, { role: 'co_host', isHost: false });
        })
        // Round 7 — بند 19 (File Sharing).
        .listen('.meeting.file_shared', (e) => {
          setFiles((prev) => (prev.some((f) => f.id === e.file_id) ? prev : [...prev, {
            id: e.file_id, original_name: e.original_name, uploader_key: e.uploader_key, uploader_display_name: e.uploader_display_name,
            // download_url/extension/mime_type/size_bytes/created_at aren't in the broadcast payload
            // (see MeetingFileShared::broadcastWith()) — a full re-fetch isn't worth it for a live
            // notification the uploader's own REST response already covers for their own row.
          }]));
        })
        .listen('.meeting.file_removed', (e) => {
          setFiles((prev) => prev.filter((f) => f.id !== e.file_id));
        })
        // Round 7 — بند 20 (Meeting Notes + Action Items).
        .listen('.meeting.notes_updated', (e) => {
          setNotes({ body: e.body, lastEditedByDisplayName: e.edited_by_display_name, lastEditedAt: null });
        })
        .listen('.meeting.action_item_changed', (e) => {
          setActionItems((prev) => {
            if (e.action === 'deleted') return prev.filter((it) => it.id !== e.item_id);
            if (e.action === 'created') return prev.some((it) => it.id === e.item_id) ? prev : [...prev, e.item];
            return prev.map((it) => (it.id === e.item_id ? e.item : it));
          });
        })
        // Round 7 — بند 21 (Polls).
        .listen('.meeting.poll_created', (e) => {
          setPolls((prev) => (prev.some((p) => p.poll_id === e.poll.poll_id) ? prev : [...prev, e.poll]));
        })
        .listen('.meeting.poll_results_updated', (e) => {
          setPolls((prev) => prev.map((p) => (p.poll_id === e.poll_id ? e.results : p)));
        })
        .listen('.meeting.poll_closed', (e) => {
          setPolls((prev) => prev.map((p) => (p.poll_id === e.poll_id ? e.results : p)));
        })
        // Round 9 — بند 18 (Recording). "Recording must be clearly
        // indicated to all participants" — every one of these three
        // reaches everyone in the room (never toOthers(), same as every
        // Round 5-7 event), including the manager who clicked start/
        // stop themselves. broadcastWith() on all three is deliberately
        // thin (id/kind/status only) — the full row (original_name,
        // download_url, duration, etc.) only matters once `completed`,
        // and by then a plain re-fetch would be as much code as trying
        // to reconstruct it from three different partial payloads; a
        // manager reopening RecordingsPanel gets the full row for free
        // from `recordingsApi.list` next time regardless. So `.file`
        // fields simply stay undefined here for other participants — the
        // *uploader's own* browser (see stopRecordingLocal below) has
        // already patched its own row directly from the REST response.
        .listen('.meeting.recording_started', (e) => {
          setRecordings((prev) => (prev.some((r) => r.id === e.recording_id) ? prev : [...prev, {
            id: e.recording_id, kind: e.kind, status: 'recording',
            started_by_key: e.started_by_key, started_by_display_name: e.started_by_display_name,
          }]));
        })
        .listen('.meeting.recording_stopped', (e) => {
          setRecordings((prev) => prev.map((r) => (r.id === e.recording_id ? { ...r, status: e.status } : r)));
        })
        .listen('.meeting.recording_ready', (e) => {
          setRecordings((prev) => prev.map((r) => (r.id === e.recording_id ? { ...r, status: e.status } : r)));
          // A completed/failed row's download_url/size/etc aren't in this
          // payload either (see comment above) — refresh the one row so
          // "Download" actually has a URL without waiting for the panel
          // to be reopened.
          if (e.status === 'completed') {
            recordingsApi.list(meetingUuid, guestToken).then((json) => {
              setRecordings(json.data?.recordings || []);
            }).catch(() => {});
          }
        })
        .error((err) => {
          if (cancelled) return;
          if (isAlreadyInMeetingError(err)) { setSessionConflict('already_open'); return; }
          setError(err); setStatus('error');
        });
    }

    setup();

    return () => {
      cancelled = true;
      Object.keys(peersRef.current).forEach(closePeer);
      transportMgrRef.current?.stop();
      transportMgrRef.current = null; transportRef.current = 'mesh'; sourceRef.current = {};
      clearRemoteAudio('meeting:');
      channelRef.current?.stopListening('.media.state.changed');
      if (echoRef.current) {
        echoRef.current.leave(presenceChannelName(meetingUuid));
        echoRef.current.leave(personalChannelName(meetingUuid, myKey));
        echoRef.current.disconnect();
      }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      try { cameraFxRef.current?.stop(); } catch { /* ignore */ }
      cameraFxRef.current = null;
      try { rawCameraTrackRef.current?.stop(); } catch { /* ignore */ }
      rawCameraTrackRef.current = null;
      localStreamRef.current = null;
      noiseRef.current = null;
      if (screenTrackRef.current) { screenTrackRef.current.onended = null; screenTrackRef.current.stop(); screenTrackRef.current = null; }
      teardownLocalRecorder();
      if (!leftRef.current) signalingApi.leave(meetingUuid, guestToken).catch(() => {});
    };
    // Intentionally only re-runs if the meeting/actor identity changes —
    // toggling mic/camera/screen-share must NOT tear down the socket or
    // any peer connection (see the dedicated effects/callbacks below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingUuid, guestToken, myKey]);


  // ---- بند 5 — once we're removed, tear down media/peers/sockets right
  // away instead of waiting for MeetingRoomShell to unmount us (it keeps
  // rendering the hook's owner while it shows the "removed" screen).
  const meetingEnded = meetingStatus === 'ended';
  useEffect(() => {
    if (!kicked && !meetingEnded && !sessionConflict) return;
    Object.keys(peersRef.current).forEach(closePeer);
    transportMgrRef.current?.stop();
    echoRef.current?.leave(presenceChannelName(meetingUuid));
    echoRef.current?.leave(personalChannelName(meetingUuid, myKey));
    echoRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    try { cameraFxRef.current?.stop(); } catch { /* ignore */ }
    cameraFxRef.current = null;
    try { rawCameraTrackRef.current?.stop(); } catch { /* ignore */ }
    rawCameraTrackRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    teardownLocalRecorder();
  }, [kicked, meetingEnded, sessionConflict, meetingUuid, myKey, closePeer, teardownLocalRecorder]);

  // ---- heartbeat --------------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      signalingApi.heartbeat(meetingUuid, guestToken).catch((err) => { if (isSessionReplacedError(err)) setSessionConflict('replaced'); });
    }, 25000);
    return () => clearInterval(timer);
  }, [meetingUuid, guestToken]);

  // tab closing / reloading: free our session slot right away (keepalive request) so the reloaded page is not refused by it
  useEffect(() => {
    const free = () => leaveOnUnload(meetingUuid, guestToken);
    window.addEventListener('pagehide', free);
    return () => window.removeEventListener('pagehide', free);
  }, [meetingUuid, guestToken]);

  // ---- lightweight connection-quality sampling from getStats() ---------
  // Old version flagged EVERYONE as "weak network" in a 5-person room although every connection was fine: it took the packet loss
  // since the call began (not the last few seconds), read RTT from whichever candidate pair happened to be "succeeded" (unused pairs
  // have a long RTT) and a single noisy sample was enough. Now: only the audio stream decides loss, over the last interval, on the
  // pair that is really in use, and "poor" needs two bad samples in a row.
  useEffect(() => {
    const prev = new WeakMap(); // pc -> { lost, recv } at the previous sample
    let badStreak = 0;
    const timer = setInterval(async () => {
      const peers = Object.values(peersRef.current);
      if (peers.length === 0) return;
      let worst = 'excellent';
      const rank = { excellent: 0, good: 1, poor: 2, reconnecting: 3 };
      for (const pc of peers) {
        try {
          if (pc.connectionState === 'new' || pc.connectionState === 'connecting') continue; // still joining: no verdict yet
          const stats = await pc.getStats();
          let selectedId = null; let rtt = null; let lost = 0; let recv = 0;
          const pairs = [];
          stats.forEach((report) => {
            if (report.type === 'transport' && report.selectedCandidatePairId) selectedId = report.selectedCandidatePairId;
            if (report.type === 'candidate-pair') pairs.push(report);
            if (report.type === 'inbound-rtp' && !report.isRemote && (report.kind || report.mediaType) === 'audio') {
              lost += Math.max(0, report.packetsLost || 0);
              recv += report.packetsReceived || 0;
            }
          });
          const active = pairs.find((r) => r.id === selectedId) || pairs.find((r) => r.nominated && r.state === 'succeeded');
          if (active && active.currentRoundTripTime != null) rtt = active.currentRoundTripTime;
          const before = prev.get(pc) || { lost: 0, recv: 0 };
          prev.set(pc, { lost, recv });
          const dLost = Math.max(0, lost - before.lost); const dRecv = Math.max(0, recv - before.recv);
          const lossRatio = dRecv + dLost >= 50 ? dLost / (dRecv + dLost) : 0; // needs enough packets in the window to mean anything
          let quality = 'excellent';
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') quality = 'reconnecting';
          else if (lossRatio > 0.12 || (rtt != null && rtt > 0.6)) quality = 'poor';
          else if (lossRatio > 0.04 || (rtt != null && rtt > 0.3)) quality = 'good';
          if (rank[quality] > rank[worst]) worst = quality;
        } catch {
          // getStats() failing on one peer shouldn't block the others.
        }
      }
      badStreak = worst === 'poor' ? badStreak + 1 : 0;
      if (worst === 'poor' && badStreak < 2) worst = 'good'; // one bad sample is noise, not a weak network
      meshQualityRef.current = worst;
      signalingApi.connectionQuality(meetingUuid, guestToken, worst).catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, [meetingUuid, guestToken]);

  // Mesh video budget depends on how many people are connected: re-balance existing connections when someone joins/leaves.
  const peerTotal = Object.keys(participants).length;
  useEffect(() => {
    Object.values(peersRef.current).forEach((pc) => {
      if (pc.connectionState === 'connected') tuneSenders(pc, Object.keys(peersRef.current).length).catch(() => {});
    });
    // The camera itself is captured once and then encoded once PER other person, so in a bigger room also capture less: 720p30 in
    // a 5-person call is pure waste when every tile is 240p. Back to full quality when the room shrinks. Best effort only.
    const track = rawCameraTrackRef.current;
    if (track && track.readyState === 'live' && track.applyConstraints) {
      const small = peerTotal >= 3;
      track.applyConstraints(small
        ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: peerTotal >= 4 ? 20 : 24 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }).catch(() => {});
    }
  }, [peerTotal]);

  // ---- local controls ----------------------------------------------------
  const toggleMic = useCallback(() => {
    setMicEnabled((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
      signalingApi.mediaState(meetingUuid, guestToken, { mic_enabled: next }).catch(() => {});
      return next;
    });
  }, [meetingUuid, guestToken]);

  /**
   * Swap the video track we send on every peer connection (and in our local stream) without renegotiating.
   * The SAME MediaStream object is kept (new track added before the old one is removed): the <video> that shows us follows the
   * track change by itself, so picking a filter no longer re-binds the preview and no longer flashes black / "refreshes".
   */
  const swapCameraTrack = useCallback((newTrack, keepOld = false) => {
    const local = localStreamRef.current;
    if (!local) return;
    const olds = local.getVideoTracks().filter((o) => o !== newTrack);
    if (!local.getVideoTracks().includes(newTrack)) local.addTrack(newTrack);
    olds.forEach((old) => { local.removeTrack(old); if (!keepOld) old.stop(); });
    // while presenting, peers keep receiving the screen; the camera comes back when the presentation stops
    if (!screenTrackRef.current) {
      Object.values(cameraTrackSendersRef.current).forEach((sender) => sender.replaceTrack(newTrack).catch(() => {}));
      transportMgrRef.current?.replaceVideoTrack(newTrack);
    }
  }, []);

  /**
   * Camera look = colour filter + background (none / blur / generated scene / your own picture). Sends a processed track while any
   * of it is active and the raw camera track again when everything is "none". Resolves false (and keeps the previous look) on failure.
   */
  const lookBusyRef = useRef(false);
  const setCameraLook = useCallback(async (look) => {
    if (lookBusyRef.current) return false; // one change at a time: a second tap while the first is still applying is ignored
    lookBusyRef.current = true;
    try {
      const raw = rawCameraTrackRef.current;
      if (!raw || raw.readyState === 'ended') { setNotice({ type: 'camera_unavailable' }); return false; }
      const next = { filter: look.filter || 'none', background: look.background || 'none' };
      if (next.filter === 'none' && next.background === 'none') {
        swapCameraTrack(raw, true);
        raw.enabled = cameraEnabledRef.current;
        setCameraLookState(next);
        return true;
      }
      if (!cameraFxSupported()) { setNotice({ type: 'effect_unavailable' }); return false; }
      try {
        if (!cameraFxRef.current) cameraFxRef.current = createCameraFx(raw);
        await cameraFxRef.current.setLook({ ...next, image: look.image });
      } catch (err) {
        dbg('camera look failed', err?.message);
        if (next.background !== 'none') setNotice({ type: 'effect_unavailable' });
        return false;
      }
      const fxTrack = cameraFxRef.current.track;
      fxTrack.enabled = cameraEnabledRef.current;
      swapCameraTrack(fxTrack, true);
      setCameraLookState(next);
      return true;
    } catch (err) {
      dbg('camera look crashed', err?.message);
      setNotice({ type: 'effect_unavailable' });
      return false;
    } finally {
      lookBusyRef.current = false;
    }
  }, [swapCameraTrack]);

  const toggleCamera = useCallback(async () => {
    // No real camera yet (denied / none / joined without one): try to open one now instead of toggling a black placeholder.
    if (!hasCameraRef.current) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
        const track = cam.getVideoTracks()[0];
        hasCameraRef.current = true;
        rawCameraTrackRef.current = track;
        setHasCamera(true);
        swapCameraTrack(track);
        setCameraEnabled(true);
        signalingApi.mediaState(meetingUuid, guestToken, { camera_enabled: true }).catch(() => {});
      } catch (err) {
        setNotice({ type: 'camera_unavailable' });
      }
      return;
    }
    setCameraEnabled((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
      if (rawCameraTrackRef.current) rawCameraTrackRef.current.enabled = next;
      signalingApi.mediaState(meetingUuid, guestToken, { camera_enabled: next }).catch(() => {});
      return next;
    });
  }, [meetingUuid, guestToken, swapCameraTrack]);

  const stopScreenShareTrackRef = useRef(null);

  // بند 9 — نفس ترتيب الأولوية بتاع MeetingSignalingService::canShareScreen()
  // بالظبط (هوست/co-host دايمًا مسموح ← منع صريح ليّا يغلب كل حاجة ← سماح
  // صريح ليّا يغلب القفل العام ← وإلا القفل العام هو الحاكم). الباك اند هو
  // الحكم الحقيقي (بيرفض mediaState/الـ toggle مايتحققش منه أصلًا)، هنا بس
  // عشان الزرار يبان معطّل بدل ما المستخدم يفتح شاشة مشاركة وتتقفله فجأة.
  const canShareScreen = isHost || myScreenShareAllowed === true || (myScreenShareAllowed !== false && !screenSharingLocked);

  /**
   * Presenting is independent of the camera: it works with the camera off, with no camera at all, or with the camera on.
   * Every peer connection always owns one video sender (the camera track, or the black placeholder when there's no camera),
   * and presenting just swaps what that sender carries; stopping swaps the camera (or placeholder) back.
   */
  const screenBusyRef = useRef(false); // the picker is open / the share is being set up: ignore extra clicks (they used to queue up and freeze the button)
  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      stopScreenShareTrackRef.current?.();
      return;
    }
    if (screenBusyRef.current) return;
    if (!canShareScreen) {
      setNotice({ type: 'screen_share_locked' });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice({ type: 'screen_share_unsupported' });
      return;
    }
    screenBusyRef.current = true;
    let displayStream = null;
    let screenTrack = null;
    try {
      // 1080p / 30 fps made weaker laptops and phones stall (the encoder, not the network). Slides, documents and code stay sharp at
      // 15 fps, so cap there; the browser still downscales further on its own if the machine struggles.
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 24, max: 30 }, width: { ideal: 1600, max: 1920 }, height: { ideal: 900, max: 1080 } },
        audio: false,
        // Chrome/Edge hints (ignored elsewhere): don't offer this meeting tab (it would mirror itself), let the presenter switch the
        // shared tab/window without restarting, and offer whole screens — the same picker behaviour as Google Meet.
        selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include', systemAudio: 'exclude',
      });
      screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen track');
      try { screenTrack.contentHint = 'detail'; } catch { /* unsupported — harmless */ }

      const stopSharing = () => {
        screenTrack.onended = null;
        screenTrackRef.current = null;
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
        Object.values(cameraTrackSendersRef.current).forEach((sender) => sender.replaceTrack(cameraTrack).catch(() => {}));
        transportMgrRef.current?.replaceVideoTrack(cameraTrack);
        screenTrack.stop();
        setScreenStream(null);
        setScreenSharing(false);
        signalingApi.mediaState(meetingUuid, guestToken, { screen_sharing: false }).catch(() => {});
        stopScreenShareTrackRef.current = null;
      };

      // Show it on OUR screen straight away — nothing below waits for the server or for the peers.
      screenTrackRef.current = screenTrack;
      transportMgrRef.current?.replaceVideoTrack(screenTrack); // SFU publisher (no-op while the room is on mesh)
      setScreenStream(new MediaStream([screenTrack]));
      setScreenSharing(true);
      screenTrack.onended = stopSharing;
      stopScreenShareTrackRef.current = stopSharing;
      screenBusyRef.current = false;

      // Tell the server and swap every peer's sender IN PARALLEL, in the background. If the server refuses (policy), roll back.
      const announce = signalingApi.mediaState(meetingUuid, guestToken, { screen_sharing: true }).catch((e) => {
        if (stopScreenShareTrackRef.current === stopSharing) { stopSharing(); setNotice({ type: 'screen_share_failed' }); }
        dbg('mediaState(screen) failed', e?.message);
      });
      const swap = Promise.all(Object.values(cameraTrackSendersRef.current).map(async (sender) => {
        await sender.replaceTrack(screenTrack).catch((e) => dbg('replaceTrack(screen) failed', e?.message));
        try {
          const params = sender.getParameters();
          params.degradationPreference = 'balanced'; // 'maintain-resolution' froze the share on slow machines; balanced trades fps/pixels as needed
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          const peers = Math.max(1, Object.keys(cameraTrackSendersRef.current).length);
          const enc = params.encodings[0];
          enc.maxBitrate = Math.max(700_000, Math.min(2_500_000, Math.floor(4_000_000 / peers))); // bounded per peer: keeps the uplink (and the encoder) from choking
          enc.maxFramerate = 24;
          enc.scaleResolutionDownBy = 1;
          enc.networkPriority = 'medium'; // above the camera default ('low'), still below the voice ('high')
          await sender.setParameters(params);
        } catch { /* not supported everywhere */ }
      }));
      await Promise.all([announce, swap]);
    } catch (err) {
      // never leave a capture running (browser "sharing" banner) if we failed after the picker closed
      displayStream?.getTracks().forEach((t) => t.stop());
      if (screenTrackRef.current === screenTrack) { screenTrackRef.current = null; stopScreenShareTrackRef.current = null; setScreenStream(null); setScreenSharing(false); }
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        setNotice({ type: 'screen_share_failed' });
        signalingApi.mediaState(meetingUuid, guestToken, { screen_sharing: false }).catch(() => {});
      }
    } finally {
      screenBusyRef.current = false;
    }
  }, [screenSharing, canShareScreen, meetingUuid, guestToken]);

  const leave = useCallback(() => {
    leftRef.current = true;
    signalingApi.leave(meetingUuid, guestToken).catch(() => {});
  }, [meetingUuid, guestToken]);

  /** Host / co-host: close the meeting for everybody (they all get the "meeting ended" screen), then leave it ourselves. */
  const endMeetingForAll = useCallback(async () => {
    try { channelRef.current?.whisper('meeting-ended', { key: myKey }); } catch { /* the server broadcast is the primary path */ }
    await meetingLifecycleApi.end(meetingUuid);
    try { channelRef.current?.whisper('meeting-ended', { key: myKey }); } catch { /* ignore */ }
    leftRef.current = true;
    signalingApi.leave(meetingUuid, guestToken).catch(() => {});
  }, [meetingUuid, guestToken, myKey]);

  const clearNotice = useCallback(() => setNotice(null), []);

  // Screenshot / screen-recording warning: tell everyone in the room (and show the person that it was reported).
  useEffect(() => watchScreenCapture((kind) => {
    try { channelRef.current?.whisper('capture', { key: myKey, name: myDisplayName, kind }); } catch { /* ignore */ }
    setNotice({ type: kind === 'recording' ? 'capture_self_recording' : 'capture_self_screenshot' });
  }), [meetingUuid, myKey, myDisplayName]);

  // ---- بند 7/8 (Chat) ----------------------------------------------------
  // recipientKey=null → رسالة عامة. الرد المباشر من REST بيتضاف فورًا
  // (appendChatMessage بيتكفل بمنع التكرار لما نفس الرسالة ترجع تاني عبر
  // الـ broadcast — راجع docblock appendChatMessage وseenChatIdsRef فوق).
  const sendChatMessage = useCallback(async (body, { recipientKey = null, replyToMessageId = null, mentionedKeys = null, file = null } = {}) => {
    const trimmed = (body || '').trim();
    if (!trimmed && !file) return;
    const json = await chatApi.send(meetingUuid, guestToken, {
      body: trimmed,
      file: file || undefined,
      recipient_key: recipientKey,
      reply_to_message_id: replyToMessageId,
      mentioned_keys: mentionedKeys,
    });
    appendChatMessage(json.data);
  }, [meetingUuid, guestToken, appendChatMessage]);

  // فورية (optimistic) — الـ toggle ده نفس منطق toggleReaction في الباك
  // اند (نفس الإيموجي من نفس الشخص تاني بيشيلها)، فبنحسب النتيجة محليًا
  // فورًا بدل ما نستنى الـ broadcast، ثم الـ .chat.message.reaction_changed
  // listener فوق بيثبّت/يصحح الحالة لما يوصل (بما فيه نسختنا إحنا،
  // مفيش toOthers() في الباك اند).
  const reactToChatMessage = useCallback((messageId, emoji) => {
    chatApi.react(meetingUuid, guestToken, messageId, emoji).catch(() => {});
  }, [meetingUuid, guestToken]);

  const markChatRead = useCallback(() => setChatUnreadCount(0), []);

  /**
   * Delete a message for everyone (own message, or ANY public message when host / co-host). It is removed from this screen as soon
   * as the server confirms; everybody else drops it from the broadcast. Resolves/rejects so the panel can show an inline error.
   */
  const deleteChatMessage = useCallback(async (messageId) => {
    await chatApi.destroy(meetingUuid, guestToken, messageId);
    removeChatMessage(messageId);
  }, [meetingUuid, guestToken, removeChatMessage]);

  // Chat moderation (host / co-host; the server re-checks). State comes back through `.chat.settings.changed` for everyone,
  // the caller included, so there is no local optimistic copy to keep in sync.
  const setChatEnabledForAll = useCallback((enabled) => hostControlApi.chatSettings(meetingUuid, { chat_enabled: !!enabled }), [meetingUuid]);
  const setChatHistoryMode = useCallback((mode) => hostControlApi.chatSettings(meetingUuid, { chat_history: mode === 'hide' ? 'hide' : 'keep' }), [meetingUuid]);
  const setParticipantChatMuted = useCallback((targetKey, muted) => hostControlApi.chatMute(meetingUuid, targetKey, !!muted), [meetingUuid]);
  const clearChatForAll = useCallback(() => hostControlApi.chatClear(meetingUuid), [meetingUuid]);
  const muteEveryone = useCallback(() => hostControlApi.muteAll(meetingUuid), [meetingUuid]);

  // ---- بند 11 (Raise Hand + Reactions) -----------------------------------
  // بنحدّث حالتنا محليًا فورًا (الـ .hand.raised listener فوق بيتجاهل
  // eventنا الراجع لنفسنا عمدًا — راجع الدوكبلوك هناك) بدل ما نستنى رحلة
  // socket كاملة عشان الزرار يحس إنه استجاب فورًا.
  const toggleHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev;
      signalingApi.hand(meetingUuid, guestToken, next).catch(() => {
        setHandRaised(prev); // رجّعها لو الطلب فشل
      });
      return next;
    });
  }, [meetingUuid, guestToken]);

  // ephemeral بالكامل — مفيش تحديث محلي هنا، بنستنى نفس الـ broadcast اللي
  // بيوصل لكل الحاضرين (بما فيهم إحنا، راجع docblock ParticipantReactionSent)
  // عبر الـ .reaction.sent listener فوق، عشان نضمن كل الناس بتشوف نفس
  // الترتيب/التوقيت.
  const pushReaction = useCallback((key, displayName, type, emoji) => {
    reactionSeqRef.current += 1;
    const id = reactionSeqRef.current;
    const shown = emoji || REACTION_EMOJI[type] || '👍';
    // cap what is on screen so a spammed reaction can't pile up hundreds of animated nodes
    setReactions((prev) => [...prev.slice(-11), { id, key, displayName, type, emoji: shown }]);
    setReactionLog((prev) => [...prev.slice(-79), { id: `reaction-${id}`, key, displayName, emoji: shown, created_at: new Date().toISOString() }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 3200);
    return id;
  }, []);
  pushReactionRef.current = pushReaction;

  // Optimistic: the sender sees their own reaction at once (no waiting for the socket round-trip); everyone else gets it from
  // the .reaction.sent broadcast. If the request fails, the optimistic one is withdrawn so nobody is told something that never went out.
  const sendReaction = useCallback((type, emoji = null) => {
    const id = pushReaction(myKey, myDisplayName, type, emoji);
    signalingApi.reaction(meetingUuid, guestToken, type, emoji).catch(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    });
  }, [meetingUuid, guestToken, myKey, myDisplayName, pushReaction]);

  // ---- acoustic feedback between nearby devices ---------------------------
  // The mic-side detector (noiseSuppress.js) calls this each time a feedback whistle starts. One blip is handled by its notch filter;
  // a repeat inside 30 s means the loop is real (another device in the room), so we mute THIS mic — that cuts the loop at once, from
  // either side — tell the user why, and point them at "Speakers off". Unmuting is a normal tap on the mic button.
  onFeedbackRef.current = (hz) => {
    const now = Date.now();
    feedbackHitsRef.current = [...feedbackHitsRef.current.filter((t) => now - t < 30000), now];
    dbg('feedback whistle', hz, 'Hz — hits in last 30s:', feedbackHitsRef.current.length);
    tightenEchoGate(); // first whistle already: strict half-duplex for 25 s (no barge-in, longer tail) before the mic has to be muted
    if (feedbackHitsRef.current.length < 2 || leftRef.current) return;
    feedbackHitsRef.current = [];
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setMicEnabled(false);
    signalingApi.mediaState(meetingUuid, guestToken, { mic_enabled: false }).catch(() => {});
    setNotice({ type: 'echo_detected' });
  };

  const toggleSpeakers = useCallback(() => setSpeakersMuted((v) => !v), []);

  // ---- noise isolation switch (shared with 1:1 calls) ---------------------
  const toggleNoise = useCallback(() => {
    setNoiseOn((prev) => {
      const next = !prev;
      writeNoisePref(next);
      if (noiseRef.current) noiseRef.current.setEnabled(next);
      else {
        // no neural graph on this browser: at least flip the browser's own suppression live
        const track = localStreamRef.current?.getAudioTracks()[0];
        try { track?.applyConstraints({ noiseSuppression: next, echoCancellation: true }).catch(() => {}); } catch { /* not supported live */ }
      }
      return next;
    });
  }, []);

  // ---- بند 9 (Screen Sharing host policies) — host/co-host بس -----------
  // مفيش تحديث محلي هنا برضو — .screen_share.*.changed listeners فوق
  // بتستقبل نفس الـ broadcast (مفيش toOthers() في الباك اند)، فالهوست
  // نفسه بيتحدّث بنفس المسار زي أي حد تاني.
  const setScreenSharingLock = useCallback((locked) => {
    signalingApi.screenSharePolicy(meetingUuid, guestToken, locked).catch(() => {});
  }, [meetingUuid, guestToken]);

  const setParticipantScreenShareAllowed = useCallback((participantKey, allowed) => {
    signalingApi.screenShareParticipantPolicy(meetingUuid, guestToken, participantKey, allowed).catch(() => {});
  }, [meetingUuid, guestToken]);

  const forceStopScreenShare = useCallback((participantKey) => {
    signalingApi.screenShareStop(meetingUuid, guestToken, participantKey).catch(() => {});
  }, [meetingUuid, guestToken]);

  // ---- بند 5 (Host Controls / Participants Panel) — host/co-host only --
  // Unlike بند 9's screen-share actions above, these return the API
  // promise itself (not swallowed with .catch(() => {})) — the
  // Participants Panel surfaces per-row errors (e.g. "Only the host can
  // remove a moderator.") rather than failing silently, since these are
  // higher-stakes, deliberate actions taken from a dedicated panel. No
  // local optimistic update here either: the backend's own broadcast
  // (never toOthers()) reaches the actor's own browser too, same as
  // every other Round 5/6 event, so state updates ride the listeners
  // above uniformly for everyone including whoever clicked the button.
  const lockMeeting = useCallback((locked) => hostControlApi.lock(meetingUuid, locked), [meetingUuid]);
  const muteParticipant = useCallback((targetKey) => hostControlApi.mute(meetingUuid, targetKey), [meetingUuid]);
  const disableParticipantCamera = useCallback((targetKey) => hostControlApi.disableCamera(meetingUuid, targetKey), [meetingUuid]);
  const removeParticipant = useCallback((targetKey) => hostControlApi.remove(meetingUuid, targetKey), [meetingUuid]);
  const promoteParticipant = useCallback((targetKey) => hostControlApi.promote(meetingUuid, targetKey), [meetingUuid]);
  const demoteParticipant = useCallback((targetKey) => hostControlApi.demote(meetingUuid, targetKey), [meetingUuid]);
  const transferHost = useCallback((targetKey) => hostControlApi.transferHost(meetingUuid, targetKey), [meetingUuid]);

  // ---- بند 19 (File Sharing) — open to any actor present ----------------
  // Local list update happens from the REST response directly (the
  // uploader's own row needs download_url/size_bytes/etc, which the
  // broadcast payload doesn't carry — see the .meeting.file_shared
  // listener's own comment above) rather than waiting for the broadcast.
  const uploadFile = useCallback(async (file) => {
    const json = await filesApi.store(meetingUuid, guestToken, file);
    setFiles((prev) => (prev.some((f) => f.id === json.data.id) ? prev.map((f) => (f.id === json.data.id ? json.data : f)) : [...prev, json.data]));
    return json.data;
  }, [meetingUuid, guestToken]);
  const deleteFile = useCallback((fileId) => filesApi.destroy(meetingUuid, guestToken, fileId), [meetingUuid, guestToken]);

  // ---- بند 20 (Meeting Notes + Action Items) — writes are manager-only,
  // enforced server-side (MeetingNotesService::requireManager); returned
  // as a promise (not swallowed) so NotesPanel can surface a 403 inline.
  const updateNotes = useCallback((body) => notesApi.update(meetingUuid, guestToken, body), [meetingUuid, guestToken]);
  const createActionItem = useCallback((data) => notesApi.createItem(meetingUuid, guestToken, data), [meetingUuid, guestToken]);
  const updateActionItem = useCallback((itemId, data) => notesApi.updateItem(meetingUuid, guestToken, itemId, data), [meetingUuid, guestToken]);
  const deleteActionItem = useCallback((itemId) => notesApi.deleteItem(meetingUuid, guestToken, itemId), [meetingUuid, guestToken]);

  // ---- بند 21 (Polls) — create/close manager-only, vote open to anyone
  // present. Local optimistic update for vote() only (poll_id + option
  // list is already in hand from `polls` state; create/close both ride
  // their own broadcasts, which reach the caller's own browser too, same
  // as every other Round 5/6/7 event).
  const createPoll = useCallback((data) => pollsApi.create(meetingUuid, guestToken, data), [meetingUuid, guestToken]);
  const votePoll = useCallback(async (pollId, optionIds) => {
    const json = await pollsApi.vote(meetingUuid, guestToken, pollId, optionIds);
    setPolls((prev) => prev.map((p) => (p.poll_id === pollId ? json.data : p)));
    return json.data;
  }, [meetingUuid, guestToken]);
  const closePoll = useCallback((pollId) => pollsApi.close(meetingUuid, guestToken, pollId), [meetingUuid, guestToken]);

  // ---- remote control actions ----
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel(REMOTE_CONTROL_CHANNEL);
    rcChannelRef.current = ch;
    // a receiving tab's Stop button / closing it ends the session for everyone
    ch.onmessage = (m) => {
      if (m.data?.type === 'stop-request' || m.data?.type === 'receiver-closed') remoteControlApi.stop(meetingUuid, guestToken).catch(() => {});
    };
    return () => { ch.close(); rcChannelRef.current = null; };
  }, [meetingUuid, guestToken]);

  const requestRemoteControl = useCallback(async (targetKey) => {
    setRcNotice(null);
    setRcPendingTarget(targetKey);
    try { await remoteControlApi.request(meetingUuid, guestToken, targetKey); }
    catch (err) { setRcPendingTarget(null); setRcNotice(err?.message || 'failed'); }
  }, [meetingUuid, guestToken]);

  const respondRemoteControl = useCallback((controllerKey, allow) => {
    setRcIncoming((list) => list.filter((r) => r.controllerKey !== controllerKey));
    return remoteControlApi.respond(meetingUuid, guestToken, controllerKey, allow).catch((err) => setRcNotice(err?.message || 'failed'));
  }, [meetingUuid, guestToken]);

  const stopRemoteControl = useCallback(() => remoteControlApi.stop(meetingUuid, guestToken).catch(() => {}), [meetingUuid, guestToken]);
  const sendRemoteInput = useCallback((events) => {
    if (remoteControlRef.current?.controllerKey !== myKey) return;
    remoteControlApi.input(meetingUuid, guestToken, events).catch(() => {});
  }, [meetingUuid, guestToken, myKey]);
  const clearRcNotice = useCallback(() => setRcNotice(null), []);

  return {
    sessionConflict, wbSend, wbOn,
    remoteControl, rcIncoming, rcPendingTarget, rcNotice, clearRcNotice,
    requestRemoteControl, respondRemoteControl, stopRemoteControl, sendRemoteInput,
    status, error, meetingStatus, notice, clearNotice,
    localStream, screenStream, hasCamera, micEnabled, cameraEnabled, screenSharing, canShareScreen,
    participants, meshCapacity, hasTurn, transport,
    toggleMic, toggleCamera, toggleScreenShare, leave, endMeetingForAll,
    myDisplayName, isHost,

    // بند 7/8 — Chat.
    chatMessages, chatUnreadCount, chatEnabled, sendChatMessage, reactToChatMessage, markChatRead,
    chatHistory, chatMutedKeys, deleteChatMessage,
    setChatEnabledForAll, setChatHistoryMode, setParticipantChatMuted, clearChatForAll, muteEveryone,

    // بند 11 — Raise Hand + Reactions.
    handRaised, toggleHand, reactions, reactionLog, sendReaction,
    cameraLook, setCameraLook,

    // Audio — noise isolation switch.
    noiseOn, noiseAvailable, toggleNoise, speakersMuted, toggleSpeakers,

    // بند 9 — Screen Sharing host policies.
    screenSharingLocked, myScreenShareAllowed, setScreenSharingLock, setParticipantScreenShareAllowed, forceStopScreenShare,

    // بند 5 — Host Controls / Participants Panel.
    myRole, isManager: myRole === 'host' || myRole === 'co_host', meetingLocked, kicked,
    lockMeeting, muteParticipant, disableParticipantCamera, removeParticipant, promoteParticipant, demoteParticipant, transferHost,

    // بند 19 — File Sharing.
    files, uploadFile, deleteFile,

    // بند 20 — Meeting Notes + Action Items.
    notes, actionItems, updateNotes, createActionItem, updateActionItem, deleteActionItem,

    // بند 21 — Polls.
    polls, createPoll, votePoll, closePoll,

    // بند 18 — Recording.
    recordings, activeRecording: recordings.find((r) => r.status === 'recording') || null,
    isRecordingLocally, recordingBusy, recordingError,
    startRecording, stopRecordingLocal, deleteRecording,
  };
}
