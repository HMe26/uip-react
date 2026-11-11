import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { initials, avatarUrl } from '../messaging/format';
import { useLanguage } from '../../context/LanguageContext';
import { useCall } from '../../context/callCtx';
import { fmtCallDuration } from '../../lib/calls/callText';
import { FILTER_LIST, supportsVideoFx } from '../../lib/calls/videoFx';

/**
 * The call screens, rendered once by <CallProvider> into document.body:
 *   - incoming card (rings on every page)
 *   - full call screen: starting / calling / connecting / active, with mute + hang up + minimise
 *     (video calls: remote video + self-view, camera on/off, switch camera, share screen, filters, noise cancellation)
 *   - floating pill when minimised
 *   - end-of-call toast (declined, no answer, mic blocked, …)
 */

function CallAvatar({ peer, size }) {
  const [failed, setFailed] = useState(false);
  const url = !failed ? avatarUrl(peer && peer.avatar) : null;
  return (
    <span className={`call-avatar call-avatar--${size || 'lg'}`}>
      {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : initials(peer && peer.name)}
    </span>
  );
}

/** Blurred, darkened copy of the peer's photo behind the whole call screen (falls back to the brand gradient when there is no photo). */
function CallBackdrop({ peer }) {
  const url = avatarUrl(peer && peer.avatar);
  return (
    <div className="call-backdrop" aria-hidden="true">
      {url && <span className="call-backdrop__img" style={{ backgroundImage: `url("${url}")` }} />}
      <span className="call-backdrop__glow" />
    </div>
  );
}

/** Avatar with soft expanding rings (calling / ringing) or a calm live halo (connected). */
function CallRings({ peer, size, ringing, live }) {
  return (
    <div className={`call-rings${ringing ? ' is-ringing' : ''}${live ? ' is-live' : ''}`}>
      <i /><i /><i />
      <CallAvatar peer={peer} size={size || 'xl'} />
    </div>
  );
}

function useElapsed(startedAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
}

function QualityBars({ quality, ar }) {
  const n = quality === 'poor' ? 1 : quality === 'fair' ? 2 : 3;
  const label = quality === 'poor' ? (ar ? 'اتصال ضعيف' : 'Poor connection') : quality === 'fair' ? (ar ? 'اتصال متوسط' : 'Fair connection') : (ar ? 'اتصال جيد' : 'Good connection');
  return (
    <span className={`call-quality call-quality--${quality}`} title={label} aria-label={label} role="img">
      {[1, 2, 3].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
    </span>
  );
}

/** A <video> bound to a MediaStream (srcObject can't be set from JSX). The peer's sound plays from the provider's <audio>, so this is muted. */
function StreamVideo({ stream, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (el.srcObject !== (stream || null)) el.srcObject = stream || null;
    const play = () => { const p = el.play(); if (p && p.catch) p.catch(() => {}); };
    if (stream) play();
    // Some browsers/WebViews leave the element black if play() ran before the first frame: nudge it once metadata / data arrives.
    el.addEventListener('loadedmetadata', play);
    el.addEventListener('canplay', play);
    const tracks = stream && stream.getVideoTracks ? stream.getVideoTracks() : [];
    tracks.forEach((t) => { try { t.addEventListener('unmute', play); } catch { /* ignore */ } });
    // Watchdog: a <video> can silently stop painting (decoder hiccup, two windows on one camera) while the track itself is fine.
    // If the playback clock stands still for ~3 s, or the element got paused, re-attach the stream and play again.
    let last = -1;
    let still = 0;
    const dog = stream ? setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const live = tracks.some((t) => t.readyState === 'live');
      if (!live) return;
      if (el.paused) { play(); return; }
      if (el.currentTime === last) still += 1; else still = 0;
      last = el.currentTime;
      if (still >= 3) {
        still = 0;
        try { el.srcObject = null; el.srcObject = stream; } catch { /* ignore */ }
        play();
      }
    }, 1500) : 0;
    return () => {
      if (dog) clearInterval(dog);
      el.removeEventListener('loadedmetadata', play);
      el.removeEventListener('canplay', play);
      tracks.forEach((t) => { try { t.removeEventListener('unmute', play); } catch { /* ignore */ } });
    };
  }, [stream]);
  return <video ref={ref} className={className} data-persist-media="1" autoPlay playsInline muted />;
}

const debugOn = () => {
  try { return localStorage.getItem('uip.call.debug') === '1' || /[?&]calldebug\b/.test(window.location.search); } catch { return false; }
};

