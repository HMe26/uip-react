import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useLive } from '../hooks/useLive';
import { DRIVE_FAILED, DRIVE_SAVED } from '../lib/driveEvents';
import { playSound } from '../lib/notificationSound';
import { localizeNotification } from '../utils/notificationText';
import { parseServerDate } from '../utils/serverDate';

/**
 * Notification center of the desktop ("My PC").
 *
 * Two sources, shown together in one list:
 *  - SERVER notifications (/api/v1/notifications — the same ones as the portal bell and the Notifications page:
 *    a message from a doctor, exam / project / invitation updates …). Read state lives on the server, so reading
 *    one here also clears the portal bell.
 *  - LOCAL events of this desktop: "upload finished" / "upload failed" (lib/driveEvents.js). They are grouped, so a
 *    folder with 200 files becomes ONE entry, and they are kept per account in localStorage (read state included).
 *
 * New arrivals raise a toast (+ the bell sound) unless the desktop is locked / asleep — then they simply wait, unread.
 */
const BASE = '/api/v1/notifications';
const KEY = (uid) => `uip_os_notifs_${uid || 'anon'}`;
const MAX_LOCAL = 40;
const GROUP_MS = 5000; // uploads that land within 5 s of each other are one entry

const loadLocal = (uid) => {
  try { const v = JSON.parse(localStorage.getItem(KEY(uid)) || '[]'); return Array.isArray(v) ? v.slice(0, MAX_LOCAL) : []; } catch { return []; }
};
const saveLocal = (uid, list) => { try { localStorage.setItem(KEY(uid), JSON.stringify(list.slice(0, MAX_LOCAL))); } catch { /* storage full / blocked */ } };

const iconTone = (icon, priority) => {
  if (priority === 'urgent') return 'danger';
  if (['alert', 'alert-triangle', 'shield'].includes(icon)) return 'warning';
  if (['x-circle', 'trend', 'chart', 'bar-chart'].includes(icon)) return 'danger';
  if (['download', 'check', 'check-circle', 'upload'].includes(icon)) return 'success';
  return 'primary';
};

/** A local upload entry written in the student's language (rebuilt on render, so switching language updates it). */
function localText(e, tt) {
  const n = e.count || 1;
  const first = e.names?.[0] || '';
  if (e.kind === 'upload') {
    return {
      title: n === 1 ? tt('Upload finished', 'اكتمل الرفع') : tt(`Upload finished · ${n} files`, `اكتمل رفع ${n} ملفات`),
      body: n === 1 ? first : `${first}${n > 1 ? tt(` and ${n - 1} more`, ` و${n - 1} آخرين`) : ''}`,
    };
  }
  return {
    title: n === 1 ? tt('Upload failed', 'فشل الرفع') : tt(`Upload failed · ${n} files`, `فشل رفع ${n} ملفات`),
    body: n === 1 ? first : `${first}${tt(` and ${n - 1} more`, ` و${n - 1} آخرين`)}`,
  };
}

/**
 * @param {{ uid?: any, ar: boolean, tt: Function, quiet?: boolean }} o   quiet = locked / asleep (no toast, no sound)
 */
