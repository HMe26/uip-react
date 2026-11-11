import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useTranslations } from '../../context/LanguageContext';
import { PageHead, SecKpi, SearchBox, Modal, EmptyState, ErrorNote, TableSkeleton, fmtDateTime, titleCase } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/sessions';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/** /api/v1/security/sessions — list active sessions + revoke. */
export default function SecuritySessions() {
  const t = useTranslations(translations);
  const [sessions, setSessions] = useState([]);
  const [counts, setCounts] = useState({ active: 0, users: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.get('/api/v1/security/sessions')
      .then((json) => { setSessions(json.data || []); setCounts({ active: json.meta?.active_count || 0, users: json.meta?.distinct_users || 0 }); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? sessions.filter((s) => [s.full_name, s.email, s.ip_address, s.role_slug, s.location_label].some((v) => String(v || '').toLowerCase().includes(n))) : sessions;
  }, [sessions, q]);

  const revoke = () => {
    setBusy(true); setError(null);
    api.post(`/api/v1/security/sessions/${target.id}/revoke`)
      .then(() => { setTarget(null); return load(); })
      .catch((err) => { setError(errorMessage(err)); setTarget(null); })
      .finally(() => setBusy(false));
  };

  return (
    <div className="sec-page">
      <PageHead eyebrow={t('Workspace / Sessions')} title={t('Sessions')} subtitle={t('Monitor active sessions and revoke access instantly.')} />
      <div className="sec-kpis sec-kpis--2">
        <SecKpi label={t('Active Sessions')} value={counts.active.toLocaleString()} icon="monitor" />
        <SecKpi label={t('Distinct Users Online')} value={counts.users.toLocaleString()} icon="users" tone="good" meta={t('Live now')} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="sec-toolbar"><SearchBox value={q} onChange={setQ} placeholder={t('Search by user, email, or IP…')} /></div>

      <section className="sec-card sec-card--flush">
        <div className="sec-count"><strong>{visible.length} {t('Active sessions').toLowerCase()}</strong></div>
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead><tr><th>{t('User')}</th><th>{t('Role')}</th><th>{t('IP Address')}</th><th>{t('Device')}</th><th>{t('Location')}</th><th>{t('Last Activity')}</th><th className="col-actions">{t('Action')}</th></tr></thead>
            {loading && !sessions.length ? <TableSkeleton cols={7} /> : (
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.full_name || '—'}</strong><span className="sub">{s.email || ''}</span></td>
                    <td><span className="pill pill--info">{s.role_slug ? titleCase(s.role_slug) : '—'}</span></td>
                    <td className="mono muted" dir="ltr">{s.ip_address || '—'}</td>
                    <td className="muted wrap">{s.device_label || s.user_agent || '—'}</td>
                    <td className="muted">{s.location_label || '—'}</td>
                    <td className="muted">{fmtDateTime(s.last_activity_at)}</td>
                    <td className="col-actions"><button type="button" className="btn-tint btn-tint--danger" onClick={() => setTarget(s)}>{t('Revoke')}</button></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && visible.length === 0 && <EmptyState icon="monitor">{q ? t('No sessions match your search.') : t('No active sessions.')}</EmptyState>}
      </section>

      <Modal open={!!target} tone="danger" onClose={() => setTarget(null)} title={t('Revoke this session?')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setTarget(null)}>{t('Cancel')}</button><button type="button" className="btn btn-danger" disabled={busy} onClick={revoke}>{busy ? t('Revoking…') : t('Revoke session')}</button></>)}>
        {target && (<>
          <div className="sec-modal__notice">{t('This signs the user out of the platform immediately. They will need to sign in again.')}</div>
          <p style={{ margin: 0 }}><strong>{target.full_name || target.email}</strong>{target.ip_address && <> · <span className="mono" dir="ltr">{target.ip_address}</span></>}</p>
        </>)}
      </Modal>
    </div>
  );
}
