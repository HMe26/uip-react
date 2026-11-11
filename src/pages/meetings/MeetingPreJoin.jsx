import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Icon from '../../components/Icon';
import PublicTopbar from '../../components/PublicTopbar';
import MeetingRoomShell from '../../components/meetings/room/MeetingRoomShell';
import { useTranslations } from '../../context/LanguageContext';
import { portalPrefix } from '../../config/navConfig';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

const STATUS_POLL_MS = 3000;

/**
 * Round 2 (Lobby & Access, بند 3 — Join Meeting Experience/Pre-Join Screen،
 * بند 22 — Waiting Room من ناحية الداخل، بند 23 — Guest Access). Public
 * route (`/join/:joinToken`, uip.auth.optional on the backend so a Bearer
 * token — if one exists in localStorage — is still sent automatically by
 * the api client, but no login is required to reach this page).
 *
 * Talks to MeetingsLobbyApiController: GET .../info for preJoinInfo(),
 * POST .../verify-password (optional early check — requestAccess()
 * re-verifies it anyway, but this gives instant feedback instead of a
 * round-trip through the full join call), POST .../request
 * (requestAccess()), and GET .../request/{id}/status for the entrant-side
 * waiting-room poll.
 *
 * The actual meeting room (video grid, WebRTC) doesn't exist yet — that's
 * Round 3-4. Once admitted, a signed-in user with a portal is sent to the
 * existing Meeting Details page (which now shows them in Participants); a
 * guest — who has no portal to send them to — sees a plain confirmation
 * screen instead, holding onto the guest_token this call issued (Round 3's
 * signaling group needs it) in sessionStorage keyed by the join token.
 */
/**
 * The actor key the server uses for a guest is `guest:<join_request_id>` (MeetingSignalingService::resolveActor), and that id is
 * inside the guest token (a JWT). The old code used `guest:<whole token>`, so presence / WebRTC signalling / "is this message mine"
 * never matched the server's key for guests.
 */
function guestKeyFromToken(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))));
    if (json && json.join_request_id) return `guest:${json.join_request_id}`;
  } catch { /* fall through */ }
  return `guest:${token}`;
}

function readSaved(key) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
function clearSavedGuest(joinToken) {
  try {
    sessionStorage.removeItem(`uip_meeting_guest_token_${joinToken}`);
    sessionStorage.removeItem(`uip_meeting_guest_name_${joinToken}`);
  } catch { /* storage blocked: nothing to clear */ }
}

