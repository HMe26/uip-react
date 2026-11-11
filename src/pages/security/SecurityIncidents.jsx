import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import { PageHead, SevBadge, StatusPill, FilterSelect, SearchBox, Modal, DetailGrid, EmptyState, ErrorNote, TableSkeleton, fmtDateTime, fmtShort, titleCase, tl } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/incidents';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign };

/** /api/v1/security/incidents — list/filter, create (SecurityIncidentsApiController). */
const CATEGORIES = ['unauthorized_access', 'malware', 'data_leak', 'phishing', 'brute_force', 'policy_violation', 'other'];
const STATUSES = ['open', 'investigating', 'contained', 'resolved', 'closed'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const EMPTY = { title: '', description: '', category: CATEGORIES[0], severity: 'low', sourceIp: '' };

export default function SecurityIncidents() {
  const t = useTranslations(translations);
  const label = tl(t);
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const severity = params.get('severity') || '';
  const category = params.get('category') || '';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState(params.get('q') || '');
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.get('/api/v1/security/incidents', { status: status || undefined, severity: severity || undefined, category: category || undefined, per_page: 100 })
      .then((json) => setRows(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [status, severity, category]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };
  const catLabel = (c) => { const v = t(c); return v !== c ? v : titleCase(c); };

  // Category is also filtered client-side so it works even if the API ignores the param.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (!category || r.category === category)
      && (!needle || [r.title, r.reference_code, r.source_ip, r.assignee_name, r.category].some((v) => String(v || '').toLowerCase().includes(needle))));
  }, [rows, q, category]);
  const hasFilters = status || severity || category || q;

  const create = (e) => {
    e.preventDefault(); setFormError(null); setSaving(true);
    api.post('/api/v1/security/incidents', { title: form.title, description: form.description, category: form.category, severity: form.severity, source_ip: form.sourceIp || undefined })
      .then(() => { setCreating(false); setForm(EMPTY); load(); })
      .catch((err) => setFormError(errorMessage(err)))
      .finally(() => setSaving(false));
  };
  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="sec-page">
      <PageHead
        eyebrow={t('Workspace / Response')} title={t('Incidents')} subtitle={t('Investigate, assign, and resolve security incidents.')}
        actions={<button type="button" className="btn btn-primary" onClick={() => { setFormError(null); setCreating(true); }}><Icon name="plus" size={16} /> {t('Create Incident')}</button>}
      />

      <div className="sec-toolbar">
        <FilterSelect value={status} onChange={(v) => setFilter('status', v)} allLabel={t('All statuses')} options={STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect value={severity} onChange={(v) => setFilter('severity', v)} allLabel={t('All severities')} options={SEVERITIES.map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect value={category} onChange={(v) => setFilter('category', v)} allLabel={t('All categories')} options={CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))} />
        <SearchBox value={q} onChange={setQ} placeholder={t('Search incidents, IPs, users…')} />
        {hasFilters && <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setParams(new URLSearchParams()); }}><Icon name="filter" size={15} /> {t('Clear filters')}</button>}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <section className="sec-card sec-card--flush">
        <div className="sec-count"><strong>{visible.length} {t('incidents')}</strong> <span>· {loading ? t('Updating…') : t('Updated just now')}</span></div>
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead><tr><th>{t('Incident ID')}</th><th>{t('Title')}</th><th>{t('Category')}</th><th>{t('Severity')}</th><th>{t('Source IP')}</th><th>{t('Assigned To')}</th><th>{t('Status')}</th><th>{t('Created')}</th><th className="col-actions">{t('Action')}</th></tr></thead>
            {loading && !rows.length ? <TableSkeleton cols={9} /> : (
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="id-link mono" to={`/security/incidents/${r.id}`}>{r.reference_code}</Link></td>
                    <td className="wrap"><strong>{r.title}</strong></td>
                    <td className="muted">{catLabel(r.category)}</td>
                    <td><SevBadge level={r.severity} text={t(r.severity)} /></td>
                    <td className="muted mono">{r.source_ip || t('Internal')}</td>
                    <td>{r.assignee_name || <span className="muted">{t('Unassigned')}</span>}</td>
                    <td><StatusPill status={r.status} text={t(r.status)} /></td>
                    <td className="muted">{fmtShort(r.detected_at || r.created_at)}</td>
                    <td className="col-actions"><button type="button" className="btn-tint" onClick={() => setSelected(r)}>{t('View')}</button></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && visible.length === 0 && <EmptyState icon="shield">{t('No matching incidents.')}</EmptyState>}
      </section>

      <Modal
        open={!!selected} onClose={() => setSelected(null)} title={t('Incident details')} wide
        footer={selected && (<><button type="button" className="btn btn-outline" onClick={() => setSelected(null)}>{t('Close')}</button><Link to={`/security/incidents/${selected.id}`} className="btn btn-primary">{t('Open full record')}</Link></>)}
      >
        {selected && (
          <>
            <div className="sec-modal__notice"><strong style={{ color: 'var(--text-primary)' }}>{selected.title}</strong>{selected.description ? <><br />{selected.description}</> : null}</div>
            <DetailGrid items={[
              [t('Incident ID'), <span className="mono" key="i">{selected.reference_code}</span>],
              [t('Category'), catLabel(selected.category)],
              [t('Severity'), <SevBadge key="s" level={selected.severity} text={t(selected.severity)} />],
              [t('Status'), <StatusPill key="st" status={selected.status} text={t(selected.status)} />],
              [t('Source IP'), selected.source_ip || t('Internal')],
              [t('Assigned To'), selected.assignee_name || t('Unassigned')],
              [t('Created'), fmtDateTime(selected.detected_at || selected.created_at)],
            ]} />
          </>
        )}
      </Modal>

      <Modal
        open={creating} onClose={() => setCreating(false)} title={t('Create Incident')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setCreating(false)}>{t('Cancel')}</button><button type="submit" form="create-incident" className="btn btn-primary" disabled={saving || !form.title.trim()}>{saving ? t('Creating…') : t('Create Incident')}</button></>)}
      >
        <form id="create-incident" onSubmit={create}>
          <ErrorNote>{formError}</ErrorNote>
          <div className="sec-field" style={{ marginTop: formError ? 12 : 0 }}><label htmlFor="inc-title">{t('Title')}</label><input id="inc-title" className="sec-input" required value={form.title} onChange={upd('title')} placeholder={t('Incident title')} autoFocus /></div>
          <div className="sec-field"><label htmlFor="inc-desc">{t('Description')}</label><textarea id="inc-desc" className="sec-input" value={form.description} onChange={upd('description')} placeholder={t('Describe what happened')} /></div>
          <div className="sec-grid-2">
            <div className="sec-field"><label>{t('Category')}</label><FilterSelect value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} options={CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))} /></div>
            <div className="sec-field"><label>{t('Severity')}</label><FilterSelect value={form.severity} onChange={(v) => setForm((f) => ({ ...f, severity: v }))} options={SEVERITIES.map((s) => ({ value: s, label: label(s) }))} /></div>
          </div>
          <div className="sec-field"><label htmlFor="inc-ip">{t('Source IP')}</label><input id="inc-ip" className="sec-input mono" value={form.sourceIp} onChange={upd('sourceIp')} placeholder="10.0.0.1" dir="ltr" /></div>
        </form>
      </Modal>
    </div>
  );
}
