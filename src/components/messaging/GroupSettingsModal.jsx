import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { Avatar } from './ConversationRail';
import { Modal } from './modals';
import { api } from '../../api/client';
import { publicOrigin } from '../../config/siteUrl';
import { useLanguage } from '../../context/LanguageContext';
import { fmtTime } from './format';
import { BASE, GROUP_TYPES, HIDDEN_TYPES, localizeError } from './groupText';

const ALL_KEYS = GROUP_TYPES.map((x) => x.key);
/** Allowed list as the UI sees it (gif/sticker are not shown). null = everything. */
const visibleTypes = (list) => (list ? list.filter((k) => ALL_KEYS.includes(k)) : ALL_KEYS);

/**
 * WhatsApp-style group settings. Tabs: Info · Permissions · Message types · Invite link · Requests.
 * Switches (permissions, link on/off, join approval) save immediately; Info and Message types have a Save button.
 * Every successful call returns the refreshed thread, which is handed to `onUpdated`.
 */
export default function GroupSettingsModal({ conversation, conversations = [], initialTab = 'info', onClose, onUpdated, onError }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const id = conversation.id;
  const settings = conversation.settings || {};
  const isOwner = conversation.my_role === 'owner';
  const managed = !!conversation.managed_by_student_group;

  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(conversation.subject || '');
  const [description, setDescription] = useState(conversation.description || '');
  const [types, setTypes] = useState(() => new Set(visibleTypes(settings.allowed_types)));
  const [requests, setRequests] = useState([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteToken, setInviteToken] = useState(conversation.invite_token || null);
  const [sendQuery, setSendQuery] = useState('');
  const [sentTo, setSentTo] = useState({});
  const fileRef = useRef(null);

  useEffect(() => {
    setInviteToken(conversation.invite_token || null);
  }, [conversation.invite_token]);

  const fail = useCallback((err) => {
    onError?.(new Error(localizeError(err?.message) || t('Something went wrong.', 'حدث خطأ ما.')));
  }, [onError]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body) => run(async () => {
    const res = await api.patch(`${BASE}/conversations/${id}/group`, body);
    if (res.data) onUpdated?.(res.data);
    return res;
  });

  // ---- info
  const saveInfo = async () => {
    if (!name.trim()) return fail(new Error('Group name is required.'));
    await patch({ name: name.trim(), description: description.trim() });
  };
  const pickPhoto = async (file) => {
    if (!file) return;
    await run(async () => {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await api.postForm(`${BASE}/conversations/${id}/group/avatar`, fd);
      if (res.data) onUpdated?.(res.data);
    });
  };
  const removePhoto = () => run(async () => {
    const res = await api.del(`${BASE}/conversations/${id}/group/avatar`);
    if (res.data) onUpdated?.(res.data);
  });

  // ---- types
  const toggleType = (key) => setTypes((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const typesDirty = (() => {
    const current = new Set(visibleTypes(settings.allowed_types));
    if (current.size !== types.size) return true;
    for (const k of types) if (!current.has(k)) return true;
    return false;
  })();
  const saveTypes = () => {
    if (types.size === 0) return fail(new Error('Choose at least one allowed message type.'));
    return patch({ allowed_types: [...types, ...HIDDEN_TYPES] });
  };

  // ---- invite link
  const link = inviteToken ? `${publicOrigin()}/join/group/${inviteToken}` : '';
  const ensureLink = useCallback(async () => {
    if (inviteToken || managed) return;
    try {
      const res = await api.get(`${BASE}/conversations/${id}/invite`);
      setInviteToken(res.data?.token || null);
    } catch (err) {
      fail(err);
    }
  }, [id, inviteToken, managed, fail]);
  useEffect(() => {
    if (tab === 'invite' && settings.invite_enabled) ensureLink();
  }, [tab, settings.invite_enabled, ensureLink]);

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      fail(err);
    }
  };
  const shareLink = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: conversation.subject || t('Group', 'مجموعة'), url: link }); return; } catch { /* cancelled */ }
    }
    copyLink();
  };
  const resetLink = async () => {
    if (!window.confirm(t('Reset the invite link? The old link will stop working.', 'إعادة تعيين الرابط؟ الرابط القديم سيتوقف عن العمل.'))) return;
    await run(async () => {
      const res = await api.post(`${BASE}/conversations/${id}/invite/reset`);
      setInviteToken(res.data?.token || null);
      const thread = await api.get(`${BASE}/conversations/${id}`);
      if (thread.data) onUpdated?.(thread.data);
    });
  };
  const sendLinkTo = async (c) => {
    await run(async () => {
      await api.postForm(`${BASE}/conversations/${c.id}/messages`, (() => {
        const fd = new FormData();
        fd.append('body', `${t('Join my group', 'انضم إلى مجموعتي')} “${conversation.subject || ''}”: ${link}`);
        return fd;
      })());
      setSentTo((prev) => ({ ...prev, [c.id]: true }));
    });
  };

  // ---- requests
  const loadRequests = useCallback(async () => {
    try {
      const res = await api.get(`${BASE}/conversations/${id}/join-requests`);
      setRequests(res.data || []);
    } catch (err) {
      fail(err);
    } finally {
      setRequestsLoaded(true);
    }
  }, [id, fail]);
  useEffect(() => {
    if (tab === 'requests') loadRequests();
  }, [tab, loadRequests]);

  const decide = async (r, approve) => {
    await run(async () => {
      await api.post(`${BASE}/conversations/${id}/join-requests/${r.id}/${approve ? 'approve' : 'reject'}`);
      setRequests((prev) => prev.filter((x) => x.id !== r.id));
      const thread = await api.get(`${BASE}/conversations/${id}`);
      if (thread.data) onUpdated?.(thread.data);
    });
  };

  const tabs = [
    { key: 'info', label: t('Group info', 'بيانات المجموعة'), icon: 'info' },
    { key: 'perms', label: t('Permissions', 'الصلاحيات'), icon: 'lock' },
    { key: 'types', label: t('Message types', 'أنواع الرسائل'), icon: 'file' },
    ...(managed ? [] : [{ key: 'invite', label: t('Invite link', 'رابط الدعوة'), icon: 'link' }]),
    ...(managed ? [] : [{ key: 'requests', label: t('Join requests', 'طلبات الانضمام'), icon: 'users', badge: conversation.pending_requests || 0 }]),
  ];

  const Switch = ({ on, onChange, disabled }) => (
    <button type="button" className={`msg-switch${on ? ' is-on' : ''}`} aria-pressed={on} disabled={disabled || busy} onClick={() => onChange(!on)} />
  );

  const Row = ({ title, hint, children }) => (
    <div className="grp-row">
      <div className="grp-row__text">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </div>
  );

  const visibleConvs = conversations
    .filter((c) => String(c.id) !== String(id) && !c.is_archived)
    .filter((c) => !sendQuery.trim() || String(c.subject || '').toLowerCase().includes(sendQuery.trim().toLowerCase()))
    .slice(0, 30);

  return (
    <Modal title={t('Group settings', 'إعدادات المجموعة')} onClose={onClose}>
      <div className="grp-modal">
        <div className="grp-tabs" role="tablist">
          {tabs.map((x) => (
            <button type="button" role="tab" aria-selected={tab === x.key} key={x.key} className={`grp-tab${tab === x.key ? ' is-active' : ''}`} onClick={() => setTab(x.key)}>
              <Icon name={x.icon} size={14} />
              <span>{x.label}</span>
              {x.badge > 0 && <em className="grp-badge">{x.badge}</em>}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <div className="grp-pane">
            <div className="grp-photo">
              <Avatar name={name || conversation.subject} isGroup src={conversation.avatar_path} />
              <div className="grp-photo__actions">
                <button type="button" className="btn btn-outline btn-sm" disabled={busy || !conversation.can_edit_info} onClick={() => fileRef.current?.click()}>
                  <Icon name="image" size={14} /> {conversation.avatar_path ? t('Change photo', 'تغيير الصورة') : t('Add photo', 'إضافة صورة')}
                </button>
                {conversation.avatar_path && (
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy || !conversation.can_edit_info} onClick={removePhoto}>
                    <Icon name="trash" size={14} /> {t('Remove', 'إزالة')}
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
            <label className="grp-field">
              <span>{t('Group name', 'اسم المجموعة')}</span>
              <input type="text" value={name} maxLength={100} disabled={!conversation.can_edit_info} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="grp-field">
              <span>{t('Description', 'الوصف')} <small>{description.length}/500</small></span>
              <textarea rows={4} value={description} maxLength={500} disabled={!conversation.can_edit_info} placeholder={t('What is this group about?', 'ما موضوع هذه المجموعة؟')} onChange={(e) => setDescription(e.target.value)} />
            </label>
            {conversation.can_edit_info && (
              <div className="grp-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveInfo}>{t('Save changes', 'حفظ التغييرات')}</button>
              </div>
            )}
          </div>
        )}

        {tab === 'perms' && (
          <div className="grp-pane">
            <div className="grp-card">
              <Row
                title={t('Close the group', 'قفل المجموعة')}
                hint={t('Only admins can send messages. Everyone can still read.', 'المشرفون فقط يمكنهم الإرسال، ويظل الجميع قادرًا على القراءة.')}
              >
                <Switch on={!!settings.only_admins_send} onChange={(v) => patch({ only_admins_send: v })} />
              </Row>
              <Row
                title={t('Members can edit group info', 'الأعضاء يعدّلون بيانات المجموعة')}
                hint={t('Name, description and photo.', 'الاسم والوصف والصورة.')}
              >
                <Switch on={!!settings.members_can_edit_info} onChange={(v) => patch({ members_can_edit_info: v })} />
              </Row>
              <Row
                title={t('Members can add people', 'الأعضاء يضيفون أشخاصًا')}
                hint={t('Also lets members see and share the invite link.', 'ويتيح لهم رؤية رابط الدعوة ومشاركته.')}
              >
                <Switch on={!!settings.members_can_add} onChange={(v) => patch({ members_can_add: v })} />
              </Row>
              {!managed && (
                <Row
                  title={t('Approve new members', 'الموافقة على الأعضاء الجدد')}
                  hint={t('People who use the invite link wait for an admin to accept them.', 'من يدخل برابط الدعوة ينتظر موافقة أحد المشرفين.')}
                >
                  <Switch on={!!settings.join_approval} onChange={(v) => patch({ join_approval: v })} />
                </Row>
              )}
            </div>
            <p className="grp-note">
              {t('Admins and the owner are never limited by these settings.', 'المشرفون والمالك غير مقيّدين بهذه الإعدادات.')}
            </p>
            {isOwner && (
              <p className="grp-note">{t('As the owner you can also transfer ownership or delete the group from the members list.', 'بصفتك المالك يمكنك أيضًا نقل الملكية أو حذف المجموعة من قائمة الأعضاء.')}</p>
            )}
          </div>
        )}

        {tab === 'types' && (
          <div className="grp-pane">
            <p className="grp-note" style={{ marginTop: 0 }}>
              {t('Choose what members are allowed to send. Admins can always send everything.', 'اختر ما يُسمح للأعضاء بإرساله. المشرفون يمكنهم إرسال كل شيء دائمًا.')}
            </p>
            <div className="grp-card">
              {GROUP_TYPES.map((x) => (
                <Row key={x.key} title={<span className="grp-type"><Icon name={x.icon} size={15} />{ar ? x.ar : x.en}</span>} hint={ar ? x.hintAr : x.hintEn}>
                  <Switch on={types.has(x.key)} onChange={() => toggleType(x.key)} />
                </Row>
              ))}
            </div>
            <div className="grp-actions">
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setTypes(new Set(GROUP_TYPES.map((x) => x.key)))}>{t('Allow all', 'السماح بالكل')}</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !typesDirty} onClick={saveTypes}>{t('Save', 'حفظ')}</button>
            </div>
          </div>
        )}

        {tab === 'invite' && !managed && (
          <div className="grp-pane">
            <div className="grp-card">
              <Row
                title={t('Invite link', 'رابط الدعوة')}
                hint={t('Anyone on the platform who opens the link can join (or request to join).', 'أي شخص على المنصة يفتح الرابط يمكنه الانضمام (أو طلب الانضمام).')}
              >
                <Switch on={!!settings.invite_enabled} onChange={(v) => patch({ invite_enabled: v })} />
              </Row>
            </div>
            {settings.invite_enabled ? (
              <>
                <div className="grp-link">
                  <input type="text" readOnly dir="ltr" value={link || t('Creating link…', 'جارٍ إنشاء الرابط…')} onFocus={(e) => e.target.select()} />
                </div>
                <div className="grp-actions grp-actions--start">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!link} onClick={copyLink}>
                    <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? t('Copied', 'تم النسخ') : t('Copy link', 'نسخ الرابط')}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={!link} onClick={shareLink}>
                    <Icon name="share" size={14} /> {t('Share', 'مشاركة')}
                  </button>
                  {conversation.is_admin && (
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={resetLink}>
                      <Icon name="refresh" size={14} /> {t('Reset link', 'إعادة تعيين')}
                    </button>
                  )}
                </div>

                <div className="grp-send">
                  <div className="grp-send__title">{t('Send the link to someone on the platform', 'أرسل الرابط لشخص على المنصة')}</div>
                  <input type="text" value={sendQuery} placeholder={t('Search your conversations…', 'ابحث في محادثاتك…')} onChange={(e) => setSendQuery(e.target.value)} />
                  <div className="msg-picker-list">
                    {visibleConvs.length === 0 && <p className="text-small text-muted" style={{ padding: 10, margin: 0 }}>{t('No conversations found.', 'لا توجد محادثات.')}</p>}
                    {visibleConvs.map((c) => (
                      <div className="msg-picker-item" key={c.id}>
                        <Avatar name={c.subject} isGroup={c.is_group} size="sm" src={c.is_group ? c.group_avatar : c.peer_avatar} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
                        <button type="button" className="btn btn-outline btn-sm" disabled={busy || !link || sentTo[c.id]} onClick={() => sendLinkTo(c)}>
                          {sentTo[c.id] ? t('Sent', 'تم') : t('Send', 'إرسال')}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="grp-note">{t('To invite someone you have no chat with yet, copy the link and send it to them any way you like.', 'لدعوة شخص ليس لديك محادثة معه، انسخ الرابط وأرسله له بأي طريقة.')}</p>
                </div>
              </>
            ) : (
              <p className="grp-note">{t('The link is off. Turn it on to let people join with a link.', 'الرابط متوقف. فعّله للسماح بالانضمام عبر رابط.')}</p>
            )}
          </div>
        )}

        {tab === 'requests' && !managed && (
          <div className="grp-pane">
            {!requestsLoaded ? (
              <p className="text-small text-muted">{t('Loading…', 'جارٍ التحميل…')}</p>
            ) : requests.length === 0 ? (
              <div className="grp-empty">
                <Icon name="users" size={26} />
                <strong>{t('No pending requests', 'لا توجد طلبات معلّقة')}</strong>
                <span>{settings.join_approval
                  ? t('New requests from the invite link will appear here.', 'ستظهر هنا الطلبات الجديدة القادمة من رابط الدعوة.')
                  : t('Turn on “Approve new members” in Permissions to review people before they join.', 'فعّل «الموافقة على الأعضاء الجدد» من الصلاحيات لمراجعة من ينضم.')}</span>
              </div>
            ) : (
              requests.map((r) => (
                <div className="grp-request" key={r.id}>
                  <Avatar name={r.full_name} src={r.avatar_path} size="sm" />
                  <span className="grp-request__meta">
                    <strong>{r.full_name}</strong>
                    <span dir="ltr">{r.email}</span>
                    <small>{fmtTime(r.created_at)}</small>
                  </span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(r, true)}>{t('Accept', 'قبول')}</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => decide(r, false)}>{t('Decline', 'رفض')}</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
