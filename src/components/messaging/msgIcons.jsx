/**
 * Small chat-specific icon set not covered by the shared Icon.jsx catalog —
 * ported 1:1 (same paths) from uip_composer_icon() in
 * app/Views/messaging/app.php, plus the local icon('pin'/'x'/'check') set
 * from messaging.js's own icon() helper. Kept local to the messaging
 * feature instead of growing Icon.jsx's shared PATHS, same reasoning the
 * PHP view used.
 */
const PATHS = {
  paperclip:
    'M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48',
  smile:
    'M8 14s1.5 2 4 2 4-2 4-2',
  bold: 'M6 4h6a3.5 3.5 0 0 1 0 7H6z M6 11h7a3.5 3.5 0 0 1 0 7H6z',
  poll: 'M6 20V10M12 20V4M18 20v-7',
  mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8',
  send: 'm22 2-11 11M22 2 15 22l-4-9-9-4Z',
  pin: 'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  forward: 'm15 17 5-5-5-5M4 18v-2a4 4 0 0 1 4-4h12',
  react: 'M8 14s1.5 2 4 2 4-2 4-2',
  reply: 'M9 17 4 12l5-5M4 12h11a4 4 0 0 1 4 4v1',
  more: 'M12 5v.01M12 12v.01M12 19v.01',
  gif: 'M8 9v6M13 9v6M13 12h2.5M18.5 9v6M16.5 9H19M16.5 12.5H19',
};

const RECTS = {
  gif: [{ x: 3, y: 6, width: 18, height: 12, rx: 2 }],
};

const CIRCLES = {
  smile: [{ cx: 12, cy: 12, r: 10 }],
  react: [{ cx: 12, cy: 12, r: 10 }],
  more: [
    { cx: 12, cy: 5, r: 1 },
    { cx: 12, cy: 12, r: 1 },
    { cx: 12, cy: 19, r: 1 },
  ],
};

const LINES = {
  smile: [
    { x1: 9, y1: 9, x2: 9.01, y2: 9 },
    { x1: 15, y1: 9, x2: 15.01, y2: 9 },
  ],
  react: [
    { x1: 9, y1: 9, x2: 9.01, y2: 9 },
    { x1: 15, y1: 9, x2: 15.01, y2: 9 },
  ],
};

export default function MsgIcon({ name, size = 18 }) {
  const d = PATHS[name] || '';
  const circles = CIRCLES[name] || [];
  const lines = LINES[name] || [];
  const rects = RECTS[name] || [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={r.rx} />
      ))}
      {d ? <path d={d} /> : null}
      {circles.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </svg>
  );
}
