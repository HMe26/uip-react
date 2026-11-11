import { StateEffect, StateField, Prec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { api, getTokens } from '../../../api/client';

/**
 * AI autocomplete ("ghost text") for the workbench's CodeMirror editor.
 *
 *  - grey suggestion after the cursor; Tab accepts it, Esc (or any cursor move / unrelated edit) drops it;
 *  - typing the characters the suggestion already starts with just shortens it (no new request);
 *  - requests are debounced, only follow real typing (not paste / undo / delete / accepting), and a request whose
 *    document changed in the meantime is discarded (and aborted when possible);
 *  - answers are cached per (text before cursor, text after cursor);
 *  - 429 -> back off for a while; 403 / 503 -> switch itself off for this session.
 *
 * Uses a plain fetch to POST /api/v1/ai-code/complete (not `api.post`): api.post broadcasts a "mutation" event that
 * makes pages refresh their data, which must not happen on every keystroke pause.
 */

const ENDPOINT = '/api/v1/ai-code/complete';
export const GHOST_DEBOUNCE_MS = 650;
const MIN_REQUEST_GAP_MS = 400;
const REQUEST_TIMEOUT_MS = 12000;
const BACKOFF_MS = 20000;
const CACHE_MAX = 60;
const CONTEXT_BEFORE = 4000;
const CONTEXT_AFTER = 1500;

const setGhost = StateEffect.define();   // { pos, text } | null
export const clearGhostEffect = setGhost.of(null);

class GhostWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-ghost-text';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() { return true; }
}

const ghostField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    if (!value) return null;
    if (tr.docChanged) {
      // the user typed exactly what the suggestion starts with: keep the rest of it
      let n = 0; let from = -1; let to = -1; let ins = '';
      tr.changes.iterChanges((fa, ta, fb, tb, inserted) => { n += 1; from = fa; to = ta; ins = inserted.toString(); });
      if (n === 1 && from === to && from === value.pos && ins && tr.isUserEvent('input.type') && value.text.startsWith(ins)) {
        const rest = value.text.slice(ins.length);
        return rest ? { pos: value.pos + ins.length, text: rest } : null;
      }
      return null;
    }
    if (tr.selection) {
      const s = tr.state.selection.main;
      if (!s.empty || s.head !== value.pos) return null;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (g) => (g && g.text
    ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)])
    : Decoration.none)),
});

/** Accept the suggestion: insert it and put the cursor at its end. Returns false when there is none (Tab falls through to indent). */
function acceptGhost(view) {
  const g = view.state.field(ghostField, false);
  if (!g || !g.text || view.state.readOnly) return false;
  view.dispatch({
    changes: { from: g.pos, insert: g.text },
    selection: { anchor: g.pos + g.text.length },
    effects: setGhost.of(null),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  return true;
}

function dismissGhost(view) {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  view.dispatch({ effects: setGhost.of(null) });
  return true;
}

/** Plain fetch of one completion. Resolves { text } | { text:'', backoff:true } | { text:'', disable:true }; never throws. */
export async function fetchCompletion({ prefix, suffix, language, filename, signal, projectId }, retried = false) {
  try {
    const { accessToken } = getTokens();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ prefix, suffix, language: language || '', filename: filename || '', project_id: projectId || undefined }),
    });
    if (res.status === 401 && !retried) {
      await api.get('/api/v1/ai-code/status'); // a normal client call refreshes the expired token; then replay once
      return fetchCompletion({ prefix, suffix, language, filename, signal, projectId }, true);
    }
    if (res.status === 429) return { text: '', backoff: true };
    if (res.status === 403 || res.status === 503 || res.status === 401) return { text: '', disable: true };
    if (!res.ok) return { text: '' };
    const j = await res.json();
    const text = j && j.data && typeof j.data.completion === 'string' ? j.data.completion : '';
    return { text };
  } catch {
    return { text: '' };
  }
}

/**
 * The extension. `getOptions()` is read on every use so the editor can change it without rebuilding the state:
 *   { enabled:boolean, request(ctx)->Promise<{text,backoff?,disable?}>, meta()->{language,filename}, onDisable?() }
 */
