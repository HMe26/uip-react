/**
 * Spreadsheet read / write for the grid editor (.xlsx / .csv / .tsv).
 *   readSheets(blob, ext) -> [{ name, cells: string[][] }]
 *   buildSheets(sheets, ext, { rtl }) -> Blob
 * Formulas are saved as their last values; colours / widths / charts of the original are not kept.
 */
import { parseCsv, toCsv } from '../exporter';

export const MAX_COLS = 200;

/** Sheet themes: how the grid looks on screen (bg .. band, accent) and which colours go into a saved .xlsx (xl). CSV / TSV cannot hold colours. */
export const THEMES = [
  { id: 'dark', en: 'Dark', ar: 'داكن', bg: '#0c111c', fg: '#e6ecff', head: '#171e30', headFg: '#9aa7c7', headOn: '#26324f', headOnFg: '#ffffff', hdBg: '#1b2540', hdFg: '#cfe0ff', band: '', line: 'rgba(255,255,255,.09)', swatch: '#1b2540', xl: { head: '#E8ECFF', fg: '#1B2559', band: '' } },
  { id: 'excel', en: 'Excel green', ar: 'أخضر Excel', bg: '#ffffff', fg: '#1f2937', head: '#f0f3f1', headFg: '#4b5563', headOn: '#c7e6d1', headOnFg: '#14532d', hdBg: '#217346', hdFg: '#ffffff', band: '#eaf5ee', line: '#d4d9d6', accent: '#217346', swatch: '#217346', xl: { head: '#217346', fg: '#FFFFFF', band: '#EAF5EE' } },
  { id: 'blue', en: 'Ocean blue', ar: 'أزرق', bg: '#ffffff', fg: '#1f2937', head: '#eff3fa', headFg: '#4b5563', headOn: '#c9dbf7', headOnFg: '#1e3a8a', hdBg: '#1f4e9c', hdFg: '#ffffff', band: '#eaf1fb', line: '#d5dbe6', accent: '#2563eb', swatch: '#1f4e9c', xl: { head: '#1F4E9C', fg: '#FFFFFF', band: '#EAF1FB' } },
  { id: 'violet', en: 'Violet', ar: 'بنفسجي', bg: '#ffffff', fg: '#1f2937', head: '#f4f1fb', headFg: '#4b5563', headOn: '#ddd0f7', headOnFg: '#4c1d95', hdBg: '#6d28d9', hdFg: '#ffffff', band: '#f1ecfd', line: '#ddd8e8', accent: '#7c3aed', swatch: '#6d28d9', xl: { head: '#6D28D9', fg: '#FFFFFF', band: '#F1ECFD' } },
  { id: 'orange', en: 'Sunset', ar: 'برتقالي', bg: '#ffffff', fg: '#1f2937', head: '#fbf3ee', headFg: '#4b5563', headOn: '#f9d9c3', headOnFg: '#7c2d12', hdBg: '#c2410c', hdFg: '#ffffff', band: '#fdf0e7', line: '#e6dcd5', accent: '#ea580c', swatch: '#c2410c', xl: { head: '#C2410C', fg: '#FFFFFF', band: '#FDF0E7' } },
  { id: 'slate', en: 'Classic gray', ar: 'رمادي كلاسيك', bg: '#ffffff', fg: '#111827', head: '#f1f2f4', headFg: '#4b5563', headOn: '#d6d9de', headOnFg: '#111827', hdBg: '#374151', hdFg: '#ffffff', band: '#f3f4f6', line: '#d1d5db', accent: '#4b5563', swatch: '#374151', xl: { head: '#374151', fg: '#FFFFFF', band: '#F3F4F6' } },
];
export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
const THEME_KEY = 'uip.sheet.theme';
export const loadTheme = () => { try { return themeById(localStorage.getItem(THEME_KEY) || 'excel').id; } catch { return 'excel'; } };
export const saveTheme = (id) => { try { localStorage.setItem(THEME_KEY, id); } catch { /* storage not available */ } };
export const MAX_CELLS = 400000;
export const cellStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v === null || v === undefined ? '' : String(v));

const parseTsv = (text) => String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.split('\t')).filter((r, i, a) => !(i === a.length - 1 && r.length === 1 && r[0] === ''));

export async function readSheets(blob, ext) {
  if (ext === 'csv' || ext === 'tsv') {
    const text = await blob.text();
    const rows = (ext === 'tsv' ? parseTsv(text) : parseCsv(text)).map((r) => r.map(cellStr));
    return [{ name: ext.toUpperCase(), cells: rows.length ? rows : [['']] }];
  }
  const { default: readExcelFile } = await import('read-excel-file/browser');
  const sheets = await readExcelFile(blob);
  return sheets.map((s) => ({ name: s.sheet, cells: s.data.length ? s.data.map((r) => r.map(cellStr)) : [['']] }));
}

/** Rectangular, trailing empty rows / columns removed. */
export function normalize(cells) {
  const rows = cells.map((r) => { let n = r.length; while (n > 0 && (r[n - 1] ?? '') === '') n -= 1; return r.slice(0, n); });
  while (rows.length > 1 && rows[rows.length - 1].length === 0) rows.pop();
  const w = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ''));
}

/** Plain numbers become numbers; IDs / phone numbers / zero-padded codes stay text. */
const typed = (s) => (s === '' ? null : /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s) ? Number(s) : s);

export function toCsvText(cells, delimiter = ',') {
  const rows = normalize(cells);
  if (delimiter === '\t') return rows.map((r) => r.map((c) => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
  return toCsv(rows[0], rows.slice(1));
}

export async function buildSheets(sheets, ext, { rtl, theme } = {}) {
  if (ext === 'csv') return new Blob(['\uFEFF', toCsvText(sheets[0].cells)], { type: 'text/csv;charset=utf-8' });
  if (ext === 'tsv') return new Blob([toCsvText(sheets[0].cells, '\t')], { type: 'text/tab-separated-values;charset=utf-8' });
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const used = new Set();
  const out = sheets.map((s, i) => {
    const rows = normalize(s.cells);
    let name = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)}_${i}`;
    used.add(name.toLowerCase());
    const X = themeById(theme).xl;
    const data = rows.map((r, ri) => r.map((c) => {
      if (ri === 0 && c !== '') return { value: String(c), fontWeight: 'bold', backgroundColor: X.head, textColor: X.fg };
      const v = typed(c);
      return X.band && ri > 0 && ri % 2 === 1 ? { value: v, backgroundColor: X.band } : v;
    }));
    const columns = rows[0].map((_, ci) => {
      let max = 8;
      for (let r = 0; r < Math.min(rows.length, 200); r += 1) max = Math.max(max, String(rows[r][ci]).length);
      return { width: Math.min(48, max + 2) };
    });
    return { data, sheet: name, columns, stickyRowsCount: 1, rightToLeft: !!rtl };
  });
  return writeXlsxFile(out).toBlob();
}

export const colName = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
