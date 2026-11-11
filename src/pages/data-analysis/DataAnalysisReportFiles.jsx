import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, getTokens } from '../../api/client';
import Icon from '../../components/Icon';
import { ActionPreviewButton } from '../../components/FilePreviewButton';
import { saveBlob } from '../../lib/exporter';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nIndex from '../../i18n/data-analysis/report-files/index';
import i18nCreate from '../../i18n/data-analysis/report-files/create';
import i18nShow from '../../i18n/data-analysis/report-files/show';
import i18nReplace from '../../i18n/data-analysis/report-files/replace';

const translations = { ...i18nCommon, ...i18nIndex, ...i18nCreate, ...i18nShow, ...i18nReplace };

/**
 * Mirrors app/Views/data-analysis/report-files/{index,create,show,replace}.php,
 * talking to the real JSON API
 * (app/Controllers/Api/DataAnalysisReportFilesApiController.php +
 * DataAnalysisReportCommentsApiController.php,
 * /api/v1/data-analysis/report-files/* and /api/v1/data-analysis/comments/*
 * — new, thin wrappers added alongside this page; reuse
 * DataAnalysisReportFileRepository/Service and DataAnalysisCollaborationService
 * exactly as the server-rendered views already do). Same isDataAnalyst()
 * gate (data_analyst OR admin) already enforced server-side.
 *
 * Single-file, state-switched list/detail (list <-> viewing one file),
 * same convention as DataAnalysisDashboards.jsx rather than nested
 * router routes with a :id param, since no other Data Analysis page uses
 * URL-based detail routes.
 *
 * Deliberate omission vs. the PHP view: a standalone "Print" page isn't
 * built as a separate route — the detail view's Preview/Download actions
 * cover the same real data; a browser Print (Ctrl/Cmd+P) on the detail
 * view is offered instead of reproducing print.php's own PDF-embed layout.
 */

const EXTENSIONS = ['pdf', 'xlsx', 'csv', 'json', 'xml', 'docx', 'pptx'];
const SORTS = [
  { value: 'newest', en: 'Newest', ar: 'الأحدث' },
  { value: 'oldest', en: 'Oldest', ar: 'الأقدم' },
  { value: 'name', en: 'Name', ar: 'الاسم' },
  { value: 'size', en: 'Size', ar: 'الحجم' },
  { value: 'downloads', en: 'Downloads', ar: 'التنزيلات' },
];

/**
 * Downloads/previews go through the authenticated JSON API (Bearer
 * token), not a same-origin cookie — see api/client.js's docblock — so a
 * plain <a href> can't carry the Authorization header. Same pattern as
 * AdminAuditLogs.jsx's handleExport(): fetch as a blob, then trigger the
 * save via an in-memory object URL.
 */
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

