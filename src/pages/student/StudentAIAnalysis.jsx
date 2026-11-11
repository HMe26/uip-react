import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import CodeReviewReportPanel from '../../components/CodeReviewReportPanel';
import { AI_ANALYSIS_FORMATS, exportAiAnalysisReport } from '../../lib/aiAnalysisExport';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { Pill, Score, EmptyState, Skeleton } from '../../components/student/stUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/ai-analysis';

const translations = { ...i18nCommon, ...i18nPage };

const CATEGORY_AR = {
  'Software & AI': 'البرمجيات والذكاء الاصطناعي', 'Hardware & IoT': 'الأجهزة وإنترنت الأشياء', 'Biotech & Health': 'التقنية الحيوية والصحة',
  'Sustainability & Energy': 'الاستدامة والطاقة', FinTech: 'التقنية المالية', EdTech: 'تقنية التعليم', Agriculture: 'الزراعة',
  'Manufacturing & Materials': 'التصنيع والمواد', 'Social Impact': 'الأثر الاجتماعي', Other: 'أخرى',
};
const PRIORITY_TONE = { high: 'danger', medium: '', low: 'neutral' };

/**
 * Mirrors app/Views/student/ai-analysis.php, talking to the same real AI
 * pipeline via JSON:
 *  - GET  /api/v1/projects              (project switcher — ProjectsApiController::index())
 *  - GET  /api/v1/projects/{id}/ai-analysis          (ProjectsApiController::latestAiAnalysis(),
 *    AIAnalysisService::getLatest() — whatever's already persisted, no AI call on load)
 *  - POST /api/v1/projects/{id}/ai-analysis/consent  (grantAiConsent())
 *  - POST /api/v1/projects/{id}/ai-analysis/run      (runAiAnalysis() — AIAnalysisService::runFullAnalysis())
 *  - GET  /api/v1/projects/{id}/ai-analysis/similar  (similarProjects() — AISemanticSearchService, live/not persisted)
 *
 * Unlike the PHP page (which knows aiAvailable/aiConsented upfront from
 * server-side service calls), the API exposes no "is the AI provider
 * configured" or "has this project already consented" GET — consent and
 * run are two separate POST endpoints. So this page infers both from real
 * responses instead of guessing: if the project already has saved results,
 * consent must already be on file (running requires it), so only the
 * "Re-run" button is shown. Otherwise the consent checkbox is shown and
 * checking it + submitting calls consent then run in sequence. If the
 * provider genuinely isn't configured, the run call itself returns 503
 * with the exact "AI provider is not configured" message, shown verbatim —
 * never a locally-guessed availability flag.
 */
