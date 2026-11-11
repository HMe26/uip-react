import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import ExportMenu from '../../components/ExportMenu';
import { downloadExport } from '../../lib/exportDownload';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { PageHead, SevBadge, StatusPill, FilterSelect, SearchBox, Modal, EmptyState, ErrorNote, Pagination, fmtDateTime, titleCase } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/alerts';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/** /api/v1/security/alerts — list/filter, acknowledge, resolve, escalate, assign, export. */
const BAR = { critical: 'var(--sev-critical)', high: 'var(--sev-high)', warning: 'var(--sev-medium)', medium: 'var(--sev-medium)', low: 'var(--sev-low)', info: 'var(--color-primary)' };

export default function SecurityAlerts() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const severity = params.get('severity') || '';
  const type = params.get('type') || '';
  const q = params.get('q') || '';
  const page = parseInt(params.get('page') || '1', 10) || 1;

  const [qInput, setQInput] = useState(q);
  const [alerts, setAlerts] = useState([]);
  const [meta, setMeta] = useState({ assignees: [], types: [], statuses: [], severities: [], open_count: 0, total: 0, perPage: 25 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'resolve'|'escalate'|'view', alert }
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.get('/api/v1/security/alerts', { status: status || undefined, severity: severity || undefined, type: type || undefined, q: q || undefined, page })
      .then((json) => { setAlerts(json.data || []); setMeta({ assignees: [], types: [], statuses: [], severities: [], open_count: 0, total: 0, perPage: 25, ...(json.meta || {}) }); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [status, severity, type, q, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setQInput(q); }, [q]);

  const patch = (obj) => { const n = new URLSearchParams(params); Object.entries(obj).forEach(([k, v]) => { if (v) n.set(k, v); else n.delete(k); }); if (!('page' in obj)) n.delete('page'); setParams(n); };
  const label = (v) => { const x = t(v); return x !== v ? x : titleCase(v); };
  const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.perPage || 25)));
  const hasFilters = status || severity || type || q;

  const run = (id, p) => { setBusyId(id); setError(null); return p.then(() => { setDialog(null); setNote(''); return load(); }).catch((err) => setError(errorMessage(err))).finally(() => setBusyId(null)); };
  const ack = (a) => run(a.id, api.post(`/api/v1/security/alerts/${a.id}/acknowledge`));
  const assign = (a, to) => run(a.id, api.patch(`/api/v1/security/alerts/${a.id}/assign`, { assigned_to: to || null }));
  const submitDialog = () => {
    const a = dialog.alert;
    if (dialog.kind === 'resolve') run(a.id, api.post(`/api/v1/security/alerts/${a.id}/resolve`, { resolution_note: note || undefined }));
    else run(a.id, api.post(`/api/v1/security/alerts/${a.id}/escalate`, { escalation_note: note || undefined }));
  };

  const [exporting, setExporting] = useState(false);
  const doExport = (format) => { setExporting(true); setError(null); return downloadExport('/api/v1/security/alerts/export', { params: { status, severity, type, q }, format, filename: 'security-alerts', title: t('Security Alerts') }).catch((err) => setError(errorMessage(err))).finally(() => setExporting(false)); };
  const subtitle = meta.open_count > 0
    ? (locale === 'ar' ? `يوجد ${meta.open_count} تنبيه مفتوح يحتاج مراجعة.` : `${meta.open_count} open alert${meta.open_count > 1 ? 's' : ''} need review.`)
    : t('No open alerts right now.');

  return (
    <div className="sec-page">
      <PageHead eyebrow={t('Workspace / Detection')} title={t('Alerts')} subtitle={subtitle}
        actions={<ExportMenu iconSize={15} busy={exporting} onExport={doExport} />} />

      <form className="sec-toolbar" onSubmit={(e) => { e.preventDefault(); patch({ q: qInput }); }}>
        <FilterSelect value={status} onChange={(v) => patch({ status: v })} allLabel={t('All statuses')} options={(meta.statuses || []).map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect value={severity} onChange={(v) => patch({ severity: v })} allLabel={t('All severities')} options={(meta.severities || []).map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect value={type} onChange={(v) => patch({ type: v })} allLabel={t('All types')} options={(meta.types || []).map((s) => ({ value: s, label: titleCase(s) }))} />
        <SearchBox value={qInput} onChange={setQInput} placeholder={t('Search alerts…')} onSubmit={() => patch({ q: qInput })} />
        <button type="submit" className="btn btn-outline">{t('Apply')}</button>
        {hasFilters && <button type="button" className="btn btn-outline" onClick={() => { setQInput(''); setParams(new URLSearchParams()); }}>{t('Clear filters')}</button>}
      </form>
      <ErrorNote>{error}</ErrorNote>

      <section className="sec-card sec-card--flush">
        {loading && !alerts.length ? (
          <div>{Array.from({ length: 4 }).map((_, i) => <div key={i} className="sec-alert-row"><span /><div style={{ display: 'grid', gap: 10 }}><span className="sec-skel" style={{ width: '30%' }} /><span className="sec-skel" style={{ width: '60%' }} /></div></div>)}</div>
        ) : alerts.length === 0 ? <EmptyState icon="bell">{t('No matching alerts.')}</EmptyState> : alerts.map((a) => (
          <article key={a.id} className="sec-alert-row">
            <span className="sec-alert-row__bar" style={{ background: BAR[a.severity] || BAR.info }} />
            <div>
              <div className="sec-alert-row__head">
                <SevBadge level={a.severity} text={label(a.severity)} />
                <StatusPill status={a.status} text={label(a.status)} />
                <span className="muted" style={{ fontSize: 12 }}>{titleCase(a.type)}</span>
              </div>
              <h3 className="sec-alert-row__title">{a.title}</h3>
              {a.message && <p className="sec-alert-row__msg">{a.message}</p>}
              <p className="sec-alert-row__meta">
                <span>{fmtDateTime(a.created_at)}</span>
                {a.source_ip && <span className="mono" dir="ltr">{a.source_ip}</span>}
                {a.subject_name && <span>{t('Account')}: {a.subject_name}</span>}
                {a.assignee_name && <span>{t('Assigned to')}: {a.assignee_name}</span>}
              </p>
            </div>
            <div className="sec-alert-row__actions">
              <FilterSelect className="sec-select--sm" value={a.assigned_to ? String(a.assigned_to) : ''} disabled={busyId === a.id} onChange={(v) => assign(a, v)} allLabel={t('Unassigned')} options={(meta.assignees || []).map((x) => ({ value: String(x.id), label: x.full_name }))} />
              {a.status === 'open' && <button type="button" className="btn-tint" disabled={busyId === a.id} onClick={() => ack(a)}>{t('Acknowledge')}</button>}
              {['open', 'acknowledged'].includes(a.status) && (<>
                <button type="button" className="btn-tint" disabled={busyId === a.id} onClick={() => { setNote(''); setDialog({ kind: 'resolve', alert: a }); }}>{t('Resolve')}</button>
                <button type="button" className="btn-tint btn-tint--danger" disabled={busyId === a.id} onClick={() => { setNote(''); setDialog({ kind: 'escalate', alert: a }); }}>{t('Escalate')}</button>
              </>)}
            </div>
          </article>
        ))}
      </section>
      <Pagination page={page} totalPages={totalPages} onPage={(p) => patch({ page: String(p) })} />

      <Modal open={!!dialog} onClose={() => setDialog(null)} tone={dialog?.kind === 'escalate' ? 'danger' : undefined}
        title={dialog?.kind === 'escalate' ? t('Escalate') : t('Resolve')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setDialog(null)}>{t('Cancel')}</button>
          <button type="button" className={`btn ${dialog?.kind === 'escalate' ? 'btn-danger' : 'btn-primary'}`} disabled={busyId === dialog?.alert.id} onClick={submitDialog}>{dialog?.kind === 'escalate' ? t('Escalate') : t('Resolve')}</button></>)}>
        {dialog && (<>
          <div className="sec-modal__notice"><strong>{dialog.alert.title}</strong></div>
          <div className="sec-field"><label htmlFor="al-note">{t('Note (optional)')}</label><textarea id="al-note" className="sec-input" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></div>
        </>)}
      </Modal>
    </div>
  );
}
