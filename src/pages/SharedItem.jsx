import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { errorMessage } from '../api/client';
import { sharedApi, shareSession, shareVisitor } from '../lib/driveApi';
import { saveBlob } from '../lib/exporter';
import { startSharedGuard } from '../lib/sharedGuard';
import { avatarSrc } from '../components/insight/AvatarUploader';
import Icon from '../components/Icon';
import { FileGlyph, FolderGlyph } from '../desktop/OsIcons';
import ProtectedFile, { kindOfName } from '../components/shared/ProtectedFile';
import '../styles/css/drive-share.css';
import '../styles/css/drive-share-responsive.css';
import '../styles/css/drive-share-pro.css'; // professional visual layer
import '../styles/css/share-access.css';
import '../styles/css/drive-share-fix.css'; // header stacking + file viewer (code LTR, phone master/detail) — must stay last
import '../styles/css/shared-page-life.css'; // light floating bubbles + soft animations
import '../styles/css/shared-page-v2.css'; // copy / search buttons + phone & tablet polish — must stay last
import '../styles/css/shared-viewer-polish.css'; // viewer card padding / header / buttons — must stay last

// floating bubbles: position (%), size, hue, speed, start offset, sway
const BUBBLES = [
  [6, 44, 235, 26, 0, 24], [16, 22, 190, 19, -6, 18], [27, 64, 290, 32, -12, 30], [38, 28, 330, 21, -3, 22],
  [49, 52, 210, 29, -15, 26], [58, 20, 160, 18, -9, 16], [68, 70, 260, 34, -20, 34], [78, 30, 20, 22, -5, 20],
  [86, 46, 320, 27, -11, 28], [93, 24, 200, 20, -17, 18], [11, 36, 45, 25, -22, 22], [73, 18, 175, 17, -8, 14],
].map(([x, s, h, d, dl, sw], i) => ({ '--x': `${x}%`, '--s': `${s}px`, '--h': h, '--d': `${d}s`, '--dl': `${dl}s`, '--sw': `${sw}px`, '--y': `${20 + ((i * 17) % 60)}%` }));

const BIG_PREVIEW_BYTES = 80 * 1024 * 1024; // non-media files above this are not previewed in the browser

/** Sender's avatar: photo when allowed and loadable, otherwise the first letter of the name on a colour taken from the name. */
function SenderAvatar({ name, src }) {
  const [bad, setBad] = useState(false);
  const letter = (String(name || '').trim().match(/\p{L}|\p{N}/u) || [''])[0].toUpperCase();
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  if (src && !bad) return <img className="shp__avatar" src={src} alt="" draggable={false} onError={() => setBad(true)} />;
  return (
    <span className="shp__avatar shp__avatar--letter" style={{ background: `linear-gradient(135deg, hsl(${h} 62% 52%), hsl(${(h + 40) % 360} 62% 42%))` }} aria-hidden="true">
      {letter || <Icon name="user" size={18} />}
    </span>
  );
}

