import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/ai-code-review-history';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/ai-code-review-history.php, talking to the
 * real JSON API (AdminAiCodeReviewApiController::history() — reuses the
 * exact same AiCodeReviewRepository::allForProject() +
 * AiCodeReviewIssueRepository::severityCountsForReview() calls the
 * Blade view already made).
 */

const STATUS_META = {
  completed:  { cls: 'badge-success', label: 'Completed' },
  processing: { cls: 'badge-primary', label: 'Processing' },
  queued:     { cls: 'badge-neutral', label: 'Queued' },
  failed:     { cls: 'badge-danger',  label: 'Failed' },
};

const SCORE_LABELS = { overall: 'Overall', security: 'Security', performance: 'Performance', maintainability: 'Maintainability' };

export default function AdminAiCodeReviewHistory() {
  const t = useTranslations(translations);
  const { projectId } = useParams();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/admin/ai-code-review/project/${projectId}/history`)
      .then((json) => setVersions(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton rows={6} cols={4} />;
  if (error) return <ErrorState error={error} />;

  return (
    <>
      <BackLink to="/admin/ai-code-review" className="adm-link-back"><Icon name="chevron-left" size={14} /> {t('AI Code Review')}</BackLink>

      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Review Version History')}</h1>
          <p className="text-small">#{projectId}</p>
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center' }}>
          <p className="adm-empty">{t('No reviews for this project yet.')}</p>
        </div>
      ) : (
        versions.map((v, i) => {
          const meta = STATUS_META[v.status] || STATUS_META.queued;
          const compareWith = versions[i + 1];
          return (
            <div key={v.id} className="adm-panel" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <div>
                  <strong>v{v.version}</strong>{' '}
                  <span className={`badge ${meta.cls}`}>{t(meta.label)}</span>{' '}
                  {v.approved_at && <span className="badge badge-success">{t('Approved')}</span>}{' '}
                  {Number(v.score_overridden) === 1 && <span className="badge badge-warning">{t('Score overridden')}</span>}
                </div>
                <span className="adm-muted">{v.created_at ? v.created_at.slice(0, 16).replace('T', ' ') : '—'}</span>
              </div>

              <div className="adm-facts" style={{ margin: '14px 0', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                {Object.entries(SCORE_LABELS).map(([k, label]) => (
                  <div className="adm-fact" key={k}><small>{t(label)}</small><strong>{v.scores?.[k] ?? '—'}</strong></div>
                ))}
              </div>

              {v.summary && <p className="text-small">{v.summary}</p>}

              {v.admin_notes && (
                <p className="text-caption"><strong>{t('Admin note:')}</strong> {v.admin_notes}</p>
              )}

              <p className="text-caption">
                {t('Issue severity')}:{' '}
                {Object.entries(v.issue_counts || {}).filter(([, count]) => count > 0).map(([sev, count]) => (
                  <span key={sev} className="badge badge-neutral" style={{ marginInlineEnd: 4 }}>{sev}: {count}</span>
                ))}
              </p>

              {compareWith && (
                <Link className="btn btn-outline btn-sm" to={`/admin/ai-code-review/compare/${v.id}/${compareWith.id}`}>
                  {t('Compare with v')}{compareWith.version}
                </Link>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
