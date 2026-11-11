import { downloadPdfChecked, isPdfName } from '../../lib/pdfSafety';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { timeAgo } from './stUi';
import FileViewer from '../FileViewer';
import { groupFiles } from '../university/ReviewFileGroups';

/**
 * Project "Files" tab: drag & drop + a live upload queue (one card per file, circular
 * progress ring, several files in parallel) + a card-style file list.
 *
 * The queue lives in this component's own state and the list is refreshed through
 * `reloadFiles` (files endpoint only) — the page is never put back in its "Loading…"
 * state, so nothing disappears while uploading.
 *
 * Styles: styles/css/student-portal.css (.st-fm-*).
 */

const MAX_BYTES = 50 * 1024 * 1024; // matches the server limit (50MB)
const CONCURRENCY = 3;
const DONE_LINGER_MS = 1600;

const KINDS = [
  { re: /^(pdf)$/, key: 'pdf', color: '#e5484d' },
  { re: /^(doc|docx|odt|rtf|txt|md)$/, key: 'doc', color: '#3b82f6' },
  { re: /^(xls|xlsx|csv|ods)$/, key: 'sheet', color: '#16a34a' },
  { re: /^(ppt|pptx|key|odp)$/, key: 'slides', color: '#f97316' },
  { re: /^(zip|rar|7z|tar|gz)$/, key: 'archive', color: '#d4a017' },
  { re: /^(png|jpe?g|gif|webp|svg)$/, key: 'image', color: '#8b5cf6' },
  { re: /^(mp4|mov|webm|avi|mkv)$/, key: 'video', color: '#ec4899' },
];

function kindOf(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const k = KINDS.find((x) => x.re.test(ext));
  return { ext: ext.slice(0, 4).toUpperCase() || 'FILE', color: k ? k.color : '#64748b', key: k ? k.key : 'other' };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Circular progress ring around the file badge. */
function Ring({ status, pct, color, ext }) {
  const R = 25;
  const C = 2 * Math.PI * R;
  const shown = status === 'done' || status === 'error' ? 100 : status === 'queued' ? 0 : status === 'processing' ? 28 : pct;
  const stroke = status === 'done' ? 'var(--color-success)' : status === 'error' ? 'var(--color-danger)' : color;
  return (
    <span className={`st-fm-ring is-${status}`} style={{ '--k': color }}>
      <svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
        <circle className="st-fm-ring__track" cx="30" cy="30" r={R} />
        <circle
          className="st-fm-ring__bar" cx="30" cy="30" r={R}
          stroke={stroke}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - shown / 100)}
        />
      </svg>
      <span className="st-fm-ring__core">
        {status === 'done' ? <Icon name="check" size={20} />
          : status === 'error' ? <Icon name="alert-triangle" size={18} />
            : status === 'uploading' ? <b>{pct}<small>%</small></b>
              : status === 'processing' ? <span className="st-fm-spin" />
                : <span className="st-fm-ext">{ext}</span>}
      </span>
    </span>
  );
}

function QueueItem({ item, t, onRetry, onDismiss, onCancel }) {
  const k = kindOf(item.name);
  const label = {
    queued: t('Waiting…', 'في الانتظار…'),
    uploading: t('Uploading…', 'جارِ الرفع…'),
    processing: t('Processing on server…', 'جارِ المعالجة على الخادم…'),
    done: t('Uploaded', 'تم الرفع'),
    error: item.error,
  }[item.status];
  return (
    <li className={`st-fm-q is-${item.status}`}>
      <Ring status={item.status} pct={item.pct} color={k.color} ext={k.ext} />
      <div className="st-fm-q__body">
        <strong dir="auto" title={item.name}>{item.name}</strong>
        <span className="st-fm-q__meta">{humanSize(item.size)} · {label}</span>
        {(item.status === 'uploading' || item.status === 'processing') && (
          <span className="st-fm-bar" aria-hidden="true"><i style={{ width: `${item.pct}%` }} /></span>
        )}
      </div>
      <div className="st-fm-q__acts">
        {item.status === 'error' && (
          <button type="button" className="st-fm-iconbtn" onClick={() => onRetry(item.uid)} title={t('Retry', 'إعادة المحاولة')} aria-label={t('Retry', 'إعادة المحاولة')}>
            <Icon name="refresh" size={16} />
          </button>
        )}
        {(item.status === 'error' || item.status === 'queued') && (
          <button type="button" className="st-fm-iconbtn" onClick={() => onDismiss(item.uid)} title={t('Remove', 'إزالة')} aria-label={t('Remove', 'إزالة')}>
            <Icon name="x" size={16} />
          </button>
        )}
        {(item.status === 'uploading' || item.status === 'processing') && (
          <button type="button" className="st-fm-cancel" onClick={() => onCancel(item.uid)} title={t('Cancel upload', 'إلغاء الرفع')}>
            <Icon name="x" size={14} /> {t('Cancel', 'إلغاء')}
          </button>
        )}
      </div>
    </li>
  );
}

