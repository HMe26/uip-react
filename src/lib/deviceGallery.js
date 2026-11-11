/**
 * Phone gallery for the chat attach sheet (Android app only).
 * Native side: native/android/NativeGalleryPlugin.java. In a normal browser there is no such plugin
 * (websites are not allowed to list a visitor's photos) - hasDeviceGallery() is false and the sheet
 * falls back to the system photo picker, which already has albums and multi-select on phones.
 *
 * Every call rejects on an old APK without the plugin, so callers treat a rejection as "unsupported".
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from '../native';

const Gallery = isNative ? registerPlugin('NativeGallery') : null;
export const hasDeviceGallery = () => !!Gallery;

const local = (path) => (path ? Capacitor.convertFileSrc(path) : '');

export const galleryAccess = async () => (await Gallery.access()).state;          // granted | limited | denied | prompt
export const galleryRequestAccess = async () => (await Gallery.requestAccess()).state;
export const galleryOpenSettings = () => Gallery.openSettings();
export const galleryAlbums = async () => (await Gallery.albums()).albums || [];
export const galleryList = (album, offset, limit = 90) => Gallery.list({ album, offset, limit });

// ---- thumbnails: remembered in memory, 4 at a time ---------------------------------------------------------------
const thumbCache = new Map();
const queue = [];
let running = 0;
const pump = () => {
  while (running < 4 && queue.length) {
    const job = queue.shift();
    running += 1;
    Gallery.thumb({ id: job.id, kind: job.kind, size: job.size })
      .then((r) => job.resolve(local(r.path)), () => job.resolve(''))
      .finally(() => { running -= 1; pump(); });
  }
};
export function galleryThumb(id, kind, size = 200) {
  const key = `${kind}:${id}:${size}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = new Promise((resolve) => { queue.push({ id, kind, size, resolve }); pump(); });
  thumbCache.set(key, p);
  if (thumbCache.size > 700) thumbCache.delete(thumbCache.keys().next().value);
  return p;
}

/**
 * Turns the picked items into ready-to-send Files. The phone does the heavy part (decode, rotate, shrink to
 * 1920 px / JPEG, 3 photos at once; videos are copied untouched), then each result is read back as a File.
 * Files carry uipShrunk = true so the upload step does not shrink them a second time.
 */
export async function galleryPrepare(items, { hd = false } = {}) {
  const res = await Gallery.prepare({
    hd,
    items: items.map((i) => ({ id: i.id, kind: i.kind, mime: i.mime, name: i.name, size: i.size })),
  });
  const rows = res.files || [];
  const files = await Promise.all(rows.map(async (r) => {
    const blob = await (await fetch(local(r.path))).blob();
    const file = new File([blob], r.name, { type: r.mime || blob.type, lastModified: Date.now() });
    if (r.shrunk) file.uipShrunk = true;
    if (hd) file.uipHD = true;
    return file;
  }));
  Gallery.release({ paths: rows.map((r) => r.path) }).catch(() => {});
  return files;
}
