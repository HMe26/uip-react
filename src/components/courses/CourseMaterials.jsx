import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../api/client';
import { safeHref } from '../../lib/safeUrl';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { Field, FormModal, FormSection } from '../people/formUi';

/**
 * Course content (محتوى المادة): lectures, videos, images, files, posts, results and exam announcements.
 * Backend: /api/v1/courses/{id}/materials (see CourseMaterialsApiController).
 *  - Students: browse, preview, download, save (bookmark) items.
 *  - Course managers (doctor / TA / faculty / university — decided by the API via `can_edit`): add, edit, pin,
 *    draft/publish and delete items.
 * Files need the Bearer token, so preview/download go through api.blob → object URL.
 */

export const KINDS = [
  { key: 'lecture', icon: 'file', ar: 'المحاضرات', en: 'Lectures', one_ar: 'محاضرة', one_en: 'Lecture' },
  { key: 'video', icon: 'play', ar: 'الفيديوهات', en: 'Videos', one_ar: 'فيديو', one_en: 'Video' },
  { key: 'image', icon: 'image', ar: 'الصور', en: 'Images', one_ar: 'صورة', one_en: 'Image' },
  { key: 'file', icon: 'paperclip', ar: 'الملفات', en: 'Files', one_ar: 'ملف', one_en: 'File' },
  { key: 'post', icon: 'megaphone', ar: 'المنشورات', en: 'Posts', one_ar: 'منشور', one_en: 'Post' },
  { key: 'result', icon: 'award', ar: 'النتائج', en: 'Results', one_ar: 'نتيجة', one_en: 'Result' },
  { key: 'exam', icon: 'calendar', ar: 'الامتحانات', en: 'Exams', one_ar: 'إعلان امتحان', one_en: 'Exam' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));

// Mirrors CourseMaterialService::ALLOWED (the server re-checks everything).
const ACCEPT = {
  lecture: '.pdf,.ppt,.pptx,.doc,.docx,.zip',
  video: '.mp4,.webm,.mov',
  image: '.jpg,.jpeg,.png,.gif,.webp',
  file: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.zip',
  result: '.pdf,.xls,.xlsx,.csv,.doc,.docx,.jpg,.jpeg,.png',
  post: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov',
  exam: '.pdf,.doc,.docx,.jpg,.jpeg,.png',
};
const MAX_MB = { video: 200, image: 200, post: 200 };
const maxMbFor = (kind) => MAX_MB[kind] || 50;

const kindLabel = (k, ar) => (KIND[k] ? (ar ? KIND[k].ar : KIND[k].en) : k);
const kindOne = (k, ar) => (KIND[k] ? (ar ? KIND[k].one_ar : KIND[k].one_en) : k);

function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso, ar, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  return d.toLocaleString(ar ? 'ar-EG' : undefined, opts);
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ROLE_AR = { university: 'الجامعة', faculty: 'الكلية', academic_staff: 'مدرّس المادة' };
const ROLE_EN = { university: 'University', faculty: 'Faculty', academic_staff: 'Teacher' };
const roleLabel = (r, ar) => (ar ? ROLE_AR[r] : ROLE_EN[r]) || '';

async function fetchFile(m, download) {
  const res = await api.blob(`/api/v1/courses/${m.course_id}/materials/${m.id}/file`, download ? { download: 1 } : undefined);
  return res.blob();
}

