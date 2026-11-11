import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { FUNCTIONS, KEYWORDS, splitLines, tokenizeSql } from './sqlHighlight';

const KW_LIST = [...KEYWORDS];
const FN_LIST = [...FUNCTIONS];
const COLUMN_CTX = new Set(['SELECT', 'WHERE', 'AND', 'OR', 'BY', 'ON', 'HAVING', 'SET', 'DISTINCT', 'WHEN', 'THEN', 'ELSE', 'NOT']);
const TABLE_CTX = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE']);
const MAX_SUGGESTIONS = 6;

/**
 * What could the word being typed turn into? Returns null when nothing sensible matches
 * (typo, string, comment, caret in the middle of a word ...) so the editor stays out of the way.
 */
function computeSuggestions(value, pos, completions) {
  const before = value.slice(0, pos);
  const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  if (!m) return null;
  const word = m[1];
  if (word.length < 2) return null;
  if (/[0-9]/.test(before[m.index - 1] || '')) return null; // 12ab
  if (/\w/.test(value[pos] || '')) return null; // caret inside an existing word
  const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
  if (lineBefore.includes('--') || (lineBefore.match(/'/g) || []).length % 2 === 1 || (lineBefore.match(/`/g) || []).length % 2 === 1) return null;

  const head = before.slice(0, m.index);
  const dotted = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(head);
  const prevWord = (/([A-Za-z_]+)\s*$/.exec(head) || [])[1]?.toUpperCase();
  const prevChar = head.trimEnd().slice(-1);
  const { tables = [], columns = {} } = completions || {};
  const allColumns = [...new Set(Object.values(columns).flat())];

  const lower = word.toLowerCase();
  const typedUpper = word === word.toUpperCase();
  const kwCase = (w) => (typedUpper ? w.toUpperCase() : w.toLowerCase());
  const make = (list, type, cased) => list
    .filter((w) => w.toLowerCase().startsWith(lower) && w.toLowerCase() !== lower)
    .map((w) => ({ text: cased ? kwCase(w) : w, type }));

  const kws = make(KW_LIST, 'kw', true);
  const fns = make(FN_LIST, 'fn', true);
  const tbls = make(tables, 'tbl', false);
  const cols = make(dotted ? (columns[dotted[1]] || columns[dotted[1].toLowerCase()] || []) : allColumns, 'col', false);

  let ordered;
  if (dotted) ordered = cols;
  else if (TABLE_CTX.has(prevWord)) ordered = [...tbls, ...kws, ...cols];
  else if (COLUMN_CTX.has(prevWord) || prevChar === ',' || prevChar === '(') ordered = [...cols, ...fns, ...tbls, ...kws];
  else ordered = [...kws, ...tbls, ...cols, ...fns];

  const seen = new Set();
  const list = ordered.filter((c) => { const k = c.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_SUGGESTIONS);
  return list.length ? { word, start: m.index, list } : null;
}

const TYPE_TAG = { kw: 'keyword', fn: 'function', tbl: 'table', col: 'column' };

/**
 * VS Code-style tab strip: one tab per query "file". Click to switch, middle-click or
 * the x to close, double-click to rename, + to open a new empty query.
 */
export function QueryTabs({ tabs, activeId, onSelect, onClose, onNew, onRename, newLabel = 'New query', closeLabel = 'Close' }) {
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [activeId, tabs.length]);
  return (
    <div className="qb-vsc__tablist" role="tablist">
      {tabs.map((tb) => {
        const on = tb.id === activeId;
        return (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <div
            key={tb.id}
            ref={on ? activeRef : null}
            role="tab"
            tabIndex={0}
            aria-selected={on}
            className={`qb-vsc__tab${on ? ' is-active' : ''}`}
            title={tb.name}
            onClick={() => onSelect(tb.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(tb.id); } }}
            onDoubleClick={() => onRename?.(tb.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tb.id); } }}
          >
            <Icon name="file" size={13} />
            <span className="qb-vsc__tab-name">{tb.name}</span>
            {tb.running && <span className="qb-vsc__tab-spin" aria-hidden="true" />}
            <button type="button" className="qb-vsc__tab-x" aria-label={`${closeLabel} ${tb.name}`} onClick={(e) => { e.stopPropagation(); onClose(tb.id); }}>
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
      <button type="button" className="qb-vsc__new" onClick={onNew} aria-label={newLabel} title={newLabel}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}

/** Shown when every query tab has been closed — same dark shell, with a call to action. */
export function EmptyEditor({ tabsProps, title, hint, buttonLabel, extra }) {
  return (
    <div className="qb-vsc qb-vsc--empty" dir="ltr">
      <div className="qb-vsc__tabs">
        <span className="qb-vsc__dots" aria-hidden="true"><i /><i /><i /></span>
        <QueryTabs {...tabsProps} />
        <span className="qb-vsc__lang">SQL</span>
      </div>
      <div className="qb-vsc__empty">
        <span className="qb-vsc__empty-icon" aria-hidden="true"><Icon name="terminal" size={30} /></span>
        <h3 dir="auto">{title}</h3>
        <p dir="auto">{hint}</p>
        <button type="button" className="qb-vsc__empty-btn" onClick={tabsProps.onNew}><Icon name="plus" size={16} /> {buttonLabel}</button>
        {extra && <p className="qb-vsc__empty-extra" dir="auto">{extra}</p>}
      </div>
      <div className="qb-vsc__status"><span>—</span><span className="qb-vsc__status-right"><span>UTF-8</span><span>SQL</span></span></div>
    </div>
  );
}

/** Text on the caret's line after the caret (suggestion ghost is hidden when something follows). */
const rowTail = (value, pos) => {
  const nl = value.indexOf('\n', pos);
  return value.slice(pos, nl === -1 ? value.length : nl).trim();
};

/** Coloured tokens of one line; `anchor` (suggestion ghost + list) is inserted at column `at`. */
function renderTokens(toks, at, anchor) {
  const out = [];
  let acc = 0;
  let placed = at < 0 || !anchor;
  const node = () => (
    <span key="sg" className="qb-sg">
      {anchor.endOfLine && <span className="qb-sg__ghost" aria-hidden="true">{anchor.rest}</span>}
      {anchor.list.length > 1 && (
        <span className="qb-sg__list" role="listbox" aria-label="Suggestions" onMouseDown={(e) => e.preventDefault()}>
          {anchor.list.map((it, k) => (
            <span key={it.text} role="option" aria-selected={k === anchor.activeIdx} className={`qb-sg__item${k === anchor.activeIdx ? ' is-on' : ''}`} onMouseDown={() => anchor.onPick(it)}>
              <span className="qb-sg__text">{it.text}</span>
              <span className="qb-sg__type">{TYPE_TAG[it.type]}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
  toks.forEach((tk, j) => {
    out.push(tk.t === 'ws' || tk.t === 'op' ? tk.v : <span key={j} className={`qb-tok-${tk.t}`}>{tk.v}</span>);
    acc += tk.v.length;
    if (!placed && acc >= at) { out.push(node()); placed = true; }
  });
  if (!placed) out.push(node());
  return out;
}

/**
 * VS Code-style SQL editor: live syntax colours, line numbers that stay aligned
 * with wrapped lines, active-line highlight, auto-indent, auto-closing pairs,
 * Tab indentation (Esc then Tab leaves the field) and a status bar with Ln/Col.
 *
 * Technique: a transparent <textarea> sits exactly over a coloured mirror of the
 * same text. Both use identical font/wrapping/padding, so they always line up.
 */
const SqlEditor = forwardRef(function SqlEditor({ value, onChange, onRun, placeholder, tables, ariaLabel, linesLabel = 'lines', runLabel = 'to run', tabsProps = null, completions = null, completeLabel = 'to complete' }, ref) {
  const taRef = useRef(null);
  const escaped = useRef(false);
  const [caret, setCaret] = useState({ line: 1, col: 1, sel: 0, pos: 0 });
  const [focused, setFocused] = useState(false);
  const [pick, setPick] = useState({ key: '', i: 0 });
  const [dismissed, setDismissed] = useState('');

  const setRefs = useCallback((el) => {
    taRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [ref]);

  const rows = useMemo(() => splitLines(tokenizeSql(value, tables)), [value, tables]);

  // Inline suggestion for the word under the caret (only while typing, never over a selection).
  const suggest = useMemo(
    () => (focused && !caret.sel ? computeSuggestions(value, caret.pos, completions) : null),
    [focused, caret.sel, caret.pos, value, completions],
  );
  const sugKey = suggest ? `${caret.pos}:${suggest.word}` : '';
  const open = !!suggest && dismissed !== sugKey;
  const activeIdx = open && pick.key === sugKey ? Math.min(pick.i, suggest.list.length - 1) : 0;
  const chosen = open ? suggest.list[activeIdx] : null;

  const acceptSuggestion = (item = chosen) => {
    const el = taRef.current;
    if (!el || !item || !suggest) return;
    el.setSelectionRange(suggest.start, suggest.start + suggest.word.length);
    insertText(el, item.text);
  };

  const syncCaret = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const before = el.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - (before.lastIndexOf('\n') + 1) + 1;
    const sel = Math.abs((el.selectionEnd ?? pos) - pos);
    setCaret((c) => (c.line === line && c.col === col && c.sel === sel && c.pos === pos ? c : { line, col, sel, pos }));
  }, []);

  // insertText keeps the browser undo stack intact (Ctrl+Z works like a real editor).
  const insertText = (el, text) => {
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      onChange(el.value);
    }
  };

  const onKeyDown = (e) => {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value: v } = el;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun?.(); return; }
    if (open && chosen) {
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); acceptSuggestion(); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggest.list.length > 1) {
        e.preventDefault();
        const n = suggest.list.length;
        setPick({ key: sugKey, i: (activeIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(sugKey); return; }
    }
    if (e.key === 'Escape') { escaped.current = true; return; }

    if (e.key === 'Tab' && !e.shiftKey && !escaped.current) {
      e.preventDefault();
      insertText(el, '  ');
      return;
    }
    if (e.key !== 'Tab') escaped.current = false;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const indent = (v.slice(lineStart, s).match(/^[ \t]*/) || [''])[0];
      insertText(el, `\n${indent}`);
      return;
    }

    const next = v[en];
    const prev = v[s - 1];
    if (s === en && (e.key === ')' || e.key === "'") && next === e.key) {
      e.preventDefault();
      el.setSelectionRange(s + 1, s + 1);
      syncCaret();
      return;
    }
    if (e.key === '(' || (e.key === "'" && !/\w/.test(prev || ''))) {
      e.preventDefault();
      const close = e.key === '(' ? ')' : "'";
      if (s !== en) {
        insertText(el, `${e.key}${v.slice(s, en)}${close}`);
      } else {
        insertText(el, `${e.key}${close}`);
        el.setSelectionRange(s + 1, s + 1);
      }
      return;
    }
    if (e.key === 'Backspace' && s === en && prev && next && ((prev === '(' && next === ')') || (prev === "'" && next === "'"))) {
      e.preventDefault();
      el.setSelectionRange(s - 1, s + 1);
      try { document.execCommand('delete'); } catch { /* fall through */ }
      if (el.value === v) { el.setRangeText('', s - 1, s + 1, 'end'); onChange(el.value); }
    }
  };

  return (
    <div className="qb-vsc" dir="ltr">
      <div className="qb-vsc__tabs">
        <span className="qb-vsc__dots" aria-hidden="true"><i /><i /><i /></span>
        {tabsProps
          ? <QueryTabs {...tabsProps} />
          : <span className="qb-vsc__tab is-active"><Icon name="file" size={13} /> query.sql</span>}
        <span className="qb-vsc__lang">SQL</span>
      </div>

      <div className="qb-vsc__scroll">
        <div className="qb-vsc__content">
          <div className="qb-vsc__lines" aria-hidden="true">
            {rows.map((toks, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={i} className={`qb-vsc__row${caret.line === i + 1 ? ' is-active' : ''}`}>
                <span className="qb-vsc__num">{i + 1}</span>
                <span className="qb-vsc__code">
                  {toks.length
                    ? renderTokens(toks, open && caret.line === i + 1 ? caret.col - 1 : -1, open ? { rest: chosen.text.slice(suggest.word.length), list: suggest.list, activeIdx, onPick: acceptSuggestion, endOfLine: !rowTail(value, caret.pos) } : null)
                    : '\u200b'}
                </span>
              </div>
            ))}
          </div>
          <textarea
            ref={setRefs}
            className="qb-vsc__input"
            value={value}
            onChange={(e) => { onChange(e.target.value); syncCaret(); }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onFocus={() => setFocused(true)}
            onBlur={() => { escaped.current = false; setFocused(false); }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="soft"
            aria-label={ariaLabel}
            placeholder={placeholder}
          />
        </div>
      </div>

      <div className="qb-vsc__status">
        <span>
          Ln {caret.line}, Col {caret.col}{caret.sel ? ` (${caret.sel})` : ''}
          <span className="qb-vsc__sep">·</span>{rows.length} {linesLabel}
        </span>
        <span className="qb-vsc__status-right">
          {open && <span className="qb-kbd-hint"><kbd>Tab</kbd> {completeLabel}</span>}
          <span className="qb-kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> {runLabel}</span>
          <span>Spaces: 2</span><span>UTF-8</span><span>SQL</span>
        </span>
      </div>
    </div>
  );
});

export default SqlEditor;
