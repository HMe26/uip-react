/**
 * Reads the text out of an uploaded exam file, entirely in the browser (nothing is uploaded).
 * Supports PDF (text-based), Word (.docx) and plain text. Libraries are loaded on demand so they
 * don't weigh down the rest of the app.
 */

import { pdfjsAssetOptions } from '../lib/pdfjsOptions';

export const ACCEPTED_EXAM_FILES = '.pdf,.docx,.txt,.md';
export const MAX_EXAM_FILE_BYTES = 15 * 1024 * 1024;

const ext = (name) => String(name || '').toLowerCase().split('.').pop();

async function readPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...pdfjsAssetOptions }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(n);
    // eslint-disable-next-line no-await-in-loop
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    content.items.forEach((item) => {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; } else if (item.str && !/\s$/.test(item.str)) { line += ' '; }
    });
    if (line.trim()) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+$/g, '')).join('\n'));
  }
  return pages.join('\n\n');
}

async function readDocx(file) {
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await (mammoth.default || mammoth).extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value || '';
}

/** @returns {Promise<string>} the extracted text (trimmed). Throws an Error with a readable message. */
export async function extractDocumentText(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_EXAM_FILE_BYTES) throw new Error('The file is larger than 15 MB.');

  const type = ext(file.name);
  let text = '';
  if (type === 'pdf') text = await readPdf(file);
  else if (type === 'docx') text = await readDocx(file);
  else if (type === 'txt' || type === 'md') text = await file.text();
  else if (type === 'doc') throw new Error('Old .doc files are not supported — save the file as .docx or PDF and try again.');
  else throw new Error('Unsupported file type. Use PDF, Word (.docx) or a text file.');

  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('No readable text was found. If this is a scanned PDF (images only), it needs OCR first.');
  return text;
}

/** Splits long text into pieces (≤ max chars) on blank lines so the AI never receives half a question. */
export function chunkText(text, max = 15000) {
  if (text.length <= max) return [text];
  const chunks = [];
  let current = '';
  text.split(/\n{2,}/).forEach((para) => {
    if (para.length > max) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < para.length; i += max) chunks.push(para.slice(i, i + max));
      return;
    }
    if ((current + '\n\n' + para).length > max && current) { chunks.push(current); current = para; } else { current = current ? `${current}\n\n${para}` : para; }
  });
  if (current) chunks.push(current);
  return chunks;
}