export default function StudentAIAnalysis() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(null);

  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [reviewKey, setReviewKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);

  const [semanticMatches, setSemanticMatches] = useState(null);
  const [findingSimilar, setFindingSimilar] = useState(false);

  const selectedId = searchParams.get('project') || '';
  const ar0 = locale === 'ar';
  const selectedProject = projects.find((p) => p.id === selectedId);
  const selectedTitle = selectedProject ? (selectedProject.title?.[locale] || selectedProject.title?.en || selectedProject.title?.ar || '') : '';
  usePageMeta(ar0 ? 'تحليل الذكاء الاصطناعي' : 'AI Analysis', selectedTitle ? (ar0 ? `المشروع المحدد: «${selectedTitle}»` : `Selected project: "${selectedTitle}"`) : (ar0 ? 'راجع تحليلات الجاهزية والابتكار لمشاريعك.' : 'Review AI-generated readiness and innovation insights for your projects.'));

  useEffect(() => {
    setProjectsLoading(true);
    api.get('/api/v1/projects', { per_page: 100 })
      .then((json) => {
        const rows = json.data || [];
        setProjects(rows);
        if (!selectedId && rows.length) {
          setSearchParams({ project: rows[0].id }, { replace: true });
        }
      })
      .catch((err) => setProjectsError(errorMessage(err)))
      .finally(() => setProjectsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAnalysis = useCallback((uuid) => {
    if (!uuid) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    setSemanticMatches(null);
    setActionError(null);
    setActionSuccess(null);
    setAiUnavailable(false);
    setConsentChecked(false);
    api.get(`/api/v1/projects/${uuid}/ai-analysis`)
      .then((json) => setAnalysis(json.data || null))
      .catch((err) => setAnalysisError(errorMessage(err)))
      .finally(() => setAnalysisLoading(false));
  }, []);

  useEffect(() => { if (selectedId) loadAnalysis(selectedId); }, [selectedId, loadAnalysis]);

  const project = projects.find((p) => p.id === selectedId) || null;

  const readiness = analysis?.readiness || null;
  const classification = analysis?.classification || null;
  const startupPotential = analysis?.startup_potential || null;
  const suggestions = analysis?.suggestions || [];
  const summary = analysis?.summary || null;
  const logs = analysis?.logs || {};
  const hasResults = Boolean(readiness || classification || startupPotential || suggestions.length || summary);
  const failedLogs = Object.entries(logs).filter(([, log]) => log.status === 'failed');
  const readinessFailed = logs.readiness_score?.status === 'failed';

  const runAnalysis = async () => {
    if (!project) return;
    setActionError(null);
    setActionSuccess(null);
    setRunning(true);
    try {
      if (!hasResults) {
        await api.post(`/api/v1/projects/${project.id}/ai-analysis/consent`);
      }
      const res = await api.post(`/api/v1/projects/${project.id}/ai-analysis/run`, { locale });
      const outcomes = res.data || {};
      const failed = Object.values(outcomes).filter((o) => !o.ok);
      const total = Object.keys(outcomes).length;
      setActionSuccess(
        failed.length
          ? `${failed.length} ${locale === 'ar' ? `من ${total} فحوصات فشلت.` : `of ${total} checks failed.`}`
          : (locale === 'ar' ? 'اكتمل التحليل بنجاح.' : 'AI analysis complete.')
      );
      loadAnalysis(project.id);
      setReviewKey((k) => k + 1);
    } catch (err) {
      if (err.status === 503) {
        setAiUnavailable(true);
      } else {
        setActionError(errorMessage(err));
      }
    } finally {
      setRunning(false);
    }
  };

  const findSimilar = async () => {
    if (!project) return;
    setActionError(null);
    setFindingSimilar(true);
    try {
      const res = await api.get(`/api/v1/projects/${project.id}/ai-analysis/similar`);
      setSemanticMatches(res.data || []);
    } catch (err) {
      if (err.status === 503) {
        setAiUnavailable(true);
      } else {
        setActionError(errorMessage(err));
      }
    } finally {
      setFindingSimilar(false);
    }
  };

  if (projectsLoading) return <Skeleton h={110} count={2} />;
  if (projectsError) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{projectsError}</span></div>;

  const ar = locale === 'ar';
  const overall = Number(readiness?.overall_score || 0);
  const innovation = Number(readiness?.innovation_score || 0);

  return (
    <div className="st-page">
      {projects.length > 0 && (
        <div className="st-page__actions">
          <select className="form-select" style={{ width: 'auto', minWidth: 220 }} value={selectedId} onChange={(e) => setSearchParams({ project: e.target.value })} aria-label={ar ? 'المشروع' : 'Project'}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title?.[locale] || p.title?.en || p.title?.ar}</option>
            ))}
          </select>
        </div>
      )}

      {!project ? (
        <EmptyState icon="sparkles" title={t("You don't have any projects yet.")} text={t('Create your first project to run AI analysis on it.')}>
          <Link to="/student/projects/create" className="btn btn-primary"><Icon name="plus" size={16} /> {t('New Project')}</Link>
        </EmptyState>
      ) : (
        <>
          {analysisError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{analysisError}</span></div>}
          {actionError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{actionError}</span></div>}
          {actionSuccess && <div className="st-alert st-alert--success"><Icon name="check-circle" size={16} /><span>{actionSuccess}</span></div>}

          {aiUnavailable ? (
            <div className="st-alert st-alert--warning">
              <Icon name="alert-triangle" size={16} />
              <span>{t("The AI engine isn't configured yet — an admin needs to add a provider API key under Settings → AI. Until then, nothing fake is shown here.")}</span>
            </div>
          ) : (
            <>
              <section className="st-panel">
                <div className="st-row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <div className="st-row" style={{ justifyContent: 'flex-start', gap: 10 }}>
                    <Icon name="sparkles" size={20} />
                    <span style={{ fontSize: 13.5 }}>
                      {analysisLoading ? t('Loading…') : hasResults ? t('This is the last saved analysis for this project.') : t("You haven't run an analysis for this project yet.")}
                    </span>
                  </div>
                  <div className="st-row" style={{ gap: 14, flexWrap: 'wrap' }}>
                    {!hasResults && (
                      <label className="st-row" style={{ justifyContent: 'flex-start', gap: 8, cursor: 'pointer', maxWidth: 420, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />
                        <span>{t("I agree to send this project's data (description and files) to the external AI provider for analysis.")}</span>
                      </label>
                    )}
                    {hasResults && project?.id && (
                      <ExportMenu className="btn btn-outline btn-sm" iconSize={14} label={t('Export analysis')} formats={AI_ANALYSIS_FORMATS} onExport={(format) => exportAiAnalysisReport(project.id, format)} />
                    )}
                    <button type="button" className="btn btn-primary btn-sm" disabled={running || analysisLoading || (!hasResults && !consentChecked)} onClick={runAnalysis}>
                      <Icon name="refresh" size={14} /> {running ? t('Analyzing…') : hasResults ? t('Re-run analysis') : t('Run analysis')}
                    </button>
                  </div>
                </div>
                {running && <p className="st-muted" style={{ fontSize: 12, marginTop: 10 }}>{t('This can take a few minutes for a full report — feel free to leave this tab open and check back.')}</p>}
              </section>

              {!analysisLoading && !hasResults && (
                <>
                  {failedLogs.length > 0 && (
                    <section className="st-panel" style={{ borderInlineStart: '4px solid var(--color-danger)' }}>
                      <h2 style={{ marginBottom: 10 }}>{t('Error details (for diagnosis)')}</h2>
                      <ul className="st-list">
                        {failedLogs.map(([logType, log]) => (
                          <li key={logType} style={{ fontSize: 13 }}><strong>{logType}:</strong> {log.result?.error || (ar ? 'خطأ غير معروف' : 'unknown error')}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <EmptyState icon="sparkles" title={ar ? 'لا يوجد تحليل متاح بعد' : 'No AI analysis available yet'} text={t('Click "Run analysis" above to get started.')} />
                </>
              )}

              {!analysisLoading && hasResults && (
                <>
                  {readiness ? (
                    <div className="st-grid st-grid--2">
                      <section className="st-panel st-row" style={{ justifyContent: 'flex-start', gap: 16 }}>
                        <Score value={overall} large />
                        <div>
                          <strong style={{ fontSize: 14 }}>{ar ? 'درجة جاهزية الذكاء الاصطناعي' : 'AI Readiness Score'}</strong>
                          <div style={{ fontSize: 22, fontWeight: 800 }}>{Math.round(overall)}/100</div>
                          {classification && <span className="st-tag"><Icon name="sparkles" size={11} /> {ar0 ? (CATEGORY_AR[classification.predicted_category] || classification.predicted_category) : classification.predicted_category}</span>}
                        </div>
                      </section>
                      <section className="st-panel st-row" style={{ justifyContent: 'flex-start', gap: 16 }}>
                        <Score value={innovation} large />
                        <div>
                          <strong style={{ fontSize: 14 }}>{ar ? 'درجة الابتكار' : 'Innovation Score'}</strong>
                          <div style={{ fontSize: 22, fontWeight: 800 }}>{Math.round(innovation)}/100</div>
                        </div>
                      </section>
                    </div>
                  ) : readinessFailed ? (
                    <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{t('Readiness score failed on the last run.')}</span></div>
                  ) : null}

                  <div className="st-grid st-grid--main">
                    <div className="st-stack">
                      {readiness && (
                        <section className="st-panel">
                          <h2 style={{ marginBottom: 6 }}>{t('Score Breakdown')}</h2>
                          <p className="st-muted" style={{ fontSize: 12.5, marginBottom: 16 }}>{t('The AI Readiness Score blends technical feasibility, market potential, documentation quality, and innovation level.')}</p>
                          <div className="st-stack" style={{ gap: 14 }}>
                            {[
                              { label: ar ? 'تقني' : 'Technical', score: Number(readiness.technical_score || 0) },
                              { label: ar ? 'السوق' : 'Market', score: Number(readiness.market_score || 0) },
                              { label: ar ? 'الابتكار' : 'Innovation', score: Number(readiness.innovation_score || 0) },
                              { label: ar ? 'العرض' : 'Presentation', score: Number(readiness.presentation_score || 0) },
                            ].map((item) => (
                              <div key={item.label}>
                                <div className="st-row" style={{ marginBottom: 6, fontSize: 13 }}>
                                  <span>{item.label}</span><strong>{Math.round(item.score)}</strong>
                                </div>
                                <div className="st-progress"><span style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }} /></div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {suggestions.length > 0 && (
                        <section className="st-panel">
                          <h2 style={{ marginBottom: 12 }}>{t('Improvement Suggestions')}</h2>
                          <ul className="st-list">
                            {suggestions.map((sg, i) => (
                              <li key={i} style={{ fontSize: 13.5 }}>
                                <Pill tone={PRIORITY_TONE[sg.priority] ?? 'neutral'}>{ar0 ? ({ high: 'عالية', medium: 'متوسطة', low: 'منخفضة' }[sg.priority] || sg.priority) : sg.priority}</Pill>{' '}{sg.suggestion}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>

                    <aside className="st-stack">
                      {startupPotential && (
                        <section className="st-panel">
                          <h2 style={{ marginBottom: 10 }}>{t('Practical Value')}</h2>
                          <Pill tone="success">{Math.round(Number(startupPotential.potential_score || 0))}/100 · {startupPotential.market_size_estimate}</Pill>
                          <p style={{ fontSize: 13.5, marginTop: 12 }}>{startupPotential.competitive_edge}</p>
                          {startupPotential.risks?.length > 0 && (
                            <ul className="st-list" style={{ marginTop: 10 }}>
                              {startupPotential.risks.map((r, i) => <li key={i} className="st-muted" style={{ fontSize: 12.5 }}>{r}</li>)}
                            </ul>
                          )}
                        </section>
                      )}

                      {summary && (
                        <section className="st-panel">
                          <h2 style={{ marginBottom: 10 }}>{t('AI Project Summary')}</h2>
                          <p style={{ fontSize: 13.5 }}>{summary}</p>
                        </section>
                      )}

                      <section className="st-panel">
                        <h2 style={{ marginBottom: 6 }}>{t('Semantic Search')}</h2>
                        <p className="st-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{t('Find published projects similar by meaning, not just keywords.')}</p>
                        <button type="button" className="btn btn-outline btn-sm" disabled={findingSimilar} onClick={findSimilar}>
                          <Icon name="search" size={14} /> {t('Find similar projects')}
                        </button>
                        {semanticMatches !== null && (
                          semanticMatches.length === 0 ? (
                            <p className="st-muted" style={{ fontSize: 13, marginTop: 12 }}>{t('No similar published projects yet.')}</p>
                          ) : (
                            <ul className="st-list" style={{ marginTop: 14 }}>
                              {semanticMatches.map((m, i) => (
                                <li key={i}>
                                  <div className="st-row"><strong style={{ fontSize: 13.5 }}>{m.title}</strong><span className="st-tag">{m.category}</span></div>
                                  <p className="st-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{m.reason}</p>
                                </li>
                              ))}
                            </ul>
                          )
                        )}
                      </section>
                    </aside>
                  </div>
                  {project?.id && <CodeReviewReportPanel projectId={project.id} className="st-panel" refreshKey={reviewKey} />}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
