import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { Avatar, SgSkeleton, clockTime, dayKeyOf, dayLabel } from '../../components/student/groupUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/group-chat';

const translations = { ...i18nCommon, ...i18nPage };
const MESSAGING_BASE = '/api/v1/messaging';

/**
 * Group chat. GET /api/v1/group-chat resolves (creating if needed) the
 * project-group conversation; sending reuses the shared messaging surface
 * (POST /api/v1/messaging/conversations/{id}/messages). Polls every 5 s.
 */
export default function StudentGroupChat() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  const [conversationId, setConversationId] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const boxRef = useRef(null);
  const stickRef = useRef(true);

  usePageMeta(groupName || (ar ? 'دردشة المجموعة' : 'Group Chat'), t('This is your private project group channel.'));

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    return api.get('/api/v1/group-chat')
      .then((json) => {
        setConversationId(json.data.conversation_id);
        setGroupName(json.data.group_name || '');
        setParticipants(json.data.participants || []);
        setMessages(json.data.messages || []);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!conversationId) return undefined;
    const id = setInterval(() => load(true), 5000);
    return () => clearInterval(id);
  }, [conversationId, load]);

  // Only follow new messages while the reader is already at the bottom.
  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = boxRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const onSend = async (e) => {
    e?.preventDefault();
    const value = body.trim();
    if (!value || !conversationId || sending) return;
    setSending(true);
    const fd = new FormData();
    fd.append('body', value);
    try {
      const res = await api.postForm(`${MESSAGING_BASE}/conversations/${conversationId}/messages`, fd);
      stickRef.current = true;
      setMessages((prev) => [...prev, res.data]);
      setBody('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(e); }
  };

  // Day separators + "first of a run" flags so avatars/names show once per run.
  const rows = useMemo(() => {
    const out = [];
    let prevDay = '';
    let prevWho = '';
    messages.forEach((m, i) => {
      const day = dayKeyOf(m.created_at);
      const who = m.is_mine ? '__me' : (m.sender_name || '');
      const newDay = day !== prevDay;
      if (newDay) out.push({ kind: 'day', key: `d-${day}-${i}`, label: dayLabel(m.created_at, locale) });
      const first = newDay || who !== prevWho;
      const next = messages[i + 1];
      const last = !next || dayKeyOf(next.created_at) !== day || (next.is_mine ? '__me' : (next.sender_name || '')) !== who;
      out.push({ kind: 'msg', key: m.id ?? `m-${i}`, m, first, last });
      prevDay = day; prevWho = who;
    });
    return out;
  }, [messages, locale]);

  if (loading) return <SgSkeleton rows={2} h={220} />;

  if (error && !conversationId) {
    return (
      <div className="ex-page">
        <div className="ex-card">
          <div className="sg-empty-inline"><Icon name="users" size={36} /><span>{error}</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="ex-page">
      <div className="sg-chat">
        <div className="ex-card sg-chat__card">
          <div className="sg-chat__head">
            <Avatar name={groupName || 'G'} size="md" />
            <div className="sg-chat__title">
              <strong>{groupName || (ar ? 'دردشة المجموعة' : 'Group Chat')}</strong>
              <span>{ar ? `${participants.length} أعضاء` : `${participants.length} members`}</span>
            </div>
            <div className="sg-chat__links">
              <Link to="/student/group-hub" className="btn btn-outline btn-sm"><Icon name="file" size={14} /> {t('Group Hub')}</Link>
              <Link to="/student/messages" className="btn btn-outline btn-sm"><Icon name="message" size={14} /> {t('All Messages')}</Link>
            </div>
          </div>

          {error && <div className="st-alert st-alert--danger" style={{ margin: '10px 16px 0' }}><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}

          <div className="sg-chat__scroll" ref={boxRef} onScroll={onScroll}>
            {rows.length === 0 ? (
              <div className="sg-chat__empty">
                <Icon name="users" size={40} />
                <strong>{t('Start chatting with your group!')}</strong>
                <p>{t('This is your private project group channel.')}</p>
              </div>
            ) : rows.map((r) => {
              if (r.kind === 'day') return <div key={r.key} className="sg-day">{r.label}</div>;
              const { m, first, last } = r;
              return (
                <div key={r.key} className={`sg-msg${m.is_mine ? ' is-mine' : ''}${first ? ' is-first' : ''}`}>
                  {!m.is_mine && (
                    <div className="sg-msg__avatar">{last ? <Avatar name={m.sender_name} size="sm" /> : null}</div>
                  )}
                  <div className="sg-msg__col">
                    {!m.is_mine && first && <span className="sg-msg__name">{m.sender_name}</span>}
                    <div className="sg-bubble">{m.body}</div>
                    {last && <span className="sg-msg__time">{clockTime(m.created_at, locale)}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <form className="sg-compose" onSubmit={onSend}>
            <textarea
              className="ex-textarea"
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('Message your group… (Enter to send)')}
              aria-label={t('Message your group… (Enter to send)')}
            />
            <button type="submit" className="sg-send" disabled={sending || !body.trim()} aria-label={t('Send')} title={t('Send')}>
              <Icon name="send" size={18} />
            </button>
          </form>
        </div>

        <aside className="sg-side-col">
          <div className="ex-card sg-side">
            <h3>{t('Members:').replace(/[:：]$/, '')} ({participants.length})</h3>
            <div className="sg-side__list">
              {participants.map((p) => (
                <div key={p.id} className="sg-side__row">
                  <Avatar name={p.full_name || p.name} size="sm" />
                  <strong>{p.full_name || p.name}</strong>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
