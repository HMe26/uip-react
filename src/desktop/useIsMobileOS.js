import { useEffect, useState } from 'react';

const QUERY = '(max-width: 820px), (pointer: coarse) and (max-height: 520px)';
const readLayout = () => {
  try { const f = localStorage.getItem('uip.os.layout'); if (f === 'mobile') return true; if (f === 'desktop') return false; } catch { /* storage blocked */ }
  return !!window.matchMedia?.(QUERY).matches;
};
/** Phone-sized screens get <MobileShell>. Force either layout with localStorage 'uip.os.layout' = 'mobile' | 'desktop'. */
export function useIsMobileOS() {
  const [m, setM] = useState(readLayout);
  useEffect(() => {
    const q = window.matchMedia?.(QUERY);
    const on = () => setM(readLayout());
    q?.addEventListener?.('change', on);
    window.addEventListener('storage', on);
    return () => { q?.removeEventListener?.('change', on); window.removeEventListener('storage', on); };
  }, []);
  return m;
}

export default useIsMobileOS;
