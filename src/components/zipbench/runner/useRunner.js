import { useCallback, useEffect, useRef, useState } from 'react';
import { RUNNER_ORIGIN } from '../../../config/runner';

const MAX_LOGS = 3000;

/**
 * Talks to the isolated runner iframe (see /uip-runner). The iframe element is rendered by the caller with
 * ref={frameRef} and onLoad={onFrameLoad}. Only messages that come from THAT iframe window (and the runner origin)
 * are accepted — code running inside the preview can not forge them.
 */
export function useRunner() {
  const frameRef = useRef(null);
  const readyRef = useRef(false);
  const idRef = useRef(0);
  const queued = useRef(null);
  const buf = useRef([]);
  const flushT = useRef(0);
  const helloT = useRef(0);
  const waitT = useRef(0);
  const lastRef = useRef(null);    // payload of the last run (a paused input() run is resumed from it)
  const emittedRef = useRef(0);   // characters of output already shown when the program asked for input
  const [ready, setReady] = useState(false);
  const [state, setState] = useState('idle'); // idle | building | running | done | error | stopped
  const [statusText, setStatusText] = useState('');
  const [logs, setLogs] = useState([]);

  const send = useCallback((msg) => { frameRef.current?.contentWindow?.postMessage(msg, RUNNER_ORIGIN); }, []);

  const flush = useCallback(() => {
    flushT.current = 0;
    const add = buf.current; buf.current = [];
    if (add.length) setLogs((prev) => { const next = prev.concat(add); return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next; });
  }, []);
  const pushLog = useCallback((level, text) => {
    buf.current.push({ level, text });
    if (!flushT.current) flushT.current = window.setTimeout(flush, 60);
  }, [flush]);

  useEffect(() => {
    if (!RUNNER_ORIGIN) return undefined;
    const onMsg = (e) => {
      if (e.origin !== RUNNER_ORIGIN || e.source !== frameRef.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.uip !== true) return;
      if (m.type === 'ready') {
        readyRef.current = true; setReady(true);
        clearTimeout(waitT.current);
        clearInterval(helloT.current);
        if (queued.current) { send(queued.current); queued.current = null; }
        return;
      }
      if (m.id !== idRef.current) return; // belongs to an older run
      if (m.type === 'need-input') { emittedRef.current = Number(m.emitted) || 0; return; }
      if (m.type === 'log') pushLog(String(m.level || 'log'), String(m.text ?? ''));
      else if (m.type === 'status') { setState(m.state || 'idle'); setStatusText(m.text || ''); }
    };
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); clearInterval(helloT.current); clearTimeout(waitT.current); clearTimeout(flushT.current); };
  }, [pushLog, send]);

  // the iframe (re)loaded: handshake until the runner answers (it may still be starting)
  const onFrameLoad = useCallback(() => {
    readyRef.current = false; setReady(false);
    clearInterval(helloT.current);
    let tries = 0;
    send({ uip: 'hello' });
    helloT.current = window.setInterval(() => {
      tries += 1;
      if (readyRef.current || tries > 40) { clearInterval(helloT.current); return; }
      send({ uip: 'hello' });
    }, 250);
  }, [send]);

  const run = useCallback((payload, { keepLogs = false } = {}) => {
    idRef.current += 1;
    const id = idRef.current;
    lastRef.current = payload;
    if (!keepLogs) { buf.current = []; clearTimeout(flushT.current); flushT.current = 0; setLogs([]); }
    setState('building'); setStatusText('');
    const msg = { uip: 'run', id, ...payload };
    clearTimeout(waitT.current);
    if (readyRef.current) send(msg);
    else {
      queued.current = msg;
      // the runner page never answered the handshake: say why instead of spinning forever
      waitT.current = window.setTimeout(() => {
        if (readyRef.current || idRef.current !== id) return;
        queued.current = null;
        pushLog('error', 'The runner did not respond. Check that VITE_RUNNER_URL points to the deployed uip-runner site, that this app\'s CSP frame-src allows it, and that the runner allows this origin in frame-ancestors (vercel.json). | الـ Runner مش بيرد — اتأكد من VITE_RUNNER_URL ومن frame-src في CSP ومن frame-ancestors في vercel.json بتاع الـ runner.');
        setState('error'); setStatusText('');
      }, 10000);
    }
    return id;
  }, [send]);

  // The program called input() / prompt() / confirm(): echo what the user typed after the prompt, then run again with that line added. The first
  // `emittedRef` characters of output were already shown, so the worker swallows them and carries on from the same point.
  const submitInput = useCallback((value) => {
    const p = lastRef.current; if (!p) return;
    flush();
    const text = String(value ?? '');
    setLogs((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.level === 'stdout' && !/\n$/.test(last.text)) return prev.slice(0, -1).concat({ ...last, text: `${last.text}${text}\n`, echo: [last.text.length, last.text.length + text.length] }); // echo = where the user's typed answer sits, so the console can colour it
      return prev.concat({ level: 'stdout', text: `${text}\n` });
    });
    // browser JavaScript (prompt()/confirm()): answers are kept as a list (an empty answer is a real answer), and `skip`
    // is the number of console lines already shown, which the re-run swallows
    if (p.kind === 'web') {
      run({ ...p, answers: [...(p.answers || []), text], skip: emittedRef.current }, { keepLogs: true });
      return;
    }
    const base = String(p.stdin || '').replace(/\n+$/, '');
    run({ ...p, stdin: base ? `${base}\n${text}` : text, skip: emittedRef.current }, { keepLogs: true });
  }, [flush, run]);

  const stop = useCallback(() => {
    queued.current = null; clearTimeout(waitT.current);
    send({ uip: 'stop' });
    setState((s) => (s === 'building' || s === 'running' || s === 'input' ? 'stopped' : s));
  }, [send]);

  const reset = useCallback(() => { queued.current = null; idRef.current += 1; setState('idle'); setStatusText(''); setLogs([]); }, []);
  const clearLogs = useCallback(() => { buf.current = []; setLogs([]); }, []);

  return { frameRef, ready, state, statusText, logs, run, submitInput, stop, reset, clearLogs, onFrameLoad, busy: state === 'building' };
}
