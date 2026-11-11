import { createSfuClient, probeSfuReachability } from './cloudflareSfuClient';

/**
 * مدير الناقل (mesh ↔ SFU) لغرفة اجتماع واحدة. الـ hook (useMeetingRoom) بيبقى هو اللي بيملك الـ mesh القديم زي ما هو؛ المدير ده
 * بيملك بس: عميل الـ SFU، إعلانات الترَكات (whisper 'sfu')، إعادة المزامنة، والتقارير الدورية اللي بيبني عليها السيرفر قرار
 * "الغرفة دي mesh ولا SFU" (MeetingTransportService). القرار نفسه على السيرفر، عشان كل المشاركين يتحولوا مع بعض.
 *
 *  - init():              GET sfu/config، وفحص وصول UDP لـ Cloudflare (probe) → { mode, enabled }
 *  - enterSfu(stream):    publish + إعلان + سحب اللي ناشر دلوقتي. بترجّع false لو فشلت (الـ hook يرجع mesh فورًا).
 *  - leaveSfu():          قفل كل حاجة + sfu/leave
 *  - handleAnnounce(msg): whisper من مشارك نشر ترَكات جديدة
 *  - applyServerMode(e):  حدث .meeting.transport.changed (بيتجاهل epoch قديم)
 */
export function createMeetingTransport({
  meetingUuid, guestToken, myKey, sfuApi, signalingApi,
  getChannel, getIceServers, getMeshQuality, getTransport,
  onRemote, onServerMode, onSfuLost, log = () => {},
}) {
  const state = { enabled: false, mode: 'mesh', epoch: 0, reason: 'init', maxVideoSubs: 25, probe: { ok: null, rttMs: null } };
  let client = null;
  let timers = [];
  let sfuFailed = false; // آخر محاولة SFU فشلت (بيتبعت في التقرير لحد ما تنجح تاني)
  let reconnecting = false;
  let stopped = false;

  const api = {
    session: (role) => sfuApi.session(meetingUuid, guestToken, role),
    tracks: (sid, body) => sfuApi.tracks(meetingUuid, guestToken, sid, body),
    renegotiate: (sid, body) => sfuApi.renegotiate(meetingUuid, guestToken, sid, body),
    closeTracks: (sid, body) => sfuApi.closeTracks(meetingUuid, guestToken, sid, body),
  };

  async function init() {
    try {
      const res = await sfuApi.config(meetingUuid, guestToken);
      const d = (res && res.data) || {};
      state.enabled = !!d.enabled;
      state.mode = d.mode === 'sfu' && d.enabled ? 'sfu' : 'mesh';
      state.epoch = d.epoch || 0;
      state.reason = d.reason || 'init';
      state.maxVideoSubs = d.max_video_subscriptions || 25;
      state.initialPeers = d.peers || [];
    } catch (e) {
      log('sfu config unavailable → mesh only', e?.message);
      state.enabled = false; state.mode = 'mesh';
      return { enabled: false, mode: 'mesh' };
    }
    if (state.enabled) {
      // الفحص في الخلفية: ماينفعش يأخّر دخول الاجتماع. التقارير بتبعت sfu_ok لما النتيجة تجهز.
      probeSfuReachability().then((p) => { state.probe = p; log('sfu probe', JSON.stringify(p), 'room mode', state.mode); }).catch(() => { state.probe = { ok: false, rttMs: null }; });
    }
    return { enabled: state.enabled, mode: state.mode };
  }

  function announce(info) {
    const ch = getChannel();
    try { ch && ch.whisper('sfu', { key: myKey, sessionId: info.sessionId, tracks: info.tracks }); } catch { /* channel not ready */ }
  }

  async function publishNow(localStream) {
    if (client) { try { client.close(); } catch { /* ignore */ } }
    client = createSfuClient({
      api, iceServers: getIceServers(), maxVideoSubs: state.maxVideoSubs, log,
      onRemote: (key, stream, kind) => onRemote(key, stream, kind),
      onState: (s) => {
        if (stopped) return;
        if (s === 'failed') handleLost();
      },
    });
    const info = await client.publish(localStream);
    state.published = info;
    announce(info);
    // إعلان تاني بعد 3 ثواني: whisper عمره ما بيتخزّن، فمشارك لسه بيدخل ممكن يفوته
    timers.push(setTimeout(() => { if (client && !stopped) announce(info); }, 3000));
    return info;
  }

  /** @returns {Promise<boolean>} */
  async function enterSfu(localStream) {
    if (stopped) return false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await publishNow(localStream);
        sfuFailed = false;
        startLoops();
        return true;
      } catch (e) {
        lastErr = e;
        log('sfu publish failed, attempt', attempt, e?.message);
        try { client && client.close(); } catch { /* ignore */ }
        client = null;
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
    sfuFailed = true;
    log('sfu unavailable for me → report + fall back', lastErr?.message);
    sendReport().catch(() => {});
    return false;
  }

  async function syncPeers() {
    if (!client) return;
    let peers = [];
    try {
      const res = await sfuApi.peers(meetingUuid, guestToken);
      peers = (res && res.data && res.data.peers) || [];
    } catch (e) { log('sfu peers failed', e?.message); return; }
    await Promise.all(peers.map((p) => (p.key === myKey ? null : client.subscribe(p.key, p.session_id, p.tracks).catch(() => {}))));
  }

  function handleAnnounce(msg) {
    if (!client || !msg || msg.key === myKey || !msg.sessionId) return;
    client.subscribe(msg.key, msg.sessionId, msg.tracks || []).catch(() => {});
  }

  function dropPeer(key) { if (client) client.unsubscribe(key); }
  function replaceVideoTrack(track) { return client ? client.replaceVideoTrack(track) : Promise.resolve(); }
  function replaceAudioTrack(track) { return client ? client.replaceAudioTrack(track) : Promise.resolve(); }
  function hasPeerStream(key) { return !!client && client.hasPeer(key); }

  /** الناقل وقع (ICE failed) وإحنا في SFU. نحاول نرجع، ولو فشلنا نعلّم الفشل (السيرفر يقرر mesh لو الغرفة صغيرة). */
  async function handleLost() {
    if (reconnecting || stopped || getTransport() !== 'sfu') return;
    reconnecting = true;
    try {
      for (let i = 1; i <= 3 && !stopped; i += 1) {
        await new Promise((r) => setTimeout(r, 1500 * i));
        try {
          const stream = (await onSfuLost('retry')) || null; // الـ hook بيرجّع localStream الحالي
          if (!stream) break;
          await publishNow(stream);
          sfuFailed = false;
          await syncPeers();
          return;
        } catch (e) { log('sfu reconnect failed', i, e?.message); }
      }
      sfuFailed = true;
      sendReport().catch(() => {});
      onSfuLost('gave_up');
      // غرفة كبيرة مفيش لها بديل غير الـ SFU: نحاول تاني بعد شوية (الـ hook هو اللي بيرجّع mesh محليًا في الغرف الصغيرة)
      if (getTransport() === 'sfu') timers.push(setTimeout(() => { reconnecting = false; handleLost(); }, 20000));
    } finally { reconnecting = false; }
  }

  async function sendReport() {
    const mode = getTransport();
    let quality = 'good'; let rttMs = null;
    if (mode === 'sfu' && client) {
      const s = await client.stats();
      quality = s.quality; rttMs = s.rttMs;
      // نحدّث حالة الاتصال للباقيين (حلقة الـ mesh ما بتشتغلش لما مفيش peers)
      signalingApi.connectionQuality(meetingUuid, guestToken, quality).catch(() => {});
    } else {
      quality = getMeshQuality() || 'good';
    }
    const body = { transport: mode, quality, sfu_failed: sfuFailed };
    if (state.probe.ok !== null) body.sfu_ok = !!state.probe.ok && !sfuFailed;
    if (rttMs != null) body.sfu_rtt_ms = rttMs; else if (state.probe.rttMs != null) body.sfu_rtt_ms = state.probe.rttMs;
    const res = await sfuApi.report(meetingUuid, guestToken, body);
    const d = (res && res.data) || {};
    // لو حدث الـ broadcast وقع، التقرير نفسه بيرجّع الوضع الحالي: نطبّقه
    if (d.mode) applyServerMode(d);
  }

  function applyServerMode(e) {
    if (!e || (e.epoch != null && e.epoch <= state.epoch && e.mode === state.mode)) return;
    if (e.epoch != null && e.epoch < state.epoch) return;
    state.epoch = e.epoch ?? state.epoch;
    const mode = e.mode === 'sfu' && state.enabled ? 'sfu' : 'mesh';
    const changed = mode !== state.mode;
    state.mode = mode; state.reason = e.reason || state.reason;
    if (changed || mode !== getTransport()) onServerMode(mode, state.reason);
  }

  function startLoops() {
    if (state.loops || stopped) return;
    state.loops = true;
    timers.push(setInterval(() => { if (!stopped && state.enabled) sendReport().catch(() => {}); }, 6000));
    timers.push(setInterval(() => { if (!stopped && getTransport() === 'sfu') syncPeers().catch(() => {}); }, 15000));
  }

  /** نبدأ التقارير حتى لو لسه في mesh (عشان السيرفر يشوف جودة الـ mesh ويقدر يقرر التحويل). */
  function startReporting() { if (state.enabled) startLoops(); }

  function leaveSfu() {
    if (client) { try { client.close(); } catch { /* ignore */ } client = null; }
    state.published = null;
    sfuApi.leave(meetingUuid, guestToken).catch(() => {});
  }

  function stop() {
    stopped = true;
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    timers = [];
    leaveSfu();
  }

  return {
    init, enterSfu, leaveSfu, syncPeers, handleAnnounce, dropPeer, replaceVideoTrack, replaceAudioTrack, hasPeerStream,
    applyServerMode, startReporting, sendReport, stop,
    get state() { return state; },
    get active() { return !!client; },
  };
}
