/** Tiny dependency-free syntax highlighter for fenced code blocks. Returns [{ c: className, v: text }] tokens. */

const W = (s) => new Set(s.split(/\s+/).filter(Boolean));

const KW = {
  js: W('async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield interface type enum implements public private protected readonly as namespace declare abstract get set'),
  py: W('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self print'),
  php: W('abstract and array as break case catch class clone const continue declare default do echo else elseif empty extends final finally fn for foreach function global if implements include include_once instanceof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while yield'),
  java: W('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while var record fun val override object when'),
  c: W('auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename using public private protected virtual new delete try catch throw bool include define fn let mut pub impl trait use mod match loop move where async await self Self func package go defer chan range'),
  sh: W('if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed awk sudo npm npx yarn pnpm git php composer python python3 pip node docker curl wget mkdir rm cp mv chmod artisan'),
  sql: W('select from where insert into values update set delete create table alter drop index primary key foreign references join left right inner outer on group by order having limit offset as and or not null is in like distinct union all case when then else end count sum avg min max default unique auto_increment constraint database'),
  css: new Set(),
  json: new Set(),
  yaml: new Set(),
};

const ALIAS = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  py: 'py', python: 'py', php: 'php',
  java: 'java', kotlin: 'java', kt: 'java', cs: 'java', csharp: 'java', scala: 'java', swift: 'java', dart: 'java',
  c: 'c', cpp: 'c', 'c++': 'c', h: 'c', rust: 'c', rs: 'c', go: 'c', golang: 'c',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh', bat: 'sh', env: 'sh', dotenv: 'sh',
  sql: 'sql', mysql: 'sql', pgsql: 'sql', postgresql: 'sql',
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml',
  css: 'css', scss: 'css', less: 'css',
  html: 'markup', xml: 'markup', vue: 'markup', svg: 'markup', xhtml: 'markup', blade: 'markup',
};

const P = {
  slc: String.raw`\/\/[^\n]*`,
  hash: String.raw`#[^\n]*`,
  dash: String.raw`--[^\n]*`,
  blk: String.raw`\/\*[\s\S]*?\*\/`,
  dq: String.raw`"(?:\\.|[^"\\\n])*"`,
  sq: String.raw`'(?:\\.|[^'\\\n])*'`,
  bt: '`(?:\\\\[\\s\\S]|[^`\\\\])*`',
  tdq: String.raw`"""[\s\S]*?"""`,
  tsq: String.raw`'''[\s\S]*?'''`,
};

const COMMENTS = {
  js: `${P.slc}|${P.blk}`, java: `${P.slc}|${P.blk}`, c: `${P.slc}|${P.blk}`, css: P.blk,
  php: `${P.slc}|${P.hash}|${P.blk}`, py: P.hash, sh: P.hash, yaml: P.hash, sql: `${P.dash}|${P.blk}`, json: `${P.slc}|${P.blk}`,
};
const STRINGS = {
  js: `${P.dq}|${P.sq}|${P.bt}`, py: `${P.tdq}|${P.tsq}|${P.dq}|${P.sq}`, c: `${P.dq}|${P.sq}`, java: `${P.dq}|${P.sq}`,
};

const cache = new Map();
function regexFor(kind) {
  let re = cache.get(kind);
  if (!re) {
    const com = COMMENTS[kind] || P.blk;
    const str = STRINGS[kind] || `${P.dq}|${P.sq}`;
    const word = kind === 'css' || kind === 'yaml' || kind === 'sh' ? '[A-Za-z_$@][\\w$-]*' : '[A-Za-z_$@][\\w$]*';
    re = new RegExp(`(${com})|(${str})|(\\b\\d+(?:\\.\\d+)?\\b)|(${word})|([\\s\\S])`, 'g');
    cache.set(kind, re);
  }
  return re;
}
const MARKUP = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*)|(\/?>)|([A-Za-z_:@][\w:.-]*)(?=\s*=)|("[^"]*"|'[^']*')|([\s\S])/g;
const LIT = /^(true|false|null|undefined|None|True|False|NaN|Infinity|nil|NULL)$/;

function merge(list) {
  const out = [];
  for (const t of list) {
    const last = out[out.length - 1];
    if (last && last.c === t.c) last.v += t.v; else out.push({ ...t });
  }
  return out;
}

export function languageLabel(lang) {
  const l = (lang || '').toLowerCase();
  return l || 'text';
}

export function highlight(lang, code) {
  const kind = ALIAS[(lang || '').toLowerCase()];
  if (!kind || code.length > 60000) return [{ c: '', v: code }];
  const toks = [];
  if (kind === 'markup') {
    MARKUP.lastIndex = 0;
    let m;
    while ((m = MARKUP.exec(code))) {
      const cls = m[1] ? 'com' : m[2] || m[3] ? 'tag' : m[4] ? 'attr' : m[5] ? 'str' : '';
      toks.push({ c: cls, v: m[0] });
      if (m[0] === '') MARKUP.lastIndex++;
    }
    return merge(toks);
  }
  const re = regexFor(kind);
  const kw = KW[kind];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) toks.push({ c: 'com', v: m[0] });
    else if (m[2]) {
      let cls = 'str';
      if (kind === 'json' || kind === 'yaml') { const rest = /^\s*:/.exec(code.slice(re.lastIndex, re.lastIndex + 40)); if (rest) cls = 'prop'; }
      toks.push({ c: cls, v: m[0] });
    } else if (m[3]) toks.push({ c: 'num', v: m[0] });
    else if (m[4]) {
      const w = m[4];
      const key = kind === 'sql' ? w.toLowerCase() : w;
      let cls = '';
      if (kw.has(key)) cls = 'kw';
      else if (LIT.test(w)) cls = 'lit';
      else if ((kind === 'php' || kind === 'sh') && w[0] === '$') cls = 'var';
      else if ((kind === 'yaml' || kind === 'css' || kind === 'json') && /^\s*:/.test(code.slice(re.lastIndex, re.lastIndex + 8))) cls = 'prop';
      else if (kind !== 'json' && kind !== 'yaml' && code[re.lastIndex] === '(') cls = 'fn';
      else if (/^[A-Z][A-Za-z0-9_]+$/.test(w) && kind !== 'css') cls = 'type';
      toks.push({ c: cls, v: w });
    } else toks.push({ c: '', v: m[0] });
    if (m[0] === '') re.lastIndex++;
  }
  return merge(toks);
}
