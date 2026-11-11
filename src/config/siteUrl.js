import { Capacitor } from '@capacitor/core';

/**
 * Public address of the web site, for links and QR codes that people open OUTSIDE the app.
 * Inside the Android APK the page origin is "http://localhost", which must never end up on a certificate.
 * Set VITE_PUBLIC_SITE_URL (e.g. https://uip-nub.vercel.app) to override the default below.
 */
const DEFAULT_SITE = 'https://uip-nub.vercel.app';

export function publicOrigin() {
  const configured = String(import.meta.env.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (Capacitor.isNativePlatform()) return DEFAULT_SITE;
  return window.location.origin;
}
