import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CodeReviewReportPanel from '../CodeReviewReportPanel';
import { api, errorMessage } from '../../api/client';
import { safeHref } from '../../lib/safeUrl';
import Icon from '../Icon';
import { Alert, Mono, Pill, Skeletons } from './umUi';
import { useLanguage } from '../../context/LanguageContext';
import FileViewer from '../FileViewer';
import ReviewFileGroups from './ReviewFileGroups';
import ApprovalStages, { STAGE_LABEL } from '../ApprovalStages';
import ReviewerGradePanel from './ReviewerGradePanel';
import DecisionDialog from './DecisionDialog';

/**
 * Shared project-review detail screen for the University and Faculty portals
 * (um- kit → styles/css/university-manage.css).
 *
 *   scope  'university' | 'faculty' — picks the API / route base. The faculty
 *          view leaves out the Faculty + Supervisor rows (always the caller's own).
 *
 * GET  /api/v1/{scope}/approvals/{id}
 * POST /api/v1/{scope}/approvals/{id}/{approve|reject|request-changes}
 * POST /api/v1/university/approvals/{id}/{publish|unpublish}  (النشر منفصل عن الاعتماد)
 *
 * أزرار القرار بتظهر بس لما `can_decide` (الصلاحية + دور المرحلة دي في التسلسل: دكتور ← كلية ← جامعة).
 */

const STATUS_META = {
  draft: { tone: 'muted', en: 'Draft', ar: 'مسودة' },
  submitted: { tone: 'primary', en: 'Submitted', ar: 'مقدَّم' },
  approved: { tone: 'success', en: 'Approved', ar: 'معتمد' },
  published: { tone: 'success', en: 'Published', ar: 'منشور' },
  rejected: { tone: 'danger', en: 'Rejected', ar: 'مرفوض' },
};

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13.5 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'end' }}>{children}</span>
    </div>
  );
}

