import { useState } from 'react';
import { initials, avatarUrl } from '../format';

/** Round photo with an initials fallback (also used when the person hid their photo or the image fails to load). */
export default function Face({ name, src, className = '' }) {
  const [failed, setFailed] = useState(false);
  const url = !failed ? avatarUrl(src) : null;
  return (
    <span className={`st-face ${className}`}>
      {url ? <img src={url} alt="" draggable="false" onError={() => setFailed(true)} /> : <b>{initials(name)}</b>}
    </span>
  );
}
