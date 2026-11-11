import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, getTokens } from '../../api/client';
import { safeHref } from '../../lib/safeUrl';
import Icon from '../../components/Icon';
import { ActionPreviewButton } from '../../components/FilePreviewButton';
import { saveBlob } from '../../lib/exporter';
import { ConfirmModal } from '../../components/admin/adminUi';

import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/ai-code-review';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/ai-code-review.php, talking to the real JSON
 * API (app/Controllers/Api/AdminAiCodeReviewApiController.php — new;
 * reuses the exact same AiCodeReviewRepository::filteredPaginated()/
 * platformStats() calls the Blade view already made). Every row action
 * (approve/note/override score/re-run) is a real write logged via
 * AuditLogService, same as the web form flow.
 */

const STATUS_META = {
  completed:  { cls: 'badge-success', label: 'Completed' },
  processing: { cls: 'badge-primary', label: 'Processing' },
  queued:     { cls: 'badge-neutral', label: 'Queued' },
  failed:     { cls: 'badge-danger',  label: 'Failed' },
};

const FORMATS = ['pdf', 'csv', 'xlsx', 'json'];

function StatCard({ label, value, icon }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__top">{label} <Icon name={icon} size={16} /></div>
      <div className="adm-kpi__value">{value}</div>
    </div>
  );
}

async function downloadExport(url, filename) {
  const { accessToken } = getTokens();
  const res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!res.ok) throw new Error('Export failed');
  saveBlob(await res.blob(), filename);
}

