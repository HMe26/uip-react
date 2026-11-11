import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  hasDeviceGallery, galleryAccess, galleryRequestAccess, galleryOpenSettings, galleryAlbums, galleryList, galleryThumb, galleryPrepare,
} from '../../lib/deviceGallery';
import '../../styles/css/attach-sheet.css';

/**
 * Phone attachment sheet (WhatsApp style). Tapping the paperclip slides this up:
 *   - a row of round actions (Document, Audio, Location, Poll, New sticker)
 *   - below it the PHONE'S GALLERY (Android app): photos + videos, newest first, album switcher, tick several, HD switch,
 *     "Next" -> the review screen (MediaReview) where each one can be edited before everything is sent together.
 *   - in a normal browser a website cannot list the visitor's photos, so the same spot offers Camera and one big
 *     "Photos & videos" tile that opens the system picker (albums + multi-select) - same review screen after it.
 */
const ico = (d, s = 22) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  camera: ico(<><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>, 26),
  media: ico(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" /></>, 26),
  caret: ico(<path d="m6 9 6 6 6-6" />, 16),
  check: ico(<path d="m5 12.5 4.5 4.5L19 7.5" />, 14),
  play: <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>,
  folder: ico(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, 20),
  arrow: ico(<path d="M5 12h14m-6-6 6 6-6 6" />, 20),
  lock: ico(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 30),
};

const fmtDur = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ one grid cell (thumbnail loads only when visible) */
function Cell({ item, n, onToggle }) {
  const ref = useRef(null);
  const [src, setSrc] = useState('');
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return undefined;
    let live = true;
    galleryThumb(item.id, item.kind, 200).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [seen, item.id, item.kind]);
  return (
    <button type="button" ref={ref} className={`ags-cell${n ? ' is-on' : ''}`} onClick={() => onToggle(item)} aria-pressed={!!n}>
      {src ? <img src={src} alt="" draggable="false" decoding="async" /> : null}
      {item.kind === 'video' && (
        <span className="ags-cell__vid">{I.play}<span>{fmtDur(item.duration)}</span></span>
      )}
      <span className="ags-cell__tick" aria-hidden="true">{n ? n : ''}</span>
    </button>
  );
}

