import { snippetCompletion, completeAnyWord } from '@codemirror/autocomplete';

/**
 * VS Code–style suggestions for the workbench editor, added on top of what the language packages already complete
 * (tags, attributes, CSS properties/values, JS/Python keywords …):
 *
 *  - HTML: Emmet-like snippets — type `link`, `link:css`, `script`, `meta:vp`, `html:5`, `a`, `img`, `ul` … (with or without the `<`);
 *          and inside an open tag (`<link |`) the attributes that tag really uses come FIRST (rel / href / …) instead of the
 *          alphabetical list of global attributes.
 *  - CSS:  small snippets (flex-center, grid-cols, media, keyframes, :root vars …).
 *  - JS/TS: console.log, arrow function, import, fetch …
 *  - everything else without a completer: words already in the file.
 *
 * Pure functions + data — no network, no state.
 */

const S = snippetCompletion;

// ---- HTML --------------------------------------------------------------------------------------------------------
// [typed key, detail, template]   ${n:placeholder} = tab stops
const HTML = [
  ['html:5', 'HTML5 document', '<!DOCTYPE html>\n<html lang="${en}">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>${Document}</title>\n</head>\n<body>\n\t${}\n</body>\n</html>'],
  ['link:css', 'stylesheet link', '<link rel="stylesheet" href="${style.css}">'],
  ['link:favicon', 'favicon link', '<link rel="icon" type="image/x-icon" href="${favicon.ico}">'],
  ['link:preload', 'preload link', '<link rel="preload" href="${}" as="${style}">'],
  ['link', 'link element', '<link rel="${stylesheet}" href="${}">'],
  ['script:src', 'script with src', '<script src="${script.js}"></script>'],
  ['script', 'script element', '<script>\n\t${}\n</script>'],
  ['style', 'style element', '<style>\n\t${}\n</style>'],
  ['meta:utf', 'charset meta', '<meta charset="UTF-8">'],
  ['meta:vp', 'viewport meta', '<meta name="viewport" content="width=device-width, initial-scale=1.0">'],
  ['meta:desc', 'description meta', '<meta name="description" content="${}">'],
  ['a', 'link', '<a href="${#}">${}</a>'],
  ['a:blank', 'link in a new tab', '<a href="${#}" target="_blank" rel="noopener noreferrer">${}</a>'],
  ['img', 'image', '<img src="${}" alt="${}">'],
  ['input', 'input', '<input type="${text}" name="${}" id="${}">'],
  ['input:email', 'email input', '<input type="email" name="${email}" id="${email}" required>'],
  ['button', 'button', '<button type="${button}">${}</button>'],
  ['form', 'form', '<form action="${}" method="${post}">\n\t${}\n</form>'],
  ['label', 'label', '<label for="${}">${}</label>'],
  ['select', 'select', '<select name="${}" id="${}">\n\t<option value="${}">${}</option>\n</select>'],
  ['textarea', 'textarea', '<textarea name="${}" id="${}" rows="${4}"></textarea>'],
  ['ul', 'list', '<ul>\n\t<li>${}</li>\n</ul>'],
  ['ol', 'numbered list', '<ol>\n\t<li>${}</li>\n</ol>'],
  ['table', 'table', '<table>\n\t<thead>\n\t\t<tr>\n\t\t\t<th>${}</th>\n\t\t</tr>\n\t</thead>\n\t<tbody>\n\t\t<tr>\n\t\t\t<td>${}</td>\n\t\t</tr>\n\t</tbody>\n</table>'],
  ['div', 'div', '<div class="${}">\n\t${}\n</div>'],
  ['section', 'section', '<section class="${}">\n\t${}\n</section>'],
  ['nav', 'nav', '<nav>\n\t<ul>\n\t\t<li><a href="${#}">${}</a></li>\n\t</ul>\n</nav>'],
  ['header', 'header', '<header>\n\t${}\n</header>'],
  ['footer', 'footer', '<footer>\n\t${}\n</footer>'],
  ['video', 'video', '<video src="${}" controls></video>'],
  ['iframe', 'iframe', '<iframe src="${}" title="${}"></iframe>'],
];

// built once: the same option objects are reused on every keystroke
const HTML_OPTIONS = HTML.map(([key, detail, tpl]) => S(tpl, { label: key, detail, type: 'keyword', boost: key.includes(':') ? 5 : 3 }));

