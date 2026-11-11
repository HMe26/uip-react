import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useBackLayer } from '../../lib/backStack';
import { watchScreenCapture } from '../../lib/captureGuard';
import { setContentSecure } from '../../native';
import { useAuth } from '../../context/AuthContext';

/**
 * A "view once" / "timer" photo or video inside a chat bubble.
 *  - The server never sends the file URL for these. The receiver opens it with ONE request (GET …/view-once); the server hands
 *    the file over and deletes it right away, so it cannot be opened again, downloaded again or forwarded.
 *  - mode 'once'  → shown until the receiver closes it.
 *  - mode 'timer' → closes itself N seconds after it opens.
 *  - The sender cannot open it; they only see whether it has been opened.
 */
export default function ViewOnceMedia({ attachment, mine, ar }) {
  const t = (en, a) => (ar ? a : en);
  const { id, kind, view_mode: mode, view_seconds: secs } = attachment;
  const [state, setState] = useState(attachment.consumed ? 'gone' : 'idle'); // idle | loading | open | gone | error
  const [url, setUrl] = useState('');
  const [mime, setMime] = useState('');
  const [left, setLeft] = useState(secs || 0);
  const urlRef = useRef('');
  const { user } = useAuth();
  const [shield, setShield] = useState(false); // true = the picture is hidden (page not in front / a capture shortcut was seen)
  const who = String(user?.full_name || user?.email || '').slice(0, 40);

  useEffect(() => { if (attachment.consumed && state !== 'open') setState('gone'); }, [attachment.consumed, state]);

  const close = () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
    setUrl(''); setState('gone');
  };
  useBackLayer(state === 'open', close);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // ---- screen-capture protection (be honest: only the Android app can truly block it; the browser can only deter) ----
  //  • Android app: FLAG_SECURE → screenshots / recordings come out black.
  //  • Browser: close + black out the moment the tab/window loses focus (snipping tools, recorders and app switchers all do
  //    that), react to PrintScreen / Win+Shift+S / Cmd+Shift+3-4-5 (and wipe the clipboard), block print / right-click / drag,
  //    and tile the viewer's name over the picture so a photo of the screen can be traced back.
  //  Not detectable by any web page: the phone's own screenshot gesture in a mobile browser, or a photo from another device.
  useEffect(() => {
    if (state !== 'open') return undefined;
    setContentSecure(true);
    const hideNow = () => { setShield(true); close(); };
    const onVis = () => { if (document.hidden) hideNow(); };
    const stopWatch = watchScreenCapture(() => {
      try { navigator.clipboard?.writeText(' '); } catch { /* ignore */ }
      hideNow();
    });
    const noPrint = (e) => { if ((e.ctrlKey || e.metaKey) && /^(p|s)$/i.test(e.key)) e.preventDefault(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', hideNow);
    window.addEventListener('beforeprint', hideNow);
    window.addEventListener('keydown', noPrint, true);
    return () => {
      setContentSecure(false);
      stopWatch();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', hideNow);
      window.removeEventListener('beforeprint', hideNow);
      window.removeEventListener('keydown', noPrint, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // timer: counts down from the moment the picture is on screen
  useEffect(() => {
    if (state !== 'open' || mode !== 'timer') return undefined;
    setLeft(secs || 10);
    const iv = setInterval(() => setLeft((x) => x - 1), 1000);
    return () => clearInterval(iv);
  }, [state, mode, secs]);
  useEffect(() => { if (state === 'open' && mode === 'timer' && left <= 0) close(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [left, state, mode]);

  const open = async () => {
    if (mine || state !== 'idle') return;
    setState('loading');
    try {
      const res = await api.blob(`/api/v1/messaging/attachments/${id}/view-once`, undefined, { 'X-View-Claim': '1' });
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      urlRef.current = u; setUrl(u); setMime(blob.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'));
      setState('open');
    } catch (e) {
      setState(e && (e.status === 410 || e.status === 404) ? 'gone' : 'error');
    }
  };

  const icon = kind === 'video' ? '🎬' : '📷';
  const what = kind === 'video' ? t('Video', 'فيديو') : t('Photo', 'صورة');
  const badge = mode === 'timer' ? `⏱ ${secs}${ar ? 'ث' : 's'}` : '①';
  let label;
  if (mine) label = attachment.consumed ? t('Opened', 'تم الفتح') : t('Not opened yet', 'لم تُفتح بعد');
  else if (state === 'gone') label = shield ? t('Closed — the screen lost focus', 'اتقفلت — الصفحة فقدت التركيز') : t('Opened', 'تم الفتح');
  else if (state === 'loading') label = t('Opening…', 'جارٍ الفتح…');
  else if (state === 'error') label = t('Could not open — tap to retry', 'تعذّر الفتح — اضغط للمحاولة');
  else label = t('Tap to view', 'اضغط للعرض');

  const disabled = mine || state === 'gone' || state === 'loading';
  const mark = who ? `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='170'><text x='20' y='95' transform='rotate(-25 130 85)' font-family='sans-serif' font-size='17' font-weight='700' fill='white' fill-opacity='0.28'>${who.replace(/[<>&'"]/g, '')}</text></svg>`)}")` : 'none';
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => { if (state === 'error') setState('idle'); setTimeout(open, 0); }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, border: '2px dashed #4f46e5', borderRadius: 14, background: '#ffffff', color: '#111827', padding: '12px 16px', cursor: disabled ? 'default' : 'pointer', minWidth: 190, textAlign: 'start', font: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,.15)' }}>
        <span style={{ fontSize: 22 }} aria-hidden="true">{state === 'gone' ? '🚫' : icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{what} · {badge}</strong>
          <span style={{ fontSize: 13, fontWeight: 600, color: state === 'gone' || mine ? '#4b5563' : '#4f46e5' }}>{label}</span>
        </span>
      </button>
      {state === 'open' && createPortal(
        <div role="dialog" aria-modal="true" onContextMenu={(e) => e.preventDefault()}
          style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh', background: '#000', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
          {kind === 'video' || mime.startsWith('video/')
            ? <video src={url} autoPlay playsInline controls controlsList="nodownload noremoteplayback" disablePictureInPicture style={{ maxWidth: '100%', maxHeight: '100%' }} />
            : <img src={url} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'none' }} />}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: mark, backgroundRepeat: 'repeat' }} />
          {mode === 'timer' && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: 'rgba(255,255,255,.2)' }}>
              <div style={{ height: '100%', width: `${Math.max(0, (left / (secs || 10)) * 100)}%`, background: '#e53e6b', transition: 'width 1s linear' }} />
            </div>
          )}
          <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', pointerEvents: 'none' }}>
            <span style={{ background: 'rgba(0,0,0,.55)', borderRadius: 999, padding: '4px 12px', fontWeight: 700 }}>{mode === 'timer' ? `⏱ ${Math.max(0, left)}` : t('View once', 'مرة واحدة')}</span>
            <button type="button" onClick={close} aria-label={t('Close', 'إغلاق')}
              style={{ pointerEvents: 'auto', border: 0, borderRadius: '50%', width: 40, height: 40, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