export function ghostComplete(getOptions) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.timer = 0;
      this.seq = 0;
      this.ctrl = null;
      this.cache = new Map();
      this.lastAt = 0;
      this.pausedUntil = 0;
    }

    update(u) {
      if (u.docChanged) {
        this.cancel();
        const typed = u.transactions.some((tr) => tr.isUserEvent('input') && !tr.isUserEvent('input.paste') && !tr.isUserEvent('input.complete') && !tr.isUserEvent('input.drop'));
        // still showing (a shortened) suggestion after typing through it: nothing new to ask
        if (typed && !u.state.field(ghostField, false)) this.schedule();
      } else if (u.selectionSet) {
        this.cancel();
      }
    }

    cancel() {
      clearTimeout(this.timer);
      this.timer = 0;
      this.seq += 1;
      if (this.ctrl) { try { this.ctrl.abort(); } catch { /* ignore */ } this.ctrl = null; }
    }

    schedule() {
      const o = getOptions();
      if (!o || !o.enabled || Date.now() < this.pausedUntil) return;
      const wait = Math.max(GHOST_DEBOUNCE_MS, MIN_REQUEST_GAP_MS - (Date.now() - this.lastAt));
      this.timer = setTimeout(() => this.run(), wait);
    }

    eligible(view) {
      const o = getOptions();
      if (!o || !o.enabled || view.state.readOnly || view.composing || !view.hasFocus) return false;
      const sel = view.state.selection.main;
      if (!sel.empty) return false;
      const line = view.state.doc.lineAt(sel.head);
      const before = line.text.slice(0, sel.head - line.from);
      const after = line.text.slice(sel.head - line.from);
      // after the cursor only whitespace or closers (auto-closed brackets / quotes) may follow
      if (/[^\s)\]}>"'`;,]/.test(after)) return false;
      if (before.trim() === '' && sel.head === 0) return false;
      // an open completion popup would sit on top of the suggestion
      if (view.dom.querySelector('.cm-tooltip-autocomplete')) return false;
      return true;
    }

    async run() {
      this.timer = 0;
      const view = this.view;
      if (!this.eligible(view)) return;
      const o = getOptions();
      const doc = view.state.doc;
      const pos = view.state.selection.main.head;
      const prefix = doc.sliceString(Math.max(0, pos - CONTEXT_BEFORE), pos);
      const suffix = doc.sliceString(pos, Math.min(doc.length, pos + CONTEXT_AFTER));
      if (prefix.trim() === '') return;

      const key = `${prefix.slice(-400)}\u0000${suffix.slice(0, 120)}`;
      const show = (text) => {
        if (!text || view.state.selection.main.head !== pos || view.state.doc.length !== doc.length) return;
        view.dispatch({ effects: setGhost.of({ pos, text }) });
      };
      if (this.cache.has(key)) { show(this.cache.get(key)); return; }

      const seq = this.seq + 1;
      this.seq = seq;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      this.ctrl = ctrl;
      const timeout = setTimeout(() => { try { ctrl?.abort(); } catch { /* ignore */ } }, REQUEST_TIMEOUT_MS);
      this.lastAt = Date.now();
      const meta = (o.meta && o.meta()) || {};
      let res;
      try {
        res = await o.request({ prefix, suffix, language: meta.language, filename: meta.filename, signal: ctrl ? ctrl.signal : undefined });
      } finally {
        clearTimeout(timeout);
      }
      if (seq !== this.seq || !this.view) return; // the document moved on while we waited
      this.ctrl = null;
      if (res.disable) { o.onDisable?.(); return; }
      if (res.backoff) { this.pausedUntil = Date.now() + BACKOFF_MS; return; }
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, res.text || '');
      show(res.text);
    }

    destroy() { this.cancel(); this.view = null; }
  });

  return [
    ghostField,
    plugin,
    // above indentWithTab and the default keymap, but only acts when a suggestion is showing
    Prec.highest(keymap.of([
      { key: 'Tab', run: acceptGhost },
      { key: 'Escape', run: dismissGhost },
    ])),
  ];
}
