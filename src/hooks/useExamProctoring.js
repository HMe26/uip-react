import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { cameraErrorKey, cameraSupported, captureFrame, openCamera, stopStream } from '../lib/examCamera';

/**
 * Live camera monitoring while an exam attempt is in progress.
 * - Opens the camera, keeps a small preview, uploads a JPEG snapshot every `intervalSeconds`.
 * - Reports camera_started / camera_stopped / camera_denied via `reportEvent` (the server decides whether
 *   they count as violations: only when the camera is *required* for this student).
 * - status: 'off' | 'starting' | 'on' | 'denied' | 'missing' | 'busy' | 'lost' | 'unsupported'.
 */
export default function useExamProctoring({ attemptId, mode, intervalSeconds, active, reportEvent }) {
  const enabled = !!active && (mode === 'optional' || mode === 'required');
  const [status, setStatus] = useState(enabled ? 'starting' : 'off');
  const [videoEl, setVideoEl] = useState(null);
  const streamRef = useRef(null);
  const reportRef = useRef(reportEvent);
  const [tries, setTries] = useState(0);
  useEffect(() => { reportRef.current = reportEvent; }, [reportEvent]);

  const retry = useCallback(() => setTries((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) { setStatus('off'); return undefined; }
    if (!cameraSupported()) { setStatus('unsupported'); reportRef.current?.('camera_denied', { reason: 'unsupported' }); return undefined; }

    let cancelled = false;
    setStatus('starting');
    openCamera()
      .then((stream) => {
        if (cancelled) { stopStream(stream); return; }
        streamRef.current = stream;
        setStatus('on');
        reportRef.current?.('camera_started');
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (cancelled) return;
            setStatus('lost');
            reportRef.current?.('camera_stopped');
          });
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const key = cameraErrorKey(err);
        setStatus(key === 'unknown' ? 'missing' : key);
        reportRef.current?.('camera_denied', { reason: key });
      });

    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [enabled, tries]);

  useEffect(() => {
    if (videoEl && streamRef.current && status === 'on') {
      videoEl.srcObject = streamRef.current;
      videoEl.play?.().catch(() => {});
    }
  }, [videoEl, status]);

  useEffect(() => {
    if (!enabled || status !== 'on' || !videoEl) return undefined;
    const every = Math.max(15, Number(intervalSeconds) || 60) * 1000;
    let stopped = false;

    const snap = async () => {
      if (stopped || document.hidden) return;
      try {
        const { blob, flags } = await captureFrame(videoEl);
        const fd = new FormData();
        fd.append('photo', blob, 'snapshot.jpg');
        if (flags.length) fd.append('flags', JSON.stringify(flags));
        await api.postForm(`/api/v1/exam-system/attempts/${attemptId}/snapshots`, fd);
      } catch { /* a missed snapshot shows to the instructor as a gap; never interrupt the exam */ }
    };

    const first = setTimeout(snap, 4000);
    const iv = setInterval(snap, every);
    return () => { stopped = true; clearTimeout(first); clearInterval(iv); };
  }, [enabled, status, videoEl, attemptId, intervalSeconds]);

  return { status, ok: status === 'on', retry, setVideoEl, enabled };
}
