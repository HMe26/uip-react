import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/messaging-analytics';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = {
  ...i18nCommon, ...i18nPage,
  'Open': 'فتح',
  'Back to Messaging Oversight': 'العودة إلى مراقبة الرسائل',
};

/**
 * Mirrors app/Views/admin/messaging-analytics.php, talking to the real
 * JSON API (AdminMessagingOversightApiController::analytics() — reuses
 * the exact same MessagingService::adminAnalytics() call the Blade view
 * already made). Same data as before; Admin design.
 */

function Kpi({ label, value, icon, note }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__top">{label} <Icon name={icon} size={16} /></div>
      <div className="adm-kpi__value">{value}</div>
      <div className="adm-kpi__note">{note}</div>
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString();

export default function AdminMessagingAnalytics() {
  const t = useTranslations(translations);
  const [a, setA] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/admin/messaging/analytics')
      .then((json) => setA(json.data || {}))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const head = (
    <div className="page-header animate-rise-in">
      <div className="page-header__title">
        <h1 className="text-h1">{t('Messaging Analytics')}</h1>
        <p className="text-small">{t('Platform-wide messaging usage, across every portal.')}</p>
      </div>
      <div className="page-header__actions">
        <BackLink to="/admin/messaging/oversight" className="btn btn-outline"><Icon name="arrow-left" size={16} /> {t('Messaging Oversight')}</BackLink>
      </div>
    </div>
  );

  if (loading) return <>{head}<Skeleton rows={6} cols={4} /></>;
  if (error) return <>{head}<ErrorState error={error} /></>;

  const storageMb = Math.round(((a.storage_bytes || 0) / 1048576) * 10) / 10;
  const top = a.top_conversations || [];
  const maxCount = Math.max(1, ...top.map((c) => Number(c.message_count) || 0));

  return (
    <>
      {head}

      <div className="adm-kpis">
        <Kpi label={t('Total Conversations')} value={fmt(a.total_conversations)} icon="inbox" note={t('all portals')} />
        <Kpi label={t('Group / Direct')} value={`${fmt(a.group_conversations)} / ${fmt(a.direct_conversations)}`} icon="users" note={t('groups and direct chats')} />
        <Kpi label={t('Total Messages')} value={fmt(a.total_messages)} icon="chat" note={t('since the platform started')} />
        <Kpi label={t('Messages Today')} value={fmt(a.messages_today)} icon="calendar" note={t('sent since midnight')} />
      </div>
      <div className="adm-kpis">
        <Kpi label={t('Messages (7 days)')} value={fmt(a.messages_this_week)} icon="trend" note={t('last 7 days')} />
        <Kpi label={t('Active Users (7 days)')} value={fmt(a.active_users_7d)} icon="user" note={t('sent at least one message')} />
        <Kpi label={t('Total Attachments')} value={fmt(a.total_attachments)} icon="paperclip" note={t('files shared in chats')} />
        <Kpi label={t('Attachment Storage')} value={`${storageMb.toLocaleString()} MB`} icon="archive" note={t('disk space used')} />
      </div>

      <div className="adm-panel__head" style={{ marginBottom: 10 }}><h3>{t('Top 5 Most Active Conversations')}</h3></div>
      {top.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center' }}>
          <p className="adm-empty">{t('No data yet.')}</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>#</th><th>{t('Conversation')}</th><th>{t('Type')}</th><th className="is-num">{t('Messages')}</th></tr>
            </thead>
            <tbody>
              {top.map((c, i) => {
                const n = Number(c.message_count) || 0;
                return (
                  <tr key={c.id}>
                    <td className="is-rank">{i + 1}</td>
                    <td>
                      <Link to={`/admin/messaging/oversight/${c.id}`} style={{ fontWeight: 600 }}>
                        {c.is_group ? (c.group_name || t('Group')) : (c.subject || `#${c.id}`)}
                      </Link>
                    </td>
                    <td><span className={`badge ${c.is_group ? 'badge-primary' : 'badge-neutral'}`}>{c.is_group ? t('Group') : t('Direct')}</span></td>
                    <td className="is-num">
                      <div className="adm-share">
                        <span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${(n / maxCount) * 100}%` }} /></span>
                        <b>{fmt(n)}</b>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
