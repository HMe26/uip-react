/**
 * عميل Cloudflare Realtime SFU للاجتماعات (بيكلم Laravel بس — مفتاح Cloudflare مش موجود هنا أبدًا).
 *
 * تصميم: PeerConnection واحدة للنشر (publisher: مايك + كاميرا/شاشة) وواحدة للسحب (subscriber)، كل واحدة بـ session
 * على Cloudflare. السحب بيرجّع offer من Cloudflare → نرد answer → PUT renegotiate. كل عمليات الـ negotiation على نفس الـ
 * PeerConnection متسلسلة في طابور (Cloudflare بيرفض renegotiation متداخلة).
 *
 * الواجهة:
 *   const sfu = createSfuClient({ api, iceServers, maxVideoSubs, onRemote, onState, log });
 *   await sfu.publish(localStream)         // → { sessionId, tracks:[{trackName,kind}] }
 *   await sfu.subscribe(key, sessionId, tracks)
 *   sfu.unsubscribe(key)  sfu.replaceVideoTrack(track)  await sfu.stats()  sfu.close()
 *
 * api = { session(role), tracks(sessionId, body), renegotiate(sessionId, body), closeTracks(sessionId, body) } وكلها بترجّع
 * الـ JSON اللي apiSuccess بيلفّه ({ data }). المنطق هنا مبني على شكل رد Cloudflare الموصوف في docs/realtime/sfu/https-api.
 */

const CF_STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const PUB_AUDIO = 'mic';
const PUB_VIDEO = 'cam'; // نفس الـ sender بيشيل الكاميرا أو الشاشة (replaceTrack) — زي الـ mesh بالظبط

function unwrap(res) {
  return (res && res.data) || res || {};
}

function waitForIce(pc, ms = 8000) {
  if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => { pc.removeEventListener('iceconnectionstatechange', on); resolve(false); }, ms);
    const on = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') { clearTimeout(t); pc.removeEventListener('iceconnectionstatechange', on); resolve(true); }
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') { clearTimeout(t); pc.removeEventListener('iceconnectionstatechange', on); resolve(false); }
    };
    pc.addEventListener('iceconnectionstatechange', on);
  });
}

