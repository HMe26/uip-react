import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

/**
 * تحليل جودة الأسئلة (Item Analysis).
 *  mode="exam" → GET exam-system/exams/{id}/question-quality     (امتحان واحد)
 *  mode="bank" → GET exam-system/question-banks/{id}/question-quality (البنك كله، مجمّع عبر الامتحانات)
 * الحسابات كلها في الباك (ExamQuestionQualityService)؛ هنا عرض بس.
 */
const S = {
  en: {
    title: 'Question quality', loading: 'Loading…', none: 'No question has graded answers yet.',
    intro: 'Difficulty = share of marks students earned (low = hard). Discrimination = how much better the top 27% did than the bottom 27% (higher = better; negative = likely a wrong key or a misleading question).',
    minNote: (n) => `Discrimination needs at least ${n} graded answers per question.`,
    question: 'Question', answered: 'Answers', difficulty: 'Difficulty', discrimination: 'Discrimination', verdict: 'Verdict',
    all: 'All', attention: 'Needs attention', show: 'Show', details: 'Option analysis',
    option: 'Option', chosen: 'Chosen', top: 'Top 27%', bottom: 'Bottom 27%', correct: 'correct',
    good: 'Good', review: 'Review', revise: 'Revise', insufficient: 'Not enough data',
    good_c: 'Good', excellent: 'Excellent', acceptable: 'Acceptable', poor: 'Poor', negative: 'Negative',
    very_hard: 'Very hard', hard: 'Hard', easy: 'Easy', very_easy: 'Very easy',
    f: {
      too_hard: 'Almost nobody answers it correctly — check the wording/key or whether it was taught.',
      too_easy: 'Almost everybody answers it correctly — it does not separate students.',
      low_discrimination: 'Strong and weak students do about equally well on it.',
      negative_discrimination: 'Weak students did better than strong ones — check the correct answer.',
      weak_distractor: 'A wrong option is chosen by almost nobody — replace it with a more plausible one.',
      low_sample: 'Too few answers to judge.', no_data: 'Never answered in a graded attempt.',
    },
    examsCount: 'Exams', summary: (s) => `${s.good} good · ${s.review} to review · ${s.revise} to revise · ${s.insufficient} not enough data`,
  },
  ar: {
    title: 'جودة الأسئلة', loading: 'جاري التحميل…', none: 'لا يوجد سؤال له إجابات مُصححة بعد.',
    intro: 'الصعوبة = نسبة الدرجات اللي الطلاب خدوها (كل ما قلّت السؤال أصعب). قدرة التمييز = الفرق بين أداء أعلى 27% وأدنى 27% (كل ما زادت أحسن؛ السالبة غالبًا مفتاح إجابة غلط أو سؤال مضلل).',
    minNote: (n) => `قدرة التمييز محتاجة ${n} إجابات مُصححة على الأقل لكل سؤال.`,
    question: 'السؤال', answered: 'الإجابات', difficulty: 'الصعوبة', discrimination: 'قدرة التمييز', verdict: 'التقييم',
    all: 'الكل', attention: 'يحتاج مراجعة', show: 'عرض', details: 'تحليل الاختيارات',
    option: 'الاختيار', chosen: 'اختاروه', top: 'أعلى 27%', bottom: 'أدنى 27%', correct: 'صحيح',
    good: 'جيد', review: 'راجعه', revise: 'عدّله', insufficient: 'بيانات غير كافية',
    good_c: 'جيدة', excellent: 'ممتازة', acceptable: 'مقبولة', poor: 'ضعيفة', negative: 'سالبة',
    very_hard: 'صعب جدًا', hard: 'صعب', easy: 'سهل', very_easy: 'سهل جدًا',
    f: {
      too_hard: 'تقريبًا محدش بيجاوبه صح — راجع الصياغة/المفتاح أو هل اتشرحت المادة دي.',
      too_easy: 'تقريبًا الكل بيجاوبه صح — مبيفرّقش بين الطلاب.',
      low_discrimination: 'الطالب القوي والضعيف أداؤهم قريب فيه.',
      negative_discrimination: 'الضعاف جاوبوه أحسن من الأقوياء — راجع الإجابة الصحيحة.',
      weak_distractor: 'اختيار غلط محدش بيختاره تقريبًا — استبدله باختيار أقرب للإقناع.',
      low_sample: 'إجابات قليلة مينفعش نحكم بيها.', no_data: 'عمره ما اتجاوب في محاولة مُصححة.',
    },
    examsCount: 'الامتحانات', summary: (s) => `${s.good} جيد · ${s.review} للمراجعة · ${s.revise} للتعديل · ${s.insufficient} بيانات غير كافية`,
  },
};

