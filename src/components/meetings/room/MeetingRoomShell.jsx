import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackLayer } from '../../../lib/backStack';
import { useMeetingRoom, meetingLog } from '../../../hooks/useMeetingRoom';
import RemoteControlLayer from './RemoteControlLayer';
import ScreenSharePip from './ScreenSharePip';
import FloatingMeetPip, { useDocPip } from './FloatingMeetPip';
import Whiteboard from './Whiteboard';
import { BoardStore } from '../../../lib/whiteboard/boardStore';
import ParticipantTile from './ParticipantTile';
import { ReactionLayer } from './ReactionFx';
import { CAMERA_FILTERS, CAMERA_BACKGROUNDS, scenePreview } from '../../../lib/cameraFx';
import ChatPanel from './ChatPanel';
import ParticipantsPanel from './ParticipantsPanel';
import FilesPanel from './FilesPanel';
import NotesPanel from './NotesPanel';
import PollsPanel from './PollsPanel';
import RecordingsPanel from './RecordingsPanel';
import InvitePanel from './InvitePanel';
import { useRoomWaiting } from './useRoomWaiting';
import { api } from '../../../api/client';
import { publicOrigin } from '../../../config/siteUrl';
import Icon from '../../Icon';
import { useTranslations, useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

const ROOM_THEME_KEY = 'uip_room_theme';

/**
 * Light / dark look of the room itself. Starts from the choice made in the room last time, else from the site theme, and
 * flipping it here only affects the call (it does not touch the account / portal theme). Video tiles stay dark in both looks.
 */
function useRoomTheme() {
  const { theme } = useTheme();
  const [roomTheme, setRoomTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(ROOM_THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* storage unavailable */ }
    return theme === 'light' ? 'light' : 'dark';
  });
  const toggleRoomTheme = () => setRoomTheme((cur) => {
    const next = cur === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(ROOM_THEME_KEY, next); } catch { /* storage unavailable */ }
    return next;
  });
  return [roomTheme, toggleRoomTheme];
}

const REACTION_TYPES = [
  { type: 'thumbs_up', emoji: '👍' },
  { type: 'applause', emoji: '👏' },
  { type: 'laugh', emoji: '😂' },
  { type: 'heart', emoji: '❤️' },
  { type: 'celebrate', emoji: '🎉' },
];

/**
 * Round 3 (Signaling) + Round 4 (WebRTC Core, بند 4 — Participant Grid +
 * control bar). Pure UI/orchestration shell around useMeetingRoom() — used
 * two ways:
 *  - authenticated: MeetingRoom.jsx (`/${role}/meetings/{uuid}/room`)
 *    renders it with `guestToken=null` (the api client's Bearer token
 *    covers auth).
 *  - guest: MeetingPreJoin.jsx renders it inline, in place of the old
 *    static "you're in" card, once requestAccess() returns `admitted`
 *    with a guest_token — a guest has no portal to navigate to.
 *
 * Layout: always a "spotlight" tile (whoever is screen-sharing, else your
 * own camera) + a "strip" of everyone else. On desktop/tablet
 * (meeting-room.css) the strip's `display: contents` folds it back into
 * one flat grid alongside the spotlight — the split only actually takes
 * effect on mobile, matching the round plan's explicit mobile layout
 * ("one main camera + a thumbnail strip for the rest").
 *
 * Round 5 (Live Collaboration) additions — بند 7/8 (Chat, `ChatPanel`
 * slide-in), بند 11 (Raise Hand + ephemeral floating reactions), بند 9
 * (Screen Sharing host policies: a topbar lock toggle + per-participant
 * menu, gated on `isHost`). `screenSharingLockedInitial`/
 * `chatEnabledInitial` come from the caller's own already-fetched meeting
 * record where available — see MeetingRoom.jsx/MeetingPreJoin.jsx's own
 * docblocks for why a guest only gets safe defaults here (preJoinInfo()
 * doesn't expose these two meeting-wide flags to a not-yet-admitted
 * guest; the live `.screen_share.policy.changed` broadcast corrects it
 * for them the moment the host next toggles it).
 *
 * Round 6 (Host Controls) additions — بند 5: `ParticipantsPanel` slide-in
 * (mute/disable-camera/remove/promote/demote/make-host/lock meeting,
 * gated on `room.isManager` = host or co-host — see useMeetingRoom's own
 * docblock), the same actions folded into each `ParticipantTile`'s
 * existing "more" popover for quick single-participant access, and a
 * dedicated "you were removed" screen for `room.kicked`.
 *
 * Round 7 (Collaboration Extras) additions — بند 19 (`FilesPanel`), بند
 * 20 (`NotesPanel`), بند 21 (`PollsPanel`). Three more slide-in panels,
 * same "one open at a time" pattern as Chat/Participants — opening any
 * one of the five closes whichever else was open (see `openPanel` below,
 * replacing the five separate `useState(false)` booleans this component
 * used through Round 6).
 *
 * Round 9 (Recording) addition — بند 18 (`RecordingsPanel`), the sixth
 * slide-in panel, same one-at-a-time rule. `room.activeRecording` also
 * drives a persistent "Recording" indicator in the topbar itself
 * (outside the panel) — "Recording must be clearly indicated to all
 * participants", not just to whoever happens to have the panel open.
 */
