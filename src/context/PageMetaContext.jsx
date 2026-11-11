import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getNavConfig } from '../config/navConfig';
import { useLanguage } from './LanguageContext';

/**
 * Puts the page title + subtitle in the topbar (Student portal design:
 * "Student Dashboard / Track your projects…" sits on the left of the bar).
 *
 *  - Pages can set it explicitly with usePageMeta(title, subtitle).
 *  - Every other student page is covered by <PageMetaSync/>, which reads the
 *    page's own header (.page-header__title h1/p) or, failing that, uses the
 *    sidebar label for the route — so no page ends up with an empty topbar.
 */
const SetCtx = createContext(() => {});
const SetDerivedCtx = createContext(() => {});
const ValueCtx = createContext({});

export function PageMetaProvider({ children }) {
  const [explicit, setExplicit] = useState({});
  const [derived, setDerived] = useState({});
  const value = useMemo(() => (explicit.title ? explicit : derived), [explicit, derived]);
  return (
    <SetCtx.Provider value={setExplicit}>
      <SetDerivedCtx.Provider value={setDerived}>
        <ValueCtx.Provider value={value}>{children}</ValueCtx.Provider>
      </SetDerivedCtx.Provider>
    </SetCtx.Provider>
  );
}

/** Call from a page: usePageMeta(title, subtitle). Cleared on unmount. */
export function usePageMeta(title, subtitle) {
  const setMeta = useContext(SetCtx);
  useEffect(() => {
    setMeta({ title, subtitle });
    return () => setMeta({});
  }, [title, subtitle, setMeta]);
}

export function usePageMetaValue() {
  return useContext(ValueCtx);
}

/** Render once inside the student layout, next to <Outlet/>. */
export function PageMetaSync({ role, onlyWithoutHeader = false }) {
  const { pathname } = useLocation();
  const { locale } = useLanguage();
  const setDerived = useContext(SetDerivedCtx);

  useEffect(() => {
    const navLabel = () => {
      const sections = getNavConfig(role);
      let best = null;
      Object.values(sections).flat().forEach((item) => {
        if (item.route && (pathname === item.route || pathname.startsWith(`${item.route}/`))) {
          if (!best || item.route.length > best.route.length) best = item;
        }
      });
      return best ? (best[locale] || best.en) : '';
    };
    const read = () => {
      const main = document.querySelector('.app-shell__main');
      const h1 = main?.querySelector('.page-header__title h1');
      const sub = main?.querySelector('.page-header__title p:not(.text-caption)');
      // Staff shell: pages that draw their own big header (.stf-head / .page-header) keep it;
      // only header-less shared pages (Settings, Messages…) get a title in the topbar.
      const ownHeader = onlyWithoutHeader && main?.querySelector('.stf-head h1, .page-header__title h1');
      const title = ownHeader ? '' : (h1?.textContent?.trim() || navLabel());
      setDerived((prev) => {
        const next = { title, subtitle: ownHeader ? '' : (sub?.textContent?.trim() || '') };
        return prev.title === next.title && prev.subtitle === next.subtitle ? prev : next;
      });
    };
    read();
    const main = document.querySelector('.app-shell__main');
    if (!main) return undefined;
    // The page shell changes constantly in chat / video screens (progress rings, polling): read the heading at most ~6x a second.
    let pending = 0;
    const later = () => { if (pending) return; pending = setTimeout(() => { pending = 0; read(); }, 160); };
    const obs = new MutationObserver(later);
    obs.observe(main, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); clearTimeout(pending); };
  }, [pathname, locale, role, setDerived, onlyWithoutHeader]);

  return null;
}
