import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getTokens, MUTATION_EVENT } from '../api/client';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { createCallEngine } from '../lib/calls/callEngine';
import { startTone, stopTone, blip, unlockAudio } from '../lib/calls/ringtone';
import { attachNoiseSuppressor, noiseSuppressSupported } from '../lib/calls/noiseSuppress';
import { attachEchoGate, echoGateEnabled, setRemoteAudio } from '../lib/calls/echoGate';
import { createVideoFx } from '../lib/calls/videoFx';
import CallUI from '../components/calls/CallUI';
import GroupCallRing from '../components/calls/GroupCallRing';
import { joinGroupCall as joinGroupCallFlow, startGroupCallRequest } from '../lib/calls/groupCall';
import { CallCtx, IDLE, useCall } from './callCtx';

export { useCall };

/**
 * Global call layer: mounted once under <AuthProvider>. Polls for incoming calls on every page (so a call rings
 * wherever you are in the site), owns the single active call, and renders the incoming/active-call UI.
 * Chat components only need `const call = useCall(); call.startCall(conversationId, { name, avatar })`.
 */

const BASE = '/api/v1/messaging/calls';

// One id per page load (NOT sessionStorage: "duplicate tab" copies it and two tabs would share an id).
const CLIENT_ID = (() => {
  try {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
})();

const RESUME_KEY = 'uip.call.resume';
const NOISE_KEY = 'uip.call.noise';
const readNoisePref = () => { try { return localStorage.getItem(NOISE_KEY) !== '0'; } catch { return true; } };

/**
 * opts: { video?: boolean, audio?: boolean (default true), facing?: 'user'|'environment', noise?: boolean (default true) }
 * Noise suppression / echo cancellation / auto gain are the browser's built-in processing (the same engine Meet-style
 * web calls use); `voiceIsolation` is picked up by browsers that support it and ignored elsewhere.
 */
// The active noise-isolation graph of the current call (one mic at a time); the engine's on/off switch flips it.
let activeSuppressor = null;

const withTimeout = (p, ms, fallback = null) => new Promise((resolve) => {
  const h = setTimeout(() => resolve(fallback), ms);
  Promise.resolve(p).then((v) => { clearTimeout(h); resolve(v); }, () => { clearTimeout(h); resolve(fallback); });
});

function getUserMedia(opts = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('unsupported');
    e.name = 'NotSupportedError';
    return Promise.reject(e);
  }
  const noise = opts.noise !== false;
  // Same processing a Meet-style web call uses: the browser's own echo canceller + noise suppressor + auto gain, all on.
  // (The previous build turned auto-gain off and then boosted the mic 2.4x in software, which also boosted every bit of
  // leftover echo - that was the repeating, distorted voice.)
  const audio = opts.audio === false ? false : {
    echoCancellation: true,
    noiseSuppression: noise,
    autoGainControl: true,
    voiceIsolation: { ideal: noise }, // same constraint set the meeting room asks for
    channelCount: { ideal: 1 },
  };
  // 720p everywhere; the sender adapts down by itself when the link is weak.
  let video = false;
  if (opts.video) {
    video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
    else if (opts.facingExact) video.facingMode = { exact: opts.facingExact };
    else video.facingMode = { ideal: opts.facing === 'environment' ? 'environment' : 'user' };
  }
  // Forced echo breaker: whatever mic stream we end up with goes through the half-duplex gate (see lib/calls/echoGate.js).
  const withGate = async (s) => {
    // 1:1 calls are always full duplex (both people can talk at the same time): the half-duplex gate is never put on the call mic.
    return s;
    // eslint-disable-next-line no-unreachable
    if (!audio || !echoGateEnabled() || !s.getAudioTracks().length) return s;
    const g = await attachEchoGate(s);
    return g ? g.stream : s;
  };
  return navigator.mediaDevices.getUserMedia({ audio, video }).then(async (stream) => {
    if (!audio || !stream.getAudioTracks().length) return stream;
    // The browser already cancels echo and suppresses noise: stacking the neural filter on top of that is what made the voice
    // sound robotic. It is only added where the browser did NOT apply its own suppression.
    let st = {};
    try { st = stream.getAudioTracks()[0].getSettings() || {}; } catch { st = {}; }
    if (st.noiseSuppression === true && st.echoCancellation !== false) { activeSuppressor = null; return withGate(stream); }
    // Plain browser microphone by default (no WebAudio hop = no stutter / repeated chunks). The neural filter is opt-in: localStorage `uip.call.rnnoise` = '1'.
    let useRnn = false;
    try { useRnn = localStorage.getItem('uip.call.rnnoise') === '1'; } catch { /* private mode */ }
    if (!useRnn) { activeSuppressor = null; return withGate(stream); }
    // Never let the optional filter hold the call at "Starting…": give it a few seconds, then go on with the plain microphone.
    const ns = await withTimeout(attachNoiseSuppressor(stream, noise), 4000, null);
    if (!ns) { activeSuppressor = null; return withGate(stream); }
    activeSuppressor = ns;
    return withGate(ns.stream);
  });
}

function getDisplayMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    const e = new Error('unsupported');
    e.name = 'NotSupportedError';
    return Promise.reject(e);
  }
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
}

async function listCameras() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'videoinput');
  } catch { return []; }
}

async function countCameras() {
  const n = (await listCameras()).length;
  // phones: some WebViews list one camera until the other is opened, but front/back both exist
  return /Android|iPhone|iPad|iPod|Mobile/i.test((navigator && navigator.userAgent) || '') ? Math.max(n, 2) : n;
}

/** System notification + tab-title flash for a call that rings while the tab is in the background. */
function notifyIncoming(call, ar) {
  const name = (call && call.peer && call.peer.name) || '';
  const video = call && call.type === 'video';
  const title = video ? (ar ? 'مكالمة فيديو واردة' : 'Incoming video call') : (ar ? 'مكالمة صوتية واردة' : 'Incoming voice call');
  let n = null;
  let flash = 0;
  const prevTitle = document.title;
  if (document.visibilityState === 'hidden') {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        n = new Notification(title, { body: name, tag: 'uip-call', renotify: true, requireInteraction: true, icon: '/favicon.svg' });
        n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n && n.close(); };
      }
    } catch { /* some browsers only allow notifications via a service worker */ }
    let on = false;
    flash = setInterval(() => { on = !on; document.title = on ? `📞 ${name || title}` : prevTitle; }, 900);
  }
  return () => {
    if (flash) clearInterval(flash);
    document.title = prevTitle;
    try { n && n.close(); } catch { /* ignore */ }
  };
}

