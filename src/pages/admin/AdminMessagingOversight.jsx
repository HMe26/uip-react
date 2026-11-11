import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/messaging-oversight';
import i18nAi from '../../i18n/admin/ai-conversations';
import MessagingTabs from '../../components/admin/MessagingTabs';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nAi, ...i18nPage };

/**
 * Mirrors app/Views/admin/messaging-oversight.php, talking to the real
 * JSON API (app/Controllers/Api/AdminMessagingOversightApiController.php
 * — new; reuses the exact same MessagingService::adminSearchConversations()
 * call the Blade view already made). Platform-wide, cross-portal
 * moderation panel — every conversation on the platform — distinct from
 * the admin's own personal inbox (Messages.jsx / shared messaging API).
 */

export default function AdminMessagingOversight() {
  const t = useTranslations(translations);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const type = searchParams.get('type') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [searchInput, setSearchInput] = useState(search);
  const [result, setResult] = useState({ items: [], total: 0, page: 1, per_page: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/messaging/oversight', { search, type, page })
      .then((json) => setResult(json.data || { items: [], total: 0, page: 1, per_page: 20 }))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [search, type, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSearchInput(search); }, [search]);

  function submitSearch(e) {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (searchInput) next.set('search', searchInput); else next.delete('search');
      next.delete('page');
      return next;
    });
  }

  function changeType(e) {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (e.target.value) next.set('type', e.target.value); else next.delete('type');
      next.delete('page');
      return next;
    });
  }

  function goToPage(n) {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', String(n));
      return next;
    });
  }

  const items = result.items || [];
  const totalPages = Math.max(1, Math.ceil((result.total || 0) / Math.max(1, result.per_page || 20)));

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Messaging Oversight')}</h1>
          <p className="text-small">{t('Every conversation on the platform, across every portal, with an audit trail for every view or deletion.')}</p>
        </div>
        <div className="page-header__actions">
          <Link to="/admin/messaging/analytics" className="btn btn-outline">
            <Icon name="bar-chart" size={18} /> {t('Analytics')}
          </Link>
          <Link to="/admin/messaging/settings" className="btn btn-outline">
            <Icon name="settings" size={18} /> {t('Settings')}
          </Link>
        </div>
      </div>

      <MessagingTabs active="people" t={t} />

      {error && <p className="form-error">{error}</p>}

      <form onSubmit={submitSearch} className="adm-filters">
        <div className="adm-filters__search">
          <Icon name="search" size={16} />
          <input
            className="form-input"
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('Search by subject, user name, or email...')}
          />
        </div>
        <select className="form-input" style={{ maxWidth: 180 }} value={type} onChange={changeType}>
          <option value="">{t('All types')}</option>
          <option value="direct">{t('Direct')}</option>
          <option value="group">{t('Groups')}</option>
        </select>
        <button type="submit" className="btn btn-primary btn-sm"><Icon name="search" size={16} /> {t('Search')}</button>
      </form>

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : items.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center' }}>
          <p className="adm-empty">{t('No matching conversations.')}</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t('Conversation')}</th><th>{t('Type')}</th><th>{t('Participants')}</th><th>{t('Messages')}</th><th>{t('Last Activity')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const title = c.is_group ? (c.group_name || t('Group')) : (c.subject || c.participant_names || '—');
                return (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/messaging/oversight/${c.id}`} style={{ fontWeight: 600 }}>{title}</Link>
                    </td>
                    <td>
                      {c.is_group
                        ? <span className="badge badge-info">{t('Group')}</span>
                        : <span className="badge badge-neutral">{t('Direct')}</span>}
                    </td>
                    <td>
                      <span className="text-small">{c.participant_names || '—'} &nbsp;({c.participant_count})</span>
                    </td>
                    <td><span className="text-mono">{c.message_count}</span></td>
                    <td><span className="adm-muted">{c.last_message_at || c.created_at}</span></td>
                    <td className="adm-actions">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/admin/messaging/oversight/${c.id}`)}>
                        <Icon name="eye" size={14} /> {t('View')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="adm-pager">
          <span>{(result.total || 0).toLocaleString()} {t('conversations')}</span>
          {totalPages > 1 && (
            <div>
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)} aria-label={t('Previous page')}><Icon name="chevron-left" size={16} /></button>
              <span>{t('Page')} {page} {t('of')} {totalPages}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)} aria-label={t('Next page')}><Icon name="chevron-right" size={16} /></button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
