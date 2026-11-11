import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import VideoPlayer from '../../components/VideoPlayer';
import Breadcrumb from '../../components/Breadcrumb';
import CodeReviewReportPanel from '../../components/CodeReviewReportPanel';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { StatusPill, Score, Stepper, Pill, loc, timeAgo } from '../../components/student/stUi';
import FileManager from '../../components/student/FileManager';
import ApprovalStages, { STAGE_LABEL } from '../../components/ApprovalStages';

const LINK_TYPE_ICON = { github: 'github', gitlab: 'github', live_demo: 'globe', website: 'globe' };

const TEAM_STATUS_BADGE = {
  pending: { cls: 'badge-primary', en: 'Invite pending', ar: 'دعوة معلّقة' },
  accepted: { cls: 'badge-success', en: 'Confirmed', ar: 'مؤكد' },
  rejected: { cls: 'badge-danger', en: 'Declined', ar: 'مرفوض' },
};

const TABS = [
  { key: 'overview', en: 'Overview', ar: 'نظرة عامة' },
  { key: 'files', en: 'Files', ar: 'الملفات' },
  { key: 'gallery', en: 'Gallery', ar: 'معرض الوسائط' },
  { key: 'analytics', en: 'Analytics', ar: 'الإحصائيات', ownerOnly: true },
  { key: 'links', en: 'Links', ar: 'الروابط' },
  { key: 'team', en: 'Team', ar: 'الفريق' },
  { key: 'approval', en: 'Approval Status', ar: 'حالة الاعتماد' },
  { key: 'discussion', en: 'Discussion', ar: 'المناقشة' },
  { key: 'activity', en: 'Activity', ar: 'النشاط' },
  { key: 'code-review', en: 'Code Review', ar: 'مراجعة الكود' },
];

/**
 * Mirrors app/Views/student/project-details.php, talking to the real
 * private JSON API (App\Controllers\Api\ProjectsApiController) instead of
 * the PHP-rendered view: GET /api/v1/projects/{id} (+ /files, /media,
 * /links, /team, /discussion, /activity, /analytics,
 * /approval, /code-review). This is the page StudentProjects.jsx's project
 * cards link to — previously missing, so clicking a project fell through
 * to the catch-all route back to the dashboard.
 *
 * Analytics/Approval-Status are owner-only tabs (matches
 * the underlying endpoints, which 404 for anyone but the owner) and are
 * hidden entirely for an accepted-team-member viewer. Note the PHP view's
 * "Approval Timeline" tab is hardcoded placeholder markup (fixed made-up
 * dates), not backed by any real data — the "approval" tab here shows the
 * project's actual status and latest reviewer decision instead, since
 * that's the only piece the backend genuinely tracks.
 */
