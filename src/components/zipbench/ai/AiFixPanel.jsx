import { useEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import Markdown from './AiMarkdown';
import { diffRows } from './aiFixUtils';
import '../../../styles/css/zip-ai-fix.css';

/** The model's answer (safe markdown — see AiMarkdown). Kept under this name for the explain-error panel. */
export function Answer({ text, tt, onNewFile, streaming }) {
  return <Markdown text={text} tt={tt} streaming={streaming} onNewFile={onNewFile} />;
}

const DIFF_CAP = 40;

export function Diff({ edit, tt }) {
  const [all, setAll] = useState(false);
  const rows = diffRows(edit);
  const shown = all ? rows : rows.slice(0, DIFF_CAP);
  return (
    <div className="zb-ai__diff" dir="ltr" role="group">
      {shown.map((r, i) => (
        <div key={i} className={`zb-ai__row is-${r.t === '-' ? 'del' : r.t === '+' ? 'add' : 'ctx'}`}>
          <span className="zb-ai__ln">{r.n ?? ''}</span>
          <span className="zb-ai__sign" aria-hidden="true">{r.t === ' ' ? '' : r.t}</span>
          <span className="zb-ai__txt">{r.s || ' '}</span>
        </div>
      ))}
      {rows.length > shown.length && <button type="button" className="zb-ai__more" onClick={() => setAll(true)} dir="auto">{tt ? tt(`Show all ${rows.length} lines`, `عرض كل الـ ${rows.length} سطر`) : `+${rows.length - shown.length}`}</button>}
    </div>
  );
}

/**
 * Right-hand panel of the workbench: the AI's explanation of the error that appeared in the terminal / console, and
 * (assistant mode) the proposed fix as a diff the student applies or rejects. Nothing changes in the code until the
 * student presses Apply.
 */
const TITLES = {
  error: ['Explain this error', 'شرح الخطأ'], explain: ['Explain this code', 'شرح الكود'], fix: ['Fix this code', 'تصليح الكود'],
  improve: ['Improve this code', 'تحسين الكود'], comment: ['Add comments', 'إضافة تعليقات'], convert: ['Convert code', 'تحويل الكود'], test: ['Write tests', 'كتابة اختبارات'],
};

export default function AiFixPanel({ tt, panel, modes, canSwitchMode, onMode, onRetry, onClose, onApply, onApplyAll, onReject, onGoto, onNewFile, fileLabel }) {
  const bodyRef = useRef(null);
  const stick = useRef(true);
  const { phase, text, edits, error, mode, line } = panel;
  const action = panel.action || 'error';
  const target = panel.question?.target;
  const streaming = phase === 'streaming';
  const pending = edits.filter((e) => e.state === 'pending');

  useEffect(() => { const el = bodyRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [text, edits.length, phase]);
  const onScroll = () => { const el = bodyRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; };

  const modeName = (m) => (m === 'assistant' ? tt('Assistant', 'مساعد') : tt('Tutor', 'مدرّس'));
  const modeHint = action === 'explain' ? tt('Explains what the selected code does.', 'بيشرح الكود المحدد بيعمل إيه.')
    : action === 'comment' ? tt('Suggests comments as a change you can review. The code itself is not touched.', 'بيقترح تعليقات كتعديل تراجعه. الكود نفسه ما بيتغيّرش.')
      : mode === 'assistant'
    ? tt('Explains the error and suggests the fix as a change you can review.', 'بيشرح الخطأ وبيقترح التصليح كتعديل تراجعه.')
    : tt('Explains the error and gives you a hint — you write the fix.', 'بيشرح الخطأ وبيدّيك تلميح — وإنت اللي بتكتب الحل.');

  return (
    <aside className="zb-ai" aria-label={tt('AI error assistant', 'مساعد الأخطاء بالذكاء الاصطناعي')}>
      <header className="zb-ai__head">
        <span className="zb-ai__ico"><Icon name="sparkles" size={15} /></span>
        <div className="zb-ai__title">
          <strong>{tt(...(TITLES[action] || TITLES.error))}{action === 'convert' && target ? ` → ${target}` : ''}</strong>
          {fileLabel && (
            <button type="button" className="zb-ai__file" onClick={onGoto} title={tt('Open this file', 'افتح الملف ده')} dir="ltr">
              {fileLabel}{line ? `:${line}` : ''}
            </button>
          )}
        </div>
        <button type="button" className="zb-ibtn" onClick={onClose} title={tt('Close', 'إغلاق')} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={15} /></button>
      </header>

      {canSwitchMode && (
        <div className="zb-ai__modes" role="tablist" aria-label={tt('Assistant mode', 'وضع المساعد')}>
          {modes.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={`zb-ai__mode${mode === m ? ' is-on' : ''}`} onClick={() => onMode(m)} disabled={streaming}>{modeName(m)}</button>
          ))}
        </div>
      )}
      <p className="zb-ai__hint" dir="auto">{modeHint}</p>

      <div className="zb-ai__body" ref={bodyRef} onScroll={onScroll}>
        {streaming && !text && <div className="zb-ai__wait"><span className="zb-ai__dots" aria-hidden="true"><i /><i /><i /></span>{tt('Reading your code and the error…', 'بقرأ الكود والخطأ…')}</div>}
        {text && <Answer text={text} tt={tt} streaming={streaming} onNewFile={(action === 'convert' || action === 'test') ? onNewFile : undefined} />}
        {streaming && text && <span className="zb-ai__cursor" aria-hidden="true" />}

        {edits.length > 0 && (
          <div className="zb-ai__edits">
            <div className="zb-ai__edits-head">
              <strong>{tt('Suggested change', 'التعديل المقترح')}{edits.length > 1 ? ` (${edits.length})` : ''}</strong>
              {pending.length > 1 && <button type="button" className="zb-btn zb-btn--primary" onClick={onApplyAll}><Icon name="check" size={14} /> <span>{tt('Apply all', 'تطبيق الكل')}</span></button>}
            </div>
            {edits.map((e) => (
              <div key={e.id} className={`zb-ai__edit is-${e.state}`}>
                <Diff edit={e} tt={tt} />
                <div className="zb-ai__edit-acts">
                  {e.state === 'pending' && (
                    <>
                      <button type="button" className="zb-btn zb-btn--primary" onClick={() => onApply(e.id)}><Icon name="check" size={14} /> <span>{tt('Apply', 'تطبيق')}</span></button>
                      <button type="button" className="zb-btn" onClick={() => onReject(e.id)}><Icon name="x" size={14} /> <span>{tt('Reject', 'رفض')}</span></button>
                    </>
                  )}
                  {e.state === 'applied' && <span className="zb-ai__tag is-ok"><Icon name="check" size={13} /> {tt('Applied — Ctrl+S to keep it', 'اتطبّق — Ctrl+S عشان تحفظه')}</span>}
                  {e.state === 'rejected' && <span className="zb-ai__tag">{tt('Rejected', 'مرفوض')}</span>}
                  {e.state === 'stale' && <span className="zb-ai__tag is-warn">{tt('The code changed since the suggestion — ask again.', 'الكود اتغيّر بعد الاقتراح — اسأل تاني.')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {phase === 'error' && (
          <div className="zb-ai__error" role="alert">
            <span>{error}</span>
            <button type="button" className="zb-btn" onClick={onRetry}><Icon name="refresh" size={14} /> <span>{tt('Try again', 'حاول تاني')}</span></button>
          </div>
        )}
      </div>

      <footer className="zb-ai__foot">
        <small>{tt('AI can make mistakes — check the answer before relying on it.', 'الذكاء الاصطناعي ممكن يغلط — راجع الإجابة قبل ما تعتمد عليها.')}</small>
        {(phase === 'done' || phase === 'error') && <button type="button" className="zb-ibtn" onClick={onRetry} title={tt('Ask again', 'اسأل تاني')} aria-label={tt('Ask again', 'اسأل تاني')}><Icon name="refresh" size={14} /></button>}
      </footer>
    </aside>
  );
}
