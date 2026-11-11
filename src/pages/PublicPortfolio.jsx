import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Icon from '../components/Icon';
import SiteFooter from '../components/SiteFooter';
import PublicTopbar from '../components/PublicTopbar';
import AmbientBackdrop from '../components/AmbientBackdrop';
import usePaperUnfold from '../hooks/usePaperUnfold';

// Role badge shown under the name (owner.role comes from the API's primary role).
const ROLE_BADGE = {
  student:          { en: 'Student', ar: 'طالب' },
  university:       { en: 'University', ar: 'جامعة' },
  faculty:          { en: 'Faculty', ar: 'كلية' },
  academic_staff:   { en: 'Academic Staff', ar: 'عضو هيئة تدريس' },
  supervisor:       { en: 'Supervisor', ar: 'مشرف' },
  admin:            { en: 'Administrator', ar: 'مدير المنصة' },
  data_analyst:     { en: 'Data Analyst', ar: 'محلل بيانات' },
  security_admin:   { en: 'Security', ar: 'الأمان' },
  security_officer: { en: 'Security', ar: 'الأمان' },
};

// Per-role identity: accent colour, icon, badge and the "what this person does on UIPE" cards.
// Keyed by `kind` = owner.profile.kind (doctor / ta / supervisor) or else owner.role.
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; };
const KIND = {
  doctor: {
    accent: '#0F766E', icon: 'award', badge: { en: 'Doctor', ar: 'دكتور' },
    tag: { en: 'Faculty member', ar: 'عضو هيئة تدريس' },
    duties: [
      { icon: 'note',  en: ['Exams & question banks', 'Builds exams and question banks for the courses they teach.'], ar: ['الامتحانات وبنوك الأسئلة', 'بيجهّز الامتحانات وبنوك الأسئلة للمواد اللي بيدرّسها.'] },
      { icon: 'check-circle', en: ['Grading & feedback', 'Grades student work and gives feedback.'], ar: ['التصحيح والتغذية الراجعة', 'بيصحّح شغل الطلاب وبيدّيهم ملاحظاته.'] },
      { icon: 'users', en: ['Student follow-up', 'Follows student progress throughout the term.'], ar: ['متابعة الطلاب', 'بيتابع تقدّم الطلاب على مدار الترم.'] },
    ],
  },
  ta: {
    accent: '#7C3AED', icon: 'users', badge: { en: 'Teaching Assistant', ar: 'معيد' },
    tag: { en: 'Teaching staff', ar: 'الهيئة المعاونة' },
    duties: [
      { icon: 'flask', en: ['Labs & sections', 'Runs practical sessions and section classes.'], ar: ['المعامل والسكاشن', 'بيدير الجلسات العملية والسكاشن.'] },
      { icon: 'check-circle', en: ['Grading support', 'Helps grade assignments and exams.'], ar: ['مساعدة في التصحيح', 'بيساعد في تصحيح التكليفات والامتحانات.'] },
      { icon: 'chat', en: ['Student support', 'First point of contact for student questions.'], ar: ['دعم الطلاب', 'أول نقطة تواصل لأسئلة الطلاب.'] },
    ],
  },
  academic_staff: null, // resolved to doctor / ta from the API; falls back to doctor below
  supervisor: {
    accent: '#C2410C', icon: 'briefcase', badge: { en: 'Project Supervisor', ar: 'مشرف مشاريع' },
    tag: { en: 'Supervision', ar: 'الإشراف' },
    duties: [
      { icon: 'eye', en: ['Project review', 'Reviews student projects submitted for supervision.'], ar: ['مراجعة المشاريع', 'بيراجع مشاريع الطلاب المقدّمة للإشراف.'] },
      { icon: 'check-circle', en: ['Approval & grading', 'Approves and grades assigned projects.'], ar: ['الاعتماد والتقييم', 'بيعتمد المشاريع المسندة له وبيقيّمها.'] },
      { icon: 'users', en: ['Team mentoring', 'Guides student teams through delivery.'], ar: ['توجيه الفرق', 'بيوجّه فرق الطلاب لحد التسليم.'] },
    ],
  },
  admin: {
    accent: '#4F46E5', icon: 'settings', badge: { en: 'Platform Administrator', ar: 'مدير المنصة' },
    tag: { en: 'Administration', ar: 'الإدارة' },
    duties: [
      { icon: 'users', en: ['Accounts & access', 'Manages users, roles and access across the platform.'], ar: ['الحسابات والصلاحيات', 'بيدير المستخدمين والأدوار والصلاحيات على المنصة.'] },
      { icon: 'projects', en: ['Content & projects', 'Oversees projects, featured content and announcements.'], ar: ['المحتوى والمشاريع', 'بيشرف على المشاريع والمحتوى المميز والإعلانات.'] },
      { icon: 'dashboard', en: ['Platform health', 'Keeps the platform running smoothly for everyone.'], ar: ['سلامة المنصة', 'بيتأكد إن المنصة شغّالة كويس للكل.'] },
    ],
  },
  security_admin: {
    accent: '#0E7490', icon: 'shield', badge: { en: 'Security', ar: 'الأمان' },
    tag: { en: 'Information security', ar: 'أمن المعلومات' },
    duties: [
      { icon: 'alert-triangle', en: ['Incidents & alerts', 'Monitors and responds to security incidents.'], ar: ['الحوادث والتنبيهات', 'بيراقب الحوادث الأمنية وبيتعامل معاها.'] },
      { icon: 'lock', en: ['Policies & access', 'Maintains security policies and access controls.'], ar: ['السياسات والوصول', 'بيحافظ على سياسات الأمان وضوابط الوصول.'] },
      { icon: 'file', en: ['Audit & reports', 'Reviews audit logs and produces security reports.'], ar: ['المراجعة والتقارير', 'بيراجع سجلات التدقيق وبيطلّع تقارير الأمان.'] },
    ],
  },
  data_analyst: {
    accent: '#B45309', icon: 'bar-chart', badge: { en: 'Data Analyst', ar: 'محلل بيانات' },
    tag: { en: 'Data & insights', ar: 'البيانات والتحليل' },
    duties: [
      { icon: 'trend', en: ['Trends & insights', 'Analyses platform data to surface trends.'], ar: ['الاتجاهات والرؤى', 'بيحلّل بيانات المنصة ويطلّع الاتجاهات.'] },
      { icon: 'dashboard', en: ['Dashboards', 'Builds dashboards and saved data segments.'], ar: ['لوحات المتابعة', 'بيبني لوحات متابعة وشرائح بيانات محفوظة.'] },
      { icon: 'download', en: ['Reports & exports', 'Prepares custom reports and data exports.'], ar: ['التقارير والتصدير', 'بيجهّز تقارير مخصصة وتصدير للبيانات.'] },
    ],
  },
};
KIND.security_officer = KIND.security_admin;
KIND.data_analysis = KIND.data_analyst;

