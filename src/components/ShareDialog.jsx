import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import ShareQr from './ShareQr';
import { StModal, timeAgo } from './student/stUi';
import { errorMessage } from '../api/client';
import { drive } from '../lib/driveApi';
import { publicOrigin } from '../config/siteUrl';
import '../styles/css/drive-share.css'; // must load before the dialog refinements below
import '../styles/css/drive-share-dialogs.css';
import '../styles/css/share-access.css';
import '../styles/css/share-qr.css';

export const EXPIRIES = [
  { key: '1d', en: '1 day', ar: 'يوم' },
  { key: '7d', en: '1 week', ar: 'أسبوع' },
  { key: '30d', en: '1 month', ar: 'شهر' },
  { key: 'custom', en: 'Custom…', ar: 'مدة مخصصة…' },
  { key: 'never', en: 'No expiry', ar: 'بدون انتهاء' },
];
export const UNITS = [
  { key: 'm', en: 'minutes', ar: 'دقائق', mins: 1 },
  { key: 'h', en: 'hours', ar: 'ساعات', mins: 60 },
  { key: 'd', en: 'days', ar: 'أيام', mins: 1440 },
];
const MAX_MINUTES = 365 * 24 * 60;

/** '5' + 'm' -> '5m'; null when it is not a whole number between 1 minute and 365 days */
export function customKey(n, unit) {
  const v = Number(n);
  const u = UNITS.find((x) => x.key === unit);
  if (!u || !Number.isInteger(v) || v < 1 || v * u.mins > MAX_MINUTES) return null;
  return `${v}${unit}`;
}

/** number + unit inputs for a custom duration */
export function CustomDuration({ ar, n, unit, onN, onUnit, disabled }) {
  const bad = customKey(n, unit) === null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input
        type="number" min="1" step="1" inputMode="numeric" dir="ltr" value={n} disabled={disabled}
        onChange={(e) => onN(e.target.value)} aria-invalid={bad} style={{ width: 80 }}
        aria-label={ar ? 'المدة' : 'Duration'}
      />
      <select value={unit} disabled={disabled} onChange={(e) => onUnit(e.target.value)} aria-label={ar ? 'الوحدة' : 'Unit'}>
        {UNITS.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
      </select>
    </span>
  );
}

