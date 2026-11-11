// Copies the OCR engine (tesseract.js worker + wasm core) and the English / Arabic language data into public/ocr,
// so the image editor's "Edit text" works under the site's strict CSP (everything is served from our own origin).
// Runs automatically before `npm run dev` / `build` / `build:native`.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
mkdirSync(join(out, 'lang'), { recursive: true });

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'lang/ara.traineddata.gz'],
];
let missing = 0;
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) { console.warn(`[ocr] missing ${from} — run npm install`); missing += 1; continue; }
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(src, join(out, to));
}
console.log(missing ? `[ocr] copied with ${missing} missing file(s)` : '[ocr] assets ready in public/ocr');

// ---- pdf.js assets (standard fonts, CMaps, ICC profiles, wasm decoders) -> public/pdfjs ----
// Served from our own origin because the CSP only allows connect-src 'self'. Without them PDFs whose fonts are not
// embedded render with squeezed / overlapping letters in the file preview and the PDF editor.
const pdfjsPkg = join(root, 'node_modules', 'pdfjs-dist');
if (!existsSync(pdfjsPkg)) {
  console.warn('[pdfjs] pdfjs-dist not installed — run npm install');
} else {
  const pdfjsOut = join(root, 'public', 'pdfjs');
  mkdirSync(pdfjsOut, { recursive: true });
  for (const dir of ['standard_fonts', 'cmaps', 'iccs', 'wasm']) {
    if (existsSync(join(pdfjsPkg, dir))) cpSync(join(pdfjsPkg, dir), join(pdfjsOut, dir), { recursive: true });
  }
  console.log('[pdfjs] assets ready in public/pdfjs');
}
