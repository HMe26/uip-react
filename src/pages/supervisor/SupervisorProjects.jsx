import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { api, errorMessage } from '../../api/client';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { StaffHead, StaffKpi, PersonAvatar, StaffPagination } from '../../components/staff/stfUi';
import { Pill, EmptyState, Skeleton } from '../../components/student/stUi';
import DecisionDialog from '../../components/university/DecisionDialog';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/supervisor/projects';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/supervisor/projects.php, talking to the real JSON API
 * (GET/POST /api/v1/supervisor/projects* — SupervisorProjectsApiController,
 * a JSON port of Supervisor\SupervisorProjectController::index()/approve()/
 * reject()/requestChanges()). Same rule the PHP view enforced: the
 * approve/reject/request-changes buttons only ever render for a 'submitted'
 * project when the caller has 'manage_projects' — no button lets a
 * supervisor act outside status or permission, the server re-checks both
 * plus scope anyway. The rubric grading link ("Grade project" in the old
 * view) is now wired up (item 14, Graduation) — GET/POST
 * /api/v1/supervisor/projects/{id}/grade, same status set the old view
 * gated it on (submitted/published/rejected; a never-submitted draft can't
 * be graded).
 */

const PER_PAGE = 10;
const EMPTY_COUNTS = { all: 0, submitted: 0, approved: 0, published: 0, rejected: 0, draft: 0 };

const GRADABLE_STATUSES = ['submitted', 'approved', 'published', 'rejected'];

// Design wording ("Pending Review / Approved / Rejected") on top of the real
// statuses: submitted = awaiting this supervisor, published = approved & live.
const STATUS_META = {
  draft:     { tone: 'neutral', en: 'Draft',          ar: 'مسودة' },
  submitted: { tone: 'warning', en: 'Pending Review', ar: 'بانتظار المراجعة' },
  approved:  { tone: 'success', en: 'Approved',       ar: 'معتمد' },
  published: { tone: 'success', en: 'Published',      ar: 'منشور' },
  rejected:  { tone: 'danger',  en: 'Rejected',       ar: 'مرفوض' },
};

