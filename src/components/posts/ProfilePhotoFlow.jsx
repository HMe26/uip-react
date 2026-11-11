import { useEffect, useMemo, useRef, useState } from 'react';
import ImageCropModal from '../ImageCropModal';
import { api, errorMessage } from '../../api/client';
import { postsApi } from '../../api/postsApi';
import { networkApi } from '../../api/networkApi';
import { announceAvatar } from '../insight/AvatarUploader';
import { Dialog } from './Dialogs';
import { VIS, useTt } from './shared';
import { useStoryHub } from './StoryHub';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

/** After the crop: preview, optional caption and "also share as a post" ("X updated his profile picture"). */
function ShareDialog({ kind, file, onClose, onDone }) {
  const { tt } = useTt();
  const [cfg, setCfg] = useState(null);
  const [caption, setCaption] = useState('');
  const [share, setShare] = useState(true);
  const [vis, setVis] = useState('public');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    postsApi.config().then((c) => { setCfg(c); if (c?.visibilities && !c.visibilities.includes('public')) setVis(c.visibilities[0] || 'followers'); }).catch(() => setShare(false));
  }, []);
  const profile = kind === 'profile';
  const options = (cfg?.visibilities || ['public']).filter((v) => v !== 'selected' && v !== 'private');

  const save = async () => {
    setBusy(true); setErr('');
    let path = null;
    try {
      if (profile) {
        const fd = new FormData(); fd.append('avatar', file, file.name);
        const json = await api.postForm('/api/v1/messaging/me/avatar', fd);
        path = json.data?.avatar_path || null;
        announceAvatar(path);
      } else {
        path = (await networkApi.setCover(file))?.cover_path || null;
      }
    } catch (e) { setErr(errorMessage(e)); setBusy(false); return; }
    let post = null; let warn = '';
    if (share && cfg?.enabled !== false) {
      try {
        const up = await postsApi.uploadMedia(file);
        post = await postsApi.create({ body: caption.trim() || undefined, media_ids: [up.id], visibility: vis, subtype: profile ? 'profile_photo' : 'cover_photo', allow_repost: true, allow_download: true });
      } catch (e) { warn = tt('Your photo was updated, but sharing it as a post failed: ', 'تم تحديث الصورة لكن تعذّر نشرها كمنشور: ') + errorMessage(e); }
    }
    setBusy(false);
    onDone({ path, post, warn });
  };

  return (
    <Dialog title={profile ? tt('Update profile picture', 'تحديث الصورة الشخصية') : tt('Update cover photo', 'تحديث صورة الغلاف')} icon="image" busy={busy} onClose={onClose}
      footer={(
        <>
          <button type="button" className="pp-btn" disabled={busy} onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>
          <button type="button" className="pp-btn is-primary" disabled={busy} onClick={save}>{busy ? tt('Saving…', 'جارٍ الحفظ…') : tt('Save', 'حفظ')}</button>
        </>
      )}>
      <div className={`pfx-share__prev${profile ? ' is-round' : ''}`}><img src={url} alt="" /></div>
      <label className="pfx-share__check">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} disabled={busy || !cfg || cfg.enabled === false} />
        <span><strong>{tt('Share this update as a post', 'انشر هذا التغيير كمنشور')}</strong>
          <small>{tt('People can react and comment on it.', 'يقدر الناس يتفاعلوا ويعلّقوا عليه.')}</small></span>
      </label>
      {share && (
        <>
          <textarea className="pp-input" rows={2} maxLength={500} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={busy}
            placeholder={tt('Say something about it… (optional)', 'اكتب حاجة عنها… (اختياري)')} />
          <label className="pfx-share__aud">
            <span>{tt('Who can see it', 'مين يشوفها')}</span>
            {options.length > 1 ? (
              <select className="pp-input" value={vis} onChange={(e) => setVis(e.target.value)} disabled={busy}>
                {options.map((v) => <option key={v} value={v}>{tt((VIS[v] || {}).en || v, (VIS[v] || {}).ar || v)}</option>)}
              </select>
            ) : <strong className="pp-chip">{tt((VIS[options[0] || 'public'] || {}).en || 'Everyone', (VIS[options[0] || 'public'] || {}).ar || 'الجميع')}</strong>}
          </label>
        </>
      )}
      {err && <p className="pp-err" role="alert">{err}</p>}
    </Dialog>
  );
}

/**
 * Change / remove my profile photo and cover — pick → crop → (caption + share as post) → saved everywhere.
 *   const flow = usePhotoFlow({ onChanged });  flow.choose('profile' | 'cover');  flow.remove('profile' | 'cover');  render {flow.node}
 * onChanged({ kind, path, post, removed, warn }) lets the page update itself (and prepend the new post).
 */
export function usePhotoFlow({ onChanged, onError } = {}) {
  const { tt } = useTt();
  const hub = useStoryHub();
  const input = useRef(null);
  const [kind, setKind] = useState(null);     // 'profile' | 'cover'
  const [raw, setRaw] = useState(null);       // chosen File → crop
  const [cropped, setCropped] = useState(null); // cropped File → share dialog
  const kindRef = useRef(null);

  const choose = (k) => { kindRef.current = k; input.current?.click(); };
  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!ALLOWED.includes(f.type)) { onError?.(tt('Please choose a JPG, PNG or WebP image.', 'اختر صورة JPG أو PNG أو WebP.')); return; }
    if (f.size > MAX_BYTES) { onError?.(tt('That image is larger than 8 MB.', 'الصورة أكبر من 8 ميجا.')); return; }
    setKind(kindRef.current); setRaw(f);
  };
  const close = () => { setRaw(null); setCropped(null); setKind(null); };

  const remove = async (k) => {
    try {
      if (k === 'profile') { await api.del('/api/v1/messaging/me/avatar'); announceAvatar(null); } else { await networkApi.removeCover(); }
      hub?.refresh?.();
      onChanged?.({ kind: k, path: null, removed: true });
    } catch (e) { onError?.(errorMessage(e)); }
  };

  const node = (
    <>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={onPick} />
      {raw && !cropped && (
        <ImageCropModal file={raw} aspect={kind === 'profile' ? 1 : 3} outWidth={kind === 'profile' ? 800 : 1500} round={kind === 'profile'}
          title={kind === 'profile' ? tt('Crop your profile picture', 'اقتص صورتك الشخصية') : tt('Crop your cover photo', 'اقتص صورة الغلاف')}
          onCancel={close} onConfirm={(f) => setCropped(f)} />
      )}
      {cropped && (
        <ShareDialog kind={kind} file={cropped} onClose={close}
          onDone={(r) => { const k = kind; close(); hub?.refresh?.(); onChanged?.({ kind: k, ...r }); }} />
      )}
    </>
  );
  return { choose, remove, node };
}
