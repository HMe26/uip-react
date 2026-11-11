import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

const POLL_MS = 5000;

/**
 * Round 2 (Lobby & Access, بند 22 — Waiting Room). GET .../waiting-room +
 * accept/reject/accept-all/reject-all (MeetingsApiController). Polls while
 * mounted (parent only renders this for a host/co-host, and only while
 * waiting_room_enabled + the meeting can still be joined) — no
 * websocket/signaling channel exists yet for this list (that's Round 3-4),
 * so a plain interval is the honest implementation for now.
 *
 * onAdmitted() lets the parent (MeetingDetails) refresh its own
 * participants list right after an accept, instead of this panel knowing
 * anything about that other list.
 */
export default function MeetingWaitingRoomPanel({ meetingUuid, onAdmitted }) {
  const t = useTranslations(translations);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [busyBulk, setBusyBulk] = useState(false);

  const load = useCallback(() => {
    return api.get(`/api/v1/meetings/${meetingUuid}/waiting-room`)
      .then((json) => setRequests(json.data || []));
  }, [meetingUuid]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().catch((err) => { if (!cancelled) setError(errorMessage(err)); }).finally(() => { if (!cancelled) setLoading(false); });

    const timer = setInterval(() => {
      load().catch(() => {});
    }, POLL_MS);

    return () => { cancelled = true; clearInterval(timer); };
  }, [load]);

  async function decide(requestId, admit) {
    setBusyId(requestId);
    setError(null);
    try {
      await api.post(`/api/v1/meetings/${meetingUuid}/waiting-room/${requestId}/${admit ? 'accept' : 'reject'}`);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (admit) onAdmitted?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function decideAll(admit) {
    setBusyBulk(true);
    setError(null);
    try {
      await api.post(`/api/v1/meetings/${meetingUuid}/waiting-room/${admit ? 'accept-all' : 'reject-all'}`);
      setRequests([]);
      if (admit) onAdmitted?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyBulk(false);
    }
  }

  if (loading) return null;

  return (
    <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <h2 className="text-h3" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="users" size={18} /> {t('Waiting Room')}
          {requests.length > 0 && <span className="badge badge-warning">{requests.length}</span>}
        </h2>
        {requests.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={busyBulk} onClick={() => decideAll(false)}>
              {t('Deny All')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busyBulk} onClick={() => decideAll(true)}>
              {t('Admit All')}
            </button>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {requests.length === 0 ? (
        <p className="text-small" style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('No one is waiting right now.')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {requests.map((r) => (
            <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {r.display_label}
                {r.is_guest && <span className="badge badge-neutral">{t('Guest')}</span>}
              </span>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-outline btn-sm" disabled={busyId === r.id} onClick={() => decide(r.id, false)}>
                  {t('Reject')}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => decide(r.id, true)}>
                  {t('Admit')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
