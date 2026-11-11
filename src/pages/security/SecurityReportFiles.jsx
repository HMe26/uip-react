import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage, getTokens } from '../../api/client';
import Icon from '../../components/Icon';
import { ActionPreviewButton } from '../../components/FilePreviewButton';
import { saveBlob } from '../../lib/exporter';
import { PageHead, Modal, FilterSelect, SearchBox, EmptyState, ErrorNote, TableSkeleton, Pagination } from '../../components/security/ui';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nIndex from '../../i18n/security/report-files/index';
import i18nCreate from '../../i18n/security/report-files/create';
import i18nShow from '../../i18n/security/report-files/show';
import i18nReplace from '../../i18n/security/report-files/replace';
import i18nDesign from '../../i18n/security/design';

const translations = { ...i18nCommon, ...i18nSecurity, ...i18nIndex, ...i18nCreate, ...i18nShow, ...i18nReplace, ...i18nDesign, 'Delete report': 'حذف التقرير' };

/**
 * Mirrors app/Views/security/report-files/{index,create,show,replace}.php,
 * talking to the real JSON API
 * (app/Controllers/Api/SecurityReportFilesApiController.php,
 * /api/v1/security/report-files/* — list/filter+pagination, upload,
 * detail, download, preview, replace, archive/unarchive, delete; reuses
 * SecurityReportFileRepository/Service exactly as the server-rendered
 * views do). Not scoped to the uploader — every security_admin/
 * security_officer/admin can act on any file, same as the web side.
 *
 * Single-file, state-switched list/detail (list <-> viewing one file),
 * same convention as DataAnalysisReportFiles.jsx. Unlike the Data
 * Analysis equivalent, there's no comments/collaboration sub-feature
 * here — SecurityReportFilesApiController has no comment endpoints, and
 * neither does the web SecurityReportFileController — so that section is
 * intentionally omitted rather than invented.
 *
 * Deliberate omission vs. the PHP view: a standalone "Print" page isn't
 * built as a separate route — the detail view's Preview/Download actions
 * cover the same real data; a browser Print (Ctrl/Cmd+P) on the detail
 * view stands in for print.php's own PDF-embed layout.
 */

const EXTENSIONS = ['pdf', 'xlsx', 'csv', 'json', 'xml', 'docx', 'pptx'];
const SORTS = [
  { value: 'newest', en: 'Newest', ar: 'الأحدث' },
  { value: 'oldest', en: 'Oldest', ar: 'الأقدم' },
  { value: 'name', en: 'Name', ar: 'الاسم' },
  { value: 'size', en: 'Size', ar: 'الحجم' },
  { value: 'downloads', en: 'Downloads', ar: 'التنزيلات' },
];

async function fetchAndOpen(url, { filename, inline } = {}) {
  const { accessToken } = getTokens();
  const res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const blob = await res.blob();
  if (inline) {
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } else {
    saveBlob(blob, filename || 'download');
  }
}

function formatBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${Math.round(value * 10) / 10} ${units[i]}`;
}

export default function SecurityReportFiles() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [viewingId, setViewingId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, categories: [], tags: [] });
  const [urlParams] = useSearchParams();
  const [filters, setFilters] = useState({ view: 'active', q: urlParams.get('q') || '', category_id: '', tag_id: '', extension: '', sort: 'newest', page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/security/report-files', filters)
      .then((json) => {
        setRows(json.data || []);
        setMeta({
          total: json.meta?.total || 0,
          totalPages: json.meta?.totalPages || Math.max(1, Math.ceil((json.meta?.total || 0) / (json.meta?.perPage || 25))),
          categories: json.meta?.categories || [],
          tags: json.meta?.tags || [],
        });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { if (!viewingId) load(); }, [load, viewingId]);

  const catName = (c) => (locale === 'ar' ? c.name_ar : c.name_en) || c.name_en;

  if (viewingId) {
    return (
      <ReportFileDetail
        id={viewingId}
        t={t}
        locale={locale}
        onBack={() => { setViewingId(null); setActionError(null); }}
        onDeleted={() => { setViewingId(null); load(); }}
      />
    );
  }

  const setF = (k) => (v) => setFilters((f) => ({ ...f, [k]: v, page: 1 }));
  const dl = (f) => fetchAndOpen(`/api/v1/security/report-files/${f.id}/download`, { filename: f.original_filename }).catch((err) => setActionError(errorMessage(err)));

  return (
    <div className="sec-page">
      <PageHead
        eyebrow={t('Workspace / Reports')} title={t('Report Files')}
        subtitle={t('Upload, organize, and manage every security report file (PDF, Excel, CSV, JSON, XML, Word, PowerPoint).')}
        actions={<button type="button" className="btn btn-primary" onClick={() => setShowUpload(true)}><Icon name="upload" size={16} /> {t('Upload Report')}</button>}
      />

      <ErrorNote>{actionError || error}</ErrorNote>

      <div className="segmented" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button type="button" role="tab" aria-selected={filters.view === 'active'} className={filters.view === 'active' ? 'is-active' : ''} onClick={() => setFilters((f) => ({ ...f, view: 'active', page: 1 }))}>{t('Active')}</button>
        <button type="button" role="tab" aria-selected={filters.view === 'archived'} className={filters.view === 'archived' ? 'is-active' : ''} onClick={() => setFilters((f) => ({ ...f, view: 'archived', page: 1 }))}>{t('Archived')}</button>
      </div>

      <div className="sec-toolbar">
        <SearchBox value={filters.q} onChange={setF('q')} placeholder={t('Title or description...')} />
        <FilterSelect value={filters.category_id} onChange={setF('category_id')} allLabel={t('Category')} options={meta.categories.map((c) => ({ value: String(c.id), label: catName(c) }))} />
        <FilterSelect value={filters.tag_id} onChange={setF('tag_id')} allLabel={t('Tag')} options={meta.tags.map((tg) => ({ value: String(tg.id), label: tg.name }))} />
        <FilterSelect value={filters.extension} onChange={setF('extension')} allLabel={t('Format')} options={EXTENSIONS.map((ext) => ({ value: ext, label: ext.toUpperCase() }))} />
        <FilterSelect value={filters.sort} onChange={setF('sort')} options={SORTS.map((x) => ({ value: x.value, label: locale === 'ar' ? x.ar : x.en }))} />
      </div>

      <section className="sec-card sec-card--flush">
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead><tr><th>{locale === 'ar' ? 'الاسم' : 'Name'}</th><th>{t('Format')}</th><th>{t('Category')}</th><th>{locale === 'ar' ? 'الحجم' : 'Size'}</th><th>{locale === 'ar' ? 'تنزيلات' : 'Downloads'}</th><th>{locale === 'ar' ? 'بواسطة' : 'Uploaded By'}</th><th className="col-actions" /></tr></thead>
            {loading && !rows.length ? <TableSkeleton cols={7} /> : (
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td className="wrap"><button type="button" className="sec-link" onClick={() => setViewingId(f.id)}>{f.title}</button><span className="sub">{f.original_filename}</span></td>
                    <td><span className="pill pill--neutral">{String(f.file_extension).toUpperCase()}</span></td>
                    <td className="muted">{(locale === 'ar' ? f.category_name_ar : f.category_name_en) || '—'}</td>
                    <td className="muted">{formatBytes(f.file_size_bytes)}</td>
                    <td className="muted">{f.download_count}</td>
                    <td>{f.uploader_name}</td>
                    <td className="col-actions"><ActionPreviewButton className="btn-tint" iconSize={13} label title={f.title || f.original_filename} run={() => fetchAndOpen(`/api/v1/security/report-files/${f.id}/download`, { filename: f.original_filename })} /> <button type="button" className="btn-tint" onClick={() => dl(f)}><Icon name="download" size={13} /> {t('Download')}</button></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && !error && rows.length === 0 && (
          <EmptyState icon="archive">
            {t('No report files here')} — {t('Upload your first security report to see it here.')}
          </EmptyState>
        )}
      </section>

      <Pagination page={filters.page} totalPages={meta.totalPages} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />

      {showUpload && (
        <UploadModal
          t={t}
          categories={meta.categories}
          locale={locale}
          onClose={() => setShowUpload(false)}
          onDone={(err, file) => {
            setShowUpload(false);
            if (err) { setActionError(err); return; }
            load();
            if (file?.id) setViewingId(file.id);
          }}
        />
      )}
    </div>
  );
}

function UploadModal({ t, categories, locale, onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) { setError(t('Report File') + ' — required'); return; }
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', description);
    if (categoryId) fd.append('category_id', categoryId);
    if (tags) fd.append('tags', tags);
    fd.append('file', file);
    try {
      const json = await api.postForm('/api/v1/security/report-files', fd);
      onDone(null, json.data);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Upload a New Security Report')}</h2>
        <p className="text-caption" style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="shield" size={14} /> {t('Every file is automatically scanned for viruses/malware before it is stored.')}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Title')}</label>
            <input className="sec-input" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Q3 2026 Security Audit Report')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Description')}</label>
            <textarea className="sec-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Short description (optional)')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Report File')}</label>
            <input className="sec-input" type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Category')}</label>
            <select className="sec-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('None')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{(locale === 'ar' ? c.name_ar : c.name_en) || c.name_en}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Tags (comma-separated)')}</label>
            <input className="sec-input" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pentest, cvss, q3" />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name="upload" size={16} /> {saving ? t('Loading…') : t('Upload')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReportFileDetail({ id, t, locale, onBack, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/security/report-files/${id}`)
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    if (data?.can_preview) {
      const { accessToken } = getTokens();
      fetch(`/api/v1/security/report-files/${id}/preview`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      })
        .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('Preview failed'))))
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        })
        .catch(() => { if (!cancelled) setPreviewUrl(null); });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, data?.can_preview]);

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return null;

  const { file, versions, can_preview: canPreview } = data;
  const isArchived = !!file.is_archived;

  async function runAction(promise) {
    setActionError(null);
    setBusy(true);
    try {
      await promise;
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    setActionError(null);
    setBusy(true);
    try {
      await api.del(`/api/v1/security/report-files/${id}`);
      onDeleted();
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="sec-page">
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 'var(--space-2)' }}>
            <Icon name="chevron-left" size={16} /> {t('Report Files')}
          </button>
          <h1 className="text-h1">{file.title}</h1>
          <p className="text-small">
            <span className="badge badge-neutral">{String(file.file_extension).toUpperCase()}</span>
            {isArchived && <span className="badge badge-warning" style={{ marginInlineStart: 6 }}>{t('Archived')}</span>}
          </p>
        </div>
        <div className="page-header__actions" style={{ flexWrap: 'wrap' }}>
          {canPreview && previewUrl && (
            <button type="button" className="btn btn-secondary" onClick={() => window.open(previewUrl, '_blank')}>
              <Icon name="eye" size={16} /> {t('Preview')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fetchAndOpen(`/api/v1/security/report-files/${id}/download`, { filename: file.original_filename }).catch((err) => setActionError(errorMessage(err)))}
          >
            <Icon name="download" size={16} /> {t('Download')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowReplace(true)} disabled={busy}>
            <Icon name="refresh" size={16} /> {t('Replace')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => runAction(api.post(`/api/v1/security/report-files/${id}/${isArchived ? 'unarchive' : 'archive'}`, {}))}
          >
            <Icon name="folder" size={16} /> {isArchived ? t('Unarchive') : t('Archive')}
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={16} /> {t('Delete')}
          </button>
        </div>
      </div>

      <Modal open={confirmDelete} tone="danger" onClose={() => setConfirmDelete(false)} title={t('Delete report')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button><button type="button" className="btn btn-danger" onClick={handleDelete}>{t('Delete')}</button></>)}>
        <div className="sec-modal__notice">{t('Permanently delete this report? The file and every version on disk will be deleted too.')}</div>
      </Modal>
      {actionError && <p style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-4)' }}>{actionError}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
        <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-6)' }}>
          {canPreview ? (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', height: 640 }}>
              {previewUrl
                ? <iframe src={previewUrl} style={{ width: '100%', height: '100%', border: 0 }} title={file.title} />
                : <p className="text-small" style={{ padding: 'var(--space-4)' }}>{t('Loading…')}</p>}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
              <Icon name="file" size={40} />
              <p className="text-small" style={{ marginTop: 'var(--space-2)' }}>{t('No in-browser preview for this file type — use Download.')}</p>
            </div>
          )}
          {file.description && <p className="text-small" style={{ marginTop: 'var(--space-4)' }}>{file.description}</p>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Details')}</h2>
            <dl className="text-small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-3)' }}>
              <dt className="text-caption">{t('File')}</dt><dd>{file.original_filename}</dd>
              <dt className="text-caption">{t('Type')}</dt><dd>{String(file.file_extension).toUpperCase()}</dd>
              <dt className="text-caption">{t('Size')}</dt><dd>{formatBytes(file.file_size_bytes)}</dd>
              <dt className="text-caption">{t('Category')}</dt><dd>{(locale === 'ar' ? file.category_name_ar : file.category_name_en) || '—'}</dd>
              <dt className="text-caption">{t('Uploaded By')}</dt><dd>{file.uploader_name}</dd>
              <dt className="text-caption">{t('Uploaded')}</dt><dd>{String(file.created_at).slice(0, 16).replace('T', ' ')}</dd>
              <dt className="text-caption">{t('Updated')}</dt><dd>{String(file.updated_at).slice(0, 16).replace('T', ' ')}</dd>
              <dt className="text-caption">{t('Downloads')}</dt><dd>{file.download_count}</dd>
            </dl>
            {(file.tags || []).length > 0 && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                {file.tags.map((tg) => <span className="badge badge-neutral" style={{ marginInlineEnd: 4 }} key={tg.id}>{tg.name}</span>)}
              </div>
            )}
          </div>

          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)' }}>
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Version History')}</h2>
            {versions.length === 0 ? (
              <p className="text-caption">{t('No version history yet.')}</p>
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', listStyle: 'none', padding: 0, margin: 0 }}>
                {versions.map((v) => (
                  <li className="text-small" style={{ borderInlineStart: '2px solid var(--color-border)', paddingInlineStart: 'var(--space-3)' }} key={v.id}>
                    <strong>{t('v')}{v.version_number}</strong> — {v.uploader_name}
                    <div className="text-caption">{String(v.created_at).slice(0, 16).replace('T', ' ')} · {String(v.file_extension).toUpperCase()} · {formatBytes(v.file_size_bytes)}</div>
                    {v.notes && <div className="text-caption">{v.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {showReplace && (
        <ReplaceModal
          t={t}
          onClose={() => setShowReplace(false)}
          onDone={(err) => {
            setShowReplace(false);
            if (err) setActionError(err);
            else load();
          }}
          id={id}
        />
      )}
    </div>
  );
}

function ReplaceModal({ t, id, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    if (notes) fd.append('notes', notes);
    try {
      await api.postForm(`/api/v1/security/report-files/${id}/replace`, fd);
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Upload a New Version')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('New File')}</label>
            <input className="sec-input" type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Version Notes (optional)')}</label>
            <textarea className="sec-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('e.g. Updated after pentest re-test')} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name="refresh" size={16} /> {saving ? t('Loading…') : t('Replace')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
