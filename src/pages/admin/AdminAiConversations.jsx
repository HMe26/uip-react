import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar } from '../../components/admin/adminUi';
import MessagingTabs from '../../components/admin/MessagingTabs';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/ai-conversations';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Admin oversight of every user <-> AI assistant conversation on the platform
 * (GET /api/v1/admin/messaging/ai-conversations). Companion of
 * AdminMessagingOversight (people <-> people). Read-only; each thread view is audit-logged.
 */
export default function AdminAiConversations() {
  const t = useTranslations(translations);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const portal = searchParams.get('portal') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [searchInput, setSearchInput] = useState(search);
  const [result, setResult] = useState({ items: [], total: 0, page: 1, per_page: 20, portals: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/messaging/ai-conversations', { search, portal, page })
      .then((json) => setResult(json.data || { items: [], total: 0, page: 1, per_page: 20, portals: [] }))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [search, portal, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSearchInput(search); }, [search]);

  const setParam = (key, value, resetPage = true) => setSearchParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    if (resetPage) next.delete('page');
    return next;
  });

  const items = result.items || [];
  const totalPages = Math.max(1, Math.ceil((result.total || 0) / Math.max(1, result.per_page || 20)));

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('AI Conversations')}</h1>
          <p className="text-small">{t('Every conversation between users and the AI assistant, across every portal. Each view is logged.')}</p>
        </div>
        <div className="page-header__actions">
          <Link to="/admin/messaging/analytics" className="btn btn-outline"><Icon name="bar-chart" size={18} /> {t('Analytics')}</Link>
        </div>
      </div>

      <MessagingTabs active="ai" t={t} />

      {error && <p className="form-error">{error}</p>}

      <form onSubmit={(e) => { e.preventDefault(); setParam('search', searchInput.trim()); }} className="adm-filters">
        <div className="adm-filters__search">
          <Icon name="search" size={16} />
          <input className="form-input" type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={t('Search by title, user, email or message text...')} />
        </div>
        <select className="form-input" style={{ maxWidth: 200 }} value={portal} onChange={(e) => setParam('portal', e.target.value)}>
          <option value="">{t('All portals')}</option>
          {(result.portals || []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" className="btn btn-primary btn-sm"><Icon name="search" size={16} /> {t('Search')}</button>
      </form>

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : items.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center' }}><p className="adm-empty">{t('No matching AI conversations.')}</p></div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>{t('Conversation')}</th><th>{t('User')}</th><th>{t('Portal')}</th><th>{t('Messages')}</th><th>{t('Last Activity')}</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/admin/messaging/ai/${c.id}`} style={{ fontWeight: 600 }}>{c.title || '—'}</Link>
                    {!!Number(c.is_archived) && <span className="badge badge-neutral" style={{ marginInlineStart: 8 }}>{t('Archived')}</span>}
                  </td>
                  <td>
                    <span className="adm-person" style={{ display: 'inline-flex' }}>
                      <Avatar name={c.user_name} />
                      <span>
                        <strong style={{ display: 'block' }}>{c.user_name}</strong>
                        <span className="adm-muted">{c.user_email}{c.user_role ? ` · ${c.user_role}` : ''}</span>
                      </span>
                    </span>
                  </td>
                  <td><span className="badge badge-info">{c.portal}</span></td>
                  <td><span className="text-mono">{c.message_count}</span></td>
                  <td><span className="adm-muted">{c.last_message_at || c.created_at}</span></td>
                  <td className="adm-actions">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/admin/messaging/ai/${c.id}`)}>
                      <Icon name="eye" size={14} /> {t('View')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="adm-pager">
          <span>{(result.total || 0).toLocaleString()} {t('conversations')}</span>
          {totalPages > 1 && (
            <div>
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1), false)} aria-label={t('Previous page')}><Icon name="chevron-left" size={16} /></button>
              <span>{t('Page')} {page} {t('of')} {totalPages}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1), false)} aria-label={t('Next page')}><Icon name="chevron-right" size={16} /></button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
