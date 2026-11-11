import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { ACCENTS, DEFAULT_PREFS, DESK_ICONS, DOCK_ICONS, hiddenList } from './prefs';
import { WALLPAPERS, imageToWallpaper } from './wallpapers';
import { EXPLORER_SHORTCUTS, GROUPS, SHORTCUTS, fmtKeys } from './shortcuts';
import { AppGlyph } from './OsIcons';
import { desktopApi, lockError } from './desktopApi';
import { CloudPanel } from './CloudSettings';
import SecuritySettings from './SecuritySettings';
import { SharedLinksPanel } from '../components/MySharedLinks';
import { wipeLocalData } from '../lib/wipeLocalData';
import { fetchBackupAll } from '../lib/driveApi';
import { saveBlob } from '../lib/exporter';
import { VM_APPS, isVmApp, isVmDeskKey } from '../virtual/catalog';
import ModeCard from '../virtual/ModeCard';
import MobilePrefs from './MobilePrefs';
import { useIsMobileOS } from './useIsMobileOS';
import { useVirtualMode } from '../virtual/virtualMode';

const StudentMyPC = lazy(() => import('../pages/student/StudentMyPC'));

/** App registry. `pin` = pinned in the Dock (Alt+1…9 follow this order). */
export const APPS = {
  explorer: { en: 'This PC', ar: 'جهازي', size: { w: 1060, h: 650 }, singleton: true, pin: true },
  settings: { en: 'Settings', ar: 'الإعدادات', size: { w: 880, h: 590 }, singleton: true, pin: true },
  taskmgr: { en: 'Task Manager', ar: 'مدير المهام', size: { w: 680, h: 480 }, singleton: true, pin: false },
  shortcuts: { en: 'Keyboard shortcuts', ar: 'اختصارات الكيبورد', size: { w: 760, h: 600 }, singleton: true, pin: true },
  notes: { en: 'Notes', ar: 'الملاحظات', size: { w: 820, h: 560 }, singleton: true, pin: true },
  calendar: { en: 'Calendar', ar: 'التقويم', size: { w: 920, h: 600 }, singleton: true, pin: true },
  terminal: { en: 'UIPE Terminal', ar: 'ترمينال UIPE', size: { w: 860, h: 540 }, singleton: true, pin: true },
  calculator: { en: 'Calculator', ar: 'الآلة الحاسبة', size: { w: 430, h: 800 }, singleton: true, pin: true },
  // real VS Code (code-server) and a cloud Chromium, both running in the student's own sandbox container (uip-RUN)
  vscode: { en: 'VS Code', ar: 'VS Code', size: { w: 1180, h: 720 }, singleton: true, pin: true },
  browser: { en: 'Browser', ar: 'المتصفح', size: { w: 1100, h: 700 }, singleton: true, pin: true },
  // one window per file (title = the file name): images / PDFs / media / ZIPs, and the code editor
  viewer: { en: 'Viewer', ar: 'العارض', size: { w: 1000, h: 660 }, singleton: false, pin: false },
  editor: { en: 'Code editor', ar: 'محرر الأكواد', size: { w: 1120, h: 700 }, singleton: false, pin: false },
};
// The platform's own pages as apps of the virtual mode (one window each; see ../virtual). Never pinned here: the Dock adds the ones the mode wants.
VM_APPS.forEach((a) => { APPS[a.id] = { en: a.en, ar: a.ar, size: a.size, singleton: true, pin: false, virtual: true }; });
export const PINNED = Object.keys(APPS).filter((k) => APPS[k].pin);

/** The existing My PC page, embedded: same drive API, same editors, now living inside a window. */
export const ExplorerApp = memo(function ExplorerApp({ onOpenWindow }) {
  return (
    <Suspense fallback={<div className="os-app-msg"><span className="mp-spin" /></div>}>
      <StudentMyPC embedded onOpenWindow={onOpenWindow} />
    </Suspense>
  );
});

const Section = ({ title, children }) => (
  <section className="os-set__sec"><h3>{title}</h3>{children}</section>
);

