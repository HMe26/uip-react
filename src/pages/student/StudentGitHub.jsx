import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { EmptyState } from '../../components/student/stUi';
import GithubConnectCard from '../../components/student/GithubConnectCard';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/github';
import { parseServerDate } from '../../utils/serverDate';
import { isValidGithubRepoUrl } from '../../utils/github';

const translations = { ...i18nCommon, ...i18nPage };

function timeAgo(dateStr, locale) {
  if (!dateStr) return '';
  const diff = (Date.now() - parseServerDate(dateStr).getTime()) / 1000;
  const units = locale === 'ar'
    ? [[31536000, 'سنة'], [2592000, 'شهر'], [86400, 'يوم'], [3600, 'ساعة'], [60, 'دقيقة']]
    : [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  if (diff < 60) return locale === 'ar' ? 'الآن' : 'just now';
  for (const [secs, label] of units) {
    if (diff >= secs) {
      const n = Math.floor(diff / secs);
      return locale === 'ar' ? `منذ ${n} ${label}` : `${n}${label} ago`;
    }
  }
  return '';
}

/** "https://github.com/owner/repo(.git)" → "owner/repo" (falls back to the raw URL). */
function repoSlug(url) {
  if (!url) return '';
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
  } catch { /* not a parsable URL */ }
  return url;
}

/** One normalised state per repo, drives the badge, the filters and the review block. */
function repoState(r) {
  if (!r.is_connected) return 'disconnected';
  if (!isValidGithubRepoUrl(r.repository_url)) return 'invalid';
  if (r.sync_status === 'error') return 'error';
  if (!r.review_status) return 'unreviewed';
  if (r.review_status === 'failed') return 'failed';
  return (r.issues_found ?? 0) > 0 ? 'issues' : 'clean';
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'connected', label: 'Connected' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'disconnected', label: 'Not connected' },
];

function matchesFilter(state, filter) {
  if (filter === 'all') return true;
  if (filter === 'connected') return state !== 'disconnected' && state !== 'invalid';
  if (filter === 'disconnected') return state === 'disconnected';
  return ['invalid', 'error', 'failed', 'issues', 'unreviewed'].includes(state);
}

function Stat({ icon, value, label, tone = '' }) {
  return (
    <div className={`gh-stat${tone ? ` gh-stat--${tone}` : ''}`}>
      <span className="gh-stat__icon"><Icon name={icon} size={18} /></span>
      <span className="gh-stat__value">{value}</span>
      <span className="gh-stat__label">{label}</span>
    </div>
  );
}

