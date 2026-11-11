/**
 * Live video effects for calls — no network, no heavy library on the main bundle.
 *
 *   camera track -> hidden <video> -> WebGL2 (one fragment shader) -> canvas.captureStream() -> what the peer receives
 *
 * One shader does everything in a single GPU pass at the camera's own resolution (up to 1280 px wide — it is NOT downscaled any more):
 *   - proper colour grading (exposure, contrast, saturation, warmth/tint, shadow lift, highlight roll-off, teal/orange split-tone, fade, vignette)
 *   - edge-preserving skin smoothing (bilateral filter, applied only to skin-coloured pixels so eyes/hair/edges stay sharp)
 *   - gentle unsharp mask for a crisper picture
 *   - background blur with a real person mask (MediaPipe selfie segmentation, loaded on demand from /mediapipe/);
 *     until the model is ready (or if it cannot load) a soft "focus" oval is used instead
 *   - an "intensity" slider: every preset is mixed with the untouched frame
 *   - cheap auto-exposure for the presets that ask for it
 *
 * It is only created when an effect is picked; with "none" the raw camera track goes out untouched.
 * Needs WebGL2 + canvas.captureStream (all current Chrome / Edge / Firefox / Safari 15+ / Android WebView).
 * Frames are produced from a timer, so a background tab sends ~1 fps while an effect is on.
 */

/**
 * Picker order + labels (en / ar). `sw` is the swatch painted on the picker card.
 * `p` are the shader parameters; `auto` = adapt exposure to the room light; `blur` = background blur.
 */
export const FILTER_LIST = [
  { id: 'none', en: 'Original', ar: 'الأصلي', sw: 'linear-gradient(135deg,#8b94a3 0%,#c9d0da 100%)', p: {} },
  { id: 'enhance', en: 'Enhance', ar: 'تحسين تلقائي', sw: 'linear-gradient(135deg,#f7d9b0 0%,#e8a87c 55%,#7aa7c7 100%)', auto: true,
    p: { con: 1.07, sat: 1.1, temp: 0.05, lift: 0.6, high: 0.5, sharp: 0.5 } },
  { id: 'soft', en: 'Soft skin', ar: 'بشرة ناعمة', sw: 'linear-gradient(135deg,#ffe3d3 0%,#f6bfa6 60%,#f1a98f 100%)', auto: true,
    p: { exp: 0.05, con: 1.02, sat: 1.05, temp: 0.07, lift: 0.5, high: 0.4, sharp: 0.2, smooth: 0.8 } },
  { id: 'studio', en: 'Studio light', ar: 'إضاءة استوديو', sw: 'linear-gradient(135deg,#fff6e0 0%,#f2d9a8 50%,#46506a 100%)', auto: true,
    p: { exp: 0.06, con: 1.12, sat: 1.06, lift: 0.8, high: 0.9, sharp: 0.55, vig: 0.2, smooth: 0.3 } },
  { id: 'warm', en: 'Warm', ar: 'دافئ', sw: 'linear-gradient(135deg,#ffd9a0 0%,#f09a5a 100%)',
    p: { exp: 0.06, con: 1.05, sat: 1.12, temp: 0.55, tint: 0.05, lift: 0.3, sharp: 0.3 } },
  { id: 'cool', en: 'Cool', ar: 'بارد', sw: 'linear-gradient(135deg,#cfe6ff 0%,#6b9fd8 100%)',
    p: { exp: 0.04, con: 1.05, sat: 1.05, temp: -0.5, tint: -0.04, sharp: 0.3 } },
  { id: 'cinema', en: 'Cinematic', ar: 'سينمائي', sw: 'linear-gradient(135deg,#1f6f78 0%,#2a2f3c 50%,#e08a4a 100%)',
    p: { exp: -0.02, con: 1.14, sat: 0.92, teal: 0.9, fade: 0.06, vig: 0.3, sharp: 0.25 } },
  { id: 'mono', en: 'B&W', ar: 'أبيض وأسود', sw: 'linear-gradient(135deg,#f2f2f2 0%,#777 55%,#111 100%)',
    p: { exp: 0.05, con: 1.18, mono: 1, vig: 0.15, sharp: 0.35 } },
  { id: 'blur', en: 'Blur background', ar: 'تمويه الخلفية', sw: 'radial-gradient(circle at 50% 45%,#e9c9a8 0 22%,#7f8aa0 23% 100%)', auto: true, blur: true,
    p: { exp: 0.04, con: 1.04, sat: 1.05, sharp: 0.35, smooth: 0.25 } },
];