// attributes each tag really uses, most useful first (text inserted, with a tab stop inside the quotes)
const ATTRS = {
  link: ['rel="${stylesheet}"', 'href="${}"', 'type="${}"', 'media="${}"', 'as="${}"', 'crossorigin'],
  script: ['src="${}"', 'type="${module}"', 'defer', 'async'],
  a: ['href="${}"', 'target="${_blank}"', 'rel="${noopener noreferrer}"', 'download'],
  img: ['src="${}"', 'alt="${}"', 'width="${}"', 'height="${}"', 'loading="${lazy}"'],
  meta: ['name="${}"', 'content="${}"', 'charset="${UTF-8}"', 'property="${}"'],
  input: ['type="${text}"', 'name="${}"', 'id="${}"', 'placeholder="${}"', 'value="${}"', 'required', 'disabled'],
  button: ['type="${button}"', 'disabled', 'onclick="${}"'],
  form: ['action="${}"', 'method="${post}"', 'enctype="${}"'],
  label: ['for="${}"'],
  select: ['name="${}"', 'id="${}"', 'required', 'multiple'],
  textarea: ['name="${}"', 'id="${}"', 'rows="${}"', 'cols="${}"', 'placeholder="${}"'],
  iframe: ['src="${}"', 'title="${}"', 'width="${}"', 'height="${}"', 'allowfullscreen'],
  video: ['src="${}"', 'controls', 'autoplay', 'muted', 'loop', 'poster="${}"'],
  source: ['src="${}"', 'type="${}"'],
  td: ['colspan="${}"', 'rowspan="${}"'],
  th: ['colspan="${}"', 'scope="${col}"'],
  html: ['lang="${en}"', 'dir="${rtl}"'],
};
const COMMON_ATTRS = ['class="${}"', 'id="${}"', 'style="${}"'];
const attrName = (tpl) => tpl.replace(/[=${].*$/, '');
const attrOptions = (list) => list.map((tpl, i) => (tpl.includes('=')
  ? S(tpl, { label: attrName(tpl), detail: '="…"', type: 'property', boost: 99 - i })
  : { label: tpl, type: 'property', boost: 99 - i }));
const ATTR_CACHE = new Map();
const attrsFor = (tag) => {
  if (!ATTR_CACHE.has(tag)) ATTR_CACHE.set(tag, attrOptions([...(ATTRS[tag] || []), ...COMMON_ATTRS]));
  return ATTR_CACHE.get(tag);
};

/** The tag whose opening `<tag …` the cursor is inside (and not inside a quoted value), or null. Plain text scan: no parser needed. */
export function openTagAt(before) {
  const m = /<([a-zA-Z][\w:-]*)\s(?:[^<>"']|"[^"]*"|'[^']*')*$/.exec(before);
  return m ? m[1].toLowerCase() : null;
}

export function htmlSnippetSource(ctx) {
  const { state, pos } = ctx;
  const before = state.doc.sliceString(Math.max(0, pos - 400), pos);

  // 1) inside an open tag: the tag's own attributes first
  const tag = openTagAt(before);
  if (tag) {
    const word = /[\w:-]*$/.exec(before)[0];
    if (!ctx.explicit && word === '' && !/\s$/.test(before)) return null;
    return { from: pos - word.length, validFor: /^[\w:-]*$/, options: attrsFor(tag) };
  }

  // inside an attribute value (`<a href="abc|`): no tag snippets there
  if (/<[a-zA-Z][\w:-]*\s(?:[^<>"']|"[^"]*"|'[^']*')*["'][^"']*$/.test(before)) return null;

  // 2) `<link` or just `link` / `link:css` in element content -> Emmet-like snippets
  const m = /(<)?([\w:!-]*)$/.exec(before);
  const lt = !!(m && m[1]);
  const word = m ? m[2] : '';
  if (!lt && word.length < 1) return null;
  if (!lt && !ctx.explicit && word.length < 2) return null;
  return { from: pos - word.length - (lt ? 1 : 0), options: HTML_OPTIONS, validFor: /^<?[\w:!-]*$/ };
}

// ---- CSS ---------------------------------------------------------------------------------------------------------
const CSS = [
  ['flex-center', 'center with flexbox', 'display: flex;\nalign-items: center;\njustify-content: center;'],
  ['flex-col', 'flex column', 'display: flex;\nflex-direction: column;\ngap: ${1rem};'],
  ['grid-cols', 'grid columns', 'display: grid;\ngrid-template-columns: repeat(${3}, 1fr);\ngap: ${1rem};'],
  ['abs-center', 'absolute center', 'position: absolute;\ntop: 50%;\nleft: 50%;\ntransform: translate(-50%, -50%);'],
  ['ellipsis', 'single-line ellipsis', 'overflow: hidden;\ntext-overflow: ellipsis;\nwhite-space: nowrap;'],
  ['@media', 'media query', '@media (max-width: ${768px}) {\n\t${}\n}'],
  ['@keyframes', 'keyframes', '@keyframes ${name} {\n\tfrom {\n\t\t${}\n\t}\n\tto {\n\t\t${}\n\t}\n}'],
  [':root', 'css variables', ':root {\n\t--${primary}: ${#3b82f6};\n}'],
  ['reset', 'basic reset', '* {\n\tbox-sizing: border-box;\n\tmargin: 0;\n\tpadding: 0;\n}'],
];
const CSS_OPTIONS = CSS.map(([label, detail, tpl]) => S(tpl, { label, detail, type: 'text', boost: -1 }));
export function cssSnippetSource(ctx) {
  const w = ctx.matchBefore(/[@:\w-]+/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  return { from: w.from, validFor: /^[@:\w-]*$/, options: CSS_OPTIONS };
}

// ---- JS / TS -----------------------------------------------------------------------------------------------------
const JS = [
  ['log', 'console.log', 'console.log(${});'],
  ['clg', 'console.log', 'console.log(${});'],
  ['afn', 'arrow function', 'const ${name} = (${}) => {\n\t${}\n};'],
  ['imp', 'import', "import ${} from '${}';"],
  ['fetch', 'fetch + json', "const res = await fetch('${url}');\nconst data = await res.json();"],
  ['trycatch', 'try / catch', 'try {\n\t${}\n} catch (err) {\n\tconsole.error(err);\n}'],
  ['qs', 'querySelector', "document.querySelector('${}')"],
  ['ael', 'addEventListener', "${el}.addEventListener('${click}', (e) => {\n\t${}\n});"],
];
const JS_OPTIONS = JS.map(([label, detail, tpl]) => S(tpl, { label, detail, type: 'text', boost: -2 }));
export function jsSnippetSource(ctx) {
  const w = ctx.matchBefore(/\w+/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  return { from: w.from, validFor: /^\w*$/, options: JS_OPTIONS };
}

/** Words already present in the file — for languages that have no completer of their own (C#, Go, Ruby, shell, plain text …). */
export const wordSource = completeAnyWord;
