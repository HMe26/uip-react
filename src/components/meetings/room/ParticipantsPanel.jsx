import { useState } from 'react';
import Icon from '../../Icon';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 6 (Host Controls) — بند 5: Participants Panel
 * (mute/remove/promote/demote/transfer/lock). Slide-in panel, same
 * "docked over the stage, not a modal" approach as ChatPanel — the call
 * keeps running behind it.
 *
 * `people` is MeetingRoomShell's own `tiles` list (local + remote,
 * already merged) — this component doesn't fetch anything itself, it's
 * pure display + action-dispatch, same division of responsibility as
 * ParticipantTile.
 *
 * Row-level actions are gated the same way ParticipantTile's own "more"
 * menu is (see that component's docblock): `myRole === 'host' ||
 * myRole === 'co_host'` for mute/disable-camera/remove-a-non-co-host,
 * `myRole === 'host'` specifically for remove-a-co-host/promote/demote/
 * make-host, and never for guests on the promote/demote/make-host row
 * (the backend rejects those with "Guests cannot be ..." — see
 * MeetingHostControlService::resolveRegisteredTarget()'s docblock).
 * Every action call is awaited here (not fire-and-forget like بند 9's
 * screen-share menu) so a per-row error — e.g. a co-host trying to
 * remove another co-host — surfaces inline instead of failing silently.
 */
export default function ParticipantsPanel({
  people, myRole, meetingLocked, isOpen, onClose,
  waiting = null, onInvite = null,
  onLockMeeting, onMute, onDisableCamera, onRemove, onPromote, onDemote, onMakeHost,
  onMuteAll = null, onSetChatMuted = null, chatMutedKeys = [],
}) {
  const t = useTranslations(translations);
  const [busyKey, setBusyKey] = useState(null);
  const [rowError, setRowError] = useState(null); // {key, message}
  const [confirmRemove, setConfirmRemove] = useState(null); // participant key pending a "are you sure"

  if (!isOpen) return null;

  const isManager = myRole === 'host' || myRole === 'co_host';
  const isPrimaryHost = myRole === 'host';

  async function run(key, action) {
    setBusyKey(key);
    setRowError(null);
    try {
      await action();
    } catch (err) {
      setRowError({ key, message: err?.message || t('This action could not be completed.') });
    } finally {
      setBusyKey(null);
    }
  }

  const roleLabel = (role) => {
    if (role === 'host') return t('Host');
    if (role === 'co_host') return t('Moderator');
    if (role === 'guest') return t('Guest');
    return t('Participant');
  };

  return (
    <div className="meeting-participants-panel">
      <div className="meeting-chat-panel__header">
        <strong>{t('Participants')}</strong>
        <span className="badge badge-neutral" style={{ marginInlineStart: 6 }}>{people.length}</span>
        <button type="button" className="meeting-room__control-btn" style={{ width: 32, height: 32, marginInlineStart: 'auto' }} onClick={onClose} title={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {isManager && onInvite && (
        <button type="button" className="meeting-participants-panel__invite" onClick={onInvite}>
          <Icon name="link" size={15} /> {t('Invite people')}
        </button>
      )}

      {isManager && waiting && waiting.requests.length > 0 && (
        <div className="meeting-participants-panel__waiting">
          <div className="meeting-participants-panel__waiting-head">
            <strong>{t('Waiting to join')} <span className="badge badge-warning">{waiting.requests.length}</span></strong>
            <span>
              <button type="button" disabled={waiting.busyAll} onClick={waiting.rejectAll}>{t('Deny All')}</button>
              <button type="button" className="is-primary" disabled={waiting.busyAll} onClick={waiting.admitAll}>{t('Admit All')}</button>
            </span>
          </div>
          {waiting.requests.map((r) => (
            <div key={r.id} className="meeting-participants-panel__wait-row">
              <span className="meeting-participants-panel__wait-name">
                {r.display_label}
                {r.is_guest && <span className="badge badge-neutral" style={{ marginInlineStart: 6 }}>{t('Guest')}</span>}
              </span>
              <span>
                <button type="button" disabled={waiting.busyId === r.id} onClick={() => waiting.reject(r.id)}>{t('Reject')}</button>
                <button type="button" className="is-primary" disabled={waiting.busyId === r.id} onClick={() => waiting.admit(r.id)}>{t('Admit')}</button>
              </span>
            </div>
          ))}
          {waiting.error && <p className="form-error" style={{ margin: '4px 0 0' }}>{waiting.error}</p>}
        </div>
      )}

      {isManager && (
        <label className="meeting-participants-panel__lock-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="lock" size={14} />
            {t('Lock meeting')}
          </span>
          <input
            type="checkbox"
            checked={!!meetingLocked}
            onChange={(e) => run('__lock__', () => onLockMeeting(e.target.checked))}
            disabled={busyKey === '__lock__'}
          />
        </label>
      )}
      {isManager && onMuteAll && (
        <div className="meeting-participants-panel__lock-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="mic-off" size={14} />
            {t('Mute everyone')}
          </span>
          <button type="button" className="mc-pill" disabled={busyKey === '__muteall__'} onClick={() => run('__muteall__', onMuteAll)}>
            {busyKey === '__muteall__' ? '…' : t('Mute all')}
          </button>
        </div>
      )}
      {rowError?.key === '__muteall__' && <p className="form-error" style={{ margin: '4px 16px' }}>{rowError.message}</p>}
      {!isManager && meetingLocked && (
        <p className="text-caption" style={{ margin: 0, padding: '6px var(--space-4)', color: 'var(--mr-muted)' }}>
          <Icon name="lock" size={12} style={{ verticalAlign: '-2px', marginInlineEnd: 4 }} />
          {t('This meeting is locked — no one else can join.')}
        </p>
      )}

      <div className="meeting-participants-panel__list">
        {people.map((p) => {
          const isLocalRow = p.key === 'local';
          const canManageRow = isManager && !isLocalRow;
          const canPrimaryRow = isPrimaryHost && !isLocalRow && !p.isGuest;
          const busy = busyKey === p.key;

          return (
            <div key={p.key} className="meeting-participants-panel__row">
              <div className="meeting-participants-panel__identity">
                <span className="meeting-participants-panel__avatar">{(p.displayName || '?').trim().charAt(0).toUpperCase() || '?'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isLocalRow ? `${p.displayName} (${t('You')})` : p.displayName}
                  </span>
                  <span className="text-caption" style={{ color: 'var(--mr-muted)' }}>{roleLabel(p.role)}</span>
                </span>
              </div>

              <div className="meeting-participants-panel__status">
                {!p.micEnabled && <Icon name="mic-off" size={14} style={{ color: '#f87171' }} title={t('Muted')} />}
                {p.cameraEnabled === false && <Icon name="video-off" size={14} style={{ color: '#f87171' }} title={t('Camera off')} />}
                {p.handRaised && <Icon name="hand" size={14} style={{ color: '#fbbf24' }} title={t('Hand raised')} />}
                {chatMutedKeys.includes(p.key) && <Icon name="message-square" size={14} style={{ color: '#f87171' }} title={t('Chat turned off for this person')} />}
              </div>

              {canManageRow && (
                <div className="meeting-participants-panel__actions">
                  {p.micEnabled && (
                    <button type="button" disabled={busy} onClick={() => run(p.key, () => onMute(p.key))} title={t('Mute')}>
                      <Icon name="mic-off" size={14} />
                    </button>
                  )}
                  {onSetChatMuted && p.role !== 'host' && p.role !== 'co_host' && (
                    <button
                      type="button"
                      className={chatMutedKeys.includes(p.key) ? 'is-on' : ''}
                      disabled={busy}
                      onClick={() => run(p.key, () => onSetChatMuted(p.key, !chatMutedKeys.includes(p.key)))}
                      title={chatMutedKeys.includes(p.key) ? t('Allow this person to chat') : t('Turn off chat for this person')}
                    >
                      <Icon name="message-square" size={14} />
                    </button>
                  )}
                  {p.cameraEnabled !== false && (
                    <button type="button" disabled={busy} onClick={() => run(p.key, () => onDisableCamera(p.key))} title={t('Turn off camera')}>
                      <Icon name="video-off" size={14} />
                    </button>
                  )}
                  {canPrimaryRow && p.role === 'participant' && (
                    <button type="button" disabled={busy} onClick={() => run(p.key, () => onPromote(p.key))} title={t('Promote to moderator')}>
                      <Icon name="shield" size={14} />
                    </button>
                  )}
                  {canPrimaryRow && p.role === 'co_host' && (
                    <button type="button" disabled={busy} onClick={() => run(p.key, () => onDemote(p.key))} title={t('Remove moderator')}>
                      <Icon name="shield" size={14} />
                    </button>
                  )}
                  {canPrimaryRow && (
                    <button type="button" disabled={busy} onClick={() => run(p.key, () => onMakeHost(p.key))} title={t('Make host')}>
                      <Icon name="crown" size={14} />
                    </button>
                  )}
                  {(isPrimaryHost || p.role !== 'co_host') && (
                    confirmRemove === p.key ? (
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busy}
                        onClick={() => { setConfirmRemove(null); run(p.key, () => onRemove(p.key)); }}
                        title={t('Click again to confirm')}
                      >
                        <Icon name="check" size={14} />
                      </button>
                    ) : (
                      <button type="button" className="is-danger" disabled={busy} onClick={() => setConfirmRemove(p.key)} title={t('Remove from meeting')}>
                        <Icon name="user-x" size={14} />
                      </button>
                    )
                  )}
                </div>
              )}

              {rowError?.key === p.key && (
                <p className="form-error" style={{ margin: '2px 0 0', width: '100%' }}>{rowError.message}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
