import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Open / closed state of the sidebar's groups (Workspace, Academics, ...).
 *
 * - Remembered in localStorage per person + portal, so a refresh, a new tab or
 *   the next login keeps the sidebar exactly how it was left.
 * - Only the COLLAPSED group keys are stored: a group that is new (or was never
 *   touched) starts open.
 * - Several tabs stay in sync through the `storage` event.
 * - Storage being unavailable (private mode, quota) never breaks the sidebar.
 */
const PREFIX = 'uip:sidebar-groups:v1:';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function useSidebarGroups(scope, allKeys) {
  const storageKey = PREFIX + (scope || 'default');
  const [collapsed, setCollapsed] = useState(() => read(storageKey));

  // The person / portal changed (login as someone else): load their own saved state.
  useEffect(() => { setCollapsed(read(storageKey)); }, [storageKey]);

  // Another tab changed it.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === storageKey) setCollapsed(read(storageKey)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const commit = useCallback((next) => {
    setCollapsed(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [storageKey]);

  const set = useMemo(() => new Set(collapsed), [collapsed]);
  const isOpen = useCallback((key) => !set.has(key), [set]);

  const toggle = useCallback((key) => {
    commit(set.has(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);
  }, [set, collapsed, commit]);

  const expandAll = useCallback(() => commit([]), [commit]);
  const collapseAll = useCallback(() => commit([...allKeys]), [commit, allKeys]);

  const openCount = allKeys.filter((k) => !set.has(k)).length;
  return { isOpen, toggle, expandAll, collapseAll, allOpen: openCount === allKeys.length, allClosed: openCount === 0 };
}
