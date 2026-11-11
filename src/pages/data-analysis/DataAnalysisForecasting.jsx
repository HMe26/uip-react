import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart, Panel, Segmented } from '../../components/insight/charts';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/forecasting/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/forecasting/index.php, talking to the
 * real JSON API (DataAnalysisForecastingApiController::index(),
 * /api/v1/data-analysis/forecasting — reuses ForecastingService's
 * metrics()/forecastAll()/isAiAvailable() exactly as the server-rendered
 * view does: real OLS linear-regression forecasts over the platform's
 * live monthly series, not fabricated numbers).
 */

function trendBadge(direction, t) {
  const map = {
    up: { cls: 'badge-success', icon: 'trend', label: t('Trending Up') },
    down: { cls: 'badge-danger', icon: 'chevron-down', label: t('Trending Down') },
    flat: { cls: 'badge-neutral', icon: 'chevron-right', label: t('Flat') },
  };
  const m = map[direction] || map.flat;
  return (
    <span className={`badge ${m.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon name={m.icon} size={12} /> {m.label}
    </span>
  );
}

const numFmt = (v, unit) => {
  const d = unit === 'score' ? 1 : 0;
  return `${Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}${unit === 'percent' ? '%' : ''}`;
};

export default function DataAnalysisForecasting() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [metrics, setMetrics] = useState({});
  const [forecasts, setForecasts] = useState({});
  const [aiAvailable, setAiAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    api.get('/api/v1/data-analysis/forecasting')
      .then((json) => {
        setMetrics(json.data?.metrics || {});
        setForecasts(json.data?.forecasts || {});
        setAiAvailable(!!json.data?.ai_available);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const keys = useMemo(() => Object.keys(metrics).filter((k) => forecasts[k]), [metrics, forecasts]);
  const current = active && keys.includes(active) ? active : keys[0];

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  const title = (k) => metrics[k]?.label?.[locale] || metrics[k]?.label?.en || k;

  // Summary per metric: last actual value -> final forecast value.
  const summary = (k) => {
    const f = forecasts[k];
    const hist = f.history || [];
    const fc = f.forecast || [];
    const now = hist[hist.length - 1]?.value;
    const end = fc[fc.length - 1]?.value;
    const growth = now > 0 && end !== undefined ? ((end - now) / now) * 100 : null;
    return { f, now, end, growth };
  };

  const f = current ? forecasts[current] : null;
  const hist = f?.history || [];
  const fc = f?.forecast || [];
  const chartData = f ? [
    ...hist.map((p) => ({ label: p.month, value: Number(p.value) })),
    ...fc.map((p) => ({ label: p.month, value: Number(p.value) })),
  ] : [];
  // Confidence band only exists over the forecast months; history points sit on the line.
  const band = f ? [
    ...hist.map((p) => ({ lo: Number(p.value), hi: Number(p.value) })),
    ...fc.map((p) => ({ lo: Number(p.lower), hi: Number(p.upper) })),
  ] : null;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Forecasting')}</h1>
          <p>{t("Real statistical forecasts (linear regression) over the platform's last 12 months of actual data, with a 95% confidence band and accuracy metrics.")}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <span className="badge badge-primary" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('Linear regression')}</span>
        <span className="text-caption" title={t('Ordinary least squares fit over monthly history, with a 95% prediction interval.')}>
          <Icon name="alert" size={14} style={{ verticalAlign: '-2px' }} /> {t('OLS fit · 95% prediction interval')}
        </span>
      </div>

      {!aiAvailable && (
        <div className="drawer__hint animate-rise-in" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <Icon name="sparkles" size={16} />
          <span>{t("AI explanations for forecasts aren't available yet — an admin needs to add an API key under Settings → AI. The statistical forecasts themselves work independently.")}</span>
        </div>
      )}

      <div className="insight-grid insight-grid--kpi" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {keys.map((k) => {
          const { f: ff, now, end, growth } = summary(k);
          return (
            <Link key={k} to={`/data-analysis/forecasting/${k}`} className="kpi-card animate-rise-in" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="kpi-card__top"><span>{title(k)}</span>{trendBadge(ff.trend_direction, t)}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div className="text-caption">{t('Current')}</div>
                  <strong className="kpi-card__value" style={{ fontSize: 28 }}>{now !== undefined ? numFmt(now, ff.unit) : '—'}</strong>
                </div>
                <Icon name="chevron-right" size={18} style={{ color: 'var(--text-secondary)', marginBottom: 8 }} />
                <div style={{ textAlign: 'end' }}>
                  <div className="text-caption">{t('Forecast')}</div>
                  <strong className="kpi-card__value" style={{ fontSize: 28, color: 'var(--color-primary)' }}>{end !== undefined ? numFmt(end, ff.unit) : '—'}</strong>
                </div>
              </div>
              <div className="kpi-card__meta" style={{ justifyContent: 'space-between' }}>
                {growth !== null
                  ? <span className={`delta ${growth >= 0 ? 'delta--up' : 'delta--down'}`}>{growth >= 0 ? '+' : ''}{growth.toFixed(1)}% {t('growth')}</span>
                  : <span />}
                <em className="num">R² {Number(ff.accuracy?.r2 ?? 0).toFixed(2)} · 95% CI</em>
              </div>
            </Link>
          );
        })}
      </div>

      {f && (
        <Panel
          className="animate-rise-in"
          title={t('Forecast model')}
          subtitle={t('Historical performance and projected trajectory')}
          actions={<Segmented value={current} onChange={setActive} options={keys.map((k) => ({ value: k, label: title(k) }))} />}
        >
          <AreaChart
            data={chartData} band={band} dashedFrom={hist.length} dots
            format={(v) => numFmt(v, f.unit)} height={320} emptyText={t('Not enough history to draw a forecast.')}
          />
          <div className="gbars__legend" style={{ marginTop: 8 }}>
            <span><i style={{ background: 'var(--color-primary)' }} />{t('Actual')}</span>
            <span><i style={{ background: 'var(--color-primary)', opacity: .4 }} />{t('Forecast (dashed) with 95% band')}</span>
          </div>
          <div className="insight-grid insight-grid--kpi" style={{ margin: '24px 0 0', paddingTop: 20, borderTop: '1px solid var(--border-subtle)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div><div className="text-caption">R²</div><strong style={{ fontSize: 22 }}>{Number(f.accuracy?.r2 ?? 0).toFixed(2)}</strong></div>
            <div><div className="text-caption">{t('MAE')}</div><strong style={{ fontSize: 22 }}>{Number(f.accuracy?.mae ?? 0).toFixed(2)}</strong></div>
            <div><div className="text-caption">{t('RMSE')}</div><strong style={{ fontSize: 22 }}>{Number(f.accuracy?.rmse ?? 0).toFixed(2)}</strong></div>
            <div><div className="text-caption">{t('Confidence interval')}</div><strong style={{ fontSize: 22 }}>95%</strong></div>
            <div><div className="text-caption">{t('Training period')}</div><strong style={{ fontSize: 22 }}>{hist.length ? `${hist[0].month} – ${hist[hist.length - 1].month}` : '—'}</strong></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Link to={`/data-analysis/forecasting/${current}`} className="btn btn-outline btn-sm">
              {t('Details & AI explanation')} <Icon name={locale === 'ar' ? 'arrow-left' : 'arrow-right'} size={14} />
            </Link>
          </div>
        </Panel>
      )}
    </>
  );
}
