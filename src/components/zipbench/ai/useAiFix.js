import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getTokens } from '../../../api/client';

const BASE = '/api/v1/ai-code';
const STALL_MS = 60 * 1000;     // no bytes for a minute -> give up
const MAX_MS = 3 * 60 * 1000;   // whole answer
const FLUSH_MS = 40;            // batch streamed tokens into one render

const isAr = () => { try { return localStorage.getItem('uip_locale') === 'ar'; } catch { return false; } };

/** Messages for the failures the server can answer with before the stream starts. */
function httpMessage(status, serverMsg, tt) {
  if (status === 403) return tt('You do not have permission to use the AI code assistant (or it is locked during an exam).', 'مفيش عندك صلاحية لاستخدام مساعد الكود (أو هو مقفول أثناء الامتحان).');
  if (status === 429) return tt('Too many requests. Please wait a moment and try again.', 'طلبات كتير. استنى شوية وجرّب تاني.');
  if (status === 413) return tt('This file is too large for the assistant. Try a smaller file.', 'الملف كبير على المساعد. جرّب ملف أصغر.');
  if (status === 503) return tt('The AI code assistant is not available right now.', 'مساعد الكود مش متاح دلوقتي.');
  return serverMsg || tt('Something went wrong. Please try again.', 'حصلت مشكلة. جرّب تاني.');
}

/**
 * "Explain / fix this error" for the workbench.
 *
 *   const ai = useAiFix({ enabled, tt });
 *   ai.available            // the server says the assistant is on (permission + configured + not disabled)
 *   ai.ask({ path, code, error, line, mode })  // streams the explanation, then the verified edits (assistant mode)
 *
 * Talks to POST /api/v1/ai-code/fix (SSE: start → token* → [edits] → done | error) with fetch + ReadableStream (the
 * request needs a POST body, so EventSource is not an option) — same approach as the site's AI assistant widget.
 */
