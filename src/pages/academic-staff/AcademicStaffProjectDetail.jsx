import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import CodeReviewReportPanel from '../../components/CodeReviewReportPanel';
import FileViewer from '../../components/FileViewer';
import { api, errorMessage } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead } from '../../components/staff/stfUi';
import { Pill, StModal, Skeleton } from '../../components/student/stUi';
import { PROJECT_STATUS } from './AcademicStaffProjects';
import ApprovalStages, { STAGE_LABEL } from '../../components/ApprovalStages';
import { MemberAdjustments, LockBar, GradeRevisions, membersPayload, membersToValue } from '../../components/GradeLockAndMembers';

const BLANK = { criterion: '', max_score: '', score: '', comments: '' };
const DECISION = {
  approved: { tone: 'success', en: 'Approved', ar: 'تمت الموافقة' },
  rejected: { tone: 'danger', en: 'Rejected', ar: 'تم الرفض' },
  changes_requested: { tone: 'warning', en: 'Changes requested', ar: 'طُلب تعديل' },
  pending: { tone: 'neutral', en: 'Pending', ar: 'معلّق' },
};
const ROLE = {
  teaching_assistant: { en: 'Teaching Assistant', ar: 'معيد' }, professor: { en: 'Professor', ar: 'أستاذ دكتور' },
  principal_investigator: { en: 'Principal Investigator', ar: 'باحث رئيسي' }, supervisor: { en: 'Supervisor', ar: 'مشرف' },
  student_member: { en: 'Student', ar: 'طالب' }, collaborator: { en: 'Collaborator', ar: 'متعاون' },
  external_collaborator: { en: 'External', ar: 'متعاون خارجي' },
};

