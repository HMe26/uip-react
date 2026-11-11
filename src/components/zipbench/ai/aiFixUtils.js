/**
 * Pure helpers for the "explain / fix this error" feature of the workbench (no React, no network) — unit-tested in
 * __tests__/aiFixUtils.test.js.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;

/** Terminal colours / cursor moves and carriage returns are noise for the model (the server strips them again). */
export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI, '').replace(/\r\n?/g, '\n');
}

/** The end of the output is where the real error is: keep the last `max` characters, cut at a line start. */
export function tailOutput(text, max = 6000) {
  const t = stripAnsi(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(-max);
  const nl = cut.indexOf('\n');
  return (nl > -1 && nl < 400 ? cut.slice(nl + 1) : cut).trim();
}

const ERROR_WORDS = /\b(error|exception|traceback|fatal|failed|failure|cannot|can't find|undefined|not found|denied|unexpected|syntaxerror|typeerror|referenceerror|nameerror|parse error|npm err|panic)\b/i;

/** Does the output look like it contains an error? (only used to highlight the button — it is always usable). */
export const looksLikeError = (text) => ERROR_WORDS.test(stripAnsi(text).slice(-8000));

// ---- which file is the error in? ---------------------------------------------------------------------------------

const CODE_EXT = 'js|jsx|ts|tsx|mjs|cjs|py|php|java|kt|rb|go|rs|c|cc|cpp|h|hpp|cs|vue|html|htm|css|scss|json|swift|dart|sh|sql|blade\\.php';
const SKIP_REF = /(^|\/)(node_modules|vendor|site-packages|dist-packages|\.venv|venv|__pycache__)\/|^\/usr\/(local\/)?lib\/|^<|^node:/i;

/** [{ file, line }] in the order they appear in the output. */
export function extractRefs(output) {
  const text = stripAnsi(output);
  const refs = [];
  const add = (file, line) => {
    const f = String(file || '').replace(/\\/g, '/').replace(/^file:\/\//, '').replace(/^\.\//, '').replace(/[?#].*$/, '');
    const n = parseInt(line, 10);
    if (f && n > 0 && !SKIP_REF.test(f)) refs.push({ file: f, line: n });
  };
  const rx = [
    [/File "([^"\n]+)", line (\d+)/g, 1, 2],                                                       // Python
    [new RegExp(`((?:[A-Za-z]:)?[\\w@.\\\\/ -]*?[\\w@.-]+\\.(?:${CODE_EXT})):(\\d+)(?::\\d+)?`, 'g'), 1, 2], // path:line[:col]
    [new RegExp(`((?:[A-Za-z]:)?[\\w@.\\\\/-]+\\.(?:${CODE_EXT})) on line (\\d+)`, 'g'), 1, 2],  // PHP "in x.php on line 12"
    [new RegExp(`\\bin ((?:[A-Za-z]:)?[\\w@.\\\\/-]+\\.(?:${CODE_EXT})) line (\\d+)`, 'g'), 1, 2],
  ];
  for (const [re, fi, li] of rx) {
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(text))) add(m[fi].trim(), m[li]);
  }
  const pos = (r) => text.indexOf(`${r.file.split('/').pop()}`);
  return refs.map((r, i) => ({ ...r, i, p: pos(r) })).sort((a, b) => a.p - b.p || a.i - b.i).map(({ file, line }) => ({ file, line }));
}

/** Longest tail of `path` (dropping leading folders) that `ref` ends with: the sandbox prints paths relative to the app folder or absolute. */
function matchScore(ref, path) {
  const segs = path.split('/');
  for (let k = 0; k < segs.length; k += 1) {
    const tail = segs.slice(k).join('/');
    if (ref === tail || ref.endsWith(`/${tail}`)) return tail.length;
  }
  return 0;
}

/**
 * The project file (and line) the error output points at, or null.
 * Python tracebacks list the failing frame LAST; everything else (Node, PHP, Java…) lists it first.
 */
export function guessErrorFile(output, paths, activePath = '') {
  const refs = extractRefs(output);
  if (!refs.length) return null;
  const ordered = /Traceback \(most recent call last\)/.test(output) ? refs.slice().reverse() : refs;
  for (const r of ordered) {
    let best = null; let bestScore = 0;
    for (const p of paths) {
      const s = matchScore(r.file, p);
      if (s > bestScore || (s === bestScore && s > 0 && p === activePath)) { best = p; bestScore = s; }
    }
    if (best) return { path: best, line: r.line };
  }
  return null;
}

