import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { Avatar } from './ConversationRail';
import { fmtTime, roleLabel } from './format';
import { useLanguage } from '../../context/LanguageContext';
import { typeLabel } from './groupText';

/**
 * Group parts of the info panel, rendered by InfoPanel around the shared flag toggles:
 *   GroupTop     – hero (photo, name, description), quick actions, summary of the rules in force
 *   GroupMembers – members list with per-member admin actions
 *   GroupDanger  – leave / delete
 */
const TYPE_KEYS = ['text', 'image', 'video', 'audio', 'file', 'poll'];

const useBits = () => {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  return { ar, t: (en, arText) => (ar ? arText : en) };
};

export function GroupTop({ conversation, others, onOpenSettings, onAddMember }) {
  const { ar, t } = useBits();
  const [descOpen, setDescOpen] = useState(false);

  const isAdmin = !!conversation.is_admin;
  const managed = !!conversation.managed_by_student_group;
  const settings = conversation.settings || null;
  const allowed = conversation.allowed_types || [];
  const restrictedTypes = settings && settings.allowed_types
    ? TYPE_KEYS.filter((k) => !settings.allowed_types.includes(k))
    : [];
  const total = others.length + 1;
  const desc = conversation.description || '';
  const longDesc = desc.length > 140;

  return (
    <>
      <div className="msg-info__hero grp-hero">
        <Avatar name={conversation.subject || ''} isGroup src={conversation.avatar_path} />
        <strong>{conversation.subject || t('Group', 'مجموعة')}</strong>
        <span className="msg-info__role">{total} {t('members', 'عضو')}</span>
        {conversation.created_at && <span className="grp-hero__sub">{t('Created', 'أُنشئت')} {fmtTime(conversation.created_at)}</span>}
        {conversation.send_block === 'admins_only' && (
          <span className="grp-pill grp-pill--warn"><Icon name="lock" size={11} /> {t('Closed — only admins can send', 'مغلقة — المشرفون فقط يرسلون')}</span>
        )}
      </div>

      {(desc || conversation.can_edit_info) && (
        <div className="grp-desc">
          {desc ? (
            <>
              <p className={descOpen || !longDesc ? '' : 'is-clamped'}>{desc}</p>
              {longDesc && (
                <button type="button" className="grp-link-btn" onClick={() => setDescOpen((o) => !o)}>
                  {descOpen ? t('Show less', 'عرض أقل') : t('Show more', 'عرض المزيد')}
                </button>
              )}
            </>
          ) : (
            <button type="button" className="grp-link-btn" onClick={() => onOpenSettings('info')}>
              {t('+ Add a group description', '+ أضف وصفًا للمجموعة')}
            </button>
          )}
        </div>
      )}

      <div className="grp-quick">
        {conversation.can_add_members && (
          <button type="button" className="grp-quick__btn" onClick={onAddMember}>
            <Icon name="plus-circle" size={18} />
            <span>{t('Add', 'إضافة')}</span>
          </button>
        )}
        {!managed && (isAdmin || conversation.invite_token) && (
          <button type="button" className="grp-quick__btn" onClick={() => onOpenSettings('invite')}>
            <Icon name="link" size={18} />
            <span>{t('Invite link', 'رابط الدعوة')}</span>
          </button>
        )}
        {isAdmin && (
          <button type="button" className="grp-quick__btn" onClick={() => onOpenSettings(conversation.pending_requests ? 'requests' : 'perms')}>
            <Icon name="settings" size={18} />
            <span>{t('Settings', 'الإعدادات')}</span>
            {conversation.pending_requests > 0 && <em className="grp-badge">{conversation.pending_requests}</em>}
          </button>
        )}
      </div>

      {isAdmin && settings && (
        <div className="msg-info__card grp-rules">
          <div className="grp-rule">
            <span>{t('Who can send', 'من يرسل')}</span>
            <strong>{settings.only_admins_send ? t('Admins only', 'المشرفون فقط') : t('Everyone', 'الجميع')}</strong>
          </div>
          <div className="grp-rule">
            <span>{t('Message types', 'أنواع الرسائل')}</span>
            <strong>{restrictedTypes.length ? t(`${TYPE_KEYS.length - restrictedTypes.length} of ${TYPE_KEYS.length}`, `${TYPE_KEYS.length - restrictedTypes.length} من ${TYPE_KEYS.length}`) : t('All', 'الكل')}</strong>
          </div>
          {!managed && (
            <div className="grp-rule">
              <span>{t('Invite link', 'رابط الدعوة')}</span>
              <strong>{settings.invite_enabled ? (settings.join_approval ? t('On · needs approval', 'مفعّل · بموافقة') : t('On', 'مفعّل')) : t('Off', 'متوقف')}</strong>
            </div>
          )}
        </div>
      )}
      {!isAdmin && allowed.length > 0 && TYPE_KEYS.some((k) => !allowed.includes(k)) && (
        <div className="grp-pill grp-pill--info" style={{ alignSelf: 'flex-start' }}>
          {t('Allowed here: ', 'المسموح هنا: ')}{TYPE_KEYS.filter((k) => allowed.includes(k)).map(typeLabel).join(ar ? '، ' : ', ')}
        </div>
      )}
    </>
  );
}

