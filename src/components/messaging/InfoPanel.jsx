import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { Avatar } from './ConversationRail';
import { GroupTop, GroupMembers, GroupDanger } from './GroupPanel';
import WallpaperPicker from './WallpaperPicker';
import GroupInfoView from './GroupInfoView';
import { fmtBytes, roleLabel } from './format';
import { useProtectedSrc } from '../../lib/chatMedia';
import { useLanguage } from '../../context/LanguageContext';
import { BioBubble } from './BioNote';
import SavedProfile from './SavedProfile';

/**
 * Right-hand info panel — ported from renderInfoPanel()/infoToggleRow() in
 * messaging.js. Sections: group hero/rules (group only), wallpaper,
 * favorite/pin/mute/archive toggles, category input, members list with
 * admin actions (group only), shared files, leave/delete (group only).
 *
 * `convMeta` is the conversation's row from the inbox list (carries the
 * per-member flags/category — those live there, not on the thread's
 * `conversation` object, same split the original state had between
 * state.activeConversation and findConv()).
 */
/** Thumbnail of a shared chat photo (private file: fetched with the token). */
function InfoThumb({ url, alt }) {
  const { src } = useProtectedSrc(url);
  return <img src={src || undefined} alt={alt} />;
}

export default function InfoPanel({
  conversation,
  convMeta,
  others,
  messages,
  myUserId,
  onToggleFlag,
  onSetCategory,
  onAddMember,
  onOpenGroupSettings,
  onMemberAction,
  onLeaveGroup,
  onDeleteGroup,
  onBlockUser,
  onUnblockUser,
  onReportUser,
  onRenameSaved,
  onSavedAvatar,
  onClose,
  wall = 'dots',
  wallIsDefault = true,
  onWall,
  onWallUseDefault,
  customWalls = [],
  onAddCustomWall,
  onRemoveCustomWall,
  wallAnim = false,
  onWallAnim,
  autoSave = true,
  onAutoSave,
}) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const [category, setCategory] = useState(convMeta?.category || '');
  useEffect(() => {
    setCategory(convMeta?.category || '');
  }, [conversation?.id, convMeta?.category]);

  if (!conversation) return null;

  if (conversation.is_group) {
    return (
      <GroupInfoView
        conversation={conversation}
        convMeta={convMeta}
        others={others}
        messages={messages}
        myUserId={myUserId}
        onClose={onClose}
        onToggleFlag={onToggleFlag}
        onSetCategory={onSetCategory}
        onAddMember={onAddMember}
        onOpenSettings={onOpenGroupSettings}
        onMemberAction={onMemberAction}
        onLeave={onLeaveGroup}
        onDelete={onDeleteGroup}
        wall={wall}
        wallIsDefault={wallIsDefault}
        onWall={onWall}
        onWallUseDefault={onWallUseDefault}
        customWalls={customWalls}
        onAddCustomWall={onAddCustomWall}
        onRemoveCustomWall={onRemoveCustomWall}
        wallAnim={wallAnim}
        onWallAnim={onWallAnim}
        autoSave={autoSave}
        onAutoSave={onAutoSave}
      />
    );
  }

  const files = [];
  messages.forEach((m) => (m.attachments || []).forEach((a) => files.push(a)));
  const recentFiles = files.slice(-8).reverse();

  const flags = [
    { key: 'favorite', label: t('Favorite', 'مفضلة'), on: !!convMeta?.is_favorite },
    { key: 'pin', label: t('Pin conversation', 'تثبيت المحادثة'), on: !!convMeta?.is_pinned },
    { key: 'mute', label: t('Mute notifications', 'كتم الإشعارات'), on: !!convMeta?.is_muted },
    { key: 'archive', label: t('Archive', 'أرشفة'), on: !!convMeta?.is_archived },
  ];

  return (
    <aside className="msg-info" data-info-panel>
      <div className="msg-info__head">
        <strong className="text-h4">{t('Conversation info', 'معلومات المحادثة')}</strong>
        <button type="button" className="msg-icon-btn" onClick={onClose} aria-label={t('Close', 'إغلاق')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="msg-info__body" data-info-body>
        {conversation.is_group ? (
          <GroupTop conversation={conversation} others={others} onOpenSettings={onOpenGroupSettings} onAddMember={onAddMember} />
        ) : conversation.is_saved ? (
          <SavedProfile conversation={conversation} onRenameSaved={onRenameSaved} onSavedAvatar={onSavedAvatar} />
        ) : (
          <div className="msg-info__hero">
            <Avatar name={others[0]?.full_name || ''} src={others[0]?.avatar_path} />
            <strong>{others[0]?.full_name || ''}</strong>
            {others[0]?.account_role && <span className="msg-info__role">{roleLabel(others[0].account_role)}</span>}
            {others[0]?.email && <span className="msg-info__email" dir="ltr">{others[0].email}</span>}
            {others[0]?.org && <span className="msg-info__org">{others[0].org}</span>}
            {others[0]?.bio && <BioBubble text={others[0].bio} styleId={others[0].bio_style} tail={false} />}
          </div>
        )}

        {onAutoSave && (
          <div className="msg-info__card">
            <div className="msg-info__toggle-row">
              <span>
                {t('Save received media to phone', 'حفظ الملفات المستلمة على الموبايل')}
                <small style={{ display: 'block', opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                  {t('Photos, videos and files are saved automatically into a "UIPE" folder.', 'الصور والفيديوهات والملفات بتتحفظ تلقائيًا في مجلد "UIPE".')}
                </small>
              </span>
              <button type="button" className={`msg-switch${autoSave ? ' is-on' : ''}`} onClick={() => onAutoSave(!autoSave)} aria-pressed={autoSave} aria-label={t('Save received media to phone', 'حفظ الملفات المستلمة على الموبايل')} />
            </div>
          </div>
        )}
        {onWall && (
          <div>
            <div className="msg-info__section-title">{t('Background for this chat', 'خلفية المحادثة دي')}</div>
            <WallpaperPicker
              value={wall}
              usingDefault={wallIsDefault}
              onChange={onWall}
              onUseDefault={onWallUseDefault}
              customWalls={customWalls}
              onAddCustomWall={onAddCustomWall}
              onRemoveCustomWall={onRemoveCustomWall}
              anim={wallAnim}
              onAnim={onWallAnim}
            />
            <p className="msg-info__hint">{t('Only this chat. Set one for all chats in Chat settings.', 'للمحادثة دي بس. خلفية كل المحادثات من إعدادات الشات.')}</p>
          </div>
        )}
        <div className="msg-info__card">
          {flags.map((f) => (
            <div className="msg-info__toggle-row" key={f.key}>
              <span>{f.label}</span>
              <button
                type="button"
                className={`msg-switch${f.on ? ' is-on' : ''}`}
                onClick={() => onToggleFlag(f.key, !f.on)}
                aria-pressed={f.on}
              />
            </div>
          ))}
        </div>

        <div>
          <div className="msg-info__section-title">{t('Category', 'التصنيف')}</div>
          <input
            type="text"
            value={category}
            placeholder={t('e.g. Projects, Support…', 'مثال: المشاريع، الدعم…')}
            onChange={(e) => setCategory(e.target.value)}
            onBlur={() => onSetCategory(category.trim() || null)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>

        {conversation.is_group && (
          <GroupMembers conversation={conversation} others={others} myUserId={myUserId} onAddMember={onAddMember} onMemberAction={onMemberAction} />
        )}

        <div>
          <div className="msg-info__section-title">{t('Shared files', 'الملفات المشتركة')}</div>
          {recentFiles.length === 0 ? (
            <p className="text-small text-muted">{t('No files shared yet.', 'لا توجد ملفات مشتركة بعد.')}</p>
          ) : (
            recentFiles.map((a, i) => (
              <a className="msg-info__file" key={i} href="#"
                onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return; e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('uip:open-file', { detail: { files: recentFiles.map((f) => ({ url: f.url, name: f.original_name, protected: true })), index: i } })); }}>
                {a.kind === 'image' ? (
                  <InfoThumb url={a.url} alt={a.original_name} />
                ) : (
                  <span className="msg-info__file-icon">
                    <Icon name="file" size={16} />
                  </span>
                )}
                <span className="msg-info__file-name">{a.original_name}</span>
                <span className="msg-info__file-size">{fmtBytes(a.size_bytes)}</span>
              </a>
            ))
          )}
        </div>
        {conversation.is_group && <GroupDanger conversation={conversation} onLeave={onLeaveGroup} onDelete={onDeleteGroup} />}

        {!conversation.is_group && !conversation.is_saved && others[0] && !others[0].is_deleted && (onBlockUser || onReportUser) && (
          <div>
            <div className="msg-info__section-title">{t('Safety', 'الأمان')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {conversation.blocked_by_me ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUnblockUser?.({ id: others[0].id })}>
                  <Icon name="check-circle" size={14} /> {t('Unblock', 'إلغاء الحظر')}
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onBlockUser?.(others[0].id, others[0].full_name)}>
                  <Icon name="x-circle" size={14} /> {t('Block', 'حظر')}
                </button>
              )}
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onReportUser?.(others[0].id, others[0].full_name)}>
                <Icon name="alert" size={14} /> {t('Report', 'إبلاغ')}
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