/** Full-page screen for a link that cannot be opened right now: paused (temporary) / expired / turned off / item gone / not found. */
function LinkUnavailable({ err, t, onRetry, checking }) {
  const kind = err.code === 'share_paused' ? 'paused'
    : err.code === 'share_expired' ? 'expired'
      : err.code === 'share_revoked' ? 'off'
        : err.code === 'share_gone' ? 'gone'
          : err.code === 'share_consumed' ? 'used'
            : err.code === 'share_claimed' ? 'claimed'
          : err.status === 404 ? 'missing' : 'other';
  const V = {
    paused: { icon: 'pause', tone: 'warn', badge: t('Temporarily paused', 'موقوف مؤقتًا'),
      title: t('This link is paused for now', 'الرابط ده موقوف مؤقتًا'),
      text: t('The owner has paused sharing. Nothing was deleted — the link will work again as soon as they resume it.', 'صاحب الملف أوقف المشاركة مؤقتًا. مفيش حاجة اتحذفت — الرابط هيشتغل تاني أول ما يستأنفه.'),
      tips: [[ 'clock', t('Try again a bit later', 'جرّب تاني بعد شوية')], ['link', t('Keep this same link — it won’t change', 'احتفظ بنفس الرابط — مش هيتغيّر')], ['user', t('Need it now? Ask the person who sent it', 'محتاجه دلوقتي؟ كلّم اللي بعتهولك')]] },
    expired: { icon: 'clock', tone: 'muted', badge: t('Expired', 'منتهي'),
      title: t('This link has expired', 'الرابط ده انتهت صلاحيته'),
      text: t('Its validity period is over. Ask the owner to send you a new link.', 'مدة صلاحيته خلصت. اطلب من صاحب الملف يبعتلك رابط جديد.'), tips: [] },
    off: { icon: 'lock', tone: 'danger', badge: t('Turned off', 'متوقف'),
      title: t('This link was turned off', 'الرابط ده اتقفل'),
      text: t('The owner stopped sharing this item permanently. Ask them to send you a new link if you still need it.', 'صاحب الملف وقّف مشاركته نهائيًا. اطلب منه رابط جديد لو لسه محتاجه.'), tips: [] },
    used: { icon: 'clock', tone: 'muted', badge: t('Already used', 'اتستخدم'),
      title: t('This one-time link has been used', 'الرابط ده كان لمرة واحدة وخلص'),
      text: t('It opens only once, and its time is over. Ask the owner to send you a new link if you still need it.', 'الرابط ده بيتفتح مرة واحدة بس، ومدته خلصت. اطلب من صاحب الملف رابط جديد لو لسه محتاجه.'), tips: [] },
    claimed: { icon: 'lock', tone: 'danger', badge: t('Opened by someone else', 'اتفتح عند حد تاني'),
      title: t('This link is already taken', 'الرابط ده اتفتح عند شخص تاني'),
      text: t('The owner made this link for one person only, and it was already opened on another device or browser, so it will not open here. Ask the owner for your own link.', 'صاحب الملف عمل الرابط ده لشخص واحد بس، واتفتح فعلًا على جهاز أو متصفح تاني، فمش هيفتح هنا. اطلب منه رابط خاص بيك.'), tips: [] },
    gone: { icon: 'file', tone: 'muted', badge: t('Not available', 'مش متاح'),
      title: t('This item is no longer available', 'العنصر ده مبقاش متاح'),
      text: t('The file or folder was moved or deleted by its owner.', 'الملف أو المجلد اتنقل أو اتحذف من صاحبه.'), tips: [] },
    missing: { icon: 'search', tone: 'muted', badge: t('Not found', 'مش موجود'),
      title: t('Link not found', 'الرابط مش موجود'),
      text: t('Check that the address is complete and copied correctly.', 'اتأكد إن العنوان كامل ومنسوخ صح.'), tips: [] },
    other: { icon: 'alert', tone: 'danger', badge: t('Error', 'خطأ'),
      title: t('Something went wrong', 'حصل خطأ'), text: err.message || '', tips: [] },
  }[kind];
  return (
    <section className={`shp__gone shp__gone--${V.tone}`} role="alert" aria-labelledby="shp-gone-h">
      <div className="shp__gone-art" aria-hidden="true">
        <i /><i /><i />
        <span><Icon name={V.icon} size={34} /></span>
      </div>
      <span className="shp__gone-badge">{V.badge}</span>
      <h1 id="shp-gone-h">{V.title}</h1>
      <p>{V.text}</p>
      {err.owner && kind !== 'missing' && <div className="shp__gone-owner"><Icon name="user" size={14} /><span>{t('Shared by', 'صاحب الرابط')}: <b>{err.owner}</b></span></div>}
      {V.tips.length > 0 && (
        <ul className="shp__gone-tips">
          {V.tips.map(([ic, tx]) => <li key={tx}><Icon name={ic} size={15} /><span>{tx}</span></li>)}
        </ul>
      )}
      <div className="shp__gone-acts">
        {(kind === 'paused' || kind === 'other') && (
          <button type="button" className="btn btn-primary" onClick={onRetry} disabled={checking}>
            <Icon name="refresh" size={15} /><span>{checking ? t('Checking…', 'جارِ التحقق…') : t('Check again', 'جرّب تاني')}</span>
          </button>
        )}
      </div>
    </section>
  );
}

