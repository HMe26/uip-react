/**
 * Heavy offline assets (OCR engine + language data, MediaPipe background-blur model: ~28 MB) are NOT packed into the Android APK
 * (scripts/slim-native.mjs removes them from dist/). Inside the app they are fetched from the website the first time the feature is
 * used, and the browser/WebView caches them afterwards. On the website itself they are served from the same origin, as before.
 * The site sends Access-Control-Allow-Origin for /ocr/* and /mediapipe/* (vercel.json / netlify.toml) so the app can read them.
 */
import { Capacitor } from '@capacitor/core';
import { publicOrigin } from '../config/siteUrl';

/** '' on the web (same origin); the public site origin inside the APK. No trailing slash. */
export const heavyAssetOrigin = () => (Capacitor.isNativePlatform() ? publicOrigin() : '');
