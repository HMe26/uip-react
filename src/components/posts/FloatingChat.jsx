import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { api } from '../../api/client';
import { EMBED_NAME } from '../../lib/embed';
import { useTt } from './shared';

const WIDE_KEY = 'uip_fc_wide';

/**
 * Floating chat: a round button that slides the FULL Messages app in from the side (same page as /{portal}/messages,
 * rendered in an embedded frame without the portal chrome), so every messenger feature is available without leaving the page.
 * The frame is mounted on first open and kept alive afterwards, so reopening is instant and the open chat is preserved.
 */
export default function FloatingChat() {
  const { tt, rtl } = useTt();
  const nav = useNavigate();
  const loc = useLocation();
  const portal = loc.pathname.split('/')[1] || 'student';
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unread, setUnread] = useState(0);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem(WIDE_KEY) === '1'; } catch { return false; } });

  const loadUnread = useCallback(async () => {
    try {
      const r = await api.get('/api/v1/messaging/inbox');
      const rows = Array.isArray(r?.data) ? r.data : [];
      setUnread(rows.reduce((n, c) => n + (c.is_muted ? 0 : Number(c.unread_count || (c.is_unread ? 1 : 0))), 0));
    } catch { /* badge is best-effort */ }
  }, []);
  useEffect(() => {
    loadUnread();
    const id = setInterval(() => { if (!document.hidden) loadUnread(); }, open ? 8000 : 25000);
    return () => clearInterval(id);
  }, [open, loadUnread]);

  useEffect(() => { if (open) setMounted(true); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggleWide = () => setWide((w) => { const n = !w; try { localStorage.setItem(WIDE_KEY, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const src = useMemo(() => `/${portal}/messages?embed=1`, [portal]);

  return (
    <>
      <button type="button" className={`fc-fab${open ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={tt('Messages', 'الرسائل')} aria-expanded={open}>
        <span className="fc-fab__ico fc-fab__ico--chat"><Icon name="chat" size={26} /></span>
        <span className="fc-fab__ico fc-fab__ico--x"><Icon name="x" size={24} /></span>
        {unread > 0 && !open && <span className="fc-fab__badge">{unread > 99 ? '99+' : unread}</span>}
        {unread > 0 && !open && <span className="fc-fab__ring" aria-hidden="true" />}
      </button>

      <div className={`fc-scrim${open ? ' is-open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={`fc-drawer${open ? ' is-open' : ''}${wide ? ' is-wide' : ''}`} dir={rtl ? 'rtl' : 'ltr'} role="dialog" aria-label={tt('Messages', 'الرسائل')} aria-hidden={!open}>
        <header className="fc-bar">
          <span className="fc-bar__ico"><Icon name="chat" size={16} /></span>
          <strong>{tt('Messages', 'الرسائل')}</strong>
          {unread > 0 && <span className="fc-bar__n">{unread > 99 ? '99+' : unread}</span>}
          <span className="fc-bar__sp" />
          <button type="button" className="fc-ibtn fc-wide" onClick={toggleWide} title={wide ? tt('Compact view', 'عرض مصغّر') : tt('Wide view', 'عرض واسع')} aria-pressed={wide}><Icon name={wide ? 'collapse-all' : 'panel-left'} size={17} /></button>
          <button type="button" className="fc-ibtn" onClick={() => { setOpen(false); nav(`/${portal}/messages`); }} title={tt('Open as a full page', 'فتح كصفحة كاملة')}><Icon name="external-link" size={17} /></button>
          <button type="button" className="fc-ibtn" onClick={() => setOpen(false)} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>
        <div className="fc-frame">
          {mounted && !loaded && <div className="fc-loading"><span className="fc-spin" /><small>{tt('Loading messages…', 'جارٍ تحميل الرسائل…')}</small></div>}
          {mounted && <iframe key={src} name={EMBED_NAME} src={src} title={tt('Messages', 'الرسائل')} className={loaded ? 'is-ready' : ''} onLoad={() => { setLoaded(true); loadUnread(); }} allow="microphone; camera; clipboard-write; geolocation; fullscreen" />}
        </div>
      </aside>
    </>
  );
}
