/**
 * Convert any audio the browser can decode (e.g. a recorded voice-message-*.webm / opus) to an MP3 Blob — fully in the browser,
 * no server round-trip. lamejs is lazy-loaded the first time someone asks for an MP3.
 *
 *   const mp3 = await audioToMp3(blob, { kbps: 96, onProgress: (0..1) => {} });
 */
export async function audioToMp3(blob, { kbps = 96, onProgress } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('Audio decoding is not supported in this browser.');
  const { Mp3Encoder } = await import('@breezystack/lamejs');

  const decoded = await new OAC(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  const rate = decoded.sampleRate;
  const ch = decoded.numberOfChannels;
  const len = decoded.length;

  // mix down to mono → Int16 (voice notes are mono anyway; keeps the file small)
  const mono = new Int16Array(len);
  const chans = Array.from({ length: ch }, (_, i) => decoded.getChannelData(i));
  for (let i = 0; i < len; i += 1) {
    let v = 0;
    for (let c = 0; c < ch; c += 1) v += chans[c][i];
    v /= ch;
    mono[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
  }

  const enc = new Mp3Encoder(1, rate, kbps);
  const parts = [];
  const BLOCK = 1152;
  for (let i = 0, n = 0; i < len; i += BLOCK, n += 1) {
    const out = enc.encodeBuffer(mono.subarray(i, i + BLOCK));
    if (out.length) parts.push(out);
    if (n % 300 === 0) { // let the UI breathe on long recordings
      onProgress?.(i / len);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  onProgress?.(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}
