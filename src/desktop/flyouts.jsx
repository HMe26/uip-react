import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon';

/** Real battery state (Chrome / Edge / Android). null when the browser does not expose it — the tray then simply hides the icon. */
export function useBattery() {
  const [b, setB] = useState(null);
  useEffect(() => {
    if (!navigator.getBattery) return undefined;
    let dead = false; let bat = null;
    const read = () => { if (!dead && bat) setB({ level: Math.round(bat.level * 100), charging: bat.charging }); };
    navigator.getBattery().then((x) => { bat = x; read(); ['levelchange', 'chargingchange'].forEach((ev) => x.addEventListener(ev, read)); }).catch(() => {});
    return () => { dead = true; if (bat) ['levelchange', 'chargingchange'].forEach((ev) => bat.removeEventListener(ev, read)); };
  }, []);
  return b;
}

export function useOnline() {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOn(true); const down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

export const WifiGlyph = ({ on = true, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 8.8a15 15 0 0 1 20 0" opacity={on ? 1 : .35} /><path d="M5 12.5a10 10 0 0 1 14 0" opacity={on ? 1 : .35} /><path d="M8.5 16a5 5 0 0 1 7 0" opacity={on ? 1 : .35} /><circle cx="12" cy="19.4" r=".8" fill="currentColor" />
    {!on && <path d="M3 3l18 18" />}
  </svg>
);

export const BatteryGlyph = ({ level = 100, charging = false, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="7" width="17" height="10" rx="2.5" /><path d="M21.5 10.5v3" />
    <rect x="4" y="9" width={Math.max(1, (13 * level) / 100)} height="6" rx="1" fill={level <= 15 && !charging ? '#ef4444' : 'currentColor'} stroke="none" />
    {charging && <path d="M11.5 8.5 9 12.2h3L10.5 15.5" stroke="#fff" strokeWidth="1.4" />}
  </svg>
);

export const VolumeGlyph = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
);

function Tile({ on, icon, label, sub, onClick, disabled }) {
  return (
    <button type="button" className={`os-qs__tile${on ? ' is-on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={!!on}>
      <span className="os-qs__ic">{icon}</span>
      <span className="os-qs__tx"><b>{label}</b>{sub && <small>{sub}</small>}</span>
    </button>
  );
}

/** Quick settings flyout (network / theme / language / full screen / lock + brightness + battery). Every control does something real. */
export function QuickSettings({ tt, ar, theme, online, battery, brightness, setBrightness, onTheme, onLocale, onFullscreen, onLock, onSettings, fullscreen, user }) {
  const name = user?.full_name || user?.email || tt('User', 'مستخدم');
  return (
    <div className="os-fly os-qs" role="dialog" aria-label={tt('Quick settings', 'الإعدادات السريعة')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="os-qs__grid">
        <Tile on={online} icon={<WifiGlyph on={online} size={18} />} label={tt('Network', 'الشبكة')} sub={online ? tt('Connected', 'متصل') : tt('No internet', 'لا يوجد إنترنت')} disabled />
        <Tile on={theme === 'dark'} icon={<Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} />} label={tt('Dark mode', 'الوضع الداكن')} sub={theme === 'dark' ? tt('On', 'يعمل') : tt('Off', 'متوقف')} onClick={onTheme} />
        <Tile on={fullscreen} icon={<Icon name="maximize" size={18} />} label={tt('Full screen', 'ملء الشاشة')} sub={fullscreen ? tt('On', 'يعمل') : tt('Off', 'متوقف')} onClick={onFullscreen} />
        <Tile icon={<b className="os-qs__lang">{ar ? 'EN' : 'ع'}</b>} label={tt('Language', 'اللغة')} sub={ar ? 'العربية' : 'English'} onClick={onLocale} />
      </div>
      <label className="os-qs__slider">
        <Icon name="sun" size={17} />
        <input type="range" min="40" max="100" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} aria-label={tt('Brightness', 'السطوع')} />
        <span>{brightness}%</span>
      </label>
      <footer className="os-qs__foot">
        <span className="os-qs__user"><i>{String(name).trim().charAt(0).toUpperCase()}</i>
          {battery ? <span className="os-qs__bat"><BatteryGlyph level={battery.level} charging={battery.charging} size={20} />{battery.level}%{battery.charging ? ` · ${tt('Charging', 'يشحن')}` : ''}</span> : <span className="os-qs__bat">{tt('Plugged in', 'متصل بالكهرباء')}</span>}
        </span>
        <span>
          <button type="button" title={tt('Settings', 'الإعدادات')} aria-label={tt('Settings', 'الإعدادات')} onClick={onSettings}><Icon name="settings" size={17} /></button>
          <button type="button" title={tt('Lock (Alt+L)', 'قفل (Alt+L)')} aria-label={tt('Lock', 'قفل')} onClick={onLock}><Icon name="lock" size={17} /></button>
        </span>
      </footer>
    </div>
  );
}

/** Calendar flyout: today's date + a real month grid you can page through. */
export function CalendarFlyout({ tt, ar }) {
  const today = useMemo(() => new Date(), []);
  const [cur, setCur] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const lc = ar ? 'ar-EG' : 'en-US';
  const days = useMemo(() => {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const start = (first.getDay() - (ar ? 6 : 0) + 7) % 7; // the week starts on Saturday in Arabic (Egypt), Sunday in English
    const total = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const cells = Array.from({ length: start }, () => null).concat(Array.from({ length: total }, (_, i) => i + 1));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [cur, ar]);
  const heads = useMemo(() => {
    const base = ar ? 6 : 0; // 2023-01-01 is a Sunday
    return Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + ((base + i) % 7)).toLocaleDateString(lc, { weekday: 'short' }));
  }, [ar, lc]);
  const isToday = (d) => d && cur.getFullYear() === today.getFullYear() && cur.getMonth() === today.getMonth() && d === today.getDate();
  const move = (n) => setCur((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  return (
    <div className="os-fly os-cal" role="dialog" aria-label={tt('Calendar', 'التقويم')} onPointerDown={(e) => e.stopPropagation()}>
      <header className="os-cal__today">
        <b>{today.toLocaleTimeString(lc, { hour: 'numeric', minute: '2-digit' })}</b>
        <span>{today.toLocaleDateString(lc, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </header>
      <div className="os-cal__nav">
        <strong>{cur.toLocaleDateString(lc, { month: 'long', year: 'numeric' })}</strong>
        <span>
          <button type="button" aria-label={tt('Previous month', 'الشهر السابق')} onClick={() => move(-1)}><Icon name="chevron-down" size={15} style={{ transform: 'rotate(180deg)' }} /></button>
          <button type="button" aria-label={tt('Next month', 'الشهر التالي')} onClick={() => move(1)}><Icon name="chevron-down" size={15} /></button>
        </span>
      </div>
      <div className="os-cal__grid">
        {heads.map((h) => <i key={h} className="os-cal__h">{h}</i>)}
        {days.map((d, i) => <span key={i} className={`os-cal__d${isToday(d) ? ' is-today' : ''}${d ? '' : ' is-empty'}`}>{d ? d.toLocaleString(lc) : ''}</span>)}
      </div>
      <button type="button" className="os-cal__go" onClick={() => setCur(new Date(today.getFullYear(), today.getMonth(), 1))}>{tt('Go to today', 'اليوم')}</button>
    </div>
  );
}
