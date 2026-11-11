import { useEffect, useRef, useState } from 'react';

/** Animates from the previous value to `value` (respects prefers-reduced-motion). */
export default function CountUp({ value, duration = 1200, locale }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const target = Number(value) || 0;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || target === from.current) { setShown(target); from.current = target; return undefined; }
    const start = performance.now();
    const begin = from.current;
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(begin + (target - begin) * eased));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{shown.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}</>;
}
