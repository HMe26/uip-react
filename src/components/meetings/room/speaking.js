import { useEffect, useState } from 'react';

/** Stable, pleasant avatar colour per person (same name -> same colour for everyone in the room). */
const AVATAR_HUES = [231, 262, 291, 330, 12, 32, 152, 188, 205];
export function avatarColor(name) {
  let h = 0;
  const s = String(name || '?');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 28) % 360} 70% 46%))`;
}

let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sharedAudioCtx = new AC();
  }
  if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
  return sharedAudioCtx;
}

/** True while the stream's audio is above a speaking threshold (drives the glowing ring around the tile). */
export function useSpeaking(stream, enabled) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!enabled || !stream || stream.getAudioTracks().length === 0) { setSpeaking(false); return undefined; }
    let src; let analyser; let timer; let hold = 0;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return undefined;
      src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128));
        if (peak > 9) hold = 4; else if (hold > 0) hold -= 1;
        setSpeaking(hold > 0);
      }, 120);
    } catch { /* analyser unsupported — the ring just never lights up */ }
    return () => {
      clearInterval(timer);
      try { src?.disconnect(); } catch { /* already gone */ }
      setSpeaking(false);
    };
  }, [stream, enabled]);
  return speaking;
}