// ---- applying SEARCH/REPLACE edits (the server already checked each SEARCH matches once) ---------------------------

const count = (hay, needle) => {
  if (!needle) return 0;
  let n = 0; let i = hay.indexOf(needle);
  while (i !== -1) { n += 1; i = hay.indexOf(needle, i + needle.length); }
  return n;
};

/** Applies ONE edit to `text`. { ok:true, text } or { ok:false, reason:'missing'|'ambiguous' } (the code changed since the AI saw it). */
export function applyEdit(text, edit) {
  const crlf = text.includes('\r\n');
  const t = text.replace(/\r\n?/g, '\n');
  const search = String(edit?.search ?? '').replace(/\r\n?/g, '\n');
  const replace = String(edit?.replace ?? '').replace(/\r\n?/g, '\n');
  const n = count(t, search);
  if (n === 0) return { ok: false, reason: 'missing' };
  if (n > 1) return { ok: false, reason: 'ambiguous' };
  const at = t.indexOf(search);
  const out = t.slice(0, at) + replace + t.slice(at + search.length);
  return { ok: true, text: crlf ? out.replace(/\n/g, '\r\n') : out };
}

/** Applies several edits one after the other. { text, applied:number[], failed:number[] } (indexes into `edits`). */
export function applyEdits(text, edits) {
  let cur = text; const applied = []; const failed = [];
  (edits || []).forEach((e, i) => {
    const r = applyEdit(cur, e);
    if (r.ok) { cur = r.text; applied.push(i); } else failed.push(i);
  });
  return { text: cur, applied, failed };
}

/** Rows for a small diff: unchanged context (max 2 lines each side), removed lines, added lines. */
export function diffRows(edit) {
  const a = String(edit?.search ?? '').split('\n');
  const b = String(edit?.replace ?? '').split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q += 1;
  const start = Number(edit?.start_line) || 1;
  const rows = [];
  for (let i = Math.max(0, p - 2); i < p; i += 1) rows.push({ t: ' ', n: start + i, s: a[i] });
  for (let i = p; i < a.length - q; i += 1) rows.push({ t: '-', n: start + i, s: a[i] });
  for (let i = p; i < b.length - q; i += 1) rows.push({ t: '+', n: null, s: b[i] });
  for (let i = 0; i < Math.min(2, q); i += 1) rows.push({ t: ' ', n: start + a.length - q + i, s: a[a.length - q + i] });
  return rows;
}

// ---- language label for the prompt -------------------------------------------------------------------------------

const LANG = { js: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX', mjs: 'JavaScript', cjs: 'JavaScript', py: 'Python', php: 'PHP', java: 'Java', kt: 'Kotlin', rb: 'Ruby', go: 'Go', rs: 'Rust', c: 'C', cpp: 'C++', cc: 'C++', h: 'C', hpp: 'C++', cs: 'C#', vue: 'Vue', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', json: 'JSON', swift: 'Swift', dart: 'Dart', sh: 'Shell', sql: 'SQL' };
export function languageOf(path) {
  const name = String(path || '').toLowerCase();
  if (name.endsWith('.blade.php')) return 'Blade (Laravel)';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return LANG[ext] || '';
}

// ---- "convert" / "tests" results: suggested name of the new file --------------------------------------------------

/** Languages offered in the "Convert to …" items of the right-click menu. */
export const CONVERT_TARGETS = ['Python', 'JavaScript', 'Java', 'C++', 'PHP', 'C#'];
const TARGET_EXT = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', 'c++': 'cpp', php: 'php', 'c#': 'cs', c: 'c', go: 'go', ruby: 'rb', kotlin: 'kt', swift: 'swift', rust: 'rs', dart: 'dart' };

/** Where the code block of a "convert" / "test" answer is saved: next to the source file, named after it. */
export function suggestFileName(action, path, target = '') {
  const p = String(path || 'file');
  const slash = p.lastIndexOf('/');
  const dir = p.slice(0, slash + 1);
  const name = p.slice(slash + 1) || 'file';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  if (action === 'convert') return `${dir}${stem}.${TARGET_EXT[String(target).toLowerCase()] || 'txt'}`;
  const e = ext.toLowerCase();
  if (e === 'py') return `${dir}test_${stem}.py`;
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(e)) return `${dir}${stem}.test.${e}`;
  if (e === 'php') return `${dir}${stem[0].toUpperCase()}${stem.slice(1)}Test.php`;
  if (e === 'java') return `${dir}${stem}Test.java`;
  return `${dir}${stem}_test${ext ? `.${ext}` : ''}`;
}
