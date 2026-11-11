import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { STAGE_LABEL } from '../../components/ApprovalStages';
import Icon from '../../components/Icon';
import { Alert, Empty, Pill, SearchField, Skeletons, Stat } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import DecisionDialog from '../../components/university/DecisionDialog';
import DeadlinesCard from '../../components/university/DeadlinesCard';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/faculty/project-approval';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/faculty/project-approval.php, talking to the real JSON
 * API (GET /api/v1/faculty/approvals — FacultyApprovalsApiController::index(),
 * the same ProjectApprovalService::queueForFaculty() rows the Blade table
 * consumes). Decision actions POST to the same controller's approve/reject/
 * request-changes, keeping the AI-acknowledgment gate of the original per-row
 * forms (rowHasAi / ackCheckbox).
 *
 * Same look as UniversityApprovals.jsx (um- kit in styles/css/university-manage.css).
 * A faculty's queue is already scoped to its own students, so the Faculty fact
 * is left out of the cards.
 */

const STATUS_META = {
  pending: { tone: 'primary', en: 'Pending', ar: 'قيد الانتظار' },
  approved: { tone: 'success', en: 'Approved', ar: 'معتمد' },
  rejected: { tone: 'danger', en: 'Rejected', ar: 'مرفوض' },
  changes_requested: { tone: 'warning', en: 'Changes Requested', ar: 'تعديلات مطلوبة' },
};

const TABS = [
  { key: 'all', icon: 'folder', tone: 'primary', en: 'All', ar: 'الكل' },
  { key: 'pending', icon: 'clock', tone: 'warning', en: 'Pending', ar: 'قيد الانتظار' },
  { key: 'approved', icon: 'check-circle', tone: 'success', en: 'Approved', ar: 'معتمد' },
  { key: 'changes_requested', icon: 'edit', tone: 'muted', en: 'Changes Requested', ar: 'تعديلات مطلوبة' },
  { key: 'rejected', icon: 'x-circle', tone: 'danger', en: 'Rejected', ar: 'مرفوض' },
];