/** Settings ▸ Personalization ▸ Icons: one switch per built-in icon. Off = removed from the desktop / Dock; on = back. */
function IconToggles({ list, hidden, onToggle, ar }) {
  return (
    <div className="os-ic-list">
      {list.map(([k, en, arb, glyph]) => {
        const on = !hidden.includes(k);
        const name = ar ? arb : en;
        return (
          <label key={k} className={`os-ic-row${on ? '' : ' is-off'}`}>
            <span className="os-ic-row__g"><AppGlyph app={glyph} size={30} /></span>
            <span className="os-ic-row__t" dir="auto">{name}</span>
            <span className="os-ic-row__s">{on ? (ar ? 'ظاهرة' : 'Shown') : (ar ? 'محذوفة' : 'Removed')}</span>
            <input type="checkbox" role="switch" checked={on} onChange={(e) => onToggle(k, e.target.checked)} aria-label={name} />
          </label>
        );
      })}
    </div>
  );
}

/** "in 5 h 20 min" for the undo window. */
export const leftText = (secs, tt) => {
  const m = Math.max(1, Math.ceil(secs / 60));
  const h = Math.floor(m / 60);
  return h > 0 ? tt(`${h} h ${m % 60} min`, `${h} س ${m % 60} د`) : tt(`${m} min`, `${m} د`);
};

/**
 * Settings > System > Reset this PC.
 *  - files go to the Recycle Bin and are deleted for good after 24 h (Undo until then); settings / widgets / lock password are reset
 *  - blocked while an exam is in progress; asks for the account password + typing the PC name; offers a ZIP backup first
 */
