import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { AreaChart, DonutChart, HBarChart, KpiCard, Panel, fmt } from '../../components/insight/charts';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/analytics';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/analytics.php, talking to the real JSON API
 * (app/Controllers/Api/AnalyticsApiController.php::overview()/trends() —
 * already built, university branch reuses ProjectRepository's
 * *ForUniversity() aggregates exactly as UniversityAnalyticsController
 * already does; readiness_buckets/readiness_analyzed added to the API
 * response as a small addition — same AIAnalysisRepository::
 * readinessDistributionForUniversity() query the PHP view already used).
 */

export default function UniversityAnalytics() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/api/v1/analytics/overview'),
      api.get('/api/v1/analytics/trends', { days: 30, limit: 8 }),
    ])
      .then(([overviewJson, trendsJson]) => {
        setData(overviewJson.data);
        setTrends(trendsJson.data?.category_trends || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return null;

  const MONTH_LABELS = {
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  };
  // Raw shape from ProjectRepository::monthlyActivityForUniversity() is
  // {month:'YYYY-MM', total}, unlike the PHP view's already-labeled
  // {label:{en,ar}, value} — the API returns the repository row as-is.
  const activity = (data.activity || []).map((point) => {
    const monthNum = parseInt(String(point.month).slice(5, 7), 10) - 1;
    return { value: point.total, label: { en: MONTH_LABELS.en[monthNum] || point.month, ar: MONTH_LABELS.ar[monthNum] || point.month } };
  });

  const facultyTotal = data.faculty_total || 0;
  // Same story: {faculty, total} raw rows, not {label, count, pct}.
  const facultyBreakdown = (data.faculty_breakdown || []).map((f) => ({
    label: { en: f.faculty, ar: f.faculty },
    count: f.total,
    pct: facultyTotal > 0 ? Math.round((f.total / facultyTotal) * 100) : 0,
  }));

  const approvalRate = data.approval_rate || 0;
  const avgDecisionDays = data.avg_decision_days;
  const readinessBuckets = data.readiness_buckets || [];
  const readinessAnalyzed = data.readiness_analyzed || 0;
  const ranking = data.ranking;

  const totalActivity = activity.reduce((sum, p) => sum + (p.value || 0), 0);
  const ar = locale === 'ar';
  const areaData = activity.map((p) => ({ label: p.label?.[locale] || p.label?.en, value: p.value }));
  const last = areaData[areaData.length - 1];
  const prev = areaData[areaData.length - 2];
  const delta = last && prev && prev.value > 0 ? Math.round(((last.value - prev.value) / prev.value) * 100) : null;
  const PALETTE = ['var(--color-primary)', 'var(--color-success)', 'var(--color-accent)', 'var(--color-info)', 'var(--color-danger)'];
  const facultySegments = facultyBreakdown.slice(0, 5).map((f, i) => ({ label: f.label?.[locale] || f.label?.en, value: f.count, color: PALETTE[i % PALETTE.length] }));
  const facultyBars = facultyBreakdown.slice(0, 8).map((f) => ({ label: f.label?.[locale] || f.label?.en, value: f.count }));
  const readinessBars = readinessBuckets.map((b) => ({ label: b.label, value: b.count }));
  const topFaculty = facultyBreakdown.slice().sort((a, b) => b.count - a.count)[0];

  const insights = [];
  if (delta !== null) {
    insights.push({
      icon: delta >= 0 ? 'trend' : 'arrow-down',
      title: delta >= 0 ? (ar ? 'النشاط في ارتفاع' : 'Activity is rising') : (ar ? 'النشاط في تراجع' : 'Activity is slowing'),
      text: ar ? `المشاريع ${delta >= 0 ? 'ارتفعت' : 'انخفضت'} ${Math.abs(delta)}٪ عن الشهر السابق.` : `Submissions ${delta >= 0 ? 'rose' : 'fell'} ${Math.abs(delta)}% versus the previous month.`,
    });
  }
  if (topFaculty && topFaculty.pct > 0) {
    insights.push({
      icon: 'award',
      title: ar ? `${topFaculty.label?.[locale] || topFaculty.label?.en} في الصدارة` : `${topFaculty.label?.en} leads`,
      text: ar ? `تمثل ${topFaculty.pct}٪ من المشاريع.` : `It holds ${topFaculty.pct}% of all projects.`,
    });
  }
  insights.push({
    icon: 'shield',
    title: approvalRate >= 70 ? (ar ? 'الاعتمادات في وضع جيد' : 'Approvals are healthy') : (ar ? 'الاعتمادات تحتاج انتباه' : 'Approvals need attention'),
    text: ar ? `معدل الاعتماد ${approvalRate}٪.` : `Approval rate is ${approvalRate}%.`,
  });

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Analytics')}</h1>
          <p>{ar ? 'نظرة عامة على أداء الابتكار في جامعتك.' : "An overview of your university's innovation performance."}</p>
        </div>
      </div>

      <div className="insight-grid insight-grid--kpi">
        <KpiCard label={ar ? 'المشاريع (٦ أشهر)' : 'Projects (6 mo.)'} value={fmt(totalActivity)} tone="primary" delta={delta} note={delta !== null ? (ar ? 'مقابل الشهر السابق' : 'vs. previous month') : undefined} />
        <KpiCard label={ar ? 'معدل الاعتماد' : 'Approval Rate'} value={`${approvalRate}%`} tone={approvalRate >= 70 ? 'success' : 'warning'} progress={Number(approvalRate)} />
        <KpiCard label={ar ? 'متوسط زمن القرار' : 'Avg. Time to Decision'} value={avgDecisionDays !== null && avgDecisionDays !== undefined ? `${avgDecisionDays} ${t('days')}` : '—'} tone="info" />
        <KpiCard label={ar ? 'كليات نشطة' : 'Active Faculties'} value={fmt(facultyBreakdown.length)} tone="success" />
      </div>

      <div className="insight-grid insight-grid--main">
        <Panel
          title={t('Projects Submitted per Month')}
          subtitle={last ? (ar ? `آخر نقطة: ${last.label} — ${fmt(last.value)}` : `Latest: ${last.label} — ${fmt(last.value)}`) : undefined}
        >
          <AreaChart data={areaData} emptyText={t('Not enough data yet.')} />
        </Panel>

        <Panel title={t('Breakdown by Faculty')} subtitle={ar ? 'حصة كل كلية من المشاريع' : 'Share of projects per faculty'}>
          <DonutChart segments={facultySegments} centerLabel={ar ? 'مشروع' : 'projects'} emptyText={t('Not enough faculty data yet.')} />
        </Panel>
      </div>

      <div className="insight-grid insight-grid--halves">
        <Panel title={t('Readiness Score Distribution')} subtitle={readinessAnalyzed > 0 ? (ar ? `مبني على ${readinessAnalyzed} مشروع تم تحليله بالذكاء الاصطناعي.` : `Based on ${readinessAnalyzed} AI-analyzed project${readinessAnalyzed === 1 ? '' : 's'}.`) : undefined}>
          {readinessAnalyzed > 0
            ? <HBarChart items={readinessBars} emptyText={t('Not enough data yet.')} />
            : <p className="chart-empty">{t('No projects have been AI-analyzed yet. Scores will appear here once students request a readiness analysis for their projects.')}</p>}
        </Panel>

        <Panel title={t('Projects by Faculty')} subtitle={ar ? 'أعلى الكليات من حيث عدد المشاريع' : 'Top faculties by number of projects'}>
          <HBarChart items={facultyBars} emptyText={t('Not enough faculty data yet.')} />
        </Panel>
      </div>

      <div className="insight-grid insight-grid--bottom">
        <Panel title={t('Trend Analysis')} subtitle={t('Last 30 days vs the prior 30, by submission count.')}>
          {trends && trends.length ? (
            <ul className="insight-list" style={{ gap: 0 }}>
              {trends.map((trend, i) => (
                <li key={i} style={{ gridTemplateColumns: '1fr auto', padding: '12px 0', borderBottom: i < trends.length - 1 ? '1px solid var(--border-subtle)' : 'none', alignItems: 'center' }}>
                  <div><strong>{ar ? (trend.category_ar || t(trend.category)) : trend.category}</strong></div>
                  {trend.growth_pct === null ? (
                    <span className="badge badge-neutral">{ar ? 'جديد' : 'New'}</span>
                  ) : (
                    <span className={`badge ${trend.growth_pct >= 0 ? 'badge-success' : 'badge-danger'}`}>
                      <Icon name={trend.growth_pct >= 0 ? 'arrow-up' : 'arrow-down'} size={12} /> {(trend.growth_pct >= 0 ? '+' : '') + trend.growth_pct}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="chart-empty">{t('Not enough data yet.')}</p>}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Panel title={t('Innovation Statistics')}>
            {ranking ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <strong className="kpi-card__value">#{ranking.rank}</strong>
                  <span className="text-caption">{ar ? `من أصل ${ranking.total} جامعة` : `of ${ranking.total} universities`}</span>
                </div>
                <p className="text-small">
                  {ar
                    ? `جامعتك في أعلى ${ranking.percentile}٪ من حيث عدد المشاريع المُقدَّمة (${ranking.projects} مشروع).`
                    : `Your university ranks in the top ${ranking.percentile}% by submitted projects (${ranking.projects} total).`}
                </p>
              </>
            ) : <p className="chart-empty">{t('Not enough data yet to compare.')}</p>}
          </Panel>

          <Panel title={ar ? 'أهم الملاحظات' : 'Key insights'} className="panel--soft">
            <ul className="insight-list">
              {insights.map((it) => (
                <li key={it.title}>
                  <Icon name={it.icon} size={20} />
                  <div><strong>{it.title}</strong><span>{it.text}</span></div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
