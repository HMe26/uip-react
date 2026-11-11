/** First http(s) URL found in a message body (trailing punctuation trimmed), or null. */
export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  return m[0].replace(/[)\].,;:!?،؛]+$/, '');
}

/** Google-Maps links get a "Location" card; everything else a generic link card (domain + path, no network fetch). */
export default function LinkCard({ url, ar }) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const isMap = /(^|\.)google\.[a-z.]+$/.test(host) && /\/maps/.test(u.pathname) || host === 'maps.app.goo.gl' || host === 'goo.gl' && /maps/.test(u.pathname);
  const path = (u.pathname + u.search).replace(/\/$/, '');
  return (
    <a className={`lnk-card${isMap ? ' is-map' : ''}`} href={url} target="_blank" rel="noopener noreferrer nofollow">
      <span className="lnk-card__icon" aria-hidden="true">
        {isMap
          ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.7-1.7" /></svg>}
      </span>
      <span className="lnk-card__meta">
        <strong dir="ltr">{isMap ? (ar ? 'الموقع على الخريطة' : 'Location on map') : host}</strong>
        <span dir="ltr">{isMap ? host : (path.length > 1 ? path.slice(0, 60) : url.slice(0, 60))}</span>
      </span>
    </a>
  );
}