export default function DataAnalysisReportFiles() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [viewingId, setViewingId] = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, categories: [], tags: [] });
  const [filters, setFilters] = useState({ view: 'active', q: '', category_id: '', tag_id: '', extension: '', sort: 'newest', page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/report-files', filters)
      .then((json) => {
        setRows(json.data || []);
        setMeta({
          total: json.meta?.total || 0,
          totalPages: json.meta?.totalPages || 1,
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

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Report Files')}</h1>
          <p className="text-small">{t('Upload, organize, and manage every analytics report file (PDF, Excel, CSV, JSON, XML, Word, PowerPoint).')}</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowUpload(true)}>
            <Icon name="upload" size={18} /> {t('Upload Report')}
          </button>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-4)' }}>{actionError}</p>}

      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        <button type="button" className={`tab-link ${filters.view === 'active' ? 'is-active' : ''}`} onClick={() => setFilters((f) => ({ ...f, view: 'active', page: 1 }))}>{t('Active')}</button>
        <button type="button" className={`tab-link ${filters.view === 'archived' ? 'is-active' : ''}`} onClick={() => setFilters((f) => ({ ...f, view: 'archived', page: 1 }))}>{t('Archived')}</button>
      </div>

      <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)', alignItems: 'end', marginBottom: 'var(--space-4)' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Search')}</label>
          <input className="form-input" type="text" value={filters.q} placeholder={t('Title or description...')} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value, page: 1 }))} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Category')}</label>
          <select className="form-input" value={filters.category_id} onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value, page: 1 }))}>
            <option value="">{t('All')}</option>
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Tag')}</label>
          <select className="form-input" value={filters.tag_id} onChange={(e) => setFilters((f) => ({ ...f, tag_id: e.target.value, page: 1 }))}>
            <option value="">{t('All')}</option>
            {meta.tags.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Format')}</label>
          <select className="form-input" value={filters.extension} onChange={(e) => setFilters((f) => ({ ...f, extension: e.target.value, page: 1 }))}>
            <option value="">{t('All')}</option>
            {EXTENSIONS.map((ext) => <option key={ext} value={ext}>{ext.toUpperCase()}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">{t('Sort')}</label>
          <select className="form-input" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value, page: 1 }))}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{locale === 'ar' ? s.ar : s.en}</option>)}
          </select>
        </div>
      </div>

      {loading && <p className="text-small">{t('Loading…')}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && (
        rows.length === 0 ? (
          <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
            <p className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>{t('No report files here')}</p>
            <p className="text-small" style={{ marginBottom: 'var(--space-4)' }}>{t('Upload your first analytics report to see it here.')}</p>
            <button type="button" className="btn btn-primary" onClick={() => setShowUpload(true)}>
              <Icon name="upload" size={18} /> {t('Upload Report')}
            </button>
          </div>
        ) : (
          <div className="table-responsive card glass-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الاسم' : 'Name'}</th>
                  <th>{t('Format')}</th>
                  <th>{t('Category')}</th>
                  <th>{locale === 'ar' ? 'الحجم' : 'Size'}</th>
                  <th>{locale === 'ar' ? 'تنزيلات' : 'Downloads'}</th>
                  <th>{locale === 'ar' ? 'بواسطة' : 'Uploaded By'}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href="#" onClick={(e) => { e.preventDefault(); setViewingId(f.id); }} style={{ fontWeight: 600 }}>{f.title}</a>
                      <div className="text-caption">{f.original_filename}</div>
                    </td>
                    <td><span className="badge badge-neutral">{String(f.file_extension).toUpperCase()}</span></td>
                    <td>{(locale === 'ar' ? f.category_name_ar : f.category_name_en) || '—'}</td>
                    <td>{formatBytes(f.file_size_bytes)}</td>
                    <td>{f.download_count}</td>
                    <td>{f.uploader_name}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <ActionPreviewButton className="btn btn-ghost btn-sm" iconSize={14} title={f.title || f.original_filename}
                          run={() => fetchAndOpen(`/api/v1/data-analysis/report-files/${f.id}/download`, { filename: f.original_filename })} />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title={t('Download')}
                          onClick={() => fetchAndOpen(`/api/v1/data-analysis/report-files/${f.id}/download`, { filename: f.original_filename }).catch((err) => setActionError(errorMessage(err)))}
                        >
                          <Icon name="download" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {meta.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-5)', alignItems: 'center' }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}><Icon name="chevron-left" size={16} /></button>
          <span className="text-small">{filters.page} / {meta.totalPages}</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={filters.page >= meta.totalPages} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}><Icon name="chevron-right" size={16} /></button>
        </div>
      )}

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
    </>
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
      const json = await api.postForm('/api/v1/data-analysis/report-files', fd);
      onDone(null, json.data);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Upload a New Analytics Report')}</h2>
        <p className="text-caption" style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="shield" size={14} /> {t('Every file is automatically scanned for viruses/malware before it is stored.')}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Title')}</label>
            <input className="form-input" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Q3 2026 Performance Report')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Description')}</label>
            <textarea className="form-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Short description (optional)')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Report File')}</label>
            <input className="form-input" type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Category')}</label>
            <select className="form-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('None')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{(locale === 'ar' ? c.name_ar : c.name_en) || c.name_en}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Tags (comma-separated)')}</label>
            <input className="form-input" type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('q3, kpi, forecast')} />
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [isNote, setIsNote] = useState(false);
  const [mentioned, setMentioned] = useState([]);
  const [posting, setPosting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/data-analysis/report-files/${id}`)
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // The preview iframe needs a Bearer-authenticated fetch (see
  // fetchAndOpen's docblock) — pull the PDF into a blob object URL once
  // per file, and clean it up when leaving this file or unmounting.
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    if (data?.can_preview) {
      const { accessToken } = getTokens();
      fetch(`/api/v1/data-analysis/report-files/${id}/preview`, {
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

  const { file, versions, can_preview: canPreview, comments, teammates } = data;
  const isArchived = !!file.is_archived;
  const canDelete = true; // server enforces data_analyst/admin role on delete

  async function runAction(promise, successReload = true) {
    setActionError(null);
    setBusy(true);
    try {
      await promise;
      if (successReload) load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(t('Permanently delete this report? The file and every version on disk will be deleted too.'))) return;
    setActionError(null);
    setBusy(true);
    try {
      await api.del(`/api/v1/data-analysis/report-files/${id}`);
      onDeleted();
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  async function handlePostComment(e) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setPosting(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/data-analysis/report-files/${id}/comments`, {
        body: commentBody,
        is_note: isNote,
        mentioned_user_ids: mentioned,
      });
      setCommentBody('');
      setIsNote(false);
      setMentioned([]);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  function toggleMention(uid) {
    setMentioned((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }

  function commentAction(commentId, action) {
    runAction(api.post(`/api/v1/data-analysis/comments/${commentId}/${action}`, {}));
  }

  return (
    <>
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
            onClick={() => fetchAndOpen(`/api/v1/data-analysis/report-files/${id}/download`, { filename: file.original_filename }).catch((err) => setActionError(errorMessage(err)))}
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
            onClick={() => runAction(api.post(`/api/v1/data-analysis/report-files/${id}/${isArchived ? 'unarchive' : 'archive'}`, {}))}
          >
            <Icon name="folder" size={16} /> {isArchived ? t('Unarchive') : t('Archive')}
          </button>
          {canDelete && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={handleDelete}>
              <Icon name="trash" size={16} /> {t('Delete')}
            </button>
          )}
        </div>
      </div>

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
              <dt className="text-caption">{t('Views')}</dt><dd>{file.view_count}</dd>
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

      <div className="glass-panel animate-rise-in" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>
          <Icon name="message" size={18} /> {t('Comments & Notes')} ({comments.length})
        </h2>

        <form onSubmit={handlePostComment} style={{ marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea className="form-input" rows={2} required placeholder={t('Add a comment or note...')} value={commentBody} onChange={(e) => setCommentBody(e.target.value)} />
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={isNote} onChange={(e) => setIsNote(e.target.checked)} /> {t('Mark as a Note')}
            </label>
            {teammates.length > 0 && (
              <div className="text-caption">
                <Icon name="users" size={14} /> {t('Mention (@)')}:
                {teammates.map((tm) => (
                  <label style={{ marginInlineEnd: 'var(--space-3)', fontWeight: 'normal' }} key={tm.id}>
                    <input type="checkbox" checked={mentioned.includes(tm.id)} onChange={() => toggleMention(tm.id)} /> {tm.full_name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={posting}>
              <Icon name="message" size={16} /> {posting ? t('Loading…') : t('Post')}
            </button>
          </div>
        </form>

        {comments.length === 0 ? (
          <p className="text-caption">{t('No comments or notes yet.')}</p>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', listStyle: 'none', padding: 0, margin: 0 }}>
            {comments.map((c) => (
              <li className="text-small" style={{ borderInlineStart: '2px solid var(--color-border)', paddingInlineStart: 'var(--space-3)', opacity: c.is_resolved ? 0.6 : 1 }} key={c.id}>
                <strong>{c.commenter_name}</strong>
                {c.is_note ? <span className="badge badge-neutral" style={{ marginInlineStart: 4 }}><Icon name="star" size={12} /> {t('Note')}</span> : null}
                {c.is_resolved ? <span className="badge badge-success" style={{ marginInlineStart: 4 }}>{t('Resolved')}</span> : null}
                <div className="text-caption">{String(c.created_at).slice(0, 16).replace('T', ' ')}</div>
                <p style={{ margin: 'var(--space-1) 0' }}>{c.body}</p>
                {(c.mentions || []).length > 0 && (
                  <p className="text-caption">{t('Mentioned: ')}{c.mentions.map((m) => m.full_name).join(', ')}</p>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} disabled={busy} onClick={() => commentAction(c.id, c.is_note ? 'unnote' : 'note')}>
                    {c.is_note ? t('Unmark Note') : t('Mark as Note')}
                  </button>
                  <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} disabled={busy} onClick={() => commentAction(c.id, c.is_resolved ? 'reopen' : 'resolve')}>
                    {c.is_resolved ? t('Reopen') : t('Resolve')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showReplace && (
        <ReplaceModal
          t={t}
          fileTitle={file.title}
          onClose={() => setShowReplace(false)}
          onDone={(err) => {
            setShowReplace(false);
            if (err) setActionError(err);
            else load();
          }}
          id={id}
        />
      )}
    </>
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
      await api.postForm(`/api/v1/data-analysis/report-files/${id}/replace`, fd);
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
            <input className="form-input" type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Version Notes (optional)')}</label>
            <textarea className="form-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('e.g. Updated after data correction')} />
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
