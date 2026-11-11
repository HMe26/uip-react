import { useEffect, useState } from 'react';
import Icon from './Icon';
import ReadinessRing from './ReadinessRing';
import ExportMenu from './ExportMenu';
import { api, errorMessage } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { CODE_REVIEW_FORMATS, exportCodeReviewReport } from '../lib/codeReviewExport';

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_LABEL = { critical: ['Critical', 'حرِج'], high: ['High', 'عالي'], medium: ['Medium', 'متوسط'], low: ['Low', 'منخفض'], info: ['Info', 'معلومة'] };
const SEV_COLOR = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#64748b' };
const SCORE_LABEL = {
  security: ['Security', 'الأمان'], performance: ['Performance', 'الأداء'], maintainability: ['Maintainability', 'قابلية الصيانة'],
  architecture: ['Architecture', 'البنية'], quality: ['Code quality', 'جودة الكود'],
};
const CAT_LABEL = { security: 'الأمان', performance: 'الأداء', maintainability: 'قابلية الصيانة', architecture: 'البنية', quality: 'الجودة', general: 'عام' };
const LANG_COLORS = ['#4C63FF', '#0EA5E9', '#0FB5AE', '#F0603A', '#F0A30A', '#8B5CF6', '#64748B'];
const STATUS_LABEL = { completed: ['Completed', 'مكتمل'], failed: ['Failed', 'فشل'], running: ['Running', 'جارٍ'], pending: ['Pending', 'قيد الانتظار'] };

// green / amber / red by score (same bands the readiness ring uses)
const scoreTone = (n) => (n >= 75 ? '#16a34a' : n >= 50 ? '#d97706' : '#dc2626');

function CodeBlock({ code, t, variant = 'fix', focus, start }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className={`crr-code${variant === 'bad' ? ' crr-code--bad' : ' crr-code--fix'}`}>
      <div className="crr-code__bar">
        <span>{variant === 'bad' ? t('Code in your repository', 'الكود الحالي في المستودع') : t('Suggested fix', 'الإصلاح المقترح')}</span>
        <button type="button" className="crr-code__copy" onClick={copy}>{copied ? t('Copied', 'تم النسخ') : t('Copy', 'نسخ')}</button>
      </div>
      {variant === 'bad' && focus ? (
        <pre dir="ltr">{code.split('\n').map((ln, k) => {
          const n = Number(ln.slice(0, 4).trim());
          return <span key={k} className={n === focus ? 'crr-code__hl' : undefined}>{ln}{'\n'}</span>;
        })}</pre>
      ) : <pre dir="ltr">{code}</pre>}
    </div>
  );
}

/**
 * Code-review report of a project, for everyone the project reaches: student, doctor, teaching assistant,
 * supervisor, faculty, university and admin. Loads GET /api/v1/code-review-report/{uuid} (the server checks that
 * the signed-in role really has this project in scope) — the same data the exported PDF is built from — and offers
 * the export in every format.
 *
 *   <CodeReviewReportPanel projectId={uuid} className="um-panel" />
 *
 * Optional: `showTitle={false}` when the page already has a heading, `actions` (extra buttons next to Export),
 * `footer` (a note under the report) and `refreshKey` (change it to reload after a re-run).
 */
