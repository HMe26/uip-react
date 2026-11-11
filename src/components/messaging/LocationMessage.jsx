import { useEffect, useRef, useState } from 'react';
import { Modal } from './modals';
import { useLanguage } from '../../context/LanguageContext';
import { getPosition, geoMessage, tileGrid, mapsUrl } from '../../lib/geo';
import { isNative, openAppSettings, openLocationSettings } from '../../native';

const Pin = ({ live }) => (
  <span className={`loc-pin${live ? ' is-live' : ''}`} aria-hidden="true">
    {live ? <i className="loc-pin__pulse" /> : null}
    <svg width="30" height="38" viewBox="0 0 24 30" fill="none">
      <path d="M12 29s9-8.2 9-17A9 9 0 0 0 3 12c0 8.8 9 17 9 17z" fill="#e5484d" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.4" fill="#fff" />
    </svg>
  </span>
);

/* Map looks. Satellite (default) shows the real fields and houses; "street" is Esri World Street Map (Esri World Street Map, coloured, no API key).
   Plain OpenStreetMap tiles drew empty land as beige, which made many areas look like desert. */
const MAP_STYLES = {
  sat: {
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attr: '© Esri',
  },
  street: {
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
    attr: '© Esri',
  },
};
const MAP_KEY = 'uip_map_style';
const readStyle = () => { try { return localStorage.getItem(MAP_KEY) === 'street' ? 'street' : 'sat'; } catch { return 'sat'; } };
function useMapStyle() {
  const [style, setStyle] = useState(readStyle);
  useEffect(() => {
    const on = () => setStyle(readStyle());
    window.addEventListener('uip-map-style', on);
    return () => window.removeEventListener('uip-map-style', on);
  }, []);
  const toggle = () => {
    try { localStorage.setItem(MAP_KEY, style === 'sat' ? 'street' : 'sat'); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event('uip-map-style'));
    setStyle(style === 'sat' ? 'street' : 'sat');
  };
  return [style, toggle];
}

/** Small map built from map tiles (no iframe / SDK, works inside the CSP and the APK). */
export function MapPreview({ lat, lng, zoom = 17, live = false, height = 150 }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [style, toggle] = useMapStyle();
  const [failed, setFailed] = useState(0);
  const def = MAP_STYLES[style];
  const g = tileGrid(Number(lat), Number(lng), zoom);
  const tiles = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = (((g.cx + dx) % g.n) + g.n) % g.n;
      const y = g.cy + dy;
      if (y < 0 || y >= g.n) continue;
      tiles.push(
        <img key={`${style}:${dx}:${dy}`} alt="" draggable="false" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
          src={def.url(zoom, x, y)}
          style={{ left: (dx + 1) * 256, top: (dy + 1) * 256 }}
          onError={() => setFailed((n) => n + 1)} />,
      );
    }
  }
  return (
    <div className={`loc-map loc-map--${style}`} style={{ height }}>
      <div className="loc-map__tiles" style={{ left: `calc(50% - ${256 + g.ox}px)`, top: `calc(50% - ${256 + g.oy}px)`, opacity: failed >= 9 ? 0 : 1 }}>
        {tiles}
      </div>
      <Pin live={live} />
      <button
        type="button"
        className="loc-map__style"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFailed(0); toggle(); }}
        title={style === 'sat' ? (ar ? 'عرض خريطة الشوارع' : 'Street map') : (ar ? 'عرض القمر الصناعي' : 'Satellite')}
        aria-label={style === 'sat' ? (ar ? 'عرض خريطة الشوارع' : 'Street map') : (ar ? 'عرض القمر الصناعي' : 'Satellite')}
      >
        {style === 'sat' ? (ar ? 'خريطة' : 'Map') : (ar ? 'قمر صناعي' : 'Satellite')}
      </button>
      <span className="loc-map__attr">{def.attr}</span>
    </div>
  );
}

const FIX_KEY = 'uip_last_fix';
function readLastFix() {
  try {
    const v = JSON.parse(localStorage.getItem(FIX_KEY) || 'null');
    return v && Date.now() - v.ts < 6 * 3600 * 1000 && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? { lat: v.lat, lng: v.lng, accuracy: null } : null;
  } catch { return null; }
}
const saveLastFix = (p) => { try { localStorage.setItem(FIX_KEY, JSON.stringify({ lat: p.lat, lng: p.lng, ts: Date.now() })); } catch { /* storage blocked */ } };

const PinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const OpenIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
);

const coordText = (lat, lng) => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

/** "Current location" message. */
export function LocationBubble({ m }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const { lat, lng } = m.metadata || {};
  if (lat == null || lng == null) return null;
  return (
    <a className="loc-card" href={mapsUrl(lat, lng)} target="_blank" rel="noopener noreferrer nofollow">
      <span className="loc-card__mapwrap">
        <MapPreview lat={lat} lng={lng} height={176} />
        <span className="loc-card__chip"><PinIcon />{ar ? 'الموقع الحالي' : 'Current location'}</span>
      </span>
      <span className="loc-card__meta">
        <span className="loc-card__text">
          <strong>{ar ? 'الموقع الحالي' : 'Current location'}</strong>
          <span dir="ltr">{coordText(lat, lng)}</span>
        </span>
        <span className="loc-card__open">{ar ? 'فتح في الخرائط' : 'Open in Maps'}<OpenIcon /></span>
      </span>
    </a>
  );
}

function remaining(ms, ar) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return ar ? `${h} ساعة${r ? ` و${r} دقيقة` : ''}` : `${h} h${r ? ` ${r} min` : ''}`;
  }
  return ar ? `${mins} دقيقة` : `${mins} min`;
}

function ago(ts, now, ar) {
  const s = Math.max(0, Math.round((now - ts * 1000) / 1000));
  if (s < 20) return ar ? 'الآن' : 'just now';
  if (s < 3600) { const m = Math.max(1, Math.round(s / 60)); return ar ? `منذ ${m} دقيقة` : `${m} min ago`; }
  const h = Math.round(s / 3600);
  return ar ? `منذ ${h} ساعة` : `${h} h ago`;
}

/** Live-location message: the pin moves as the sender's position updates (the thread poll refreshes `m.metadata`). */
export function LiveLocationBubble({ m, onStop }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const meta = m.metadata || {};
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const active = !meta.ended && now < Number(meta.expires_ts || 0) * 1000;
  useEffect(() => {
    if (!active) return undefined;
    const h = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(h);
  }, [active]);
  if (meta.lat == null || meta.lng == null) return null;
  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try { await onStop?.(m.id); } finally { setBusy(false); }
  };
  return (
    <div className={`loc-card loc-card--live${active ? ' is-active' : ' is-ended'}`}>
      <a href={mapsUrl(meta.lat, meta.lng)} target="_blank" rel="noopener noreferrer nofollow" className="loc-card__maplink loc-card__mapwrap">
        <MapPreview lat={meta.lat} lng={meta.lng} live={active} height={176} />
        <span className={`loc-card__chip${active ? ' is-live' : ''}`}>
          {active ? <i className="loc-live-dot" aria-hidden="true" /> : <PinIcon />}
          {active ? (ar ? 'مباشر' : 'LIVE') : (ar ? 'انتهى' : 'Ended')}
        </span>
      </a>
      <span className="loc-card__meta">
        <span className="loc-card__text">
          <strong>{ar ? 'الموقع المباشر' : 'Live location'}</strong>
          <span>
            {active
              ? `${ar ? 'متبقي' : 'Ends in'} ${remaining(Number(meta.expires_ts) * 1000 - now, ar)}${meta.updated_ts ? ` · ${ago(Number(meta.updated_ts), now, ar)}` : ''}`
              : (ar ? 'انتهت مشاركة الموقع المباشر' : 'Live location ended')}
          </span>
        </span>
      </span>
      {active && m.is_mine ? (
        <button type="button" className="loc-card__stop" onClick={stop} disabled={busy}>
          {ar ? 'إيقاف المشاركة' : 'Stop sharing'}
        </button>
      ) : null}
    </div>
  );
}

const DURATIONS = [
  { min: 15, en: '15 minutes', ar: '15 دقيقة' },
  { min: 60, en: '1 hour', ar: 'ساعة' },
  { min: 480, en: '8 hours', ar: '8 ساعات' },
];