export default function MeetingPreJoin() {
  const { joinToken } = useParams();
  const t = useTranslations(translations);
  const { user, status: authStatus } = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState('loading'); // loading | error | unavailable | password | prejoin | waiting | admitted | rejected
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // password gate
  const [password, setPassword] = useState('');
  const [passwordChecking, setPasswordChecking] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordVerified, setPasswordVerified] = useState(false);

  // device test
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const meterRef = useRef(null);
  const rafRef = useRef(null);
  const [devices, setDevices] = useState({ cameras: [], microphones: [], speakers: [] });
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const [speakerId, setSpeakerId] = useState('');
  const [cameraEnabled, setCameraEnabled] = useState(false); // join with camera + mic off by default
  const [micEnabled, setMicEnabled] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [displayName, setDisplayName] = useState('');

  // submit / waiting
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [waitingRequestId, setWaitingRequestId] = useState(null);
  const [guestToken, setGuestToken] = useState(null);

  // ---- load pre-join info -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/meetings/join/${encodeURIComponent(joinToken)}/info`)
      .then((json) => {
        if (cancelled) return;
        const data = json?.data;
        if (!data) throw new Error(t('Could not load the meeting. Please try again.'));
        setInfo(data);
        // Hard refresh while inside the room: the guest token (and name) live in sessionStorage, so go straight back in instead of
        // asking for the name / device check / host approval again. Only for guests (the name key is saved on the guest path only).
        const savedToken = readSaved(`uip_meeting_guest_token_${joinToken}`);
        const savedName = readSaved(`uip_meeting_guest_name_${joinToken}`);
        if (savedToken && savedName) {
          if (data.meeting?.status === 'ended' || data.meeting?.status === 'cancelled') {
            clearSavedGuest(joinToken);
          } else {
            setGuestToken(savedToken);
            setDisplayName(savedName);
            setPhase('admitted');
            return;
          }
        }
        if (!data.joinable) {
          setPhase('unavailable');
        } else if (data.requires_password) {
          setPhase('password');
        } else {
          setPhase('prejoin');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(errorMessage(err));
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [joinToken]);

  // ---- device test: acquire stream + enumerate devices ---------------
  useEffect(() => {
    if (phase !== 'prejoin') return undefined;

    let cancelled = false;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMediaError(t("This browser can't access a camera or microphone."));
      return undefined;
    }

    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        startMeter(stream);
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((list) => {
        if (cancelled || !list) return;
        const cameras = list.filter((d) => d.kind === 'videoinput');
        const microphones = list.filter((d) => d.kind === 'audioinput');
        const speakers = list.filter((d) => d.kind === 'audiooutput');
        setDevices({ cameras, microphones, speakers });
        if (cameras[0]) setCameraId(cameras[0].deviceId);
        if (microphones[0]) setMicrophoneId(microphones[0].deviceId);
        if (speakers[0]) setSpeakerId(speakers[0].deviceId);
      })
      .catch(() => {
        if (!cancelled) setMediaError(t('Camera/microphone access was denied. You can still join with them off.'));
      });

    return () => {
      cancelled = true;
      stopMeter();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Reflect the enabled/disabled toggles onto the live tracks.
  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((tr) => { tr.enabled = cameraEnabled; });
  }, [cameraEnabled]);
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((tr) => { tr.enabled = micEnabled; });
  }, [micEnabled]);

  function startMeter(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        if (meterRef.current) {
          meterRef.current.style.width = `${Math.min(100, (avg / 160) * 100)}%`;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Non-fatal — the level meter is a nicety, not a blocker.
    }
  }

  function stopMeter() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  async function switchDevice(kind, deviceId) {
    if (kind === 'camera') setCameraId(deviceId);
    if (kind === 'microphone') setMicrophoneId(deviceId);
    if (kind === 'speaker') { setSpeakerId(deviceId); return; }

    // Re-acquire the stream against the newly chosen camera/microphone so
    // the preview + level meter reflect the actual selected device.
    try {
      const constraints = {
        video: { deviceId: kind === 'camera' ? { exact: deviceId } : (cameraId ? { exact: cameraId } : true) },
        audio: { deviceId: kind === 'microphone' ? { exact: deviceId } : (microphoneId ? { exact: microphoneId } : true) },
      };
      const next = await navigator.mediaDevices.getUserMedia(constraints);
      stopMeter();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = next;
      if (videoRef.current) videoRef.current.srcObject = next;
      next.getVideoTracks().forEach((tr) => { tr.enabled = cameraEnabled; });
      next.getAudioTracks().forEach((tr) => { tr.enabled = micEnabled; });
      startMeter(next);
    } catch {
      setMediaError(t('Camera/microphone access was denied. You can still join with them off.'));
    }
  }

  // ---- password gate ---------------------------------------------------
  async function handleUnlock(e) {
    e.preventDefault();
    setPasswordChecking(true);
    setPasswordError(null);
    try {
      const json = await api.post(`/api/v1/meetings/join/${encodeURIComponent(joinToken)}/verify-password`, { password });
      if (json.data?.valid) {
        setPasswordVerified(true);
        setPhase('prejoin');
      } else {
        setPasswordError(t('Incorrect password.'));
      }
    } catch (err) {
      setPasswordError(errorMessage(err));
    } finally {
      setPasswordChecking(false);
    }
  }

  // ---- submit join request ---------------------------------------------
  async function handleJoin(e) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const json = await api.post(`/api/v1/meetings/join/${encodeURIComponent(joinToken)}/request`, {
        password: info?.requires_password ? password : undefined,
        display_name: !info?.is_authenticated ? displayName.trim() : undefined,
        device_preferences: {
          mic_enabled: micEnabled,
          camera_enabled: cameraEnabled,
          microphone_id: microphoneId || undefined,
          camera_id: cameraId || undefined,
          speaker_id: speakerId || undefined,
        },
      });

      stopMeter();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;

      if (!json?.data) throw new Error(t('Could not join right now. Please try again.'));
      if (json.data.status === 'admitted') {
        handleAdmitted(json.data.guest_token);
      } else {
        setWaitingRequestId(json.data.request_id);
        if (json.data.guest_token) setGuestToken(json.data.guest_token);
        setPhase('waiting');
      }
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleAdmitted(newGuestToken) {
    const token = newGuestToken || guestToken;
    if (authStatus === 'authenticated' && user?.role) {
      if (token) sessionStorage.setItem(`uip_meeting_guest_token_${joinToken}`, token);
      navigate(`/${portalPrefix(user.role)}/meetings/${info.meeting.uuid}`, { replace: true });
      return;
    }
    if (token) {
      sessionStorage.setItem(`uip_meeting_guest_token_${joinToken}`, token);
      if (displayName.trim()) sessionStorage.setItem(`uip_meeting_guest_name_${joinToken}`, displayName.trim());
      // a guest who was let straight in (no waiting room) never went through setGuestToken — without it the room opened with
      // no identity and showed "You haven't joined this meeting yet".
      setGuestToken(token);
    }
    setPhase('admitted');
  }

  // ---- waiting room poll -------------------------------------------------
  useEffect(() => {
    if (phase !== 'waiting' || !waitingRequestId) return undefined;
    let cancelled = false;

    const poll = () => {
      const qs = guestToken ? `?guest_token=${encodeURIComponent(guestToken)}` : '';
      api.get(`/api/v1/meetings/join/${encodeURIComponent(joinToken)}/request/${waitingRequestId}/status${qs}`)
        .then((json) => {
          if (cancelled || !json?.data) return;
          if (json.data.status === 'admitted') handleAdmitted();
          else if (json.data.status === 'rejected') setPhase('rejected');
        })
        .catch(() => {});
    };

    poll();
    const timer = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, waitingRequestId, guestToken]);

  // ------------------------------------------------------------------
  const unavailableReason = () => {
    if (!info) return t('This meeting is no longer available to join.');
    if (info.meeting.status === 'cancelled') return t('This meeting was cancelled.');
    if (info.meeting.status === 'ended') return t('This meeting has ended.');
    return t('This meeting is locked by the host.');
  };

  return (
    <div className="public-wrap">
      <PublicTopbar />

      {phase === 'loading' && (
        <p className="text-small" style={{ textAlign: 'center' }}>{t('Loading…')}</p>
      )}

      {phase === 'error' && (
        <div className="card glass-panel" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <p className="text-h3">{t('This meeting link is invalid or has expired.')}</p>
          {loadError && <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{loadError}</p>}
          <Link to="/" className="btn btn-primary">{t('Back to My Meetings')}</Link>
        </div>
      )}

      {phase === 'unavailable' && info && (
        <div className="card glass-panel" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <h1 className="text-h2">{info.meeting.title}</h1>
          <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{unavailableReason()}</p>
        </div>
      )}

      {phase === 'password' && info && (
        <div className="card glass-panel" style={{ maxWidth: 420, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
            <Icon name="lock" size={28} />
            <h1 className="text-h3" style={{ margin: 'var(--space-2) 0 0' }}>{info.meeting.title}</h1>
            <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('This meeting is password protected')}</p>
          </div>
          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="form-group">
              <label className="form-label">{t('Password')}</label>
              <input
                className="form-input"
                type="password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Enter the meeting password to continue.')}</p>
            </div>
            {passwordError && <p className="form-error">{passwordError}</p>}
            <button type="submit" className="btn btn-primary" disabled={passwordChecking || !password}>
              {passwordChecking ? '…' : t('Unlock')}
            </button>
          </form>
        </div>
      )}

      {phase === 'prejoin' && info && (
        <div className="mtg-join">
          <div className="mtg-join__head">
            <h1>{info.meeting.title}</h1>
            <p>
              {info.host?.full_name ? `${t('Hosted by')} ${info.host.full_name} · ` : ''}
              {t('Check your camera and microphone, then join.')}
            </p>
          </div>

          <div className="mtg-join__grid">
            <div className="card glass-panel mtg-join__card">
              <div className="mtg-preview">
                <video ref={videoRef} autoPlay playsInline muted style={{ display: cameraEnabled ? 'block' : 'none' }} />
                {!cameraEnabled && (
                  <div className="mtg-preview__off">
                    <span className="mtg-preview__avatar">{(displayName || user?.full_name || '?').trim().charAt(0).toUpperCase() || '?'}</span>
                    <span>{t('Camera is off')}</span>
                  </div>
                )}
                <div className="mtg-preview__ctrls">
                  <button type="button" className={`mtg-ctrl ${micEnabled ? '' : 'is-off'}`} onClick={() => setMicEnabled((v) => !v)}
                    title={micEnabled ? t('Mute') : t('Unmute')} aria-label={micEnabled ? t('Mute') : t('Unmute')}>
                    <Icon name={micEnabled ? 'mic' : 'mic-off'} size={20} />
                  </button>
                  <button type="button" className={`mtg-ctrl ${cameraEnabled ? '' : 'is-off'}`} onClick={() => setCameraEnabled((v) => !v)}
                    title={cameraEnabled ? t('Turn camera off') : t('Turn camera on')} aria-label={cameraEnabled ? t('Turn camera off') : t('Turn camera on')}>
                    <Icon name={cameraEnabled ? 'video' : 'video-off'} size={20} />
                  </button>
                </div>
              </div>

              <div className="mtg-meter">
                <Icon name="mic" size={15} />
                <div className="mtg-meter__bar"><div ref={meterRef} /></div>
              </div>

              {mediaError && <p className="form-error" style={{ margin: 0 }}>{mediaError}</p>}

              {(devices.cameras.length > 0 || devices.microphones.length > 0) && (
                <div className="mtg-devices">
                  {devices.cameras.length > 0 && (
                    <div className="mtg-field">
                      <label>{t('Camera')}</label>
                      <select className="form-input" value={cameraId} onChange={(e) => switchDevice('camera', e.target.value)}>
                        {devices.cameras.map((d, i) => (
                          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t('Camera')} ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {devices.microphones.length > 0 && (
                    <div className="mtg-field">
                      <label>{t('Microphone')}</label>
                      <select className="form-input" value={microphoneId} onChange={(e) => switchDevice('microphone', e.target.value)}>
                        {devices.microphones.map((d, i) => (
                          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t('Microphone')} ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {devices.speakers.length > 0 && (
                    <div className="mtg-field">
                      <label>{t('Speaker')}</label>
                      <select className="form-input" value={speakerId} onChange={(e) => switchDevice('speaker', e.target.value)}>
                        {devices.speakers.map((d, i) => (
                          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t('Speaker')} ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleJoin} className="card glass-panel mtg-join__card mtg-join__side">
              <h2>{t('Ready to join?')}</h2>
              <div className="mtg-join__facts">
                {info.waiting_room_enabled && <span className="mtg-fact"><Icon name="clock" size={13} /> {t('Waiting room on')}</span>}
                {info.requires_password && <span className="mtg-fact"><Icon name="lock" size={13} /> {t('This meeting is password protected')}</span>}
              </div>

              {!info.is_authenticated && (
                <div className="mtg-field">
                  <label>{t('Your name')}</label>
                  <input className="form-input" required maxLength={100} autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  <p className="mtg-hint">{t('This is how other participants will see you.')}</p>
                  <p className="mtg-hint">
                    {t('Continue as guest, or')} <Link to="/auth/login" state={{ from: { pathname: `/join/${joinToken}` } }}>{t('log in to your account')}</Link>
                  </p>
                </div>
              )}

              {submitError && <p className="form-error" style={{ margin: 0 }}>{submitError}</p>}

              <button type="submit" className="btn btn-primary mtg-join__go" disabled={submitting || (!info.is_authenticated && !displayName.trim())}>
                {submitting ? '…' : t('Join Meeting')}
              </button>
            </form>
          </div>
        </div>
      )}

      {phase === 'waiting' && info && (
        <div className="card glass-panel" style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Icon name="clock" size={32} />
          <h1 className="text-h3" style={{ margin: 0 }}>{t('Waiting for the host to let you in…')}</h1>
          <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t("You'll join automatically once the host admits you.")}</p>
        </div>
      )}

      {phase === 'admitted' && info && (
        <MeetingRoomShell
          meetingUuid={info.meeting.uuid}
          meetingTitle={info.meeting.title}
          guestToken={guestToken}
          myKey={guestToken ? guestKeyFromToken(guestToken) : `user:${user?.id}`}
          myDisplayName={displayName || user?.full_name || user?.email || t('Guest')}
          deviceDefaults={info.device_defaults}
          // Round 5 — a not-yet-admitted guest's own preJoinInfo() doesn't
          // expose screen_sharing_locked/settings.allow_chat (those live on
          // the full Meeting record, behind the host/participant-only GET
          // .../meetings/{uuid}) — so a guest starts from the same safe
          // defaults the backend itself defaults to (unlocked, chat on),
          // and the live .screen_share.policy.changed broadcast corrects
          // it the moment the host next toggles it (see useMeetingRoom's
          // own docblock for why this is a real gap, not a fetch we skipped).
          onLeave={() => { clearSavedGuest(joinToken); navigate('/', { replace: true }); }}
        />
      )}

      {phase === 'rejected' && info && (
        <div className="card glass-panel" style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Icon name="x-circle" size={32} />
          <h1 className="text-h3" style={{ margin: 0 }}>{t('Your request to join was declined by the host.')}</h1>
          <Link to="/" className="btn btn-outline">{t('Back to meeting link')}</Link>
        </div>
      )}
    </div>
  );
}
