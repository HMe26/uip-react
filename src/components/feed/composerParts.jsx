import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import Icon from '../Icon';
import { lockScroll } from '../../lib/scrollLock';

export const MAX_FILES = 5;
export const MAX_LINKS = 3;
export const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip';
export const fmtSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Modal / bottom-sheet shell shared by the announcement and feed composers. */
export function Sheet({ titleId, title, subtitle, onClose, saving, onSubmit, footer, children, closeLabel = 'Close' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => { document.removeEventListener('keydown', onKey); unlock(); };
  }, [onClose, saving]);

  return (
    <div className="ua-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <form className="ua-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={onSubmit}>
        <div className="ua-sheet__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ua-icon-btn" aria-label={closeLabel} onClick={onClose} disabled={saving}><Icon name="x" size={18} /></button>
        </div>
        <div className="ua-sheet__body">{children}</div>
        <div className="ua-sheet__foot">{footer}</div>
      </form>
    </div>
  );
}

export function Section({ title, hint, children }) {
  return (
    <section className="ua-section">
      {(title || hint) && <div className="ua-section__head">{title && <h3>{title}</h3>}{hint && <small>{hint}</small>}</div>}
      {children}
    </section>
  );
}

export function FileDrop({ files, setFiles, ar }) {
  const [dragging, setDragging] = useState(false);
  const add = (list) => {
    const incoming = Array.from(list || []);
    if (incoming.length) setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES));
  };
  return (
    <>
      <label
        className={`ua-drop${dragging ? ' is-drag' : ''}${files.length >= MAX_FILES ? ' is-full' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
      >
        <Icon name="upload" size={22} />
        <strong>{ar ? 'اختر ملفات أو اسحبها هنا' : 'Choose files or drop them here'}</strong>
        <span>{ar ? `حتى ${MAX_FILES} ملفات.` : `Up to ${MAX_FILES} files.`}</span>
        <input type="file" multiple accept={ACCEPT} disabled={files.length >= MAX_FILES} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </label>
      {files.length > 0 && (
        <div className="ua-picked">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="ua-picked__row">
              <Icon name="file" size={16} />
              <b title={f.name}>{f.name}</b>
              <small>{fmtSize(f.size)}</small>
              <button type="button" className="ua-icon-btn ua-icon-btn--danger" style={{ width: 32, height: 32 }} aria-label={`${ar ? 'إزالة' : 'Remove'} ${f.name}`} onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function LinkRows({ links, setLinks, ar }) {
  const update = (i, field, value) => setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  const titlePh = ar ? 'عنوان الرابط (اختياري)' : 'Link title (optional)';
  return (
    <>
      {links.map((link, i) => (
        <div key={i} className="ua-linkrow">
          <input className="ua-input" type="url" inputMode="url" placeholder="https://…" value={link.url} onChange={(e) => update(i, 'url', e.target.value)} aria-label={ar ? 'رابط' : 'Link URL'} dir="ltr" />
          <input className="ua-input" type="text" placeholder={titlePh} value={link.title} onChange={(e) => update(i, 'title', e.target.value)} aria-label={titlePh} />
          <button type="button" className="ua-icon-btn ua-icon-btn--danger" aria-label={ar ? 'إزالة' : 'Remove'} disabled={links.length === 1 && !link.url && !link.title}
            onClick={() => setLinks((p) => (p.length === 1 ? [{ url: '', title: '' }] : p.filter((_, idx) => idx !== i)))}><Icon name="trash" size={16} /></button>
        </div>
      ))}
      {links.length < MAX_LINKS && (
        <button type="button" className="ua-add" onClick={() => setLinks((p) => [...p, { url: '', title: '' }])}><Icon name="plus" size={14} /> {ar ? 'إضافة رابط' : 'Add link'}</button>
      )}
    </>
  );
}

/** Faculty → department → academic-year selectors. `value` = { facultyId, departmentId, academicYear }. */
export function AudienceFields({ faculties, value, onChange, ar }) {
  const [departments, setDepartments] = useState([]);
  const { facultyId, departmentId, academicYear } = value;
  const prevFaculty = useRef(facultyId);

  useEffect(() => {
    if (!facultyId) { setDepartments([]); return undefined; }
    let cancelled = false;
    api.get(`/api/v1/faculty/${facultyId}`)
      .then((json) => { if (!cancelled) setDepartments(json.data?.departments || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [facultyId]);

  useEffect(() => {
    if (prevFaculty.current !== facultyId) { prevFaculty.current = facultyId; if (departmentId) onChange({ ...value, departmentId: '' }); }
  }, [facultyId, departmentId, onChange, value]);

  const nm = (o) => (ar ? (o.name_ar || o.name_en) : o.name_en);
  return (
    <div className="ua-grid ua-grid--3">
      <div className="ua-field">
        <label htmlFor="aud_fac">{ar ? 'الكلية' : 'Faculty'}</label>
        <select id="aud_fac" className="ua-select" value={facultyId} onChange={(e) => onChange({ ...value, facultyId: e.target.value, departmentId: '' })}>
          <option value="">{ar ? 'كل الكليات' : 'All faculties'}</option>
          {faculties.map((f) => <option key={f.id} value={f.id}>{nm(f)}</option>)}
        </select>
      </div>
      <div className="ua-field">
        <label htmlFor="aud_dep">{ar ? 'القسم' : 'Department'}</label>
        <select id="aud_dep" className="ua-select" value={departmentId} onChange={(e) => onChange({ ...value, departmentId: e.target.value })} disabled={!facultyId}>
          <option value="">{ar ? 'كل الأقسام' : 'All departments'}</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{nm(d)}</option>)}
        </select>
      </div>
      <div className="ua-field">
        <label htmlFor="aud_year">{ar ? 'السنة الدراسية' : 'Academic year'}</label>
        <select id="aud_year" className="ua-select" value={academicYear} onChange={(e) => onChange({ ...value, academicYear: e.target.value })}>
          <option value="">{ar ? 'كل السنوات الدراسية' : 'All academic years'}</option>
          {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{ar ? `السنة ${y}` : `Year ${y}`}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Appends the audience + attachments + links to a FormData (same field names the API already expects). */
export function appendCommon(fd, { aud, files, links }) {
  if (aud.facultyId) fd.append('target_faculty_id', aud.facultyId);
  if (aud.departmentId) fd.append('target_department_id', aud.departmentId);
  if (aud.academicYear) fd.append('target_academic_year', aud.academicYear);
  files.forEach((file, i) => fd.append(`attachment_${i}`, file));
  links.forEach((link) => {
    if (link.url) { fd.append('link_url[]', link.url); fd.append('link_title[]', link.title || ''); }
  });
}
export const EMPTY_AUD = { facultyId: '', departmentId: '', academicYear: '' };
