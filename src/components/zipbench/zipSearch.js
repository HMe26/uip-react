/** "Search in files" engine for the ZIP workbench (VS Code style: case / whole word / regex / include / exclude). */
import { isBinary } from './zipUtils';

export const MAX_FILE_BYTES = 1024 * 1024; // bigger files are skipped
export const MAX_MATCHES = 2000; // stop the whole search after this many hits
export const MAX_PER_FILE = 200;
const BATCH = 30; // files decompressed per tick (keeps the UI responsive)
const dec = new TextDecoder('utf-8');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds the RegExp for a query. Throws SyntaxError on an invalid regex (caller shows the message). */
export function compileQuery(query, { caseSensitive, wholeWord, regex }) {
  if (!query) return null;
  let src = regex ? query : esc(query);
  if (wholeWord) src = `\\b(?:${src})\\b`;
  // "m" so ^ and $ behave per line, matching the line-by-line scan below
  return new RegExp(src, caseSensitive ? 'gm' : 'gim');
}

function globToRegex(g) {
  let out = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { out += '.*'; i += 1; } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += esc(c);
  }
  return out;
}

/** "node_modules, *.php, src/components" -> list of RegExps. A pattern matches at any depth. */
export function parseGlobs(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .map((g) => new RegExp(`(?:^|/)${globToRegex(g)}(?:/|$)`, 'i'));
}

const matchesGlobs = (path, globs) => globs.some((re) => re.test(path));

function makeMatch(line, lineNo, idx, len) {
  const cut = idx - 40 > 0;
  let s = Math.max(0, idx - 40);
  if (!cut) s = Math.min(idx, line.length - line.trimStart().length); // drop indentation
  const e = Math.min(line.length, idx + len + 160);
  return {
    line: lineNo,
    col: idx, // 0-based column in the original line
    len,
    pre: (cut ? '…' : '') + line.slice(s, idx),
    hit: line.slice(idx, Math.min(idx + len, e)),
    post: line.slice(idx + len, e) + (e < line.length ? '…' : ''),
  };
}

function scan(text, re, limit) {
  re.lastIndex = 0;
  if (!re.test(text)) return { matches: [], capped: false }; // cheap pre-filter, most files miss
  const matches = [];
  const lines = text.split(/\r?\n/);
  let capped = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    re.lastIndex = 0;
    let m = re.exec(line);
    while (m) {
      if (!m[0]) { re.lastIndex += 1; } else {
        if (matches.length >= limit) { capped = true; return { matches, capped }; }
        matches.push(makeMatch(line, i + 1, m.index, m[0].length));
      }
      m = re.exec(line);
    }
  }
  return { matches, capped };
}

const tick = () => new Promise((r) => { setTimeout(r, 0); });

/**
 * files:      [{ path, size }]
 * readBatch:  async (paths) => Map(path -> Uint8Array)   (includes unsaved edits)
 * token:      { cancelled } – flip to true to abort
 * Resolves to { files:[{path,matches,capped}], total, truncated, skipped, done, of } or null when cancelled.
 */
export async function searchFiles({ files, readBatch, re, include, exclude, token, onProgress }) {
  const cand = files
    .filter((f) => (!include.length || matchesGlobs(f.path, include)) && !matchesGlobs(f.path, exclude))
    .filter((f) => !isBinary(f.path, new Uint8Array(0)))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));

  const out = [];
  let total = 0;
  let skipped = 0;
  let truncated = false;
  let done = 0;

  for (let i = 0; i < cand.length && !truncated; i += BATCH) {
    if (token.cancelled) return null;
    const batch = cand.slice(i, i + BATCH).filter((f) => {
      if (f.size > MAX_FILE_BYTES) { skipped += 1; return false; }
      return true;
    });
    // eslint-disable-next-line no-await-in-loop
    const data = await readBatch(batch.map((f) => f.path));
    if (token.cancelled) return null;
    for (const f of batch) {
      const bytes = data.get(f.path);
      if (!bytes || bytes.length > MAX_FILE_BYTES || isBinary(f.path, bytes)) continue;
      const { matches, capped } = scan(dec.decode(bytes), re, Math.min(MAX_PER_FILE, MAX_MATCHES - total));
      if (matches.length) {
        out.push({ path: f.path, matches, capped });
        total += matches.length;
        if (total >= MAX_MATCHES) { truncated = true; break; }
      }
    }
    done = Math.min(i + BATCH, cand.length);
    if (onProgress) onProgress({ files: out.slice(), total, truncated, skipped, done, of: cand.length });
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }
  return { files: out, total, truncated, skipped, done: truncated ? done : cand.length, of: cand.length };
}
