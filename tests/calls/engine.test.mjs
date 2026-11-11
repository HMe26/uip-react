import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallEngine } from '../../src/lib/calls/callEngine.js';

class FakePc {
  constructor(cfg) { this.cfg = cfg; this.signalingState = 'stable'; this.remoteDescription = null; this.localDescription = null; this.connectionState = 'new'; this.added = []; this.ice = []; this.closed = false; this.restarted = 0; FakePc.last = this; }
  addTrack(t) { this.added.push(t); }
  async createOffer(o) { this.lastOfferOpts = o; return { type: 'offer', sdp: 'OFFER' }; }
  async createAnswer() { return { type: 'answer', sdp: 'ANSWER' }; }
  async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) { this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate(c) { this.ice.push(c); }
  restartIce() { this.restarted++; }
  close() { this.closed = true; }
  setState(s) { this.connectionState = s; this.onconnectionstatechange && this.onconnectionstatechange(); }
}

function setup(over = {}) {
  const log = { posts: [], quiet: [], gets: [], tones: [], states: [], finished: [], track: { stopped: 0 } };
  const queue = []; // fake timers
  const timers = {
    setTimeout: (fn, ms) => { const h = { fn, ms, on: true }; queue.push(h); return h; },
    clearTimeout: (h) => { if (h) h.on = false; },
    setInterval: () => ({}), clearInterval: () => {},
  };
  const stream = { getTracks: () => [{ stop: () => log.track.stopped++ }], getAudioTracks: () => [{ enabled: true }] };
  let pollResponses = [];
  const api = {
    async get(path, q) {
      log.gets.push([path, q]);
      if (path.endsWith('/ice')) return { data: { ice_servers: [{ urls: 'stun:x' }], video_enabled: false } };
      const r = pollResponses.length > 1 ? pollResponses.shift() : pollResponses[0];
      if (r instanceof Error) throw r;
      return { data: r || { incoming: [], call: null, signals: [] } };
    },
    async post(path, body) { log.posts.push([path, body]); return over.post ? over.post(path, body) : { data: {} }; },
    async postQuiet(path, body) { log.quiet.push([path, body]); return {}; },
  };
  const eng = createCallEngine({
    api, clientId: 'cid', timers,
    getUserMedia: over.getUserMedia || (async () => stream),
    createPc: (cfg) => new FakePc(cfg),
    tones: { start: (k) => log.tones.push('start:' + k), stop: () => log.tones.push('stop'), blip: (k) => log.tones.push('blip:' + k) },
    setRemoteStream: () => {}, onChange: (s) => log.states.push(s), onFinished: (i) => log.finished.push(i),
    now: over.now || (() => 1000000),
  });
  eng.start();
  return { eng, log, setPoll: (...r) => { pollResponses = r; }, queue };
}
const call = (o = {}) => ({ id: 7, conversation_id: 3, type: 'audio', status: 'ringing', role: 'callee', peer: { id: 2, name: 'Sara', avatar: null }, expires_in: 40, ...o });

test('caller: start → offer → answer → connected → hangup', async () => {
  const t = setup({ post: async (p) => (p.endsWith('/calls') ? { data: call({ role: 'caller' }) } : { data: {} }) });
  assert.equal(await t.eng.startCall(3, { name: 'Sara' }), true);
  assert.equal(t.eng.getState().phase, 'outgoing');
  assert.ok(t.log.tones.includes('start:outgoing'));
  const offer = t.log.quiet.find((q) => q[1].kind === 'offer');
  assert.ok(offer, 'offer sent'); assert.equal(offer[1].client_id, 'cid');
  // poll: callee accepted + answer + ice
  t.setPoll({ call: call({ role: 'caller', status: 'active' }), signals: [{ id: 1, kind: 'answer', payload: { type: 'answer', sdp: 'A' } }, { id: 2, kind: 'ice', payload: { candidate: 'c' } }], incoming: [] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'connecting');
  assert.equal(FakePc.last.remoteDescription.sdp, 'A\r\n'); // SDP is normalised to end with CRLF
  assert.equal(FakePc.last.ice.length, 1);
  FakePc.last.setState('connected');
  assert.equal(t.eng.getState().phase, 'active');
  assert.ok(t.log.tones.includes('blip:connect'));
  t.eng.hangup();
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice.kind, 'ended');
  assert.ok(t.log.posts.some((p) => p[0].endsWith('/7/end') && p[1].reason === 'hangup'));
  assert.equal(FakePc.last.closed, true);
  assert.ok(t.log.track.stopped > 0, 'mic released');
});

