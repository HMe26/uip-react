/** Window snap zones as fractions of the window area: [x, y, w, h]. Keys are stored in win.snap. */
const T = 1 / 3;
export const SNAP_RECTS = {
  left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1],
  l13: [0, 0, T, 1], r23: [T, 0, 2 * T, 1], l23: [0, 0, 2 * T, 1], r13: [2 * T, 0, T, 1],
  t1: [0, 0, T, 1], t2: [T, 0, T, 1], t3: [2 * T, 0, T, 1],
  rt: [0.5, 0, 0.5, 0.5], rb: [0.5, 0.5, 0.5, 0.5], lt: [0, 0, 0.5, 0.5], lb: [0, 0.5, 0.5, 0.5],
  tl: [0, 0, 0.5, 0.5], tr: [0.5, 0, 0.5, 0.5], bl: [0, 0.5, 0.5, 0.5], br: [0.5, 0.5, 0.5, 0.5],
};

/** The layouts shown in the flyout (like Windows 11). Each is a list of zone keys. */
export const SNAP_LAYOUTS = [
  ['left', 'right'],
  ['l23', 'r13'],
  ['l13', 'r23'],
  ['t1', 't2', 't3'],
  ['left', 'rt', 'rb'],
  ['lt', 'lb', 'right'],
  ['tl', 'tr', 'bl', 'br'],
];

export const snapStyle = (key) => {
  const r = SNAP_RECTS[key]; if (!r) return null;
  return { left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` };
};