export function createSfuClient({ api, iceServers = [], maxVideoSubs = 25, onRemote, onState, log = () => {} }) {
  let closed = false;
  const iceCfg = () => ({ iceServers: [...CF_STUN, ...(iceServers || [])], bundlePolicy: 'max-bundle' });

  // ---------- طابور عمليات متسلسل لكل PeerConnection ----------
  const queues = { pub: Promise.resolve(), sub: Promise.resolve() };
  const enqueue = (which, fn) => {
    const run = queues[which].then(() => (closed ? null : fn()));
    queues[which] = run.catch(() => {});
    return run;
  };

  const pub = { pc: null, sessionId: null, sender: { audio: null, video: null }, mids: {} };
  const sub = { pc: null, sessionId: null, byMid: {}, peers: {} }; // peers[key] = { sessionId, mids:{trackName: mid}, stream, videoCount }
  let videoSubs = 0;

  const emitState = (state, extra) => { try { onState && onState(state, extra); } catch { /* ignore */ } };

  function watch(pc, label) {
    pc.onconnectionstatechange = () => {
      log('sfu pc', label, pc.connectionState);
      if (pc.connectionState === 'failed') emitState('failed', { which: label });
      else if (pc.connectionState === 'disconnected') emitState('reconnecting', { which: label });
      else if (pc.connectionState === 'connected') emitState('connected', { which: label });
    };
  }

  // ---------- النشر ----------
  async function publish(localStream) {
    return enqueue('pub', async () => {
      const created = unwrap(await api.session('pub'));
      pub.sessionId = created.session_id;
      const pc = new RTCPeerConnection(iceCfg());
      pub.pc = pc;
      watch(pc, 'pub');

      const audio = localStream?.getAudioTracks()[0] || null;
      const video = localStream?.getVideoTracks()[0] || null;
      const specs = [];
      // transceiver بدون track (null) بيفضل sendonly وجاهز لـ replaceTrack لما الكاميرا/المايك يتفتحوا بعدين
      const aT = pc.addTransceiver(audio || 'audio', { direction: 'sendonly', streams: localStream ? [localStream] : [] });
      const vT = pc.addTransceiver(video || 'video', { direction: 'sendonly', streams: localStream ? [localStream] : [] });
      pub.sender.audio = aT.sender; pub.sender.video = vT.sender;
      specs.push({ t: aT, trackName: PUB_AUDIO, kind: 'audio' }, { t: vT, trackName: PUB_VIDEO, kind: 'video' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const body = {
        sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
        tracks: specs.map((s) => ({ location: 'local', mid: s.t.mid, trackName: s.trackName, kind: s.kind })),
      };
      const res = unwrap(await api.tracks(pub.sessionId, body));
      if (!res.sessionDescription) throw new Error('SFU: no answer for publish');
      await pc.setRemoteDescription(res.sessionDescription);
      specs.forEach((s) => { pub.mids[s.trackName] = s.t.mid; });
      const ok = await waitForIce(pc, 6000);
      if (!ok) throw new Error('SFU: publisher ICE did not connect');
      await tuneUplink().catch(() => {});
      return { sessionId: pub.sessionId, tracks: specs.map((s) => ({ trackName: s.trackName, kind: s.kind })) };
    });
  }

  async function tuneUplink() {
    for (const sender of [pub.sender.audio, pub.sender.video]) {
      if (!sender) continue;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      const enc = params.encodings[0];
      if (sender === pub.sender.audio) { enc.maxBitrate = 64000; enc.priority = 'high'; enc.networkPriority = 'high'; }
      else {
        // ناشر واحد بس لكل مشاهد → مفيش multiplier بعدد الناس، جودة أعلى بكتير من الـ mesh
        const isScreen = sender.track?.contentHint === 'detail';
        enc.maxBitrate = isScreen ? 2_000_000 : 1_200_000;
        enc.maxFramerate = isScreen ? 24 : 30;
        enc.networkPriority = 'low';
      }
      await sender.setParameters(params);
    }
  }

  /** تبديل كاميرا↔شاشة↔placeholder من غير renegotiation. */
  function replaceVideoTrack(track) {
    return pub.sender.video ? pub.sender.video.replaceTrack(track).catch((e) => log('sfu replaceTrack failed', e?.message)) : Promise.resolve();
  }
  function replaceAudioTrack(track) {
    return pub.sender.audio ? pub.sender.audio.replaceTrack(track).catch(() => {}) : Promise.resolve();
  }

  // ---------- السحب ----------
  async function ensureSub() {
    if (sub.pc) return;
    const created = unwrap(await api.session('sub'));
    sub.sessionId = created.session_id;
    const pc = new RTCPeerConnection(iceCfg());
    sub.pc = pc;
    watch(pc, 'sub');
    pc.ontrack = (e) => {
      const mid = e.transceiver?.mid;
      const owner = sub.byMid[mid];
      if (!owner) { log('sfu ontrack for unknown mid', mid); return; }
      const peer = sub.peers[owner.key];
      if (!peer) return;
      if (!peer.stream) peer.stream = new MediaStream();
      peer.stream.getTracks().filter((t) => t.kind === e.track.kind && t !== e.track).forEach((t) => peer.stream.removeTrack(t));
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      try { if (e.track.kind === 'video' && 'jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 0; } catch { /* unsupported */ }
      try { onRemote && onRemote(owner.key, peer.stream, e.track.kind); } catch { /* ignore */ }
      e.track.onunmute = () => { try { onRemote && onRemote(owner.key, peer.stream, e.track.kind); } catch { /* ignore */ } };
    };
  }

  function subscribe(key, sessionId, tracks) {
    return enqueue('sub', async () => {
      await ensureSub();
      const peer = sub.peers[key] && sub.peers[key].sessionId === sessionId ? sub.peers[key] : (sub.peers[key] = { sessionId, mids: {}, stream: null, videoCount: 0 });
      const want = [];
      for (const t of tracks || []) {
        if (peer.mids[t.trackName]) continue; // already pulled
        if (t.kind === 'video') {
          if (videoSubs >= maxVideoSubs) { log('sfu video subscription limit reached, audio only for', key); continue; }
          videoSubs += 1; peer.videoCount += 1;
        }
        want.push(t);
      }
      if (!want.length) return;

      const res = unwrap(await api.tracks(sub.sessionId, {
        tracks: want.map((t) => ({ location: 'remote', sessionId, trackName: t.trackName })),
      }));
      const bad = (res.tracks || []).filter((t) => t.errorCode);
      if (bad.length) log('sfu pull errors', JSON.stringify(bad));
      (res.tracks || []).forEach((rt) => {
        if (rt.errorCode || rt.mid == null) return;
        peer.mids[rt.trackName] = rt.mid;
        sub.byMid[rt.mid] = { key, trackName: rt.trackName };
      });
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await sub.pc.setRemoteDescription(res.sessionDescription);
        const answer = await sub.pc.createAnswer();
        await sub.pc.setLocalDescription(answer);
        unwrap(await api.renegotiate(sub.sessionId, { sessionDescription: { type: 'answer', sdp: sub.pc.localDescription.sdp } }));
      }
    }).catch((err) => { log('sfu subscribe failed', key, err?.message); emitState('subscribe_failed', { key, error: err }); throw err; });
  }

  function unsubscribe(key) {
    const peer = sub.peers[key];
    if (!peer) return Promise.resolve();
    delete sub.peers[key];
    videoSubs = Math.max(0, videoSubs - peer.videoCount);
    const mids = Object.values(peer.mids);
    mids.forEach((m) => { delete sub.byMid[m]; });
    if (!mids.length || !sub.sessionId) return Promise.resolve();
    // best effort: لو الناشر خرج Cloudflare بيقفل ترَكاته لوحده، فالفشل هنا مش مهم
    return enqueue('sub', async () => {
      await api.closeTracks(sub.sessionId, { tracks: mids.map((mid) => ({ mid })), force: true }).catch(() => {});
    }).catch(() => {});
  }

  // ---------- جودة الاتصال (للقرار + للمؤشر) ----------
  /** @returns {Promise<{quality:string, rttMs:number|null}>} */
  async function stats() {
    const pcs = [pub.pc, sub.pc].filter(Boolean);
    if (!pcs.length) return { quality: 'good', rttMs: null };
    let rtt = null; let lost = 0; let total = 0; let state = 'connected';
    for (const pc of pcs) {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') state = pc.connectionState;
      try {
        const rep = await pc.getStats();
        let selected = null;
        rep.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) selected = r.selectedCandidatePairId; });
        rep.forEach((r) => {
          if (r.type === 'candidate-pair' && (r.id === selected || (r.nominated && r.state === 'succeeded')) && r.currentRoundTripTime != null) {
            rtt = Math.max(rtt || 0, Math.round(r.currentRoundTripTime * 1000));
          }
          if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost += r.packetsLost || 0; total += (r.packetsReceived || 0) + (r.packetsLost || 0); }
          if (r.type === 'remote-inbound-rtp' && r.kind === 'audio') { lost += r.packetsLost || 0; total += (r.packetsLost || 0) + 50; }
        });
      } catch { /* getStats can fail while closing */ }
    }
    const ratio = total > 100 ? lost / total : 0;
    let quality = 'excellent';
    if (state !== 'connected') quality = 'reconnecting';
    else if (ratio > 0.12 || (rtt != null && rtt > 600)) quality = 'poor';
    else if (ratio > 0.04 || (rtt != null && rtt > 300)) quality = 'good';
    return { quality, rttMs: rtt };
  }

  function close() {
    closed = true;
    try { pub.pc?.close(); } catch { /* ignore */ }
    try { sub.pc?.close(); } catch { /* ignore */ }
    pub.pc = null; sub.pc = null; sub.peers = {}; sub.byMid = {}; videoSubs = 0;
  }

  return {
    publish, subscribe, unsubscribe, replaceVideoTrack, replaceAudioTrack, stats, close,
    get publisherSessionId() { return pub.sessionId; },
    get isOpen() { return !closed && !!pub.pc; },
    hasPeer: (key) => !!sub.peers[key] && !!sub.peers[key].stream,
  };
}

/**
 * فحص سريع قبل ما نعتمد على الـ SFU: هل UDP لـ Cloudflare شغّال من الشبكة دي، وكام ms لحد أول srflx candidate.
 * مش قياس مثالي (بيقيس وصول STUN مش مسار الميديا كله) لكنه بيكشف الشبكات اللي بتقفل UDP قبل ما نحوّل غرفة كاملة.
 * @returns {Promise<{ok:boolean, rttMs:number|null}>}
 */
export function probeSfuReachability(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let pc;
    const t0 = performance.now();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      try { pc && pc.close(); } catch { /* ignore */ }
      resolve({ ok, rttMs: ok ? Math.round(performance.now() - t0) : null });
    };
    try {
      pc = new RTCPeerConnection({ iceServers: CF_STUN });
      pc.createDataChannel('probe');
      pc.onicecandidate = (e) => { if (e.candidate && e.candidate.type === 'srflx') finish(true); };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => finish(false));
      setTimeout(() => finish(false), timeoutMs);
    } catch { finish(false); }
  });
}