export function useAiFix({ enabled, tt, projectId }) {
  const [status, setStatus] = useState(null); // { available, default_mode, allow_mode_switch, modes, limits } | null
  const [panel, setPanel] = useState(null);   // null = closed, else the current question + answer (see ask())
  const abortRef = useRef(null);
  const seqRef = useRef(0);
  const ttRef = useRef(tt);
  ttRef.current = tt;

  useEffect(() => {
    if (!enabled) { setStatus(null); return undefined; }
    let dead = false;
    // inside a project the supervising doctor may have fixed the AI mode (off / tutor / assistant): the server answers for that project
    api.get(projectId ? `${BASE}/status?project_id=${encodeURIComponent(projectId)}` : `${BASE}/status`)
      .then((res) => { if (!dead) setStatus((res && res.data) || res || null); })
      .catch(() => { if (!dead) setStatus(null); });
    return () => { dead = true; };
  }, [enabled, projectId]);

  const abort = useCallback(() => {
    seqRef.current += 1;
    try { abortRef.current?.abort(); } catch { /* already done */ }
    abortRef.current = null;
  }, []);
  useEffect(() => abort, [abort]);

  /** @param {{ path:string, code:string, error:string, line?:number, language?:string, filename?:string, mode?:string }} q */
  const ask = useCallback((q) => {
    abort();
    const seq = seqRef.current;
    const t = (en, ar) => ttRef.current(en, ar);
    const mode = q.mode || status?.default_mode || 'tutor';
    const isAssist = !!q.action; // right-click menu action (explain / fix / improve / comment / convert / test) vs. "explain this error"
    setPanel({ path: q.path, line: q.line || null, mode, action: q.action || 'error', question: q, text: '', edits: [], phase: 'streaming', error: '' });

    const patch = (p) => { if (seq === seqRef.current) setPanel((cur) => (cur ? { ...cur, ...p } : cur)); };

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ctrl;
    let textBuf = ''; let flushT = 0; let settled = false; let stall = 0; let hardStop = 0;
    const flush = () => { flushT = 0; if (textBuf) { const add = textBuf; textBuf = ''; setPanel((cur) => (seq === seqRef.current && cur ? { ...cur, text: cur.text + add } : cur)); } };
    const finish = (p) => { if (settled) return; settled = true; clearTimeout(stall); clearTimeout(hardStop); clearTimeout(flushT); flush(); patch(p); };
    const timeoutErr = () => ({ phase: 'error', error: t('The assistant took too long to answer. Please try again.', 'المساعد اتأخر في الرد. جرّب تاني.') });
    const bump = () => { clearTimeout(stall); stall = setTimeout(() => { if (settled) return; try { ctrl?.abort(); } catch { /* ignore */ } finish(timeoutErr()); }, STALL_MS); };
    hardStop = setTimeout(() => { if (settled) return; try { ctrl?.abort(); } catch { /* ignore */ } finish(timeoutErr()); }, MAX_MS);

    const body = JSON.stringify(isAssist ? {
      action: q.action, code: q.code, sel_from: q.selFrom || undefined, sel_to: q.selTo || undefined, target: q.target || undefined,
      language: q.language || '', filename: q.filename || '', mode, locale: isAr() ? 'ar' : 'en', project_id: projectId || undefined,
    } : {
      code: q.code, error: q.error, language: q.language || '', filename: q.filename || '', line: q.line || undefined,
      mode, locale: isAr() ? 'ar' : 'en', project_id: projectId || undefined,
    });

    const handle = (evt) => {
      switch (evt.type) {
        case 'token': textBuf += evt.delta || ''; if (!flushT) flushT = setTimeout(flush, FLUSH_MS); break;
        case 'edits': patch({ edits: Array.isArray(evt.edits) ? evt.edits.map((e, i) => ({ ...e, id: i, state: 'pending' })) : [] }); break;
        case 'done': finish(typeof evt.content === 'string' && evt.content ? { phase: 'done', text: evt.content } : { phase: 'done' }); break;
        case 'error': finish({ phase: 'error', error: evt.message || t('Something went wrong. Please try again.', 'حصلت مشكلة. جرّب تاني.') }); break;
        default: break;
      }
    };

    const run = async (retried) => {
      const { accessToken } = getTokens();
      bump();
      try {
        const res = await fetch(`${BASE}/${isAssist ? 'assist' : 'fix'}`, {
          method: 'POST',
          signal: ctrl ? ctrl.signal : undefined,
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Locale': isAr() ? 'ar' : 'en',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body,
        });
        if (res.status === 401 && !retried) { // expired access token: a normal client call refreshes it, then replay once
          clearTimeout(stall);
          await api.get(`${BASE}/status`);
          await run(true);
          return;
        }
        if (!res.ok || !res.body) {
          let msg = '';
          try { const j = await res.json(); msg = (j && j.message) || ''; } catch { /* not json */ }
          throw Object.assign(new Error(httpMessage(res.status, msg, t)), { status: res.status });
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder('utf-8');
        let buf = '';
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (settled) { try { reader.cancel(); } catch { /* ignore */ } return; }
          if (done) break;
          bump();
          buf += dec.decode(value, { stream: true });
          const chunks = buf.split('\n\n');
          buf = chunks.pop();
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue; // eslint-disable-line no-continue
            let evt; try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; } // eslint-disable-line no-continue
            handle(evt);
          }
        }
        finish({ phase: 'done' }); // the stream ended without done/error: keep what we have
      } catch (err) {
        if (settled) return;
        if (err && err.name === 'AbortError') { finish({ phase: 'idle' }); return; }
        finish({ phase: 'error', error: (err && err.message) || t('Something went wrong. Please try again.', 'حصلت مشكلة. جرّب تاني.') });
      }
    };
    run(false);
  }, [abort, status, projectId]);

  const close = useCallback(() => { abort(); setPanel(null); }, [abort]);
  const mark = useCallback((id, state) => setPanel((cur) => (cur ? { ...cur, edits: cur.edits.map((e) => (e.id === id ? { ...e, state } : e)) } : cur)), []);

  return {
    available: !!(status && status.available),
    chatAvailable: !!(status && status.available && status.chat && status.chat.available),
    autocompleteAvailable: !!(status && status.available && status.autocomplete && status.autocomplete.available),
    modes: (status && status.modes) || ['tutor'],
    defaultMode: (status && status.default_mode) || 'tutor',
    projectMode: (status && status.project_mode) || null, // set by the supervising doctor for this project: 'off' | 'tutor' | 'assistant' | null
    limits: (status && status.limits) || {},
    panel, ask, abort, close, mark,
    streaming: panel?.phase === 'streaming',
  };
}