export default function ProjectReviewView({ scope }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const isUni = scope === 'university';
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState(null); // 'approve' | 'reject' | 'request-changes' while the comment dialog is open
  const [viewerId, setViewerId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/v1/${scope}/approvals/${encodeURIComponent(id)}`)
      .then((json) => { if (!cancelled) setData(json.data); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, scope]);

  if (loading) return <div className="um-page"><Skeletons n={3} h={140} /></div>;
  if (error) return <div className="um-page"><Alert>{error}</Alert></div>;
  if (!data) return null;

  const p = data.project || {};
  const files = data.files || [];
  const review = data.review || {};
  const reviewTeam = review.team || [];
  const reviewLinks = review.links || [];
  const reviewHistory = review.history || [];
  const reviewGrade = review.grade || null;
  const ROLE_AR = { student_member: 'طالب', supervisor: 'دكتور مشرف', professor: 'أستاذ دكتور', principal_investigator: 'الباحث الرئيسي', teaching_assistant: 'معيد', collaborator: 'متعاون', external_collaborator: 'متعاون خارجي' };
  const DECISION = { approved: ['Approved', 'تم الاعتماد'], rejected: ['Rejected', 'مرفوض'], changes_requested: ['Changes requested', 'مطلوب تعديلات'] };
  const aiReadiness = data.ai_readiness;
  const aiClassification = data.ai_classification;
  const hasAiInfo = !!aiReadiness || !!aiClassification;
  const canApprove = !!data.can_approve;
  const canDecide = !!data.can_decide;
  const canPublish = !!data.can_publish;
  const canUnpublish = !!data.can_unpublish;
  const flow = review.flow || null;
  const gradeDetail = data.grade_detail || null;
  const reloadReview = () => api.get(`/api/v1/${scope}/approvals/${encodeURIComponent(id)}`).then((json) => setData(json.data)).catch((err) => setActionError(errorMessage(err)));
  const requiresAck = !!data.requires_ai_acknowledgment;
  const status = p.status || 'draft';
  const meta = STATUS_META[status] || STATUS_META.draft;
  const locked = (requiresAck && !ack) || busy;
  const backTo = `/${scope}/approvals`;

  async function handlePublication(action) {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/${scope}/approvals/${encodeURIComponent(id)}/${action}`);
      const json = await api.get(`/api/v1/${scope}/approvals/${encodeURIComponent(id)}`);
      setData(json.data);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDecide(action, comments = '') {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/${scope}/approvals/${encodeURIComponent(id)}/${action}`, { ai_acknowledgment: ack ? 1 : 0, comments });
      navigate(backTo, { replace: true });
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            {p.category?.[locale] && <Pill tone="primary" dot={false}>{p.category[locale]}</Pill>}
            <Pill tone={meta.tone}>{meta[locale]}</Pill>
            {p.id && <span className="um-fact um-fact--mono"><Icon name="file" size={13} /> {p.id}</span>}
          </div>
          <h1>{p.title?.[locale]}</h1>
          {p.summary?.[locale] && <p style={{ maxWidth: 680 }}>{p.summary[locale]}</p>}
        </div>
        <div className="um-head__act">
          <Link to={backTo} className="btn btn-outline">
            <Icon name={ar ? 'chevron-right' : 'chevron-left'} size={16} /> {ar ? 'الرجوع لقائمة الاعتماد' : 'Back to Approvals'}
          </Link>
        </div>
      </header>

      {actionError && <Alert>{actionError}</Alert>}

      {status === 'submitted' && canApprove && !canDecide && flow?.awaiting && (
        <Alert tone="warn">
          {ar ? `لا يمكن اتخاذ قرار الآن: المشروع بانتظار اعتماد «${STAGE_LABEL(flow.awaiting, true)}» أولًا (الترتيب: دكتور مشرف ← كلية ← جامعة).`
              : `You can't decide yet: the project is awaiting «${STAGE_LABEL(flow.awaiting, false)}» first (order: supervisor → faculty → university).`}
        </Alert>
      )}

      {(canPublish || canUnpublish) && (
        <section className="um-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <strong>{canPublish ? (ar ? 'المشروع معتمد وغير منشور' : 'Approved, not published') : (ar ? 'المشروع منشور للعامة' : 'Published to the public')}</strong>
            <div className="um-panel__sub" style={{ margin: 0 }}>
              {canPublish ? (ar ? 'الاعتماد لا ينشر المشروع تلقائيًا. انشره للعامة عند الجاهزية.' : 'Approval does not publish automatically. Publish it when ready.')
                          : (ar ? 'يمكنك سحبه من العرض العام ويبقى معتمدًا.' : 'You can withdraw it from public view; it stays approved.')}
            </div>
          </div>
          <button type="button" className={`btn ${canPublish ? 'um-btn-ok' : 'btn-outline um-btn-warn'}`} disabled={busy} onClick={() => handlePublication(canPublish ? 'publish' : 'unpublish')}>
            <Icon name={canPublish ? 'globe' : 'eye-off'} size={16} /> {canPublish ? (ar ? 'نشر للعامة' : 'Publish') : (ar ? 'سحب من النشر' : 'Unpublish')}
          </button>
        </section>
      )}

      {status === 'submitted' && canDecide && (
        <section className="um-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            {requiresAck ? (
              <label className="um-ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <Icon name="sparkles" size={14} />
                {ar ? 'راجعت مؤشرات الذكاء الاصطناعي أدناه بشكل مستقل قبل اتخاذ القرار' : "I've reviewed the AI indicators below independently before deciding"}
              </label>
            ) : (
              <strong>{ar ? 'القرار بانتظارك' : 'Your decision is needed'}</strong>
            )}
          </div>
          <div className="um-review__acts">
            <button type="button" className="btn btn-outline um-btn-warn" disabled={locked} onClick={() => setDlg('request-changes')}>
              <Icon name="edit" size={16} /> {ar ? 'طلب تعديلات' : 'Request Changes'}
            </button>
            <button type="button" className="btn btn-outline um-btn-danger" disabled={locked} onClick={() => setDlg('reject')}>
              <Icon name="x" size={16} /> {ar ? 'رفض' : 'Reject'}
            </button>
            <button type="button" className="btn um-btn-ok" disabled={locked} onClick={() => setDlg('approve')}>
              <Icon name="check" size={16} /> {ar ? 'اعتماد' : 'Approve'}
            </button>
          </div>
        </section>
      )}

      {dlg && <DecisionDialog action={dlg} ar={ar} busy={busy} onCancel={() => setDlg(null)} onConfirm={(c) => { setDlg(null); handleDecide(dlg, c); }} />}

      <div className="um-layout">
        <div className="um-stack">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{ar ? 'وصف المشروع' : 'Project Summary'}</h2></div>
            <p style={{ whiteSpace: 'pre-line', margin: 0, lineHeight: 1.7 }}>{p.summary?.[locale]}</p>
            {p.tags?.length > 0 && (
              <>
                <h3 style={{ margin: '18px 0 8px', fontSize: 14 }}>{ar ? 'الوسوم' : 'Tags'}</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {p.tags.map((tag) => <span key={tag} className="ru-chip">{tag}</span>)}
                </div>
              </>
            )}
            {p.repository_url && (
              <a href={safeHref(p.repository_url)} target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ marginTop: 16 }}>
                <Icon name="link" size={16} /> {ar ? 'المستودع' : 'Repository'}
              </a>
            )}
          </section>

          <CodeReviewReportPanel projectId={id} className="um-panel" />

          <section className="um-panel">
            <div className="um-panel__head"><h2>{ar ? 'الملفات' : 'Files'}</h2></div>
            {files.length === 0 ? (
              <p className="um-panel__sub">{ar ? 'لا توجد ملفات مرفوعة على هذا المشروع.' : 'No files uploaded on this project.'}</p>
            ) : (
              <ReviewFileGroups files={files} ar={ar} onPreview={setViewerId} />
            )}
          </section>

          <section className="um-panel">
            <div className="um-panel__head"><h2>{ar ? 'فريق المشروع' : 'Project Team'}</h2></div>
            {reviewTeam.length === 0 ? (
              <p className="um-panel__sub">{ar ? 'لا يوجد أعضاء فريق.' : 'No team members.'}</p>
            ) : reviewTeam.map((m) => (
              <Row key={m.id} label={ROLE_AR[m.role] && ar ? ROLE_AR[m.role] : m.role}>{m.display_name}{m.student_number ? ` · ${m.student_number}` : ''}{m.status === 'pending' ? (ar ? ' (دعوة معلّقة)' : ' (pending)') : ''}</Row>
            ))}
          </section>

          {reviewLinks.length > 0 && (
            <section className="um-panel">
              <div className="um-panel__head"><h2>{ar ? 'الروابط' : 'Links'}</h2></div>
              {reviewLinks.map((l, i) => (
                <Row key={i} label={l.label || l.type}><a href={safeHref(l.url)} target="_blank" rel="noopener noreferrer">{l.url}</a></Row>
              ))}
            </section>
          )}

          {reviewGrade && (
            <section className="um-panel">
              <div className="um-panel__head"><h2>{ar ? 'تقييم المشرف' : 'Supervisor Grade'}</h2></div>
              <Row label={ar ? 'الدرجة' : 'Score'}>{reviewGrade.total_score ?? '—'} / {reviewGrade.max_score} {reviewGrade.letter_grade ? `(${reviewGrade.letter_grade})` : ''}</Row>
              <Row label={ar ? 'الحالة' : 'Status'}>{reviewGrade.status === 'final' ? (ar ? 'نهائي' : 'Final') : (ar ? 'مسودة' : 'Draft')}</Row>
              {reviewGrade.grader_name && <Row label={ar ? 'المُقيِّم' : 'Graded by'}>{reviewGrade.grader_name}</Row>}
              {reviewGrade.overall_comments && <p className="um-panel__sub">{reviewGrade.overall_comments}</p>}
              {(review.grade_members || []).map((m) => (
                <Row key={m.user_id} label={m.full_name}>{m.final_percentage != null ? `${Number(m.final_percentage).toFixed(1)}% ${m.letter_grade || ''}` : '—'}{Number(m.adjustment) !== 0 ? ` (${Number(m.adjustment) > 0 ? '+' : ''}${Number(m.adjustment)}${m.comments ? ` — ${m.comments}` : ''})` : ''}</Row>
              ))}
            </section>
          )}

          {gradeDetail?.gradable && gradeDetail.can_grade && (
            <ReviewerGradePanel scope={scope} id={id} grade={reviewGrade} detail={gradeDetail} ar={ar} onChanged={reloadReview} />
          )}

          {reviewHistory.length > 0 && (
            <section className="um-panel">
              <div className="um-panel__head"><h2>{ar ? 'سجل القرارات' : 'Decision History'}</h2></div>
              {reviewHistory.map((h, i) => (
                <Row key={i} label={`${(DECISION[h.decision] || [h.decision, h.decision])[ar ? 1 : 0]}${h.stage === 'admin_review' ? (ar ? ' · إدارة المنصة' : ' · Platform admin') : h.stage ? ` · ${STAGE_LABEL(h.stage, ar)}` : ''}`}>
                  {h.reviewer_name || '—'}{h.decided_at ? ` · ${new Date(h.decided_at).toLocaleDateString(ar ? 'ar-EG' : 'en-US')}` : ''}{h.comments ? ` — ${h.comments}` : ''}
                </Row>
              ))}
            </section>
          )}
        </div>

        <aside className="um-aside">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{ar ? 'الطالب' : 'Student'}</h2></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Mono name={p.owner_name} hue="1" />
              <div style={{ minWidth: 0 }}>
                <strong>{p.owner_name || '—'}</strong>
                <div className="um-panel__sub" style={{ margin: 0 }}>{p.owner_email}</div>
              </div>
            </div>
            {isUni && p.owner_faculty && <Row label={ar ? 'الكلية' : 'Faculty'}>{p.owner_faculty}</Row>}
            {p.owner_department && <Row label={ar ? 'القسم' : 'Department'}>{p.owner_department}</Row>}
          </section>

          {flow && (
            <section className="um-panel">
              <div className="um-panel__head"><h2>{ar ? 'مسار الاعتماد' : 'Approval Path'}</h2></div>
              <ApprovalStages flow={flow} status={status} ar={ar} />
            </section>
          )}

          {hasAiInfo && (
            <section className="um-panel" style={{ borderInlineStart: '3px solid var(--color-accent)' }}>
              <div className="um-panel__head"><h2><Icon name="sparkles" size={16} /> {ar ? 'مؤشرات الذكاء الاصطناعي' : 'AI Indicators'}</h2></div>
              <p className="um-panel__sub">{ar ? 'استرشادية فقط — القرار النهائي دائمًا بشري. راجعها قبل الاعتماد أو الرفض.' : 'Advisory only — the final decision is always human. Review before approving or rejecting.'}</p>
              {aiReadiness && <Row label={ar ? 'درجة الجاهزية' : 'Readiness score'}>{Number(aiReadiness.overall_score).toFixed(1)}/100</Row>}
              {aiClassification && (
                <Row label={ar ? 'التصنيف المقترح' : 'Predicted category'}>
                  {aiClassification.predicted_category}{aiClassification.confidence !== null && aiClassification.confidence !== undefined ? ` · ${Math.round(aiClassification.confidence)}%` : ''}
                </Row>
              )}
            </section>
          )}

          <section className="um-panel">
            <div className="um-panel__head"><h2>{ar ? 'معلومات المشروع' : 'Project Info'}</h2></div>
            {(review.supervisor_name || p.supervisor_name) && <Row label={ar ? 'المشرف' : 'Supervisor'}>{review.supervisor_name || p.supervisor_name}</Row>}
            <Row label={ar ? 'المجال' : 'Category'}>{p.category?.[locale]}</Row>
            <Row label={ar ? 'الحالة' : 'Status'}><Pill tone={meta.tone}>{meta[locale]}</Pill></Row>
          </section>
        </aside>
      </div>
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
