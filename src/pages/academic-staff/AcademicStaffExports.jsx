import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';
import { EXPORT_FORMATS, downloadExport } from './resultsShared';
import { parseServerDate } from '../../utils/serverDate';

const translations = { ...i18nCommon, ...i18nExam };
const API = '/api/v1/exam-system/exports';

const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/**
 * Exports centre (sidebar → Exports). Every export is generated once, SAVED on the server and
 * listed here with Preview / Download / Delete — same idea as the Data Analysis export centre.
 * API: GET/POST /exam-system/exports, GET .../{id}/preview, GET .../{id}/download, DELETE .../{id}.
 * The same save-to-centre flow is used by the Export menu on an exam's attempts page and the
 * Students' Results page.
 */
export default function AcademicStaffExports() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [items, setItems] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [type, setType] = useState('exam_results');
  const [examId, setExamId] = useState('');
  const [format, setFormat] = useState('xlsx');
  const [generating, setGenerating] = useState(false);

  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(() => api.get(API).then((json) => setItems(json.data || [])), []);

  useEffect(() => {
    Promise.all([
      load(),
      api.get('/api/v1/exam-system/exams').then((json) => {
        const list = json.data || [];
        setExams(list);
        if (list[0]) setExamId(String(list[0].id));
      }),
    ]).catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      await api.post(API, { export_type: type, format, ...(type === 'exam_results' ? { exam_id: Number(examId) } : {}) });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  async function openPreview(item) {
    setPreviewLoading(true);
    setPreview({ title: item.title, id: item.id, format: item.format, header: [], rows: [], total: 0 });
    try {
      const json = await api.get(`${API}/${item.id}/preview`);
      setPreview(json.data);
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err) || t('Preview failed'));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function download(item) {
    setError(null);
    try {
      await downloadExport(`${API}/${item.id}/download`, `${item.title.replace(/[^\w.-]+/g, '_')}.${item.format}`);
    } catch {
      setError(t('Download failed'));
    }
  }

  async function remove(item) {
    if (!window.confirm(t('Delete this export?'))) return;
    setError(null);
    try {
      await api.del(`${API}/${item.id}`);
      setItems((list) => list.filter((x) => x.id !== item.id));
      setSelected((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const allSelected = items.length > 0 && items.every((x) => selected.has(x.id));
  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((x) => x.id)));
  }

  async function bulkRemove(all) {
    const ids = [...selected];
    if (!all && ids.length === 0) return;
    const msg = all
      ? t('Delete ALL exports? This cannot be undone.')
      : t('Delete {n} selected exports? This cannot be undone.').replace('{n}', ids.length);
    if (!window.confirm(msg)) return;
    setDeleting(true);
    setError(null);
    try {
      await api.post(`${API}/bulk-delete`, all ? { all: true } : { ids });
      await load();
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;

  const col = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };
  const chip = (active) => ({
    padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
    background: active ? 'rgba(var(--color-primary-rgb), .1)' : 'var(--bg-surface)',
    color: active ? 'var(--color-primary)' : 'var(--text-secondary)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 className="text-h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Icon name="download" size={22} /> {t('Exports')}
        </h1>
        <p className="text-small" style={{ margin: 'var(--space-1) 0 0' }}>{t('Saved exports. Preview, download or delete any time.')}</p>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="card glass-panel" style={col}>
        <h2 className="text-h3" style={{ margin: 0 }}>{t('New export')}</h2>

        <div style={col}>
          <span className="form-label">{t('What to export')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={chip(type === 'exam_results')} onClick={() => setType('exam_results')}>{t('Exam results')}</button>
            <button type="button" style={chip(type === 'students_results')} onClick={() => setType('students_results')}>{t("Students' results")}</button>
          </div>
        </div>

        {type === 'exam_results' && (
          <div className="form-group" style={{ maxWidth: 380 }}>
            <label className="form-label">{t('Choose exam')}</label>
            <select className="form-input" value={examId} onChange={(e) => setExamId(e.target.value)}>
              {exams.length === 0 && <option value="">{t('No exams yet.')}</option>}
              {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
        )}

        <div style={col}>
          <span className="form-label">{t('Format')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXPORT_FORMATS.map((f) => <button key={f} type="button" style={chip(format === f)} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>)}
          </div>
        </div>

        <div>
          <button type="button" className="btn btn-primary" disabled={generating || (type === 'exam_results' && !examId)} onClick={generate}>
            <Icon name="download" size={16} /> {generating ? t('Generating…') : t('Generate & save')}
          </button>
        </div>
      </div>

      <div className="card glass-panel" style={col}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 className="text-h3" style={{ margin: 0 }}>{t('Export history')}</h2>
          {items.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={deleting || selected.size === 0} onClick={() => bulkRemove(false)}>
                <Icon name="trash" size={14} /> {t('Delete selected')}{selected.size > 0 ? ` (${selected.size})` : ''}
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={deleting} onClick={() => bulkRemove(true)} style={{ color: 'var(--color-danger, #d92d20)' }}>
                <Icon name="trash" size={14} /> {t('Delete all')}
              </button>
            </div>
          )}
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            <Icon name="archive" size={32} className="empty-state__icon" />
            <p className="text-small">{t('No exports yet. Generate one above and it will be saved here.')}</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t('Select all')} />
                  </th>
                  <th>{t('Title')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Format')}</th>
                  <th>{t('Rows')}</th>
                  <th>{t('Size')}</th>
                  <th>{t('Created')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggleOne(x.id)} aria-label={t('Select')} />
                    </td>
                    <td style={{ fontWeight: 600 }}>{x.title}</td>
                    <td><span className="badge badge-neutral">{x.export_type === 'exam_results' ? t('Exam results') : t("Students' results")}</span></td>
                    <td><span className="badge badge-primary">{String(x.format).toUpperCase()}</span></td>
                    <td>{x.row_count}</td>
                    <td>{fmtSize(Number(x.file_size) || 0)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{parseServerDate(String(x.created_at)).toLocaleString(locale === 'ar' ? 'ar-EG' : undefined)}</td>
                    <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openPreview(x)}><Icon name="eye" size={14} /> {t('Preview')}</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => download(x)}><Icon name="download" size={14} /> {t('Download')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(x)} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal-box card glass-panel" style={{ maxWidth: 1000, width: '95vw', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-box__title text-h3">{preview.title}</h2>
            {previewLoading ? <p className="text-small">{t('Loading…')}</p> : (
              <>
                {preview.meta && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 var(--space-3)' }}>
                    {Object.entries(preview.meta).map(([k, v]) => <span key={k} className="badge badge-neutral">{k}: {v}</span>)}
                  </div>
                )}
                {preview.rows.length === 0 ? <p className="text-small">{t('No rows.')}</p> : (
                  <div className="table-responsive" style={{ maxHeight: '55vh' }}>
                    <table className="data-table">
                      <thead><tr>{preview.header.map((h, i) => <th key={i} style={{ position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
                      <tbody>{preview.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c ?? '')}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
                {preview.truncated && (
                  <p className="text-caption" style={{ margin: 'var(--space-2) 0 0' }}>
                    {t('Showing the first {n} of {total} rows.').replace('{n}', preview.rows.length).replace('{total}', preview.total)}
                  </p>
                )}
              </>
            )}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={() => setPreview(null)}>{t('Close')}</button>
              {!previewLoading && <button type="button" className="btn btn-primary" onClick={() => download({ id: preview.id, title: preview.title, format: preview.format })}><Icon name="download" size={14} /> {t('Download')}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
