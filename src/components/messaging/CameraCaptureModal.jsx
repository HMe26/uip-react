import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackLayer } from '../../lib/backStack';
import CameraReview from './CameraReview';

const FILTERS = [
  { id: 'none', en: 'Normal', ar: 'عادي', css: 'none' },
  { id: 'bw', en: 'B&W', ar: 'أبيض وأسود', css: 'grayscale(1) contrast(1.1)' },
  { id: 'sepia', en: 'Sepia', ar: 'سيبيا', css: 'sepia(.85)' },
  { id: 'vintage', en: 'Vintage', ar: 'قديم', css: 'sepia(.4) contrast(1.1) brightness(.95) saturate(1.3) hue-rotate(-10deg)' },
  { id: 'warm', en: 'Warm', ar: 'دافئ', css: 'sepia(.25) saturate(1.3) brightness(1.05) hue-rotate(-8deg)' },
  { id: 'cool', en: 'Cool', ar: 'بارد', css: 'saturate(1.1) hue-rotate(15deg) brightness(1.03)' },
  { id: 'vivid', en: 'Vivid', ar: 'ساطع', css: 'saturate(1.8) contrast(1.15)' },
  { id: 'fade', en: 'Fade', ar: 'باهت', css: 'contrast(.85) brightness(1.1) saturate(.8)' },
  { id: 'noir', en: 'Noir', ar: 'داكن', css: 'grayscale(1) contrast(1.5) brightness(.85)' },
];

const canNormalize = () => typeof window !== 'undefined' && window.isSecureContext !== false
  && typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function' && typeof VideoFrame === 'function';

