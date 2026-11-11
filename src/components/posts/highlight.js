/** Tiny dependency-free syntax highlighter for post code cards (read-only view). Returns an HTML string (escaped). */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KW = {
  _: 'if else for while do return function class const let var new import from export default try catch finally throw switch case break continue async await def elif lambda None True False self in is not and or pass with as yield public private protected static void int long float double bool boolean string char struct enum interface extends implements package namespace use fn mut match impl trait go func defer chan range select SELECT FROM WHERE INSERT UPDATE DELETE JOIN GROUP BY ORDER LIMIT CREATE TABLE null true false undefined echo print printf fi then done',
};
const KWSET = new Set(KW._.split(' '));
const COMMENT_SLASH = ['js', 'javascript', 'ts', 'typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'php', 'css', 'rust', 'kotlin', 'swift', 'json'];
const COMMENT_HASH = ['python', 'bash', 'ruby', 'yaml', 'php', 'perl', 'r'];

export function highlight(code, language = 'text') {
  const lang = String(language).toLowerCase();
  if (['text', 'markdown', 'plaintext'].includes(lang) || code.length > 200000) return esc(code);
  const slash = COMMENT_SLASH.includes(lang) || lang === 'html' || lang === 'xml';
  const hash = COMMENT_HASH.includes(lang);
  const parts = ['("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)'];
  if (slash) parts.push('(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)');
  else parts.push('(\\u0000)');
  if (hash) parts.push('(#[^\\n]*)'); else if (lang === 'sql') parts.push('(--[^\\n]*)'); else parts.push('(\\u0000)');
  parts.push('(\\b\\d+(?:\\.\\d+)?\\b)', '(\\b[A-Za-z_][A-Za-z0-9_]*\\b)');
  const re = new RegExp(parts.join('|'), 'g');
  let out = ''; let last = 0; let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [tok, str, c1, c2, num, word] = m;
    if (str) out += `<span class="hl-s">${esc(tok)}</span>`;
    else if (c1 || c2) out += `<span class="hl-c">${esc(tok)}</span>`;
    else if (num) out += `<span class="hl-n">${esc(tok)}</span>`;
    else if (word && KWSET.has(word)) out += `<span class="hl-k">${esc(tok)}</span>`;
    else out += esc(tok);
    last = m.index + tok.length;
  }
  return out + esc(code.slice(last));
}