export default function MeetingRoomShell({
  meetingUuid, meetingTitle, guestToken = null, myKey, myDisplayName, deviceDefaults, onLeave,
  isHost = false, screenSharingLockedInitial = false, chatEnabledInitial = true, meetingLockedInitial = false,
}) {
  const t = useTranslations(translations);
  const { locale, toggleLocale } = useLanguage();
  const [roomTheme, toggleRoomTheme] = useRoomTheme();
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [fxBusy, setFxBusy] = useState(null);
  const fxFileRef = useRef(null);
  const fxImageRef = useRef(null); // the picture picked with "Upload your own" (kept so a filter change doesn't lose it)
  async function applyLook(patch) {
    const id = patch.background ?? patch.filter;
    setFxBusy(id);
    try {
      const next = { ...room.cameraLook, ...patch };
      if (next.background === 'custom' && !fxImageRef.current) next.background = 'none';
      await room.setCameraLook({ ...next, image: next.background === 'custom' ? fxImageRef.current : undefined });
    } finally { setFxBusy(null); }
  }
  async function onPickBackground(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setFxBusy('custom');
    try {
      fxImageRef.current = await createImageBitmap(file);
      await room.setCameraLook({ ...room.cameraLook, background: 'custom', image: fxImageRef.current });
    } catch { /* unreadable image: keep the current look */ } finally { setFxBusy(null); }
  }
  const [leaveOpen, setLeaveOpen] = useState(false);
  // Floating always-on-top window (Document Picture-in-Picture) — shown while you present, like Google Meet.
  const pip = useDocPip();
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(null);
  const dockRef = useRef(null);
  const [elapsed, setElapsed] = useState('00:00');
  useEffect(() => {
    const started = Date.now();
    const pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const sec = Math.floor((Date.now() - started) / 1000);
      const h = Math.floor(sec / 3600);
      setElapsed(`${h ? `${pad(h)}:` : ''}${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  // close the reactions / "more" popovers when clicking anywhere outside the dock
  useEffect(() => {
    if (!reactionsOpen && !moreOpen && !fxOpen) return undefined;
    const onDown = (e) => {
      if (dockRef.current && !dockRef.current.contains(e.target)) { setReactionsOpen(false); setMoreOpen(false); setFxOpen(false); }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [reactionsOpen, moreOpen, fxOpen]);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLines, setDiagLines] = useState([]);
  useEffect(() => {
    if (!diagOpen) return undefined;
    const tick = () => setDiagLines(meetingLog());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [diagOpen]);
  const [pinnedKey, setPinnedKey] = useState(null); // double-click a tile to pin it large
  // Round 7 — one slide-in panel open at a time (Chat/Participants/Files/
  // Notes/Polls); replaces the separate per-panel booleans Round 5/6 used,
  // since a 5-way stack over the same stage only makes sense one at a time.
  const [openPanel, setOpenPanel] = useState(null); // 'chat' | 'participants' | 'files' | 'notes' | 'polls' | 'recordings' | null
  const togglePanel = (name) => setOpenPanel((prev) => (prev === name ? null : name));
  // Back closes the open side panel first (chat, participants, ...), then leaves the room page.
  useBackLayer(openPanel !== null, () => setOpenPanel(null));
  const chatOpen = openPanel === 'chat';
  const participantsOpen = openPanel === 'participants';
  const filesOpen = openPanel === 'files';
  const notesOpen = openPanel === 'notes';
  const pollsOpen = openPanel === 'polls';
  const recordingsOpen = openPanel === 'recordings';

  useEffect(() => {
    document.body.classList.add('meeting-room-active');
    return () => document.body.classList.remove('meeting-room-active');
  }, []);

  const room = useMeetingRoom({
    meetingUuid, guestToken, myKey, myDisplayName, deviceDefaults,
    isHost, screenSharingLockedInitial, chatEnabledInitial, meetingLockedInitial,
  });

  // Shared whiteboard: the store listens to the meeting channel for the whole stay (so nothing drawn while the board is hidden is lost).
  const [board, setBoard] = useState(null);
  const [, wbTick] = useState(0);
  useEffect(() => {
    if (!room.wbSend || !myKey) return undefined;
    const store = new BoardStore({ send: room.wbSend, on: room.wbOn, myKey, myName: myDisplayName, isManager: room.isManager });
    const off = store.subscribe((kind) => { if (kind === 'open') wbTick((n) => n + 1); });
    setBoard(store);
    return () => { off(); store.destroy(); setBoard(null); };
  }, [room.wbSend, room.wbOn, myKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { board?.setIdentity(myDisplayName, room.isManager); }, [board, myDisplayName, room.isManager]);

  // Host / moderator tools inside the room: the join link + who is waiting at the door. (A guest has no meeting record to read.)
  const canHost = !guestToken && room.isManager;
  const [hostInfo, setHostInfo] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  useEffect(() => {
    if (!canHost) return undefined;
    let off = false;
    api.get(`/api/v1/meetings/${meetingUuid}`).then((json) => { if (!off) setHostInfo(json.data || null); }).catch(() => {});
    return () => { off = true; };
  }, [canHost, meetingUuid]);
  const joinToken = hostInfo && hostInfo.join_url ? String(hostInfo.join_url).split('/').filter(Boolean).pop() : null;
  const joinAppUrl = joinToken ? `${publicOrigin()}/join/${joinToken}` : null;
  const waiting = useRoomWaiting(meetingUuid, canHost && !(hostInfo && hostInfo.waiting_room_enabled === false));

  const tiles = useMemo(() => {
    const remote = Object.entries(room.participants).map(([key, p]) => ({ key, ...p }));
    const local = {
      key: 'local', displayName: myDisplayName, isHost: room.myRole === 'host', role: room.myRole, isGuest: !!guestToken,
      micEnabled: room.micEnabled, cameraEnabled: room.cameraEnabled, screenSharing: room.screenSharing,
      handRaised: room.handRaised, screenShareAllowed: room.myScreenShareAllowed,
      connectionState: 'connected', connectionQuality: 'excellent', remoteStream: room.localStream, isLocal: true,
    };
    const all = [local, ...remote];
    // Equal grid by default; a big "spotlight" + side strip only when someone shares their screen or you pinned a tile.
    // Someone ELSE presenting -> they fill the stage. When YOU present you keep the normal grid and get a small floating preview
    // instead (ScreenSharePip) — like Meet — so you never stare at a giant picture of your own screen.
    const presenter = all.find((p) => p.screenSharing && !p.isLocal) || null;
    const featured = all.find((p) => all.length > 1 && p.key === pinnedKey) || presenter || null;
    const rest = featured ? all.filter((p) => p.key !== featured.key) : all;
    const n = all.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    return { spotlight: featured, rest, all, cols, rows: Math.ceil(n / cols) };
  }, [room.participants, room.localStream, room.micEnabled, room.cameraEnabled, room.screenSharing, room.handRaised, room.myScreenShareAllowed, room.myRole, myDisplayName, guestToken, pinnedKey]);

  // newest live reaction per person -> shown on THEIR tile (their own tile = 'local'); the corner overlay shows the same stream with names
  const reactionByTile = useMemo(() => {
    const map = {};
    room.reactions.forEach((r) => { map[r.key === myKey ? 'local' : r.key] = r; });
    return map;
  }, [room.reactions, myKey]);

  const recipientOptions = useMemo(
    () => Object.entries(room.participants).map(([key, p]) => ({ key, displayName: p.displayName })),
    [room.participants]
  );

  function handleLeave() {
    setMoreOpen(false); setReactionsOpen(false); setFxOpen(false);
    setLeaveOpen(true);
  }
  /** Leave only (everyone else stays in the call). */
  function confirmLeave() {
    setLeaveOpen(false);
    room.leave();
    onLeave?.();
  }
  /** Host / co-host: close the meeting for every participant, then leave. */
  async function confirmEndForAll() {
    setEnding(true);
    setEndError(null);
    try {
      await room.endMeetingForAll();
      setLeaveOpen(false);
      onLeave?.();
    } catch (err) {
      setEndError(err?.message || t('Could not end the meeting. Please try again.'));
    } finally {
      setEnding(false);
    }
  }

  // open it automatically when you start presenting (works while the click's permission is still fresh; otherwise use the button),
  // and close it when the presentation ends.
  const sharingNow = !!room.screenSharing;
  useEffect(() => {
    if (sharingNow) pip.open();
    else if (pip.isOpen) pip.close();
  }, [sharingNow]); // eslint-disable-line react-hooks/exhaustive-deps

  if (room.sessionConflict) {
    const replaced = room.sessionConflict === 'replaced';
    return (
      <div className="meeting-room" data-room-theme={roomTheme} style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--space-6)' }}>
        <Icon name="alert-triangle" size={32} />
        <p className="text-h3" style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>{replaced ? t('You joined from another tab or device') : t('You are already in this meeting')}</p>
        <p className="text-small" style={{ color: 'var(--mr-muted)', maxWidth: 420 }}>
          {replaced
            ? t('This meeting was opened somewhere else, so this window has been disconnected.')
            : t('This meeting is open in another tab, browser or device. You can only be in a meeting once at a time — close the other one, then try again.')}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
          {!replaced && <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{t('Try again')}</button>}
          <button type="button" className="btn btn-outline" onClick={() => onLeave?.()}>{t('Back to My Meetings')}</button>
        </div>
      </div>
    );
  }

  if (room.status === 'error') {
    return (
      <div className="meeting-room" data-room-theme={roomTheme} style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--space-6)' }}>
        <Icon name="alert-triangle" size={32} />
        <p className="text-h3" style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>{t("You haven't joined this meeting yet.")}</p>
        <p className="text-small" style={{ color: 'var(--mr-muted)' }}>{t('Use the meeting link to join first.')}</p>
        {room.error && (
          <p className="text-caption" dir="ltr" style={{ color: 'var(--mr-muted)', maxWidth: 520, wordBreak: 'break-word' }}>
            {room.error?.message || String(room.error)}
          </p>
        )}
        <button type="button" className="btn btn-outline" style={{ marginTop: 'var(--space-3)' }} onClick={() => onLeave?.()}>
          {t('Back to My Meetings')}
        </button>
      </div>
    );
  }

  const renderTile = (p) => (
    <div key={p.key} className="meeting-tile-wrap">
      <ParticipantTile
        stream={p.remoteStream}
        displayName={p.key === 'local' ? `${p.displayName} (${t('You')})` : p.displayName}
        isHost={p.isHost}
        isGuest={p.isGuest}
        micEnabled={p.micEnabled}
        cameraEnabled={p.cameraEnabled}
        screenSharing={p.screenSharing}
        handRaised={p.handRaised}
        reaction={reactionByTile[p.key]}
        speakersMuted={room.speakersMuted}
        screenShareAllowed={p.screenShareAllowed}
        connectionQuality={p.connectionQuality}
        connectionState={p.connectionState}
        isLocal={!!p.isLocal}
        large={!!tiles.spotlight && p.key === tiles.spotlight.key}
        pinned={pinnedKey === p.key}
        onPin={tiles.all.length > 1 ? () => setPinnedKey((k) => (k === p.key ? null : p.key)) : undefined}
        onStopShare={p.isLocal && p.screenSharing ? room.toggleScreenShare : undefined}
        canManage={room.isManager && !p.isLocal}
        onAllowScreenShare={() => room.setParticipantScreenShareAllowed(p.key, true)}
        onDenyScreenShare={() => room.setParticipantScreenShareAllowed(p.key, false)}
        onResetScreenShare={() => room.setParticipantScreenShareAllowed(p.key, null)}
        onForceStopScreenShare={() => room.forceStopScreenShare(p.key)}
        role={p.role}
        canPrimaryManage={room.myRole === 'host' && !p.isLocal && !p.isGuest}
        onMute={() => room.muteParticipant(p.key).catch(() => {})}
        onDisableCamera={() => room.disableParticipantCamera(p.key).catch(() => {})}
        onRemove={() => { if (window.confirm(t('Remove this participant from the meeting?'))) room.removeParticipant(p.key).catch(() => {}); }}
        onPromote={() => room.promoteParticipant(p.key).catch(() => {})}
        onDemote={() => room.demoteParticipant(p.key).catch(() => {})}
        onMakeHost={() => { if (window.confirm(t('Make this participant the host? You will become a moderator.'))) room.transferHost(p.key).catch(() => {}); }}
      />
    </div>
  );

  function noticeText(notice) {
    if (!notice) return null;
    if (notice.type === 'screen_share_force_stopped') {
      return `${t('The host stopped your screen share.')}${notice.by ? ` (${notice.by})` : ''}`;
    }
    if (notice.type === 'screen_share_locked') {
      return t('Screen sharing is currently locked by the host.');
    }
    if (notice.type === 'muted_by_host') {
      return `${t('You were muted by the host.')}${notice.by ? ` (${notice.by})` : ''}`;
    }
    if (notice.type === 'capture_other_screenshot') return `${t('Screenshot warning')}: ${notice.by || t('A participant')} ${t('may have taken a screenshot of this meeting.')}`;
    if (notice.type === 'capture_other_recording') return `${t('Recording warning')}: ${notice.by || t('A participant')} ${t('may be recording their screen.')}`;
    if (notice.type === 'capture_self_screenshot') return t('A screenshot was detected. The other participants were notified.');
    if (notice.type === 'capture_self_recording') return t('Screen recording was detected. The other participants were notified.');
    if (notice.type === 'echo_detected') return t('Audio feedback detected — another device nearby is looping your voice, so your mic was muted. Use headphones, or turn Speakers off in More if you are in the same room as them.');
    if (notice.type === 'effect_unavailable') return t("Backgrounds and blur couldn't load. Colour filters still work.");
    if (notice.type === 'camera_unavailable') return t("Couldn't open a camera. Check the browser's camera permission and that no other app is using it.");
    if (notice.type === 'screen_share_unsupported') return t("This browser can't share your screen.");
    if (notice.type === 'screen_share_failed') return t('Screen sharing could not start. Please try again.');
    if (notice.type === 'sfu_unavailable') return t('The large-meeting video server is unreachable from your network — using direct connections where possible.');
    if (notice.type === 'camera_disabled_by_host') {
      return `${t('Your camera was turned off by the host.')}${notice.by ? ` (${notice.by})` : ''}`;
    }
    return null;
  }

  if (room.meetingStatus === 'ended') {
    return (
      <div className="meeting-room" data-room-theme={roomTheme} style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--space-6)' }}>
        <Icon name="check-circle" size={32} />
        <p className="text-h3" style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>{t('This meeting has ended.')}</p>
        <p className="text-small" style={{ color: 'var(--mr-muted)' }}>{t('The host ended the meeting for everyone.')}</p>
        <button type="button" className="btn btn-outline" style={{ marginTop: 'var(--space-3)' }} onClick={() => onLeave?.()}>
          {t('Back to My Meetings')}
        </button>
      </div>
    );
  }

  if (room.kicked) {
    return (
      <div className="meeting-room" data-room-theme={roomTheme} style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'var(--space-6)' }}>
        <Icon name="user-x" size={32} />
        <p className="text-h3" style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>{t('You were removed from the meeting.')}</p>
        {room.kicked.byDisplayName && (
          <p className="text-small" style={{ color: 'var(--mr-muted)' }}>{`${t('Removed by')} ${room.kicked.byDisplayName}`}</p>
        )}
        <button type="button" className="btn btn-outline" style={{ marginTop: 'var(--space-3)' }} onClick={() => onLeave?.()}>
          {t('Back to My Meetings')}
        </button>
      </div>
    );
  }

  const presenterTile = tiles.all.find((p) => p.screenSharing && !p.isLocal) || null;
  const anyPanelOpen = openPanel !== null;
  const unread = room.chatUnreadCount > 0 && !chatOpen ? (room.chatUnreadCount > 9 ? '9+' : room.chatUnreadCount) : null;
  const moreActive = filesOpen || notesOpen || pollsOpen || recordingsOpen || !!(board && board.open);

  const cameraTitle = !room.hasCamera ? t('Turn camera on') : room.cameraEnabled ? t('Turn camera off') : t('Turn camera on');

  return (
    <div className={`meeting-room ${anyPanelOpen ? 'has-panel' : ''}`} data-room-theme={roomTheme}>
      <header className="meeting-room__topbar">
        <div className="meeting-room__title">
          <span className="meeting-room__live-dot" aria-hidden="true" />
          <div className="meeting-room__title-text">
            <strong>{meetingTitle || t('Meeting Room')}</strong>
            <span>
              {room.status === 'connecting' ? t('Connecting…') : <bdi dir="ltr">{elapsed}</bdi>}
              {room.meetingLocked && <Icon name="lock" size={11} title={t('Meeting locked')} />}
            </span>
          </div>
        </div>

        <div className="meeting-room__topbar-end">
          {room.activeRecording && (
            <span className="meeting-room__rec" title={`${t('Recording in progress — started by')} ${room.activeRecording.started_by_display_name || ''}`}>
              <Icon name="record-dot" size={11} className="meeting-room__record-pulse" /> {t('Recording')}
            </span>
          )}
          <button
            type="button"
            className={`meeting-room__pill ${participantsOpen ? 'is-active' : ''}`}
            onClick={() => togglePanel('participants')}
            title={t('Participants')}
          >
            <Icon name="users" size={15} />
            <span>{tiles.all.length}</span>
            {canHost && waiting.requests.length > 0 && <span className="meeting-room__pill-badge" aria-label={t('Waiting to join')}>{waiting.requests.length}</span>}
          </button>
          {canHost && (
            <button type="button" className="meeting-room__pill" onClick={() => setInviteOpen(true)} title={t('Invite people')} aria-label={t('Invite people')}>
              <Icon name="link" size={15} />
              <span className="meeting-room__pill-text">{t('Invite')}</span>
            </button>
          )}
          {room.isHost && (
            <button
              type="button"
              className={`meeting-room__icon-btn ${room.screenSharingLocked ? 'is-warn' : ''}`}
              onClick={() => room.setScreenSharingLock(!room.screenSharingLocked)}
              title={room.screenSharingLocked ? t('Allow screen sharing') : t('Disable screen sharing')}
              aria-pressed={room.screenSharingLocked}
            >
              <Icon name={room.screenSharingLocked ? 'lock' : 'screen-share'} size={16} />
            </button>
          )}
          <button type="button" className="meeting-room__pill meeting-room__hide-xs" onClick={toggleLocale} title={t('Switch language')} aria-label={t('Switch language')}>
            <Icon name="globe" size={15} />
            <span>{locale === 'ar' ? 'EN' : 'عربي'}</span>
          </button>
          <button
            type="button"
            className="meeting-room__icon-btn meeting-room__hide-xs"
            onClick={toggleRoomTheme}
            title={roomTheme === 'light' ? t('Dark mode') : t('Light mode')}
            aria-label={roomTheme === 'light' ? t('Dark mode') : t('Light mode')}
          >
            <Icon name={roomTheme === 'light' ? 'moon' : 'sun'} size={16} />
          </button>
          <button type="button" className={`meeting-room__icon-btn meeting-room__hide-xs ${diagOpen ? 'is-active' : ''}`} onClick={() => setDiagOpen((v) => !v)} title={t('Diagnostics')} aria-label={t('Diagnostics')}>
            <Icon name="pulse" size={16} />
          </button>
        </div>
      </header>

      {diagOpen && (
        <div className="meeting-room__diag">
          <div className="meeting-room__diag-head">
            <strong>{t('Diagnostics')}</strong>
            <span>
              <button type="button" onClick={() => { try { navigator.clipboard.writeText(diagLines.join('\n')); } catch { /* clipboard blocked */ } }}>{t('Copy')}</button>
              <button type="button" onClick={() => setDiagOpen(false)}>{t('Close')}</button>
            </span>
          </div>
          <pre>{diagLines.length ? diagLines.join('\n') : '…'}</pre>
        </div>
      )}

      <div className="meeting-room__alerts">
        {canHost && waiting.requests.length > 0 && !participantsOpen && (
          <p className="meeting-room__alert is-info meeting-room__alert--wait" role="status">
            <Icon name="users" size={15} />
            <span>
              <strong>{waiting.requests.length === 1 ? waiting.requests[0].display_label : waiting.requests.length}</strong> {t('waiting to join')}
            </span>
            <button type="button" className="meeting-room__alert-act" onClick={() => setOpenPanel('participants')}>{t('View')}</button>
            <button type="button" className="meeting-room__alert-act is-primary" disabled={waiting.busyAll} onClick={waiting.admitAll}>{t('Admit All')}</button>
          </p>
        )}
        {noticeText(room.notice) && (
          <p className={`meeting-room__alert ${String(room.notice?.type || '').startsWith('capture_') ? 'is-warn' : 'is-info'}`}>
            <Icon name="info" size={15} />
            <span>{noticeText(room.notice)}</span>
            <button type="button" onClick={room.clearNotice} aria-label={t('Close')}><Icon name="x" size={14} /></button>
          </p>
        )}
        {room.meshCapacity?.exceeds_recommended && room.transport !== 'sfu' && (
          <p className="meeting-room__alert is-warn">
            <Icon name="alert-triangle" size={15} />
            <span>{t('This meeting has reached the recommended participant limit — call quality may degrade.')}</span>
          </p>
        )}
        {room.hasTurn === false && tiles.all.length > 1 && (
          <p className="meeting-room__alert is-warn">
            <Icon name="alert-triangle" size={15} />
            <span>{t('No TURN server is configured — audio/video may not reach people on other networks.')}</span>
          </p>
        )}
        {room.error && (
          <p className="meeting-room__alert is-danger">
            <Icon name="alert-triangle" size={15} />
            <span>{room.error.message || t("Camera/microphone couldn't be accessed — you can still see and hear everyone else.")}</span>
          </p>
        )}
      </div>

      <div className="meeting-room__body">
        <div
          className={`meeting-room__stage ${tiles.spotlight ? `has-spotlight ${tiles.rest.length === 0 ? 'no-strip' : ''}` : 'is-grid'}`}
          style={{ '--cols': tiles.cols, '--rows': tiles.rows, '--n': tiles.all.length }}
        >
          {tiles.spotlight ? (
            <>
              <div className="meeting-room__spotlight">
                {presenterTile && tiles.spotlight.key === presenterTile.key && (
                  <div className="meeting-room__presenter-banner">
                    <Icon name="screen-share" size={14} />
                    {presenterTile.isLocal ? t('You are presenting your screen') : `${presenterTile.displayName} ${t('is presenting')}`}
                  </div>
                )}
                {renderTile(tiles.spotlight)}
                <RemoteControlLayer room={room} myKey={myKey} presenter={presenterTile && tiles.spotlight.key === presenterTile.key ? presenterTile : null} t={t} />
              </div>
              {tiles.rest.length > 0 && <div className="meeting-room__strip">{tiles.rest.map(renderTile)}</div>}
            </>
          ) : tiles.all.map(renderTile)}

          {room.screenSharing && room.screenStream && (
            <>
              <ScreenSharePip stream={room.screenStream} onStop={room.toggleScreenShare} t={t} onPopOut={pip.supported ? (pip.isOpen ? pip.close : pip.open) : undefined} popped={pip.isOpen} />
              {!tiles.spotlight && <RemoteControlLayer room={room} myKey={myKey} presenter={null} t={t} />}
            </>
          )}

          <FloatingMeetPip
            win={pip.win}
            people={tiles.all}
            elapsed={elapsed}
            title={meetingTitle}
            screenStream={room.screenStream}
            t={t}
            state={{ micEnabled: room.micEnabled, cameraEnabled: room.cameraEnabled, handRaised: room.handRaised, screenSharing: room.screenSharing, unread: unread }}
            actions={{
              toggleMic: room.toggleMic,
              toggleCamera: room.toggleCamera,
              toggleHand: room.toggleHand,
              stopShare: room.toggleScreenShare,
              openChat: () => { window.focus(); if (!chatOpen) togglePanel('chat'); },
              back: () => { window.focus(); },
              leave: () => { window.focus(); handleLeave(); },
            }}
          />

          {board && board.visible && (
            <Whiteboard store={board} t={t} isManager={room.isManager} onClose={() => board.hideForMe()} />
          )}

          <ReactionLayer reactions={room.reactions} myKey={myKey} youLabel={t('You')} />
        </div>

        <ParticipantsPanel
          people={tiles.all}
          myRole={room.myRole}
          meetingLocked={room.meetingLocked}
          waiting={canHost ? waiting : null}
          onInvite={canHost ? () => setInviteOpen(true) : null}
          isOpen={participantsOpen}
          onClose={() => setOpenPanel(null)}
          onLockMeeting={(locked) => room.lockMeeting(locked)}
          onMute={(key) => room.muteParticipant(key)}
          onDisableCamera={(key) => room.disableParticipantCamera(key)}
          onRemove={(key) => room.removeParticipant(key)}
          onPromote={(key) => room.promoteParticipant(key)}
          onDemote={(key) => room.demoteParticipant(key)}
          onMuteAll={() => room.muteEveryone()}
          onSetChatMuted={(key, muted) => room.setParticipantChatMuted(key, muted)}
          chatMutedKeys={room.chatMutedKeys}
          onMakeHost={(key) => {
            if (!window.confirm(t('Make this participant the host? You will become a moderator.'))) return Promise.resolve();
            return room.transferHost(key);
          }}
        />

        <ChatPanel
          messages={room.chatMessages}
          unreadCount={room.chatUnreadCount}
          enabled={room.chatEnabled}
          myKey={myKey}
          recipientOptions={recipientOptions}
          isOpen={chatOpen}
          onClose={() => setOpenPanel(null)}
          onSend={room.sendChatMessage}
          onReact={room.reactToChatMessage}
          onMarkRead={room.markChatRead}
          isManager={room.isManager}
          chatHistory={room.chatHistory}
          iAmMuted={room.chatMutedKeys.includes(myKey)}
          onDelete={room.deleteChatMessage}
          onSetEnabled={room.setChatEnabledForAll}
          onSetHistory={room.setChatHistoryMode}
          onClear={room.clearChatForAll}
        />

        <FilesPanel
          files={room.files}
          myKey={myKey}
          isManager={room.isManager}
          isOpen={filesOpen}
          onClose={() => setOpenPanel(null)}
          onUpload={room.uploadFile}
          onDelete={room.deleteFile}
        />

        <NotesPanel
          notes={room.notes}
          actionItems={room.actionItems}
          isManager={room.isManager}
          isOpen={notesOpen}
          onClose={() => setOpenPanel(null)}
          onUpdateNotes={room.updateNotes}
          onCreateItem={room.createActionItem}
          onUpdateItem={room.updateActionItem}
          onDeleteItem={room.deleteActionItem}
        />

        <PollsPanel
          polls={room.polls}
          isManager={room.isManager}
          isOpen={pollsOpen}
          onClose={() => setOpenPanel(null)}
          onCreate={room.createPoll}
          onVote={room.votePoll}
          onClosePoll={room.closePoll}
        />

        <RecordingsPanel
          recordings={room.recordings}
          isManager={room.isManager}
          isOpen={recordingsOpen}
          onClose={() => setOpenPanel(null)}
          activeRecording={room.activeRecording}
          isRecordingLocally={room.isRecordingLocally}
          recordingBusy={room.recordingBusy}
          recordingError={room.recordingError}
          onStart={room.startRecording}
          onStopLocal={room.stopRecordingLocal}
          onDelete={room.deleteRecording}
        />
      </div>

      <footer className="meeting-room__controls">
        <div className="meeting-room__dock" ref={dockRef}>
          <div className="meeting-room__group">
            <DockButton
              icon={room.micEnabled ? 'mic' : 'mic-off'}
              label={room.micEnabled ? t('Mute') : t('Unmute')}
              state={room.micEnabled ? '' : 'is-off'}
              onClick={room.toggleMic}
            />
            <DockButton
              icon={room.cameraEnabled ? 'video' : 'video-off'}
              label={room.cameraEnabled ? t('Camera') : t('Camera off')}
              title={cameraTitle}
              state={room.cameraEnabled ? '' : 'is-off'}
              onClick={room.toggleCamera}
            />
            <div className="meeting-room__pop-anchor">
              <DockButton
                icon="ai-spark"
                label={t('Effects')}
                title={t('Camera effects')}
                state={fxOpen || room.cameraLook.filter !== 'none' || room.cameraLook.background !== 'none' ? 'is-active' : ''}
                disabled={!room.hasCamera}
                onClick={() => { setFxOpen((v) => !v); setMoreOpen(false); setReactionsOpen(false); }}
              />
              {fxOpen && (
                <div className="meeting-room__menu meeting-room__fx" role="menu">
                  <div className="meeting-room__fx-title">{t('Backgrounds')}</div>
                  <div className="meeting-room__fx-bgs">
                    {CAMERA_BACKGROUNDS.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        title={t(b.label)}
                        disabled={fxBusy !== null}
                        className={`meeting-room__fx-bg ${room.cameraLook.background === b.id ? 'is-on' : ''}`}
                        onClick={() => applyLook({ background: b.id })}
                      >
                        {b.scene
                          ? <img src={scenePreview(b.scene)} alt="" />
                          : <span className={`meeting-room__fx-bg-ico ${b.blur ? 'is-blur' : ''}`}>{b.blur ? <Icon name="eye-off" size={16} /> : <Icon name="x" size={16} />}</span>}
                        <em>{fxBusy === b.id ? '…' : t(b.label)}</em>
                      </button>
                    ))}
                    <button type="button" className={`meeting-room__fx-bg ${room.cameraLook.background === 'custom' ? 'is-on' : ''}`} disabled={fxBusy !== null} onClick={() => fxFileRef.current?.click()} title={t('Upload your own')}>
                      <span className="meeting-room__fx-bg-ico"><Icon name="plus" size={16} /></span>
                      <em>{fxBusy === 'custom' ? '…' : t('Upload your own')}</em>
                    </button>
                    <input ref={fxFileRef} type="file" accept="image/*" hidden onChange={onPickBackground} />
                  </div>
                  <div className="meeting-room__fx-title">{t('Filters')}</div>
                  <div className="meeting-room__fx-grid">
                    {CAMERA_FILTERS.map((fx) => (
                      <button
                        key={fx.id}
                        type="button"
                        className={`meeting-room__fx-chip ${room.cameraLook.filter === fx.id ? 'is-on' : ''}`}
                        disabled={fxBusy !== null}
                        onClick={() => applyLook({ filter: fx.id })}
                      >
                        {fxBusy === fx.id ? '…' : t(fx.label)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DockButton
              icon="screen-share"
              label={room.screenSharing ? t('Stop Sharing') : t('Share Screen')}
              title={room.screenSharing ? t('Stop Sharing') : (room.canShareScreen ? t('Share Screen') : t('Screen sharing is currently locked by the host.'))}
              state={room.screenSharing ? 'is-presenting' : ''}
              disabled={!room.screenSharing && !room.canShareScreen}
              onClick={room.toggleScreenShare}
            />
          </div>

          <span className="meeting-room__divider" aria-hidden="true" />

          <div className="meeting-room__group">
            <DockButton
              icon="hand"
              label={room.handRaised ? t('Lower Hand') : t('Raise Hand')}
              state={room.handRaised ? 'is-active' : ''}
              onClick={room.toggleHand}
            />
            <div className="meeting-room__pop-anchor">
              <DockButton icon="smile" label={t('Reactions')} state={reactionsOpen ? 'is-active' : ''} onClick={() => { setReactionsOpen((v) => !v); setMoreOpen(false); }} />
              {reactionsOpen && (
                <div className="meeting-room__reactions-popover">
                  {REACTION_TYPES.map((r) => (
                    <button key={r.type} type="button" onClick={() => { room.sendReaction(r.type, r.emoji); setReactionsOpen(false); }}>{r.emoji}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <span className="meeting-room__divider" aria-hidden="true" />

          <div className="meeting-room__group">
            <DockButton icon="message-square" label={t('Chat')} state={chatOpen ? 'is-active' : ''} badge={unread} onClick={() => togglePanel('chat')} />
            <DockButton icon="users" label={t('Participants')} state={participantsOpen ? 'is-active' : ''} onClick={() => togglePanel('participants')} className="meeting-room__hide-sm" />
            <div className="meeting-room__pop-anchor">
              <DockButton
                icon="more-horizontal"
                label={t('More')}
                state={moreOpen || moreActive ? 'is-active' : ''}
                dot={!!room.activeRecording || !!(board && board.open && !board.visible)}
                onClick={() => { setMoreOpen((v) => !v); setReactionsOpen(false); }}
              />
              {moreOpen && (
                <div className="meeting-room__menu meeting-room__more" role="menu">
                  <button type="button" role="menuitem" className="meeting-room__menu-item show-sm" onClick={() => { togglePanel('participants'); setMoreOpen(false); }}>
                    <Icon name="users" size={16} /><span className="meeting-room__menu-text">{t('Participants')}</span>
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item" onClick={() => { togglePanel('files'); setMoreOpen(false); }}>
                    <Icon name="file" size={16} /><span className="meeting-room__menu-text">{t('Files')}</span>
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item" onClick={() => { togglePanel('notes'); setMoreOpen(false); }}>
                    <Icon name="note" size={16} /><span className="meeting-room__menu-text">{t('Notes & Action Items')}</span>
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item" disabled={!board} onClick={() => { if (board) { if (board.visible) board.hideForMe(); else board.showForMe(); } setMoreOpen(false); }}>
                    <Icon name="edit" size={16} /><span className="meeting-room__menu-text">{board?.visible ? t('Hide whiteboard') : t('Whiteboard')}</span>
                    {board && board.open && !board.visible && <span className="meeting-room__menu-badge" aria-hidden="true">●</span>}
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item" onClick={() => { togglePanel('polls'); setMoreOpen(false); }}>
                    <Icon name="bar-chart" size={16} /><span className="meeting-room__menu-text">{t('Polls')}</span>
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item" onClick={() => { togglePanel('recordings'); setMoreOpen(false); }}>
                    <Icon name="record-dot" size={16} style={room.activeRecording ? { color: '#ef4444' } : undefined} /><span className="meeting-room__menu-text">{t('Recordings')}</span>
                  </button>
                  <div className="meeting-room__menu-sep" role="separator" />
                  <button type="button" role="menuitem" className="meeting-room__menu-item meeting-room__show-xs" onClick={() => { toggleLocale(); setMoreOpen(false); }}>
                    <Icon name="globe" size={16} /><span className="meeting-room__menu-text">{t('Switch language')}</span>
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item meeting-room__show-xs" onClick={() => { toggleRoomTheme(); setMoreOpen(false); }}>
                    <Icon name={roomTheme === 'light' ? 'moon' : 'sun'} size={16} /><span className="meeting-room__menu-text">{roomTheme === 'light' ? t('Dark mode') : t('Light mode')}</span>
                  </button>
                  <button type="button" role="menuitem" className="meeting-room__menu-item meeting-room__show-xs" onClick={() => { setDiagOpen(true); setMoreOpen(false); }}>
                    <Icon name="pulse" size={16} /><span className="meeting-room__menu-text">{t('Diagnostics')}</span>
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={!!room.noiseOn} className="meeting-room__menu-item" onClick={room.toggleNoise}>
                    <Icon name="mic" size={16} /><span className="meeting-room__menu-text">{t('Noise isolation')}</span>
                    <span className={`meeting-room__switch ${room.noiseOn ? 'is-on' : ''}`} aria-hidden="true"><i /></span>
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={!!room.speakersMuted} className="meeting-room__menu-item" onClick={room.toggleSpeakers} title={t('Turn off if another participant is sitting next to you')}>
                    <Icon name="volume" size={16} /><span className="meeting-room__menu-text">{t('Speakers off (same room)')}</span>
                    <span className={`meeting-room__switch ${room.speakersMuted ? 'is-on' : ''}`} aria-hidden="true"><i /></span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <span className="meeting-room__divider" aria-hidden="true" />

          <button type="button" className="meeting-room__leave" onClick={handleLeave} title={t('Leave Meeting')} aria-label={t('Leave Meeting')}>
            <Icon name="logout" size={18} />
            <span>{t('Leave')}</span>
          </button>
        </div>
      </footer>

      {inviteOpen && canHost && (
        <InvitePanel title={meetingTitle} joinUrl={joinAppUrl} code={hostInfo && hostInfo.meeting_code} hasPassword={!!(hostInfo && hostInfo.has_password)} onClose={() => setInviteOpen(false)} />
      )}

      {leaveOpen && (
        <div className="meeting-leave" role="dialog" aria-modal="true" aria-label={t('Leave Meeting')} onClick={() => !ending && setLeaveOpen(false)}>
          <div className="meeting-leave__box" onClick={(e) => e.stopPropagation()}>
            <h3>{t('Leave Meeting')}</h3>
            <p>{room.isManager ? t('You can leave and let the others carry on, or end the meeting for everyone.') : t('Are you sure you want to leave the meeting?')}</p>
            {endError && <p className="form-error">{endError}</p>}
            <div className="meeting-leave__actions">
              {room.isManager && (
                <button type="button" className="meeting-leave__btn is-danger" disabled={ending} onClick={confirmEndForAll}>
                  <Icon name="x-circle" size={16} /> {ending ? t('Ending…') : t('End meeting for everyone')}
                </button>
              )}
              <button type="button" className={`meeting-leave__btn ${room.isManager ? '' : 'is-danger'}`} disabled={ending} onClick={confirmLeave}>
                <Icon name="logout" size={16} /> {room.isManager ? t('Leave, keep meeting open') : t('Leave')}
              </button>
              <button type="button" className="meeting-leave__btn is-ghost" disabled={ending} onClick={() => setLeaveOpen(false)}>{t('Cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One control-bar button: round icon with a short label underneath (the label hides on narrow screens). */
function DockButton({ icon, label, title, state = '', onClick, disabled = false, badge = null, dot = false, className = '' }) {
  return (
    <button
      type="button"
      className={`meeting-room__dock-btn ${state} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={title || label}
    >
      <span className="meeting-room__dock-ico">
        <Icon name={icon} size={20} />
        {badge ? <span className="meeting-room__badge-dot">{badge}</span> : null}
        {dot ? <span className="meeting-room__rec-dot" /> : null}
      </span>
      <span className="meeting-room__dock-label">{label}</span>
    </button>
  );
}