test('caller cancels while ringing → cancelled, no toast', async () => {
  const t = setup({ post: async (p) => (p.endsWith('/calls') ? { data: call({ role: 'caller' }) } : { data: {} }) });
  await t.eng.startCall(3, {});
  t.eng.hangup();
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice, null);
  assert.equal(t.log.finished[0].status, 'cancelled');
});

test('callee: incoming rings → accept → offer answered, queued ICE flushed', async () => {
  const t = setup({ post: async (p) => ({ data: call({ status: 'active' }) }) });
  t.setPoll({ incoming: [call()], call: null, signals: [] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'incoming');
  assert.ok(t.log.tones.includes('start:incoming'));
  await t.eng.accept();
  assert.equal(t.eng.getState().phase, 'connecting');
  assert.ok(t.log.posts.some((p) => p[0].endsWith('/7/accept') && p[1].client_id === 'cid'));
  // ICE arrives BEFORE the offer → must be queued, then flushed
  t.setPoll({ call: call({ status: 'active' }), incoming: [], signals: [{ id: 5, kind: 'ice', payload: { candidate: 'early' } }, { id: 6, kind: 'offer', payload: { type: 'offer', sdp: 'O' } }] });
  await t.eng.pollNow();
  assert.equal(FakePc.last.remoteDescription.sdp, 'O\r\n');
  assert.equal(FakePc.last.ice.length, 1);
  assert.ok(t.log.quiet.find((q) => q[1].kind === 'answer'));
  const nextAfter = t.log.gets.filter((g) => g[0].endsWith('/poll')).pop();
  await t.eng.pollNow();
  assert.equal(t.log.gets.filter((g) => g[0].endsWith('/poll')).pop()[1].after, 6, 'resumes after last signal id');
  void nextAfter;
});

test('callee declines → silent, no re-ring for same id', async () => {
  const t = setup();
  t.setPoll({ incoming: [call()], call: null, signals: [] });
  await t.eng.pollNow();
  t.eng.decline();
  assert.equal(t.eng.getState().phase, 'idle');
  assert.ok(t.log.posts.some((p) => p[0].endsWith('/7/decline')));
  await t.eng.pollNow(); // server still lists it once (race) → must not ring again
  assert.equal(t.eng.getState().phase, 'idle');
});

test('incoming call cancelled by caller → "missed" toast', async () => {
  const t = setup();
  t.setPoll({ incoming: [call()], call: null, signals: [] }, { incoming: [], call: call({ status: 'cancelled' }), signals: [] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'incoming');
  await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice.kind, 'missed');
});

test('answered on another tab → ringing closes silently', async () => {
  const t = setup();
  t.setPoll({ incoming: [call()], call: null, signals: [] }, { incoming: [], call: call({ status: 'active', handled_elsewhere: true }), signals: [] });
  await t.eng.pollNow(); await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice, null);
});

test('mic denied → caller gets notice, nothing posted', async () => {
  const t = setup({ getUserMedia: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } });
  assert.equal(await t.eng.startCall(3, {}), false);
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice.kind, 'mic_denied');
  assert.equal(t.log.posts.length, 0);
});

test('mic denied on accept → stays incoming, rings again', async () => {
  let deny = true;
  const t = setup({ getUserMedia: async () => { if (deny) { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } return { getTracks: () => [], getAudioTracks: () => [] }; }, post: async () => ({ data: call({ status: 'active' }) }) });
  t.setPoll({ incoming: [call()], call: null, signals: [] });
  await t.eng.pollNow();
  await t.eng.accept();
  assert.equal(t.eng.getState().phase, 'incoming');
  assert.equal(t.eng.getState().notice.kind, 'mic_denied');
  deny = false;
  await t.eng.accept();
  assert.equal(t.eng.getState().phase, 'connecting');
});

test('busy → toast, back to idle', async () => {
  const t = setup({ post: async () => ({ data: call({ role: 'caller', status: 'busy' }) }) });
  await t.eng.startCall(3, { name: 'Sara' });
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice.kind, 'busy');
});

test('server error on start (already calling you) → error notice with message', async () => {
  const t = setup({ post: async () => { const e = new Error('This person is already calling you.'); e.status = 422; throw e; } });
  await t.eng.startCall(3, {});
  assert.equal(t.eng.getState().notice.kind, 'error');
  assert.match(t.eng.getState().notice.message, /already calling/);
});

