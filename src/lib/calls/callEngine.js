/**
 * Call engine (1:1 voice + video) — framework-free so it can be unit-tested with fakes.
 *
 * Signaling is polling against /api/v1/messaging/calls/* (the chat itself polls too, so no websocket is needed):
 * the audio goes browser-to-browser over WebRTC and the server only relays offer/answer/ICE + keeps call state.
 *
 *   caller:  startCall → getUserMedia → POST /calls → peer connection → offer (signal) → poll for answer/ICE
 *   callee:  poll shows it in `incoming` → accept → getUserMedia → POST accept → peer connection →
 *            poll delivers the offer → answer (signal)
 *   either:  heartbeat = every poll that carries call_id; the server ends a call whose peer went silent for ~25 s
 *
 * phases: idle | starting | outgoing | incoming | connecting | active
 * Roles are fixed (only the caller makes offers, incl. ICE restarts) so there is no offer "glare" to resolve.
 * The engine owns NO React/DOM state; everything it needs from the outside is injected via `deps`.
 */

export const CLOSED = ['ended', 'declined', 'cancelled', 'missed', 'busy', 'failed'];
export const BUSY_PHASES = ['starting', 'outgoing', 'incoming', 'connecting', 'active'];

const IDLE_STATE = {
  phase: 'idle', call: null, peer: null, muted: false, peerMuted: false, quality: 'good',
  reconnecting: false, accepting: false, startedAt: 0, notice: null, minimized: false, available: false, videoEnabled: false, noAccess: false,
  // video: callType is fixed at start; camOn/sharing = what I send, peerCam/peerSharing = what the other side says it sends
  callType: 'audio', camOn: false, peerCam: false, sharing: false, peerSharing: false, facing: 'user', canSwitchCam: false, filter: 'none', filterAmount: 100,
  noiseOn: true,
};

export const VIDEO_FILTERS = ['none', 'enhance', 'soft', 'studio', 'warm', 'cool', 'cinema', 'mono', 'blur'];

/**
 * Local SDP tuning, applied to MY description before it is sent (the other side's encoder reads it):
 *  - Opus: in-band FEC (a lost packet is rebuilt instead of leaving a gap), mono, ~40 kbps - plenty for speech, no DTX (DTX makes
 *    the voice "pump" when it is combined with noise isolation).
 *  - Video: start/min/max bitrate hints so the picture starts sharp instead of ramping up from a blurry 300 kbps.
 * Anything unexpected returns the SDP untouched.
 */
export function tuneSdp(sdp, maxVideoBps = 3500000) {
  if (typeof sdp !== 'string' || sdp.indexOf('m=') === -1) return sdp;
  try {
    const maxK = Math.round(maxVideoBps / 1000);
    const startK = Math.min(maxK, 900);
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);
    const res = [];
    let kind = '';
    // payload types of real codecs per m-section, to know where a missing a=fmtp must be added
    const sectionCodecs = {};
    let cur = -1;
    lines.forEach((ln) => {
      if (ln.startsWith('m=')) { cur += 1; sectionCodecs[cur] = {}; }
      const m = /^a=rtpmap:(\d+) ([A-Za-z0-9-]+)\//.exec(ln);
      if (m && cur >= 0) sectionCodecs[cur][m[1]] = m[2].toUpperCase();
    });
    const wantAudio = (pt, codec) => codec === 'OPUS';
    const wantVideo = (pt, codec) => ['VP8', 'VP9', 'H264', 'AV1', 'H265'].includes(codec);
    const audioParams = 'useinbandfec=1;stereo=0;sprop-stereo=0;usedtx=0;cbr=0;minptime=10;maxaveragebitrate=64000;maxplaybackrate=48000';
    const videoParams = `x-google-min-bitrate=150;x-google-start-bitrate=${startK};x-google-max-bitrate=${maxK}`;
    const merge = (existing, extra) => {
      const have = new Set(existing.split(';').map((x) => x.split('=')[0].trim()));
      const add = extra.split(';').filter((x) => !have.has(x.split('=')[0]));
      return add.length ? `${existing};${add.join(';')}` : existing;
    };
    cur = -1;
    const fmtpSeen = new Set();
    lines.forEach((ln) => {
      if (ln.startsWith('m=')) { cur += 1; kind = ln.slice(2, ln.indexOf(' ')); }
      const f = /^a=fmtp:(\d+) (.*)$/.exec(ln);
      if (f && cur >= 0) {
        const codec = sectionCodecs[cur][f[1]];
        if (kind === 'audio' && wantAudio(f[1], codec)) { fmtpSeen.add(`${cur}:${f[1]}`); res.push(`a=fmtp:${f[1]} ${merge(f[2], audioParams)}`); return; }
        if (kind === 'video' && wantVideo(f[1], codec)) { fmtpSeen.add(`${cur}:${f[1]}`); res.push(`a=fmtp:${f[1]} ${merge(f[2], videoParams)}`); return; }
      }
      res.push(ln);
      const r = /^a=rtpmap:(\d+) /.exec(ln);
      if (r && cur >= 0) {
        const codec = sectionCodecs[cur][r[1]];
        const needs = (kind === 'video' && wantVideo(r[1], codec)) ? videoParams : (kind === 'audio' && wantAudio(r[1], codec)) ? audioParams : '';
        if (needs && !lines.some((x) => x.startsWith(`a=fmtp:${r[1]} `))) res.push(`a=fmtp:${r[1]} ${needs}`);
      }
    });
    return res.join(eol);
  } catch { return sdp; }
}