export default function CodeReviewReportPanel({ projectId, className = 'card glass-panel', style, showTitle = true, actions = null, footer = null, refreshKey = 0 }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const [state, setState] = useState({ loading: true, report: null, error: null });
  const [showFailed, setShowFailed] = useState(false);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    setState((s) => ({ loading: true, report: refreshKey ? s.report : null, error: null }));
    api.get(`/api/v1/code-review-report/${encodeURIComponent(projectId)}`)
      .then((j) => { if (!cancelled) setState({ loading: false, report: j.data || null, error: null }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, report: null, error: errorMessage(err) }); });
    return () => { cancelled = true; };
  }, [projectId, locale, refreshKey]);

  const { loading, report, error } = state;
  const head = (
    <div className="crr-head">
      {showTitle ? <h2><Icon name="terminal" size={16} /> {t('Code Review Report', 'تقرير مراجعة الكود')}</h2> : <span />}
      <div className="crr-head__actions">
        {actions}
        {report && <ExportMenu className="btn btn-outline btn-sm" label={t('Export report', 'تصدير التقرير')} formats={CODE_REVIEW_FORMATS} onExport={(format) => exportCodeReviewReport(projectId, format)} />}
      </div>
    </div>
  );

  if (loading && !report) return <section className={className} style={style}>{head}<p className="text-small" style={{ opacity: 0.7 }}>{t('Loading…', 'جارٍ التحميل…')}</p></section>;
  if (error) return <section className={className} style={style}>{head}<p className="text-small" style={{ opacity: 0.7 }}>{error}</p></section>;
  if (!report) {
    return <section className={className} style={style}>{head}<p className="text-small" style={{ opacity: 0.8 }}>{t('No code review has been run for this project yet.', 'لم يتم تشغيل مراجعة الكود لهذا المشروع بعد.')}</p></section>;
  }

  const { project: p, review: r, severity, issues, history } = report;
  const scores = r.scores || {};
  const overall = scores.overall ?? 0;
  const metrics = Object.entries(SCORE_LABEL).filter(([k]) => scores[k] != null);
  const langs = Object.entries(r.language_mix || {}).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const files = r.files_analyzed || [];
  const decision = r.admin_notes || r.override_reason || r.approved_at;
  const failedCount = (history || []).filter((h) => h.status === 'failed').length;
  const shownHistory = (history || []).filter((h) => showFailed || h.status !== 'failed');
  const facts = [
    [t('Student', 'الطالب'), p.owner ? `${p.owner}${p.student_number ? ` · ${p.student_number}` : ''}` : ''],
    [t('University', 'الجامعة'), p.university],
    [t('Faculty', 'الكلية'), p.faculty],
    [t('Department', 'القسم'), p.department],
    [t('Doctor / Supervisor', 'الدكتور / المشرف'), (p.doctors || []).join('، ')],
    [t('Teaching Assistant', 'المعيد'), (p.assistants || []).join('، ')],
    [t('Repository', 'المستودع'), p.repository],
    [t('Review date', 'تاريخ المراجعة'), r.created_at],
  ].filter(([, v]) => v);

  return (
    <section className={`crr ${className}`.trim()} style={style}>
      {head}

      {facts.length > 0 && (
        <dl className="crr-facts">
          {facts.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></div>
          ))}
        </dl>
      )}

      {/* Score hero: ring + per-metric bars + severity counts */}
      <div className="crr-hero">
        <div className="crr-hero__ring">
          <ReadinessRing score={overall} size={92} caption={t('Readiness', 'الجاهزية')} />
          <div>
            <div className="crr-hero__score">{overall}<small>/100</small></div>
            <span className="text-caption">
              {r.issues_found} {t('issue(s) flagged', 'ملاحظة')} · v{r.version} · {r.method === 'ai' ? t('AI analysis', 'تحليل بالذكاء الاصطناعي') : t('Quick check', 'فحص سريع')}
            </span>
          </div>
        </div>
        {metrics.length > 0 && (
          <div className="crr-metrics">
            {metrics.map(([k, l]) => (
              <div key={k} className="crr-metric">
                <div className="crr-metric__row"><span>{t(...l)}</span><strong>{scores[k]}</strong></div>
                <div className="crr-bar"><span style={{ width: `${Math.max(2, Math.min(100, scores[k]))}%`, background: scoreTone(scores[k]) }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="crr-sev">
        {SEV_ORDER.map((k) => (
          <span key={k} className={`crr-sev__chip${(severity?.[k] || 0) === 0 ? ' is-zero' : ''}`} style={{ '--sev': SEV_COLOR[k] }}>
            <i />{t(...SEV_LABEL[k])}<b>{severity?.[k] || 0}</b>
          </span>
        ))}
      </div>

      {r.summary && (
        <div className="crr-summary">
          <h3>{t('Summary', 'الملخص')}</h3>
          <p dir="auto">{r.summary}</p>
        </div>
      )}

      {(r.strengths || []).length > 0 && (
        <>
          <h3 className="crr-h">{t('Done well', 'النقاط الصحيحة')} <span>{r.strengths.length}</span></h3>
          <ul className="crr-strengths">
            {r.strengths.map((st, k) => (
              <li key={k}>
                <Icon name="check-circle" size={15} />
                <div>
                  {st.file && <code dir="ltr">{st.file}</code>}
                  <p dir="auto">{st.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {(r.structure?.layers || []).length > 0 && (
        <>
          <h3 className="crr-h">{t('Code structure', 'تقسيم الكود')} <span>{r.structure.layers.length}</span></h3>
          {r.structure.summary && <p className="text-small" dir="auto" style={{ marginBottom: 10 }}>{r.structure.summary}</p>}
          <div className="crr-layers">
            {r.structure.layers.map((ly, k) => (
              <div key={k} className={`crr-layer crr-layer--${ly.assessment}`}>
                <div className="crr-layer__head">
                  <strong dir="auto">{ly.name}</strong>
                  <span>{ly.assessment === 'good' ? t('Good', 'جيد') : ly.assessment === 'weak' ? t('Weak', 'ضعيف') : t('Fair', 'مقبول')}</span>
                </div>
                {ly.purpose && <p dir="auto">{ly.purpose}</p>}
                {ly.note && <p className="crr-layer__note" dir="auto">{ly.note}</p>}
                {(ly.files || []).length > 0 && <div className="crr-layer__files" dir="ltr">{ly.files.map((f) => <code key={f}>{f}</code>)}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="crr-h">{t('Findings', 'الملاحظات')} <span>{issues.length}</span></h3>
      {issues.length > 0 ? (
        <ul className="crr-issues">
          {issues.map((i, idx) => (
            <li key={idx} className="crr-issue" style={{ '--sev': SEV_COLOR[i.severity] || SEV_COLOR.info }}>
              <div className="crr-issue__meta">
                <span className="crr-issue__sev">{SEV_LABEL[i.severity] ? t(...SEV_LABEL[i.severity]) : i.severity}</span>
                {i.category && <span className="crr-issue__cat">{ar ? (CAT_LABEL[String(i.category).toLowerCase()] || i.category) : i.category}</span>}
                {i.file && <code dir="ltr" className="crr-issue__file">{i.file}{i.line ? `:${i.line}` : ''}</code>}
              </div>
              <p className="crr-issue__text" dir="auto">{i.text}</p>
              {i.recommendation && (
                <div className="crr-issue__rec" dir="auto"><strong>{t('Recommendation', 'التوصية')}</strong> {i.recommendation}</div>
              )}
              {i.snippet?.code && <CodeBlock code={i.snippet.code} t={t} variant="bad" focus={i.snippet.focus} start={i.snippet.start} />}
              {i.fix && <CodeBlock code={i.fix} t={t} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small" style={{ color: 'var(--color-success)' }}>{t('No issues found — all checks passed.', 'لا ملاحظات — كل الفحوصات ناجحة.')}</p>
      )}

      {langs.length > 0 && (
        <>
          <h3 className="crr-h">{t('Language mix', 'توزيع اللغات')}</h3>
          <div className="crr-langbar" role="img" aria-label={langs.map(([k, v]) => `${k} ${v}%`).join(', ')}>
            {langs.map(([k, v], i) => <span key={k} style={{ width: `${v}%`, background: LANG_COLORS[i % LANG_COLORS.length] }} title={`${k} ${v}%`} />)}
          </div>
          <ul className="crr-langs">
            {langs.map(([k, v], i) => (
              <li key={k}><i style={{ background: LANG_COLORS[i % LANG_COLORS.length] }} />{k} <b dir="ltr">{v}%</b></li>
            ))}
          </ul>
        </>
      )}

      {files.length > 0 && (
        <details className="crr-files">
          <summary>{t('Files analyzed', 'الملفات التي تم تحليلها')} <span>{files.length}</span></summary>
          <ul dir="ltr">{files.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </details>
      )}

      {decision && (
        <div className="crr-decision">
          <h3>{t('Administrator decision', 'قرار الإدارة')}</h3>
          <dl>
            <div><dt>{t('Approved at', 'تاريخ الاعتماد')}</dt><dd dir="ltr">{r.approved_at || t('Not yet approved', 'لم يُعتمد بعد')}</dd></div>
            {r.score_overridden && <div><dt>{t('Score overridden', 'تم تعديل الدرجة')}</dt><dd>{r.override_reason || t('Yes', 'نعم')}</dd></div>}
            {r.admin_notes && <div><dt>{t('Notes', 'ملاحظات')}</dt><dd dir="auto">{r.admin_notes}</dd></div>}
          </dl>
        </div>
      )}

      {history && history.length > 1 && (
        <>
          <h3 className="crr-h">
            {t('Version history', 'سجل النسخ')}
            {failedCount > 0 && (
              <button type="button" className="crr-link" onClick={() => setShowFailed((v) => !v)}>
                {showFailed ? t('Hide failed attempts', 'إخفاء المحاولات الفاشلة') : t('Show failed attempts', 'إظهار المحاولات الفاشلة')} ({failedCount})
              </button>
            )}
          </h3>
          <div className="crr-table-wrap">
            <table className="crr-table">
              <thead><tr><th>{t('Version', 'النسخة')}</th><th>{t('Status', 'الحالة')}</th><th>{t('Score', 'الدرجة')}</th><th>{t('Issues', 'الملاحظات')}</th><th>{t('Date', 'التاريخ')}</th></tr></thead>
              <tbody>
                {shownHistory.map((h) => (
                  <tr key={h.version} className={h.version === r.version ? 'is-current' : ''}>
                    <td data-label={t('Version', 'النسخة')}>v{h.version}</td>
                    <td data-label={t('Status', 'الحالة')}>{STATUS_LABEL[h.status] ? t(...STATUS_LABEL[h.status]) : h.status}</td>
                    <td data-label={t('Score', 'الدرجة')}>{h.overall ?? '—'}</td>
                    <td data-label={t('Issues', 'الملاحظات')}>{h.issues}</td>
                    <td data-label={t('Date', 'التاريخ')} dir="ltr">{h.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {footer}
    </section>
  );
}
