import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { EmptyState, Skeleton } from '../../components/student/stUi';
import { initials } from '../../components/Sidebar';
import PortfolioCoverCard from '../../components/portfolio/PortfolioCoverCard';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/portfolio';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/student/portfolio.php, talking to /api/v1/portfolios/*
 * (App\Controllers\Api\PortfoliosApiController, reusing PortfolioService
 * exactly as Student\StudentPortfolioController does). GET /me for the
 * combined portfolio + eligible + featured projects; PATCH /me for
 * headline/about/is_public; POST /projects/{id}/feature to toggle a
 * published project's featured state — same three calls the Blade view's
 * three <form>s submit to.
 */
const assetUrl = (p) => `/${String(p).replace(/^\//, '')}`;

function PfAvatar({ src, user, size = 88 }) {
  return (
    <span className="pf-avatar" style={{ width: size, height: size, fontSize: Math.round(size / 3) }}>
      {src ? <img src={assetUrl(src)} alt="" /> : initials(user || {})}
    </span>
  );
}

function ProjectMiniCard({ p, locale, t }) {
  const title = (locale === 'ar' ? p.title?.ar : p.title?.en) || p.title?.en || p.title?.ar || '';
  const category = (locale === 'ar' ? p.category?.ar : p.category?.en) || p.category?.en || '';
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const cover = p.cover_image_path || '';
  const liveUrl = p.live_demo_url || '';
  return (
    <article className="pf-project">
      <div className="pf-project__media">
        {cover
          ? <img src={assetUrl(cover)} alt={title} loading="lazy" />
          : <span className="pf-project__ph"><Icon name="projects" size={28} /></span>}
        <span className="pf-project__star" title={locale === 'ar' ? 'مشروع مميز' : 'Featured'}><Icon name="star" size={13} /></span>
      </div>
      <div className="pf-project__body">
        {category && <span className="st-tag">{category}</span>}
        <h3 dir="auto">{title}</h3>
        {tags.length > 0 && (
          <div className="pf-project__tags">{tags.slice(0, 4).map((tag, i) => <span key={i}>{String(tag)}</span>)}</div>
        )}
        {liveUrl && (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="pf-project__link"><Icon name="link" size={13} /> {t('Visit demo')}</a>
        )}
      </div>
    </article>
  );
}

/** Cover banner + avatar + name/headline/about. Shared by the View and Public Preview tabs. */
function ProfileHero({ data, user, name, headline, about, isPublic, ar, t, actions, center = false }) {
  const cover = data.portfolio?.cover_path;
  return (
    <section className={`pf-hero${center ? ' pf-hero--center' : ''}`}>
      <div className="pf-hero__cover" style={cover ? { backgroundImage: `url(${assetUrl(cover)})` } : undefined} />
      <div className="pf-hero__body">
        <PfAvatar src={data.avatar_path} user={user} size={center ? 96 : 92} />
        <div className="pf-hero__info">
          <div className="pf-hero__title">
            <h2 dir="auto">{name}</h2>
            <span className={`pf-vis ${isPublic ? 'is-public' : 'is-private'}`}>
              <Icon name={isPublic ? 'eye' : 'eye-off'} size={12} /> {isPublic ? t('Public') : t('Private')}
            </span>
          </div>
          <p className="pf-hero__headline" dir="auto">{headline || (ar ? 'لم تضف عنوانًا تعريفيًا بعد' : 'No headline yet')}</p>
          {about && <p className="pf-hero__about" dir="auto">{about}</p>}
        </div>
        {actions && <div className="pf-hero__actions">{actions}</div>}
      </div>
    </section>
  );
}

