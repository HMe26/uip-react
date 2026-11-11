import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { portalPrefix } from '../../config/navConfig';
import MeetingRoomShell from '../../components/meetings/room/MeetingRoomShell';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 3-4 (Signaling + WebRTC Core). Thin route wrapper: loads just
 * enough of the meeting (title, settings.mute_on_entry/camera_on_entry —
 * same device_defaults shape as MeetingLobbyService::preJoinInfo(), Round
 * 2) to hand off to MeetingRoomShell, which does the actual signaling
 * work. `myKey` mirrors MeetingSignalingService::resolveActor()'s
 * `'user:' . $authUserId` exactly — the signaling REST calls and the
 * presence-channel identity must agree on this format or nothing lines
 * up. Reaching this page assumes a `meeting_participants` row already
 * exists with status=joined (created by MeetingLobbyService::
 * requestAccess() — see Round 2's /join/{token} flow); if it doesn't
 * (someone typed this URL directly without ever using a join link),
 * MeetingRoomShell's own `status === 'error'` state handles that
 * gracefully rather than this page trying to detect it first.
 *
 * Round 5 additions — `isHost`/`screenSharingLockedInitial`/
 * `chatEnabledInitial` come straight off this same GET (host_user_id,
 * screen_sharing_locked, settings.allow_chat — all already in
 * MeetingsApiController::present()'s `$meeting->toArray()`, no new field
 * needed). `isHost` only covers the meeting's original host for now —
 * co-host promotion is Round 6 (Host Controls) and isn't wired up yet
 * (see useMeetingRoom's own docblock).
 */
export default function MeetingRoom() {
  const { uuid } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useTranslations(translations);
  const prefix = portalPrefix(user?.role);

  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/meetings/${uuid}`)
      .then((json) => { if (!cancelled) setMeeting(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [uuid]);

  if (error) {
    return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  }
  if (!meeting) {
    return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  }

  return (
    <MeetingRoomShell
      meetingUuid={uuid}
      meetingTitle={meeting.title}
      guestToken={null}
      myKey={`user:${user.id}`}
      myDisplayName={user.full_name || user.email}
      deviceDefaults={{
        mute_on_entry: !!meeting.settings?.mute_on_entry,
        camera_on_entry: meeting.settings?.camera_on_entry ?? true,
      }}
      isHost={meeting.host_user_id === user.id}
      screenSharingLockedInitial={!!meeting.screen_sharing_locked}
      chatEnabledInitial={meeting.settings?.allow_chat ?? true}
      meetingLockedInitial={!!meeting.locked}
      onLeave={() => navigate(`/${prefix}/meetings/${uuid}`, { replace: true })}
    />
  );
}