const FILTER_BY_ID = Object.fromEntries(FILTER_LIST.map((f) => [f.id, f]));

let supportCache = null;
export function supportsVideoFx() {
  if (supportCache !== null) return supportCache;
  try {
    if (typeof document === 'undefined') return (supportCache = false);
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    supportCache = !!gl && typeof c.captureStream === 'function';
    try { const lose = gl && gl.getExtension('WEBGL_lose_context'); lose && lose.loseContext(); } catch { /* ignore */ }
  } catch {
    supportCache = false;
  }
  return supportCache;
}

// Heavy per-pixel work (blur taps, skin filter) at full 720p/30 fps froze weaker phones: cap the processed picture and frame rate there.
const IS_MOBILE = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
const MAX_W = IS_MOBILE ? 640 : 960;
const FPS = IS_MOBILE ? 24 : 30;
const MASK_W = 256;
const MASK_H = 144;
import { heavyAssetOrigin } from '../heavyAssets';

const SEG_BASE = `${heavyAssetOrigin()}/mediapipe/`; // APK: loaded from the website (see lib/heavyAssets.js)

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec2 uPx;
uniform float uAmount, uExp, uCon, uSat, uTemp, uTint, uLift, uHigh, uSharp, uSmooth, uVig, uFade, uMono, uTeal, uBlur;

float L(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float skinMask(vec3 c) {
  float y = L(c);
  float cb = 0.5 + (c.b - y) * 0.5389;
  float cr = 0.5 + (c.r - y) * 0.6350;
  float s = smoothstep(0.28, 0.32, cb) * (1.0 - smoothstep(0.48, 0.52, cb));
  s *= smoothstep(0.50, 0.54, cr) * (1.0 - smoothstep(0.66, 0.70, cr));
  return s * smoothstep(0.10, 0.22, y);
}

void main() {
  vec3 c0 = texture(uTex, vUv).rgb;
  vec3 c = c0;

  // ---- background blur (person stays sharp) ----
  if (uBlur > 0.5) {
    float m = smoothstep(0.30, 0.70, texture(uMask, vUv).r);
    vec3 b = vec3(0.0);
    for (int k = 0; k < 12; k++) {
      float fk = float(k);
      float r = sqrt((fk + 0.5) / 12.0) * 16.0;
      float a = fk * 2.39996323;
      b += textureLod(uTex, vUv + vec2(cos(a), sin(a)) * r * uPx, 2.5).rgb;
    }
    b = (b / 12.0) * 0.97;
    c = mix(b, c0, m);
  }

  // ---- skin smoothing (edge-preserving) + sharpening ----
  if (uSmooth > 0.0 || uSharp > 0.0) {
    float sk = skinMask(c0);
    if (uSmooth > 0.0 && sk > 0.01) {
      vec3 sum = vec3(0.0);
      float ws = 0.0;
      float l0 = L(c0);
      for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
          vec3 s = texture(uTex, vUv + vec2(float(i), float(j)) * uPx * 2.4).rgb;
          float d = L(s) - l0;
          float w = exp(-d * d * 160.0) * exp(-float(i * i + j * j) * 0.12);
          sum += s * w;
          ws += w;
        }
      }
      c = mix(c, sum / ws, uSmooth * sk);
    }
    if (uSharp > 0.0) {
      vec3 avg = (texture(uTex, vUv + vec2(uPx.x, 0.0)).rgb + texture(uTex, vUv - vec2(uPx.x, 0.0)).rgb
                + texture(uTex, vUv + vec2(0.0, uPx.y)).rgb + texture(uTex, vUv - vec2(0.0, uPx.y)).rgb) * 0.25;
      c += (c0 - avg) * uSharp * (1.0 - sk * uSmooth);
    }
  }

  // ---- colour grading ----
  c *= exp2(uExp);
  c.r += uTemp * 0.07;
  c.b -= uTemp * 0.07;
  c.g += uTint * 0.05;
  float l = L(c);
  c += uLift * (1.0 - smoothstep(0.0, 0.5, l)) * 0.10;     // open the shadows
  c -= uHigh * smoothstep(0.65, 1.0, l) * 0.08;             // roll the highlights off
  c = (c - 0.5) * uCon + 0.5;
  l = L(c);
  c = mix(vec3(l), c, uSat);
  c += uTeal * ((1.0 - l) * vec3(-0.035, 0.015, 0.05) + l * vec3(0.05, 0.02, -0.04));
  c = c * (1.0 - uFade) + uFade * 0.07;
  c = mix(c, vec3(L(c)), uMono);
  float v = distance(vUv, vec2(0.5)) * 1.35;
  c *= 1.0 - uVig * smoothstep(0.35, 1.0, v);

  c = mix(c0, c, uAmount);
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; // dither: no banding in gradients
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const UNIFORMS = ['uAmount', 'uExp', 'uCon', 'uSat', 'uTemp', 'uTint', 'uLift', 'uHigh', 'uSharp', 'uSmooth', 'uVig', 'uFade', 'uMono', 'uTeal', 'uBlur'];

