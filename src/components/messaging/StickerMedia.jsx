import { useRef } from 'react';
import { useProtectedSrc } from '../../lib/chatMedia';

/**
 * A sticker (image or short looping video) from any source: a protected API path (blob-fetched with the token, cached),
 * a local blob: preview, or a plain URL. `hover` plays video stickers only while the pointer is over them (picker grids).
 */
export default function StickerMedia({ url, kind, className = '', hover = false, alt = '', size }) {
  const { src, error } = useProtectedSrc(url);
  const vref = useRef(null);
  const isVideo = kind === 'video';
  const style = size ? { width: size, height: size } : undefined;
  if (error) return <span className={`stk-media stk-media--err ${className}`} style={style} aria-hidden="true">🖼️</span>;
  if (!src) return <span className={`stk-media stk-media--skeleton ${className}`} style={style} aria-hidden="true" />;
  if (isVideo) {
    return (
      <video
        ref={vref} className={`stk-media stk-media--video ${className}`} style={style} src={src} muted loop playsInline
        autoPlay={!hover} preload={hover ? 'metadata' : 'auto'} aria-label={alt}
        onMouseEnter={hover ? () => vref.current?.play().catch(() => {}) : undefined}
        onMouseLeave={hover ? () => { const v = vref.current; if (v) { v.pause(); v.currentTime = 0; } } : undefined}
      />
    );
  }
  return <img className={`stk-media ${className}`} style={style} src={src} alt={alt} loading="lazy" decoding="async" draggable={false} />;
}
