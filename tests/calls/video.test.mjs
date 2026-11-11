import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallEngine } from '../../src/lib/calls/callEngine.js';

// ---- fakes with transceivers so the video paths (replaceTrack, direction) can be checked ----
let trackSeq = 0;
const mkTrack = (kind) => ({ kind, id: `${kind}${++trackSeq}`, stopped: false, enabled: true, stop() { this.stopped = true; }, applied: [], applyConstraints(c) { this.applied.push(c); return Promise.resolve(); } });
const mkStream = (tracks) => ({ getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'), getVideoTracks: () => tracks.filter((t) => t.kind === 'video') });

class FakePc {
  constructor(cfg) { this.cfg = cfg; this.signalingState = 'stable'; this.remoteDescription = null; this.connectionState = 'new'; this.transceivers = []; FakePc.last = this; }
  addTrack(t) {
    const tr = { sender: { track: t, replaced: [], replaceTrack: async (x) => { tr.sender.track = x; tr.sender.replaced.push(x); } }, receiver: { track: { kind: t.kind } }, direction: 'sendrecv' };
    this.transceivers.push(tr);
    return tr.sender;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer() { return { type: 'offer', sdp: 'OFFER' }; }
  async createAnswer() { this.answeredDirections = this.transceivers.map((t) => t.direction); return { type: 'answer', sdp: 'ANSWER' }; }
  async setLocalDescription(d) { this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    // a remote offer with a video line and no local video transceiver creates a recvonly one (browser behaviour)
    if (d.type === 'offer' && d.video && !this.transceivers.some((t) => t.receiver.track.kind === 'video')) {
      this.transceivers.push({ sender: { track: null, replaced: [], replaceTrack: async function (x) { this.track = x; this.replaced.push(x); } }, receiver: { track: { kind: 'video' } }, direction: 'recvonly' });
    }
  }
  async addIceCandidate() {}
  restartIce() {}
  close() {}
  setState(s) { this.connectionState = s; this.onconnectionstatechange && this.onconnectionstatechange(); }
  video() { return this.transceivers.find((t) => t.receiver.track.kind === 'video'); }
}

function setup(over = {}) {
  const log = { posts: [], quiet: [], gums: [], local: [], remote: [], remoteAudio: [], prefs: [], fx: [] };
  const queue = [];
  const timers = { setTimeout: (fn, ms) => { const h = { fn, ms, on: true }; queue.push(h); return h; }, clearTimeout: (h) => { if (h) h.on = false; }, setInterval: () => ({}), clearInterval: () => {} };
  let pollResponse = { incoming: [], call: null, signals: [] };
  const api = {
    async get(path) { if (path.endsWith('/ice')) return { data: { ice_servers: [], video_enabled: true } }; return { data: pollResponse }; },
    async post(path, body) { log.posts.push([path, body]); return over.post ? over.post(path, body) : { data: {} }; },
    async postQuiet(path, body) { log.quiet.push([path, body]); return {}; },
  };
  const eng = createCallEngine({
    api, clientId: 'cid', timers,
    getUserMedia: async (o = {}) => {
      log.gums.push(o);
      const tracks = [];
      if (o.audio !== false) tracks.push(mkTrack('audio'));
      if (o.video) tracks.push(mkTrack('video'));
      const st = mkStream(tracks);
      log.lastStream = st;
      return st;
    },
    getDisplayMedia: async () => { const t = mkTrack('video'); log.screen = t; return mkStream([t]); },
    countCameras: async () => 2,
    createPc: (cfg) => new FakePc(cfg),
    createFx: () => { const fx = { out: mkTrack('video'), stopped: false, attach(src, f) { log.fx.push(['attach', src.id, f]); return fx.out; }, stop() { fx.stopped = true; log.fx.push(['stop']); } }; log.fxObj = fx; return fx; },
    makeStream: (tracks) => mkStream(tracks),
    setLocalVideo: (s) => log.local.push(s), setRemoteVideo: (s) => log.remote.push(s), setRemoteStream: (s, t) => log.remoteAudio.push([s, t]),
    onPref: (k, v) => log.prefs.push([k, v]),
    tones: { start() {}, stop() {}, blip() {} }, onChange: () => {}, onFinished: () => {}, now: () => 1000000,
  });
  eng.start();
  return { eng, log, setPoll: (r) => { pollResponse = r; } };
}
const call = (o = {}) => ({ id: 9, conversation_id: 3, type: 'video', status: 'ringing', role: 'callee', peer: { id: 2, name: 'Sara', avatar: null }, expires_in: 40, ...o });
const sentStates = (t) => t.log.quiet.filter((q) => q[1].kind === 'state').map((q) => q[1].payload);

async function calleeConnected(t, { video }) {
  t.setPoll({ incoming: [call()], call: null, signals: [] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'incoming');
  assert.equal(t.eng.getState().callType, 'video');
  assert.equal(t.eng.getState().peerCam, true);
  await t.eng.accept(video ? undefined : { video: false });
  t.setPoll({ call: call({ status: 'active' }), incoming: [], signals: [{ id: 1, kind: 'offer', payload: { type: 'offer', sdp: 'O', video: true } }] });
  await t.eng.pollNow();
  FakePc.last.setState('connected');
}

test('caller: video call asks for camera, posts type=video, shows local preview', async () => {
  const t = setup({ post: async (p) => (p.endsWith('/calls') ? { data: call({ role: 'caller' }) } : { data: {} }) });
  assert.equal(await t.eng.startCall(3, { name: 'Sara' }, { video: true }), true);
  assert.equal(t.log.gums[0].video, true);
  assert.equal(t.log.posts.find((p) => p[0].endsWith('/calls'))[1].type, 'video');
  const s = t.eng.getState();
  assert.equal(s.callType, 'video'); assert.equal(s.camOn, true);
  assert.ok(t.log.local.some((x) => x && x.getVideoTracks().length === 1), 'preview stream emitted');
  assert.equal(FakePc.last.transceivers.length, 2, 'audio + video tracks added');
});

test('voice call is unchanged: no video requested, type=audio', async () => {
  const t = setup({ post: async (p) => (p.endsWith('/calls') ? { data: call({ role: 'caller', type: 'audio' }) } : { data: {} }) });
  await t.eng.startCall(3, {});
  assert.equal(t.log.gums[0].video, false);
  assert.equal(t.log.posts.find((p) => p[0].endsWith('/calls'))[1].type, 'audio');
  assert.equal(t.eng.getState().callType, 'audio');
  assert.equal(FakePc.last.transceivers.length, 1);
});

test('callee answers a video call audio-only: no camera, video line still sendrecv, camera can be enabled later', async () => {
  const t = setup();
  await calleeConnected(t, { video: false });
  assert.equal(t.log.gums[0].video, false);
  assert.equal(t.eng.getState().camOn, false);
  assert.equal(FakePc.last.video().direction, 'sendrecv', 'direction fixed before the answer');
  assert.deepEqual(FakePc.last.answeredDirections.sort(), ['sendrecv', 'sendrecv']);
  await t.eng.toggleCamera();
  const last = t.log.gums[t.log.gums.length - 1];
  assert.deepEqual([last.video, last.audio], [true, false]);
  assert.equal(t.eng.getState().camOn, true);
  assert.equal(FakePc.last.video().sender.replaced.length, 1);
  assert.equal(FakePc.last.video().sender.track.kind, 'video');
  assert.equal(sentStates(t).pop().cam, true);
});

test('camera off stops the track, sends null, tells the peer', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  assert.equal(t.eng.getState().camOn, true);
  const cam = FakePc.last.video().sender.track;
  await t.eng.toggleCamera();
  assert.equal(cam.stopped, true);
  assert.equal(FakePc.last.video().sender.track, null);
  assert.equal(t.eng.getState().camOn, false);
  assert.equal(sentStates(t).pop().cam, false);
});

test('peer state signal drives peerCam / peerSharing / peerMuted', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  t.setPoll({ call: call({ status: 'active' }), incoming: [], signals: [{ id: 2, kind: 'state', payload: { muted: true, cam: false, sharing: true } }] });
  await t.eng.pollNow();
  const s = t.eng.getState();
  assert.deepEqual([s.peerMuted, s.peerCam, s.peerSharing], [true, false, true]);
});

test('filter: routed through the fx pipeline, "none" restores the raw camera and stops fx', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  const cam = FakePc.last.video().sender.track;
  await t.eng.setFilter('warm');
  assert.equal(t.eng.getState().filter, 'warm');
  assert.equal(FakePc.last.video().sender.track, t.log.fxObj.out);
  assert.deepEqual(t.log.fx[0], ['attach', cam.id, 'warm']);
  await t.eng.setFilter('none');
  assert.equal(FakePc.last.video().sender.track, cam);
  assert.equal(t.log.fxObj.stopped, true);
  await t.eng.setFilter('not-a-filter');
  assert.equal(t.eng.getState().filter, 'none');
});

test('screen share replaces the camera, browser "stop sharing" restores it', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  const cam = FakePc.last.video().sender.track;
  await t.eng.toggleScreenShare();
  assert.equal(t.eng.getState().sharing, true);
  assert.equal(FakePc.last.video().sender.track, t.log.screen);
  assert.equal(sentStates(t).pop().sharing, true);
  await t.log.screen.onended(); // user clicks the browser's stop button
  await new Promise((r) => setImmediate(r));
  assert.equal(t.eng.getState().sharing, false);
  assert.equal(FakePc.last.video().sender.track, cam);
});

