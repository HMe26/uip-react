import { Fragment, memo, useMemo, useState } from 'react';
import Icon from '../../Icon';
import { highlight } from '../mdHighlight';

/**
 * Safe markdown for the AI answers. Everything becomes React elements — the text is never injected as HTML, so nothing the
 * model (or the student's own code echoed back by it) writes can run. Supports headings, bullet / numbered lists (nested),
 * quotes, tables, horizontal rules, fenced code (with a language label, Copy, Wrap and "New file"), **bold**, *italic*,
 * ~~strike~~, `code` and http(s) links. An unfinished fence (still streaming) renders as code too.
 */

const FENCE = /^\s*```\s*([\w+#.-]*)\s*(?::\s*(\S+))?\s*$/;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** @returns {Array<object>} blocks: heading | hr | code | quote | table | list | p */
export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const isBreak = (l) => FENCE.test(l) || HEADING.test(l) || HR.test(l) || /^\s*>/.test(l) || LIST.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; } // eslint-disable-line no-continue

    const f = FENCE.exec(line);
    if (f) {
      const body = []; i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      const closed = i < lines.length;
      if (closed) i += 1;
      blocks.push({ k: 'code', lang: (f[1] || '').toLowerCase(), path: f[2] || '', code: body.join('\n'), closed });
      continue; // eslint-disable-line no-continue
    }
    const h = HEADING.exec(line);
    if (h) { blocks.push({ k: 'h', level: h[1].length, text: h[2] }); i += 1; continue; } // eslint-disable-line no-continue
    if (HR.test(line)) { blocks.push({ k: 'hr' }); i += 1; continue; } // eslint-disable-line no-continue

    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      blocks.push({ k: 'quote', text: q.join('\n') });
      continue; // eslint-disable-line no-continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line); const rows = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ k: 'table', head, rows });
      continue; // eslint-disable-line no-continue
    }

    if (LIST.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m) { items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, text: m[3] }); i += 1; continue; } // eslint-disable-line no-continue
        // a wrapped continuation line of the previous item (indented, not a new block)
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length && !isBreak(lines[i])) { items[items.length - 1].text += `\n${lines[i].trim()}`; i += 1; continue; } // eslint-disable-line no-continue
        break;
      }
      blocks.push({ k: 'list', items });
      continue; // eslint-disable-line no-continue
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && isBreak(lines[i]))) {
      if (para.length && lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) break;
      para.push(lines[i]); i += 1;
    }
    blocks.push({ k: 'p', text: para.join('\n') });
  }
  blocks.forEach((b) => { b.sig = JSON.stringify(b); }); // lets <Block> skip re-rendering blocks that did not change while the answer streams
  return blocks;
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*\n]*?\*(?![\w*]))/g;

export function Inline({ text }) {
  const out = [];
  let last = 0; let m; let n = 0;
  const s = String(text);
  INLINE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = INLINE.exec(s))) {
    const t = m[0];
    if (t[0] === '*' && t[1] !== '*' && m.index > 0 && /[\w*]/.test(s[m.index - 1])) { // "a*b*c" is arithmetic, not italic (no lookbehind: older Safari)
      out.push(s.slice(last, m.index + 1)); last = m.index + 1; INLINE.lastIndex = last; continue; // eslint-disable-line no-continue
    }
    if (m.index > last) out.push(s.slice(last, m.index));
    n += 1;
    if (t.startsWith('`')) out.push(<code key={n} dir="ltr">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={n}><Inline text={t.slice(2, -2)} /></strong>);
    else if (t.startsWith('~~')) out.push(<del key={n}>{t.slice(2, -2)}</del>);
    else if (t.startsWith('[')) {
      const mid = t.indexOf('](');
      out.push(<a key={n} href={t.slice(mid + 2, -1)} target="_blank" rel="noopener noreferrer nofollow">{t.slice(1, mid)}</a>);
    } else out.push(<em key={n}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.map((x, i) => (typeof x === 'string' ? <Fragment key={`t${i}`}>{x}</Fragment> : x));
}

const withBreaks = (text) => String(text).split('\n').map((l, n) => <Fragment key={n}>{n > 0 && <br />}<Inline text={l} /></Fragment>);

/** Items with indentation → nested <ul>/<ol>. */
function List({ items }) {
  const build = (from, level) => {
    const nodes = []; let idx = from;
    const base = items[from].indent;
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const Tag = group[0].ordered ? 'ol' : 'ul';
      nodes.push(<Tag key={`g${nodes.length}`} start={group[0].ordered && group[0].start !== 1 ? group[0].start : undefined} dir="auto">{group.map((g) => g.node)}</Tag>);
      group = [];
    };
    while (idx < items.length) {
      const it = items[idx];
      if (it.indent < base) break;
      if (it.indent > base) { // a deeper item belongs to the previous one
        const sub = build(idx, level + 1);
        if (group.length) group[group.length - 1].node = <li key={group[group.length - 1].node.key}>{group[group.length - 1].node.props.children}{sub.nodes}</li>;
        else nodes.push(...sub.nodes);
        idx = sub.next; continue; // eslint-disable-line no-continue
      }
      if (group.length && group[0].ordered !== it.ordered) flush();
      group.push({ ordered: it.ordered, start: it.start, node: <li key={`i${idx}`}>{withBreaks(it.text)}</li> });
      idx += 1;
    }
    flush();
    return { nodes, next: idx };
  };
  const res = build(0, 0);
  let rest = res.next; const all = [...res.nodes];
  while (rest < items.length) { const more = build(rest, 0); all.push(...more.nodes); rest = more.next; } // shallower trailing items
  return <>{all}</>;
}

