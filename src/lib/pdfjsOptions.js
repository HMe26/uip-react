// Extra getDocument() options so pdf.js can draw PDFs whose fonts are not embedded (and CJK/Arabic CMaps, JPEG2000,
// ICC colours). The files are copied to public/pdfjs by scripts/copy-pdfjs-assets.mjs and served from our own origin,
// which is the only place the strict CSP lets pdf.js fetch them from.
const base = `${(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}pdfjs/`;

export const pdfjsAssetOptions = {
  standardFontDataUrl: `${base}standard_fonts/`,
  cMapUrl: `${base}cmaps/`,
  cMapPacked: true,
  iccUrl: `${base}iccs/`,
  wasmUrl: `${base}wasm/`,
  // Draw glyphs as vector paths instead of handing the PDF's embedded fonts to the browser. Slides exported from
  // PowerPoint / Google Slides often embed fonts the browser rejects; it then silently swaps in a fallback font whose
  // letter widths differ, which is what squeezes the text and makes it overlap its own shadow copy.
  disableFontFace: true,
  isEvalSupported: false,
  // 0 = errors only. Hides harmless pdf.js warnings such as "TT: undefined function: 32", which just means a font inside
  // the PDF has a broken TrueType hinting program that pdf.js already repairs by itself (the text still renders fine).
  verbosity: 0,
};