export function createCallEngine(deps) {
  const {
    api, clientId, getUserMedia, createPc, tones, setRemoteStream, onChange, onFinished,
    isHidden = () => false, notify = () => () => {}, vibrate = () => {}, now = () => Date.now(),
    // video-only helpers (all optional, so voice-only hosts/tests keep working)
    setLocalVideo = () => {}, setRemoteVideo = () => {}, makeStream = (tracks) => ({ getTracks: () => tracks }),
    videoMaxBitrate = 2500000, createFx = null, getDisplayMedia = null, countCameras = async () => 1, listCameras = null, onPref = () => {}, initialNoise = true,
    base = '/api/v1/messaging/calls',
    // group calls ringing on this user's screen (the poll carries them; the host app owns the UI)
    onGroupIncoming = () => {},
    timers = {
      setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a),
      setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a),
    },
  } = deps;

  const st = { ...IDLE_STATE, noiseOn: initialNoise !== false };
  let pc = null;
  let localStream = null;
  let camTrack = null;      // raw camera track (null = camera off / audio-only)
  let screenTrack = null;   // screen-share track while sharing
  let fx = null;            // canvas filter pipeline (only created when a filter is picked)
  let remoteVideo = null;   // MediaStream with the peer's video track
  let pendingIce = [];
  let lastSignalId = 0;
  let pollTimer = 0;
  let polling = false;
  let stopped = true;
  let failures = 0;
  let attempt = 0; // bumps when a "starting" attempt is cancelled
  let sendChain = Promise.resolve();
  let iceCache = null; // { servers, at, video }
  let connectTimer = 0;
  let disconnectTimer = 0;
  let restartTimer = 0;
  let statsTimer = 0;
  let closeNotify = null;
  let noticeTimer = 0;
  let lastLoss = { lost: 0, recv: 0 };
  let makingOffer = false;
  let resuming = false;       // a page reload is re-joining a live call: polling is paused until the server has re-bound it to this page
  let resumeWindowUntil = 0;  // right after a reload on either side, stale offers/answers from the old connection may still arrive: tolerate them
  let needStats = false;      // the peer connection was replaced while active: restart the stats watcher + sender tuning when it connects
  let rebuilding = false;     // the peer reloaded: my side of the connection is being recreated
  let resumedStartedAt = 0;   // keeps the call timer running across the reload
  const ignored = new Set(); // call ids I already handled/closed — never ring for them again

  const emit = () => { try { onChange && onChange({ ...st }); } catch { /* UI errors must not break the engine */ } };
  const set = (patch) => { Object.assign(st, patch); emit(); };
  const isCaller = () => !!st.call && st.call.role === 'caller';
  const sleep = (ms) => new Promise((r) => timers.setTimeout(r, ms));

  // ------------------------------------------------------------------ helpers

  function stopStream(s) {
    try { (s || localStream)?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
  }

  /** Releases mic + camera right now (used when a call attempt is abandoned before it exists). */
  function dropMedia() {
    stopStream();
    localStream = null;
    try { camTrack && camTrack.stop(); } catch { /* ignore */ }
    camTrack = null;
    try { setLocalVideo(null); } catch { /* ignore */ }
  }

  // ---- video helpers ----------------------------------------------------------------------------------------

  const firstVideoTrack = (stream) => {
    try { return (stream && stream.getVideoTracks && stream.getVideoTracks()[0]) || null; } catch { return null; }
  };

  /** Remember the camera track of a freshly acquired stream and show it in the local preview. */
  function adoptStream(stream) {
    camTrack = firstVideoTrack(stream);
    watchCam(camTrack);
    try { const f = trackFacing(camTrack); if (f && f !== st.facing) st.facing = f; } catch { /* ignore */ }
    try { setLocalVideo(camTrack ? makeStream([camTrack]) : null); } catch { /* preview is best-effort */ }
    if (camTrack && countCameras) {
      Promise.resolve(countCameras()).then((n) => { if (camTrack) set({ canSwitchCam: n > 1 }); }).catch(() => {});
    }
  }


  const BACK_RE = /back|rear|environment|world|خلف/i;
  const FRONT_RE = /front|user|face|selfie|أمام/i;
  const settingsOf = (t) => { try { return (t && t.getSettings && t.getSettings()) || {}; } catch { return {}; } };
  /** 'user' | 'environment' | '' (unknown) — from the track itself, never from what we asked for. */
  function trackFacing(t) {
    const s = settingsOf(t);
    if (s.facingMode === 'environment' || s.facingMode === 'user') return s.facingMode;
    const label = (t && t.label) || '';
    if (BACK_RE.test(label)) return 'environment';
    return label ? 'user' : '';
  }
  let switching = false;

  // ---- camera health: a webcam can stall mid-call (driver hiccup, camera shared with another window/app). The preview then
  // freezes and the peer sees black. Browsers flag it as a muted/ended track, or the encoder stops producing frames.
  let camWatch = 0;
  let camReopens = 0;

  function watchCam(track) {
    if (!track) return;
    const bad = () => {
      if (camTrack !== track || !inLiveCall() || camWatch) return;
      camWatch = timers.setTimeout(() => {
        camWatch = 0;
        if (camTrack === track && st.camOn && !st.sharing && (track.muted || track.readyState === 'ended')) reopenCamera();
      }, 2500);
    };
    try { track.onmute = bad; track.onended = bad; } catch { /* ignore */ }
  }

  async function reopenCamera() {
    if (!st.call || !st.camOn || st.sharing || camReopens >= 4) return;
    camReopens += 1;
    const id = st.call.id;
    try { console.warn('[call] camera stalled - reopening it', camReopens); } catch { /* diagnostics only */ }
    try { camTrack && camTrack.stop(); } catch { /* ignore */ }
    try {
      const stream = await getUserMedia({ video: true, audio: false, facing: st.facing, noise: st.noiseOn });
      if (!st.call || st.call.id !== id) { stopStream(stream); return; }
      camTrack = firstVideoTrack(stream);
      watchCam(camTrack);
      await applyOutgoingVideo();
    } catch { /* the camera is really gone; the user can toggle it manually */ }
  }

  /** The video m-line's transceiver (exists in video calls only). Its sender is how camera/screen/filters are swapped without renegotiating. */
  function videoTransceiver() {
    if (!pc || !pc.getTransceivers) return null;
    try {
      return pc.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'video') || null;
    } catch { return null; }
  }

  /** Pushes whatever should be on the wire now (screen > camera, through the filter if one is picked) and updates the preview. */
  async function applyOutgoingVideo() {
    const src = screenTrack || camTrack;
    let out = src;
    if (src && !screenTrack && st.filter !== 'none' && createFx) {
      try {
        if (!fx) fx = createFx();
        out = fx.attach(src, st.filter, (st.filterAmount == null ? 100 : st.filterAmount) / 100) || src;
        if (out === src && st.filter !== 'none') st.filter = 'none'; // canvas filters unsupported here
      } catch { out = src; st.filter = 'none'; }
    } else if (fx) {
      try { fx.stop(); } catch { /* ignore */ }
      fx = null;
    }
    try { if (out) out.contentHint = screenTrack ? 'detail' : 'motion'; } catch { /* optional hint for the encoder */ }
    const vt = videoTransceiver();
    if (vt && vt.sender) {
      try { await vt.sender.replaceTrack(out || null); } catch { /* the peer just keeps the last frame; the next change retries */ }
    }
    try { setLocalVideo(out ? makeStream([out]) : null); } catch { /* ignore */ }
    emit();
  }

  /** Tells the other side what I am sending (mute / camera / screen). */
  function sendState() {
    if (!st.call) return Promise.resolve();
    return sendSignal('state', { muted: st.muted, cam: st.camOn, sharing: st.sharing });
  }

  function clearCallTimers() {
    [connectTimer, disconnectTimer, restartTimer, noticeTimer].forEach((h) => h && timers.clearTimeout(h));
    connectTimer = disconnectTimer = restartTimer = noticeTimer = 0;
    if (statsTimer) timers.clearInterval(statsTimer);
    statsTimer = 0;
  }

  /** Releases mic, peer connection and timers. Does NOT touch phase/notice. */
  function teardown() {
    clearCallTimers();
    const old = pc;
    pc = null;
    if (old) {
      old.onicecandidate = old.ontrack = old.onconnectionstatechange = old.oniceconnectionstatechange = null;
      try { old.close(); } catch { /* ignore */ }
    }
    stopStream();
    localStream = null;
    try { camTrack && camTrack.stop(); } catch { /* ignore */ }
    try { screenTrack && screenTrack.stop(); } catch { /* ignore */ }
    camTrack = null;
    screenTrack = null;
    if (fx) { try { fx.stop(); } catch { /* ignore */ } fx = null; }
    remoteVideo = null;
    try { setLocalVideo(null); setRemoteVideo(null); } catch { /* ignore */ }
    pendingIce = [];
    lastSignalId = 0;
    sendChain = Promise.resolve();
    makingOffer = false;
    lastLoss = { lost: 0, recv: 0 };
    stallTicks = 0; lastIn = -1; recoveries = 0; frameStall = 0; lastFrames = -1; camReopens = 0;
    if (camWatch) { timers.clearTimeout(camWatch); camWatch = 0; }
    try { setRemoteStream && setRemoteStream(null, null); } catch { /* ignore */ }
    try { vibrate(0); } catch { /* ignore */ }
    if (closeNotify) { try { closeNotify(); } catch { /* ignore */ } closeNotify = null; }
  }

  function durationOf(serverCall) {
    if (serverCall && serverCall.duration_seconds != null) return serverCall.duration_seconds;
    return st.startedAt ? Math.max(0, Math.round((now() - st.startedAt) / 1000)) : 0;
  }

  /** What the person should be told when a call closes (null = nothing: they caused it / it is obvious). */
  function noticeFor(status, role, serverCall, byMe) {
    const name = (st.peer && st.peer.name) || '';
    const reason = serverCall && serverCall.end_reason;
    if (status === 'ended') {
      if (reason === 'connection_lost') return { kind: 'lost', name };
      if (reason === 'failed') return { kind: 'failed', name };
      return { kind: 'ended', name, duration: durationOf(serverCall) };
    }
    if (status === 'failed') return { kind: 'failed', name };
    if (byMe) return null;
    if (role === 'caller') {
      if (status === 'declined') return { kind: 'declined', name };
      if (status === 'busy') return { kind: 'busy', name };
      if (status === 'missed') return { kind: 'noanswer', name };
      return null;
    }
    if (status === 'missed' || status === 'cancelled') return { kind: 'missed', name };
    return null;
  }

  /**
   * Closes the local side. `opts.byMe` = I pressed the button; `opts.silent` = no toast (answered elsewhere…);
   * `opts.notice` overrides the computed toast.
   */
  function finish(status, serverCall, opts = {}) {
    const call = serverCall || st.call;
    const phaseBefore = st.phase;
    const role = (call && call.role) || (st.call && st.call.role) || null;
    const wasLive = ['outgoing', 'connecting', 'active'].includes(phaseBefore);
    const wasActive = phaseBefore === 'active' || (phaseBefore === 'connecting' && st.startedAt);
    const notice = opts.silent ? null : (opts.notice !== undefined ? opts.notice : noticeFor(status, role, call, !!opts.byMe));
    const duration = durationOf(call);
    if (call && call.id != null) ignored.add(call.id);
    tones.stop();
    if (wasLive && !opts.silent && wasActive) tones.blip('end');
    teardown();
    st.phase = 'idle';
    st.call = null;
    st.peer = null;
    st.muted = false;
    st.peerMuted = false;
    st.quality = 'good';
    st.reconnecting = false;
    st.accepting = false;
    st.startedAt = 0;
    st.minimized = false;
    st.callType = 'audio';
    st.camOn = false;
    st.peerCam = false;
    st.sharing = false;
    st.peerSharing = false;
    st.filter = 'none';
    st.facing = 'user';
    st.canSwitchCam = false;
    st.notice = notice;
    emit();
    if (notice) {
      noticeTimer = timers.setTimeout(() => { if (st.notice === notice) set({ notice: null }); }, notice.kind === 'ended' ? 4000 : 6000);
    }
    try { onFinished && onFinished({ call, status, phase: phaseBefore, duration, silent: !!opts.silent, byMe: !!opts.byMe }); } catch { /* ignore */ }
    schedule(300);
  }

  function failNotice(kind, message) {
    return { kind, message: message || '' };
  }

  function micNotice(err, video = false) {
    const n = err && err.name;
    if (video) {
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return failNotice('cam_denied');
      if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return failNotice('cam_missing');
      if (n === 'NotSupportedError') return failNotice('unsupported');
      return failNotice('cam_error');
    }
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return failNotice('mic_denied');
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return failNotice('mic_missing');
    if (n === 'NotSupportedError') return failNotice('unsupported');
    return failNotice('mic_error');
  }

  async function getIce() {
    if (iceCache && now() - iceCache.at < 5 * 60 * 1000) return iceCache;
    const res = await api.get(`${base}/ice`);
    const d = (res && res.data) || {};
    iceCache = { servers: d.ice_servers || [], at: now(), video: !!d.video_enabled };
    try {
      const urls = iceCache.servers.flatMap((x) => [].concat(x.urls || []));
      // eslint-disable-next-line no-console
      console.info('[call] ice config', { turn: !!d.turn, servers: iceCache.servers.length, hasTurnUrl: urls.some((u) => /^turns?:/i.test(u)), urls: urls.map((u) => String(u).split('?')[0]) });
    } catch { /* diagnostics only */ }
    if (st.videoEnabled !== iceCache.video) set({ videoEnabled: iceCache.video });
    return iceCache;
  }

  // ------------------------------------------------------------------ signaling out

  function sendSignal(kind, payload) {
    const call = st.call;
    if (!call) return Promise.resolve();
    const id = call.id;
    sendChain = sendChain.then(async () => {
      for (let i = 0; i < 3; i += 1) {
        if (!st.call || st.call.id !== id) return;
        try {
          await api.postQuiet(`${base}/${id}/signal`, { client_id: clientId, kind, payload });
          return;
        } catch (e) {
          const s = e && e.status;
          if (s && s < 500 && s !== 429) return; // permanent (call over / other window): don't retry
          await sleep(400 * (i + 1));
        }
      }
    });
    return sendChain;
  }

  // ------------------------------------------------------------------ peer connection

  async function buildPc() {
    const ice = await getIce();
    if (!st.call) throw new Error('call gone');
    const conn = createPc({ iceServers: ice.servers });
    pc = conn;
    if (localStream) localStream.getTracks().forEach((t) => conn.addTrack(t, localStream));
    conn.onicecandidate = (e) => {
      if (pc !== conn || !e.candidate) return;
      try {
        // eslint-disable-next-line no-console
        console.info('[call] local candidate', e.candidate.type || (/ typ (\w+)/.exec(e.candidate.candidate || '') || [])[1]);
      } catch { /* diagnostics only */ }
      sendSignal('ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
    };
    conn.ontrack = (e) => {
      if (pc !== conn) return;
      const track = e.track || null;
      if (track && track.kind === 'video') {
        const attachVideo = () => { try { remoteVideo = makeStream([track]); setRemoteVideo(remoteVideo); } catch { /* ignore */ } };
        attachVideo();
        // A remote track is "muted" until its first RTP packet arrives. Some browsers / WebViews attach the <video> too early and
        // keep painting black, so hand the element a fresh stream the moment real frames start flowing.
        try { track.onunmute = () => { if (pc === conn) attachVideo(); }; } catch { /* ignore */ }
        return;
      }
      const attachAudio = () => { try { setRemoteStream && setRemoteStream((e.streams && e.streams[0]) || null, track, e.receiver || null); } catch { /* ignore */ } };
      attachAudio();
      // Same idea for sound: if the first play() was refused (autoplay policy) or happened before any packet, try again on unmute.
      try { if (track) track.onunmute = () => { if (pc === conn) attachAudio(); }; } catch { /* ignore */ }
    };
    const onState = () => { if (pc === conn) onConnState(conn); };
    conn.onconnectionstatechange = onState;
    conn.oniceconnectionstatechange = onState;
    return conn;
  }

  function startConnectTimer() {
    if (connectTimer) timers.clearTimeout(connectTimer);
    connectTimer = timers.setTimeout(() => {
      connectTimer = 0;
      if (st.phase === 'connecting') {
        try {
          // eslint-disable-next-line no-console
          console.warn('[call] connect timeout', { conn: pc && pc.connectionState, ice: pc && pc.iceConnectionState, signaling: pc && pc.signalingState });
        } catch { /* diagnostics only */ }
        endLocal('failed');
      }
    }, 30000);
  }

  function onConnState(conn) {
    const s = conn.connectionState && conn.connectionState !== 'new' ? conn.connectionState : conn.iceConnectionState;
    try {
      // eslint-disable-next-line no-console
      console.info('[call] state', { conn: conn.connectionState, ice: conn.iceConnectionState, gathering: conn.iceGatheringState, phase: st.phase });
    } catch { /* diagnostics only */ }
    if (s === 'connected' || s === 'completed') {
      if (disconnectTimer) { timers.clearTimeout(disconnectTimer); disconnectTimer = 0; }
      if (restartTimer) { timers.clearTimeout(restartTimer); restartTimer = 0; }
      if (connectTimer) { timers.clearTimeout(connectTimer); connectTimer = 0; }
      if (needStats && st.phase === 'active') { needStats = false; startStats(conn); tuneVideoSender(conn); }
      const first = st.phase !== 'active';
      if (first) {
        tones.stop();
        tones.blip('connect');
        st.startedAt = resumedStartedAt || now();
        resumedStartedAt = 0;
        st.phase = 'active';
        startStats(conn);
        tuneVideoSender(conn);
        sendState();
      }
      st.reconnecting = false;
      if (st.quality === 'poor') st.quality = 'fair';
      emit();
    } else if (s === 'disconnected' || s === 'failed') {
      if (st.phase !== 'active' && st.phase !== 'connecting') return;
      if (st.phase === 'active') set({ reconnecting: true, quality: 'poor' });
      if (isCaller()) {
        if (!restartTimer) restartTimer = timers.setTimeout(() => { restartTimer = 0; restartIce(); }, s === 'failed' ? 0 : 2500);
      }
      if (!disconnectTimer) {
        const wasActive = st.phase === 'active';
        disconnectTimer = timers.setTimeout(() => {
          disconnectTimer = 0;
          endLocal(wasActive ? 'connection_lost' : 'failed');
        }, wasActive ? 15000 : 10000);
      }
    }
  }

  const hasTurn = () => !!(iceCache && iceCache.servers.some((x) => [].concat(x.urls || []).some((u) => /^turns?:/i.test(u))));

  async function restartIce(relay = false) {
    const conn = pc;
    if (!conn || !isCaller() || makingOffer) return;
    makingOffer = true;
    try {
      if (relay && hasTurn() && conn.getConfiguration && conn.setConfiguration) {
        // direct path is up but carries no media (one-way audio / black video): force everything through the TURN relay
        try { conn.setConfiguration({ ...conn.getConfiguration(), iceTransportPolicy: 'relay' }); } catch { /* keep going with a plain restart */ }
        try { console.warn('[call] no media on the direct path - restarting ICE through TURN relay'); } catch { /* diagnostics only */ }
      }
      if (conn.restartIce) conn.restartIce();
      let offer = await conn.createOffer({ iceRestart: true });
      if (offer && offer.sdp) offer = { type: offer.type, sdp: tuneSdp(offer.sdp, videoMaxBitrate) };
      if (pc !== conn) return;
      await conn.setLocalDescription(offer);
      await sendSignal('offer', { type: offer.type, sdp: offer.sdp });
    } catch { /* the disconnect timer ends the call if this never recovers */ } finally {
      makingOffer = false;
    }
  }

  /**
   * "Connected" does not prove sound/video really flows (one-way NAT/firewall paths look connected). While active we watch the
   * inbound audio counters; if nothing arrives for ~8 s we recover: the caller restarts ICE (second time through the TURN relay),
   * the callee asks the caller to do it with a `state` signal.
   */
  let stallTicks = 0;
  let lastIn = -1;
  let recoveries = 0;
  let frameStall = 0;
  let lastFrames = -1;

  function recoverMedia() {
    if (recoveries >= 3) return;
    recoveries += 1;
    stallTicks = 0;
    set({ quality: 'poor' });
    if (isCaller()) restartIce(recoveries >= 2);
    else sendSignal('state', { muted: st.muted, cam: st.camOn, sharing: st.sharing, restart: true, attempt: recoveries });
  }

  /** Set the video bitrate ceiling (a generous one: the browser still adapts down by itself when the link is weak). */
  async function tuneVideoSender(conn) {
    try {
      const vt = conn.getTransceivers ? conn.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'video') : null;
      if (!vt || !vt.sender || !vt.sender.getParameters || !vt.sender.setParameters) throw new Error('no video sender');
      const params = vt.sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = videoMaxBitrate;
      params.encodings[0].maxFramerate = 30;
      params.encodings[0].scaleResolutionDownBy = 1;     // never send a downscaled picture unless the browser has to
      params.encodings[0].networkPriority = 'medium';
      params.degradationPreference = 'balanced'; // weak link: lower resolution AND fps a little instead of freezing the picture
      await vt.sender.setParameters(params);
    } catch { /* optional tuning */ }
    try { // voice: small constant bitrate budget, top priority on the wire
      const at = conn.getTransceivers ? conn.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') : null;
      if (at && at.sender && at.sender.getParameters && at.sender.setParameters) {
        const ap = at.sender.getParameters();
        if (!ap.encodings || !ap.encodings.length) ap.encodings = [{}];
        ap.encodings[0].maxBitrate = 64000;
        ap.encodings[0].priority = 'high';
        ap.encodings[0].networkPriority = 'high';
        await at.sender.setParameters(ap);
      }
    } catch { /* optional tuning */ }
  }

  function startStats(conn) {
    if (statsTimer) timers.clearInterval(statsTimer);
    stallTicks = 0; lastIn = -1; recoveries = 0; frameStall = 0; lastFrames = -1; camReopens = 0;
    if (!conn.getStats) return;
    statsTimer = timers.setInterval(async () => {
      if (pc !== conn || st.reconnecting) return;
      try {
        const report = await conn.getStats();
        let lost = 0; let recv = 0; let rtt = 0; let inAudio = 0; let vFrames = -1;
        report.forEach((r) => {
          if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) { lost = r.packetsLost || 0; recv = r.packetsReceived || 0; inAudio = (r.bytesReceived || 0) + (r.packetsReceived || 0); }
          if (r.type === 'outbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) vFrames = r.framesEncoded != null ? r.framesEncoded : (r.framesSent != null ? r.framesSent : -1);
          if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.currentRoundTripTime) rtt = r.currentRoundTripTime;
        });
        // my camera should keep producing frames even for a still scene; a flat counter = frozen camera
        if (vFrames >= 0 && st.camOn && !st.sharing && camTrack && st.phase === 'active') {
          if (vFrames <= lastFrames) { frameStall += 1; } else { frameStall = 0; }
          lastFrames = vFrames;
          if (frameStall >= 2) { frameStall = 0; reopenCamera(); }
        } else { frameStall = 0; lastFrames = vFrames; }
        const dl = Math.max(0, lost - lastLoss.lost);
        const dr = Math.max(0, recv - lastLoss.recv);
        lastLoss = { lost, recv };
        const ratio = dl + dr > 0 ? dl / (dl + dr) : 0;
        const q = ratio > 0.15 || rtt > 0.6 ? 'poor' : (ratio > 0.05 || rtt > 0.3 ? 'fair' : 'good');
        if (q !== st.quality) set({ quality: q });
        // media watchdog (audio is always negotiated; a muted mic still sends silence packets, so a flat counter means a dead path)
        if (inAudio > lastIn) { stallTicks = 0; } else if (st.phase === 'active') { stallTicks += 1; }
        lastIn = inAudio;
        if (stallTicks >= 2) recoverMedia();
      } catch { /* stats are best-effort */ }
    }, 4000);
  }

  /** Snapshot for the on-screen debug panel (and the console): what is really flowing, and over which kind of path. */
  async function diagnostics() {
    const conn = pc;
    if (!conn || !conn.getStats) return null;
    const out = {
      conn: conn.connectionState, ice: conn.iceConnectionState, signaling: conn.signalingState, turnConfigured: hasTurn(),
      audio: { in: 0, out: 0, lost: 0, inLevel: 0, micLevel: 0 }, video: { in: 0, out: 0, frames: 0 }, path: null, recoveries,
    };
    try {
      const rep = await conn.getStats();
      const byId = {};
      let selectedId = null;
      rep.forEach((r) => { byId[r.id] = r; if (r.type === 'transport' && r.selectedCandidatePairId) selectedId = r.selectedCandidatePairId; });
      rep.forEach((r) => {
        const k = r.kind || r.mediaType;
        if (r.type === 'inbound-rtp' && (k === 'audio' || k === 'video')) { out[k].in = r.bytesReceived || 0; if (k === 'audio') { out.audio.lost = r.packetsLost || 0; out.audio.inLevel = r.audioLevel || 0; } else out.video.frames = r.framesDecoded || 0; }
        if (r.type === 'media-source' && k === 'audio') out.audio.micLevel = r.audioLevel || 0;
        if (r.type === 'outbound-rtp' && (k === 'audio' || k === 'video')) out[k].out = r.bytesSent || 0;
        if (!selectedId && r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') selectedId = r.id;
      });
      const pair = selectedId && byId[selectedId];
      if (pair) {
        const l = byId[pair.localCandidateId] || {};
        const rm = byId[pair.remoteCandidateId] || {};
        out.path = { local: l.candidateType || '?', remote: rm.candidateType || '?', protocol: l.protocol || '?', rtt: pair.currentRoundTripTime || 0 };
      }
    } catch { /* best-effort */ }
    return out;
  }

  // ------------------------------------------------------------------ signals in

  // The SDP must use CRLF line endings and end with one. Server-side input trimming (or a proxy)
  // can strip the trailing newline, which makes setRemoteDescription reject the offer/answer.
  function fixSdp(p) {
    if (p && typeof p.sdp === 'string') {
      const sdp = p.sdp.replace(/\r?\n/g, '\r\n');
      return { ...p, sdp: sdp.endsWith('\r\n') ? sdp : `${sdp}\r\n` };
    }
    return p;
  }

  async function handleSignal(s) {
    const conn = pc;
    if (!conn) return;
    let p = s.payload || {};
    if (s.kind === 'offer' || s.kind === 'answer') {
      try {
        // eslint-disable-next-line no-console
        console.info('[call] signal in', s.kind, { sdpEndsWithCRLF: typeof p.sdp === 'string' && p.sdp.endsWith('\r\n'), len: typeof p.sdp === 'string' ? p.sdp.length : 0 });
      } catch { /* diagnostics only */ }
      p = fixSdp(p);
    }
    if (s.kind === 'offer') {
      await conn.setRemoteDescription(p);
      // An answerer's transceiver for the offered video line defaults to recvonly; make it sendrecv so my camera can be turned on later.
      const vt = videoTransceiver();
      if (vt && vt.direction !== 'sendrecv') { try { vt.direction = 'sendrecv'; } catch { /* ignore */ } }
      await flushIce(conn);
      let answer = await conn.createAnswer();
      if (answer && answer.sdp) answer = { type: answer.type, sdp: tuneSdp(answer.sdp, videoMaxBitrate) };
      await conn.setLocalDescription(answer);
      await sendSignal('answer', { type: answer.type, sdp: answer.sdp });
    } else if (s.kind === 'answer') {
      if (conn.signalingState === 'have-local-offer') {
        await conn.setRemoteDescription(p);
        await flushIce(conn);
      }
    } else if (s.kind === 'ice') {
      if (conn.remoteDescription) {
        try { await conn.addIceCandidate(p); } catch { /* stale candidate */ }
      } else {
        pendingIce.push(p);
      }
    } else if (s.kind === 'resume') {
      await rebuildForPeerReload();
    } else if (s.kind === 'state') {
      if (typeof p.muted === 'boolean' && p.muted !== st.peerMuted) set({ peerMuted: p.muted });
      if (typeof p.cam === 'boolean' && p.cam !== st.peerCam) set({ peerCam: p.cam });
      if (typeof p.sharing === 'boolean' && p.sharing !== st.peerSharing) set({ peerSharing: p.sharing });
      if (p.restart === true && isCaller() && st.phase === 'active') restartIce(Number(p.attempt) >= 2);
    }
  }

  async function flushIce(conn) {
    const q = pendingIce;
    pendingIce = [];
    for (const c of q) {
      try { await conn.addIceCandidate(c); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------------ surviving a page reload

  /**
   * The OTHER person reloaded their page: their old peer connection is gone for good (a new page cannot adopt it), so drop mine and
   * build a fresh one on the SAME microphone/camera. Only the caller makes offers, so the caller sends a new offer right away;
   * the callee just waits for it. The call itself (server row, timer, mute state) is untouched.
   */
  async function rebuildForPeerReload() {
    if (!st.call || rebuilding || !['connecting', 'active'].includes(st.phase)) return;
    rebuilding = true;
    resumeWindowUntil = now() + 20000;
    try {
      const old = pc;
      pc = null;
      if (old) {
        old.onicecandidate = old.ontrack = old.onconnectionstatechange = old.oniceconnectionstatechange = null;
        try { old.close(); } catch { /* ignore */ }
      }
      pendingIce = [];
      makingOffer = false;
      [disconnectTimer, restartTimer].forEach((h) => h && timers.clearTimeout(h));
      disconnectTimer = restartTimer = 0;
      if (statsTimer) { timers.clearInterval(statsTimer); statsTimer = 0; }
      stallTicks = 0; lastIn = -1; recoveries = 0; frameStall = 0; lastFrames = -1;
      if (st.phase === 'active') set({ reconnecting: true, quality: 'poor' });
      needStats = true;
      const conn = await buildPc();
      // if the old connection had been carrying only audio+video from localStream, the new one gets the same tracks; re-apply
      // the current camera/screen/filter choice so the video line sends what it did before
      if (st.callType === 'video') applyOutgoingVideo().catch(() => {});
      if (isCaller()) {
        makingOffer = true;
        let offer = await conn.createOffer();
        if (offer && offer.sdp) offer = { type: offer.type, sdp: tuneSdp(offer.sdp, videoMaxBitrate) };
        if (pc !== conn) return;
        await conn.setLocalDescription(offer);
        makingOffer = false;
        await sendSignal('offer', { type: offer.type, sdp: offer.sdp });
      }
      sendState(); // the reloaded page does not know whether I am muted / have my camera on
    } catch (e) {
      makingOffer = false;
      try { console.warn('[call] could not rebuild the connection after the peer reloaded', e && e.message); } catch { /* diagnostics only */ }
    } finally {
      rebuilding = false;
    }
  }

  /**
   * MY page was reloaded in the middle of a call. `rec` is what the previous page saved (call id, role, type, peer, timer start,
   * mute/camera state). Re-acquire the microphone (and camera), ask the server to bind the call to this page, build a fresh peer
   * connection and tell the other side with a `resume` signal (the caller then also sends the new offer). Returns false and
   * leaves the engine idle if the call is already over.
   */
  async function resume(rec) {
    if (!rec || !rec.call || !rec.call.id || BUSY_PHASES.includes(st.phase)) return false;
    const wantVideo = rec.callType === 'video';
    const token = (attempt += 1);
    resuming = true;
    resumeWindowUntil = now() + 20000;
    lastSignalId = 0;
    resumedStartedAt = rec.startedAt || 0;
    set({
      phase: 'connecting', call: { ...rec.call, status: 'active' }, peer: rec.peer || null, callType: wantVideo ? 'video' : 'audio',
      notice: null, muted: !!rec.muted, peerMuted: false, minimized: false, reconnecting: true, quality: 'poor', startedAt: 0,
      noiseOn: rec.noiseOn !== false, camOn: false, peerCam: wantVideo, sharing: false, peerSharing: false,
    });
    const giveUp = (notice) => {
      resuming = false;
      resumedStartedAt = 0;
      dropMedia();
      tones.stop();
      Object.assign(st, { phase: 'idle', call: null, peer: null, muted: false, reconnecting: false, startedAt: 0, callType: 'audio', camOn: false, peerCam: false });
      set({ notice });
      if (notice) noticeTimer = timers.setTimeout(() => { if (st.notice === notice) set({ notice: null }); }, 6000);
      return false;
    };

    let stream;
    try {
      stream = await getUserMedia({ video: wantVideo, facing: st.facing, noise: st.noiseOn });
    } catch (e) {
      // I cannot capture audio any more: leave the call properly so the other person is not left talking to nobody
      api.post(`${base}/${rec.call.id}/end`, { reason: 'failed' }).catch(() => {});
      ignored.add(rec.call.id);
      return giveUp(micNotice(e, wantVideo));
    }
    if (token !== attempt) { stopStream(stream); resuming = false; return false; }
    localStream = stream;
    adoptStream(stream);
    try { stream.getAudioTracks().forEach((t) => { t.enabled = !rec.muted; }); } catch { /* ignore */ }

    let data;
    try {
      const res = await api.post(`${base}/${rec.call.id}/resume`, { client_id: clientId });
      data = res && res.data;
      if (!data) throw new Error('empty');
    } catch (e) {
      ignored.add(rec.call.id);
      return giveUp({ kind: 'ended', name: (rec.peer && rec.peer.name) || '', duration: 0, message: e && e.message });
    }
    if (stopped || !st.call || st.call.id !== rec.call.id) { resuming = false; return false; } // hung up / signed out while we waited
    lastSignalId = Number(data.after_signal_id) || 0;
    st.call = { ...st.call, ...data, role: rec.call.role };
    // a video call whose camera was off before the reload resumes with the camera off (no surprise broadcast)
    const camWasOn = rec.camOn !== false;

    try {
      await buildPc();
      if (wantVideo && !camWasOn && camTrack) {
        try { camTrack.stop(); } catch { /* ignore */ }
        camTrack = null;
        set({ camOn: false });
        await applyOutgoingVideo();
      } else {
        set({ camOn: !!camTrack });
      }
      startConnectTimer();
      resuming = false;
      await sendSignal('resume', {});
      if (isCaller()) {
        const conn = pc;
        makingOffer = true;
        let offer = await conn.createOffer();
        if (offer && offer.sdp) offer = { type: offer.type, sdp: tuneSdp(offer.sdp, videoMaxBitrate) };
        await conn.setLocalDescription(offer);
        makingOffer = false;
        await sendSignal('offer', { type: offer.type, sdp: offer.sdp });
      }
    } catch {
      makingOffer = false;
      resuming = false;
      if (st.call && st.call.id === rec.call.id) endLocal('failed');
      return false;
    }
    schedule(250);
    return true;
  }

  // ------------------------------------------------------------------ polling

  function schedule(delay) {
    if (stopped) return;
    if (pollTimer) timers.clearTimeout(pollTimer);
    let d = delay;
    if (d == null) {
      if (failures > 0) d = Math.min(30000, 2000 * 2 ** Math.min(failures, 4));
      else if (!st.available && failures === 0 && st.phase === 'idle' && st.noAccess) d = 60000;
      else if (st.phase === 'idle') d = isHidden() ? 8000 : 3000;
      else if (st.phase === 'active') d = 1500;
      else d = 1000;
    }
    pollTimer = timers.setTimeout(pollNow, d);
  }

  async function pollNow() {
    if (stopped || polling) return;
    if (resuming) { schedule(300); return; }
    polling = true;
    if (pollTimer) { timers.clearTimeout(pollTimer); pollTimer = 0; }
    try {
      const q = { client_id: clientId };
      const callId = st.call && st.call.id;
      if (callId && ['incoming', 'outgoing', 'connecting', 'active'].includes(st.phase)) {
        q.call_id = callId;
        q.after = lastSignalId;
      }
      const res = await api.get(`${base}/poll`, q);
      if (stopped) return;
      failures = 0;
      try { onGroupIncoming((res && res.data && res.data.group_incoming) || []); } catch { /* ui only */ }
      if (!st.available || st.noAccess) { st.noAccess = false; set({ available: true }); getIce().catch(() => {}); }
      await applyPoll((res && res.data) || {}, callId);
    } catch (e) {
      const s = e && e.status;
      if (s === 403 || (s === 422 && /disabled/i.test(String(e.message || '')))) {
        st.noAccess = true;
        if (st.available) set({ available: false });
        failures = 0;
      } else {
        failures += 1;
      }
    } finally {
      polling = false;
      schedule();
    }
  }

  async function applyPoll(data, polledId) {
    // Something changed while the request was in flight (hung up, finished…): drop this response.
    if ((st.call && st.call.id) !== polledId) return;
    const call = data.call || null;

    if (st.phase === 'idle') {
      const inc = (data.incoming || []).find((c) => !ignored.has(c.id));
      if (inc) ringIncoming(inc);
      return;
    }
    if (st.phase === 'starting') return;

    if (polledId && !call) { finish('ended', null, { silent: true }); return; }
    if (!call) return;

    if (call.handled_elsewhere) { finish('ended', call, { silent: true }); return; }

    if (CLOSED.includes(call.status)) {
      // Deliver anything the peer sent right before closing? Not needed — the call is over.
      finish(call.status, call);
      return;
    }

    // Keep role/expiry fresh (role never changes; status ringing → active does).
    st.call = { ...st.call, ...call };

    if (st.phase === 'outgoing' && call.status === 'active') {
      tones.stop();
      set({ phase: 'connecting' });
      startConnectTimer();
    }

    if (data.signals && data.signals.length && pc) {
      for (const s of data.signals) {
        if (st.call == null || st.call.id !== polledId) return;
        try {
          await handleSignal(s);
        } catch (err) {
          try {
            // eslint-disable-next-line no-console
            console.warn('[call] signal failed', s.kind, err && (err.name + ': ' + err.message));
          } catch { /* diagnostics only */ }
          if ((s.kind === 'offer' || s.kind === 'answer') && now() >= resumeWindowUntil) { endLocal('failed'); return; }
        }
        lastSignalId = Math.max(lastSignalId, s.id);
      }
    }
  }

  function ringIncoming(call) {
    const video = call.type === 'video';
    set({ phase: 'incoming', call, peer: call.peer, notice: null, accepting: false, muted: false, peerMuted: false, minimized: false, callType: video ? 'video' : 'audio', peerCam: video, camOn: false, sharing: false, peerSharing: false, filter: 'none' });
    lastSignalId = 0;
    tones.start('incoming');
    try { vibrate([400, 200, 400, 1600]); } catch { /* ignore */ }
    try { closeNotify = notify('incoming', call); } catch { closeNotify = null; }
  }

  // ------------------------------------------------------------------ public actions

  async function startCall(conversationId, peerInfo = {}, opts = {}) {
    if (BUSY_PHASES.includes(st.phase)) return false;
    const wantVideo = !!(opts && opts.video);
    const token = (attempt += 1);
    set({ phase: 'starting', call: null, peer: { id: peerInfo.id || null, name: peerInfo.name || '', avatar: peerInfo.avatar || null }, notice: null, muted: false, peerMuted: false, minimized: false, callType: wantVideo ? 'video' : 'audio', camOn: false, peerCam: wantVideo, sharing: false, peerSharing: false, filter: 'none', facing: 'user', canSwitchCam: false });
    if (noticeTimer) { timers.clearTimeout(noticeTimer); noticeTimer = 0; }

    let stream;
    try {
      stream = await getUserMedia({ video: wantVideo, facing: st.facing, noise: st.noiseOn });
    } catch (e) {
      if (token !== attempt) return false;
      return abortStart(micNotice(e, wantVideo));
    }
    if (token !== attempt) { stopStream(stream); return false; } // cancelled while the permission prompt was open
    localStream = stream;
    adoptStream(stream);

    let call;
    try {
      const res = await api.post(base, { conversation_id: conversationId, type: wantVideo ? 'video' : 'audio', client_id: clientId });
      call = res && res.data;
      if (!call) throw new Error('empty');
    } catch (e) {
      if (token !== attempt) { dropMedia(); return false; }
      return abortStart(failNotice('error', e && e.message));
    }
    if (token !== attempt) {
      // cancelled while the request was in flight: end it server-side so the other phone stops ringing
      api.post(`${base}/${call.id}/end`, { reason: 'hangup' }).catch(() => {});
      dropMedia();
      return false;
    }
    if (CLOSED.includes(call.status)) { // e.g. busy
      st.call = call;
      finish(call.status, call);
      return false;
    }

    lastSignalId = 0;
    set({ phase: 'outgoing', call, camOn: !!camTrack });
    tones.start('outgoing');
    try {
      await buildPc();
      const conn = pc;
      makingOffer = true;
      let offer = await conn.createOffer();
      if (offer && offer.sdp) offer = { type: offer.type, sdp: tuneSdp(offer.sdp, videoMaxBitrate) };
      await conn.setLocalDescription(offer);
      makingOffer = false;
      if (st.call && st.call.id === call.id) await sendSignal('offer', { type: offer.type, sdp: offer.sdp });
    } catch {
      makingOffer = false;
      if (st.call && st.call.id === call.id) endLocal('failed');
      return false;
    }
    schedule(250);
    return true;
  }

  function abortStart(notice) {
    dropMedia();
    tones.stop();
    set({ phase: 'idle', call: null, peer: null, notice });
    if (notice) noticeTimer = timers.setTimeout(() => { if (st.notice === notice) set({ notice: null }); }, 7000);
    return false;
  }

  /** `o.video === false` answers a video call with the camera off (audio only). */
  async function accept(o) {
    if (st.phase !== 'incoming' || st.accepting || !st.call) return;
    const call = st.call;
    const wantVideo = call.type === 'video' && !(o && o.video === false);
    set({ accepting: true, notice: null });
    tones.stop();
    try { vibrate(0); } catch { /* ignore */ }
    if (closeNotify) { try { closeNotify(); } catch { /* ignore */ } closeNotify = null; }

    let stream;
    try {
      stream = await getUserMedia({ video: wantVideo, facing: st.facing, noise: st.noiseOn });
    } catch (e) {
      if (!st.call || st.call.id !== call.id) return;
      set({ accepting: false, notice: micNotice(e, wantVideo) });
      tones.start('incoming'); // still ringing: they can allow the mic and try again, or decline
      return;
    }
    if (!st.call || st.call.id !== call.id) { stopStream(stream); return; } // ended while the prompt was open
    localStream = stream;
    adoptStream(stream);

    let res;
    try {
      res = await api.post(`${base}/${call.id}/accept`, { client_id: clientId });
    } catch (e) {
      dropMedia();
      if (!st.call || st.call.id !== call.id) return;
      finish('missed', call, { notice: failNotice('unavailable', e && e.message) });
      return;
    }
    if (!st.call || st.call.id !== call.id) return;
    lastSignalId = 0;
    set({ phase: 'connecting', accepting: false, call: { ...call, ...res.data, role: 'callee' }, camOn: !!camTrack });
    startConnectTimer();
    try {
      await buildPc();
    } catch {
      if (st.call && st.call.id === call.id) endLocal('failed');
      return;
    }
    schedule(150); // the offer is already waiting on the server
  }

  function decline() {
    if (st.phase !== 'incoming' || !st.call) return;
    const call = st.call;
    finish('declined', call, { byMe: true, silent: true });
    api.post(`${base}/${call.id}/decline`, {}).catch(() => {});
  }

  /** Ends/cancels/declines whatever I'm in. */
  function hangup() {
    if (st.phase === 'starting') {
      attempt += 1;
      stopStream(); localStream = null;
      tones.stop();
      set({ phase: 'idle', peer: null, call: null });
      return;
    }
    if (st.phase === 'incoming') return decline();
    if (!st.call) return;
    endLocal('hangup');
  }

  /** reason: hangup | failed | connection_lost. Optimistic: the UI closes now, the server call follows. */
  function endLocal(reason) {
    const call = st.call;
    if (!call) return;
    const status = st.phase === 'outgoing' ? 'cancelled' : 'ended';
    const byMe = reason === 'hangup';
    const notice = byMe
      ? (status === 'ended' && st.startedAt ? { kind: 'ended', name: (st.peer && st.peer.name) || '', duration: durationOf(null) } : null)
      : { kind: reason === 'connection_lost' ? 'lost' : 'failed', name: (st.peer && st.peer.name) || '' };
    finish(status, call, { byMe, notice });
    const send = (n) => api.post(`${base}/${call.id}/end`, { reason }).catch(() => (n > 0 ? sleep(800).then(() => send(n - 1)) : null));
    send(1);
  }

  function toggleMute() {
    if (!localStream || !BUSY_PHASES.includes(st.phase)) return;
    const muted = !st.muted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    set({ muted });
    if (st.phase === 'active') sendState();
  }

  // ------------------------------------------------------------------ video / audio options during a call

  const inLiveCall = () => !!st.call && (st.phase === 'connecting' || st.phase === 'active');

  async function toggleCamera() {
    if (!inLiveCall() || st.callType !== 'video' || !videoTransceiver() || st.sharing) return;
    if (st.camOn) {
      try { camTrack && camTrack.stop(); } catch { /* ignore */ }
      camTrack = null;
      set({ camOn: false });
      await applyOutgoingVideo();
      sendState();
      return;
    }
    const id = st.call.id;
    try {
      const stream = await getUserMedia({ video: true, audio: false, facing: st.facing, noise: st.noiseOn });
      if (!st.call || st.call.id !== id) { stopStream(stream); return; }
      camTrack = firstVideoTrack(stream);
      watchCam(camTrack);
      set({ camOn: !!camTrack });
      if (countCameras) Promise.resolve(countCameras()).then((n) => { if (camTrack) set({ canSwitchCam: n > 1 }); }).catch(() => {});
      await applyOutgoingVideo();
      sendState();
    } catch (e) {
      if (st.call && st.call.id === id) set({ notice: micNotice(e, true) });
    }
  }

  /**
   * Front <-> back camera. The old version only asked for `facingMode: { ideal }`, which many phones/WebViews silently answer with the
   * SAME camera - and the UI then mirrored the picture as if it had switched ("only the angle changes"). Now:
   *   1. ask for the other facing with `exact`, 2. otherwise walk the real camera list by deviceId (labels containing back/rear first),
   *   3. only accept a result whose track really is a different camera, and show the facing the TRACK reports.
   */
  async function switchCamera() {
    if (switching || !inLiveCall() || !camTrack || st.sharing || !videoTransceiver()) return;
    switching = true;
    const id = st.call.id;
    const want = st.facing === 'environment' ? 'user' : 'environment';
    const old = camTrack;
    const oldSet = settingsOf(old);
    const sameCam = (t) => {
      const s = settingsOf(t);
      if (s.deviceId && oldSet.deviceId) return s.deviceId === oldSet.deviceId;
      return trackFacing(t) === trackFacing(old);
    };
    const attempts = [{ facingExact: want }];
    try {
      const cams = listCameras ? await listCameras() : [];
      const others = (cams || []).filter((d) => d.deviceId && d.deviceId !== oldSet.deviceId);
      const rx = want === 'environment' ? BACK_RE : FRONT_RE;
      const ordered = [...others.filter((d) => rx.test(d.label || '')), ...others.filter((d) => !rx.test(d.label || ''))];
      ordered.slice(0, 3).forEach((d) => attempts.push({ deviceId: d.deviceId }));
    } catch { /* the exact-facing attempt is still tried */ }
    try { old.stop(); } catch { /* some phones cannot open two cameras at once */ }
    let fresh = null;
    for (const opt of attempts) {
      if (!st.call || st.call.id !== id) { switching = false; return; }
      try {
        const stream = await getUserMedia({ video: true, audio: false, noise: st.noiseOn, ...opt });
        const tr = firstVideoTrack(stream);
        if (tr && !sameCam(tr)) { fresh = tr; break; }
        stopStream(stream);
      } catch { /* try the next candidate */ }
    }
    if (!st.call || st.call.id !== id) { if (fresh) { try { fresh.stop(); } catch { /* ignore */ } } switching = false; return; }
    if (fresh) {
      camTrack = fresh;
      watchCam(fresh);
      set({ facing: trackFacing(fresh) || want });
    } else {
      // no other camera could be opened: bring the previous one back and say so (do NOT pretend the camera changed)
      try {
        const stream = await getUserMedia({ video: true, audio: false, noise: st.noiseOn, deviceId: oldSet.deviceId, facing: st.facing });
        camTrack = firstVideoTrack(stream);
        watchCam(camTrack);
        if (st.call && st.call.id === id) set({ notice: failNotice('cam_switch') });
      } catch { camTrack = null; set({ camOn: false }); }
    }
    await applyOutgoingVideo();
    if (!camTrack) sendState();
    switching = false;
  }

  async function stopSharing() {
    const t = screenTrack;
    screenTrack = null;
    try { t && t.stop(); } catch { /* ignore */ }
    if (!st.call) return;
    set({ sharing: false });
    await applyOutgoingVideo();
    sendState();
  }

  async function toggleScreenShare() {
    if (!inLiveCall() || st.callType !== 'video' || !videoTransceiver()) return;
    if (st.sharing) { await stopSharing(); return; }
    if (!getDisplayMedia) return;
    const id = st.call.id;
    try {
      const stream = await getDisplayMedia();
      if (!st.call || st.call.id !== id) { stopStream(stream); return; }
      screenTrack = firstVideoTrack(stream);
      if (!screenTrack) return;
      screenTrack.onended = () => { if (screenTrack) stopSharing(); }; // the browser's own "Stop sharing" bar
      set({ sharing: true });
      await applyOutgoingVideo();
      sendState();
    } catch (e) {
      // the picker being dismissed is not an error
      if (st.call && st.call.id === id && e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') set({ notice: failNotice('screen_error') });
    }
  }

  async function setFilter(name) {
    if (!VIDEO_FILTERS.includes(name) || name === st.filter) return;
    set({ filter: name });
    if (inLiveCall() && camTrack && !screenTrack) await applyOutgoingVideo();
  }

  function setFilterAmount(v) {
    const a = Math.max(0, Math.min(100, Math.round(Number(v)) || 0));
    set({ filterAmount: a });
    try { fx && fx.setAmount && fx.setAmount(a / 100); } catch { /* ignore */ }
  }

  function setNoise(on) {
    const v = !!on;
    set({ noiseOn: v });
    try { onPref('noise', v); } catch { /* ignore */ }
    try {
      const a = localStream && localStream.getAudioTracks && localStream.getAudioTracks()[0];
      if (a && a.applyConstraints) a.applyConstraints({ noiseSuppression: v, autoGainControl: v, echoCancellation: true }).catch(() => {});
    } catch { /* the choice still applies from the next call */ }
  }

  function setMinimized(v) { set({ minimized: !!v }); }
  function dismissNotice() { if (noticeTimer) { timers.clearTimeout(noticeTimer); noticeTimer = 0; } if (st.notice) set({ notice: null }); }

  function start() {
    if (!stopped) return;
    stopped = false;
    failures = 0;
    schedule(0);
  }

  /** Provider unmount / sign-out: free the mic and tell the server if a call is open. */
  function stop() {
    if (st.call && ['outgoing', 'connecting', 'active'].includes(st.phase)) {
      const id = st.call.id;
      api.post(`${base}/${id}/end`, { reason: 'hangup' }).catch(() => {});
    } else if (st.call && st.phase === 'incoming') {
      api.post(`${base}/${st.call.id}/decline`, {}).catch(() => {});
    }
    stopped = true;
    if (pollTimer) timers.clearTimeout(pollTimer);
    pollTimer = 0;
    tones.stop();
    teardown();
    Object.assign(st, IDLE_STATE);
  }

  return {
    start, stop, startCall, resume, accept, decline, hangup, toggleMute, setMinimized, dismissNotice,
    toggleCamera, switchCamera, toggleScreenShare, setFilter, setFilterAmount, setNoise,
    pollNow, kick: () => schedule(0), getState: () => ({ ...st }), diagnostics,
  };
}