test('no answer → caller sees noanswer', async () => {
  const t = setup({ post: async () => ({ data: call({ role: 'caller' }) }) });
  await t.eng.startCall(3, {});
  t.setPoll({ call: call({ role: 'caller', status: 'missed' }), incoming: [], signals: [] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().notice.kind, 'noanswer');
});

test('mute sends state signal once active; peer mute shown', async () => {
  const t = setup({ post: async () => ({ data: call({ role: 'caller' }) }) });
  await t.eng.startCall(3, {});
  t.setPoll({ call: call({ role: 'caller', status: 'active' }), incoming: [], signals: [{ id: 1, kind: 'answer', payload: { type: 'answer', sdp: 'A' } }] });
  await t.eng.pollNow();
  FakePc.last.setState('connected');
  t.eng.toggleMute();
  assert.equal(t.eng.getState().muted, true);
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(t.log.quiet.find((q) => q[1].kind === 'state' && q[1].payload.muted === true));
  t.setPoll({ call: call({ role: 'caller', status: 'active' }), incoming: [], signals: [{ id: 2, kind: 'state', payload: { muted: true } }] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().peerMuted, true);
});

test('disconnect → caller restarts ICE; unrecovered → connection_lost', async () => {
  const t = setup({ post: async () => ({ data: call({ role: 'caller' }) }) });
  await t.eng.startCall(3, {});
  t.setPoll({ call: call({ role: 'caller', status: 'active' }), incoming: [], signals: [{ id: 1, kind: 'answer', payload: { type: 'answer', sdp: 'A' } }] });
  await t.eng.pollNow();
  FakePc.last.setState('connected');
  FakePc.last.setState('disconnected');
  assert.equal(t.eng.getState().reconnecting, true);
  const pending = t.queue.filter((h) => h.on);
  pending.find((h) => h.ms === 2500).fn(); // restart timer
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(FakePc.last.restarted, 1);
  assert.equal(FakePc.last.lastOfferOpts.iceRestart, true);
  assert.ok(t.log.quiet.filter((q) => q[1].kind === 'offer').length >= 2);
  t.queue.filter((h) => h.on).find((h) => h.ms === 15000).fn(); // give up
  assert.equal(t.eng.getState().phase, 'idle');
  assert.equal(t.eng.getState().notice.kind, 'lost');
  assert.ok(t.log.posts.some((p) => p[1] && p[1].reason === 'connection_lost'));
});

test('recovers: connected again cancels the give-up timer', async () => {
  const t = setup({ post: async () => ({ data: call({ role: 'caller' }) }) });
  await t.eng.startCall(3, {});
  t.setPoll({ call: call({ role: 'caller', status: 'active' }), incoming: [], signals: [{ id: 1, kind: 'answer', payload: { type: 'answer', sdp: 'A' } }] });
  await t.eng.pollNow();
  FakePc.last.setState('connected'); FakePc.last.setState('disconnected'); FakePc.last.setState('connected');
  assert.equal(t.eng.getState().phase, 'active');
  assert.equal(t.eng.getState().reconnecting, false);
  assert.ok(!t.queue.some((h) => h.on && h.ms === 15000));
});

test('peer hangs up (server says ended) → toast with duration', async () => {
  let n = 1000000;
  const t = setup({ post: async () => ({ data: call({ role: 'caller' }) }), now: () => n });
  await t.eng.startCall(3, {});
  t.setPoll({ call: call({ role: 'caller', status: 'active' }), incoming: [], signals: [{ id: 1, kind: 'answer', payload: { type: 'answer', sdp: 'A' } }] });
  await t.eng.pollNow(); FakePc.last.setState('connected');
  t.setPoll({ call: call({ role: 'caller', status: 'ended', duration_seconds: 75, end_reason: 'hangup' }), incoming: [], signals: [] });
  await t.eng.pollNow();
  assert.equal(t.eng.getState().phase, 'idle');
  assert.deepEqual([t.eng.getState().notice.kind, t.eng.getState().notice.duration], ['ended', 75]);
});

test('cancel during permission prompt → no call is created', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const t = setup({ getUserMedia: async () => { await gate; return { getTracks: () => [], getAudioTracks: () => [] }; } });
  const p = t.eng.startCall(3, {});
  t.eng.hangup();
  release();
  assert.equal(await p, false);
  assert.equal(t.log.posts.length, 0);
  assert.equal(t.eng.getState().phase, 'idle');
});

test('403 on poll → available=false and no crash', async () => {
  const e = new Error('no'); e.status = 403;
  const t = setup();
  t.setPoll(e);
  await t.eng.pollNow();
  assert.equal(t.eng.getState().available, false);
});

test('first successful poll → available', async () => {
  const t = setup();
  await t.eng.pollNow();
  assert.equal(t.eng.getState().available, true);
});
