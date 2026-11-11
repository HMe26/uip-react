import { useEffect, useRef } from 'react';
import { MUTATION_EVENT } from '../api/client';
import { RT_EVENT, isRealtimeConnected } from '../lib/realtime';

/**
 * Keeps a piece of UI in sync without a page reload.
 *
 * `refresh` is called (never on mount — the caller does its own first load):
 *   - right after any successful write the app makes (api.post/put/patch/del)
 *     whose path matches `watch` (a RegExp; omit to react to every write),
 *   - when the tab becomes visible again / the window regains focus,
 *   - every `interval` ms while the tab is visible (omit/0 to disable) —
 *     this is how changes made by *other* people or devices show up.
 *   - the instant the server pushes a realtime ping for one of `topics` (e.g. ['messaging','notification']),
 *     over the Reverb socket — no waiting for the poll. Also on socket (re)connect.
 * Bursts of events are coalesced into one refresh (`debounce`, default 250ms; realtime pings use 40ms).
 */
export function useLive(refresh, { watch, interval = 0, debounce = 250, enabled = true, topics } = {}) {
  const ref = useRef(refresh);
  ref.current = refresh;
  const watchSrc = watch ? watch.source : '';
  const topicsKey = Array.isArray(topics) ? topics.join(',') : '';

  useEffect(() => {
    if (!enabled) return undefined;
    const re = watchSrc ? new RegExp(watchSrc) : null;
    let timer = null;
    let lastRun = 0;
    const run = () => { lastRun = Date.now(); ref.current?.(); };
    const fire = (ms) => { // `ms` is only a number when called by us; listeners pass an Event
      clearTimeout(timer);
      timer = setTimeout(run, typeof ms === 'number' ? ms : debounce);
    };
    // Returning to the tab / refocusing the window fires BOTH `focus` and `visibilitychange`, and people switch tabs all
    // the time: re-fetch only if the data is at least MIN_GAP old (writes and realtime pings still refresh at once).
    const MIN_GAP = 20000;
    const onBack = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRun < MIN_GAP) return;
      fire();
    };
    const onMutation = (e) => {
      const path = e.detail?.path || '';
      if (!re || re.test(path)) fire();
    };

    // realtime ping from the Reverb socket (see lib/realtime.js): refresh now, ~40 ms coalescing
    const topicList = topicsKey ? topicsKey.split(',') : [];
    const onRealtime = (e) => {
      const t = e.detail?.topic;
      if (t === 'resync' ? topicList.length > 0 : topicList.includes(t)) fire(40);
    };

    window.addEventListener(MUTATION_EVENT, onMutation);
    if (topicList.length) window.addEventListener(RT_EVENT, onRealtime);
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    // While the realtime socket is connected the server pushes every change, so the poll is only a slow safety net.
    const poll = interval > 0
      ? setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        const every = topicList.length && isRealtimeConnected() ? Math.max(interval * 6, 180000) : interval;
        if (Date.now() - lastRun < every - 1000) return;
        run();
      }, interval)
      : null;

    return () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      window.removeEventListener(MUTATION_EVENT, onMutation);
      window.removeEventListener(RT_EVENT, onRealtime);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [enabled, watchSrc, interval, debounce, topicsKey]);
}

// Writes that can change what the shell (topbar / sidebar) shows about the person.
export const PROFILE_WRITE = /\/(profile|me|avatar|settings|account|preferences|portfolio)(\/|$|\?)/;
