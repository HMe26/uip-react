/** Colour themes for the ZIP workbench: one palette drives both the UI chrome (CSS variables) and the code editor. */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

import { THEMES } from './themePalettes';
export { THEMES };

export const DEFAULT_THEME = 'dark';
export const themeById = (id) => THEMES.find((x) => x.id === id) || THEMES[0];

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS variables for the .zb root: { '--zb-bg': '#…', … } */
export function themeVars(id) {
  const th = themeById(id);
  const out = { colorScheme: th.dark ? 'dark' : 'light' };
  Object.entries(th.ui).forEach(([k, v]) => { out[`--zb-${kebab(k)}`] = v; });
  return out;
}

/** CodeMirror extensions (UI theme + syntax highlighting) for a theme id. */
export function buildEditorTheme(id) {
  const th = themeById(id);
  const { ed: e, ui: u } = th;
  const view = EditorView.theme({
    '&': { color: e.fg, backgroundColor: e.bg },
    '.cm-content': { caretColor: e.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: e.cursor },
    // one paint only (the drawn selection layer): the native ::selection is hidden by CodeMirror, styling it too just doubles the work
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: e.selection, borderRadius: '2px' },
    '.cm-activeLine': { backgroundColor: e.line },
    '.cm-gutters': { backgroundColor: e.bg, color: e.gutter, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: e.line, color: e.fg },
    '.cm-selectionMatch': { backgroundColor: e.match },
    '.cm-searchMatch': { backgroundColor: e.find, borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: e.findSel },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: e.match, outline: `1px solid ${u.accent}` },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'transparent', outline: `1px solid ${u.danger}` },
    '.cm-foldPlaceholder': { backgroundColor: u.btn, color: u.muted, border: `1px solid ${u.line}` },
    '.cm-panels': { backgroundColor: u.side, color: u.text },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${u.line}` },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${u.line}` },
    '.cm-panel.cm-search input, .cm-panel.cm-search .cm-textfield': { backgroundColor: u.input, color: u.text, border: `1px solid ${u.line}`, borderRadius: '4px' },
    '.cm-panel.cm-search .cm-button': { backgroundImage: 'none', backgroundColor: u.btn, color: u.text, border: `1px solid ${u.line}`, borderRadius: '4px' },
    '.cm-panel.cm-search label': { color: u.muted },
    '.cm-tooltip': { backgroundColor: u.menu, border: `1px solid ${u.line}`, color: u.text },
  }, { dark: th.dark });

  const hl = HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: e.keyword },
    { tag: [t.controlKeyword, t.self], color: e.control },
    { tag: [t.string, t.regexp, t.special(t.string), t.inserted], color: e.string },
    { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], color: e.number },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: e.comment, fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: e.fn },
    { tag: [t.variableName, t.name, t.labelName], color: e.variable },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: e.prop },
    { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: e.type },
    { tag: [t.tagName, t.angleBracket], color: e.tag },
    { tag: [t.attributeName], color: e.attr },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: e.op },
    { tag: [t.meta, t.processingInstruction, t.annotation, t.deleted], color: e.meta },
    { tag: t.heading, color: e.keyword, fontWeight: 'bold' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.link, color: e.fn, textDecoration: 'underline' },
    { tag: t.invalid, color: e.invalid },
  ]);
  return [view, syntaxHighlighting(hl)];
}
