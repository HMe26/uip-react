/**
 * Camera effects for the meeting room — colour filters, skin softening, background blur, and virtual backgrounds.
 *
 *   raw camera track -> hidden <video> -> canvas (look) -> canvas.captureStream() track (what peers receive)
 *
 * A "look" is { filter, background }: any colour filter combined with any background (none / blur / generated scene / your own
 * picture). The raw camera track is never touched, so "No effect" is just swapping the sender back to it. Frames are pumped by a
 * Worker timer (not requestAnimationFrame) so the picture does not freeze while the meeting tab is in the background.
 *
 * Backgrounds other than "none" need person segmentation: the MediaPipe selfie-segmentation build that ships with the app in
 * /public/mediapipe (same files the 1:1 calls use). It is loaded from OUR OWN origin on demand — the page's Content-Security-Policy
 * (script-src 'self') blocks any CDN, which is why the old CDN loader never worked. If it still cannot load, setLook() throws and the
 * caller keeps the plain camera; colour filters never need it.
 */

export const CAMERA_FILTERS = [
  { id: 'none', label: 'No effect', css: '' },
  { id: 'enhance', label: 'Enhance', css: 'brightness(1.06) contrast(1.1) saturate(1.18)', auto: 0.6 },
  // "Low light" measures the room and lifts the picture by however much it needs (more in a dark room, nothing in a bright one).
  { id: 'lowlight', label: 'Low light', css: 'brightness(1.12) contrast(1.08) saturate(1.05)', auto: 1 },
  { id: 'soft', label: 'Soft skin', css: 'brightness(1.05) saturate(1.05)', soften: true },
  { id: 'warm', label: 'Warm', css: 'sepia(0.22) saturate(1.2) brightness(1.05)' },
  { id: 'cool', label: 'Cool', css: 'hue-rotate(-10deg) saturate(1.1) brightness(1.04)' },
  { id: 'bw', label: 'Black & white', css: 'grayscale(1) contrast(1.12)' },
];

/** Deterministic pseudo-random so a generated scene always looks the same. */
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const grad = (c, W, H, stops, x0 = 0, y0 = 0, x1 = 0, y1 = H) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };

