/**
 * Freeze page scrolling behind a full-screen layer (lightbox, editor, composer).
 *
 * Never use `document.body.style.overflow = 'hidden'` for this: html already has overflow-x clipped, so a
 * hidden body stops propagating to the viewport and becomes its OWN scroll container — the sticky sidebar
 * then loses its stickiness and the whole sidebar jumps up with the page behind the overlay.
 * Locking <html> instead keeps the viewport as the scroller (scroll position and sticky stay intact), and the
 * missing scrollbar's width is padded back so nothing shifts sideways.
 */
let count = 0;
let saved = null;

export function lockScroll() {
  const root = document.documentElement;
  if (count === 0) {
    const gap = window.innerWidth - root.clientWidth;
    saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    if (gap > 0) root.style.paddingRight = `${gap}px`;
    root.style.overflow = 'hidden';
  }
  count += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count -= 1;
    if (count === 0 && saved) {
      root.style.overflow = saved.overflow;
      root.style.paddingRight = saved.paddingRight;
      saved = null;
    }
  };
}
