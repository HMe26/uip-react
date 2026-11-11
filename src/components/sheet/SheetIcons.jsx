/** Small stroke icon set for the spreadsheet ribbon (24×24, currentColor). Anything the shared <Icon/> already has is used from there. */
const P = {
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3"/><rect x="7" y="13" width="10" height="8" rx="1"/>',
  download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  painter: '<rect x="4" y="3" width="13" height="6" rx="1.5"/><path d="M17 6h3v5h-8v3"/><rect x="10.5" y="14" width="3" height="7" rx="1"/>',
  sum: '<path d="M18 5H6l6 7-6 7h12"/>',
  sortaz: '<path d="M4 6h5M4 12h8M4 18h11"/><path d="M19 5v14"/><path d="m16 16 3 3 3-3"/>',
  sortza: '<path d="M4 6h11M4 12h8M4 18h5"/><path d="M19 5v14"/><path d="m16 8 3-3 3 3"/>',
  fx: '<path d="M14 5c-2.5 0-3 1.5-3.4 4L9.5 16c-.4 2.5-1 4-3.5 4"/><path d="M6 10h8"/><path d="m14 14 5 5m0-5-5 5"/>',
  grid: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  headings: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M8 4v16"/>',
  formulabar: '<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 12h6"/>',
  freeze: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M9 4v16" stroke-width="2.6"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/><path d="M8 10.5h5M10.5 8v5"/>',
  zoomin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/><path d="M8 10.5h5M10.5 8v5"/>',
  zoomout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/><path d="M8 10.5h5"/>',
  styles: '<rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="4" width="8" height="6" rx="1.5"/><rect x="3" y="14" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14.5h18M9 9v11"/><path d="M3 5.5h18v3.5H3z" fill="currentColor" opacity=".25"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  filldown: '<rect x="5" y="3" width="14" height="6" rx="1"/><path d="M12 11v9"/><path d="m8 16 4 4 4-4"/>',
  fillright: '<rect x="3" y="5" width="6" height="14" rx="1"/><path d="M11 12h9"/><path d="m16 8 4 4-4 4"/>',
  sheetplus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/>',
  wrap: '<path d="M4 6h16"/><path d="M4 12h12a3 3 0 0 1 0 6h-4"/><path d="m14 15-2 3 2 3"/><path d="M4 18h4"/>',
  growfont: '<path d="m3 19 5-13 5 13M5 14h6"/><path d="M17 8V3m-2.5 2.5h5"/>',
  shrinkfont: '<path d="m3 19 5-13 5 13M5 14h6"/><path d="M14.5 5.5h5"/>',
  names: '<path d="M4 7h16v10H4z"/><path d="M8 11h8M8 14h5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/>',
  goto: '<path d="M4 4h6v6H4zM14 14h6v6h-6z"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/><path d="m15 12 2 2 2-2"/>',
  recalc: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  landscape: '<rect x="3" y="6" width="18" height="12" rx="2"/>',
  portrait: '<rect x="6" y="3" width="12" height="18" rx="2"/>',
  csv: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  xlsx: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="m9.5 12 5 6m0-6-5 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hide: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.3 7.6A16.4 16.4 0 0 0 2 12s3.5 6 10 6c1.4 0 2.6-.3 3.7-.7"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 7.8 11.8 12M8.2 16.2 20 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4Z"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="11" width="3" height="6" rx=".5"/><rect x="12" y="7" width="3" height="10" rx=".5"/><rect x="17" y="13" width="3" height="4" rx=".5"/>',
  cf: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.3h18M3 14.6h18M9 4v16"/><path d="M12 6.5h7M12 11.9h4M12 17.2h6" stroke-width="2.6"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
};

export default function SxIcon({ name, size = 18, className = '' }) {
  return (
    <svg className={`sxi ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: P[name] || '' }} />
  );
}
export const hasIcon = (n) => !!P[n];
