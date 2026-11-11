import { translate } from './boardGeom';

/**
 * Shared whiteboard state for one meeting room. It lives OUTSIDE React (drawing must never re-render the room), listens to the
 * meeting channel the whole time the room is mounted — so a board someone draws while yours is hidden is still collected — and
 * talks through two functions the room hook provides:
 *   send(payload)   -> channel.whisper('wb', payload)   (client event: no Laravel / DB involved)
 *   on(handler)     -> subscribe to incoming 'wb' whispers, returns an unsubscribe
 *
 * Wire format: every message is `{ k, f:<sender key>, … }`
 *   o  upsert one object           { o }            p  append points to a stroke { id, o?, pts }
 *   d  delete                      { ids }          c  clear everything
 *   open / lock                    { open } / { locked }
 *   cur  pointer / laser           { x, y, n, l }   req  "send me the board"        b  batch { m:[…] } (state replies)
 * Whispers are capped (~10 KB) so state is packed into ≤ 6 KB batches and staggered.
 */
const MAX_BATCH = 6000;
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const hueOf = (key) => { let h = 0; for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; };
const r1 = (n) => Math.round(n * 10) / 10;

export class BoardStore {
  constructor({ send, on, myKey, myName, isManager }) {
    this.sendRaw = send; this.myKey = myKey; this.myName = myName || 'Me'; this.isManager = !!isManager;
    this.myColor = hueOf(myKey || 'me');
    this.objs = new Map(); this.order = [];
    this.open = false; this.hiddenByMe = false; this.locked = false; this.openedBy = '';
    this.cursors = new Map(); // key -> { x, y, n, c, l, t, trail:[[x,y,t]] }
    this.undoStack = []; this.redoStack = [];
    this.listeners = new Set(); this.rev = 0;
    this._buf = new Map(); this._flushT = 0; this._lastCur = 0; this._seq = 0; this._answered = new Set();
    this._off = on((msg) => this._recv(msg));
    this._reqT = setTimeout(() => this.send({ k: 'req' }), 1200); // a late joiner asks whoever already has the board
  }

