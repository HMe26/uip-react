import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/feed-reports';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/feed-reports.php, talking to the real
 * JSON API (FeedApiController::reports()/resolveReport(), already built,
 * reuses FeedService::reportsForUniversity()/moderateReport() exactly as
 * UniversityFeedController does).
 */

const STATUS_BADGE = { pending: 'badge-warning', actioned: 'badge-danger', dismissed: 'badge-neutral' };
const STATUS_LABEL = {
  pending: { en: 'Pending', ar: 'قيد المراجعة' },
  actioned: { en: 'Taken down', ar: 'تم الحذف' },
  dismissed: { en: 'Dismissed', ar: 'مرفوض' },
};

export default function UniversityFeedReports() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/feed/reports')
      .then((json) => setReports(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(id, action) {
    if (action === 'takedown' && !confirm(t('Take down this post?'))) return;
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/api/v1/feed/reports/${id}/resolve`, { action, notes: notes[id] || '' });
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Feed Reports')}</h1>
          <p className="text-small">{t('Student reports on your university feed posts.')}</p>
        </div>
        <Link to="/university/feed" className="btn btn-secondary">{t('University Feed')}</Link>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}
      {loading && <p className="text-small">{t('Loading…')}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && reports.length === 0 && (
        <div className="glass-panel" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <p className="text-small">{t('No reports.')}</p>
        </div>
      )}

      {!loading && !error && reports.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {reports.map((r) => {
            const busy = busyId === r.id;
            const statusLabel = STATUS_LABEL[r.status];
            return (
              <div key={r.id} className="card glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span className={`badge ${STATUS_BADGE[r.status] || 'badge-neutral'}`}>{statusLabel?.[locale] || statusLabel?.en || r.status}</span>
                      <h2 className="text-h3" style={{ margin: 0 }}>{r.post_title}</h2>
                      {r.post_deleted_at && <span className="badge badge-neutral">{t('Post deleted')}</span>}
                    </div>
                    <p className="text-caption" style={{ marginTop: 'var(--space-1)' }}>
                      {t('Reported by')} {r.reporter_name} · {(r.created_at || '').slice(0, 16).replace('T', ' ')}
                    </p>
                    <p className="text-small" style={{ marginTop: 'var(--space-2)', maxWidth: 640, whiteSpace: 'pre-wrap' }}>{r.reason}</p>
                    {r.resolution_notes && (
                      <p className="text-caption" style={{ marginTop: 'var(--space-2)' }}>{t('Resolution notes:')} {r.resolution_notes}</p>
                    )}
                  </div>
                  {r.status === 'pending' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 220 }}>
                      <input
                        className="form-input"
                        type="text"
                        placeholder={t('Notes (optional)')}
                        value={notes[r.id] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} disabled={busy} onClick={() => resolve(r.id, 'dismiss')}>
                        {t('Dismiss')}
                      </button>
                      {!r.post_deleted_at && (
                        <button type="button" className="btn btn-danger btn-sm" style={{ width: '100%' }} disabled={busy} onClick={() => resolve(r.id, 'takedown')}>
                          {t('Take down post')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
