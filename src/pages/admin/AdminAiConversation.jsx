import { useEffect, useMemo, useState } from 'react';
import { BackLink } from '../../lib/backStack';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar } from '../../components/admin/adminUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/ai-conversations';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

function fmt(value, locale, withDate = true) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', withDate
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
}
const dayKey = (v) => String(v || '').slice(0, 10);

/** Read-only transcript of one user <-> AI assistant conversation (the view is audit-logged server-side). */
export default function AdminAiConversation() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const { id } = useParams();
  const [thread, setThread] = useState({ conversation: {}, messages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.get(`/api/v1/admin/messaging/ai-conversations/${id}`)
      .then((json) => { if (alive) setThread(json.data || { conversation: {}, messages: [] }); })
      .catch((err) => { if (alive) setError(errorMessage(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const { conversation: c, messages } = thread;
  const stats = useMemo(() => {
    const list = messages || [];
    return {
      total: list.length,
      user: list.filter((m) => m.role !== 'assistant').length,
      ai: list.filter((m) => m.role === 'assistant').length,
      failed: list.filter((m) => m.status === 'error').length,
      first: list[0]?.created_at,
      last: list[list.length - 1]?.created_at,
    };
  }, [messages]);

  if (loading) return <Skeleton rows={6} cols={4} />;
  if (error) return <ErrorState error={error} />;

  let lastDay = null;
  return (
    <div className="aic">
      <BackLink to="/admin/messaging/ai" className="adm-link-back"><Icon name="chevron-left" size={14} /> {t('AI Conversations')}</BackLink>

      <header className="aic-hero animate-rise-in">
        <span className="aic-hero__icon"><Icon name="ai-spark" size={24} /></span>
        <div className="aic-hero__text">
          <h1>{c.title || tr('Untitled conversation', 'محادثة بدون عنوان')}</h1>
          <p className="aic-hero__meta">
            <span className="aic-user"><Avatar name={c.user_name} /> <strong>{c.user_name || '—'}</strong></span>
            {c.user_email && <span dir="ltr" className="aic-muted">{c.user_email}</span>}
            {c.user_role && <span className="badge badge-primary">{c.user_role}</span>}
            {c.portal && <span className="badge badge-info">{c.portal}</span>}
          </p>
        </div>
        <span className="aic-audit"><Icon name="eye" size={14} /> {t('Read-only — this view was logged')}</span>
      </header>

      <div className="aic-stats">
        <div className="aic-stat"><b>{stats.total}</b><span>{tr('Messages', 'الرسائل')}</span></div>
        <div className="aic-stat"><b>{stats.user}</b><span>{tr('From user', 'من المستخدم')}</span></div>
        <div className="aic-stat"><b>{stats.ai}</b><span>{tr('From AI', 'من المساعد')}</span></div>
        <div className={`aic-stat${stats.failed ? ' aic-stat--bad' : ''}`}><b>{stats.failed}</b><span>{tr('Failed', 'فاشلة')}</span></div>
        <div className="aic-stat aic-stat--wide"><b>{fmt(stats.first, locale) || '—'}</b><span>{tr('Started', 'بداية المحادثة')}</span></div>
        <div className="aic-stat aic-stat--wide"><b>{fmt(stats.last, locale) || '—'}</b><span>{tr('Last message', 'آخر رسالة')}</span></div>
      </div>

      <section className="aic-thread" aria-label={tr('Conversation transcript', 'نص المحادثة')}>
        {messages.length === 0 && <p className="aic-empty">{t('No messages in this conversation.')}</p>}
        {messages.map((m) => {
          const isAi = m.role === 'assistant';
          const k = dayKey(m.created_at);
          const showDay = k && k !== lastDay;
          lastDay = k || lastDay;
          return (
            <div key={m.id}>
              {showDay && <div className="aic-day"><span>{new Date(k).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>}
              <article className={`aic-msg ${isAi ? 'aic-msg--ai' : 'aic-msg--user'}${m.is_deleted ? ' is-deleted' : ''}${m.status === 'error' ? ' is-error' : ''}`}>
                <span className="aic-msg__avatar">{isAi ? <Icon name="ai-spark" size={16} /> : <Avatar name={c.user_name} />}</span>
                <div className="aic-msg__main">
                  <div className="aic-msg__head">
                    <strong>{isAi ? t('AI Assistant') : (c.user_name || '—')}</strong>
                    <time>{fmt(m.created_at, locale, false)}</time>
                    {isAi && m.model && <span className="aic-tag">{m.model}</span>}
                    {isAi && m.answer_source === 'predefined' && <span className="aic-tag">{t('Predefined answer')}</span>}
                    {m.edited_at && <span className="aic-tag">{t('edited')}</span>}
                    {m.is_deleted && <span className="aic-tag aic-tag--warn">{t('deleted by user')}</span>}
                    {m.status === 'error' && <span className="aic-tag aic-tag--bad">{t('failed')}</span>}
                  </div>
                  <div className="aic-bubble" dir="auto">{m.content}</div>
                  {m.error_message && <p className="aic-error"><Icon name="alert-triangle" size={13} /> {m.error_message}</p>}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="aic-files">
                      {m.attachments.map((a) => <span key={a.id} className="aic-file"><Icon name="file" size={13} /> {a.original_name}</span>)}
                    </div>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </section>
    </div>
  );
}
