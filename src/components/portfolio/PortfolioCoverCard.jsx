import { useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import ImageCropModal from '../ImageCropModal';
import { useLanguage } from '../../context/LanguageContext';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Cover image (hero background) for the public profile page /p/{uuid}.
 * Role-agnostic — used by every portfolio editor (student / academic staff /
 * public-profile editor). Talks to:
 *   POST   /api/v1/portfolios/me/cover   multipart `cover`
 *   DELETE /api/v1/portfolios/me/cover
 * Also previews how the profile photo (users.avatar_path) will look, since the
 * public page now shows the real photo instead of the first letter.
 *
 * Props: coverPath, avatarPath, name, onChanged(newCoverPath|null)
 */
export default function PortfolioCoverCard({ coverPath, avatarPath, name = '', onChanged }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localPreview, setLocalPreview] = useState(null);
  const [pending, setPending] = useState(null);

  const url = (p) => `/${String(p).replace(/^\//, '')}`;
  const shown = localPreview || (coverPath ? url(coverPath) : null);

  function onPick(e) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) { setError(ar ? 'الصيغ المسموحة: JPG أو PNG أو WebP.' : 'Allowed formats: JPG, PNG or WebP.'); return; }
    if (file.size > MAX_BYTES) { setError(ar ? 'الحجم الأقصى 5 ميجابايت.' : 'Maximum size is 5 MB.'); return; }
    setPending(file); // opens the crop/preview dialog — nothing is uploaded until "Apply"
  }

  async function upload(file) {
    setPending(null);
    setLocalPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('cover', file);
      const json = await api.postForm('/api/v1/portfolios/me/cover', fd);
      onChanged?.(json.data?.cover_path || null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLocalPreview(null);
      setBusy(false);
    }
  }

  async function onRemove() {
    setError(null);
    setBusy(true);
    try {
      await api.del('/api/v1/portfolios/me/cover');
      onChanged?.(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const initial = (name || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="card glass-panel st-panel" style={{ padding: 'var(--space-6, 24px)', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
      <h2 className="text-h3" style={{ fontSize: 16, marginBottom: 4 }}>{ar ? 'الغلاف وصورة الحساب' : 'Cover & profile photo'}</h2>
      <p style={{ fontSize: 12.5, opacity: .7, margin: '0 0 14px' }}>
        {ar ? 'الغلاف هو خلفية أعلى صفحتك العامة. صورة الحساب بتظهر بدل الحرف الأول.' : 'The cover is the background at the top of your public page. Your profile photo replaces the first-letter badge.'}
      </p>

      <div style={{ position: 'relative', width: '100%', minWidth: 0 }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: '100%', minWidth: 0, height: 0, paddingTop: 'max(25%, 112px)', borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(118deg, #4b27c2, #6A3DF0 45%, #d56fb0)' }}>
          {shown && <img src={shown} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <span style={{ position: 'absolute', insetInlineStart: 16, bottom: -32, width: 64, height: 64, borderRadius: 18, border: '4px solid var(--bg-surface, #fff)', background: '#6A3DF0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontWeight: 800, fontSize: 24 }}>
          {avatarPath ? <img src={url(avatarPath)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 44, alignItems: 'center' }}>
        <label className="btn btn-primary btn-sm" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? .7 : 1 }}>
          <Icon name="upload" size={15} /> {busy ? (ar ? 'جارِ الرفع…' : 'Uploading…') : (coverPath ? (ar ? 'تغيير الغلاف' : 'Change cover') : (ar ? 'رفع صورة غلاف' : 'Upload cover'))}
          <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }} disabled={busy} onChange={onPick} />
        </label>
        {coverPath && (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onRemove}>
            <Icon name="x" size={15} /> {ar ? 'إزالة الغلاف' : 'Remove cover'}
          </button>
        )}
        <small style={{ opacity: .65 }}>{ar ? 'يفضّل 1600×400 أو أكبر · حتى 5MB' : 'Best at 1600×400 or larger · up to 5 MB'}</small>
      </div>
      {!avatarPath && (
        <p style={{ fontSize: 12.5, opacity: .75, marginTop: 10 }}>
          {ar ? 'لسه معندكش صورة حساب — ارفعها من صفحة «الملف الشخصي» وهتظهر هنا وفي الصفحة العامة.' : 'No profile photo yet — upload one from your Profile page and it will show here and on the public page.'}
        </p>
      )}
      {error && <p style={{ color: 'var(--color-danger, #d33)', fontSize: 13, marginTop: 10 }}>{error}</p>}
      {pending && (
        <ImageCropModal
          file={pending} aspect={4} outWidth={1600}
          title={ar ? 'اضبط صورة الغلاف' : 'Adjust your cover image'}
          onCancel={() => setPending(null)} onConfirm={upload}
        />
      )}
    </div>
  );
}
