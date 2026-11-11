import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Icon from '../components/Icon';
import SiteFooter from '../components/SiteFooter';
import PublicTopbar from '../components/PublicTopbar';
import AmbientBackdrop from '../components/AmbientBackdrop';
import usePaperUnfold from '../hooks/usePaperUnfold';

/**
 * Public faculty page — /universities/{universitySlug}/faculties/{facultySlug}, no login required.
 * Talks to GET /api/v1/faculty/public/{universitySlug}/{facultySlug} (FacultyApiController::publicShow()).
 * 404 (unknown slugs / non-public faculty / non-public parent university) is one "not found" state.
 *
 * Same design language as PublicPortfolio.jsx and PublicUniversityProfile.jsx: scoped to .prf-page in
 * styles/css/pages/public-portfolio.css, Light + Dark, RTL-aware.
 */
export default function PublicFacultyProfile() {
  const { universitySlug, facultySlug } = useParams();
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
    api.get(`/api/v1/faculty/public/${encodeURIComponent(universitySlug)}/${encodeURIComponent(facultySlug)}`)
      .then((json) => { if (alive) setData(json.data); })
      .catch((err) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [universitySlug, facultySlug]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — ignore */ }
  };

  if (error) {
    return (
      <div className="prf-page">
      <AmbientBackdrop />
        <div className="prf-shell">
          <PublicTopbar />
          <div className="prf-card prf-state">
            <Icon name="building" size={34} />
            <h1>{t('Faculty page not found', 'صفحة الكلية غير موجودة')}</h1>
            <p>{t('This profile does not exist or is not public.', 'الصفحة دي مش موجودة أو مش متاحة للعامة.')}</p>
            <Link to="/projects" className="prf-btn prf-btn--primary">{t('Browse projects', 'تصفّح المشاريع')}</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="prf-page">
      <AmbientBackdrop />
        <div className="prf-shell">
          <PublicTopbar />
          <div className="prf-layout" aria-busy="true" aria-label={t('Loading…', 'جارِ التحميل…')}>
            <div className="prf-skel" style={{ height: 420 }} />
            <div className="prf-main">
              <div className="prf-skel" style={{ height: 90 }} />
              <div className="prf-skel" style={{ height: 320 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const university = data.university || {};
  const faculty = data.faculty || {};
  const departments = data.departments || [];
  const uniName = isAr ? (university.official_name_ar || university.official_name_en) : (university.official_name_en || university.official_name_ar);
  const name = isAr ? (faculty.name_ar || faculty.name_en) : (faculty.name_en || faculty.name_ar);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const website = faculty.website || '';
  const websiteLabel = website.replace(/^https?:\/\//, '').replace(/\/$/, '');

  const kpis = [
    { icon: 'building', value: faculty.departments_count ?? 0, label: t('Departments', 'الأقسام') },
    { icon: 'users', value: faculty.students_count ?? 0, label: t('Students', 'الطلاب') },
    { icon: 'projects', value: faculty.published_projects_count ?? 0, label: t('Published projects', 'مشاريع منشورة') },
  ];

  return (
    <div className="prf-page">
      <AmbientBackdrop />
      <div className="prf-shell">
        <PublicTopbar />

        <div className="prf-layout">
          {/* ---- Hero ---- */}
          <header className="prf-card prf-hero animate-rise-in">
            <div className="prf-hero__cover" aria-hidden="true" />
            <div className="prf-hero__body">
              <div className={`prf-avatar${faculty.logo_path ? ' prf-avatar--logo' : ''}`} aria-hidden="true">
                {faculty.logo_path ? <img src={faculty.logo_path} alt="" /> : initial}
              </div>
              <div className="prf-id">
                <h1 className="prf-name">{name}</h1>
                {uniName && <p className="prf-subline">{uniName}</p>}
              </div>
              <div className="prf-actions">
                <button type="button" className={`prf-btn${copied ? ' is-done' : ''}`} onClick={copyLink}>
                  <Icon name={copied ? 'check' : 'link'} size={16} />
                  {copied ? t('Link copied', 'تم نسخ الرابط') : t('Copy profile link', 'نسخ رابط البروفايل')}
                </button>
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer" className="prf-btn prf-btn--primary">
                    <Icon name="globe" size={16} />
                    {t('Visit website', 'زيارة الموقع')}
                  </a>
                )}
              </div>
            </div>
            {website && (
              <ul className="prf-meta">
                <li>
                  <Icon name="globe" size={16} />
                  <a href={website} target="_blank" rel="noopener noreferrer">{websiteLabel}</a>
                </li>
              </ul>
            )}
          </header>

          {/* ---- Main column ---- */}
          <div className="prf-main">
            <div className="prf-kpis">
              {kpis.map((k) => (
                <div key={k.label} className="prf-card prf-kpi animate-rise-in">
                  <span className="prf-kpi__ico"><Icon name={k.icon} size={20} /></span>
                  <div><strong>{k.value}</strong><span>{k.label}</span></div>
                </div>
              ))}
            </div>

            {faculty.description && (
              <section className="prf-card prf-section animate-rise-in">
                <div className="prf-section__head">
                  <h2 className="prf-section__title"><Icon name="info" size={18} />{t('About', 'نبذة')}</h2>
                </div>
                <p className="prf-about">{faculty.description}</p>
              </section>
            )}

            <section className="prf-card prf-section animate-rise-in">
              <div className="prf-section__head">
                <h2 className="prf-section__title"><Icon name="building" size={18} />{t('Departments', 'الأقسام')}</h2>
                {departments.length > 0 && <span className="prf-count">{departments.length}</span>}
              </div>

              {departments.length === 0 ? (
                <div className="prf-empty">
                  <Icon name="building" size={30} />
                  <strong>{t('No public departments yet', 'لا توجد أقسام معلنة بعد')}</strong>
                  <p>{t('Departments will appear here once they are made public.', 'الأقسام هتظهر هنا أول ما تتفعّل للعامة.')}</p>
                </div>
              ) : (
                <div className="prf-grid">
                  {departments.map((d) => {
                    const dName = isAr ? (d.name_ar || d.name_en) : (d.name_en || d.name_ar);
                    return (
                      <article key={d.id} className="prf-dept">
                        <span className="prf-dept__ico"><Icon name="layers" size={18} /></span>
                        <h3>{dName}</h3>
                        {d.description && <p>{d.description}</p>}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
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
