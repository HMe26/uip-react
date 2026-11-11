import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart } from '../../components/insight/charts';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/forecasting/show';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/forecasting/show.php, talking to the
 * real JSON API (DataAnalysisForecastingApiController::show()/explain(),
 * /api/v1/data-analysis/forecasting/{key} — reuses ForecastingService's
 * forecast()/explain() exactly as the server-rendered view does). The
 * web controller kept the AI explanation in Session so it survives a
 * redirect; here it's just returned directly from the explain() call
 * and held in local state, no Session round-trip needed for a JSON API.
 */
export default function DataAnalysisForecastingShow() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { key } = useParams();

  const [forecast, setForecast] = useState(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [explaining, setExplaining] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setExplanation(null);
    api.get(`/api/v1/data-analysis/forecasting/${encodeURIComponent(key)}`)
      .then((json) => {
        setForecast(json.data?.forecast || null);
        setAiAvailable(!!json.data?.ai_available);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [key]);

  const handleExplain = () => {
    setExplaining(true);
    api.post(`/api/v1/data-analysis/forecasting/${encodeURIComponent(key)}/explain`, {})
      .then((json) => setExplanation(json.data?.explanation || null))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setExplaining(false));
  };

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error && !forecast) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!forecast) return null;

  const history = forecast.history || [];
  const points = forecast.forecast || [];
  const unit = forecast.unit || 'count';
  const suffix = unit === 'percent' ? '%' : '';
  const decimals = unit === 'score' ? 1 : 0;
  const chg = forecast.historical_comparison?.change_pct;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <Link to="/data-analysis/forecasting" className="text-caption">&larr; {t('Forecasting')}</Link>
          <h1 className="text-h1" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Icon name="chart" size={22} /> {forecast.label?.[locale] || forecast.label?.en}
          </h1>
          <p className="text-small">{forecast.description?.[locale] || forecast.description?.en}</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" disabled={!aiAvailable || explaining} onClick={handleExplain}>
            <Icon name="sparkles" size={16} /> {explaining ? t('Loading…') : t('AI Explanation')}
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)', marginTop: 'var(--space-3)' }}>{error}</p>}

      <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
        <h2 className="text-h3" style={{ margin: '0 0 var(--space-2) 0' }}>{t('Historical Data & Forecast')}</h2>
        <AreaChart
          dots height={320} dashedFrom={history.length}
          data={[...history.map((p) => ({ label: p.month, value: Number(p.value) })), ...points.map((p) => ({ label: p.month, value: Number(p.value) }))]}
          band={[...history.map((p) => ({ lo: Number(p.value), hi: Number(p.value) })), ...points.map((p) => ({ lo: Number(p.lower), hi: Number(p.upper) }))]}
          format={(v) => `${Number(v).toFixed(decimals)}${suffix}`}
        />
        <div className="gbars__legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: 'var(--color-primary)' }} />{t('Actual')}</span>
          <span><i style={{ background: 'var(--color-primary)', opacity: .4 }} />{t('Forecast')} (95% CI)</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)' }}>
          <h2 className="text-h3" style={{ margin: '0 0 var(--space-3) 0' }}><Icon name="calendar" size={18} /> {t('Upcoming Forecast (95% CI)')}</h2>
          <div className="table-responsive">
            <table className="data-table data-table--cards" style={{ width: '100%' }}>
              <thead>
                <tr><th>{t('Month')}</th><th>{t('Predicted')}</th><th>{t('Confidence Range')}</th></tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.month}>
                    <td data-label={t('Month')}>{point.month}</td>
                    <td className="text-mono" data-label={t('Predicted')}>{Number(point.value).toFixed(decimals)}{suffix}</td>
                    <td className="text-mono text-caption" data-label={t('Confidence Range')}>{Number(point.lower).toFixed(1)} – {Number(point.upper).toFixed(1)}{suffix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)' }}>
          <h2 className="text-h3" style={{ margin: '0 0 var(--space-3) 0' }}>{t('Forecast Accuracy')}</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span className="text-small text-muted">{t('MAE')}</span><span className="text-mono">{Number(forecast.accuracy?.mae ?? 0).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span className="text-small text-muted">{t('RMSE')}</span><span className="text-mono">{Number(forecast.accuracy?.rmse ?? 0).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <span className="text-small text-muted">R²</span><span className="text-mono">{Number(forecast.accuracy?.r2 ?? 0).toFixed(3)}</span>
          </div>

          <h2 className="text-h3" style={{ margin: '0 0 var(--space-3) 0' }}>{t('Historical Comparison')}</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span className="text-small text-muted">{t('Recent 3-mo avg')}</span>
            <span className="text-mono">{Number(forecast.historical_comparison?.recent_3mo_avg ?? 0).toFixed(1)}{suffix}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span className="text-small text-muted">{t('Prior 3-mo avg')}</span>
            <span className="text-mono">{Number(forecast.historical_comparison?.prior_3mo_avg ?? 0).toFixed(1)}{suffix}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-small text-muted">{t('Change')}</span>
            <span className="text-mono" style={{ color: chg === null || chg === undefined ? 'inherit' : (chg >= 0 ? 'var(--uip-teal-600)' : 'var(--uip-coral-600)') }}>
              {chg === null || chg === undefined ? '—' : `${chg >= 0 ? '+' : ''}${Number(chg).toFixed(1)}%`}
            </span>
          </div>
        </div>
      </div>

      <div className="card glass-panel animate-rise-in" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
        <h2 className="text-h3" style={{ margin: '0 0 var(--space-3) 0' }}><Icon name="sparkles" size={18} /> {t('AI Explanation')}</h2>
        {explanation ? (
          <p className="text-small" style={{ whiteSpace: 'pre-line' }}>{explanation}</p>
        ) : !aiAvailable ? (
          <p className="text-small text-muted">{t('No AI provider is configured yet — an admin can add an API key under Settings → AI.')}</p>
        ) : (
          <p className="text-small text-muted">{t('Click "AI Explanation" above for a quick read of this forecast.')}</p>
        )}
      </div>
    </>
  );
}