test('incoming video track goes to the video stream and never replaces the audio element', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  const vt = mkTrack('video'); const at = mkTrack('audio');
  FakePc.last.ontrack({ track: vt, streams: [] });
  assert.equal(t.log.remote.length, 1);
  assert.equal(t.log.remoteAudio.length, 0);
  FakePc.last.ontrack({ track: at, streams: [mkStream([at])] });
  assert.equal(t.log.remoteAudio.length, 1);
});

test('noise suppression toggle updates the live mic track and is persisted via onPref', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  const mic = t.log.lastStream.getAudioTracks()[0];
  t.eng.setNoise(false);
  assert.equal(t.eng.getState().noiseOn, false);
  assert.deepEqual(mic.applied[0], { noiseSuppression: false, autoGainControl: false, echoCancellation: true });
  assert.deepEqual(t.log.prefs[0], ['noise', false]);
});

test('hangup releases camera + screen and clears previews', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  const cam = FakePc.last.video().sender.track;
  await t.eng.toggleScreenShare();
  t.eng.hangup();
  assert.equal(cam.stopped, true);
  assert.equal(t.log.screen.stopped, true);
  assert.equal(t.log.local[t.log.local.length - 1], null);
  assert.equal(t.log.remote[t.log.remote.length - 1], null);
  assert.equal(t.eng.getState().callType, 'audio');
});

