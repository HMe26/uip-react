/** Ribbon presets: Cell Styles gallery, Format-as-Table styles, Format Cells palette. Plain style patches understood by ctl.style(). */

const line = (c = '#8ea9db', w = 'thin') => [w, c];

/** Cell Styles gallery (Excel names). `sample` is only used by the gallery tile. */
export const CELL_STYLES = [
  { id: 'normal', en: 'Normal', ar: 'عادي', patch: { b: null, i: null, u: null, st: null, color: null, bg: null, fs: null, font: null, bd: null, al: null, va: null, ind: null, wrap: null, nf: null }, reset: true },
  { id: 'good', en: 'Good', ar: 'جيد', patch: { bg: '#c6efce', color: '#006100' } },
  { id: 'bad', en: 'Bad', ar: 'سيئ', patch: { bg: '#ffc7ce', color: '#9c0006' } },
  { id: 'neutral', en: 'Neutral', ar: 'محايد', patch: { bg: '#ffeb9c', color: '#9c5700' } },
  { id: 'calc', en: 'Calculation', ar: 'حساب', patch: { bg: '#f2f2f2', color: '#fa7d00', b: 1, bd: { t: line('#7f7f7f'), b: line('#7f7f7f'), l: line('#7f7f7f'), r: line('#7f7f7f') } } },
  { id: 'check', en: 'Check Cell', ar: 'خلية تحقق', patch: { bg: '#a5a5a5', color: '#ffffff', b: 1, bd: { t: line('#3f3f3f', 'medium'), b: line('#3f3f3f', 'medium'), l: line('#3f3f3f', 'medium'), r: line('#3f3f3f', 'medium') } } },
  { id: 'input', en: 'Input', ar: 'إدخال', patch: { bg: '#ffcc99', color: '#3f3f76', bd: { t: line('#7f7f7f'), b: line('#7f7f7f'), l: line('#7f7f7f'), r: line('#7f7f7f') } } },
  { id: 'note', en: 'Note', ar: 'ملاحظة', patch: { bg: '#ffffcc', bd: { t: line('#b2b2b2'), b: line('#b2b2b2'), l: line('#b2b2b2'), r: line('#b2b2b2') } } },
  { id: 'explain', en: 'Explanatory Text', ar: 'نص توضيحي', patch: { color: '#7f7f7f', i: 1 } },
  { id: 'warn', en: 'Warning Text', ar: 'نص تحذير', patch: { color: '#ff0000' } },
  { id: 'title', en: 'Title', ar: 'عنوان', patch: { b: 1, fs: 18, color: '#44546a' } },
  { id: 'h1', en: 'Heading 1', ar: 'عنوان 1', patch: { b: 1, fs: 15, color: '#44546a', bd: { b: line('#4472c4', 'medium') } } },
  { id: 'h2', en: 'Heading 2', ar: 'عنوان 2', patch: { b: 1, fs: 13, color: '#44546a', bd: { b: line('#8ea9db', 'medium') } } },
  { id: 'h3', en: 'Heading 3', ar: 'عنوان 3', patch: { b: 1, fs: 11, color: '#44546a', bd: { b: line('#8ea9db') } } },
  { id: 'total', en: 'Total', ar: 'الإجمالي', patch: { b: 1, bd: { t: line('#000000'), b: line('#000000', 'medium') } } },
  { id: 'comma', en: 'Comma', ar: 'فاصلة', patch: { nf: '#,##0.00' } },
  { id: 'currency', en: 'Currency', ar: 'عملة', patch: { nf: '"$"#,##0.00' } },
  { id: 'percent', en: 'Percent', ar: 'نسبة مئوية', patch: { nf: '0%' } },
];

/** Format as Table: header row + banded body. */
export const TABLE_STYLES = [
  { id: 'blue', en: 'Blue', ar: 'أزرق', head: '#4472c4', band: '#d9e1f2', line: '#8ea9db' },
  { id: 'orange', en: 'Orange', ar: 'برتقالي', head: '#ed7d31', band: '#fce4d6', line: '#f4b183' },
  { id: 'green', en: 'Green', ar: 'أخضر', head: '#217346', band: '#e2efda', line: '#a9d08e' },
  { id: 'gold', en: 'Gold', ar: 'ذهبي', head: '#bf9000', band: '#fff2cc', line: '#ffd966' },
  { id: 'gray', en: 'Gray', ar: 'رمادي', head: '#595959', band: '#ededed', line: '#bfbfbf' },
  { id: 'dark', en: 'Dark', ar: 'داكن', head: '#1f2937', band: '#e5e7eb', line: '#9ca3af' },
  { id: 'light', en: 'Light', ar: 'فاتح', head: null, band: null, line: '#9ca3af' },
];

