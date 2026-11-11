import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar, ConfirmModal } from '../../components/admin/adminUi';
import useRowLookup from '../../components/admin/useRowLookup';
import { ReverificationModal, StatusPill } from './AdminUniversities';
import { useTranslations } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/university-verification';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * University Details / Verification Request Details (/admin/universities/:id).
 * An institution's verification request IS its university record, so one page serves both
 * the Institutions list and the Verification & Approvals queue (?from=approvals changes
 * only the back link). Data comes from the existing list endpoint (no detail endpoint is
 * assumed); actions are the existing verify / reject / reverification / delete calls.
 * Documents, risk score, flags and "request more information" from the design have no
 * data or endpoint and are not shown.
 */

const fmt = (v) => (v ? String(v).slice(0, 10) : null);

function Fact({ label, children }) {
  return <div className="adm-fact"><small>{label}</small><strong>{children ?? '—'}</strong></div>;
}

export default function AdminUniversityDetails() {
  const t = useTranslations(translations);
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromApprovals = location.state?.from === 'approvals';
  const backTo = fromApprovals ? '/admin/approvals' : '/admin/universities';
  const backLabel = fromApprovals ? t('Back to verification & approvals') : t('Back to institutions');

  const { row: u, loading, error, notFound, reload } = useRowLookup('/api/v1/admin/universities', id);
  const [confirm, setConfirm] = useState(null);
  const [reverify, setReverify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const back = <BackLink to={backTo} className="adm-link-back"><Icon name="chevron-left" size={14} /> {backLabel}</BackLink>;
  if (loading && !u) return <Skeleton rows={6} cols={4} />;
  if (error) return <>{back}<ErrorState error={error} /></>;
  if (notFound || !u) return <>{back}<p className="adm-empty">{t('This institution was not found (it may have been deleted).')}</p></>;

  const name = L(t, u.official_name_en, u.official_name_ar) || '—';
  const pending = u.verification_status === 'pending';

  const CONFIRM = {
    verify: { title: t('Verify institution'), message: t('Mark {name} as a verified institution?').replace('{name}', name), label: t('Verify') },
    reject: { title: t('Reject institution'), message: t('Reject the verification request from {name}?').replace('{name}', name), label: t('Reject'), danger: true },
    delete: { title: t('Delete institution'), message: t('Delete {name}? This also bans its linked account.').replace('{name}', name), label: t('Delete'), danger: true },
  };
  const cfg = confirm ? CONFIRM[confirm] : null;

  async function runConfirmed() {
    setBusy(true);
    setActionError(null);
    try {
      if (confirm === 'delete') {
        await api.del(`/api/v1/admin/universities/${u.id}`);
        navigate(backTo, { replace: true });
        return;
      }
      await api.post(`/api/v1/admin/universities/${u.id}/${confirm}`);
      setConfirm(null);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  // Only the dates the API actually returns are listed in the timeline.
  const timeline = [
    { label: t('Request submitted'), date: fmt(u.created_at) },
    { label: u.verification_status === 'rejected' ? t('Request rejected') : t('Institution verified'), date: fmt(u.verified_at || u.reviewed_at || u.decided_at) },
    { label: t('Last re-verification'), date: fmt(u.last_verified_at) },
  ].filter((x) => x.date);

  return (
    <>
      {back}
      <div className="page-header animate-rise-in">
        <div className="page-header__title"><h1 className="text-h1">{fromApprovals ? t('Verification Request Details') : t('University Details')}</h1></div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-outline" onClick={() => setReverify(true)}><Icon name="refresh" size={16} /> {t('Re-verification')}</button>
          {pending && (
            <>
              <button type="button" className="btn btn-outline adm-btn-danger" onClick={() => setConfirm('reject')}><Icon name="x-circle" size={16} /> {t('Reject')}</button>
              <button type="button" className="btn btn-primary" onClick={() => setConfirm('verify')}><Icon name="check-circle" size={16} /> {t('Verify')}</button>
            </>
          )}
        </div>
      </div>
      {actionError && <p className="form-error">{actionError}</p>}

      <div className="adm-profile">
        <Avatar name={name} large />
        <div>
          <h2>{name}</h2>
          {u.official_name_ar && u.official_name_en && <p>{u.official_name_ar}</p>}
          <div className="adm-profile__badges"><StatusPill status={u.verification_status} /></div>
        </div>
      </div>

      <div className="adm-kpis">
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Students')} <Icon name="users" size={16} /></div><div className="adm-kpi__value">{(u.students_count ?? 0).toLocaleString()}</div></div>
        <div className="adm-kpi"><div className="adm-kpi__top">{t('Projects')} <Icon name="folder" size={16} /></div><div className="adm-kpi__value">{(u.projects_count ?? 0).toLocaleString()}</div></div>
      </div>

      <div className="adm-grid">
        <div className="adm-panel">
          <div className="adm-panel__head"><div><h3>{fromApprovals ? t('Requester information') : t('Institution information')}</h3></div></div>
          <div className="adm-facts">
            <Fact label={t('Name (English)')}>{u.official_name_en}</Fact>
            <Fact label={t('Name (Arabic)')}>{u.official_name_ar}</Fact>
            <Fact label={t('Location')}>{[u.city, u.country].filter(Boolean).join(', ') || null}</Fact>
            <Fact label={t('Submitted')}>{fmt(u.created_at)}</Fact>
            <Fact label={t('Re-verification period')}>{u.verification_period_days ? `${u.verification_period_days} ${t('days')}` : t('Platform default')}</Fact>
            <Fact label={t('Auto re-verify')}>{Number(u.auto_reverify_enabled) ? t('On') : t('Off')}</Fact>
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel__head"><div><h3>{t('Verification history')}</h3></div></div>
          {timeline.length === 0 ? <p className="adm-empty">{t('No history recorded.')}</p> : (
            <ul className="adm-list">
              {timeline.map((x) => (
                <li key={x.label} className="adm-list__item"><span>{x.label}</span><span className="adm-muted">{x.date}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="adm-panel adm-danger">
        <div className="adm-panel__head">
          <div><h3>{t('Danger zone')}</h3><p>{t('Deleting an institution also bans its linked account.')}</p></div>
          <button type="button" className="btn btn-outline btn-sm adm-btn-danger" onClick={() => setConfirm('delete')}><Icon name="trash" size={14} /> {t('Delete')}</button>
        </div>
      </div>

      {reverify && <ReverificationModal university={u} onClose={() => setReverify(false)} onSaved={() => { setReverify(false); reload(); }} />}
      {cfg && <ConfirmModal title={cfg.title} message={cfg.message} confirmLabel={cfg.label} danger={cfg.danger} busy={busy} onConfirm={runConfirmed} onClose={() => setConfirm(null)} />}
    </>
  );
}
