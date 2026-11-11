import { useEffect, useRef, useState } from 'react';

/** { ref, seen } — `seen` flips to true (and stays) once the element comes within `margin` of the viewport. */
export default function useNearScreen(margin = '500px 0px') {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return { ref, seen };
}
