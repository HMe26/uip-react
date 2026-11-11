import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import ImageCropModal from '../ImageCropModal';
import { Avatar } from './ConversationRail';
import { BioBubble, BioEditor } from './BioNote';
import { roleLabel } from './format';
import { api } from '../../api/client';
import { announceAvatar } from '../insight/AvatarUploader';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useChatSettings } from '../../lib/chatSettings';
import { portalPrefix } from '../../config/navConfig';
import '../../styles/css/messaging-saved.css';

/**
 * "Saved messages" profile hub (info panel, top section). Everything about *my* chat identity is editable right here:
 *   - photo (crop → upload / remove), chat name, bio + its design
 *   - "As others see me": a live preview of my card for a contact and for a stranger, driven by the real privacy
 *     settings, with the audience of each field switchable inline (the server enforces the same rules).
 */

const ME = '/api/v1/messaging/me/avatar';
const AUD_QUICK = ['everyone', 'contacts', 'nobody'];

/** Mirrors ChatSettingsService::allows() for a *typical* viewer (a contact who is not on any custom list, or a stranger). */
export function visibleTo(privacy, field, viewer) {
  const a = privacy?.[field]?.audience || 'everyone';
  if (a === 'everyone') return true;
  if (a === 'contacts' || a === 'contacts_except') return viewer === 'contact';
  return false; // 'nobody' / 'only' (a named list) — a typical viewer is not on it
}

const FIELDS = [
  { key: 'avatar', icon: 'image', en: 'Profile photo', ar: 'صورتي الشخصية', kind: 'see' },
  { key: 'bio', icon: 'note', en: 'Bio', ar: 'البايو', kind: 'see' },
  { key: 'last_seen', icon: 'clock', en: 'Last seen', ar: 'آخر ظهور', kind: 'see' },
  { key: 'stories', icon: 'play', en: 'My stories', ar: 'قصصي', kind: 'see' },
  { key: 'messages', icon: 'message', en: 'Message me', ar: 'مراسلتي', kind: 'do' },
  { key: 'calls', icon: 'phone', en: 'Call me', ar: 'الاتصال بي', kind: 'do' },
  { key: 'groups', icon: 'users', en: 'Add me to groups', ar: 'إضافتي لمجموعات', kind: 'do' },
];