/** Developer panel (enable: localStorage.setItem('uip.call.debug','1') or add ?calldebug to the URL): shows what really flows. */
function DebugPanel({ c }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const r = await c.getDiagnostics(); if (alive) setD(r); } catch { /* ignore */ } };
    tick();
    const h = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(h); };
  }, [c]);
  if (!d) return null;
  const kb = (n) => `${Math.round((n || 0) / 1024)}KB`;
  return (
    <pre className="call-debug" dir="ltr">
      {`conn ${d.conn} / ice ${d.ice}\n`}
      {`path ${d.path ? `${d.path.local}→${d.path.remote} ${d.path.protocol} rtt ${Math.round(d.path.rtt * 1000)}ms` : 'none'}  TURN ${d.turnConfigured ? 'yes' : 'NO'}\n`}
      {`audio in ${kb(d.audio.in)} out ${kb(d.audio.out)} lost ${d.audio.lost}\n`}
      {`mic level ${(d.audio.micLevel * 100).toFixed(0)}%  incoming level ${(d.audio.inLevel * 100).toFixed(0)}%\n`}
      {`video in ${kb(d.video.in)} out ${kb(d.video.out)} frames ${d.video.frames}\n`}
      {`recoveries ${d.recoveries}`}
    </pre>
  );
}

/** Effects bottom sheet: noise cancellation (all calls) + filters (video calls, where the browser can draw them). */
function EffectsPanel({ c, ar, t, onClose }) {
  const fxOk = c.callType === 'video' && supportsVideoFx();
  const camReady = c.camOn && !c.sharing;
  const amount = c.filterAmount == null ? 100 : c.filterAmount;
  return (
    <>
      <div className="cx-scrim" onClick={onClose} aria-hidden="true" />
      <div className="cx-sheet" role="dialog" aria-label={t('Call effects', 'مؤثرات المكالمة')}>
        <span className="cx-grab" aria-hidden="true" />
        <div className="cx-head">
          <strong>{t('Effects', 'المؤثرات')}</strong>
          <button type="button" className="cx-close" onClick={onClose} aria-label={t('Close', 'إغلاق')}><Icon name="x" size={16} /></button>
        </div>
        <button type="button" role="switch" aria-checked={c.noiseOn} className={`cx-noise${c.noiseOn ? ' is-on' : ''}`} onClick={() => c.setNoise(!c.noiseOn)}>
          <span className="cx-noise__ico"><Icon name="audio-wave" size={18} /></span>
          <span className="cx-noise__txt">
            <strong>{t('Noise cancellation', 'إلغاء الضوضاء')}</strong>
            <span>{t('Reduces background noise and echo', 'يقلل ضوضاء الخلفية والصدى')}</span>
          </span>
          <i className="cx-switch" aria-hidden="true" />
        </button>
        {fxOk && (
          <>
            <p className="cx-label">{t('Video filters', 'فلاتر الفيديو')}</p>
            <div className="cx-filters" role="radiogroup" aria-label={t('Video filters', 'فلاتر الفيديو')}>
              {FILTER_LIST.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={c.filter === f.id} className={`cx-flt${c.filter === f.id ? ' is-on' : ''}`}
                  onClick={() => c.setFilter(f.id)} disabled={!camReady}>
                  <span className="cx-flt__sw" style={{ background: f.sw }} aria-hidden="true" />
                  <span className="cx-flt__name">{ar ? f.ar : f.en}</span>
                </button>
              ))}
            </div>
            {c.filter !== 'none' && camReady && (
              <label className="cx-range">
                <span>{t('Intensity', 'الشدة')}</span>
                <input type="range" min="0" max="100" step="1" value={amount} onChange={(e) => c.setFilterAmount(Number(e.target.value))} aria-label={t('Filter intensity', 'شدة الفلتر')} />
                <output>{amount}%</output>
              </label>
            )}
            {!camReady && <p className="cx-hint">{c.sharing ? t('Filters apply to the camera, not a shared screen.', 'الفلاتر تعمل على الكاميرا فقط وليس على مشاركة الشاشة.') : t('Turn the camera on to use filters.', 'شغّل الكاميرا لاستخدام الفلاتر.')}</p>}
          </>
        )}
      </div>
    </>
  );
}

