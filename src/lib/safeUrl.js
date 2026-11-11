/**
 * Links that come from user input (course material URL, project links, feed links, university website,
 * notification links...) must never become javascript:/data:/vbscript: hrefs. Only http(s), mailto, tel and
 * same-site paths pass; anything else becomes '#'. (CSP already blocks inline script URLs in modern browsers —
 * this is the second line of defence, and keeps the link from being clickable at all.)
 */
const OK = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

export function safeHref(url) {
  const s = String(url == null ? '' : url).trim();
  // control chars / whitespace tricks like "java\tscript:" are removed by browsers, so reject them outright
  if (!s || /[\u0000-\u001f\u007f]/.test(s)) return '#';
  return OK.test(s) ? s : '#';
}