export default function FileManager({ id, files, canEdit, isOwner, userId, t, locale, reloadFiles, setActionError }) {
  const inputRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [search, setSearch] = useState('');
  const [viewerId, setViewerId] = useState(null);

  const pending = useRef([]); // uids waiting for a free slot
  const active = useRef(0);
  const filesRef = useRef(new Map()); // uid -> File
  const aborts = useRef(new Map()); // uid -> AbortController (uploads in flight)
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const patch = useCallback((uid, p) => {
    if (alive.current) setQueue((q) => q.map((it) => (it.uid === uid ? { ...it, ...p } : it)));
  }, []);
  const drop = useCallback((uid) => {
    filesRef.current.delete(uid);
    if (alive.current) setQueue((q) => q.filter((it) => it.uid !== uid));
  }, []);

  const uploadOne = useCallback(async (uid) => {
    const file = filesRef.current.get(uid);
    if (!file) return;
    patch(uid, { status: 'uploading', pct: 0, error: null });
    const fd = new FormData();
    fd.append('file', file);
    const ctrl = new AbortController();
    aborts.current.set(uid, ctrl);
    try {
      await api.postFormProgress(`/api/v1/projects/${id}/files`, fd, (pct) => patch(uid, { pct, status: pct >= 100 ? 'processing' : 'uploading' }), ctrl.signal);
      patch(uid, { status: 'done', pct: 100 });
      reloadFiles();
      setTimeout(() => drop(uid), DONE_LINGER_MS);
    } catch (err) {
      if (ctrl.signal.aborted) {
        // User cancelled. If the server had already saved the file (cancelled during "processing"), it shows up in the list.
        drop(uid);
        reloadFiles();
      } else {
        patch(uid, { status: 'error', error: errorMessage(err) });
      }
    } finally {
      aborts.current.delete(uid);
    }
  }, [id, patch, drop, reloadFiles]);

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && pending.current.length) {
      const uid = pending.current.shift();
      active.current += 1;
      uploadOne(uid).finally(() => { active.current -= 1; pump(); });
    }
  }, [uploadOne]);

  const enqueue = useCallback((list) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setActionError(null);
    const items = picked.map((file) => {
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let error = null;
      if (file.size === 0) error = t('This file is empty.', 'الملف فارغ.');
      else if (file.size > MAX_BYTES) error = t('Larger than the 50MB limit.', 'أكبر من الحد المسموح (50MB).');
      if (!error) filesRef.current.set(uid, file);
      return { uid, name: file.name, size: file.size, status: error ? 'error' : 'queued', pct: 0, error, blocked: !!error };
    });
    setQueue((q) => [...q, ...items]);
    items.filter((i) => !i.blocked).forEach((i) => pending.current.push(i.uid));
    pump();
  }, [pump, setActionError, t]);

  const retry = useCallback((uid) => {
    if (!filesRef.current.has(uid)) return;
    patch(uid, { status: 'queued', pct: 0, error: null });
    pending.current.push(uid);
    pump();
  }, [patch, pump]);

  const cancel = useCallback((uid) => {
    aborts.current.get(uid)?.abort();
  }, []);

  const dismiss = useCallback((uid) => {
    pending.current = pending.current.filter((u) => u !== uid);
    drop(uid);
  }, [drop]);

  const busy = queue.some((q) => q.status === 'queued' || q.status === 'uploading' || q.status === 'processing');
  useEffect(() => {
    if (!busy) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  // ZIP editor "Save": the rebuilt archive replaces the file as its newest version (the old one stays in the version
  // history), so everyone on the project gets it. A 409 means someone else saved first — the editor then asks.
  const saveFile = useCallback(async (file, blob, { force, name } = {}) => {
    const fd = new FormData();
    fd.append('file', new File([blob], name || file.original_name, { type: blob.type || 'application/octet-stream' }));
    if (force) fd.append('force', '1');
    const res = await api.postForm(`/api/v1/projects/${id}/files/${file.id}/replace`, fd);
    await reloadFiles();
    return res.data;
  }, [id, reloadFiles]);

  // The viewer follows a file by its root id, so a newer saved version replaces the open one instead of closing it.
  const rootOf = (f) => f.root_id ?? f.id;
  const openViewer = (f) => { setViewerId(rootOf(f)); reloadFiles(); }; // reload: pick up versions others saved meanwhile

  async function handleDelete(fileId) {
    setDeletingId(fileId);
    try {
      await api.del(`/api/v1/projects/${id}/files/${fileId}`);
      setConfirmId(null);
      await reloadFiles();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? files.filter((f) => String(f.original_name || '').toLowerCase().includes(q)) : files;
  }, [files, search]);

  const groups = useMemo(() => groupFiles(shown), [shown]);

  const typeChips = useMemo(() => {
    const m = new Map();
    files.forEach((f) => { const e = (f.extension || '—').toUpperCase(); m.set(e, (m.get(e) || 0) + 1); });
    return [...m.entries()];
  }, [files]);

  const activeCount = queue.filter((q) => ['queued', 'uploading', 'processing'].includes(q.status)).length;

  return (
    <div className="st-stack st-fm">
      {canEdit ? (
        <div
          className={`st-fm-drop${dragging ? ' is-drag' : ''}`}
          role="button" tabIndex={0}
          aria-label={t('Upload files', 'رفع ملفات')}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragging(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }}
          onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); enqueue(e.dataTransfer.files); }}
        >
          <span className="st-fm-drop__icon"><Icon name="upload" size={26} /></span>
          <strong>{dragging ? t('Drop to upload', 'أفلت الملفات للرفع') : t('Drag & drop files here', 'اسحب وأفلت الملفات هنا')}</strong>
          <small>{t('or click to browse — multiple files, up to 50MB each', 'أو اضغط للاختيار من جهازك — عدة ملفات، حتى 50MB للملف')}</small>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { enqueue(e.target.files); e.target.value = ''; }} />
        </div>
      ) : (
        <div className="st-fm-locked">
          <Icon name="lock" size={16} />
          <span>{t('Uploading is closed — files can only be changed while the project is a draft or sent back for changes.', 'الرفع مقفول — الملفات تتعدّل فقط والمشروع مسودة أو مُعاد للتعديل.')}</span>
        </div>
      )}

      {queue.length > 0 && (
        <section className="st-fm-queue" aria-live="polite">
          <header>
            <strong>{activeCount > 0 ? t(`Uploading ${activeCount} file${activeCount > 1 ? 's' : ''}`, `جارِ رفع ${activeCount} ${activeCount > 2 ? 'ملفات' : 'ملف'}`) : t('Uploads', 'الرفع')}</strong>
            {queue.some((q) => q.status === 'error') && (
              <button type="button" className="st-link" onClick={() => queue.filter((q) => q.status === 'error' && !q.blocked).forEach((q) => retry(q.uid))}>{t('Retry failed', 'إعادة المحاولة للفاشل')}</button>
            )}
          </header>
          <ul>
            {queue.map((it) => <QueueItem key={it.uid} item={it} t={t} onRetry={retry} onDismiss={dismiss} onCancel={cancel} />)}
          </ul>
        </section>
      )}

      <section className="st-fm-list">
        <header className="st-fm-list__head">
          <div>
            <h2>{t('Project files', 'ملفات المشروع')} <span className="st-fm-count">{files.length}</span></h2>
            {typeChips.length > 0 && (
              <div className="st-fm-chips">
                {typeChips.map(([ext, n]) => <span key={ext}>{ext} · {n}</span>)}
              </div>
            )}
          </div>
          {files.length > 5 && (
            <input className="form-input st-fm-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search files…', 'ابحث في الملفات…')} />
          )}
        </header>

        {files.length === 0 ? (
          <div className="st-fm-empty">
            <span><Icon name="file" size={26} /></span>
            <strong>{t('No files uploaded yet.', 'لا توجد ملفات مرفوعة بعد.')}</strong>
            {canEdit && <p>{t('Add your report (PDF/Word), source code (zip) and presentation.', 'ارفع تقرير المشروع (PDF أو Word) والكود (zip) والعرض التقديمي.')}</p>}
          </div>
        ) : shown.length === 0 ? (
          <p className="st-muted" style={{ padding: 20 }}>{t('No files match your search.', 'لا توجد ملفات مطابقة للبحث.')}</p>
        ) : (
          <div className="rv-folders st-fm-folders">
            {groups.map((g) => (
              <details key={g.key} className="rv-folder" open={g.items.length <= 6 || !!search.trim()}>
                <summary className="rv-folder__head">
                  <span className="rv-folder__ico"><Icon name={g.icon} size={18} /></span>
                  <span className="rv-folder__name">{locale === 'ar' ? g.ar : g.en}</span>
                  <span className="rv-folder__count">{g.items.length}</span>
                  <span className="rv-folder__chev"><Icon name="chevron-down" size={16} /></span>
                </summary>
                <ul className="st-fm-files">
                  {g.items.map((f) => {
              const k = kindOf(f.original_name);
              const mine = canEdit && (isOwner || (userId != null && Number(f.uploaded_by) === Number(userId)));
              return (
                <li key={f.id} className="st-fm-file" style={{ '--k': k.color }}>
                  <button type="button" className="st-fm-badge st-fm-badge--btn" onClick={() => f.url && openViewer(f)} aria-label={t('Preview', 'معاينة')}>{k.ext}</button>
                  <div className="st-fm-file__body">
                    <button type="button" className="st-fm-file__name" dir="auto" title={f.original_name} onClick={() => f.url && openViewer(f)}>{f.original_name}</button>
                    <span className="st-fm-file__meta">
                      {[f.size_human, f.uploader_name, f.created_at && timeAgo(f.created_at, locale), Number(f.version) > 1 && `v${f.version}`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="st-fm-file__acts">
                    {f.url && (
                      <>
                        <button type="button" className="st-fm-iconbtn" onClick={() => openViewer(f)} title={t('Preview', 'معاينة')} aria-label={t('Preview', 'معاينة')}><Icon name="eye" size={16} /></button>
                        {!isPdfName(f.original_name) && <a href={f.url} target="_blank" rel="noopener noreferrer" className="st-fm-iconbtn" title={t('Open in a new tab', 'فتح في تبويب جديد')} aria-label={t('Open in a new tab', 'فتح في تبويب جديد')}><Icon name="expand" size={16} /></a>}
                        <a href={f.url} download className="st-fm-iconbtn" title={t('Download', 'تنزيل')} aria-label={t('Download', 'تنزيل')}
                          onClick={(e) => { if (isPdfName(f.original_name)) { e.preventDefault(); downloadPdfChecked({ url: f.url, name: f.original_name, tt: t }); } }}><Icon name="download" size={16} /></a>
                      </>
                    )}
                    {mine && (confirmId === f.id ? (
                      <span className="st-fm-confirm">
                        <button type="button" className="st-fm-danger" disabled={deletingId === f.id} onClick={() => handleDelete(f.id)}>{deletingId === f.id ? '…' : t('Delete', 'حذف')}</button>
                        <button type="button" className="st-fm-iconbtn" onClick={() => setConfirmId(null)} aria-label={t('Cancel', 'إلغاء')}><Icon name="x" size={16} /></button>
                      </span>
                    ) : (
                      <button type="button" className="st-fm-iconbtn st-fm-iconbtn--danger" onClick={() => setConfirmId(f.id)} title={t('Delete', 'حذف')} aria-label={t('Delete', 'حذف')}><Icon name="trash" size={16} /></button>
                    ))}
                  </div>
                </li>
              );
            })}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>
      {viewerId != null && files.some((x) => rootOf(x) === viewerId && x.url) && (
        <FileViewer
          files={files.filter((x) => x.url)}
          startIndex={Math.max(0, files.filter((x) => x.url).findIndex((x) => rootOf(x) === viewerId))}
          onClose={() => setViewerId(null)}
          locale={locale}
          projectId={id}
          onSaveFile={canEdit ? saveFile : undefined}
        />
      )}
    </div>
  );
}