/** One control of the video-call dock: round glass button with a small label underneath. */
function CvBtn({ icon, label, on, onClick, disabled, pressed }) {
  return (
    <button type="button" className={`cv-btn${on ? ' is-on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-label={label} title={label}>
      <span className="cv-btn__ico"><Icon name={icon} size={22} /></span>
      <span className="cv-btn__lbl">{label}</span>
    </button>
  );
}

function noticeText(n, ar) {
  const name = n.name || (ar ? 'المستخدم' : 'The user');
  switch (n.kind) {
    case 'ended': return ar ? `انتهت المكالمة · ${fmtCallDuration(n.duration)}` : `Call ended · ${fmtCallDuration(n.duration)}`;
    case 'declined': return ar ? `${name} رفض المكالمة` : `${name} declined the call`;
    case 'noanswer': return ar ? `${name} لم يرد` : `${name} didn’t answer`;
    case 'busy': return ar ? `${name} مشغول في مكالمة أخرى` : `${name} is on another call`;
    case 'missed': return ar ? `مكالمة فائتة من ${name}` : `Missed call from ${name}`;
    case 'lost': return ar ? 'انقطع الاتصال' : 'Connection lost';
    case 'failed': return ar ? 'تعذّر إتمام المكالمة' : 'The call couldn’t be completed';
    case 'mic_denied': return ar ? 'الميكروفون محظور. اسمح بالوصول إليه من إعدادات المتصفح ثم حاول مرة أخرى.' : 'Microphone access is blocked. Allow it in your browser settings and try again.';
    case 'mic_missing': return ar ? 'لم يتم العثور على ميكروفون.' : 'No microphone was found.';
    case 'mic_error': return ar ? 'تعذّر تشغيل الميكروفون.' : 'Couldn’t start the microphone.';
    case 'cam_denied': return ar ? 'الكاميرا أو الميكروفون محظور. اسمح بالوصول من إعدادات المتصفح ثم حاول مرة أخرى.' : 'Camera or microphone access is blocked. Allow it in your browser settings and try again.';
    case 'cam_missing': return ar ? 'لم يتم العثور على كاميرا أو ميكروفون.' : 'No camera or microphone was found.';
    case 'cam_error': return ar ? 'تعذّر تشغيل الكاميرا.' : 'Couldn’t start the camera.';
    case 'cam_switch': return ar ? 'لا توجد كاميرا أخرى متاحة للتبديل على هذا الجهاز.' : 'No other camera is available to switch to on this device.';
    case 'screen_error': return ar ? 'تعذّرت مشاركة الشاشة.' : 'Couldn’t share the screen.';
    case 'unsupported': return ar ? 'المكالمات تحتاج اتصالًا آمنًا (HTTPS) ومتصفحًا يدعمها.' : 'Calls need a secure (HTTPS) connection and a browser that supports them.';
    case 'unavailable': return ar ? 'هذه المكالمة لم تعد متاحة.' : 'This call is no longer available.';
    default: return n.message || (ar ? 'تعذّر بدء المكالمة.' : 'Couldn’t start the call.');
  }
}

export default function CallUI() {
  const c = useCall();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const secs = useElapsed(c.phase === 'active' ? c.startedAt : 0);
  const name = (c.peer && c.peer.name) || '';
  const inCall = ['starting', 'outgoing', 'connecting', 'active'].includes(c.phase);
  const isVideo = c.callType === 'video';
  const [fxOpen, setFxOpen] = useState(false);
  const screenRef = useRef(null);
  const [uiOn, setUiOn] = useState(true);
  const hideTimer = useRef(0);
  const fxOpenRef = useRef(false);
  fxOpenRef.current = fxOpen;
  // video call: the bars fade away a few seconds after the last touch / mouse move so the picture is the whole screen
  const poke = () => {
    setUiOn(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!fxOpenRef.current) setUiOn(false); }, 5000);
  };
  useEffect(() => {
    if (inCall && c.callType === 'video' && c.phase === 'active') poke(); else { clearTimeout(hideTimer.current); setUiOn(true); }
    return () => clearTimeout(hideTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCall, c.callType, c.phase]);
  const live = c.phase === 'connecting' || c.phase === 'active';
  const canShare = isVideo && typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
    && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); // phones can't pick a screen to share
  useEffect(() => { if (!inCall) setFxOpen(false); }, [inCall]);
  const toggleFullscreen = () => {
    const el = screenRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    } catch { /* not supported */ }
  };

  const statusText = (() => {
    if (c.phase === 'starting') return t('Starting…', 'جارٍ البدء…');
    if (c.phase === 'outgoing') return t('Calling…', 'جارٍ الاتصال…');
    if (c.reconnecting) return t('Reconnecting…', 'جارٍ إعادة الاتصال…');
    if (c.phase === 'connecting') return isVideo ? t('Connecting…', 'جارٍ الاتصال…') : t('Connecting…', 'جارٍ الاتصال بالصوت…');
    return fmtCallDuration(secs);
  })();

  // Escape never hangs up (too easy to hit by accident); keyboard users use the buttons.
  const toast = c.notice ? (
    <div className={`call-toast${c.notice.kind === 'ended' ? '' : ' is-warn'}`} role="status" aria-live="polite">
      <Icon name={c.notice.kind === 'ended' ? 'phone' : 'info'} size={16} />
      <span>{noticeText(c.notice, ar)}</span>
      <button type="button" className="call-toast__x" onClick={c.dismissNotice} aria-label={t('Dismiss', 'إغلاق')}><Icon name="x" size={14} /></button>
    </div>
  ) : null;

  const soundBanner = c.audioBlocked && inCall ? (
    <button type="button" className="call-soundfix" onClick={c.resumeAudio}>
      <Icon name="phone" size={16} /> {t('Tap to enable call sound', 'اضغط لتشغيل صوت المكالمة')}
    </button>
  ) : null;
  const debugPanel = inCall && debugOn() ? <DebugPanel c={c} /> : null;

  let body = null;

  if (c.phase === 'incoming') {
    const kindLabel = isVideo ? t('Incoming video call', 'مكالمة فيديو واردة') : t('Incoming voice call', 'مكالمة صوتية واردة');
    const acceptLabel = isVideo ? t('Answer with video', 'الرد بالفيديو') : t('Accept', 'رد');
    body = (
      <div className="call-ring" role="alertdialog" aria-label={t('Incoming call', 'مكالمة واردة')}>
        <div className="call-ring__card">
          <CallBackdrop peer={c.peer} />
          <span className="call-ring__kind"><Icon name={isVideo ? 'video' : 'phone'} size={14} /> {kindLabel}</span>
          <CallRings peer={c.peer} size="xl" ringing={!c.accepting} />
          <strong className="call-ring__name" dir="auto">{name}</strong>
          <span className="call-ring__sub" aria-live="polite">{c.accepting ? t('Connecting…', 'جارٍ الاتصال…') : t('is calling you…', 'يتصل بك…')}</span>
          <div className="call-ring__btns">
            <div className="call-ctl">
              <button type="button" className="call-btn call-btn--end call-btn--lg" onClick={c.decline} disabled={c.accepting} aria-label={t('Decline', 'رفض')} title={t('Decline', 'رفض')}>
                <Icon name="phone" size={26} />
              </button>
              <span>{t('Decline', 'رفض')}</span>
            </div>
            {isVideo && (
              <div className="call-ctl">
                <button type="button" className="call-btn call-btn--lg call-btn--alt" onClick={() => c.accept({ video: false })} disabled={c.accepting} aria-label={t('Answer with audio only', 'الرد بالصوت فقط')} title={t('Answer with audio only', 'الرد بالصوت فقط')}>
                  <Icon name="phone" size={24} />
                </button>
                <span>{t('Audio only', 'صوت فقط')}</span>
              </div>
            )}
            <div className="call-ctl">
              <button type="button" className="call-btn call-btn--accept call-btn--lg" onClick={() => c.accept()} disabled={c.accepting} aria-label={acceptLabel} title={acceptLabel}>
                <Icon name={isVideo ? 'video' : 'phone'} size={26} />
              </button>
              <span>{acceptLabel}</span>
            </div>
          </div>
        </div>
      </div>
    );

  } else if (inCall && c.minimized) {
    body = (
      <div className="call-pill" role="group" aria-label={t('Call in progress', 'مكالمة جارية')}>
        <button type="button" className="call-pill__main" onClick={() => c.setMinimized(false)} title={t('Open call', 'فتح المكالمة')}>
          <CallAvatar peer={c.peer} size="xs" />
          <span className="call-pill__txt"><strong dir="auto">{name}</strong><span>{statusText}</span></span>
        </button>
        <button type="button" className={`call-btn call-btn--sm call-btn--mute${c.muted ? ' is-on' : ''}`} onClick={c.toggleMute} aria-pressed={c.muted} aria-label={c.muted ? t('Unmute', 'إلغاء الكتم') : t('Mute', 'كتم')}>
          <Icon name={c.muted ? 'mic-off' : 'mic'} size={16} />
        </button>
        <button type="button" className="call-btn call-btn--sm call-btn--end" onClick={c.hangup} aria-label={t('End call', 'إنهاء المكالمة')}>
          <Icon name="phone" size={16} />
        </button>
      </div>
    );
  } else if (inCall && isVideo) {
    const showRemote = c.phase === 'active' && c.peerCam && c.remoteVideo;
    const showSelfBig = !showRemote && c.camOn && c.localVideo && c.phase !== 'active'; // preview while ringing/connecting
    const showPip = (c.camOn || c.sharing) && c.localVideo && !showSelfBig;
    const mirrorSelf = c.facing === 'user' && !c.sharing;
    const canFlip = c.canSwitchCam && c.camOn && !c.sharing;
    const ending = c.phase === 'outgoing' || c.phase === 'starting';
    body = (
      <div className={`call-screen call-screen--video cv${uiOn || fxOpen ? '' : ' is-idle'}`} ref={screenRef} role="dialog" aria-modal="false" aria-label={t('Video call', 'مكالمة فيديو')}
        onPointerDown={poke} onPointerMove={() => { if (!uiOn) poke(); }}>
        <div className="call-vstage">
          {showRemote && <StreamVideo className={`call-vremote${c.peerSharing ? ' is-contain' : ''}`} stream={c.remoteVideo} />}
          {showSelfBig && <StreamVideo className={`call-vremote call-vremote--self${mirrorSelf ? ' is-mirror' : ''}`} stream={c.localVideo} />}
          {!showRemote && (
            <div className={`call-vplaceholder${showSelfBig ? ' is-over' : ''}`}>
              <CallRings peer={c.peer} size="xl" ringing={c.phase === 'outgoing' || c.phase === 'connecting'} />
              {c.phase === 'active' && !c.peerCam && <p className="call-screen__peermuted"><Icon name="video-off" size={14} /> {t(`${name || 'They'} turned their camera off`, `${name || 'الطرف الآخر'} أوقف الكاميرا`)}</p>}
            </div>
          )}
        </div>

        <div className="cv-top">
          <button type="button" className="cv-round" onClick={() => c.setMinimized(true)} aria-label={t('Minimise', 'تصغير')} title={t('Minimise', 'تصغير')}>
            <Icon name="chevron-down" size={20} />
          </button>
          <div className="cv-chip" aria-live="polite">
            <strong dir="auto">{name}</strong>
            <span className="cv-chip__sub">
              {c.phase === 'active' && <QualityBars quality={c.reconnecting ? 'poor' : c.quality} ar={ar} />}
              <span className={c.phase === 'active' && !c.reconnecting ? 'is-timer' : ''}>{statusText}</span>
              {c.peerMuted && c.phase === 'active' && <span className="cv-chip__muted"><Icon name="mic-off" size={12} /></span>}
            </span>
          </div>
          <button type="button" className="cv-round" onClick={toggleFullscreen} aria-label={t('Full screen', 'ملء الشاشة')} title={t('Full screen', 'ملء الشاشة')}>
            <Icon name="maximize" size={17} />
          </button>
        </div>

        {showPip && (
          <div className="cv-pip">
            <StreamVideo className={`cv-pip__v${mirrorSelf ? ' is-mirror' : ''}`} stream={c.localVideo} />
            {canFlip && (
              <button type="button" className="cv-pip__flip" onClick={c.switchCamera} disabled={!live} aria-label={t('Switch camera', 'تبديل الكاميرا')} title={t('Switch camera', 'تبديل الكاميرا')}>
                <Icon name="camera-flip" size={16} />
              </button>
            )}
          </div>
        )}
        {c.sharing && <div className="call-vbadge"><Icon name="screen-share" size={14} /> {t('You are sharing your screen', 'أنت تشارك شاشتك')}</div>}
        {fxOpen && <EffectsPanel c={c} ar={ar} t={t} onClose={() => setFxOpen(false)} />}

        <div className="cv-dock">
          <div className="cv-bar" role="toolbar" aria-label={t('Call controls', 'أزرار المكالمة')}>
            <CvBtn icon={c.muted ? 'mic-off' : 'mic'} label={c.muted ? t('Unmute', 'تشغيل') : t('Mute', 'كتم')} on={c.muted} pressed={c.muted} onClick={c.toggleMute} disabled={c.phase === 'starting'} />
            <CvBtn icon={c.camOn ? 'video' : 'video-off'} label={c.camOn ? t('Camera', 'الكاميرا') : t('Camera off', 'مغلقة')} on={!c.camOn} pressed={!c.camOn} onClick={c.toggleCamera} disabled={!live || c.sharing} />
            {canFlip && <CvBtn icon="camera-flip" label={t('Flip', 'تبديل')} onClick={c.switchCamera} disabled={!live} />}
            {canShare && <CvBtn icon="screen-share" label={c.sharing ? t('Stop', 'إيقاف') : t('Share', 'مشاركة')} on={c.sharing} pressed={c.sharing} onClick={c.toggleScreenShare} disabled={!live} />}
            <CvBtn icon="ai-spark" label={t('Effects', 'مؤثرات')} on={fxOpen} pressed={fxOpen} onClick={() => setFxOpen((v) => !v)} />
          </div>
          <button type="button" className="cv-end" onClick={c.hangup} aria-label={ending ? t('Cancel call', 'إلغاء المكالمة') : t('End call', 'إنهاء المكالمة')}>
            <Icon name="phone" size={22} />
            <span>{ending ? t('Cancel', 'إلغاء') : t('End', 'إنهاء')}</span>
          </button>
        </div>
      </div>
    );
  } else if (inCall) {
    body = (
      <div className="call-screen" role="dialog" aria-modal="false" aria-label={t('Voice call', 'مكالمة صوتية')}>
        <CallBackdrop peer={c.peer} />
        <span className="call-screen__kind"><Icon name="phone" size={13} /> {t('Voice call', 'مكالمة صوتية')}</span>
        <button type="button" className="call-screen__min" onClick={() => c.setMinimized(true)} aria-label={t('Minimise', 'تصغير')} title={t('Minimise', 'تصغير')}>
          <Icon name="chevron-down" size={22} />
        </button>
        <div className="call-screen__center">
          <CallRings peer={c.peer} size="xl" ringing={c.phase === 'outgoing' || c.phase === 'connecting'} live={c.phase === 'active' && !c.reconnecting} />
          <h2 dir="auto">{name}</h2>
          <p className="call-screen__status" aria-live="polite">
            {c.phase === 'active' && <QualityBars quality={c.reconnecting ? 'poor' : c.quality} ar={ar} />}
            <span className={c.phase === 'active' && !c.reconnecting ? 'is-timer' : ''}>{statusText}</span>
          </p>
          {c.peerMuted && c.phase === 'active' && (
            <p className="call-screen__peermuted"><Icon name="mic-off" size={14} /> {t(`${name || 'They'} muted their microphone`, `${name || 'الطرف الآخر'} كتم الميكروفون`)}</p>
          )}
        </div>
        <div className="call-screen__controls">
          <div className="call-ctl">
            <button type="button" className={`call-btn call-btn--mute${c.muted ? ' is-on' : ''}`} onClick={c.toggleMute} aria-pressed={c.muted} aria-label={c.muted ? t('Unmute', 'إلغاء الكتم') : t('Mute', 'كتم')} disabled={c.phase === 'starting'}>
              <Icon name={c.muted ? 'mic-off' : 'mic'} size={24} />
            </button>
            <span>{c.muted ? t('Unmute', 'إلغاء الكتم') : t('Mute', 'كتم')}</span>
          </div>
          <div className="call-ctl">
            <button type="button" className={`call-btn${fxOpen ? ' call-btn--mute is-on' : ''}`} onClick={() => setFxOpen((v) => !v)} aria-expanded={fxOpen} aria-label={t('Effects', 'المؤثرات')} disabled={c.phase === 'starting'}>
              <Icon name="audio-wave" size={24} />
            </button>
            <span>{t('Effects', 'المؤثرات')}</span>
          </div>
          <div className="call-ctl">
            <button type="button" className="call-btn call-btn--end call-btn--lg" onClick={c.hangup} aria-label={c.phase === 'outgoing' || c.phase === 'starting' ? t('Cancel call', 'إلغاء المكالمة') : t('End call', 'إنهاء المكالمة')}>
              <Icon name="phone" size={26} />
            </button>
            <span>{c.phase === 'outgoing' || c.phase === 'starting' ? t('Cancel', 'إلغاء') : t('End', 'إنهاء')}</span>
          </div>
        </div>
        {fxOpen && <EffectsPanel c={c} ar={ar} t={t} onClose={() => setFxOpen(false)} />}
      </div>
    );
  }

  if (!body && !toast) return null;
  return createPortal(<div className="call-layer" dir={ar ? 'rtl' : 'ltr'}>{body}{soundBanner}{debugPanel}{toast}</div>, document.body);
}