// ---- who can open the link: anyone / one person (first browser) / one time (+ how long it stays open after the first open) ----
export const ACCESS_PRESETS = [
  { key: '5m', en: '5 minutes', ar: '5 دقائق' }, { key: '10m', en: '10 minutes', ar: '10 دقائق' }, { key: '30m', en: '30 minutes', ar: '30 دقيقة' },
  { key: '1h', en: '1 hour', ar: 'ساعة' }, { key: '1d', en: '1 day', ar: 'يوم' }, { key: 'custom', en: 'Custom…', ar: 'مدة مخصصة…' },
];
const MAX_ACCESS_MINUTES = 30 * 24 * 60;
/** '10' + 'm' -> '10m'; null unless a whole number between 1 minute and 30 days */
export function accessKey(n, unit) {
  const v = Number(n); const u = UNITS.find((x) => x.key === unit);
  if (!u || !Number.isInteger(v) || v < 1 || v * u.mins > MAX_ACCESS_MINUTES) return null;
  return `${v}${unit}`;
}
/** minutes -> '1d' | '2h' | '45m' */
export const minutesToKey = (m) => { const v = Number(m) || 0; if (v >= 1440 && v % 1440 === 0) return `${v / 1440}d`; if (v >= 60 && v % 60 === 0) return `${v / 60}h`; return `${Math.max(1, v)}m`; };
/** minutes -> "10 minutes" / "2 hours" / "1 day" */
export function accessText(mins, ar) {
  const v = Number(mins) || 0;
  const [n, u] = v >= 1440 && v % 1440 === 0 ? [v / 1440, 'd'] : v >= 60 && v % 60 === 0 ? [v / 60, 'h'] : [v, 'm'];
  const w = { m: [['minute', 'minutes'], ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة']], h: [['hour', 'hours'], ['ساعة', 'ساعتين', 'ساعات', 'ساعة']], d: [['day', 'days'], ['يوم', 'يومين', 'أيام', 'يوم']] }[u];
  if (!ar) return `${n} ${n === 1 ? w[0][0] : w[0][1]}`;
  return n === 1 ? w[1][0] : n === 2 ? w[1][1] : `${n} ${n <= 10 ? w[1][2] : w[1][3]}`;
}

export const ACCESS_MODES = [
  { key: 'any', icon: 'users', en: 'Anyone with the link', ar: 'أي حد معاه الرابط', hint_en: 'Can be opened (and forwarded) by anyone.', hint_ar: 'أي حد يقدر يفتحه ويبعته لغيره.' },
  { key: 'single', icon: 'user', en: 'One person only', ar: 'شخص واحد بس', hint_en: 'The first browser that opens it owns it. If it is forwarded, it will not open for anyone else.', hint_ar: 'أول متصفح يفتحه بيتربط بيه. لو اتبعت لحد تاني مش هيفتح عنده.' },
  { key: 'once', icon: 'clock', en: 'One time only', ar: 'مرة واحدة بس', hint_en: 'Opens once, for one person. After the first open it stays available for the time you choose, then closes for good.', hint_ar: 'بيتفتح مرة واحدة لشخص واحد. بعد أول فتح بيفضل متاح للمدة اللي تحددها وبعدين بيتقفل نهائيًا.' },
];
export const modeOf = (l) => (l?.one_time ? 'once' : l?.single_person ? 'single' : 'any');

/** Radio group + (for "one time") the access duration. `access` is a key like '10m'; onAccess(null) while a custom value is invalid. */
export function AccessOptions({ ar, mode, onMode, access, onAccess, disabled }) {
  const preset = ACCESS_PRESETS.find((x) => x.key === access && x.key !== 'custom');
  const [custom, setCustom] = useState(!preset && !!access);
  const m = /^(\d+)([mhd])$/.exec(access || '');
  const [n, setN] = useState(m ? m[1] : '15');
  const [u, setU] = useState(m ? m[2] : 'm');
  const cur = ACCESS_MODES.find((x) => x.key === mode) || ACCESS_MODES[0];
  return (
    <div className="mp-access">
      <div className="mp-seg mp-seg--wrap" role="radiogroup" aria-label={ar ? 'مين يقدر يفتح الرابط' : 'Who can open the link'}>
        {ACCESS_MODES.map((x) => (
          <button key={x.key} type="button" role="radio" aria-checked={mode === x.key} className={mode === x.key ? 'is-on' : ''} disabled={disabled} onClick={() => onMode(x.key)}>
            <Icon name={x.icon} size={14} />{ar ? x.ar : x.en}
          </button>
        ))}
      </div>
      <small className="mp-access__hint">{ar ? cur.hint_ar : cur.hint_en}</small>
      {mode === 'once' && (
        <div className="mp-access__when">
          <span className="mp-share__lbl">{ar ? 'بعد أول فتح يفضل متاح لمدة' : 'After the first open it stays available for'}</span>
          <div className="mp-seg mp-seg--wrap" role="radiogroup">
            {ACCESS_PRESETS.map((x) => {
              const on = x.key === 'custom' ? custom : !custom && access === x.key;
              return (
                <button key={x.key} type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''} disabled={disabled}
                  onClick={() => { if (x.key === 'custom') { setCustom(true); onAccess(accessKey(n, u)); } else { setCustom(false); onAccess(x.key); } }}>
                  {ar ? x.ar : x.en}
                </button>
              );
            })}
          </div>
          {custom && <CustomDuration ar={ar} n={n} unit={u} disabled={disabled} onN={(v) => { setN(v); onAccess(accessKey(v, u)); }} onUnit={(v) => { setU(v); onAccess(accessKey(n, v)); }} />}
          {custom && accessKey(n, u) === null && <small className="mp-access__hint is-bad">{ar ? 'اكتب رقم صحيح: من دقيقة لـ 30 يوم.' : 'Enter a whole number: 1 minute to 30 days.'}</small>}
        </div>
      )}
    </div>
  );
}

/** 12 readable random characters (no 0/O/1/l look-alikes). */
export function genPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => abc[n % abc.length]).join('');
}

export const shareUrl = (token) => `${publicOrigin()}/s/${token}`;

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/**
 * "Share" dialog for My PC: one file / folder, or several of them in ONE link (`nodes` with 2+ items).
 * A multi-item link opens for the visitor as a single folder that holds the selected items, in the order they see them in My PC.
 */