export default function SupervisorProjects() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ can_manage: false, has_scope: false, status: 'all' });
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { p, action } while the comment dialog is open
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = { page, per_page: PER_PAGE };
    if (status !== 'all') params.status = status;
    if (search) params.q = search;
    api.get('/api/v1/supervisor/projects', params)
      .then((json) => {
        setRows(json.data || []);
        setMeta(json.meta || {});
        // Server clamps the page (e.g. after the last row of a page was acted on).
        if (json.meta?.page && json.meta.page !== page) setPage(json.meta.page);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, status, search]);

  useEffect(() => { load(); }, [load]);

  async function decide(project, action, comments = '') {
    setBusyId(project.uuid);
    setActionError(null);
    try {
      await api.post(`/api/v1/supervisor/projects/${encodeURIComponent(project.uuid)}/${action}`, { comments });
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const ar = locale === 'ar';
  const TABS = [
    { key: 'all', en: 'All', ar: 'الكل' },
    { key: 'submitted', en: 'Pending Review', ar: 'بانتظار المراجعة' },
    { key: 'approved', en: 'Approved', ar: 'معتمد' },
    { key: 'published', en: 'Published', ar: 'منشور' },
    { key: 'rejected', en: 'Rejected', ar: 'مرفوض' },
  ];
  const counts = { ...EMPTY_COUNTS, ...(meta.counts || {}) };
  const countOf = (k) => counts[k] ?? 0;
  const total = meta.total ?? rows.length;
  const totalPages = meta.total_pages ?? 1;
  const shown = rows;
  const hasFilters = status !== 'all' || search !== '';

  return (
    <div className="st-page">
      <StaffHead
        crumbs={[{ label: ar ? 'لوحة التحكم' : 'Dashboard', to: '/supervisor/dashboard' }, { label: ar ? 'الإشراف على المشاريع' : 'Project Supervision' }]}
        title={ar ? 'الإشراف على المشاريع' : 'Project Supervision'}
        subtitle={t('Only the projects within the scope your university assigned you.')}
      />

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {actionError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{actionError}</span></div>}

      {!loading && !error && meta.has_scope === false ? (
        <EmptyState icon="folder" title={ar ? 'لم يتم إسناد أي نطاق لك بعد.' : "You haven't been assigned a scope yet."} />
      ) : (
        <>
          <div className="stf-kpis">
            <StaffKpi value={countOf('all')} label={ar ? 'المشاريع المُسندة' : 'Assigned Projects'} icon="folder" />
            <StaffKpi value={countOf('submitted')} label={ar ? 'بانتظار المراجعة' : 'Pending Review'} icon="clock" tone="warn" />
            <StaffKpi value={countOf('rejected')} label={ar ? 'مرفوضة' : 'Rejected'} icon="x-circle" tone="bad" />
            <StaffKpi value={countOf('approved') + countOf('published')} label={ar ? 'معتمدة' : 'Approved'} icon="check-circle" tone="good" />
          </div>

          <div className="st-tabs" role="tablist">
            {TABS.map((tb) => (
              <button key={tb.key} type="button" role="tab" aria-selected={status === tb.key} className={`st-tab${status === tb.key ? ' is-active' : ''}`} onClick={() => { setStatus(tb.key); setPage(1); }}>
                {ar ? tb.ar : tb.en}{tb.key !== 'all' && <span className="st-tab__count">{countOf(tb.key)}</span>}
              </button>
            ))}
          </div>

          <div className="stf-toolbar">
            <label className="st-search">
              <Icon name="search" size={16} />
              <input className="form-input" type="search" placeholder={ar ? 'ابحث عن مشاريع أو طلاب…' : 'Search projects or students…'} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          {loading && shown.length === 0 ? <Skeleton h={64} count={4} /> : shown.length === 0 ? (
            <EmptyState icon="folder" title={!hasFilters && total === 0 ? t('No projects currently fall within your scope.') : (ar ? 'لا توجد مشاريع مطابقة' : 'No matching projects')} />
          ) : (
            <div className="stf-table-card" style={loading ? { opacity: 0.6, transition: 'opacity .15s' } : undefined}>
              <div className="st-table-wrap">
              <table className="st-table">
                <thead>
                  <tr>
                    <th>{ar ? 'المشروع' : 'Project'}</th>
                    <th>{ar ? 'الكلية' : 'Faculty'}</th>
                    <th>{t('Status')}</th>
                    <th style={{ textAlign: 'end' }}>{ar ? 'الإجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const sMeta = STATUS_META[p.status] || STATUS_META.draft;
                    const title = ar ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar);
                    const busy = busyId === p.uuid;
                    // قرار المشرف-بنطاق = مرحلة الجامعة: بيتفتح بس لما يجي دورها (بعد الدكتور المشرف والكلية).
                    const canDecide = p.status === 'submitted' && meta.can_manage && p.awaiting === 'university_review';
                    const waiting = p.status === 'submitted' && p.awaiting && p.awaiting !== 'university_review';
                    return (
                      <tr key={p.uuid}>
                        <td style={{ whiteSpace: 'normal', minWidth: 200 }}>
                          <div className="stf-person"><PersonAvatar name={p.owner_name || title} /><div><strong>{title}</strong><small>{p.owner_name || ''}</small></div></div>
                        </td>
                        <td className="st-muted">{p.owner_faculty || '—'}</td>
                        <td><Pill tone={sMeta.tone}>{sMeta[locale] || sMeta.en}</Pill></td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {waiting && <span className="st-muted" style={{ fontSize: 12.5 }}>{ar ? 'بانتظار اعتماد مراحل سابقة (دكتور مشرف / كلية)' : 'Awaiting earlier approvals (supervisor doctor / faculty)'}</span>}
                            {canDecide && (
                              <>
                                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(p, 'approve')}><Icon name="check" size={14} /> {t('Approve')}</button>
                                <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setDialog({ p, action: 'request-changes' })}><Icon name="edit" size={14} /> {t('Request Changes')}</button>
                                <button type="button" className="btn btn-outline btn-sm st-btn-danger" disabled={busy} onClick={() => setDialog({ p, action: 'reject' })}><Icon name="x" size={14} /> {t('Reject')}</button>
                              </>
                            )}
                            {GRADABLE_STATUSES.includes(p.status) && (
                              <Link to={`/supervisor/projects/${encodeURIComponent(p.uuid)}/grade`} className={canDecide ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'} title={t('Grade project')}>
                                <Icon name="award" size={14} /> {t('Grade project')}
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <StaffPagination page={meta.page || page} totalPages={totalPages} total={total} perPage={meta.per_page || PER_PAGE} onPage={(n) => { setPage(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </div>
          )}
        </>
      )}

      {dialog && <DecisionDialog action={dialog.action} ar={ar} busy={!!busyId} onCancel={() => setDialog(null)} onConfirm={(c) => { const d = dialog; setDialog(null); decide(d.p, d.action, c); }} />}
    </div>
  );
}
