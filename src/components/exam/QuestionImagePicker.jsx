import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import Icon from '../Icon';

export const QUESTION_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
export const QUESTION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** @returns {string|null} رسالة خطأ لو الملف مش صالح، وإلا null. */
export function validateQuestionImage(file, ar) {
  if (!file) return null;
  if (!QUESTION_IMAGE_ACCEPT.split(',').includes(file.type)) {
    return ar ? 'نوع الصورة غير مدعوم. المسموح: JPG, PNG, WEBP, GIF.' : 'Unsupported image type. Allowed: JPG, PNG, WEBP, GIF.';
  }
  if (file.size > QUESTION_IMAGE_MAX_BYTES) {
    return ar ? 'حجم الصورة أكبر من 5 ميجا.' : 'Image is larger than 5 MB.';
  }
  return null;
}

export function uploadQuestionImage(questionId, file) {
  const fd = new FormData();
  fd.append('image', file);
  return api.postForm(`/api/v1/exam-system/questions/${questionId}/image`, fd);
}

export function removeQuestionImage(questionId) {
  return api.del(`/api/v1/exam-system/questions/${questionId}/image`);
}

/**
 * Controlled picker: the parent owns `file` (a File picked but not yet
 * uploaded) and `removed` (existing server image flagged for deletion) and
 * performs the actual upload after the question itself is saved.
 */
export default function QuestionImagePicker({ existingUrl, file, onFile, removed, onRemoveExisting, ar, compact = false }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handlePick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const msg = validateQuestionImage(f, ar);
    setError(msg);
    if (!msg) onFile(f);
  }

  const shown = preview || (!removed ? existingUrl : null);

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="image" size={14} /> {ar ? 'صورة توضيحية (اختياري)' : 'Illustration image (optional)'}
      </label>
      <input ref={input} type="file" accept={QUESTION_IMAGE_ACCEPT} onChange={handlePick} style={{ display: 'none' }} />
      {shown ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <img src={shown} alt="" style={{ maxWidth: compact ? 140 : 220, maxHeight: compact ? 100 : 160, borderRadius: 8, border: '1px solid var(--glass-border)', background: '#fff' }} />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()}>
              <Icon name="upload" size={14} /> {ar ? 'تغيير' : 'Replace'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => { if (file) onFile(null); else onRemoveExisting(true); }}
            >
              <Icon name="trash" size={14} /> {ar ? 'إزالة' : 'Remove'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()}>
            <Icon name="upload" size={14} /> {ar ? 'رفع صورة' : 'Upload image'}
          </button>
          {removed && existingUrl && (
            <button type="button" className="text-caption" style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer' }} onClick={() => onRemoveExisting(false)}>
              {ar ? 'تراجع عن الإزالة' : 'Undo remove'}
            </button>
          )}
          <span className="text-caption">{ar ? 'JPG / PNG / WEBP / GIF — حتى 5 ميجا' : 'JPG / PNG / WEBP / GIF — up to 5 MB'}</span>
        </div>
      )}
      {error && <p className="form-error" style={{ margin: '4px 0 0' }}>{error}</p>}
    </div>
  );
}