/** Plain-words warning for a link meant for one person / one time (shown BEFORE it can be opened). */
function ClaimNotice({ info, t }) {
  if (!info || (!info.one_time && !info.single_person)) return null;
  const mins = Number(info.access_minutes) || 0;
  const span = mins >= 1440 && mins % 1440 === 0 ? t(`${mins / 1440} day(s)`, `${mins / 1440} يوم`) : mins >= 60 && mins % 60 === 0 ? t(`${mins / 60} hour(s)`, `${mins / 60} ساعة`) : t(`${mins} minute(s)`, `${mins} دقيقة`);
  return (
    <div className="shp__claim" role="note">
      <Icon name={info.one_time ? 'clock' : 'user'} size={18} />
      <div>
        <b>{info.one_time ? t('This link opens only once', 'الرابط ده بيتفتح مرة واحدة بس') : t('This link is for one person only', 'الرابط ده لشخص واحد بس')}</b>
        <span>
          {info.one_time
            ? t(`Once you open it, it stays available on this device for ${span}, then it closes for good. It will not open again, and it will not open for anyone else.`, `أول ما تفتحه هيفضل متاح على الجهاز ده لمدة ${span}، وبعدها بيتقفل نهائيًا. مش هيتفتح تاني ولا عند أي حد غيرك.`)
            : t('It binds to the first device and browser that opens it. If you send it to someone else, it will not open for them.', 'بيتربط بأول جهاز ومتصفح يفتحه. لو بعتّه لحد تاني مش هيفتح عنده.')}
        </span>
      </div>
    </div>
  );
}

/** Shown after the gate (or when there is none) and before the first open of a one-person / one-time link. */
function ConfirmOpen({ info, t, busy, error, onOpen }) {
  return (
    <section className="shp__card shp__gate" aria-labelledby="shp-confirm-h">
      <span className="shp__state-ico shp__state-ico--gate" style={{ alignSelf: 'center' }}><Icon name={info.one_time ? 'clock' : 'user'} size={30} /></span>
      <h1 id="shp-confirm-h">{info.one_time ? t('Open this one-time link?', 'تفتح الرابط ده (مرة واحدة)؟') : t('Open this private link?', 'تفتح الرابط الخاص ده؟')}</h1>
      <p>{info.owner_name ? t(`${info.owner_name} shared something with you. `, `${info.owner_name} شارك معاك ملف. `) : ''}{t('Read this first:', 'اقرا ده الأول:')}</p>
      <ClaimNotice info={info} t={t} />
      {error && <div className="mp-share__err" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onOpen}>{busy ? t('Opening…', 'جارِ الفتح…') : t('Open it now', 'افتحه دلوقتي')}</button>
    </section>
  );
}

