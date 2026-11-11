import { useRef, useState } from 'react';
import Icon from '../Icon';
import WallpaperEditor from './WallpaperEditor';
import { getWallStyle, setWallStyle } from '../../lib/wallStyle';
import { useLanguage } from '../../context/LanguageContext';

export const WALLPAPERS = ['dots', 'aurora', 'lagoon', 'forest', 'rose', 'amber', 'graphite', 'midnight'];

/**
 * Chat background chooser — built-in themes + the person's own photos (+ animation switch).
 * Used for BOTH levels: the account-wide default (settings page) and a single chat (details panel / settings page).
 *
 *   value        current id ('dots' … or 'img:<id>'); '' = "use the default" (per-chat only)
 *   onChange(id) pick a theme/photo
 *   onUseDefault when given, shows a "Use the default background" button (per-chat mode)
 */
export default function WallpaperPicker({
  value, onChange, customWalls = [], onAddCustomWall, onRemoveCustomWall, anim, onAnim, onUseDefault, usingDefault = false,
}) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null); // { file, src } picked photo waiting in the preview
  const [editing, setEditing] = useState(null); // { id, src } saved photo being re-adjusted

  const labels = {
    dots: t('Classic', 'كلاسيك'), aurora: t('Aurora', 'أورورا'), lagoon: t('Lagoon', 'لاجون'), forest: t('Forest', 'غابة'),
    rose: t('Rose', 'وردي'), amber: t('Amber', 'عنبري'), graphite: t('Graphite', 'جرافيت'), midnight: t('Midnight', 'منتصف الليل'),
  };

  const errorText = (err) => {
    const code = err && err.message;
    return code === 'not_image' ? t('Choose an image file.', 'اختار ملف صورة.')
      : code === 'too_big' ? t('This image is larger than 15 MB.', 'الصورة أكبر من 15 ميجا.')
        : code === 'limit' ? t('You reached the limit of 12 saved backgrounds — delete one first.', 'وصلت للحد الأقصى (12 خلفية محفوظة) — امسح واحدة الأول.')
          : t('Could not save this image.', 'مقدرتش أحفظ الصورة.');
  };

  // picking a file opens the preview first; nothing is uploaded until the person confirms
  function pickFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !onAddCustomWall) return;
    setError(null);
    if (!file.type.startsWith('image/')) { setError(t('Choose an image file.', 'اختار ملف صورة.')); return; }
    if (file.size > 15 * 1024 * 1024) { setError(t('This image is larger than 15 MB.', 'الصورة أكبر من 15 ميجا.')); return; }
    setDraft({ file, src: URL.createObjectURL(file) });
  }
  const closeDraft = () => { if (draft) URL.revokeObjectURL(draft.src); setDraft(null); };
  async function confirmDraft(style) {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await onAddCustomWall(draft.file, style);
      closeDraft();
    } catch (err) {
      closeDraft();
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  return (
    <div className="wp-picker">
      {onUseDefault && (
        <button type="button" className={`wp-default${usingDefault ? ' is-on' : ''}`} onClick={onUseDefault} aria-pressed={usingDefault}>
          <Icon name={usingDefault ? 'check-circle' : 'refresh'} size={15} />
          <span>{t('Use the default background', 'استخدم الخلفية الافتراضية')}</span>
        </button>
      )}
      <div className="msg-wall-picker" role="group" aria-label={t('Chat background', 'خلفية المحادثة')}>
        {WALLPAPERS.map((id) => (
          <button key={id} type="button" className="msg-wall-opt" aria-pressed={!usingDefault && value === id} aria-label={labels[id]} title={labels[id]} onClick={() => onChange(id)}>
            <span className={`msg-wall-swatch msg-wall-swatch--${id}`} />
            <em>{labels[id]}</em>
          </button>
        ))}
      </div>
      {onAddCustomWall && (
        <div className="msg-wall-mine">
          <div className="msg-wall-mine__title">{t('My photos', 'صوري')}</div>
          <div className="msg-wall-mine__grid">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
            <button type="button" className="msg-wall-add" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={t('Upload a photo as background', 'ارفع صورة كخلفية')} title={t('Upload a photo as background', 'ارفع صورة كخلفية')}>
              <Icon name="plus" size={18} />
            </button>
            {customWalls.map((w) => (
              <div key={w.id} className="msg-wall-mine__item">
                <button type="button" className="msg-wall-mine__pick" aria-pressed={!usingDefault && value === `img:${w.id}`} aria-label={t('Use this photo', 'استخدم الصورة دي')} onClick={() => onChange(`img:${w.id}`)} style={{ backgroundImage: `url("${w.url}")` }} />
                <button type="button" className="msg-wall-mine__edit" aria-label={t('Adjust this photo', 'اضبط الصورة دي')} title={t('Preview / adjust', 'معاينة / ضبط')} onClick={() => setEditing({ id: w.id, src: w.url })}>
                  <Icon name="edit" size={11} />
                </button>
                {onRemoveCustomWall && (
                  <button type="button" className="msg-wall-mine__del" aria-label={t('Delete this photo', 'امسح الصورة دي')} title={t('Delete this photo', 'امسح الصورة دي')} onClick={() => onRemoveCustomWall(w.id)}>
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {error && <p className="msg-wall-mine__err">{error}</p>}
        </div>
      )}
      {onAnim && (
        <div className="msg-info__toggle-row msg-wall-anim">
          <span>{t('Animated background', 'خلفية متحركة')}</span>
          <button type="button" className={`msg-switch${anim ? ' is-on' : ''}`} onClick={() => onAnim(!anim)} aria-pressed={!!anim} aria-label={t('Animated background', 'خلفية متحركة')} />
        </div>
      )}
      {draft && <WallpaperEditor src={draft.src} initial={null} busy={busy} onSave={confirmDraft} onCancel={closeDraft} />}
      {editing && (
        <WallpaperEditor src={editing.src} initial={getWallStyle(editing.id)}
          onSave={(st) => { setWallStyle(editing.id, st); setEditing(null); }} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
