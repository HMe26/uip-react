import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { indentWithTab, undo, redo, selectAll, undoDepth, redoDepth } from '@codemirror/commands';
import { search, SearchQuery, setSearchQuery, openSearchPanel, closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import { StreamLanguage } from '@codemirror/language';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { html, htmlLanguage } from '@codemirror/lang-html';
import { css, cssLanguage } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { markdown } from '@codemirror/lang-markdown';
import { sql, MSSQL, PLSQL } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { rust } from '@codemirror/lang-rust';
import { csharp, kotlin, dart, scala, objectiveC, c as clikeC } from '@codemirror/legacy-modes/mode/clike';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { cobol } from '@codemirror/legacy-modes/mode/cobol';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import { oCaml, fSharp } from '@codemirror/legacy-modes/mode/mllike';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { sas } from '@codemirror/legacy-modes/mode/sas';
import { gas } from '@codemirror/legacy-modes/mode/gas';
import { pascal } from '@codemirror/legacy-modes/mode/pascal';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { extOf } from './zipUtils';
import { buildEditorTheme } from './zipThemes';
import { ghostComplete, clearGhostEffect } from './ai/ghostComplete';
import { htmlSnippetSource, cssSnippetSource, jsSnippetSource, wordSource } from './editorComplete';

// a StreamLanguage (no completer of its own) that also suggests the words already in the file
const withWords = (mode) => { const L = StreamLanguage.define(mode); return [L, L.data.of({ autocomplete: wordSource })]; };
const withJs = (support) => [support, javascriptLanguage.data.of({ autocomplete: jsSnippetSource })];

function languageFor(path, text = '') {
  switch (extOf(path)) {
    case 'js': case 'mjs': case 'cjs': return withJs(javascript());
    case 'jsx': return withJs(javascript({ jsx: true }));
    case 'ts': return withJs(javascript({ typescript: true }));
    case 'tsx': return withJs(javascript({ typescript: true, jsx: true }));
    case 'json': return json();
    // + Emmet-like snippets and tag-aware attributes (rel / href first for <link …>)
    case 'html': case 'htm': case 'vue': return [html(), htmlLanguage.data.of({ autocomplete: htmlSnippetSource })];
    case 'css': case 'scss': case 'less': return [css(), cssLanguage.data.of({ autocomplete: cssSnippetSource })];
    case 'php': return php();
    case 'py': return python();
    case 'java': return java();
    case 'c': case 'h': case 'cpp': case 'hpp': case 'cc': return cpp();
    case 'md': return markdown();
    case 'sql': return sql();
    case 'xml': case 'svg': return xml();
    case 'yml': case 'yaml': return yaml();
    case 'rs': return rust();
    case 'cs': return withWords(csharp);
    case 'kt': return withWords(kotlin);
    case 'dart': return withWords(dart);
    case 'sh': case 'bash': return withWords(shell);
    case 'go': return withWords(go);
    case 'rb': return withWords(ruby);
    case 'swift': return withWords(swift);
    case 'm': return withWords(/@(interface|implementation|end|property)\b|#import\b|NS[A-Z]\w+/.test(String(text).slice(0, 4000)) ? objectiveC : octave);
    case 'mm': return withWords(objectiveC);
    case 'scala': return withWords(scala);
    case 'erl': return withWords(erlang);
    case 'clj': case 'cljc': return withWords(clojure);
    case 'lisp': case 'lsp': return withWords(commonLisp);
    case 'scm': case 'ss': case 'rkt': return withWords(scheme);
    case 'cob': case 'cbl': case 'cobol': return withWords(cobol);
    case 'groovy': case 'gvy': return withWords(groovy);
    case 'ps1': return withWords(powerShell);
    case 'vb': case 'bas': case 'frm': return withWords(vb);
    case 'ml': return withWords(oCaml);
    case 'fs': case 'fsx': return withWords(fSharp);
    case 'sas': return withWords(sas);
    case 'asm': case 'nasm': case 's': return withWords(gas);
    case 'pas': case 'dpr': case 'pp': return withWords(pascal);
    case 'f90': case 'f95': case 'f03': return withWords(fortran);
    case 'hs': return withWords(haskell);
    case 'lua': return withWords(lua);
    case 'pl': return withWords(perl);
    case 'r': return withWords(r);
    case 'jl': return withWords(julia);
    case 'plsql': case 'pls': return sql({ dialect: PLSQL });
    case 'tsql': return sql({ dialect: MSSQL });
    case 'sol': case 'cls': return java();
    case 'zig': return withWords(clikeC);
    case 'v': return rust();
    case 'toml': return StreamLanguage.define(toml);
    case 'ini': case 'env': return StreamLanguage.define(properties);
    default: return EditorState.languageData.of(() => [{ autocomplete: wordSource }]);
  }
}

/** Clipboard + history actions for the editor's own right-click menu (the browser's menu is not used inside the editor). */
function editActions(v) {
  const sel = () => { const { main } = v.state.selection; return main.empty ? '' : v.state.sliceDoc(main.from, main.to); };
  const copy = async () => { const t = sel(); if (!t) return false; try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  return {
    canUndo: undoDepth(v.state) > 0,
    canRedo: redoDepth(v.state) > 0,
    readOnly: v.state.readOnly,
    undo: () => { v.focus(); undo(v); },
    redo: () => { v.focus(); redo(v); },
    selectAll: () => { v.focus(); selectAll(v); },
    copy: async () => { const ok = await copy(); v.focus(); return ok; },
    cut: async () => {
      if (v.state.readOnly) return false;
      const ok = await copy();
      if (ok) v.dispatch(v.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
      v.focus();
      return ok;
    },
    paste: async () => {
      if (v.state.readOnly) return false;
      try {
        const t = await navigator.clipboard.readText();
        v.focus();
        if (t) v.dispatch(v.state.replaceSelection(t), { userEvent: 'input.paste', scrollIntoView: true });
        return true;
      } catch { v.focus(); return false; } // clipboard read blocked: the caller tells the user to press Ctrl+V
    },
  };
}

/**
 * One CodeMirror view for the whole workbench. Each open file keeps its own EditorState
 * (undo history, selection, scroll) in `statesRef`, swapped in when its tab becomes active.
 */
export default function CodeEditor({ docId, path, initialText, onChange, onCursor, onContext, readOnly, wrap, fontSize, reveal, theme, ghost, findTick }) {
  const host = useRef(null);
  const view = useRef(null);
  const states = useRef(new Map());
  const scrolls = useRef(new Map());
  const current = useRef(null);
  const cb = useRef({ onChange, onCursor, onContext });
  cb.current = { onChange, onCursor, onContext };
  // AI autocomplete options ({ enabled, request, onDisable }), read lazily by the extension so a change needs no rebuild
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const pathRef = useRef(path);
  pathRef.current = path;
  // the workbench re-renders on every cursor report, so while a selection is dragged / extended with the keyboard it is reported
  // only once the selection settles (trailing debounce) — a drag no longer re-renders the whole workbench per mouse move
  const cursorT = useRef(0);
  const cursorLast = useRef(null);
  const reportCursor = (c) => {
    cursorLast.current = c;
    clearTimeout(cursorT.current);
    cursorT.current = setTimeout(() => cb.current.onCursor?.(cursorLast.current), 140);
  };
  const wrapComp = useRef(new Compartment());
  const roComp = useRef(new Compartment());
  const sizeComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());

  const makeState = (p, text) => EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      search({ top: true }),
      ghostComplete(() => {
        const g = ghostRef.current;
        return g && { ...g, meta: () => ({ filename: pathRef.current, language: extOf(pathRef.current) }) };
      }),
      keymap.of([indentWithTab]),
      themeComp.current.of(buildEditorTheme(theme)),
      languageFor(p, text),
      wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
      roComp.current.of(EditorState.readOnly.of(!!readOnly)),
      sizeComp.current.of(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
      // right-click: hands the selection (lines + text) to the workbench, which may show its own menu (return false = native menu)
      EditorView.domEventHandlers({
        contextmenu: (e, v) => {
          const h = cb.current.onContext;
          if (!h) return false;
          const { main } = v.state.selection;
          const doc = v.state.doc;
          const info = { x: e.clientX, y: e.clientY, empty: main.empty, edit: editActions(v) };
          if (!main.empty) {
            const endLine = doc.lineAt(main.to);
            info.fromLine = doc.lineAt(main.from).number;
            // a selection that ends at the very start of a line does not include that line
            info.toLine = endLine.from === main.to ? Math.max(info.fromLine, endLine.number - 1) : endLine.number;
            info.text = doc.sliceString(main.from, Math.min(main.to, main.from + 100000));
          }
          // the workbench always shows its own menu (cut / copy / paste / undo … + the AI actions) — never the browser's
          e.preventDefault();
          h(info);
          return true;
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          const { main } = u.state.selection;
          const pos = main.head;
          const line = u.state.doc.lineAt(pos);
          // selected lines (1-based; a selection ending at the very start of a line does not include that line) — the AI chat sends them as context
          let sel = null;
          if (!main.empty) {
            const a = u.state.doc.lineAt(main.from);
            const b = u.state.doc.lineAt(main.to);
            sel = { from: a.number, to: b.from === main.to ? Math.max(a.number, b.number - 1) : b.number };
          }
          reportCursor({ line: line.number, col: pos - line.from + 1, sel });
        }
      }),
      // keep browser extensions (Grammarly, translators, writing helpers…) and spell-check away from the code
      EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false' }),
    ],
  });

  useEffect(() => {
    view.current = new EditorView({ parent: host.current, state: makeState(path, initialText) });
    current.current = docId;
    states.current.set(docId, view.current.state);
    cb.current.onCursor?.({ line: 1, col: 1 });
    return () => { clearTimeout(cursorT.current); view.current?.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // switch file
  useEffect(() => {
    const v = view.current;
    if (!v || current.current === docId) return;
    if (current.current) {
      states.current.set(current.current, v.state);
      scrolls.current.set(current.current, v.scrollDOM.scrollTop);
    }
    const next = states.current.get(docId) || makeState(path, initialText);
    v.setState(next);
    // compartments of a stored state may be stale -> re-apply the global toggles
    v.dispatch({ effects: [
      clearGhostEffect,
      wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []),
      roComp.current.reconfigure(EditorState.readOnly.of(!!readOnly)),
      sizeComp.current.reconfigure(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
      themeComp.current.reconfigure(buildEditorTheme(theme)),
    ] });
    current.current = docId;
    requestAnimationFrame(() => { v.scrollDOM.scrollTop = scrolls.current.get(docId) || 0; });
    const pos = next.selection.main.head;
    const line = next.doc.lineAt(pos);
    clearTimeout(cursorT.current);
    cb.current.onCursor?.({ line: line.number, col: pos - line.from + 1, sel: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // jump to a "search in files" hit: select it, centre it, and highlight every other hit of the same query
  useEffect(() => {
    const v = view.current;
    if (!v || !reveal || reveal.path !== path || current.current !== docId) return;
    const doc = v.state.doc;
    const ln = doc.line(Math.min(Math.max(1, reveal.line), doc.lines));
    const from = Math.min(ln.from + reveal.col, ln.to);
    const to = Math.min(from + reveal.len, ln.to);
    const sp = reveal.spec;
    const effects = [EditorView.scrollIntoView(from, { y: 'center' })];
    if (sp?.query) effects.push(setSearchQuery.of(new SearchQuery({ search: sp.query, caseSensitive: !!sp.caseSensitive, regexp: !!sp.regex, wholeWord: !!sp.wholeWord })));
    v.dispatch({ selection: { anchor: from, head: to }, effects });
    v.focus();
    // re-assert after the tab-switch scroll restore above (it runs in a rAF)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (view.current !== v) return;
      const end = Math.min(from, v.state.doc.length);
      v.dispatch({ effects: EditorView.scrollIntoView(end, { y: 'center' }) });
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.key, docId]);

  // a "Search" button outside the editor (phones have no Ctrl+F): toggles CodeMirror's own search panel
  useEffect(() => {
    const v = view.current;
    if (!v || !findTick) return;
    if (searchPanelOpen(v.state) && findTick % 2 === 0) closeSearchPanel(v); else openSearchPanel(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findTick]);

  // turning the AI autocomplete off removes a suggestion that is still showing
  useEffect(() => { if (!ghost?.enabled) view.current?.dispatch({ effects: clearGhostEffect }); }, [ghost?.enabled]);

  // global toggles
  useEffect(() => { view.current?.dispatch({ effects: themeComp.current.reconfigure(buildEditorTheme(theme)) }); }, [theme]);
  useEffect(() => { view.current?.dispatch({ effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  useEffect(() => { view.current?.dispatch({ effects: roComp.current.reconfigure(EditorState.readOnly.of(!!readOnly)) }); }, [readOnly, docId]);
  useEffect(() => { view.current?.dispatch({ effects: sizeComp.current.reconfigure(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })) }); }, [fontSize]);

  return <div ref={host} className="zb-cm" />;
}
