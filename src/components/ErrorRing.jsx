import Icon from './Icon';

const VARIANTS = {
  404: { badge: 'search', dashed: true, sweep: true },
  403: { badge: 'lock', dashed: false, sweep: false },
  500: { badge: 'alert-triangle', dashed: false, sweep: false, glitch: true },
};

/**
 * ErrorRing — the diagnostic twin of <ReadinessRing/> (components/
 * ReadinessRing.jsx + readiness-ring.css). Same circle math, same
 * .readiness-ring__* label markup, so it reads as unmistakably "the same
 * instrument" everywhere else in the product shows a score — except here
 * it's reading the status of the *page*, not a project:
 *   404 — a dashed arc, slowly sweeping: still searching, nothing found.
 *   403 — a short, solid, motionless arc: a reading that stopped on
 *         purpose, not one that's still looking.
 *   500 — a full arc that stutters on mount then settles into a slow
 *         pulse: the instrument itself is the thing that's unwell.
 * All motion is skipped under prefers-reduced-motion (see error-ring.css).
 */
export default function ErrorRing({ code = 404, size = 148 }) {
  const variant = VARIANTS[code] || VARIANTS[404];
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  // 403 reads a fixed, deliberately partial arc (~28%) — "denied", not "empty".
  const offset = code === 403 ? circumference - circumference * 0.28 : 0;

  return (
    <div
      className="error-ring"
      data-code={code}
      data-dashed={variant.dashed || undefined}
      data-sweep={variant.sweep || undefined}
      data-glitch={variant.glitch || undefined}
      style={{ width: size, height: size, '--ring-circumference': circumference }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="error-ring__track" cx={center} cy={center} r={radius} />
        <circle
          className="error-ring__progress"
          cx={center} cy={center} r={radius}
          strokeDasharray={variant.dashed ? '3 9' : circumference}
          strokeDashoffset={variant.dashed ? 0 : offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="readiness-ring__label error-ring__label">
        <span className="readiness-ring__score error-ring__score">{code}</span>
      </span>
      <span className="error-ring__badge">
        <Icon name={variant.badge} size={16} />
      </span>
    </div>
  );
}
