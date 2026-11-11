import { useRef } from 'react';
import { BOOST_PRESETS, MAX_BOOST, boostLabel, useVolumeBoost } from '../lib/volumeBoost';
import { useLanguage } from '../context/LanguageContext';
import '../styles/css/volume-boost.css';

const SpeakerPlus = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" />
    <path d="M16 9v6M13 12h6" />
  </svg>
);
export { SpeakerPlus };

/**
 * Volume-boost UI for a useVolumeBoost() controller.
 *   variant="chip"  → one small button that cycles 100 → 200 → 300 → 400 % (voice notes, audio rows)
 *   variant="panel" → slider 100–400 % + preset buttons (video player menu, audio player, meetings)
 */
export default function VolumeBoost({ vb, variant = 'panel', className = '' }) {
  const { locale } = useLanguage();
  const tt = (en, ar) => (locale === 'ar' ? ar : en);
  const { boost, setBoost, status, reason } = vb;
  const title = tt('Volume boost (louder than 100%)', 'تضخيم الصوت (أعلى من 100%)');

  if (variant === 'chip') {
    const next = () => {
      const i = BOOST_PRESETS.findIndex((p) => Math.abs(p - boost) < 0.01);
      setBoost(BOOST_PRESETS[(i + 1) % BOOST_PRESETS.length]);
    };
    return (
      <button
        type="button"
        className={`vb-chip ${boost > 1 ? 'is-on' : ''} ${status === 'loading' ? 'is-busy' : ''} ${className}`}
        onClick={next}
        aria-label={`${title}: ${boostLabel(boost)}`}
        title={status === 'error' ? tt('Could not boost this file', 'مقدرتش أضخّم الصوت للملف ده') : title}
      >
        <SpeakerPlus size={12} />{boostLabel(boost)}
      </button>
    );
  }

  return (
    <div className={`vb-panel ${className}`} onClick={(e) => e.stopPropagation()}>
      <div className="vb-panel__head">
        <span className="vb-panel__title"><SpeakerPlus size={15} />{tt('Volume boost', 'تضخيم الصوت')}</span>
        <button
          type="button"
          className={`vb-panel__value ${boost > 1 ? 'is-on' : ''}`}
          onClick={() => setBoost(1)}
          title={boost >= 3 ? tt('High volume — protect your ears. Tap to reset to 100%', 'صوت عالي — خلي بالك على سمعك. اضغط للرجوع 100%') : tt('Reset to 100%', 'رجّعه 100%')}
          aria-label={`${boostLabel(boost)} — ${tt('reset to 100%', 'رجّعه 100%')}`}
          dir="ltr"
        >{boostLabel(boost)}</button>
      </div>
      <div className="vb-panel__slider" dir="ltr">
        <input
          className="vb-panel__range"
          type="range"
          min="1" max={MAX_BOOST} step="0.05"
          value={boost}
          onChange={(e) => setBoost(Number(e.target.value))}
          aria-label={title}
          style={{ '--p': `${((boost - 1) / (MAX_BOOST - 1)) * 100}%` }}
        />
      </div>
      <div className="vb-panel__presets" dir="ltr">
        {BOOST_PRESETS.map((p) => (
          <button key={p} type="button" className={Math.abs(boost - p) < 0.01 ? 'is-on' : ''} onClick={() => setBoost(p)}>{p * 100}%</button>
        ))}
      </div>
      {status === 'loading' && <div className="vb-panel__note">{tt('Preparing…', 'جارٍ التجهيز…')}</div>}
      {status === 'error' && <div className="vb-panel__note vb-panel__note--err" role="alert">{tt('This file cannot be boosted — playing at normal volume.', 'الملف ده مينفعش يتضخّم صوته — بيشتغل بالصوت العادي.')}{reason ? <bdi dir="ltr" className="vb-panel__code"> [{reason}]</bdi> : null}</div>}
    </div>
  );
}

/**
 * Native <audio controls> with a volume-boost control next to it.
 *   <BoostedAudio src={url} autoPlay compact />      compact → small chip (cycles 100/200/300/400 %), otherwise slider
 */
export function BoostedAudio({ src, autoPlay = false, compact = false, style, className = '' }) {
  const ref = useRef(null);
  const vb = useVolumeBoost(ref, { src });
  return (
    <span className={`vb-inline ${className}`} style={{ flexWrap: 'wrap' }}>
      <audio ref={ref} src={src} controls autoPlay={autoPlay} preload="metadata" style={style} />
      <VolumeBoost vb={vb} variant={compact ? 'chip' : 'panel'} />
    </span>
  );
}
