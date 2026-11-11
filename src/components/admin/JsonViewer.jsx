import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { THEMES } from '../zipbench/themePalettes';
import '../../styles/css/json-viewer.css';

/**
 * Code-editor style JSON viewer: Tree / Code views, themes, search, expand levels, copy path,
 * copy / download, font size, word-wrap and full screen. No dependencies.
 *   <JsonViewer value={object} text={optionalRawText} filename="response.json" labels={{…}} />
 */

// One theme list for the whole app: the same palettes the ZIP workbench / code editor use (zipbench/themePalettes.js).
// `bg`/`line` paint the preview swatch, `dots` = key · string · number · boolean · null colours of the theme.
export const JV_THEMES = THEMES.map((th) => ({ id: th.id, name: th.name, dark: th.dark, bg: th.ed.bg, line: th.ui.line, dots: [th.ed.prop, th.ed.string, th.ed.number, th.ed.keyword, th.ed.control] }));
const JV_ALIAS = { 'dark-plus': 'dark' }; // id the viewer stored before the lists were merged
const jvTheme = (id) => JV_THEMES.find((t) => t.id === (JV_ALIAS[id] || id)) || JV_THEMES[0];
/** CSS variables of the viewer for a theme id (derived from the shared palette, so it always matches the editor). */
function jvVars(id) {
  const th = THEMES.find((t) => t.id === jvTheme(id).id) || THEMES[0];
  const { ui: u, ed: e } = th;
  return {
    colorScheme: th.dark ? 'dark' : 'light',
    '--jv-bg': e.bg, '--jv-bar': u.side, '--jv-fg': e.fg, '--jv-dim': u.muted, '--jv-border': u.line, '--jv-hover': u.hover, '--jv-sel': u.sel,
    '--jv-key': e.prop, '--jv-str': e.string, '--jv-num': e.number, '--jv-bool': e.keyword, '--jv-null': e.control, '--jv-punct': u.muted, '--jv-idx': e.type,
    '--jv-match': u.mark, '--jv-accent': u.accent, '--jv-status': u.status, '--jv-status-fg': u.statusFg, '--jv-on-accent': u.onPrimary,
  };
}

const LS_THEME = 'uip_jv_theme';
const JV_DEFAULT = 'dark';
const LS_SIZE = 'uip_jv_size';
const readLS = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* storage blocked */ } };

const isObj = (v) => v !== null && typeof v === 'object';
const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const SAFE_KEY = /^[A-Za-z_$][\w$]*$/;
const childPath = (p, k, parentIsArray) => (parentIsArray ? `${p}[${k}]` : SAFE_KEY.test(k) ? `${p}.${k}` : `${p}[${JSON.stringify(k)}]`);
const norm = (s) => String(s).toLowerCase();

function copyTextFn(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text);
  return Promise.resolve();
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

/** Wraps case-insensitive matches of `q` in <mark>. */
function hl(text, q) {
  if (!q) return text;
  const lower = norm(text);
  const needle = norm(q);
  const out = [];
  let i = 0;
  let idx = lower.indexOf(needle, i);
  let n = 0;
  while (idx !== -1 && n < 200) {
    if (idx > i) out.push(text.slice(i, idx));
    out.push(<mark key={idx} className="jv-match">{text.slice(idx, idx + needle.length)}</mark>);
    i = idx + needle.length; n += 1;
    idx = lower.indexOf(needle, i);
  }
  out.push(text.slice(i));
  return out;
}

/** Paths whose key/value matches, plus every ancestor path (so the tree can open down to them). */
function searchPaths(root, q) {
  const matches = new Set();
  const open = new Set();
  if (!q) return { matches, open, count: 0 };
  const needle = norm(q);
  let count = 0;
  const walk = (v, path, key, ancestors) => {
    let hit = key !== null && norm(key).includes(needle);
    if (!isObj(v)) hit = hit || norm(v === null ? 'null' : v).includes(needle);
    if (hit) { matches.add(path); count += 1; ancestors.forEach((a) => open.add(a)); }
    if (isObj(v)) {
      const isArr = Array.isArray(v);
      Object.keys(v).forEach((k) => walk(v[k], childPath(path, k, isArr), isArr ? null : k, [...ancestors, path]));
    }
  };
  walk(root, '$', null, []);
  return { matches, open, count };
}

// ------------------------------------------------------------------ shared bits
const TYPE_BADGE = {
  object: { cls: 'obj', ch: '{}' },
  array: { cls: 'arr', ch: '[]' },
  string: { cls: 'str', ch: 'Aa' },
  number: { cls: 'num', ch: '#' },
  boolean: { cls: 'bool', ch: 'T/F' },
  null: { cls: 'null', ch: '∅' },
};
function TypeBadge({ kind }) {
  const b = TYPE_BADGE[kind] || TYPE_BADGE.string;
  return <span className={`jv-ty jv-ty--${b.cls}`} aria-hidden="true">{b.ch}</span>;
}

const countLabel = (n, isArr) => `${n} ${isArr ? (n === 1 ? 'item' : 'items') : (n === 1 ? 'key' : 'keys')}`;

