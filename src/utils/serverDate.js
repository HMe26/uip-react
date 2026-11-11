// The API returns timestamps as UTC "YYYY-MM-DD HH:MM:SS" (Laravel, app.timezone = UTC) with no zone
// marker. new Date("... ") would read that as the browser's LOCAL time, so a notification created just
// now showed as "3h ago" in Cairo (UTC+3). Treat zone-less strings as UTC; leave anything with an
// explicit zone (Z / +02:00) untouched.
const NO_ZONE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function parseServerDate(value) {
  if (value instanceof Date) return value;
  const s = String(value ?? '').trim();
  if (NO_ZONE.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  return new Date(s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2'));
}