/** Generated scenes (no image files to ship). Each paints a full W x H frame. */
export const SCENES = {
  office(c, W, H) {
    c.fillStyle = grad(c, W, H, [[0, '#e9e4dc'], [1, '#cfc7ba']]); c.fillRect(0, 0, W, H);
    c.fillStyle = grad(c, W, H, [[0, '#9fd0f5'], [1, '#e6f3ff']], 0, H * 0.12, 0, H * 0.62); c.fillRect(W * 0.55, H * 0.12, W * 0.34, H * 0.5);
    c.strokeStyle = '#f7f4ee'; c.lineWidth = W * 0.012; c.strokeRect(W * 0.55, H * 0.12, W * 0.34, H * 0.5);
    c.beginPath(); c.moveTo(W * 0.72, H * 0.12); c.lineTo(W * 0.72, H * 0.62); c.moveTo(W * 0.55, H * 0.37); c.lineTo(W * 0.89, H * 0.37); c.stroke();
    c.fillStyle = '#8a6a4a'; c.fillRect(W * 0.06, H * 0.46, W * 0.3, H * 0.025); c.fillRect(W * 0.06, H * 0.26, W * 0.3, H * 0.025);
    const r = rng(7); const cols = ['#3b6ea5', '#c0504d', '#6a994e', '#e0b13c', '#7d5ba6', '#2f4858'];
    [0.26, 0.46].forEach((y) => { let x = W * 0.07; while (x < W * 0.34) { const bw = W * (0.012 + r() * 0.014); const bh = H * (0.07 + r() * 0.05); c.fillStyle = cols[Math.floor(r() * cols.length)]; c.fillRect(x, H * y - bh, bw, bh); x += bw + 2; } });
    c.fillStyle = '#6b4f36'; c.fillRect(W * 0.8, H * 0.7, W * 0.07, H * 0.3);
    c.fillStyle = '#3f7d4e'; for (let i = 0; i < 7; i += 1) { c.beginPath(); c.ellipse(W * 0.835 + (i - 3) * W * 0.012, H * 0.62 - i * H * 0.01, W * 0.018, H * 0.09, (i - 3) * 0.3, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = grad(c, W, H, [[0, '#b9aa95'], [1, '#9c8c76']], 0, H * 0.88, 0, H); c.fillRect(0, H * 0.88, W, H * 0.12);
  },
  studio(c, W, H) {
    c.fillStyle = '#12141b'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.45, W * 0.7); g.addColorStop(0, '#3a4263'); g.addColorStop(0.55, '#1c2033'); g.addColorStop(1, '#0c0d12');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.04)'; for (let i = 0; i < 6; i += 1) c.fillRect(W * (0.08 + i * 0.16), 0, W * 0.05, H);
  },
  sunset(c, W, H) {
    c.fillStyle = grad(c, W, H, [[0, '#2b1b4d'], [0.45, '#b43f6d'], [0.75, '#ff8a4c'], [1, '#ffd27a']]); c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff1c4'; c.beginPath(); c.arc(W * 0.72, H * 0.62, H * 0.14, 0, Math.PI * 2); c.fill();
    [['#4a2a5c', 0.74, 0.1], ['#2e1a42', 0.82, 0.07], ['#1b0f2b', 0.9, 0.05]].forEach(([col, base, amp], k) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 40) c.lineTo(x, H * base + Math.sin(x / W * (5 + k * 3) + k) * H * amp * 0.5);
      c.lineTo(W, H); c.closePath(); c.fill();
    });
  },
  ocean(c, W, H) {
    c.fillStyle = grad(c, W, H, [[0, '#8fd3f4'], [0.5, '#2e8bc0'], [1, '#0b3d66']]); c.fillRect(0, 0, W, H);
    for (let k = 0; k < 5; k += 1) {
      c.fillStyle = `rgba(255,255,255,${0.07 + k * 0.03})`; c.beginPath(); c.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 50) c.lineTo(x, H * (0.5 + k * 0.1) + Math.sin(x / W * 9 + k * 1.3) * H * 0.02);
      c.lineTo(W, H); c.closePath(); c.fill();
    }
  },
  forest(c, W, H) {
    c.fillStyle = grad(c, W, H, [[0, '#d7efe0'], [1, '#7fb99a']]); c.fillRect(0, 0, W, H);
    const r = rng(11);
    [['#8cc5a2', 0.55, 0.22], ['#4f9a6e', 0.7, 0.28], ['#256b48', 0.85, 0.34]].forEach(([col, base, size]) => {
      c.fillStyle = col;
      for (let x = -W * 0.05; x < W * 1.05; x += W * (0.05 + r() * 0.05)) { const h = H * size * (0.7 + r() * 0.6); c.beginPath(); c.moveTo(x, H * base + h * 0.2); c.lineTo(x + W * 0.035, H * base - h); c.lineTo(x + W * 0.07, H * base + h * 0.2); c.fill(); }
      c.fillRect(0, H * base + H * 0.04, W, H);
    });
  },
  city(c, W, H) {
    c.fillStyle = grad(c, W, H, [[0, '#0b1230'], [1, '#27346b']]); c.fillRect(0, 0, W, H);
    const r = rng(23); c.fillStyle = '#fff'; for (let i = 0; i < 60; i += 1) c.fillRect(r() * W, r() * H * 0.5, 1.5, 1.5);
    c.fillStyle = '#fdf6d3'; c.beginPath(); c.arc(W * 0.8, H * 0.18, H * 0.06, 0, Math.PI * 2); c.fill();
    let x = 0; while (x < W) {
      const bw = W * (0.05 + r() * 0.06); const bh = H * (0.25 + r() * 0.4);
      c.fillStyle = '#0d1530'; c.fillRect(x, H - bh, bw, bh);
      for (let wy = H - bh + 8; wy < H - 8; wy += 14) for (let wx = x + 5; wx < x + bw - 6; wx += 11) { if (r() > 0.55) { c.fillStyle = r() > 0.5 ? '#ffd76a' : '#9ad1ff'; c.fillRect(wx, wy, 5, 7); } }
      x += bw + 2;
    }
  },
  minimal(c, W, H) {
    c.fillStyle = grad(c, W, H, [[0, '#ffffff'], [1, '#dfe3ec']]); c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(81,95,255,0.08)'; c.beginPath(); c.arc(W * 0.85, H * 0.2, H * 0.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(81,95,255,0.06)'; c.beginPath(); c.arc(W * 0.1, H * 0.95, H * 0.35, 0, Math.PI * 2); c.fill();
  },
  space(c, W, H) {
    const g = c.createRadialGradient(W * 0.3, H * 0.4, 0, W * 0.5, H * 0.5, W * 0.8); g.addColorStop(0, '#2a1b5e'); g.addColorStop(1, '#05030f');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const r = rng(5); for (let i = 0; i < 140; i += 1) { c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; const s = r() * 2 + 0.5; c.fillRect(r() * W, r() * H, s, s); }
    const p = c.createRadialGradient(W * 0.8, H * 0.3, 0, W * 0.8, H * 0.3, H * 0.2); p.addColorStop(0, '#ffb26b'); p.addColorStop(1, '#a1402d');
    c.fillStyle = p; c.beginPath(); c.arc(W * 0.8, H * 0.3, H * 0.15, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,220,180,0.55)'; c.lineWidth = 4; c.beginPath(); c.ellipse(W * 0.8, H * 0.3, H * 0.26, H * 0.055, -0.35, 0, Math.PI * 2); c.stroke();
  },
};

