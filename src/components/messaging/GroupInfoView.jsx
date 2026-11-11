import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { Avatar } from './ConversationRail';
import WallpaperPicker from './WallpaperPicker';
import { avatarUrl, fmtBytes, fmtTime, roleLabel } from './format';
import { useProtectedSrc } from '../../lib/chatMedia';
import { useLanguage } from '../../context/LanguageContext';

/**
 * WhatsApp-style "Group info" screen (opened from the group avatar / name in the thread header).
 *
 *   hero (big photo · name · member count) → quick actions → description → media & files →
 *   settings card (mute / favourite / pin / archive / permissions / invite …) → members → leave / delete.
 *
 * Presentation only: every action is a callback owned by Messages.jsx, so the API contract is unchanged.
 */

const TYPE_TOTAL = 6; // text, image, video, audio, file, poll
const MEMBER_PREVIEW = 8;

function Thumb({ url, alt }) {
  const { src } = useProtectedSrc(url);
  return src ? <img src={src} alt={alt} loading="lazy" /> : <span className="gi-thumb__ph" />;
}

/** One settings row: tinted icon tile · title/subtitle · trailing control (switch, chevron, badge). */
function Row({ icon, tone = 'primary', title, hint, onClick, children, danger }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`gi-row${onClick ? ' is-action' : ''}${danger ? ' is-danger' : ''}`} onClick={onClick}>
      <span className={`gi-row__icon gi-tone--${danger ? 'danger' : tone}`}><Icon name={icon} size={18} /></span>
      <span className="gi-row__text">
        <strong>{title}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </Tag>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      className={`gi-switch${on ? ' is-on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onChange(!on); } }}
    />
  );
}

export default function GroupInfoView({
  conversation, convMeta, others, messages, myUserId,
  onClose, onToggleFlag, onSetCategory, onAddMember, onOpenSettings, onMemberAction, onLeave, onDelete,
  wall, wallIsDefault, onWall, onWallUseDefault, customWalls, onAddCustomWall, onRemoveCustomWall, wallAnim, onWallAnim,
  autoSave, onAutoSave,
}) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);

  const [descOpen, setDescOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const [category, setCategory] = useState(convMeta?.category || '');
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const membersRef = useRef(null);

  useEffect(() => { setCategory(convMeta?.category || ''); }, [conversation?.id, convMeta?.category]);
  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);
  useEffect(() => {
    if (menuFor == null) return undefined;
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [menuFor]);
  useEffect(() => {
    if (!photoOpen) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setPhotoOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [photoOpen]);

  const isAdmin = !!conversation.is_admin;
  const isOwner = conversation.my_role === 'owner';
  const managed = !!conversation.managed_by_student_group;
  const settings = conversation.settings || null;
  const total = others.length + 1;
  const desc = conversation.description || '';
  const longDesc = desc.length > 140;
  const photo = avatarUrl(conversation.avatar_path);

  // ---- shared media / files (from the loaded thread)
  const { media, docs, mediaCount } = useMemo(() => {
    const all = [];
    (messages || []).forEach((m) => (m.attachments || []).forEach((a) => all.push(a)));
    const images = all.filter((a) => a.kind === 'image');
    const files = all.filter((a) => a.kind !== 'image');
    return { media: images.slice(-6).reverse(), docs: files.slice(-3).reverse(), mediaCount: all.length };
  }, [messages]);
  const openFiles = (list, i) => window.dispatchEvent(new CustomEvent('uip:open-file', {
    detail: { files: list.map((f) => ({ url: f.url, name: f.original_name, protected: true })), index: i },
  }));

  // ---- members
  const ordered = useMemo(() => {
    const rank = (x) => (x.group_role === 'owner' ? 0 : x.group_role === 'admin' ? 1 : 2);
    return [...others].sort((a, b) => rank(a) - rank(b) || String(a.full_name).localeCompare(String(b.full_name)));
  }, [others]);
  const q = query.trim().toLowerCase();
  const filtered = q ? ordered.filter((p) => `${p.full_name} ${p.email || ''} ${p.org || ''}`.toLowerCase().includes(q)) : ordered;
  const shown = q || showAll ? filtered : filtered.slice(0, MEMBER_PREVIEW);

  const roleText = (r) => (r === 'owner' ? t('Group owner', 'مالك المجموعة') : r === 'admin' ? t('Group admin', 'مشرف') : '');
  const actionsFor = (p) => {
    if (!isAdmin || String(p.id) === String(myUserId) || p.group_role === 'owner') return [];
    const list = [];
    if (p.group_role === 'admin') {
      if (!isOwner) return [];
      list.push({ key: 'demote', label: t('Remove admin role', 'إزالة صلاحية الإشراف'), icon: 'shield' });
    } else {
      list.push({ key: 'promote', label: t('Make group admin', 'تعيين كمشرف'), icon: 'shield' });
      list.push(p.send_restricted
        ? { key: 'unrestrict', label: t('Allow to send', 'السماح بالإرسال'), icon: 'check-circle' }
        : { key: 'restrict', label: t('Restrict from sending', 'منع من الإرسال'), icon: 'lock' });
    }
    if (isOwner) list.push({ key: 'transfer', label: t('Make group owner', 'نقل الملكية إليه'), icon: 'star' });
    list.push({ key: 'remove', label: t('Remove from group', 'إزالة من المجموعة'), icon: 'x-circle', danger: true });
    return list;
  };

  const restrictedTypes = settings?.allowed_types
    ? Math.max(0, TYPE_TOTAL - settings.allowed_types.filter((k) => ['text', 'image', 'video', 'audio', 'file', 'poll'].includes(k)).length)
    : 0;

  const flag = (key) => ({
    favorite: !!convMeta?.is_favorite, pin: !!convMeta?.is_pinned, mute: !!convMeta?.is_muted, archive: !!convMeta?.is_archived,
  }[key]);

  const quick = [
    conversation.can_add_members && { key: 'add', icon: 'plus-circle', label: t('Add', 'إضافة'), run: onAddMember },
    !managed && (isAdmin || conversation.invite_token) && { key: 'invite', icon: 'link', label: t('Invite', 'دعوة'), run: () => onOpenSettings('invite') },
    { key: 'search', icon: 'search', label: t('Search', 'بحث'), run: () => { setSearching(true); membersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    isAdmin && { key: 'settings', icon: 'settings', label: t('Settings', 'الإعدادات'), badge: conversation.pending_requests || 0, run: () => onOpenSettings(conversation.pending_requests ? 'requests' : 'perms') },
  ].filter(Boolean);

  return (
    <aside className="msg-info gi" data-info-panel>
      <header className="gi-bar">
        <button type="button" className="gi-bar__btn" onClick={onClose} aria-label={t('Close', 'إغلاق')}>
          <Icon name={ar ? 'arrow-right' : 'arrow-left'} size={20} />
        </button>
        <strong>{t('Group info', 'معلومات المجموعة')}</strong>
        {conversation.can_edit_info ? (
          <button type="button" className="gi-bar__btn" onClick={() => onOpenSettings('info')} aria-label={t('Edit group', 'تعديل المجموعة')}>
            <Icon name="edit" size={18} />
          </button>
        ) : <span className="gi-bar__btn gi-bar__btn--ghost" />}
      </header>

      <div className="gi-scroll" data-info-body>
        {/* ---------------- hero ---------------- */}
        <section className="gi-hero">
          <button type="button" className="gi-hero__photo" disabled={!photo} onClick={() => photo && setPhotoOpen(true)} aria-label={t('View group photo', 'عرض صورة المجموعة')}>
            <Avatar name={conversation.subject || ''} isGroup src={conversation.avatar_path} />
          </button>
          {conversation.can_edit_info && (
            <button type="button" className="gi-hero__edit" onClick={() => onOpenSettings('info')} aria-label={t('Change photo', 'تغيير الصورة')}>
              <Icon name="image" size={14} />
            </button>
          )}
          <h2 className="gi-hero__name">{conversation.subject || t('Group', 'مجموعة')}</h2>
          <p className="gi-hero__sub">{t('Group', 'مجموعة')} · {total} {total === 1 ? t('member', 'عضو') : t('members', 'أعضاء')}</p>
          {conversation.send_block === 'admins_only' && (
            <span className="gi-pill"><Icon name="lock" size={11} /> {t('Only admins can send', 'المشرفون فقط يرسلون')}</span>
          )}
        </section>

        {/* ---------------- quick actions ---------------- */}
        <nav className="gi-quick" aria-label={t('Quick actions', 'إجراءات سريعة')}>
          {quick.map((a) => (
            <button type="button" key={a.key} className="gi-quick__btn" onClick={a.run}>
              <span className="gi-quick__icon"><Icon name={a.icon} size={20} />{a.badge > 0 && <em className="gi-badge">{a.badge}</em>}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </nav>

        {/* ---------------- description ---------------- */}
        {(desc || conversation.can_edit_info) && (
          <section className="gi-card gi-desc">
            {desc ? (
              <>
                <p className={descOpen || !longDesc ? '' : 'is-clamped'}>{desc}</p>
                {longDesc && <button type="button" className="gi-link" onClick={() => setDescOpen((o) => !o)}>{descOpen ? t('Show less', 'عرض أقل') : t('Read more', 'قراءة المزيد')}</button>}
              </>
            ) : (
              <button type="button" className="gi-link gi-link--lg" onClick={() => onOpenSettings('info')}>{t('Add group description', 'أضف وصفًا للمجموعة')}</button>
            )}
            {conversation.created_at && <small className="gi-desc__meta">{t('Group created', 'أُنشئت')} {fmtTime(conversation.created_at)}</small>}
          </section>
        )}

        {/* ---------------- media, links & docs ---------------- */}
        <section className="gi-card">
          <div className="gi-card__head">
            <strong>{t('Media and files', 'الوسائط والملفات')}</strong>
            <span className="gi-card__count">{mediaCount}</span>
          </div>
          {mediaCount === 0 ? (
            <p className="gi-empty">{t('Photos and files shared in this group will appear here.', 'الصور والملفات المشاركة في المجموعة هتظهر هنا.')}</p>
          ) : (
            <>
              {media.length > 0 && (
                <div className="gi-thumbs">
                  {media.map((a, i) => (
                    <button type="button" key={a.url || i} className="gi-thumb" onClick={() => openFiles(media, i)} aria-label={a.original_name}>
                      <Thumb url={a.url} alt={a.original_name} />
                    </button>
                  ))}
                </div>
              )}
              {docs.map((a, i) => (
                <button type="button" key={a.url || i} className="gi-file" onClick={() => openFiles(docs, i)}>
                  <span className="gi-row__icon gi-tone--primary"><Icon name="file" size={16} /></span>
                  <span className="gi-file__name">{a.original_name}</span>
                  <span className="gi-file__size">{fmtBytes(a.size_bytes)}</span>
                </button>
              ))}
            </>
          )}
        </section>

        {/* ---------------- settings ---------------- */}
        <section className="gi-card gi-list">
          <Row icon="bell" title={t('Mute notifications', 'كتم الإشعارات')} hint={flag('mute') ? t('Muted', 'مكتومة') : t('On', 'مفعّلة')}>
            <Switch on={flag('mute')} onChange={(v) => onToggleFlag('mute', v)} label={t('Mute notifications', 'كتم الإشعارات')} />
          </Row>
          <Row icon="star" tone="amber" title={t('Add to favourites', 'إضافة للمفضلة')}>
            <Switch on={flag('favorite')} onChange={(v) => onToggleFlag('favorite', v)} label={t('Favourite', 'مفضلة')} />
          </Row>
          <Row icon="pin" tone="teal" title={t('Pin conversation', 'تثبيت المحادثة')}>
            <Switch on={flag('pin')} onChange={(v) => onToggleFlag('pin', v)} label={t('Pin conversation', 'تثبيت المحادثة')} />
          </Row>
          <Row icon="archive" tone="slate" title={t('Archive', 'أرشفة')}>
            <Switch on={flag('archive')} onChange={(v) => onToggleFlag('archive', v)} label={t('Archive', 'أرشفة')} />
          </Row>
          <label className="gi-row">
            <span className="gi-row__icon gi-tone--violet"><Icon name="folder" size={18} /></span>
            <span className="gi-row__text">
              <strong>{t('Category', 'التصنيف')}</strong>
              <input
                type="text"
                className="gi-inline-input"
                value={category}
                placeholder={t('e.g. Projects, Support…', 'مثال: المشاريع، الدعم…')}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={() => onSetCategory(category.trim() || null)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </span>
          </label>
        </section>

        {isAdmin && settings && (
          <section className="gi-card gi-list">
            <Row icon="lock" title={t('Group permissions', 'صلاحيات المجموعة')}
              hint={settings.only_admins_send ? t('Only admins can send', 'المشرفون فقط يرسلون') : t('Everyone can send', 'الجميع يستطيع الإرسال')}
              onClick={() => onOpenSettings('perms')}>
              <Icon name="chevron-right" size={16} className="gi-chev" />
            </Row>
            <Row icon="file" tone="teal" title={t('Message types', 'أنواع الرسائل')}
              hint={restrictedTypes ? t(`${TYPE_TOTAL - restrictedTypes} of ${TYPE_TOTAL} allowed`, `${TYPE_TOTAL - restrictedTypes} من ${TYPE_TOTAL} مسموح`) : t('All allowed', 'الكل مسموح')}
              onClick={() => onOpenSettings('types')}>
              <Icon name="chevron-right" size={16} className="gi-chev" />
            </Row>
            {!managed && (
              <Row icon="link" tone="green" title={t('Invite link', 'رابط الدعوة')}
                hint={settings.invite_enabled ? (settings.join_approval ? t('On · needs approval', 'مفعّل · بموافقة') : t('On', 'مفعّل')) : t('Off', 'متوقف')}
                onClick={() => onOpenSettings('invite')}>
                <Icon name="chevron-right" size={16} className="gi-chev" />
              </Row>
            )}
            {!managed && (
              <Row icon="users" tone="amber" title={t('Join requests', 'طلبات الانضمام')} onClick={() => onOpenSettings('requests')}>
                {conversation.pending_requests > 0 && <em className="gi-badge gi-badge--inline">{conversation.pending_requests}</em>}
                <Icon name="chevron-right" size={16} className="gi-chev" />
              </Row>
            )}
          </section>
        )}

        {(onWall || onAutoSave) && (
          <section className="gi-card gi-list">
            {onWall && (
              <>
                <Row icon="palette" tone="violet" title={t('Chat background', 'خلفية المحادثة')} hint={t('Only for this chat', 'للمحادثة دي بس')} onClick={() => setWallOpen((o) => !o)}>
                  <Icon name={wallOpen ? 'chevron-down' : 'chevron-right'} size={16} className="gi-chev" />
                </Row>
                {wallOpen && (
                  <div className="gi-wall">
                    <WallpaperPicker
                      value={wall} usingDefault={wallIsDefault} onChange={onWall} onUseDefault={onWallUseDefault}
                      customWalls={customWalls} onAddCustomWall={onAddCustomWall} onRemoveCustomWall={onRemoveCustomWall}
                      anim={wallAnim} onAnim={onWallAnim}
                    />
                  </div>
                )}
              </>
            )}
            {onAutoSave && (
              <Row icon="download" tone="teal" title={t('Save received media', 'حفظ الوسائط المستلمة')} hint={t('Saved automatically into a "UIPE" folder', 'بتتحفظ تلقائيًا في مجلد "UIPE"')}>
                <Switch on={!!autoSave} onChange={onAutoSave} label={t('Save received media', 'حفظ الوسائط المستلمة')} />
              </Row>
            )}
          </section>
        )}

        {/* ---------------- members ---------------- */}
        <section className="gi-card gi-members" ref={membersRef}>
          <div className="gi-card__head">
            <strong>{total} {total === 1 ? t('member', 'عضو') : t('members', 'أعضاء')}</strong>
            <button type="button" className="gi-icon-btn" onClick={() => { setSearching((s) => !s); setQuery(''); }} aria-label={t('Search members', 'بحث في الأعضاء')}>
              <Icon name={searching ? 'x' : 'search'} size={17} />
            </button>
          </div>

          {searching && (
            <div className="gi-search">
              <Icon name="search" size={15} />
              <input ref={searchRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search members', 'بحث في الأعضاء')} />
            </div>
          )}

          {conversation.can_add_members && !q && (
            <button type="button" className="gi-member gi-member--cta" onClick={onAddMember}>
              <span className="gi-cta-icon"><Icon name="plus" size={20} /></span>
              <span className="gi-member__meta"><strong>{t('Add members', 'إضافة أعضاء')}</strong></span>
            </button>
          )}
          {!managed && !q && (isAdmin || conversation.invite_token) && (
            <button type="button" className="gi-member gi-member--cta" onClick={() => onOpenSettings('invite')}>
              <span className="gi-cta-icon"><Icon name="link" size={18} /></span>
              <span className="gi-member__meta"><strong>{t('Invite via link', 'دعوة عبر رابط')}</strong></span>
            </button>
          )}

          {!q && (
            <div className="gi-member">
              <Avatar name={t('You', 'أنت')} size="sm" />
              <span className="gi-member__meta"><strong>{t('You', 'أنت')}</strong></span>
              {conversation.my_role !== 'member' && <span className={`gi-role${isOwner ? ' is-owner' : ''}`}>{roleText(conversation.my_role)}</span>}
            </div>
          )}

          {shown.map((p) => {
            const actions = actionsFor(p);
            const sub = [p.account_role ? roleLabel(p.account_role) : '', p.org || ''].filter(Boolean).join(' · ');
            return (
              <div className="gi-member" key={p.id}>
                <Avatar name={p.full_name} size="sm" src={p.avatar_path} />
                <span className="gi-member__meta">
                  <strong>{p.full_name}</strong>
                  {sub && <small>{sub}</small>}
                  {p.send_restricted && <span className="gi-pill gi-pill--warn"><Icon name="lock" size={10} /> {t('Can’t send', 'ممنوع من الإرسال')}</span>}
                </span>
                {p.group_role !== 'member' && <span className={`gi-role${p.group_role === 'owner' ? ' is-owner' : ''}`}>{roleText(p.group_role)}</span>}
                {actions.length > 0 && (
                  <span className="gi-menu-wrap" ref={menuFor === p.id ? menuRef : null}>
                    <button type="button" className="gi-icon-btn" aria-label={t('Member actions', 'إجراءات العضو')} aria-expanded={menuFor === p.id} onClick={() => setMenuFor((c) => (c === p.id ? null : p.id))}>
                      <Icon name="more-vertical" size={17} />
                    </button>
                    {menuFor === p.id && (
                      <div className="gi-menu" role="menu">
                        {actions.map((a) => (
                          <button type="button" role="menuitem" key={a.key} className={a.danger ? 'is-danger' : ''} onClick={() => { setMenuFor(null); onMemberAction(a.key, p); }}>
                            <Icon name={a.icon} size={15} /> {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </span>
                )}
              </div>
            );
          })}

          {q && filtered.length === 0 && <p className="gi-empty">{t('No members match your search.', 'مفيش أعضاء مطابقين للبحث.')}</p>}
          {!q && filtered.length > MEMBER_PREVIEW && (
            <button type="button" className="gi-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? t('Show fewer', 'عرض أقل') : t(`View all (${filtered.length})`, `عرض الكل (${filtered.length})`)}
              <Icon name={showAll ? 'chevron-up' : 'chevron-down'} size={15} />
            </button>
          )}
        </section>

        {/* ---------------- danger zone ---------------- */}
        <section className="gi-card gi-list gi-danger">
          <Row icon="logout" danger title={t('Exit group', 'مغادرة المجموعة')} onClick={onLeave} />
          {isOwner && <Row icon="trash" danger title={t('Delete group', 'حذف المجموعة')} hint={t('Removes the group for everyone', 'بتحذف المجموعة للجميع')} onClick={onDelete} />}
        </section>

        <p className="gi-foot">
          {conversation.created_at ? `${t('Created', 'أُنشئت')} ${fmtTime(conversation.created_at)}` : ''}
        </p>
      </div>

      {photoOpen && photo && (
        <div className="gi-photo" role="dialog" aria-modal="true" onClick={() => setPhotoOpen(false)}>
          <button type="button" className="gi-photo__close" aria-label={t('Close', 'إغلاق')} onClick={() => setPhotoOpen(false)}><Icon name="x" size={20} /></button>
          <img src={photo} alt={conversation.subject || ''} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </aside>
  );
}
