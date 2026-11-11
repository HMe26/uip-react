import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { invitationsApi } from '../../lib/meetingSignaling';
import { useAuth } from '../../context/AuthContext';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import { portalPrefix } from '../../config/navConfig';
import { DurationPicker, ToggleRow, durationPayload } from '../../components/meetings/MeetingFormParts';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 1 (Foundation) — GET/POST /api/v1/meetings (MeetingsApiController::
 * index/store). One shared page for every portal (`/${role}/meetings`),
 * exactly like Messages/Notifications — see navConfig.js's
 * COMMON_ACCOUNT_ITEMS and App.jsx's routing block. `forUser()` on the
 * backend returns meetings the caller hosts *or* participates in, so this
 * list is never scoped to "meetings I created" only.
 *
 * Creation here only takes the fields MeetingsApiController::store()
 * actually requires/accepts at Round 1 — waiting room/guests/password are
 * still exposed since they're plain schema columns already, but lobby
 * enforcement, guest join links, and password verification are Round 2
 * work (MeetingsLobbyApiController) not wired into this page yet.
 *
 * Round 8 (Invitations & Calendar) addition — بند 14: a "Calendar" link
 * next to "New Meeting" heading to MeetingCalendar.jsx (its own full-page
 * route, `/${role}/meetings/calendar`, registered in App.jsx *before* the
 * `:uuid` route for the exact same "calendar mustn't be read as a uuid"
 * reason the backend registers `GET meetings/calendar` before
 * `GET meetings/{uuid}` — see routes/api.php's own comment there). بند 13:
 * a "My Invitations" section (`invitationsApi.mine()` — pending
 * invitations across every meeting, not just ones on this list) with
 * inline Accept/Decline, since accepting one changes this page's own
 * meetings list (the backend creates/updates the participant row on
 * respond — MeetingService::respondToInvitation()) — `load()` is
 * re-run after a response for that reason.
 */

const STATUS_KEY = { scheduled: 'Scheduled', lobby: 'In Lobby', live: 'Live', ended: 'Ended', cancelled: 'Cancelled' };
const isLive = (m) => m.status === 'live' || m.status === 'lobby';
const isPast = (m) => m.status === 'ended' || m.status === 'cancelled';
const startOf = (m) => new Date(m.scheduled_start_at || m.created_at || 0);

/** One meeting: date tile · title + meta · actions. Live ones glow and get a "Join now" button. */
function MeetingCard({ m, isHost, prefix, t, onDelete }) {
  const loc = t.locale === 'ar' ? 'ar-EG' : undefined;
  const live = isLive(m);
  const past = isPast(m);
  const when = m.scheduled_start_at ? new Date(m.scheduled_start_at) : null;
  const href = `/${prefix}/meetings/${m.uuid}`;
  return (
    <article className={`mm-card${live ? ' is-live' : ''}${past ? ' is-past' : ''}`}>
      <Link to={href} className="mm-date" aria-hidden="true" tabIndex={-1}>
        {live ? <span className="mm-date__live"><i /><Icon name="video" size={20} /></span>
          : when ? <><b>{when.toLocaleDateString(loc, { day: 'numeric' })}</b><small>{when.toLocaleDateString(loc, { month: 'short' })}</small></>
          : <Icon name={m.type === 'scheduled' ? 'calendar' : 'video'} size={22} />}
      </Link>
      <div className="mm-card__main">
        <div className="mm-card__top">
          <Link to={href} className="mm-card__title">{m.title}</Link>
          <span className={`mm-pill mm-pill--${m.status}`}>{live && <i />}{t(STATUS_KEY[m.status] || 'Scheduled')}</span>
        </div>
        <div className="mm-card__meta">
          <span><Icon name="clock" size={14} />{when ? when.toLocaleString(loc, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : t('No date')} · {m.duration_minutes ? `${m.duration_minutes} ${t('min')}` : t('Open-ended')}</span>
          {isHost && <span className="mm-host"><Icon name="crown" size={14} />{t('You host this')}</span>}
        </div>
      </div>
      <div className="mm-card__actions">
        <Link to={href} className={`mm-btn ${live ? 'mm-btn--go' : 'mm-btn--ghost'}`}>
          {live ? <><Icon name="video" size={15} />{t('Join now')}</> : <>{t('Open meeting')}<Icon name="arrow-right" size={15} className="mm-flip" /></>}
        </Link>
        {isHost && (
          <button type="button" className="mm-icon-btn" onClick={() => onDelete(m)} title={t('Delete')} aria-label={t('Delete')}><Icon name="trash" size={15} /></button>
        )}
      </div>
    </article>
  );
}

function CreateMeetingModal({ onClose, onCreated, initialType = 'instant' }) {
  const t = useTranslations(translations);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState(initialType);
  const [scheduledStartAt, setScheduledStartAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(null); // null = open-ended (no end time)
  const [maxParticipants, setMaxParticipants] = useState('');
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(true);
  const [allowGuests, setAllowGuests] = useState(true); // link-first: anyone with the link can join without an account
  const [hideChatHistory, setHideChatHistory] = useState(false); // false = late joiners can read the earlier chat, true = they start with an empty chat
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/meetings', {
        title: title.trim(),
        description: description.trim() || null,
        type,
        scheduled_start_at: type === 'scheduled' && scheduledStartAt ? scheduledStartAt : null,
        duration_minutes: durationPayload(durationMinutes),
        max_participants: maxParticipants ? Number(maxParticipants) : null,
        waiting_room_enabled: waitingRoomEnabled,
        allow_guests: allowGuests,
        settings: { chat_history: hideChatHistory ? 'hide' : 'keep' },
        password: password.trim() || null,
      });
      onCreated(json.data.uuid);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel mtg-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mtg-dialog__head">
          <h2>{t('Create Meeting')}</h2>
          <p>{t('Set it up in a few seconds — you can change everything later.')}</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          <div className="mtg-dialog__body">
            <div className="mtg-field">
              <label>{t('Title')}</label>
              <input className="form-input" required autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="mtg-field">
              <label>{t('Description')}</label>
              <textarea className="form-input" rows={2} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="mtg-field">
              <span className="mtg-label">{t('Type')}</span>
              <div className="mtg-seg">
                <label className={`mtg-seg__opt ${type === 'instant' ? 'is-on' : ''}`}>
                  <input type="radio" name="meeting-type" checked={type === 'instant'} onChange={() => setType('instant')} />
                  <span className="mtg-seg__ico"><Icon name="video" size={18} /></span>
                  <span className="mtg-seg__txt"><strong>{t('Instant')}</strong><span>{t('Start right now')}</span></span>
                </label>
                <label className={`mtg-seg__opt ${type === 'scheduled' ? 'is-on' : ''}`}>
                  <input type="radio" name="meeting-type" checked={type === 'scheduled'} onChange={() => setType('scheduled')} />
                  <span className="mtg-seg__ico"><Icon name="calendar" size={18} /></span>
                  <span className="mtg-seg__txt"><strong>{t('Scheduled')}</strong><span>{t('Pick a date and time')}</span></span>
                </label>
              </div>
            </div>

            {type === 'scheduled' && (
              <div className="mtg-field">
                <label>{t('Scheduled Start')}</label>
                <input className="form-input" type="datetime-local" required value={scheduledStartAt} onChange={(e) => setScheduledStartAt(e.target.value)} />
              </div>
            )}

            <div className="mtg-field">
              <span className="mtg-label">{t('Duration')}</span>
              <DurationPicker value={durationMinutes} onChange={setDurationMinutes} />
            </div>

            <div className="mtg-row">
              <div className="mtg-field">
                <label>{t('Max Participants')}</label>
                <input className="form-input" type="number" min="2" placeholder={t('No limit')} value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} />
              </div>
              <div className="mtg-field">
                <label>{t('Password (optional)')}</label>
                <input className="form-input" type="text" maxLength={100} placeholder={t('Leave blank for no password')} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <div className="mtg-toggles">
              <ToggleRow checked={waitingRoomEnabled} onChange={setWaitingRoomEnabled} title={t('Waiting Room')} hint={t('Enable a waiting room — you approve each participant before they join.')} />
              <ToggleRow checked={allowGuests} onChange={setAllowGuests} title={t('Allow Guests')} hint={t('Allow people without an account to join with a link.')} />
              <ToggleRow checked={hideChatHistory} onChange={setHideChatHistory} title={t('Hide earlier chat from late joiners')} hint={t('Off: people who join later can read what was said before them. On: they only see messages sent after they join.')} />
            </div>

            {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
          </div>

          <div className="mtg-dialog__foot">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>{saving ? '…' : t('Create Meeting')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MyMeetings() {
  const t = useTranslations(translations);
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefix = portalPrefix(user?.role);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [creating, setCreating] = useState(null); // null | 'instant' | 'scheduled'
  const [filter, setFilter] = useState('all');
  const [joinLink, setJoinLink] = useState('');
  const [joinError, setJoinError] = useState(null);

  // Round 8 — بند 13 (My Invitations).
  const [invitations, setInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [respondingId, setRespondingId] = useState(null);
  const [invitationsError, setInvitationsError] = useState(null);

  const load = useCallback(() => {
    return api.get('/api/v1/meetings').then((json) => setMeetings(json.data || []));
  }, []);

  const loadInvitations = useCallback(() => {
    setInvitationsLoading(true);
    return invitationsApi.mine()
      .then((json) => setInvitations((json.data || []).filter((inv) => inv && inv.meeting?.uuid))) // an invitation whose meeting was deleted has nothing to open or answer
      .catch((err) => setInvitationsError(errorMessage(err)))
      .finally(() => setInvitationsLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => { loadInvitations(); }, [loadInvitations]);

  async function handleRespond(invitation, accept) {
    setRespondingId(invitation.id);
    setInvitationsError(null);
    try {
      await invitationsApi.respond(invitation.meeting.uuid, invitation.id, accept);
      await Promise.all([loadInvitations(), load()]);
    } catch (err) {
      setInvitationsError(errorMessage(err));
    } finally {
      setRespondingId(null);
    }
  }

  function handleCreated(uuid) {
    setCreating(null);
    navigate(`/${prefix}/meetings/${uuid}`);
  }

  async function handleDelete(meeting) {
    if (!window.confirm(t('Delete this meeting? This cannot be undone.'))) return;
    setActionError(null);
    try {
      await api.del(`/api/v1/meetings/${meeting.uuid}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // "Join with a link": accepts the whole link or just the code at the end of it.
  function handleJoin(e) {
    e.preventDefault();
    const raw = joinLink.trim();
    // a 10-digit meeting code may be typed with spaces / dashes (213 927 1924)
    const compact = raw.replace(/[\s-]/g, '');
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(raw) || /^(\d{10})$/.exec(compact) || /^([A-Za-z0-9_-]{8,})$/.exec(raw);
    if (!m) { setJoinError(t('Paste a valid meeting link or code.')); return; }
    setJoinError(null);
    navigate(`/join/${m[1]}`);
  }

  const live = meetings.filter(isLive);
  const upcoming = meetings.filter((m) => !isLive(m) && !isPast(m)).sort((a, b) => startOf(a) - startOf(b));
  const past = meetings.filter(isPast).sort((a, b) => startOf(b) - startOf(a));
  const counts = { all: meetings.length, live: live.length, upcoming: upcoming.length, past: past.length };
  const sections = [
    { id: 'live', title: t('Live now'), items: live },
    { id: 'upcoming', title: t('Upcoming'), items: upcoming },
    { id: 'past', title: t('Past'), items: past },
  ].filter((sec) => sec.items.length > 0 && (filter === 'all' || filter === sec.id));
  const tabs = [['all', t('All')], ['live', t('Live now')], ['upcoming', t('Upcoming')], ['past', t('Past')]];

  return (
    <div className="mm-page">
      <header className="mm-hero">
        <span className="mm-hero__blob mm-hero__blob--a" aria-hidden="true" />
        <span className="mm-hero__blob mm-hero__blob--b" aria-hidden="true" />
        <div className="mm-hero__text">
          <span className="mm-eyebrow"><Icon name="video" size={14} />{t('Meetings')}</span>
          <h1>{t('My Meetings')}</h1>
          <p>{t('Host, join and follow every meeting from one place.')}</p>
          <div className="mm-hero__cta">
            <button type="button" className="mm-btn mm-btn--light" onClick={() => setCreating('instant')}>
              <Icon name="video" size={16} />{t('Instant meeting')}
            </button>
            <button type="button" className="mm-btn mm-btn--glass" onClick={() => setCreating('scheduled')}>
              <Icon name="calendar" size={16} />{t('Schedule a meeting')}
            </button>
            <Link to={`/${prefix}/meetings/calendar`} className="mm-btn mm-btn--glass">
              <Icon name="calendar" size={16} />{t('Calendar')}
            </Link>
          </div>
        </div>
        <form className="mm-join" onSubmit={handleJoin}>
          <label htmlFor="mm-join-input"><Icon name="link" size={15} />{t('Join with a link')}</label>
          <div className={`mm-join__box${joinError ? ' has-error' : ''}`}>
            <input id="mm-join-input" value={joinLink} onChange={(e) => { setJoinLink(e.target.value); setJoinError(null); }} placeholder={t('Paste a meeting link or code')} autoComplete="off" dir="ltr" />
            <button type="submit" disabled={!joinLink.trim()}>{t('Join')}</button>
          </div>
          {joinError && <small className="mm-join__err">{joinError}</small>}
        </form>
      </header>

      {error && <p className="form-error">{error}</p>}
      {actionError && <p className="form-error">{actionError}</p>}
      {invitationsError && <p className="form-error">{invitationsError}</p>}

      {!invitationsLoading && invitations.length > 0 && (
        <section className="mm-invites" aria-label={t('My Invitations')}>
          <h2><Icon name="mail" size={16} />{t('Invitations waiting for you')}<b>{invitations.length}</b></h2>
          <div className="mm-invites__row">
            {invitations.map((inv) => (
              <div className="mm-invite" key={inv.id}>
                <div className="mm-invite__txt">
                  <strong>{inv.meeting?.title}</strong>
                  <small>{t('Invited by')}: {inv.invited_by?.full_name || `#${inv.invited_by_user_id}`}</small>
                </div>
                <div className="mm-invite__btns">
                  <button type="button" className="mm-btn mm-btn--ghost mm-btn--sm" disabled={respondingId === inv.id} onClick={() => handleRespond(inv, false)}>{t('Decline')}</button>
                  <button type="button" className="mm-btn mm-btn--solid mm-btn--sm" disabled={respondingId === inv.id} onClick={() => handleRespond(inv, true)}>{respondingId === inv.id ? '…' : t('Accept')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <div className="mm-list" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="mm-card mm-skel"><span className="mm-date" /><div className="mm-card__main"><i /><i /></div></div>)}
        </div>
      ) : meetings.length === 0 ? (
        <section className="mm-empty">
          <div className="mm-empty__art" aria-hidden="true">
            <span className="mm-empty__orb"><Icon name="video" size={38} /></span>
            <span className="mm-empty__chip mm-empty__chip--1"><Icon name="calendar" size={16} /></span>
            <span className="mm-empty__chip mm-empty__chip--2"><Icon name="users" size={16} /></span>
            <span className="mm-empty__chip mm-empty__chip--3"><Icon name="link" size={16} /></span>
          </div>
          <h2>{t('Your meeting room is empty')}</h2>
          <p>{t('Start one in a click, schedule it for later, or join with a link. Everything you host or get invited to lands here.')}</p>
          <div className="mm-empty__cta">
            <button type="button" className="mm-btn mm-btn--solid" onClick={() => setCreating('instant')}><Icon name="video" size={16} />{t('Instant meeting')}</button>
            <button type="button" className="mm-btn mm-btn--ghost" onClick={() => setCreating('scheduled')}><Icon name="calendar" size={16} />{t('Schedule a meeting')}</button>
          </div>
          <ul className="mm-empty__perks">
            <li><Icon name="screen-share" size={16} />{t('Video, audio and screen sharing')}</li>
            <li><Icon name="shield" size={16} />{t('Waiting room and password')}</li>
            <li><Icon name="mail" size={16} />{t('Invite by link or email')}</li>
          </ul>
        </section>
      ) : (
        <>
          <nav className="mm-tabs" role="tablist" aria-label={t('My Meetings')}>
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`mm-tab${filter === id ? ' is-on' : ''}${id === 'live' && counts.live ? ' is-hot' : ''}`} onClick={() => setFilter(id)}>
                {id === 'live' && counts.live > 0 && <i />}{label}<b>{counts[id]}</b>
              </button>
            ))}
          </nav>
          {sections.length === 0 ? (
            <p className="mm-none">{t('No meetings in this view.')}</p>
          ) : sections.map((sec) => (
            <section key={sec.id} className="mm-section">
              <h2 className="mm-section__title">{sec.title}<span>{sec.items.length}</span></h2>
              <div className="mm-list">
                {sec.items.map((m) => (
                  <MeetingCard key={m.uuid} m={m} t={t} prefix={prefix} isHost={String(m.host_user_id) === String(user?.id)} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {creating && <CreateMeetingModal initialType={creating} onClose={() => setCreating(null)} onCreated={handleCreated} />}
    </div>
  );
}
