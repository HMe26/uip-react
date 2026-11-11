import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import ImageCropModal from '../ImageCropModal';
import { useLanguage } from '../../context/LanguageContext';

// Shared between Settings (uploader) and Topbar (display) so the new photo
// shows up everywhere immediately, without a page reload.
export const AVATAR_EVENT = 'uip:avatar-updated';

/** Tells the Topbar the signed-in person's photo changed (call after any avatar upload). */
export const announceAvatar = (path) => window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { path: path || null } }));
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const avatarSrc = (path) => (path ? (path.startsWith('http') || path.startsWith('blob:') ? path : `/${path.replace(/^\//, '')}`) : null);

const TEXT = {
  en: {
    change: 'Change photo', upload: 'Upload photo', hint: 'Drag an image here, or click to choose. JPG, PNG or WebP, up to 5 MB.',
    drop: 'Drop to upload', uploading: 'Uploading…', saved: 'Photo updated', badType: 'Please choose a JPG, PNG or WebP image.', tooBig: 'That image is larger than 5 MB.', alt: 'Your profile photo',
    publicLabel: 'Show my photo to other people', publicHint: 'When off, everyone else (chats, people search, public pages, feed, meetings) sees your initials instead of your photo.', publicFail: 'Could not save this setting.',
  },
  ar: {
    change: 'تغيير الصورة', upload: 'رفع صورة', hint: 'اسحب صورة هنا أو اضغط للاختيار. JPG أو PNG أو WebP حتى 5 ميجا.',
    drop: 'أفلت الصورة للرفع', uploading: 'جارٍ الرفع…', saved: 'تم تحديث الصورة', badType: 'اختر صورة بصيغة JPG أو PNG أو WebP.', tooBig: 'حجم الصورة أكبر من 5 ميجا.', alt: 'صورتك الشخصية',
    publicLabel: 'إظهار صورتي للآخرين', publicHint: 'عند الإيقاف يرى الآخرون (المحادثات والبحث عن الأشخاص والصفحات العامة والفيد والاجتماعات) الحروف الأولى من اسمك بدل صورتك.', publicFail: 'تعذّر حفظ هذا الإعداد.',
  },
};

// Portals return the person's avatar under different keys (profile / user /
// top level) — read them all.
const readAvatar = (json) => json?.data?.profile?.avatar_path || json?.data?.user?.avatar_path || json?.data?.avatar_path || json?.data?.path || null;

/**
 * Avatar upload card shared by every portal's Settings page.
 *   endpoint         POST (multipart `avatar`) — the portal's own upload route
 *   profileEndpoint  GET that returns the person's avatar_path; used to
 *                    re-read the photo when the upload response omits it and,
 *                    when `avatarPath` is undefined, to load the current photo.
 */
export default function AvatarUploader({
  name = '',
  avatarPath,
  endpoint = '/api/v1/data-analysis/settings/avatar',
  profileEndpoint = '/api/v1/data-analysis/settings',
  onUploaded,
  showPrivacy = true,
}) {
  const { locale } = useLanguage();
  const tx = TEXT[locale] || TEXT.en;
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [current, setCurrent] = useState(avatarPath);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [done, setDone] = useState(false);
  const [isPublic, setIsPublic] = useState(null); // null = loading
  const [savingPublic, setSavingPublic] = useState(false);

  useEffect(() => {
    if (!showPrivacy) return undefined;
    let alive = true;
    api.get('/api/v1/account/photo-privacy').then((json) => { if (alive) setIsPublic(json?.data?.public !== false); }).catch(() => {});
    return () => { alive = false; };
  }, [showPrivacy]);

  async function togglePublic() {
    if (isPublic === null || savingPublic) return;
    const next = !isPublic;
    setIsPublic(next); setSavingPublic(true); setError(null);
    try {
      const json = await api.patch('/api/v1/account/photo-privacy', { public: next });
      setIsPublic(json?.data?.public !== false);
    } catch (err) {
      setIsPublic(!next);
      setError(errorMessage(err) || tx.publicFail);
    } finally {
      setSavingPublic(false);
    }
  }

  useEffect(() => { setCurrent(avatarPath); }, [avatarPath]);
  useEffect(() => {
    if (avatarPath !== undefined || !profileEndpoint) return undefined;
    let cancelled = false;
    api.get(profileEndpoint).then((json) => { if (!cancelled) setCurrent(readAvatar(json)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [avatarPath, profileEndpoint]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!done) return undefined;
    const id = setTimeout(() => setDone(false), 3000);
    return () => clearTimeout(id);
  }, [done]);

  // Pick -> crop/preview dialog -> upload only after "Apply".
  function handleFile(file) {
    if (!file) return;
    setError(null); setDone(false);
    if (inputRef.current) inputRef.current.value = '';
    if (!TYPES.includes(file.type)) { setError(tx.badType); return; }
    if (file.size > MAX_BYTES) { setError(tx.tooBig); return; }
    setCropFile(file);
  }

  async function uploadFile(file) {
    setCropFile(null);
    setPreview(URL.createObjectURL(file)); // instant preview while uploading
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const json = await api.postForm(endpoint, formData);
      // Prefer the path the API returns; otherwise re-read the profile.
      let path = readAvatar(json);
      if (!path && profileEndpoint) {
        path = readAvatar(await api.get(profileEndpoint));
      }
      setCurrent(path);
      setPreview(null);
      setDone(true);
      announceAvatar(path);
      onUploaded?.(path);
    } catch (err) {
      setPreview(null); // roll back to the previous photo
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const shown = preview || avatarSrc(current);

  return (
    <div
      className={`avatar-up${drag ? ' is-drag' : ''}${busy ? ' is-busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) handleFile(e.dataTransfer.files?.[0]); }}
    >
      <button type="button" className="avatar-up__pic" onClick={() => inputRef.current?.click()} disabled={busy} aria-label={current ? tx.change : tx.upload}>
        {shown ? <img src={shown} alt={tx.alt} /> : <span>{(name || '?').slice(0, 1).toUpperCase()}</span>}
        <span className="avatar-up__overlay"><Icon name={busy ? 'refresh' : 'image'} size={20} className={busy ? 'avatar-up__spin' : undefined} /></span>
      </button>

      <div className="avatar-up__body">
        <div className="avatar-up__actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={16} /> {busy ? tx.uploading : (current ? tx.change : tx.upload)}
          </button>
          {done && <span className="avatar-up__ok" role="status"><Icon name="check-circle" size={16} /> {tx.saved}</span>}
        </div>
        <p className="avatar-up__hint">{drag ? tx.drop : tx.hint}</p>
        {showPrivacy && isPublic !== null && (
          <div className="avatar-up__privacy">
            <span>
              <strong>{tx.publicLabel}</strong>
              <span className="avatar-up__hint">{tx.publicHint}</span>
            </span>
            <button type="button" className={`avatar-up__switch${isPublic ? ' is-on' : ''}`} role="switch" aria-checked={isPublic} aria-label={tx.publicLabel} onClick={togglePublic} disabled={savingPublic} />
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>

      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      {cropFile && (
        <ImageCropModal
          file={cropFile} aspect={1} outWidth={800} round
          title={tx.change}
          onCancel={() => setCropFile(null)} onConfirm={uploadFile}
        />
      )}
    </div>
  );
}
