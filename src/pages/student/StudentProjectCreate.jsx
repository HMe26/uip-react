import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useBackLayer } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { isValidGithubRepoUrl, githubUrlError } from '../../utils/github';
import { usePageMeta } from '../../context/PageMetaContext';
import { Stepper, StModal, Skeleton } from '../../components/student/stUi';

const LINK_TYPE_LABELS = {
  gitlab: { en: 'GitLab', ar: 'GitLab' },
  website: { en: 'Website', ar: 'موقع إلكتروني' },
  mobile_app: { en: 'Mobile App', ar: 'تطبيق جوال' },
  documentation: { en: 'Documentation', ar: 'توثيق' },
  video_demo: { en: 'Video Demo (explains the project)', ar: 'فيديو يشرح المشروع' },
  presentation: { en: 'Presentation', ar: 'عرض تقديمي' },
  research_paper: { en: 'Research Paper', ar: 'ورقة بحثية' },
  other: { en: 'Other', ar: 'أخرى' },
};

const TEAM_ROLE_LABELS = {
  student_member: { en: 'Student Team Member', ar: 'عضو فريق (طالب)' },
  teaching_assistant: { en: 'Teaching Assistant', ar: 'معيد' },
  principal_investigator: { en: 'Principal Investigator', ar: 'الباحث الرئيسي' },
  professor: { en: 'Professor', ar: 'أستاذ دكتور' },
  external_collaborator: { en: 'External Collaborator', ar: 'متعاون خارجي' },
  collaborator: { en: 'Collaborator', ar: 'متعاون' },
};

