import { useCallback, useRef, useState } from 'react';

/** Snapshot history for immutable values: { value, set(v), undo, redo, canUndo, canRedo, dirty, markSaved }. */
export default function useDocHistory(initial, startDirty = false) {
  // startDirty: the document is a restored local draft -> `saved` is a sentinel nothing can equal until markSaved()
  const [state, setState] = useState({ past: [], value: initial, future: [], saved: startDirty ? Symbol('draft') : initial });
  const ref = useRef(state); ref.current = state;
  // merge = true folds the change into the previous undo step (used for key-repeat nudges)
  const set = useCallback((v, merge) => setState((s) => ({ ...s, past: merge && s.past.length ? s.past : [...s.past.slice(-80), s.value], value: v, future: [] })), []);
  const undo = useCallback(() => setState((s) => (s.past.length ? { ...s, past: s.past.slice(0, -1), value: s.past[s.past.length - 1], future: [s.value, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length ? { ...s, past: [...s.past, s.value], value: s.future[0], future: s.future.slice(1) } : s)), []);
  const markSaved = useCallback(() => setState((s) => ({ ...s, saved: s.value })), []);
  const reset = useCallback((v) => setState((s) => ({ past: [], value: v, future: [], saved: typeof s.saved === 'symbol' ? s.saved : v })), []);
  return { value: state.value, set, undo, redo, reset, markSaved, canUndo: state.past.length > 0, canRedo: state.future.length > 0, dirty: state.value !== state.saved };
}
