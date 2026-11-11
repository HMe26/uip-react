import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { safeHref } from '../lib/safeUrl';
import Icon from '../components/Icon';
import { useLanguage } from '../context/LanguageContext';
import { useLive } from '../hooks/useLive';
import { localizeNotification } from '../utils/notificationText';
import { parseServerDate } from '../utils/serverDate';

/**
 * React port of app/Views/components/notification-center.php +
 * notification-row.php + public/assets/js/notifications.js.
 *
 * THE single Notification Center UI for every portal — one backend surface
 * (/api/v1/notifications/*, App\Controllers\Api\NotificationsApiController)
 * and this is its one React client, mounted at every role's `/*\/notifications`
 * route (see navConfig.js's COMMON_ACCOUNT_ITEMS + App.jsx), same
 * "one system, portal only changes the URL prefix" convention already used
 * for Messages (src/pages/Messages.jsx + /api/v1/messaging/*).
 *
 * Unlike the old public/assets/js/notifications.js (which hit a bespoke
 * {portal}/notifications/search endpoint and read res.items/res.total off
 * an ad-hoc body), this talks to the newer unified REST surface:
 *   GET    /api/v1/notifications            list (filters as query params)
 *   GET    /api/v1/notifications/counts     tab badge counts (one round trip,
 *                                            not the old JS's 7x per-status
 *                                            /search calls)
 *   PATCH  /api/v1/notifications/{id}/{read|unread|pin|unpin|important|
 *                                    unimportant|archive|unarchive}
 *   POST   /api/v1/notifications/{id}/restore
 *   DELETE /api/v1/notifications/{id}        soft delete -> Trash
 *   DELETE /api/v1/notifications/{id}/purge  permanent delete
 *   POST   /api/v1/notifications/read-all
 *   POST   /api/v1/notifications/bulk        { ids, action }
 * Every response uses Controller::apiSuccess()'s {success,message,data,
 * errors,meta} envelope — list items are `data` (an array), pagination info
 * is `meta.{page,perPage,total,totalPages}`, counts are `data.{unread,read,
 * pinned,important,archived,deleted,total}`.
 */

const BASE = '/api/v1/notifications';

// Tab keys ('' = All) and the category buckets; labels live in TX below.
const TAB_KEYS = ['', 'unread', 'read', 'pinned', 'important', 'archived', 'deleted'];
const CATEGORY_KEYS = ['', 'messages', 'university', 'projects', 'ai', 'reports', 'invitations', 'files', 'security', 'system', 'general'];

const EMPTY_COUNTS = { unread: 0, read: 0, pinned: 0, important: 0, archived: 0, deleted: 0, total: 0 };

