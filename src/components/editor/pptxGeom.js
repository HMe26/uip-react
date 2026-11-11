/** SVG paths (in the shape's own EMU box, w × h) for the preset geometries the editor can draw. Unknown presets fall back to a rectangle. */
const poly = (pts) => `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
function star(w, h, n, inner) {
  const pts = []; for (let k = 0; k < n * 2; k += 1) { const a = -Math.PI / 2 + (k * Math.PI) / n; const r = k % 2 ? inner : 1; pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]); }
  return poly(pts);
}
export function geomPath(prst, w, h) {
  const m = Math.min(w, h);
  switch (prst) {
    case 'roundRect': { const r = m * 0.1667; return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`; }
    case 'ellipse': return `M${w / 2} 0A${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h}A${w / 2} ${h / 2} 0 1 1 ${w / 2} 0Z`;
    case 'triangle': return poly([[w / 2, 0], [w, h], [0, h]]);
    case 'rtTriangle': return poly([[0, 0], [0, h], [w, h]]);
    case 'diamond': case 'flowChartDecision': return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': return poly([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]);
    case 'trapezoid': return poly([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]]);
    case 'hexagon': return poly([[0, h / 2], [w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h]]);
    case 'pentagon': return poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]);
    case 'star5': return star(w, h, 5, 0.382);
    case 'star4': return star(w, h, 4, 0.382);
    case 'star6': return star(w, h, 6, 0.5);
    case 'rightArrow': { const hx = w - m * 0.5; return poly([[0, h * 0.25], [hx, h * 0.25], [hx, 0], [w, h / 2], [hx, h], [hx, h * 0.75], [0, h * 0.75]]); }
    case 'leftArrow': { const hx = m * 0.5; return poly([[w, h * 0.25], [hx, h * 0.25], [hx, 0], [0, h / 2], [hx, h], [hx, h * 0.75], [w, h * 0.75]]); }
    case 'upArrow': { const hy = m * 0.5; return poly([[w * 0.25, h], [w * 0.25, hy], [0, hy], [w / 2, 0], [w, hy], [w * 0.75, hy], [w * 0.75, h]]); }
    case 'downArrow': { const hy = h - m * 0.5; return poly([[w * 0.25, 0], [w * 0.25, hy], [0, hy], [w / 2, h], [w, hy], [w * 0.75, hy], [w * 0.75, 0]]); }
    case 'chevron': return poly([[0, 0], [w * 0.7, 0], [w, h / 2], [w * 0.7, h], [0, h], [w * 0.3, h / 2]]);
    case 'plus': case 'mathPlus': return poly([[w * 0.35, 0], [w * 0.65, 0], [w * 0.65, h * 0.35], [w, h * 0.35], [w, h * 0.65], [w * 0.65, h * 0.65], [w * 0.65, h], [w * 0.35, h], [w * 0.35, h * 0.65], [0, h * 0.65], [0, h * 0.35], [w * 0.35, h * 0.35]]);
    case 'line': case 'straightConnector1': return `M0 0L${w} ${h}`;
    default: return `M0 0H${w}V${h}H0Z`;
  }
}
/** Shapes offered in Insert ▸ Shapes. */
export const SHAPE_MENU = [
  ['rect', 'Rectangle', 'مستطيل'], ['roundRect', 'Rounded rectangle', 'مستطيل مدوّر'], ['ellipse', 'Oval', 'دائرة'], ['triangle', 'Triangle', 'مثلث'],
  ['diamond', 'Diamond', 'معيّن'], ['hexagon', 'Hexagon', 'سداسي'], ['pentagon', 'Pentagon', 'خماسي'], ['star5', 'Star', 'نجمة'],
  ['rightArrow', 'Right arrow', 'سهم يمين'], ['leftArrow', 'Left arrow', 'سهم يسار'], ['chevron', 'Chevron', 'شيفرون'], ['plus', 'Plus', 'علامة +'],
];
export const DASH = { dash: [4, 3], sysDash: [3, 1], dot: [1, 3], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3] };
