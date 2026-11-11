import { useCallback, useEffect, useRef, useState } from 'react';
import { allowDraft, delDraft, putDraft } from './draftStore';
import { saveCenter } from './saveCenter';
import '../styles/css/drafts.css';

/**
 * Debounced local autosave of an editor's unsaved work.
 *   draftKey  – '' disables everything
 *   dirty     – unsaved changes exist; going back to clean (saved / all undone) deletes the draft
 *   token     – changes whenever the content changes (re-arms the timer)
 *   build()   – Blob (stored as { kind:'blob' }), plain object (stored as is) or null (editor not ready: nothing written)
 *   always    – keep the record even while clean (session state such as open tabs)
 *   saver     – optional () => Promise<boolean>: lets the Save Center save this document (reminders, "Save changes?" dialog).
 *   ready     – hold writes back until the editor has loaded, so an empty first state can't replace a stored draft
 * touch() schedules a write without a React state change (typing in a code editor must not re-render the tree).
 */
export default function useAutoDraft({ draftKey, dirty, token, build, meta, delay = 2500, always = false, ready = true, saver }) {
  const buildRef = useRef(build); buildRef.current = build;
  const metaRef = useRef(meta); metaRef.current = meta;
  const keyRef = useRef(draftKey); keyRef.current = draftKey;
  const readyRef = useRef(ready); readyRef.current = ready;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const saverRef = useRef(saver); saverRef.current = saver;
  const [state, setState] = useState({ status: 'idle', at: 0 }); // idle | pending | saving | saved | failed
  const pending = useRef(false);
  const busy = useRef(false);
  const wasDirty = useRef(false);
  const timer = useRef(0);
  const alive = useRef(true);

  const flush = useCallback(async () => {
    const key = keyRef.current;
    if (!key || busy.current || !pending.current) return;
    clearTimeout(timer.current);
    busy.current = true; pending.current = false;
    if (alive.current) setState((s) => ({ ...s, status: 'saving' }));
    let ok = false; let skipped = false;
    try {
      const out = await buildRef.current();
      if (out instanceof Blob) ok = await putDraft(key, { kind: 'blob', blob: out, ...(metaRef.current || {}) });
      else if (out) ok = await putDraft(key, { ...out, ...(metaRef.current || {}) });
      else skipped = true;
    } catch { ok = false; }
    busy.current = false;
    if (alive.current) setState(skipped ? { status: 'idle', at: 0 } : { status: ok ? 'saved' : 'failed', at: Date.now() });
    if (pending.current) timer.current = setTimeout(flush, delay);
  }, [delay]);

  const touch = useCallback(() => {
    if (!keyRef.current || !readyRef.current) return;
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
    setState((s) => (s.status === 'pending' || s.status === 'saving' ? s : { ...s, status: 'pending' }));
  }, [flush, delay]);

  useEffect(() => {
    if (!draftKey || !ready) return;
    if (dirty || always) touch();
    else if (wasDirty.current) {
      pending.current = false;
      clearTimeout(timer.current);
      delDraft(draftKey);
      setState({ status: 'idle', at: 0 });
    }
    wasDirty.current = dirty;
  }, [draftKey, dirty, always, ready, token, touch]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden' && pending.current) flush(); };
    const bye = (e) => {
      if (pending.current || busy.current) { flush(); if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', bye);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('beforeunload', bye);
    };
  }, [flush]);

  // tell the Save Center about unsaved changes (reminders + "Save changes?" dialog)
  const docName = meta?.name;
  useEffect(() => {
    if (!draftKey) return undefined;
    saveCenter.report(draftKey, { dirty: !!dirty, name: docName, save: saverRef.current ? () => saverRef.current?.() : undefined });
    return undefined;
  }, [draftKey, dirty, docName, token, !!saver]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (draftKey) saveCenter.release(draftKey); }, [draftKey]);

  useEffect(() => { if (draftKey) allowDraft(draftKey); }, [draftKey]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); if (pending.current) flush(); }; }, [flush]);

  return { ...state, flush, touch };
}

/** Small status chip next to the Save button. */
export function DraftChip({ draft, tt }) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!online) return <span className="uip-netchip" title={tt('No connection — your edits are kept on this device', 'مفيش اتصال — تعديلاتك محفوظة على جهازك')}>{tt('Offline · kept on this device', 'بدون نت · محفوظ على جهازك')}</span>;
  const s = draft?.status;
  if (s === 'saved') return <span className="ed__pagecount" title={tt('Auto-saved on this device (not on the server yet)', 'محفوظ تلقائيًا على جهازك (لسه مش على السيرفر)')}>✓&nbsp;{tt('draft saved', 'اتحفظت مسودة')}</span>;
  if (s === 'saving' || s === 'pending') return <span className="ed__pagecount">…&nbsp;{tt('saving draft', 'بيحفظ مسودة')}</span>;
  if (s === 'failed') return <span className="ed__err">{tt('Draft not saved locally', 'المسودة ما اتحفظتش محليًا')}</span>;
  return null;
}
