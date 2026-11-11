import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from '../api/client';

// Android app download link, set by the admin in Platform Policy → "Mobile app download".
// Read from the public GET /api/v1/platform/status. Returns { url, version, native } while a link is set, otherwise null.
// Inside the Android app `native` is true: the UI then offers "Share the app" (see components/AppDownloadLink.jsx) instead of a download.
const TTL = 60 * 1000;
let cache = null;
let cachedAt = 0;
let inflight = null;

function load() {
  if (cache && Date.now() - cachedAt < TTL) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api.get('/api/v1/platform/status')
      .then((json) => {
        const url = String(json?.data?.app_download_url || '').trim();
        cache = { url, version: String(json?.data?.app_download_version || '').trim() };
        cachedAt = Date.now();
        return cache;
      })
      .catch(() => cache || { url: '', version: '' })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export default function useAppDownload() {
  const [info, setInfo] = useState(cache);
  useEffect(() => {
    let alive = true;
    load().then((v) => { if (alive) setInfo(v); });
    return () => { alive = false; };
  }, []);
  if (!info || !/^https:\/\//i.test(info.url)) return null;
  return { ...info, native: Capacitor.isNativePlatform() };
}