let segLoad = null;
/** Loads the MediaPipe selfie-segmentation script from our own origin (once). Rejects if it is missing/blocked. */
function loadSegmentation() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.SelfieSegmentation) return Promise.resolve(window.SelfieSegmentation);
  if (segLoad) return segLoad;
  segLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${SEG_BASE}selfie_segmentation.js`;
    s.async = true;
    s.onload = () => (window.SelfieSegmentation ? resolve(window.SelfieSegmentation) : reject(new Error('segmentation missing')));
    s.onerror = () => reject(new Error('segmentation script failed'));
    document.head.appendChild(s);
  }).catch((e) => { segLoad = null; throw e; });
  return segLoad;
}

/** A soft oval in the middle of the frame: the stand-in "person" mask until the real model answers. */
function ovalMask() {
  const a = new Uint8Array(MASK_W * MASK_H);
  for (let y = 0; y < MASK_H; y += 1) {
    for (let x = 0; x < MASK_W; x += 1) {
      const dx = (x / MASK_W - 0.5) / 0.30;
      const dy = (y / MASK_H - 0.55) / 0.52;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = Math.min(1, Math.max(0, (d - 0.75) / 0.5));
      a[y * MASK_W + x] = Math.round((1 - t * t * (3 - 2 * t)) * 255);
    }
  }
  return a;
}

/** @returns {{attach:(track:MediaStreamTrack, filter:string, amount?:number)=>MediaStreamTrack|null, setAmount:(a:number)=>void, stop:()=>void}} */
export function createVideoFx() {
  if (!supportsVideoFx()) return { attach: () => null, setAmount() {}, stop() {} };

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) return { attach: () => null, setAmount() {}, stop() {} };

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
    return sh;
  }
  let prog;
  const loc = {};
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    UNIFORMS.forEach((n) => { loc[n] = gl.getUniformLocation(prog, n); });
    loc.uTex = gl.getUniformLocation(prog, 'uTex');
    loc.uMask = gl.getUniformLocation(prog, 'uMask');
    loc.uPx = gl.getUniformLocation(prog, 'uPx');
  } catch (e) {
    try { console.warn('[call] video effects unavailable:', e && e.message); } catch { /* diagnostics only */ }
    return { attach: () => null, setAmount() {}, stop() {} };
  }

  function makeTex(unit, minFilter) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const vidTex = makeTex(0, gl.LINEAR); // mip-mapped only while background blur is on (an un-generated mip chain would sample black)
  const maskTex = makeTex(1, gl.LINEAR);
  gl.uniform1i(loc.uTex, 0);
  gl.uniform1i(loc.uMask, 1);

  // person mask (0..255), temporally smoothed; starts as the oval stand-in
  let mask = ovalMask();
  let maskDirty = true;
  gl.activeTexture(gl.TEXTURE1);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_W, MASK_H, 0, gl.RED, gl.UNSIGNED_BYTE, mask);

  let filter = 'none';
  let amount = 1;
  let src = null;
  let out = null;
  let timer = 0;
  let stopped = false;
  let texW = 0;
  let texH = 0;
  let lastTime = -1;
  let frameNo = 0;
  let mipOn = false;

  // ---- auto exposure: a 16x9 thumbnail every 20 frames, eased so the picture never "pumps" ----
  const probe = document.createElement('canvas');
  probe.width = 16;
  probe.height = 9;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  let autoExp = 0;
  function measureLight() {
    try {
      pctx.drawImage(video, 0, 0, 16, 9);
      const d = pctx.getImageData(0, 0, 16, 9).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const avg = Math.max(0.04, sum / (d.length / 4));
      const target = Math.min(0.45, Math.max(-0.25, Math.log2(0.46 / avg))) * 0.7; // aim for a comfortably lit face, never blow out
      autoExp += (Math.min(0.6, target) - autoExp) * 0.25;
    } catch { /* keep the last value */ }
  }

  // ---- background segmentation (lazy) ----
  let seg = null;
  let segState = 'idle'; // idle | loading | ready | failed
  let segBusy = false;
  let useAlpha = null;
  const mcan = document.createElement('canvas');
  mcan.width = MASK_W;
  mcan.height = MASK_H;
  const mctx = mcan.getContext('2d', { willReadFrequently: true });

  function onSegResults(res) {
    segBusy = false;
    if (stopped || !res || !res.segmentationMask) return;
    try {
      mctx.clearRect(0, 0, MASK_W, MASK_H);
      mctx.drawImage(res.segmentationMask, 0, 0, MASK_W, MASK_H);
      const d = mctx.getImageData(0, 0, MASK_W, MASK_H).data;
      if (useAlpha === null) {
        let minA = 255;
        for (let i = 3; i < d.length; i += 4) { if (d[i] < minA) minA = d[i]; }
        useAlpha = minA < 250; // the confidence lives either in alpha or in the red channel, depending on the build
      }
      const off = useAlpha ? 3 : 0;
      for (let i = 0, p = 0; p < mask.length; i += 4, p += 1) mask[p] = Math.round(mask[p] * 0.35 + d[i + off] * 0.65);
      maskDirty = true;
    } catch { /* keep the previous mask */ }
  }

  async function ensureSeg() {
    if (segState !== 'idle') return;
    segState = 'loading';
    try {
      const SS = await loadSegmentation();
      if (stopped) return;
      seg = new SS({ locateFile: (f) => `${SEG_BASE}${f}` });
      seg.setOptions({ modelSelection: 1, selfieMode: false });
      seg.onResults(onSegResults);
      await seg.initialize();
      if (stopped) { try { seg.close(); } catch { /* ignore */ } seg = null; return; }
      mask = new Uint8Array(mask); // start from the oval, converge to the real mask in a few frames
      segState = 'ready';
    } catch (e) {
      segState = 'failed'; // the soft oval keeps working
      try { console.warn('[call] background segmentation unavailable, using the soft focus oval:', e && e.message); } catch { /* diagnostics only */ }
    }
  }

  function resize() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const k = Math.min(1, MAX_W / vw);
    const w = Math.max(2, Math.round((vw * k) / 2) * 2);
    const h = Math.max(2, Math.round((vh * k) / 2) * 2);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    return true;
  }

  function setUniforms(def) {
    const p = def.p || {};
    const wantBlur = !!def.blur;
    gl.uniform1f(loc.uAmount, amount);
    gl.uniform1f(loc.uExp, (p.exp || 0) + (def.auto ? autoExp : 0));
    gl.uniform1f(loc.uCon, p.con == null ? 1 : p.con);
    gl.uniform1f(loc.uSat, p.sat == null ? 1 : p.sat);
    gl.uniform1f(loc.uTemp, p.temp || 0);
    gl.uniform1f(loc.uTint, p.tint || 0);
    gl.uniform1f(loc.uLift, p.lift || 0);
    gl.uniform1f(loc.uHigh, p.high || 0);
    gl.uniform1f(loc.uSharp, p.sharp || 0);
    gl.uniform1f(loc.uSmooth, p.smooth || 0);
    gl.uniform1f(loc.uVig, p.vig || 0);
    gl.uniform1f(loc.uFade, p.fade || 0);
    gl.uniform1f(loc.uMono, p.mono || 0);
    gl.uniform1f(loc.uTeal, p.teal || 0);
    gl.uniform1f(loc.uBlur, wantBlur ? 1 : 0);
  }

  function draw() {
    if (stopped || video.readyState < 2 || !resize()) return;
    if (video.currentTime === lastTime) return; // no new camera frame yet
    lastTime = video.currentTime;
    if (gl.isContextLost && gl.isContextLost()) return;
    const def = FILTER_BY_ID[filter] || FILTER_BY_ID.none;
    frameNo += 1;
    if (def.auto && frameNo % 20 === 1) measureLight();

    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vidTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      if (vw !== texW || vh !== texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        texW = vw;
        texH = vh;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }
      if (!!def.blur !== mipOn) {
        mipOn = !!def.blur;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipOn ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      }
      if (mipOn) gl.generateMipmap(gl.TEXTURE_2D);

      if (def.blur) {
        if (segState === 'idle') ensureSeg();
        if (segState === 'ready' && !segBusy && frameNo % 3 === 0) {
          segBusy = true;
          Promise.resolve(seg.send({ image: video })).catch(() => { segBusy = false; });
        }
      }
      if (maskDirty) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MASK_W, MASK_H, gl.RED, gl.UNSIGNED_BYTE, mask);
        maskDirty = false;
      }

      gl.uniform2f(loc.uPx, 1 / canvas.width, 1 / canvas.height);
      setUniforms(def);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } catch { /* a frame that fails to draw is simply skipped */ }
  }

  return {
    attach(track, f, a) {
      if (stopped || !track) return null;
      filter = FILTER_BY_ID[f] ? f : 'none';
      if (typeof a === 'number' && Number.isFinite(a)) amount = Math.min(1, Math.max(0, a));
      if (src !== track) {
        src = track;
        lastTime = -1;
        video.srcObject = new MediaStream([track]);
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
      }
      if (!out) {
        out = canvas.captureStream(FPS).getVideoTracks()[0] || null;
        if (!out) return null;
        try { out.contentHint = 'motion'; } catch { /* optional */ }
        timer = setInterval(draw, IS_MOBILE ? 33 : 16); // checked at ~60 Hz, but only a NEW camera frame is drawn
      }
      return out;
    },
    setAmount(a) {
      if (typeof a === 'number' && Number.isFinite(a)) amount = Math.min(1, Math.max(0, a));
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = 0;
      try { out && out.stop(); } catch { /* ignore */ }
      out = null;
      try { video.srcObject = null; } catch { /* ignore */ }
      try { seg && seg.close(); } catch { /* ignore */ }
      seg = null;
      try { const lose = gl.getExtension('WEBGL_lose_context'); lose && lose.loseContext(); } catch { /* ignore */ }
    },
  };
}