/** One project in full + approve / reject / request-changes + grading (official or advisory). */
export default function AcademicStaffProjectDetail() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [viewerId, setViewerId] = useState(null);
  const [dlg, setDlg] = useState(null); // { action, label, required }
  const [comments, setComments] = useState('');
  const [ack, setAck] = useState(false);
  const [criteria, setCriteria] = useState([{ ...BLANK }]);
  const [overall, setOverall] = useState('');
  const [memberAdj, setMemberAdj] = useState({});
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState('');

  const hydrateGrade = useCallback((g, official) => {
    const src = official ? g.official : g.mine_advisory;
    const rows = official ? g.official_criteria : src?.criteria;
    setCriteria(rows && rows.length ? rows.map((r) => ({ criterion: r.criterion || '', max_score: r.max_score ?? '', score: r.score ?? '', comments: r.comments || '' })) : [{ ...BLANK }]);
    setOverall(src?.overall_comments || '');
    setMemberAdj(official ? membersToValue(g.members) : {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}`)
      .then((j) => { setData(j.data); hydrateGrade(j.data.grades, j.data.is_official); })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id, hydrateGrade]);
  const loadNotes = useCallback(() => {
    api.get(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}/discussion`).then((j) => setNotes(j.data || [])).catch(() => setNotes([]));
  }, [id]);
  useEffect(() => { load(); loadNotes(); }, [load, loadNotes]);

  async function sendNote() {
    if (!noteText.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}/discussion`, { message: noteText.trim() });
      setNoteText(''); setMsg(ar ? 'تم إرسال الملاحظة للطالب.' : 'Note sent to the student.'); loadNotes();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  // AI code-assistant mode for this project's students (official supervisor only): '' = default (admin settings) | off | tutor | assistant
  async function saveAiMode(mode) {
    setBusy(true); setError(null);
    try {
      const j = await api.patch(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}/ai-mode`, { mode: mode || 'inherit' });
      setData((d) => ({ ...d, ai_code_mode: j.data?.ai_code_mode ?? null }));
      setMsg(ar ? 'تم حفظ وضع مساعد الذكاء الاصطناعي للمشروع.' : 'AI assistant mode saved for this project.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function decide() {
    setBusy(true); setError(null);
    try {
      const j = await api.post(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}/${dlg.action}`, { comments, ai_acknowledgment: ack ? 1 : 0 });
      setMsg(j.message || (ar ? 'تم' : 'Done')); setDlg(null); setComments(''); setAck(false); load();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function reopenGrade(reason) {
    setBusy(true); setError(null);
    try {
      const j = await api.post(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}/grade/reopen`, { reason });
      setMsg(j.message || (ar ? 'تمت إعادة الفتح' : 'Reopened'));
      setData((d) => ({ ...d, grades: j.data.grades })); hydrateGrade(j.data.grades, true);
      return true;
    } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  }

  async function saveGrade(finalize) {
    if (finalize && data.is_official && !window.confirm(ar ? 'اعتماد الدرجة النهائية؟ سيتم إخطار الطالب.' : 'Finalize this grade? The student will be notified.')) return;
    setBusy(true); setError(null);
    try {
      const j = await api.post(`/api/v1/academic-staff/projects/${encodeURIComponent(id)}/grade`, { criteria, overall_comments: overall, finalize: finalize ? 1 : 0, ...(data.is_official ? { members: membersPayload(memberAdj) } : {}) });
      setMsg(j.message || (ar ? 'تم الحفظ' : 'Saved'));
      setData((d) => ({ ...d, grades: j.data.grades })); hydrateGrade(j.data.grades, data.is_official);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (loading) return <div className="st-page"><Skeleton h={90} count={3} /></div>;
  if (!data) return <div className="st-page"><div className="st-alert st-alert--danger"><span>{error}</span></div></div>;

  const { project: p, files, links, team, history, grades, is_official: official, can_decide: canDecide, requires_ai_ack: needsAck, flow, decide_blocked: blocked } = data;
  const title = ar ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar);
  const sm = PROJECT_STATUS[p.status] || PROJECT_STATUS.draft;
  const canGrade = ['submitted', 'under_review', 'approved', 'published', 'rejected'].includes(p.status);
  const gradeFinal = (official ? grades.official?.status : grades.mine_advisory?.status) === 'final';
  const open = (action, label, required) => { setDlg({ action, label, required }); setComments(''); setAck(false); };
  const upd = (i, f, v) => setCriteria((rs) => rs.map((r, k) => (k === i ? { ...r, [f]: v } : r)));
  const list = (v) => (Array.isArray(v) ? v : []).join(', ') || '—';

  return (
    <div className="st-page">
      <StaffHead
        crumbs={[{ label: ar ? 'مشاريع الطلبة' : "Students' Projects", to: '/academic-staff/projects' }, { label: title }]}
        title={title}
        subtitle={`${ar ? 'الطالب: ' : 'Student: '}${p.owner_name || '—'}`}
        actions={canDecide && (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => open('approve', ar ? 'موافقة' : 'Approve', false)}><Icon name="check" size={14} /> {ar ? 'موافقة' : 'Approve'}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => open('request-changes', ar ? 'طلب تعديل' : 'Request Changes', true)}><Icon name="edit" size={14} /> {ar ? 'طلب تعديل' : 'Request Changes'}</button>
            <button type="button" className="btn btn-outline btn-sm st-btn-danger" onClick={() => open('reject', ar ? 'رفض' : 'Reject', true)}><Icon name="x" size={14} /> {ar ? 'رفض' : 'Reject'}</button>
          </>
        )}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {msg && <div className="st-alert"><Icon name="check-circle" size={16} /><span>{msg}</span></div>}
      {p.status === 'draft' && <div className="st-alert"><Icon name="clock" size={16} /><span>{ar ? 'المشروع مع الطالب كمسودة (لم يُقدَّم بعد أو أُعيد للتعديل) — أزرار القرار والتقييم تظهر بعد التقديم. تقدر تكتب له ملاحظاتك من خانة "ملاحظات للطالب" تحت.' : 'The project is a draft with the student (not submitted yet, or sent back for changes). Decision and grading open once it is submitted. You can still write notes to the student below.'}</span></div>}
      {blocked === 'advisory_role' && <div className="st-alert"><Icon name="info" size={16} /><span>{ar ? 'ربطك بالمشروع استشاري (معيد): تقدر تطّلع وتقيّم استشاريًا وتكتب ملاحظات، لكن الموافقة والرفض وطلب التعديل للدكتور المشرف فقط.' : 'Your link to this project is advisory (teaching assistant): you can view, grade advisorily and leave notes, but only the supervisor doctor can approve, reject or request changes.'}</span></div>}
      {blocked === 'not_your_turn' && <div className="st-alert"><Icon name="clock" size={16} /><span>{ar ? `قرار الدكتور المشرف سُجّل بالفعل في هذه الدورة؛ المشروع الآن بانتظار «${STAGE_LABEL(flow?.awaiting, true)}».` : `Your supervisor decision is already recorded for this round; the project is now awaiting “${STAGE_LABEL(flow?.awaiting, false)}”.`}</span></div>}
      {p.status !== 'draft' && !canDecide && !blocked && <div className="st-alert"><Icon name="clock" size={16} /><span>{ar ? 'القرارات (موافقة / طلب تعديل / رفض) متاحة فقط والمشروع في حالة "تم التقديم" وعندما يحين دور المشرف.' : 'Decisions (approve / request changes / reject) are only available while the project is Submitted and it is the supervisor’s turn.'}</span></div>}

      {flow && (
        <section className="st-panel">
          <h3>{ar ? 'مسار الاعتماد' : 'Approval path'}</h3>
          <ApprovalStages flow={flow} status={p.status} ar={ar} />
        </section>
      )}

      <section className="st-panel">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Pill tone={sm.tone}>{ar ? sm.ar : sm.en}</Pill>
          <Pill tone={official ? 'success' : 'neutral'}>{official ? (ar ? 'تقييمك رسمي' : 'Your grade is official') : (ar ? 'تقييمك استشاري' : 'Your grade is advisory')}</Pill>
          {p.category && <Pill>{p.category}</Pill>}
        </div>
        {p.summary && <p><strong>{ar ? 'الملخص: ' : 'Summary: '}</strong>{p.summary}</p>}
        {p.description && <p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>}
        <div className="st-row"><span>{ar ? 'البريد' : 'Email'}</span><span>{p.owner_email || '—'}</span></div>
        <div className="st-row"><span>{ar ? 'الكلمات المفتاحية' : 'Keywords'}</span><span>{list(p.keywords)}</span></div>
        <div className="st-row"><span>{ar ? 'التقنيات' : 'Technologies'}</span><span>{list(p.technologies)}</span></div>
        <div className="st-row"><span>{ar ? 'أهداف التنمية' : 'SDGs'}</span><span>{list(p.sdgs)}</span></div>
        <div className="st-row"><span>{ar ? 'الجدول الزمني' : 'Timeline'}</span><span>{p.timeline_start || '—'} → {p.timeline_end || '—'}</span></div>
        {p.budget != null && <div className="st-row"><span>{ar ? 'الميزانية' : 'Budget'}</span><span>{p.budget}</span></div>}
      </section>

      <CodeReviewReportPanel projectId={id} className="st-panel" />

      <section className="st-panel">
        <h3>{ar ? 'مساعد الذكاء الاصطناعي في المحرر' : 'AI assistant in the code editor'}</h3>
        <p className="st-muted" style={{ fontSize: 12.5 }}>
          {ar
            ? 'تتحكم في وضع المساعد لطلبة المشروع ده. الوضع اللي تختاره بيغلب إعدادات الإدارة، والطالب مبيقدرش يبدّله.'
            : "Controls the assistant for this project's students. Your choice overrides the platform default and students cannot switch it."}
        </p>
        <select
          className="form-input"
          value={data.ai_code_mode || ''}
          disabled={busy || !data.can_set_ai_mode}
          onChange={(e) => saveAiMode(e.target.value)}
          aria-label={ar ? 'وضع مساعد الذكاء الاصطناعي' : 'AI assistant mode'}
        >
          <option value="">{ar ? 'الافتراضي (إعدادات الإدارة)' : 'Default (platform setting)'}</option>
          <option value="off">{ar ? 'مقفول — بدون مساعد' : 'Off — no AI assistant'}</option>
          <option value="tutor">{ar ? 'مدرّس — يشرح ويلمّح من غير حل جاهز' : 'Tutor — explains and hints, no ready-made fix'}</option>
          <option value="assistant">{ar ? 'مساعد — يدّي حلول وتعديلات' : 'Assistant — gives fixes and edits'}</option>
        </select>
        {!data.can_set_ai_mode && <p className="st-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{ar ? 'الضبط للدكتور المشرف بس (ربطك استشاري).' : 'Only the supervising doctor can change this (your link is advisory).'}</p>}
      </section>

      <section className="st-panel">
        <h3>{ar ? 'الفريق' : 'Team'}</h3>
        {team.length === 0 ? <p className="st-muted">—</p> : team.map((m) => (
          <div className="st-row" key={m.id}><span>{m.display_name}{m.student_number ? ` · ${m.student_number}` : ''}</span><span>{(ROLE[m.role] || { en: m.role, ar: m.role })[locale] || m.role}</span></div>
        ))}
      </section>

      <section className="st-panel">
        <h3>{ar ? 'الملفات والروابط' : 'Files & links'}</h3>
        {files.length === 0 && links.length === 0 && <p className="st-muted">—</p>}
        {files.map((f) => (
          <div className="st-row" key={`f${f.id}`}>
            <span>
              <button type="button" onClick={() => f.url && setViewerId(f.id)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 600 }} title={ar ? 'معاينة' : 'Preview'}>{f.original_name}</button>{' '}
              <small className="st-muted">{f.size_human}{f.uploader_name ? ` · ${ar ? 'رفعه' : 'by'} ${f.uploader_name}` : ''}</small>
            </span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewerId(f.id)} title={ar ? 'معاينة' : 'Preview'} aria-label={ar ? 'معاينة' : 'Preview'}><Icon name="eye" size={16} /></button>
              {f.url && <a className="btn btn-ghost btn-sm" href={f.url} target="_blank" rel="noopener noreferrer" title={ar ? 'فتح في تبويب جديد' : 'Open in a new tab'} aria-label={ar ? 'فتح في تبويب جديد' : 'Open in a new tab'}><Icon name="expand" size={16} /></a>}
            </span>
          </div>
        ))}
        {links.map((l) => (
          <div className="st-row" key={`l${l.id}`}><span>{l.label}</span><a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a></div>
        ))}
      </section>

      <section className="st-panel">
        <h3>{ar ? 'التقييم' : 'Grading'} {official ? (ar ? '(رسمي)' : '(official)') : (ar ? '(استشاري)' : '(advisory)')}</h3>
        {!official && grades.official && grades.official.status === 'final' && (
          <p className="st-muted">{ar ? 'الدرجة الرسمية: ' : 'Official grade: '}<strong>{grades.official.total_score}/{grades.official.max_score}</strong> {grades.official.letter_grade && `(${grades.official.letter_grade})`}</p>
        )}
        {official && grades.other_advisory.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <strong>{ar ? 'تقييمات استشارية من المعيدين' : 'Advisory grades from TAs'}</strong>
            {grades.other_advisory.map((a, i) => (
              <div className="st-row" key={i}><span>{a.grader_name} <small className="st-muted">({a.status})</small>{a.overall_comments ? ` — ${a.overall_comments}` : ''}</span><span>{a.total_score ?? '—'}/{a.max_score} {a.letter_grade || ''}</span></div>
            ))}
          </div>
        )}
        {!canGrade ? <p className="st-muted">{ar ? 'لا يمكن التقييم قبل تقديم الطالب للمشروع.' : 'Grading opens once the student has submitted the project.'}</p> : (
          <>
            {gradeFinal && official && <LockBar ar={ar} busy={busy} onReopen={reopenGrade} />}
            {gradeFinal && !official && <p className="st-muted">{ar ? 'تم إرسال تقييمك الاستشاري. التعديل سيعيده لمسودة حتى ترسله مجددًا.' : 'Your advisory grade was submitted. Editing reverts it to a draft until you submit again.'}</p>}
            {official && !gradeFinal && grades.official?.reopen_reason && <p className="st-muted">{ar ? 'أُعيد فتح الدرجة: ' : 'Reopened: '}{grades.official.reopen_reason}</p>}
            <fieldset disabled={official && gradeFinal} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
            {official && <MemberAdjustments candidates={grades.member_candidates || []} value={memberAdj} onChange={setMemberAdj} ar={ar} disabled={gradeFinal}
              projectPct={(() => { const mx = criteria.reduce((a, r) => a + (Number(r.max_score) || 0), 0); const sc = criteria.reduce((a, r) => a + (Number(r.score) || 0), 0); return mx > 0 && criteria.some((r) => r.score !== '') ? (sc / mx) * 100 : null; })()} />}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => saveGrade(false)}>{ar ? 'حفظ كمسودة' : 'Save as draft'}</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveGrade(true)}>{official ? (ar ? 'اعتماد الدرجة' : 'Finalize grade') : (ar ? 'إرسال التقييم الاستشاري' : 'Submit advisory grade')}</button>
            </div>
            </fieldset>
            {official && <GradeRevisions revisions={grades.revisions} ar={ar} />}
          </>
        )}
      </section>

      <section className="st-panel">
        <h3>{ar ? 'ملاحظات للطالب' : 'Notes to the student'}</h3>
        <p className="st-muted" style={{ fontSize: 12.5 }}>{ar ? 'اكتب التعديلات المطلوبة أو أي ملاحظة — بتظهر عند الطالب والفريق في تاب النقاش وبيوصلهم إشعار. متاحة في أي حالة للمشروع.' : 'Write requested edits or any remark — it shows in the Discussion tab for the student and team, who are notified. Available in any project status.'}</p>
        {notes.map((n) => (
          <div className="st-row" key={n.id} style={{ alignItems: 'flex-start' }}>
            <span><strong>{n.author_name || '—'}</strong> <small className="st-muted">{n.created_at}</small><div style={{ whiteSpace: 'pre-wrap' }}>{n.message}</div></span>
          </div>
        ))}
        <textarea className="form-input" rows={3} style={{ marginTop: 10 }} placeholder={ar ? 'اكتب ملاحظتك أو التعديل المطلوب…' : 'Write your note or the requested change…'} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy || !noteText.trim()} onClick={sendNote}><Icon name="send" size={14} /> {ar ? 'إرسال للطالب' : 'Send to student'}</button>
      </section>

      <section className="st-panel">
        <h3>{ar ? 'سجل القرارات' : 'Decision history'}</h3>
        {history.length === 0 ? <p className="st-muted">—</p> : history.map((h, i) => {
          const d = DECISION[h.decision] || DECISION.pending;
          return (
            <div className="st-row" key={i} style={{ alignItems: 'flex-start' }}>
              <span><Pill tone={d.tone}>{ar ? d.ar : d.en}</Pill> {h.stage && <small className="st-muted">{h.stage === 'admin_review' ? (ar ? 'إدارة المنصة' : 'Platform admin') : STAGE_LABEL(h.stage, ar)} · </small>}<small className="st-muted">{h.reviewer_name || ''} · {h.decided_at || h.created_at}</small>{h.comments && <div>{h.comments}</div>}</span>
            </div>
          );
        })}
      </section>

      {dlg && (
        <StModal
          title={dlg.label}
          onClose={() => setDlg(null)}
          actions={(
            <>
              <button type="button" className="btn btn-outline" onClick={() => setDlg(null)}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn btn-primary" disabled={busy || (dlg.required && !comments.trim()) || (needsAck && !ack)} onClick={decide}>{dlg.label}</button>
            </>
          )}
        >
          <label className="form-label">{dlg.required ? (ar ? 'التعليق (مطلوب — سيصل للطالب)' : 'Comment (required — sent to the student)') : (ar ? 'تعليق (اختياري)' : 'Comment (optional)')}</label>
          <textarea className="form-input" rows={4} value={comments} onChange={(e) => setComments(e.target.value)} />
          {needsAck && (
            <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{ar ? 'راجعت مؤشرات الذكاء الاصطناعي لهذا المشروع.' : "I've reviewed this project's AI indicators."}</span>
            </label>
          )}
        </StModal>
      )}
      {viewerId != null && files.some((x) => x.id === viewerId && x.url) && (
        <FileViewer
          files={files.filter((x) => x.url)}
          startIndex={Math.max(0, files.filter((x) => x.url).findIndex((x) => x.id === viewerId))}
          onClose={() => setViewerId(null)}
          locale={locale}
          projectId={id}
        />
      )}
    </div>
  );
}
