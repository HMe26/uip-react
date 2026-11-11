import Icon from '../Icon';
import { safeHref } from '../../lib/safeUrl';

/** Known sites get their own name, colour and icon; everything else shows the host. */
const BRANDS = [
  [/(^|\.)gemini\.google\.com$/, 'Gemini', '#4285f4', 'ai-spark'],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, 'ChatGPT', '#10a37f', 'chat'],
  [/(^|\.)(claude\.ai|anthropic\.com)$/, 'Claude', '#d97757', 'ai-spark'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', '#ff0033', 'video'],
  [/(^|\.)github\.com$/, 'GitHub', '#24292f', 'terminal'],
  [/(^|\.)gitlab\.com$/, 'GitLab', '#fc6d26', 'terminal'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn', '#0a66c2', 'users'],
  [/(^|\.)(drive|docs)\.google\.com$/, 'Google Drive', '#1a73e8', 'file'],
  [/(^|\.)(twitter|x)\.com$/, 'X', '#111827', 'message'],
  [/(^|\.)(facebook|fb)\.com$/, 'Facebook', '#1877f2', 'users'],
  [/(^|\.)figma\.com$/, 'Figma', '#a259ff', 'ed-pen'],
  [/(^|\.)(vercel\.app|netlify\.app|pages\.dev)$/, 'Website', '#0ea5e9', 'globe'],
];

export function parseLink(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, '');
    const brand = BRANDS.find(([re]) => re.test(host));
    const path = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
    return { host, path, href: u.href, name: brand ? brand[1] : host, color: brand ? brand[2] : '#3b5bdb', icon: brand ? brand[3] : 'globe', known: !!brand };
  } catch { return null; }
}

/** Rich card for a post's link: site tile, name, address and an open arrow (always LTR — addresses are Latin). */
export default function LinkCard({ url, compact = false }) {
  const l = parseLink(url);
  if (!l) return null;
  const shown = `${l.host}${l.path}`;
  return (
    <a className={`pp-lk${compact ? ' is-compact' : ''}`} dir="ltr" href={safeHref(l.href)} target="_blank" rel="noopener noreferrer nofollow" style={{ '--lk': l.color }}>
      <span className="pp-lk__ico"><Icon name={l.icon} size={compact ? 18 : 22} /></span>
      <span className="pp-lk__txt">
        <strong>{l.name}</strong>
        <span title={l.href}>{shown.length > 70 ? `${shown.slice(0, 69)}…` : shown}</span>
      </span>
      <span className="pp-lk__go" aria-hidden="true"><Icon name="external-link" size={16} /></span>
    </a>
  );
}
