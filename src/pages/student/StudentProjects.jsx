import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { StatusPill, EmptyState, Skeleton, loc, timeAgo } from '../../components/student/stUi';

// Tabs bucket the real workflow status (draft/submitted/under_review/rejected/
// published/archived — see Project::toResearchCardArray()). The design's
// "Changes Requested" is `rejected`. `approved` (معتمد) is separate from `published`:
// the owner publishes an approved project to the public as a distinct step.
const TABS = [
  { key: 'all', en: 'All', ar: 'الكل', statuses: null },
  { key: 'draft', en: 'Drafts', ar: 'المسودات', statuses: ['draft'] },
  { key: 'review', en: 'Under Review', ar: 'قيد المراجعة', statuses: ['submitted', 'under_review'] },
  { key: 'changes', en: 'Changes Requested', ar: 'مطلوب تعديلات', statuses: ['rejected'] },
  { key: 'approved', en: 'Approved', ar: 'معتمد', statuses: ['approved'] },
  { key: 'published', en: 'Published', ar: 'منشور', statuses: ['published'] },
  { key: 'archived', en: 'Archived', ar: 'مؤرشف', statuses: ['archived'] },
];
const EDITABLE = ['draft', 'rejected'];

function initialsOf(name) {
  const parts = String(name || '').replace(/^(Dr\.?|د\.?)\s*/i, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

function ProjectCard({ project: p, locale, onUnarchive }) {
  const ar = locale === 'ar';
  const category = loc(p.category, locale);
  const supervisor = p.supervisor_name;
  const updated = timeAgo(p.updated_at, locale);
  const href = `/student/projects/${encodeURIComponent(p.id)}`;
  return (
    <article className="st-pcard">
      <div className="st-pcard__top">
        {category ? <span className="st-tag">{category}</span> : <span />}
        <StatusPill status={p.status} locale={locale} />
      </div>
      <h3><Link to={href}>{loc(p.title, locale)}</Link></h3>
      {supervisor && <p className="st-pcard__sub">{supervisor}</p>}
      <div className="st-pcard__meta">
        <span className="st-pcard__score">
          <span className="st-mini-avatar">{initialsOf(supervisor) || <Icon name="sparkles" size={11} />}</span>
          {ar ? 'الجاهزية' : 'AI Readiness'} {p.score ? `${Math.round(p.score)}` : '—'}
        </span>
        {updated && <span>{updated}</span>}
      </div>
      {p.status === 'archived' ? (
        <div className="st-pcard__actions">
          <Link to={href} className="btn btn-outline btn-sm">{ar ? 'عرض' : 'View'}</Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onUnarchive(p.id)}>
            {ar ? 'استرجاع كمسودة' : 'Restore to Draft'}
          </button>
        </div>
      ) : (
        <div className="st-pcard__actions">
          <Link to={href} className="btn btn-outline btn-sm">{ar ? 'عرض' : 'View'}</Link>
          {EDITABLE.includes(p.status)
            ? <Link to={`${href}/edit`} className="btn btn-primary btn-sm">{ar ? 'تعديل' : 'Edit'}</Link>
            : <Link to={href} className="btn btn-primary btn-sm">{ar ? 'التفاصيل' : 'Details'}</Link>}
        </div>
      )}
    </article>
  );
}

/**
 * Student "My Projects" (Student design). Talks to GET /api/v1/projects
 * (ProjectsApiController::index()) exactly as before; cards link to
 * /student/projects/{id} (StudentProjectDetail) and /edit.
 */
export default function StudentProjects() {
  const { locale } = useLanguage();
  const { can } = useAuth();
  const ar = locale === 'ar';
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  usePageMeta(ar ? 'مشاريعي' : 'My Projects', ar ? 'أدر وتابع مشاريع التخرج الخاصة بك.' : 'Manage and track all of your graduation projects.');

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('all');
  const [category, setCategory] = useState('');
  const query = params.get('q') || '';
  const [flash, setFlash] = useState(location.state?.flash || null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (location.state?.flash) navigate(location.pathname + location.search, { replace: true, state: {} });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v1/projects')
      .then((json) => setProjects(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function unarchive(uuid) {
    setActionError(null);
    try { await api.post(`/api/v1/projects/${uuid}/unarchive`); load(); }
    catch (err) { setActionError(errorMessage(err)); }
  }

  const categories = useMemo(
    () => [...new Set(projects.map((p) => loc(p.category, locale)).filter(Boolean))],
    [projects, locale],
  );
  const countFor = (t) => (t.statuses ? projects.filter((p) => t.statuses.includes(p.status)).length : projects.length);

  const filtered = useMemo(() => {
    const t = TABS.find((x) => x.key === tab);
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (t?.statuses && !t.statuses.includes(p.status)) return false;
      if (category && loc(p.category, locale) !== category) return false;
      if (q && !`${loc(p.title, locale)} ${loc(p.summary, locale)} ${loc(p.category, locale)} ${p.supervisor_name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, tab, category, query, locale]);

  const setQuery = (v) => { const n = new URLSearchParams(params); if (v) n.set('q', v); else n.delete('q'); setParams(n, { replace: true }); };

  return (
    <div className="st-page">
      {flash && (
        <div className={`st-alert ${flash.type === 'warning' ? 'st-alert--warning' : 'st-alert--success'}`}>
          <Icon name={flash.type === 'warning' ? 'alert-triangle' : 'check-circle'} size={16} />
          <span style={{ flex: 1 }}>{flash.message}</span>
          <button type="button" className="st-link" onClick={() => setFlash(null)} aria-label={locale === 'ar' ? 'إغلاق' : 'Dismiss'}><Icon name="x" size={14} /></button>
        </div>
      )}
      {actionError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{actionError}</span></div>}

      <div className="st-row st-projects-head">
        <div className="st-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`st-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
              {ar ? t.ar : t.en}
              {!loading && <span className="st-tab__count">{countFor(t)}</span>}
            </button>
          ))}
        </div>
        {can('project.create') && <Link to="/student/projects/create" className="btn btn-primary"><Icon name="plus" size={16} /> {ar ? 'إنشاء مشروع' : 'Create Project'}</Link>}
      </div>

      <div className="st-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ar ? 'ابحث في المشاريع…' : 'Search projects…'} aria-label={ar ? 'بحث' : 'Search'} />
        </label>
        {categories.length > 0 && (
          <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={ar ? 'التصنيف' : 'Category'}>
            <option value="">{ar ? 'كل التصنيفات' : 'All categories'}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <Skeleton h={170} count={2} />
      ) : error ? (
        <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="folder"
          title={projects.length === 0 ? (ar ? 'لا توجد مشاريع بعد' : 'No projects yet') : (ar ? 'لا توجد مشاريع في هذا التصنيف' : 'No projects in this category')}
          text={projects.length === 0 ? (ar ? 'ابدأ بإنشاء أول مشروع تخرج لك.' : 'Start a new project to see it appear here.') : (ar ? 'جرّب تصنيفًا آخر أو غيّر البحث.' : 'Try another tab or change your search.')}
        >
          {can('project.create') && <Link to="/student/projects/create" className="btn btn-primary"><Icon name="plus" size={16} /> {ar ? 'إنشاء مشروع' : 'Create Project'}</Link>}
        </EmptyState>
      ) : (
        <div className="st-cards">
          {filtered.map((p) => <ProjectCard key={p.id} project={p} locale={locale} onUnarchive={unarchive} />)}
        </div>
      )}
    </div>
  );
}