export const CAMERA_BACKGROUNDS = [
  { id: 'none', label: 'None' },
  { id: 'blur-light', label: 'Light blur', blur: 8 },
  { id: 'blur-strong', label: 'Strong blur', blur: 20 },
  { id: 'office', label: 'Office', scene: 'office' },
  { id: 'studio', label: 'Studio', scene: 'studio' },
  { id: 'minimal', label: 'Minimal', scene: 'minimal' },
  { id: 'sunset', label: 'Sunset', scene: 'sunset' },
  { id: 'ocean', label: 'Ocean', scene: 'ocean' },
  { id: 'forest', label: 'Forest', scene: 'forest' },
  { id: 'city', label: 'Night city', scene: 'city' },
  { id: 'space', label: 'Space', scene: 'space' },
];

/** Small preview image (data URL) of a generated scene, for the picker. */
const previewCache = {};
export function scenePreview(sceneId) {
  if (previewCache[sceneId]) return previewCache[sceneId];
  try {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 72;
    SCENES[sceneId](cv.getContext('2d'), 128, 72);
    previewCache[sceneId] = cv.toDataURL('image/jpeg', 0.7);
  } catch { previewCache[sceneId] = ''; }
  return previewCache[sceneId];
}

export const cameraFxSupported = () => typeof document !== 'undefined'
  && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

import { heavyAssetOrigin } from './heavyAssets';

const SEG_BASE = `${heavyAssetOrigin()}/mediapipe/`; // APK: loaded from the website (see lib/heavyAssets.js)
const MASK_W = 256;
const MASK_H = 144;
let segLoad = null;

/** Loads /mediapipe/selfie_segmentation.js once (a classic script that defines window.SelfieSegmentation). */
function loadSegScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.SelfieSegmentation) return Promise.resolve(window.SelfieSegmentation);
  if (segLoad) return segLoad;
  segLoad = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = `${SEG_BASE}selfie_segmentation.js`;
    el.async = true;
    el.onload = () => (window.SelfieSegmentation ? resolve(window.SelfieSegmentation) : reject(new Error('segmentation missing')));
    el.onerror = () => reject(new Error('segmentation script failed'));
    document.head.appendChild(el);
  }).catch((e) => { segLoad = null; throw e; });
  return segLoad;
}

let segmenterPromise = null;
/** One shared segmenter for the whole tab. The result handler is swapped per camera-fx instance. */
function loadSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const SS = await loadSegScript();
      const seg = new SS({ locateFile: (f) => `${SEG_BASE}${f}` });
      seg.setOptions({ modelSelection: 1, selfieMode: false });
      seg.onResults((res) => { try { seg.__onResults && seg.__onResults(res); } catch { /* ignore a bad frame */ } });
      await seg.initialize();
      return seg;
    })().catch((e) => { segmenterPromise = null; throw e; });
  }
  return segmenterPromise;
}

/** A timer that keeps ticking in background tabs (Worker timers are not throttled like main-thread ones). */
function makeTicker(fn, ms) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = fn;
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

