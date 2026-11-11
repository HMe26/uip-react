import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { parseServerDate } from '../utils/serverDate';
import { desktopApi, lockError } from './desktopApi';
import { OPT, minLabel } from './security';
import { ago } from './CloudSettings';

const Section = ({ title, hint, children }) => (
  <section className="os-set__sec"><h3>{title}</h3>{hint && <p className="os-set__hint os-set__hint--top">{hint}</p>}{children}</section>
);

/** iOS-style switch row. */
function Row({ label, hint, children }) {
  return (
    <div className="os-sec-row">
      <div className="os-sec-row__txt"><b>{label}</b>{hint && <span>{hint}</span>}</div>
      <div className="os-sec-row__ctl">{children}</div>
    </div>
  );
}
function Switch({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`os-sw${on ? ' is-on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}
function Select({ value, onChange, options, label }) {
  return (
    <select className="os-select" value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const KIND_ICON = { mobile: 'smartphone', tablet: 'smartphone', desktop: 'monitor' };
const when = (s, tt) => { const d = s ? parseServerDate(s) : null; return d && !Number.isNaN(d.getTime()) ? ago(d.getTime(), tt) : '—'; };
const stamp = (s, ar) => { const d = s ? parseServerDate(s) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(ar ? 'ar-EG' : undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'; };

/**
 * Settings ▸ Security & devices. Everything saves the moment it changes.
 *  Devices      who is signed in right now · lock or sign out any of them remotely
 *  Limits       how many devices at once, and what happens at the limit  (enforced by the server)
 *  Screen       auto-lock · sleep · lock when leaving the tab · password after sleep · lock on a new device
 *  Account      sign out after inactivity (enforced by the server + the app) · new-device alert · privacy on the lock screen
 */
export default function SecuritySettings({ tt, ar, sec, onSec, lockEnabled, onLockNow, onSleepNow, onSelfLogout, onOpenLockTab }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [histOpen, setHistOpen] = useState(null); // id of the expanded “recent sign-ins” row
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState('');
  const confirmTimer = useRef(null);
  const noteTimer = useRef(null);

  const flash = (msg) => { setNote(msg); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(''), 3500); };
  const load = useCallback(async () => {
    try { const r = await desktopApi.security(); setData(r); setLoadErr(''); if (r?.settings) onSec(r.settings); } catch (e) { setLoadErr(lockError(e)); }
  }, [onSec]);
  useEffect(() => {
    load();
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => { clearInterval(h); clearTimeout(confirmTimer.current); clearTimeout(noteTimer.current); };
  }, [load]);

  const save = async (patch) => {
    onSec(patch); // instant
    setErr('');
    try {
      const r = await desktopApi.saveSecurity(patch);
      if (r?.settings) onSec(r.settings);
      setData((d) => ({ ...(d || {}), ...r }));
      if (r?.evicted > 0) flash(tt(`${r.evicted} older session(s) were signed out to fit the new limit.`, `اتسجّل خروج من ${r.evicted} جلسة أقدم عشان الحد الجديد.`));
      else flash(tt('Saved', 'اتحفظ'));
    } catch (e) { setErr(lockError(e)); load(); }
  };

  const act = async (id, fn, okMsg) => {
    setBusy(id); setErr(''); setConfirm('');
    try { const r = await fn(); flash(okMsg(r)); await load(); return r; } catch (e) { setErr(lockError(e)); } finally { setBusy(''); }
    return null;
  };
  const ask = (id) => { setConfirm(id); clearTimeout(confirmTimer.current); confirmTimer.current = setTimeout(() => setConfirm(''), 4000); };

  const signOutDevice = async (d) => {
    const r = await act(`out:${d.id}`, () => desktopApi.logoutDevice(d.id), () => tt('Device signed out.', 'تم تسجيل خروج الجهاز.'));
    if (r?.self) onSelfLogout();
  };

  const limits = data?.limits || {};
  const devices = data?.devices || [];
  const cap = limits.platformDeviceLimit > 0 ? limits.platformDeviceLimit : 0;
  const maxOpts = OPT.maxDevices.filter((n) => n === 0 || !cap || n <= cap).map((n) => [n, n === 0 ? (cap ? tt(`Platform limit (${cap})`, `حد المنصة (${cap})`) : tt('No limit', 'بدون حد')) : String(n)]);
  if (cap && !maxOpts.some(([n]) => n === cap) && cap <= 20 && sec.maxDevices === cap) maxOpts.push([cap, String(cap)]);
  if (sec.maxDevices > 0 && !maxOpts.some(([n]) => n === sec.maxDevices)) maxOpts.push([sec.maxDevices, String(sec.maxDevices)]);
  maxOpts.sort((a, b) => (a[0] === 0 ? -1 : b[0] === 0 ? 1 : a[0] - b[0]));
  const mins = (list, never) => list.map((m) => [m, m === 0 ? never : minLabel(m, tt)]);
  const nobody = lockEnabled !== true;
  const REASON = {
    revoked_by_user: tt('Signed out', 'تسجيل خروج'), revoked_by_security: tt('Ended by security', 'أنهاها فريق الأمان'),
    device_limit: tt('Replaced (device limit)', 'اتشال (حد الأجهزة)'), concurrent_limit: tt('Replaced (session limit)', 'اتشال (حد الجلسات)'),
    same_device_relogin: tt('Signed in again', 'دخول تاني'), idle_timeout: tt('Inactivity', 'خمول'), logout: tt('Signed out', 'تسجيل خروج'),
  };

  return (
    <>
      {(note || err) && <div className={`os-sec-flash${err ? ' is-err' : ''}`} role={err ? 'alert' : 'status'}>{err || note}</div>}
      {loadErr && !data && <p className="os-set__err">{loadErr}</p>}

      <Section title={tt('Signed-in devices', 'الأجهزة المسجّل عليها')}
        hint={tt('Every browser or phone your account is open on right now. Lock or sign out any of them from here — it takes effect within seconds.', 'كل متصفح أو موبايل حسابك مفتوح عليه دلوقتي. تقدر تقفل أو تسجّل خروج أي جهاز من هنا — بيتنفّذ في ثواني.')}>
        {!data && !loadErr && <p className="os-set__hint">…</p>}
        <div className="os-dev-list">
          {devices.map((d) => {
            const key = String(d.id);
            return (
              <div key={key} className={`os-dev${d.is_current ? ' is-me' : ''}`}>
                <span className="os-dev__ic"><Icon name={KIND_ICON[d.kind] || 'monitor'} size={20} /><i className={`os-dev__dot${d.online ? ' is-on' : ''}`} title={d.online ? tt('Active now', 'نشط دلوقتي') : tt('Idle', 'خامل')} /></span>
                <div className="os-dev__txt">
                  <b dir="auto">{d.device_label || tt('Unknown device', 'جهاز غير معروف')}{d.is_current && <em>{tt('This device', 'الجهاز ده')}</em>}</b>
                  <span dir="auto">{[d.location_label, d.ip_address].filter(Boolean).join(' · ') || '—'}</span>
                  <span>{d.is_current || d.online ? tt('Active now', 'نشط دلوقتي') : tt(`Last active ${when(d.last_activity_at, tt)}`, `آخر نشاط ${when(d.last_activity_at, tt)}`)} · {tt('Signed in', 'دخل')} {stamp(d.signed_in_at, ar)}</span>
                </div>
                <div className="os-dev__btns">
                  {d.is_current
                    ? <button type="button" className="os-btn" onClick={onLockNow}>{tt('Lock', 'قفل')}</button>
                    : <button type="button" className="os-btn" disabled={!!busy} onClick={() => act(`lock:${key}`, () => desktopApi.lockDevice(d.id), () => tt('Lock command sent.', 'اتبعت أمر القفل.'))}>{busy === `lock:${key}` ? '…' : tt('Lock', 'قفل')}</button>}
                  {confirm === `out:${key}`
                    ? <button type="button" className="os-btn os-btn--danger" disabled={!!busy} onClick={() => signOutDevice(d)}>{tt('Confirm', 'تأكيد')}</button>
                    : <button type="button" className="os-btn" disabled={!!busy} onClick={() => ask(`out:${key}`)}>{busy === `out:${key}` ? '…' : tt('Sign out', 'خروج')}</button>}
                </div>
              </div>
            );
          })}
          {data && devices.length === 0 && <p className="os-set__hint">{tt('No other sessions found.', 'مفيش جلسات تانية.')}</p>}
        </div>
        {devices.length > 1 && (
          <div className="os-set__btns">
            <button type="button" className="os-btn" disabled={!!busy} onClick={() => act('lockall', () => desktopApi.lockOthers(), (r) => tt(`Lock sent to ${r?.locked ?? 0} device(s).`, `اتبعت القفل لـ ${r?.locked ?? 0} جهاز.`))}>{tt('Lock all other devices', 'قفل كل الأجهزة التانية')}</button>
            {confirm === 'outall'
              ? <button type="button" className="os-btn os-btn--danger" disabled={!!busy} onClick={() => act('outall', () => desktopApi.logoutOthers(), (r) => tt(`${r?.ended ?? 0} session(s) signed out.`, `اتسجّل خروج من ${r?.ended ?? 0} جلسة.`))}>{tt('Confirm: sign out all others', 'تأكيد: خروج من كل الباقي')}</button>
              : <button type="button" className="os-btn os-btn--danger" disabled={!!busy} onClick={() => ask('outall')}>{tt('Sign out all other devices', 'خروج من كل الأجهزة التانية')}</button>}
          </div>
        )}
      </Section>

      <Section title={tt('Device limit', 'حد الأجهزة')}
        hint={tt('How many devices can be signed in to your account at the same time.', 'كام جهاز يقدر يكون مسجّل دخول على حسابك في نفس الوقت.')}>
        <Row label={tt('Maximum devices', 'أقصى عدد أجهزة')} hint={cap ? tt(`The platform allows up to ${cap} for your role. You can choose less, not more.`, `المنصة بتسمح بحد أقصى ${cap} لدورك. تقدر تختار أقل، مش أكتر.`) : tt('The platform sets no limit for your role.', 'المنصة مش حاطة حد لدورك.')}>
          <Select value={sec.maxDevices} onChange={(v) => save({ maxDevices: v })} options={maxOpts} label={tt('Maximum devices', 'أقصى عدد أجهزة')} />
        </Row>
        <Row label={tt('When the limit is reached', 'لما الحد يتوصّل')} hint={limits.platformMode === 'block' ? tt('The platform is set to block new sign-ins at the limit.', 'المنصة مظبوطة تمنع الدخول الجديد عند الحد.') : tt('Choose what happens to a new sign-in.', 'اختار إيه يحصل لما حد يحاول يدخل.')}>
          <div className="os-seg os-seg--sm">
            {[['replace_oldest', tt('Sign out the oldest', 'اطرد أقدم جهاز')], ['block', tt('Block the new one', 'امنع الجديد')]].map(([k, l]) => (
              <button key={k} type="button" className={(limits.platformMode === 'block' ? 'block' : sec.deviceOverflow) === k ? 'is-on' : ''} disabled={limits.platformMode === 'block' || sec.maxDevices === 0} onClick={() => save({ deviceOverflow: k })}>{l}</button>
            ))}
          </div>
        </Row>
        <Row label={tt('Alert me about a new device', 'نبّهني لما جهاز جديد يدخل')} hint={tt('You get a notification when your account is opened on a device you have not used before.', 'بيجيلك إشعار لما حسابك يتفتح على جهاز عمره ما دخل منه.')}>
          <Switch on={sec.alertNewDevice} onChange={(v) => save({ alertNewDevice: v })} label={tt('Alert me about a new device', 'نبّهني لما جهاز جديد يدخل')} />
        </Row>
      </Section>

      <Section title={tt('Lock & sleep', 'القفل والسكون')}>
        {nobody && (
          <p className="os-sec-tip">
            <Icon name="lock" size={14} />
            {tt('Without a lock password, the lock screen opens with a click. ', 'من غير باسورد قفل، شاشة القفل بتتفتح بضغطة. ')}
            <button type="button" onClick={onOpenLockTab}>{tt('Set a lock password', 'فعّل باسورد القفل')}</button>
          </p>
        )}
        <Row label={tt('Lock automatically after', 'اقفل الشاشة تلقائيًا بعد')} hint={tt('No mouse, keyboard or touch for this long.', 'لو مفيش ماوس أو كيبورد أو لمس طول المدة دي.')}>
          <Select value={sec.autoLockMinutes} onChange={(v) => save({ autoLockMinutes: v })} options={mins(OPT.autoLock, tt('Never', 'أبدًا'))} label={tt('Lock automatically after', 'اقفل الشاشة تلقائيًا بعد')} />
        </Row>
        <Row label={tt('Go to sleep after', 'وضع السكون بعد')} hint={tt('The screen goes dark. Any key or click wakes it.', 'الشاشة بتعتّم. أي زر أو ضغطة بترجّعها.')}>
          <Select value={sec.sleepMinutes} onChange={(v) => save({ sleepMinutes: v })} options={mins(OPT.sleep, tt('Never', 'أبدًا'))} label={tt('Go to sleep after', 'وضع السكون بعد')} />
        </Row>
        <Row label={tt('Ask for the password after sleep', 'اطلب الباسورد بعد السكون')} hint={tt('Waking up shows the lock screen.', 'لما الجهاز يصحى بتظهر شاشة القفل.')}>
          <Switch on={sec.lockAfterSleep} onChange={(v) => save({ lockAfterSleep: v })} label={tt('Ask for the password after sleep', 'اطلب الباسورد بعد السكون')} />
        </Row>
        <Row label={tt('Dim instead of a black screen', 'تعتيم بدل الشاشة السودا')} hint={tt('Sleep keeps a faint clock on screen.', 'السكون بيسيب ساعة خافتة على الشاشة.')}>
          <Switch on={sec.sleepDimOnly} onChange={(v) => save({ sleepDimOnly: v })} label={tt('Dim instead of a black screen', 'تعتيم بدل الشاشة السودا')} />
        </Row>
        <Row label={tt('Lock when I leave this tab', 'اقفل لما أسيب التبويب ده')} hint={tt('Switching to another tab or minimizing the browser.', 'لما تروح لتبويب تاني أو تصغّر المتصفح.')}>
          <Select value={sec.lockOnHide} onChange={(v) => save({ lockOnHide: v })}
            options={OPT.lockOnHide.map((m) => [m, m === -1 ? tt('Off', 'إيقاف') : m === 0 ? tt('Immediately', 'فورًا') : tt(`After ${minLabel(m, tt)}`, `بعد ${minLabel(m, tt)}`)])} label={tt('Lock when I leave this tab', 'اقفل لما أسيب التبويب ده')} />
        </Row>
        <Row label={tt('Start locked on a new device or tab', 'ابدأ مقفول على جهاز أو تبويب جديد')} hint={tt('Needs a lock password.', 'محتاج باسورد قفل.')}>
          <Switch on={sec.lockOnStart} onChange={(v) => save({ lockOnStart: v })} label={tt('Start locked on a new device or tab', 'ابدأ مقفول على جهاز أو تبويب جديد')} />
        </Row>
        <Row label={tt('Hide my name on the lock screen', 'إخفاء اسمي في شاشة القفل')} hint={tt('Privacy in shared places.', 'خصوصية في الأماكن العامة.')}>
          <Switch on={sec.hideLockDetails} onChange={(v) => save({ hideLockDetails: v })} label={tt('Hide my name on the lock screen', 'إخفاء اسمي في شاشة القفل')} />
        </Row>
        <div className="os-set__btns">
          <button type="button" className="os-btn" onClick={onLockNow}><Icon name="lock" size={14} /> {tt('Lock now', 'اقفل دلوقتي')}</button>
          <button type="button" className="os-btn" onClick={onSleepNow}><Icon name="moon" size={14} /> {tt('Sleep now', 'سكون دلوقتي')}</button>
        </div>
      </Section>

      <Section title={tt('Automatic sign-out', 'الخروج التلقائي')}
        hint={tt('Ends your session on every device when there has been no activity for this long. You get a warning a minute before.', 'بينهي جلستك لما تعدّي المدة دي من غير أي نشاط. بيظهرلك تحذير قبلها بدقيقة.')}>
        <Row label={tt('Sign me out after', 'سجّلني خروج بعد')} hint={limits.platformIdleMinutes > 0 ? tt(`The platform already signs everyone out after ${minLabel(limits.platformIdleMinutes, tt)}; a shorter time here wins.`, `المنصة بتسجّل الخروج بعد ${minLabel(limits.platformIdleMinutes, tt)}؛ الوقت الأقصر هو اللي بيتنفّذ.`) : limits.persistentLogin ? tt('The platform keeps you signed in; this makes it stricter for your account.', 'المنصة بتفضّلك مسجّل دخول؛ ده بيشدّدها على حسابك.') : undefined}>
          <Select value={sec.autoLogoutMinutes} onChange={(v) => save({ autoLogoutMinutes: v })} options={mins(OPT.autoLogout, tt('Never', 'أبدًا'))} label={tt('Sign me out after', 'سجّلني خروج بعد')} />
        </Row>
      </Section>

      <Section title={tt('Recent sign-ins', 'آخر عمليات الدخول')}>
        <div className="os-hist">
          {(data?.history || []).map((h) => {
            const open = histOpen === h.id;
            const state = h.active ? tt('Active', 'نشط') : (REASON[h.end_reason] || tt('Ended', 'انتهت'));
            const kind = h.kind === 'mobile' ? tt('Phone', 'موبايل') : h.kind === 'tablet' ? tt('Tablet', 'تابلت') : tt('Computer', 'كمبيوتر');
            const rows = [
              [tt('Device', 'الجهاز'), h.device_label || tt('Unknown device', 'جهاز غير معروف')],
              [tt('Type', 'النوع'), kind],
              [tt('Location', 'الموقع'), h.location_label || '—'],
              [tt('IP address', 'عنوان IP'), h.ip_address || '—'],
              [tt('Signed in', 'وقت الدخول'), stamp(h.signed_in_at, ar)],
              [tt('Last activity', 'آخر نشاط'), h.last_activity_at ? stamp(h.last_activity_at, ar) : '—'],
              [tt('Status', 'الحالة'), h.active ? state : `${state}${h.ended_at ? ` · ${stamp(h.ended_at, ar)}` : ''}`],
            ];
            return (
              <div key={h.id} className={`os-hist__item${open ? ' is-open' : ''}`}>
                <button type="button" className="os-hist__row" aria-expanded={open} onClick={() => setHistOpen(open ? null : h.id)}>
                  <Icon name={KIND_ICON[h.kind] || 'monitor'} size={15} />
                  <span dir="auto"><b>{h.device_label || tt('Unknown device', 'جهاز غير معروف')}</b>{h.location_label ? ` · ${h.location_label}` : ''}</span>
                  <small><em>{state}</em><i>{stamp(h.signed_in_at, ar)}</i></small>
                  <Icon name="chevron-down" size={14} className="os-hist__chev" />
                </button>
                {open && (
                  <dl className="os-hist__detail" dir={ar ? 'rtl' : 'ltr'}>
                    {rows.map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></Fragment>))}
                    {h.user_agent && (<><dt>{tt('Browser', 'المتصفح')}</dt><dd className="is-ua" dir="ltr">{h.user_agent}</dd></>)}
                  </dl>
                )}
              </div>
            );
          })}
          {data && !(data.history || []).length && <p className="os-set__hint">—</p>}
        </div>
        <p className="os-set__hint">{tt('Wrong lock-password attempts are limited: 5 mistakes block further tries for 10 minutes.', 'محاولات باسورد القفل الغلط محدودة: 5 غلطات بتمنع المحاولة 10 دقايق.')}</p>
      </Section>
    </>
  );
}