export default function StudentPortfolio() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const { user } = useAuth();
  const ar = locale === 'ar';
  usePageMeta(ar ? 'الملف الإبداعي' : 'Portfolio', t('Your public page for showcasing your published projects.'));
  const [tab, setTab] = useState('view');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const [headline, setHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v1/portfolios/me')
      .then((json) => {
        setData(json.data);
        setHeadline(json.data.portfolio?.headline || '');
        setAbout(json.data.portfolio?.about || '');
        setIsPublic(!!json.data.portfolio?.is_public);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setActionError(null);
    try {
      await api.patch('/api/v1/portfolios/me', { headline, about, is_public: isPublic });
      setSavedAt(Date.now());
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleFeature = async (dbId) => {
    setActionError(null);
    try {
      await api.post(`/api/v1/portfolios/projects/${dbId}/feature`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const copyLink = () => {
    if (!data?.share_url) return;
    navigator.clipboard?.writeText(data.share_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <Skeleton h={120} count={2} />;
  if (error) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>;
  if (!data) return null;

  const eligible = data.eligible_projects || [];
  const featured = data.featured_projects || [];
  const name = user?.full_name || user?.name || '';
  const TABS = [
    { key: 'view', label: ar ? 'عرض' : 'View' },
    { key: 'edit', label: ar ? 'تعديل' : 'Edit' },
    { key: 'preview', label: ar ? 'المعاينة العامة' : 'Public Preview' },
  ];
  const headlineSaved = data.portfolio?.headline || '';
  const aboutSaved = data.portfolio?.about || '';

  const featuredGrid = featured.length === 0 ? (
    <EmptyState icon="award" title={t('No featured projects yet — pick from your published projects below.')} text={ar ? 'اختر من مشاريعك المنشورة من تبويب «تعديل».' : 'Pick from your published projects in the Edit tab.'}>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('edit')}>{ar ? 'اختيار مشاريع' : 'Choose projects'}</button>
    </EmptyState>
  ) : (
    <div className="pf-grid">{featured.map((p) => <ProjectMiniCard key={p.id} p={p} locale={locale} t={t} />)}</div>
  );

  const canShare = isPublic && data.share_url;
  const shortUrl = canShare ? String(data.share_url).replace(/^https?:\/\//, '') : '';

  return (
    <div className="st-page pf-page">
      <div className="st-tabs" role="tablist">
        {TABS.map((tb) => (
          <button key={tb.key} type="button" role="tab" aria-selected={tab === tb.key} className={`st-tab${tab === tb.key ? ' is-active' : ''}`} onClick={() => setTab(tb.key)}>{tb.label}</button>
        ))}
      </div>

      {actionError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{actionError}</span></div>}

      {tab === 'view' && (
        <>
          <ProfileHero
            data={data} user={user} name={name} headline={headlineSaved} about={aboutSaved}
            isPublic={isPublic} ar={ar} t={t}
            actions={(
              <>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('edit')}><Icon name="edit" size={14} /> {ar ? 'تعديل الملف' : 'Edit Portfolio'}</button>
                {canShare && <a className="btn btn-primary btn-sm" href={data.share_url} target="_blank" rel="noopener noreferrer"><Icon name="globe" size={14} /> {t('Open public page')}</a>}
              </>
            )}
          />

          <div className="pf-stats">
            <div className="pf-stat">
              <span className="pf-stat__icon"><Icon name="star" size={16} /></span>
              <div><strong>{featured.length}</strong><small>{ar ? 'مشاريع مميزة' : 'Featured projects'}</small></div>
            </div>
            <div className="pf-stat">
              <span className="pf-stat__icon"><Icon name="check-circle" size={16} /></span>
              <div><strong>{eligible.length}</strong><small>{ar ? 'مشاريع منشورة' : 'Published projects'}</small></div>
            </div>
            <div className="pf-stat">
              <span className="pf-stat__icon"><Icon name={isPublic ? 'eye' : 'eye-off'} size={16} /></span>
              <div><strong>{isPublic ? t('Public') : t('Private')}</strong><small>{ar ? 'ظهور الملف' : 'Visibility'}</small></div>
            </div>
          </div>

          {canShare ? (
            <div className="pf-share">
              <span className="pf-share__icon"><Icon name="share" size={16} /></span>
              <div className="pf-share__text">
                <small>{t('Public Share Link')}</small>
                <span dir="ltr" title={data.share_url}>{shortUrl}</span>
              </div>
              <button type="button" className={`btn btn-sm ${copied ? 'btn-primary' : 'btn-outline'}`} onClick={copyLink}>
                <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? t('Copied!') : (ar ? 'نسخ الرابط' : 'Copy Link')}
              </button>
            </div>
          ) : (
            <div className="st-alert"><Icon name="eye-off" size={16} /><span>{ar ? 'ملفك خاص حاليًا. فعّل «إظهار الملف للعامة» من تبويب تعديل عشان تحصل على رابط للمشاركة.' : 'Your portfolio is private. Turn on public visibility in the Edit tab to get a shareable link.'}</span></div>
          )}

          <section>
            <div className="pf-section-head">
              <h2>{t('Featured Projects')} <span className="pf-count">{featured.length}</span></h2>
              <button type="button" className="st-link" onClick={() => setTab('edit')}>{ar ? 'إدارة المشاريع المميزة' : 'Manage featured'}</button>
            </div>
            {featuredGrid}
          </section>
        </>
      )}

      {tab === 'edit' && (
        <div className="pf-edit">
          <div className="pf-edit__main">
            <PortfolioCoverCard
              coverPath={data.portfolio?.cover_path}
              avatarPath={data.avatar_path}
              name={name}
              onChanged={(cp) => setData((d) => ({ ...d, portfolio: { ...d.portfolio, cover_path: cp } }))}
            />
            <section className="st-panel">
              <h2 style={{ marginBottom: 14 }}>{t('Headline & About')}</h2>
              <form className="st-form" onSubmit={saveProfile}>
                <div className="st-field">
                  <div className="pf-label-row">
                    <label className="st-label" htmlFor="pf-headline">{t('Headline')}</label>
                    <small className="st-muted">{headline.length}/255</small>
                  </div>
                  <input id="pf-headline" dir="auto" className="form-input" type="text" maxLength={255} placeholder={t('e.g. Computer Systems Engineer interested in Applied AI & IoT')} value={headline} onChange={(e) => setHeadline(e.target.value)} />
                </div>
                <div className="st-field">
                  <label className="st-label" htmlFor="pf-about">{t('About')}</label>
                  <textarea id="pf-about" dir="auto" className="form-textarea" rows={5} value={about} onChange={(e) => setAbout(e.target.value)} />
                </div>
                <div className="pf-toggle">
                  <div>
                    <strong>{t('Make portfolio public')}</strong>
                    <small>{t('When on, others can view your featured projects.')}</small>
                  </div>
                  <button type="button" role="switch" aria-checked={isPublic} className={`pf-switch${isPublic ? ' is-on' : ''}`} onClick={() => setIsPublic((v) => !v)}><span /></button>
                </div>
                <div className="st-form__footer" style={{ borderTop: 'none', paddingTop: 0 }}>
                  <span className="st-muted" style={{ fontSize: 12.5 }}>{savedAt ? (ar ? 'تم الحفظ.' : 'Saved.') : ''}</span>
                  <button type="submit" className="btn btn-primary" disabled={saving}><Icon name="check" size={16} /> {t('Save Changes')}</button>
                </div>
              </form>
            </section>
          </div>

          <aside className="pf-edit__side">
            <section className="st-panel">
              <div className="pf-section-head" style={{ marginBottom: 4 }}>
                <h2>{t('All Published Projects')}</h2>
                <span className="pf-count">{featured.length}/{eligible.length}</span>
              </div>
              <p className="st-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>{t('Only published (approved) projects are eligible for the portfolio.')}</p>
              {eligible.length === 0 ? (
                <p className="st-muted" style={{ fontSize: 13 }}>
                  {t("You don't have any published projects yet.")}{' '}
                  <Link to="/student/projects" className="st-link">{t('View my projects')}</Link>
                </p>
              ) : (
                <ul className="pf-pick">
                  {eligible.map((p) => (
                    <li key={p.db_id} className={p.is_featured ? 'is-on' : ''}>
                      <span className="pf-pick__thumb">
                        {p.cover_image_path ? <img src={assetUrl(p.cover_image_path)} alt="" /> : <Icon name="projects" size={16} />}
                      </span>
                      <div className="pf-pick__text">
                        <strong dir="auto">{(ar ? p.title?.ar : p.title?.en) || p.title?.en || p.title?.ar}</strong>
                        <small>{p.is_featured ? (ar ? 'ظاهر في ملفك' : 'Shown on your page') : (ar ? 'غير مميز' : 'Not featured')}</small>
                      </div>
                      <button
                        type="button"
                        className={`pf-pick__btn${p.is_featured ? ' is-on' : ''}`}
                        onClick={() => toggleFeature(p.db_id)}
                        aria-pressed={!!p.is_featured}
                        title={p.is_featured ? t('Remove from Featured') : t('Add to Featured')}
                      >
                        <Icon name={p.is_featured ? 'star' : 'plus'} size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {tab === 'preview' && (
        <div className="pf-browser">
          <div className="pf-browser__bar">
            <span className="pf-browser__dots"><i /><i /><i /></span>
            <span className="pf-browser__url" dir="ltr"><Icon name={isPublic ? 'globe' : 'lock'} size={12} /> {shortUrl || (data.share_url ? String(data.share_url).replace(/^https?:\/\//, '') : 'uip.app/p/…')}</span>
          </div>
          <div className="pf-browser__view">
            {!isPublic && (
              <div className="st-alert" style={{ marginBottom: 16 }}><Icon name="eye-off" size={16} /><span>{ar ? 'الملف خاص حاليًا — لن يراه أحد غيرك.' : 'Your portfolio is currently private — only you can see this.'}</span></div>
            )}
            <ProfileHero data={data} user={user} name={name} headline={headlineSaved} about={aboutSaved} isPublic={isPublic} ar={ar} t={t} center />
            <h2 className="pf-preview-title">{t('Featured Projects')}</h2>
            {featured.length === 0
              ? <p className="st-muted" style={{ fontSize: 13, textAlign: 'center' }}>{t('No featured projects yet — pick from your published projects below.')}</p>
              : <div className="pf-grid">{featured.map((p) => <ProjectMiniCard key={p.id} p={p} locale={locale} t={t} />)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
