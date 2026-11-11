import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { useTt } from './shared';

/** In-app modal shell: scrim + centered card, Esc / outside-click to close, focus returns to the opener, body scroll locked. */
export function Dialog({ title, icon, tone = 'default', onClose, children, footer, busy = false, wide = false, labelledBy }) {
  const { tt } = useTt();
  const card = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const k = (e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    card.current?.focus();
    return () => { window.removeEventListener('keydown', k, true); document.body.style.overflow = prev; if (opener && opener.focus) opener.focus(); };
  }, [onClose, busy]);
  const id = labelledBy || 'pp-dlg-title';
  return createPortal(
    <div className="pp-dlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`pp-dlg ${wide ? 'is-wide' : ''} is-${tone}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={card}>
        <header className="pp-dlg__head">
          {icon && <span className="pp-dlg__ico"><Icon name={icon} size={20} /></span>}
          <h3 id={id}>{title}</h3>
          <button type="button" className="pp-icon" onClick={onClose} disabled={busy} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>
        <div className="pp-dlg__body">{children}</div>
        {footer && <footer className="pp-dlg__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

function ConfirmBox({ opts, onDone }) {
  const { tt } = useTt();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [text, setText] = useState(opts.initial || '');
  const isAsk = opts.kind === 'prompt';
  const go = async () => {
    if (isAsk && !opts.allowEmpty && !text.trim()) return;
    setBusy(true); setErr('');
    try { if (opts.run) await opts.run(isAsk ? text.trim() : undefined); onDone(isAsk ? text.trim() : true); } catch (e) { setErr(e?.message || String(e)); setBusy(false); }
  };
  const danger = opts.danger !== false && !isAsk;
  return (
    <Dialog title={opts.title} icon={opts.icon || (danger ? 'alert-triangle' : 'check')} tone={danger ? 'danger' : 'default'} busy={busy} onClose={() => onDone(isAsk ? null : false)}
      footer={(
        <>
          <button type="button" className="pp-btn" disabled={busy} onClick={() => onDone(isAsk ? null : false)}>{opts.cancelLabel || tt('Cancel', 'إلغاء')}</button>
          <button type="button" className={`pp-btn is-primary ${danger ? 'is-danger' : ''}`} disabled={busy || (isAsk && !opts.allowEmpty && !text.trim())} onClick={go} autoFocus={!isAsk}>
            {busy ? tt('Working…', 'جارٍ التنفيذ…') : (opts.confirmLabel || tt('Confirm', 'تأكيد'))}
          </button>
        </>
      )}>
      {opts.message && <p className="pp-dlg__msg">{opts.message}</p>}
      {isAsk && (
        <label className="pp-dlg__field">
          {opts.label && <span>{opts.label}</span>}
          <input className="pp-input" value={text} maxLength={opts.maxLength || 100} autoFocus onChange={(e) => setText(e.target.value)} placeholder={opts.placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }} />
        </label>
      )}
      {err && <p className="pp-err pp-dlg__msg" role="alert">{err}</p>}
    </Dialog>
  );
}

/**
 * Promise-based replacement for window.confirm / window.prompt:
 *   const { confirm, ask, dialogs } = useDialogs();  …  if (await confirm({ title, message, confirmLabel })) …  ; render {dialogs}.
 * `run` (optional) is awaited while the button shows a spinner; the dialog stays open with the error if it throws.
 */
export function useDialogs() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const open = useCallback((opts) => new Promise((resolve) => { resolver.current = resolve; setState(opts); }), []);
  const done = useCallback((v) => { setState(null); resolver.current?.(v); resolver.current = null; }, []);
  const confirm = useCallback((o) => open({ ...o, kind: 'confirm' }), [open]);
  const ask = useCallback((o) => open({ ...o, kind: 'prompt' }), [open]);
  const dialogs = state ? <ConfirmBox opts={state} onDone={done} /> : null;
  return useMemo(() => ({ confirm, ask, dialogs }), [confirm, ask, dialogs]);
}

const Ctx = createContext(null);
export const DialogsProvider = Ctx.Provider;
export const useSharedDialogs = () => useContext(Ctx);