export function useDesktopNotifications({ uid, ar, tt, quiet = false }) {
  const [server, setServer] = useState([]);
  const [serverUnread, setServerUnread] = useState(0);
  const [local, setLocal] = useState(() => loadLocal(uid));
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const seen = useRef({ ready: false, maxId: 0, unread: 0 });
  const quietRef = useRef(quiet); quietRef.current = quiet;
  const seq = useRef(0);
  const timers = useRef(new Map());

  // ── toasts ──
  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const h = timers.current.get(id); if (h) { clearTimeout(h); timers.current.delete(id); }
  }, []);
  const pushToast = useCallback((t) => {
    if (quietRef.current) return;
    const id = `n${(seq.current += 1)}`;
    setToasts((list) => [...list.filter((x) => !(t.group && x.group === t.group)), { id, ...t }].slice(-3));
    timers.current.set(id, setTimeout(() => dismissToast(id), t.tone === 'danger' ? 9000 : 6500));
    playSound('notification');
  }, [dismissToast]);
  useEffect(() => () => { timers.current.forEach((h) => clearTimeout(h)); timers.current.clear(); }, []);

  // ── server notifications ──
  const refresh = useCallback(() => (
    Promise.all([api.get(BASE, { per_page: 25 }), api.get(`${BASE}/counts`)])
      .then(([list, counts]) => {
        const rows = Array.isArray(list.data) ? list.data : [];
        const unread = counts.data?.unread ?? rows.filter((n) => !n.is_read).length;
        const s = seen.current;
        const fresh = rows.filter((n) => !n.is_read && Number(n.id) > s.maxId);
        if (s.ready && fresh.length) {
          const newest = fresh.reduce((m, n) => (Number(n.id) > Number(m.id) ? n : m), fresh[0]);
          const text = localizeNotification(newest, ar ? 'ar' : 'en');
          pushToast({ key: `s:${newest.id}`, group: 'server', icon: newest.icon || 'bell', tone: iconTone(newest.icon, newest.priority), title: text.title, body: fresh.length > 1 ? tt(`and ${fresh.length - 1} more new`, `و${fresh.length - 1} إشعارات جديدة أخرى`) : text.body, link: newest.link_url || null, serverId: newest.id });
        }
        seen.current = { ready: true, maxId: Math.max(s.maxId, ...rows.map((n) => Number(n.id) || 0)), unread };
        setServer(rows);
        setServerUnread(unread);
      })
      .catch(() => { /* the center degrades to "nothing new" instead of breaking the desktop */ })
      .finally(() => setLoading(false))
  ), [ar, pushToast, tt]);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLocal(loadLocal(uid)); }, [uid]);
  useLive(refresh, { watch: /\/(notifications|messaging|messages|exams?|appeals?)(\/|$|\?)/, interval: 30000, topics: ['notification', 'messaging'] });
  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('uip:push-received', on);
    return () => window.removeEventListener('uip:push-received', on);
  }, [refresh]);

  // ── local events: uploads ──
  const batch = useRef({ saved: null, failed: null });
  const writeLocal = useCallback((fn) => setLocal((prev) => { const next = fn(prev); saveLocal(uid, next); return next; }), [uid]);
  useEffect(() => {
    const add = (kind) => (e) => {
      const d = e.detail || {};
      if (kind === 'upload' && (d.silent || d.kind !== 'upload')) return;
      if (kind === 'failed' && d.kind !== 'upload') return;
      const slot = kind === 'upload' ? 'saved' : 'failed';
      const now = Date.now();
      const cur = batch.current[slot];
      const name = d.name || '';
      if (cur && now - cur.last < GROUP_MS) {
        cur.last = now; cur.count += 1; if (name && cur.names.length < 3) cur.names.push(name);
      } else {
        batch.current[slot] = { id: `l${now}${Math.random().toString(36).slice(2, 6)}`, last: now, count: 1, names: name ? [name] : [] };
      }
      const b = batch.current[slot];
      writeLocal((prev) => {
        const entry = { id: b.id, kind, at: now, count: b.count, names: [...b.names], read: false };
        const i = prev.findIndex((x) => x.id === b.id);
        if (i >= 0) { const next = prev.slice(); next[i] = { ...entry, read: false }; return next; }
        return [entry, ...prev].slice(0, MAX_LOCAL);
      });
      // ONE toast per batch, shown once the burst has settled (a folder of 200 files must not toast 200 times)
      clearTimeout(b.timer);
      b.timer = setTimeout(() => {
        const txt = localText({ kind, count: b.count, names: b.names }, tt);
        pushToast({ key: b.id, group: `local-${slot}`, icon: kind === 'upload' ? 'check-circle' : 'x-circle', tone: kind === 'upload' ? 'success' : 'danger', title: txt.title, body: txt.body, localId: b.id });
      }, 1600);
    };
    const onSaved = add('upload'); const onFail = add('failed');
    window.addEventListener(DRIVE_SAVED, onSaved);
    window.addEventListener(DRIVE_FAILED, onFail);
    return () => { window.removeEventListener(DRIVE_SAVED, onSaved); window.removeEventListener(DRIVE_FAILED, onFail); };
  }, [pushToast, tt, writeLocal]);

  // ── the merged, display-ready list ──
  const items = useMemo(() => {
    const out = [];
    server.forEach((n) => {
      const text = localizeNotification(n, ar ? 'ar' : 'en');
      const at = parseServerDate(n.created_at).getTime();
      out.push({ key: `s:${n.id}`, src: 'server', id: n.id, title: text.title, body: text.body, icon: n.icon || 'bell', tone: iconTone(n.icon, n.priority), at: Number.isNaN(at) ? 0 : at, read: !!n.is_read, link: n.link_url || null, category: n.category || '', important: !!n.is_important || n.priority === 'urgent' });
    });
    local.forEach((e) => {
      const text = localText(e, tt);
      out.push({ key: `l:${e.id}`, src: 'local', id: e.id, title: text.title, body: text.body, icon: e.kind === 'upload' ? 'upload' : 'x-circle', tone: e.kind === 'upload' ? 'success' : 'danger', at: e.at, read: !!e.read, link: null, category: 'files' });
    });
    return out.sort((a, b) => b.at - a.at);
  }, [server, local, ar, tt]);

  const unread = serverUnread + local.filter((e) => !e.read).length;

  // ── actions ──
  const markRead = useCallback((it) => {
    if (!it || it.read) return;
    if (it.src === 'local') { writeLocal((p) => p.map((e) => (e.id === it.id ? { ...e, read: true } : e))); return; }
    setServer((p) => p.map((n) => (n.id === it.id ? { ...n, is_read: true } : n)));
    setServerUnread((c) => Math.max(0, c - 1));
    api.patch(`${BASE}/${it.id}/read`).catch(() => refresh());
  }, [refresh, writeLocal]);

  const markAllRead = useCallback(() => {
    writeLocal((p) => p.map((e) => ({ ...e, read: true })));
    if (serverUnread > 0) {
      setServer((p) => p.map((n) => ({ ...n, is_read: true })));
      setServerUnread(0);
      api.post(`${BASE}/read-all`).catch(() => refresh());
    }
  }, [refresh, serverUnread, writeLocal]);

  /** Only local entries can be cleared from the desktop; server notifications are archived / deleted from the full Notifications page. */
  const clearLocal = useCallback(() => writeLocal(() => []), [writeLocal]);
  const removeLocal = useCallback((id) => writeLocal((p) => p.filter((e) => e.id !== id)), [writeLocal]);

  return { items, unread, loading, toasts, dismissToast, markRead, markAllRead, clearLocal, removeLocal, refresh, hasLocal: local.length > 0 };
}

export function ago(at, tt, ar) {
  const diff = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (diff < 60) return tt('Just now', 'الآن');
  if (diff < 3600) { const m = Math.floor(diff / 60); return tt(`${m}m ago`, `منذ ${m} د`); }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return tt(`${h}h ago`, `منذ ${h} س`); }
  if (diff < 604800) { const d = Math.floor(diff / 86400); return tt(`${d}d ago`, `منذ ${d} يوم`); }
  return new Date(at).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
}
