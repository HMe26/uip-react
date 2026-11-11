import { useCallback, useRef, useState } from 'react';

const LIMIT = 80;

/**
 * Undo / redo over an immutable state.
 *   live(fn)       – change the present without recording (while dragging)
 *   commit(from)   – record `from(present)` as the undo point after a live gesture
 *   push(fn)       – change + record in one step
 *   debounced(fn)  – live change that is recorded 0.5s after the last tweak (sliders, colour pickers…)
 */
export default function useHistory(initial, startDirty = false) {
  const [s, setS] = useState({ past: [], present: initial, future: [] });
  const ref = useRef(s);
  ref.current = s;
  const pend = useRef({ from: null, t: 0 });

  const flush = useCallback(() => {
    clearTimeout(pend.current.t);
    const f = pend.current.from;
    pend.current.from = null;
    if (f) setS((st) => ({ past: [...st.past.slice(-LIMIT), f], present: st.present, future: [] }));
  }, []);

  const live = useCallback((fn) => setS((st) => ({ ...st, present: typeof fn === 'function' ? fn(st.present) : fn })), []);

  const debounced = useCallback((fn) => {
    if (!pend.current.from) pend.current.from = ref.current.present;
    setS((st) => ({ ...st, present: fn(st.present) }));
    clearTimeout(pend.current.t);
    pend.current.t = setTimeout(flush, 500);
  }, [flush]);

  const push = useCallback((fn) => {
    flush();
    setS((st) => ({ past: [...st.past.slice(-LIMIT), st.present], present: typeof fn === 'function' ? fn(st.present) : fn, future: [] }));
  }, [flush]);

  const commit = useCallback((from) => {
    flush();
    setS((st) => ({ past: [...st.past.slice(-LIMIT), from(st.present)], present: st.present, future: [] }));
  }, [flush]);

  const undo = useCallback(() => {
    flush();
    setS((st) => (st.past.length ? { past: st.past.slice(0, -1), present: st.past[st.past.length - 1], future: [st.present, ...st.future] } : st));
  }, [flush]);

  const redo = useCallback(() => {
    flush();
    setS((st) => (st.future.length ? { past: [...st.past, st.present], present: st.future[0], future: st.future.slice(1) } : st));
  }, [flush]);

  const reset = useCallback((next) => { clearTimeout(pend.current.t); pend.current.from = null; setS({ past: [], present: next, future: [] }); }, []);

  return {
    present: s.present,
    canUndo: s.past.length > 0 || !!pend.current.from,
    canRedo: s.future.length > 0,
    dirty: startDirty || s.past.length > 0 || !!pend.current.from, // a restored draft stays "unsaved" until it is saved
    live, debounced, push, commit, undo, redo, reset, flush,
  };
}
