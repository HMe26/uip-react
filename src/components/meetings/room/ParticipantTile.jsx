import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TileReaction } from './ReactionFx';
import Icon from '../../Icon';
import VolumeBoost from '../../VolumeBoost';
import { avatarColor, useSpeaking } from './speaking';
import { useVolumeBoost } from '../../../lib/volumeBoost';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };


/**
 * One tile in the participant grid: a `<video>` bound to the local MediaStream or a peer's stream, an avatar when there is
 * nothing to show, a name chip, and (for hosts) the per-person menu.
 *
 * Presenting is independent of the camera: whoever is sharing their screen shows that video even if their camera is off
 * (`screenSharing` wins over `cameraEnabled`). Your OWN tile never plays back your screen (that would be the "hall of
 * mirrors" Meet avoids) — it shows a "you are presenting" card with a stop button instead.
 */
export default function ParticipantTile({
  stream, displayName, isHost, isGuest, micEnabled, cameraEnabled,
  screenSharing, connectionQuality, connectionState, isLocal, large,
  handRaised, reaction, screenShareAllowed, canManage, onAllowScreenShare, onDenyScreenShare, onResetScreenShare, onForceStopScreenShare,
  role, canPrimaryManage, onMute, onDisableCamera, onRemove, onPromote, onDemote, onMakeHost,
  onPin, pinned, onStopShare, speakersMuted,
}) {
  const videoRef = useRef(null);
  const vb = useVolumeBoost(videoRef, { stream });   // louder remote participants (never for your own mic)
  const t = useTranslations(translations);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);

  // The tile clips its children (rounded video), so the host menu is portalled into the room layer and placed beside the button.
  useLayoutEffect(() => {
    if (!menuOpen) { setMenuPos(null); return undefined; }
    const place = () => {
      const btn = menuBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const mh = menuRef.current?.offsetHeight || 260;
      const mw = menuRef.current?.offsetWidth || 230;
      const rtl = document.documentElement.dir === 'rtl';
      let left = rtl ? r.left : r.right - mw;
      left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
      let top = r.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
      setMenuPos({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    const close = (e) => {
      if (menuRef.current?.contains(e.target) || menuBtnRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', close, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); document.removeEventListener('pointerdown', close, true); };
  }, [menuOpen]);
  const [audioBlocked, setAudioBlocked] = useState(false); // browser refused autoplay-with-sound until the user interacts
  const speaking = useSpeaking(stream, micEnabled !== false);

  const initial = (displayName || '?').trim().charAt(0).toUpperCase() || '?';
  const presentingSelf = !!isLocal && !!screenSharing;
  const showVideo = !!stream && (isLocal ? cameraEnabled !== false : (!!screenSharing || cameraEnabled !== false));
  const poor = connectionState === 'disconnected' || connectionQuality === 'poor' || connectionQuality === 'reconnecting';

  // The <video> stays mounted even while the camera is off: it is also what plays this participant's VOICE.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    if (el.srcObject !== (stream || null)) el.srcObject = stream || null;
    el.muted = !!isLocal || !!speakersMuted; // your own tile must NEVER play your own mic (that is the echo you hear); "speakers off" silences everyone for same-room use
    if (!stream || isLocal) return undefined;
    el.volume = 1;
    const play = () => {
      const p = el.play();
      if (p && p.then) p.then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    };
    play();
    window.addEventListener('pointerdown', play, { once: true, capture: true });
    window.addEventListener('keydown', play, { once: true, capture: true });
    stream.addEventListener && stream.addEventListener('addtrack', play);
    return () => {
      setAudioBlocked(false);
      window.removeEventListener('pointerdown', play, true);
      window.removeEventListener('keydown', play, true);
      stream.removeEventListener && stream.removeEventListener('addtrack', play);
    };
  }, [stream, isLocal, speakersMuted]);

  const cls = ['meeting-tile'];
  if (pinned) cls.push('is-pinned');
  if (!showVideo) cls.push('is-no-video');
  if (speaking && micEnabled !== false) cls.push('is-speaking');
  if (screenSharing && !isLocal) cls.push('is-presenting');
  if (large) cls.push('is-large');

  return (
    <div className={cls.join(' ')}>
      {/* Always mounted (it also plays this person's VOICE). Hidden with opacity, not display:none, so browsers keep playing it. */}
      <video
        ref={videoRef}
        className="meeting-tile__video"
        autoPlay
        playsInline
        muted={isLocal}
        onDoubleClick={onPin}
        style={{
          objectFit: screenSharing && !isLocal ? 'contain' : 'cover',
          transform: isLocal ? 'scaleX(-1)' : 'none',
          opacity: showVideo ? 1 : 0,
        }}
      />

      {presentingSelf && !showVideo && (
        <div className="meeting-tile__presenting-card" onDoubleClick={onPin}>
          <span className="meeting-tile__presenting-icon"><Icon name="screen-share" size={30} /></span>
          <strong>{t('You are presenting your screen')}</strong>
          <span className="meeting-tile__presenting-hint">{t('Everyone in the meeting can see it, even with your camera off.')}</span>
          {onStopShare && (
            <button type="button" className="meeting-tile__stop-share" onClick={onStopShare}>
              <Icon name="stop" size={14} /> {t('Stop Sharing')}
            </button>
          )}
        </div>
      )}

      {!showVideo && !presentingSelf && (
        <div className="meeting-tile__avatar-wrap" onDoubleClick={onPin}>
          <div
            className="meeting-tile__avatar"
            style={{ width: large ? 112 : 72, height: large ? 112 : 72, fontSize: large ? 44 : 28, background: avatarColor(displayName) }}
          >
            {initial}
          </div>
        </div>
      )}

      {audioBlocked && !isLocal && (
        <button type="button" className="meeting-tile__enable-audio" onClick={() => { const el = videoRef.current; if (el) el.play().then(() => setAudioBlocked(false)).catch(() => {}); }}>
          <Icon name="volume" size={14} /> {t('Tap to enable sound')}
        </button>
      )}

      {reaction && (
        // keyed by the reaction id so every new reaction replays the pop (Web Animations: still visible when the platform's animations are off)
        <TileReaction key={reaction.id} reaction={reaction} />
      )}

      <div className="meeting-tile__badges">
        {pinned && (
          <span className="meeting-tile__badge" title={t('Pinned')}><Icon name="pin" size={12} /></span>
        )}
        {screenSharing && (
          <span className="meeting-tile__badge is-accent"><Icon name="screen-share" size={12} /> {t('Presenting')}</span>
        )}
        {handRaised && (
          <span className="meeting-tile__badge is-hand" title={t('Hand raised')}><Icon name="hand" size={12} /></span>
        )}
      </div>

      {!isLocal && connectionState && connectionState !== 'connected' && (
        <span className="meeting-tile__status">
          {connectionState === 'connecting' ? t('Connecting…') : connectionState === 'reconnecting' ? t('Reconnecting…') : t('Connection failed')}
        </span>
      )}

      <div className="meeting-tile__actions">
        {poor && !isLocal && connectionState === 'connected' && (
          <span className="meeting-tile__weak" title={t('Weak connection')}><Icon name="alert-triangle" size={13} /></span>
        )}
        {showVideo && !isLocal && <VolumeBoost vb={vb} variant="chip" />}
        {onPin && (
          <button type="button" className="meeting-tile__icon-btn meeting-tile__hover-only" onClick={onPin} title={pinned ? t('Unpin') : t('Pin')}>
            <Icon name="pin" size={14} />
          </button>
        )}
        {canManage && (
          <div style={{ position: 'relative' }}>
            <button ref={menuBtnRef} type="button" className="meeting-tile__icon-btn" onClick={() => setMenuOpen((v) => !v)} title={t('Host controls')}>
              <Icon name="more-horizontal" size={15} />
            </button>
            {menuOpen && createPortal(
              <div ref={menuRef} className="meeting-tile__host-menu is-floating" style={menuPos ? { top: menuPos.top, left: menuPos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
                {screenShareAllowed !== true && (
                  <button type="button" onClick={() => { onAllowScreenShare?.(); setMenuOpen(false); }}>{t('Allow screen sharing')}</button>
                )}
                {screenShareAllowed !== false && (
                  <button type="button" onClick={() => { onDenyScreenShare?.(); setMenuOpen(false); }}>{t('Disable screen sharing')}</button>
                )}
                {screenShareAllowed !== null && screenShareAllowed !== undefined && (
                  <button type="button" onClick={() => { onResetScreenShare?.(); setMenuOpen(false); }}>{t('Reset to meeting default')}</button>
                )}
                {screenSharing && (
                  <button type="button" onClick={() => { onForceStopScreenShare?.(); setMenuOpen(false); }}>{t("Stop this participant's screen share")}</button>
                )}
                {(onMute || onDisableCamera || onPromote || onDemote || onMakeHost || onRemove) && <div className="meeting-tile__menu-sep" />}
                {micEnabled && onMute && (
                  <button type="button" onClick={() => { onMute?.(); setMenuOpen(false); }}>{t('Mute')}</button>
                )}
                {cameraEnabled !== false && onDisableCamera && (
                  <button type="button" onClick={() => { onDisableCamera?.(); setMenuOpen(false); }}>{t('Turn off camera')}</button>
                )}
                {canPrimaryManage && role === 'participant' && onPromote && (
                  <button type="button" onClick={() => { onPromote?.(); setMenuOpen(false); }}>{t('Promote to moderator')}</button>
                )}
                {canPrimaryManage && role === 'co_host' && onDemote && (
                  <button type="button" onClick={() => { onDemote?.(); setMenuOpen(false); }}>{t('Remove moderator')}</button>
                )}
                {canPrimaryManage && onMakeHost && (
                  <button type="button" onClick={() => { onMakeHost?.(); setMenuOpen(false); }}>{t('Make host')}</button>
                )}
                {(canPrimaryManage || role !== 'co_host') && onRemove && (
                  <button type="button" className="is-danger" onClick={() => { onRemove?.(); setMenuOpen(false); }}>{t('Remove from meeting')}</button>
                )}
              </div>,
              menuBtnRef.current?.closest('.meeting-room') || document.body,
            )}
          </div>
        )}
      </div>

      <div className="meeting-tile__nameplate">
        <span className={`meeting-tile__mic ${micEnabled ? '' : 'is-off'}`}>
          <Icon name={micEnabled ? 'mic' : 'mic-off'} size={13} />
        </span>
        <span className="meeting-tile__name">{displayName}</span>
        {isHost && <Icon name="star" size={11} style={{ color: '#fbbf24', flexShrink: 0 }} />}
        {isGuest && <span className="meeting-tile__guest">{t('Guest')}</span>}
      </div>
    </div>
  );
}
