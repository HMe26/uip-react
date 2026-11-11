import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import Breadcrumb from '../../components/Breadcrumb';
import { useLanguage } from '../../context/LanguageContext';
import { isValidGithubRepoUrl, githubUrlError } from '../../utils/github';

/**
 * Mirrors app/Views/student/project-edit.php's basic-info form, talking to
 * PATCH /api/v1/projects/{id} (App\Controllers\Api\ProjectsApiController::
 * update() -> ProjectPublishingService::update(), same field set as
 * StudentProjectCreate.jsx's create form — repository_url/demo_url sync
 * to the project's primary github/live_demo links same as on create).
 * Links and team management live on the project details page's own tabs
 * (StudentProjectDetail.jsx) rather than duplicated here, since the JSON
 * API already exposes them as their own real-time endpoints there.
 */
export default function StudentProjectEdit() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const t = (en, ar) => (locale === 'ar' ? ar : en);

  const [meta, setMeta] = useState(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [summary, setSummary] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get(`/api/v1/projects/${id}`),
      api.get('/api/v1/projects/create-meta').catch(() => ({ data: null })),
      api.get(`/api/v1/projects/${id}/links`).catch(() => ({ data: [] })),
    ])
      .then(([p, m, l]) => {
        if (cancelled) return;
        const proj = p.data;
        setProject(proj);
        setMeta(m.data);
        setTitleEn(proj.title?.en || '');
        setTitleAr(proj.title?.ar || '');
        setCategoryId(proj.category_id != null ? String(proj.category_id) : '');
        setSummary(proj.description || proj.summary?.en || proj.summary?.ar || '');
        setSupervisorName(proj.supervisor_name || '');
        setTags(proj.technologies?.length ? proj.technologies : (proj.tags || []));
        const gh = (l.data || []).find((row) => row.type === 'github');
        const demo = (l.data || []).find((row) => row.type === 'live_demo');
        if (gh) setRepositoryUrl(gh.url);
        if (demo) setDemoUrl(demo.url);
      })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const addTag = (raw) => {
    const v = raw.trim();
    if (v && !tags.includes(v)) setTags((prev) => [...prev, v]);
    setTagInput('');
  };
  const removeTag = (v) => setTags((prev) => prev.filter((x) => x !== v));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaveError(null);

    if (!titleEn.trim() || !titleAr.trim() || !summary.trim()) {
      setSaveError(t('Title (English), title (Arabic), and summary are required.', 'العنوان بالإنجليزية والعربية وملخص المشروع حقول مطلوبة.'));
      return;
    }

    if (repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl)) {
      setSaveError(githubUrlError(locale));
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/api/v1/projects/${id}`, {
        title_en: titleEn.trim(),
        title_ar: titleAr.trim(),
        summary: summary.trim(),
        category_id: categoryId || undefined,
        repository_url: repositoryUrl.trim() || undefined,
        demo_url: demoUrl.trim() || undefined,
        supervisor_name: supervisorName.trim() || undefined,
        tags: tags.join(','),
      });
      navigate(`/student/projects/${id}`, {
        replace: true,
        state: { flash: { type: 'success', message: t('Project updated successfully.', 'تم تحديث المشروع بنجاح.') } },
      });
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…', 'جارِ التحميل…')}</p>;
  if (loadError) return <p style={{ color: 'var(--color-danger)', padding: 'var(--space-5)' }}>{loadError}</p>;

  const title = project?.title?.[locale] || project?.title?.en || '';
  const categories = meta?.categories || [];

  return (
    <>
      <Breadcrumb
        locale={locale}
        items={[
          { en: 'Dashboard', ar: 'لوحة التحكم', url: '/student/dashboard' },
          { en: 'My Projects', ar: 'مشاريعي', url: '/student/projects' },
          { en: title, ar: title, url: `/student/projects/${id}` },
          { en: 'Edit', ar: 'تعديل' },
        ]}
      />

      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Edit Project', 'تعديل المشروع')}</h1>
          <p className="text-small">{t('Changes are saved directly to the database.', 'التعديلات تُحفظ مباشرة في قاعدة البيانات.')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxWidth: 720 }}>
        <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Project Information', 'معلومات المشروع')}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="form-label">{t('Project Title (English)', 'عنوان المشروع (بالإنجليزية)')}</label>
            <input className="form-input" type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Project Title (Arabic)', 'عنوان المشروع (بالعربية)')}</label>
            <input className="form-input" type="text" dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} required />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('Category', 'التصنيف')}</label>
          <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('— Select —', '— اختر —')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name?.[locale] || c.name?.en}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">{t('Project Summary', 'ملخص المشروع')}</label>
          <textarea className="form-textarea" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} required />
        </div>

        <div className="form-group">
          <label className="form-label">{t('Academic Supervisor', 'المشرف الأكاديمي')}</label>
          <input className="form-input" type="text" list="supervisor-suggestions" value={supervisorName} onChange={(e) => setSupervisorName(e.target.value)} />
          <datalist id="supervisor-suggestions">
            {(meta?.supervisor_suggestions || []).map((name) => <option key={name} value={name} />)}
          </datalist>
        </div>

        <div className="form-group">
          <label className="form-label">{t('Tech Stack', 'التقنيات المستخدمة')}</label>
          <div className="tag-input">
            {tags.map((tag) => (
              <span key={tag} className="badge badge-primary" style={{ cursor: 'pointer' }} title={t('Click to remove', 'اضغط للحذف')} onClick={() => removeTag(tag)}>{tag}</span>
            ))}
            <input
              type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                else if (e.key === 'Backspace' && tagInput === '' && tags.length) removeTag(tags[tags.length - 1]);
              }}
              list="tag-suggestions"
              placeholder={t('Add a technology and press Enter', 'أضف تقنية واضغط Enter')}
            />
          </div>
          <datalist id="tag-suggestions">
            {(meta?.tag_suggestions || []).map((tag) => <option key={tag} value={tag} />)}
          </datalist>
        </div>

        <div className="form-group">
          <label className="form-label">{t('GitHub Repository URL (optional)', 'رابط مستودع GitHub (اختياري)')}</label>
          <input className={`form-input${repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl) ? ' is-invalid' : ''}`} type="url" value={repositoryUrl} onChange={(e) => setRepositoryUrl(e.target.value)} placeholder="https://github.com/username/project" aria-invalid={!!repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl)} />
          {repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl) && <p className="text-caption" style={{ color: 'var(--color-danger)', marginTop: 4 }}>{githubUrlError(locale)}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">{t('Demo URL (optional)', 'رابط الديمو (اختياري)')}</label>
          <input className="form-input" type="url" value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} placeholder="https://your-demo.example.com" />
        </div>

        <div className="glass-panel" style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
          <Icon name="link" size={20} />
          <p className="text-small" style={{ margin: 0 }}>
            {t('Additional links, files, and team members are managed from the ', 'الروابط الإضافية والملفات وأعضاء الفريق تُدار من ')}
            <Link to={`/student/projects/${id}`}>{t("project's details page", 'صفحة تفاصيل المشروع')}</Link>.
          </p>
        </div>

        {saveError && <p className="text-small" style={{ color: 'var(--color-danger)' }}>{saveError}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
          <Link to={`/student/projects/${id}`} className="btn btn-outline">{t('Cancel', 'إلغاء')}</Link>
          <button type="submit" className="btn btn-primary" disabled={saving}><Icon name="check" size={18} /> {saving ? t('Saving…', 'جارِ الحفظ…') : t('Save Changes', 'حفظ التغييرات')}</button>
        </div>
      </form>
    </>
  );
}
