import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { publicOrigin } from '../../config/siteUrl';
import { analyticsApi, attendanceApi, invitationsApi, recordingsApi } from '../../lib/meetingSignaling';
import { useAuth } from '../../context/AuthContext';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { exportFromCsvBlob } from '../../lib/exporter';
import MeetingWaitingRoomPanel from '../../components/meetings/MeetingWaitingRoomPanel';
import InviteModal from '../../components/meetings/InviteModal';
import RecordingPlayerModal, { downloadRecording } from '../../components/meetings/RecordingPlayerModal';
import { useTranslations } from '../../context/LanguageContext';
import { portalPrefix } from '../../config/navConfig';
import { DurationPicker, durationPayload } from '../../components/meetings/MeetingFormParts';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';
import '../../styles/css/pages/meeting-details.css';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 1 (Foundation) — GET/PATCH/DELETE /api/v1/meetings/{uuid} +
 * GET /api/v1/meetings/{uuid}/participants (MeetingsApiController::show/
 * update/destroy/indexParticipants), plus the three lifecycle actions
 * (cancel/start/end). join_url/meeting_code only come back from the API
 * when the caller canManage() (host or co-host, see present()'s
 * $includeJoinDetails) — everyone else only sees the public fields.
 *
 * Round 2 (Lobby & Access) addition — the Join Link card below now links
 * to this app's own Pre-Join screen (MeetingPreJoin.jsx, /join/{token})
 * instead of just displaying a bare token, and hosts get a live Waiting
 * Room panel (MeetingWaitingRoomPanel) when waiting_room_enabled and the
 * meeting hasn't ended/been cancelled — admitting someone there reloads
 * this page's Participants list.
 *
 * Round 3-4 (WebRTC Core) addition — once the host flips the meeting to
 * `live`, everyone here (host or participant) gets a "Join Room" button
 * next to the status badge that sends them straight to
 * `/${role}/meetings/{uuid}/room` (MeetingRoom.jsx). This assumes a
 * `meeting_participants` row already exists for them (created via the
 * /join/{token} flow, Round 2) — someone who was never admitted through
 * the lobby and lands here by other means gets MeetingRoomShell's own
 * `status === 'error'` state instead of a broken room. Guests never see
 * this page at all (no portal), so they only ever reach the room inline
 * from MeetingPreJoin.jsx.
 *
 * Round 7 (Collaboration Extras) addition — بند 17 (Attendance
 * Tracking): an Attendance Report card, host/co-host only
 * (`attendanceApi` is plain `uip.auth`, no guest path — see its own
 * docblock), fetched lazily (`loadAttendance`, only once `isManager` is
 * known and the card is actually rendered) rather than bundled into the
 * page's initial `load()`, since it's a second API round-trip most
 * visits to this page (a participant, or a host who hasn't opened the
 * card) never need. Export reuses the exact blob-download idiom
 * AdminAuditLogs.jsx already uses elsewhere in this app.
 *
 * Round 8 (Invitations & Calendar) addition — بند 13: an Invitations
 * card, host/co-host only, listing everyone already invited to this
 * meeting (`invitationsApi.listFor`) with an "Invite" button opening
 * InviteModal (single user_id, or bulk by role/university/group/project —
 * see that component's own docblock). Loaded lazily alongside attendance,
 * same `isManager`-gated `useEffect` reasoning.
 *
 * Round 9 (Recording) addition — بند 18: a Recordings card, listing
 * everything MediaRecorder produced during the live room (see
 * useMeetingRoom's own docblock for how those actually get made) with a
 * Download link once `completed`. Unlike Attendance/Invitations this
 * ISN'T `isManager`-gated — MeetingsRecordingsApiController's own
 * docblock says reading is open to "any actor شايف الاجتماع" (host or
 * anyone who actually joined), not just host/co-host — so it's fetched
 * for every visitor here and the card just stays hidden if that fetch
 * 403s (someone who was never a participant landing on this page some
 * other way). Delete stays `isManager`-only, same as the room's own
 * RecordingsPanel.
 *
 * Round 10 (Admin & Docs) addition — بند 15 ("Meeting Analytics" widget):
 * a small stat-card grid fed by GET /api/v1/meetings/{uuid}/analytics
 * (MeetingsAnalyticsApiController::forMeeting() -> MeetingAnalyticsService,
 * host/co-host only server-side). Same `isManager`-gated lazy-load
 * convention as Attendance/Invitations above — this is aggregate counts
 * only (never message/file/recording content itself), matching the
 * platform-wide admin monitoring dashboard's own "counters, not content"
 * scope (see AdminMeetingsMonitoring.jsx / بند 39).
 */

const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };

const STATUS_META = {
  scheduled: { cls: 'badge-primary', key: 'Scheduled' },
  lobby: { cls: 'badge-warning', key: 'In Lobby' },
  live: { cls: 'badge-success', key: 'Live' },
  ended: { cls: 'badge-neutral', key: 'Ended' },
  cancelled: { cls: 'badge-neutral', key: 'Cancelled' },
};

function EditMeetingModal({ meeting, onClose, onSaved }) {
  const t = useTranslations(translations);
  const [title, setTitle] = useState(meeting.title || '');
  const [description, setDescription] = useState(meeting.description || '');
  const [scheduledStartAt, setScheduledStartAt] = useState(
    meeting.scheduled_start_at ? meeting.scheduled_start_at.slice(0, 16) : ''
  );
  const [durationMinutes, setDurationMinutes] = useState(meeting.duration_minutes ?? null);
  const [maxParticipants, setMaxParticipants] = useState(meeting.max_participants || '');
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(!!meeting.waiting_room_enabled);
  const [allowGuests, setAllowGuests] = useState(!!meeting.allow_guests);
  const [hideChatHistory, setHideChatHistory] = useState(meeting.settings?.chat_history === 'hide');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const json = await api.patch(`/api/v1/meetings/${meeting.uuid}`, {
        title: title.trim(),
        description: description.trim() || null,
        scheduled_start_at: meeting.type === 'scheduled' && scheduledStartAt ? scheduledStartAt : null,
        duration_minutes: durationPayload(durationMinutes),
        max_participants: maxParticipants ? Number(maxParticipants) : null,
        waiting_room_enabled: waitingRoomEnabled,
        allow_guests: allowGuests,
        settings: { chat_history: hideChatHistory ? 'hide' : 'keep' },
      });
      onSaved(json.data);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Edit Meeting')}</h2>
        <form onSubmit={handleSubmit} style={CARD}>
          <div className="form-group">
            <label className="form-label">{t('Title')}</label>
            <input className="form-input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">{t('Description')}</label>
            <textarea className="form-input" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {meeting.type === 'scheduled' && (
            <div className="form-group">
              <label className="form-label">{t('Scheduled Start')}</label>
              <input className="form-input" type="datetime-local" value={scheduledStartAt} onChange={(e) => setScheduledStartAt(e.target.value)} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t('Duration')}</label>
            <DurationPicker value={durationMinutes} onChange={setDurationMinutes} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Max Participants')}</label>
            <input className="form-input" type="number" min="2" placeholder={t('No limit')} value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} />
          </div>

          <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={waitingRoomEnabled} onChange={(e) => setWaitingRoomEnabled(e.target.checked)} />
            {t('Waiting Room')}
          </label>

          <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={allowGuests} onChange={(e) => setAllowGuests(e.target.checked)} />
            {t('Allow Guests')}
          </label>

          <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={hideChatHistory} onChange={(e) => setHideChatHistory(e.target.checked)} />
            {t('Hide earlier chat from late joiners')}
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>{saving ? '…' : t('Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MeetingDetails() {
  const { uuid } = useParams();
  const t = useTranslations(translations);
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefix = portalPrefix(user?.role);

  const [meeting, setMeeting] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Round 7 — بند 17 (Attendance Tracking).
  const [attendance, setAttendance] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Round 8 — بند 13 (Invitations).
  const [invitations, setInvitations] = useState(null);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationsError, setInvitationsError] = useState(null);
  const [inviting, setInviting] = useState(false);

  // Round 9 — بند 18 (Recording).
  const [recordings, setRecordings] = useState(null); // null = not yet loaded/unavailable; [] = loaded, empty
  const [recordingsBusyId, setRecordingsBusyId] = useState(null);
  const [playing, setPlaying] = useState(null); // the recording open in the player modal

  // Round 10 — بند 15 (Meeting Analytics widget).
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  const load = useCallback(() => {
    return Promise.all([
      api.get(`/api/v1/meetings/${uuid}`).then((json) => setMeeting(json.data)),
      api.get(`/api/v1/meetings/${uuid}/participants`).then((json) => setParticipants(json.data || [])).catch(() => {}),
    ]);
  }, [uuid]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  const isHost = meeting && String(meeting.host_user_id) === String(user?.id);
  const isManager = isHost || participants.some((p) => p.role === 'co_host' && String(p.user_id) === String(user?.id));

  const loadAttendance = useCallback(() => {
    setAttendanceLoading(true);
    setAttendanceError(null);
    attendanceApi.report(uuid)
      .then((json) => setAttendance(json.data?.attendance || []))
      .catch((err) => setAttendanceError(errorMessage(err)))
      .finally(() => setAttendanceLoading(false));
  }, [uuid]);

  useEffect(() => {
    if (isManager) loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, uuid]);

  const loadInvitations = useCallback(() => {
    setInvitationsLoading(true);
    setInvitationsError(null);
    invitationsApi.listFor(uuid)
      .then((json) => setInvitations(json.data || []))
      .catch((err) => setInvitationsError(errorMessage(err)))
      .finally(() => setInvitationsLoading(false));
  }, [uuid]);

  useEffect(() => {
    if (isManager) loadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, uuid]);

  const loadAnalytics = useCallback(() => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    analyticsApi.forMeeting(uuid)
      .then((json) => setAnalytics(json.data || {}))
      .catch((err) => setAnalyticsError(errorMessage(err)))
      .finally(() => setAnalyticsLoading(false));
  }, [uuid]);

  useEffect(() => {
    if (isManager) loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, uuid]);

  // Round 9 — بند 18. No `isManager` gate (see docblock above) — just a
  // silent no-op on 403, same "hide the card rather than show an error"
  // choice as a plain visitor with no `meeting_participants` row landing
  // on this page.
  useEffect(() => {
    let cancelled = false;
    recordingsApi.list(uuid)
      .then((json) => { if (!cancelled) setRecordings(json.data?.recordings || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uuid]);

  async function handleDeleteRecording(recordingId) {
    if (!window.confirm(t('Delete this recording for everyone?'))) return;
    setRecordingsBusyId(recordingId);
    try {
      await recordingsApi.destroy(uuid, null, recordingId);
      setRecordings((prev) => (prev || []).filter((r) => r.id !== recordingId));
    } catch (err) {
      alert(errorMessage(err));
    } finally {
      setRecordingsBusyId(null);
    }
  }

  function formatRecordingDuration(seconds) {
    if (seconds == null) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const RECORDING_STATUS_META = {
    recording: { cls: 'badge-danger', key: 'Recording…' },
    processing: { cls: 'badge-warning', key: 'Processing…' },
    completed: { cls: 'badge-success', key: 'Ready' },
    failed: { cls: 'badge-neutral', key: 'Failed' },
  };

  function handleInviteSent() {
    setInviting(false);
    loadInvitations();
  }

  const INVITATION_STATUS_META = {
    pending: { cls: 'badge-warning', key: 'Pending' },
    accepted: { cls: 'badge-success', key: 'Accepted' },
    declined: { cls: 'badge-neutral', key: 'Declined' },
    expired: { cls: 'badge-neutral', key: 'Expired' },
    cancelled: { cls: 'badge-neutral', key: 'Cancelled' },
  };

  async function handleExportAttendance(format) {
    setExporting(true);
    try {
      const response = await attendanceApi.export(uuid);
      await exportFromCsvBlob(await response.blob(), {
        format,
        filename: `attendance-${uuid}`,
        title: meeting?.title ? `${t('Attendance Report')} — ${meeting.title}` : t('Attendance Report'),
        // CSV headers come from the API in English: show them in the reader's language, and add a short summary under the PDF title
        mapRows: ({ headers, rows }) => ({ headers: headers.map((h) => t(h)), rows }),
        meta: (() => {
          const list = attendance || [];
          if (!list.length) return [];
          const avg = list.reduce((sum, r) => sum + (Number(r.attendance_percentage) || 0), 0) / list.length;
          return [
            { label: t('Participants'), value: String(list.length) },
            { label: t('Average attendance'), value: `${avg.toFixed(1)}%` },
          ];
        })(),
      });
    } catch {
      alert(t('Export failed. Please try again.'));
    } finally {
      setExporting(false);
    }
  }

  function formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} ${t('minutes')}`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  async function runAction(action, confirmMessage) {
    if (confirmMessage && !window.confirm(t(confirmMessage))) return;
    setBusy(true);
    setActionError(null);
    try {
      const json = await api.post(`/api/v1/meetings/${uuid}/${action}`);
      setMeeting(json.data);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('Delete this meeting? This cannot be undone.'))) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.del(`/api/v1/meetings/${uuid}`);
      navigate(`/${prefix}/meetings`, { replace: true });
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  function copyJoinLink() {
    if (!joinAppUrl) return;
    navigator.clipboard?.writeText(joinAppUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  if (!meeting) return null;

  const meta = STATUS_META[meeting.status] || STATUS_META.scheduled;
  // meeting.join_url is either "{frontend_join_base_url}/{join_token}" or,
  // when that config is unset, just the bare join_token (see
  // MeetingsApiController::present()'s docblock) — either way the token is
  // the last path segment, and this app owns the /join/{token} route
  // itself (MeetingPreJoin.jsx), so always link to our own origin rather
  // than trusting an unset/foreign base URL.
  const joinToken = meeting.join_url ? meeting.join_url.split('/').filter(Boolean).pop() : null;
  const joinAppUrl = joinToken ? `${publicOrigin()}/join/${joinToken}` : null;
  const waitingRoomActive = isHost && meeting.waiting_room_enabled && !['ended', 'cancelled'].includes(meeting.status);

  const hostEntry = participants.find((p) => p.role === 'host');
  const hostName = isHost ? t('You') : (hostEntry?.user?.full_name || hostEntry?.user?.email || `#${meeting.host_user_id}`);
  const roleLabel = (role) => (role === 'host' ? t('Host') : role === 'co_host' ? t('Moderator') : role === 'guest' ? t('Guest') : t('Participant'));
  const facts = [
    { icon: 'meeting-type', label: t('Type'), value: t(meeting.type === 'scheduled' ? 'Scheduled' : 'Instant') },
    { icon: 'calendar', label: t('Scheduled Start'), value: meeting.scheduled_start_at ? new Date(meeting.scheduled_start_at).toLocaleString() : t('Opens right away') },
    { icon: 'clock', label: t('Duration'), value: meeting.duration_minutes ? `${meeting.duration_minutes} ${t('minutes')}` : t('Open-ended') },
    { icon: 'users', label: t('Max Participants'), value: meeting.max_participants ?? t('No limit') },
    { icon: 'inbox', label: t('Waiting Room'), value: meeting.waiting_room_enabled ? t('On') : t('Off'), on: !!meeting.waiting_room_enabled },
    { icon: 'user', label: t('Allow Guests'), value: meeting.allow_guests ? t('On') : t('Off'), on: !!meeting.allow_guests },
  ];

  return (
    <div className="md-page">
      <div>
        <Link to={`/${prefix}/meetings`} className="md-back">
          <Icon name="chevron-right" size={14} className="md-back__ico" /> {t('Back to My Meetings')}
        </Link>
      </div>

      <section className="md-hero">
        <div className="md-hero__main">
          <div className="md-hero__badges">
            <span className={`badge ${meta.cls}`}>{meeting.status === 'live' && <span className="md-live-dot" />}{t(meta.key)}</span>
            {meeting.has_password && <span className="badge badge-neutral"><Icon name="lock" size={12} /> {t('Password protected')}</span>}
          </div>
          <h1 className="md-hero__title">{meeting.title}</h1>
          <p className="md-hero__host">
            <span className="md-avatar md-avatar--sm">{String(hostName).trim().charAt(0).toUpperCase()}</span>
            {t('Host')}: <strong>{hostName}</strong>
          </p>
          {meeting.description && <p className="md-hero__desc">{meeting.description}</p>}
        </div>
        {meeting.status === 'live' && (
          <button type="button" className="btn btn-primary md-hero__cta" onClick={() => navigate(`/${prefix}/meetings/${uuid}/room`)}>
            <Icon name="meeting-type" size={16} /> {t('Join Room')}
          </button>
        )}
      </section>

      {actionError && <p className="form-error">{actionError}</p>}

      <section className="md-facts">
        {facts.map((f) => (
          <div key={f.label} className="md-fact">
            <span className="md-fact__ico"><Icon name={f.icon} size={16} /></span>
            <span className="md-fact__text">
              <span className="md-fact__label">{f.label}</span>
              <span className={`md-fact__value ${f.on === true ? 'is-on' : ''}`}>{f.value}</span>
            </span>
          </div>
        ))}
      </section>

      {isHost && joinAppUrl && (
        <div className="card glass-panel md-card">
          <h2 className="md-card__title">{t('Join Link')}</h2>
          <div className="md-link-row">
            <code className="md-link-row__url" dir="ltr">{joinAppUrl}</code>
            <button type="button" className={`btn btn-sm ${copied ? 'btn-primary' : 'btn-outline'}`} onClick={copyJoinLink}>
              <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? t('Copied!') : t('Copy')}
            </button>
          </div>
          {meeting.meeting_code && (
            <p className="md-card__hint">{t('Meeting Code')}: <strong dir="ltr" style={{ unicodeBidi: 'isolate' }}>{meeting.meeting_code}</strong></p>
          )}
        </div>
      )}

      {waitingRoomActive && (
        <MeetingWaitingRoomPanel meetingUuid={uuid} onAdmitted={load} />
      )}

      <div className="card glass-panel md-card">
        <h2 className="md-card__title">{t('Participants')} <span className="md-count">{participants.length}</span></h2>
        {participants.length === 0 ? (
          <p className="md-empty">{t('No participants yet.')}</p>
        ) : (
          <ul className="md-people">
            {participants.map((p) => {
              const name = p.user?.full_name || p.user?.email || `#${p.user_id}`;
              return (
                <li key={p.id} className="md-person">
                  <span className="md-avatar">{String(name).trim().charAt(0).toUpperCase()}</span>
                  <span className="md-person__name">{name}</span>
                  <span className={`badge ${p.role === 'host' ? 'badge-primary' : 'badge-neutral'}`}>{roleLabel(p.role)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isManager && (
        <div className="card glass-panel" style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <h2 className="text-h3" style={{ margin: 0 }}>{t('Attendance Report')}</h2>
            <ExportMenu className="btn btn-outline btn-sm" iconSize={14} disabled={!attendance?.length} busy={exporting} onExport={handleExportAttendance} />
          </div>
          {attendanceLoading && <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('Loading…')}</p>}
          {attendanceError && <p className="form-error">{attendanceError}</p>}
          {!attendanceLoading && !attendanceError && (
            (attendance || []).length === 0 ? (
              <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('No attendance recorded yet.')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="text-small md-att" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'start' }}>
                      <th style={{ padding: '4px 8px' }}>{t('Participant')}</th>
                      <th style={{ padding: '4px 8px' }}>{t('First Joined')}</th>
                      <th style={{ padding: '4px 8px' }}>{t('Last Left')}</th>
                      <th style={{ padding: '4px 8px' }}>{t('Duration')}</th>
                      <th style={{ padding: '4px 8px' }}>{t('Joins')}</th>
                      <th style={{ padding: '4px 8px' }}>{t('Leaves')}</th>
                      <th style={{ padding: '4px 8px' }}>{t('Attendance %')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.map((row) => (
                      <tr key={row.participant_key} style={{ borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))' }}>
                        <td data-label={t('Participant')} style={{ padding: '4px 8px' }}>{row.display_name}</td>
                        <td data-label={t('First Joined')} style={{ padding: '4px 8px' }}>{row.joined_at ? new Date(row.joined_at).toLocaleString() : '—'}</td>
                        <td data-label={t('Last Left')} style={{ padding: '4px 8px' }}>{row.left_at ? new Date(row.left_at).toLocaleString() : t('Still in meeting')}</td>
                        <td data-label={t('Duration')} style={{ padding: '4px 8px' }}>{formatDuration(row.duration_seconds)}</td>
                        <td data-label={t('Joins')} style={{ padding: '4px 8px' }}>{row.joins}</td>
                        <td data-label={t('Leaves')} style={{ padding: '4px 8px' }}>{row.leaves}</td>
                        <td data-label={t('Attendance %')} style={{ padding: '4px 8px' }}>{row.attendance_percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {isManager && (
        <div className="card glass-panel" style={CARD}>
          <h2 className="text-h3" style={{ margin: 0 }}>{t('Meeting Analytics')}</h2>
          {analyticsLoading && <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('Loading…')}</p>}
          {analyticsError && <p className="form-error">{analyticsError}</p>}
          {!analyticsLoading && !analyticsError && analytics && (
            <div className="md-stats">
              <div className="md-stat">
                <p className="md-stat__label">{t('Joined')}</p>
                <p className="md-stat__value">{analytics.joined_count ?? 0}</p>
              </div>
              <div className="md-stat">
                <p className="md-stat__label">{t('Peak Participants')}</p>
                <p className="md-stat__value">{analytics.peak_participants ?? 0}</p>
              </div>
              <div className="md-stat">
                <p className="md-stat__label">{t('Duration')}</p>
                <p className="md-stat__value">{analytics.duration_minutes != null ? `${analytics.duration_minutes} ${t('min')}` : '—'}</p>
              </div>
              <div className="md-stat">
                <p className="md-stat__label">{t('Chat Messages')}</p>
                <p className="md-stat__value">{analytics.chat_messages_count ?? 0}</p>
              </div>
              <div className="md-stat">
                <p className="md-stat__label">{t('Files Shared')}</p>
                <p className="md-stat__value">{analytics.files_shared_count ?? 0}</p>
              </div>
              <div className="md-stat">
                <p className="md-stat__label">{t('Recordings')}</p>
                <p className="md-stat__value">{analytics.recordings_count ?? 0}</p>
              </div>
              <div className="md-stat">
                <p className="md-stat__label">{t('Failed Connections')}</p>
                <p className="md-stat__value">{analytics.failed_connections ?? 0}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {isManager && (
        <div className="card glass-panel" style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <h2 className="text-h3" style={{ margin: 0 }}>{t('Invitations')}</h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviting(true)}>
              <Icon name="mail" size={14} /> {t('Invite')}
            </button>
          </div>
          {invitationsLoading && <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('Loading…')}</p>}
          {invitationsError && <p className="form-error">{invitationsError}</p>}
          {!invitationsLoading && !invitationsError && (
            (invitations || []).length === 0 ? (
              <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{t('No invitations sent yet.')}</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {invitations.map((inv) => {
                  const meta = INVITATION_STATUS_META[inv.status] || INVITATION_STATUS_META.pending;
                  return (
                    <li key={inv.id} className="text-small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span>{inv.invited_user?.full_name || inv.invited_user?.email || `#${inv.invited_user_id}`}</span>
                      <span className={`badge ${meta.cls}`}>{t(meta.key)}</span>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </div>
      )}

      {inviting && (
        <InviteModal meetingUuid={uuid} onClose={() => setInviting(false)} onSent={handleInviteSent} />
      )}

      {recordings && recordings.length > 0 && (
        <div className="card glass-panel" style={CARD}>
          <h2 className="text-h3" style={{ margin: 0 }}>{t('Recordings')}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {recordings.map((r) => {
              const meta = RECORDING_STATUS_META[r.status] || RECORDING_STATUS_META.processing;
              return (
                <li key={r.id} className="text-small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Icon name={r.kind === 'audio' ? 'mic' : 'monitor'} size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.original_name || `#${r.id}`}
                    </span>
                    <span className="text-caption" style={{ color: 'var(--text-secondary)' }}>
                      {r.started_by_display_name}
                      {r.duration_seconds != null ? ` · ${formatRecordingDuration(r.duration_seconds)}` : ''}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span className={`badge ${meta.cls}`}>{t(meta.key)}</span>
                    {r.download_url && (
                      <>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setPlaying(r)} title={t('Preview')}>
                          <Icon name="play" size={12} /> {t('Preview')}
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadRecording(r)} title={t('Download')}>
                          <Icon name="download" size={12} /> {t('Download')}
                        </button>
                      </>
                    )}
                    {isManager && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={recordingsBusyId === r.id} onClick={() => handleDeleteRecording(r.id)}>
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {playing && <RecordingPlayerModal recording={playing} onClose={() => setPlaying(null)} />}

      {isHost && (
        <div className="card glass-panel md-card">
          <h2 className="md-card__title">{t('Host controls')}</h2>
          <div className="md-actions">
            <div className="md-actions__main">
              {meeting.status === 'scheduled' && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => runAction('start')}>
                  <Icon name="play" size={14} /> {t('Start Meeting')}
                </button>
              )}
              {meeting.status === 'live' && (
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => runAction('end', 'Are you sure you want to end this meeting?')}>
                  <Icon name="stop" size={14} /> {t('End Meeting')}
                </button>
              )}
              {['scheduled', 'lobby'].includes(meeting.status) && (
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => runAction('cancel', 'Are you sure you want to cancel this meeting?')}>
                  {t('Cancel Meeting')}
                </button>
              )}
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setEditing(true)}>
                <Icon name="edit" size={14} /> {t('Edit')}
              </button>
            </div>
            <button type="button" className="btn btn-danger md-actions__danger" disabled={busy} onClick={handleDelete}>
              <Icon name="trash" size={14} /> {t('Delete Meeting')}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <EditMeetingModal
          meeting={meeting}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setMeeting(updated); setEditing(false); }}
        />
      )}
    </div>
  );
}
