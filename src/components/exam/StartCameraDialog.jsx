import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { cameraErrorKey, cameraSupported, captureFrame, openCamera, stopStream } from '../../lib/examCamera';

const STR = {
  en: {
    title: 'Camera check', titleId: 'Identity check',
    body: 'This exam is monitored by camera. Take a clear photo of your face to start. It is visible only to your instructor.',
    bodyId: 'Take a clear photo of your face. You can also add a photo of your university ID. Your instructor will review them.',
    capture: 'Take photo', retake: 'Retake', start: 'Start exam', cancel: 'Cancel', working: 'Starting…',
    idLabel: 'University ID photo (optional)', idChosen: 'ID photo attached',
    denied: 'Camera access was blocked. Allow the camera in your browser settings, then try again.',
    missing: 'No camera was found on this device.', busy: 'The camera is being used by another app. Close it and try again.',
    unsupported: 'This browser cannot access the camera.', unknown: 'Could not start the camera.',
    tryAgain: 'Try again', flagged: 'The photo looks dark or unclear — retake it if you can.',
  },
  ar: {
    title: 'فحص الكاميرا', titleId: 'التحقق من الهوية',
    body: 'هذا الامتحان مراقَب بالكاميرا. التقط صورة واضحة لوجهك للبدء. الصورة يراها مدرّس المادة فقط.',
    bodyId: 'التقط صورة واضحة لوجهك، ويمكنك إضافة صورة بطاقتك الجامعية. سيراجعها مدرّس المادة.',
    capture: 'التقاط صورة', retake: 'إعادة الالتقاط', start: 'ابدأ الامتحان', cancel: 'إلغاء', working: 'جارٍ البدء…',
    idLabel: 'صورة البطاقة الجامعية (اختياري)', idChosen: 'تم إرفاق صورة البطاقة',
    denied: 'تم حظر الوصول للكاميرا. اسمح بالكاميرا من إعدادات المتصفح ثم حاول مرة أخرى.',
    missing: 'لم يتم العثور على كاميرا في هذا الجهاز.', busy: 'الكاميرا مستخدمة في تطبيق آخر. أغلقه وحاول مرة أخرى.',
    unsupported: 'هذا المتصفح لا يدعم الوصول للكاميرا.', unknown: 'تعذّر تشغيل الكاميرا.',
    tryAgain: 'حاول مرة أخرى', flagged: 'الصورة تبدو مظلمة أو غير واضحة — أعد الالتقاط إن أمكن.',
  },
};

/**
 * Shown before an attempt starts when the exam requires a start photo / identity check.
 * onSubmit({ photo: Blob, idCard: File|null, flags: string[] }) — errors are passed in via `error`.
 */
export default function StartCameraDialog({ ar, identity, busy, error, onCancel, onSubmit }) {
  const S = STR[ar ? 'ar' : 'en'];
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [camError, setCamError] = useState(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState(null); // { blob, flags, url }
  const [idCard, setIdCard] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!cameraSupported()) { setCamError('unsupported'); return undefined; }
    let cancelled = false;
    setCamError(null);
    setReady(false);
    openCamera()
      .then((stream) => {
        if (cancelled) { stopStream(stream); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
        setReady(true);
      })
      .catch((err) => { if (!cancelled) setCamError(cameraErrorKey(err)); });
    return () => { cancelled = true; stopStream(streamRef.current); streamRef.current = null; };
  }, [nonce]);

  useEffect(() => () => { if (shot?.url) URL.revokeObjectURL(shot.url); }, [shot]);

  const take = async () => {
    try {
      const { blob, flags } = await captureFrame(videoRef.current, { maxWidth: 640, quality: 0.8 });
      setShot({ blob, flags, url: URL.createObjectURL(blob) });
    } catch { setCamError('unknown'); }
  };

  return (
    <div className="ex-modal-scrim" role="dialog" aria-modal="true">
      <div className="ex-modal" style={{ maxWidth: 520 }}>
        <Icon name="eye" size={30} />
        <h2 style={{ margin: 0 }}>{identity ? S.titleId : S.title}</h2>
        <p className="ex-card__sub" style={{ margin: 0 }}>{identity ? S.bodyId : S.body}</p>

        {camError ? (
          <>
            <p className="form-error" style={{ margin: 0 }}>{S[camError] || S.unknown}</p>
            <button type="button" className="btn btn-outline" onClick={() => setNonce((n) => n + 1)}>{S.tryAgain}</button>
          </>
        ) : (
          <div className="ex-cam-frame">
            <video ref={videoRef} muted playsInline autoPlay style={{ display: shot ? 'none' : 'block' }} />
            {shot && <img src={shot.url} alt="" />}
          </div>
        )}

        {shot && shot.flags.length > 0 && <p className="ex-card__sub" style={{ margin: 0, color: 'var(--color-warning, #b45309)' }}>{S.flagged}</p>}

        {identity && (
          <label className="ex-card__sub" style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            <span>{idCard ? `✓ ${S.idChosen}` : S.idLabel}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setIdCard(e.target.files?.[0] || null)} />
          </label>
        )}

        {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>{S.cancel}</button>
          {!shot ? (
            <button type="button" className="btn btn-primary" onClick={take} disabled={!ready || !!camError}>{S.capture}</button>
          ) : (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setShot(null)} disabled={busy}>{S.retake}</button>
              <button type="button" className="btn btn-primary" onClick={() => onSubmit({ photo: shot.blob, idCard, flags: shot.flags })} disabled={busy}>{busy ? S.working : S.start}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
