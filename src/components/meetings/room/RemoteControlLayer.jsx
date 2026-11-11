import { useCallback, useEffect, useRef } from 'react';
import Icon from '../../Icon';

/**
 * Remote control of a shared screen (Zoom-style). Rendered inside the spotlight, on top of the presenter's video.
 *  - Viewer, nobody controlling: "Request control" button.
 *  - Controller: a transparent overlay captures mouse + keyboard, maps the pointer to 0..1 coordinates inside the real video
 *    picture (not the letterbox), batches events every 50 ms and sends them through the server (which checks the grant).
 *  - Screen owner: an Allow / Deny prompt, and a banner with Stop while someone controls.
 */
export default function RemoteControlLayer({ room, myKey, presenter, t }) {
  const overlayRef = useRef(null);
  const bufferRef = useRef([]);
  const lastMoveRef = useRef(0);
  const rc = room.remoteControl;
  const iControl = !!rc && rc.controllerKey === myKey && !!presenter;
  const iAmControlled = !!rc && rc.targetKey === myKey;

  const flush = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    const events = bufferRef.current.splice(0, 40);
    room.sendRemoteInput(events);
  }, [room]);

  useEffect(() => {
    if (!iControl) return undefined;
    const id = setInterval(flush, 50);
    overlayRef.current?.focus();
    return () => { clearInterval(id); bufferRef.current = []; };
  }, [iControl, flush]);

  const norm = (e) => {
    const box = overlayRef.current;
    const video = box?.parentElement?.querySelector('video');
    if (!box || !video) return null;
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth || r.width;
    const vh = video.videoHeight || r.height;
    const scale = Math.min(r.width / vw, r.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    const left = r.left + (r.width - w) / 2;
    const top = r.top + (r.height - h) / 2;
    const x = (e.clientX - left) / w;
    const y = (e.clientY - top) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  };
  const push = (ev) => { bufferRef.current.push(ev); };

  const handlers = iControl ? {
    onMouseMove: (e) => {
      const now = performance.now();
      if (now - lastMoveRef.current < 40) return;
      lastMoveRef.current = now;
      const p = norm(e); if (p) push({ type: 'move', ...p });
    },
    onClick: (e) => { const p = norm(e); if (p) push({ type: 'click', ...p, button: 0 }); },
    onDoubleClick: (e) => { const p = norm(e); if (p) push({ type: 'dblclick', ...p, button: 0 }); },
    onContextMenu: (e) => { e.preventDefault(); const p = norm(e); if (p) push({ type: 'contextmenu', ...p, button: 2 }); },
    onWheel: (e) => { const p = norm(e); if (p) push({ type: 'wheel', ...p, dx: e.deltaX, dy: e.deltaY }); },
    onKeyDown: (e) => {
      e.preventDefault();
      push({ type: 'keydown', key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
    },
    onKeyUp: (e) => { e.preventDefault(); push({ type: 'keyup', key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey }); },
  } : {};

  const canAsk = presenter && !presenter.isLocal && !rc && room.rcPendingTarget !== presenter.key;
  const waiting = presenter && room.rcPendingTarget === presenter.key;
  const incoming = room.rcIncoming[0];

  return (
    <>
      {iControl && presenter && (
        <div ref={overlayRef} className="meeting-rc__overlay" tabIndex={0} {...handlers} aria-label={t('You are controlling the shared screen')} />
      )}

      <div className="meeting-rc__bar">
        {canAsk && (
          <button type="button" className="meeting-rc__btn" onClick={() => room.requestRemoteControl(presenter.key)}>
            <Icon name="monitor" size={14} /> {t('Request control')}
          </button>
        )}
        {waiting && <span className="meeting-rc__chip">{t('Waiting for approval…')}</span>}
        {iControl && (
          <span className="meeting-rc__chip is-live">
            <Icon name="monitor" size={14} /> {t('You are controlling the shared screen')}
            <button type="button" onClick={room.stopRemoteControl}>{t('Stop control')}</button>
          </span>
        )}
        {iAmControlled && (
          <span className="meeting-rc__chip is-live is-warn">
            <Icon name="shield" size={14} /> {rc.controllerName} {t('is controlling your screen')}
            <button type="button" onClick={room.stopRemoteControl}>{t('Stop control')}</button>
          </span>
        )}
        {room.rcNotice && (
          <span className="meeting-rc__chip" role="status" onClick={room.clearRcNotice}>
            {room.rcNotice === 'denied' ? t('Your control request was declined.')
              : room.rcNotice === 'stopped' ? t('Remote control ended.') : room.rcNotice}
          </span>
        )}
      </div>

      {incoming && (
        <div className="meeting-rc__modal" role="alertdialog" aria-modal="true">
          <div className="meeting-rc__card">
            <span className="meeting-rc__ico"><Icon name="monitor" size={22} /></span>
            <h3>{incoming.controllerName} {t('wants to control your screen')}</h3>
            <p>{t('They will be able to click, scroll and type in the UIPE page you are sharing (open in another tab). You can stop it at any time.')}</p>
            <div className="meeting-rc__actions">
              <button type="button" className="btn btn-outline" onClick={() => room.respondRemoteControl(incoming.controllerKey, false)}>{t('Deny')}</button>
              <button type="button" className="btn btn-primary" onClick={() => room.respondRemoteControl(incoming.controllerKey, true)}>{t('Allow control')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
