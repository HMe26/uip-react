import { useEffect, useState } from 'react';

/** Home-screen clock of the phone UI in five styles: 'ios' (big lock-screen type) · 'digital' (card) · 'analog' (dial) · 'minimal' (one line) · 'off'. */
export const CLOCK_STYLES = [
  { id: 'ios', en: 'iOS', ar: 'iOS' },
  { id: 'digital', en: 'Digital', ar: 'رقمي' },
  { id: 'analog', en: 'Analog', ar: 'عقارب' },
  { id: 'minimal', en: 'Minimal', ar: 'بسيط' },
  { id: 'off', en: 'None', ar: 'بدون' },
];

function useNow(ms) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), ms); return () => clearInterval(h); }, [ms]);
  return now;
}

function Dial({ now }) {
  const s = now.getSeconds(); const m = now.getMinutes() + s / 60; const h = (now.getHours() % 12) + m / 60;
  const ticks = Array.from({ length: 12 }, (_, i) => i);
  return (
    <svg className="mclk__dial" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <circle cx="50" cy="50" r="47" className="mclk__face" />
      {ticks.map((i) => <line key={i} x1="50" y1="8" x2="50" y2={i % 3 ? 12 : 15} className={i % 3 ? 'mclk__tick' : 'mclk__tick mclk__tick--big'} transform={`rotate(${i * 30} 50 50)`} />)}
      <line x1="50" y1="50" x2="50" y2="27" className="mclk__h" transform={`rotate(${h * 30} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="17" className="mclk__m" transform={`rotate(${m * 6} 50 50)`} />
      <line x1="50" y1="56" x2="50" y2="12" className="mclk__s" transform={`rotate(${s * 6} 50 50)`} />
      <circle cx="50" cy="50" r="3" className="mclk__pin" />
    </svg>
  );
}

export default function PhoneClock({ ar, kind = 'ios' }) {
  const now = useNow(kind === 'analog' ? 1000 : 10000);
  if (kind === 'off') return null;
  const lc = ar ? 'ar-EG' : 'en-US';
  const parts = new Intl.DateTimeFormat(lc, { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const hm = `${get('hour')}:${get('minute')}`; const per = get('dayPeriod');
  const day = now.toLocaleDateString(lc, { weekday: 'long' });
  const date = now.toLocaleDateString(lc, { day: 'numeric', month: 'long' });

  if (kind === 'analog') {
    return (
      <section className="mclk mclk--analog" aria-label={`${hm} ${per}`}>
        <Dial now={now} />
        <div className="mclk__txt"><b>{hm}<small>{per}</small></b><span>{day}</span><span>{date}</span></div>
      </section>
    );
  }
  if (kind === 'minimal') {
    return <section className="mclk mclk--min" aria-label={`${hm} ${per}`}><b>{hm}<small>{per}</small></b><span>{day} · {date}</span></section>;
  }
  if (kind === 'digital') {
    return <section className="mclk mclk--digital" aria-label={`${hm} ${per}`}><span>{day} · {date}</span><b>{hm}<small>{per}</small></b></section>;
  }
  return (
    <section className="mclk mclk--ios" aria-label={`${hm} ${per}`}>
      <span className="mclk__date">{day} {date}</span>
      <b className="mclk__time">{hm}</b>
      <span className="mclk__per">{per}</span>
    </section>
  );
}