test('filterAmount is clamped, kept in state and pushed to the live fx', async () => {
  const t = setup();
  await calleeConnected(t, { video: true });
  await t.eng.setFilter('soft');
  t.log.fxObj.amounts = [];
  t.log.fxObj.setAmount = (a) => t.log.fxObj.amounts.push(a);
  t.eng.setFilterAmount(40);
  t.eng.setFilterAmount(999);
  t.eng.setFilterAmount(-5);
  assert.deepEqual(t.log.fxObj.amounts, [0.4, 1, 0]);
  assert.equal(t.eng.getState().filterAmount, 0);
});

test('tuneSdp: opus FEC/mono + video bitrate hints, tolerant of junk', async () => {
  const { tuneSdp } = await import('../../src/lib/calls/callEngine.js');
  const sdp = [
    'v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98', 'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96',
    'a=rtpmap:98 H264/90000', 'a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f', '',
  ].join('\r\n');
  const out = tuneSdp(sdp, 3500000);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=0;stereo=0;/); // existing keys are kept, not duplicated
  assert.doesNotMatch(out, /useinbandfec=1/);
  assert.match(out, /a=fmtp:96 x-google-min-bitrate=150;x-google-start-bitrate=900;x-google-max-bitrate=3500/);
  assert.match(out, /a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f;x-google-min-bitrate=150/);
  assert.equal(out.match(/a=fmtp:97 apt=96/g).length, 1); // rtx line untouched
  assert.ok(out.includes('\r\n'));
  assert.equal(tuneSdp('OFFER'), 'OFFER');
  assert.equal(tuneSdp(undefined), undefined);
});

