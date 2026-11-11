import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar, ConfirmModal } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/university-verification';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Institutions (universities) — Admin design. Same real API as before
 * (/api/v1/admin/universities: list, verify, reject, reverification, delete).
 * "View" opens the University Details page (/admin/universities/:id). window.confirm() is replaced by the in-page dialog.
 */

const PER_PAGE = 20;
export const STATUS_BADGE = { verified: 'badge-success', pending: 'badge-warning', rejected: 'badge-danger' };

export function StatusPill({ status }) {
  const t = useTranslations(translations);
  const label = status ? t(status.charAt(0).toUpperCase() + status.slice(1)) : '—';
  return <span className={`badge ${STATUS_BADGE[status] || 'badge-neutral'}`}>{label}</span>;
}

export default function AdminUniversities() {
  const t = useTranslations(translations);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [reverifyTarget, setReverifyTarget] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, row }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/universities', { page, q: search || undefined, status: status || undefined })
      .then((json) => {
        setRows(json.data || []);
        setTotal(json.meta?.total ?? 0);
        setCounts(json.meta?.counts || {});
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, search, status]);

  useEffect(() => { load(); }, [load]);

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, row } = confirm;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === 'verify') await api.post(`/api/v1/admin/universities/${row.id}/verify`);
      else if (kind === 'reject') await api.post(`/api/v1/admin/universities/${row.id}/reject`);
      else if (kind === 'delete') await api.del(`/api/v1/admin/universities/${row.id}`);
      setConfirm(null);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (u) => L(t, u.official_name_en, u.official_name_ar) || '—';
  const CONFIRM = {
    verify: (u) => ({ title: t('Verify institution'), message: t('Mark {name} as a verified institution?').replace('{name}', nameOf(u)), label: t('Verify') }),
    reject: (u) => ({ title: t('Reject institution'), message: t('Reject the verification request from {name}?').replace('{name}', nameOf(u)), label: t('Reject'), danger: true }),
    delete: (u) => ({ title: t('Delete institution'), message: t('Delete {name}? This also bans its linked account.').replace('{name}', nameOf(u)), label: t('Delete'), danger: true }),
  };
  const cfg = confirm ? CONFIRM[confirm.kind](confirm.row) : null;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const hasFilters = Boolean(search || status);

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Institutions')}</h1>
          <p className="text-small">{t('Manage universities, verification status and re-verification settings.')}</p>
        </div>
      </div>

      <div className="adm-kpis">
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Total institutions')} <Icon name="building" size={16} /></div><div className="adm-kpi__value">{(counts.total ?? total).toLocaleString()}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Verified')} <Icon name="check-circle" size={16} /></div><div className="adm-kpi__value">{(counts.verified ?? 0).toLocaleString()}</div><div className="adm-kpi__note adm-kpi__note--good">{t('active on the platform')}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Pending')} <Icon name="clock" size={16} /></div><div className="adm-kpi__value">{(counts.pending ?? 0).toLocaleString()}</div><div className="adm-kpi__note adm-kpi__note--warn">{(counts.pending ?? 0) > 0 ? t('Needs review') : t('All clear')}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Rejected')} <Icon name="x-circle" size={16} /></div><div className="adm-kpi__value">{(counts.rejected ?? 0).toLocaleString()}</div></div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      <div className="adm-filters">
        <div className="adm-filters__search">
          <Icon name="search" size={16} />
          <input className="form-input" placeholder={t('Search name, city, country…')} value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
        </div>
        <select className="form-input" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} style={{ maxWidth: 180 }}>
          <option value="">{t('All statuses')}</option>
          <option value="verified">{t('Verified')}</option>
          <option value="pending">{t('Pending')}</option>
          <option value="rejected">{t('Rejected')}</option>
        </select>
        {hasFilters && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatus(''); setPage(1); }}>{t('Clear filters')}</button>}
      </div>

      {loading && <Skeleton rows={6} cols={4} />}
      {error && <ErrorState error={error} />}

      {!loading && !error && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>{t('University')}</th><th>{t('Location')}</th><th>{t('Status')}</th><th>{t('Students')}</th><th>{t('Projects')}</th><th>{t('Submitted')}</th><th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><div className="adm-person"><Avatar name={nameOf(u)} src={u.avatar_path} /><span><strong>{nameOf(u)}</strong></span></div></td>
                  <td>{[u.city, u.country].filter(Boolean).join(', ') || '—'}</td>
                  <td><StatusPill status={u.verification_status} /></td>
                  <td>{(u.students_count ?? 0).toLocaleString()}</td>
                  <td>{(u.projects_count ?? 0).toLocaleString()}</td>
                  <td>{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                  <td className="adm-actions">
                    <Link to={`/admin/universities/${u.id}`} state={{ row: u }} className="btn btn-outline btn-sm">{t('View')}</Link>
                    {u.verification_status === 'pending' && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" title={t('Verify')} onClick={() => setConfirm({ kind: 'verify', row: u })}><Icon name="check-circle" size={16} /></button>
                        <button type="button" className="btn btn-ghost btn-sm" title={t('Reject')} onClick={() => setConfirm({ kind: 'reject', row: u })}><Icon name="x-circle" size={16} /></button>
                      </>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" title={t('Re-verification settings')} onClick={() => setReverifyTarget(u)}><Icon name="refresh" size={16} /></button>
                    <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} onClick={() => setConfirm({ kind: 'delete', row: u })}><Icon name="trash" size={16} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="adm-empty" style={{ textAlign: 'center', padding: 28 }}>{t('No universities match these filters.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="adm-pager">
          <span>{t('Showing')} {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} {t('of')} {total.toLocaleString()}</span>
          {totalPages > 1 && (
            <div>
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('Previous page')}><Icon name="chevron-left" size={16} /></button>
              <span>{t('Page')} {page} {t('of')} {totalPages}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('Next page')}><Icon name="chevron-right" size={16} /></button>
            </div>
          )}
        </div>
      )}

      {reverifyTarget && <ReverificationModal university={reverifyTarget} onClose={() => setReverifyTarget(null)} onSaved={() => { setReverifyTarget(null); load(); }} />}
      {cfg && <ConfirmModal title={cfg.title} message={cfg.message} confirmLabel={cfg.label} danger={cfg.danger} busy={busy} onConfirm={runConfirmed} onClose={() => setConfirm(null)} />}
    </>
  );
}

export function ReverificationModal({ university, onClose, onSaved }) {
  const t = useTranslations(translations);
  const name = L(t, university.official_name_en, university.official_name_ar);
  const [periodDays, setPeriodDays] = useState(university.verification_period_days || 365);
  const [autoReverify, setAutoReverify] = useState(!!Number(university.auto_reverify_enabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/v1/admin/universities/${university.id}/reverification`, { verification_period_days: periodDays, auto_reverify_enabled: autoReverify });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Re-verification')} — {name}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Re-verification period (days)')}</label>
            <input className="form-input" type="number" min={1} value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} required />
            <p className="text-small">{t('How often this university must be re-verified. Defaults to the platform-wide setting when left at the default.')}</p>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={autoReverify} onChange={(e) => setAutoReverify(e.target.checked)} />
              {t('Auto re-verify automatically when the period elapses')}
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t('Saving…') : t('Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
