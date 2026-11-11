import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../context/LanguageContext';
import { AutoSubError, generateAutoSubtitles, getAutoSubtitleStatus, loadCachedSubtitles } from '../lib/autoSubtitles';
import { useVolumeBoost } from '../lib/volumeBoost';
import VolumeBoost, { SpeakerPlus } from './VolumeBoost';
import '../styles/css/video-player.css';

/**
 * Custom video player — replaces the browser's native <video controls> UI.
 *
 *   <VideoPlayer src={url} poster={poster} autoPlay onEnded={…} />
 *
 * Play/pause, seekable + buffered timeline with hover preview, ±10s skip,
 * volume + mute, playback speed, picture-in-picture, fullscreen, auto-hiding
 * controls, loading spinner, error state, keyboard shortcuts
 * (Space/K, J/L or ←/→, ↑/↓, M, F, 0-9) and double-tap to skip on touch.
 * Bilingual (en/ar). Styles: styles/css/video-player.css (.vp*).
 */

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** SRT / WebVTT → [{ s, e, text }] (seconds). Tolerant: BOM, CRLF, optional hours, comma or dot decimals, inline tags stripped. */
export function parseCues(text) {
  const out = [];
  const T = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  const sec = (h, m, s, f) => Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${f}`);
  String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n{2,}/).forEach((block) => {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) return;
    const m = lines[i].match(T);
    if (!m) return;
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body) out.push({ s: sec(m[1], m[2], m[3], m[4]), e: sec(m[5], m[6], m[7], m[8]), text: body });
  });
  return out.sort((a, b) => a.s - b.s);
}

const P = {
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /></>,
  back: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><text x="12" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text></>,
  fwd: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /><text x="12" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text></>,
  vol: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.3 5.8a9 9 0 0 1 0 12.4" /></>,
  volLow: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6" /></>,
  mute: <><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
  fs: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  fsExit: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  pip: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><rect x="12" y="12" width="7" height="5" rx="1.2" fill="currentColor" stroke="none" /></>,
  /* speedometer (playback speed) */
  speed: <><path d="M4.9 18.4a9 9 0 1 1 14.2 0" /><path d="M12 14.2 16.2 9" /><circle cx="12" cy="14.6" r="1.3" fill="currentColor" stroke="none" /><path d="M12 6.2v1.2M6.3 10l1 .6M17.7 10l-1 .6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  cc: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10.4 10.3a2.3 2.3 0 1 0 0 3.4M17 10.3a2.3 2.3 0 1 0 0 3.4" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>,
};

function Ico({ n, size = 22, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{P[n]}</svg>
  );
}

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Copy the page's CSS into the floating (Document Picture-in-Picture) window so the custom controls look the same there. */
function copyStylesTo(toDoc) {
  toDoc.documentElement.className = document.documentElement.className;
  toDoc.documentElement.dir = document.documentElement.dir || 'ltr';
  toDoc.documentElement.lang = document.documentElement.lang || '';
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const st = toDoc.createElement('style');
      st.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      toDoc.head.appendChild(st);
    } catch {
      if (sheet.href) {
        const l = toDoc.createElement('link');
        l.rel = 'stylesheet';
        l.href = sheet.href;
        toDoc.head.appendChild(l);
      }
    }
  });
  toDoc.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
}

export default function VideoPlayer({ src, poster, autoPlay = false, loop = false, className = '', onEnded, onError, tracks }) {
  const { locale } = useLanguage();
  const tt = useCallback((en, ar) => (locale === 'ar' ? ar : en), [locale]);

  const wrapRef = useRef(null);
  const vref = useRef(null);
  const vb = useVolumeBoost(vref, { src });   // volume boost up to 400% (lib/volumeBoost.js)
  const [boostMenu, setBoostMenu] = useState(false);
  const boostMenuRef = useRef(null);
  const barRef = useRef(null);
  const hideTimer = useRef(null);
  const seeking = useRef(false);
  const lastTap = useRef({ t: 0, side: 0 });

  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [full, setFull] = useState(false);
  const [uiOn, setUiOn] = useState(true);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState(null); // { x, t }
  const [flash, setFlash] = useState(null); // { k, label }
  const [ccMenu, setCcMenu] = useState(false);
  const [subs, setSubs] = useState([]);        // [{ id, label, cues }]
  const [subId, setSubId] = useState(null);    // active subtitle track (null = off)
  const [caption, setCaption] = useState('');
  const fileRef = useRef(null);
  const ccMenuRef = useRef(null);
  const speedMenuRef = useRef(null);
  // automatic subtitles (server transcribes + translates; see lib/autoSubtitles.js)
  const [autoOk, setAutoOk] = useState(false);                // server has the feature switched on
  const [auto, setAuto] = useState({ on: false });             // { on, stage, done, total, target } while generating
  const [autoErr, setAutoErr] = useState('');
  const autoAbort = useRef(null);
  const [pipWin, setPipWin] = useState(null);   // floating window (Document Picture-in-Picture) hosting OUR controls
  const pipRef = useRef(null);
  const resume = useRef(null);                  // playback state to restore when the <video> is re-created in / out of the floating window
  const everPip = useRef(false);

  const docPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  const iosPip = typeof HTMLVideoElement !== 'undefined' && 'webkitSetPresentationMode' in HTMLVideoElement.prototype;   // iPhone / iPad Safari
  const canPip = docPip || iosPip || (typeof document !== 'undefined' && !!document.pictureInPictureEnabled);

  /* ---------- helpers ---------- */
  const poke = useCallback(() => {
    setUiOn(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = vref.current;
      if (v && !v.paused && !seeking.current) { setUiOn(false); setMenu(false); setCcMenu(false); setBoostMenu(false); }
    }, 2600);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const showFlash = useCallback((label) => {
    setFlash({ k: Date.now(), label });
  }, []);
  useEffect(() => {
    if (!flash) return undefined;
    const id = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(id);
  }, [flash]);

  const toggle = useCallback(() => {
    const v = vref.current;
    if (!v) return;
    if (v.paused || v.ended) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause();
  }, []);

  const skip = useCallback((d) => {
    const v = vref.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = clamp(v.currentTime + d, 0, v.duration);
    showFlash(d > 0 ? '+10' : '−10');
  }, [showFlash]);

  const setVol = useCallback((val) => {
    const v = vref.current;
    if (!v) return;
    const x = clamp(val, 0, 1);
    v.volume = x;
    v.muted = x === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const v = vref.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5;
  }, []);

  const toggleFull = useCallback(() => {
    const el = wrapRef.current;
    if (!el || pipRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (vref.current?.webkitEnterFullscreen) vref.current.webkitEnterFullscreen(); // iOS Safari
  }, []);

  const snapshot = () => {
    const v = vref.current;
    return v ? { t: v.currentTime, playing: !v.paused && !v.ended, vol: v.volume, muted: v.muted, rate: v.playbackRate } : null;
  };

  // Floating window with OUR controls + subtitles (the browser's own PiP window shows Google's controls instead)
  const openDocPip = async () => {
    const el = wrapRef.current;
    const pw = await window.documentPictureInPicture.requestWindow({
      width: clamp(el?.clientWidth || 480, 360, 960),
      height: clamp(el?.clientHeight || 270, 220, 640),
    });
    copyStylesTo(pw.document);
    resume.current = snapshot();
    everPip.current = true;
    vref.current?.pause();
    pw.addEventListener('pagehide', () => {
      if (pipRef.current === pw) {
        resume.current = snapshot() || resume.current;   // the user closed the window: carry on from where it was
        pipRef.current = null;
        setPipWin(null);
      }
    });
    pipRef.current = pw;
    setPipWin(pw);
  };

  const togglePip = async () => {
    if (pipRef.current) { pipRef.current.close(); return; }
    const v = vref.current;
    if (!v) return;
    if (docPip) {
      try { await openDocPip(); return; } catch { /* blocked / unsupported: fall back to the native window */ }
    }
    try {
      if (v.requestPictureInPicture && document.pictureInPictureEnabled) {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await v.requestPictureInPicture();
      } else if (v.webkitSetPresentationMode) {
        v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      }
    } catch { /* unsupported / blocked */ }
  };

  // leaving the page / unmounting: close the floating window too
  useEffect(() => () => { try { pipRef.current?.close(); } catch { /* ignore */ } }, []);
  useEffect(() => { if (pipWin) wrapRef.current?.focus(); }, [pipWin]);

  const changeRate = (r) => {
    const v = vref.current;
    if (v) v.playbackRate = r;
    setRate(r);
    setMenu(false);
  };

  /* ---------- seeking ---------- */
  const timeAt = (clientX) => {
    const r = barRef.current.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * (vref.current?.duration || 0);
  };
  const onBarDown = (e) => {
    if (!dur) return;
    seeking.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const t = timeAt(e.clientX);
    vref.current.currentTime = t;
    setCur(t);
  };
  const onBarMove = (e) => {
    if (!dur) return;
    const r = barRef.current.getBoundingClientRect();
    const t = timeAt(e.clientX);
    setHover({ x: clamp(e.clientX - r.left, 0, r.width), t });
    if (seeking.current) { vref.current.currentTime = t; setCur(t); }
  };
  const onBarUp = (e) => {
    seeking.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    poke();
  };
  const onBarKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      skip(e.key === 'ArrowRight' ? 5 : -5);
    }
  };

  /* ---------- keyboard ---------- */
  const onKeyDown = (e) => {
    if (e.target.closest?.('.vp__menu')) { if (e.key === 'Escape') { setMenu(false); e.stopPropagation(); } return; }
    if (e.key === 'Escape' && menu) { setMenu(false); e.stopPropagation(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const v = vref.current;
    let handled = true;
    switch (e.key) {
      case ' ': case 'k': case 'K': if (e.target.tagName === 'BUTTON' && e.key === ' ') { handled = false; break; } toggle(); break;
      case 'ArrowRight': case 'l': case 'L': skip(10); break;
      case 'ArrowLeft': case 'j': case 'J': skip(-10); break;
      case 'ArrowUp': setVol((v?.muted ? 0 : v?.volume ?? 1) + 0.1); showFlash(`${Math.round(clamp((v?.volume ?? 1) + 0.1, 0, 1) * 100)}%`); break;
      case 'ArrowDown': setVol((v?.volume ?? 1) - 0.1); showFlash(`${Math.round(clamp((v?.volume ?? 1) - 0.1, 0, 1) * 100)}%`); break;
      case 'm': case 'M': toggleMute(); break;
      case 'f': case 'F': toggleFull(); break;
      case 'c': case 'C': if (subs.length) setSubId((id) => (id ? null : subs[0].id)); else handled = false; break;
      case 'p': case 'P': if (canPip) togglePip(); else handled = false; break;
      case '<': changeRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)]); break;
      case '>': changeRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)]); break;
      case 'Home': if (v) v.currentTime = 0; break;
      case 'End': if (v && Number.isFinite(v.duration)) v.currentTime = v.duration; break;
      default:
        if (/^[0-9]$/.test(e.key) && v && Number.isFinite(v.duration)) v.currentTime = (Number(e.key) / 10) * v.duration;
        else handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); poke(); }
  };

  /* ---------- surface click / double-tap ---------- */
  const onSurfaceClick = (e) => {
    if (menu || ccMenu || boostMenu) { setMenu(false); setCcMenu(false); setBoostMenu(false); return; }
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const side = x < 0.33 ? -1 : x > 0.67 ? 1 : 0;
    const l = lastTap.current;
    if (now - l.t < 280 && l.side === side) {
      lastTap.current = { t: 0, side: 0 };
      clearTimeout(lastTap.timer);
      if (side === 0) toggleFull(); else skip(side * 10);
      return;
    }
    lastTap.current = { t: now, side };
    clearTimeout(lastTap.timer);
    lastTap.timer = setTimeout(toggle, 260);
  };

  /* ---------- media events ---------- */
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Popups close by themselves: click / tap anywhere outside them, focus moving elsewhere (e.g. you start typing in the chat box),
  // Escape, or the window losing focus. (The CC / speed buttons toggle their own menu, so clicks on them are ignored here.)
  useEffect(() => {
    if (!menu && !ccMenu && !boostMenu) return undefined;
    const host = wrapRef.current;
    const doc = host?.ownerDocument || document;
    const win = doc.defaultView || window;
    const closeAll = () => { setMenu(false); setCcMenu(false); setBoostMenu(false); };
    const onDown = (e) => { if (!e.target?.closest?.('.vp__menuwrap')) closeAll(); };
    const onFocusIn = (e) => { if (!host?.contains(e.target)) closeAll(); };
    const onKey = (e) => { if (e.key === 'Escape') closeAll(); };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('keydown', onKey, true);
    win.addEventListener('blur', closeAll);
    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('keydown', onKey, true);
      win.removeEventListener('blur', closeAll);
    };
  }, [menu, ccMenu, pipWin]);

  useEffect(() => { setFailed(false); setEnded(false); setCur(0); setDur(0); setBuffered(0); }, [src]);

  const syncBuffered = () => {
    const v = vref.current;
    if (!v || !v.buffered.length) return;
    for (let i = 0; i < v.buffered.length; i += 1) {
      if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) { setBuffered(v.buffered.end(i)); return; }
    }
  };

  // subtitle tracks passed in as props: [{ src, label, lang }] (.vtt or .srt URLs)
  useEffect(() => {
    let alive = true;
    setSubs([]); setSubId(null); setCaption('');
    (tracks || []).forEach(async (t, i) => {
      try {
        const txt = await (await fetch(t.src)).text();
        const cues = parseCues(txt);
        if (alive && cues.length) setSubs((prev) => [...prev, { id: `t${i}`, label: t.label || t.lang || `#${i + 1}`, cues }]);
      } catch { /* unreachable / CORS: ignore that track */ }
    });
    return () => { alive = false; };
  }, [tracks, src]);

  const onSubFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const cues = parseCues(await f.text());
      if (!cues.length) { showFlash(tt('No subtitles found in that file', 'مفيش ترجمة في الملف ده')); return; }
      const id = `f${Date.now()}`;
      setSubs((prev) => [...prev, { id, label: f.name.replace(/\.[^.]+$/, ''), cues }]);
      setSubId(id);
      setCcMenu(false);
    } catch { showFlash(tt('Could not read the file', 'تعذّرت قراءة الملف')); }
  };

  // show the cue for the current time (frame-accurate while playing, not just on timeupdate)
  useEffect(() => {
    const track = subs.find((x) => x.id === subId);
    if (!track) { setCaption(''); return undefined; }
    let raf = 0;
    const tick = () => {
      const t = vref.current?.currentTime ?? 0;
      const c = track.cues.find((q) => t >= q.s && t < q.e);
      setCaption((prev) => (prev === (c ? c.text : '') ? prev : (c ? c.text : '')));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [subs, subId]);

  // A popup that would stick out of the player (small chat player, RTL, fullscreen exit…) is nudged back inside it.
  const keepInside = (ref, open) => {
    const m = ref.current;
    const host = wrapRef.current;
    if (!open || !m || !host) return;
    m.style.translate = '0px';
    const a = m.getBoundingClientRect();
    // visible bounds = the player ∩ every clipping ancestor (the player can be wider than the window / chat bubble that crops it)
    const hb = host.getBoundingClientRect();
    const b = { left: hb.left, right: hb.right };
    for (let el = document.fullscreenElement === host ? null : host.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX)) { const r = el.getBoundingClientRect(); b.left = Math.max(b.left, r.left); b.right = Math.min(b.right, r.right); }
    }
    b.left = Math.max(b.left, 0); b.right = Math.min(b.right, window.innerWidth);
    let dx = 0;
    if (a.left < b.left + 8) dx = b.left + 8 - a.left;
    else if (a.right > b.right - 8) dx = b.right - 8 - a.right;
    if (dx) m.style.translate = `${Math.round(dx)}px`;
  };
  useLayoutEffect(() => { keepInside(ccMenuRef, ccMenu); }, [ccMenu, subs.length, auto, autoOk, autoErr, full]);
  useLayoutEffect(() => { keepInside(speedMenuRef, menu); }, [menu, full]);
  useLayoutEffect(() => { keepInside(boostMenuRef, boostMenu); }, [boostMenu, full, vb.status, vb.boost >= 3]);
  // Keep every open popup inside the player while it is open: the player / window can be resized, or the menu can grow (auto-subtitle progress, errors).
  useEffect(() => {
    const open = [[ccMenuRef, ccMenu], [speedMenuRef, menu], [boostMenuRef, boostMenu]].filter(([, o]) => o);
    if (!open.length || !wrapRef.current) return undefined;
    const fit = () => open.forEach(([r]) => keepInside(r, true));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(wrapRef.current); open.forEach(([r]) => r.current && ro?.observe(r.current));
    window.addEventListener('resize', fit);
    const t = setTimeout(fit, 200); // after the pop-in animation + late layout (fonts, async subtitle list)
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); clearTimeout(t); };
  }, [ccMenu, menu, boostMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  // is the automatic-subtitles feature available? (asked once, the first time the CC menu opens)
  useEffect(() => {
    if (!ccMenu) return undefined;
    let alive = true;
    getAutoSubtitleStatus().then((s) => { if (alive) setAutoOk(!!s?.available); });
    return () => { alive = false; };
  }, [ccMenu]);

  // leaving / switching video: stop any running generation
  useEffect(() => () => { autoAbort.current?.abort(); }, [src]);

  const LANG_LABEL = { ar: tt('Arabic', 'العربية'), en: 'English', orig: tt('original language', 'اللغة الأصلية') };

  const putAutoTrack = useCallback((target, cues, select) => {
    const id = `auto-${target}`;
    const label = `${tt('Auto', 'تلقائي')} · ${LANG_LABEL[target] || target}`;
    setSubs((prev) => (prev.some((x) => x.id === id) ? prev.map((x) => (x.id === id ? { ...x, cues, label } : x)) : [...prev, { id, label, cues }]));
    if (select) setSubId(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tt]);

  const autoMessage = (err) => {
    const code = err instanceof AutoSubError ? err.code : 'failed';
    return ({
      unavailable: tt('Automatic subtitles are not enabled on the server', 'الترجمة التلقائية مش مفعّلة على السيرفر'),
      unsupported: tt('This browser cannot read the video audio', 'المتصفح ده مش بيقدر يقرأ صوت الفيديو'),
      fetch_failed: tt('Could not download the video for analysis', 'مقدرتش أنزّل الفيديو عشان أحلله'),
      too_large: tt('The video is too large to analyse in the browser (max 300 MB)', 'الفيديو كبير أوي ومينفعش يتحلل في المتصفح (الحد 300MB)'),
      decode_failed: tt('Could not read the audio of this video (it may have no sound)', 'مقدرتش أقرأ صوت الفيديو ده (يمكن مفيهوش صوت)'),
      no_audio: tt('This video has no audio track', 'الفيديو ده مفيهوش صوت'),
      no_speech: tt('No clear speech was found in the video', 'مفيش كلام واضح في الفيديو'),
      rate_limited: tt('Too many requests — wait a moment and try again', 'طلبات كتير — استنى شوية وجرّب تاني'),
    })[code] || tt('Automatic subtitles failed. Please try again.', 'الترجمة التلقائية فشلت. جرّب تاني.');
  };

  const startAuto = async (target) => {
    if (auto.on) return;
    setAutoErr('');
    const cached = loadCachedSubtitles(src, target);
    if (cached) { putAutoTrack(target, cached.cues, true); setCcMenu(false); return; }
    const ctl = new AbortController();
    autoAbort.current = ctl;
    setAuto({ on: true, stage: 'download', target });
    let selected = false;
    try {
      const res = await generateAutoSubtitles({
        src, target, signal: ctl.signal,
        onProgress: (p) => setAuto({ on: true, target, ...p }),
        onCues: (cues) => { putAutoTrack(target, cues, !selected); selected = true; },
      });
      putAutoTrack(target, res.cues, !selected);
      if (res.partial) setAutoErr(tt('Stopped early — part of the subtitles are missing', 'اتوقفت بدري — جزء من الترجمة ناقص'));
      else if (!res.translated && target !== 'orig') setAutoErr(tt('Some lines could not be translated and stay in the original language', 'في سطور معرفتش أترجمها وفضلت بلغتها الأصلية'));
      else showFlash(tt('Subtitles ready', 'الترجمة جاهزة'));
    } catch (err) {
      if (!(err instanceof AutoSubError && err.code === 'cancelled')) setAutoErr(autoMessage(err));
    } finally {
      setAuto({ on: false });
      if (autoAbort.current === ctl) autoAbort.current = null;
    }
  };
  const cancelAuto = () => autoAbort.current?.abort();

  const pct = dur ? (cur / dur) * 100 : 0;
  const bufPct = dur ? (buffered / dur) * 100 : 0;
  const volIcon = muted || volume === 0 ? 'mute' : volume < 0.5 ? 'volLow' : 'vol';
  const showBig = !playing && !waiting && !failed;

  const player = (
    <div
      ref={wrapRef}
      className={`vp ${className} ${uiOn || !playing ? 'is-ui' : ''} ${full ? 'is-full' : ''} ${pipWin ? 'is-pip' : ''} ${playing ? 'is-playing' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={tt('Video player', 'مشغّل الفيديو')}
      onKeyDown={onKeyDown}
      onMouseMove={poke}
      onMouseLeave={() => { if (playing && !menu) setUiOn(false); }}
      onTouchStart={poke}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={vref}
        className="vp__video"
        src={src}
        poster={poster}
        autoPlay={autoPlay && !everPip.current}
        loop={loop}
        playsInline
        preload="auto"
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture={!canPip}
        onClick={onSurfaceClick}
        onPlay={() => { setPlaying(true); setEnded(false); poke(); }}
        onPause={() => { setPlaying(false); setUiOn(true); }}
        onEnded={() => { setPlaying(false); setEnded(true); setUiOn(true); onEnded?.(); }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          const r = resume.current;
          if (r) { // the <video> was re-created (moved into / out of the floating window): restore where we were
            resume.current = null;
            v.volume = r.vol; v.muted = r.muted; v.playbackRate = r.rate; v.currentTime = r.t;
            if (r.playing) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
          }
          setDur(v.duration || 0); setVolume(v.volume); setMuted(v.muted);
          setFailed(false); // a volume-boost probe (crossorigin / blob swap) may have raised a transient media error
        }}
        onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => { if (!seeking.current) setCur(e.currentTarget.currentTime); syncBuffered(); }}
        onProgress={syncBuffered}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onWaiting={() => setWaiting(true)}
        onSeeking={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onSeeked={() => setWaiting(false)}
        onError={() => { setFailed(true); setWaiting(false); onError?.(); }}
      />

      {/* layer that receives taps/clicks (video itself also does, this keeps the poster/idle state clickable) */}
      {waiting && !failed && <div className="vp__spinner" aria-label={tt('Loading', 'جارٍ التحميل')} />}

      {caption && <div className="vp__cap" dir="auto" aria-live="off">{caption}</div>}

      {flash && <div key={flash.k} className="vp__flash" aria-hidden="true">{flash.label}</div>}

      {showBig && (
        <button type="button" className="vp__big" onClick={toggle} aria-label={ended ? tt('Replay', 'إعادة التشغيل') : tt('Play', 'تشغيل')}>
          {ended ? <Ico n="fwd" size={34} /> : <Ico n="play" size={34} />}
        </button>
      )}

      {failed && (
        <div className="vp__error" role="alert">
          <Ico n="alert" size={34} />
          <strong>{tt('This video can’t be played', 'تعذّر تشغيل هذا الفيديو')}</strong>
          <span>{tt('The file may be unsupported or the connection dropped.', 'ممكن الصيغة غير مدعومة أو انقطع الاتصال.')}</span>
          <button type="button" onClick={() => { setFailed(false); vref.current?.load(); }}>{tt('Try again', 'حاول مرة أخرى')}</button>
        </div>
      )}

      {!failed && (
        <div className="vp__ui" dir="ltr" onClick={(e) => e.stopPropagation()}>
          <div
            ref={barRef}
            className="vp__bar"
            role="slider"
            tabIndex={0}
            aria-label={tt('Seek', 'التقدّم')}
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(cur)}
            aria-valuetext={`${fmt(cur)} / ${fmt(dur)}`}
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerCancel={onBarUp}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onBarKey}
          >
            <div className="vp__track">
              <div className="vp__buf" style={{ width: `${bufPct}%` }} />
              <div className="vp__fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="vp__thumb" style={{ left: `${pct}%` }} />
            {hover && <div className="vp__tip" style={{ left: hover.x }}>{fmt(hover.t)}</div>}
          </div>

          <div className="vp__row">
            <button type="button" className="vp__btn" onClick={toggle} aria-label={playing ? tt('Pause', 'إيقاف مؤقت') : tt('Play', 'تشغيل')} title={`${playing ? tt('Pause', 'إيقاف مؤقت') : tt('Play', 'تشغيل')} (K)`}>
              <Ico n={playing ? 'pause' : 'play'} />
            </button>
            <button type="button" className="vp__btn vp__btn--skip" onClick={() => skip(-10)} aria-label={tt('Back 10 seconds', 'رجوع 10 ثوانٍ')} title={`${tt('Back 10s', 'رجوع 10 ث')} (J)`}><Ico n="back" /></button>
            <button type="button" className="vp__btn vp__btn--skip" onClick={() => skip(10)} aria-label={tt('Forward 10 seconds', 'تقديم 10 ثوانٍ')} title={`${tt('Forward 10s', 'تقديم 10 ث')} (L)`}><Ico n="fwd" /></button>

            <div className="vp__vol" onWheel={(e) => { e.preventDefault(); const nv = clamp((muted ? 0 : volume) + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1); setVol(nv); }}>
              <button type="button" className="vp__btn" onClick={toggleMute} aria-label={muted ? tt('Unmute', 'تشغيل الصوت') : tt('Mute', 'كتم الصوت')} title={`${muted ? tt('Unmute', 'تشغيل الصوت') : tt('Mute', 'كتم')} (M)`}>
                <Ico n={volIcon} />
              </button>
              <div className="vp__volpop">
                <input
                  className="vp__range"
                  type="range" min="0" max="1" step="0.01"
                  value={muted ? 0 : volume}
                  onChange={(e) => setVol(Number(e.target.value))}
                  aria-label={tt('Volume', 'مستوى الصوت')}
                  style={{ '--p': `${(muted ? 0 : volume) * 100}%` }}
                />
                <span className="vp__volnum">{Math.round((muted ? 0 : volume) * 100)}</span>
              </div>
            </div>

            <span className="vp__time">{fmt(cur)} <i>/</i> {fmt(dur)}</span>
            <span className="vp__spacer" />

            <div className="vp__menuwrap vp__menuwrap--cc">
              <button type="button" className={`vp__btn ${subId ? 'is-cc' : ''} ${ccMenu ? 'is-on' : ''} ${auto.on ? 'is-busy' : ''}`} onClick={() => { setCcMenu((m) => !m); setMenu(false); setBoostMenu(false); }} aria-haspopup="menu" aria-expanded={ccMenu} aria-label={tt('Subtitles', 'الترجمة')} title={`${tt('Subtitles', 'الترجمة')} (C)`}>
                <Ico n="cc" />
              </button>
              {ccMenu && (
                <div ref={ccMenuRef} className="vp__menu vp__menu--cc" role="menu" dir={locale === 'ar' ? 'rtl' : 'ltr'} onKeyDown={(e) => e.key === 'Escape' && setCcMenu(false)}>
                  <div className="vp__menu-title">{tt('Subtitles', 'الترجمة')}</div>
                  <button type="button" role="menuitemradio" aria-checked={!subId} className={!subId ? 'is-on' : ''} onClick={() => { setSubId(null); setCcMenu(false); }}>{tt('Off', 'إيقاف')}</button>
                  {subs.map((x) => (
                    <button key={x.id} type="button" role="menuitemradio" aria-checked={subId === x.id} className={subId === x.id ? 'is-on' : ''} onClick={() => { setSubId(x.id); setCcMenu(false); }} title={x.label} dir="auto">{x.label}</button>
                  ))}
                  {auto.on ? (
                    <div className="vp__menu-auto" role="status">
                      <span className="vp__menu-auto-txt">
                        {auto.stage === 'download' && tt('Downloading the video…', 'بنحمّل الفيديو…')}
                        {auto.stage === 'decode' && tt('Reading the audio…', 'بنقرأ الصوت…')}
                        {auto.stage === 'transcribe' && tt(`Transcribing… ${auto.done || 0}/${auto.total || 1} ${auto.pct ?? 0}%`, `بنكتب الكلام… ${auto.done || 0}/${auto.total || 1} ${auto.pct ?? 0}%`)}
                      </span>
                      <span className="vp__menu-bar"><i style={{ width: `${auto.stage === 'transcribe' ? Math.max(6, auto.pct ?? Math.round(((auto.done || 0) / (auto.total || 1)) * 100)) : 6}%`, transition: 'width .3s linear' }} /></span>
                      <button type="button" className="vp__menu-cancel" onClick={cancelAuto}>{tt('Cancel', 'إلغاء')}</button>
                    </div>
                  ) : autoOk && (
                    <>
                      <div className="vp__menu-sub">{tt('Generate automatically', 'ترجمة تلقائية من صوت الفيديو')}</div>
                      <div className="vp__menu-chips">
                        <button type="button" role="menuitem" className="vp__menu-load" onClick={() => startAuto('ar')}>✨ {tt('Arabic', 'عربي')}</button>
                        <button type="button" role="menuitem" className="vp__menu-load" onClick={() => startAuto('en')}>✨ English</button>
                        <button type="button" role="menuitem" className="vp__menu-load" title={tt('Original language (no translation)', 'اللغة الأصلية (من غير ترجمة)')} onClick={() => startAuto('orig')}>✨ {tt('Original', 'الأصلية')}</button>
                      </div>
                    </>
                  )}
                  {autoErr && <div className="vp__menu-err" role="alert" dir="auto">{autoErr}</div>}
                  <button type="button" role="menuitem" className="vp__menu-load" onClick={() => fileRef.current?.click()}>
                    <span aria-hidden="true">＋ </span>{tt('Add subtitle file', 'إضافة ملف ترجمة')} <bdi dir="ltr">(.srt / .vtt)</bdi>
                  </button>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".srt,.vtt,.txt,text/vtt" hidden onChange={onSubFile} />
            </div>

            <div className="vp__menuwrap vp__menuwrap--boost">
              <button type="button" className={`vp__btn vp__btn--boost ${boostMenu ? 'is-on' : ''} ${vb.boost > 1 ? 'is-boosted' : ''}`} onClick={() => { setBoostMenu((m) => !m); setMenu(false); setCcMenu(false); }} aria-haspopup="menu" aria-expanded={boostMenu} aria-label={tt('Volume boost', 'تضخيم الصوت')} title={tt('Volume boost', 'تضخيم الصوت')}>
                {vb.boost > 1 ? <b dir="ltr">{vb.label}</b> : <SpeakerPlus size={20} />}
              </button>
              {boostMenu && (
                <div ref={boostMenuRef} className="vp__menu vp__menu--boost" role="dialog" aria-label={tt('Volume boost', 'تضخيم الصوت')} onKeyDown={(e) => e.key === 'Escape' && setBoostMenu(false)}>
                  <VolumeBoost vb={vb} />
                </div>
              )}
            </div>

            <div className="vp__menuwrap">
              <button type="button" className={`vp__btn vp__btn--rate ${menu ? 'is-on' : ''}`} onClick={() => { setMenu((m) => !m); setCcMenu(false); setBoostMenu(false); }} aria-haspopup="menu" aria-expanded={menu} aria-label={tt('Playback speed', 'سرعة التشغيل')} title={tt('Playback speed', 'سرعة التشغيل')}>
                {rate === 1 ? <Ico n="speed" /> : <b dir="ltr">{rate}×</b>}
              </button>
              {menu && (
                <div ref={speedMenuRef} className="vp__menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                  <div className="vp__menu-title">{tt('Playback speed', 'سرعة التشغيل')}</div>
                  {SPEEDS.map((r) => (
                    <button key={r} type="button" role="menuitemradio" aria-checked={r === rate} className={r === rate ? 'is-on' : ''} onClick={() => changeRate(r)}>
                      <span className="vp__tick">{r === rate && <Ico n="check" size={15} />}</span>
                      {r === 1 ? tt('Normal', 'عادي') : <bdi dir="ltr">{r}×</bdi>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {canPip && (
              <button type="button" className="vp__btn vp__btn--pip" onClick={togglePip} aria-label={pipWin ? tt('Back to the page', 'رجوع للصفحة') : tt('Picture-in-picture', 'نافذة عائمة')} title={`${pipWin ? tt('Back to the page', 'رجوع للصفحة') : tt('Picture-in-picture', 'نافذة عائمة')} (P)`}><Ico n="pip" /></button>
            )}
            {!pipWin && <button type="button" className="vp__btn vp__btn--full" onClick={toggleFull} aria-label={full ? tt('Exit fullscreen', 'إنهاء ملء الشاشة') : tt('Fullscreen', 'ملء الشاشة')} title={`${full ? tt('Exit fullscreen', 'إنهاء ملء الشاشة') : tt('Fullscreen', 'ملء الشاشة')} (F)`}>
              <Ico n={full ? 'fsExit' : 'fs'} />
            </button>}
          </div>
        </div>
      )}
    </div>
  );

  if (!pipWin) return player;
  return (
    <>
      <div className={`vp vp--placeholder ${className}`} style={poster ? { backgroundImage: `url(${poster})` } : undefined}>
        <div className="vp__pipnote">
          <Ico n="pip" size={30} />
          <span>{tt('Playing in the floating window', 'الفيديو شغّال في النافذة العائمة')}</span>
          <button type="button" onClick={() => pipRef.current?.close()}>{tt('Bring it back here', 'رجّعه هنا')}</button>
        </div>
      </div>
      {createPortal(player, pipWin.document.body)}
    </>
  );
}
