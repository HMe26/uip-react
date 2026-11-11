/** Which My PC files open in the code editor (text) vs the viewer — shared by the classic page and the desktop windows. */
export const TEXT_EXT = new Set(['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env', 'gitignore', 'csv', 'tsv',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'rb', 'go', 'rs', 'kt',
  'swift', 'dart', 'lua', 'pl', 'r', 'jl', 'hs', 'f90', 'pas', 'swift', 'm', 'mm', 'vb', 'scala', 'ex', 'exs', 'erl', 'fs', 'fsx', 'ml', 'clj', 'lisp', 'lsp', 'cob', 'cbl', 'asm', 'nasm', 'dpr', 'bas', 'cls', 'frm', 'ps1', 'sol', 'abap', 'sas', 'plsql', 'pls', 'tsql', 'pro', 'adb', 'ads', 'v', 'zig', 'groovy', 'gvy', 'kts', 'scm', 'rkt', 'sql', 'sh', 'bat', 'css', 'scss', 'less', 'html', 'htm', 'svg', 'lock', 'gradle', 'properties', 'geojson', 'webmanifest', 'har', 'ipynb', 'jsonl', 'ndjson']);
/** Structured JSON files: they open in the JSON viewer (tree / outline / code, themes, search); "Edit" still opens the code editor. */
export const JSON_EXT = new Set(['json', 'geojson', 'webmanifest', 'har', 'ipynb', 'jsonl', 'ndjson']);
export const isJsonName = (n) => JSON_EXT.has(extOf(n));
/** Open in the code editor by default (text, but not JSON — that goes to the viewer first). */
export const opensInEditor = (n) => isTextName(n) && !isJsonName(n);
export const TEXT_NAMES = /^(makefile|dockerfile|procfile|readme|license|changelog|\.gitignore|\.env.*|\.editorconfig)$/i;
export const extOf = (n) => { const s = String(n || ''); const i = s.lastIndexOf('.'); return i >= 0 ? s.slice(i + 1).toLowerCase() : ''; };
export const isTextName = (n) => TEXT_EXT.has(extOf(n)) || TEXT_NAMES.test(String(n || ''));