// A 0.1 s silent WAV. Playing it from inside a click "unlocks" the <audio> element on iOS Safari / Android WebView, which otherwise
// refuse to start the remote voice later (it begins asynchronously, long after the tap) - that is a classic one-way-audio cause.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// The data: URL above is blocked by the site's CSP (media-src 'self' blob: https:), so the unlock clip is served from a blob: URL instead.
let silentUrl = null;
function silentSrc() {
  if (silentUrl) return silentUrl;
  try {
    const bin = atob(SILENT_WAV.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    silentUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  } catch { silentUrl = SILENT_WAV; }
  return silentUrl;
}

export function CallProvider({ children }) {
  const { user, status, can, permissionsReady } = useAuth();
  const { locale } = useLanguage();
  const [state, setState] = useState(IDLE);
  const [media, setMedia] = useState({ local: null, remote: null }); // live MediaStreams for the <video> tags
  const [audioBlocked, setAudioBlocked] = useState(false); // the browser refused to start the other person's voice until the user taps
  const navigate = useNavigate();
  const [groupRing, setGroupRing] = useState([]); // live group calls ringing on this screen (from the poll)
  const dismissedGroup = useRef(new Set());       // meeting uuids I closed the ring for (until reload)
  const groupToneOn = useRef(false);
  const engineRef = useRef(null);
  const audioRef = useRef(null);
  const arRef = useRef(locale === 'ar');
  arRef.current = locale === 'ar';

  const enabled = status === 'authenticated' && !!user && permissionsReady && can('messaging.use');
  const userId = user && user.id;

  /** Call from a user gesture (tap on call / answer): lets the remote <audio> start later without another tap. */
  const primeAudio = () => {
    const el = audioRef.current;
    if (!el || el.srcObject) return;
    try {
      el.muted = false;
      el.volume = 1;
      el.src = silentSrc();
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* best effort */ }
  };

  /** Retry playing the remote voice (used by the "tap to enable sound" button and by any later user gesture). */
  const resumeAudio = () => {
    const el = audioRef.current;
    if (!el || !el.srcObject) return;
    el.muted = false;
    el.volume = 1;
    const p = el.play();
    if (p && p.then) p.then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    else setAudioBlocked(false);
  };

  // Sound watchdog. "Connected" + a live remote audio track does not prove the <audio> element is really playing (autoplay refusal,
  // a stalled element after the video track joined the same stream, ...). While a call is active, check that playback time advances;
  // if it doesn't: retry play(), then re-attach the stream, and finally show the "tap to enable sound" button.
  useEffect(() => {
    if (state.phase !== 'active') return undefined;
    let last = -1;
    let still = 0;
    const id = setInterval(() => {
      const el = audioRef.current;
      const stream = el && el.srcObject;
      const track = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
      if (!el || !track || track.readyState !== 'live' || track.muted) { still = 0; return; } // nothing arriving yet: not our problem
      if (el.muted) el.muted = false;
      if (el.volume < 1) el.volume = 1;
      const moving = !el.paused && el.currentTime > last;
      last = el.currentTime;
      if (moving) { if (still > 0) setAudioBlocked(false); still = 0; return; }
      still += 1;
      try { console.warn('[call] remote audio is not playing, attempt', still); } catch { /* diagnostics only */ }
      if (still === 1) {
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
      } else if (still === 2) {
        try { el.srcObject = null; el.srcObject = stream; const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
      } else {
        setAudioBlocked(true);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [state.phase]);

  // Browsers only start audio after a gesture: unlock the ringtone context on the first interaction.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const engine = createCallEngine({
      api,
      clientId: CLIENT_ID,
      base: BASE,
      getUserMedia,
      getDisplayMedia: typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? getDisplayMedia : null,
      countCameras,
      listCameras,
      createFx: createVideoFx,
      makeStream: (tracks) => new MediaStream(tracks),
      videoMaxBitrate: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ? 2500000 : 3500000,
      setLocalVideo: (stream) => setMedia((m) => (m.local === stream ? m : { ...m, local: stream })),
      setRemoteVideo: (stream) => setMedia((m) => (m.remote === stream ? m : { ...m, remote: stream })),
      initialNoise: readNoisePref(),
      onPref: (key, value) => { if (key === 'noise') { try { activeSuppressor && activeSuppressor.setEnabled(!!value); } catch { /* ignore */ } try { localStorage.setItem(NOISE_KEY, value ? '1' : '0'); } catch { /* private mode */ } } },
      createPc: (cfg) => new RTCPeerConnection(cfg),
      tones: { start: startTone, stop: stopTone, blip },
      setRemoteStream: (stream, track, receiver) => {
        const el = audioRef.current;
        if (!el) return;
        // the echo gate listens to the remote voice (analysis only) to know when to close the mic
        // 1:1 calls never use the gate, so don't spin up an extra AudioContext + 60 ms getStats polling on the voice for nothing.
        if (echoGateEnabled()) { try { setRemoteAudio('call', track && track.kind === 'audio' ? new MediaStream([track]) : (stream || null), receiver || null); } catch { /* optional */ } }
        // Voice only: hand the <audio> a stream with just the audio track, so the video track riding in the same remote stream can never interfere.
        const src = track && track.kind === 'audio' ? new MediaStream([track]) : (stream || null);
        const cur = el.srcObject;
        const same = cur && src && cur.getAudioTracks && src.getAudioTracks && cur.getAudioTracks()[0] === src.getAudioTracks()[0];
        if (!same) {
          if (el.getAttribute('src')) el.removeAttribute('src'); // the silent unlock clip must not linger next to the live stream
          el.srcObject = src;
        } // an unmute re-attach hands us the same track: don't restart playback
        if (!src) { setAudioBlocked(false); return; }
        el.muted = false;
        el.volume = 1;
        const p = el.play();
        if (p && p.then) {
          p.then(() => setAudioBlocked(false)).catch(() => {
            // autoplay refused: ask for a tap, and also retry on the very next interaction anywhere on the page
            setAudioBlocked(true);
            const retry = () => resumeAudio();
            window.addEventListener('pointerdown', retry, { once: true, capture: true });
            window.addEventListener('keydown', retry, { once: true, capture: true });
          });
        }
      },
      onGroupIncoming: (list) => {
        const next = (list || []).filter((c) => c && c.meeting_uuid && !dismissedGroup.current.has(c.meeting_uuid));
        setGroupRing((prev) => (prev.length === next.length && prev.every((p, i) => p.meeting_uuid === next[i].meeting_uuid) ? prev : next));
      },
      onChange: setState,
      onFinished: () => {
        // The log message (and the inbox preview) changed on the server: let chat pages refetch right away.
        try { window.dispatchEvent(new CustomEvent(MUTATION_EVENT, { detail: { method: 'POST', path: BASE } })); } catch { /* ignore */ }
      },
      isHidden: () => document.visibilityState === 'hidden',
      notify: (kind, call) => notifyIncoming(call, arRef.current),
      vibrate: (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* ignore */ } },
    });
    engineRef.current = engine;
    engine.start();

    const onVisible = () => { if (document.visibilityState === 'visible') engine.kick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // Instant ring: server "call" ping (Reverb) or a phone push arriving while the app is open -> poll right now, don't wait for the next tick.
    const onRt = (e) => { if (e?.detail?.topic === 'call') engine.kick(); };
    const onPush = (e) => { const t = e?.detail?.type; if (t === 'incoming_call' || t === 'call_cancel' || e?.detail?.resume) engine.kick(); };
    window.addEventListener('uip:rt', onRt);
    window.addEventListener('uip:push-received', onPush);
    // Reload vs. close: a reload must NOT hang up. While the call is live (connecting/active) we only remember it in sessionStorage
    // (survives a reload, vanishes when the tab is closed) and the reloaded page re-joins it; if nobody comes back the server hangs
    // up by itself after ~25 s. A call that is still ringing out (nobody answered yet) is cancelled right away, as before.
    const leave = () => {
      const s = engine.getState();
      if (!s.call) return;
      if (s.phase === 'connecting' || s.phase === 'active') {
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({
            ts: Date.now(), userId,
            call: { id: s.call.id, role: s.call.role, type: s.call.type },
            peer: s.peer, callType: s.callType, startedAt: s.startedAt || 0, muted: !!s.muted, camOn: !!s.camOn, noiseOn: s.noiseOn !== false,
          }));
        } catch { /* storage blocked: the call just ends after ~25 s */ }
        return;
      }
      if (s.phase !== 'outgoing') return;
      try {
        const { accessToken } = getTokens();
        fetch(`${BASE}/${s.call.id}/end`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({ reason: 'hangup' }),
        }).catch(() => {});
      } catch { /* the server's 25 s heartbeat timeout is the fallback */ }
    };
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', leave);

    // Re-join the call the previous page left (see above). Deferred a tick so React StrictMode's throw-away first mount never consumes it.
    const resumeTimer = setTimeout(() => {
      let rec = null;
      try {
        const raw = sessionStorage.getItem(RESUME_KEY);
        if (raw) { sessionStorage.removeItem(RESUME_KEY); rec = JSON.parse(raw); }
      } catch { rec = null; }
      if (rec && rec.call && rec.call.id && String(rec.userId) === String(userId) && Date.now() - Number(rec.ts || 0) < 60000) engine.resume(rec);
    }, 60);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('uip:rt', onRt);
      window.removeEventListener('uip:push-received', onPush);
      clearTimeout(resumeTimer);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', leave);
      engine.stop();
      engineRef.current = null;
      setState(IDLE);
      setMedia({ local: null, remote: null });
      setAudioBlocked(false);
      setGroupRing([]);
    };
  }, [enabled, userId]);

  // Ring while a group call is waiting for me (and I'm not in a 1:1 call). The 1:1 engine owns the tone once a direct call comes in.
  useEffect(() => {
    const should = groupRing.length > 0 && state.phase === 'idle';
    if (should && !groupToneOn.current) { groupToneOn.current = true; startTone('incoming'); }
    else if (!should && groupToneOn.current) { groupToneOn.current = false; if (state.phase === 'idle') stopTone(); }
  }, [groupRing, state.phase]);
  useEffect(() => () => { if (groupToneOn.current) { groupToneOn.current = false; stopTone(); } }, []);

  const actions = useMemo(() => ({
    startCall: (conversationId, peer, opts) => { primeAudio(); return engineRef.current ? engineRef.current.startCall(conversationId, peer, opts) : Promise.resolve(false); },
    accept: (opts) => { primeAudio(); return engineRef.current && engineRef.current.accept(opts); },
    resumeAudio: () => resumeAudio(),
    getDiagnostics: () => (engineRef.current && engineRef.current.diagnostics ? engineRef.current.diagnostics() : Promise.resolve(null)),
    toggleCamera: () => engineRef.current && engineRef.current.toggleCamera(),
    switchCamera: () => engineRef.current && engineRef.current.switchCamera(),
    toggleScreenShare: () => engineRef.current && engineRef.current.toggleScreenShare(),
    setFilter: (name) => engineRef.current && engineRef.current.setFilter(name),
    setFilterAmount: (v) => engineRef.current && engineRef.current.setFilterAmount(v),
    setNoise: (on) => engineRef.current && engineRef.current.setNoise(on),
    decline: () => engineRef.current && engineRef.current.decline(),
    hangup: () => engineRef.current && engineRef.current.hangup(),
    toggleMute: () => engineRef.current && engineRef.current.toggleMute(),
    setMinimized: (v) => engineRef.current && engineRef.current.setMinimized(v),
    dismissNotice: () => engineRef.current && engineRef.current.dismissNotice(),
  }), []);

  const role = user && user.role;
  const groupActions = useMemo(() => ({
    dismissGroupRing: (uuid) => {
      if (uuid) dismissedGroup.current.add(uuid);
      setGroupRing((prev) => prev.filter((c) => c.meeting_uuid !== uuid));
    },
    /** Join a live group call (from the ring or the chat card). Throws a readable error when not allowed / already over. */
    joinGroupCall: async (call) => {
      primeAudio();
      if (call && call.meeting_uuid) {
        dismissedGroup.current.add(call.meeting_uuid);
        setGroupRing((prev) => prev.filter((c) => c.meeting_uuid !== call.meeting_uuid));
      }
      await joinGroupCallFlow(api, navigate, role, call);
      return true;
    },
    /** Start the group's call, or join the one already live, and go straight into the room. */
    startGroupCall: async (conversationId, opts = {}) => {
      primeAudio();
      const call = await startGroupCallRequest(api, BASE, conversationId, opts.video ? 'video' : 'audio');
      dismissedGroup.current.add(call.meeting_uuid);
      await joinGroupCallFlow(api, navigate, role, call);
      return true;
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [navigate, role]);

  const value = useMemo(() => ({ ...state, ...actions, ...groupActions, groupRing, localVideo: media.local, remoteVideo: media.remote, audioBlocked }), [state, actions, groupActions, groupRing, media, audioBlocked]);

  return (
    <CallCtx.Provider value={value}>
      {children}
      {/* The remote voice plays here; it must stay mounted for the whole call. */}
      {/* not display:none - some WebViews / Safari pause media elements that are not rendered */}
      <audio ref={audioRef} data-persist-media="1" autoPlay playsInline style={{ position: 'fixed', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: 0, top: 0 }} />
      {enabled && <CallUI />}
      {enabled && <GroupCallRing />}
    </CallCtx.Provider>
  );
}
