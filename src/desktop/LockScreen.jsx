import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import BrandWordmark from '../components/BrandWordmark';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { desktopApi, lockError } from './desktopApi';
import { Clock } from './shell';
import './lock.css';

/**
 * Lock screen. No lock password set -> click / any key unlocks (as before).
 * Lock password set (Settings > Lock screen) -> the password is checked on the server; "Forgot password?" sends a
 * 6-digit code to the account's e-mail and lets the student choose a new password with it.
 */
export function LockScreen({ ar, tt, user, lockEnabled, onUnlock: onUnlockRaw, onLockEnabled, onPortal, hideDetails }) {
  const name = hideDetails ? tt('Locked', 'مقفول') : (user?.full_name || user?.email || '');
  const needPw = lockEnabled !== false; // unknown (offline, first load) is treated as locked: the server answers "no password" if there is none
  // "No password" is only what this browser remembers: ask the server before unlocking without one (a password may have been set elsewhere).
  const unlocking = useRef(false);
  const onUnlock = useCallback(async () => {
    if (lockEnabled !== false) { onUnlockRaw(); return; } // password flow: LockScreen's own form already verified it
    if (unlocking.current) return;
    unlocking.current = true;
    try {
      const r = await desktopApi.lockVerify('');
      if (r?.lockEnabled === false) onUnlockRaw(); else onLockEnabled?.(true);
    } catch (x) {
      // Fail closed: only a genuinely offline browser may open without asking the server. A failed / aborted / throttled
      // request (a hard refresh, many reloads, a 429 or 5xx) must NEVER unlock the screen.
      if (typeof navigator !== 'undefined' && navigator.onLine === false && lockEnabled === false) onUnlockRaw?.();
      else if (x?.status === 0 || x?.status >= 500 || !x?.status || x?.status === 429) { /* stay locked; the next click retries */ }
      else onLockEnabled?.(true); // the server has a password: show the password form
    } finally { unlocking.current = false; }
  }, [lockEnabled, onUnlockRaw, onLockEnabled]);
  const [view, setView] = useState('pw'); // 'pw' | 'reset'
  const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [np, setNp] = useState(''); const [np2, setNp2] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('');
  const [wait, setWait] = useState(0);
  const [show, setShow] = useState(false); const [caps, setCaps] = useState(false); const [shake, setShake] = useState(0);
  const first = useRef(null);
  const [leaving, setLeaving] = useState(false); // “exit to portal?” confirmation
  const { toggleLocale } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const night = theme === 'dark';
  useEffect(() => {
    if (needPw || leaving) return undefined; // while the exit confirmation is open, Enter / Esc belong to it (not “any key unlocks”)
    const k = (e) => { e.preventDefault(); onUnlock(); };
    const t = setTimeout(() => window.addEventListener('keydown', k, true), 150);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k, true); };
  }, [onUnlock, needPw, leaving]);
  useEffect(() => { if (needPw) first.current?.focus(); }, [needPw, view]);
  useEffect(() => { if (wait <= 0) return undefined; const h = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(h); }, [wait]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !pw) return;
    setBusy(true); setErr('');
    try { await desktopApi.lockVerify(pw); onUnlock(); } catch (x) { setErr(lockError(x)); setPw(''); setShake((n) => n + 1); first.current?.focus(); } finally { setBusy(false); }
  };
  const sendCode = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await desktopApi.lockOtp();
      setInfo(tt(`We sent a 6-digit code to ${r?.email || 'your e-mail'}.`, `بعتنا رمز من 6 أرقام على ${r?.email || 'إيميلك'}.`));
      setWait(Number(r?.retry_after) || 60); setView('reset');
    } catch (x) { setErr(lockError(x)); } finally { setBusy(false); }
  };
  const reset = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (np.length < 4) { setErr(tt('The password must be at least 4 characters.', 'الباسورد لازم يكون 4 حروف/أرقام على الأقل.')); return; }
    if (np !== np2) { setErr(tt('The two passwords do not match.', 'الباسوردين مش متطابقين.')); return; }
    setBusy(true); setErr('');
    try { await desktopApi.lockReset(code.trim(), np); onUnlock(); } catch (x) { setErr(lockError(x)); } finally { setBusy(false); }
  };

  const sub = !hideDetails && user?.email && user.email !== name ? user.email : '';
  const dir = ar ? 'rtl' : 'ltr';
  const capsKey = (e) => setCaps(!!e.getModifierState?.('CapsLock'));
  const initial = hideDetails ? null : String(name || '?').trim().charAt(0).toUpperCase();
  const features = [
    { icon: 'briefcase', t: tt('Project management', 'إدارة المشاريع'), s: tt('Track • Evaluate • Collaborate', 'متابعة • تقييم • تعاون') },
    { icon: 'file', t: tt('Online exams', 'الامتحانات الإلكترونية'), s: tt('Secure • Smart • Accurate', 'بأمان • ذكاء • دقة') },
    { icon: 'ai-spark', t: tt('AI assistant', 'الذكاء الاصطناعي'), s: tt('Helping you at every step', 'مساعدك في كل خطوة') },
    { icon: 'shield', t: tt('Safe & trusted', 'بيئة آمنة وموثوقة'), s: tt('Your data and privacy, protected', 'لحماية بياناتك وخصوصيتك') },
  ];
  const identity = (
    <div className="lk-id">
      <i className="lk-avatar" aria-hidden="true">{initial || <Icon name="lock" size={22} />}</i>
      <b dir="auto">{name}</b>
      {sub && <small dir="ltr">{sub}</small>}
    </div>
  );
  const shell = (card, extra = {}) => (
    <div className="lk" dir={dir} data-night={night ? '1' : '0'} {...extra}>
      <div className="lk-bg" aria-hidden="true">
        <i className="lk-bg__a" /><i className="lk-bg__b" /><i className="lk-bg__c" />
        <i className="lk-bg__photo" />
        <svg className="lk-bg__wave" viewBox="0 0 1200 260" preserveAspectRatio="none"><defs><linearGradient id="lkw" x1="0" x2="1"><stop offset="0" stopColor="#2563eb" stopOpacity=".05" /><stop offset=".55" stopColor="#3b82f6" stopOpacity=".55" /><stop offset="1" stopColor="#7c3aed" stopOpacity="0" /></linearGradient></defs><path d="M0 150C220 70 430 60 640 120S1020 210 1200 150V260H0Z" fill="url(#lkw)" /><path d="M0 150C220 70 430 60 640 120S1020 210 1200 150" fill="none" stroke="#93c5fd" strokeOpacity=".55" strokeWidth="2" /></svg>
      </div>
      <div className="lk-scroll">
        <header className="lk-top">
          <div className="lk-brand">
            <BrandWordmark onDark className="lk-brand__mark" width={112} height={44} />
            <span className="lk-brand__txt"><small>Unified Integrated Platform Ecosystem</small></span>
          </div>
          <div className="lk-clock" dir={dir}><Clock ar={ar} big /></div>
          <div className="lk-tools" dir="ltr">
            <button type="button" className="lk-seg" onClick={toggleTheme} aria-label={night ? tt('Light mode', 'الوضع النهاري') : tt('Dark mode', 'الوضع الليلي')} title={night ? tt('Light mode', 'الوضع النهاري') : tt('Dark mode', 'الوضع الليلي')}>
              <span className={night ? '' : 'is-on'}><Icon name="sun" size={15} /></span><span className={night ? 'is-on' : ''}><Icon name="moon" size={15} /></span>
            </button>
            <button type="button" className="lk-seg lk-seg--lang" onClick={toggleLocale} aria-label={tt('Switch language', 'تغيير اللغة')} title={tt('العربية', 'English')}><Icon name="globe" size={17} /></button>
          </div>
        </header>
        <div className="lk-main">
          <aside className="lk-hero" dir={dir}>
            <h2>{tt('From an idea', 'من فكرة')} .. {tt('to', 'إلى')} <em>{tt('achievement', 'إنجاز')}</em></h2>
            <p>{tt('A smart platform for university projects and online exams, in one place.', 'منصة ذكية تجمع بين إدارة المشاريع الجامعية والامتحانات الإلكترونية، في مكان واحد.')}</p>
            <ul>{features.map((f) => (
              <li key={f.icon}><span><Icon name={f.icon} size={20} /></span><div><b>{f.t}</b><small>{f.s}</small></div></li>
            ))}</ul>
          </aside>
          <main className="lk-card" dir={dir}>{card}</main>
          <span className="lk-sign" aria-hidden="true">Build Your Future</span>
        </div>
        <footer className="lk-foot">
          <span className="lk-pill"><Icon name="lock" size={14} />{tt('Locked', 'مقفول')}</span>
          <button type="button" className="lk-pill lk-pill--btn" onClick={toggleTheme}><Icon name={night ? 'sun' : 'moon'} size={14} />{night ? tt('Light mode', 'الوضع النهاري') : tt('Dark mode', 'الوضع الليلي')}</button>
          {onPortal && <button type="button" className="lk-pill lk-pill--btn" onClick={() => setLeaving(true)}>{tt('Back to portal', 'العودة للبوابة')}</button>}
        </footer>
      </div>
      {leaving && (
        <div className="os-scrim os-scrim--top" style={{ inset: 0 }} onPointerDown={() => setLeaving(false)}>
          <div className="os-dlg os-dlg--confirm" role="alertdialog" aria-modal="true" aria-label={tt('Exit to the UIPE portal?', 'الخروج إلى بوابة UIPE؟')} dir={dir}
            onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setLeaving(false); }}>
            <span className="os-dlg__ico" aria-hidden="true"><Icon name="logout" size={26} /></span>
            <h3>{tt('Exit to the UIPE portal?', 'الخروج إلى بوابة UIPE؟')}</h3>
            <p>{tt('You will leave the desktop and go back to the portal. Your files stay saved.', 'هتخرج من سطح المكتب وترجع للبوابة. ملفاتك فاضلة محفوظة.')}</p>
            <footer>
              <button type="button" className="os-btn" onClick={() => setLeaving(false)}>{tt('Cancel', 'إلغاء')}<kbd>Esc</kbd></button>
              <button type="button" className="os-btn os-btn--primary" autoFocus onClick={onPortal}>{tt('Exit', 'خروج')}<kbd>↵</kbd></button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
  const head = (
    <>
      <h1 className="lk-title">{tt('Welcome back', 'مرحباً بك مجدداً')}</h1>
      <p className="lk-sub">{tt('Enter your password to continue', 'اكتب كلمة المرور للمتابعة')}</p>
      {identity}
    </>
  );
  if (!needPw) {
    return shell(
      <>
        <h1 className="lk-title">{tt('Welcome back', 'مرحباً بك مجدداً')}</h1>
        {identity}
        <button type="button" className="lk-go" onClick={onUnlock} autoFocus>{tt('Unlock', 'فتح القفل')}<Icon name={ar ? 'arrow-left' : 'arrow-right'} size={18} /></button>
        <p className="lk-hint">{tt('Or press any key', 'أو اضغط أي زر')}</p>
      </>,
      { role: 'dialog', 'aria-modal': true, 'aria-label': tt('Locked', 'مقفول') },
    );
  }
  return shell(
    view === 'pw' ? (
      <>
        {head}
        <form className="lk-form" onSubmit={submit}>
          <div key={shake} className={`lk-row${shake ? ' is-shake' : ''}`}>
            <div className={`lk-field${err ? ' is-err' : ''}`}>
              <Icon name="lock" size={17} />
              <input ref={first} type={show ? 'text' : 'password'} value={pw} onChange={(e) => { setPw(e.target.value); if (err) setErr(''); }} onKeyDown={capsKey} onKeyUp={capsKey} onBlur={() => setCaps(false)}
                placeholder={tt('Enter your password', 'اكتب كلمة المرور')} aria-label={tt('Password', 'كلمة المرور')} autoComplete="current-password" maxLength={72} dir="auto" />
              <button type="button" className="lk-eye" onClick={() => setShow((v) => !v)} aria-label={show ? tt('Hide password', 'إخفاء الباسورد') : tt('Show password', 'إظهار الباسورد')} aria-pressed={show} tabIndex={-1}><Icon name={show ? 'eye-off' : 'eye'} size={17} /></button>
            </div>
            <button type="submit" className="lk-round" disabled={busy || !pw} aria-label={tt('Unlock', 'فتح القفل')}>{busy ? <span className="mp-spin" /> : <Icon name={ar ? 'arrow-left' : 'arrow-right'} size={20} />}</button>
          </div>
          {caps && <p className="lk-note is-warn"><Icon name="alert-triangle" size={13} />{tt('Caps Lock is on', 'زر Caps Lock مفعّل')}</p>}
          {err && <p className="lk-note is-err" role="alert">{err}</p>}
          <button type="button" className="lk-link" onClick={sendCode} disabled={busy}>{tt('Forgot password?', 'نسيت كلمة المرور؟')}</button>
          <button type="submit" className="lk-go" disabled={busy || !pw}>{busy ? <span className="mp-spin" /> : <>{tt('Unlock', 'فتح القفل')}<Icon name={ar ? 'arrow-left' : 'arrow-right'} size={18} /></>}</button>
        </form>
      </>
    ) : (
      <>
        <h1 className="lk-title">{tt('Reset your password', 'إعادة تعيين كلمة المرور')}</h1>
        <p className="lk-sub">{info}</p>
        <form className="lk-form" onSubmit={reset}>
          <input className="lk-input" ref={first} type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={tt('6-digit code', 'الرمز (6 أرقام)')} aria-label={tt('6-digit code', 'الرمز (6 أرقام)')} maxLength={6} dir="ltr" />
          <input className="lk-input" type="password" value={np} onChange={(e) => setNp(e.target.value)} placeholder={tt('New password', 'كلمة مرور جديدة')} autoComplete="new-password" maxLength={72} aria-label={tt('New password', 'كلمة مرور جديدة')} dir="auto" />
          <input className="lk-input" type="password" value={np2} onChange={(e) => setNp2(e.target.value)} placeholder={tt('Repeat new password', 'كرر كلمة المرور الجديدة')} autoComplete="new-password" maxLength={72} aria-label={tt('Repeat new password', 'كرر كلمة المرور الجديدة')} dir="auto" />
          {err && <p className="lk-note is-err" role="alert">{err}</p>}
          <button type="submit" className="lk-go" disabled={busy || code.length < 6 || !np}>{busy ? <span className="mp-spin" /> : tt('Reset password & unlock', 'غيّر كلمة المرور وافتح')}</button>
          <div className="lk-links">
            <button type="button" className="lk-link" onClick={sendCode} disabled={busy || wait > 0}>{wait > 0 ? tt(`Resend code (${wait}s)`, `إعادة إرسال الرمز (${wait}ث)`) : tt('Resend code', 'إعادة إرسال الرمز')}</button>
            <button type="button" className="lk-link" onClick={() => { setView('pw'); setErr(''); setCode(''); setNp(''); setNp2(''); }}>{tt('Back', 'رجوع')}</button>
          </div>
        </form>
      </>
    ),
    { role: 'dialog', 'aria-modal': true, 'aria-label': tt('Locked', 'مقفول') },
  );
}

/** Sleep mode: black screen with a dim clock. Any mouse move / click / key / touch wakes it (see useDesktopSecurity in ./security.js). */
export function SleepScreen({ ar, tt, dim, onWake }) {
  useEffect(() => {
    let armed = false;
    const t = setTimeout(() => { armed = true; }, 400); // ignore the input that put it to sleep
    const wake = () => { if (armed) onWake(); };
    const ev = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'];
    ev.forEach((e) => window.addEventListener(e, wake, true));
    return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, wake, true)); };
  }, [onWake]);
  return (
    <div className={`os-sleep${dim ? ' is-dim' : ''}`} role="dialog" aria-modal="true" aria-label={tt('Sleeping', 'السكون')}>
      <div className="os-sleep__clock"><Clock ar={ar} big /></div>
      <p className="os-sleep__hint"><Icon name="moon" size={13} />{tt('Move the mouse or press any key to wake', 'حرّك الماوس أو اضغط أي زر عشان تصحّي الجهاز')}</p>
    </div>
  );
}

export default LockScreen;