function Primitive({ value, q }) {
  const [full, setFull] = useState(false);
  const kind = kindOf(value);
  if (kind === 'string') {
    const long = value.length > 240 && !full;
    const shown = long ? `${value.slice(0, 240)}…` : value;
    return (
      <span className="jv-str">
        &quot;{hl(shown, q)}&quot;
        {value.length > 240 && (
          <button type="button" className="jv-more" onClick={(e) => { e.stopPropagation(); setFull((f) => !f); }}>{full ? 'less' : `+${value.length - 240}`}</button>
        )}
      </span>
    );
  }
  if (kind === 'boolean') return <span className={`jv-bool jv-pill jv-pill--${value ? 'yes' : 'no'}`}>{hl(String(value), q)}</span>;
  if (kind === 'null') return <span className="jv-null jv-pill">{hl('null', q)}</span>;
  return <span className="jv-num">{hl(String(value), q)}</span>;
}

// ------------------------------------------------------------------ editing (only when <JsonViewer onChange> is given)
const EditCtx = createContext(null);
const PATH_RE = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g;
/** "$.a[0]["x y"]" -> ['a', 0, 'x y'] */
export function parsePath(p) {
  const out = []; PATH_RE.lastIndex = 0; let m;
  const src = String(p).replace(/^\$/, '');
  while ((m = PATH_RE.exec(src))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? Number(m[2]) : JSON.parse(m[3]));
  return out;
}
const cloneC = (x) => (Array.isArray(x) ? x.slice() : { ...x });
function updateIn(root, tokens, fn) { // immutable: copies only the containers along the path
  if (!tokens.length) return fn(root);
  const out = cloneC(root); const [k, ...rest] = tokens;
  out[k] = updateIn(root[k], rest, fn);
  return out;
}
export const setIn = (root, path, v) => updateIn(root, parsePath(path), () => v);
export function removeIn(root, path) {
  const t = parsePath(path); if (!t.length) return root;
  const last = t.pop();
  return updateIn(root, t, (c) => { const o = cloneC(c); if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; return o; });
}
export function addIn(root, path, key, v) {
  return updateIn(root, parsePath(path), (c) => { const o = cloneC(c); if (Array.isArray(o)) o.push(v); else o[key] = v; return o; });
}
/** Text typed by the user -> JSON value. Strings stay strings; other types are parsed (true / 12 / null), falling back to text. */
function typedValue(text, was) {
  if (was === 'string') return text;
  const t = text.trim();
  try { const v = JSON.parse(t); if (!isObj(v)) return v; } catch { /* plain text */ }
  return text;
}
const literalValue = (text) => { const t = text.trim(); try { return JSON.parse(t); } catch { return text; } };

function EditInput({ path, value, kind, ctx }) {
  const [draft, setDraft] = useState(kind === 'string' ? value : kind === 'null' ? 'null' : String(value));
  return (
    <input className="jv-edit" autoFocus value={draft} spellCheck={false} dir="auto"
      ref={(el) => { if (el && !el.dataset.sel) { el.dataset.sel = '1'; el.select(); } }}
      onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ctx.commit(path, typedValue(draft, kind)); } else if (e.key === 'Escape') ctx.cancel(); }}
      onBlur={() => ctx.commit(path, typedValue(draft, kind))} />
  );
}

/** A primitive value; double-click edits it in place when the viewer is editable. */
function EditableValue({ path, value, q, graph }) {
  const ctx = useContext(EditCtx);
  const view = graph ? <GraphValue value={value} q={q} /> : <Primitive value={value} q={q} />;
  if (!ctx) return view;
  if (ctx.editing !== path) return <span className="jv-editable" onDoubleClick={(e) => { e.stopPropagation(); ctx.begin(path); }} title="Double-click to edit">{view}</span>;
  return <EditInput path={path} value={value} kind={kindOf(value)} ctx={ctx} />;
}