function RepoCard({ r, t, locale, isRunning, onRun, filesOpen, files, filesLoading, onToggleFiles }) {
  const state = repoState(r);
  const title = locale === 'ar' ? (r.title_ar || r.title_en) : (r.title_en || r.title_ar);
  const cover = r.cover_image_path ? `/${r.cover_image_path.replace(/^\//, '')}` : '';
  const uuid = encodeURIComponent(r.project_uuid);
  const busyLabel = t('Loading…');

  const badge = {
    disconnected: { tone: 'neutral', icon: 'link', text: t('Not connected') },
    invalid: { tone: 'danger', icon: 'alert-triangle', text: t('Invalid link') },
    error: { tone: 'danger', icon: 'alert-triangle', text: t('Sync error') },
    unreviewed: { tone: 'info', icon: 'check-circle', text: t('Connected') },
    failed: { tone: 'danger', icon: 'alert-triangle', text: t('Review failed') },
    issues: { tone: 'warning', icon: 'alert-triangle', text: t('Connected') },
    clean: { tone: 'success', icon: 'check-circle', text: t('Connected') },
  }[state];

  return (
    <article className={`gh-card gh-card--${state}`}>
      <div className="gh-card__cover">
        {cover
          ? <img src={cover} alt={title} loading="lazy" />
          : <span className="gh-card__placeholder"><Icon name="github" size={34} /></span>}
        <span className={`gh-badge gh-badge--${badge.tone}`}><Icon name={badge.icon} size={12} /> {badge.text}</span>
      </div>

      <div className="gh-card__body">
        <h2 className="gh-card__title">{title}</h2>

        {state === 'invalid' ? (
          <span className="gh-repo gh-repo--bad" dir="ltr"><Icon name="alert-triangle" size={14} /><span>{r.repository_url}</span></span>
        ) : r.is_connected ? (
          <a className="gh-repo" href={r.repository_url} target="_blank" rel="noopener noreferrer" dir="ltr">
            <Icon name="github" size={14} />
            <span>{repoSlug(r.repository_url)}</span>
          </a>
        ) : (
          <p className="gh-card__hint">{t('Link a GitHub repo from the project edit page to enable analysis.')}</p>
        )}

        {state !== 'invalid' && r.is_connected && (r.default_branch || r.last_synced_at) && (
          <div className="gh-meta">
            {r.default_branch && <span className="gh-meta__item" dir="ltr"><Icon name="terminal" size={12} /> {r.default_branch}</span>}
            {r.last_synced_at && <span className="gh-meta__item"><Icon name="clock" size={12} /> {t('Synced')} {timeAgo(r.last_synced_at, locale)}</span>}
          </div>
        )}

        {/* ---- Review block ------------------------------------------------ */}
        {state !== 'disconnected' && (
          <div className={`gh-review gh-review--${state}`}>
            {state === 'invalid' && <p>{t('This is not a GitHub repository link, so it cannot be reviewed. Fix it from the project edit page.')}</p>}
            {state === 'unreviewed' && <p>{t('Repository linked. Run your first review now.')}</p>}
            {state === 'error' && <p>{t('We could not sync this repository. Check the link and try again.')}</p>}
            {state === 'failed' && <p>{r.review_summary || t('The last review failed.')}</p>}
            {(state === 'issues' || state === 'clean') && (
              <>
                <span className="gh-review__count">{r.issues_found ?? 0}</span>
                <div className="gh-review__text">
                  <strong>{state === 'clean' ? t('No issues found') : t('issue(s) flagged')}</strong>
                  <span>{timeAgo(r.review_created_at, locale)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- Files ------------------------------------------------------- */}
        {filesOpen && (
          <div className="gh-files">
            {filesLoading && !files ? (
              <p className="gh-files__empty">{busyLabel}</p>
            ) : !files || files.length === 0 ? (
              <p className="gh-files__empty">{t('No files uploaded yet.')}</p>
            ) : (
              <ul>
                {files.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noopener noreferrer">
                      <Icon name="file" size={14} />
                      <span className="gh-files__name">{f.original_name}</span>
                      <span className="gh-files__size" dir="ltr">{f.extension} · {f.size_human}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ---- Actions ------------------------------------------------------- */}
      <footer className="gh-card__actions">
        {(state === 'disconnected' || state === 'invalid') && (
          <Link to={`/student/projects/${uuid}/edit`} className="btn btn-primary btn-sm">
            <Icon name="link" size={14} /> {state === 'invalid' ? t('Fix link') : t('Connect repository')}
          </Link>
        )}
        {(state === 'unreviewed') && (
          <button type="button" className="btn btn-primary btn-sm" disabled={isRunning} onClick={onRun}>
            <Icon name="refresh" size={14} /> {isRunning ? busyLabel : t('Run Review')}
          </button>
        )}
        {(state === 'failed' || state === 'error') && (
          <button type="button" className="btn btn-primary btn-sm" disabled={isRunning} onClick={onRun}>
            <Icon name="refresh" size={14} /> {isRunning ? busyLabel : t('Try again')}
          </button>
        )}
        {(state === 'issues' || state === 'clean') && (
          <>
            <Link to={`/student/projects/${uuid}`} className="btn btn-primary btn-sm">{t('View full details')}</Link>
            <button type="button" className="btn btn-outline btn-sm" disabled={isRunning} onClick={onRun}>
              <Icon name="refresh" size={14} /> {isRunning ? busyLabel : t('Re-run review')}
            </button>
          </>
        )}
        <span className="gh-card__spacer" />
        {r.live_demo_url && (
          <a href={r.live_demo_url} target="_blank" rel="noopener noreferrer" className="gh-iconbtn" title={t('Visit demo')} aria-label={t('Visit demo')}>
            <Icon name="link" size={16} />
          </a>
        )}
        <button type="button" className={`gh-iconbtn${filesOpen ? ' is-on' : ''}`} onClick={onToggleFiles} title={filesOpen ? t('Hide files') : t('Files')} aria-label={filesOpen ? t('Hide files') : t('Files')} aria-expanded={filesOpen}>
          <Icon name="folder" size={16} />
        </button>
      </footer>
    </article>
  );
}

/**
 * Mirrors app/Views/student/github.php (Student\StudentGitHubController::index()),
 * talking to the real JSON API instead: GET /api/v1/projects/github
 * (App\Controllers\Api\ProjectsApiController::githubOverview(), reusing
 * GithubCodeReviewService::forOwner() exactly like the PHP view). "Run
 * Review" / "Re-run review" / "Try again" all post to the same real
 * POST /api/v1/projects/{id}/code-review/run action.
 */
export default function StudentGitHub() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  usePageMeta(t('GitHub Integration'), t('GitHub link and code review status across all of your projects, in one place.'));

  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [runError, setRunError] = useState(null);
  const [openFilesFor, setOpenFilesFor] = useState(null);
  const [filesById, setFilesById] = useState({});
  const [filesLoading, setFilesLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v1/projects/github')
      .then((json) => setRepos(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const runReview = async (projectUuid) => {
    setRunningId(projectUuid);
    setRunError(null);
    try {
      await api.post(`/api/v1/projects/${encodeURIComponent(projectUuid)}/code-review/run`, {});
      load();
    } catch (err) {
      setRunError(errorMessage(err));
    } finally {
      setRunningId(null);
    }
  };

  const toggleFiles = async (projectUuid) => {
    if (openFilesFor === projectUuid) {
      setOpenFilesFor(null);
      return;
    }
    setOpenFilesFor(projectUuid);
    if (!filesById[projectUuid]) {
      setFilesLoading(true);
      try {
        const json = await api.get(`/api/v1/projects/${encodeURIComponent(projectUuid)}/files`);
        setFilesById((prev) => ({ ...prev, [projectUuid]: json.data || [] }));
      } catch {
        setFilesById((prev) => ({ ...prev, [projectUuid]: [] }));
      } finally {
        setFilesLoading(false);
      }
    }
  };

  const withState = useMemo(() => repos.map((r) => ({ r, state: repoState(r) })), [repos]);

  const stats = useMemo(() => ({
    total: repos.length,
    connected: withState.filter((x) => x.state !== 'disconnected' && x.state !== 'invalid').length,
    reviewed: withState.filter((x) => x.state === 'issues' || x.state === 'clean').length,
    issues: repos.reduce((sum, r) => sum + (r.review_status && r.review_status !== 'failed' ? (r.issues_found ?? 0) : 0), 0),
  }), [repos, withState]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, withState.filter((x) => matchesFilter(x.state, f.key)).length])), [withState]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return withState.filter(({ r, state }) => {
      if (!matchesFilter(state, filter)) return false;
      if (!q) return true;
      return [r.title_en, r.title_ar, r.repository_url].some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [withState, filter, query]);

  if (loading && repos.length === 0) {
    return (
      <div className="gh-page">
        <div className="st-skel" style={{ height: 190 }} />
        <div className="gh-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="st-skel" style={{ height: 330 }} />)}
        </div>
      </div>
    );
  }
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;

  return (
    <div className="gh-page">
      {/* ---- Hero ---------------------------------------------------------- */}
      <section className="gh-hero">
        <div className="gh-hero__head">
          <span className="gh-hero__logo"><Icon name="github" size={28} /></span>
          <div>
            <h1>{t('GitHub Integration')}</h1>
            <p>{t('GitHub link and code review status across all of your projects, in one place.')}</p>
          </div>
        </div>
        <div className="gh-stats">
          <Stat icon="folder" value={stats.total} label={t('Projects')} />
          <Stat icon="link" value={stats.connected} label={t('Linked repos')} tone="primary" />
          <Stat icon="check-circle" value={stats.reviewed} label={t('Reviewed')} tone="success" />
          <Stat icon="alert-triangle" value={stats.issues} label={t('Open issues')} tone={stats.issues > 0 ? 'warning' : ''} />
        </div>
      </section>

      <GithubConnectCard
        projects={repos.filter((r) => !r.is_connected || !isValidGithubRepoUrl(r.repository_url))}
        onChanged={load}
      />

      {runError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{runError}</span></div>}

      {repos.length === 0 ? (
        <EmptyState icon="github" title={locale === 'ar' ? 'لا يوجد لديك أي مشاريع حتى الآن.' : "You don't have any projects yet."}>
          <Link to="/student/projects/create" className="btn btn-primary btn-sm">{t('Create a project')}</Link>
        </EmptyState>
      ) : (
        <>
          {stats.connected === 0 && (
            <div className="st-alert">
              <Icon name="github" size={16} />
              <span>
                {locale === 'ar'
                  ? 'لسه محدّش من مشاريعك مربوط بمستودع GitHub. اربط مستودع من صفحة تعديل أي مشروع لتفعيل مراجعة الكود.'
                  : "None of your projects are linked to a GitHub repository yet. Link one from a project's edit page to enable code review."}
              </span>
            </div>
          )}

          {/* ---- Filters ----------------------------------------------------- */}
          <div className="gh-toolbar">
            <div className="gh-tabs" role="tablist">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`gh-tab${filter === f.key ? ' is-active' : ''}`} onClick={() => setFilter(f.key)}>
                  {t(f.label)} <span className="gh-tab__count">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="gh-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search projects…')}
              aria-label={t('Search projects…')}
            />
          </div>

          {/* ---- Cards ------------------------------------------------------- */}
          {visible.length === 0 ? (
            <EmptyState icon="github" title={t('No projects match your filters.')} />
          ) : (
            <div className="gh-grid">
              {visible.map(({ r }) => (
                <RepoCard
                  key={r.project_uuid}
                  r={r}
                  t={t}
                  locale={locale}
                  isRunning={runningId === r.project_uuid}
                  onRun={() => runReview(r.project_uuid)}
                  filesOpen={openFilesFor === r.project_uuid}
                  files={filesById[r.project_uuid]}
                  filesLoading={filesLoading}
                  onToggleFiles={() => toggleFiles(r.project_uuid)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