const VERDICT_BADGE = { good: 'badge-success', review: 'badge-warning', revise: 'badge-danger', insufficient: '' };
const num = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));

export default function QuestionQualityPanel({ mode, id }) {
  const { locale } = useLanguage();
  const t = locale === 'ar' ? S.ar : S.en;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [open, setOpen] = useState(null);

  const url = mode === 'bank'
    ? `/api/v1/exam-system/question-banks/${id}/question-quality`
    : `/api/v1/exam-system/exams/${id}/question-quality`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.get(url).then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [url]);

  const items = useMemo(() => {
    if (!data) return [];
    const rank = { revise: 0, review: 1, good: 2, insufficient: 3 };
    const list = onlyIssues ? data.items.filter((i) => i.verdict === 'revise' || i.verdict === 'review') : data.items;
    return [...list].sort((a, b) => rank[a.verdict] - rank[b.verdict]);
  }, [data, onlyIssues]);

  const rowKey = (i) => (mode === 'bank' ? i.question_id : i.exam_question_id);

  return (
    <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="text-h3" style={{ margin: 0 }}>{t.title}</h2>
        {data && (
          <label className="text-small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> {t.attention}
          </label>
        )}
      </div>
      <p className="text-small" style={{ margin: 0 }}>{t.intro} {data && t.minNote(data.min_for_discrimination)}</p>
      {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
      {!data && !error && <p className="text-small">{t.loading}</p>}
      {data && (
        <>
          <p className="text-small" style={{ margin: 0 }}><strong>{t.summary(data.summary)}</strong></p>
          {data.items.every((i) => i.sample_size === 0) ? <p className="text-small">{t.none}</p> : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.question}</th><th>{t.answered}</th>
                    {mode === 'bank' && <th>{t.examsCount}</th>}
                    <th>{t.difficulty}</th><th>{t.discrimination}</th><th>{t.verdict}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const k = rowKey(i);
                    const expandable = i.options && i.options.length > 0 && i.sample_size > 0;
                    const discKey = i.discrimination_label === 'good' ? 'good_c' : i.discrimination_label;
                    return (
                      <Fragment key={k}>
                        <tr>
                          <td style={{ maxWidth: 340 }}>
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.prompt}</span>
                            {i.flags.length > 0 && (
                              <ul className="text-caption" style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
                                {i.flags.map((f) => <li key={f}>{t.f[f]}</li>)}
                              </ul>
                            )}
                            {expandable && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(open === k ? null : k)}>
                                {t.details} {open === k ? '▴' : '▾'}
                              </button>
                            )}
                          </td>
                          <td>{i.sample_size}</td>
                          {mode === 'bank' && <td>{i.exams_count}</td>}
                          <td>{num(i.difficulty)}{i.difficulty_label && <small style={{ display: 'block' }}>{t[i.difficulty_label] || ''}</small>}</td>
                          <td>{num(i.discrimination)}{discKey && <small style={{ display: 'block' }}>{t[discKey]}</small>}</td>
                          <td><span className={`badge ${VERDICT_BADGE[i.verdict]}`}>{t[i.verdict]}</span></td>
                        </tr>
                        {expandable && open === k && (
                          <tr>
                            <td colSpan={mode === 'bank' ? 6 : 5}>
                              <table className="data-table">
                                <thead><tr><th>{t.option}</th><th>{t.chosen}</th><th>{t.top}</th><th>{t.bottom}</th></tr></thead>
                                <tbody>
                                  {i.options.map((o) => (
                                    <tr key={o.id}>
                                      <td>{o.text}{o.is_correct && <span className="badge badge-success" style={{ marginInlineStart: 6 }}>{t.correct}</span>}</td>
                                      <td>{o.selected_pct ?? '—'}%</td>
                                      <td>{o.upper_pct ?? '—'}{o.upper_pct != null && '%'}</td>
                                      <td>{o.lower_pct ?? '—'}{o.lower_pct != null && '%'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
