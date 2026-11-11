import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { Alert } from './umUi';
import { MemberAdjustments, LockBar, GradeRevisions, membersPayload, membersToValue } from '../GradeLockAndMembers';

const BLANK = { criterion: '', max_score: '', score: '', comments: '' };

/**
 * University / Faculty grading: same rules as the supervisor (locked once finalized; reopen needs a written
 * reason; per-member adjustments). POST /api/v1/{scope}/approvals/{id}/grade and .../grade/reopen.
 * `grade` = review.grade (current official grade or null), `detail` = data.grade_detail.
 */
export default function ReviewerGradePanel({ scope, id, grade, detail, ar, onChanged }) {
  const [criteria, setCriteria] = useState([{ ...BLANK }]);
  const [overall, setOverall] = useState('');
  const [memberAdj, setMemberAdj] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  useEffect(() => {
    setCriteria(detail.criteria?.length ? detail.criteria.map((r) => ({ criterion: r.criterion || '', max_score: r.max_score ?? '', score: r.score ?? '', comments: r.comments || '' })) : [{ ...BLANK }]);
    setOverall(grade?.overall_comments || '');
    setMemberAdj(membersToValue(detail.members));
  }, [detail, grade]);

  const locked = !!detail.locked;
  const base = `/api/v1/${scope}/approvals/${encodeURIComponent(id)}/grade`;
  const upd = (i, f, v) => setCriteria((rs) => rs.map((r, k) => (k === i ? { ...r, [f]: v } : r)));
  const mx = criteria.reduce((a, r) => a + (Number(r.max_score) || 0), 0);
  const sc = criteria.reduce((a, r) => a + (Number(r.score) || 0), 0);
  const pct = mx > 0 && criteria.some((r) => r.score !== '' && r.score != null) ? (sc / mx) * 100 : null;

  async function save(finalize) {
    if (finalize && !window.confirm(ar ? 'اعتماد الدرجة النهائية؟ سيتم إخطار الفريق وتتقفل الدرجة.' : 'Finalize this grade? The team will be notified and the grade will be locked.')) return;
    setBusy(true); setError(null); setOk(null);
    try {
      const j = await api.post(base, { criteria, overall_comments: overall, finalize: finalize ? 1 : 0, members: membersPayload(memberAdj) });
      setOk(j.message); onChanged?.();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function reopen(reason) {
    setBusy(true); setError(null); setOk(null);
    try {
      const j = await api.post(`${base}/reopen`, { reason });
      setOk(j.message); onChanged?.();
      return true;
    } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  }

  return (
    <section className="um-panel">
      <div className="um-panel__head"><h2>{ar ? 'تقييم المشروع (رسمي)' : 'Project Grading (official)'}</h2></div>
      {error && <Alert>{error}</Alert>}
      {ok && <Alert tone="ok">{ok}</Alert>}
      {locked && <LockBar ar={ar} busy={busy} onReopen={reopen} />}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {criteria.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input className="form-input" placeholder={ar ? 'المعيار' : 'Criterion'} value={r.criterion} onChange={(e) => upd(i, 'criterion', e.target.value)} />
            <input className="form-input" type="number" step="0.5" min="0.5" placeholder={ar ? 'الدرجة العظمى' : 'Max'} value={r.max_score} onChange={(e) => upd(i, 'max_score', e.target.value)} />
            <input className="form-input" type="number" step="0.5" min="0" placeholder={ar ? 'الدرجة' : 'Score'} value={r.score} onChange={(e) => upd(i, 'score', e.target.value)} />
            <input className="form-input" placeholder={ar ? 'ملاحظة' : 'Note'} value={r.comments} onChange={(e) => upd(i, 'comments', e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={criteria.length <= 1} onClick={() => setCriteria((rs) => rs.filter((_, k) => k !== i))}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setCriteria((rs) => [...rs, { ...BLANK }])}><Icon name="plus" size={14} /> {ar ? 'إضافة معيار' : 'Add criterion'}</button>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label className="form-label">{ar ? 'ملاحظات عامة' : 'Overall comments'}</label>
          <textarea className="form-input" rows={3} value={overall} onChange={(e) => setOverall(e.target.value)} />
        </div>
        <MemberAdjustments candidates={detail.candidates || []} value={memberAdj} onChange={setMemberAdj} projectPct={pct} ar={ar} disabled={locked} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(false)}>{ar ? 'حفظ كمسودة' : 'Save as draft'}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{ar ? 'اعتماد الدرجة' : 'Finalize grade'}</button>
        </div>
      </fieldset>
      <GradeRevisions revisions={detail.revisions} ar={ar} />
    </section>
  );
}
