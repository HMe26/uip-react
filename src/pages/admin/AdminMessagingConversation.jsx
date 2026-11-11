import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar, ConfirmModal } from '../../components/admin/adminUi';

import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/messaging-conversation';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/messaging-conversation.php, talking to the real
 * JSON API (AdminMessagingOversightApiController::thread()/
 * deleteMessage()/deleteAttachment() — reuses the exact same
 * MessagingService::adminThread()/adminDeleteMessage()/
 * adminDeleteAttachment() calls the Blade view already made, each view
 * logged via AuditLogService). Read-only except for force-deleting a
 * message or attachment.
 */

export default function AdminMessagingConversation() {
  const t = useTranslations(translations);
  const { id } = useParams();
  const [thread, setThread] = useState({ conversation: {}, participants: [], messages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pending, setPending] = useState(null); // { kind: 'message' | 'attachment', id }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/admin/messaging/oversight/${id}`)
      .then((json) => setThread(json.data || { conversation: {}, participants: [], messages: [] }))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function runPending() {
    setBusy(true);
    setActionError(null);
    try {
      if (pending.kind === 'message') await api.post(`/api/v1/admin/messaging/oversight/messages/${pending.id}/delete`);
      else await api.del(`/api/v1/admin/messaging/oversight/attachments/${pending.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (loading) return <Skeleton rows={6} cols={4} />;
  if (error) return <ErrorState error={error} />;

  const { conversation, participants, messages } = thread;
  const title = conversation.is_group
    ? (conversation.group_name || t('Group'))
    : (conversation.subject || participants.map((p) => p.full_name).join(', '));

  return (
    <>
      <BackLink to="/admin/messaging/oversight" className="adm-link-back"><Icon name="chevron-left" size={14} /> {t('Messaging Oversight')}</BackLink>

      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{title}</h1>
          <p className="text-small">{t('Participants')}: {participants.map((p) => p.full_name).join(', ')}</p>
        </div>
        <span className="badge badge-neutral"><Icon name="eye" size={14} /> {t('Read-only — this view was logged')}</span>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      <div className="adm-panel">
        {messages.length === 0 && (
          <p className="adm-empty" style={{ textAlign: 'center', padding: 28 }}>
            {t('No messages in this conversation.')}
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <span className="adm-person" style={{ display: 'inline-flex' }}><Avatar name={m.sender_name} /><strong>{m.sender_name || '—'}</strong></span>
                <span className="text-caption" style={{ marginInlineStart: 'var(--space-2)' }}>{m.created_at}</span>
                {m.is_edited && <span className="text-caption"> ({t('edited')})</span>}
                {m.is_deleted && <span className="badge badge-neutral">{t('deleted')}</span>}
              </div>
              {!m.is_deleted && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm adm-btn-danger"
                  onClick={() => setPending({ kind: 'message', id: m.id })}
                >
                  <Icon name="trash" size={14} /> {t('Delete')}
                </button>
              )}
            </div>

            {!m.is_deleted && (
              <>
                {m.body && <p className="text-small" style={{ marginTop: 'var(--space-1)', whiteSpace: 'pre-wrap' }}>{m.body}</p>}

                {m.attachments && m.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    {m.attachments.map((a) => (
                      <div key={a.id} className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                        <Icon name="file" size={12} />
                        <span>{a.original_name}</span>
                        <button
                          type="button"
                          title={t('Delete attachment')}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', padding: 0, display: 'flex' }}
                          onClick={() => setPending({ kind: 'attachment', id: a.id })}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {pending && (
        <ConfirmModal
          title={t('Confirm action')}
          message={pending.kind === 'message' ? t('Delete this message for everyone?') : t('Permanently delete this attachment?')}
          confirmLabel={t('Delete')}
          danger
          busy={busy}
          onConfirm={runPending}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
