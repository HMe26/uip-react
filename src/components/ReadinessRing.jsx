/**
 * Port of public/assets/js/components/readiness-ring.js — same markup/
 * classes (.readiness-ring, .readiness-ring__track/__progress/__label/
 * __score/__caption), same circumference/offset math, so it reads
 * identically to the PHP-rendered ring.
 */
export default function ReadinessRing({ score = 0, size = 120, caption = 'Readiness' }) {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const band = clamped >= 75 ? 'high' : clamped >= 50 ? 'mid' : 'low';
  const center = size / 2;

  return (
    <div
      className="readiness-ring"
      data-readiness-ring
      data-band={band}
      style={{ '--ring-circumference': circumference, '--ring-offset': offset }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="readiness-ring__track" cx={center} cy={center} r={radius} />
        <circle
          className="readiness-ring__progress"
          cx={center} cy={center} r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="readiness-ring__label">
        <span className="readiness-ring__score">{Math.round(clamped)}</span>
        <span className="readiness-ring__caption">{caption}</span>
      </span>
    </div>
  );
}
