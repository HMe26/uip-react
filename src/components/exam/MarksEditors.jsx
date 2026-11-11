import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { fmtNum } from './examUi';

/**
 * Editable points widgets for the exam builder.
 *  - MarksInput: a number box with −/+ steppers for ONE question; saves on blur / Enter / stepper.
 *  - TotalPointsEditor: the exam total. Changing it asks the server to spread the new total evenly
 *    over the questions (the server keeps the sum exact); each question can then be tuned alone.
 */

const STEP = 0.5;
const round2 = (n) => Math.round(n * 100) / 100;

export function MarksInput({ value, ar, onCommit, disabled, min = 0.25 }) {
  const [text, setText] = useState(String(value ?? ''));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setText(value === null || value === undefined ? '' : String(round2(Number(value)))); }, [value]);

  async function commit(raw) {
    const n = round2(Number(raw));
    if (!Number.isFinite(n) || n < min) { setText(String(round2(Number(value)))); return; }
    if (n === round2(Number(value))) { setText(String(n)); return; }
    setBusy(true);
    try { await onCommit(n); } catch { setText(String(round2(Number(value)))); } finally { setBusy(false); }
  }

  const bump = (d) => commit(Math.max(min, round2((Number(text) || 0) + d)));
  const off = disabled || busy;

  return (
    <span className="ex-marks" aria-busy={busy}>
      <button type="button" className="ex-marks__btn" disabled={off || Number(text) <= min} onClick={() => bump(-STEP)} aria-label={ar ? 'إنقاص الدرجة' : 'Decrease points'}>−</button>
      <input
        className="ex-marks__input"
        type="number"
        inputMode="decimal"
        min={min}
        step="0.25"
        value={text}
        disabled={off}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        aria-label={ar ? 'درجة السؤال' : 'Question points'}
      />
      <button type="button" className="ex-marks__btn" disabled={off} onClick={() => bump(STEP)} aria-label={ar ? 'زيادة الدرجة' : 'Increase points'}>+</button>
      <span className="ex-marks__unit">{ar ? 'درجة' : 'pts'}</span>
    </span>
  );
}

export function TotalPointsEditor({ id, total, canEdit, ar, onApply, compact }) {
  const [text, setText] = useState(String(total ?? 0));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setText(String(round2(Number(total ?? 0)))); }, [total]);

  async function apply() {
    const n = round2(Number(text));
    if (!Number.isFinite(n) || n <= 0) { setText(String(round2(Number(total ?? 0)))); return; }
    if (n === round2(Number(total ?? 0))) return;
    setBusy(true);
    try { await onApply(n); } catch { setText(String(round2(Number(total ?? 0)))); } finally { setBusy(false); }
  }

  if (!canEdit) {
    return compact
      ? <b>{fmtNum(total ?? 0, 2)}</b>
      : <input id={id} className="ex-input" value={fmtNum(total ?? 0, 2)} readOnly aria-readonly="true" />;
  }

  return (
    <span className={`ex-total${compact ? ' ex-total--compact' : ''}`}>
      <input
        id={id}
        className="ex-input"
        type="number"
        min="0.25"
        step="0.5"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        aria-label={ar ? 'إجمالي الدرجات' : 'Total points'}
      />
      <button type="button" className="ex-icon-btn" disabled={busy} onClick={apply} title={ar ? 'توزيع تلقائي على الأسئلة' : 'Distribute across questions'} aria-label={ar ? 'توزيع تلقائي' : 'Distribute'}>
        <Icon name="refresh" size={15} />
      </button>
    </span>
  );
}
