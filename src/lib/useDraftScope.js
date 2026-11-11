import { useAuth } from '../context/AuthContext';

/** Who the local drafts belong to: one account's drafts are never offered to another one on a shared computer. */
export default function useDraftScope() {
  try { return String(useAuth()?.user?.id ?? 'anon'); } catch { return 'anon'; } // eslint-disable-line react-hooks/rules-of-hooks
}
