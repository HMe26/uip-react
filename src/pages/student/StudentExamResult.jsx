import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import QuestionImage from '../../components/exam/QuestionImage';
import { useLanguage } from '../../context/LanguageContext';
import { Skeleton } from '../../components/student/stUi';
import { ExKpi, Note, fmtNum, ringStyle } from '../../components/exam/examUi';
import AppealPanel from '../../components/exam/AppealPanel';

/**
 * GET /api/v1/exam-system/attempts/{id}/result. `visible=false` → submitted but the
 * exam's result_visibility hasn't opened yet (expected, not an error). `review_allowed`
 * =false (score-only exams / answer review off) → the grade without the question breakdown.
 */
export default function StudentExamResult() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/exam-system/attempts/${id}/result`)
      .then((json) => { if (!cancelled) setResult(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="ex-page"><Skeleton h={100} count={3} /></div>;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!result) return null;

  const back = (
    <Link to="/student/my-exams" className="ex-back"><Icon name="chevron-left" size={14} className="icon-flip" /> {ar ? 'العودة إلى الامتحانات' : 'Back to Exams'}</Link>
  );

  if (!result.visible) {
    return (
      <div className="ex-page ex-page--narrow">
        {back}
        <div className="ex-card ex-card__pad" style={{ textAlign: 'center' }}>
          <Icon name="clock" size={32} />
          <h2 style={{ margin: '12px 0 4px' }}>{ar ? 'نتيجتك غير متاحة بعد' : 'Your result is not available yet'}</h2>
          <p className="ex-card__sub">{ar ? 'سينشر أستاذك النتائج وفق إعداد ظهور النتيجة لهذا الامتحان.' : "Your instructor will publish results according to this exam's result visibility setting."}</p>
        </div>
      </div>
    );
  }

  const pct = result.percentage;
  const passed = result.passing_score != null && result.score != null ? result.score >= result.passing_score : null;
  const questions = result.questions || [];
  const answerText = (q) => {
    if (q.my_answer?.answer_text) return q.my_answer.answer_text;
    if (q.my_answer?.selected_option_ids?.length) {
      return (q.options || []).filter((o) => q.my_answer.selected_option_ids.includes(o.id)).map((o) => o.option_text).join(', ');
    }
    return ar ? 'لم تُرسل إجابة' : 'No answer submitted';
  };

  return (
    <div className="ex-page ex-page--narrow">
      <div>
        {back}
        <div className="ex-detail-head"><div><h1>{ar ? 'نتيجتك' : 'Your Result'}</h1></div></div>
      </div>

      <div className="ex-card">
        <div className="ex-donut">
          <div className="ex-donut__ring" style={ringStyle([{ value: pct || 0, color: passed === false ? 'var(--color-danger)' : 'var(--color-success)' }, { value: 100 - (pct || 0), color: 'var(--bg-muted)' }])}>
            <b>{pct != null ? `${fmtNum(pct)}%` : '—'}</b>
          </div>
          <div className="ex-legend">
            <span><b>{fmtNum(result.score)}</b>&nbsp;/ {fmtNum(result.total_marks)} {ar ? 'درجة' : 'points'}</span>
            {passed != null && (
              <span className={`ex-status ex-status--${passed ? 'graded' : 'failed'}`}>{passed ? (ar ? 'ناجح' : 'Passed') : (ar ? 'راسب' : 'Failed')}</span>
            )}
          </div>
        </div>
      </div>

      {result.is_late && result.late_penalty_percent > 0 && (
        <Note tone="warn" icon="clock">
          {ar
            ? `سُلِّم هذا الامتحان بعد انتهاء الوقت، فخُصم ${fmtNum(result.late_penalty_percent)}% من درجتك${result.score_before_penalty != null ? ` (قبل الخصم: ${fmtNum(result.score_before_penalty)}).` : '.'}`
            : `This exam was submitted after time ended, so ${fmtNum(result.late_penalty_percent)}% was deducted${result.score_before_penalty != null ? ` (before deduction: ${fmtNum(result.score_before_penalty)}).` : '.'}`}
        </Note>
      )}
      {result.status !== 'graded' && <Note tone="warn" icon="clock">{ar ? 'بعض الإجابات لم تُصحَّح بعد، وقد تتغير درجتك.' : 'Some answers are still being graded, so your score may change.'}</Note>}
      {!result.review_allowed && <Note icon="info">{ar ? 'لا يعرض هذا الامتحان مراجعة الإجابات، تظهر الدرجة فقط.' : 'This exam does not show answer review — only your score.'}</Note>}

      {questions.length > 0 && (
        <div className="ex-qlist">
          {questions.map((q, idx) => (
            <div key={q.exam_question_id} className="ex-q">
              <div className="ex-q__top">
                <span className="ex-q__no">{ar ? 'س' : 'Q'}<bdi dir="ltr">{idx + 1}</bdi></span>
                <span>·</span>
                <span><bdi dir="ltr">{fmtNum(q.marks_awarded)} / {fmtNum(q.max_marks)}</bdi> {ar ? 'درجة' : 'pts'}</span>
                <span className="ex-q__tools">
                  {q.is_correct === true && <span className="ex-status ex-status--graded">{ar ? 'صحيحة' : 'Correct'}</span>}
                  {q.is_correct === false && <span className="ex-status ex-status--failed">{ar ? 'خاطئة' : 'Incorrect'}</span>}
                  {q.is_correct == null && <span className="ex-status ex-status--idle">{ar ? 'لم تُصحَّح' : 'Not graded'}</span>}
                </span>
              </div>
              <p className="ex-q__prompt" dir="auto">{q.prompt}</p>
              <QuestionImage url={q.image_url} />
              <div className="ex-ghost" style={{ borderStyle: 'solid' }}><strong>{ar ? 'إجابتك: ' : 'Your answer: '}</strong><bdi dir="auto">{answerText(q)}</bdi></div>
              {q.feedback && <p className="ex-card__sub" style={{ marginTop: 10 }}><strong>{ar ? 'ملاحظات: ' : 'Feedback: '}</strong>{q.feedback}</p>}
            </div>
          ))}
        </div>
      )}

      {result.status === 'graded' && <AppealPanel attemptId={id} questions={questions} />}
    </div>
  );
}