function ReviewCard({ p, locale, canApprove, onDecide, busyId }) {
  const ar = locale === 'ar';
  const meta = STATUS_META[p.status] || STATUS_META.pending;
  const hasScore = p.score !== null && p.score !== undefined;
  const rowHasAi = hasScore || !!p.predictedCategory;
  const [ack, setAck] = useState(false);
  const [dlg, setDlg] = useState(null);
  const busy = busyId === p.id;
  // الاعتماد بالترتيب (دكتور ← كلية ← جامعة): أزرار القرار بتظهر بس لما دور المرحلة دي.
  const myTurn = p.status === 'pending' && canApprove && p.awaiting === 'faculty_review';
  const waitingFor = p.status === 'pending' && p.awaiting && p.awaiting !== 'faculty_review' ? p.awaiting : null;
  const locked = (rowHasAi && !ack) || busy;
  const href = `/faculty/approvals/${encodeURIComponent(p.id)}`;
  const title = p.title?.[locale] || p.title?.en;
  const score = hasScore ? Math.max(0, Math.min(100, Math.round(Number(p.score)))) : null;
  const ringCls = score === null ? '' : score >= 75 ? ' um-score--good' : score < 50 ? ' um-score--low' : '';

  return (
    <article className="um-review" data-tone={meta.tone}>
      <span className="um-review__spine" aria-hidden="true" />
      <div className="um-review__body">
        <div className="um-review__main">
          <div className="um-review__info">
            <span style={{ alignSelf: 'flex-start' }}><Pill tone={meta.tone}>{meta[locale]}</Pill></span>
            <h3 className="um-review__title"><Link to={href}>{title}</Link></h3>
            <p className="um-review__who">
              <strong>{p.student?.[locale] || p.student?.en}</strong>
              {(p.supervisor?.[locale] || p.supervisor?.en) ? ` · ${ar ? 'المشرف' : 'Supervisor'}: ${p.supervisor?.[locale] || p.supervisor?.en}` : ''}
            </p>
            <div className="um-facts">
              {p.submitted && <span className="um-fact"><Icon name="calendar" size={14} /> {p.submitted}</span>}
              <span className="um-fact um-fact--mono"><Icon name="file" size={14} /> {p.id}</span>
            </div>
            {p.predictedCategory && (
              <span className="um-ai-tag" title={t0(ar, 'مصنَّف تلقائياً بالذكاء الاصطناعي', 'Auto-classified by AI')}>
                <Icon name="sparkles" size={13} /> {p.predictedCategory}
                {p.classificationConfidence !== null && p.classificationConfidence !== undefined ? ` · ${Math.round(p.classificationConfidence)}%` : ''}
              </span>
            )}
          </div>

          {score !== null ? (
            <div className="um-score">
              <span className={`st-score${ringCls}`} style={{ '--p': score }} aria-label={`${score}/100`}><span>{score}</span></span>
              <small>{ar ? 'الجاهزية' : 'Readiness'}</small>
            </div>
          ) : (
            <div className="um-score um-score--none">
              <span className="um-score__dash"><Icon name="sparkles" size={20} /></span>
              <small>{ar ? 'لم يُحلَّل بعد' : 'Not analyzed'}</small>
            </div>
          )}
        </div>

        <div className="um-review__foot">
          <div>
            {myTurn && rowHasAi && (
              <label className="um-ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <Icon name="sparkles" size={14} />
                {ar ? 'راجعت مؤشرات الذكاء الاصطناعي بشكل مستقل' : "I've reviewed the AI indicators independently"}
              </label>
            )}
            {waitingFor && (
              <span className="um-fact"><Icon name="clock" size={14} /> {ar ? `بانتظار اعتماد: ${STAGE_LABEL(waitingFor, true)}` : `Awaiting: ${STAGE_LABEL(waitingFor, false)}`}</span>
            )}
            {p.status === 'approved' && (
              <span className="um-fact"><Icon name={p.published ? 'globe' : 'eye-off'} size={14} /> {p.published ? (ar ? 'منشور للعامة' : 'Published') : (ar ? 'معتمد وغير منشور' : 'Approved, not published')}</span>
            )}
            {p.status === 'pending' && !canApprove && (
              <span className="um-fact"><Icon name="lock" size={14} /> {ar ? 'لا تملك صلاحية' : 'No permission'}</span>
            )}
          </div>
          <div className="um-review__acts">
            <Link to={href} className="btn btn-ghost"><Icon name="eye" size={16} /> {ar ? 'عرض' : 'View'}</Link>
            {myTurn && (
              <>
                <button type="button" className="btn btn-outline um-btn-warn" disabled={locked} onClick={() => setDlg('request-changes')}>
                  <Icon name="edit" size={16} /> {ar ? 'طلب تعديلات' : 'Request Changes'}
                </button>
                <button type="button" className="btn btn-outline um-btn-danger" disabled={locked} onClick={() => setDlg('reject')}>
                  <Icon name="x" size={16} /> {ar ? 'رفض' : 'Reject'}
                </button>
                <button type="button" className="btn um-btn-ok" disabled={locked} onClick={() => setDlg('approve')}>
                  <Icon name="check" size={16} /> {ar ? 'اعتماد' : 'Approve'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {dlg && <DecisionDialog action={dlg} ar={ar} busy={busy} onCancel={() => setDlg(null)} onConfirm={(c) => { const a = dlg; setDlg(null); onDecide(p.id, a, ack, c); }} />}
    </article>
  );
}

const t0 = (ar, a, e) => (ar ? a : e);

export default function FacultyApprovals() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [queue, setQueue] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    setError(null);
    api.get('/api/v1/faculty/approvals')
      .then((json) => {
        setQueue(json.data?.queue || []);
        setCanApprove(!!json.data?.can_approve);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDecide(id, action, aiAcknowledged, comments = '') {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/api/v1/faculty/approvals/${encodeURIComponent(id)}/${action}`, { ai_acknowledgment: aiAcknowledged ? 1 : 0, comments });
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => ({
    all: queue.length,
    pending: queue.filter((p) => p.status === 'pending').length,
    approved: queue.filter((p) => p.status === 'approved').length,
    rejected: queue.filter((p) => p.status === 'rejected').length,
    changes_requested: queue.filter((p) => p.status === 'changes_requested').length,
  }), [queue]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return queue.filter((p) => {
      if (tab !== 'all' && p.status !== tab) return false;
      if (!needle) return true;
      return [p.id, p.title?.en, p.title?.ar, p.student?.en, p.student?.ar, p.supervisor?.en, p.supervisor?.ar, p.faculty?.en, p.faculty?.ar]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [queue, tab, q]);

  const pendingRows = queue.filter((p) => p.status === 'pending');
  const classifiedCount = pendingRows.filter((p) => p.predictedCategory).length;
  const classifiedPct = pendingRows.length ? Math.round((classifiedCount / pendingRows.length) * 100) : 0;

  const flow = [
    { icon: 'check', label: t('Student submission'), state: 'done' },
    { icon: 'clock', label: ar ? 'اعتماد الكلية (أنتم هنا)' : 'Faculty approval (you are here)', state: 'now' },
    { icon: 'sparkles', label: t('AI review'), state: '' },
    { icon: 'folder', label: t('Published on platform'), state: '' },
  ];

  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <h1>{t('Project Approvals')}</h1>
          <p>{ar ? 'مشاريع طلاب كليتك بانتظار اعتمادك قبل النشر.' : "Your faculty's students' projects awaiting your sign-off before publishing."}</p>
        </div>
      </header>

      <DeadlinesCard />

      {actionError && <Alert>{actionError}</Alert>}

      <div className="um-stats" style={{ '--n': TABS.length }} data-scroll="">
        {TABS.map((tb) => (
          <Stat key={tb.key} icon={tb.icon} tone={tb.tone} value={counts[tb.key]} label={tb[locale]} active={tab === tb.key} onClick={() => setTab(tb.key)} />
        ))}
      </div>

      <div className="um-bar">
        <SearchField value={q} onChange={setQ} placeholder={ar ? 'ابحث بعنوان المشروع أو الطالب…' : 'Search by project or student…'} />
        <span className="um-count">{ar ? `${rows.length} مشروع` : `${rows.length} ${rows.length === 1 ? 'project' : 'projects'}`}</span>
      </div>

      {loading ? <Skeletons n={3} h={150} /> : error ? <Alert>{error}</Alert> : (
        <div className="um-layout">
          <div className="um-stack">
            {rows.length === 0 ? (
              <Empty icon="folder" title={ar ? 'لا توجد مشاريع في هذا التصنيف.' : 'No projects in this filter.'}
                text={q ? (ar ? 'جرّب كلمات بحث مختلفة.' : 'Try a different search.') : undefined} />
            ) : rows.map((p) => (
              <ReviewCard key={p.id} p={p} locale={locale} canApprove={canApprove} onDecide={handleDecide} busyId={busyId} />
            ))}
          </div>

          <aside className="um-aside">
            <section className="um-panel">
              <div className="um-panel__head"><h2>{t('Approval Workflow')}</h2></div>
              <ol className="um-flow">
                {flow.map((s) => (
                  <li key={s.label} className={s.state ? `is-${s.state}` : ''}>
                    <span className="um-flow__dot"><Icon name={s.icon} size={14} /></span>
                    {s.label}
                  </li>
                ))}
              </ol>
              <p className="um-note">
                {t('Approve publishes the project immediately. Request Changes sends it back to the student as a draft.')}
              </p>
            </section>

            <section className="um-panel">
              <div className="um-panel__head"><h2>{t('Automatic Classification')}</h2></div>
              {pendingRows.length > 0 ? (
                <>
                  <div className="um-meter"><b>{classifiedCount}/{pendingRows.length}</b><span>{classifiedPct}%</span></div>
                  <div className="um-bar-track"><span style={{ width: `${classifiedPct}%` }} /></div>
                  <p className="um-panel__sub">{t('of pending projects have been auto-tagged by field. The suggested field appears under each project title in the table.')}</p>
                </>
              ) : (
                <p className="um-panel__sub">{t('No pending projects right now.')}</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
