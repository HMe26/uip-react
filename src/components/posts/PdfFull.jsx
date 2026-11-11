import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import Icon from '../Icon';
import PdfCarousel from './PdfCarousel';

/** Full-screen wrapper around the same carousel (opened from the expand button). */
export default function PdfFull({ media, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="pp-lb" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="pp-lb__x" onClick={onClose} aria-label="Close"><Icon name="x" size={22} /></button>
      <div className="pp-lb__doc" onClick={(e) => e.stopPropagation()}><PdfCarousel media={media} previewOf={!!media.has_preview} /></div>
    </div>, document.body);
}