  destroy() { clearTimeout(this._reqT); clearTimeout(this._flushT); this._off?.(); this.listeners.clear(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { if (kind !== 'cursors') this.rev += 1; this.listeners.forEach((fn) => fn(kind)); }
  send(msg) { try { this.sendRaw({ ...msg, f: this.myKey }); } catch { /* channel not ready: harmless */ } }
  setIdentity(name, isManager) { this.myName = name || this.myName; this.isManager = !!isManager; }
  get canDraw() { return !this.locked || this.isManager; }
  list() { return this.order.map((id) => this.objs.get(id)).filter(Boolean); }
  newId() { this._seq += 1; return `${this.myKey}:${Date.now().toString(36)}${this._seq.toString(36)}`; }

  /* ---------- open / lock ---------- */
  openBoard() { this.open = true; this.hiddenByMe = false; this.openedBy = this.myName; this.send({ k: 'open', open: true, by: this.myName }); this.emit('open'); }
  hideForMe() { this.hiddenByMe = true; this.emit('open'); }
  showForMe() { this.hiddenByMe = false; if (!this.open) { this.openBoard(); return; } this.emit('open'); this.send({ k: 'req' }); }
  stopForAll() { this.open = false; this.send({ k: 'open', open: false, by: this.myName }); this.emit('open'); }
  setLocked(locked) { this.locked = !!locked; this.send({ k: 'lock', locked: this.locked }); this.emit('meta'); }
  get visible() { return this.open && !this.hiddenByMe; }

  /* ---------- local edits ---------- */
  _upsert(o) { if (!this.objs.has(o.id)) this.order.push(o.id); this.objs.set(o.id, o); }
  _record(action) { this.undoStack.push(action); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; this.emit('meta'); }

  beginStroke(o) { this._upsert(o); this._buf.set(o.id, { meta: { id: o.id, t: o.t, c: o.c, w: o.w }, pts: o.p.slice(), first: true }); this._schedule(); this.emit('objs'); }
  extendStroke(id, x, y) {
    const o = this.objs.get(id); if (!o) return;
    x = r1(x); y = r1(y); o.p.push(x, y);
    const b = this._buf.get(id) || { pts: [], first: false }; b.pts.push(x, y); this._buf.set(id, b); this._schedule(); this.emit('objs');
  }
  endStroke(id) { this._flush(); if (this.objs.has(id)) this._record({ u: 'add', ids: [id] }); }
  _schedule() { if (!this._flushT) this._flushT = setTimeout(() => this._flush(), 50); }
  _flush() {
    this._flushT = 0;
    this._buf.forEach((b, id) => {
      if (!b.pts.length) return;
      for (let i = 0; i < b.pts.length; i += 600) { // 600 numbers ≈ 4 KB
        const chunk = b.pts.slice(i, i + 600);
        this.send({ k: 'p', id, pts: chunk, ...(b.first && i === 0 ? { o: b.meta } : {}) });
      }
    });
    this._buf.clear();
  }

  /** Create or replace a whole object (shapes, text, notes, moves). `record` = push an undo step. */
  put(o, record) {
    const before = this.objs.get(o.id);
    this._upsert(o); this.send({ k: 'o', o });
    if (record) this._record(before ? { u: 'upd', pairs: [{ before, after: o }] } : { u: 'add', ids: [o.id] });
    this.emit('objs');
  }
  /** Same, but only to the screen + throttled network (live preview while dragging a shape / moving an object). */
  putLive(o) {
    this._upsert(o); this.emit('objs');
    const now = performance.now(); if (now - (this._liveT || 0) < 60) return;
    this._liveT = now; this.send({ k: 'o', o });
  }
  commitLive(o, before) { this._upsert(o); this.send({ k: 'o', o }); this._record(before ? { u: 'upd', pairs: [{ before, after: o }] } : { u: 'add', ids: [o.id] }); this.emit('objs'); }
  /** End of a drag-move of several objects: send the final positions and make it ONE undo step. */
  commitMove(pairs) { pairs.forEach((p) => { this._upsert(p.after); this.send({ k: 'o', o: p.after }); }); this._record({ u: 'upd', pairs }); this.emit('objs'); }
  remove(ids, record = true) {
    const gone = ids.map((id) => this.objs.get(id)).filter(Boolean); if (!gone.length) return;
    gone.forEach((o) => this.objs.delete(o.id)); this.order = this.order.filter((id) => this.objs.has(id));
    this.send({ k: 'd', ids: gone.map((o) => o.id) });
    if (record) this._record({ u: 'del', objs: gone });
    this.emit('objs');
  }
  clearAll() {
    const all = this.list(); if (!all.length) return;
    this.objs.clear(); this.order = []; this.send({ k: 'c' }); this._record({ u: 'clear', objs: all }); this.emit('objs');
  }
  moveBy(ids, dx, dy, originals) { ids.forEach((id) => { const o0 = originals.get(id); if (o0) this.putLive(translate(o0, dx, dy)); }); }

  /* ---------- undo / redo (your own actions) ---------- */
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    const a = this.undoStack.pop(); if (!a) return;
    if (a.u === 'add') { const objs = a.ids.map((id) => this.objs.get(id)).filter(Boolean); this._drop(a.ids); a.objs = objs; }
    else if (a.u === 'del' || a.u === 'clear') a.objs.forEach((o) => this._restore(o));
    else if (a.u === 'upd') a.pairs.forEach((p) => this._restore(p.before));
    this.redoStack.push(a); this.emit('objs'); this.emit('meta');
  }
  redo() {
    const a = this.redoStack.pop(); if (!a) return;
    if (a.u === 'add') (a.objs || []).forEach((o) => this._restore(o));
    else if (a.u === 'del') this._drop(a.objs.map((o) => o.id));
    else if (a.u === 'clear') { this.objs.clear(); this.order = []; this.send({ k: 'c' }); }
    else if (a.u === 'upd') a.pairs.forEach((p) => this._restore(p.after));
    this.undoStack.push(a); this.emit('objs'); this.emit('meta');
  }
  _drop(ids) { ids.forEach((id) => this.objs.delete(id)); this.order = this.order.filter((id) => this.objs.has(id)); this.send({ k: 'd', ids }); }
  _restore(o) { this._upsert(o); this._sendObject(o); }
  _sendObject(o) { this._pack(this._encode(o)).forEach((m, i) => setTimeout(() => this.send(m), i * 30)); }

  /* ---------- pointer / laser presence ---------- */
  cursor(x, y, laser) {
    const now = performance.now(); if (now - this._lastCur < 45) return; this._lastCur = now;
    this.send({ k: 'cur', x: r1(x), y: r1(y), n: this.myName, l: laser ? 1 : 0 });
  }
  cursorGone() { this.send({ k: 'cur', x: -1e9, y: -1e9, n: this.myName, l: 0 }); }

  /* ---------- state transfer ---------- */
  _encode(o) {
    const json = JSON.stringify(o);
    if (json.length <= MAX_BATCH - 200 || !o.p) return [{ k: 'o', o }];
    const out = []; const meta = { id: o.id, t: o.t, c: o.c, w: o.w };
    for (let i = 0; i < o.p.length; i += 600) out.push({ k: 'p', id: o.id, pts: o.p.slice(i, i + 600), ...(i === 0 ? { o: meta } : {}) });
    return out;
  }
  _pack(msgs) {
    const batches = []; let cur = []; let size = 0;
    msgs.forEach((m) => { const l = JSON.stringify(m).length; if (size + l > MAX_BATCH && cur.length) { batches.push({ k: 'b', m: cur }); cur = []; size = 0; } cur.push(m); size += l; });
    if (cur.length) batches.push({ k: 'b', m: cur });
    return batches;
  }
  _sendState(to) {
    const msgs = [{ k: 'open', open: this.open, by: this.openedBy }, { k: 'lock', locked: this.locked }];
    this.list().forEach((o) => msgs.push(...this._encode(o)));
    this._pack(msgs).forEach((b, i) => setTimeout(() => this.send({ ...b, to }), i * 40));
  }

  _recv(msg) {
    if (!msg || msg.f === this.myKey) return;
    if (msg.to && msg.to !== this.myKey) { if (msg.k === 'b') this._answered.add(msg.to); return; } // someone already answered that requester
    switch (msg.k) {
      case 'b': (msg.m || []).forEach((m) => this._recv({ ...m, f: msg.f })); break;
      case 'o': if (msg.o && msg.o.id) { this._upsert(msg.o); this.emit('objs'); } break;
      case 'p': {
        let o = this.objs.get(msg.id);
        if (!o && msg.o) { o = { ...msg.o, p: [] }; this._upsert(o); }
        if (o && Array.isArray(msg.pts)) { o.p.push(...msg.pts); this.emit('objs'); }
        break;
      }
      case 'd': (msg.ids || []).forEach((id) => this.objs.delete(id)); this.order = this.order.filter((id) => this.objs.has(id)); this.emit('objs'); break;
      case 'c': this.objs.clear(); this.order = []; this.emit('objs'); break;
      case 'open': {
        const was = this.open; this.open = !!msg.open; this.openedBy = msg.by || this.openedBy;
        if (this.open && !was) this.hiddenByMe = false; // somebody opened it: show it
        this.emit('open'); break;
      }
      case 'lock': this.locked = !!msg.locked; this.emit('meta'); break;
      case 'cur': {
        if (msg.x < -1e8) { this.cursors.delete(msg.f); this.emit('cursors'); break; }
        const prev = this.cursors.get(msg.f) || { trail: [] }; const t = performance.now();
        const trail = msg.l ? [...prev.trail.filter((q) => t - q[2] < 900), [msg.x, msg.y, t]] : [];
        this.cursors.set(msg.f, { x: msg.x, y: msg.y, n: msg.n, c: hueOf(msg.f), l: !!msg.l, t, trail });
        this.emit('cursors'); break;
      }
      case 'req': {
        if (!this.list().length && !this.open) break;
        const who = msg.f; this._answered.delete(who);
        setTimeout(() => { if (!this._answered.has(who)) { this._answered.add(who); this._sendState(who); } }, 80 + Math.random() * 400);
        break;
      }
      default: break;
    }
  }
}
