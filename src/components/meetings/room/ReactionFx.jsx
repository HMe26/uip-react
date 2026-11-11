import { useEffect, useRef, useState } from 'react';

/**
 * On-screen reactions (Zoom style): the emoji floats up over the stage with the sender's name, and pops over the sender's own tile.
 *
 * Why Web Animations (element.animate) and not CSS @keyframes: the platform has a global "animations off" switch
 * (html[data-motion="off"], see styles/css/ambient.css) that forces every CSS animation to ~0 ms. A CSS reaction then jumps straight to
 * its end state (opacity 0) and is never seen — which is exactly why reactions only showed up in the chat. Web Animations are not touched
 * by that rule, so the reaction is always visible; with reduced motion we just fade it instead of moving it.
 */

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** One emoji drifting up from the bottom of the stage, with the sender's name under it. */
function FloatingReaction({ emoji, name }) {
  const ref = useRef(null);
  // a different lane + drift for every reaction so a burst of them fans out instead of stacking
  const [lane] = useState(() => 4 + Math.random() * 52);
  const [drift] = useState(() => (Math.random() - 0.5) * 90);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return undefined;
    const calm = reducedMotion();
    const rise = calm ? 0 : -(window.innerHeight * 0.42);
    const anim = el.animate(
      [
        { opacity: 0, transform: 'translate(0, 24px) scale(0.5)' },
        { opacity: 1, transform: `translate(${calm ? 0 : drift * 0.3}px, ${calm ? 0 : -16}px) scale(1.15)`, offset: 0.12 },
        { opacity: 1, transform: `translate(${calm ? 0 : drift * 0.6}px, ${rise * 0.55}px) scale(1)`, offset: 0.6 },
        { opacity: 0, transform: `translate(${calm ? 0 : drift}px, ${rise}px) scale(1)` },
      ],
      { duration: 3800, easing: 'ease-out', fill: 'forwards' },
    );
    return () => { try { anim.cancel(); } catch { /* already gone */ } };
  }, [drift]);

  return (
    <span ref={ref} className="meeting-fx__float" style={{ insetInlineStart: `${lane}%` }}>
      <span className="meeting-fx__emoji">{emoji}</span>
      <span className="meeting-fx__name">{name}</span>
    </span>
  );
}

/** Overlay over the whole stage. `reactions` = [{id, key, displayName, emoji}] (auto-pruned by the room hook after ~3 s). */
export function ReactionLayer({ reactions, myKey, youLabel }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="meeting-fx" aria-hidden="true">
      {reactions.map((r) => (
        <FloatingReaction key={r.id} emoji={r.emoji || '👍'} name={r.key === myKey ? youLabel : r.displayName} />
      ))}
    </div>
  );
}

/** The big emoji that pops over the tile of whoever reacted. */
export function TileReaction({ reaction }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return undefined;
    const calm = reducedMotion();
    const anim = el.animate(
      calm
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
        : [
          { opacity: 0, transform: 'translate(-50%, 18px) scale(0.4)' },
          { opacity: 1, transform: 'translate(-50%, 0) scale(1.3)', offset: 0.14 },
          { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.28 },
          { opacity: 1, transform: 'translate(-50%, -26px) scale(1)', offset: 0.8 },
          { opacity: 0, transform: 'translate(-50%, -48px) scale(1)' },
        ],
      { duration: 2800, easing: 'ease-out', fill: 'forwards' },
    );
    return () => { try { anim.cancel(); } catch { /* already gone */ } };
  }, [reaction.id]);

  return <span ref={ref} className="meeting-tile__reaction-pop" aria-hidden="true">{reaction.emoji || '👍'}</span>;
}
