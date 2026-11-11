import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';

const translations = { ...i18nCommon, ...i18nExam };
const STATUS_CLS = { pending: 'badge-warning', confirmed: 'badge-danger', dismissed: 'badge-neutral' };

/**
 * كشف التشابه بين إجابات المقالي — GET/POST /api/v1/exam-system/exams/{id}/similarity[/analyze],
 * PATCH .../similarity/{flagId}. إشارات للمراجعة البشرية فقط: مفيش أي إجراء تلقائي على الطالب أو الدرجة.
 */
export default function AcademicStaffExamSimilarity() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [threshold, setThreshold] = useState(60);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/v1/exam-system/exams/${id}/similarity`, filter ? { status: filter } : undefined)
      .then((json) => { setData(json.data); setError(null); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id, filter]);

  useEffect(() => { load(); }, [load]);

  const analyze = () => {
    setBusy(true); setError(null); setNotice(null);
    api.post(`/api/v1/exam-system/exams/${id}/similarity/analyze`, { threshold: Number(threshold) })
      .then((json) => {
        const d = json.data;
        setNotice(`${t('Analysis finished')}: ${d.flags_found} ${t('similar pairs found')}.${d.truncated_questions?.length ? ` ${t('Some questions had too many answers; only the first 300 were compared.')}` : ''}`);
        load();
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const review = (flagId, status) => {
    setBusy(true); setError(null);
    api.patch(`/api/v1/exam-system/exams/${id}/similarity/${flagId}`, { status, note: notes[flagId] || null })
      .then(() => load())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const counts = data?.counts || {};
  const flags = data?.flags || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to={`/academic-staff/exams/${id}/attempts`} className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Attempts')}
        </Link>
      </div>
      <div>
        <h1 className="text-h2" style={{ margin: 0 }}>{t('Answer Similarity')}</h1>
        <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>
          {t('Compares short-answer and essay responses between different students. Flags are hints for your review only — nothing is applied to a student automatically.')}
        </p>
      </div>

      <div className="card glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Minimum similarity (%)')}</label>
          <input className="form-input" type="number" min="30" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ width: 120 }} />
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={analyze}>
          <Icon name="refresh" size={14} /> {busy ? t('Analyzing…') : t('Run analysis')}
        </button>
        <span className="text-small">{t('Answers under 20 words are skipped.')}</span>
      </div>

      {notice && <p className="text-small">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {[['pending', 'Pending'], ['confirmed', 'Confirmed'], ['dismissed', 'Dismissed'], ['', 'All']].map(([k, label]) => (
          <button key={k || 'all'} type="button" className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(k)}>
            {t(label)}{k ? ` (${counts[k] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {loading ? <p className="text-small">{t('Loading…')}</p> : flags.length === 0 ? (
        <div className="card glass-panel empty-state"><p>{t('No similar answers found.')}</p></div>
      ) : flags.map((f) => (
        <div key={f.id} className="card glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <strong>{f.question_prompt}</strong>
            <span>
              <span className={`badge ${STATUS_CLS[f.status] || 'badge-neutral'}`}>{t(f.status)}</span>{' '}
              <strong>{f.similarity}%</strong> · {f.matched_words} {t('matching words')}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
            {[f.a, f.b].map((side) => (
              <div key={side.attempt_id}>
                <div className="text-small" style={{ marginBottom: 4 }}>
                  <Link to={`/academic-staff/exams/${id}/attempts/${side.attempt_id}`}>{side.student_name}</Link> · {side.student_number}
                </div>
                <div className="form-input" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', height: 'auto' }}>{side.answer}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="form-input" style={{ flex: 1, minWidth: 200 }} placeholder={t('Note (optional)')} maxLength={2000}
              value={notes[f.id] ?? f.review_note ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))} />
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || f.status === 'confirmed'} onClick={() => review(f.id, 'confirmed')}>{t('Confirm suspicion')}</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || f.status === 'dismissed'} onClick={() => review(f.id, 'dismissed')}>{t('Dismiss')}</button>
            {f.status !== 'pending' && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => review(f.id, 'pending')}>{t('Reopen')}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