/** Gate shown before the content when the owner asked for the visitor's details and/or a password. */
function GateForm({ gate, token, t, ar, onDone }) {
  const [f, setF] = useState(() => ({ name: '', email: '', phone: '', password: '', ...(shareVisitor.get() || {}) })); // this device remembers who you are
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({});
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => { setF((v) => ({ ...v, [k]: e.target.value })); setFields((x) => ({ ...x, [k]: undefined })); };

  const check = () => {
    const bad = {};
    if (gate.needs_info) {
      if (f.name.trim().length < 2) bad.name = t('Enter your full name.', 'اكتب اسمك بالكامل.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) bad.email = t('Enter a valid email address.', 'اكتب إيميل صحيح.');
      const digits = f.phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) bad.phone = t('Enter a valid mobile number.', 'اكتب رقم موبايل صحيح.');
    }
    if (gate.needs_password && !f.password) bad.password = t('Enter the password.', 'اكتب الباسورد.');
    return bad;
  };

  const submit = async (e) => {
    e.preventDefault();
    const bad = check();
    setFields(bad);
    setMsg('');
    if (Object.keys(bad).length) return;
    setBusy(true);
    try {
      const res = await sharedApi.enter(token, {
        ...(gate.needs_info ? { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() } : {}),
        ...(gate.needs_password ? { password: f.password } : {}),
      });
      if (res?.session) shareSession.set(token, res.session);
      if (gate.needs_info) shareVisitor.set({ name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() });
      onDone();
    } catch (er) {
      const errs = er?.payload?.errors;
      if (errs?.fields) setFields(errs.fields);
      setMsg(errs?.fields ? '' : errorMessage(er));
      if (errs?.code === 'bad_password') setF((v) => ({ ...v, password: '' }));
    } finally { setBusy(false); }
  };

  return (
    <section className="shp__card shp__gate" aria-labelledby="shp-gate-h">
      <span className="shp__state-ico shp__state-ico--gate" style={{ alignSelf: 'center' }}><Icon name={gate.needs_password ? 'lock' : 'user'} size={30} /></span>
      <h1 id="shp-gate-h">{gate.needs_password ? t('This link is protected', 'الرابط ده محمي') : t('Before you open it', 'قبل ما تفتح الرابط')}</h1>
      <p>
        {gate.owner_name ? t(`${gate.owner_name} shared something with you. `, `${gate.owner_name} شارك معاك ملف. `) : ''}
        {gate.needs_info && gate.needs_password ? t('Enter your details and the password to continue.', 'اكتب بياناتك والباسورد عشان تكمّل.')
          : gate.needs_info ? t('Enter your details to continue.', 'اكتب بياناتك عشان تكمّل.')
            : t('Enter the password to continue.', 'اكتب الباسورد عشان تكمّل.')}
      </p>
      <ClaimNotice info={gate} t={t} />
      <form onSubmit={submit} noValidate>
        {gate.needs_info && (
          <>
            <label className="shp__field"><span>{t('Full name', 'الاسم بالكامل')}</span>
              <input type="text" autoComplete="name" value={f.name} onChange={set('name')} maxLength={80} aria-invalid={!!fields.name} disabled={busy} />
              {fields.name && <small role="alert">{fields.name}</small>}
            </label>
            <label className="shp__field"><span>{t('Email', 'الإيميل')}</span>
              <input type="email" dir="ltr" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={190} aria-invalid={!!fields.email} disabled={busy} />
              {fields.email && <small role="alert">{fields.email}</small>}
            </label>
            <label className="shp__field"><span>{t('Mobile number', 'رقم الموبايل')}</span>
              <input type="tel" dir="ltr" autoComplete="tel" inputMode="tel" placeholder="+20 100 000 0000" value={f.phone} onChange={set('phone')} maxLength={24} aria-invalid={!!fields.phone} disabled={busy} />
              {fields.phone && <small role="alert">{fields.phone}</small>}
            </label>
          </>
        )}
        {gate.needs_password && (
          <label className="shp__field"><span>{t('Password', 'الباسورد')}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <input style={{ flex: 1, minWidth: 0 }} type={show ? 'text' : 'password'} dir="ltr" autoComplete="off" value={f.password} onChange={set('password')} maxLength={64} aria-invalid={!!fields.password} disabled={busy} />
              <button type="button" className="shp__tool shp__tool--icon" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide password', 'إخفاء الباسورد') : t('Show password', 'إظهار الباسورد')}><Icon name={show ? 'eye-off' : 'eye'} size={16} /></button>
            </span>
            {fields.password && <small role="alert">{fields.password}</small>}
          </label>
        )}
        {msg && <div className="mp-share__err" role="alert">{msg}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('Checking…', 'جارِ التحقق…') : t('Continue', 'متابعة')}</button>
      </form>
      {gate.needs_info && <p className="shp__gate-note">{t('Your details are shared with the owner of this link only.', 'بياناتك بتتبعت لصاحب الرابط ده بس.')}</p>}
    </section>
  );
}

/**
 * Public page for a My PC share link (/s/:token) — no sign-in, protected: no context menu / selection / copy / print /
 * view-source / devtools shortcuts, devtools detection that wipes the content, images and PDFs drawn to canvas with a
 * burned-in watermark. A shared folder can be browsed; downloads only exist when the owner allowed them.
 */