const PC_NAME = 'UIPE-PC';
function ResetPc({ tt }) {
  const [st, setSt] = useState(null); // { pending, seconds_left, exam_active }
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(''); const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [bk, setBk] = useState(''); // '' | 'busy' | 'done' | error text
  const ready = word.trim().toLowerCase() === PC_NAME.toLowerCase();
  const load = () => desktopApi.resetStatus().then(setSt).catch(() => setSt((o) => o || {}));
  useEffect(() => { load(); }, []);
  const close = () => { setOpen(false); setPw(''); setWord(''); setErr(''); setBk(''); };
  const backup = async () => {
    setBk('busy');
    try { const blob = await fetchBackupAll(); saveBlob(blob, 'UIPE-PC-backup.zip'); setBk('done'); } catch (x) { setBk(lockError(x) || tt('Could not create the backup.', 'معرفتش أعمل النسخة الاحتياطية.')); }
  };
  const run = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try {
      await desktopApi.resetPc({ confirm: 'RESET', account_password: pw });
      await wipeLocalData({ keepSession: true }); // this device forgets everything too; the person stays signed in
      window.location.reload();
    } catch (x) { setErr(lockError(x)); setBusy(false); load(); }
  };
  const undo = async () => {
    setBusy(true); setErr('');
    try { await desktopApi.resetUndo(); await wipeLocalData({ keepSession: true }); window.location.reload(); } catch (x) { setErr(lockError(x)); setBusy(false); load(); }
  };
  return (
    <Section title={tt('Reset this PC', 'إعادة تهيئة الجهاز')}>
      <p className="os-set__hint os-set__hint--top">{tt('Erase everything and start again like a brand-new PC.', 'امسح كل حاجة وابدأ من جديد زي جهاز جديد.')}</p>
      {st?.pending && (
        <div className="os-reset__undo" role="status">
          <Icon name="clock" size={20} />
          <div>
            <b>{tt('Your PC was reset — you can still undo it.', 'الجهاز اتعمله إعادة تهيئة — لسه تقدر تتراجع.')}</b>
            <span>{tt(`Your files are in the Recycle Bin and are deleted for good in ${leftText(st.seconds_left, tt)}.`, `ملفاتك في سلة المحذوفات وهتتمسح نهائيًا بعد ${leftText(st.seconds_left, tt)}.`)}</span>
          </div>
          <button type="button" className="os-btn os-btn--primary" onClick={undo} disabled={busy}>{busy ? '…' : tt('Undo and restore everything', 'تراجع واسترجاع كل حاجة')}</button>
        </div>
      )}
      {st?.exam_active && (
        <p className="os-set__err" role="alert">{tt('An exam is in progress, so resetting is locked. Submit the exam first.', 'فيه امتحان شغّال، فإعادة التهيئة مقفولة. سلّم الامتحان الأول.')}</p>
      )}
      {!open && <div className="os-set__btns"><button type="button" className="os-btn os-btn--danger" disabled={!!st?.exam_active || busy} onClick={() => setOpen(true)}>{tt('Reset this PC…', 'إعادة تهيئة الجهاز…')}</button></div>}
      {err && !open && <p className="os-set__err" role="alert">{err}</p>}
      {open && (
        <form className="os-set__form os-reset" onSubmit={run}>
          <div className="os-reset__warn" role="alert">
            <Icon name="alert-triangle" size={22} />
            <div>
              <b>{tt('Everything on this PC will be erased.', 'كل حاجة على الجهاز ده هتتمسح.')}</b>
              <ul>
                <li>{tt('ALL your files and folders on My PC move to the Recycle Bin and are deleted permanently after 24 hours. Until then you can undo from this page.', 'كل ملفاتك ومجلداتك في «جهازي» هتروح سلة المحذوفات وتتمسح نهائيًا بعد 24 ساعة. لحد وقتها تقدر تتراجع من الصفحة دي.')}</li>
                <li>{tt('Wallpaper, icons, Dock, widgets and sticky notes go back to the defaults, and the lock-screen password is removed.', 'الخلفية والأيقونات والـ Dock والويدجت والملاحظات اللاصقة هترجع للافتراضي، وباسورد شاشة القفل هيتلغي.')}</li>
                <li>{tt('Your account and sign-in are not affected.', 'حسابك وتسجيل دخولك مش هيتأثروا.')}</li>
              </ul>
              <div className="os-reset__bk">
                <button type="button" className="os-btn" onClick={backup} disabled={bk === 'busy' || busy}><Icon name="download" size={15} />{bk === 'busy' ? tt('Preparing the ZIP…', 'بجهّز الـ ZIP…') : tt('Download a ZIP of all my files first', 'نزّل نسخة ZIP من كل ملفاتي الأول')}</button>
                {bk === 'done' && <small>{tt('Downloaded.', 'اتنزّلت.')}</small>}
                {bk && bk !== 'busy' && bk !== 'done' && <small className="is-err">{bk}</small>}
              </div>
            </div>
          </div>
          <label>
            <span>{tt('Your account password (leave empty if you sign in with Google)', 'باسورد حسابك (سيبه فاضي لو بتدخل بجوجل)')}</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" maxLength={72} disabled={busy} />
          </label>
          <label>
            <span>{tt(`Type ${PC_NAME} to confirm`, `اكتب ${PC_NAME} للتأكيد`)}</span>
            <input value={word} onChange={(e) => setWord(e.target.value)} dir="ltr" autoComplete="off" spellCheck={false} placeholder={PC_NAME} disabled={busy} />
          </label>
          {err && <p className="os-set__err" role="alert">{err}</p>}
          <div className="os-set__btns">
            <button type="submit" className="os-btn os-btn--danger" disabled={!ready || busy}>{busy ? tt('Resetting…', 'جاري إعادة التهيئة…') : tt('Erase everything and reset', 'امسح كل حاجة وأعد التهيئة')}</button>
            <button type="button" className="os-btn" onClick={close} disabled={busy}>{tt('Cancel', 'إلغاء')}</button>
          </div>
        </form>
      )}
    </Section>
  );
}