/**
 * Public portfolio — /p/{uuid}, no login required.
 * Talks to GET /api/v1/public/portfolios/{uuid} (owner.full_name, portfolio.headline/about,
 * featured_projects[]). 404 (missing user or non-public portfolio) is one "not found" state.
 *
 * Redesigned to match the new UIPE portal design language (violet palette,
 * 14px radius cards, Light + Dark). Styles: styles/css/pages/public-portfolio.css (scoped to .prf-page).
 * No new backend data is needed — everything shown comes from the existing response.
 */
export default function PublicPortfolio() {
  const { uuid } = useParams();
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  usePaperUnfold('.prf-section');

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api.get(`/api/v1/public/portfolios/${encodeURIComponent(uuid)}`)
      .then((json) => { if (alive) setData(json.data); })
      .catch((err) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [uuid]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — silently ignore */ }
  };

  // ---- Not found ----
  if (error) {
    return (
      <div className="prf-page">
      <AmbientBackdrop />
        <div className="prf-shell">
          <PublicTopbar />
          <div className="prf-card prf-state">
            <Icon name="user" size={34} />
            <h1>{t('Portfolio not found', 'الملف الشخصي غير موجود')}</h1>
            <p>{t('This profile does not exist or is not public.', 'الملف ده مش موجود أو مش متاح للعامة.')}</p>
            <Link to="/projects" className="prf-btn prf-btn--primary">{t('Browse projects', 'تصفّح المشاريع')}</Link>
          </div>
        </div>
      </div>
    );
  }

  // ---- Loading ----
  if (!data) {
    return (
      <div className="prf-page">
      <AmbientBackdrop />
        <div className="prf-shell">
          <PublicTopbar />
          <div className="prf-layout" aria-busy="true" aria-label={t('Loading…', 'جارِ التحميل…')}>
            <div className="prf-skel" style={{ height: 380 }} />
            <div className="prf-main">
              <div className="prf-skel" style={{ height: 150 }} />
              <div className="prf-skel" style={{ height: 300 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const owner = data.owner || {};
  const portfolio = data.portfolio || {};
  const featured = data.featured_projects || [];
  const fullName = owner.full_name || '';
  const initial = (fullName || '?').trim().charAt(0).toUpperCase();
  const asUrl = (p) => (p ? `/${String(p).replace(/^\//, '')}` : '');
  const avatarUrl = asUrl(owner.avatar_path);
  const coverUrl = asUrl(portfolio.cover_path);
  const liveCount = featured.filter((p) => p.live_demo_url).length;
  const prof = owner.profile || null;
  const kindKey = prof?.kind || (owner.role === 'academic_staff' ? 'doctor' : owner.role);
  const kind = KIND[kindKey] || null;
  const roleBadge = kind ? kind.badge : ROLE_BADGE[owner.role];
  const pick = (o) => (o ? ((isAr ? o.ar : o.en) || o.en || o.ar || '') : '');
  const affiliation = prof ? [
    ['university', 'building', t('University', 'الجامعة'), pick(prof.university)],
    ['faculty',    'layers',   t('Faculty', 'الكلية'),     pick(prof.faculty)],
    ['department', 'folder',   t('Department', 'القسم'),   pick(prof.department)],
    ['rank',       'award',    t('Title', 'المسمى'),       pick(prof.rank)],
  ].filter((r) => r[3]) : [];
  // Only students own projects; every other role gets its own role-specific profile instead
  // of an always-empty "Featured Projects" block (unless they do have featured projects).
  const showProjects = !owner.role || owner.role === 'student' || featured.length > 0;
  const themeStyle = kind ? { '--prf-accent': kind.accent, '--color-primary-rgb': hex2rgb(kind.accent) } : undefined;

  return (
    <div className="prf-page" style={themeStyle}>
      <AmbientBackdrop />
      <div className="prf-shell">
        <PublicTopbar />

        <div className="prf-layout">
          {/* ---- Hero ---- */}
          <header className="prf-card prf-hero animate-rise-in">
            <div className={`prf-hero__cover${coverUrl ? ' has-img' : ''}`} aria-hidden="true">
              {coverUrl && <img src={coverUrl} alt="" />}
            </div>
            <div className="prf-hero__body">
              <div className={`prf-avatar${avatarUrl ? ' prf-avatar--photo' : ''}`} aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
              </div>
              <div className="prf-id">
                <h1 className="prf-name">{fullName}</h1>
                {roleBadge && (
                  <span className="prf-role">
                    {kind && <Icon name={kind.icon} size={14} />}
                    {isAr ? roleBadge.ar : roleBadge.en}
                  </span>
                )}
                {kind && pick(prof?.university) && <p className="prf-headline">{pick(prof.university)}</p>}
                {portfolio.headline && <p className="prf-headline">{portfolio.headline}</p>}
              </div>
              <div className="prf-actions">
                <button type="button" className={`prf-btn${copied ? ' is-done' : ''}`} onClick={copyLink}>
                  <Icon name={copied ? 'check' : 'link'} size={16} />
                  {copied ? t('Link copied', 'تم نسخ الرابط') : t('Copy profile link', 'نسخ رابط البروفايل')}
                </button>
                <Link to="/projects" className={`prf-btn${showProjects ? ' prf-btn--primary' : ''}`}>
                  <Icon name="projects" size={16} />
                  {t('Explore all projects', 'استكشف كل المشاريع')}
                </Link>
              </div>
            </div>
            {showProjects && (
              <div className="prf-stats">
                <div className="prf-stat"><strong>{featured.length}</strong><span>{t('Featured projects', 'مشاريع مميزة')}</span></div>
                <div className="prf-stat"><strong>{liveCount}</strong><span>{t('Live demos', 'عروض شغّالة')}</span></div>
              </div>
            )}
          </header>

          {/* ---- Main column ---- */}
          <div className="prf-main">
            {portfolio.about && (
              <section className="prf-card prf-section animate-rise-in">
                <div className="prf-section__head">
                  <h2 className="prf-section__title"><Icon name="user" size={18} />{t('About', 'نبذة')}</h2>
                </div>
                <p className="prf-about">{portfolio.about}</p>
              </section>
            )}

            {affiliation.length > 0 && (
              <section className="prf-card prf-section animate-rise-in">
                <div className="prf-section__head">
                  <h2 className="prf-section__title"><Icon name="building" size={18} />{t('Affiliation', 'جهة العمل')}</h2>
                </div>
                <dl className="prf-facts">
                  {affiliation.map(([k, ic, label, val]) => (
                    <div key={k} className="prf-fact">
                      <dt><Icon name={ic} size={15} />{label}</dt>
                      <dd>{val}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {kind && (
              <section className="prf-card prf-section animate-rise-in">
                <div className="prf-section__head">
                  <h2 className="prf-section__title"><Icon name={kind.icon} size={18} />{t('Role on UIPE', 'الدور على المنصة')}</h2>
                  <span className="prf-count prf-count--text">{isAr ? kind.tag.ar : kind.tag.en}</span>
                </div>
                <div className="prf-duties">
                  {kind.duties.map((d, i) => (
                    <div key={i} className="prf-duty">
                      <span className="prf-duty__ic"><Icon name={d.icon} size={18} /></span>
                      <div>
                        <strong>{isAr ? d.ar[0] : d.en[0]}</strong>
                        <p>{isAr ? d.ar[1] : d.en[1]}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showProjects && (
            <section className="prf-card prf-section animate-rise-in">
              <div className="prf-section__head">
                <h2 className="prf-section__title"><Icon name="star" size={18} />{t('Featured Projects', 'المشاريع المميزة')}</h2>
                {featured.length > 0 && <span className="prf-count">{featured.length}</span>}
              </div>

              {featured.length === 0 ? (
                <div className="prf-empty">
                  <Icon name="folder" size={30} />
                  <strong>{t('No featured projects yet', 'لا توجد مشاريع مميزة بعد')}</strong>
                  <p>{t('Featured projects will appear here once they are added.', 'المشاريع المميزة هتظهر هنا أول ما تتضاف.')}</p>
                </div>
              ) : (
                <div className="prf-grid">
                  {featured.map((p) => {
                    const title = (isAr ? p.title?.ar : p.title?.en) || p.title?.en || p.title?.ar || '';
                    const summary = (isAr ? p.summary?.ar : p.summary?.en) || p.summary?.en || p.summary?.ar || '';
                    const category = (isAr ? p.category?.ar : p.category?.en) || p.category?.en || '';
                    const tags = Array.isArray(p.tags) ? p.tags : [];
                    const cover = p.cover_image_path || '';
                    const liveUrl = p.live_demo_url || '';
                    return (
                      <article key={p.id} className="prf-project">
                        <div className="prf-project__media">
                          {cover ? (
                            <img src={`/${cover.replace(/^\//, '')}`} alt={title} loading="lazy" />
                          ) : (
                            <div className="prf-project__ph">{(title || '?').charAt(0).toUpperCase()}</div>
                          )}
                          {liveUrl && (
                            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="prf-project__live">
                              <i /> {t('Live', 'شغّال')}
                            </a>
                          )}
                        </div>
                        <div className="prf-project__body">
                          {category && <span className="prf-project__cat">{category}</span>}
                          <h3 className="prf-project__title">
                            <Link to={`/projects/${encodeURIComponent(p.slug || p.id)}`} className="prf-project__link">{title}</Link>
                          </h3>
                          {summary && <p className="prf-project__sum">{summary}</p>}
                          {tags.length > 0 && (
                            <div className="prf-tags">
                              {tags.map((tag, i) => <span key={i} className="prf-tag">{String(tag)}</span>)}
                            </div>
                          )}
                          <div className="prf-project__foot">
                            <span className="prf-badge-pub"><Icon name="check-circle" size={14} />{t('Published', 'منشور')}</span>
                            <Link to={`/projects/${encodeURIComponent(p.slug || p.id)}`}>
                              {t('View details', 'عرض التفاصيل')} <Icon name={isAr ? 'arrow-left' : 'arrow-right'} size={14} />
                            </Link>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            )}
          </div>
        </div>

        <p className="prf-credit">
          {t('Public profile powered by', 'ملف عام تم إنشاؤه عبر')} <Link to="/">UIPE</Link>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
