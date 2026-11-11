/**
 * Fast video export (WebCodecs). Load with `await import('./fastVideoExport')`: it pulls in mediabunny.
 *
 * Demux -> hardware decode -> (optional) canvas pass for colour filter / burned-in subtitles -> hardware encode -> mux.
 * It runs faster than playback speed and uses the same code in the website and in the Android APK (Capacitor WebView
 * is Chromium). The caller keeps the old real-time MediaRecorder path as a fallback: any failure here that is not an
 * abort / size problem simply means "use the old path".
 *
 * Output preference:
 *   1. MP4  (H.264 + AAC)  — plays everywhere (iOS, Android, WhatsApp-style previews)
 *   2. WebM (VP9/VP8 + Opus) — when the device cannot encode H.264 / AAC
 */

import {
  AudioSample,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  WEBM,
  WebMOutputFormat,
} from 'mediabunny';

// only the containers people actually send from a phone / PC (keeps the lazy chunk small)
const INPUT_FORMATS = [MP4, QTFF, WEBM, MATROSKA];

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * @param {object}   o
 * @param {File}     o.file
 * @param {number}   o.start / o.end        trim range, seconds
 * @param {boolean}  o.mute
 * @param {AudioBuffer|null} o.cleanAudio   noise-reduced sound for the WHOLE source (replaces the original audio)
 * @param {{rot:number,flip:boolean,crop:{x:number,y:number,w:number,h:number},filter:string}} o.params
 * @param {{max:number}} o.quality          longest output side
 * @param {{v:number,a:number}} o.bits      target bitrates (already capped to the upload budget)
 * @param {Function|null} o.drawOverlay     (ctx, sourceTime, w, h) => void — subtitles
 * @param {Function} o.onProgress           0..1
 * @param {{current:Function|null}} o.abortRef
 * @param {number}   o.maxBytes             hard ceiling for the result
 */