const EXT = { javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py', php: 'php', html: 'html', css: 'css', scss: 'scss', json: 'json', java: 'java', cpp: 'cpp', c: 'c', cs: 'cs', go: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', sh: 'sh', bash: 'sh', shell: 'sh', sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml', md: 'md', markdown: 'md', vue: 'vue', kotlin: 'kt', swift: 'swift', dart: 'dart' };

/** A name for "New file" when the fence does not say one: a path in the first line comment, or `file.<ext>`. */
export function guessBlockName(lang, code, path) {
  if (path) return path;
  const first = String(code).split('\n', 1)[0] || '';
  const m = /^\s*(?:\/\/|#|<!--|\/\*|--)\s*(?:file(?:name)?:\s*)?([\w./-]+\.\w{1,8})\s*(?:-->|\*\/)?\s*$/i.exec(first);
  if (m) return m[1].replace(/^\.?\//, '');
  return `file.${EXT[lang] || 'txt'}`;
}

const HL_LIVE_MAX = 6000; // while a block is still streaming, only highlight it while it is small

function CodeBlock({ b, tt, onNewFile, streaming }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(true);
  const live = streaming && !b.closed;
  const toks = useMemo(() => (live && b.code.length > HL_LIVE_MAX ? [{ c: '', v: b.code }] : highlight(b.lang, b.code)), [b.lang, b.code, live]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(b.code); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="zb-ai__block">
      <div className="zb-ai__blockbar" dir="ltr">
        <span className="zb-ai__lang">{b.path || b.lang || tt('code', 'كود')}</span>
        <span className="zb-ai__blockacts">
          <button type="button" className={`zb-ai__mini${wrap ? ' is-on' : ''}`} onClick={() => setWrap((w) => !w)} aria-pressed={wrap} title={tt('Wrap long lines', 'لفّ السطور الطويلة')}>{tt('Wrap', 'لفّ')}</button>
          {!live && <button type="button" className="zb-ai__mini" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? tt('Copied', 'تم النسخ') : tt('Copy', 'نسخ')}</button>}
          {!live && onNewFile && <button type="button" className="zb-ai__mini" onClick={() => onNewFile(b.code, guessBlockName(b.lang, b.code, b.path))}><Icon name="file-plus" size={12} /> {tt('New file', 'ملف جديد')}</button>}
        </span>
      </div>
      <pre className={`zb-ai__code${wrap ? ' is-wrap' : ''}`} dir="ltr"><code>{toks.map((t, i) => (t.c ? <span key={i} className={`zb-tk zb-tk--${t.c}`}>{t.v}</span> : t.v))}</code></pre>
    </div>
  );
}

const Table = ({ b }) => (
  <div className="zb-aimd__tablewrap">
    <table className="zb-aimd__table" dir="auto">
      <thead><tr>{b.head.map((c, n) => <th key={n}><Inline text={c} /></th>)}</tr></thead>
      <tbody>{b.rows.map((r, n) => <tr key={n}>{b.head.map((_, c) => <td key={c}><Inline text={r[c] || ''} /></td>)}</tr>)}</tbody>
    </table>
  </div>
);

/** One block of the answer. Memoised on its content, so while the text streams only the LAST block re-renders. */
const Block = memo(function Block({ b, tt, onNewFile, streaming }) {
  switch (b.k) {
    case 'code': return <CodeBlock b={b} tt={tt} onNewFile={onNewFile} streaming={streaming} />;
    case 'h': { const H = `h${Math.min(6, b.level + 2)}`; return <H className="zb-aimd__h" dir="auto"><Inline text={b.text} /></H>; }
    case 'hr': return <hr className="zb-aimd__hr" />;
    case 'quote': return <blockquote className="zb-aimd__quote" dir="auto">{withBreaks(b.text)}</blockquote>;
    case 'table': return <Table b={b} />;
    case 'list': return <List items={b.items} />;
    default: return <p dir="auto">{withBreaks(b.text)}</p>;
  }
}, (a, c) => a.b.sig === c.b.sig && a.tt === c.tt && a.onNewFile === c.onNewFile && (a.b.k !== 'code' || a.streaming === c.streaming));

// NB: the class is `zb-aimd`, NOT `zb-md` — `.zb-md` is the full-size Markdown *preview* pane of the workbench
// (position:absolute; inset:0; overflow:hidden) and used to cover and clip the whole chat panel.
export default function Markdown({ text, tt, onNewFile, streaming }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="zb-ai__answer zb-aimd">
      {blocks.map((b, i) => <Block key={i} b={b} tt={tt} onNewFile={onNewFile} streaming={streaming} />)}
    </div>
  );
}
