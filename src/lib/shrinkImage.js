/**
 * Photos are shrunk right before they are uploaded (like WhatsApp): a 6 MB camera photo becomes ~300 KB, so ten photos
 * leave the phone in a second or two instead of a minute. Not touched: HD picks (file.uipHD), files the phone already
 * shrunk (file.uipShrunk), GIFs / SVG, small files, and anything the browser cannot decode (the original is sent).
 */
const MIN_BYTES = 600 * 1024;
const OK_TYPES = /^image\/(jpeg|png|webp)$/;

export const needsShrink = (f) => !!f && OK_TYPES.test(f.type || '') && !f.uipShrunk && !f.uipHD && f.size > MIN_BYTES;

export async function shrinkImageFile(file, { maxEdge = 1920, quality = 0.8 } = {}) {
  if (!needsShrink(file)) return file;
  let bmp = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width: w, height: h } = bmp;
    const texty = file.type === 'image/png' || Math.max(w, h) / Math.max(1, Math.min(w, h)) > 2; // screenshots keep more pixels so text stays sharp
    const scale = Math.min(1, (texty ? 2560 : maxEdge) / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(tw, th) : Object.assign(document.createElement('canvas'), { width: tw, height: th });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, tw, th);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size * 0.9) return file;
    const out = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
    if (file.uipView !== undefined) out.uipView = file.uipView;
    out.uipShrunk = true;
    return out;
  } catch {
    return file;
  } finally {
    try { bmp && bmp.close && bmp.close(); } catch { /* ignore */ }
  }
}

/** Shrinks all files, 3 at a time, keeping their order. */
export async function shrinkImages(files, concurrency = 3) {
  const out = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next; next += 1;
      out[i] = await shrinkImageFile(files[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}
