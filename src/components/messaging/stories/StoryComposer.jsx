import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { useLanguage } from '../../../context/LanguageContext';
import { useBackLayer } from '../../../lib/backStack';
import Face from './Face';
import { API, BACKGROUNDS, bgCss, FONTS, EXPIRY, readPref, writePref } from './storyUtils';

const AUDIENCES = [
  { key: 'contacts', icon: 'users', en: 'My contacts', ar: 'جهات اتصالي', hEn: 'Everyone you chat with', hAr: 'كل اللي بتتكلم معاهم' },
  { key: 'everyone', icon: 'globe', en: 'Everyone', ar: 'الكل', hEn: 'Anyone on the platform', hAr: 'أي حد على المنصة' },
  { key: 'selected', icon: 'user', en: 'Only share with…', ar: 'شاركها مع…', hEn: 'Pick the people', hAr: 'اختار الناس' },
  { key: 'except', icon: 'eye-off', en: 'My contacts except…', ar: 'جهات اتصالي ماعدا…', hEn: 'Hide it from some people', hAr: 'اخفيها عن ناس' },
];
const IMG_RE = /^image\//;
const VID_RE = /^video\//;

/** New story: text (colour + font) or photo/video (+ caption), who sees it, how long it lasts, replies on/off. */
export default function StoryComposer({ limits, onClose, onPosted }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, a) => (ar ? a : en);
  const maxText = limits?.max_text || 700;
  const maxCaption = limits?.max_caption || 300;
  const maxVideo = limits?.max_video_seconds || 90;

  const [mode, setMode] = useState('text');                  // text | media
  const [body, setBody] = useState('');
  const [bg, setBg] = useState(() => (readPref('bg', 'violet') in BACKGROUNDS ? readPref('bg', 'violet') : 'violet'));
  const [font, setFont] = useState(() => readPref('font', 'sans'));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);              // { url, kind }
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState(() => readPref('audience', 'contacts'));
  const [picked, setPicked] = useState([]);                  // [{id, full_name, avatar_path}]
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState('');
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [hours, setHours] = useState(() => Number(readPref('hours', '24')) || 24);
  const [replies, setReplies] = useState(() => readPref('replies', '1') !== '0');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const fileRef = useRef(null);

  useBackLayer(true, () => { if (!busy) onClose(); });
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // People picker (only for "selected" / "except"): my contacts first, search by name/email.
  const needsPeople = audience === 'selected' || audience === 'except';
  useEffect(() => {
    if (!needsPeople) return undefined;
    let dead = false;
    const id = setTimeout(async () => {
      setLoadingPeople(true);
      try {
        const res = await api.get(`${API}/contacts`, q.trim() ? { q: q.trim() } : undefined);
        if (!dead) setPeople(Array.isArray(res.data) ? res.data : []);
      } catch { if (!dead) setPeople([]); } finally { if (!dead) setLoadingPeople(false); }
    }, q ? 250 : 0);
    return () => { dead = true; clearTimeout(id); };
  }, [needsPeople, q]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const toggle = (p) => setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));

  const chooseFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const kind = IMG_RE.test(f.type) ? 'image' : VID_RE.test(f.type) ? 'video' : null;
    if (!kind) { setError(t('Choose a photo or a video.', 'اختار صورة أو فيديو.')); return; }
    setError('');
    const url = URL.createObjectURL(f);
    if (kind === 'video') {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        if (probe.duration && probe.duration > maxVideo + 0.5) {
          URL.revokeObjectURL(url);
          setError(t(`Video is too long (max ${maxVideo} seconds).`, `الفيديو طويل (الحد الأقصى ${maxVideo} ثانية).`));
          return;
        }
        setFile(f); setPreview({ url, kind });
      };
      probe.onerror = () => { setFile(f); setPreview({ url, kind }); };   // unknown codec: let the server decide
      probe.src = url;
    } else {
      setFile(f); setPreview({ url, kind });
    }
  };

  const canPost = !busy && (mode === 'text' ? body.trim().length > 0 : !!file) && (audience !== 'selected' || picked.length > 0);

  const post = async () => {
    if (!canPost) return;
    setBusy(true); setError(''); setProgress(0);
    const fd = new FormData();
    fd.append('type', mode === 'text' ? 'text' : preview?.kind || 'image');
    if (mode === 'text') { fd.append('body', body.trim()); fd.append('bg', bg); fd.append('font', font); }
    else { fd.append('media', file); if (caption.trim()) fd.append('caption', caption.trim()); }
    fd.append('audience', audience);
    if (needsPeople) picked.forEach((p) => fd.append('audience_ids[]', String(p.id)));
    fd.append('expires_hours', String(hours));
    fd.append('allow_replies', replies ? '1' : '0');
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      if (mode === 'text') await api.postForm(API, fd);
      else await api.postFormProgress(API, fd, (p) => setProgress(p), ctl.signal);
      writePref('bg', bg); writePref('font', font); writePref('audience', audience); writePref('hours', String(hours)); writePref('replies', replies ? '1' : '0');
      onPosted?.();
    } catch (err) {
      if (ctl.signal.aborted) return;
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const cancelUpload = () => { abortRef.current?.abort(); setBusy(false); setProgress(0); };

  return createPortal(
    <div className="sc" role="dialog" aria-modal="true" aria-label={t('New story', 'استوري جديدة')} dir={ar ? 'rtl' : 'ltr'}>
      <button type="button" className="sc__backdrop" aria-label={t('Close', 'إغلاق')} onClick={() => { if (!busy) onClose(); }} />
      <div className="sc__panel">
        <header className="sc__head">
          <h2>{t('New story', 'استوري جديدة')}</h2>
          <button type="button" className="sc__x" onClick={onClose} disabled={busy} aria-label={t('Close', 'إغلاق')}><Icon name="x" size={20} /></button>
        </header>

        <div className="sc__body">
          {/* ------------------------------------------------ preview */}
          <div className="sc__preview-col">
            <div className="sc__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'is-on' : ''} onClick={() => setMode('text')}>
                <Icon name="ed-type" size={16} /> {t('Text', 'نص')}
              </button>
              <button type="button" role="tab" aria-selected={mode === 'media'} className={mode === 'media' ? 'is-on' : ''} onClick={() => setMode('media')}>
                <Icon name="image" size={16} /> {t('Photo / video', 'صورة / فيديو')}
              </button>
            </div>

            <div className="sc__phone" style={mode === 'text' ? { background: bgCss(bg) } : undefined}>
              {mode === 'text' ? (
                <textarea
                  className={`sc__textarea sv-font-${font}`}
                  value={body} maxLength={maxText} autoFocus
                  placeholder={t('Type a status', 'اكتب استوري')}
                  onChange={(e) => setBody(e.target.value)}
                  aria-label={t('Story text', 'نص الاستوري')}
                />
              ) : preview ? (
                <>
                  {preview.kind === 'video'
                    ? <video className="sc__media" src={preview.url} controls playsInline muted />
                    : <img className="sc__media" src={preview.url} alt="" />}
                  <button type="button" className="sc__change" onClick={() => fileRef.current?.click()}>{t('Change', 'تغيير')}</button>
                </>
              ) : (
                <button type="button" className="sc__pick" onClick={() => fileRef.current?.click()}>
                  <Icon name="image" size={34} />
                  <strong>{t('Choose a photo or video', 'اختار صورة أو فيديو')}</strong>
                  <small>{t(`Video up to ${maxVideo} seconds`, `الفيديو لحد ${maxVideo} ثانية`)}</small>
                </button>
              )}
              <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={chooseFile} />
              {mode === 'text' && <span className="sc__count">{body.length}/{maxText}</span>}
            </div>

            {mode === 'text' ? (
              <div className="sc__styles">
                <div className="sc__swatches" role="radiogroup" aria-label={t('Background', 'الخلفية')}>
                  {Object.keys(BACKGROUNDS).map((k) => (
                    <button type="button" key={k} role="radio" aria-checked={bg === k} aria-label={k}
                      className={bg === k ? 'is-on' : ''} style={{ background: bgCss(k) }} onClick={() => setBg(k)} />
                  ))}
                </div>
                <div className="sc__fonts" role="radiogroup" aria-label={t('Font', 'الخط')}>
                  {FONTS.map((f) => (
                    <button type="button" key={f.key} role="radio" aria-checked={font === f.key}
                      className={`sv-font-${f.key}${font === f.key ? ' is-on' : ''}`} title={t(f.title[0], f.title[1])} onClick={() => setFont(f.key)}>Aa</button>
                  ))}
                </div>
              </div>
            ) : (
              <input className="sc__caption" type="text" value={caption} maxLength={maxCaption} placeholder={t('Add a caption…', 'أضف تعليق…')} onChange={(e) => setCaption(e.target.value)} />
            )}
          </div>

          {/* ------------------------------------------------ options */}
          <div className="sc__opts">
            <section>
              <h3>{t('Who can see it', 'مين يشوفها')}</h3>
              <div className="sc__radios" role="radiogroup">
                {AUDIENCES.map((a) => (
                  <button type="button" key={a.key} role="radio" aria-checked={audience === a.key} className={`sc__radio${audience === a.key ? ' is-on' : ''}`} onClick={() => setAudience(a.key)}>
                    <span className="sc__radio-ic"><Icon name={a.icon} size={18} /></span>
                    <span className="sc__radio-tx"><strong>{ar ? a.ar : a.en}</strong><small>{ar ? a.hAr : a.hEn}</small></span>
                    <span className="sc__dot" aria-hidden="true" />
                  </button>
                ))}
              </div>

              {needsPeople && (
                <div className="sc__people">
                  {picked.length > 0 && (
                    <div className="sc__chips">
                      {picked.map((p) => (
                        <button type="button" key={p.id} className="sc__chip" onClick={() => toggle(p)} title={t('Remove', 'إزالة')}>
                          <Face name={p.full_name} src={p.avatar_path} /> <span>{p.full_name}</span> <Icon name="x" size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="sc__search">
                    <Icon name="search" size={15} />
                    <input type="search" value={q} placeholder={t('Search by name or email', 'ابحث بالاسم أو الإيميل')} onChange={(e) => setQ(e.target.value)} />
                  </label>
                  <ul className="sc__list">
                    {loadingPeople && <li className="sc__empty">{t('Loading…', 'جاري التحميل…')}</li>}
                    {!loadingPeople && people.length === 0 && <li className="sc__empty">{q ? t('No one found', 'مفيش نتايج') : t('Chat with someone first, or search above.', 'ابدأ محادثة مع حد الأول، أو ابحث فوق.')}</li>}
                    {people.map((p) => (
                      <li key={p.id}>
                        <button type="button" className={pickedIds.has(p.id) ? 'is-on' : ''} onClick={() => toggle(p)} aria-pressed={pickedIds.has(p.id)}>
                          <Face name={p.full_name} src={p.avatar_path} />
                          <span>{p.full_name}</span>
                          <i className="sc__check">{pickedIds.has(p.id) && <Icon name="check" size={14} />}</i>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {audience === 'selected' && picked.length === 0 && <p className="sc__note">{t('Pick at least one person.', 'اختار شخص واحد على الأقل.')}</p>}
                </div>
              )}
            </section>

            <section>
              <h3>{t('Disappears after', 'تختفي بعد')}</h3>
              <div className="sc__seg" role="radiogroup">
                {EXPIRY.map((h) => (
                  <button type="button" key={h} role="radio" aria-checked={hours === h} className={hours === h ? 'is-on' : ''} onClick={() => setHours(h)}>
                    {ar ? `${h} ساعة` : `${h}h`}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <button type="button" className="sc__switch" role="switch" aria-checked={replies} onClick={() => setReplies((r) => !r)}>
                <span className="sc__switch-tx"><strong>{t('Allow replies', 'السماح بالرد')}</strong><small>{t('Replies arrive in your chat with them', 'الردود بتوصل في المحادثة بينك وبينهم')}</small></span>
                <span className={`sc__toggle${replies ? ' is-on' : ''}`} aria-hidden="true"><i /></span>
              </button>
            </section>
          </div>
        </div>

        <footer className="sc__foot">
          {error && <p className="sc__error" role="alert"><Icon name="alert-triangle" size={14} /> {error}</p>}
          {busy && mode === 'media' && (
            <div className="sc__progress" aria-label={t('Uploading', 'جاري الرفع')}><i style={{ width: `${progress}%` }} /></div>
          )}
          <div className="sc__actions">
            {busy && mode === 'media'
              ? <button type="button" className="sc__ghost" onClick={cancelUpload}>{t('Cancel upload', 'إلغاء الرفع')}</button>
              : <button type="button" className="sc__ghost" onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</button>}
            <button type="button" className="sc__post" disabled={!canPost} onClick={post}>
              <Icon name="send" size={16} /> {busy ? (mode === 'media' && progress ? `${progress}%` : t('Posting…', 'جاري النشر…')) : t('Post story', 'نشر الاستوري')}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
