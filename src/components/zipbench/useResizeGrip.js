import { useRef, useState } from 'react';

/** Drag the top edge of a bottom panel to resize it. `height` is null until the user drags (then the CSS default applies). */
export function useResizeGrip(min = 110, reserve = 64) {
  const panelRef = useRef(null);
  const [height, setHeight] = useState(null);
  const onGripDown = (e) => {
    const el = panelRef.current; const parent = el?.parentElement; if (!el || !parent) return;
    e.preventDefault();
    const y0 = e.clientY; const h0 = el.getBoundingClientRect().height; const max = parent.clientHeight - reserve;
    const move = (ev) => setHeight(Math.max(min, Math.min(max, h0 + (y0 - ev.clientY))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return { panelRef, height, setHeight, onGripDown };
}