/** WhatsApp-style "Share location" sheet: send the current location or start a live one. */
export function LocationShareModal({ onClose, onSendCurrent, onStartLive }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, a) => (ar ? a : en);
  const [pos, setPos] = useState(readLastFix); // last known place shows instantly (map only) while the real fix is found
  const [stale, setStale] = useState(() => readLastFix() !== null);
  const [error, setError] = useState('');
  const [errCode, setErrCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const attempt = useRef(0);

  const locate = () => {
    const id = (attempt.current += 1); // ignore answers of an older attempt
    setLoading(true);
    setSlow(false);
    setError('');
    setErrCode('');
    // quick fix first -> the map shows up fast; then a precise fix quietly replaces it
    getPosition()
      .then((p) => {
        if (!alive.current || id !== attempt.current) return;
        setPos(p); setStale(false); saveLastFix(p);
        getPosition({ precise: true })
          .then((q) => { if (alive.current && id === attempt.current) { setPos(q); saveLastFix(q); } })
          .catch(() => { /* keep the quick fix */ });
      })
      .catch((e) => { if (alive.current && id === attempt.current) { setError(geoMessage(e, ar)); setErrCode(e?.code || ''); } })
      .finally(() => { if (alive.current && id === attempt.current) setLoading(false); });
  };
  useEffect(() => { alive.current = true; locate(); return () => { alive.current = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // still waiting after a few seconds: say so and offer a retry instead of a silent spinner
  useEffect(() => {
    if (!loading) return undefined;
    const h = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(h);
  }, [loading]);

  const run = async (fn) => {
    if (!pos || busy) return;
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e?.message || t('Something went wrong.', 'حدث خطأ ما.')); setBusy(false); }
  };

  return (
    <Modal title={t('Share location', 'مشاركة الموقع')} onClose={onClose}>
      <div className="loc-share">
        {pos ? (
          <>
            <MapPreview lat={pos.lat} lng={pos.lng} height={170} />
            <p className="loc-share__acc" dir={stale ? undefined : 'ltr'}>
              {stale
                ? (error ? t('Showing your last known place — current location not found', 'آخر مكان معروف — لم يتم تحديد موقعك الحالي') : t('Last known place — updating to your current location…', 'آخر مكان معروف — جارٍ التحديث لموقعك الحالي…'))
                : `${coordText(pos.lat, pos.lng)}${pos.accuracy != null ? ` · ±${pos.accuracy} m` : ''}`}
            </p>
          </>
        ) : (
          <div className="loc-share__wait">
            {loading
              ? (slow ? t('Still locating… this can take a bit indoors. Move near a window or turn GPS on.', 'ما زال يحدد موقعك… قد يستغرق وقتًا داخل المباني. اقترب من نافذة أو شغّل الـ GPS.') : t('Getting your location…', 'جارٍ تحديد موقعك…'))
              : t('Location unavailable', 'الموقع غير متاح')}
          </div>
        )}
        {error ? <p className="loc-share__err" role="alert">{error}</p> : null}
        {(!pos || stale) && (slow || !loading) ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={locate}>{t('Try again', 'حاول مرة أخرى')}</button>
            {isNative && (errCode === 'denied' || errCode === 'stuck') ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => openAppSettings()}>{t('Open app settings', 'فتح إعدادات التطبيق')}</button>
            ) : null}
            {isNative && ['unavailable', 'timeout', 'stuck', 'gps_off'].includes(errCode) ? (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => openLocationSettings()}>{t('Turn on location (GPS)', 'تشغيل الموقع (GPS)')}</button>
            ) : null}
          </div>
        ) : null}

        <button type="button" className="loc-share__opt" disabled={!pos || stale || busy} onClick={() => run(() => onSendCurrent(pos))}>
          <span className="loc-share__ico is-blue" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          </span>
          <span><strong>{t('Send your current location', 'إرسال موقعك الحالي')}</strong><small>{t('Share where you are right now', 'مشاركة مكانك الآن')}</small></span>
        </button>

        <div className="loc-share__live">
          <button type="button" className="loc-share__opt" disabled={!pos || stale || busy} onClick={() => run(() => onStartLive(pos, minutes))}>
            <span className="loc-share__ico is-green" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></svg>
            </span>
            <span><strong>{t('Share live location', 'مشاركة الموقع المباشر')}</strong><small>{t('Updates as you move, for the time you choose', 'يتحدّث أثناء تحركك طوال المدة التي تختارها')}</small></span>
          </button>
          <div className="loc-share__dur" role="radiogroup" aria-label={t('Duration', 'المدة')}>
            {DURATIONS.map((d) => (
              <button key={d.min} type="button" role="radio" aria-checked={minutes === d.min} className={minutes === d.min ? 'is-on' : ''} onClick={() => setMinutes(d.min)}>
                {ar ? d.ar : d.en}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
