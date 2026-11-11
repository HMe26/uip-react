import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import Icon from '../../components/Icon';
import CodeReviewReportPanel from '../../components/CodeReviewReportPanel';
import useRowLookup from '../../components/admin/useRowLookup';
import { ModerateModal, STATUS_BADGE } from './AdminProjects';
import { useTranslations } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/project-approval';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Moderation Project Details (/admin/projects/:id). Built from the existing project list
 * (/api/v1/admin/approvals) — no detail endpoint is assumed. The moderation panel uses the
 * existing logged, reason-required override (same ModerateModal as the list). Moderation
 * flags, severity, "Clear flag" and the quality score from the design have no data source
 * and are not shown.
 */

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const pick = (v, t) => (v == null ? null : typeof v === 'object' ? (L(t, v.en, v.ar) || null) : String(v));

function Fact({ label, children }) {
  return <div className="adm-fact"><small>{label}</small><strong>{children ?? '—'}</strong></div>;
}

export default function AdminProjectDetails() {
  const t = useTranslations(translations);
  const { id } = useParams();
  const { row: p, loading, error, notFound, reload } = useRowLookup('/api/v1/admin/approvals', id);
  const [moderating, setModerating] = useState(false);
  const [notice, setNotice] = useState(null);

  const back = <BackLink to="/admin/projects" className="adm-link-back"><Icon name="chevron-left" size={14} /> {t('Back to projects')}</BackLink>;
  if (loading && !p) return <Skeleton rows={6} cols={4} />;
  if (error) return <>{back}<ErrorState error={error} /></>;
  if (notFound || !p) return <>{back}<p className="adm-empty">{t('This project was not found.')}</p></>;

  const title = pick(p.title, t) || '—';
  const known = new Set(['id', 'title', 'university', 'status', 'decided']);
  // Any extra scalar field the API returns is shown; nothing is invented.
  const extras = Object.entries(p)
    .filter(([k, v]) => !known.has(k) && v != null && v !== '' && typeof v !== 'object')
    .slice(0, 8);

  return (
    <>
      {back}
      <div className="page-header animate-rise-in">
        <div className="page-header__title"><h1 className="text-h1">{t('Moderation Project Details')}</h1></div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setModerating(true)}><Icon name="shield" size={16} /> {t('Moderate')}</button>
        </div>
      </div>
      {notice && <p className="adm-empty" style={{ color: 'var(--color-success)' }}>{notice}</p>}

      <div className="adm-profile">
        <span className="adm-avatar adm-avatar--lg"><Icon name="folder" size={22} /></span>
        <div>
          <h2>{title}</h2>
          <p>{pick(p.university, t) || '—'}</p>
          <div className="adm-profile__badges"><span className={`badge ${STATUS_BADGE[p.status] || 'badge-neutral'}`}>{cap(p.status)}</span></div>
        </div>
      </div>

      <div className="adm-grid">
        <div className="adm-panel">
          <div className="adm-panel__head"><div><h3>{t('Project information')}</h3></div></div>
          <div className="adm-facts">
            <Fact label={t('Title (English)')}>{pick(p.title && { en: p.title.en }, t)}</Fact>
            <Fact label={t('Title (Arabic)')}>{pick(p.title && { en: p.title.ar }, t)}</Fact>
            <Fact label={t('University')}>{pick(p.university, t)}</Fact>
            <Fact label={t('Status')}>{cap(p.status)}</Fact>
            <Fact label={t('Last decision')}>{p.decided}</Fact>
            {extras.map(([k, v]) => <Fact key={k} label={k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}>{String(v)}</Fact>)}
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel__head"><div><h3>{t('Moderation actions')}</h3><p>{t('Every decision needs a reason and is written to the audit log.')}</p></div></div>
          <ul className="adm-list">
            <li className="adm-list__item"><span>{t('Approve & publish')}</span><span className="adm-muted">{t('visible on the platform')}</span></li>
            <li className="adm-list__item"><span>{t('Request changes')}</span><span className="adm-muted">{t('back to owner as draft')}</span></li>
            <li className="adm-list__item"><span>{t('Remove project')}</span><span className="adm-muted">{t('rejected, not published')}</span></li>
          </ul>
        </div>
      </div>

      <CodeReviewReportPanel projectId={p.uuid || p.id} className="adm-panel" style={{ marginTop: 16 }} />

      {moderating && <ModerateModal project={p} onClose={() => setModerating(false)} onDone={() => { setModerating(false); setNotice(t('Decision recorded and written to the audit log.')); reload(); }} />}
    </>
  );
}
