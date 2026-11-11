import { saveBlob } from './exporter';

/**
 * PDF safety. A PDF can carry JavaScript / launch actions / embedded files; opened in the browser's own
 * viewer it runs on OUR origin (that is how an `alert()` from an uploaded PDF showed up on the site).
 *  - scanPdfBlob(): looks for active content (also inside compressed object streams and #xx-obfuscated names).
 *  - PDFs are only ever drawn with pdf.js on a canvas (scripts never run), and a PDF flagged here is not
 *    opened at all: the viewer shows a warning instead.
 *  - downloadPdfChecked(): a flagged PDF needs TWO separate confirmations before it is saved.
 */

const NAMES = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'SubmitForm', 'ImportData', 'XFA', 'GoToE'];
const NAME_RE = new RegExp(`/(${NAMES.join('|')})(?![A-Za-z0-9])`, 'g');
const MAX_SCAN = 30 * 1024 * 1024;
const MAX_STREAMS = 400;

const latin1 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return out;
};

function scanText(text) {
  const decoded = text.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const found = new Set();
  for (const m of decoded.matchAll(NAME_RE)) found.add(m[1]);
  if (/\/Encrypt(?![A-Za-z0-9])/.test(decoded)) found.add('Encrypted');
  return found;
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined' || bytes.length < 8) return null;
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
      const buf = new Uint8Array(await new Response(stream).arrayBuffer());
      return buf.length > 8 * 1024 * 1024 ? buf.subarray(0, 8 * 1024 * 1024) : buf;
    } catch { /* try the next format */ }
  }
  return null;
}

/** @returns {Promise<{risky:boolean, findings:string[]}>} */
export async function scanPdfBlob(blob) {
  if (blob.size > MAX_SCAN) return { risky: true, findings: ['too_large_to_scan'] };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const raw = latin1(bytes);
  const found = scanText(raw);

  let n = 0;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) && n < MAX_STREAMS) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    n += 1;
    // eslint-disable-next-line no-await-in-loop
    const out = await inflate(bytes.subarray(start, Math.max(start, end - 1)));
    if (out) scanText(latin1(out)).forEach((f) => found.add(f));
    re.lastIndex = end;
  }
  return { risky: found.size > 0, findings: [...found] };
}

export const isPdfName = (name) => /\.pdf$/i.test(String(name || ''));

/** Two different warnings, one after the other. Returns true only if the person accepts both. */
export function confirmRiskyDownload(tt, name) {
  const first = tt(
    `⚠ Warning: "${name}" contains scripts or active content that can harm your device or your account.\n\nIt was NOT opened. Do you still want to download it?`,
    `⚠ تحذير: الملف "${name}" فيه سكربتات أو محتوى نشط ممكن يضر جهازك أو حسابك.\n\nاتمنع فتحه. عايز تنزّله برضو؟`
  );
  if (!window.confirm(first)) return false;
  const second = tt(
    'Final warning: only continue if you fully trust whoever sent this file. Never open it on a device with sensitive data, and do not enable scripts or macros if it asks.\n\nDownload it anyway?',
    'تحذير أخير: كمّل بس لو واثق تمامًا في اللي بعت الملف. متفتحوش على جهاز عليه بيانات حساسة، ولا تفعّل أي سكربتات أو ماكروز لو طلب منك.\n\nتنزّله رغم كده؟'
  );
  return window.confirm(second);
}

/**
 * Download a PDF (fetching it if no Blob is at hand). Clean => saved straight away.
 * Flagged (or impossible to inspect) => two warnings first.
 */
export async function downloadPdfChecked({ url, name, blob, tt }) {
  try {
    let b = blob;
    if (!b) {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      b = await res.blob();
    }
    const { risky } = await scanPdfBlob(b);
    if (risky && !confirmRiskyDownload(tt, name)) return false;
    saveBlob(new Blob([b], { type: 'application/octet-stream' }), name);
    return true;
  } catch {
    window.alert(tt('Download failed.', 'فشل التنزيل.'));
    return false;
  }
}