/** Style patch for cell (r, c) of the range g (first row = header). */
export function tableStylePatch(ts, g) {
  return (cur, r) => {
    const head = r === g.r1; const odd = (r - g.r1) % 2 === 1;
    const bd = { ...(cur.bd || {}), b: line(ts.line) }; if (head) bd.t = line(ts.line);
    if (head) return ts.head ? { bg: ts.head, color: '#ffffff', b: 1, bd } : { b: 1, bd: { ...bd, b: line(ts.line, 'medium') } };
    return { bg: ts.band && odd ? ts.band : null, color: null, b: null, bd };
  };
}

/** Quick number formats for Ctrl+Shift+digit. */
export const QUICK_NF = {
  1: '#,##0.00', 2: 'h:mm AM/PM', 3: 'd-mmm-yy', 4: '"$"#,##0.00', 5: '0%', 6: '0.00E+00', '`': 'General',
};

export const SWATCH_THEME = [
  ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'],
  ['#f2f2f2', '#7f7f7f', '#d0cece', '#d6dce4', '#d9e1f2', '#fce4d6', '#ededed', '#fff2cc', '#deebf7', '#e2efda'],
  ['#d9d9d9', '#595959', '#aeaaaa', '#adb9ca', '#b4c6e7', '#f8cbad', '#dbdbdb', '#ffe699', '#bdd7ee', '#c6e0b4'],
  ['#bfbfbf', '#404040', '#757171', '#8497b0', '#8eaadb', '#f4b183', '#c9c9c9', '#ffd966', '#9dc3e6', '#a9d08e'],
  ['#a6a6a6', '#262626', '#3b3838', '#323f4f', '#2f5597', '#c55a11', '#7b7b7b', '#bf9000', '#2e75b6', '#548235'],
];
export const SWATCH_STD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

/** Function categories for Formulas ▸ Function Library and the Insert Function dialog. */
export const FN_CATS = [
  { id: 'Math', en: 'Math & Trig', ar: 'رياضيات', list: 'SUM PRODUCT ABS ROUND ROUNDUP ROUNDDOWN INT MOD POWER SQRT SUMIF SUMIFS SUMPRODUCT CEILING FLOOR MROUND RAND RANDBETWEEN PI EXP LN LOG LOG10 FACT SIGN TRUNC SUBTOTAL' },
  { id: 'Statistical', en: 'Statistical', ar: 'إحصاء', list: 'AVERAGE AVERAGEIF AVERAGEIFS COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS MAX MIN MAXIFS MINIFS MEDIAN MODE LARGE SMALL RANK STDEV VAR PERCENTILE QUARTILE CORREL SLOPE INTERCEPT FORECAST' },
  { id: 'Logical', en: 'Logical', ar: 'منطقية', list: 'IF IFS IFERROR IFNA AND OR NOT XOR SWITCH TRUE FALSE ISBLANK ISNUMBER ISTEXT ISERROR ISNA' },
  { id: 'Text', en: 'Text', ar: 'نص', list: 'LEN LEFT RIGHT MID UPPER LOWER PROPER TRIM CONCAT CONCATENATE TEXTJOIN FIND SEARCH SUBSTITUTE REPLACE REPT TEXT VALUE EXACT CHAR CODE TEXTBEFORE TEXTAFTER TEXTSPLIT' },
  { id: 'Lookup', en: 'Lookup & Reference', ar: 'بحث ومراجع', list: 'VLOOKUP HLOOKUP XLOOKUP LOOKUP MATCH XMATCH INDEX OFFSET INDIRECT ROW COLUMN ROWS COLUMNS CHOOSE TRANSPOSE ADDRESS' },
  { id: 'Dynamic', en: 'Dynamic arrays', ar: 'مصفوفات ديناميكية', list: 'SORT SORTBY FILTER UNIQUE SEQUENCE TAKE DROP HSTACK VSTACK TOCOL TOROW CHOOSECOLS CHOOSEROWS' },
  { id: 'Date', en: 'Date & Time', ar: 'تاريخ ووقت', list: 'TODAY NOW DATE YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM EDATE EOMONTH DATEDIF DAYS NETWORKDAYS WORKDAY DATEVALUE TIME' },
  { id: 'Financial', en: 'Financial', ar: 'مالية', list: 'PMT IPMT PPMT FV PV NPER NPV IRR RATE SLN' },
];
