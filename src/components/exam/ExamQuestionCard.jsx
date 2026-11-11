import Icon from '../Icon';
import QuestionImage from './QuestionImage';
import { fmtNum, questionTypeLabel } from './examUi';
import { MarksInput } from './MarksEditors';

/**
 * One question in the exam builder / exam detail (design: "Q1 · MULTIPLE CHOICE · 2 Points").
 * `q` is an item of GET exam-system/exams/{id} → questions[]: { type, prompt, marks,
 * options: [{ option_text, is_correct }] }. `tools` (optional) renders reorder/remove buttons.
 */
export default function ExamQuestionCard({ q, index, ar, tools }) {
  const options = q.options || [];
  const isChoice = ['mcq', 'multi_select'].includes(q.type);
  const isTF = q.type === 'true_false';
  const pts = fmtNum(q.marks, 2);

  return (
    <div className="ex-q">
      <div className="ex-q__top">
        {tools?.onSelect && (
          <input
            type="checkbox"
            className="ex-check-input"
            checked={!!tools.selected}
            onChange={tools.onSelect}
            aria-label={ar ? 'تحديد السؤال' : 'Select question'}
          />
        )}
        <span className="ex-q__no">Q{index + 1}</span>
        <span className="ex-q__type">{questionTypeLabel(q.type, ar)}</span>
        <span>·</span>
        {tools?.onMarks
          ? <MarksInput value={q.marks} ar={ar} onCommit={tools.onMarks} />
          : <span>{pts} {ar ? (Number(q.marks) === 1 ? 'درجة' : 'درجات') : (Number(q.marks) === 1 ? 'Point' : 'Points')}</span>}
        {tools && (
          <span className="ex-q__tools">
            {tools.onImage && (
              <button
                type="button"
                className="ex-icon-btn"
                disabled={tools.imageBusy}
                onClick={tools.onImage}
                title={q.image_url ? (ar ? 'تغيير الصورة' : 'Change image') : (ar ? 'إضافة صورة' : 'Add image')}
                aria-label={q.image_url ? (ar ? 'تغيير الصورة' : 'Change image') : (ar ? 'إضافة صورة' : 'Add image')}
              ><Icon name="image" size={15} /></button>
            )}
            {tools.onEdit && (
              <button type="button" className="ex-icon-btn" onClick={tools.onEdit} title={ar ? 'تعديل السؤال' : 'Edit question'} aria-label={ar ? 'تعديل السؤال' : 'Edit question'}><Icon name="edit" size={15} /></button>
            )}
            <button type="button" className="ex-icon-btn" disabled={!tools.canUp} onClick={tools.onUp} aria-label={ar ? 'نقل لأعلى' : 'Move up'}><Icon name="arrow-up" size={15} /></button>
            <button type="button" className="ex-icon-btn" disabled={!tools.canDown} onClick={tools.onDown} aria-label={ar ? 'نقل لأسفل' : 'Move down'}><Icon name="arrow-down" size={15} /></button>
            <button type="button" className="ex-icon-btn ex-icon-btn--danger" onClick={tools.onRemove} aria-label={ar ? 'إزالة' : 'Remove'}><Icon name="trash" size={15} /></button>
          </span>
        )}
      </div>

      <p className="ex-q__prompt">{q.prompt}</p>
      <QuestionImage url={q.image_url} />

      {isChoice && (
        <div className="ex-opts">
          {options.map((o, i) => (
            <div key={o.id ?? i} className={`ex-opt${o.is_correct ? ' is-correct' : ''}`}>
              <span className="ex-opt__dot">{o.is_correct && <Icon name="check" size={11} />}</span>
              <span>{o.option_text}</span>
              {o.is_correct && <em>{ar ? 'الإجابة الصحيحة' : 'Correct answer'}</em>}
            </div>
          ))}
        </div>
      )}

      {isTF && (
        <div className="ex-tf">
          {options.map((o, i) => (
            <span key={i} className={o.is_correct ? 'is-correct' : ''}>
              {o.option_text === 'True' ? (ar ? 'صح' : 'True') : (ar ? 'خطأ' : 'False')}
            </span>
          ))}
        </div>
      )}

      {!isChoice && !isTF && (
        <div className="ex-ghost">
          {q.type === 'essay'
            ? (ar ? 'سيكتب الطلاب إجابة مقالية. تُصحَّح يدويًا.' : 'Students will write an essay answer. Graded manually.')
            : (ar ? 'سيكتب الطلاب إجابة قصيرة.' : 'Students will provide a typed answer for this question.')}
        </div>
      )}
    </div>
  );
}