export default function SavedProfile({ conversation, onRenameSaved, onSavedAvatar }) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { settings, patch } = useChatSettings();
  const me = conversation?.me || {};
  const fullName = me.full_name || authUser?.full_name || '';
  const role = me.account_role || authUser?.role;

  const [tab, setTab] = useState('edit');
  const [viewer, setViewer] = useState('contact');
  const [bioOpen, setBioOpen] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }
  const [name, setName] = useState(conversation?.saved_default_name === false ? (conversation.subject || '') : '');
  const [nameBusy, setNameBusy] = useState(false);
  const fileRef = useRef(null);
  const noteTimer = useRef(null);

  useEffect(() => () => clearTimeout(noteTimer.current), []);
  useEffect(() => {
    setName(conversation?.saved_default_name === false ? (conversation.subject || '') : '');
  }, [conversation?.id, conversation?.subject, conversation?.saved_default_name]);

  const flash = (ok, text) => {
    setNote({ ok, text });
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 3200);
  };
  const failText = (err) => err?.message || t('Something went wrong, try again.', 'حصلت مشكلة، حاول تاني.');

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (f) setCropFile(f);
  };
  const uploadPhoto = async (file) => {
    setCropFile(null);
    setBusyPhoto(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await api.postForm(ME, fd);
      const path = res.data?.avatar_path || null;
      onSavedAvatar?.(path);
      announceAvatar(path);
      flash(true, t('Photo updated', 'تم تحديث الصورة'));
    } catch (err) {
      flash(false, failText(err));
    } finally {
      setBusyPhoto(false);
    }
  };
  const removePhoto = async () => {
    setBusyPhoto(true);
    try {
      await api.del(ME);
      onSavedAvatar?.(null);
      announceAvatar(null);
      flash(true, t('Photo removed', 'تم حذف الصورة'));
    } catch (err) {
      flash(false, failText(err));
    } finally {
      setBusyPhoto(false);
    }
  };

  const saveName = async () => {
    if (!onRenameSaved || nameBusy) return;
    const next = name.trim();
    const cur = conversation?.saved_default_name === false ? (conversation.subject || '') : '';
    if (next === cur) return;
    setNameBusy(true);
    try { await onRenameSaved(next); flash(true, t('Chat name saved', 'تم حفظ اسم المحادثة')); } finally { setNameBusy(false); }
  };

  const saveBio = async (p) => {
    try {
      await patch(p);
      flash(true, t('Bio saved', 'تم حفظ البايو'));
      setBioOpen(false);
    } catch (err) {
      flash(false, failText(err));
    }
  };

  const setAudience = async (field, audience) => {
    try { await patch({ privacy: { [field]: { audience } } }); } catch (err) { flash(false, failText(err)); }
  };

  const privacy = settings.privacy || {};
  const avatarVisible = visibleTo(privacy, 'avatar', viewer);
  const bioVisible = visibleTo(privacy, 'bio', viewer) && !!(settings.bio || '').trim();
  const seenVisible = visibleTo(privacy, 'last_seen', viewer);
  const audLabel = (a) => ({
    everyone: t('Everyone', 'الكل'),
    contacts: t('My contacts', 'جهات اتصالي'),
    contacts_except: t('Contacts except…', 'جهات اتصالي ما عدا…'),
    only: t('Only some people', 'ناس محددين'),
    nobody: t('Nobody', 'لا أحد'),
  }[a] || a);
  const hasCustom = Object.values(privacy).some((p) => p && (p.audience === 'only' || p.audience === 'contacts_except'));

  const title = conversation?.saved_default_name === false ? conversation.subject : t('Saved Messages', 'الرسائل المحفوظة');
  const hasPhoto = !!me.avatar_path;

  return (
    <section className="savp" aria-label={t('My profile in chat', 'ملفي في الشات')}>
      <div className="savp-hero">
        <div className="savp-hero__cover" aria-hidden="true" />
        <div className="savp-hero__avatar">
          <button type="button" className="savp-avatar-btn" onClick={() => fileRef.current?.click()} disabled={busyPhoto}
            aria-label={t('Change photo', 'تغيير الصورة')} title={t('Change photo', 'تغيير الصورة')}>
            <Avatar name={fullName} saved src={me.avatar_path} />
            <span className="savp-avatar-btn__cam">{busyPhoto ? <span className="savp-spin" /> : <Icon name="edit" size={13} />}</span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
        </div>
        <strong className="savp-hero__title">{title}</strong>
        <div className="savp-hero__id">
          {fullName && <span dir="auto">{fullName}</span>}
          {role && <span className="msg-info__role">{roleLabel(role)}</span>}
        </div>
        <span className="savp-lock"><Icon name="lock" size={12} /> {t('Private — only you can see this chat', 'خاصة — أنت فقط تشوف المحادثة دي')}</span>
      </div>

      <div className="savp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'is-on' : ''} onClick={() => setTab('edit')}>
          <Icon name="edit" size={14} /> {t('Edit', 'تعديل')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'is-on' : ''} onClick={() => setTab('preview')}>
          <Icon name="eye" size={14} /> {t('As others see me', 'كما يراني الآخرون')}
        </button>
      </div>

      {note && <div className={`savp-note ${note.ok ? 'is-ok' : 'is-err'}`} role="status">{note.text}</div>}

      {tab === 'edit' ? (
        <div className="savp-body">
          <div className="savp-card">
            <div className="savp-card__h">{t('Profile photo', 'الصورة الشخصية')}</div>
            <div className="savp-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={busyPhoto}>
                <Icon name="image" size={14} /> {hasPhoto ? t('Change', 'تغيير') : t('Upload', 'رفع صورة')}
              </button>
              {hasPhoto && (
                <button type="button" className="btn btn-secondary btn-sm savp-danger" onClick={removePhoto} disabled={busyPhoto}>
                  <Icon name="trash" size={14} /> {t('Remove', 'حذف')}
                </button>
              )}
            </div>
            <p className="savp-hint">{t('This is your account photo — it updates everywhere on the platform.', 'دي صورة حسابك — بتتحدّث في كل المنصة.')}</p>
          </div>

          <div className="savp-card">
            <div className="savp-card__h">{t('Chat name', 'اسم المحادثة')}</div>
            <input type="text" className="msg-input savp-input" maxLength={60} value={name} disabled={nameBusy}
              placeholder={t('Saved Messages', 'الرسائل المحفوظة')} aria-label={t('Chat name', 'اسم المحادثة')}
              onChange={(e) => setName(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            <p className="savp-hint">{t('Only you see this name. Leave empty for the default.', 'الاسم ده بيظهرلك أنت بس. سيبه فاضي للاسم الافتراضي.')}</p>
          </div>

          <div className="savp-card">
            <div className="savp-card__h">
              {t('Bio', 'البايو')}
              <button type="button" className="savp-link" onClick={() => setBioOpen((o) => !o)} aria-expanded={bioOpen}>
                {bioOpen ? t('Close', 'إغلاق') : ((settings.bio || '').trim() ? t('Edit', 'تعديل') : t('Add', 'إضافة'))}
              </button>
            </div>
            {!bioOpen && ((settings.bio || '').trim()
              ? <BioBubble text={settings.bio} styleId={settings.bio_style} tail={false} />
              : <p className="savp-hint">{t('No bio yet — a short line shown above your photo in your chats.', 'مفيش بايو لسه — سطر قصير بيظهر فوق صورتك في محادثاتك.')}</p>)}
            {bioOpen && <BioEditor settings={settings} save={saveBio} />}
          </div>

          <button type="button" className="savp-more" onClick={() => navigate(`/${portalPrefix(authUser?.role)}/messages/settings`)}>
            <Icon name="settings" size={14} /> {t('All chat & privacy settings', 'كل إعدادات الشات والخصوصية')}
            <Icon name="chevron-right" size={14} className="savp-more__arrow" />
          </button>
        </div>
      ) : (
        <div className="savp-body">
          <div className="savp-seg" role="radiogroup" aria-label={t('Viewer', 'المشاهد')}>
            <button type="button" role="radio" aria-checked={viewer === 'contact'} className={viewer === 'contact' ? 'is-on' : ''} onClick={() => setViewer('contact')}>
              {t('A contact', 'جهة اتصال')}
            </button>
            <button type="button" role="radio" aria-checked={viewer === 'stranger'} className={viewer === 'stranger' ? 'is-on' : ''} onClick={() => setViewer('stranger')}>
              {t('Someone new', 'شخص جديد')}
            </button>
          </div>

          <div className="savp-pv" aria-live="polite">
            <div className="savp-pv__bar">
              <Avatar name={fullName} src={avatarVisible ? me.avatar_path : null} />
              <div className="savp-pv__meta">
                <strong dir="auto">{fullName || '—'}{role && <span className="msg-info__role">{roleLabel(role)}</span>}</strong>
                <span className={`savp-pv__status${seenVisible ? ' is-on' : ''}`}>
                  {seenVisible ? t('Online · last seen shown', 'متصل · آخر ظهور ظاهر') : t('Last seen hidden', 'آخر ظهور مخفي')}
                </span>
              </div>
            </div>
            {bioVisible && <BioBubble text={settings.bio} styleId={settings.bio_style} tail={false} className="savp-pv__bio" />}
            {!avatarVisible && <p className="savp-pv__ghost"><Icon name="eye-off" size={13} /> {t('Photo hidden — they see your initials', 'الصورة مخفية — بيشوفوا الحروف الأولى من اسمك')}</p>}
          </div>

          {[['see', t('What they can see', 'اللي يقدروا يشوفوه')], ['do', t('What they can do', 'اللي يقدروا يعملوه')]].map(([kind, heading]) => (
            <div className="savp-card savp-card--list" key={kind}>
              <div className="savp-group-h">{heading}</div>
              {FIELDS.filter((f) => f.kind === kind).map((f) => {
                const aud = privacy[f.key]?.audience || 'everyone';
                const ok = visibleTo(privacy, f.key, viewer);
                const label = locale === 'ar' ? f.ar : f.en;
                return (
                  <div className="savp-perm" key={f.key}>
                    <span className={`savp-perm__ic${ok ? ' is-ok' : ''}`} aria-hidden="true"><Icon name={ok ? 'check' : 'x'} size={12} /></span>
                    <span className="savp-perm__txt">
                      <Icon name={f.icon} size={14} />
                      <span className="savp-perm__lbl">{label}</span>
                    </span>
                    <select className="savp-select" value={aud} onChange={(e) => setAudience(f.key, e.target.value)} aria-label={label}>
                      {AUD_QUICK.map((a) => <option key={a} value={a}>{audLabel(a)}</option>)}
                      {!AUD_QUICK.includes(aud) && <option value={aud} disabled>{audLabel(aud)}</option>}
                    </select>
                  </div>
                );
              })}
            </div>
          ))}
          {hasCustom && (
            <p className="savp-hint">{t('Custom lists (“except…” / “only…”) are managed in chat settings; the preview assumes you are not on them.', 'القوائم المخصصة (“ما عدا…” / “ناس محددين”) بتتعدّل من إعدادات الشات؛ المعاينة بتفترض إنك مش فيها.')}</p>
          )}
        </div>
      )}

      {cropFile && (
        <ImageCropModal file={cropFile} aspect={1} outWidth={800} round title={t('Change Photo', 'تغيير الصورة')}
          onCancel={() => setCropFile(null)} onConfirm={uploadPhoto} />
      )}
    </section>
  );
}