/** Draw an image/canvas to fill the frame ("cover"). */
function drawCover(c, src, sw, sh, W, H) {
  const k = Math.max(W / sw, H / sh);
  const dw = sw * k; const dh = sh * k;
  c.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/**
 * @param {MediaStreamTrack} rawTrack the real camera track
 * @returns {{ track: MediaStreamTrack, setLook: (look: {filter?: string, background?: string, image?: ImageBitmap}) => Promise<void>, stop: () => void }}
 */
export function createCameraFx(rawTrack) {
  const settings = rawTrack.getSettings ? rawTrack.getSettings() : {};
  const W = settings.width || 1280;
  const H = settings.height || 720;
  const FPS = Math.min(30, Math.round(settings.frameRate || 30));

  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.autoplay = true;
  video.srcObject = new MediaStream([rawTrack]);
  video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const out = canvas.captureStream(FPS);
  const track = out.getVideoTracks()[0];
  try { track.contentHint = 'motion'; } catch { /* optional */ }

  const personCanvas = document.createElement('canvas'); personCanvas.width = W; personCanvas.height = H;
  const pctx = personCanvas.getContext('2d');
  const bgCanvas = document.createElement('canvas'); bgCanvas.width = W; bgCanvas.height = H; // generated scene / custom picture, painted once
  const bctx = bgCanvas.getContext('2d');
  const maskCanvas = document.createElement('canvas'); // the smoothed person mask, as alpha, drawn with destination-in
  maskCanvas.width = MASK_W; maskCanvas.height = MASK_H;
  const mctx = maskCanvas.getContext('2d');
  const rawMask = document.createElement('canvas'); // the segmenter's own mask, read back to pixels
  rawMask.width = MASK_W; rawMask.height = MASK_H;
  const rctx = rawMask.getContext('2d', { willReadFrequently: true });
  let useAlpha = null;
  let prevAlpha = null;
  let segmenter = null;
  let haveMask = false;
  let segBusy = false;
  let lastSeg = 0;

  let filter = CAMERA_FILTERS[0];
  let bg = CAMERA_BACKGROUNDS[0];
  let stopped = false;

  function updateMask(result) {
    const m = result && result.segmentationMask;
    if (!m) return;
    rctx.clearRect(0, 0, MASK_W, MASK_H);
    rctx.drawImage(m, 0, 0, MASK_W, MASK_H);
    const d = rctx.getImageData(0, 0, MASK_W, MASK_H).data;
    if (useAlpha === null) {
      let minA = 255;
      for (let i = 3; i < d.length; i += 4) { if (d[i] < minA) minA = d[i]; }
      useAlpha = minA < 250; // the confidence lives either in alpha or in the red channel, depending on the build
    }
    const off = useAlpha ? 3 : 0;
    const n = MASK_W * MASK_H;
    if (!prevAlpha || prevAlpha.length !== n) prevAlpha = new Float32Array(n);
    // Polarity differs between model builds (mask = "person" vs "background"); the person is whatever sits in the middle of the frame.
    let centre = 0; let corners = 0; let nc = 0; let nk = 0;
    for (let y = Math.floor(MASK_H * 0.35); y < Math.floor(MASK_H * 0.75); y += 4) for (let x = Math.floor(MASK_W * 0.4); x < Math.floor(MASK_W * 0.6); x += 4) { centre += d[(y * MASK_W + x) * 4 + off]; nc += 1; }
    for (let y = 0; y < Math.floor(MASK_H * 0.2); y += 4) for (let x = 0; x < Math.floor(MASK_W * 0.15); x += 4) { corners += d[(y * MASK_W + x) * 4 + off]; nk += 1; }
    const invert = nc && nk ? (centre / nc) < (corners / nk) : false;
    const img = mctx.createImageData(MASK_W, MASK_H);
    for (let i = 0; i < n; i += 1) {
      let p = d[i * 4 + off] / 255;
      if (invert) p = 1 - p;
      const a = Math.max(0, Math.min(1, (p - 0.4) / 0.25));       // soft threshold
      prevAlpha[i] = prevAlpha[i] * 0.4 + a * 0.6;                  // temporal smoothing: no flicker on the edges
      img.data[i * 4 + 3] = Math.round(prevAlpha[i] * 255);
    }
    mctx.putImageData(img, 0, 0);
    haveMask = true;
  }

  function paintBackground(look) {
    bctx.filter = 'none';
    bctx.clearRect(0, 0, W, H);
    if (look.image) drawCover(bctx, look.image, look.image.width, look.image.height, W, H);
    else if (look.scene) SCENES[look.scene](bctx, W, H);
  }

  // ---- auto exposure for the "Low light" / "Enhance" filters: a 16x9 thumbnail every ~15 frames, eased so the picture never "pumps" ----
  const probe = document.createElement('canvas'); probe.width = 16; probe.height = 9;
  const pr = probe.getContext('2d', { willReadFrequently: true });
  let autoGain = 1; let frameNo = 0;
  function measureLight() {
    try {
      pr.drawImage(video, 0, 0, 16, 9);
      const d = pr.getImageData(0, 0, 16, 9).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const avg = Math.max(0.05, sum / (d.length / 4));
      const target = Math.min(1.9, Math.max(1, 0.5 / avg)); // aim for a comfortably lit face, never blow out
      autoGain += (target - autoGain) * 0.25;
    } catch { /* keep the last value */ }
  }

  function drawFiltered(c, extraCss = '') {
    frameNo += 1;
    let css = filter.css || '';
    if (filter.auto) {
      if (frameNo % 15 === 1) measureLight();
      const gain = 1 + (autoGain - 1) * filter.auto;
      css = `${css} brightness(${gain.toFixed(3)})`.trim();
    }
    css = `${css} ${extraCss}`.trim();
    c.filter = css || 'none';
    c.drawImage(video, 0, 0, W, H);
    c.filter = 'none';
    if (filter.soften && !extraCss) {
      c.globalAlpha = 0.45;
      c.filter = 'blur(2.5px) brightness(1.04)';
      c.drawImage(video, 0, 0, W, H);
      c.filter = 'none';
      c.globalAlpha = 1;
    }
  }

  function draw() {
    if (stopped || video.readyState < 2) return;
    const now = performance.now();
    const wantsBg = bg.id !== 'none';

    if (wantsBg && segmenter && now - lastSeg > 50 && !segBusy) {
      segBusy = true; lastSeg = now;
      try {
        segmenter.__onResults = (res) => { updateMask(res); segBusy = false; };
        Promise.resolve(segmenter.send({ image: video })).catch(() => { segBusy = false; });
      } catch { segBusy = false; }
    }

    if (wantsBg && segmenter && haveMask) {
      // 1) the new background
      // (blurred backdrop gets the colour filter too, otherwise a B&W / warm look would only apply to the person)
      if (bg.blur) drawFiltered(ctx, `blur(${bg.blur}px)`);
      else ctx.drawImage(bgCanvas, 0, 0, W, H);
      // 2) the person (filtered camera frame cut out with the soft mask)
      pctx.globalCompositeOperation = 'source-over';
      pctx.clearRect(0, 0, W, H);
      drawFiltered(pctx);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.filter = 'blur(1.5px)';
      pctx.drawImage(maskCanvas, 0, 0, W, H);
      pctx.filter = 'none';
      ctx.drawImage(personCanvas, 0, 0, W, H);
      return;
    }
    drawFiltered(ctx);
  }

  const stopTicker = makeTicker(draw, Math.round(1000 / FPS));

  return {
    track,
    async setLook(look = {}) {
      const nextFilter = CAMERA_FILTERS.find((f) => f.id === (look.filter || 'none')) || CAMERA_FILTERS[0];
      const nextBg = look.background === 'custom'
        ? { id: 'custom', label: 'Custom', image: look.image }
        : (CAMERA_BACKGROUNDS.find((b) => b.id === (look.background || 'none')) || CAMERA_BACKGROUNDS[0]);
      if (nextBg.id !== 'none' && !segmenter) segmenter = await loadSegmenter(); // throws if the model cannot be fetched
      if (nextBg.scene || nextBg.image) paintBackground({ scene: nextBg.scene, image: nextBg.image });
      if (nextBg.id !== bg.id) { haveMask = false; prevAlpha = null; } // a filter-only change keeps the current mask: no flash of the plain camera
      filter = nextFilter;
      bg = nextBg;
    },
    stop() {
      stopped = true;
      stopTicker();
      try { track.stop(); } catch { /* already stopped */ }
      try { video.srcObject = null; } catch { /* ignore */ }
    },
  };
}
