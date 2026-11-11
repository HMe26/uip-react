/**
 * Camera helpers for exam proctoring. Runs in the student's browser. The "flags" are cheap heuristics
 * (lighting, covered lens, faces when the browser ships the experimental FaceDetector API) meant to help
 * the instructor review — hints, not proof; the server never counts them as violations on its own.
 */
export function cameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
}

export function stopStream(stream) {
  try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
}

function frameStats(video) {
  const w = 64;
  const h = 48;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  let sumSq = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

/** Current video frame as a JPEG (max 480px wide) plus heuristic flags. Rejects if there is no frame yet. */
export async function captureFrame(video, { maxWidth = 480, quality = 0.7 } = {}) {
  if (!video || !video.videoWidth || !video.videoHeight) throw new Error('No camera frame available.');

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);

  const flags = [];
  try {
    const { mean, std } = frameStats(video);
    if (mean < 25) flags.push('too_dark');
    if (std < 5) flags.push('blank');
  } catch { /* best-effort */ }

  try {
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      const faces = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }).detect(canvas);
      if (faces.length === 0) flags.push('no_face');
      else if (faces.length > 1) flags.push('multiple_faces');
    }
  } catch { /* unsupported */ }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the frame.'))), 'image/jpeg', quality);
  });
  return { blob, flags };
}

export function cameraErrorKey(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError') return 'busy';
  return 'unknown';
}
