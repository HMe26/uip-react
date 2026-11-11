import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { StModal, timeAgo } from './stUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/github';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Modal that lists the student's GitHub repositories (GET /api/v1/github/repos) and lets them
 * link one to an existing project (POST /github/link) or create a new project from it
 * (POST /github/create-project).
 */
export default function GithubRepoPicker({ projects, onClose, onChanged, onRevoked }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [vis, setVis] = useState('all');
  const [busyRepo, setBusyRepo] = useState(null);
  const [rowMsg, setRowMsg] = useState({});
  const [choice, setChoice] = useState({});

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/github/repos')
      .then((json) => { if (!cancelled) setRepos(json.data || []); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 409 || err?.response?.status === 409) { onRevoked?.(); return; }
        setError(errorMessage(err));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `projects` = the ones with no (valid) GitHub link yet — the natural targets for "Link to…".
  const freeProjects = projects || [];
  const projectTitle = (p) => (locale === 'ar' ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos || []).filter((r) => {
      if (vis === 'public' && r.private) return false;
      if (vis === 'private' && !r.private) return false;
      return !q || r.full_name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
    });
  }, [repos, query, vis]);

  const markLinked = (fullName, uuid, title) => setRepos((prev) => prev.map((r) => (
    r.full_name === fullName ? { ...r, linked_project_uuid: uuid, linked_project_title: title } : r
  )));

  const link = async (r) => {
    const uuid = choice[r.full_name];
    if (!uuid) return;
    setBusyRepo(r.full_name);
    setRowMsg((m) => ({ ...m, [r.full_name]: null }));
    try {
      await api.post('/api/v1/github/link', { full_name: r.full_name, project_uuid: uuid });
      const p = (projects || []).find((x) => x.project_uuid === uuid);
      markLinked(r.full_name, uuid, p ? projectTitle(p) : '');
      onChanged?.();
    } catch (err) {
      setRowMsg((m) => ({ ...m, [r.full_name]: errorMessage(err) }));
    } finally {
      setBusyRepo(null);
    }
  };

  const create = async (r) => {
    setBusyRepo(r.full_name);
    setRowMsg((m) => ({ ...m, [r.full_name]: null }));
    try {
      const json = await api.post('/api/v1/github/create-project', { full_name: r.full_name });
      markLinked(r.full_name, json.data?.id || 'new', r.name);
      onChanged?.();
    } catch (err) {
      setRowMsg((m) => ({ ...m, [r.full_name]: errorMessage(err) }));
    } finally {
      setBusyRepo(null);
    }
  };

  return (
    <StModal title={t('Your GitHub repositories')} wide onClose={onClose} actions={<button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{t('Close')}</button>}>
      <div className="gh-picker">
        <div className="gh-picker__bar">
          <input type="search" className="gh-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search repositories…')} aria-label={t('Search repositories…')} />
          <div className="gh-tabs">
            {['all', 'public', 'private'].map((k) => (
              <button key={k} type="button" className={`gh-tab${vis === k ? ' is-active' : ''}`} onClick={() => setVis(k)}>
                {k === 'all' ? t('All') : k === 'public' ? t('Public') : t('Private')}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
        {!repos && !error && <div className="st-stack">{[0, 1, 2].map((i) => <div key={i} className="st-skel" style={{ height: 76 }} />)}</div>}
        {repos && filtered.length === 0 && <p className="gh-files__empty" style={{ padding: '18px 4px' }}>{t('No repositories found.')}</p>}

        <ul className="gh-picker__list">
          {filtered.map((r) => {
            const busy = busyRepo === r.full_name;
            return (
              <li key={r.id} className="gh-repo-row">
                <div className="gh-repo-row__main">
                  <div className="gh-repo-row__title" dir="ltr">
                    <Icon name="github" size={14} />
                    <a href={r.html_url} target="_blank" rel="noopener noreferrer">{r.full_name}</a>
                    <span className={`gh-chip${r.private ? ' gh-chip--private' : ''}`}>{r.private ? t('Private') : t('Public')}</span>
                    {r.fork && <span className="gh-chip">{t('Fork')}</span>}
                    {r.archived && <span className="gh-chip">{t('Archived')}</span>}
                  </div>
                  {r.description && <p className="gh-repo-row__desc">{r.description}</p>}
                  <div className="gh-meta">
                    {r.language && <span className="gh-meta__item">{r.language}</span>}
                    {r.updated_at && <span className="gh-meta__item">{t('Updated')} {timeAgo(r.updated_at, locale)}</span>}
                  </div>
                  {rowMsg[r.full_name] && <p className="gh-repo-row__err">{rowMsg[r.full_name]}</p>}
                </div>

                <div className="gh-repo-row__actions">
                  {r.linked_project_uuid ? (
                    <span className="gh-badge-inline"><Icon name="check-circle" size={13} /> {t('Linked')}{r.linked_project_title ? `: ${r.linked_project_title}` : ''}</span>
                  ) : (
                    <>
                      {freeProjects.length > 0 && (
                        <div className="gh-repo-row__link">
                          <select className="form-select" value={choice[r.full_name] || ''} onChange={(e) => setChoice((c) => ({ ...c, [r.full_name]: e.target.value }))} aria-label={t('Link to project')}>
                            <option value="">{t('Link to project…')}</option>
                            {freeProjects.map((p) => <option key={p.project_uuid} value={p.project_uuid}>{projectTitle(p)}</option>)}
                          </select>
                          <button type="button" className="btn btn-outline btn-sm" disabled={busy || !choice[r.full_name]} onClick={() => link(r)}>{t('Link')}</button>
                        </div>
                      )}
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => create(r)}>
                        {busy ? t('Loading…') : t('Create project')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </StModal>
  );
}
