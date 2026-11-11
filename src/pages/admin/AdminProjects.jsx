import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Pager } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import { LO } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/project-approval';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Projects & Moderation (new page, /admin/projects). Built on the existing platform-wide
 * project list (/api/v1/admin/approvals) and its logged, reason-required admin action
 * (POST /api/v1/admin/approvals/{id}/override): approve & publish, send back for changes
 * (draft), or remove (rejected). There is no moderation-flag data in the API, so flags,
 * severity and "Clear flag" from the design are not shown.
 */

const PER_PAGE = 20;
export const STATUS_BADGE = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

export const ACTIONS = [
  { value: 'approved', title: 'Approve (without publishing)', hint: 'Mark the project approved; the owner or university publishes it later.' },
  { value: 'published', title: 'Approve & publish', hint: 'Approve and make the project visible on the platform.' },
  { value: 'draft', title: 'Request changes', hint: 'Send the project back to its owner as a draft.' },
  { value: 'rejected', title: 'Remove project', hint: 'Reject the project; it will no longer be published.' },
];

export default function AdminProjects() {
  const t = useTranslations(translations);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [target, setTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/approvals', { page, q: search || undefined })
      .then((json) => { setRows(json.data || []); setTotal(json.meta?.total ?? 0); setCounts(json.meta?.counts || {}); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, search]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Projects & Moderation')}</h1>
          <p className="text-small">{t('Review projects across every university and take logged moderation actions.')}</p>
        </div>
        <div className="page-header__actions">
          <Link to="/admin/featured-projects" className="btn btn-outline"><Icon name="sparkles" size={16} /> {t('Featured projects')}</Link>
          <Link to="/admin/ai-code-review" className="btn btn-outline"><Icon name="shield" size={16} /> {t('AI code review')}</Link>
        </div>
      </div>

      <div className="adm-kpis">
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Projects in review flow')} <Icon name="folder" size={16} /></div><div className="adm-kpi__value">{total.toLocaleString()}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Pending')} <Icon name="clock" size={16} /></div><div className="adm-kpi__value">{(counts.pending ?? 0).toLocaleString()}</div><div className="adm-kpi__note adm-kpi__note--warn">{(counts.pending ?? 0) > 0 ? t('At universities') : t('None')}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Approved')} <Icon name="check-circle" size={16} /></div><div className="adm-kpi__value">{(counts.approved ?? 0).toLocaleString()}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Rejected')} <Icon name="x-circle" size={16} /></div><div className="adm-kpi__value">{(counts.rejected ?? 0).toLocaleString()}</div></div>
      </div>

      {notice && <p className="adm-empty" style={{ color: 'var(--color-success)' }}>{notice}</p>}

      <div className="adm-filters">
        <div className="adm-filters__search">
          <Icon name="search" size={16} />
          <input className="form-input" placeholder={t('Search project title…')} value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
        </div>
      </div>

      {loading && <Skeleton rows={6} cols={4} />}
      {error && <ErrorState error={error} />}

      {!loading && !error && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>{t('Project')}</th><th>{t('University')}</th><th>{t('Status')}</th><th>{t('Decided')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{LO(t, r.title) || '—'}</strong></td>
                  <td>{LO(t, r.university) || '—'}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>{cap(r.status)}</span></td>
                  <td>{r.decided || '—'}</td>
                  <td className="adm-actions"><Link to={`/admin/projects/${r.id}`} state={{ row: r }} className="btn btn-outline btn-sm">{t('View')}</Link>{' '}<button type="button" className="btn btn-outline btn-sm" onClick={() => setTarget(r)}>{t('Moderate')}</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="adm-empty" style={{ textAlign: 'center', padding: 28 }}>{t('No projects match this search.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && <Pager page={page} setPage={setPage} total={total} perPage={PER_PAGE} />}

      {target && <ModerateModal project={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); setNotice(t('Decision recorded and written to the audit log.')); load(); }} />}
    </>
  );
}

export function ModerateModal({ project, onClose, onDone }) {
  const t = useTranslations(translations);
  const [status, setStatus] = useState('draft');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/v1/admin/approvals/${project.id}/override`, { status, comments });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Moderate')} — {LO(t, project.title)}</h2>
        <form onSubmit={submit}>
          <div className="adm-choice">
            {ACTIONS.map((a) => (
              <label key={a.value} className={status === a.value ? 'is-on' : ''}>
                <input type="radio" name="mod-action" checked={status === a.value} onChange={() => setStatus(a.value)} />
                <span>{t(a.title)}<small>{t(a.hint)}</small></span>
              </label>
            ))}
          </div>
          <div className="form-group">
            <label className="form-label">{t('Reason (required, logged)')}</label>
            <textarea className="form-input" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} required />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}
              style={status === 'rejected' ? { background: 'var(--color-danger)', borderColor: 'var(--color-danger)' } : undefined}>
              {saving ? t('Submitting…') : t('Confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
