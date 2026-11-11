/**
 * Vercel Routing Middleware — بيشتغل على كل /api/* قبل ما vercel.json يعمل
 * rewrite للـ Railway.
 *
 * المشكلة: الـ Laravel API بيستقبل الطلب من سيرفرات Vercel (AWS Frankfurt) مش
 * من المستخدم، فكل الـ IPs/المواقع (Sessions، GeoIP، عدّادات الدخول الفاشلة)
 * كانت غلط. هنا بنقرأ الـ IP الحقيقي اللي Vercel شافه ونبعته للـ API موقّع
 * بـ HMAC-SHA256 باستخدام سر مشترك (UIP_PROXY_SECRET)، فالـ API يقدر يتأكد إن
 * الـ IP جاي من Vercel فعلًا مش من حد بيكلّم Railway مباشرة ومزوّر header.
 *
 *   x-uip-client-ip   : IP العميل
 *   x-uip-proxy-ts    : unix seconds (الـ API بيرفض لو أقدم/أحدث من 5 دقايق)
 *   x-uip-proxy-sig   : HMAC_SHA256(secret, "<ip>|<ts>") hex
 *
 * لو UIP_PROXY_SECRET مش مضبوط، مش بنضيف أي header (الـ API يكمل بالسلوك
 * القديم بدل ما يثق في حاجة غير موقّعة). أي قيمة x-uip-* جاية من العميل بتتمسح.
 */
/* global process, crypto, TextEncoder */
import { ipAddress, next } from '@vercel/functions';

export const config = { matcher: '/api/:path*' };

const enc = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function middleware(request) {
  const headers = new Headers(request.headers);

  // مفيش حاجة جاية من المتصفح تتصدّق.
  headers.delete('x-uip-client-ip');
  headers.delete('x-uip-proxy-ts');
  headers.delete('x-uip-proxy-sig');

  const secret = process.env.UIP_PROXY_SECRET;
  const ip = ipAddress(request);

  if (secret && ip) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers.set('x-uip-client-ip', ip);
    headers.set('x-uip-proxy-ts', ts);
    headers.set('x-uip-proxy-sig', await hmacHex(secret, `${ip}|${ts}`));
  }

  return next({ request: { headers } });
}