export default function ShareDialog({ nodes, node: nodeProp, ar, locale, onClose, onToast, onManage }) {
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  const list = useMemo(() => (nodes && nodes.length ? nodes : [nodeProp]).filter(Boolean), [nodes, nodeProp]);
  const multi = list.length > 1;
  const node = list[0];
  const defaultTitle = ar ? `${list.length} عناصر مشتركة` : `${list.length} shared items`;
  const [groupName, setGroupName] = useState('');
  const [createdIds, setCreatedIds] = useState([]); // links made from this dialog (a multi-item link has no per-node list to load)
  const [links, setLinks] = useState(null);
  const [expiry, setExpiry] = useState('7d');
  const [customN, setCustomN] = useState('5');
  const [customU, setCustomU] = useState('m');
  const [editId, setEditId] = useState(null); // link whose expiry is being set to a custom duration
  const [editN, setEditN] = useState('5');
  const [editU, setEditU] = useState('m');
  const newExpiry = expiry === 'custom' ? customKey(customN, customU) : expiry;
  const [canDownload, setCanDownload] = useState(true);
  const [mode, setMode] = useState('any');     // any | single | once
  const [access, setAccess] = useState('10m'); // how long a one-time link stays open after its first open
  const [requireInfo, setRequireInfo] = useState(false); // the visitor must type name + email + mobile first
  const [usePw, setUsePw] = useState(false);
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const pwBad = usePw && (pw.length < 4 || pw.length > 64);
  const [busy, setBusy] = useState(false);
  const [qrId, setQrId] = useState(null); // link whose QR code is open
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      if (multi) {
        if (!createdIds.length) { setLinks([]); return; }
        const all = (await drive.mySharedLinks())?.items || [];
        setLinks(all.filter((l) => createdIds.includes(l.id)));
      } else setLinks((await drive.shares(node.id))?.items || []);
    } catch (e) { setError(errorMessage(e)); setLinks([]); }
  }, [node.id, multi, createdIds]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okMsg) => {
    setBusy(true); setError('');
    try { await fn(); if (okMsg) onToast?.(okMsg); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const copy = async (token) => {
    const ok = await copyText(shareUrl(token));
    onToast?.(ok ? tt('Link copied.', 'تم نسخ الرابط.') : tt('Could not copy — select the link and copy it.', 'تعذّر النسخ — حدد الرابط وانسخه يدويًا.'), ok ? undefined : 'error');
  };

  const expiryText = (l) => {
    if (!l.expires_at) return tt('No expiry', 'بدون انتهاء');
    if (l.expired) return tt('Expired', 'منتهي');
    const d = new Date(String(l.expires_at).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return tt('Expires ', 'ينتهي ');
    const lng = locale === 'ar' ? 'ar-EG' : undefined;
    // a short link shows the exact time ("5 minutes" is useless without it); a long one only the date
    const soon = d.getTime() - Date.now() < 3 * 24 * 3600 * 1000;
    return tt('Expires ', 'ينتهي ') + (soon
      ? d.toLocaleString(lng, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(lng, { day: 'numeric', month: 'short', year: 'numeric' }));
  };

  const PERMS = [
    { key: 'dl', icon: 'download', en: 'View & download', ar: 'عرض وتنزيل' },
    { key: 'view', icon: 'eye', en: 'View only', ar: 'عرض فقط' },
  ];
  const isFolder = node.type === 'folder';

  return (
    <StModal
      wide title={tt('Share', 'مشاركة')} onClose={onClose}
      actions={(
        <>
          {onManage && <button type="button" className="btn btn-ghost" onClick={onManage}><Icon name="link" size={15} /><span>{tt('All my shared links', 'كل روابطي المشاركة')}</span></button>}
          <button type="button" className="btn btn-primary" onClick={onClose}>{tt('Done', 'تم')}</button>
        </>
      )}
    >
      <div className="mp-share">
        <div className="mp-share__file">
          <span className="mp-share__file-ico"><Icon name={isFolder || multi ? 'folder' : 'file'} size={20} /></span>
          <div>
            <strong title={multi ? list.map((x) => x.name).join('\n') : node.name}>{multi ? tt(`${list.length} items in one link`, `${list.length} عناصر في رابط واحد`) : node.name}</strong>
            <small>{tt('Anyone with the link can open it — no sign-in. Turn it off any time.', 'أي شخص معه الرابط يقدر يفتحه — من غير تسجيل دخول. وتقدر توقفه في أي وقت.')}</small>
          </div>
        </div>
        {multi && (
          <div className="mp-share__bundle">
            <ul className="mp-share__bundle-list" aria-label={tt('Items in this link', 'العناصر داخل الرابط')}>
              {list.slice(0, 6).map((x) => (
                <li key={x.id} title={x.name}><Icon name={x.type === 'folder' ? 'folder' : 'file'} size={14} /><span>{x.name}</span></li>
              ))}
              {list.length > 6 && <li className="is-more">{tt(`+${list.length - 6} more`, `+${list.length - 6} عنصر كمان`)}</li>}
            </ul>
            <label className="mp-share__group mp-share__group--full">
              <span className="mp-share__lbl">{tt('Name shown to the visitor (optional)', 'الاسم اللي هيظهر للمستلم (اختياري)')}</span>
              <input
                type="text" value={groupName} maxLength={120} disabled={busy} placeholder={defaultTitle}
                onChange={(e) => setGroupName(e.target.value)} aria-label={tt('Link name', 'اسم الرابط')}
              />
            </label>
            <small className="mp-share__hint">{tt('The visitor sees one organized folder with these items — folders open with everything inside.', 'المستلم هيشوف مجلد واحد منظم فيه العناصر دي — والمجلدات بتتفتح بكل اللي جواها.')}</small>
          </div>
        )}

        <section className="mp-share__new">
          <div className="mp-share__group">
            <span className="mp-share__lbl">{tt('Link expires after', 'مدة صلاحية الرابط')}</span>
            <div className="mp-seg mp-seg--wrap" role="radiogroup" aria-label={tt('Link expires after', 'مدة صلاحية الرابط')}>
              {EXPIRIES.map((x) => (
                <button key={x.key} type="button" role="radio" aria-checked={expiry === x.key} className={expiry === x.key ? 'is-on' : ''} disabled={busy} onClick={() => setExpiry(x.key)}>{ar ? x.ar : x.en}</button>
              ))}
            </div>
            {expiry === 'custom' && <CustomDuration ar={ar} n={customN} unit={customU} onN={setCustomN} onUnit={setCustomU} disabled={busy} />}
          </div>
          <div className="mp-share__group">
            <span className="mp-share__lbl">{tt('Permission', 'الصلاحية')}</span>
            <div className="mp-seg" role="radiogroup" aria-label={tt('Permission', 'الصلاحية')}>
              {PERMS.map((x) => (
                <button key={x.key} type="button" role="radio" aria-checked={(canDownload ? 'dl' : 'view') === x.key} className={(canDownload ? 'dl' : 'view') === x.key ? 'is-on' : ''} disabled={busy} onClick={() => setCanDownload(x.key === 'dl')}>
                  <Icon name={x.icon} size={14} />{ar ? x.ar : x.en}
                </button>
              ))}
            </div>
          </div>
          <div className="mp-share__group mp-share__group--full">
            <span className="mp-share__lbl">{tt('Who can open it', 'مين يقدر يفتحه')}</span>
            <AccessOptions ar={ar} mode={mode} onMode={setMode} access={access} onAccess={setAccess} disabled={busy} />
          </div>
          <div className="mp-share__group mp-share__group--full">
            <span className="mp-share__lbl">{tt('Before opening the link', 'قبل ما يفتح الرابط')}</span>
            <label className="mp-gate-opt">
              <input type="checkbox" checked={requireInfo} disabled={busy} onChange={(e) => setRequireInfo(e.target.checked)} />
              <span className="mp-gate-opt__txt">
                <b><Icon name="users" size={14} /> {tt('Ask for the visitor’s details', 'اطلب بيانات الزائر')}</b>
                <small>{tt('Name, email and mobile number are required — you will see them in “My shared links”.', 'الاسم والإيميل ورقم الموبايل إجباريين — وهتشوفهم في "روابطي المشاركة".')}</small>
              </span>
            </label>
            <label className="mp-gate-opt">
              <input type="checkbox" checked={usePw} disabled={busy} onChange={(e) => { setUsePw(e.target.checked); if (!e.target.checked) setPw(''); }} />
              <span className="mp-gate-opt__txt">
                <b><Icon name="lock" size={14} /> {tt('Protect with a password', 'حماية بباسورد')}</b>
                <small>{tt('Even someone who has the link must enter the password.', 'حتى اللي معاه الرابط لازم يكتب الباسورد.')}</small>
              </span>
            </label>
            {usePw && (
              <div className="mp-pw">
                <input
                  type={showPw ? 'text' : 'password'} dir="ltr" autoComplete="new-password" value={pw} disabled={busy} maxLength={64}
                  placeholder={tt('Password (4–64 characters)', 'الباسورد (من 4 لـ 64 حرف)')} aria-invalid={pwBad}
                  onChange={(e) => setPw(e.target.value)}
                />
                <button type="button" className="mp-pw__btn" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? tt('Hide', 'إخفاء') : tt('Show', 'إظهار')}><Icon name={showPw ? 'eye-off' : 'eye'} size={15} /></button>
                <button type="button" className="mp-pw__btn" disabled={busy} onClick={() => { setPw(genPassword()); setShowPw(true); }}><Icon name="refresh" size={14} /><span>{tt('Generate', 'توليد')}</span></button>
              </div>
            )}
          </div>
          <button
            type="button" className="btn btn-primary mp-share__create" disabled={busy || !newExpiry || pwBad || (usePw && !pw) || (mode === 'once' && !access)}
            title={newExpiry ? undefined : tt('Enter a whole number: 1 minute to 365 days', 'اكتب رقم صحيح: من دقيقة لـ 365 يوم')}
            onClick={() => act(async () => {
              const opts = { expiry: newExpiry, canDownload, requireInfo, password: usePw ? pw : '', singlePerson: mode === 'single', oneTime: mode === 'once', access: mode === 'once' ? access : undefined };
              const l = multi
                ? await drive.createBundleShare(list.map((x) => x.id), { ...opts, title: groupName.trim() || defaultTitle })
                : await drive.createShare(node.id, opts);
              if (l?.id && multi) setCreatedIds((ids) => [...ids, l.id]);
              if (l?.token) await copyText(shareUrl(l.token));
              setPw(''); setUsePw(false); setShowPw(false);
            }, usePw ? tt('Link created and copied — remember the password, it can’t be shown again.', 'تم إنشاء الرابط ونسخه — افتكر الباسورد، مش هيتعرض تاني.') : tt('Link created and copied.', 'تم إنشاء الرابط ونسخه.'))}
          ><Icon name="link" size={16} /><span>{tt('Create & copy link', 'إنشاء الرابط ونسخه')}</span></button>
        </section>

        {error && <div className="mp-share__err" role="alert">{error}</div>}

        <div className="mp-share__head">
          <span>{tt('Your links', 'روابطك')}</span>
          {links && links.length > 0 && <b>{links.length}</b>}
        </div>

        <div className="mp-share__list">
          {links === null && <div className="mp-share__empty">{tt('Loading…', 'جارِ التحميل…')}</div>}
          {links && links.length === 0 && <div className="mp-share__empty"><Icon name="link" size={20} /><span>{multi ? tt('Create the link above — it will show up here.', 'اعمل الرابط من فوق — وهيظهر هنا.') : tt('No links yet — create one above.', 'مفيش روابط لسه — اعمل واحد من فوق.')}</span></div>}
          {links && links.map((l) => (
            <article key={l.id} className={`mp-share__row${l.expired ? ' is-expired' : ''}`}>
              <div className="mp-share__top">
                <span className={`mp-badge ${l.paused ? 'is-warn' : l.expired ? 'is-off' : 'is-on'}`}>{l.paused ? tt('Paused', 'موقوف مؤقتًا') : l.expired ? tt('Expired', 'منتهي') : tt('Active', 'شغّال')}</span>
                <span className="mp-badge mp-badge--soft"><Icon name={l.can_download ? 'download' : 'eye'} size={11} />{l.can_download ? tt('Download allowed', 'التنزيل مسموح') : tt('View only', 'عرض فقط')}</span>
                {l.is_bundle && <span className="mp-badge mp-badge--soft"><Icon name="folder" size={11} />{l.node?.count ?? ''} {tt('items', 'عناصر')}</span>}
                {l.has_password && <span className="mp-badge mp-badge--soft"><Icon name="lock" size={11} />{tt('Password', 'باسورد')}</span>}
                {l.require_visitor_info && <span className="mp-badge mp-badge--soft"><Icon name="users" size={11} />{tt('Visitor details', 'بيانات الزائر')}</span>}
                {l.one_time && <span className="mp-badge mp-badge--soft"><Icon name="clock" size={11} />{tt('One time', 'مرة واحدة')} · {accessText(l.access_minutes, ar)}</span>}
                {l.single_person && !l.one_time && <span className="mp-badge mp-badge--soft"><Icon name="user" size={11} />{tt('One person', 'شخص واحد')}</span>}
                <button type="button" className="mp-share__off" disabled={busy} onClick={() => act(() => drive.revokeShare(l.id), tt('Link turned off.', 'تم إيقاف الرابط.'))}>
                  <Icon name="x" size={13} /><span>{tt('Turn off', 'إيقاف')}</span>
                </button>
              </div>
              <div className="mp-share__url">
                <input readOnly dir="ltr" value={shareUrl(l.token)} onFocus={(e) => e.target.select()} aria-label={tt('Share link', 'رابط المشاركة')} />
                <button type="button" className="mp-share__copy" onClick={() => copy(l.token)} disabled={l.expired}><Icon name="copy" size={14} /><span>{tt('Copy', 'نسخ')}</span></button>
                <button type="button" className={`mp-share__qrbtn${qrId === l.id ? ' is-on' : ''}`} onClick={() => setQrId(qrId === l.id ? null : l.id)} disabled={l.expired} aria-expanded={qrId === l.id}><Icon name="qr" size={14} /><span>QR</span></button>
              </div>
              {qrId === l.id && !l.expired && <ShareQr url={shareUrl(l.token)} name={l.node?.name || node.name} ar={ar} onToast={onToast} />}
              <div className="mp-share__meta">
                <span><Icon name="clock" size={12} /> {expiryText(l)}</span>
                <span title={tt('Views', 'المشاهدات')}><Icon name="eye" size={12} /> {l.views}</span>
                <span title={tt('Downloads', 'التنزيلات')}><Icon name="download" size={12} /> {l.downloads}</span>
                {l.last_used_at && <span>{tt('Last opened ', 'آخر فتح ')}{timeAgo(l.last_used_at, locale)}</span>}
              </div>
              <div className="mp-share__ctl">
                <div className="mp-seg mp-seg--sm" role="radiogroup" aria-label={tt('Permission', 'الصلاحية')}>
                  {PERMS.map((x) => (
                    <button key={x.key} type="button" role="radio" aria-checked={(l.can_download ? 'dl' : 'view') === x.key} className={(l.can_download ? 'dl' : 'view') === x.key ? 'is-on' : ''} disabled={busy}
                      onClick={() => { if ((l.can_download ? 'dl' : 'view') !== x.key) act(() => drive.updateShare(l.id, { can_download: x.key === 'dl' })); }}>
                      {ar ? x.ar : x.en}
                    </button>
                  ))}
                </div>
                <select
                  className="mp-share__sel" value="" disabled={busy} aria-label={tt('Change expiry', 'تغيير المدة')}
                  onChange={(e) => {
                    if (e.target.value === 'custom') { setEditId(l.id); return; }
                    setEditId(null);
                    if (e.target.value) act(() => drive.updateShare(l.id, { expiry: e.target.value }), tt('Expiry updated.', 'تم تحديث المدة.'));
                  }}
                >
                  <option value="">{tt('Change expiry…', 'تغيير المدة…')}</option>
                  {EXPIRIES.map((x) => <option key={x.key} value={x.key}>{tt('From now: ', 'من الآن: ')}{ar ? x.ar : x.en}</option>)}
                </select>
              </div>
              {editId === l.id && (
                <div className="mp-share__edit">
                  <CustomDuration ar={ar} n={editN} unit={editU} onN={setEditN} onUnit={setEditU} disabled={busy} />
                  <button
                    type="button" className="btn btn-primary" disabled={busy || !customKey(editN, editU)}
                    onClick={() => act(async () => { await drive.updateShare(l.id, { expiry: customKey(editN, editU) }); setEditId(null); }, tt('Expiry updated.', 'تم تحديث المدة.'))}
                  >{tt('Apply', 'تطبيق')}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </StModal>
  );
}
