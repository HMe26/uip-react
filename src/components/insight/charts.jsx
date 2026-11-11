import { useId, useRef, useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Small, dependency-free SVG/HTML chart primitives for the Insight Platform
 * (Data Analysis portal). Colors come only from CSS variables so light/dark
 * themes both work. Every chart renders a readable empty state instead of
 * an empty box.
 */

const ARIA = { 'Line chart': 'رسم بياني خطي', 'Donut chart': 'رسم بياني دائري', Close: 'إغلاق' };
const noData = () => (typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'لا توجد بيانات بعد.' : 'No data yet.');
const aria = (locale, key) => (locale === 'ar' ? ARIA[key] || key : key);

const fmt = (n) => Number(n || 0).toLocaleString();

function niceMax(max) {
  if (max <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

// Monotone-ish smooth path through points [[x,y],...]
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

export function ChartEmpty({ children }) {
  return <div className="chart-empty">{children}</div>;
}

/**
 * Line / area chart.
 *  data:        [{ label, value }]
 *  area:        fill under the line
 *  dots:        draw a marker on every point
 *  dashedFrom:  index from which the line is dashed (used for forecasts)
 *  band:        optional [{ lo, hi }] per point — confidence interval
 *  yMin:        force the y-axis minimum (default 0)
 */
export function AreaChart({
  data, area = true, dots = false, dashedFrom = null, band = null, yMin = 0,
  color = 'var(--color-primary)', height = 280, format = fmt, emptyText,
}) {
  const { locale } = useLanguage();
  const uid = useId().replace(/:/g, '');
  const wrap = useRef(null);
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0) return <ChartEmpty>{emptyText ?? noData()}</ChartEmpty>;

  const W = 760; const H = height;
  const pad = { t: 16, r: 16, b: 34, l: 48 };
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const highs = data.map((d, i) => Math.max(d.value, band?.[i]?.hi ?? d.value));
  const top = niceMax(Math.max(...highs));
  const bottom = Math.min(yMin, ...data.map((d) => d.value));
  const span = top - bottom || 1;
  const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - bottom) / span) * ih;
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const split = dashedFrom !== null && dashedFrom > 0 && dashedFrom < data.length ? dashedFrom : null;
  const solidPts = split === null ? pts : pts.slice(0, split);
  const dashPts = split === null ? [] : pts.slice(split - 1);
  const ticks = [0, 1, 2, 3, 4].map((i) => bottom + (span / 4) * i);
  const step = Math.ceil(data.length / 8);

  const onMove = (e) => {
    const r = wrap.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round(((px - pad.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  };

  return (
    <div className="chart-wrap" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={aria(locale, 'Line chart')}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" className="chart-axis">{format(Math.round(t * 10) / 10)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % step === 0 || i === data.length - 1) && (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="chart-axis">{d.label}</text>
        ))}
        {band && (
          <path
            d={`${smoothPath(band.map((b, i) => [x(i), y(b.hi)]))} L${[...band].reverse().map((b, i) => `${x(band.length - 1 - i)},${y(b.lo)}`).join(' L')} Z`}
            fill={color} opacity="0.10"
          />
        )}
        {area && solidPts.length > 1 && (
          <path d={`${smoothPath(solidPts)} L${solidPts[solidPts.length - 1][0]},${pad.t + ih} L${solidPts[0][0]},${pad.t + ih} Z`} fill={`url(#g${uid})`} />
        )}
        <path d={smoothPath(solidPts)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        {dashPts.length > 1 && <path d={smoothPath(dashPts)} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />}
        {dots && pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="4" fill="var(--bg-surface)" stroke={color} strokeWidth="2.5" />)}
        {hover !== null && (
          <g>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={pad.t} y2={pad.t + ih} className="chart-guide" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5.5" fill={color} stroke="var(--bg-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(pts[hover][0] / W) * 100}%`, top: `${(pts[hover][1] / H) * 100}%` }}>
          <strong>{data[hover].label}</strong>
          <span>{format(data[hover].value)}</span>
          {band?.[hover] && <em>{format(band[hover].lo)} – {format(band[hover].hi)}</em>}
        </div>
      )}
    </div>
  );
}

/** Donut with the total in the middle and a legend that shows each value. */
export function DonutChart({ segments, centerValue, centerLabel, emptyText }) {
  const { locale } = useLanguage();
  const total = (segments || []).reduce((s, x) => s + x.value, 0);
  if (!segments || total === 0) return <ChartEmpty>{emptyText ?? noData()}</ChartEmpty>;
  const R = 70; const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <div className="donut__ring">
        <svg viewBox="0 0 200 200" role="img" aria-label={aria(locale, 'Donut chart')}>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="26" />
          {segments.map((s) => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="26"
                strokeDasharray={`${Math.max(len - 2, 0)} ${C - Math.max(len - 2, 0)}`}
                strokeDashoffset={-offset} transform="rotate(-90 100 100)"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut__center">
          <strong>{centerValue ?? fmt(total)}</strong>
          {centerLabel && <span>{centerLabel}</span>}
        </div>
      </div>
      <ul className="donut__legend">
        {segments.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{fmt(s.value)}</b>
            <em>{Math.round((s.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, sorted as given. */
export function HBarChart({ items, color = 'var(--color-primary)', emptyText }) {
  if (!items || items.length === 0) return <ChartEmpty>{emptyText ?? noData()}</ChartEmpty>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="hbars">
      {items.map((it) => (
        <li key={it.label}>
          <span className="hbars__label" title={it.label}>{it.label}</span>
          <span className="hbars__track"><span style={{ width: `${Math.max(3, (it.value / max) * 100)}%`, background: color }} /></span>
          <b className="hbars__value">{fmt(it.value)}</b>
        </li>
      ))}
    </ul>
  );
}

/** Vertical grouped bars (used by Compare universities). */
export function GroupedBars({ items, series, emptyText }) {
  const [hover, setHover] = useState(null);
  if (!items || items.length === 0) return <ChartEmpty>{emptyText ?? noData()}</ChartEmpty>;
  const max = niceMax(Math.max(1, ...items.flatMap((i) => series.map((s) => i[s.key] || 0))));
  return (
    <div className="gbars">
      <div className="gbars__plot">
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <div key={f} className="gbars__row" style={{ bottom: `${f * 100}%` }}><span>{fmt(Math.round(max * f))}</span></div>
        ))}
        <div className="gbars__cols">
          {items.map((it, idx) => (
            <div key={it.label} className={`gbars__col${hover === idx ? ' is-hover' : ''}`} onMouseEnter={() => setHover(idx)} onMouseLeave={() => setHover(null)}>
              <div className="gbars__bars">
                {series.map((s) => (
                  <span key={s.key} className="gbars__bar" style={{ height: `${((it[s.key] || 0) / max) * 100}%`, background: s.color }} title={`${s.label}: ${fmt(it[s.key])}`} />
                ))}
              </div>
              {hover === idx && (
                <div className="chart-tip chart-tip--static">
                  <strong>{it.label}</strong>
                  {series.map((s) => <span key={s.key} style={{ color: s.color }}>{s.label}: {fmt(it[s.key])}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="gbars__labels">{items.map((it) => <span key={it.label} title={it.label}>{it.label}</span>)}</div>
      <div className="gbars__legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}

const TONES = { primary: 'var(--color-primary)', success: 'var(--color-success)', info: 'var(--color-info)', warning: 'var(--color-accent)', danger: 'var(--color-danger)' };

/** KPI tile. `progress` is 0–100; `delta` is a number (shown as ▲/▼ pill). */
export function KpiCard({ label, value, tone = 'primary', delta = null, note, progress = null }) {
  const color = TONES[tone] || tone;
  const up = delta !== null && delta >= 0;
  return (
    <div className="kpi-card">
      <div className="kpi-card__top">
        <span>{label}</span>
        <Icon name="pulse" size={18} style={{ color }} />
      </div>
      <strong className="kpi-card__value">{value}</strong>
      <div className="kpi-card__meta">
        {delta !== null && (
          <span className={`delta ${up ? 'delta--up' : 'delta--down'}`}>
            <Icon name={up ? 'arrow-up' : 'arrow-down'} size={11} />{up ? '+' : ''}{delta}%
          </span>
        )}
        {note && <em>{note}</em>}
      </div>
      {progress !== null && <div className="kpi-card__bar"><span style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: color }} /></div>}
    </div>
  );
}

/** Card wrapper with a heading row. */
export function Panel({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel__head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Segmented toggle (Students / Projects / Universities in the design). */
export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Right-hand slide-over. Fixed to the viewport top (no offset). */
export function Drawer({ open, title, subtitle, onClose, children }) {
  const { locale } = useLanguage();
  if (!open) return null;
  return (
    <div className="drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer__head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="topbar__icon-btn" onClick={onClose} aria-label={aria(locale, 'Close')}><Icon name="x" size={18} /></button>
        </header>
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  );
}

export { fmt };