async function downloadMaterial(m) {
  const blob = await fetchFile(m, true);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = m.file_name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------------------------------------ */

export default function CourseMaterials({ courseId, saved = false, canManage = false }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null | { kind } | material
  const [preview, setPreview] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const j = saved
      ? await api.get('/api/v1/courses/materials/saved', { locale })
      : await api.get(`/api/v1/courses/${courseId}/materials`, { locale });
    setItems(j.data?.items || []);
    setCounts(j.data?.counts || {});
  }, [courseId, saved, locale]);

  useEffect(() => {
    setLoading(true);
    load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, [load]);

  const kindCounts = useMemo(() => {
    if (saved) {
      const c = {};
      items.forEach((m) => { c[m.kind] = (c[m.kind] || 0) + 1; });
      return c;
    }
    return counts;
  }, [saved, items, counts]);
  const total = useMemo(() => Object.values(kindCounts).reduce((a, b) => a + b, 0), [kindCounts]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((m) => kind === 'all' || m.kind === kind)
      .filter((m) => !needle || `${m.title} ${m.body || ''} ${m.file_name || ''} ${m.author_name || ''}`.toLowerCase().includes(needle));
  }, [items, kind, q]);

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 3500); };

  async function toggleSave(m) {
    setBusyId(m.id);
    setError(null);
    try {
      if (m.saved) await api.delete(`/api/v1/courses/${m.course_id}/materials/${m.id}/save`);
      else await api.put(`/api/v1/courses/${m.course_id}/materials/${m.id}/save`, { locale });
      if (saved && m.saved) setItems((a) => a.filter((x) => x.id !== m.id));
      else setItems((a) => a.map((x) => (x.id === m.id ? { ...x, saved: !m.saved } : x)));
    } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }

  async function download(m) {
    setBusyId(m.id);
    setError(null);
    try { await downloadMaterial(m); } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }

  async function remove(m) {
    if (!window.confirm(ar ? `حذف «${m.title}» نهائيًا؟` : `Delete “${m.title}” permanently?`)) return;
    setBusyId(m.id);
    setError(null);
    try {
      const j = await api.delete(`/api/v1/courses/${m.course_id}/materials/${m.id}`, { locale });
      setItems((a) => a.filter((x) => x.id !== m.id));
      setCounts((c) => ({ ...c, [m.kind]: Math.max(0, (c[m.kind] || 1) - 1) }));
      flash(j?.message || (ar ? 'تم الحذف.' : 'Deleted.'));
    } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }

  async function togglePin(m) {
    setBusyId(m.id);
    setError(null);
    try {
      await api.patch(`/api/v1/courses/${m.course_id}/materials/${m.id}`, { is_pinned: !m.is_pinned, locale });
      await load();
    } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }

  const tabs = [{ key: 'all', label: ar ? 'الكل' : 'All', n: total }, ...KINDS.map((k) => ({ key: k.key, label: ar ? k.ar : k.en, n: kindCounts[k.key] || 0, icon: k.icon }))];

  return (
    <div className="cm">
      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert st-alert--success"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}

      <div className="cm-bar">
        <div className="ex-search">
          <Icon name="search" size={15} />
          <input className="ex-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'ابحث في المحتوى' : 'Search content'} aria-label={ar ? 'بحث' : 'Search'} />
        </div>
        {canManage && !saved && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm({ kind: kind !== 'all' ? kind : 'lecture' })}>
            <Icon name="plus" size={14} /> {ar ? 'إضافة محتوى' : 'Add content'}
          </button>
        )}
      </div>

      <div className="cm-kinds" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={kind === t.key} className={`cm-kind${kind === t.key ? ' is-active' : ''}`} onClick={() => setKind(t.key)}>
            {t.icon && <Icon name={t.icon} size={14} />}
            <span>{t.label}</span>
            <small>{t.n}</small>
          </button>
        ))}
      </div>

      {loading ? <Skeleton h={84} count={3} /> : shown.length === 0 ? (
        <EmptyState
          icon={saved ? 'bookmark' : 'folder'}
          title={saved ? (ar ? 'لا توجد عناصر محفوظة' : 'Nothing saved yet') : (q || kind !== 'all' ? (ar ? 'لا يوجد محتوى مطابق' : 'No matching content') : (ar ? 'لا يوجد محتوى بعد' : 'No content yet'))}
          text={saved ? (ar ? 'اضغط «حفظ» على أي محاضرة أو ملف ليظهر هنا.' : 'Press “Save” on any lecture or file and it will show here.') : (canManage ? (ar ? 'ابدأ بإضافة محاضرة أو منشور للطلاب.' : 'Start by adding a lecture or a post for your students.') : (ar ? 'سيظهر هنا ما ينشره الدكتور والمعيد.' : 'What your doctor and TAs publish will appear here.'))}
        />
      ) : (
        <ul className="cm-list">
          {shown.map((m) => (
            <MaterialCard
              key={m.id}
              m={m}
              ar={ar}
              busy={busyId === m.id}
              showCourse={saved}
              onPreview={() => setPreview(m)}
              onDownload={() => download(m)}
              onSave={() => toggleSave(m)}
              onEdit={() => setForm(m)}
              onDelete={() => remove(m)}
              onPin={() => togglePin(m)}
            />
          ))}
        </ul>
      )}

      {form && createPortal(
        <MaterialForm
          courseId={courseId}
          material={form.id ? form : null}
          initialKind={form.kind}
          onClose={() => setForm(null)}
          onDone={(msg) => { setForm(null); flash(msg); load().catch((e) => setError(errorMessage(e))); }}
        />, document.body)}
      {preview && createPortal(<PreviewModal m={preview} onClose={() => setPreview(null)} onDownload={() => download(preview)} />, document.body)}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function MaterialCard({ m, ar, busy, showCourse, onPreview, onDownload, onSave, onEdit, onDelete, onPin }) {
  const meta = KIND[m.kind] || KIND.file;
  const canPreview = m.preview_type !== 'none' || !!m.embed_url;
  const isStudentView = !m.can_edit;
  return (
    <li className={`cm-item cm-item--${m.kind}${m.is_pinned ? ' is-pinned' : ''}${m.status === 'draft' ? ' is-draft' : ''}`}>
      <span className="cm-item__icon"><Icon name={meta.icon} size={20} /></span>
      <div className="cm-item__main">
        <div className="cm-item__top">
          <span className="ex-chip">{kindOne(m.kind, ar)}</span>
          {m.is_pinned && <span className="cm-badge cm-badge--pin"><Icon name="pin" size={12} /> {ar ? 'مثبّت' : 'Pinned'}</span>}
          {m.status === 'draft' && <span className="cm-badge cm-badge--draft">{ar ? 'مسودة (غير ظاهر للطلاب)' : 'Draft (hidden from students)'}</span>}
          {showCourse && m.course_code && <span className="cm-badge">{m.course_code}{m.course_name ? ` — ${m.course_name}` : ''}</span>}
        </div>
        <h4 className="cm-item__title">{m.title}</h4>
        {m.kind === 'exam' && (
          <p className="cm-exam">
            <span><Icon name="calendar" size={14} /> {fmtDate(m.exam_at, ar, true)}</span>
            {m.exam_location && <span><Icon name="map-pin" size={14} /> {m.exam_location}</span>}
            {m.exam_duration_min != null && <span><Icon name="clock" size={14} /> {m.exam_duration_min} {ar ? 'دقيقة' : 'min'}</span>}
          </p>
        )}
        {m.body && <p className="cm-item__body">{m.body}</p>}
        {m.has_file && <p className="cm-item__file"><Icon name="paperclip" size={13} /> <bdi>{m.file_name}</bdi>{m.file_size != null && <small> · {fmtSize(m.file_size)}</small>}</p>}
        {m.external_url && !m.embed_url && <p className="cm-item__file"><Icon name="link" size={13} /> <a href={safeHref(m.external_url)} target="_blank" rel="noopener noreferrer"><bdi>{m.external_url}</bdi></a></p>}
        <p className="cm-item__meta">
          {[m.author_name ? `${m.author_name}${m.author_role ? ` (${roleLabel(m.author_role, ar)})` : ''}` : null, fmtDate(m.created_at, ar)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="cm-item__actions">
        {canPreview && <button type="button" className="btn btn-outline btn-sm" onClick={onPreview} disabled={busy}><Icon name="eye" size={14} /> {ar ? 'معاينة' : 'Preview'}</button>}
        {m.external_url && !m.embed_url && !m.has_file && (
          <a className="btn btn-outline btn-sm" href={safeHref(m.external_url)} target="_blank" rel="noopener noreferrer"><Icon name="external-link" size={14} /> {ar ? 'فتح الرابط' : 'Open link'}</a>
        )}
        {m.has_file && <button type="button" className="btn btn-outline btn-sm" onClick={onDownload} disabled={busy}><Icon name="download" size={14} /> {ar ? 'تحميل' : 'Download'}</button>}
        {isStudentView && (
          <button type="button" className={`btn btn-sm ${m.saved ? 'btn-primary' : 'btn-ghost'}`} onClick={onSave} disabled={busy} aria-pressed={!!m.saved}>
            <Icon name="bookmark" size={14} /> {m.saved ? (ar ? 'محفوظ' : 'Saved') : (ar ? 'حفظ' : 'Save')}
          </button>
        )}
        {m.can_edit && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} disabled={busy}><Icon name="edit" size={14} /> {ar ? 'تعديل' : 'Edit'}</button>
            <button type="button" className="ex-icon-btn" onClick={onPin} disabled={busy} title={m.is_pinned ? (ar ? 'إلغاء التثبيت' : 'Unpin') : (ar ? 'تثبيت' : 'Pin')} aria-label={ar ? 'تثبيت' : 'Pin'}><Icon name="pin" size={15} /></button>
            <button type="button" className="ex-icon-btn ex-icon-btn--danger" onClick={onDelete} disabled={busy} title={ar ? 'حذف' : 'Delete'} aria-label={ar ? 'حذف' : 'Delete'}><Icon name="trash" size={15} /></button>
          </>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------------------------ */

function PreviewModal({ m, onClose, onDownload }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(m.has_file && m.preview_type !== 'none');

  useEffect(() => {
    if (!m.has_file || m.preview_type === 'none') return undefined;
    let revoked = false;
    let objectUrl = null;
    (async () => {
      try {
        const blob = await fetchFile(m, false);
        if (m.preview_type === 'text') {
          if (!revoked) setText(await blob.text());
        } else {
          objectUrl = URL.createObjectURL(blob);
          if (!revoked) setUrl(objectUrl);
        }
      } catch (e) {
        if (!revoked) setError(errorMessage(e));
      } finally {
        if (!revoked) setLoading(false);
      }
    })();
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [m]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cm-preview" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={m.title}>
        <header className="cm-preview__head">
          <strong>{m.title}</strong>
          <div className="cm-preview__acts">
            {m.has_file && <button type="button" className="btn btn-outline btn-sm" onClick={onDownload}><Icon name="download" size={14} /> {ar ? 'تحميل' : 'Download'}</button>}
            <button type="button" className="pf-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="x" size={18} /></button>
          </div>
        </header>
        <div className="cm-preview__body">
          {loading && <Skeleton h={260} count={1} />}
          {error && <div className="pf-error" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
          {!loading && !error && m.embed_url && (
            <div className="cm-embed"><iframe src={m.embed_url} title={m.title} allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
          )}
          {!loading && !error && url && m.preview_type === 'pdf' && <iframe className="cm-frame" src={url} title={m.title} />}
          {!loading && !error && url && m.preview_type === 'image' && <img className="cm-img" src={url} alt={m.title} />}
          {!loading && !error && url && m.preview_type === 'video' && <video className="cm-video" src={url} controls playsInline />}
          {!loading && !error && text != null && <pre className="cm-text">{text}</pre>}
          {m.body && <p className="cm-preview__text">{m.body}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function MaterialForm({ courseId, material, initialKind, onClose, onDone }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const editing = !!material;
  const [kind, setKind] = useState(material?.kind || initialKind || 'lecture');
  const [title, setTitle] = useState(material?.title || '');
  const [body, setBody] = useState(material?.body || '');
  const [url, setUrl] = useState(material?.external_url || '');
  const [file, setFile] = useState(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [examAt, setExamAt] = useState(toLocalInput(material?.exam_at));
  const [place, setPlace] = useState(material?.exam_location || '');
  const [minutes, setMinutes] = useState(material?.exam_duration_min ?? '');
  const [pinned, setPinned] = useState(!!material?.is_pinned);
  const [draft, setDraft] = useState(material?.status === 'draft');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const hasExistingFile = editing && material.has_file && !removeFile;

  function pick(e) {
    const f = e.target.files?.[0] || null;
    if (f && f.size > maxMbFor(kind) * 1024 * 1024) {
      setError(ar ? `حجم الملف أكبر من ${maxMbFor(kind)} ميجابايت.` : `The file is larger than ${maxMbFor(kind)} MB.`);
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(f);
  }

  function clientCheck() {
    if (!title.trim()) return ar ? 'اكتب عنوانًا.' : 'Enter a title.';
    const hasFile = !!file || hasExistingFile;
    const hasUrl = url.trim() !== '';
    const hasBody = body.trim() !== '';
    if (url.trim() && !/^https?:\/\/\S+$/i.test(url.trim())) return ar ? 'الرابط لازم يبدأ بـ http:// أو https://' : 'The link must start with http:// or https://';
    if (kind === 'image' && !hasFile) return ar ? 'ارفع صورة.' : 'Upload an image.';
    if ((kind === 'lecture' || kind === 'file' || kind === 'video') && !hasFile && !hasUrl) return ar ? 'ارفع ملفًا أو ضع رابطًا.' : 'Upload a file or add a link.';
    if (kind === 'post' && !hasBody && !hasFile) return ar ? 'اكتب نص المنشور أو أرفق ملفًا.' : 'Write the post text or attach a file.';
    if (kind === 'result' && !hasBody && !hasFile && !hasUrl) return ar ? 'ارفع ملف النتيجة أو اكتبها.' : 'Upload the results file or type them.';
    if (kind === 'exam' && !examAt) return ar ? 'حدّد موعد الامتحان.' : 'Set the exam date and time.';
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    const bad = clientCheck();
    if (bad) { setError(bad); return; }
    setSaving(true);
    setError(null);
    setProgress(file ? 0 : null);
    try {
      const fd = new FormData();
      fd.append('locale', locale);
      if (!editing) fd.append('kind', kind);
      fd.append('title', title.trim());
      fd.append('body', body.trim());
      fd.append('external_url', url.trim());
      fd.append('is_pinned', pinned ? '1' : '0');
      fd.append('status', draft ? 'draft' : 'published');
      if (kind === 'exam') {
        fd.append('exam_at', examAt ? new Date(examAt).toISOString() : '');
        fd.append('exam_location', place.trim());
        fd.append('exam_duration_min', minutes === '' ? '' : String(minutes));
      }
      if (file) fd.append('file', file);
      else if (removeFile) fd.append('remove_file', '1');

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const path = editing ? `/api/v1/courses/${courseId}/materials/${material.id}` : `/api/v1/courses/${courseId}/materials`;
      const json = file
        ? await api.postFormProgress(path, fd, setProgress, ctrl.signal)
        : await api.postForm(path, fd);
      onDone(json?.message || (ar ? 'تم الحفظ.' : 'Saved.'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      abortRef.current = null;
      setSaving(false);
      setProgress(null);
    }
  }

  function close() {
    if (abortRef.current) abortRef.current.abort();
    onClose();
  }

  const label = ar ? 'عنوان' : 'Title';

  return (
    <FormModal
      title={editing ? (ar ? 'تعديل المحتوى' : 'Edit content') : (ar ? 'إضافة محتوى للمادة' : 'Add course content')}
      subtitle={kindLabel(kind, ar)}
      icon={KIND[kind]?.icon || 'file'}
      onClose={close}
      onSubmit={submit}
      saving={saving}
      submitLabel={editing ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'نشر' : 'Publish')}
      error={error}
    >
      <FormSection title={ar ? 'النوع والعنوان' : 'Type & title'}>
        <Field label={ar ? 'نوع المحتوى' : 'Content type'} hint={editing ? (ar ? 'لا يمكن تغيير النوع بعد الإضافة.' : 'The type cannot be changed after creation.') : undefined}>
          <select className="form-input" value={kind} disabled={editing} onChange={(e) => { setKind(e.target.value); setFile(null); }}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{ar ? k.one_ar : k.one_en}</option>)}
          </select>
        </Field>
        <Field label={label} required wide>
          <input className="form-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'exam' ? (ar ? 'مثال: امتحان منتصف الفصل' : 'e.g. Midterm exam') : (ar ? 'مثال: المحاضرة 3 — الدوال' : 'e.g. Lecture 3 — Functions')} />
        </Field>
      </FormSection>

      <FormSection title={ar ? 'المحتوى' : 'Content'}>
        {kind === 'exam' && (
          <>
            <Field label={ar ? 'موعد الامتحان' : 'Exam date & time'} required>
              <input className="form-input" type="datetime-local" value={examAt} onChange={(e) => setExamAt(e.target.value)} />
            </Field>
            <Field label={ar ? 'المكان / القاعة' : 'Location / hall'}>
              <input className="form-input" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} />
            </Field>
            <Field label={ar ? 'المدة (بالدقائق)' : 'Duration (minutes)'}>
              <input className="form-input" type="number" min="1" max="1440" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </>
        )}
        <Field label={kind === 'post' || kind === 'exam' || kind === 'result' ? (ar ? 'النص / التفاصيل' : 'Text / details') : (ar ? 'وصف (اختياري)' : 'Description (optional)')} wide>
          <textarea className="form-input" rows={kind === 'post' ? 6 : 3} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
        </Field>

        {kind !== 'post' && kind !== 'exam' && kind !== 'image' && (
          <Field label={kind === 'video' ? (ar ? 'رابط الفيديو (YouTube / Drive …)' : 'Video link (YouTube / Drive …)') : (ar ? 'رابط خارجي (اختياري)' : 'External link (optional)')} wide>
            <input className="form-input" type="url" dir="ltr" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
        )}

        <Field
          label={ar ? 'الملف' : 'File'}
          wide
          hint={`${ACCEPT[kind].replace(/\./g, '').split(',').join(', ')} — ${ar ? 'حتى' : 'up to'} ${maxMbFor(kind)} MB`}
        >
          {hasExistingFile && !file && (
            <div className="cm-current">
              <Icon name="paperclip" size={14} /> <bdi>{material.file_name}</bdi>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveFile(true)}><Icon name="trash" size={13} /> {ar ? 'إزالة الملف' : 'Remove file'}</button>
            </div>
          )}
          {editing && removeFile && !file && (
            <div className="cm-current">
              <span>{ar ? 'سيتم حذف الملف الحالي عند الحفظ.' : 'The current file will be removed on save.'}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveFile(false)}>{ar ? 'تراجع' : 'Undo'}</button>
            </div>
          )}
          <input className="form-input" type="file" accept={ACCEPT[kind]} onChange={pick} />
          {file && <small className="pf-hint">{file.name} · {fmtSize(file.size)}{hasExistingFile ? (ar ? ' — سيستبدل الملف الحالي' : ' — replaces the current file') : ''}</small>}
        </Field>

        {saving && progress != null && (
          <div className="cm-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${progress}%` }} /><span>{progress}%</span>
          </div>
        )}
      </FormSection>

      <FormSection title={ar ? 'خيارات' : 'Options'}>
        <label className="cr-confirm"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> {ar ? 'تثبيت في أعلى القائمة' : 'Pin to the top'}</label>
        <label className="cr-confirm"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {ar ? 'حفظ كمسودة (لا يظهر للطلاب ولا يُرسل إشعار)' : 'Save as draft (hidden from students, no notification)'}</label>
      </FormSection>
    </FormModal>
  );
}

/* ------------------------------------------------------------------------------------------ */

/** Big modal that hosts the materials of one course (student page). */
export function CourseMaterialsModal({ course, onClose }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pf-modal cm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pf-head">
          <span className="pf-head__icon"><Icon name="folder" size={20} /></span>
          <div className="pf-head__text">
            <h2>{ar ? 'محتوى المادة' : 'Course content'}</h2>
            <p>{course.code} — {course.name}</p>
          </div>
          <button type="button" className="pf-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}><Icon name="x" size={18} /></button>
        </header>
        <div className="pf-body"><CourseMaterials courseId={course.id} /></div>
      </div>
    </div>
  );
}