/** In-app camera capture (desktop + Android APK) (getUserMedia) with live filters. Returns a File via onCapture. */
export default function CameraCaptureModal({ ar, onCapture, onClose, allowViewOnce = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const filterRef = useRef('none');
  const rafRef = useRef(0);
  const [error, setError] = useState('');
  const [facing, setFacing] = useState('user');
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState('none');
  const [mode, setMode] = useState('photo'); // photo | video
  const [secs, setSecs] = useState(0);
  const audioRef = useRef(null);
  const [review, setReview] = useState(null); // { kind: 'photo' | 'video', file } — edit / send-options step after a shot
  const [attempt, setAttempt] = useState(0);
  const [fixing, setFixing] = useState(false);
  const recStartRef = useRef(0);

  // Phone Back / gesture closes ONLY the camera (not the whole chat underneath). Ignored while a video is being recorded.
  useBackLayer(true, () => {
    if (review) { retake(); return; }
    if (!recRef.current || recRef.current.state === 'inactive') onClose();
  });

  const retake = () => { setReview(null); setAttempt((a) => a + 1); };
  const toReview = (kind, file) => { stop(); setReady(false); setReview({ kind, file }); };

  const canFilter = typeof document !== 'undefined' && 'filter' in document.createElement('canvas').getContext('2d');
  filterRef.current = canFilter ? (FILTERS.find((f) => f.id === filter)?.css || 'none') : 'none';

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  const stopAudio = () => { audioRef.current?.getTracks().forEach((t) => t.stop()); audioRef.current = null; };

  const draw = () => {
    const v = videoRef.current; const c = canvasRef.current;
    if (v && c && v.videoWidth) {
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = filterRef.current;
      ctx.drawImage(v, 0, 0, c.width, c.height);
    }
    rafRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    let cancelled = false;
    setReady(false); setError('');
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(ar ? 'المتصفح لا يدعم الكاميرا (يتطلب HTTPS).' : 'Camera is not supported (HTTPS required).');
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        // Ask the sensor for its best size on devices that ignored the first request (phones often fall back to 640x480).
        try { s.getVideoTracks()[0]?.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 } }).catch(() => {}); } catch { /* ignore */ }
        const v = videoRef.current;
        if (v) { v.srcObject = s; v.play?.().catch(() => {}); }
        setReady(true);
        rafRef.current = requestAnimationFrame(draw);
      })
      .catch((e) => setError(e?.name === 'NotAllowedError'
        ? (ar ? 'تم رفض إذن الكاميرا. فعّله من إعدادات المتصفح.' : 'Camera permission denied. Allow it in browser settings.')
        : (ar ? 'لا توجد كاميرا متاحة.' : 'No camera available.')));
    return () => { cancelled = true; stop(); stopAudio(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, ar, attempt]);

  useEffect(() => {
    if (!recording) { setSecs(0); return undefined; }
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const snap = async () => {
    const c = canvasRef.current;
    if (!c || !c.width) return;
    // No filter: take a real full-sensor still (much sharper than a frame of the preview stream). Falls back to the canvas.
    const track = streamRef.current?.getVideoTracks()[0];
    if (filterRef.current === 'none' && track && typeof window.ImageCapture !== 'undefined') {
      try {
        const blob = await new window.ImageCapture(track).takePhoto();
        if (blob && blob.size) { toReview('photo', new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })); return; }
      } catch { /* not supported on this device → canvas below */ }
    }
    c.toBlob((b) => {
      if (b) toReview('photo', new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  const toggleRec = async () => {
    if (recording) { recRef.current?.stop(); return; }
    const c = canvasRef.current;
    if (!c || !c.captureStream || typeof MediaRecorder === 'undefined') return;
    chunksRef.current = [];
    // No filter -> record the camera's own stream: every frame goes straight to the encoder (smooth, perfectly in sync).
    // The old path always re-drew the picture on a canvas first, so any hiccup in the page became dropped / frozen frames.
    // A filter needs the canvas, so only then is it used (the filter picker is locked while recording).
    const direct = filterRef.current === 'none' && streamRef.current?.getVideoTracks().length > 0;
    const out = direct ? new MediaStream(streamRef.current.getVideoTracks()) : c.captureStream(30);
    try {
      const a = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      audioRef.current = a;
      a.getAudioTracks().forEach((t) => out.addTrack(t));
    } catch { /* record without sound */ }
    // H.264 first (hardware encoder on phones / most PCs). VP8 before VP9: VP9 is software-encoded in real time and at 1080p
    // the encoder cannot keep up, so it silently drops frames -> the clip looks smooth live but jumpy once played.
    const pref = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
    // record at 720p30: half the pixels of 1080p, which is what keeps a real-time encoder from falling behind
    const vt = streamRef.current?.getVideoTracks()[0];
    try { await vt?.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }); } catch { /* keep current size */ }
    const rec = new MediaRecorder(out, { ...(pref ? { mimeType: pref } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      setRecording(false);
      stopAudio();
      const type = (rec.mimeType || 'video/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      let file = new File([new Blob(chunksRef.current, { type })], `video-${Date.now()}.${ext}`, { type });
      // MediaRecorder output has variable frame timing, no duration / seek index and drifting timestamps: players stutter on it.
      // Re-mux it through the WebCodecs pipeline (constant 30 fps, regular keyframes, index up front) before it is sent.
      const secsRec = (performance.now() - recStartRef.current) / 1000;
      if (canNormalize() && secsRec > 0.5) {
        setFixing(true);
        try {
          const { fastExportVideo } = await import('../../lib/fastVideoExport');
          const fixed = await fastExportVideo({
            file, start: 0, end: secsRec + 1, mute: false, cleanAudio: null,
            params: { rot: 0, flip: false, crop: { x: 0, y: 0, w: 1, h: 1 }, filter: 'none' },
            quality: { max: 1280 }, bits: { v: 2_500_000, a: 96_000 },
            drawOverlay: null, onProgress: () => {}, abortRef: { current: null },
            maxBytes: 45 * 1024 * 1024, copyMaxBytes: 0, // copyMaxBytes 0: never stream-copy, always re-time + re-encode
          });
          if (fixed && fixed.size > 500) file = fixed;
        } catch { /* no WebCodecs encoder here: send the raw recording as before */ }
        setFixing(false);
      }
      toReview('video', file);
    };
    recStartRef.current = performance.now();
    recRef.current = rec; rec.start(1000); setRecording(true);
  };

  const shutter = () => (mode === 'photo' ? snap() : toggleRec());
  const canVideo = typeof MediaRecorder !== 'undefined';
  const fmt = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

  const btn = { border: 0, borderRadius: 999, padding: '10px 18px', cursor: 'pointer', fontWeight: 600 };
  const thumbBase = { flex: '0 0 auto', border: '2px solid transparent', borderRadius: 10, padding: 0, background: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, textAlign: 'center' };
  return createPortal(
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100dvh', background: 'rgba(0,0,0,.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !recording) onClose(); }}>
      <div style={{ background: '#111', borderRadius: 16, padding: 12, boxSizing: 'border-box', width: 'min(560px,100%)', height: 'min(100%, 820px)', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden', color: '#fff' }}>
        {review ? (
          <CameraReview ar={ar} kind={review.kind} file={review.file} allowViewOnce={allowViewOnce} onBack={retake}
            onSend={(f, o) => { if (o?.mode) f.uipView = { mode: o.mode, seconds: o.seconds }; onCapture(f); }} />
        ) : (
          <>
        {/* kept "visible" (tiny + almost transparent): browsers throttle display:none / off-screen media, which made the picture stutter */}
        <video ref={videoRef} muted playsInline style={{ position: 'fixed', right: 0, bottom: 0, width: 64, height: 36, opacity: 0.01, pointerEvents: 'none', zIndex: -1 }} />
        {error ? <p style={{ padding: 24, textAlign: 'center' }}>{error}</p> : (
          <canvas ref={canvasRef} style={{ flex: '1 1 0', minHeight: 120, width: '100%', objectFit: 'contain', borderRadius: 12, background: '#000', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
        )}
        {!error && canFilter && (
          <div style={{ display: 'flex', flexShrink: 0, gap: 8, overflowX: 'auto', paddingBottom: 4 }} role="listbox" aria-label={ar ? 'الفلاتر' : 'Filters'}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="option" aria-selected={filter === f.id} disabled={recording} onClick={() => setFilter(f.id)}
                style={{ ...thumbBase, opacity: recording && filter !== f.id ? 0.4 : 1, borderColor: filter === f.id ? '#e53e6b' : 'transparent' }}>
                <span style={{ display: 'block', width: 64, height: 44, borderRadius: 8, background: 'linear-gradient(135deg,#f97316,#22c55e 50%,#3b82f6)', filter: f.css }} />
                <span style={{ display: 'block', marginTop: 3 }}>{ar ? f.ar : f.en}</span>
              </button>
            ))}
          </div>
        )}
        {!error && canVideo && (
          <div style={{ display: 'flex', flexShrink: 0, gap: 6, justifyContent: 'center', }}>
            {[['photo', ar ? 'صورة' : 'Photo'], ['video', ar ? 'فيديو' : 'Video']].map(([k, l]) => (
              <button key={k} type="button" disabled={recording} onClick={() => setMode(k)}
                style={{ ...btn, padding: '6px 16px', background: mode === k ? '#fff' : '#374151', color: mode === k ? '#111' : '#fff' }}>{l}</button>
            ))}
          </div>
        )}
        {recording && <div style={{ textAlign: 'center', flexShrink: 0, marginTop: 8, color: '#f87171', fontWeight: 700 }}>● {fmt(secs)}</div>}
        {fixing && <div style={{ textAlign: 'center', flexShrink: 0, marginTop: 8, fontWeight: 600 }}>{ar ? 'جارٍ تجهيز الفيديو…' : 'Preparing video…'}</div>}
        <div style={{ display: 'flex', flexShrink: 0, gap: 14, justifyContent: 'center', alignItems: 'center' }}>
          <button type="button" style={{ ...btn, background: '#fff', color: '#111' }} onClick={() => { if (recording) recRef.current?.stop(); onClose(); }}>{ar ? 'إغلاق' : 'Close'}</button>
          {!error && (
            <button type="button" aria-label={mode === 'photo' ? (ar ? 'التقاط' : 'Capture') : (recording ? (ar ? 'إيقاف' : 'Stop') : (ar ? 'تسجيل' : 'Record'))}
              disabled={!ready || fixing} onClick={shutter}
              style={{ width: 66, height: 66, borderRadius: '50%', border: '4px solid #fff', background: 'transparent', padding: 4, cursor: 'pointer' }}>
              <span style={{ display: 'block', width: '100%', height: '100%', background: mode === 'video' ? '#dc2626' : '#fff', borderRadius: recording ? 8 : '50%', transition: 'border-radius .15s' }} />
            </button>
          )}
          {!error && <button type="button" style={{ ...btn, background: '#374151', color: '#fff' }} disabled={recording} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>{facing === 'user' ? (ar ? 'الخلفية' : 'Rear') : (ar ? 'الأمامية' : 'Front')}</button>}
        </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