export async function fastExportVideo({
  file,
  start,
  end,
  mute,
  cleanAudio = null,
  params,
  quality,
  bits,
  drawOverlay = null,
  onProgress,
  abortRef,
  maxBytes = Infinity,
  copyMaxBytes = maxBytes,
}) {
  let aborted = false;
  let conv = null;
  abortRef.current = () => {
    aborted = true;
    conv?.cancel().catch(() => {});
  };

  const input = new Input({ source: new BlobSource(file), formats: INPUT_FORMATS });
  let canvas = null;
  let ctx = null;
  try {
    const vTrack = await input.getPrimaryVideoTrack();
    if (!vTrack) throw new Error('no_video');
    if (!(await vTrack.canDecode())) throw new Error('undecodable');

    // size of the picture the user sees (natural rotation applied) before the editor's own rotate
    const dw = await vTrack.getDisplayWidth();
    const dh = await vTrack.getDisplayHeight();
    const swap = params.rot % 180 !== 0;
    const sw = swap ? dh : dw;
    const sh = swap ? dw : dh;

    const cx = Math.round(params.crop.x * sw);
    const cy = Math.round(params.crop.y * sh);
    const cwSrc = Math.max(2, Math.min(sw - cx, Math.round(params.crop.w * sw)));
    const chSrc = Math.max(2, Math.min(sh - cy, Math.round(params.crop.h * sh)));
    const isCropped = cx > 0 || cy > 0 || cwSrc < sw || chSrc < sh;

    const k = Math.min(1, quality.max / Math.max(cwSrc, chSrc));
    const outW = even(cwSrc * k);
    const outH = even(chSrc * k);

    // 30 fps is plenty for chat clips and keeps 60 fps sources small
    let frameRate;
    try {
      const st = await vTrack.computePacketStats(60);
      if (st.averagePacketRate > 31) frameRate = 30;
    } catch { /* keep source rate */ }

    const needsCanvas = (params.filter && params.filter !== 'none') || !!drawOverlay;
    if (needsCanvas) {
      canvas = new OffscreenCanvas(outW, outH);
      ctx = canvas.getContext('2d', { alpha: false });
    }

    const hasAudio = !mute && !!(await input.getPrimaryAudioTrack());
    const cleanOn = hasAudio && !!cleanAudio;

    const videoOpts = (codec) => ({
      codec,
      width: outW,
      height: outH,
      fit: 'fill',
      rotate: params.rot || 0,
      flip: !!params.flip,
      allowTransformationMetadata: false,
      ...(isCropped ? { crop: { left: cx, top: cy, width: cwSrc, height: chSrc } } : {}),
      ...(frameRate ? { frameRate } : {}),
      bitrate: bits.v,
      keyFrameInterval: 2,
      forceTranscode: true,
      ...(needsCanvas
        ? {
            processedWidth: outW,
            processedHeight: outH,
            process: (sample) => {
              ctx.save();
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, outW, outH);
              if (params.filter && params.filter !== 'none') ctx.filter = params.filter;
              sample.draw(ctx, 0, 0, outW, outH);
              ctx.restore();
              // the converter re-bases trimmed frames to 0, so add `start` back: cues are in source time
              drawOverlay?.(ctx, sample.timestamp + start, outW, outH);
              return canvas;
            },
          }
        : {}),
    });

    const audioOpts = (codec) => {
      if (!hasAudio) return { discard: true };
      const o = { codec, bitrate: bits.a };
      if (cleanOn) {
        const ch = Math.min(2, cleanAudio.numberOfChannels);
        const rate = cleanAudio.sampleRate;
        Object.assign(o, {
          numberOfChannels: ch,
          sampleRate: rate,
          forceTranscode: true,
          processedNumberOfChannels: ch,
          processedSampleRate: rate,
          process: (s) => {
            // swap each decoded chunk for the same time slice of the noise-reduced buffer
            const t0 = s.timestamp + start; // re-based to 0 by the trim: back to source time
            const from = Math.max(0, Math.round(t0 * rate));
            // the cleaned sound can be at another sample rate than the source (the neural models run at 48 kHz):
            // take the same DURATION as the chunk, not the same number of frames, or the sound drifts out of sync
            const want = Math.max(1, Math.round((s.numberOfFrames * rate) / (s.sampleRate || rate)));
            const n = Math.min(want, cleanAudio.length - from);
            if (n <= 0) return null;
            const data = new Float32Array(n * ch);
            for (let c = 0; c < ch; c += 1) data.set(cleanAudio.getChannelData(c).subarray(from, from + n), c * n);
            const ts = s.timestamp;
            s.close();
            return new AudioSample({ data, format: 'f32-planar', numberOfChannels: ch, sampleRate: rate, timestamp: ts });
          },
        });
      }
      return o;
    };

    // Stream copy: when the picture is untouched (trim from a keyframe / mute only, no filter, subtitles, rotate, crop,
    // downscale or noise-reduced audio) the encoded packets are copied as they are: no decode, no encode, near instant.
    // 'shrink' never shows footage outside the chosen range; if the start isn't near a keyframe the copy is refused
    // (cannot_copy) and the normal re-encode below takes over.
    const copyEligible = !needsCanvas && !params.rot && !params.flip && !isCropped && k === 1 && !cleanOn;
    let chosen = null;
    let target = null;
    if (copyEligible) {
      try {
        const srcDur = await input.computeDuration();
        const estBytes = srcDur > 0 ? (file.size * Math.max(0.1, end - start)) / srcDur : Infinity;
        if (estBytes <= copyMaxBytes) {
          // keep the container family of the source (VP8/VP9/AV1 stay in WebM; H.264/HEVC stay in MP4)
          const mp4 = { fmt: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), ext: 'mp4', mime: 'video/mp4' };
          const webm = { fmt: () => new WebMOutputFormat(), ext: 'webm', mime: 'video/webm' };
          const webmFirst = ['vp8', 'vp9', 'av1'].includes(vTrack.codec);
          for (const at of webmFirst ? [webm, mp4] : [mp4, webm]) {
            if (aborted) throw abortError();
            const output = new Output({ format: at.fmt(), target: new BufferTarget() });
            const c = await Conversion.init({
              input,
              output,
              trim: { start, end },
              video: {},
              audio: hasAudio ? {} : { discard: true },
              copy: { mode: 'forced', shiftTolerance: 0, boundaryPolicy: 'shrink', boundaryTolerance: 0.3 },
              tags: {},
              showWarnings: false,
            });
            if (c.isValid && !c.discardedTracks.some((d) => d.reason !== 'discarded_by_user')) {
              chosen = at;
              conv = c;
              target = output.target;
              break;
            }
          }
        }
      } catch (e) {
        if (aborted || e?.name === 'AbortError') throw abortError();
        // anything else: just re-encode
      }
    }

    // Negotiate: try MP4 (H.264/AAC) first; if the device can't encode it, fall back to WebM (VP9/Opus).
    const attempts = [
      { fmt: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), v: 'avc', a: 'aac', ext: 'mp4', mime: 'video/mp4' },
      { fmt: () => new WebMOutputFormat(), v: 'vp9', a: 'opus', ext: 'webm', mime: 'video/webm' },
      { fmt: () => new WebMOutputFormat(), v: 'vp8', a: 'opus', ext: 'webm', mime: 'video/webm' },
    ];

    for (const at of conv ? [] : attempts) {
      if (aborted) throw abortError();
      const output = new Output({ format: at.fmt(), target: new BufferTarget() });
      const c = await Conversion.init({
        input,
        output,
        trim: { start, end },
        video: videoOpts(at.v),
        audio: audioOpts(at.a),
        tags: {},
        showWarnings: false,
      });
      const lostMedia = c.discardedTracks.some((d) => d.reason !== 'discarded_by_user');
      if (c.isValid && !lostMedia) {
        chosen = at;
        conv = c;
        target = output.target;
        break;
      }
    }
    if (!conv) throw new Error('no_encoder');

    let lastP = 0;
    conv.onProgress = (p) => {
      lastP = Math.max(lastP, Math.min(1, p));
      onProgress?.(lastP);
    };
    if (aborted) throw abortError();
    onProgress?.(0);

    try {
      await conv.execute();
    } catch (e) {
      if (aborted || e?.name === 'ConversionCanceledError') throw abortError();
      throw e;
    }
    if (aborted) throw abortError();
    onProgress?.(1);

    const buf = target.buffer;
    if (!buf || buf.byteLength < 500) throw new Error('empty');
    if (buf.byteLength > maxBytes) throw new Error('too_big');
    const base = (file.name || 'video').replace(/\.[^.]+$/, '');
    return new File([buf], `${base}-edited.${chosen.ext}`, { type: chosen.mime });
  } finally {
    abortRef.current = null;
    try { input.dispose(); } catch { /* already disposed */ }
  }
}