/** Settings > Lock screen: optional password for the lock screen (stored hashed on the server). */
function LockSettings({ tt, lockEnabled, onLockChanged }) {
  const [mode, setMode] = useState(null); // null | 'set' | 'change' | 'remove'
  const [f, setF] = useState({ cur: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const on = lockEnabled === true;
  const open = (m) => { setMode(m); setF({ cur: '', pw: '', pw2: '' }); setErr(''); setOk(''); };
  const key = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (mode !== 'remove') {
      if (f.pw.length < 4) { setErr(tt('The password must be at least 4 characters.', 'الباسورد لازم يكون 4 حروف/أرقام على الأقل.')); return; }
      if (f.pw !== f.pw2) { setErr(tt('The two passwords do not match.', 'الباسوردين مش متطابقين.')); return; }
    }
    setBusy(true); setErr('');
    try {
      if (mode === 'remove') { await desktopApi.lockDisable(f.cur); onLockChanged?.(false); setOk(tt('Lock password removed.', 'تم إلغاء باسورد القفل.')); }
      else {
        // "current" accepts either the current lock password or the account password
        await desktopApi.lockSet({ password: f.pw, account_password: f.cur, current_password: f.cur });
        onLockChanged?.(true); setOk(mode === 'set' ? tt('Lock password is on.', 'باسورد القفل اتفعّل.') : tt('Lock password changed.', 'تم تغيير باسورد القفل.'));
      }
      setMode(null);
    } catch (x) { setErr(lockError(x)); } finally { setBusy(false); }
  };
  return (
    <Section title={tt('Lock screen password', 'باسورد شاشة القفل')}>
      <p className="os-set__hint" style={{ marginTop: 0 }}>
        {on
          ? tt('The lock screen asks for your password. If you forget it, "Forgot password?" on the lock screen sends a code to your account e-mail.', 'شاشة القفل بتطلب الباسورد. لو نسيته، "نسيت الباسورد؟" في شاشة القفل بتبعت رمز على إيميل حسابك.')
          : tt('Optional. Without a password the lock screen opens with a click. With one, nobody can open your desktop without it — on any device.', 'اختياري. من غير باسورد شاشة القفل بتتفتح بضغطة. ومعاه محدش يقدر يفتح سطح مكتبك من غير الباسورد — على أي جهاز.')}
      </p>
      {ok && <p className="os-set__ok" role="status">{ok}</p>}
      {!mode && (
        <div className="os-set__btns">
          {!on && <button type="button" className="os-btn os-btn--primary" onClick={() => open('set')}>{tt('Set a lock password', 'تفعيل باسورد القفل')}</button>}
          {on && <button type="button" className="os-btn" onClick={() => open('change')}>{tt('Change password', 'تغيير الباسورد')}</button>}
          {on && <button type="button" className="os-btn os-btn--danger" onClick={() => open('remove')}>{tt('Remove password', 'إلغاء الباسورد')}</button>}
        </div>
      )}
      {mode && (
        <form className="os-set__form" onSubmit={submit}>
          <label>
            <span>{mode === 'set' ? tt('Your account password (leave empty if you sign in with Google)', 'باسورد حسابك (سيبه فاضي لو بتدخل بجوجل)') : tt('Current lock password (or your account password)', 'باسورد القفل الحالي (أو باسورد حسابك)')}</span>
            <input type="password" value={f.cur} onChange={key('cur')} autoComplete="current-password" maxLength={72} />
          </label>
          {mode !== 'remove' && (
            <>
              <label><span>{tt('New lock password', 'باسورد القفل الجديد')}</span><input type="password" value={f.pw} onChange={key('pw')} autoComplete="new-password" maxLength={72} /></label>
              <label><span>{tt('Repeat it', 'كرر الباسورد')}</span><input type="password" value={f.pw2} onChange={key('pw2')} autoComplete="new-password" maxLength={72} /></label>
            </>
          )}
          {err && <p className="os-set__err" role="alert">{err}</p>}
          <div className="os-set__btns">
            <button type="submit" className={`os-btn ${mode === 'remove' ? 'os-btn--danger' : 'os-btn--primary'}`} disabled={busy}>{busy ? '…' : mode === 'remove' ? tt('Remove', 'إلغاء الباسورد') : tt('Save', 'حفظ')}</button>
            <button type="button" className="os-btn" onClick={() => setMode(null)} disabled={busy}>{tt('Cancel', 'إلغاء')}</button>
          </div>
        </form>
      )}
    </Section>
  );
}

export function SettingsApp({ tab: tabProp, prefs, setPrefs, ar, tt, theme, toggleTheme, toggleLocale, usage, user, lockEnabled, onLockChanged, sec, onSec, onLockNow, onSleepNow, onSelfLogout }) {
  const [tab, setTab] = useState(tabProp || 'personalize');
  const vm = useVirtualMode();
  const isPhone = useIsMobileOS();
  const showVm = vm.supported && (vm.available || vm.enabled);
  // the platform's icons are only listed (and restorable) while the virtual mode is on
  const deskList = vm.enabled ? DESK_ICONS : DESK_ICONS.filter((d) => !isVmDeskKey(d[0]));
  const dockList = vm.enabled ? DOCK_ICONS : DOCK_ICONS.filter((d) => !isVmApp(d[0]));
  const [err, setErr] = useState('');
  const file = useRef(null);
  useEffect(() => { if (tabProp) setTab(tabProp); }, [tabProp]);

  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { setPrefs({ wallpaper: 'custom', customWallpaper: await imageToWallpaper(f) }); setErr(''); } catch { setErr(tt('Could not read that image.', 'مقدرتش أقرأ الصورة دي.')); }
  };
  const removeCustom = () => {
    // drop the picture (it is also deleted on the server by the sync) and fall back to the default wallpaper if it was the one in use
    setPrefs({ customWallpaper: null, ...(prefs.wallpaper === 'custom' ? { wallpaper: DEFAULT_PREFS.wallpaper } : {}) });
    setErr('');
  };
  const tabs = [
    ['personalize', 'palette', tt('Personalization', 'التخصيص')],
    ...(isPhone ? [['phone', 'smartphone', tt('Phone look', 'مظهر الهاتف')]] : []),
    ['cloud', 'cloud', tt('Storage & backup', 'التخزين والنسخ')],
    ['links', 'link', tt('Shared links', 'الروابط المشاركة')],
    ['security', 'shield', tt('Security & devices', 'الأمان والأجهزة')],
    ['lock', 'lock', tt('Lock password', 'باسورد القفل')],
    ...(showVm ? [['vm', 'grid', tt('UIPE OS (virtual mode)', 'UIPE OS (الوضع الافتراضي)')]] : []),
    ['system', 'monitor', tt('System', 'النظام')],
    ['about', 'info', tt('About', 'حول')],
  ];
  return (
    <div className="os-set">
      <nav className="os-set__nav">
        {tabs.map(([k, ic, l]) => (
          <button key={k} type="button" className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={16} />{l}</button>
        ))}
      </nav>
      <div className="os-set__main">
        {tab === 'vm' && showVm && <Section title={tt('UIPE OS — Virtual mode', 'UIPE OS — الوضع الافتراضي')}><div className="vm-set"><ModeCard inDesktop /></div></Section>}
        {tab === 'personalize' && (
          <>
            <Section title={tt('Desktop background', 'خلفية سطح المكتب')}>
              <div className="os-wp-grid">
                {WALLPAPERS.map((w) => (
                  <button key={w.id} type="button" className={`os-wp${prefs.wallpaper === w.id ? ' is-on' : ''}`} style={{ background: w.css }} onClick={() => setPrefs({ wallpaper: w.id })} title={ar ? w.ar : w.en} aria-label={ar ? w.ar : w.en}>
                    <span>{ar ? w.ar : w.en}</span>
                  </button>
                ))}
                {prefs.customWallpaper && (
                  <div className="os-wp-wrap">
                    <button type="button" className={`os-wp${prefs.wallpaper === 'custom' ? ' is-on' : ''}`} style={{ background: `center / cover url("${prefs.customWallpaper}")` }} onClick={() => setPrefs({ wallpaper: 'custom' })}><span>{tt('My picture', 'صورتي')}</span></button>
                    <button type="button" className="os-wp-del" title={tt('Remove picture', 'حذف الصورة')} aria-label={tt('Remove picture', 'حذف الصورة')} onClick={removeCustom}><Icon name="trash" size={14} /></button>
                  </div>
                )}
                <button type="button" className="os-wp os-wp--add" onClick={() => file.current?.click()}><Icon name="image" size={20} /><span>{tt('Browse photo…', 'اختيار صورة…')}</span></button>
              </div>
              <input ref={file} type="file" accept="image/*" hidden onChange={upload} />
              {err && <p className="os-set__err">{err}</p>}
            </Section>
            <Section title={tt('Accent color', 'لون التمييز')}>
              <div className="os-swatches">
                {ACCENTS.map((c) => <button key={c} type="button" className={prefs.accent === c ? 'is-on' : ''} style={{ background: c }} onClick={() => setPrefs({ accent: c })} aria-label={c} />)}
              </div>
            </Section>
            <Section title={tt('Dock', 'الـ Dock')}>
              <div className="os-seg">
                {[[true, tt('Magnification on', 'تكبير الأيقونات')], [false, tt('Off', 'إيقاف')]].map(([k, l]) => <button key={String(k)} type="button" className={(prefs.dockMag !== false) === k ? 'is-on' : ''} onClick={() => setPrefs({ dockMag: k })}>{l}</button>)}
              </div>
            </Section>
            <Section title={tt('Open files', 'فتح الملفات')}>
              <div className="os-seg">
                {[[true, tt('Full screen', 'ملء الصفحة')], [false, tt('In a window', 'في نافذة')]].map(([k, l]) => <button key={String(k)} type="button" className={(prefs.openMax !== false) === k ? 'is-on' : ''} onClick={() => setPrefs({ openMax: k })}>{l}</button>)}
              </div>
            </Section>
            <Section title={tt('Desktop icons', 'أيقونات سطح المكتب')}>
              <p className="os-set__hint os-set__hint--top">{tt('Remove an icon with right-click ▸ Remove, or the Delete key. Turn it back on here.', 'احذف أي أيقونة بالزر اليمين ▸ حذف، أو بزر Delete. وشغّلها تاني من هنا.')}</p>
              <IconToggles list={deskList} hidden={hiddenList(prefs.hiddenIcons)} ar={ar} onToggle={(k, on) => { const cur = hiddenList(prefs.hiddenIcons); setPrefs({ hiddenIcons: on ? cur.filter((x) => x !== k) : [...new Set([...cur, k])] }); }} />
            </Section>
            <Section title={tt('Dock icons', 'أيقونات الـ Dock')}>
              <IconToggles list={dockList} hidden={hiddenList(prefs.hiddenDock)} ar={ar} onToggle={(k, on) => { const cur = hiddenList(prefs.hiddenDock); setPrefs({ hiddenDock: on ? cur.filter((x) => x !== k) : [...new Set([...cur, k])] }); }} />
              <div className="os-ic-actions">
                <button type="button" className="os-btn" disabled={!hiddenList(prefs.hiddenIcons).length && !hiddenList(prefs.hiddenDock).length} onClick={() => setPrefs({ hiddenIcons: [], hiddenDock: [] })}>{tt('Restore all icons', 'استرجاع كل الأيقونات')}</button>
              </div>
            </Section>
            <Section title={tt('Icon size', 'حجم الأيقونات')}>
              <div className="os-seg">
                {[['s', tt('Small', 'صغير')], ['m', tt('Medium', 'متوسط')], ['l', tt('Large', 'كبير')]].map(([k, l]) => <button key={k} type="button" className={prefs.iconSize === k ? 'is-on' : ''} onClick={() => setPrefs({ iconSize: k })}>{l}</button>)}
              </div>
            </Section>
            <Section title={tt('Accessibility', 'إمكانيات الوصول')}>
              <p className="os-set__hint os-set__hint--top">{tt('Text size inside windows and dialogs', 'حجم الخط داخل النوافذ والرسائل')}</p>
              <div className="os-seg">
                {[['m', tt('Normal', 'عادي')], ['l', tt('Large', 'كبير')], ['xl', tt('Extra large', 'كبير جدًا')]].map(([k, l]) => <button key={k} type="button" className={(prefs.fontScale || 'm') === k ? 'is-on' : ''} onClick={() => setPrefs({ fontScale: k })}>{l}</button>)}
              </div>
              <div className="os-ic-list" style={{ marginTop: 12 }}>
                {[['reduceMotion', tt('Reduce motion', 'تقليل الحركة'), tt('No window animations, no Dock zoom.', 'من غير حركات للنوافذ ولا تكبير للـ Dock.')],
                  ['highContrast', tt('High contrast', 'تباين عالي'), tt('Solid backgrounds, stronger text and borders.', 'خلفيات ثابتة ونصوص وحدود أوضح.')]].map(([k, name, hint]) => (
                  <label key={k} className={`os-ic-row${prefs[k] ? '' : ' is-off'}`}>
                    <span className="os-ic-row__t" dir="auto"><b>{name}</b><br /><small>{hint}</small></span>
                    <span className="os-ic-row__s">{prefs[k] ? tt('On', 'شغّال') : tt('Off', 'مقفول')}</span>
                    <input type="checkbox" role="switch" checked={!!prefs[k]} onChange={(e) => setPrefs({ [k]: e.target.checked })} aria-label={name} />
                  </label>
                ))}
              </div>
            </Section>
          </>
        )}
        {tab === 'phone' && isPhone && <Section title={tt('Phone look', 'مظهر الهاتف')}><MobilePrefs prefs={prefs} setPrefs={setPrefs} tt={tt} ar={ar} /></Section>}
        {tab === 'cloud' && <CloudPanel tt={tt} usage={usage} />}
        {tab === 'links' && <SharedLinksPanel ar={ar} locale={ar ? 'ar' : 'en'} embedded />}
        {tab === 'security' && sec && <SecuritySettings tt={tt} ar={ar} sec={sec} onSec={onSec} lockEnabled={lockEnabled} onLockNow={onLockNow} onSleepNow={onSleepNow} onSelfLogout={onSelfLogout} onOpenLockTab={() => setTab('lock')} />}
        {tab === 'lock' && <LockSettings tt={tt} lockEnabled={lockEnabled} onLockChanged={onLockChanged} />}
        {tab === 'system' && (
          <>
            <Section title={tt('Appearance', 'المظهر')}>
              <div className="os-seg">
                {[['light', tt('Light', 'فاتح')], ['dark', tt('Dark', 'داكن')]].map(([k, l]) => <button key={k} type="button" className={theme === k ? 'is-on' : ''} onClick={() => { if (theme !== k) toggleTheme(); }}>{l}</button>)}
              </div>
            </Section>
            <Section title={tt('Language', 'اللغة')}>
              <div className="os-seg">
                {[['en', 'English'], ['ar', 'العربية']].map(([k, l]) => <button key={k} type="button" className={(ar ? 'ar' : 'en') === k ? 'is-on' : ''} onClick={() => { if ((ar ? 'ar' : 'en') !== k) toggleLocale(); }}>{l}</button>)}
              </div>
            </Section>
            <Section title={tt('Storage', 'التخزين')}>
              {usage ? (
                <>
                  <div className="os-bar"><i style={{ width: `${Math.min(100, usage.percent || 0)}%` }} /></div>
                  <p className="os-set__hint">{tt(`${usage.used_human} used of ${usage.quota_human} (${usage.percent}%)`, `${usage.used_human} مستخدمة من ${usage.quota_human} (${usage.percent}%)`)}</p>
                </>
              ) : <p className="os-set__hint">…</p>}
            </Section>
            <ResetPc tt={tt} />
          </>
        )}
        {tab === 'about' && (
          <Section title="UIPE Desktop">
            <dl className="os-about">
              <dt>{tt('Signed in as', 'المستخدم')}</dt><dd dir="auto">{user?.full_name || user?.email || '—'}</dd>
              <dt>{tt('Device name', 'اسم الجهاز')}</dt><dd>UIPE-PC</dd>
              <dt>{tt('Edition', 'الإصدار')}</dt><dd>UIPE Desktop 1.0 (web)</dd>
              <dt>{tt('Storage backend', 'مكان التخزين')}</dt><dd>{tt('Private drive on the UIPE server', 'مساحتك الخاصة على سيرفر UIPE')}</dd>
            </dl>
          </Section>
        )}
      </div>
    </div>
  );
}

