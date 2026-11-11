import Icon from '../Icon';
import QuestionImage from './QuestionImage';
import { fmtNum, questionTypeLabel } from './examUi';

const DIFFICULTY = {
  easy: { en: 'Easy', ar: 'سهل' },
  medium: { en: 'Medium', ar: 'متوسط' },
  hard: { en: 'Hard', ar: 'صعب' },
};

const LETTERS_AR = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
const letter = (i, ar) => (ar ? LETTERS_AR[i] || String(i + 1) : String.fromCharCode(65 + i));

/**
 * One question in the doctor's question bank — a readable card instead of a
 * truncated table row. Shows the full prompt, the options (correct one marked)
 * and the actions. Styles: styles/css/question-bank.css (`qb-*`).
 */
export default function QuestionBankCard({ q, index, ar, onEdit, onDelete, onRubric, canRubric }) {
  const options = q.options || [];
  const isChoice = ['mcq', 'multi_select'].includes(q.type);
  const isTF = q.type === 'true_false';
  const diff = DIFFICULTY[q.difficulty];
  const marks = Number(q.marks);
  const modelAnswer = q.model_answer || (q.type === 'short_answer' ? q.correct_answer : '');

  return (
    <article className="qb-card">
      <header className="qb-card__head">
        <span className="qb-card__no">{index + 1}</span>
        <span className="qb-chip qb-chip--type">{questionTypeLabel(q.type, ar)}</span>
        {diff && <span className={`qb-chip qb-chip--${q.difficulty}`}>{ar ? diff.ar : diff.en}</span>}
        <span className="qb-card__marks">
          <bdi>{fmtNum(q.marks, 2)}</bdi> {ar ? (marks === 1 ? 'درجة' : 'درجات') : (marks === 1 ? 'mark' : 'marks')}
        </span>
        <span className="qb-card__actions">
          {canRubric && (
            <button type="button" className="qb-icon-btn" onClick={onRubric} title={ar ? 'معيار التصحيح' : 'Rubric'} aria-label={ar ? 'معيار التصحيح' : 'Rubric'}>
              <Icon name="layers" size={17} />
            </button>
          )}
          <button type="button" className="qb-icon-btn" onClick={onEdit} title={ar ? 'تعديل' : 'Edit'} aria-label={ar ? 'تعديل' : 'Edit'}>
            <Icon name="edit" size={17} />
          </button>
          <button type="button" className="qb-icon-btn qb-icon-btn--danger" onClick={onDelete} title={ar ? 'حذف' : 'Delete'} aria-label={ar ? 'حذف' : 'Delete'}>
            <Icon name="trash" size={17} />
          </button>
        </span>
      </header>

      <p className="qb-card__prompt">{q.prompt}</p>
      <QuestionImage url={q.image_url} maxHeight={240} />

      {isChoice && (
        <ul className="qb-opts">
          {options.map((o, i) => (
            <li key={o.id ?? i} className={`qb-opt${o.is_correct ? ' is-correct' : ''}`}>
              <span className="qb-opt__key">{o.is_correct ? <Icon name="check" size={14} /> : letter(i, ar)}</span>
              <span className="qb-opt__text">{o.option_text}</span>
            </li>
          ))}
        </ul>
      )}

      {isTF && (
        <ul className="qb-opts qb-opts--tf">
          {options.map((o, i) => (
            <li key={i} className={`qb-opt${o.is_correct ? ' is-correct' : ''}`}>
              <span className="qb-opt__key">{o.is_correct ? <Icon name="check" size={14} /> : (o.option_text === 'True' ? '✓' : '✕')}</span>
              <span className="qb-opt__text">{o.option_text === 'True' ? (ar ? 'صح' : 'True') : (ar ? 'خطأ' : 'False')}</span>
            </li>
          ))}
        </ul>
      )}

      {!isChoice && !isTF && (
        <div className="qb-note">
          {modelAnswer ? (
            <>
              <strong>{ar ? 'الإجابة النموذجية' : 'Model answer'}</strong>
              <span>{modelAnswer}</span>
            </>
          ) : (
            <span>{q.type === 'essay' ? (ar ? 'سؤال مقالي — يُصحَّح يدويًا أو بالذكاء الاصطناعي.' : 'Essay question — graded manually or by AI.') : (ar ? 'سؤال إجابة قصيرة.' : 'Short-answer question.')}</span>
          )}
        </div>
      )}
    </article>
  );
}
