import { useEffect } from 'react';
import { snapStyle } from './snapLayouts';

/**
 * Snap Assist (like Windows 11): after a window is snapped into one zone of a layout, the next free zone is highlighted
 * and every other open window is offered for it, one zone after another.
 *   assist = { zones: ['r13', …] (still empty), skip: [window ids already placed] }
 */
export default function SnapAssist({ assist, list, titleOf, iconOf, tt, dispatch, setAssist }) {
  const zone = assist?.zones?.[0];
  const cands = assist ? list.filter((w) => !assist.skip.includes(w.id)) : [];

  useEffect(() => {
    if (!assist) return undefined;
    const k = (e) => { if (e.key === 'Escape') setAssist(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [assist, setAssist]);

  // nothing left to offer (or no zone left): finish
  useEffect(() => { if (assist && (!zone || cands.length === 0)) setAssist(null); }, [assist, zone, cands.length, setAssist]);
  if (!assist || !zone || cands.length === 0) return null;

  const next = (id) => {
    const rest = assist.zones.slice(1);
    setAssist(rest.length ? { zones: rest, skip: id ? [...assist.skip, id] : assist.skip } : null);
  };
  const pick = (w) => {
    dispatch({ type: 'focus', id: w.id });
    dispatch({ type: 'snap', id: w.id, side: zone });
    next(w.id);
  };

  return (
    <div className="os-assist" onPointerDown={(e) => { if (e.target === e.currentTarget) setAssist(null); }}>
      <div className="os-assist__zone" style={snapStyle(zone)}>
        <div className="os-assist__card" role="dialog" aria-label={tt('Snap Assist', 'اقتراحات التقسيم')}>
          <b>{tt('Pick a window for this side', 'اختار نافذة للجزء ده')}</b>
          <div className="os-assist__grid">
            {cands.map((w) => (
              <button key={w.id} type="button" className="os-assist__item" onClick={() => pick(w)} title={titleOf(w)}>
                <span className="os-assist__ico">{iconOf(w)}</span>
                <span className="os-assist__ttl" dir="auto">{titleOf(w)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="os-assist__skip" onClick={() => next(null)}>{assist.zones.length > 1 ? tt('Skip', 'تخطّي') : tt('Close', 'إغلاق')}</button>
        </div>
      </div>
    </div>
  );
}
