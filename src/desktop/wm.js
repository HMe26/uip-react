/** Window manager state: a plain reducer so every shortcut / button / Dock action goes through one place. */
/** Screen furniture: the menu bar on top and the floating Dock at the bottom. Windows live in between. */
export const MENUBAR_H = 28;
export const dockH = () => (typeof window !== 'undefined' && window.innerWidth < 560 ? 70 : 84);
/** Width taken by the pinned navigation sidebar: windows are sized / clamped to the screen WITHOUT it. */
export const layoutInset = { w: 0 };
export const areaW = () => Math.max(320, (typeof window !== 'undefined' ? window.innerWidth : 1280) - layoutInset.w);
export const chromeH = () => MENUBAR_H + dockH();
export const MIN_W = 380;
export const MIN_H = 260;
/** The title a window shows: its own (a file name) or the app's. */
export const winTitle = (w, apps, ar) => (w.title && w.title !== w.app ? w.title : (ar ? apps[w.app].ar : apps[w.app].en));

/** Virtual desktops ("Spaces"): every window belongs to one (`w.d`, 0-based); only the current one (`s.desk`) is shown. */
export const MAX_DESKS = 6;
export const initialWm = { list: [], z: 10, active: null, seq: 1, peek: null, desk: 0, desks: 1 };
export const dOf = (w) => w.d || 0;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const topVisible = (list, except, desk = 0) => [...list].filter((w) => !w.min && w.id !== except && dOf(w) === desk).sort((a, b) => b.z - a.z)[0]?.id ?? null;

function focus(s, id, patch) {
  if (!s.list.some((w) => w.id === id)) return s;
  const z = s.z + 1;
  const target = s.list.find((w) => w.id === id);
  // focusing a window that lives on another desktop (Dock, Mission Control, the Window menu) takes you there
  return { ...s, z, desk: dOf(target), active: id, peek: null, list: s.list.map((w) => (w.id === id ? { ...w, ...patch, min: false, z } : w)) };
}

export function wmReducer(s, a) {
  switch (a.type) {
    case 'open': {
      const ex = a.key ? s.list.find((w) => w.key === a.key) : a.singleton ? s.list.find((w) => w.app === a.app) : null;
      if (ex) return focus(s, ex.id, a.props ? { props: { ...ex.props, ...a.props } } : undefined);
      const { aw, ah } = a.area;
      const size = a.size || { w: 920, h: 600 };
      const w = Math.min(size.w, Math.round(aw * 0.92)); // restoring on a laptop never gives an edge-to-edge window
      const h = Math.min(size.h, Math.round(ah * 0.9));
      const step = (s.seq % 7) * 30;
      const x = clamp(Math.round((aw - w) / 2) + step - 90, 8, Math.max(8, aw - w - 8));
      const y = clamp(Math.round((ah - h) / 3) + step - 60, 8, Math.max(8, ah - h - 8));
      const id = `w${s.seq}`;
      const z = s.z + 1;
      const win = { id, app: a.app, key: a.key || null, title: a.title || a.app, x, y, w, h, max: !!a.maximized, snap: null, min: false, z, props: a.props || {}, since: Date.now(), d: s.desk || 0 };
      return { ...s, seq: s.seq + 1, z, active: id, peek: null, list: [...s.list, win] };
    }
    case 'focus': return focus(s, a.id);
    case 'close': {
      const list = s.list.filter((w) => w.id !== a.id);
      return { ...s, list, active: s.active === a.id ? topVisible(list, null, s.desk || 0) : s.active };
    }
    case 'minimize': {
      const list = s.list.map((w) => (w.id === a.id ? { ...w, min: true } : w));
      return { ...s, list, active: s.active === a.id ? topVisible(list, a.id, s.desk || 0) : s.active };
    }
    case 'toggleMax': return { ...s, list: s.list.map((w) => (w.id === a.id ? { ...w, max: !w.max, snap: null } : w)) };
    case 'snap': return { ...s, list: s.list.map((w) => (w.id === a.id ? { ...w, snap: a.side === 'max' ? null : a.side, max: a.side === 'max' } : w)) };
    case 'rect': return { ...s, list: s.list.map((w) => (w.id === a.id ? { ...w, ...a.rect, max: false, snap: null } : w)) };
    case 'patch': return { ...s, list: s.list.map((w) => (w.id === a.id ? { ...w, ...a.patch } : w)) };
    case 'showDesktop': {
      const cur = s.desk || 0; // only the current desktop's windows
      const visible = s.list.filter((w) => !w.min && dOf(w) === cur).map((w) => w.id);
      if (visible.length) { const v = new Set(visible); return { ...s, peek: visible, active: null, list: s.list.map((w) => (v.has(w.id) ? { ...w, min: true } : w)) }; }
      if (s.peek?.length) {
        const keep = new Set(s.peek);
        const list = s.list.map((w) => (keep.has(w.id) ? { ...w, min: false } : w));
        return { ...s, peek: null, list, active: topVisible(list, null, cur) };
      }
      return s;
    }
    case 'restoreAll': {
      const cur = s.desk || 0;
      const list = s.list.map((w) => (dOf(w) === cur ? { ...w, min: false } : w));
      return { ...s, list, peek: null, active: s.active || topVisible(list, null, cur) };
    }
    case 'cycle': {
      const here = s.list.filter((w) => dOf(w) === (s.desk || 0));
      if (!here.length) return s;
      const i = here.findIndex((w) => w.id === s.active);
      const next = here[(i + a.dir + here.length) % here.length];
      return focus(s, next.id);
    }
    case 'deskGo': {
      const n = clamp(a.n | 0, 0, (s.desks || 1) - 1);
      return { ...s, desk: n, peek: null, active: topVisible(s.list, null, n) };
    }
    case 'deskStep': return wmReducer(s, { type: 'deskGo', n: ((s.desk || 0) + a.dir + s.desks) % s.desks });
    case 'deskAdd': {
      if ((s.desks || 1) >= MAX_DESKS) return s;
      return { ...s, desks: s.desks + 1, desk: s.desks, peek: null, active: null };
    }
    case 'moveToDesk': {
      let desks = s.desks || 1; let n = a.n;
      if (n === 'new') { if (desks >= MAX_DESKS) return s; n = desks; desks += 1; }
      n = clamp(n | 0, 0, desks - 1);
      const list = s.list.map((w) => (w.id === a.id ? { ...w, d: n } : w));
      const desk = s.desk || 0;
      return { ...s, desks, list, active: s.active === a.id && n !== desk ? topVisible(list, null, desk) : s.active };
    }
    case 'deskRemove': {
      if ((s.desks || 1) <= 1) return s;
      const n = clamp(a.n | 0, 0, s.desks - 1);
      // windows of the removed desktop move to the one before it (or the next one when it was the first)
      const into = n > 0 ? n - 1 : 0;
      const list = s.list.map((w) => { const d = dOf(w); if (d === n) return { ...w, d: into > n ? into - 1 : into }; return d > n ? { ...w, d: d - 1 } : w; });
      const desks = s.desks - 1;
      let desk = s.desk || 0;
      if (desk === n) desk = into; else if (desk > n) desk -= 1;
      return { ...s, desks, desk, list, active: topVisible(list, null, desk) };
    }
    default: return s;
  }
}
