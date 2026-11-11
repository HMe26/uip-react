import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';

const translations = { ...i18nCommon, ...i18nExam };
const STATUS_CLS = { pending: 'badge-warning', accepted: 'badge-success', rejected: 'badge-danger', withdrawn: 'badge-neutral' };

/**
 * تظلمات الطلاب على درجات الامتحان — GET /exams/{id}/appeals, POST .../appeals/{appealId}/resolve,
 * PUT .../appeal-settings. قبول تظلم على سؤال + درجة جديدة بيحدّث الدرجة (ويتسجل في تاريخ الدرجات).
 */
export default function AcademicStaffExamAppeals() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({});
  const [settings, setSettings] = useState({ appeals_enabled: true, appeal_window_days: 7 });

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/v1/exam-system/exams/${id}/appeals`, filter ? { status: filter } : undefined)
      .then((json) => { setData(json.data); setSettings(json.data.settings); setError(null); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id, filter]);

  useEffect(() => { load(); }, [load]);

  const setField = (appealId, patch) => setForm((f) => ({ ...f, [appealId]: { ...(f[appealId] || {}), ...patch } }));

  const resolve = (appeal, decision) => {
    const f = form[appeal.id] || {};
    const body = { decision, response: f.response || null };
    if (decision === 'accepted' && appeal.exam_question_id && f.new_marks !== undefined && f.new_marks !== '') body.new_marks = Number(f.new_marks);
    setBusy(true); setError(null);
    api.post(`/api/v1/exam-system/exams/${id}/appeals/${appeal.id}/resolve`, body)
      .then(() => load())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const saveSettings = () => {
    setBusy(true); setError(null);
    api.put(`/api/v1/exam-system/exams/${id}/appeal-settings`, { appeals_enabled: !!settings.appeals_enabled, appeal_window_days: Number(settings.appeal_window_days) })
      .then(() => load())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const counts = data?.counts || {};
  const appeals = data?.appeals || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to={`/academic-staff/exams/${id}/attempts`} className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Attempts')}
        </Link>
      </div>
      <div>
        <h1 className="text-h2" style={{ margin: 0 }}>{t('Grade Appeals')}</h1>
        <p className="text-caption" style={{ margin: 'var(--space-1) 0 0' }}>{t('Review students’ requests to re-check their grades and reply to each one.')}</p>
      </div>

      <div className="card glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="form-label" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
          <input type="checkbox" checked={!!settings.appeals_enabled} onChange={(e) => setSettings((s) => ({ ...s, appeals_enabled: e.target.checked }))} />
          {t('Allow students to appeal grades')}
        </label>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Appeal window (days after results)')}</label>
          <input className="form-input" type="number" min="1" max="90" style={{ width: 120 }} value={settings.appeal_window_days}
            onChange={(e) => setSettings((s) => ({ ...s, appeal_window_days: e.target.value }))} />
        </div>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={saveSettings}>{t('Save settings')}</button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {[['pending', 'Pending'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'], ['', 'All']].map(([k, label]) => (
          <button key={k || 'all'} type="button" className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(k)}>
            {t(label)}{k ? ` (${counts[k] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {loading ? <p className="text-small">{t('Loading…')}</p> : appeals.length === 0 ? (
        <div className="card glass-panel empty-state"><p>{t('No appeals.')}</p></div>
      ) : appeals.map((a) => {
        const f = form[a.id] || {};
        return (
          <div key={a.id} className="card glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <Link to={`/academic-staff/exams/${id}/attempts/${a.attempt_id}`}><strong>{a.student_name}</strong></Link> · {a.student_number}
                <div className="text-small">
                  {a.exam_question_id ? `${t('Question')}: ${a.question_prompt}` : `${t('Overall score')}: ${a.attempt_score ?? '—'} (${a.attempt_percentage ?? '—'}%)`}
                </div>
              </div>
              <span className={`badge ${STATUS_CLS[a.status] || 'badge-neutral'}`}>{t(a.status)}</span>
            </div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.reason}</p>
            {a.status === 'pending' ? (
              <>
                <textarea className="form-input" rows={2} maxLength={2000} placeholder={t('Your reply to the student')} value={f.response || ''}
                  onChange={(e) => setField(a.id, { response: e.target.value })} style={{ height: 'auto' }} />
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  {a.exam_question_id && (
                    <input className="form-input" type="number" min="0" max={a.question_max_marks ?? undefined} step="0.25" style={{ width: 170 }}
                      placeholder={`${t('New marks')} (0–${a.question_max_marks})`} value={f.new_marks ?? ''} onChange={(e) => setField(a.id, { new_marks: e.target.value })} />
                  )}
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => resolve(a, 'accepted')}>{t('Accept')}</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => resolve(a, 'rejected')}>{t('Reject')}</button>
                </div>
                {!a.exam_question_id && <p className="text-small" style={{ margin: 0 }}>{t('For an overall appeal, adjust the question grades from the attempt page, then accept here.')}</p>}
              </>
            ) : (
              <>
                {a.response && <p className="text-small" style={{ margin: 0 }}><strong>{t('Reply')}:</strong> {a.response}</p>}
                {a.score_before != null && <p className="text-small" style={{ margin: 0 }}>{t('Marks')}: {a.score_before} → {a.score_after}</p>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