// ------------------------------------------------------------------ outline (nested tree with connector lines)
function TreeNode({ name, value, path, depth, isArrayItem, cmd, search, q, selected, onSelect }) {
  const container = isObj(value);
  const keys = container ? Object.keys(value) : [];
  const [open, setOpen] = useState(depth < 2);
  const isArr = Array.isArray(value);
  const kind = kindOf(value);

  useEffect(() => {
    if (!cmd.tick) return;
    setOpen(cmd.level === Infinity ? true : depth < cmd.level);
  }, [cmd.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (q && search.open.has(path)) setOpen(true); }, [q, search, path]);

  const isSel = selected === path;
  const cls = `jv-row${container ? ' jv-row--node' : ''}${isSel ? ' is-sel' : ''}${search.matches.has(path) ? ' is-hit' : ''}`;
  const label = (
    <span className={isArrayItem ? 'jv-idx' : 'jv-key'}>
      {name === null ? 'root' : isArrayItem ? `[${name}]` : <>&quot;{hl(name, q)}&quot;</>}
      <span className="jv-punct">: </span>
    </span>
  );

  if (!container) {
    return (
      <div className="jv-node">
        <div className={cls} onClick={() => onSelect(path, value)} title="Click to copy the value">
          <span className="jv-caret jv-caret--sp" />
          <TypeBadge kind={kind} />
          {label}<EditableValue path={path} value={value} q={q} />
        </div>
      </div>
    );
  }
  const preview = !open && !isArr ? keys.slice(0, 5).join(', ') + (keys.length > 5 ? ', …' : '') : '';
  return (
    <div className="jv-node">
      <div className={cls} onClick={() => { onSelect(path, value); setOpen((o) => !o); }}>
        <button type="button" className={`jv-caret${open ? ' is-open' : ''}`} aria-label={open ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <Icon name="chevron-right" size={12} />
        </button>
        <TypeBadge kind={kind} />
        {label}
        <span className="jv-count">{countLabel(keys.length, isArr)}</span>
        {preview && <span className="jv-fold">{preview}</span>}
      </div>
      {open && keys.length > 0 && (
        <div className="jv-kids">
          {keys.map((k) => (
            <TreeNode key={k} name={k} value={value[k]} path={childPath(path, k, isArr)} depth={depth + 1} isArrayItem={isArr}
              cmd={cmd} search={search} q={q} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ graph (node-link diagram)
const ROWS_CAP = 80;      // rows drawn per card
const CARDS_CAP = 90;     // cards drawn in total (keeps huge responses responsive)

/** Containers (never the root) that should be drawn as their own card when `level` columns are shown. */
function levelSet(root, level) {
  const out = new Set();
  const walk = (v, path, depth) => {
    if (!isObj(v)) return;
    const isArr = Array.isArray(v);
    Object.keys(v).forEach((k) => {
      const c = v[k];
      if (!isObj(c)) return;
      const cp = childPath(path, k, isArr);
      if (depth + 1 < level) { out.add(cp); walk(c, cp, depth + 1); }
    });
  };
  walk(root, '$', 0);
  return out;
}

function buildCard(v, path, name, depth, exp, ctx) {
  const isArr = Array.isArray(v);
  const keys = Object.keys(v);
  const shown = keys.slice(0, ROWS_CAP);
  const card = { path, name, isArr, depth, count: keys.length, rows: [], kids: [], more: keys.length - shown.length, x: 0, y: 0, h: 0 };
  ctx.cards += 1;
  shown.forEach((k) => {
    const child = v[k];
    const cp = childPath(path, k, isArr);
    const row = { key: isArr ? `[${k}]` : k, bare: isArr ? null : k, path: cp, value: child, kind: kindOf(child), open: false };
    if (isObj(child) && exp.has(cp) && ctx.cards < CARDS_CAP) {
      row.open = true;
      card.kids.push({ ri: card.rows.length, card: buildCard(child, cp, row.key, depth + 1, exp, ctx) });
    }
    card.rows.push(row);
  });
  return card;
}

const MIN_W = 170;
const Z_MIN = 0.25;
const Z_MAX = 2;
const clampZ = (z) => Math.min(Z_MAX, Math.max(Z_MIN, Math.round(z * 100) / 100));

function GraphView({ value, q, search, cmd, selected, onSelect, fontSize, L }) {
  const [exp, setExp] = useState(() => levelSet(value, cmd.tick ? cmd.level : 3));
  const [pos, setPos] = useState({});       // path -> { x, y }   (cards the user dragged)
  const [dims, setDims] = useState({});     // path -> { w, h }   (cards the user resized)
  const [scroll, setScroll] = useState({}); // path -> scrollTop of a card's row list
  const [zoom, setZoom] = useState(1);
  const [order, setOrder] = useState({});   // path -> z-index (last touched card goes on top)
  const zTop = useRef(1);
  const act = useRef(null);                 // the pointer gesture in progress
  const rootRef = useRef(null);
  const pendingScroll = useRef(null);

  useEffect(() => { if (cmd.tick) setExp(levelSet(value, cmd.level)); }, [cmd.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q && search.open.size) setExp((prev) => { const n = new Set(prev); search.open.forEach((p) => { if (p !== '$') n.add(p); }); return n; });
  }, [q, search]);

  const k = fontSize / 13;
  const D = { cw: Math.round(270 * k), rh: Math.round(24 * k), hh: Math.round(30 * k), gx: Math.round(72 * k), gy: 18, pad: 24 };

  // 1) automatic left-to-right layout
  const auto = useMemo(() => {
    const ctx = { cards: 0 };
    const root = buildCard(value, '$', 'root', 0, exp, ctx);
    const list = [];
    const place = (c, top) => {
      c.h = D.hh + c.rows.length * D.rh + (c.more > 0 ? D.rh : 0) + 8;
      let y = top;
      c.kids.forEach((kid) => { y += place(kid.card, y) + D.gy; });
      const kidsH = c.kids.length ? y - D.gy - top : 0;
      const h = Math.max(c.h, kidsH);
      c.x = D.pad + c.depth * (D.cw + D.gx);
      c.y = top + (h - c.h) / 2;
      list.push(c);
      return h;
    };
    place(root, D.pad);
    return list;
  }, [value, exp, D.cw, D.rh, D.hh, D.gx]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) apply what the user moved / resized, then work out the connecting lines
  const { cards, edges, width, height } = useMemo(() => {
    const byPath = {};
    const list = auto.map((c) => {
      const p = pos[c.path]; const d = dims[c.path];
      const f = { ...c, x: p ? p.x : c.x, y: p ? p.y : c.y, w: d ? d.w : D.cw, h: d ? d.h : c.h, natural: c.h };
      byPath[c.path] = f;
      return f;
    });
    const es = [];
    let maxX = 0; let maxY = 0;
    list.forEach((c) => {
      maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
      c.kids.forEach((kid) => {
        const child = byPath[kid.card.path];
        if (!child) return;
        const sy = c.y + D.hh + kid.ri * D.rh + D.rh / 2 - (scroll[c.path] || 0);
        const y1 = Math.min(c.y + c.h - 4, Math.max(c.y + D.hh + 4, sy));
        const left = child.x + child.w / 2 < c.x + c.w / 2; // child sits to the left of its parent
        const x1 = left ? c.x : c.x + c.w;
        const x2 = left ? child.x + child.w : child.x;
        const y2 = child.y + D.hh / 2;
        const mx = (x1 + x2) / 2;
        es.push({ id: child.path, d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, x1, y1, x2, y2 });
      });
    });
    return { cards: list, edges: es, width: maxX + D.pad, height: maxY + D.pad };
  }, [auto, pos, dims, scroll, D.cw, D.hh, D.rh, D.pad]);

  const toggle = (p) => setExp((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const raise = (p) => { zTop.current += 1; const z = zTop.current; setOrder((o) => ({ ...o, [p]: z })); };

  // ---- pointer gestures: pan the canvas, drag a card, resize a card
  const begin = (e, kind, card) => {
    if (e.button !== undefined && e.button !== 0) return;
    const sc = rootRef.current.parentElement;
    act.current = { kind, card, sx: e.clientX, sy: e.clientY, x: card?.x, y: card?.y, w: card?.w, h: card?.h, l: sc.scrollLeft, t: sc.scrollTop, sc, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (card) raise(card.path);
    if (kind === 'pan') rootRef.current.classList.add('is-drag');
  };
  // Pointer events can fire far faster than the screen refreshes (touch screens / precision touchpads). Applying every one of them
  // (scrollLeft writes + a React re-render per card move) made the whole page judder, so the gesture is applied once per frame.
  const raf = useRef(0);
  const last = useRef(null);
  const apply = () => {
    const a = act.current; const pt = last.current;
    if (!a || !pt) return;
    const dx = pt.x - a.sx; const dy = pt.y - a.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) a.moved = true;
    if (a.kind === 'pan') {
      a.sc.scrollLeft = a.l - dx; a.sc.scrollTop = a.t - dy;
    } else if (a.kind === 'drag' && a.moved) {
      setPos((p) => ({ ...p, [a.card.path]: { x: Math.max(0, Math.round(a.x + dx / zoom)), y: Math.max(0, Math.round(a.y + dy / zoom)) } }));
    } else if (a.kind.startsWith('resize')) {
      const w = a.kind.includes('x') ? Math.max(MIN_W, Math.round(a.w + dx / zoom)) : a.w;
      const h = a.kind.includes('y') ? Math.max(D.hh + D.rh + 8, Math.round(a.h + dy / zoom)) : a.h;
      setDims((d) => ({ ...d, [a.card.path]: { w, h } }));
    }
  };
  const move = (e) => {
    if (!act.current) return;
    last.current = { x: e.clientX, y: e.clientY };
    if (act.current.kind === 'pan' && !act.current.moved) {
      if (Math.abs(e.clientX - act.current.sx) + Math.abs(e.clientY - act.current.sy) > 3) act.current.moved = true;
    }
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; apply(); });
  };
  const end = () => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    apply();
    const a = act.current;
    act.current = null;
    last.current = null;
    rootRef.current?.classList.remove('is-drag');
    if (a && a.kind === 'drag' && !a.moved) onSelect(a.card.path, {});
  };
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // ---- zoom (buttons, Ctrl/⌘ + wheel) keeping the point under the cursor still
  const zoomTo = useCallback((next, cx, cy) => {
    const sc = rootRef.current?.parentElement;
    if (!sc) return;
    const nz = clampZ(next);
    const x = cx ?? sc.clientWidth / 2; const y = cy ?? sc.clientHeight / 2;
    setZoom((z) => {
      if (nz === z) return z;
      pendingScroll.current = { left: ((sc.scrollLeft + x) / z) * nz - x, top: ((sc.scrollTop + y) / z) * nz - y };
      return nz;
    });
  }, []);
  useLayoutEffect(() => {
    const sc = rootRef.current?.parentElement;
    const p = pendingScroll.current;
    if (sc && p) { sc.scrollLeft = p.left; sc.scrollTop = p.top; pendingScroll.current = null; }
  }, [zoom]);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  useEffect(() => {
    const sc = rootRef.current?.parentElement;
    if (!sc) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  const fit = () => {
    const sc = rootRef.current?.parentElement;
    if (!sc) return;
    setZoom(clampZ(Math.min(sc.clientWidth / width, sc.clientHeight / height, 1)));
    sc.scrollLeft = 0; sc.scrollTop = 0;
  };
  const resetLayout = () => { setPos({}); setDims({}); setScroll({}); setZoom(1); };
  const changed = Object.keys(pos).length > 0 || Object.keys(dims).length > 0 || zoom !== 1;

  return (
    <>
      <div className="jv-gtools" role="toolbar"><div className="jv-gtools-in">
        <button type="button" onClick={() => zoomTo(zoom / 1.2)} title={L.zoomOut} aria-label={L.zoomOut}><Icon name="ed-minus" size={14} /></button>
        <span className="jv-zoom" title={L.zoomHint}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomTo(zoom * 1.2)} title={L.zoomIn} aria-label={L.zoomIn}><Icon name="plus" size={14} /></button>
        <button type="button" onClick={fit} title={L.fit} aria-label={L.fit}><Icon name="ed-fit" size={14} /></button>
        <button type="button" onClick={resetLayout} disabled={!changed} title={L.resetLayout} aria-label={L.resetLayout}><Icon name="refresh" size={14} /></button>
      </div></div>
      <div ref={rootRef} className="jv-graph" style={{ width: width * zoom, height: height * zoom, minWidth: '100%', minHeight: '100%' }}
        onPointerDown={(e) => { if (!e.target.closest('.jv-gcard')) begin(e, 'pan'); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <div className="jv-stage" style={{ width, height, transform: `scale(${zoom})` }}>
          <svg className="jv-edges" width={width} height={height} aria-hidden="true">
            {edges.map((e) => (
              <g key={e.id}>
                <path d={e.d} />
                <circle cx={e.x1} cy={e.y1} r="3.5" /><circle cx={e.x2} cy={e.y2} r="3.5" />
              </g>
            ))}
          </svg>
          {cards.map((c) => (
            <div key={c.path} className={`jv-gcard${selected === c.path ? ' is-sel' : ''}${pos[c.path] ? ' is-moved' : ''}`}
              style={{ left: c.x, top: c.y, width: c.w, height: c.h, zIndex: order[c.path] || 1 }}
              onPointerDown={() => raise(c.path)}>
              <div className="jv-ghead" style={{ height: D.hh }} title={`${c.path} — ${L.dragHint}`}
                onPointerDown={(e) => begin(e, 'drag', c)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                <TypeBadge kind={c.isArr ? 'array' : 'object'} />
                <b>{c.name}</b>
                <span className="jv-count">{countLabel(c.count, c.isArr)}</span>
              </div>
              <div className="jv-grows" onScroll={(e) => { const t = e.currentTarget.scrollTop; setScroll((s) => (s[c.path] === t ? s : { ...s, [c.path]: t })); }}>
                {c.rows.map((r) => {
                  const container = isObj(r.value);
                  const sub = container ? Object.keys(r.value).length : 0;
                  const rowCls = `jv-grow${container ? ' is-node' : ''}${selected === r.path ? ' is-sel' : ''}${search.matches.has(r.path) ? ' is-hit' : ''}`;
                  return (
                    <div key={r.path} className={rowCls} style={{ height: D.rh }}
                      onClick={() => { onSelect(r.path, r.value); if (container) toggle(r.path); }}
                      title={container ? r.path : `${r.path} — click to copy`}>
                      <TypeBadge kind={r.kind} />
                      <span className={r.bare === null ? 'jv-idx' : 'jv-key'}>{r.bare === null ? r.key : hl(r.key, q)}</span>
                      {container ? (
                        <>
                          <span className="jv-gval jv-punct">{countLabel(sub, Array.isArray(r.value))}</span>
                          <span className={`jv-gcaret${r.open ? ' is-open' : ''}`}><Icon name="chevron-right" size={11} /></span>
                        </>
                      ) : (
                        <span className="jv-gval"><EditableValue path={r.path} value={r.value} q={q} graph /></span>
                      )}
                    </div>
                  );
                })}
                {c.more > 0 && <div className="jv-grow jv-gmore" style={{ height: D.rh }}>… +{c.more}</div>}
              </div>
              <i className="jv-rs jv-rs--x" title={L.resize} onPointerDown={(e) => begin(e, 'resize-x', c)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              <i className="jv-rs jv-rs--y" title={L.resize} onPointerDown={(e) => begin(e, 'resize-y', c)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              <i className="jv-rs jv-rs--xy" title={L.resize} onPointerDown={(e) => begin(e, 'resize-xy', c)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function GraphValue({ value, q }) {
  const kind = kindOf(value);
  if (kind === 'string') return <span className="jv-str">&quot;{hl(value.length > 60 ? `${value.slice(0, 60)}…` : value, q)}&quot;</span>;
  if (kind === 'boolean') return <span className={`jv-bool jv-pill jv-pill--${value ? 'yes' : 'no'}`}>{hl(String(value), q)}</span>;
  if (kind === 'null') return <span className="jv-null jv-pill">null</span>;
  return <span className="jv-num">{hl(String(value), q)}</span>;
}

// ------------------------------------------------------------------ theme picker
function Swatch({ th }) {
  const [kc, sc, nc, bc, uc] = th.dots;
  return (
    <span className="jv-swatch" style={{ background: th.bg, borderColor: th.line }} aria-hidden="true">
      <i><b style={{ width: 11, background: kc }} /><b style={{ width: 17, background: sc }} /></i>
      <i style={{ marginInlineStart: 6 }}><b style={{ width: 9, background: kc }} /><b style={{ width: 8, background: nc }} /></i>
      <i><b style={{ width: 8, background: bc }} /><b style={{ width: 12, background: uc }} /></i>
    </span>
  );
}

function ThemePicker({ value, onChange, onPreview, popStyle, labels }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const current = jvTheme(value);

  const close = useCallback((refocus) => { setOpen(false); onPreview(null); if (refocus) btnRef.current?.focus(); }, [onPreview]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = 264;
    const est = Math.min(JV_THEMES.length * 46 + 70, window.innerHeight - 16);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom;
    setPos(below >= est || below >= r.top ? { left, top: r.bottom + 6, width: w } : { left, bottom: window.innerHeight - r.top + 6, width: w });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    popRef.current?.querySelector('.is-on')?.focus();
    const down = (e) => { if (!popRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } };
    const away = (e) => { if (!popRef.current?.contains(e.target)) close(false); };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open, close, pos]);

  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = [...popRef.current.querySelectorAll('.jv-opt')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const groups = [{ label: labels.dark, list: JV_THEMES.filter((t) => t.dark) }, { label: labels.light, list: JV_THEMES.filter((t) => !t.dark) }];

  return (
    <>
      <button ref={btnRef} type="button" className={`jv-theme-btn${open ? ' is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open}
        aria-label={labels.theme} title={labels.theme} onClick={() => setOpen((o) => !o)}>
        <Swatch th={current} />
        <span className="jv-theme-name">{current.name}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {open && pos && createPortal(
        <div ref={popRef} className="jv-pop" dir="ltr" role="listbox" aria-label={labels.theme} style={{ ...popStyle, ...pos }} onKeyDown={onListKey} onMouseLeave={() => onPreview(null)}>
          {groups.map((g) => g.list.length > 0 && (
            <div key={g.label} className="jv-pop-group">
              <div className="jv-pop-title">{g.label}</div>
              {g.list.map((th) => (
                <button key={th.id} type="button" role="option" aria-selected={th.id === current.id} className={`jv-opt${th.id === current.id ? ' is-on' : ''}`}
                  onMouseEnter={() => onPreview(th.id)} onFocus={() => onPreview(th.id)}
                  onClick={() => { onChange(th.id); close(true); }}>
                  <Swatch th={th} />
                  <span className="jv-opt-name">{th.name}</span>
                  <span className="jv-dots" aria-hidden="true">{th.dots.map((c, i) => <span key={i} style={{ background: c }} />)}</span>
                  <span className="jv-opt-check">{th.id === current.id && <Icon name="check" size={14} />}</span>
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ------------------------------------------------------------------ code
const TOKEN = /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false)\b|\b(null)\b|([{}[\],:])/g;

function codeLine(line, q) {
  const out = [];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  // a string directly followed by ":" is an object key
  while ((m = TOKEN.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    let cls = 'jv-punct';
    if (m[1]) cls = /^\s*:/.test(line.slice(m.index + tok.length)) ? 'jv-key' : 'jv-str';
    else if (m[2]) cls = 'jv-num';
    else if (m[3]) cls = 'jv-bool';
    else if (m[4]) cls = 'jv-null';
    out.push(<span key={m.index} className={cls}>{hl(tok, q)}</span>);
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function CodeView({ lines, q, wrap, fontSize }) {
  const heavy = lines.length > 12000;
  return (
    <div className={`jv-code${wrap ? ' is-wrap' : ''}`} style={{ fontSize }}>
      {lines.map((l, i) => (
        <div className="jv-line" key={i}>
          <span className="jv-ln">{i + 1}</span>
          <span className="jv-src">{heavy ? l : codeLine(l, q)}{'\n'}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ viewer
export default function JsonViewer({ value, text, filename = 'response.json', meta, labels = {}, onChange, theme: themeProp, onTheme, onCode, locked = false }) {
  // `locked` (public share page): nothing can be copied or downloaded out of the viewer
  const copyText = locked ? () => Promise.resolve() : copyTextFn;
  const L = { tree: 'Tree', outline: 'Outline', code: 'Code', search: 'Search keys & values…', expand: 'Expand all', collapse: 'Collapse all', copy: 'Copy', copied: 'Copied', download: 'Download', full: 'Full screen', exit: 'Exit full screen', nodes: 'nodes', lines: 'lines', path: 'Click a node to see its path', matches: 'matches', wrap: 'Wrap', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomHint: 'Ctrl + mouse wheel to zoom', fit: 'Fit to screen', resetLayout: 'Reset layout', dragHint: 'drag to move', resize: 'Drag to resize', theme: 'Theme', dark: 'Dark', light: 'Light', ...labels };
  const [view, setView] = useState('tree');
  const controlled = themeProp !== undefined; // inside the ZIP workbench the editor's own theme drives the viewer
  const [ownTheme, setOwnTheme] = useState(() => jvTheme(readLS(LS_THEME, JV_DEFAULT)).id);
  const theme = controlled ? themeProp : ownTheme;
  const setTheme = useCallback((id) => { if (controlled) onTheme?.(id); else setOwnTheme(id); }, [controlled, onTheme]);
  const [preview, setPreview] = useState(null);
  const [fontSize, setFontSize] = useState(() => Number(readLS(LS_SIZE, 13)) || 13);
  const [wrap, setWrap] = useState(false);
  const [q, setQ] = useState('');
  const [cmd, setCmd] = useState({ tick: 0, level: 2 });
  const [selected, setSelected] = useState(null);
  const [flash, setFlash] = useState('');
  const [full, setFull] = useState(false);
  const rootRef = useRef(null);
  const editable = typeof onChange === 'function';
  const [editing, setEditing] = useState(null); // path of the value being edited
  const [adding, setAdding] = useState(null); // { key, val } while the add form is open

  const pretty = useMemo(() => (value !== undefined && value !== null ? JSON.stringify(value, null, 2) : (text || '')), [value, text]);
  const lines = useMemo(() => pretty.split('\n'), [pretty]);
  const parsed = value !== undefined && value !== null && isObj(value);
  const search = useMemo(() => (parsed ? searchPaths(value, q.trim()) : { matches: new Set(), open: new Set(), count: 0 }), [parsed, value, q]);
  const nodeCount = useMemo(() => {
    let n = 0;
    const walk = (v) => { n += 1; if (isObj(v)) Object.keys(v).forEach((k) => walk(v[k])); };
    if (parsed) walk(value);
    return n;
  }, [parsed, value]);
  const codeMatches = useMemo(() => (q.trim() ? lines.filter((l) => norm(l).includes(norm(q.trim()))).length : 0), [lines, q]);

  useEffect(() => { if (!controlled) writeLS(LS_THEME, ownTheme); }, [controlled, ownTheme]);
  useEffect(() => { writeLS(LS_SIZE, fontSize); }, [fontSize]);
  useEffect(() => { if (editable) return; setSelected(null); setCmd((c) => ({ tick: 0, level: c.level })); }, [pretty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [full]);

  const say = useCallback((msg) => { setFlash(msg); setTimeout(() => setFlash(''), 1400); }, []);
  const onSelect = useCallback((path, v) => {
    setSelected(path);
    if (!isObj(v)) copyText(typeof v === 'string' ? v : String(v)).then(() => say(L.copied));
  }, [say, L.copied]);


  const editApi = useMemo(() => (editable ? {
    editing,
    begin: (path) => setEditing(path),
    cancel: () => setEditing(null),
    commit: (path, v) => { setEditing(null); if (JSON.stringify(setIn(value, path, v)) !== JSON.stringify(value)) onChange(setIn(value, path, v)); },
  } : null), [editable, editing, value, onChange]);
  const selVal = useMemo(() => { if (!selected || !parsed) return undefined; try { return parsePath(selected).reduce((a, k) => a[k], value); } catch { return undefined; } }, [selected, parsed, value]);
  const addTarget = selected && isObj(selVal) ? selected : '$';
  const addTargetVal = addTarget === '$' ? value : selVal;
  const doAdd = () => {
    if (!adding || !isObj(addTargetVal)) return;
    const arr = Array.isArray(addTargetVal); const key = adding.key.trim();
    if (!arr && !key) return;
    onChange(addIn(value, addTarget, key, literalValue(adding.val)));
    setAdding(null);
  };
  const doRemove = () => { if (!selected || selected === '$') return; onChange(removeIn(value, selected)); setSelected(null); };

  const level = (n) => setCmd((c) => ({ tick: c.tick + 1, level: n }));
  const download = () => {
    const url = URL.createObjectURL(new Blob([pretty], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const vars = useMemo(() => jvVars(preview || theme), [preview, theme]);
  const popVars = useMemo(() => jvVars(theme), [theme]);
  const shownView = parsed ? view : 'code';
  const matchCount = shownView === 'code' ? codeMatches : search.count;
  const structured = shownView === 'tree' || shownView === 'outline';

  const node = (
    <div ref={rootRef} className={`jv${full ? ' is-full' : ''}`} style={vars} dir="ltr">
      <div className="jv-bar">
        <div className="jv-tabs" role="tablist">
          {parsed && <button type="button" role="tab" aria-selected={shownView === 'tree'} className={shownView === 'tree' ? 'is-on' : ''} onClick={() => setView('tree')}><Icon name="share" size={13} /> {L.tree}</button>}
          {parsed && <button type="button" role="tab" aria-selected={shownView === 'outline'} className={shownView === 'outline' ? 'is-on' : ''} onClick={() => setView('outline')}><Icon name="menu" size={13} /> {L.outline}</button>}
          <button type="button" role="tab" aria-selected={shownView === 'code'} className={shownView === 'code' ? 'is-on' : ''} onClick={() => (onCode ? onCode() : setView('code'))}><Icon name="terminal" size={13} /> {L.code}</button>
        </div>
        <label className="jv-search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.search} spellCheck={false} aria-label={L.search} />
          {q && <span className="jv-hits">{matchCount} {L.matches}</span>}
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><Icon name="x" size={12} /></button>}
        </label>
        <div className="jv-tools">
          {structured && (
            <>
              <button type="button" onClick={() => level(Infinity)}>{L.expand}</button>
              <button type="button" onClick={() => level(0)}>{L.collapse}</button>
              {[1, 2, 3].map((n) => <button type="button" key={n} className="jv-lv" title={`Expand to level ${n}`} onClick={() => level(n)}>{n}</button>)}
            </>
          )}
          {shownView === 'code' && <button type="button" className={wrap ? 'is-on' : ''} onClick={() => setWrap((w) => !w)}>{L.wrap}</button>}
          <button type="button" className="jv-lv" title="Smaller" onClick={() => setFontSize((s) => Math.max(10, s - 1))}>A−</button>
          <button type="button" className="jv-lv" title="Larger" onClick={() => setFontSize((s) => Math.min(20, s + 1))}>A+</button>
          <ThemePicker value={theme} onChange={setTheme} onPreview={setPreview} popStyle={popVars} labels={L} />
          {!locked && <button type="button" onClick={() => copyText(pretty).then(() => say(L.copied))}><Icon name="copy" size={14} /> {L.copy}</button>}
          {!locked && <button type="button" onClick={download}><Icon name="download" size={14} /> {L.download}</button>}
          <button type="button" className="jv-lv" title={full ? L.exit : L.full} aria-label={full ? L.exit : L.full} onClick={() => setFull((f) => !f)}><Icon name={full ? 'collapse' : 'maximize'} size={14} /></button>
        </div>
      </div>

      <EditCtx.Provider value={editApi}>
      <div className={`jv-body${shownView === 'tree' ? ' jv-body--graph' : ''}`} style={{ fontSize }}>
        {shownView === 'tree' && <GraphView key={editable ? 'g' : pretty} value={value} q={q.trim()} search={search} cmd={cmd} selected={selected} onSelect={onSelect} fontSize={fontSize} L={L} />}
        {shownView === 'outline' && <TreeNode name={null} value={value} path="$" depth={0} isArrayItem={false} cmd={cmd} search={search} q={q.trim()} selected={selected} onSelect={onSelect} />}
        {shownView === 'code' && <CodeView lines={lines} q={q.trim()} wrap={wrap} fontSize={fontSize} />}
      </div>
      </EditCtx.Provider>

      {editable && structured && (
        <div className="jv-editbar">
          {adding ? (
            <>
              {!Array.isArray(addTargetVal) && <input className="jv-edit" autoFocus placeholder="key" value={adding.key} onChange={(e) => setAdding({ ...adding, key: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); else if (e.key === 'Escape') setAdding(null); }} />}
              <input className="jv-edit" autoFocus={Array.isArray(addTargetVal)} placeholder='value  (123, true, null, "text", {}, [])' value={adding.val} onChange={(e) => setAdding({ ...adding, val: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); else if (e.key === 'Escape') setAdding(null); }} />
              <button type="button" onClick={doAdd}><Icon name="check" size={13} /> {L.add || 'Add'}</button>
              <button type="button" onClick={() => setAdding(null)}>{L.cancel || 'Cancel'}</button>
            </>
          ) : (
            <>
              <span className="jv-edithint">{L.editHint || 'Double-click a value to edit it'}</span>
              <button type="button" disabled={!isObj(addTargetVal)} onClick={() => setAdding({ key: '', val: '' })}><Icon name="plus" size={13} /> {L.add || 'Add'} {addTarget !== '$' ? `→ ${addTarget}` : ''}</button>
              <button type="button" className="jv-danger" disabled={!selected || selected === '$'} onClick={doRemove}><Icon name="trash" size={13} /> {L.remove || 'Delete'}</button>
            </>
          )}
        </div>
      )}
      <div className="jv-status">
        <span className="jv-path" title={selected || ''}>{selected || L.path}</span>
        {flash && <span className="jv-flash"><Icon name="check" size={12} /> {flash}</span>}
        <span className="jv-sp" />
        {meta && <span>{meta}</span>}
        <span>{parsed ? `${nodeCount.toLocaleString()} ${L.nodes} · ` : ''}{lines.length.toLocaleString()} {L.lines} · {(new Blob([pretty]).size / 1024).toFixed(1)} KB</span>
        {selected && !locked && <button type="button" onClick={() => copyText(selected).then(() => say(L.copied))}>{L.copy} path</button>}
      </div>
    </div>
  );
  // Full screen is drawn straight into <body>: inside the page an ancestor with a transform / animation / overflow turns
  // `position: fixed` into "fixed relative to that ancestor", which made the whole page judder when the button was pressed.
  return full && typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}
