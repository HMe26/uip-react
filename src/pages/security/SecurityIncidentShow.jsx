import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { downloadFile } from '../../components/security/download';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { ActionPreviewButton } from '../../components/FilePreviewButton';
import { downloadExport } from '../../lib/exportDownload';
import { PageHead, SevBadge, StatusPill, Modal, ErrorNote, tl } from '../../components/security/ui';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/incident-show';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign, 'Delete evidence': 'حذف الدليل', 'Delete': 'حذف' };

/**
 * Mirrors app/Views/security/incident-show.php, talking to the real JSON
 * API (/api/v1/security/incidents/{id} + status/assign/comment/evidence
 * sub-routes — SecurityIncidentsApiController).
 */

const STATUSES = ['open', 'investigating', 'contained', 'resolved', 'closed'];
const EVENT_ICON = { created: 'plus-circle', status_change: 'refresh', assignment: 'user', comment: 'message', evidence_upload: 'upload', evidence_delete: 'trash' };

export default function SecurityIncidentShow() {
  const t = useTranslations(translations);
  const label = tl(t);
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [status, setStatus] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [note, setNote] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [evToDelete, setEvToDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/security/incidents/${id}`)
      .then((json) => {
        setData(json.data);
        setStatus(json.data?.incident?.status || '');
        setAssignedTo(json.data?.incident?.assigned_to ? String(json.data.incident.assigned_to) : '');
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="sec-page"><section className="sec-card"><div className="sec-card__body" style={{ display: 'grid', gap: 12 }}><span className="sec-skel" style={{ width: '40%', height: 22 }} /><span className="sec-skel" style={{ width: '70%' }} /><span className="sec-skel" style={{ width: '55%' }} /></div></section></div>;
  if (error) return <div className="sec-page"><ErrorNote>{error}</ErrorNote></div>;
  if (!data) return null;

  const incident = data.incident || {};
  const timeline = data.timeline || [];
  const evidence = data.evidence || [];
  const assignees = data.assignees || [];

  const runAction = (promise) => {
    setActionError(null);
    setBusy(true);
    promise.then(() => load()).catch((err) => setActionError(errorMessage(err))).finally(() => setBusy(false));
  };

  const handleStatusUpdate = (e) => {
    e.preventDefault();
    runAction(api.patch(`/api/v1/security/incidents/${id}/status`, { status }));
  };

  const handleAssign = (e) => {
    e.preventDefault();
    runAction(api.patch(`/api/v1/security/incidents/${id}/assign`, { assigned_to: assignedTo || null }));
  };

  const handleComment = (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    runAction(api.post(`/api/v1/security/incidents/${id}/comment`, { note }).then(() => setNote('')));
  };

  const handleEvidenceUpload = (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    if (evidenceNote) formData.append('note', evidenceNote);
    setActionError(null);
    setBusy(true);
    api.postForm(`/api/v1/security/incidents/${id}/evidence`, formData)
      .then(() => { setEvidenceNote(''); if (fileInputRef.current) fileInputRef.current.value = ''; load(); })
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const confirmEvidenceDelete = () => {
    const evId = evToDelete.id;
    setEvToDelete(null);
    runAction(api.del(`/api/v1/security/incidents/${id}/evidence/${evId}`));
  };

  const downloadEvidence = (evId, filename) => {
    setActionError(null);
    return downloadFile(`/api/v1/security/incidents/${id}/evidence/${evId}/download`, { filename: filename || 'evidence' }).catch((err) => setActionError(errorMessage(err)));
  };

  const exportReport = (format) => {
    setActionError(null);
    return downloadExport(`/api/v1/security/incidents/${id}/export`, { format, filename: `incident-report-${incident.reference_code}`, title: `${t('Incident')} ${incident.reference_code}` }).catch((err) => setActionError(errorMessage(err)));
  };

  return (
    <div className="sec-page">
      <PageHead
        eyebrow={<><Link to="/security/incidents" style={{ color: 'inherit' }}>{t('Incidents')}</Link> / {incident.reference_code}</>}
        title={incident.title}
        subtitle={incident.reference_code}
        actions={(<>
          <SevBadge level={incident.severity} text={t(incident.severity)} />
          <StatusPill status={incident.status} text={t(incident.status)} />
          <ExportMenu iconSize={15} onExport={exportReport} />
        </>)}
      />

      <ErrorNote>{actionError}</ErrorNote>

      <div className="sec-row sec-row--bottom">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Description')}</h2>
            <p className="text-small">{incident.description || t('No description provided.')}</p>
            <div className="grid-2" style={{ marginTop: 'var(--space-4)' }}>
              <div>
                <span className="text-caption">{t('Category')}</span>
                <p className="text-small" style={{ margin: 0 }}>{String(incident.category || '').replace(/_/g, ' ')}</p>
              </div>
              <div>
                <span className="text-caption">{t('Source IP')}</span>
                <p className="text-small text-mono" style={{ margin: 0 }}>{incident.source_ip || '—'}</p>
              </div>
            </div>
          </div>

          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('Timeline')}</h2>
            {timeline.length ? timeline.map((ev, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--glass-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--color-primary)' }}>
                  <Icon name={EVENT_ICON[ev.event_type] || 'clock'} size={16} />
                </div>
                <div>
                  <p className="text-small" style={{ margin: 0 }}>
                    <strong>{ev.actor_name || t('System')}</strong> — {ev.note || String(ev.event_type || '').replace(/_/g, ' ')}
                  </p>
                  <span className="text-caption text-mono">{ev.created_at ? String(ev.created_at).replace('T', ' ').slice(0, 16) : ''}</span>
                </div>
              </div>
            )) : <p className="text-caption">{t('No events yet.')}</p>}

            <form onSubmit={handleComment} style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              <input
                type="text" className="sec-input" placeholder={t('Add a note...')}
                style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy}>{t('Post')}</button>
            </form>
          </div>

          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('Evidence & Attachments')}</h2>
            {evidence.length ? evidence.map((ev) => (
              <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div>
                  <p className="text-small" style={{ margin: 0 }}><strong>{ev.original_filename}</strong></p>
                  <span className="text-caption">
                    {ev.uploader_name || t('Unknown')} · {ev.created_at ? String(ev.created_at).replace('T', ' ').slice(0, 16) : ''} · {((Number(ev.file_size_bytes) || 0) / 1024).toFixed(1)} KB
                  </span>
                  {ev.note && <p className="text-caption" style={{ margin: '4px 0 0' }}>{ev.note}</p>}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                  <ActionPreviewButton className="btn btn-outline btn-sm" iconSize={14} label title={ev.original_filename} run={() => downloadEvidence(ev.id, ev.original_filename)} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadEvidence(ev.id, ev.original_filename)}>
                    <Icon name="download" size={14} />
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => setEvToDelete(ev)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            )) : <p className="text-caption">{t('No evidence uploaded yet.')}</p>}

            <form onSubmit={handleEvidenceUpload} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              <input type="file" ref={fileInputRef} className="sec-input" required />
              <input
                type="text" className="sec-input" placeholder={t('Note (optional)')}
                value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)}
              />
              <button type="submit" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
                <Icon name="upload" size={16} /> {t('Upload Evidence')}
              </button>
            </form>
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Change Status')}</h2>
            <form onSubmit={handleStatusUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <select className="sec-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
              <button type="submit" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
                {t('Update')}
              </button>
            </form>
          </div>

          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Assignment')}</h2>
            <form onSubmit={handleAssign} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <select className="sec-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">{t('Unassigned')}</option>
                {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
              <button type="submit" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
                {t('Save Assignment')}
              </button>
            </form>
          </div>
        </aside>
      </div>

      <Modal open={!!evToDelete} tone="danger" onClose={() => setEvToDelete(null)} title={t('Delete evidence')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setEvToDelete(null)}>{t('Cancel')}</button><button type="button" className="btn btn-danger" onClick={confirmEvidenceDelete}>{t('Delete')}</button></>)}>
        <div className="sec-modal__notice">{t('Permanently delete this evidence?')}</div>
        {evToDelete && <strong>{evToDelete.original_filename}</strong>}
      </Modal>
    </div>
  );
}
