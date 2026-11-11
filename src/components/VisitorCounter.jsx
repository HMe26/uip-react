import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { fetchVisitStats } from '../lib/siteVisits';

const MIN_DIGITS = 6;

/**
 * Footer visitor counter: odometer-style digit tiles for total visits + a
 * unique-visitors chip. Numbers come from GET/POST /api/v1/public/visits
 * (real DB counters). Hidden if the API is unreachable — never a fake number.
 */
export default function VisitorCounter() {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const [stats, setStats] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchVisitStats({ fresh: tick > 0 }).then((s) => { if (alive && s) setStats(s); });
    return () => { alive = false; };
  }, [tick]);

  // Keep the number live while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (!stats) return null;

  const total = Math.max(0, Number(stats.total_visits) || 0);
  const digits = String(total).padStart(MIN_DIGITS, '0').split('');
  const fmt = (n) => n.toLocaleString(isAr ? 'ar-EG' : 'en-US');
  const digitText = (d) => (isAr ? Number(d).toLocaleString('ar-EG') : d);

  return (
    <section className="uip-visits" aria-label={t('Platform visitors', 'زوار المنصة')}>
      <div className="uip-visits__head">
        <span className="uip-visits__live"><i aria-hidden="true" /> {t('Live', 'مباشر')}</span>
        <h3>{t('Platform visits', 'زيارات المنصة')}</h3>
      </div>

      <div className="uip-visits__odometer" dir="ltr" role="img" aria-label={`${fmt(total)} ${t('total visits', 'زيارة')}`}>
        {digits.map((d, i) => (
          <span key={`${i}-${digits.length}`} className="uip-visits__digit">{digitText(d)}</span>
        ))}
      </div>
    </section>
  );
}
