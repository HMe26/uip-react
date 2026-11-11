/**
 * Location helpers shared by attendance (QR + geofence) and chat (location messages / live sharing / permissions):
 * one-shot GPS fix, a live watcher, readable errors, map-tile maths, and a stable per-browser device id.
 *
 * Error codes (err.code): 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'gps_off' | 'stuck' | 'failed'.
 */
import { isNative } from '../native';

const codeOf = (e) => {
  const m = String(e?.message || e || '').toLowerCase();
  if (e?.code === 'unsupported') return 'unsupported';
  if (e?.code === 1 || e?.code === 'denied' || /denied|not authori[sz]ed|permission/.test(m)) return 'denied';
  if (/location services|gps.*(off|disabled)|disabled/.test(m)) return 'gps_off';
  if (e?.code === 3 || e?.code === 'timeout' || /time(d)? ?out/.test(m)) return 'timeout';
  if (e?.code === 2 || e?.code === 'unavailable' || /unavailable|position/.test(m)) return 'unavailable';
  return e?.code && typeof e.code === 'string' ? e.code : 'failed';
};

const fail = (e) => Object.assign(new Error(e?.message || 'geo'), { code: codeOf(e) });

async function nativeGeo() {
  const { Geolocation } = await import('@capacitor/geolocation');
  return Geolocation;
}

/** Native app: make sure the OS location permission is granted (shows the system dialog if needed). */
export async function ensureNativePermission() {
  try {
    const G = await nativeGeo();
    let p = await G.checkPermissions();
    if (p.location !== 'granted' && p.coarseLocation !== 'granted') p = await G.requestPermissions();
    if (p.location !== 'granted' && p.coarseLocation !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' });
    return true;
  } catch (e) { throw fail(e); }
}

/**
 * One-shot fix → { lat, lng, accuracy }.
 * getPosition(15000) or getPosition({ precise: true, timeout }) — "precise" waits for a high-accuracy GPS fix,
 * the default accepts a quick (possibly network-based) one so a map can show fast.
 */
export function getPosition(opts = 15000) {
  const o = typeof opts === 'number' ? { timeout: opts, precise: true } : { precise: false, ...opts };
  const timeout = o.timeout || (o.precise ? 20000 : 10000);
  const toPos = (c) => ({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy });

  if (isNative) {
    return (async () => {
      try {
        await ensureNativePermission();
        const G = await nativeGeo();
        const p = await G.getCurrentPosition({ enableHighAccuracy: !!o.precise, timeout, maximumAge: o.precise ? 0 : 60000 });
        return toPos(p.coords);
      } catch (e) { throw fail(e); }
    })();
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(Object.assign(new Error('unsupported'), { code: 'unsupported' })); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toPos(p.coords)),
      (e) => reject(fail(e)),
      { enableHighAccuracy: !!o.precise, timeout, maximumAge: o.precise ? 0 : 60000 },
    );
  });
}

/**
 * Keep watching the position. Resolves with a `stop()` function once the watcher is running.
 * `labels` ({ title, message }) are only used by the native foreground notification, if any.
 */
export async function watchLive(onPosition, onError = () => {}, labels = {}) { // eslint-disable-line no-unused-vars
  const toPos = (c) => ({ lat: c.latitude, lng: c.longitude, accuracy: c.accuracy });
  if (isNative) {
    await ensureNativePermission();
    const G = await nativeGeo();
    const id = await G.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }, (p, err) => {
      if (err || !p) { onError(fail(err)); return; }
      onPosition(toPos(p.coords));
    });
    return () => { G.clearWatch({ id }); };
  }
  if (!navigator.geolocation) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  const id = navigator.geolocation.watchPosition((p) => onPosition(toPos(p.coords)), (e) => onError(fail(e)), { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  return () => navigator.geolocation.clearWatch(id);
}

const MSG = {
  denied: ['تم رفض إذن الموقع. فعّله من الإعدادات وحاول تاني.', 'Location permission was denied. Enable it in settings and try again.'],
  unsupported: ['جهازك لا يدعم تحديد الموقع.', 'This device does not support location.'],
  gps_off: ['خدمة الموقع (GPS) مقفولة. شغّلها وحاول تاني.', 'Location services (GPS) are off. Turn them on and try again.'],
  timeout: ['استغرق تحديد الموقع وقتًا طويلًا. جرّب في مكان مفتوح.', 'Locating took too long. Try somewhere with a clearer sky.'],
  unavailable: ['الموقع غير متاح حاليًا. فعّل GPS وحاول تاني.', 'Location is unavailable right now. Turn on GPS and try again.'],
  stuck: ['إذن الموقع محتاج تفعّله من إعدادات التطبيق.', 'Location permission must be enabled from the app settings.'],
};
export function geoMessage(err, ar) {
  const m = MSG[err?.code] || ['تعذّر تحديد موقعك. فعّل GPS وحاول تاني.', 'Could not get your location. Turn on GPS and try again.'];
  return ar ? m[0] : m[1];
}
export const geoErrorText = geoMessage;

/** Web-mercator tile under (lat,lng) at `zoom`: { n: tiles per side, cx, cy: tile indexes, ox, oy: pixel offset inside that 256px tile }. */
export function tileGrid(lat, lng, zoom) {
  const n = 2 ** zoom;
  const latC = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = ((lng + 180) / 360) * n;
  const r = (latC * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  return { n, cx, cy, ox: (x - cx) * 256, oy: (y - cy) * 256 };
}

export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;

export function deviceId() {
  try {
    let v = localStorage.getItem('uip_device_id');
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('uip_device_id', v);
    }
    return v;
  } catch { return ''; }
}
