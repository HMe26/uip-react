import { cloneElement, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import SharedExportMenu from '../../components/ExportMenu';
import { isPreviewing, saveBlob } from '../../lib/exporter';
import { KpiCard, Panel, fmt } from '../../components/insight/charts';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/ai-insights/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * AI Insights — Insight Platform layout.
 *
 * Data still comes from the real JSON API (DataAnalysisAiInsightsApiController::
 * index()/regenerate(), /api/v1/data-analysis/ai-insights — AIInsightsService
 * over live platform metrics). Nothing is fabricated: every KPI tile below is a
 * plain count of an array the report already contains, and when the AI provider
 * isn't configured or the call fails we say so instead of showing placeholder
 * content.
 */

// tone → badge class. "risk" scales red with severity, "gain" scales green.
const TONE_BADGE = { danger: 'badge-danger', warning: 'badge-warning', success: 'badge-success', primary: 'badge-primary', neutral: 'badge-neutral' };
const SCALES = {
  risk: { high: 'danger', medium: 'warning', low: 'primary' },
  gain: { high: 'success', medium: 'primary', low: 'neutral' },
  strength: { strong: 'primary', moderate: 'primary', weak: 'neutral' },
  priority: { high: 'danger', medium: 'warning', low: 'neutral' },
};

const txt = (v) => (typeof v === 'string' ? v : (v?.description || v?.text || v?.title || ''));

function LevelBadge({ value, scale, t }) {
  if (!value) return null;
  const key = String(value).toLowerCase();
  const labels = { high: t('High'), medium: t('Medium'), low: t('Low'), strong: t('Strong'), moderate: t('Moderate'), weak: t('Weak') };
  const tone = SCALES[scale]?.[key] || 'neutral';
  return <span className={`badge ${TONE_BADGE[tone]}`}>{labels[key] || value}</span>;
}

/** One finding: tinted icon tile, text, optional level badge. */
function Finding({ icon, tone = 'primary', title, text, badge }) {
  return (
    <li className="ai-item">
      <span className={`ai-item__icon ai-item__icon--${tone}`}><Icon name={icon} size={16} /></span>
      <div className="ai-item__body">
        {title && <strong>{title}</strong>}
        {text && <span>{text}</span>}
      </div>
      {badge}
    </li>
  );
}

/** Hidden entirely when there is nothing to show — an empty "No X detected" card is filler. */
function FindingsPanel({ title, subtitle, items, render, tone, wide = false }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  return (
    <Panel title={title} subtitle={subtitle} className={`animate-rise-in${wide ? ' ai-wide' : ''}`}>
      <ul className={`ai-list${wide ? ' ai-list--wide' : ''}`}>{list.map((item, i) => render(item, i, tone))}</ul>
    </Panel>
  );
}

const HEALTH_AREAS = {
  users: ['Users', 'users'], projects: ['Projects', 'folder'], universities: ['Universities', 'building'], exams: ['Exams', 'note'],
  integrity: ['Academic integrity', 'shield'], security: ['Security', 'lock'], ai_usage: ['AI usage', 'sparkles'],
  visitors: ['Visitors', 'globe'], data_quality: ['Data quality', 'layers'],
};
const HEALTH_TONE = { good: 'success', watch: 'warning', critical: 'danger' };

/** One compact card per platform area: status + its key number. Replaces the old wall of generic bullets. */
function HealthOverview({ items, t }) {
  const list = (Array.isArray(items) ? items : []).filter((h) => h && h.summary);
  if (!list.length) return null;
  return (
    <Panel title={t('Platform health')} subtitle={t('Status of each area at a glance.')} className="animate-rise-in">
      <div className="ai-health">
        {list.map((h, i) => {
          const [label, icon] = HEALTH_AREAS[h.area] || [h.area, 'layers'];
          const tone = HEALTH_TONE[h.status] || 'neutral';
          return (
            <div key={i} className="ai-health__card">
              <div className="ai-health__head">
                <span className={`ai-item__icon ai-item__icon--${tone}`}><Icon name={icon} size={16} /></span>
                <strong>{t(label)}</strong>
                <span className={`badge ${TONE_BADGE[tone]}`}>{t(h.status === 'critical' ? 'Critical' : h.status === 'watch' ? 'Needs attention' : 'Healthy')}</span>
              </div>
              <p>{h.summary}</p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * Lays the findings out in tidy rows: panels are paired two per row (same height, nothing floating),
 * a leftover odd panel and the Recommendations panel span the full width. Empty panels are skipped
 * before pairing, so hiding one never leaves a hole.
 */
function FindingsGrid({ panels }) {
  const visible = panels.filter((p) => Array.isArray(p.items) && p.items.length > 0);
  if (!visible.length) return null;
  const recs = visible.find((p) => p.key === 'recs');
  const others = visible.filter((p) => p !== recs);
  const wideKeys = new Set();
  if (recs) wideKeys.add(recs.key);
  if (others.length % 2 === 1) wideKeys.add(others[others.length - 1].key); // lone panel fills its row
  const ordered = recs ? [...others, recs] : others;
  return (
    <div className="ai-grid">
      {ordered.map((p) => cloneElement(p.node, { key: p.key, wide: wideKeys.has(p.key) }))}
    </div>
  );
}

const API = '/api/v1/data-analysis/ai-insights';

const EXPORT_FORMATS = [
  { key: 'pdf', label: 'PDF', hint: 'PDF document', icon: 'file' },
  { key: 'docx', label: 'Word', hint: 'Word document', icon: 'note' },
  { key: 'xlsx', label: 'Excel', hint: 'Excel spreadsheet', icon: 'grid' },
  { key: 'csv', label: 'CSV', hint: 'CSV file', icon: 'layers' },
  { key: 'json', label: 'JSON', hint: 'JSON data', icon: 'terminal' },
  { key: 'md', label: 'Markdown', hint: 'Markdown text', icon: 'edit' },
];

/** Authenticated download of one report (id) in the chosen format, saved through a temporary link. */
async function downloadReport({ id, format, locale }) {
  const res = await api.blob(`${API}/export`, { format, id, lang: locale === 'ar' ? 'ar' : 'en' });
  let blob;
  let name = null;
  if (typeof Response !== 'undefined' && res instanceof Response) {
    blob = await res.blob();
    const m = (res.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m) name = decodeURIComponent(m[1]);
  } else {
    // api client already parsed an application/json body (the JSON export) — write it back out.
    blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
  }
  saveBlob(blob, name || `ai-insights-${id || 'latest'}.${format}`);
}

/**
 * Export button + format menu (Download or Preview for every format). Uses the
 * shared menu, which is portaled to <body> so it is never clipped by the history
 * table's scroll container.
 */
function ExportMenu({ id, t, locale, compact = false, disabled = false, onDone, onError }) {
  const run = async (format) => {
    try {
      const previewing = isPreviewing();
      await downloadReport({ id, format, locale });
      if (!previewing) onDone?.(t('Export downloaded'));
    } catch (err) {
      onError?.(errorMessage(err));
    }
  };
  return (
    <SharedExportMenu
      formats={EXPORT_FORMATS.map((f) => f.key)}
      iconOnly={compact}
      className="btn btn-outline btn-sm"
      disabled={disabled}
      onExport={run}
    />
  );
}

function Notice({ tone = 'info', icon, children }) {
  return (
    <div className={`ai-notice ai-notice--${tone} animate-rise-in`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div>{children}</div>
    </div>
  );
}

export default function DataAnalysisAiInsights() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [available, setAvailable] = useState(false);
  const [latest, setLatest] = useState(null);
  const [result, setResult] = useState(null);
  const [lastFailed, setLastFailed] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [selected, setSelected] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/ai-insights')
      .then((json) => {
        setAvailable(!!json.data?.available);
        setLatest(json.data?.latest || null);
        setResult(json.data?.result || null);
        setLastFailed(json.data?.last_failed || null);
        setHistory(json.data?.history || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Keep the selection limited to rows that still exist after a reload.
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => history.some((h) => h.id === id)));
  }, [history]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleRegenerate = () => {
    setRegenerating(true);
    setError(null);
    api.post(`/api/v1/data-analysis/ai-insights/regenerate?lang=${locale === 'ar' ? 'ar' : 'en'}`, {})
      .then((json) => {
        setResult(json.data?.result || null);
        load();
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setRegenerating(false));
  };

  const ar = locale === 'ar';
  const deletedMsg = (n) => (ar ? `تم حذف ${n} سجل` : `${n} ${n === 1 ? 'entry' : 'entries'} deleted`);

  const runDelete = (promise, message) => {
    setDeleting(true);
    setError(null);
    promise
      .then((json) => { setSelected([]); setToast(message(json)); load(); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setDeleting(false));
  };

  const removeOne = (h) => {
    if (!window.confirm(t('Delete this entry from the history? This cannot be undone.'))) return;
    runDelete(api.del(`${API}/${h.id}`), () => t('Entry deleted'));
  };

  const removeSelected = () => {
    const n = selected.length;
    if (!n) return;
    const q = ar ? `سيتم حذف ${n} من السجلات المحددة. لا يمكن التراجع.` : `Delete ${n} selected ${n === 1 ? 'entry' : 'entries'}? This cannot be undone.`;
    if (!window.confirm(q)) return;
    runDelete(api.post(`${API}/delete-selected`, { ids: selected }), (json) => deletedMsg(json?.data?.deleted ?? n));
  };

  const removeAll = () => {
    if (!window.confirm(t('Delete the whole generation history and the current report? This cannot be undone.'))) return;
    runDelete(api.post(`${API}/delete-all`), (json) => deletedMsg(json?.data?.deleted ?? history.length));
  };

  const toggleOne = (id) => setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  const allSelected = history.length > 0 && selected.length === history.length;
  const toggleAll = () => setSelected(allSelected ? [] : history.map((h) => h.id));

  if (loading && !result && !regenerating) return <p className="text-small">{t('Loading…')}</p>;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const risks = arr(result?.risks);
  const anomalies = arr(result?.anomalies);
  const recommendations = [...arr(result?.recommendations), ...arr(result?.performance_recommendations)];
  const highRisks = risks.filter((r) => String(r?.severity).toLowerCase() === 'high').length;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('AI Insights')}</h1>
          <p>{t('AI-powered analytics engine generating insights, trends, correlations, anomalies, and recommendations from real platform data.')}</p>
        </div>
        <div className="page-header__actions">
          {result && latest?.id && (
            <ExportMenu id={latest.id} t={t} locale={locale} onDone={setToast} onError={setError} />
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={!available || regenerating} onClick={handleRegenerate}>
            <Icon name={regenerating ? 'refresh' : 'sparkles'} size={16} className={regenerating ? 'ai-spin' : undefined} /> {regenerating ? t('Generating…') : t('Regenerate Insights')}
          </button>
        </div>
      </div>

      {error && <Notice tone="danger" icon="alert-triangle">{error}</Notice>}

      {!available && (
        <Panel className="animate-rise-in">
          <div className="ai-state">
            <span className="ai-state__icon"><Icon name="sparkles" size={26} /></span>
            <h2>{t('No AI provider is configured yet')}</h2>
            <p>{t('An admin needs to add an API key under Settings → AI to enable this feature.')}</p>
          </div>
        </Panel>
      )}

      {lastFailed && (
        <Notice tone="danger" icon="alert-triangle">
          <strong>{t('The last generation attempt failed: ')}</strong>{lastFailed.error_message || ''}
        </Notice>
      )}

      {available && !result && (
        <Panel className="animate-rise-in">
          <div className="ai-state">
            <span className="ai-state__icon"><Icon name="ai-spark" size={26} /></span>
            <h2>{t('No report generated yet')}</h2>
            <p>{t('Click "Regenerate Insights" to run the first analysis.')}</p>
            <button type="button" className="btn btn-primary btn-sm" disabled={regenerating} onClick={handleRegenerate}>
              <Icon name="sparkles" size={16} /> {t('Regenerate Insights')}
            </button>
          </div>
        </Panel>
      )}

      {result && (
        <>
          {result.language && result.language !== locale && (
            <Notice tone="info" icon="globe">
              {locale === 'ar'
                ? 'هذا التقرير مكتوب بالإنجليزية. اضغط "إعادة توليد الرؤى" للحصول عليه بالعربية.'
                : 'This report was written in Arabic. Click "Regenerate Insights" to get it in English.'}
            </Notice>
          )}

          <Panel className="ai-hero animate-rise-in">
            <div className="ai-hero__icon"><Icon name="ai-spark" size={26} /></div>
            <div className="ai-hero__body">
              <div className="ai-hero__meta">
                <span className={`badge ${available ? 'badge-success' : 'badge-neutral'}`}>
                  <Icon name="sparkles" size={12} /> {available ? t('Active') : t('Unavailable')}
                </span>
                <span className="text-caption">
                  {t('Last generated by')} <strong>{latest?.generated_by_name || '—'}</strong> {latest?.created_at ? `${t('on')} ${latest.created_at}` : ''}
                </span>
              </div>
              <h2>{t('Executive Summary')}</h2>
              <p>{result.executive_summary || ''}</p>
            </div>
          </Panel>

          <HealthOverview items={result.health_overview} t={t} />

          <div className="insight-grid insight-grid--kpi">
            <KpiCard label={t('Key Insights')} value={fmt(arr(result.insights).length)} tone="primary" />
            <KpiCard
              label={t('Risks')} value={fmt(risks.length)} tone={highRisks > 0 ? 'danger' : risks.length ? 'warning' : 'success'}
              note={highRisks > 0 ? `${fmt(highRisks)} ${t('High').toLowerCase()}` : undefined}
            />
            <KpiCard label={t('Anomalies')} value={fmt(anomalies.length)} tone={anomalies.length ? 'warning' : 'success'} />
            <KpiCard label={t('Opportunities')} value={fmt(arr(result.opportunities).length)} tone="success" />
          </div>

          <FindingsGrid
            panels={[
              {
                key: 'insights', items: result.insights,
                node: <FindingsPanel
                  key="insights" title={t('Key Insights')} tone="primary" items={result.insights}
                  render={(it, i, tone) => <Finding key={i} icon="sparkles" tone={tone} text={txt(it)} />}
                />,
              },
              {
                key: 'trends', items: result.trends,
                node: <FindingsPanel
                  key="trends" title={t('Trends')} items={result.trends}
                  render={(tr, i) => {
                    const dir = tr?.direction;
                    return (
                      <Finding
                        key={i}
                        icon={dir === 'up' ? 'arrow-up' : dir === 'down' ? 'arrow-down' : 'arrow-right'}
                        tone={dir === 'up' ? 'success' : dir === 'down' ? 'danger' : 'neutral'}
                        title={tr?.label} text={tr?.description}
                      />
                    );
                  }}
                />,
              },
              {
                key: 'risks', items: risks,
                node: <FindingsPanel
                  key="risks" title={t('Risks')} tone="danger" items={risks}
                  render={(r, i, tone) => <Finding key={i} icon="shield" tone={tone} text={txt(r)} badge={<LevelBadge value={r?.severity} scale="risk" t={t} />} />}
                />,
              },
              {
                key: 'anomalies', items: anomalies,
                node: <FindingsPanel
                  key="anomalies" title={t('Anomalies')} tone="warning" items={anomalies}
                  render={(a, i, tone) => <Finding key={i} icon="alert-triangle" tone={tone} text={txt(a)} badge={<LevelBadge value={a?.severity} scale="risk" t={t} />} />}
                />,
              },
              {
                key: 'correlations', items: result.correlations,
                node: <FindingsPanel
                  key="correlations" title={t('Correlations')} tone="primary" items={result.correlations}
                  render={(c, i, tone) => <Finding key={i} icon="layers" tone={tone} text={txt(c)} badge={<LevelBadge value={c?.strength} scale="strength" t={t} />} />}
                />,
              },
              {
                key: 'opportunities', items: result.opportunities,
                node: <FindingsPanel
                  key="opportunities" title={t('Opportunities')} tone="success" items={result.opportunities}
                  render={(o, i, tone) => <Finding key={i} icon="star" tone={tone} text={txt(o)} badge={<LevelBadge value={o?.potential_impact} scale="gain" t={t} />} />}
                />,
              },
              {
                key: 'root', items: result.root_cause_analysis,
                node: <FindingsPanel
                  key="root" title={t('Root Cause Analysis')} tone="danger" items={result.root_cause_analysis}
                  render={(rc, i, tone) => <Finding key={i} icon="wrench" tone={tone} title={rc?.issue} text={rc?.likely_cause} />}
                />,
              },
              {
                key: 'kpi', items: result.kpi_analysis,
                node: <FindingsPanel
                  key="kpi" title={t('KPI Analysis')} tone="primary" items={result.kpi_analysis}
                  render={(ka, i, tone) => <Finding key={i} icon="award" tone={tone} title={ka?.kpi} text={ka?.analysis} />}
                />,
              },
              {
                key: 'recs', items: recommendations,
                node: <FindingsPanel
                  key="recs" title={t('Recommendations')} tone="success" items={recommendations}
                  render={(r, i, tone) => (
                    <Finding
                      key={i} icon="check-circle" tone={tone}
                      title={typeof r === 'string' ? undefined : r?.action}
                      text={typeof r === 'string' ? r : r?.reason}
                      badge={typeof r === 'string' ? null : <LevelBadge value={r?.priority} scale="priority" t={t} />}
                    />
                  )}
                />,
              },
            ]}
          />

          {arr(result.data_limitations).length > 0 && (
            <Notice tone="info" icon="info">
              <strong>{t('Data limitations')}</strong>
              <ul className="ai-limits">{arr(result.data_limitations).map((d, i) => <li key={i}>{txt(d)}</li>)}</ul>
            </Notice>
          )}
        </>
      )}

      {history.length > 0 && (
        <Panel
          title={t('Generation History')}
          subtitle={t('Every analysis run, newest first.')}
          className="panel--flat ai-history animate-rise-in"
          actions={(
            <button type="button" className="btn btn-outline btn-sm ai-danger-btn" disabled={deleting} onClick={removeAll}>
              <Icon name="trash" size={16} /> {t('Delete all')}
            </button>
          )}
        >
          {selected.length > 0 && (
            <div className="ai-selbar" role="status">
              <span className="ai-selbar__count">{fmt(selected.length)}</span>
              <span className="ai-selbar__text">{ar ? 'سجل محدد' : (selected.length === 1 ? 'entry selected' : 'entries selected')}</span>
              <span className="ai-selbar__spacer" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>{ar ? 'إلغاء التحديد' : 'Clear'}</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={deleting} onClick={removeSelected}>
                <Icon name="trash" size={16} /> {t('Delete selected')}
              </button>
            </div>
          )}
          <div className="table-responsive">
            <table className="data-table ai-table">
              <thead>
                <tr>
                  <th className="ai-check-col">
                    <input
                      type="checkbox" className="ai-check" checked={allSelected} onChange={toggleAll}
                      ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allSelected; }}
                      aria-label={t('Select all')}
                    />
                  </th>
                  <th>{t('Date')}</th><th>{t('Status')}</th><th>{t('By')}</th><th>{t('Details')}</th>
                  <th aria-label={t('Actions')} />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const [day, time] = String(h.created_at || '').split(' ');
                  const who = h.generated_by_name || '';
                  return (
                    <tr key={h.id} className={selected.includes(h.id) ? 'is-selected' : undefined}>
                      <td className="ai-check-col">
                        <input type="checkbox" className="ai-check" checked={selected.includes(h.id)} onChange={() => toggleOne(h.id)} aria-label={t('Select entry')} />
                      </td>
                      <td data-label={t('Date')}>
                        <div className="ai-when">
                          <span className="ai-when__main">
                            <strong dir="ltr">{day || '—'}</strong>
                            {time && <span dir="ltr">{time.slice(0, 5)}</span>}
                          </span>
                          {h.id === latest?.id && <span className="badge badge-primary ai-current">{t('Current')}</span>}
                        </div>
                      </td>
                      <td data-label={t('Status')}>
                        <span className={`badge ai-status ${h.status === 'completed' ? 'badge-success' : 'badge-danger'}`}>
                          <span className="ai-status__dot" aria-hidden="true" />
                          {h.status === 'completed' ? t('Completed') : t('Failed')}
                        </span>
                      </td>
                      <td data-label={t('By')}>
                        {who ? (
                          <span className="ai-by">
                            <span className="ai-by__avatar" aria-hidden="true">{who.trim().charAt(0).toUpperCase()}</span>
                            <span className="ai-by__name">{who}</span>
                          </span>
                        ) : <span className="ai-muted">—</span>}
                      </td>
                      <td data-label={t('Details')} className="ai-details">
                        {h.error_message ? <span className="ai-details__err">{h.error_message}</span> : <span className="ai-muted">—</span>}
                      </td>
                      <td className="ai-actions-col">
                        <div className="row-actions">
                          {h.status === 'completed' && (
                            <ExportMenu id={h.id} t={t} locale={locale} compact onDone={setToast} onError={setError} />
                          )}
                          <button type="button" className="icon-btn ai-danger" title={t('Delete')} aria-label={t('Delete')} disabled={deleting} onClick={() => removeOne(h)}>
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {toast && (
        <div className="toast" role="status"><Icon name="check-circle" size={18} /><span>{toast}</span></div>
      )}
    </>
  );
}