export default function StudentProjectDetail() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const { can, user: authUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = (en, ar) => (locale === 'ar' ? ar : en);

  const [flash, setFlash] = useState(location.state?.flash || null);
  useEffect(() => {
    if (location.state?.flash) navigate(location.pathname, { replace: true, state: {} });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = useState('overview');
  const [project, setProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [media, setMedia] = useState([]);
  const [links, setLinks] = useState([]);
  const [team, setTeam] = useState([]);
  const [discussion, setDiscussion] = useState([]);
  const [activity, setActivity] = useState([]);
  const [codeReview, setCodeReview] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [approval, setApproval] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadedRef = useRef(false);
  useEffect(() => { loadedRef.current = false; }, [id]);

  // After the first load, reloads are silent: the page never drops back to "Loading…",
  // so in-flight uploads / open forms inside the tabs don't vanish.
  const load = useCallback(() => {
    if (!loadedRef.current) setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/api/v1/projects/${id}`),
      api.get(`/api/v1/projects/${id}/files`).catch(() => ({ data: [] })),
      api.get(`/api/v1/projects/${id}/media`).catch(() => ({ data: [] })),
      api.get(`/api/v1/projects/${id}/links`).catch(() => ({ data: [] })),
      api.get(`/api/v1/projects/${id}/team`).catch(() => ({ data: [] })),
      api.get(`/api/v1/projects/${id}/discussion`).catch(() => ({ data: [] })),
      api.get(`/api/v1/projects/${id}/activity`).catch(() => ({ data: [] })),
      api.get(`/api/v1/projects/${id}/code-review`).catch(() => ({ data: null })),
      // Owner-only — a viewing team member gets a 404 here, which is fine;
      // the tabs themselves are hidden for non-owners (see TABS' ownerOnly).
      api.get(`/api/v1/projects/${id}/analytics`).catch(() => ({ data: null })),
      api.get(`/api/v1/projects/${id}/approval`).catch(() => ({ data: null })),
    ])
      .then(([p, f, m, l, tm, d, a, cr, an, ap]) => {
        setProject(p.data);
        setFiles(f.data || []);
        setMedia(m.data || []);
        setLinks(l.data || []);
        setTeam(tm.data || []);
        setDiscussion(d.data || []);
        setActivity(a.data || []);
        setCodeReview(cr.data || null);
        setAnalyticsData(an.data || null);
        setApproval(ap.data || null);
      })
      .then(() => { loadedRef.current = true; })
      .catch((err) => { if (!loadedRef.current) setError(errorMessage(err)); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const reloadFiles = useCallback(
    () => api.get(`/api/v1/projects/${id}/files`).then((r) => setFiles(r.data || [])).catch(() => {}),
    [id],
  );

  usePageMeta(project ? (project.title?.[locale] || project.title?.en || t('Project', 'المشروع')) : t('Project', 'المشروع'), t('Project details and review status.', 'تفاصيل المشروع وحالة المراجعة.'));

  async function runAction(promise, { confirmMsg, onDone } = {}) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setActionError(null);
    setActionBusy(true);
    try {
      await promise;
      if (onDone) onDone(); else load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…', 'جارِ التحميل…')}</p>;
  if (error) {
    return (
      <div style={{ padding: 'var(--space-5)' }}>
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
        <Link to="/student/projects" className="btn btn-outline" style={{ marginTop: 'var(--space-3)' }}>{t('Back to My Projects', 'رجوع لمشاريعي')}</Link>
      </div>
    );
  }
  if (!project) return null;

  const title = project.title?.[locale] || project.title?.en || '';
  const isOwner = project.viewer_role === 'owner';
  const canEdit = isOwner && ['draft', 'rejected'].includes(project.status);
  const canManageTeam = (isOwner || project.viewer_role === 'student_member') && ['draft', 'submitted', 'under_review', 'rejected'].includes(project.status);
  const canContribute = (isOwner || ['student_member', 'collaborator'].includes(project.viewer_role)) && ['draft', 'rejected'].includes(project.status);
  const canSubmit = isOwner && ['draft', 'rejected'].includes(project.status);
  const canArchive = isOwner && project.status !== 'archived';
  const canUnarchive = isOwner && project.status === 'archived';
  // الاعتماد منفصل عن النشر: المشروع المعتمد يتنشر بقرار صاحبه.
  const canPublish = isOwner && project.status === 'approved';

  return (
    <>
      <Breadcrumb
        locale={locale}
        items={[
          { en: 'Dashboard', ar: 'لوحة التحكم', url: '/student/dashboard' },
          { en: 'My Projects', ar: 'مشاريعي', url: '/student/projects' },
          { en: title, ar: title },
        ]}
      />

      <section className="st-panel st-project-head">
        <div className="st-row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="st-row" style={{ justifyContent: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 20, fontWeight: 800 }}>{title}</h2>
              <StatusPill status={project.status} locale={locale} />
            </div>
            <p className="st-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {[loc(project.category, locale), project.supervisor_name, project.updated_at && `${t('Updated', 'آخر تحديث')} ${timeAgo(project.updated_at, locale)}`].filter(Boolean).join(' · ')}
            </p>
            {(project.summary?.[locale] || project.summary?.en) && (
              <p style={{ fontSize: 13.5, marginTop: 10, maxWidth: 720 }}>{project.summary?.[locale] || project.summary?.en}</p>
            )}
          </div>
          {project.score > 0 && <Score value={project.score} large />}
        </div>
        <div className="st-page__actions" style={{ justifyContent: 'flex-start' }}>
          {isOwner && can('ai.request_analysis') && (
            <Link to={`/student/ai-analysis?project=${id}`} className="btn btn-outline">
              <Icon name="sparkles" size={18} /> {t('AI Analysis', 'تحليل الذكاء الاصطناعي')}
            </Link>
          )}
          {canEdit && can('project.edit_own') ? (
            <Link to={`/student/projects/${id}/edit`} className="btn btn-outline"><Icon name="edit" size={18} /> {t('Edit', 'تعديل')}</Link>
          ) : (
            <button className="btn btn-outline" disabled title={t('Published projects cannot be edited directly', 'المشاريع المنشورة لا يمكن تعديلها مباشرة')}>
              <Icon name="edit" size={18} /> {t('Edit', 'تعديل')}
            </button>
          )}
          {canPublish && (
            <button type="button" className="btn btn-primary" disabled={actionBusy} onClick={() => runAction(api.post(`/api/v1/projects/${id}/publish`), { confirmMsg: t('Publish this project to the public?', 'نشر هذا المشروع للعامة؟') })}>
              <Icon name="globe" size={16} /> {t('Publish', 'نشر للعامة')}
            </button>
          )}
          {canArchive && (
            <button type="button" className="btn btn-outline" disabled={actionBusy} onClick={() => runAction(api.post(`/api/v1/projects/${id}/archive`), { confirmMsg: t('Archive this project?', 'أرشفة هذا المشروع؟') })}>
              <Icon name="archive" size={16} /> {t('Archive', 'أرشفة')}
            </button>
          )}
          {canUnarchive && (
            <button type="button" className="btn btn-outline" disabled={actionBusy} onClick={() => runAction(api.post(`/api/v1/projects/${id}/unarchive`))}>
              <Icon name="refresh" size={16} /> {t('Restore to Draft', 'استرجاع كمسودة')}
            </button>
          )}
          {isOwner && (
            <button
              type="button" disabled={actionBusy}
              className="btn btn-outline st-btn-danger"
              onClick={() => runAction(api.del(`/api/v1/projects/${id}`), {
                confirmMsg: t('Delete this project permanently? This cannot be undone.', 'حذف هذا المشروع نهائياً؟ لا يمكن التراجع عن هذا الإجراء.'),
                onDone: () => navigate('/student/projects', { replace: true, state: { flash: { type: 'success', message: t('Project deleted.', 'تم حذف المشروع.') } } }),
              })}
            >
              <Icon name="trash" size={18} /> {t('Delete', 'حذف')}
            </button>
          )}
        </div>
      </section>

      {canSubmit && <SubmissionPanel id={id} refreshKey={`${files.length}-${team.length}-${links.length}-${project.updated_at}`} busy={actionBusy} t={t} onSubmit={() => runAction(api.post(`/api/v1/projects/${id}/submit`))} />}

      {flash && (
        <div
          className="glass-panel"
          style={{
            padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
            borderInlineStart: `3px solid ${flash.type === 'warning' ? 'var(--color-warning, #d97706)' : 'var(--color-success)'}`,
          }}
        >
          <p className="text-small" style={{ margin: 0 }}>{flash.message}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setFlash(null)}><Icon name="x" size={14} /></button>
        </div>
      )}

      {/* Reviewer feedback: shown on every tab while the project is waiting for the student's changes. */}
      {approval?.latest_decision && ['changes_requested', 'rejected'].includes(approval.latest_decision.decision) && project.status !== 'published' && project.status !== 'approved' && (
        <div
          className="glass-panel"
          role="alert"
          style={{
            padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)',
            borderInlineStart: `3px solid ${approval.latest_decision.decision === 'rejected' ? 'var(--color-danger)' : 'var(--color-warning, #d97706)'}`,
          }}
        >
          <strong>
            {approval.latest_decision.decision === 'rejected' ? t('Your project was rejected', 'تم رفض مشروعك') : t('The reviewer asked for changes', 'المراجع طلب تعديلات على مشروعك')}
            {approval.latest_decision.stage ? ` · ${approval.latest_decision.stage === 'admin_review' ? t('Platform admin', 'إدارة المنصة') : STAGE_LABEL(approval.latest_decision.stage, locale === 'ar')}` : ''}
          </strong>
          <p className="text-small" style={{ margin: '6px 0 10px', whiteSpace: 'pre-line' }}>
            {approval.latest_decision.comments || t('No written reason was attached by the reviewer.', 'لم يُرفق سبب مكتوب من المراجع.')}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canEdit && <Link to={`/student/projects/${id}/edit`} className="btn btn-outline btn-sm"><Icon name="edit" size={14} /> {t('Edit the project now', 'عدّل المشروع الآن')}</Link>}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('approval')}>{t('View full decision history', 'عرض سجل القرارات كاملًا')}</button>
          </div>
        </div>
      )}

      {actionError && <p className="text-small" style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>{actionError}</p>}

      <div className="st-tabs" role="tablist">
        {TABS.filter((tb) => !tb.ownerOnly || isOwner).map((tb) => (
          <button key={tb.key} type="button" className={`st-tab${tab === tb.key ? ' is-active' : ''}`} role="tab" aria-selected={tab === tb.key} onClick={() => setTab(tb.key)}>
            {t(tb.en, tb.ar)}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === 'overview' && <OverviewTab project={project} approval={approval} locale={locale} t={t} />}
        {tab === 'files' && <FileManager id={id} files={files} canEdit={canContribute} isOwner={isOwner} userId={authUser?.id} t={t} locale={locale} reloadFiles={reloadFiles} setActionError={setActionError} />}
        {tab === 'gallery' && <GalleryTab media={media} t={t} />}
        {tab === 'analytics' && isOwner && <AnalyticsTab data={analyticsData} locale={locale} t={t} />}
        {tab === 'links' && <LinksTab id={id} links={links} canEdit={canEdit} t={t} reload={load} setActionError={setActionError} />}
        {tab === 'team' && <TeamTab id={id} team={team} canEdit={canManageTeam} isOwner={isOwner} userId={authUser?.id} t={t} reload={load} setActionError={setActionError} />}
        {tab === 'approval' && <ApprovalTab approval={approval} canEdit={canEdit} id={id} locale={locale} t={t} />}
        {tab === 'discussion' && <DiscussionTab id={id} discussion={discussion} t={t} reload={load} setActionError={setActionError} />}
        {tab === 'activity' && <ActivityTab activity={activity} t={t} />}
        {tab === 'code-review' && <CodeReviewTab id={id} project={project} review={codeReview} canEdit={canEdit} t={t} reload={load} setActionError={setActionError} />}
      </div>
    </>
  );
}

function OverviewTab({ project, approval, locale, t }) {
  const tags = project.technologies || [];
  const allTags = [...tags, ...(project.tags || [])];
  // مسار الاعتماد الحقيقي: مسودة ← تم التقديم ← (مشرف ← كلية ← جامعة، حسب المطلوب) ← منشور.
  // "معتمد" = خلّص كل المراحل لكن لسه ما اتنشرش (النشر خطوة منفصلة بقرار صاحب المشروع).
  const flow = approval?.flow;
  const stageSteps = (flow?.stages || []).filter((s) => s.state !== 'skipped');
  const steps = [
    { label: t('Draft', 'مسودة') }, { label: t('Submitted', 'تم التقديم') },
    ...(stageSteps.length ? stageSteps.map((s) => ({ key: s.stage, label: STAGE_LABEL(s.stage, locale === 'ar') })) : [{ label: t('Under Review', 'قيد المراجعة') }]),
    { label: t('Published', 'منشور') },
  ];
  const awaitingIdx = stageSteps.findIndex((s) => s.state === 'awaiting');
  const cur = project.status === 'published' ? steps.length
    : project.status === 'approved' ? steps.length - 1
    : project.status === 'rejected' ? 1
    : project.status === 'draft' ? 0
    : awaitingIdx >= 0 ? 2 + awaitingIdx : 2;
  return (
    <div className="st-stack">
    {project.status === 'published' && project.slug && (
      <div className="st-banner">
        <div><span className="st-banner__text">{t('Your project is live and publicly viewable.', 'مشروعك منشور ويمكن للجميع مشاهدته.')}</span></div>
        <Link to={`/projects/${project.slug}`} className="btn btn-primary">{t('View Public Project', 'عرض المشروع العام')}</Link>
      </div>
    )}
    {project.status === 'approved' && (
      <div className="st-alert"><Icon name="check-circle" size={16} /><span>{t('Your project is approved by all required reviewers. It is not public yet — publish it from the actions above when you are ready.', 'تم اعتماد مشروعك من كل الجهات المطلوبة. هو غير منشور للعامة بعد — انشره من الأزرار بالأعلى عند الجاهزية.')}</span></div>
    )}
    {project.status === 'rejected' && (
      <div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={16} /><span>{t('Changes were requested on this project. Update it and resubmit.', 'تم طلب تعديلات على هذا المشروع. حدّثه وأعد إرساله.')}</span></div>
    )}
    <section className="st-panel">
      <div className="st-panel__head"><h2>{t('Approval Progress', 'مراحل الاعتماد')}</h2>{project.status === 'rejected' && <Pill tone="warning">{t('Changes requested', 'مطلوب تعديلات')}</Pill>}</div>
      <Stepper steps={steps} current={cur} warn={project.status === 'rejected'} />
      {flow?.supervisor_unlinked && (
        <p className="st-muted" style={{ fontSize: 12.5, marginTop: 10 }}>{t('The supervisor name you typed was not matched to a single doctor account, so the supervisor stage is skipped. Add the doctor from search to include their approval.', 'اسم المشرف المكتوب لم يُربط بحساب دكتور واحد، لذلك تم تخطي مرحلة المشرف. أضف الدكتور من البحث ليدخل اعتماده في المسار.')}</p>
      )}
    </section>
    <div className="grid-2">
      <div className="glass-panel" style={{ padding: 'var(--space-5)' }}>
        <h2 className="text-h3">{t('Problem & Solution', 'وصف المشروع')}</h2>
        <p className="text-small">{project.description || project.summary?.[locale] || project.summary?.en || ''}</p>
        <div className="divider" />
        <h2 className="text-h3">{t('Tech Stack', 'التقنيات المستخدمة')}</h2>
        {allTags.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
            {allTags.map((tag, i) => <span key={i} className="badge badge-neutral">{tag}</span>)}
          </div>
        ) : (
          <p className="text-small" style={{ marginTop: 'var(--space-2)' }}>{t('No technologies added yet.', 'لم تُضف أي تقنيات بعد.')}</p>
        )}
      </div>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="card glass-panel">
          <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Project Info', 'معلومات المشروع')}</h2>
          <dl className="kv-list">
            <dt>{t('Category', 'التصنيف')}</dt><dd>{project.category?.[locale] || project.category?.en || '—'}</dd>
            <dt>{t('Supervisor', 'المشرف')}</dt><dd>{project.supervisor_name || '—'}</dd>
            <dt>{t('Created', 'تاريخ الإنشاء')}</dt><dd>{project.created_at ? new Date(project.created_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US') : '—'}</dd>
            <dt>{t('Published', 'تاريخ النشر')}</dt><dd>{project.published_at ? new Date(project.published_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US') : '—'}</dd>
          </dl>
        </div>
      </aside>
    </div>
    </div>
  );
}

function SubmissionPanel({ id, refreshKey, busy, onSubmit, t }) {
  const [check, setCheck] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/projects/${id}/submission-check`)
      .then((r) => { if (!cancelled) setCheck(r?.data || null); })
      .catch(() => { if (!cancelled) setCheck(null); });
    return () => { cancelled = true; };
  }, [id, refreshKey]);
  if (!check) return null;
  const blocking = check.blocking || [];
  const warnings = check.warnings || [];
  return (
    <section className="st-panel" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15, marginBottom: 10 }}>{t('Before you submit', 'قبل التقديم')}</h2>
      {check.deadline && (check.deadline.submission_deadline || check.deadline.defense_starts_at) && (
        <p className="st-muted" style={{ fontSize: 13, marginBottom: 10 }}>
          {check.deadline.submission_deadline ? `${t('Submission deadline', 'آخر موعد للتسليم')}: ${new Date(String(check.deadline.submission_deadline).replace(' ', 'T')).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          {check.deadline.defense_starts_at ? ` · ${t('Defense', 'المناقشة')}: ${check.deadline.defense_starts_at}${check.deadline.defense_ends_at ? ` → ${check.deadline.defense_ends_at}` : ''}` : ''}
        </p>
      )}
      {blocking.length === 0 && warnings.length === 0 && (
        <p className="st-muted" style={{ fontSize: 13.5 }}>{t('Everything required is in place.', 'كل المطلوب مستوفى.')}</p>
      )}
      {blocking.map((m, i) => (
        <div key={`b${i}`} className="st-alert st-alert--danger" style={{ marginBottom: 6 }}><Icon name="alert-triangle" size={16} /><span>{m}</span></div>
      ))}
      {warnings.map((m, i) => (
        <div key={`w${i}`} className="st-alert st-alert--warning" style={{ marginBottom: 6 }}><Icon name="alert-triangle" size={16} /><span>{m} {t('(optional)', '(اختياري)')}</span></div>
      ))}
      <p className="st-muted" style={{ fontSize: 12.5, margin: '10px 0' }}>{t('After submitting you cannot edit the project unless changes are requested.', 'بعد التقديم لا يمكن تعديل المشروع إلا إذا طُلبت تعديلات.')}</p>
      <button type="button" className="btn btn-primary" disabled={busy || blocking.length > 0} onClick={onSubmit}>
        <Icon name="check" size={18} /> {t('Submit for Approval', 'إرسال للاعتماد')}
      </button>
    </section>
  );
}

function GalleryTab({ media, t }) {
  const [lightbox, setLightbox] = useState(null);
  if (media.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><Icon name="image" size={24} /></div>
        <p className="text-small">{t('No media uploaded yet.', 'لا توجد وسائط مرفوعة بعد.')}</p>
      </div>
    );
  }
  const current = lightbox !== null ? media[lightbox] : null;
  return (
    <>
      <div className="pp-gallery">
        {media.map((m, i) => {
          const thumb = m.file_type === 'image' ? m.url : m.thumbnail_url;
          return (
            <button key={m.id} type="button" className="pp-gallery__item" onClick={() => setLightbox(i)}>
              {thumb ? <img src={thumb} alt={m.caption || ''} loading="lazy" /> : <div className="pp-gallery__placeholder"><Icon name="file" size={22} /></div>}
              {(m.caption || m.original_name) && <span className="pp-gallery__caption">{m.caption || m.original_name}</span>}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="pp-lightbox" onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}>
          <button type="button" className="pp-lightbox__close" onClick={() => setLightbox(null)}><Icon name="x" size={22} /></button>
          <div className="pp-lightbox__stage">
            {current.file_type === 'image' && <img src={current.url} alt={current.caption || ''} />}
            {current.file_type === 'video' && current.url && <VideoPlayer key={current.url} src={current.url} autoPlay />}
          </div>
        </div>
      )}
    </>
  );
}

function AnalyticsTab({ data, t }) {
  if (!data) return <p className="text-small">{t('Analytics are not available yet.', 'الإحصائيات غير متاحة بعد.')}</p>;

  const summary = data.summary || {};
  const trend = data.trend || [];
  const top = data.top || [];
  const cards = [
    { key: 'total_views', icon: 'eye', en: 'Total Views', ar: 'إجمالي المشاهدات' },
    { key: 'unique_views', icon: 'user', en: 'Unique Views', ar: 'مشاهدات فريدة' },
    { key: 'github_clicks', icon: 'github', en: 'GitHub Clicks', ar: 'نقرات GitHub' },
    { key: 'demo_clicks', icon: 'globe', en: 'Demo Clicks', ar: 'نقرات العرض' },
    { key: 'file_downloads', icon: 'download', en: 'Downloads', ar: 'تنزيلات' },
    { key: 'contact_requests', icon: 'mail', en: 'Contact Requests', ar: 'طلبات تواصل' },
  ];
  const maxViews = Math.max(1, ...trend.map((d) => Number(d.views) || 0));

  return (
    <div className="glass-panel" style={{ padding: 'var(--space-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        {cards.map((c) => (
          <div key={c.key} style={{ textAlign: 'center' }}>
            <div className="text-h2">{Number(summary[c.key]) || 0}</div>
            <span className="text-caption"><Icon name={c.icon} size={12} /> {t(c.en, c.ar)}</span>
          </div>
        ))}
      </div>

      {trend.length > 0 && trend.some((d) => Number(d.views) > 0) && (
        <>
          <h2 className="text-h3">{t('Views (last 14 days)', 'المشاهدات (آخر 14 يوم)')}</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100, marginTop: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            {trend.map((d, i) => (
              <div key={i} title={`${d.date}: ${d.views}`} style={{ flex: 1, background: 'var(--color-primary)', opacity: 0.7, borderRadius: 2, height: `${Math.max(4, (Number(d.views) / maxViews) * 100)}%` }} />
            ))}
          </div>
        </>
      )}

      {top.length > 0 && (
        <>
          <h2 className="text-h3">{t('Top Interactions', 'أكثر التفاعلات')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            {top.map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', padding: '4px 0' }}>
                <span className="text-small">{row.label || row.type}</span>
                <span className="text-small text-mono">{row.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ApprovalTab({ approval, canEdit, id, locale, t }) {
  const decision = approval?.latest_decision;
  const decisionLabelMap = {
    approved: { en: 'Approved', ar: 'تم الاعتماد' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    changes_requested: { en: 'Changes requested', ar: 'مطلوب تعديلات' },
  };
  const decisionLabel = decisionLabelMap[decision?.decision] || null;

  return (
    <section className="st-panel">
      <dl className="st-kv">
        <dt>{t('Current Status', 'الحالة الحالية')}</dt>
        <dd>{approval?.status ? <StatusPill status={approval.status} locale={locale} /> : '—'}</dd>
        <dt>{t('Submitted', 'تاريخ الإرسال')}</dt>
        <dd>{approval?.submitted_at ? new Date(approval.submitted_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US') : '—'}</dd>
      </dl>
      {approval?.flow && (
        <>
          <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '18px 0' }} />
          <h2 style={{ marginBottom: 10 }}>{t('Approval Path', 'مسار الاعتماد')}</h2>
          <ApprovalStages flow={approval.flow} status={approval.status} ar={locale === 'ar'} compact />
        </>
      )}
      <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '18px 0' }} />
      {decision ? (
        <div className="st-stack" style={{ gap: 10 }}>
          <h2>{t('Latest Reviewer Decision', 'أحدث قرار من المراجع')}</h2>
          <div className="st-row" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <Pill tone={decision.decision === 'approved' ? 'success' : decision.decision === 'rejected' ? 'danger' : 'warning'}>{decisionLabel ? t(decisionLabel.en, decisionLabel.ar) : decision.decision}</Pill>
            {decision.decided_at && <span className="st-muted" style={{ fontSize: 12 }}>{new Date(decision.decided_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</span>}
          </div>
          <p style={{ fontSize: 13.5 }}>{decision.comments || t('No written reason was attached by the reviewer.', 'لم يُرفق سبب مكتوب من المراجع.')}</p>
          {canEdit && (
            <Link to={`/student/projects/${id}/edit`} className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }}>
              <Icon name="edit" size={14} /> {t('Edit the project now', 'عدّل المشروع الآن')}
            </Link>
          )}
        </div>
      ) : (
        <p className="st-muted" style={{ fontSize: 13.5 }}>{t('No reviewer decision has been recorded yet.', 'لم يُسجَّل أي قرار من مراجع حتى الآن.')}</p>
      )}
      {approval?.supervisor_name && (
        <p className="st-muted" style={{ fontSize: 13, marginTop: 14 }}>{t('Supervisor', 'المشرف')}: {approval.supervisor_name}</p>
      )}
      {approval?.grade && (
        <div className="st-stack" style={{ gap: 6, marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <h2>{t('Final Grade', 'الدرجة النهائية')}</h2>
          <p style={{ fontSize: 15, fontWeight: 600 }}>{approval.grade.total_score} / {approval.grade.max_score} {approval.grade.letter_grade ? `(${approval.grade.letter_grade})` : ''}</p>
          {approval.grade.overall_comments && <p style={{ fontSize: 13.5 }}>{approval.grade.overall_comments}</p>}
          {approval.my_grade && approval.my_grade.final_percentage != null && (
            <div style={{ marginTop: 6 }}>
              <strong>{t('Your individual grade', 'درجتك الفردية')}:</strong>{' '}
              {Number(approval.my_grade.final_percentage).toFixed(1)}% {approval.my_grade.letter_grade ? `(${approval.my_grade.letter_grade})` : ''}
              {Number(approval.my_grade.adjustment) !== 0 && (
                <p className="st-muted" style={{ fontSize: 12.5 }}>
                  {t('Adjustment', 'التعديل')}: {Number(approval.my_grade.adjustment) > 0 ? '+' : ''}{Number(approval.my_grade.adjustment)}{approval.my_grade.comments ? ` — ${approval.my_grade.comments}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {(approval?.history || []).length > 1 && (
        <div className="st-stack" style={{ gap: 8, marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <h2>{t('Decision History', 'سجل القرارات')}</h2>
          {approval.history.map((h, i) => (
            <div key={i} style={{ fontSize: 13 }}>
              <strong>{(decisionLabelMap[h.decision] ? t(decisionLabelMap[h.decision].en, decisionLabelMap[h.decision].ar) : h.decision)}</strong>
              {h.stage ? ` · ${h.stage === 'admin_review' ? t('Platform admin', 'إدارة المنصة') : STAGE_LABEL(h.stage, locale === 'ar')}` : ''}
              {h.reviewer_name ? ` · ${h.reviewer_name}` : ''}{h.decided_at ? ` · ${new Date(h.decided_at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}` : ''}
              {h.comments ? <span className="st-muted"> — {h.comments}</span> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const LINK_TYPE_LABELS = {
  github: { en: 'GitHub', ar: 'GitHub' }, gitlab: { en: 'GitLab', ar: 'GitLab' },
  live_demo: { en: 'Live Demo', ar: 'عرض تجريبي' }, website: { en: 'Website', ar: 'موقع إلكتروني' },
  mobile_app: { en: 'Mobile App', ar: 'تطبيق جوال' }, documentation: { en: 'Documentation', ar: 'توثيق' },
  video_demo: { en: 'Video Demo', ar: 'فيديو توضيحي' }, presentation: { en: 'Presentation', ar: 'عرض تقديمي' },
  research_paper: { en: 'Research Paper', ar: 'ورقة بحثية' }, other: { en: 'Other', ar: 'أخرى' },
};

function LinksTab({ id, links, canEdit, t, reload, setActionError }) {
  const [type, setType] = useState('other');
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editRow, setEditRow] = useState({ type: 'other', url: '', label: '', is_primary: false });

  async function addLink(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/projects/${id}/links`, { type, url: url.trim(), label: label.trim() || undefined });
      setUrl(''); setLabel('');
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(l) {
    setEditingId(l.id);
    setEditRow({ type: l.type, url: l.url, label: l.label || '', is_primary: !!l.is_primary });
  }

  async function saveEdit(linkId) {
    setSaving(true);
    setActionError(null);
    try {
      await api.patch(`/api/v1/projects/${id}/links/${linkId}`, {
        type: editRow.type, url: editRow.url.trim(), label: editRow.label.trim() || undefined, is_primary: editRow.is_primary,
      });
      setEditingId(null);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteLink(linkId) {
    if (!window.confirm(t('Delete this link?', 'حذف هذا الرابط؟'))) return;
    try {
      await api.del(`/api/v1/projects/${id}/links/${linkId}`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="card glass-panel">
      {canEdit && (
        <form onSubmit={addLink} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
          <select className="form-select" style={{ flex: '0 0 auto' }} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(LINK_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{t(l.en, l.ar)}</option>)}
          </select>
          <input type="url" className="form-input" style={{ flex: 1, minWidth: 200 }} placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} required />
          <input type="text" className="form-input" style={{ flex: 1, minWidth: 140 }} placeholder={t('Label (optional)', 'تسمية (اختياري)')} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="submit" className="btn btn-outline btn-sm" disabled={saving}><Icon name="plus" size={14} /> {t('Add', 'إضافة')}</button>
        </form>
      )}
      {links.length === 0 ? (
        <p className="text-small">{t('No links added yet.', 'لا توجد روابط بعد.')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {links.map((l) => (
            editingId === l.id ? (
              <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <select className="form-select" value={editRow.type} onChange={(e) => setEditRow((r) => ({ ...r, type: e.target.value }))}>
                  {Object.entries(LINK_TYPE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{t(lbl.en, lbl.ar)}</option>)}
                </select>
                <input className="form-input" type="url" value={editRow.url} onChange={(e) => setEditRow((r) => ({ ...r, url: e.target.value }))} required />
                <input className="form-input" type="text" value={editRow.label} onChange={(e) => setEditRow((r) => ({ ...r, label: e.target.value }))} maxLength={150} />
                <label className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={editRow.is_primary} onChange={(e) => setEditRow((r) => ({ ...r, is_primary: e.target.checked }))} /> {t('Primary link', 'الرابط الأساسي')}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={() => saveEdit(l.id)}><Icon name="check" size={14} /> {t('Save', 'حفظ')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>{t('Cancel', 'إلغاء')}</button>
                </div>
              </div>
            ) : (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <Icon name={LINK_TYPE_ICON[l.type] || 'link'} size={16} />
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</a>
                {l.is_primary && <span className="badge badge-primary"><Icon name="star" size={10} /></span>}
                {canEdit && (
                  <>
                    <button type="button" className="text-caption" style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer' }} onClick={() => startEdit(l)}>{t('Edit', 'تعديل')}</button>
                    <button type="button" className="text-caption" style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }} onClick={() => deleteLink(l.id)}>{t('Delete', 'حذف')}</button>
                  </>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

const TEAM_ROLE_LABELS = {
  student_member: { en: 'Student Team Member', ar: 'عضو فريق (طالب)' },
  supervisor: { en: 'Supervisor (Doctor)', ar: 'دكتور مشرف' },
  teaching_assistant: { en: 'Teaching Assistant', ar: 'معيد' },
  principal_investigator: { en: 'Principal Investigator', ar: 'الباحث الرئيسي' },
  professor: { en: 'Professor', ar: 'أستاذ دكتور' },
  external_collaborator: { en: 'External Collaborator', ar: 'متعاون خارجي' },
  collaborator: { en: 'Collaborator', ar: 'متعاون' },
};

function TeamTab({ id, team, canEdit, isOwner, userId, t, reload, setActionError }) {
  const STAFF_ROLE_KEYS = ['supervisor', 'professor', 'principal_investigator', 'teaching_assistant'];
  const [name, setName] = useState('');
  const [role, setRole] = useState('student_member');
  const [year, setYear] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pickRole, setPickRole] = useState({});

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/api/v1/projects/${id}/team/search?q=${encodeURIComponent(term)}`);
        if (!cancelled) setResults(Array.isArray(res?.data) ? res.data : []);
      } catch (err) {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, id]);

  async function addUser(c) {
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/projects/${id}/team/add-user`, { user_id: c.user_id, role: pickRole[c.user_id] || c.allowed_roles[0], locale: 'ar' });
      setQ(''); setResults([]);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function addManual(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/projects/${id}/team/manual`, {
        name: name.trim(), role, academic_year: year || undefined, student_number: studentNumber.trim() || undefined, locale: 'ar',
      });
      setName(''); setYear(''); setStudentNumber('');
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(memberId) {
    if (!window.confirm(t('Remove this member?', 'إزالة هذا العضو؟'))) return;
    try {
      await api.del(`/api/v1/projects/${id}/team/${memberId}`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const initialsOf = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  return (
    <div className="st-stack">
      {team.length === 0 ? (
        <div className="st-empty">
          <Icon name="users" size={28} />
          <strong>{t('No team members added yet.', 'لا يوجد أعضاء فريق بعد.')}</strong>
        </div>
      ) : (
        <div className="st-grid st-grid--2">
          {team.map((m) => {
            const st = TEAM_STATUS_BADGE[m.status] || { cls: 'badge-neutral', en: m.status, ar: m.status };
            const tone = /success/.test(st.cls) ? 'success' : /warning/.test(st.cls) ? 'warning' : /danger/.test(st.cls) ? 'danger' : 'neutral';
            return (
              <div key={m.id} className="st-panel st-row" style={{ padding: 16, gap: 12 }}>
                <div className="st-row" style={{ justifyContent: 'flex-start', gap: 12, minWidth: 0 }}>
                  <span className="sidebar__user-avatar" style={{ width: 38, height: 38 }}>{initialsOf(m.display_name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.display_name}</strong>
                    <span className="st-muted" style={{ fontSize: 12 }}>{t((TEAM_ROLE_LABELS[m.role] || {}).en || m.role, (TEAM_ROLE_LABELS[m.role] || {}).ar || m.role)}</span>
                  </div>
                </div>
                <div className="st-row" style={{ gap: 8, flexShrink: 0 }}>
                  <Pill tone={tone}>{t(st.en, st.ar)}</Pill>
                  {canEdit && (isOwner || (userId != null && Number(m.invited_by) === Number(userId) && !STAFF_ROLE_KEYS.includes(m.role))) && <button type="button" className="st-link st-btn-danger" onClick={() => remove(m.id)} aria-label={t('Remove', 'إزالة')}><Icon name="trash" size={15} /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <section className="st-panel">
          <h2 style={{ marginBottom: 14 }}>{t('Add team members', 'إضافة أعضاء للفريق')}</h2>
          <div style={{ paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
            <input type="search" className="form-input" style={{ width: '100%' }} placeholder={t('Search a student, doctor or TA by name, email or ID', 'ابحث عن طالب أو دكتور أو معيد بالاسم أو الإيميل أو الكود')} value={q} onChange={(e) => setQ(e.target.value)} />
            {searching && <p className="st-muted" style={{ fontSize: 12, marginTop: 8 }}>{t('Searching…', 'جارِ البحث…')}</p>}
            {!searching && q.trim().length >= 2 && results.length === 0 && <p className="st-muted" style={{ fontSize: 12, marginTop: 8 }}>{t('No matching accounts in your university.', 'لا توجد حسابات مطابقة في جامعتك.')}</p>}
            {results.length > 0 && (
              <div className="st-grid" style={{ marginTop: 10, gap: 8 }}>
                {results.map((c) => (
                  <div key={c.user_id} className="st-panel st-row" style={{ padding: 12, gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5, display: 'block' }}>{c.full_name}</strong>
                      <span className="st-muted" style={{ fontSize: 12 }}>{c.email}{c.code ? ` · ${c.code}` : ''} · {c.kind === 'academic_staff' ? t('Doctor / TA', 'دكتور / معيد') : t('Student', 'طالب')}</span>
                    </div>
                    <div className="st-row" style={{ gap: 8, flexShrink: 0 }}>
                      {c.allowed_roles.length > 1 && (
                        <select className="form-select" value={pickRole[c.user_id] || c.allowed_roles[0]} onChange={(e) => setPickRole((r) => ({ ...r, [c.user_id]: e.target.value }))}>
                          {c.allowed_roles.map((r) => <option key={r} value={r}>{t((TEAM_ROLE_LABELS[r] || {}).en || r, (TEAM_ROLE_LABELS[r] || {}).ar || r)}</option>)}
                        </select>
                      )}
                      <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => addUser(c)}><Icon name="plus" size={14} /> {t('Add', 'إضافة')}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={addManual} className="st-form">
            <div className="st-form__grid">
              <input type="text" className="form-input" placeholder={t("Teammate's name", 'اسم الزميل')} value={name} onChange={(e) => setName(e.target.value)} required />
              <select className="form-select" value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.entries(TEAM_ROLE_LABELS).filter(([k]) => k !== 'supervisor' && (isOwner || ['student_member', 'collaborator', 'external_collaborator'].includes(k))).map(([k, l]) => <option key={k} value={k}>{t(l.en, l.ar)}</option>)}
              </select>
              <input type="number" min={1} max={10} className="form-input" placeholder={t('Academic year', 'السنة الدراسية')} value={year} onChange={(e) => setYear(e.target.value)} />
              <input type="text" className="form-input" placeholder={t('Student ID', 'الرقم الجامعي')} value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-outline btn-sm" disabled={saving} style={{ alignSelf: 'flex-start' }}><Icon name="plus" size={16} /> {t('Add member without an account', 'إضافة عضو بدون حساب')}</button>
          </form>
        </section>
      )}
    </div>
  );
}

function DiscussionTab({ id, discussion, t, reload, setActionError }) {
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);

  async function post(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setPosting(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/projects/${id}/discussion`, { message: message.trim() });
      setMessage('');
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="card glass-panel">
      <form onSubmit={post} style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <input type="text" className="form-input" style={{ flex: 1 }} placeholder={t('Write a message to your team…', 'اكتب رسالة لفريقك…')} value={message} onChange={(e) => setMessage(e.target.value)} required />
        <button type="submit" className="btn btn-primary btn-sm" disabled={posting}><Icon name="send" size={14} /> {t('Send', 'إرسال')}</button>
      </form>
      {discussion.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon"><Icon name="message" size={24} /></div>
          <p className="text-small">{t('No messages yet on this project.', 'لا توجد رسائل بعد على هذا المشروع.')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {discussion.map((msg) => (
            <div key={msg.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-small" style={{ fontWeight: 600 }}>{msg.author_name}{msg.author_kind === 'staff' ? ` · ${t('Reviewer', 'المشرف / المراجع')}` : ''}</span>
                <span className="text-caption">{msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</span>
              </div>
              <p className="text-small" style={{ margin: 0 }}>{msg.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityTab({ activity, t }) {
  if (activity.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><Icon name="clock" size={24} /></div>
        <p className="text-small">{t('No activity recorded yet.', 'لا يوجد نشاط مسجل بعد.')}</p>
      </div>
    );
  }
  return (
    <div className="glass-panel" style={{ padding: 'var(--space-5)' }}>
      <div className="timeline">
        {activity.map((ev, i) => (
          <div key={ev.id || i} className="timeline-item is-done">
            <div className="timeline-item__dot"><Icon name="clock" size={14} /></div>
            <div>
              <p className="text-small" style={{ margin: 0, color: 'var(--text-primary)' }}>{ev.description || ev.type || ev.action || ''}</p>
              <span className="text-caption">{ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeReviewTab({ id, project, review, canEdit, t, reload, setActionError }) {
  const [running, setRunning] = useState(false);
  const hasRepo = !!project.repo_url;

  async function run() {
    setRunning(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/projects/${id}/code-review/run`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card glass-panel">
      {!hasRepo && !review ? (
        <p className="text-small">{t('Link a GitHub repo from the project edit page to enable analysis.', 'اربط مستودع GitHub من صفحة تعديل المشروع لتفعيل التحليل.')}</p>
      ) : !review ? (
        <>
          <p className="text-small">{t('Repository linked. Run your first review now.', 'المستودع مربوط. شغّل أول مراجعة الآن.')}</p>
          {canEdit && <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-3)' }} disabled={running} onClick={run}><Icon name="terminal" size={16} /> {t('Run Review', 'تشغيل المراجعة')}</button>}
        </>
      ) : review.status === 'failed' ? (
        <>
          <span className="badge badge-danger"><Icon name="alert-triangle" size={12} /> {t('Last attempt failed', 'فشلت آخر محاولة')}</span>
          <p className="text-small" style={{ marginTop: 'var(--space-2)' }}>{review.summary}</p>
          {canEdit && <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-3)' }} disabled={running} onClick={run}>{t('Try again', 'إعادة المحاولة')}</button>}
        </>
      ) : (
        <CodeReviewReportPanel
          projectId={id}
          className=""
          showTitle={false}
          refreshKey={review.id || review.version || 1}
          actions={canEdit && <button type="button" className="btn btn-outline btn-sm" disabled={running} onClick={run}><Icon name="refresh" size={14} /> {t('Re-run review', 'إعادة التحليل')}</button>}
          footer={<p className="text-caption" style={{ marginTop: 14, opacity: 0.75 }}>{t('Your doctor, teaching assistant, faculty and university can see this report together with your code.', 'يظهر هذا التقرير للدكتور والمعيد والكلية والجامعة مع الكود الخاص بك.')}</p>}
        />
      )}
    </div>
  );
}
