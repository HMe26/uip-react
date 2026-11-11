import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { api, errorMessage } from '../../api/client';
import { networkApi } from '../../api/networkApi';
import { setContentSecure } from '../../native';
import { portalPrefix } from '../../config/navConfig';
import { avatarSrc } from '../insight/AvatarUploader';
import { PAvatar, useTt } from './shared';
import { useStoryHub } from './StoryHub';
import '../../styles/css/posts-profile.css';

/** Where a person's profile page lives for the signed-in portal: /student/posts/u/12, /faculty/posts/u/12, … */
export function useProfilePath() {
  const { user } = useAuth();
  const prefix = portalPrefix(user?.role);
  return (id) => `/${prefix}/posts/u/${id}`;
}

/**
 * Full-size profile photo — protected viewer. The photo comes from the permission-checked API (never a public URL), is drawn on a
 * <canvas> (no "save image as", no drag, no image URL), carries a watermark with the viewer's id, hides itself when the tab / window
 * loses focus or a capture / print shortcut is pressed, and turns on the app's secure-screen flag in the mobile app.
 * Download is offered only when the owner allows it. NOTE: no web page can fully block a screenshot taken by the OS or another
 * device — the watermark is what makes a leak traceable.
 */
export function PhotoViewer({ user, onClose, onProfile }) {
  const { tt } = useTt();
  const { user: me } = useAuth();
  const canvas = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [hidden, setHidden] = useState(false);
  const [canDl, setCanDl] = useState(null);
  const [dlErr, setDlErr] = useState('');
  const isOwn = me?.id != null && String(me.id) === String(user?.id);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);

  // secure screen (Android: blocks screenshots / recording / recents preview)
  useEffect(() => { if (isOwn) return undefined; setContentSecure(true); return () => setContentSecure(false); }, [isOwn]);

  // hide the picture whenever something looks like a capture attempt
  useEffect(() => {
    if (isOwn) return undefined;
    const hide = () => setHidden(true);
    const show = () => { if (document.visibilityState === 'visible' && document.hasFocus()) setHidden(false); };
    const keys = (e) => {
      const k = (e.key || '').toLowerCase();
      const cap = k === 'printscreen' || k === 'snapshot' || ((e.ctrlKey || e.metaKey) && ['p', 's'].includes(k)) || (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(k)) || (e.key === 'S' && e.shiftKey && e.metaKey);
      if (cap) { e.preventDefault(); hide(); try { navigator.clipboard?.writeText(''); } catch { /* ignore */ } }
    };
    const up = (e) => { if ((e.key || '').toLowerCase() === 'printscreen') { try { navigator.clipboard?.writeText(''); } catch { /* ignore */ } } };
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? hide() : show()));
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    window.addEventListener('beforeprint', hide);
    window.addEventListener('keydown', keys, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('blur', hide); window.removeEventListener('focus', show); window.removeEventListener('beforeprint', hide);
      window.removeEventListener('keydown', keys, true); window.removeEventListener('keyup', up, true);
    };
  }, [isOwn]);

  // load + draw
  useEffect(() => {
    let dead = false;
    if (!user?.id || !user?.avatar_path) { setState('error'); return undefined; }
    (async () => {
      try {
        const res = await api.blob(`/api/v1/profile-photos/${user.id}`);
        const bmp = await createImageBitmap(await res.blob());
        if (dead || !canvas.current) return;
        const c = canvas.current;
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
        setState('ready');
      } catch { if (!dead) setState('error'); }
    })();
    return () => { dead = true; };
  }, [user?.id, user?.avatar_path]);

  // can this viewer download?
  useEffect(() => {
    if (isOwn) { setCanDl(true); return undefined; }
    let dead = false;
    networkApi.person(user.id).then((p) => { if (!dead) setCanDl(!!p.photo_can_download); }).catch(() => { if (!dead) setCanDl(false); });
    return () => { dead = true; };
  }, [user?.id, isOwn]);

  const download = async () => {
    setDlErr('');
    try {
      const res = await api.blob(`/api/v1/profile-photos/${user.id}/download`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `profile-${user.id}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setDlErr(errorMessage(e)); }
  };

  const mark = `UIPE #${me?.id ?? ''}`;
  const block = (e) => e.preventDefault();
  return createPortal(
    <div className="pfx-photo is-protected" role="dialog" aria-modal="true" aria-label={user?.full_name} onClick={onClose} onContextMenu={block} onDragStart={block}>
      <button type="button" className="pfx-photo__x" onClick={onClose} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={22} /></button>
      <figure onClick={(e) => e.stopPropagation()}>
        <div className={`pfx-photo__frame${hidden && !isOwn ? ' is-hidden' : ''}`}>
          <canvas ref={canvas} className="pfx-photo__canvas" style={{ display: state === 'ready' ? 'block' : 'none' }} />
          {state === 'loading' && <span className="pp-skel" style={{ width: 280, height: 280, borderRadius: 18 }} />}
          {state === 'error' && <span className="pfx-photo__none">{tt('No photo to show', 'لا توجد صورة لعرضها')}</span>}
          {state === 'ready' && !isOwn && <span className="pfx-photo__wm" aria-hidden="true">{Array.from({ length: 12 }).map((_, i) => <i key={i}>{mark}</i>)}</span>}
          {hidden && !isOwn && state === 'ready' && <span className="pfx-photo__shield">{tt('Hidden for protection — return to this window', 'الصورة مخفية للحماية — ارجع لهذه النافذة')}</span>}
        </div>
        <figcaption>
          <strong>{user?.full_name}</strong>
          {onProfile && <button type="button" className="pp-btn is-primary" onClick={onProfile}><Icon name="user" size={14} /> {tt('View profile', 'عرض البروفايل')}</button>}
          {canDl && state === 'ready' && <button type="button" className="pp-btn" onClick={download}><Icon name="download" size={14} /> {tt('Download', 'تنزيل')}</button>}
        </figcaption>
        {dlErr && <small className="pp-err" role="alert">{dlErr}</small>}
        {!isOwn && state === 'ready' && canDl === false && <small className="pfx-photo__note">{tt('Downloading is turned off by the owner.', 'التنزيل غير متاح من صاحب الصورة.')}</small>}
      </figure>
    </div>,
    document.body,
  );
}

/** "What do you want to open?" sheet — shown when the person has an active story. */
function ChoiceSheet({ user, group, onClose, onStory, onPhoto, onProfile, onAdd }) {
  const { tt } = useTt();
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const mine = !!group.is_mine;
  const count = group.stories?.length || 0;
  return createPortal(
    <div className="pfx-sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pfx-sheet" role="dialog" aria-modal="true" aria-label={user.full_name}>
        <header className="pfx-sheet__head">
          <span className={`pfx-av has-story ${group.has_unseen ? 'is-new' : 'is-seen'}`} style={{ width: 52, height: 52 }}><PAvatar user={user} size={46} /></span>
          <div><strong>{user.full_name}</strong><small>{tt(`${count} active ${count === 1 ? 'story' : 'stories'}`, `${count} استوري نشطة`)}</small></div>
        </header>
        <button type="button" className="pfx-sheet__row" onClick={onStory} autoFocus>
          <span className="pfx-sheet__ico is-story"><Icon name="play" size={18} /></span>
          <span><strong>{mine ? tt('View my story', 'عرض الاستوري بتاعتي') : tt('View story', 'عرض الاستوري')}</strong>
            <small>{mine ? tt('See who viewed it', 'شوف مين شافها') : group.has_unseen ? tt('New — you haven’t seen it yet', 'جديدة — لسه ما شفتهاش') : tt('You’ve already seen it', 'شفتها قبل كده')}</small></span>
          {group.has_unseen && !mine && <i className="pfx-sheet__dot" />}
        </button>
        <button type="button" className="pfx-sheet__row" onClick={onPhoto} disabled={!user.avatar_path}>
          <span className="pfx-sheet__ico"><Icon name="image" size={18} /></span>
          <span><strong>{mine ? tt('View my profile photo', 'عرض صورتي الشخصية') : tt('View profile photo', 'عرض الصورة الشخصية')}</strong>
            <small>{user.avatar_path ? tt('Open the photo full size', 'افتح الصورة بالحجم الكامل') : tt('No photo to show', 'لا توجد صورة')}</small></span>
        </button>
        <button type="button" className="pfx-sheet__row" onClick={onProfile}>
          <span className="pfx-sheet__ico"><Icon name="user" size={18} /></span>
          <span><strong>{tt('Go to profile', 'الذهاب إلى البروفايل')}</strong><small>{tt('Posts, friends and photos', 'المنشورات والأصدقاء والصور')}</small></span>
        </button>
        {mine && (
          <button type="button" className="pfx-sheet__row" onClick={onAdd}>
            <span className="pfx-sheet__ico"><Icon name="plus" size={18} /></span>
            <span><strong>{tt('Add to my story', 'إضافة استوري جديدة')}</strong></span>
          </button>
        )}
        <button type="button" className="pp-btn pfx-sheet__cancel" onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A person's round photo that behaves like Facebook / WhatsApp:
 *   • has an active story  → coloured ring; tap asks "story, photo or profile?"
 *   • no story             → tap opens the photo full size (with "View profile")
 *   • no photo             → tap goes straight to the profile
 * Works without the stories provider too (then it is just photo / profile). `user` needs { id, full_name, avatar_path }.
 */
export default function UserAvatar({ user, size = 40, className = '', title }) {
  const nav = useNavigate();
  const profilePath = useProfilePath();
  const hub = useStoryHub();
  const [sheet, setSheet] = useState(false);
  const [photo, setPhoto] = useState(false);
  const clickable = user?.id != null;
  const group = clickable && hub ? hub.groupFor(user.id) : null;
  const profile = () => { setSheet(false); setPhoto(false); nav(profilePath(user.id)); };

  if (!clickable) return <PAvatar user={user} size={size} />;

  const onClick = (e) => {
    e.stopPropagation();
    if (group) setSheet(true);
    else if (user.avatar_path) setPhoto(true);
    else profile();
  };
  const ring = group ? (group.has_unseen ? 'is-new' : 'is-seen') : '';
  return (
    <>
      <button type="button" className={`pfx-av${group ? ` has-story ${ring}` : ''} ${className}`} style={{ width: size + (group ? 8 : 0), height: size + (group ? 8 : 0) }}
        onClick={onClick} title={title || user.full_name} aria-label={user.full_name}>
        <PAvatar user={user} size={size} />
      </button>
      {sheet && group && (
        <ChoiceSheet user={user} group={group} onClose={() => setSheet(false)}
          onStory={() => { setSheet(false); hub.open(group, false); }}
          onPhoto={() => { setSheet(false); setPhoto(true); }}
          onProfile={profile}
          onAdd={() => { setSheet(false); hub.addStory(); }} />
      )}
      {photo && <PhotoViewer user={user} onClose={() => setPhoto(false)} onProfile={profile} />}
    </>
  );
}
