import { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { Avatar } from './ConversationRail';
import { fmtTime, peerLabel, previewLabel } from './format';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Trash view of the messages rail: deleted chats stay here for `retentionDays` days (default 30),
 * then are deleted for good. Each chat can be restored or deleted forever; several can be selected at once,
 * and the whole trash can be restored or emptied.
 *
 * onRestore / onPurge take ({ ids, all }) and resolve to true when done (false when the person cancelled).
 */
export default function TrashRail({ items, loading, retentionDays = 30, onBack, onRestore, onPurge }) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  // Drop selections for chats that are no longer in the trash (restored/purged elsewhere, polled refresh).
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(items.map((c) => c.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const allIds = useMemo(() => items.map((c) => c.id), [items]);
  const allSelected = items.length > 0 && selected.size === items.length;
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const act = async (fn, payload) => {
    setBusy(true);
    try {
      if (await fn(payload)) setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };
  const ids = [...selected];

  const daysLabel = (n) => {
    if (n <= 0) return t('Deleting today', 'يُحذف اليوم');
    if (locale === 'ar') return n === 1 ? 'يوم واحد متبقٍ' : n === 2 ? 'يومان متبقيان' : `${n} ${n <= 10 ? 'أيام' : 'يومًا'} متبقية`;
    return `${n} day${n === 1 ? '' : 's'} left`;
  };

  return (
    <aside className="msg-rail msg-trash" data-msg-rail data-msg-trash>
      <div className="msg-trash__head">
        <button type="button" className="msg-icon-btn" onClick={onBack} title={t('Back to messages', 'العودة للرسائل')} aria-label={t('Back to messages', 'العودة للرسائل')}>
          <Icon name={locale === 'ar' ? 'arrow-right' : 'arrow-left'} size={16} />
        </button>
        <strong className="text-h4">{t('Trash', 'المحذوفات')}</strong>
        <span className="msg-trash__count">{items.length}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm msg-trash__empty"
          disabled={busy || items.length === 0}
          onClick={() => act(onPurge, { all: true })}
        >
          <Icon name="trash" size={14} /> {t('Empty trash', 'تفريغ السلة')}
        </button>
      </div>

      <div className="msg-trash__note">
        <Icon name="clock" size={14} />
        <span>
          {t(
            `Deleted chats stay here for ${retentionDays} days, then are deleted permanently.`,
            `تبقى المحادثات المحذوفة هنا ${retentionDays} يومًا ثم تُحذف نهائيًا.`
          )}
        </span>
      </div>

      {items.length > 0 && (
        <div className="msg-select-bar" role="toolbar" aria-label={t('Trash actions', 'إجراءات المحذوفات')}>
          <label className="msg-check">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
            />
            <span>{selected.size ? t(`${selected.size} selected`, `تم تحديد ${selected.size}`) : t('Select all', 'تحديد الكل')}</span>
          </label>
          <span className="msg-select-bar__spacer" />
          {selected.size > 0 ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(onRestore, { ids })}>
                <Icon name="refresh" size={14} /> {t('Restore', 'استرجاع')}
              </button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(onPurge, { ids })}>
                <Icon name="trash" size={14} /> {t('Delete forever', 'حذف نهائي')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(onRestore, { all: true })}>
              <Icon name="refresh" size={14} /> {t('Restore all', 'استرجاع الكل')}
            </button>
          )}
        </div>
      )}

      <div className="msg-rail__list" data-conversation-list>
        {loading ? (
          <div className="msg-skeleton-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <div className="msg-skeleton-row" key={i}><span className="msg-skeleton-avatar" /><span className="msg-skeleton-lines"><i /><i /></span></div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="msg-empty-state msg-trash__empty-state">
            <Icon name="trash" size={28} />
            <strong>{t('Trash is empty', 'سلة المحذوفات فارغة')}</strong>
            <span>{t('Chats you delete will appear here.', 'ستظهر هنا المحادثات التي تحذفها.')}</span>
          </div>
        ) : (
          items.map((c) => {
            const urgent = c.days_left != null && c.days_left <= 3;
            return (
              <div className={`msg-conv-row${selected.has(c.id) ? ' is-selected' : ''}`} key={c.id}>
                <div className="msg-conv msg-conv--static" role="checkbox" aria-checked={selected.has(c.id)} tabIndex={0}
                  onClick={() => toggle(c.id)}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(c.id); } }}>
                  <span className="msg-check msg-check--box"><input type="checkbox" tabIndex={-1} readOnly checked={selected.has(c.id)} /></span>
                  <Avatar name={peerLabel(c)} isGroup={c.is_group} src={c.is_group ? c.group_avatar : (c.peer_deleted ? null : c.peer_avatar)} />
                  <span className="msg-conv__meta">
                    <span className="msg-conv__row1">
                      <span className="msg-conv__name">{peerLabel(c)}</span>
                      <span className="msg-conv__time">{fmtTime(c.deleted_at)}</span>
                    </span>
                    <span className="msg-conv__row2">
                      <span className="msg-conv__preview">{previewLabel(c, locale) || t('No messages yet', 'لا توجد رسائل بعد')}</span>
                      <span className={`msg-days-left${urgent ? ' is-urgent' : ''}`}>{daysLabel(c.days_left ?? 0)}</span>
                    </span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
