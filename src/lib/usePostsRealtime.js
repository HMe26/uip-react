import { useEffect, useRef } from 'react';
import { onRealtime } from './realtime';

/**
 * Live updates for posts (Reverb, same socket as the chat). The server pushes only { post_id, kind, actor, comment_id?, parent_id? } —
 * never counts or text — so each screen re-fetches through the normal API (visibility rules, hidden counters…).
 *
 *   usePostsRealtime(postId, (d) => …, enabled)   d.kind === 'resync' after a reconnect / when the tab wakes up
 */
let lastLocalWrite = 0;
/** Call right after this tab writes (react / comment / save…): the server's echo of it is then ignored instead of re-fetched. */
export const markLocalWrite = () => { lastLocalWrite = Date.now(); };
export const isOwnEcho = (d, uid) => !!d && d.kind !== 'resync' && uid != null && Number(d.actor) === Number(uid) && Date.now() - lastLocalWrite < 1500;

export default function usePostsRealtime(postId, handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled || postId == null) return undefined;
    return onRealtime('posts', (d, topic) => {
      if (topic === 'resync') ref.current({ kind: 'resync' });
      else if (Number(d.post_id) === Number(postId)) ref.current(d);
    });
  }, [postId, enabled]);
}
