/**
 * Netlify equivalent of middleware.js (Vercel): forwards /api/* to the Laravel API and tells it the REAL visitor IP,
 * signed with the shared secret, so sessions / GeoIP / login rate limits see each user and not Netlify's servers.
 *
 *   x-uip-client-ip : visitor IP        x-uip-proxy-ts : unix seconds        x-uip-proxy-sig : HMAC_SHA256(secret, "<ip>|<ts>")
 *
 * Needs the Netlify environment variable UIP_PROXY_SECRET (the SAME value as UIP_PROXY_SECRET on Railway).
 * Without it this function steps aside (returns nothing) and the plain [[redirects]] proxy in netlify.toml handles /api/*,
 * exactly as before, but the API then sees Netlify's IP instead of the visitor's.
 * Optional variable: API_ORIGIN (defaults to the Railway URL below).
 */
const DEFAULT_ORIGIN = 'https://uip-laravel-production.up.railway.app';
const enc = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async (request, context) => {
  const secret = Netlify.env.get('UIP_PROXY_SECRET');
  if (!secret || !context.ip) return; // not configured: let the redirect rule proxy it

  const url = new URL(request.url);
  const origin = (Netlify.env.get('API_ORIGIN') || DEFAULT_ORIGIN).replace(/\/+$/, '');

  const headers = new Headers(request.headers);
  for (const h of ['host', 'x-uip-client-ip', 'x-uip-proxy-ts', 'x-uip-proxy-sig']) headers.delete(h); // nothing from the browser is trusted
  const ts = String(Math.floor(Date.now() / 1000));
  headers.set('x-uip-client-ip', context.ip);
  headers.set('x-uip-proxy-ts', ts);
  headers.set('x-uip-proxy-sig', await hmacHex(secret, `${context.ip}|${ts}`));

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(origin + url.pathname + url.search, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    duplex: 'half',
  });

  const out = new Headers(upstream.headers);
  out.delete('content-encoding'); // fetch already decoded the body
  out.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
};

export const config = { path: '/api/*' };
