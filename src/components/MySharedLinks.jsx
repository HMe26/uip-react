import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import ShareQr from './ShareQr';
import { StModal, timeAgo } from './student/stUi';
import { errorMessage } from '../api/client';
import { drive } from '../lib/driveApi';
import { AccessOptions, CustomDuration, EXPIRIES, accessText, copyText, customKey, genPassword, minutesToKey, modeOf, shareUrl } from './ShareDialog';
import '../styles/css/drive-share.css'; // must load before the dialog refinements below
import '../styles/css/drive-share-dialogs.css';
import '../styles/css/shared-links-manager.css';
import '../styles/css/shared-links-panel.css'; // last: layout + colours that work in the dialog, in Settings and inside the desktop window

const STATUS = {
  active: { en: 'Active', ar: 'شغّال', cls: 'is-on' },
  paused: { en: 'Paused', ar: 'موقوف مؤقتًا', cls: 'is-warn' },
  expired: { en: 'Expired', ar: 'منتهي', cls: 'is-off' },
  revoked: { en: 'Turned off', ar: 'متوقف نهائيًا', cls: 'is-off' },
};
const USED = { en: 'Used', ar: 'اتستخدم', cls: 'is-off' }; // a one-time link whose window is over
const EVENT = {
  open: { en: 'Opened the link', ar: 'فتح الرابط', icon: 'eye' },
  enter: { en: 'Passed the gate', ar: 'عدّى البوابة', icon: 'check-circle' },
  preview: { en: 'Viewed', ar: 'شاف', icon: 'file' },
  download: { en: 'Downloaded', ar: 'نزّل', icon: 'download' },
  zip: { en: 'Downloaded ZIP', ar: 'نزّل ZIP', icon: 'archive' },
  password_failed: { en: 'Wrong password', ar: 'باسورد غلط', icon: 'alert' },
};

