import { useId, useRef, useState } from 'react';

/** Smooth path through [[x,y],...] (same curve the Insight charts use). */
function smooth(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1]; const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}
function niceTop(max) {
  if (max <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(max)); const n = max / pow;
  const top = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  return Math.max(4, Math.ceil(top / 4) * 4); // 4 even bands -> integer gridlines
}

/**
 * Two-series line chart (design: "Security activity"). series[0] gets the
 * gradient area; both are hover-inspectable. labels[] is the x axis.
 */
export function ActivityChart({ labels, series, height = 250, emptyText }) {
  const uid = useId().replace(/:/g, '');
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  const all = series.flatMap((s) => s.values);
  if (!labels.length || all.every((v) => !v)) return <div className="chart-empty">{emptyText}</div>;
  const W = 720; const H = height; const pad = { t: 14, r: 14, b: 30, l: 40 };
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const top = niceTop(Math.max(...all));
  const x = (i) => pad.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / top) * ih;
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const lines = series.map((s) => s.values.map((v, i) => [x(i), y(v)]));
  const onMove = (e) => {
    const r = wrap.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / iw) * (labels.length - 1)))));
  };
  const step = Math.ceil(labels.length / 8);
  return (
    <div className="chart-wrap" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={document.documentElement.lang === 'ar' ? 'نشاط الأمان' : 'Security activity'}>
        <defs>
          <linearGradient id={`a${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0].color} stopOpacity=".24" />
            <stop offset="100%" stopColor={series[0].color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="chart-axis">{Math.round(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % step === 0 || i === labels.length - 1) && (
          <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle" className="chart-axis">{l}</text>
        ))}
        <path d={`${smooth(lines[0])} L${lines[0][lines[0].length - 1][0]},${pad.t + ih} L${lines[0][0][0]},${pad.t + ih} Z`} fill={`url(#a${uid})`} />
        {lines.map((pts, i) => <path key={i} d={smooth(pts)} fill="none" stroke={series[i].color} strokeWidth="2.4" strokeLinecap="round" />)}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="chart-guide" />
            {lines.map((pts, i) => <circle key={i} cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill={series[i].color} stroke="var(--bg-surface)" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(Math.min(...lines.map((p) => p[hover][1])) / H) * 100}%` }}>
          <strong>{labels[hover]}</strong>
          {series.map((s) => <span key={s.name} style={{ color: s.color }}>{s.name}: {s.values[hover]}</span>)}
        </div>
      )}
    </div>
  );
}

/** Donut with the total in the middle and a two-column legend (design). */
export function SeverityDonut({ segments, centerLabel, emptyText }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <div className="chart-empty">{emptyText}</div>;
  const R = 70; const C = 2 * Math.PI * R; let off = 0;
  return (
    <div>
      <div className="donut__ring" style={{ margin: '4px auto 0' }}>
        <svg viewBox="0 0 200 200" role="img" aria-label={document.documentElement.lang === 'ar' ? 'الحوادث حسب الخطورة' : 'Incidents by severity'}>
          {segments.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * C; const gap = segments.filter((z) => z.value > 0).length > 1 ? 3 : 0;
            const el = <circle key={s.key} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="24" strokeDasharray={`${Math.max(len - gap, 0)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 100 100)" />;
            off += len; return el;
          })}
        </svg>
        <div className="donut__center"><strong>{total}</strong>{centerLabel && <span>{centerLabel}</span>}</div>
      </div>
      <ul className="sec-legend">
        {segments.map((s) => <li key={s.key}><i style={{ background: s.color }} /><span>{s.label}</span><b>{s.value}</b></li>)}
      </ul>
    </div>
  );
}