export default function SharedItem() {
  const { token } = useParams();
  const { locale, toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const ar = locale === 'ar';
  const t = useCallback((en, a) => (ar ? a : en), [ar]);

  const [nodeId, setNodeId] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewOpen, setViewOpen] = useState(true);   // the file viewer can be folded away so the page stays short
  const [listOpen, setListOpen] = useState(true);   // ... and so can the list of items
  const [viewMode, setViewMode] = useState('list'); // list | grid
  const [q, setQ] = useState('');                   // filter box (shown once there are many items)
  const [preview, setPreview] = useState(null); // { id, name, kind, blob?, url?, text?, loading?, failed? }
  const [locked, setLocked] = useState(false);
  const [gate, setGate] = useState(null); // { needs_password, needs_info, owner_name } while the owner's gate is not passed
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState(null); // { owner_name, one_time, single_person, access_minutes } until the visitor presses "Open"
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState('');
  const [away, setAway] = useState(() => typeof document !== 'undefined' && !document.hasFocus());
  const [shot, setShot] = useState(false);
  const shotT = useRef(0);
  const viewId = useMemo(() => Math.random().toString(36).slice(2, 8).toUpperCase(), []);
  const stamp = useMemo(() => new Date().toLocaleString(ar ? 'ar-EG' : undefined, { dateStyle: 'medium', timeStyle: 'short' }), [ar]);
  const who = [data?.share?.visitor_name, data?.share?.visitor_email].filter(Boolean).join(' · ');
  const mark = `${who ? `${who} · ` : ''}${t('Protected', 'محتوى محمي')} · ${stamp} · #${viewId}`;

  const clearPreview = useCallback(() => {
    setPreview(null);
  }, []);

  // protection: shortcuts / menus / devtools. Once devtools are seen, every file is dropped and the page stays locked.
  useEffect(() => {
    const stopGuard = startSharedGuard({
      onLock: (on) => { if (on) { setLocked(true); setData(null); clearPreview(); } },
      // a screenshot shortcut hides the content for a few seconds (view-only links)
      onCapture: () => { setShot(true); clearTimeout(shotT.current); shotT.current = setTimeout(() => setShot(false), 3500); },
    });
    const onVis = () => setAway(document.hidden || !document.hasFocus());
    document.addEventListener('visibilitychange', onVis);
    const onBlur = () => setAway(true);
    const onFocus = () => setAway(false);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.documentElement.classList.add('shp-lock');
    return () => {
      stopGuard();
      clearTimeout(shotT.current);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.documentElement.classList.remove('shp-lock');
    };
  }, [clearPreview]);

  useEffect(() => {
    if (locked) return undefined;
    let live = true;
    setLoading(true);
    sharedApi.view(token, nodeId).then((d) => { if (live) { setData(d); setErr(null); setGate(null); setConfirm(null); } })
      .catch((e) => {
        if (!live) return;
        const g = e?.status === 423 && e?.payload?.errors?.code === 'share_gate' ? e.payload.errors : null;
        if (g) { shareSession.clear(token); setData(null); setErr(null); setConfirm(null); setGate(g); return; }
        if (e?.status === 423 && e?.payload?.errors?.code === 'share_confirm') { setData(null); setErr(null); setGate(null); setConfirm(e.payload.errors); return; }
        setErr({ status: e?.status || 0, message: errorMessage(e), code: e?.payload?.errors?.code || '', owner: e?.payload?.errors?.owner_name || '' });
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, nodeId, locked, reload]);

  // the owner changed the password / settings while the page was open -> the next call answers 423: show the gate again
  const regate = useCallback((e) => {
    if (e?.status === 423 && e?.payload?.errors?.code === 'share_gate') {
      shareSession.clear(token); setData(null); clearPreview(); setGate(e.payload.errors); return true;
    }
    return false;
  }, [token, clearPreview]);

  const node = data?.node;
  const share = data?.share;
  const canDl = !!share?.can_download;
  const isFolder = node?.type === 'folder';
  const items = data?.items || [];
  const shown = q.trim() ? items.filter((it) => it.name.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const nFolders = items.filter((it) => it.type === 'folder').length;
  const nFiles = items.length - nFolders;

  const openPreview = useCallback(async (file) => {
    clearPreview();
    setViewOpen(true);
    const kind = kindOfName(file.name);
    const media = kind === 'video' || kind === 'audio';
    if (kind === 'none') { setPreview({ id: file.id, name: file.name, none: true }); return; }
    if (!media && Number(file.size_bytes) > BIG_PREVIEW_BYTES) { setPreview({ id: file.id, name: file.name, big: true }); return; }
    setPreview({ id: file.id, name: file.name, loading: true });
    try {
      const blob = await sharedApi.file(token, file.id === share?.root?.id ? null : file.id);
      setPreview({ id: file.id, name: file.name, blob });
    } catch (e) { if (!regate(e)) setPreview({ id: file.id, name: file.name, failed: true }); }
  }, [token, share, clearPreview, regate]);

  useEffect(() => {
    if (node && node.type === 'file' && nodeId === null) openPreview(node);
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id) => { clearPreview(); setQ(''); setNodeId(id && id !== share?.root?.id ? id : null); };

  const download = async (file) => {
    setBusy(true);
    try {
      const blob = await sharedApi.file(token, file.id === share?.root?.id ? null : file.id, { download: true });
      saveBlob(blob, file.name);
    } catch (e) { if (!regate(e)) setErr({ status: e?.status || 0, message: errorMessage(e), soft: true }); } finally { setBusy(false); }
  };
  const downloadZip = async () => {
    setBusy(true);
    try {
      const blob = await sharedApi.zip(token, node.id === share?.root?.id ? null : node.id);
      saveBlob(blob, `${node.name}.zip`);
    } catch (e) { if (!regate(e)) setErr({ status: e?.status || 0, message: errorMessage(e), soft: true }); } finally { setBusy(false); }
  };

  const dead = err && !err.soft && !data;
  // the visitor read the warning and pressed "Open it now": this is the request that binds the link to this browser
  const openNow = async () => {
    setCBusy(true); setCErr('');
    try { const d = await sharedApi.view(token, null, { confirm: true }); setConfirm(null); setData(d); setErr(null); }
    catch (e) {
      const c = e?.payload?.errors?.code;
      if (c === 'share_claimed' || c === 'share_consumed' || c === 'share_revoked' || c === 'share_expired' || c === 'share_paused') { setConfirm(null); setErr({ status: e?.status || 0, message: errorMessage(e), code: c, owner: e?.payload?.errors?.owner_name || '' }); }
      else setCErr(errorMessage(e));
    } finally { setCBusy(false); }
  };
  const fmtDate = (v) => { const d = new Date(String(v).replace(' ', 'T')); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(ar ? 'ar-EG' : undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  const owner = share?.owner_name || '';
  const wmStyle = { '--shp-mark': `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><text x='180' y='100' transform='rotate(-22 180 100)' text-anchor='middle' font-family='sans-serif' font-size='14' font-weight='600' fill='#6b7280' fill-opacity='.16'>${mark.replace(/[<>&'"]/g, '')}</text></svg>`)}")` };

  if (locked) {
    return (
      <div className="shp shp--center" dir={ar ? 'rtl' : 'ltr'}>
        <div className="shp__state" role="alert">
          <span className="shp__state-ico"><Icon name="shield" size={30} /></span>
          <h1>{t('This page is protected', 'الصفحة دي محمية')}</h1>
          <p>{t('Developer tools were detected, so the content was removed. Close them and reload to continue.', 'اتكشفت أدوات المطوّر فاتشال المحتوى. اقفلها وأعد تحميل الصفحة عشان تكمّل.')}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>{t('Reload', 'إعادة التحميل')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`shp${(away || shot) && !canDl ? ' is-away' : ''}`} dir={ar ? 'rtl' : 'ltr'} onContextMenu={(e) => e.preventDefault()}>
      <div className="shp__bubbles" aria-hidden="true">{BUBBLES.map((b, i) => <i key={i} style={b} />)}</div>
      <header className="shp__top">
        <div className="shp__who">
          {data && <SenderAvatar name={owner} src={avatarSrc(share.owner_avatar)} />}
          {data && owner && (
            <span className="shp__who-txt">
              <span className="shp__who-lbl">{t('Shared with you by', 'تمت المشاركة معك بواسطة')}</span>
              <span className="shp__who-name">{owner}</span>
            </span>
          )}
        </div>
        <div className="shp__tools">
          <span className="shp__secure" title={t('Protected link', 'رابط محمي')}><Icon name="shield" size={14} /><span>{t('Secure link', 'رابط آمن')}</span></span>
          <button type="button" className="shp__tool shp__tool--icon" onClick={toggleLocale} title={ar ? 'English' : 'العربية'} aria-label={ar ? 'Switch to English' : 'التبديل للعربية'}>
            <Icon name="globe" size={16} />
          </button>
          <button type="button" className="shp__tool shp__tool--icon" onClick={toggleTheme} title={theme === 'dark' ? t('Light mode', 'الوضع الفاتح') : t('Dark mode', 'الوضع الداكن')} aria-label={t('Toggle theme', 'تبديل الثيم')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
        </div>
      </header>

      <main className="shp__main">
        {confirm && !data && !gate && <ConfirmOpen info={confirm} t={t} busy={cBusy} error={cErr} onOpen={openNow} />}

        {gate && !data && <GateForm gate={gate} token={token} t={t} ar={ar} onDone={() => { setGate(null); setLoading(true); setReload((n) => n + 1); }} />}

        {loading && !data && !gate && !confirm && <div className="shp__state"><span className="lp2-spinner" aria-hidden="true" /><p>{t('Loading…', 'جارِ التحميل…')}</p></div>}

        {dead && <LinkUnavailable err={err} t={t} checking={loading} onRetry={() => { setLoading(true); setReload((n) => n + 1); }} />}

        {data && (
          <>
            <section className="shp__card shp__hero">
              <span className="shp__hero-ico">{isFolder ? <FolderGlyph size={44} /> : <FileGlyph size={44} label={node.extension} />}</span>
              <div className="shp__hero-txt">
                <h1 className="shp__title">{share.root.name}</h1>
                <div className="shp__chips">
                  {!isFolder && node.size_human && <span className="shp__chip">{node.size_human}</span>}
                  {share.expires_at && <span className="shp__chip"><Icon name="clock" size={12} />{t('Available until ', 'متاح لحد ')}{fmtDate(share.expires_at)}</span>}
                  {isFolder && <span className="shp__chip">{items.length} {t('items', 'عنصر')}{nFolders > 0 && nFiles > 0 ? ` · ${nFolders} ${t('folders', 'مجلد')} · ${nFiles} ${t('files', 'ملف')}` : ''}</span>}
                  {canDl
                    ? <span className="shp__chip shp__chip--ok"><Icon name="download" size={12} />{t('Download allowed', 'التنزيل متاح')}</span>
                    : <span className="shp__chip shp__chip--lock"><Icon name="eye" size={12} />{t('View only', 'عرض فقط')}</span>}
                </div>
              </div>
              {canDl && (
                <div className="shp__actions">
                  {isFolder
                    ? <button type="button" className="btn btn-primary" disabled={busy} onClick={downloadZip}><Icon name="download" size={15} /><span>{t('Download as ZIP', 'تنزيل كـ ZIP')}</span></button>
                    : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => download(node)}><Icon name="download" size={15} /><span>{t('Download', 'تنزيل')}</span></button>}
                </div>
              )}
              {err?.soft && <div className="mp-share__err shp__hero-err" role="alert">{err.message}</div>}
            </section>

            {isFolder && (
              <section className="shp__card shp__browser">
                <div className="shp__bar">
                  <nav className="shp__crumbs" aria-label={t('Path', 'المسار')}>
                    {data.breadcrumb.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && <span aria-hidden="true"> / </span>}
                        <button type="button" disabled={i === data.breadcrumb.length - 1} onClick={() => go(c.id)}>{c.name}</button>
                      </span>
                    ))}
                  </nav>
                  <div className="shp__bar-tools">
                    {listOpen && items.length > 1 && (
                      <label className="shp__find">
                        <Icon name="search" size={14} />
                        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter…', 'بحث في العناصر…')} aria-label={t('Filter items', 'بحث في العناصر')} />
                      </label>
                    )}
                    {listOpen && items.length > 0 && (
                      <div className="shp__seg" role="group" aria-label={t('View', 'طريقة العرض')}>
                        <button type="button" className={viewMode === 'list' ? 'is-on' : ''} aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} title={t('List', 'قائمة')}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                        </button>
                        <button type="button" className={viewMode === 'grid' ? 'is-on' : ''} aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} title={t('Grid', 'شبكة')}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
                        </button>
                      </div>
                    )}
                    <button type="button" className="shp__fold" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>
                      <Icon name={listOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                      <span>{listOpen ? t('Hide list', 'إخفاء القائمة') : t('Show list', 'إظهار القائمة')}</span>
                    </button>
                  </div>
                </div>
                {listOpen && (items.length === 0 ? <p className="shp__note">{t('This folder is empty.', 'المجلد فاضي.')}</p> : shown.length === 0 ? <p className="shp__note">{t('No matches.', 'مفيش نتائج.')}</p> : (
                  <ul className={`shp__list${viewMode === 'grid' ? ' shp__list--grid' : ''}`}>
                    {shown.map((it) => (
                      <li key={it.id}>
                        <button type="button" className={`shp__item${preview?.id === it.id ? ' is-on' : ''}`} onClick={() => (it.type === 'folder' ? go(it.id) : openPreview(it))}>
                          {it.type === 'folder' ? <FolderGlyph size={viewMode === 'grid' ? 44 : 28} /> : <FileGlyph size={viewMode === 'grid' ? 44 : 28} label={it.extension} />}
                          <span className="shp__item-name">{it.name}</span>
                          {it.type === 'file' && <span className="shp__item-size">{it.size_human}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
              </section>
            )}

            {preview && (
              <section className={`shp__card shp__viewer${viewOpen ? '' : ' is-folded'}`}>
                <div className="shp__head">
                  <strong className="shp__vtitle" title={preview.name}>{preview.name}</strong>
                  <div className="shp__actions">
                    <button type="button" className="btn btn-ghost" aria-expanded={viewOpen} onClick={() => setViewOpen((v) => !v)}>
                      <Icon name={viewOpen ? 'chevron-up' : 'chevron-down'} size={14} /><span>{viewOpen ? t('Hide preview', 'إخفاء العرض') : t('Show preview', 'إظهار العرض')}</span>
                    </button>
                    {isFolder && canDl && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => download({ id: preview.id, name: preview.name })}><Icon name="download" size={14} /><span>{t('Download', 'تنزيل')}</span></button>}
                    {isFolder && <button type="button" className="btn btn-ghost" onClick={clearPreview}><Icon name="x" size={14} /><span>{t('Close', 'إغلاق')}</span></button>}
                  </div>
                </div>
                <div className="shp__viewer-body" hidden={!viewOpen}>
                  <div className={`shp__preview${preview.blob ? " has-file" : ""}`} style={wmStyle}>
                    {preview.loading && <span className="lp2-spinner" aria-hidden="true" />}
                    {preview.failed && <p className="shp__note">{t('Could not load the preview.', 'تعذّر تحميل المعاينة.')}</p>}
                    {preview.big && <p className="shp__note">{canDl ? t('This file is too large to preview — download it to open it.', 'الملف كبير على المعاينة — نزّله عشان تفتحه.') : t('This file is too large to preview.', 'الملف كبير على المعاينة.')}</p>}
                    {preview.none && <p className="shp__note">{canDl ? t('No preview for this file type — download it to open it.', 'مفيش معاينة لنوع الملف ده — نزّله عشان تفتحه.') : t('No preview is available for this file type.', 'مفيش معاينة متاحة لنوع الملف ده.')}</p>}
                    {preview.blob && <ProtectedFile key={preview.id} name={preview.name} blob={preview.blob} mark={mark} tt={t} rtl={ar} canCopy={canDl} onFail={() => setPreview((p) => p && { ...p, blob: null, failed: true })} />}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer className="shp__foot"><Icon name="shield" size={13} /><span>{t('Shared securely · UIPE — Unified Integrated Platform Ecosystem', 'مشاركة آمنة · UIPE — المنصة الذكية المتكاملة')}</span></footer>
      {(away || shot) && !canDl && data && (
        <div className="shp__veil" role="status"><Icon name="eye-off" size={26} /><p>{t('Content is hidden while the window is not in focus.', 'المحتوى مخفي طول ما النافذة مش في التركيز.')}</p></div>
      )}
    </div>
  );
}