const fmtDT = (v, ar) => {
  if (!v) return '—';
  const d = new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(ar ? 'ar-EG' : undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Who opened one link: summary + the people (name / email / mobile / device) + the latest events. */
function Activity({ share, ar, locale, tt, onBack, onToast, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try { setData(await drive.shareActivity(share.id)); setError(''); } catch (e) { setError(errorMessage(e)); }
  }, [share.id]);
  useEffect(() => { load(); }, [load]);

  const sm = data?.summary;
  const people = data?.visitors || [];
  return (
    <div className="mp-sl">
      <div className="mp-sl__bar">
        <button type="button" className="btn btn-ghost" onClick={onBack}><Icon name={ar ? 'chevron-right' : 'chevron-left'} size={15} /><span>{tt('Back', 'رجوع')}</span></button>
        <strong title={share.node?.name}>{share.node?.name || tt('Deleted item', 'عنصر محذوف')}</strong>
      </div>
      {error && <div className="mp-share__err" role="alert">{error}</div>}
      {!data && !error && <div className="mp-share__empty">{tt('Loading…', 'جارِ التحميل…')}</div>}
      {data && (
        <>
          <div className="mp-sl__stats">
            <div><b>{sm.opens}</b><span>{tt('Opens', 'مرات الفتح')}</span></div>
            <div><b>{sm.identified}</b><span>{tt('Identified people', 'أشخاص معروفين')}</span></div>
            <div><b>{sm.anonymous}</b><span>{tt('Anonymous devices', 'أجهزة مجهولة')}</span></div>
            <div><b>{sm.downloads}</b><span>{tt('Downloads', 'التنزيلات')}</span></div>
            {data.share.has_password && <div><b>{sm.failed_passwords}</b><span>{tt('Wrong passwords', 'باسورد غلط')}</span></div>}
          </div>
          {sm.opens === 0 && people.length === 0 && (
            <div className="mp-share__empty"><Icon name="eye-off" size={20} /><span>{tt('Nobody has opened this link yet.', 'محدش فتح الرابط ده لسه.')}</span></div>
          )}

          {people.length > 0 && (
            <>
              <div className="mp-share__head"><span>{tt('People who entered their details', 'اللي دخّلوا بياناتهم')}</span><b>{people.length}</b></div>
              <div className="mp-sl__people">
                {people.map((p) => (
                  <article key={p.key} className="mp-sl__person">
                    <div className="mp-sl__pname">
                      <span className="mp-sl__avatar" aria-hidden="true">{(p.name || '?').trim().charAt(0).toUpperCase()}</span>
                      <div>
                        <strong>{p.name || tt('Anonymous (password only)', 'مجهول (باسورد فقط)')}</strong>
                        {p.account && <span className="mp-badge mp-badge--soft"><Icon name="shield" size={11} />{tt('UIPE account', 'حساب UIPE')}{p.account.name ? `: ${p.account.name}` : ''}</span>}
                      </div>
                    </div>
                    <div className="mp-sl__pinfo">
                      {p.email && <a href={`mailto:${p.email}`} dir="ltr"><Icon name="mail" size={12} />{p.email}</a>}
                      {p.phone && <a href={`tel:${p.phone}`} dir="ltr"><Icon name="smartphone" size={12} />{p.phone}</a>}
                      {p.devices.length > 0 && <span><Icon name="monitor" size={12} />{p.devices.join(' • ')}</span>}
                      {p.ips.length > 0 && <span dir="ltr" title={tt('Last part of the IP is hidden', 'آخر جزء من الـ IP مخفي')}>IP {p.ips.join(', ')}</span>}
                    </div>
                    <div className="mp-share__meta">
                      <span><Icon name="eye" size={12} /> {p.opens}</span>
                      <span><Icon name="download" size={12} /> {p.downloads}</span>
                      <span>{tt('First ', 'أول مرة ')}{fmtDT(p.first_seen_at, ar)}</span>
                      <span>{tt('Last ', 'آخر مرة ')}{fmtDT(p.last_seen_at, ar)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {data.events.length > 0 && (
            <>
              <div className="mp-share__head"><span>{tt('Latest activity', 'آخر النشاط')}</span><b>{data.events.length}</b></div>
              <ul className="mp-sl__events">
                {data.events.map((e) => {
                  const t = EVENT[e.type] || { en: e.type, ar: e.type, icon: 'eye' };
                  const who = e.visitor_name || e.visitor_email || tt('Anonymous', 'مجهول');
                  return (
                    <li key={e.id} className={e.type === 'password_failed' ? 'is-bad' : ''}>
                      <Icon name={t.icon} size={14} />
                      <span className="mp-sl__ev-main"><b>{who}</b> · {ar ? t.ar : t.en}{e.node_name ? <em> — {e.node_name}</em> : null}</span>
                      <span className="mp-sl__ev-meta">{e.device || ''}{e.ip ? ` · ${e.ip}` : ''}</span>
                      <time>{timeAgo(e.at, locale)} · {fmtDT(e.at, ar)}</time>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {(sm.opens > 0 || people.length > 0 || data.events.length > 0) && (
            <div className="mp-sl__foot">
              {!confirm ? (
                <button type="button" className="btn btn-ghost mp-sl__danger" onClick={() => setConfirm(true)}><Icon name="trash" size={14} /><span>{tt('Clear this log', 'مسح السجل')}</span></button>
              ) : (
                <span className="mp-sl__confirm">
                  {tt('Clear the whole log and reset the counters?', 'تمسح السجل كله وتصفّر العدّادات؟')}
                  <button type="button" className="btn btn-primary mp-sl__dangerfill" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { await drive.clearShareActivity(share.id); onToast?.(tt('Log cleared.', 'تم مسح السجل.')); setConfirm(false); await load(); onChanged?.(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
                  }}>{tt('Clear', 'مسح')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>{tt('Cancel', 'إلغاء')}</button>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Edit the gate + permission + expiry of one existing link. */
function Settings({ l, ar, tt, busy, act }) {
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [custom, setCustom] = useState(false);
  const [n, setN] = useState('5');
  const [u, setU] = useState('m');
  const pwBad = pw !== '' && (pw.length < 4 || pw.length > 64);
  const perm = l.can_download ? 'dl' : 'view';
  // who can open it: anyone / one person / one time (+ how long after the first open)
  const curMode = modeOf(l);
  const curAccess = l.access_minutes ? minutesToKey(l.access_minutes) : '10m';
  const [mode, setMode] = useState(curMode);
  const [access, setAccess] = useState(curAccess);
  const changed = mode !== curMode || (mode === 'once' && access !== curAccess);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="mp-sl__settings">
      <div className="mp-share__group">
        <span className="mp-share__lbl">{tt('Permission', 'الصلاحية')}</span>
        <div className="mp-seg mp-seg--sm" role="radiogroup">
          {[{ k: 'dl', icon: 'download', en: 'View & download', ar: 'عرض وتنزيل' }, { k: 'view', icon: 'eye', en: 'View only', ar: 'عرض فقط' }].map((x) => (
            <button key={x.k} type="button" role="radio" aria-checked={perm === x.k} className={perm === x.k ? 'is-on' : ''} disabled={busy}
              onClick={() => { if (perm !== x.k) act(() => drive.updateShare(l.id, { can_download: x.k === 'dl' })); }}>
              <Icon name={x.icon} size={13} />{ar ? x.ar : x.en}
            </button>
          ))}
        </div>
      </div>

      <div className="mp-share__group">
        <span className="mp-share__lbl">{tt('Expiry (from now)', 'مدة الصلاحية (من الآن)')}</span>
        <div className="mp-sl__row">
          <select className="mp-share__sel" value="" disabled={busy} onChange={(e) => {
            if (e.target.value === 'custom') { setCustom(true); return; }
            setCustom(false);
            if (e.target.value) act(() => drive.updateShare(l.id, { expiry: e.target.value }), tt('Expiry updated.', 'تم تحديث المدة.'));
          }}>
            <option value="">{tt('Change expiry…', 'تغيير المدة…')}</option>
            {EXPIRIES.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
          </select>
          {custom && (
            <>
              <CustomDuration ar={ar} n={n} unit={u} onN={setN} onUnit={setU} disabled={busy} />
              <button type="button" className="btn btn-primary" disabled={busy || !customKey(n, u)}
                onClick={() => act(async () => { await drive.updateShare(l.id, { expiry: customKey(n, u) }); setCustom(false); }, tt('Expiry updated.', 'تم تحديث المدة.'))}>{tt('Apply', 'تطبيق')}</button>
            </>
          )}
        </div>
      </div>

      <div className="mp-share__group mp-share__group--full">
        <span className="mp-share__lbl">{tt('Who can open it', 'مين يقدر يفتحه')}</span>
        <AccessOptions ar={ar} mode={mode} onMode={setMode} access={access} onAccess={setAccess} disabled={busy} />
        {changed && (
          <div className="mp-sl__row">
            <button type="button" className="btn btn-primary" disabled={busy || (mode === 'once' && !access)}
              onClick={() => act(() => drive.updateShare(l.id, { single_person: mode === 'single', one_time: mode === 'once', ...(mode === 'once' ? { access } : {}) }),
                tt('Saved. The link starts fresh — the first browser that opens it from now on is the one it binds to.', 'تم الحفظ. الرابط بدأ من الأول — أول متصفح يفتحه من دلوقتي هو اللي بيتربط بيه.'))}>{tt('Apply', 'تطبيق')}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setMode(curMode); setAccess(curAccess); }}>{tt('Cancel', 'إلغاء')}</button>
          </div>
        )}
        {!changed && curMode !== 'any' && (
          <div className="mp-access__state">
            {l.claimed ? (
              <>
                <span><Icon name="user" size={13} /> {tt('Bound to', 'مربوط بـ')} <b>{l.claimed_device || tt('one browser', 'متصفح واحد')}</b>{l.claimed_at ? <> · {fmtDT(l.claimed_at, ar)}</> : null}</span>
                {l.one_time && l.claim_expires_at && <span><Icon name="clock" size={13} /> {l.consumed ? tt('Closed for good since ', 'اتقفل نهائيًا من ') : tt('Closes ', 'بيتقفل ')}{fmtDT(l.claim_expires_at, ar)}</span>}
                {confirmReset ? (
                  <span className="mp-sl__confirm">
                    {tt('Forget this browser? The next one to open the link takes its place.', 'تنسى المتصفح ده؟ أول متصفح يفتح الرابط بعد كده هيحل مكانه.')}
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(async () => { await drive.resetShareClaim(l.id); setConfirmReset(false); }, tt('Link reset.', 'تم إعادة ضبط الرابط.'))}>{tt('Yes, reset', 'أيوه، أعد الضبط')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>{tt('Cancel', 'إلغاء')}</button>
                  </span>
                ) : <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmReset(true)}><Icon name="refresh" size={14} /><span>{tt('Reset (open for someone else)', 'إعادة ضبط (تفتحه لحد تاني)')}</span></button>}
              </>
            ) : <span><Icon name="clock" size={13} /> {tt('Nobody has opened it yet — the first browser to open it will be bound to it.', 'لسه محدش فتحه — أول متصفح يفتحه هيتربط بيه.')}</span>}
          </div>
        )}
      </div>

      <div className="mp-share__group mp-share__group--full">
        <span className="mp-share__lbl">{tt('Before opening the link', 'قبل ما يفتح الرابط')}</span>
        <label className="mp-gate-opt">
          <input type="checkbox" checked={!!l.require_visitor_info} disabled={busy}
            onChange={(e) => act(() => drive.updateShare(l.id, { require_visitor_info: e.target.checked }), e.target.checked ? tt('Visitors must now enter their details (earlier visitors will be asked again).', 'الزوار لازم يدخّلوا بياناتهم دلوقتي (اللي فتحوا قبل كده هيتسألوا تاني).') : tt('Visitor details are no longer required.', 'مبقاش مطلوب بيانات الزائر.'))} />
          <span className="mp-gate-opt__txt"><b><Icon name="users" size={14} /> {tt('Ask for name, email and mobile', 'اطلب الاسم والإيميل والموبايل')}</b></span>
        </label>
        <div className="mp-gate-opt mp-gate-opt--pw">
          <span className="mp-gate-opt__txt">
            <b><Icon name="lock" size={14} /> {l.has_password ? tt('Password is set', 'الباسورد مفعّل') : tt('No password', 'من غير باسورد')}</b>
            <small>{l.has_password ? tt('Setting a new password signs out everyone who entered the old one.', 'تغيير الباسورد بيطلّع كل اللي دخلوا بالباسورد القديم.') : tt('Anyone with the link can open it (after the details, if required).', 'أي حد معاه الرابط يقدر يفتح (بعد البيانات لو مطلوبة).')}</small>
          </span>
          <div className="mp-pw">
            <input type={showPw ? 'text' : 'password'} dir="ltr" autoComplete="new-password" value={pw} maxLength={64} disabled={busy}
              placeholder={l.has_password ? tt('New password', 'باسورد جديد') : tt('Set a password (4–64)', 'حدد باسورد (4–64)')} aria-invalid={pwBad} onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="mp-pw__btn" onClick={() => setShowPw((v) => !v)} aria-label={tt('Show / hide', 'إظهار / إخفاء')}><Icon name={showPw ? 'eye-off' : 'eye'} size={15} /></button>
            <button type="button" className="mp-pw__btn" disabled={busy} onClick={() => { setPw(genPassword()); setShowPw(true); }}><Icon name="refresh" size={14} /><span>{tt('Generate', 'توليد')}</span></button>
            <button type="button" className="btn btn-primary" disabled={busy || !pw || pwBad}
              onClick={() => act(async () => { await drive.updateShare(l.id, { password: pw }); setPw(''); setShowPw(false); }, tt('Password saved — it can’t be shown again.', 'تم حفظ الباسورد — مش هيتعرض تاني.'))}>{tt('Save', 'حفظ')}</button>
            {l.has_password && <button type="button" className="btn btn-ghost mp-sl__danger" disabled={busy}
              onClick={() => act(() => drive.updateShare(l.id, { remove_password: true }), tt('Password removed.', 'تم إزالة الباسورد.'))}>{tt('Remove', 'إزالة')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "My shared links" manager — used inside Settings (embedded) and in the My PC dialog.
 * Every link I shared: select several (or all) to pause / resume / delete in one go, or act on a single link;
 * edit its gate, and see who opened it.
 */
export function SharedLinksPanel({ ar, locale, onToast: onToastProp, embedded = false }) {
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  // Always give feedback: use the host's toast when it passes one, otherwise show our own inside the panel.
  const [localToast, setLocalToast] = useState(null);
  const toastTimer = useRef(0);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const onToast = useCallback((msg, kind) => {
    if (onToastProp) { onToastProp(msg, kind); return; }
    setLocalToast({ msg, kind, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLocalToast(null), kind === 'error' ? 4200 : 2400);
  }, [onToastProp]);
  const [copiedId, setCopiedId] = useState(null); // the link whose Copy button shows "Copied ✓" for a moment
  const [qrId, setQrId] = useState(null); // link whose QR code is open
  const copiedTimer = useRef(0);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // link id whose settings are open
  const [del, setDel] = useState(null);   // link id waiting for delete confirmation
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [bulk, setBulk] = useState(null); // { action: 'delete'|'pause'|'resume', all: bool } waiting for confirmation

  const load = useCallback(async () => {
    try { setItems((await drive.manageShares())?.items || []); setError(''); } catch (e) { setError(errorMessage(e)); setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // forget selected ids that no longer exist
  useEffect(() => {
    if (!items) return;
    setSel((cur) => { const ids = new Set(items.map((l) => l.id)); const next = new Set([...cur].filter((id) => ids.has(id))); return next.size === cur.size ? cur : next; });
  }, [items]);

  const act = async (fn, okMsg) => {
    setBusy(true); setError('');
    try { await fn(); if (okMsg) onToast?.(okMsg); await load(); } catch (e) { const m = errorMessage(e); setError(m); onToast?.(m, 'error'); } finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, paused: 0, ended: 0 };
    (items || []).forEach((l) => { c.all += 1; if (l.status === 'active') c.active += 1; else if (l.status === 'paused') c.paused += 1; else c.ended += 1; });
    return c;
  }, [items]);

  const shown = useMemo(() => (items || []).filter((l) => {
    if (tab === 'active' && l.status !== 'active') return false;
    if (tab === 'paused' && l.status !== 'paused') return false;
    if (tab === 'ended' && (l.status === 'active' || l.status === 'paused')) return false;
    if (q.trim() && !(l.node?.name || '').toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  }), [items, tab, q]);

  const picked = useMemo(() => (items || []).filter((l) => sel.has(l.id)), [items, sel]);
  const allShownOn = shown.length > 0 && shown.every((l) => sel.has(l.id));
  const toggle = (id) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleShown = () => setSel((cur) => { const n = new Set(cur); if (allShownOn) shown.forEach((l) => n.delete(l.id)); else shown.forEach((l) => n.add(l.id)); return n; });

  const runBulk = async () => {
    if (!bulk) return;
    const { action, all } = bulk;
    const ids = all ? [] : picked.map((l) => l.id);
    setBusy(true); setError('');
    try {
      const r = await drive.bulkShares(action, { ids, all });
      const n = r?.done ?? 0;
      const msg = action === 'delete' ? tt(`${n} link(s) deleted.`, `تم حذف ${n} رابط.`)
        : action === 'pause' ? tt(`${n} link(s) paused.`, `تم إيقاف ${n} رابط مؤقتًا.`)
          : tt(`${n} link(s) resumed.`, `تم استئناف ${n} رابط.`);
      onToast?.(msg);
      setBulk(null); setSel(new Set());
      await load();
    } catch (e) { const m = errorMessage(e); setError(m); onToast?.(m, 'error'); } finally { setBusy(false); }
  };

  const copy = async (l) => {
    const ok = await copyText(shareUrl(l.token));
    if (ok) {
      setCopiedId(l.id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 1800);
    }
    onToast?.(ok ? tt('Link copied to the clipboard.', 'تم نسخ الرابط ✓') : tt('Could not copy — select the link and copy it.', 'تعذّر النسخ — حدد الرابط وانسخه يدويًا.'), ok ? undefined : 'error');
  };

  const expiryText = (l) => {
    if (!l.expires_at) return tt('No expiry', 'بدون انتهاء');
    const d = new Date(String(l.expires_at).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '';
    return (l.expired ? tt('Expired ', 'انتهى ') : tt('Expires ', 'ينتهي ')) + fmtDT(l.expires_at, ar);
  };

  const TABS = [
    { k: 'all', en: 'All', ar: 'الكل' }, { k: 'active', en: 'Active', ar: 'شغّالة' },
    { k: 'paused', en: 'Paused', ar: 'موقوفة' }, { k: 'ended', en: 'Ended', ar: 'منتهية' },
  ];

  const toastEl = localToast && (
    <div className="mp-sl__toastdock" aria-live="polite">
      <div key={localToast.id} className={`mp-sl__toast${localToast.kind === 'error' ? ' is-error' : ''}`} role="status">
        <Icon name={localToast.kind === 'error' ? 'alert' : 'check-circle'} size={16} /><span>{localToast.msg}</span>
      </div>
    </div>
  );

  if (detail) {
    return (
      <div className={`mp-sl-wrap${embedded ? ' mp-sl--embedded' : ''}`}>
        <Activity share={detail} ar={ar} locale={locale} tt={tt} onBack={() => setDetail(null)} onToast={onToast} onChanged={load} />
        {toastEl}
      </div>
    );
  }

  const total = items?.length || 0;
  const pickedActive = picked.filter((l) => l.status === 'active').length;
  const pickedPaused = picked.filter((l) => l.status === 'paused').length;
  const bulkText = bulk && (() => {
    const n = bulk.all ? total : picked.length;
    if (bulk.action === 'delete') return bulk.all
      ? tt(`Delete ALL ${n} links and their logs for good? This can’t be undone.`, `تمسح كل الروابط (${n}) وسجلاتها نهائيًا؟ مش هينفع ترجّعهم.`)
      : tt(`Delete ${n} selected link(s) and their logs for good?`, `تمسح ${n} رابط محدد وسجلاتهم نهائيًا؟`);
    if (bulk.action === 'pause') return bulk.all
      ? tt(`Pause all your active links? Visitors will see a “paused” page until you resume them.`, 'توقّف كل الروابط الشغّالة؟ الزوار هيشوفوا صفحة "موقوف" لحد ما تستأنفها.')
      : tt(`Pause ${n} selected link(s)?`, `توقّف ${n} رابط محدد مؤقتًا؟`);
    return bulk.all ? tt('Resume all paused links?', 'تستأنف كل الروابط الموقوفة؟') : tt(`Resume ${n} selected link(s)?`, `تستأنف ${n} رابط محدد؟`);
  })();

  return (
    <div className={`mp-sl${embedded ? ' mp-sl--embedded' : ''}`}>
      <div className="mp-sl__tools">
        <div className="mp-seg mp-seg--wrap" role="tablist">
          {TABS.map((x) => (
            <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} className={tab === x.k ? 'is-on' : ''} onClick={() => setTab(x.k)}>
              {ar ? x.ar : x.en}<b className="mp-sl__count">{counts[x.k]}</b>
            </button>
          ))}
        </div>
        <input className="mp-sl__search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search by file name…', 'ابحث باسم الملف…')} aria-label={tt('Search', 'بحث')} />
      </div>

      {items && total > 0 && (
        <div className={`mp-bulk${picked.length ? ' is-on' : ''}`} role="toolbar" aria-label={tt('Bulk actions', 'إجراءات جماعية')}>
          <label className="mp-bulk__all">
            <input type="checkbox" checked={allShownOn} onChange={toggleShown} disabled={busy || shown.length === 0} aria-label={tt('Select all shown', 'تحديد كل المعروض')} />
            <span>{picked.length ? tt(`${picked.length} selected`, `${picked.length} محدد`) : tt('Select all', 'تحديد الكل')}</span>
          </label>
          {picked.length > 0 ? (
            <div className="mp-bulk__acts">
              {pickedActive > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setBulk({ action: 'pause', all: false })}><Icon name="stop" size={14} /><span>{tt('Pause', 'إيقاف')}</span></button>}
              {pickedPaused > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setBulk({ action: 'resume', all: false })}><Icon name="play" size={14} /><span>{tt('Resume', 'استئناف')}</span></button>}
              <button type="button" className="btn btn-ghost mp-sl__danger" disabled={busy} onClick={() => setBulk({ action: 'delete', all: false })}><Icon name="trash" size={14} /><span>{tt('Delete selected', 'حذف المحدد')}</span></button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setSel(new Set())}><span>{tt('Clear', 'إلغاء التحديد')}</span></button>
            </div>
          ) : (
            <div className="mp-bulk__acts">
              {counts.active > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setBulk({ action: 'pause', all: true })}><Icon name="stop" size={14} /><span>{tt('Pause all', 'إيقاف الكل')}</span></button>}
              {counts.paused > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setBulk({ action: 'resume', all: true })}><Icon name="play" size={14} /><span>{tt('Resume all', 'استئناف الكل')}</span></button>}
              <button type="button" className="btn btn-ghost mp-sl__danger" disabled={busy} onClick={() => setBulk({ action: 'delete', all: true })}><Icon name="trash" size={14} /><span>{tt('Delete all', 'حذف الكل')}</span></button>
            </div>
          )}
        </div>
      )}
      {bulk && (
        <div className={`mp-bulk__confirm${bulk.action === 'delete' ? ' is-danger' : ''}`} role="alertdialog" aria-live="polite">
          <Icon name={bulk.action === 'delete' ? 'trash' : bulk.action === 'pause' ? 'stop' : 'play'} size={18} />
          <span>{bulkText}</span>
          <div>
            <button type="button" className={`btn btn-primary${bulk.action === 'delete' ? ' mp-sl__dangerfill' : ''}`} disabled={busy} onClick={runBulk}>
              {busy ? tt('Working…', 'جارِ التنفيذ…') : bulk.action === 'delete' ? tt('Yes, delete', 'أيوه، احذف') : bulk.action === 'pause' ? tt('Pause', 'إيقاف') : tt('Resume', 'استئناف')}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setBulk(null)}>{tt('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      )}
      {error && <div className="mp-share__err" role="alert">{error}</div>}

      <div className="mp-sl__list">
        {items === null && <div className="mp-share__empty">{tt('Loading…', 'جارِ التحميل…')}</div>}
        {items && items.length === 0 && <div className="mp-share__empty"><Icon name="link" size={20} /><span>{tt('You haven’t shared anything yet. Select a file in My PC and press Share.', 'لسه ما شاركتش حاجة. اختار ملف في جهازي واضغط مشاركة.')}</span></div>}
        {items && items.length > 0 && shown.length === 0 && <div className="mp-share__empty"><span>{tt('No links match.', 'مفيش روابط مطابقة.')}</span></div>}
        {shown.map((l) => {
          const st = l.consumed ? USED : (STATUS[l.status] || STATUS.active);
          const live = l.status === 'active' || l.status === 'paused' || !!l.consumed; // a used one-time link can still be reset
          const on = sel.has(l.id);
          return (
            <article key={l.id} className={`mp-share__row mp-sl__card${live ? '' : ' is-expired'}${on ? ' is-picked' : ''}${l.status === 'paused' ? ' is-paused' : ''}`}>
              <div className="mp-sl__head">
                <label className="mp-sl__pick" title={tt('Select', 'تحديد')}>
                  <input type="checkbox" checked={on} onChange={() => toggle(l.id)} disabled={busy} aria-label={tt('Select this link', 'تحديد الرابط ده')} />
                </label>
                <span className="mp-share__file-ico"><Icon name={l.node?.type === 'folder' || l.node?.type === 'bundle' ? 'folder' : 'file'} size={18} /></span>
                <div className="mp-sl__title">
                  <strong title={l.node?.name}>{l.node_deleted ? tt('Deleted item', 'عنصر محذوف') : l.node?.name}</strong>
                  <div className="mp-share__top">
                    {l.is_bundle && !l.node_deleted && <span className="mp-badge mp-badge--soft"><Icon name="folder" size={11} />{l.node?.count ?? ''} {tt('items', 'عناصر')}</span>}
                    {l.node_deleted && <span className="mp-badge is-off">{tt('Item deleted — link is dead', 'العنصر اتحذف — الرابط مات')}</span>}
                    <span className="mp-badge mp-badge--soft"><Icon name={l.can_download ? 'download' : 'eye'} size={11} />{l.can_download ? tt('Download allowed', 'التنزيل مسموح') : tt('View only', 'عرض فقط')}</span>
                    {l.has_password && <span className="mp-badge mp-badge--soft"><Icon name="lock" size={11} />{tt('Password', 'باسورد')}</span>}
                    {l.require_visitor_info && <span className="mp-badge mp-badge--soft"><Icon name="users" size={11} />{tt('Visitor details', 'بيانات الزائر')}</span>}
                    {l.one_time && <span className="mp-badge mp-badge--soft"><Icon name="clock" size={11} />{tt('One time', 'مرة واحدة')} · {accessText(l.access_minutes, ar)}</span>}
                    {l.single_person && !l.one_time && <span className="mp-badge mp-badge--soft"><Icon name="user" size={11} />{tt('One person', 'شخص واحد')}</span>}
                    {l.claimed && <span className="mp-badge mp-badge--soft" title={l.claimed_device || ''}><Icon name="shield" size={11} />{tt('Bound to a browser', 'مربوط بمتصفح')}</span>}
                  </div>
                </div>
                <span className={`mp-badge mp-sl__status ${st.cls}`}>{ar ? st.ar : st.en}</span>
              </div>

              {live && (
                <div className="mp-share__url">
                  <input readOnly dir="ltr" value={shareUrl(l.token)} onFocus={(e) => e.target.select()} aria-label={tt('Share link', 'رابط المشاركة')} />
                  <button type="button" className={`mp-share__copy${copiedId === l.id ? ' is-done' : ''}`} onClick={() => copy(l)} disabled={l.expired} aria-live="polite">
                    <Icon name={copiedId === l.id ? 'check' : 'copy'} size={14} /><span>{copiedId === l.id ? tt('Copied', 'تم النسخ') : tt('Copy', 'نسخ')}</span>
                  </button>
                  <button type="button" className={`mp-share__qrbtn${qrId === l.id ? ' is-on' : ''}`} onClick={() => setQrId(qrId === l.id ? null : l.id)} disabled={l.expired} aria-expanded={qrId === l.id}><Icon name="qr" size={14} /><span>QR</span></button>
                </div>
              )}
              {live && qrId === l.id && !l.expired && (
                <ShareQr url={shareUrl(l.token)} name={l.node?.name || l.title} ar={ar} onToast={onToast} />
              )}

              <div className="mp-share__meta">
                <span><Icon name="clock" size={12} /> {expiryText(l)}</span>
                <span title={tt('Opens', 'مرات الفتح')}><Icon name="eye" size={12} /> {l.views}</span>
                <span title={tt('Different visitors', 'زوار مختلفين')}><Icon name="users" size={12} /> {l.unique_visitors}</span>
                <span title={tt('Downloads', 'التنزيلات')}><Icon name="download" size={12} /> {l.downloads}</span>
                <span>{l.last_used_at ? tt('Last opened ', 'آخر فتح ') + timeAgo(l.last_used_at, locale) : tt('Never opened', 'لسه محدش فتحه')}</span>
              </div>

              <div className="mp-sl__actions">
                <button type="button" className="btn btn-ghost" onClick={() => setDetail(l)}><Icon name="users" size={14} /><span>{tt('Who opened it', 'مين فتحه')}</span></button>
                {l.status === 'active' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => drive.pauseShare(l.id), tt('Link paused.', 'تم إيقاف الرابط مؤقتًا.'))}><Icon name="stop" size={14} /><span>{tt('Pause', 'إيقاف')}</span></button>}
                {l.status === 'paused' && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => drive.resumeShare(l.id), tt('Link resumed.', 'تم استئناف الرابط.'))}><Icon name="play" size={14} /><span>{tt('Resume', 'استئناف')}</span></button>}
                {live && <button type="button" className={`btn btn-ghost${open === l.id ? ' is-on' : ''}`} onClick={() => setOpen(open === l.id ? null : l.id)}><Icon name="settings" size={14} /><span>{tt('Settings', 'الإعدادات')}</span></button>}
                {del === l.id ? (
                  <span className="mp-sl__confirm">
                    {tt('Delete the link and its log for good?', 'تمسح الرابط وسجله نهائيًا؟')}
                    <button type="button" className="btn btn-primary mp-sl__dangerfill" disabled={busy} onClick={() => act(async () => { await drive.deleteShare(l.id); setDel(null); }, tt('Link deleted.', 'تم حذف الرابط.'))}>{tt('Delete', 'حذف')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setDel(null)}>{tt('Cancel', 'إلغاء')}</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-ghost mp-sl__danger" disabled={busy} onClick={() => setDel(l.id)}><Icon name="trash" size={14} /><span>{tt('Delete', 'حذف')}</span></button>
                )}
              </div>
              {open === l.id && live && <Settings l={l} ar={ar} tt={tt} busy={busy} act={act} />}
            </article>
          );
        })}
      </div>
      {toastEl}
    </div>
  );
}

/** Dialog wrapper (opened from My PC's sidebar / the Share dialog). The same panel also lives in Settings → Shared links. */
export default function MySharedLinks({ ar, locale, onClose, onToast }) {
  const tt = (en, a) => (ar ? a : en);
  return (
    <StModal wide title={tt('My shared links', 'روابطي المشاركة')} onClose={onClose} actions={<button type="button" className="btn btn-primary" onClick={onClose}>{tt('Done', 'تم')}</button>}>
      <SharedLinksPanel ar={ar} locale={locale} onToast={onToast} />
    </StModal>
  );
}