function ActionsMenu({ review, onChanged, onError }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('review');
  const [rerun, setRerun] = useState(false);
  const [note, setNote] = useState(review.admin_notes || '');
  const [newScore, setNewScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    onError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(fmt) {
    try {
      await downloadExport(`/api/v1/admin/ai-code-review/project/${review.project_id}/export?format=${fmt}`, `ai_code_review_project_${review.project_id}.${fmt === 'xlsx' ? 'xlsx' : fmt}`);
    } catch {
      onError(t('Export failed. Please try again.'));
    }
  }

  const title = L(t, review.title_en, review.title_ar) || '—';

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setTab('review'); setOpen(true); }}>{t('Actions')}</button>

      {open && createPortal(
        <div className="modal-overlay um-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="um um--sm" role="dialog" aria-modal="true" aria-labelledby="cr-title">
            <header className="um-head">
              <span className="um-head__avatar"><Icon name="ai-spark" size={22} /></span>
              <div className="um-head__text">
                <h2 id="cr-title">{title}</h2>
                <p><span className="um-ver">v{review.version || 1}</span>{review.approved_at ? <span className="badge badge-success">{t('Approved')}</span> : <span className="badge badge-neutral">{t('Not reviewed')}</span>}</p>
              </div>
              <button type="button" className="um-close" onClick={() => setOpen(false)} aria-label={t('Close')}><Icon name="x" size={18} /></button>
            </header>

            <div className="um-tabs" role="tablist">
              {[['review', 'Review', 'check-circle'], ['export', 'Export', 'download'], ['notes', 'Notes & score', 'edit']].map(([k, label, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`um-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>
                  <Icon name={icon} size={15} /> {t(label)}
                </button>
              ))}
            </div>

            <div className="um-body">
              {tab === 'review' && (
                <div className="um-actions-grid">
                  <button type="button" className="um-action um-action--primary" disabled={busy}
                    onClick={() => run(() => api.post(`/api/v1/admin/ai-code-review/${review.id}/approve`))}>
                    <span className="um-action__icon"><Icon name="check-circle" size={20} /></span>
                    <span><strong>{t('Approve')}</strong><small>{tr('Mark this review as approved by the admin.', 'اعتماد هذه المراجعة من الأدمن.')}</small></span>
                  </button>
                  <button type="button" className="um-action" disabled={busy} onClick={() => setRerun(true)}>
                    <span className="um-action__icon"><Icon name="refresh" size={20} /></span>
                    <span><strong>{t('Re-run')}</strong><small>{tr('Run the AI analysis again and create a new version.', 'إعادة تشغيل التحليل وإنشاء نسخة جديدة.')}</small></span>
                  </button>
                  <Link className="um-action" to={`/admin/ai-code-review/project/${review.project_id}/history`}>
                    <span className="um-action__icon"><Icon name="clock" size={20} /></span>
                    <span><strong>{t('Version History')}</strong><small>{tr('Browse and compare previous versions.', 'استعراض ومقارنة النسخ السابقة.')}</small></span>
                  </Link>
                </div>
              )}

              {tab === 'export' && (
                <div className="um-formats">
                  {FORMATS.map((fmt) => (
                    <div key={fmt} className="um-format">
                      <span className="um-format__name">{fmt.toUpperCase()}</span>
                      <div className="um-format__btns">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => handleExport(fmt)}><Icon name="download" size={14} /> {tr('Download', 'تنزيل')}</button>
                        <ActionPreviewButton className="btn btn-outline btn-sm" iconSize={14} label run={() => handleExport(fmt)} title={`${title} · ${fmt.toUpperCase()}`} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'notes' && (
                <>
                  <section className="um-section">
                    <h3 className="um-section__title">{t('Admin note...').replace('...', '')}</h3>
                    <textarea className="um-input um-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Admin note...')} />
                    <div className="um-row-end">
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy}
                        onClick={() => run(() => api.post(`/api/v1/admin/ai-code-review/${review.id}/note`, { admin_notes: note }))}>
                        {t('Save Note')}
                      </button>
                    </div>
                  </section>

                  <section className="um-section">
                    <h3 className="um-section__title">{t('Override Score')}</h3>
                    <input className="um-input" type="number" min="0" max="100" placeholder={t('New score')} value={newScore} onChange={(e) => setNewScore(e.target.value)} />
                    <textarea className="um-input um-textarea" rows={2} placeholder={t('Override reason (required)')} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    <div className="um-row-end">
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy || newScore === '' || !overrideReason.trim()}
                        onClick={() => run(() => api.post(`/api/v1/admin/ai-code-review/${review.id}/override-score`, { overall_score: newScore, override_reason: overrideReason }))}>
                        {t('Override Score')}
                      </button>
                    </div>
                  </section>
                </>
              )}
            </div>

            <footer className="um-foot">
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{t('Close')}</button>
            </footer>
          </div>
        </div>,
        document.body,
      )}

      {rerun && (
        <ConfirmModal
          title={t('Confirm action')}
          message={t('Re-run the AI analysis for this project? A new review version will be created.')}
          confirmLabel={t('Re-run')}
          busy={busy}
          onConfirm={async () => { await run(() => api.post(`/api/v1/admin/ai-code-review/${review.project_uuid}/rerun`)); setRerun(false); }}
          onClose={() => setRerun(false)}
        />
      )}
    </>
  );
}

export default function AdminAiCodeReview() {
  const t = useTranslations(translations);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = {
    search: searchParams.get('search') || '',
    university_id: searchParams.get('university_id') || '',
    status: searchParams.get('status') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
    score_min: searchParams.get('score_min') || '',
    score_max: searchParams.get('score_max') || '',
  };
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [form, setForm] = useState(filters);
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, failed: 0, total_issues: 0 });
  const [universities, setUniversities] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/ai-code-review', { ...filters, page })
      .then((json) => {
        setReviews(json.data || []);
        setStats(json.meta?.stats || { total: 0, completed: 0, failed: 0, total_issues: 0 });
        setUniversities(json.meta?.universities || []);
        setTotalPages(json.meta?.totalPages || 1);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setForm(filters); }, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters(e) {
    e.preventDefault();
    const next = new URLSearchParams();
    Object.entries(form).forEach(([k, v]) => { if (v) next.set(k, v); });
    setSearchParams(next);
  }

  function resetFilters() {
    setSearchParams(new URLSearchParams());
  }

  function goToPage(n) {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', String(n));
      return next;
    });
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('AI Code Review')}</h1>
          <p className="text-small">{t('Every code review run against student project GitHub repositories, platform-wide.')}</p>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="adm-kpis">
        <StatCard label={t('Total Reviews')} value={stats.total} icon="sparkles" />
        <StatCard label={t('Completed')} value={stats.completed} icon="check-circle" />
        <StatCard label={t('Failed')} value={stats.failed} icon="x-circle" />
        <StatCard label={t('Total Issues Found')} value={Number(stats.total_issues || 0).toLocaleString()} icon="alert-triangle" />
      </div>

      <div className="adm-panel" style={{ marginBottom: 16 }}>
        <form onSubmit={applyFilters} className="adm-filter-form">
          <div className="form-group">
            <label className="form-label">{t('Search')}</label>
            <input className="form-input" type="text" placeholder={t('Project or student name')} value={form.search} onChange={(e) => setForm((f) => ({ ...f, search: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('University')}</label>
            <select className="form-input" value={form.university_id} onChange={(e) => setForm((f) => ({ ...f, university_id: e.target.value }))}>
              <option value="">{t('All')}</option>
              {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Status')}</label>
            <select className="form-input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="">{t('All')}</option>
              {Object.entries(STATUS_META).map(([key, meta]) => <option key={key} value={key}>{t(meta.label)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('From')}</label>
            <input className="form-input" type="date" value={form.date_from} onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('To')}</label>
            <input className="form-input" type="date" value={form.date_to} onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Min Score')}</label>
            <input className="form-input" type="number" min="0" max="100" style={{ width: 90 }} value={form.score_min} onChange={(e) => setForm((f) => ({ ...f, score_min: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Max Score')}</label>
            <input className="form-input" type="number" min="0" max="100" style={{ width: 90 }} value={form.score_max} onChange={(e) => setForm((f) => ({ ...f, score_max: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flexDirection: 'row', gap: 6 }}>
            <button type="submit" className="btn btn-primary btn-sm">{t('Filter')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>{t('Reset')}</button>
          </div>
        </form>

        {filters.university_id && (
          <div className="adm-export-row">
            <span className="adm-muted">{t('Export report for the selected university:')}</span>
            {FORMATS.map((fmt) => (
              <span key={fmt} style={{ display: 'inline-flex', gap: 2 }}>
                <button type="button" className="btn btn-outline btn-sm"
                  onClick={() => downloadExport(`/api/v1/admin/ai-code-review/university/${filters.university_id}/export?format=${fmt}`, `ai_code_review_university_${filters.university_id}.${fmt}`).catch(() => setError(t('Export failed. Please try again.')))}>
                  <Icon name="download" size={12} /> {fmt.toUpperCase()}
                </button>
                <ActionPreviewButton className="btn btn-outline btn-sm" iconSize={12} title={`${t('AI Code Review')} · ${fmt.toUpperCase()}`}
                  run={() => downloadExport(`/api/v1/admin/ai-code-review/university/${filters.university_id}/export?format=${fmt}`, `ai_code_review_university_${filters.university_id}.${fmt}`)} />
              </span>
            ))}
          </div>
        )}

        <FacultyExport onError={setError} />
      </div>

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : reviews.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center' }}>
          <p className="adm-empty">{t('No matching code reviews.')}</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>{t('Project')}</th><th>{t('Student')}</th><th>{t('Status')}</th><th>{t('Score')}</th><th>{t('Issues')}</th><th>{t('Admin Review')}</th><th>{t('Date')}</th><th>{t('Actions')}</th></tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const meta = STATUS_META[r.status] || STATUS_META.queued;
                const title = L(t, r.title_en, r.title_ar) || '—';
                const scoreClass = r.overall_score === null ? null : (r.overall_score >= 70 ? 'badge-success' : r.overall_score >= 40 ? 'badge-warning' : 'badge-danger');
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{title}</strong><br />
                      {r.repository_url
                        ? <a href={safeHref(r.repository_url)} target="_blank" rel="noopener noreferrer" className="adm-muted"><Icon name="github" size={12} /> GitHub</a>
                        : <span className="adm-muted">—</span>}
                      <br /><span className="adm-muted">v{r.version || 1}</span>
                    </td>
                    <td>{r.owner_name || '—'}</td>
                    <td><span className={`badge ${meta.cls}`}>{t(meta.label)}</span></td>
                    <td>
                      {r.overall_score !== null
                        ? <>
                            <span className={`badge ${scoreClass}`}>{r.overall_score}</span>
                            {Number(r.score_overridden) === 1 && <span className="text-caption" title={t('Manually overridden')}> <Icon name="edit" size={12} /></span>}
                          </>
                        : <span className="adm-muted">—</span>}
                    </td>
                    <td>{r.issues_found > 0 ? <span className="badge badge-danger">{r.issues_found}</span> : <span className="adm-muted">0</span>}</td>
                    <td>{r.approved_at ? <span className="badge badge-success">{t('Approved')}</span> : <span className="adm-muted">{t('Not reviewed')}</span>}</td>
                    <td>{r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td className="adm-actions"><ActionsMenu review={r} onChanged={load} onError={setError} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && reviews.length > 0 && totalPages > 1 && (
        <div className="adm-pager">
          <span>{stats.total.toLocaleString()} {t('reviews')}</span>
          <div>
            <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)} aria-label={t('Previous page')}><Icon name="chevron-left" size={16} /></button>
            <span>{t('Page')} {page} {t('of')} {totalPages}</span>
            <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)} aria-label={t('Next page')}><Icon name="chevron-right" size={16} /></button>
          </div>
        </div>
      )}
    </>
  );
}

function FacultyExport({ onError }) {
  const t = useTranslations(translations);
  const [faculty, setFaculty] = useState('');
  const [format, setFormat] = useState('pdf');
  const [busy, setBusy] = useState(false);

  const exportFaculty = () => downloadExport(`/api/v1/admin/ai-code-review/faculty/export?faculty=${encodeURIComponent(faculty)}&format=${format}`, `ai_code_review_faculty.${format}`);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!faculty.trim()) return;
    setBusy(true);
    try {
      await exportFaculty();
    } catch {
      onError(t('Export failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-export-row">
      <form onSubmit={handleSubmit} className="adm-filter-form" style={{ margin: 0 }}>
        <div className="form-group">
          <label className="form-label">{t('Export a faculty report')}</label>
          <input className="form-input" type="text" required placeholder={t('Faculty name')} value={faculty} onChange={(e) => setFaculty(e.target.value)} />
        </div>
        <select className="form-input" style={{ width: 'auto' }} value={format} onChange={(e) => setFormat(e.target.value)}>
          {FORMATS.map((fmt) => <option key={fmt} value={fmt}>{fmt.toUpperCase()}</option>)}
        </select>
        <button type="submit" className="btn btn-outline btn-sm" disabled={busy}><Icon name="download" size={12} /> {busy ? t('Exporting…') : t('Export')}</button>
        <ActionPreviewButton className="btn btn-outline btn-sm" iconSize={12} label disabled={!faculty.trim()} title={`${faculty} · ${format.toUpperCase()}`} run={exportFaculty} />
      </form>
    </div>
  );
}
