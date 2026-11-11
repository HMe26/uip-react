import { useState } from 'react';
import Icon from '../components/Icon';
import { ago } from './notifications';

/** Tray bell with the unread badge. Click = open / close the notification center flyout. */
export function NotifTray({ tt, unread, on, onClick }) {
  const label = unread > 0 ? tt(`Notifications · ${unread} unread`, `الإشعارات · ${unread} غير مقروء`) : tt('Notifications', 'الإشعارات');
  return (
    <button type="button" className={`os-tray__notif${on ? ' is-on' : ''}`} title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={!!on} onClick={onClick}>
      <Icon name="bell" size={17} />
      {unread > 0 && <b className="os-tray__badge">{unread > 99 ? '99+' : unread}</b>}
    </button>
  );
}

/** One notification row — shared by the desktop flyout and the phone sheet. */
export function NotifRow({ it, tt, ar, onOpen, onRemove }) {
  return (
    <div className={`os-nc__row${it.read ? '' : ' is-unread'}`}>
      <button type="button" className="os-nc__main" onClick={() => onOpen(it)}>
        <span className="os-nc__ic" data-tone={it.tone}><Icon name={it.icon || 'bell'} size={17} /></span>
        <span className="os-nc__tx">
          <b dir="auto">{it.title}</b>
          {it.body && <small dir="auto">{it.body}</small>}
          <time>{ago(it.at, tt, ar)}</time>
        </span>
        {!it.read && <i className="os-nc__dot" aria-label={tt('Unread', 'غير مقروء')} />}
      </button>
      {it.src === 'local' && onRemove && (
        <button type="button" className="os-nc__x" title={tt('Remove', 'إزالة')} aria-label={tt('Remove', 'إزالة')} onClick={() => onRemove(it.id)}><Icon name="x" size={14} /></button>
      )}
    </div>
  );
}

/** The list itself (tabs + rows + empty state). */
export function NotifList({ tt, ar, items, unread, loading, onOpen, onRemove }) {
  const [tab, setTab] = useState('all'); // 'all' | 'unread'
  const shown = tab === 'unread' ? items.filter((i) => !i.read) : items;
  return (
    <>
      <div className="os-nc__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>{tt('All', 'الكل')}</button>
        <button type="button" role="tab" aria-selected={tab === 'unread'} className={tab === 'unread' ? 'is-on' : ''} onClick={() => setTab('unread')}>{tt('Unread', 'غير مقروءة')}{unread > 0 && <em>{unread}</em>}</button>
      </div>
      <div className="os-nc__list">
        {loading && !items.length ? <p className="os-nc__none">{tt('Loading…', 'جارٍ التحميل…')}</p>
          : !shown.length ? (
            <div className="os-nc__empty">
              <Icon name="bell" size={30} />
              <b>{tab === 'unread' ? tt("You're all caught up", 'مفيش إشعارات جديدة') : tt('No notifications yet', 'مفيش إشعارات لسه')}</b>
              <small>{tt('Finished uploads and messages from your doctors will show up here.', 'اكتمال الرفع ورسائل الدكاترة هتظهر هنا.')}</small>
            </div>
          ) : shown.map((it) => <NotifRow key={it.key} it={it} tt={tt} ar={ar} onOpen={onOpen} onRemove={onRemove} />)}
      </div>
    </>
  );
}

/** Desktop flyout. */
export function NotifFlyout({ tt, ar, nc, onOpen, onAll }) {
  return (
    <div className="os-fly os-nc" role="dialog" aria-label={tt('Notifications', 'الإشعارات')} onPointerDown={(e) => e.stopPropagation()}>
      <header className="os-nc__head">
        <strong>{tt('Notifications', 'الإشعارات')}</strong>
        <span>
          <button type="button" disabled={!nc.unread} onClick={nc.markAllRead}>{tt('Mark all read', 'تعيين الكل كمقروء')}</button>
          {nc.hasLocal && <button type="button" onClick={nc.clearLocal} title={tt('Remove the upload entries from this list', 'إزالة إشعارات الرفع من القائمة')}>{tt('Clear uploads', 'مسح الرفع')}</button>}
        </span>
      </header>
      <NotifList tt={tt} ar={ar} items={nc.items} unread={nc.unread} loading={nc.loading} onOpen={onOpen} onRemove={nc.removeLocal} />
      <footer className="os-nc__foot">
        <button type="button" onClick={onAll}>{tt('Open all notifications', 'فتح كل الإشعارات')} <Icon name="arrow-right" size={14} className="icon-flip" /></button>
      </footer>
    </div>
  );
}

/** Pop-up banners for new arrivals (upload finished, a message from a doctor …). */
export function NotifToasts({ toasts, onOpen, onClose, tt }) {
  if (!toasts.length) return null;
  return (
    <div className="os-nt" role="region" aria-live="polite" aria-label={tt('New notifications', 'إشعارات جديدة')}>
      {toasts.map((t) => (
        <div key={t.id} className="os-nt__card">
          <button type="button" className="os-nt__main" onClick={() => onOpen(t)}>
            <span className="os-nc__ic" data-tone={t.tone}><Icon name={t.icon || 'bell'} size={17} /></span>
            <span className="os-nc__tx"><b dir="auto">{t.title}</b>{t.body && <small dir="auto">{t.body}</small>}</span>
          </button>
          <button type="button" className="os-nc__x" aria-label={tt('Dismiss', 'إغلاق')} onClick={() => onClose(t.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