// Module-level on purpose: defining this inside the page component would give
// it a new identity every render and remount (blur) the inputs on each keystroke.
function Field({ label, hint, children, wide }) {
  return (
    <div className={`st-field${wide ? ' is-wide' : ''}`}>
      <label className="st-label">{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

let linkRowSeq = 0;
let teamRowSeq = 0;
const newLinkRow = () => ({ _key: ++linkRowSeq, type: 'gitlab', url: '', label: '' });
const newTeamRow = () => ({ _key: ++teamRowSeq, name: '', role: 'student_member', academic_year: '', student_number: '' });

/**
 * Mirrors app/Views/student/project-create.php, talking to the real JSON
 * API (App\Controllers\Api\ProjectsApiController):
 *   - GET  /api/v1/projects/create-meta  (categories, affiliation, supervisor/tag suggestions)
 *   - POST /api/v1/projects              (the project itself — same fields as the PHP form)
 *   - POST /api/v1/projects/{id}/links   (repeatable "Additional Links" rows)
 *   - POST /api/v1/projects/{id}/team/manual  (TA field + repeatable "Team Members" rows)
 * Each link/team row is attached independently after the project is
 * created — same "one bad row doesn't lose the rest" behavior as
 * StudentProjectController::attachExtrasFromCreateForm(), with failures
 * surfaced as non-blocking warnings rather than lost silently. On success
 * this redirects to the new project's details page (StudentProjectDetail.jsx),
 * same as the PHP create flow.
 */
export default function StudentProjectCreate() {
  const { locale } = useLanguage();
  const navigate = useNavigate();
  const ar = locale === 'ar';
  usePageMeta(ar ? 'إنشاء مشروع' : 'Create Project', ar ? 'قدّم مشروع تخرج جديد للمراجعة.' : 'Submit a new graduation project for review.');
  const [step, setStep] = useState(0);
  // Back goes to the previous step of the form instead of leaving it.
  useBackLayer(step > 0, () => setStep((n) => Math.max(0, n - 1)));
  const [files, setFiles] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInput = useRef(null);

  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [taName, setTaName] = useState('');
  const [summary, setSummary] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [links, setLinks] = useState([]);
  const [team, setTeam] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/projects/create-meta')
      .then((json) => { if (!cancelled) setMeta(json.data); })
      .catch((err) => { if (!cancelled) setMetaError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const addTag = (raw) => {
    const v = raw.trim();
    if (v && !tags.includes(v)) setTags((t) => [...t, v]);
    setTagInput('');
  };
  const removeTag = (v) => setTags((t) => t.filter((x) => x !== v));

  const addLinkRow = () => setLinks((rows) => [...rows, newLinkRow()]);
  const updateLinkRow = (key, patch) => setLinks((rows) => rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const removeLinkRow = (key) => setLinks((rows) => rows.filter((r) => r._key !== key));

  const addTeamRow = () => setTeam((rows) => [...rows, newTeamRow()]);
  const updateTeamRow = (key, patch) => setTeam((rows) => rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const removeTeamRow = (key) => setTeam((rows) => rows.filter((r) => r._key !== key));

  const submit = async (status) => {
    setSubmitError(null);

    if (!titleEn.trim() || !titleAr.trim() || !summary.trim()) {
      setSubmitError(locale === 'ar'
        ? 'العنوان بالإنجليزية والعربية وملخص المشروع حقول مطلوبة.'
        : 'Title (English), title (Arabic), and summary are required.');
      return;
    }

    if (repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl)) {
      setSubmitError(githubUrlError(locale));
      return;
    }
    if (links.some((row) => row.type === 'github' && row.url.trim() && !isValidGithubRepoUrl(row.url))) {
      setSubmitError(githubUrlError(locale));
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post('/api/v1/projects', {
        title_en: titleEn.trim(),
        title_ar: titleAr.trim(),
        summary: summary.trim(),
        category_id: categoryId || undefined,
        repository_url: repositoryUrl.trim() || undefined,
        demo_url: demoUrl.trim() || undefined,
        supervisor_name: supervisorName.trim() || undefined,
        tags: tags.join(','),
        status: 'draft', // التقديم بيتم بعد رفع الملفات عبر /submit (قايمة التحقق)
      });
      const projectId = created.data.id;

      const warnings = [];

      if (taName.trim()) {
        try {
          await api.post(`/api/v1/projects/${projectId}/team/manual`, {
            name: taName.trim(),
            role: 'teaching_assistant',
            locale,
          });
        } catch (err) {
          warnings.push(errorMessage(err));
        }
      }

      for (const row of links) {
        if (!row.url.trim()) continue;
        try {
          await api.post(`/api/v1/projects/${projectId}/links`, {
            type: row.type,
            url: row.url.trim(),
            label: row.label.trim() || undefined,
          });
        } catch (err) {
          warnings.push(errorMessage(err));
        }
      }

      for (const row of team) {
        if (!row.name.trim()) continue;
        try {
          await api.post(`/api/v1/projects/${projectId}/team/manual`, {
            name: row.name.trim(),
            role: row.role,
            academic_year: row.academic_year || undefined,
            student_number: row.student_number.trim() || undefined,
            locale,
          });
        } catch (err) {
          warnings.push(errorMessage(err));
        }
      }

      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append('file', file);
          await api.postForm(`/api/v1/projects/${projectId}/files`, fd);
        } catch (err) {
          warnings.push(`${file.name}: ${errorMessage(err)}`);
        }
      }

      let successMsg = locale === 'ar' ? 'تم حفظ المشروع كمسودة.' : 'Project saved as draft.';
      if (status === 'submitted') {
        try {
          await api.post(`/api/v1/projects/${projectId}/submit`);
          successMsg = locale === 'ar' ? 'تم إرسال المشروع للاعتماد.' : 'Project submitted for approval.';
        } catch (err) {
          warnings.push(`${locale === 'ar' ? 'لم يتم التقديم بعد، أكمل التالي ثم قدّم من صفحة المشروع:' : 'Not submitted yet — finish the items below, then submit from the project page:'} ${errorMessage(err).replace(/\n/g, ' - ')}`);
        }
      }

      navigate(`/student/projects/${projectId}`, {
        replace: true,
        state: { flash: warnings.length ? { type: 'warning', message: `${successMsg} ${warnings.join(' ')}` } : { type: 'success', message: successMsg } },
      });
    } catch (err) {
      setSubmitError(errorMessage(err));
      setSubmitting(false);
    }
  };

  if (loading) return <div className="st-page st-page--narrow"><Skeleton h={120} count={2} /></div>;
  if (metaError) return <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{metaError}</span></div>;

  const affiliation = meta?.affiliation || { has_university: false, university: null, faculty: null, department: null };
  const steps = [
    { label: ar ? 'معلومات أساسية' : 'Basic Information' },
    { label: ar ? 'التفاصيل التقنية' : 'Technical Details' },
    { label: ar ? 'الملفات' : 'Files' },
    { label: ar ? 'المراجعة والإرسال' : 'Review & Submit' },
  ];
  const categoryName = (meta?.categories || []).find((c) => String(c.id) === String(categoryId));
  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  const next = () => {
    setSubmitError(null);
    if (step === 0 && (!titleEn.trim() || !titleAr.trim() || !summary.trim())) {
      setSubmitError(ar ? 'العنوان بالإنجليزية والعربية وملخص المشروع حقول مطلوبة.' : 'Title (English), title (Arabic), and summary are required.');
      return;
    }
    setStep((n) => Math.min(n + 1, steps.length - 1));
  };
  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (incoming.length) setFiles((cur) => [...cur, ...incoming]);
  };

  return (
    <div className="st-page st-page--narrow">
      {!affiliation.has_university && (
        <div className="st-alert st-alert--warning">
          <Icon name="alert-triangle" size={16} />
          <span>
            {ar ? 'حسابك غير مربوط بجامعة بعد، فلن يصل مشروعك لأي جامعة للاعتماد. ' : "Your account isn't linked to a university yet, so this project won't reach a university for approval. "}
            <Link to="/student/settings" className="st-link">{ar ? 'الملف الشخصي' : 'Go to profile'}</Link>
          </span>
        </div>
      )}

      <Stepper steps={steps} current={step} wizard />

      <section className="st-panel">
        <h2 style={{ marginBottom: 16 }}>{steps[step].label}</h2>

        {step === 0 && (
          <div className="st-form">
            <div className="st-form__grid">
              <Field label={ar ? 'عنوان المشروع (بالإنجليزية)' : 'Project Title (English)'}>
                <input className="form-input" type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder={ar ? 'مثال: نظام ري ذكي' : 'e.g. Smart Irrigation Controller'} />
              </Field>
              <Field label={ar ? 'عنوان المشروع (بالعربية)' : 'Project Title (Arabic)'}>
                <input className="form-input" type="text" dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} placeholder="مثال: نظام تحكم ري ذكي" />
              </Field>
              <Field label={ar ? 'التصنيف' : 'Category'}>
                <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">{ar ? '— اختر —' : '— Select —'}</option>
                  {(meta?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name[locale] || c.name.en}</option>)}
                </select>
              </Field>
              <Field
                label={ar ? 'المشرف الأكاديمي' : 'Academic Supervisor'}
                hint={!meta?.supervisor_suggestions?.length
                  ? (ar ? 'اكتب الاسم — أول مشرف تكتبه يظهر كاقتراح للطلاب الآخرين في جامعتك.' : 'Type the name — the first one you enter becomes a suggestion for other students at your university.')
                  : (ar ? 'اكتب اسم مشرفك، أو اختر من الأسماء المستخدمة في جامعتك.' : "Type your supervisor's name, or pick one already used at your university.")}
              >
                <input className="form-input" type="text" list="supervisor-suggestions" value={supervisorName} onChange={(e) => setSupervisorName(e.target.value)} placeholder={ar ? 'اكتب اسم المشرف' : "Type your supervisor's name"} />
                <datalist id="supervisor-suggestions">{(meta?.supervisor_suggestions || []).map((name) => <option key={name} value={name} />)}</datalist>
              </Field>
              <Field wide label={ar ? 'المعيد (اختياري)' : 'Teaching Assistant (optional)'} hint={ar ? 'منفصل عن المشرف الأكاديمي — يُسجَّل كعضو فريق بدور «معيد».' : 'Separate from the academic supervisor — recorded as a team member with a "Teaching Assistant" role.'}>
                <input className="form-input" type="text" maxLength={190} value={taName} onChange={(e) => setTaName(e.target.value)} placeholder={ar ? 'اسم المعيد المتابع للمشروع' : 'The teaching assistant following up on this project'} />
              </Field>
              <Field wide label={ar ? 'ملخص المشروع' : 'Project Summary'} hint={ar ? 'سيُستخدم هذا النص في ملخص المشروع بالذكاء الاصطناعي.' : 'This text feeds the AI Project Summary service.'}>
                <textarea className="form-textarea" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={ar ? 'فقرة واحدة تصف المشكلة والحل…' : 'One paragraph describing the problem and your solution…'} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="st-form">
            <Field label={ar ? 'التقنيات المستخدمة' : 'Technology Stack'} hint={ar ? 'تُحفظ كوسوم قابلة للبحث تُستخدم في اكتشاف المشاريع.' : 'Saved as real searchable tags, used in project discovery.'}>
              <div className="tag-input">
                {tags.map((t) => (
                  <span key={t} className="st-tag" style={{ cursor: 'pointer' }} title={ar ? 'اضغط للحذف' : 'Click to remove'} onClick={() => removeTag(t)}>{t} ×</span>
                ))}
                <input
                  type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} list="tag-suggestions"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                    else if (e.key === 'Backspace' && tagInput === '' && tags.length) removeTag(tags[tags.length - 1]);
                  }}
                  placeholder={ar ? 'أضف تقنية واضغط Enter' : 'Add a technology and press Enter'}
                />
              </div>
              <datalist id="tag-suggestions">{(meta?.tag_suggestions || []).map((tag) => <option key={tag} value={tag} />)}</datalist>
            </Field>
            <div className="st-form__grid">
              <Field label={ar ? 'رابط مستودع GitHub (اختياري)' : 'GitHub Repository URL'} hint={ar ? 'اربطه الآن وشغّل مراجعة الكود لاحقًا من صفحة المشروع.' : 'Link it now, then run the AI code review any time from the project page.'}>
                <input className={`form-input${repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl) ? ' is-invalid' : ''}`} type="url" value={repositoryUrl} onChange={(e) => setRepositoryUrl(e.target.value)} placeholder="https://github.com/username/project" aria-invalid={!!repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl)} />
                {repositoryUrl.trim() && !isValidGithubRepoUrl(repositoryUrl) && <p style={{ color: 'var(--color-danger)', fontSize: 12.5, margin: '6px 0 0' }}>{githubUrlError(locale)}</p>}
              </Field>
              <Field label={ar ? 'رابط الديمو (اختياري)' : 'Demo URL'} hint={ar ? 'نسخة شغّالة من المشروع تظهر للمراجع.' : 'A working version shown to your reviewer.'}>
                <input className="form-input" type="url" value={demoUrl} onChange={(e) => setDemoUrl(e.target.value)} placeholder="https://your-demo.example.com" />
              </Field>
            </div>

            <Field label={ar ? 'روابط إضافية (اختياري)' : 'Additional Links (optional)'} hint={ar ? 'فيديو، توثيق، عرض تقديمي، ورقة بحثية أو أي رابط خارجي.' : 'A video, documentation, a presentation, a research paper or any other external link.'}>
              <div className="st-stack" style={{ gap: 8 }}>
                {links.map((row) => (
                  <div key={row._key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select className="form-select" style={{ flex: '0 0 auto', width: 'auto' }} value={row.type} onChange={(e) => updateLinkRow(row._key, { type: e.target.value })}>
                      {Object.entries(LINK_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label[locale] || label.en}</option>)}
                    </select>
                    <input type="url" className="form-input" style={{ flex: '1 1 180px' }} placeholder="https://..." value={row.url} onChange={(e) => updateLinkRow(row._key, { url: e.target.value })} />
                    <input type="text" className="form-input" style={{ flex: '1 1 140px' }} placeholder={ar ? 'تسمية (اختياري)' : 'Label (optional)'} value={row.label} onChange={(e) => updateLinkRow(row._key, { label: e.target.value })} />
                    <button type="button" className="btn btn-outline btn-sm st-btn-danger" onClick={() => removeLinkRow(row._key)} aria-label={ar ? 'حذف' : 'Remove'}><Icon name="x" size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={addLinkRow}><Icon name="plus" size={14} /> {ar ? 'إضافة رابط' : 'Add a link'}</button>
            </Field>

            <Field label={ar ? 'أعضاء الفريق (اختياري)' : 'Team Members (optional)'} hint={ar ? 'يمكنك دعوة زميل لديه حساب بالبريد من صفحة المشروع بعد الإنشاء.' : "To invite a teammate who already has an account by email, use the project's page after it's created."}>
              <div className="st-stack" style={{ gap: 8 }}>
                {team.map((row) => (
                  <div key={row._key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input type="text" className="form-input" style={{ flex: '2 1 150px' }} placeholder={ar ? 'اسم العضو' : "Member's name"} value={row.name} onChange={(e) => updateTeamRow(row._key, { name: e.target.value })} />
                    <select className="form-select" style={{ flex: '1 1 150px', width: 'auto' }} value={row.role} onChange={(e) => updateTeamRow(row._key, { role: e.target.value })}>
                      {Object.entries(TEAM_ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label[locale] || label.en}</option>)}
                    </select>
                    <input type="number" min={1} max={10} className="form-input" style={{ flex: '0 0 84px' }} placeholder={ar ? 'السنة' : 'Year'} value={row.academic_year} onChange={(e) => updateTeamRow(row._key, { academic_year: e.target.value })} />
                    <input type="text" className="form-input" style={{ flex: '1 1 120px' }} placeholder={ar ? 'الرقم الجامعي' : 'Student ID'} value={row.student_number} onChange={(e) => updateTeamRow(row._key, { student_number: e.target.value })} />
                    <button type="button" className="btn btn-outline btn-sm st-btn-danger" onClick={() => removeTeamRow(row._key)} aria-label={ar ? 'حذف' : 'Remove'}><Icon name="x" size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={addTeamRow}><Icon name="plus" size={14} /> {ar ? 'إضافة عضو' : 'Add a member'}</button>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="st-form">
            <div
              className="st-dropzone" role="button" tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            >
              <Icon name="upload" size={22} />
              <span>{ar ? 'اضغط للرفع أو اسحب الملفات هنا' : 'Click to upload or drag and drop'}</span>
              <small>{ar ? 'تقرير، كود مصدري، عرض تقديمي، ملفات داعمة' : 'Report, source code, slides, supporting files'}</small>
            </div>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            {files.length > 0 && (
              <div className="st-stack" style={{ gap: 8 }}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="st-file-row">
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}><Icon name="file" size={16} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span> <small>{fmtSize(f.size)}</small></span>
                    <button type="button" className="st-link st-btn-danger" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={ar ? 'حذف' : 'Remove'}><Icon name="trash" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="st-muted" style={{ fontSize: 12.5 }}>{ar ? 'الملفات اختيارية، وتُرفع بعد إنشاء المشروع. يمكنك إضافة المزيد لاحقًا من تبويب «الملفات».' : 'Files are optional and upload right after the project is created. You can add more later from the project\'s Files tab.'}</p>
          </div>
        )}

        {step === 3 && (
          <div className="st-form">
            <div className="st-review-block">
              <h4>{ar ? 'المعلومات الأساسية' : 'Basic Information'}</h4>
              <div className="st-row"><span>{ar ? 'العنوان' : 'Title'}</span><span>{titleEn}</span></div>
              <div className="st-row"><span>{ar ? 'العنوان (عربي)' : 'Title (Arabic)'}</span><span dir="rtl">{titleAr}</span></div>
              <div className="st-row"><span>{ar ? 'التصنيف' : 'Category'}</span><span>{categoryName ? (categoryName.name[locale] || categoryName.name.en) : '—'}</span></div>
              <div className="st-row"><span>{ar ? 'المشرف' : 'Supervisor'}</span><span>{supervisorName || '—'}</span></div>
              {taName && <div className="st-row"><span>{ar ? 'المعيد' : 'Teaching Assistant'}</span><span>{taName}</span></div>}
            </div>
            <div className="st-review-block">
              <h4>{ar ? 'التفاصيل التقنية' : 'Technical Details'}</h4>
              <div className="st-row"><span>{ar ? 'التقنيات' : 'Stack'}</span><span>{tags.length ? tags.join(', ') : '—'}</span></div>
              <div className="st-row"><span>GitHub</span><span>{repositoryUrl || '—'}</span></div>
              {demoUrl && <div className="st-row"><span>{ar ? 'العرض التجريبي' : 'Demo'}</span><span>{demoUrl}</span></div>}
              <div className="st-row"><span>{ar ? 'روابط إضافية' : 'Extra links'}</span><span>{links.filter((l) => l.url.trim()).length}</span></div>
              <div className="st-row"><span>{ar ? 'أعضاء الفريق' : 'Team members'}</span><span>{team.filter((m) => m.name.trim()).length}</span></div>
            </div>
            <div className="st-review-block">
              <h4>{ar ? 'الملفات' : 'Files'}</h4>
              {files.length === 0 ? <div className="st-row"><span>—</span></div> : files.map((f, i) => <div key={i} className="st-row"><span>{f.name}</span><span>{fmtSize(f.size)}</span></div>)}
            </div>
            <div className="st-alert st-alert--warning"><Icon name="alert-triangle" size={16} /><span>{ar ? 'لن تستطيع تعديل المشروع بعد الإرسال إلا إذا طُلبت تعديلات.' : 'You will not be able to edit the project again unless changes are requested.'}</span></div>
          </div>
        )}

        {submitError && <p className="st-form__error" style={{ marginTop: 12 }}>{submitError}</p>}

        <div className="st-form__footer" style={{ marginTop: 20 }}>
          {step > 0
            ? <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => { setSubmitError(null); setStep(step - 1); }}>{ar ? 'رجوع' : 'Back'}</button>
            : <Link to="/student/projects" className="btn btn-outline">{ar ? 'إلغاء' : 'Cancel'}</Link>}
          <div>
            <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => submit('draft')}>{ar ? 'حفظ كمسودة' : 'Save Draft'}</button>
            {step < steps.length - 1
              ? <button type="button" className="btn btn-primary" onClick={next}>{ar ? 'التالي' : 'Next'}</button>
              : <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => setConfirmOpen(true)}>{ar ? 'إرسال للمراجعة' : 'Submit for Review'}</button>}
          </div>
        </div>
      </section>

      {confirmOpen && (
        <StModal
          title={ar ? 'إرسال المشروع' : 'Submit Project'}
          onClose={() => setConfirmOpen(false)}
          actions={(
            <>
              <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => { setConfirmOpen(false); submit('submitted'); }}>{ar ? 'إرسال المشروع' : 'Submit Project'}</button>
            </>
          )}
        >
          {ar ? 'هل أنت متأكد من إرسال هذا المشروع للمراجعة؟ لن تستطيع تعديله إلا إذا طُلبت تعديلات.' : 'Are you sure you want to submit this project for review? You will only be able to edit it if changes are requested.'}
        </StModal>
      )}
    </div>
  );
}