const TX = {
  en: {
    tabs: { '': 'All', unread: 'Unread', read: 'Read', pinned: 'Pinned', important: 'Important', archived: 'Archived', deleted: 'Trash' },
    categories: { '': 'All categories', messages: 'Messages', university: 'University', projects: 'Projects', ai: 'AI', reports: 'Reports', invitations: 'Invitations', files: 'Files', security: 'Security', system: 'System', general: 'General' },
    now: 'Just now', m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago`, dateLocale: 'en-US',
    filters: 'Filters', today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week', earlier: 'Earlier', unreadCount: (n) => (n ? `${n} unread` : "You're all caught up"),
    select: 'Select', pinned: 'Pinned', important: 'Important', urgent: 'Urgent', high: 'High', view: 'View',
    restore: 'Restore', purge: 'Delete permanently', markUnread: 'Mark as unread', markRead: 'Mark as read',
    unpin: 'Unpin', pin: 'Pin', unmarkImportant: 'Unmark important', markImportant: 'Mark important',
    unarchive: 'Unarchive', archive: 'Archive', delete: 'Delete',
    allRead: 'All notifications marked as read.', purgeConfirm: 'Permanently delete this notification? This cannot be undone.',
    updated: (n) => `${n} updated.`,
    searchPh: 'Search notifications…', searchAria: 'Search notifications', category: 'Category', priority: 'Priority',
    anyPriority: 'Any priority', normal: 'Normal', low: 'Low', fromDate: 'From date', toDate: 'To date', sort: 'Sort',
    newest: 'Newest first', oldest: 'Oldest first', clear: 'Clear', markAll: 'Mark all read', refresh: 'Refresh',
    selected: 'selected', cancel: 'Cancel', noMatch: 'No notifications match these filters.', none: "You don't have any notifications yet.",
    prev: 'Prev', next: 'Next', pageOf: (p, n, t) => `Page ${p} of ${n} · ${t} total`,
  },
  ar: {
    tabs: { '': 'الكل', unread: 'غير مقروءة', read: 'مقروءة', pinned: 'المثبّتة', important: 'المهمة', archived: 'المؤرشفة', deleted: 'المحذوفات' },
    categories: { '': 'كل الفئات', messages: 'الرسائل', university: 'الجامعة', projects: 'المشاريع', ai: 'الذكاء الاصطناعي', reports: 'التقارير', invitations: 'الدعوات', files: 'الملفات', security: 'الأمان', system: 'النظام', general: 'عام' },
    now: 'الآن', m: (n) => `منذ ${n} د`, h: (n) => `منذ ${n} س`, d: (n) => `منذ ${n} يوم`, dateLocale: 'ar-EG',
    filters: 'تصفية', today: 'اليوم', yesterday: 'أمس', thisWeek: 'هذا الأسبوع', earlier: 'أقدم', unreadCount: (n) => (n ? `${n} غير مقروء` : 'لا توجد إشعارات جديدة'),
    select: 'تحديد', pinned: 'مثبّت', important: 'مهم', urgent: 'عاجل', high: 'مرتفع', view: 'عرض',
    restore: 'استعادة', purge: 'حذف نهائي', markUnread: 'تعيين كغير مقروء', markRead: 'تعيين كمقروء',
    unpin: 'إلغاء التثبيت', pin: 'تثبيت', unmarkImportant: 'إلغاء التمييز كمهم', markImportant: 'تمييز كمهم',
    unarchive: 'إلغاء الأرشفة', archive: 'أرشفة', delete: 'حذف',
    allRead: 'تم تعيين كل الإشعارات كمقروءة.', purgeConfirm: 'هل تريد حذف هذا الإشعار نهائياً؟ لا يمكن التراجع عن ذلك.',
    updated: (n) => `تم تحديث ${n}.`,
    searchPh: 'ابحث في الإشعارات…', searchAria: 'ابحث في الإشعارات', category: 'الفئة', priority: 'الأولوية',
    anyPriority: 'أي أولوية', normal: 'عادية', low: 'منخفضة', fromDate: 'من تاريخ', toDate: 'إلى تاريخ', sort: 'الترتيب',
    newest: 'الأحدث أولاً', oldest: 'الأقدم أولاً', clear: 'مسح', markAll: 'تعيين الكل كمقروء', refresh: 'تحديث',
    selected: 'محدد', cancel: 'إلغاء', noMatch: 'لا توجد إشعارات تطابق هذه المرشّحات.', none: 'ليس لديك أي إشعارات بعد.',
    prev: 'السابق', next: 'التالي', pageOf: (p, n, t) => `صفحة ${p} من ${n} · ${t} إجمالاً`,
  },
};

function timeAgo(dateStr, tx) {
  if (!dateStr) return '';
  const then = parseServerDate(dateStr);
  if (isNaN(then.getTime())) return dateStr;
  const diff = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (diff < 60) return tx.now;
  if (diff < 3600) return tx.m(Math.floor(diff / 60));
  if (diff < 86400) return tx.h(Math.floor(diff / 3600));
  if (diff < 604800) return tx.d(Math.floor(diff / 86400));
  return then.toLocaleDateString(tx.dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isExternal(url) {
  return /^(https?:)?\/\//i.test(url || '');
}

function SkeletonRow() {
  return (
    <div className="nc-row nc-row--skeleton">
      <span className="skeleton nc-skel-icon" />
      <div className="nc-row__body">
        <div className="skeleton skeleton-line" style={{ width: '60%' }} />
        <div className="skeleton skeleton-line" style={{ width: '85%' }} />
        <div className="skeleton skeleton-line" style={{ width: '25%' }} />
      </div>
    </div>
  );
}

function toneForIcon(icon, priority) {
  if (priority === 'urgent') return 'danger';
  if (['download', 'check', 'check-circle', 'upload'].includes(icon)) return 'success';
  if (['alert', 'alert-triangle', 'shield'].includes(icon)) return 'warning';
  if (['trend', 'chart', 'bar-chart', 'x-circle'].includes(icon)) return 'danger';
  return 'primary';
}

/** Day bucket used to group the list. */
function dayBucket(dateStr) {
  const d = parseServerDate(String(dateStr || ''));
  if (isNaN(d.getTime())) return 'earlier';
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'thisWeek';
  return 'earlier';
}

function NotifRow({ n, checked, onCheck, onAction }) {
  const { locale } = useLanguage();
  const tx = TX[locale] || TX.en;
  const isDeleted = !!n.is_deleted;
  const isArchived = !!n.is_archived;
  const isRead = !!n.is_read;
  const isPinned = !!n.is_pinned;
  const isImportant = !!n.is_important;
  const priority = n.priority || 'normal';
  const text = localizeNotification(n, locale);

  const cls = ['nc-row'];
  if (!isRead) cls.push('is-unread');
  if (isArchived) cls.push('is-archived');
  if (isDeleted) cls.push('is-deleted');
  if (checked) cls.push('is-checked');

  const act = (key, icon, title, on, extra = '') => (
    <button key={key} type="button" className={`nc-act${on ? ' is-on' : ''}${extra}`} title={title} aria-label={title} onClick={() => onAction(n.id, key)}>
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <article className={cls.join(' ')} data-id={n.id}>
      <div className="nc-row__lead">
        <span className="nc-row__icon" data-tone={toneForIcon(n.icon, priority)}>
          <Icon name={n.icon || 'bell'} size={20} />
          {!isRead && <i className="nc-row__dot" />}
        </span>
        <label className="nc-row__check" title={tx.select}>
          <input type="checkbox" className="form-checkbox" aria-label={tx.select} checked={checked} onChange={(e) => onCheck(n.id, e.target.checked)} />
        </label>
      </div>

      <div className="nc-row__body">
        <div className="nc-row__head">
          <h3 className="nc-row__title">
            {isPinned && <span className="nc-flag nc-flag--pin" title={tx.pinned}><Icon name="pin" size={12} /></span>}
            {isImportant && <span className="nc-flag nc-flag--star" title={tx.important}><Icon name="star" size={12} /></span>}
            {text.title}
          </h3>
          <time className="nc-row__time">{timeAgo(n.created_at, tx)}</time>
        </div>
        {text.body && <p className="nc-row__snippet">{text.body}</p>}
        <div className="nc-row__foot">
          {(priority === 'urgent' || priority === 'high') && (
            <span className={`nc-prio nc-prio--${priority}`}>{priority === 'urgent' ? tx.urgent : tx.high}</span>
          )}
          {n.link_url && (
            isExternal(n.link_url)
              ? <a href={safeHref(n.link_url)} className="nc-row__view" target="_blank" rel="noreferrer">{tx.view} <Icon name="arrow-right" size={13} className="icon-flip" /></a>
              : <Link to={n.link_url} className="nc-row__view" onClick={() => { if (!isRead) onAction(n.id, 'read', { silent: true }); }}>{tx.view} <Icon name="arrow-right" size={13} className="icon-flip" /></Link>
          )}
          <div className="nc-row__actions">
            {isDeleted ? (
              <>
                {act('restore', 'refresh', tx.restore)}
                {act('purge', 'trash', tx.purge, false, ' is-danger')}
              </>
            ) : (
              <>
                {act(isRead ? 'unread' : 'read', isRead ? 'mail' : 'check', isRead ? tx.markUnread : tx.markRead)}
                {act(isPinned ? 'unpin' : 'pin', 'pin', isPinned ? tx.unpin : tx.pin, isPinned)}
                {act(isImportant ? 'unimportant' : 'important', 'star', isImportant ? tx.unmarkImportant : tx.markImportant, isImportant)}
                {act(isArchived ? 'unarchive' : 'archive', 'archive', isArchived ? tx.unarchive : tx.archive)}
                {act('delete', 'trash', tx.delete, false, ' is-danger')}
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Notifications() {
  const { locale } = useLanguage();
  const tx = TX[locale] || TX.en;
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const perPage = 20;

  const [selected, setSelected] = useState({});
  const [toast, setToast] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const reqIdRef = useRef(0);

  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message, kind });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(h);
  }, [toast]);

  const loadCounts = useCallback(() => {
    api.get(BASE + '/counts').then((res) => setCounts(res.data || EMPTY_COUNTS)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const myReqId = ++reqIdRef.current;
    setLoading(true);
    const params = {
      status: status || undefined,
      category: category || undefined,
      priority: priority || undefined,
      search: search || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      sort,
      page,
      per_page: perPage,
    };
    api.get(BASE, params)
      .then((res) => {
        if (reqIdRef.current !== myReqId) return;
        const list = res.data || [];
        const metaTotal = res.meta?.total ?? 0;
        if (!list.length && page > 1) {
          setPage((p) => Math.max(1, p - 1));
          return;
        }
        setItems(list);
        setTotal(metaTotal);
        setSelected({});
        setLoadError('');
      })
      .catch((err) => {
        if (reqIdRef.current !== myReqId) return;
        setItems([]);
        setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (reqIdRef.current !== myReqId) return;
        setLoading(false);
        setFirstLoad(false);
      });
  }, [status, category, priority, search, dateFrom, dateTo, sort, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  // New notifications from other people / other tabs show up on their own.
  useLive(() => { load(); loadCounts(); }, { watch: /(?!)/, interval: 20000, topics: ['notification'] });

  // Debounced search box, same 350ms as the old JS.
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const h = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(h);
  }, [searchInput]);

  const changeTab = (key) => {
    setStatus(key);
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setCategory('');
    setPriority('');
    setDateFrom('');
    setDateTo('');
    setSort('newest');
    setPage(1);
  };

  const markAllRead = () => {
    api.post(BASE + '/read-all', {})
      .then(() => {
        showToast(tx.allRead);
        load();
        loadCounts();
      })
      .catch((err) => showToast(errorMessage(err), 'error'));
  };

  const singleAction = (id, action, opts = {}) => {
    if (action === 'purge' && !window.confirm(tx.purgeConfirm)) return;
    const method = action === 'restore' ? 'post' : action === 'delete' || action === 'purge' ? 'del' : 'patch';
    const path = action === 'delete' ? `${BASE}/${id}` : `${BASE}/${id}/${action}`;
    const call = method === 'del' ? api.del(path) : method === 'post' ? api.post(path, {}) : api.patch(path, {});
    call
      .then(() => { if (!opts.silent) { load(); loadCounts(); } })
      .catch((err) => showToast(errorMessage(err), 'error'));
  };

  const toggleCheck = (id, checked) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[id] = true; else delete next[id];
      return next;
    });
  };

  const selectedIds = Object.keys(selected);
  const allChecked = items.length > 0 && selectedIds.length === items.length;

  const toggleSelectAll = (checked) => {
    if (checked) {
      const next = {};
      items.forEach((n) => { next[n.id] = true; });
      setSelected(next);
    } else {
      setSelected({});
    }
  };

  const bulkAction = (action) => {
    if (!selectedIds.length) return;
    api.post(BASE + '/bulk', { ids: selectedIds, action })
      .then((res) => {
        showToast(tx.updated(res.data?.affected ?? selectedIds.length));
        setSelected({});
        load();
        loadCounts();
      })
      .catch((err) => showToast(errorMessage(err), 'error'));
  };

  const pages = Math.max(1, Math.ceil(total / perPage));
  const hasFilters = !!(status || search || category || priority || dateFrom || dateTo);
  const activeFilterCount = [category, priority, dateFrom, dateTo, sort !== 'newest' ? sort : ''].filter(Boolean).length;

  const grouped = [];
  if (sort === 'priority') {
    grouped.push({ key: '', rows: items });
  } else {
    items.forEach((n) => {
      const k = dayBucket(n.created_at);
      const last = grouped[grouped.length - 1];
      if (last && last.key === k) last.rows.push(n); else grouped.push({ key: k, rows: [n] });
    });
  }
  const groupLabel = { today: tx.today, yesterday: tx.yesterday, thisWeek: tx.thisWeek, earlier: tx.earlier };

  return (
    <div className="nc-page">
      <header className="nc-top">
        <div className="nc-top__text">
          <h1>{locale === 'ar' ? 'الإشعارات' : 'Notifications'}</h1>
          <p>{tx.unreadCount(counts.unread || 0)}</p>
        </div>
        <div className="nc-top__actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={markAllRead} disabled={!counts.unread}>
            <Icon name="check" size={14} /> <span>{tx.markAll}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm nc-iconbtn" title={tx.refresh} aria-label={tx.refresh} onClick={() => { load(); loadCounts(); }}>
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      <section className="nc-card">
        <div className="nc-search">
          <label className="nc-search__box">
            <Icon name="search" size={16} />
            <input type="search" placeholder={tx.searchPh} aria-label={tx.searchAria} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </label>
          <button type="button" className={`nc-filtertoggle${filtersOpen ? ' is-open' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
            <Icon name="filter" size={15} /> <span>{tx.filters}</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
          </button>
        </div>

        <div className={`nc-filters${filtersOpen ? ' is-open' : ''}`}>
          <select className="form-select" aria-label={tx.category} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            {CATEGORY_KEYS.map((val) => <option key={val} value={val}>{tx.categories[val]}</option>)}
          </select>
          <select className="form-select" aria-label={tx.priority} value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
            <option value="">{tx.anyPriority}</option>
            <option value="urgent">{tx.urgent}</option>
            <option value="high">{tx.high}</option>
            <option value="normal">{tx.normal}</option>
            <option value="low">{tx.low}</option>
          </select>
          <select className="form-select" aria-label={tx.sort} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="newest">{tx.newest}</option>
            <option value="oldest">{tx.oldest}</option>
            <option value="priority">{tx.priority}</option>
          </select>
          <label className="nc-date">
            <span>{tx.fromDate}</span>
            <input type="date" className="form-input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="nc-date">
            <span>{tx.toDate}</span>
            <input type="date" className="form-input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </label>
          <button type="button" className="btn btn-ghost btn-sm nc-clear" onClick={clearFilters}>
            <Icon name="x" size={14} /> {tx.clear}
          </button>
        </div>
      </section>

      <nav className="nc-tabs" role="tablist" aria-label={locale === 'ar' ? 'تصنيف الإشعارات' : 'Notification views'}>
        {TAB_KEYS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={status === key} className={`nc-tab${status === key ? ' is-active' : ''}`} onClick={() => changeTab(key)}>
            {tx.tabs[key]}
            <span className="nc-tab__count">{counts[key || 'total'] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className={`nc-list${loading ? ' is-loading' : ''}`}>
        {firstLoad && loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : loadError ? (
          <div className="nc-empty"><p>{loadError}</p></div>
        ) : items.length === 0 ? (
          <div className="nc-empty">
            <span className="nc-empty__icon"><Icon name="bell" size={28} /></span>
            <p>{hasFilters ? tx.noMatch : tx.none}</p>
            {hasFilters && <button type="button" className="btn btn-outline btn-sm" onClick={clearFilters}>{tx.clear}</button>}
          </div>
        ) : (
          grouped.map((g) => (
            <section key={g.key || 'all'} className="nc-group">
              {g.key && <h2 className="nc-group__title">{groupLabel[g.key]}</h2>}
              {g.rows.map((n) => (
                <NotifRow key={n.id} n={n} checked={!!selected[n.id]} onCheck={toggleCheck} onAction={singleAction} />
              ))}
            </section>
          ))
        )}
      </div>

      {pages > 1 && (
        <div className="nc-pager">
          <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <Icon name={locale === 'ar' ? 'chevron-right' : 'chevron-left'} size={14} /> {tx.prev}
          </button>
          <span>{tx.pageOf(page, pages, total)}</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {tx.next} <Icon name={locale === 'ar' ? 'chevron-left' : 'chevron-right'} size={14} />
          </button>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="nc-bulk" role="toolbar">
          <label className="nc-bulk__all">
            <input type="checkbox" className="form-checkbox" checked={allChecked} onChange={(e) => toggleSelectAll(e.target.checked)} />
            <span><b>{selectedIds.length}</b> {tx.selected}</span>
          </label>
          <div className="nc-bulk__actions">
            <button type="button" title={tx.markRead} aria-label={tx.markRead} onClick={() => bulkAction('markRead')}><Icon name="check" size={16} /></button>
            <button type="button" title={tx.markUnread} aria-label={tx.markUnread} onClick={() => bulkAction('markUnread')}><Icon name="mail" size={16} /></button>
            <button type="button" title={tx.pin} aria-label={tx.pin} onClick={() => bulkAction('pin')}><Icon name="pin" size={16} /></button>
            <button type="button" title={tx.markImportant} aria-label={tx.markImportant} onClick={() => bulkAction('important')}><Icon name="star" size={16} /></button>
            <button type="button" title={tx.archive} aria-label={tx.archive} onClick={() => bulkAction('archive')}><Icon name="archive" size={16} /></button>
            <button type="button" className="is-danger" title={tx.delete} aria-label={tx.delete} onClick={() => bulkAction('delete')}><Icon name="trash" size={16} /></button>
          </div>
          <button type="button" className="nc-bulk__cancel" onClick={() => setSelected({})}>{tx.cancel}</button>
        </div>
      )}

      {toast && (
        <div className={`nc-toast nc-toast--${toast.kind}`} role="status" aria-live="polite">
          <Icon name={toast.kind === 'error' ? 'alert-triangle' : 'check-circle'} size={16} />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
