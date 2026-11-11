import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { downloadExport } from '../../lib/exportDownload';
import { useTranslations } from '../../context/LanguageContext';
import { PageHead, SevBadge, StatusPill, FilterSelect, SearchBox, Modal, DetailGrid, EmptyState, ErrorNote, TableSkeleton, fmtDate, tl } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/vulnerabilities';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/** /api/v1/security/vulnerabilities — list, create, status + deadline patch, export. */
const STATUSES = ['open', 'in_progress', 'mitigated', 'resolved', 'accepted_risk'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const EMPTY = { title: '', description: '', component: '', severity: 'low', cvss: '', deadline: '' };

export default function SecurityVulnerabilities() {
  const t = useTranslations(translations);
  const label = tl(t);
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const severity = params.get('severity') || '';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState(params.get('q') || '');
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.get('/api/v1/security/vulnerabilities', { status: status || undefined, per_page: 100 })
      .then((json) => setRows(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };
  const today = new Date(new Date().toDateString());
  const overdue = (v) => v.deadline && ['open', 'in_progress'].includes(v.status) && new Date(v.deadline) < today;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((v) => (!severity || v.severity === severity)
      && (!needle || [v.title, v.affected_component, v.assignee_name].some((x) => String(x || '').toLowerCase().includes(needle))));
  }, [rows, q, severity]);

  const patchRow = (id, path, body) => {
    setBusyId(id); setError(null);
    api.patch(`/api/v1/security/vulnerabilities/${id}/${path}`, body)
      .then(() => load()).catch((err) => setError(errorMessage(err))).finally(() => setBusyId(null));
  };
  const create = (e) => {
    e.preventDefault(); setFormError(null); setSaving(true);
    api.post('/api/v1/security/vulnerabilities', {
      title: form.title, description: form.description || undefined, affected_component: form.component || undefined,
      severity: form.severity, cvss_score: form.cvss || undefined, deadline: form.deadline || undefined,
    }).then(() => { setCreating(false); setForm(EMPTY); load(); })
      .catch((err) => setFormError(errorMessage(err))).finally(() => setSaving(false));
  };
  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cvssTone = (n) => (n >= 9 ? 'tone--danger' : n >= 7 ? 'tone--warn' : n >= 4 ? 'tone--caution' : 'tone--good');
  const [exporting, setExporting] = useState(false);
  const doExport = (format) => { setExporting(true); setError(null); return downloadExport('/api/v1/security/vulnerabilities/export', { params: { status }, format, filename: 'vulnerabilities', title: t('Vulnerabilities') }).catch((err) => setError(errorMessage(err))).finally(() => setExporting(false)); };

  return (
    <div className="sec-page">
      <PageHead
        eyebrow={t('Workspace / Response')} title={t('Vulnerabilities')} subtitle={t('Track vulnerabilities from discovery through remediation.')}
        actions={(<>
          <ExportMenu iconSize={15} busy={exporting} onExport={doExport} />
          <button type="button" className="btn btn-primary" onClick={() => { setFormError(null); setCreating(true); }}><Icon name="plus" size={16} /> {t('Record Vulnerability')}</button>
        </>)}
      />
      <div className="sec-toolbar">
        <FilterSelect value={status} onChange={(v) => setFilter('status', v)} allLabel={t('All statuses')} options={STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect value={severity} onChange={(v) => setFilter('severity', v)} allLabel={t('All severities')} options={SEVERITIES.map((s) => ({ value: s, label: label(s) }))} />
        <SearchBox value={q} onChange={setQ} placeholder={t('Search vulnerabilities…')} />
        {(status || severity || q) && <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setParams(new URLSearchParams()); }}>{t('Clear filters')}</button>}
      </div>
      <ErrorNote>{error}</ErrorNote>

      <section className="sec-card sec-card--flush">
        <div className="sec-count"><strong>{visible.length} {t('Vulnerabilities').toLowerCase()}</strong></div>
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead><tr><th>{t('Vulnerability')}</th><th>{t('Severity')}</th><th>{t('CVSS')}</th><th>{t('Status')}</th><th>{t('Assignee')}</th><th>{t('Deadline')}</th><th>{t('Discovered')}</th><th className="col-actions">{t('Action')}</th></tr></thead>
            {loading && !rows.length ? <TableSkeleton cols={8} /> : (
              <tbody>
                {visible.map((v) => (
                  <tr key={v.id}>
                    <td className="wrap"><strong>{v.title}</strong><span className="sub">{v.affected_component || '—'}</span></td>
                    <td><SevBadge level={v.severity} text={t(v.severity)} /></td>
                    <td>{v.cvss_score != null ? <b className={`mono ${cvssTone(Number(v.cvss_score))}`}>{v.cvss_score}</b> : '—'}</td>
                    <td>
                      <FilterSelect value={v.status} disabled={busyId === v.id} onChange={(s) => patchRow(v.id, 'status', { status: s })} options={STATUSES.map((s) => ({ value: s, label: label(s) }))} className="sec-select--sm" />
                    </td>
                    <td>{v.assignee_name || <span className="muted">{t('Unassigned')}</span>}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="date" className="sec-input" style={{ width: 150, minHeight: 38 }} disabled={busyId === v.id} defaultValue={v.deadline || ''}
                          onBlur={(e) => { if (e.target.value !== (v.deadline || '')) patchRow(v.id, 'deadline', { deadline: e.target.value }); }} />
                        {overdue(v) && <span className="pill pill--danger">{t('Overdue')}</span>}
                      </div>
                    </td>
                    <td className="muted">{fmtDate(v.discovered_at)}</td>
                    <td className="col-actions"><button type="button" className="btn-tint" onClick={() => setSelected(v)}>{t('View')}</button></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && visible.length === 0 && <EmptyState icon="alert">{t('No vulnerabilities recorded.')}</EmptyState>}
      </section>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={t('Vulnerability details')} wide footer={<button type="button" className="btn btn-outline" onClick={() => setSelected(null)}>{t('Close')}</button>}>
        {selected && (<>
          <div className="sec-modal__notice"><strong style={{ color: 'var(--text-primary)' }}>{selected.title}</strong>{selected.description ? <><br />{selected.description}</> : null}</div>
          <DetailGrid items={[
            [t('Affected component'), selected.affected_component],
            [t('Severity'), <SevBadge key="s" level={selected.severity} text={t(selected.severity)} />],
            [t('CVSS'), selected.cvss_score != null ? String(selected.cvss_score) : null],
            [t('Status'), <StatusPill key="st" status={selected.status} text={t(selected.status)} />],
            [t('Assignee'), selected.assignee_name || t('Unassigned')],
            [t('Deadline'), fmtDate(selected.deadline)],
            [t('Discovered'), fmtDate(selected.discovered_at)],
          ]} />
        </>)}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title={t('Record Vulnerability')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setCreating(false)}>{t('Cancel')}</button><button type="submit" form="create-vuln" className="btn btn-primary" disabled={saving || !form.title.trim()}>{saving ? t('Saving…') : t('Record')}</button></>)}>
        <form id="create-vuln" onSubmit={create}>
          <ErrorNote>{formError}</ErrorNote>
          <div className="sec-field" style={{ marginTop: formError ? 12 : 0 }}><label htmlFor="v-title">{t('Title')}</label><input id="v-title" className="sec-input" required autoFocus value={form.title} onChange={upd('title')} placeholder={t('Vulnerability title')} /></div>
          <div className="sec-field"><label htmlFor="v-desc">{t('Description')}</label><textarea id="v-desc" className="sec-input" value={form.description} onChange={upd('description')} /></div>
          <div className="sec-field"><label htmlFor="v-comp">{t('Affected component')}</label><input id="v-comp" className="sec-input" value={form.component} onChange={upd('component')} /></div>
          <div className="sec-grid-2">
            <div className="sec-field"><label>{t('Severity')}</label><FilterSelect value={form.severity} onChange={(v) => setForm((f) => ({ ...f, severity: v }))} options={SEVERITIES.map((s) => ({ value: s, label: label(s) }))} /></div>
            <div className="sec-field"><label htmlFor="v-cvss">{t('CVSS score (optional)')}</label><input id="v-cvss" type="number" step="0.1" min="0" max="10" className="sec-input" value={form.cvss} onChange={upd('cvss')} /></div>
          </div>
          <div className="sec-field"><label htmlFor="v-dl">{t('Deadline (optional)')}</label><input id="v-dl" type="date" className="sec-input" value={form.deadline} onChange={upd('deadline')} /></div>
        </form>
      </Modal>
    </div>
  );
}