const age = (ms, ar) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return ar ? `${s} ث` : `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? (ar ? `${m} د` : `${m}m`) : (ar ? `${Math.floor(m / 60)} س ${m % 60} د` : `${Math.floor(m / 60)}h ${m % 60}m`);
};

export function TaskManagerApp({ list, ar, tt, usage, onEnd, onFocus }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(h); }, []);
  const [sel, setSel] = useState(null);
  const heap = typeof performance !== 'undefined' && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  const rows = list.filter((w) => w.app !== 'taskmgr');
  return (
    <div className="os-tm">
      <div className="os-tm__stats">
        <div><b>{rows.length}</b><span>{tt('Apps running', 'تطبيقات شغّالة')}</span></div>
        <div><b>{heap != null ? `${heap} MB` : '—'}</b><span>{tt('Browser memory (JS)', 'ذاكرة المتصفح (JS)')}</span></div>
        <div><b>{usage ? `${usage.percent}%` : '—'}</b><span>{tt('Disk used', 'المساحة المستخدمة')}</span></div>
      </div>
      <div className="os-tm__table" role="table">
        <div className="os-tm__row os-tm__row--head" role="row"><span>{tt('Name', 'الاسم')}</span><span>{tt('Status', 'الحالة')}</span><span>{tt('Running for', 'مدة التشغيل')}</span></div>
        {rows.length === 0 && <p className="os-app-msg">{tt('No apps are running.', 'مفيش تطبيقات شغّالة.')}</p>}
        {rows.map((w) => (
          <div key={w.id} role="row" className={`os-tm__row${sel === w.id ? ' is-on' : ''}`} onClick={() => setSel(w.id)} onDoubleClick={() => onFocus(w.id)}>
            <span><AppGlyph app={w.app} size={20} /> <em dir="auto">{w.title}</em></span>
            <span>{w.min ? tt('Minimized', 'مصغّر') : tt('Running', 'يعمل')}</span>
            <span>{age(Date.now() - w.since, ar)}</span>
          </div>
        ))}
      </div>
      <footer className="os-tm__foot">
        <button type="button" className="os-btn" disabled={!sel} onClick={() => { onFocus(sel); }}>{tt('Switch to', 'التبديل إليه')}</button>
        <button type="button" className="os-btn os-btn--danger" disabled={!sel || !rows.some((w) => w.id === sel)} onClick={() => { onEnd(sel); setSel(null); }}>{tt('End task', 'إنهاء المهمة')}</button>
      </footer>
    </div>
  );
}

const Keys = ({ k }) => (
  <span className="os-keys">{k.map((c) => <span key={c}>{fmtKeys(c).split(/\+(?=.)/).map((p) => <kbd key={p}>{p}</kbd>)}</span>)}</span>
);

export function ShortcutsApp({ ar, tt }) {
  const [q, setQ] = useState('');
  const match = (s) => !q.trim() || `${s.en} ${s.ar} ${s.keys.join(' ')} ${s.win || ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const nums = SHORTCUTS.filter((s) => /^pin\d$/.test(s.id));
  const base = SHORTCUTS.filter((s) => !/^pin\d$/.test(s.id));
  return (
    <div className="os-sc">
      <div className="os-sc__top">
        <Icon name="search" size={15} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search shortcuts…', 'ابحث في الاختصارات…')} dir="auto" />
      </div>
      <p className="os-sc__note">{tt('The browser reserves Win+key, Alt+Tab and Alt+F4, so each of them has an Alt-based twin here.', 'المتصفح بيحجز مفاتيح Win و Alt+Tab و Alt+F4، فكل واحد ليه بديل بـ Alt هنا.')}</p>
      <div className="os-sc__list">
        {GROUPS.map((g) => {
          let rows = g.id === 'explorer' ? EXPLORER_SHORTCUTS.filter(match) : base.filter((s) => s.group === g.id && match(s));
          if (g.id === 'taskbar') rows = nums.filter(match).length ? [{ keys: ['Alt+1 … Alt+9'], en: 'Open / switch to Dock app 1–9', ar: 'فتح / تبديل لتطبيق 1–9 في شريط المهام' }] : [];
          if (!rows.length) return null;
          return (
            <section key={g.id}>
              <h4>{ar ? g.ar : g.en}</h4>
              {rows.map((s) => (
                <div key={s.keys.join() + s.en} className="os-sc__row">
                  <span>{ar ? s.ar : s.en}</span>
                  <span className="os-sc__keys">
                    {g.id === 'taskbar' || g.id === 'explorer' ? <Keys k={s.keys} /> : <Keys k={s.keys} />}
                    {s.win && <small title={tt('Native macOS shortcut', 'اختصار ماك الأصلي')}>≈ {s.win}</small>}
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