function AlbumRow({ a, current, ar, onPick }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    galleryThumb(a.coverId, a.coverKind, 96).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [a.coverId, a.coverKind]);
  const label = a.id === 'all' ? (ar ? 'الأحدث' : 'Recents') : a.id === 'videos' ? (ar ? 'الفيديوهات' : 'Videos') : a.name;
  return (
    <button type="button" role="option" aria-selected={current} className="ags-album" onClick={() => onPick(a)}>
      <span className="ags-album__cover">{src ? <img src={src} alt="" /> : null}</span>
      <span className="ags-album__txt"><b>{label}</b><small>{a.count.toLocaleString(ar ? 'ar-EG' : 'en-US')} {ar ? 'عنصر' : 'items'}</small></span>
      {current ? <span className="ags-album__ok">{I.check}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ the gallery (Android app) */
function Gallery({ ar, max, onCamera, onSystemPicker, onFiles }) {
  const t = (en, a) => (ar ? a : en);
  const [access, setAccess] = useState('loading'); // loading | granted | limited | denied | unsupported
  const [albums, setAlbums] = useState([]);
  const [album, setAlbum] = useState({ id: 'all' });
  const [items, setItems] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState([]);           // picked items, in the order they were ticked
  const [hd, setHd] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const gen = useRef(0);
  const tail = useRef(null);

  const check = useCallback(async (ask) => {
    try {
      let s = await galleryAccess();
      if (ask && s !== 'granted') s = await galleryRequestAccess();
      setAccess(s === 'prompt' ? 'denied' : s);
    } catch { setAccess('unsupported'); }
  }, []);
  // first visit: ask straight away, like WhatsApp does
  useEffect(() => {
    if (access !== 'loading') return;
    (async () => {
      try {
        let s = await galleryAccess();
        if (s === 'prompt') s = await galleryRequestAccess();
        setAccess(s === 'prompt' ? 'denied' : s);
      } catch { setAccess('unsupported'); }
    })();
  }, [access]);

  const open = access === 'granted' || access === 'limited';
  const loadPage = useCallback(async (reset) => {
    const g = ++gen.current;
    setLoading(true);
    try {
      const r = await galleryList(album.id, reset ? 0 : items.length, 90);
      if (g !== gen.current) return;
      setItems((prev) => (reset ? r.items : [...prev, ...r.items]));
      setMore(!!r.hasMore);
    } catch { if (g === gen.current) setMore(false); } finally { if (g === gen.current) setLoading(false); }
  }, [album.id, items.length]);

  useEffect(() => { // (re)load when the album changes or access arrives
    if (!open) return;
    setItems([]); setMore(false);
    loadPage(true);
    galleryAlbums().then(setAlbums).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, album.id]);

  useEffect(() => { // endless scroll
    const el = tail.current;
    if (!el || !more || loading || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadPage(false); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loading, loadPage]);

  const toggle = (it) => {
    setNote('');
    setSel((prev) => {
      if (prev.some((p) => p.id === it.id)) return prev.filter((p) => p.id !== it.id);
      if (prev.length >= max) { setNote(t(`You can pick up to ${max} at a time`, `تقدر تختار لحد ${max} في المرة الواحدة`)); return prev; }
      return [...prev, it];
    });
  };

  const next = async () => {
    if (!sel.length || busy) return;
    setBusy(true);
    try {
      const files = await galleryPrepare(sel, { hd });
      onFiles(files, { hd });
    } catch {
      setNote(t('Could not read these files. Try again.', 'مقدرتش أقرأ الملفات دي. جرّب تاني.'));
      setBusy(false);
    }
  };

  if (access === 'loading') return <div className="ags-state"><span className="ags-spin" /></div>;
  if (access === 'denied' || access === 'unsupported') {
    return (
      <div className="ags-state">
        <span className="ags-state__ico">{I.lock}</span>
        <b>{access === 'denied' ? t('Allow access to see your photos here', 'اسمح بالوصول عشان تشوف صورك هنا') : t('Pick photos and videos from your phone', 'اختار صور وفيديوهات من موبايلك')}</b>
        <p>{access === 'denied' ? t('Then every photo and video is one tap away, with several selectable at once.', 'وبعدها كل الصور والفيديوهات تبقى قدامك، وتقدر تختار كذا واحد مع بعض.') : t('The system picker lets you select several at once.', 'المعرض بتاع النظام بيخليك تختار كذا واحد مع بعض.')}</p>
        <div className="ags-state__btns">
          {access === 'denied' && <button type="button" className="ags-btn ags-btn--main" onClick={() => check(true)}>{t('Allow access', 'السماح بالوصول')}</button>}
          {access === 'denied' && <button type="button" className="ags-btn" onClick={() => galleryOpenSettings().catch(() => {})}>{t('Open settings', 'فتح الإعدادات')}</button>}
          <button type="button" className={`ags-btn${access === 'unsupported' ? ' ags-btn--main' : ''}`} onClick={onSystemPicker}>{t('Choose from phone', 'اختيار من الموبايل')}</button>
        </div>
      </div>
    );
  }

  const label = album.id === 'all' ? t('Recents', 'الأحدث') : album.id === 'videos' ? t('Videos', 'الفيديوهات') : (album.name || '');
  const orderOf = (id) => sel.findIndex((s) => s.id === id) + 1;
  return (
    <div className="ags-gal">
      <div className="ags-gal__head">
        <button type="button" className="ags-albumbtn" aria-haspopup="listbox" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <span>{label}</span>{I.caret}
        </button>
        <span className="ags-gal__fill" />
        <button type="button" className={`ags-hd${hd ? ' is-on' : ''}`} aria-pressed={hd} onClick={() => setHd((v) => !v)} title={t('Send in higher quality', 'إرسال بجودة أعلى')}>HD</button>
        <button type="button" className="ags-iconbtn" onClick={onSystemPicker} title={t('Browse other apps and folders', 'تصفّح تطبيقات ومجلدات تانية')} aria-label={t('Browse other apps and folders', 'تصفّح تطبيقات ومجلدات تانية')}>{I.folder}</button>
        {menu && (
          <>
            <div className="ags-albums__scrim" onClick={() => setMenu(false)} aria-hidden="true" />
            <div className="ags-albums" role="listbox">
              {albums.map((a) => (
                <AlbumRow key={a.id} a={a} ar={ar} current={a.id === album.id} onPick={(x) => { setMenu(false); setAlbum(x); }} />
              ))}
            </div>
          </>
        )}
      </div>

      {access === 'limited' && (
        <div className="ags-limited">
          <span>{t('You allowed access to selected photos only.', 'انت سامح بالوصول لصور محددة بس.')}</span>
          <button type="button" onClick={() => check(true).then(() => setAlbum({ id: album.id }))}>{t('Allow more', 'السماح بالمزيد')}</button>
        </div>
      )}

      <div className="ags-grid">
        {album.id === 'all' && (
          <button type="button" className="ags-cell ags-cell--cam" onClick={onCamera}>
            {I.camera}<span>{t('Camera', 'الكاميرا')}</span>
          </button>
        )}
        {items.map((it) => <Cell key={`${it.kind}${it.id}`} item={it} n={orderOf(it.id)} onToggle={toggle} />)}
      </div>
      {!loading && items.length === 0 && <div className="ags-empty">{t('Nothing here yet.', 'مفيش حاجة هنا لسه.')}</div>}
      <div ref={tail} className="ags-tail">{loading ? <span className="ags-spin" /> : null}</div>

      {(sel.length > 0 || note) && (
        <div className="ags-bar" role="status">
          <span className="ags-bar__txt">{note || t(`${sel.length} selected`, `${sel.length} محدد`)}</span>
          {sel.length > 0 && (
            <>
              <button type="button" className="ags-bar__clear" onClick={() => { setSel([]); setNote(''); }}>{t('Clear', 'مسح')}</button>
              <button type="button" className="ags-bar__go" onClick={next} disabled={busy}>
                {busy ? <span className="ags-spin ags-spin--on" /> : <>{t('Next', 'متابعة')}{I.arrow}</>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the sheet */
export default function AttachSheet({ ar, actions, canMedia, onClose, onCamera, onSystemPicker, onGalleryFiles, max = 10 }) {
  const t = (en, a) => (ar ? a : en);
  const panel = useRef(null);
  const drag = useRef(null);
  const [dy, setDy] = useState(0);
  const native = hasDeviceGallery();

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [onClose]);

  // pull the handle down to close
  const down = (e) => { drag.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (drag.current != null) setDy(Math.max(0, e.clientY - drag.current)); };
  const up = () => { if (drag.current == null) return; const far = dy > 90; drag.current = null; setDy(0); if (far) onClose(); };

  return createPortal(
    <div className="ags-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panel}
        className={`ags${native && canMedia ? ' ags--tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('Attach', 'إرفاق')}
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
      >
        <div className="ags-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><span /></div>
        <div className="ags-scroll">
          {actions.length > 0 && (
            <div className="ags-actions">
              {actions.map((a) => (
                <button key={a.k} type="button" className="ags-act" style={{ '--c': a.color }} onClick={a.run}>
                  <span className="ags-act__ico">{a.icon}</span>
                  <span className="ags-act__lbl">{a.label}</span>
                </button>
              ))}
            </div>
          )}
          {canMedia && native && <Gallery ar={ar} max={max} onCamera={onCamera} onSystemPicker={onSystemPicker} onFiles={onGalleryFiles} />}
          {canMedia && !native && (
            <div className="ags-web">
              <button type="button" className="ags-tile ags-tile--cam" onClick={onCamera}>{I.camera}<span>{t('Camera', 'الكاميرا')}</span></button>
              <button type="button" className="ags-tile ags-tile--media" onClick={onSystemPicker}>
                {I.media}
                <span><b>{t('Photos & videos', 'صور وفيديوهات')}</b><small>{t('Select several, edit, send together', 'اختار كذا واحد، عدّل، وابعتهم مع بعض')}</small></span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