export function GroupMembers({ conversation, others, myUserId, onAddMember, onMemberAction }) {
  const { t } = useBits();
  const [menuFor, setMenuFor] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (menuFor == null) return undefined;
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [menuFor]);

  const isOwner = conversation.my_role === 'owner';
  const isAdmin = !!conversation.is_admin;
  const roleText = (r) => (r === 'owner' ? t('Owner', 'المالك') : r === 'admin' ? t('Admin', 'مشرف') : '');

  const ordered = [...others].sort((a, b) => {
    const rank = (x) => (x.group_role === 'owner' ? 0 : x.group_role === 'admin' ? 1 : 2);
    return rank(a) - rank(b) || String(a.full_name).localeCompare(String(b.full_name));
  });
  const total = others.length + 1;
  const LIMIT = 8;
  const shown = showAll ? ordered : ordered.slice(0, LIMIT);

  const actionsFor = (p) => {
    if (!isAdmin || String(p.id) === String(myUserId) || p.group_role === 'owner') return [];
    const list = [];
    if (p.group_role === 'admin') {
      if (!isOwner) return [];
      list.push({ key: 'demote', label: t('Remove admin role', 'إزالة صلاحية الإشراف'), icon: 'shield' });
    } else {
      list.push({ key: 'promote', label: t('Make admin', 'تعيين كمشرف'), icon: 'shield' });
      list.push(p.send_restricted
        ? { key: 'unrestrict', label: t('Allow to send', 'السماح بالإرسال'), icon: 'check-circle' }
        : { key: 'restrict', label: t('Restrict from sending', 'منع من الإرسال'), icon: 'lock' });
    }
    if (isOwner) list.push({ key: 'transfer', label: t('Make group owner', 'نقل الملكية إليه'), icon: 'star' });
    list.push({ key: 'remove', label: t('Remove from group', 'إزالة من المجموعة'), icon: 'x-circle', danger: true });
    return list;
  };

  return (
    <div>
      <div className="msg-info__section-title">{t('Members', 'الأعضاء')} ({total})</div>
      <div className="msg-info__member">
        <Avatar name={t('You', 'أنت')} size="sm" />
        <span className="msg-info__member-meta">
          <strong>{t('You', 'أنت')}</strong>
        </span>
        {conversation.my_role !== 'member' && <span className={`grp-role-badge${isOwner ? ' is-owner' : ''}`}>{roleText(conversation.my_role)}</span>}
      </div>

      {shown.map((p) => {
        const actions = actionsFor(p);
        return (
          <div className="msg-info__member" key={p.id}>
            <Avatar name={p.full_name} size="sm" src={p.avatar_path} />
            <span className="msg-info__member-meta">
              <strong>{p.full_name}</strong>
              {p.email && (
                <span className="msg-info__member-role" dir="ltr" style={{ textAlign: 'start', wordBreak: 'break-all' }}>{p.email}</span>
              )}
              <span className="msg-info__member-role">
                {[p.account_role ? roleLabel(p.account_role) : '', p.org || ''].filter(Boolean).join(' · ')}
              </span>
              {p.send_restricted && (
                <span className="grp-pill grp-pill--warn"><Icon name="lock" size={10} /> {t('Can’t send', 'ممنوع من الإرسال')}</span>
              )}
            </span>
            {p.group_role !== 'member' && (
              <span className={`grp-role-badge${p.group_role === 'owner' ? ' is-owner' : ''}`}>{roleText(p.group_role)}</span>
            )}
            {actions.length > 0 && (
              <span className="grp-menu-wrap" ref={menuFor === p.id ? menuRef : null}>
                <button
                  type="button"
                  className="msg-icon-btn msg-icon-btn--sm"
                  aria-label={t('Member actions', 'إجراءات العضو')}
                  aria-expanded={menuFor === p.id}
                  onClick={() => setMenuFor((c) => (c === p.id ? null : p.id))}
                >
                  <Icon name="more-vertical" size={15} />
                </button>
                {menuFor === p.id && (
                  <div className="grp-menu" role="menu">
                    {actions.map((a) => (
                      <button
                        type="button"
                        role="menuitem"
                        key={a.key}
                        className={a.danger ? 'is-danger' : ''}
                        onClick={() => { setMenuFor(null); onMemberAction(a.key, p); }}
                      >
                        <Icon name={a.icon} size={14} /> {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </div>
        );
      })}

      {ordered.length > LIMIT && (
        <button type="button" className="btn btn-outline btn-sm" style={{ width: '100%' }} onClick={() => setShowAll((s) => !s)}>
          {showAll ? t('Show fewer', 'عرض أقل') : t(`Show all ${total} members`, `عرض كل الأعضاء (${total})`)}
        </button>
      )}
      {conversation.can_add_members && (
        <button type="button" className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={onAddMember}>
          {t('+ Add member', '+ إضافة عضو')}
        </button>
      )}
    </div>
  );
}

export function GroupDanger({ conversation, onLeave, onDelete }) {
  const { t } = useBits();
  return (
    <div className="grp-danger">
      <button type="button" className="grp-danger__btn" onClick={onLeave}>
        <Icon name="logout" size={15} /> {t('Leave group', 'مغادرة المجموعة')}
      </button>
      {conversation.my_role === 'owner' && (
        <button type="button" className="grp-danger__btn" onClick={onDelete}>
          <Icon name="trash" size={15} /> {t('Delete group', 'حذف المجموعة')}
        </button>
      )}
    </div>
  );
}
