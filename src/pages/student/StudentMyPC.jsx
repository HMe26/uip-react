import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePrivateParams } from '../../lib/privateParams';
import { unzipSync, zipSync } from 'fflate';
import { errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import FileViewer from '../../components/FileViewer';
import NewFileDialog from '../../components/NewFileDialog';
import ShareDialog from '../../components/ShareDialog';
import MySharedLinks from '../../components/MySharedLinks';
import StorageDialog from '../../components/StorageDialog';
import DeleteProgressHost from '../../components/DeleteProgress';
import VersionHistoryDialog from '../../components/VersionHistoryDialog';
import '../../styles/css/drive-share.css';
import { useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { StModal, EmptyState, Skeleton, timeAgo } from '../../components/student/stUi';
import { readDataTransfer, itemsFromFileList } from '../../components/zipbench/zipImport';
import { useBackLayer } from '../../lib/backStack';
import { lockScroll } from '../../lib/scrollLock';
import { saveBlob } from '../../lib/exporter';
import { drive, fetchDriveBlob, fetchFolderZip, fetchDownload, sharedApi } from '../../lib/driveApi';
import { useAuth } from '../../context/AuthContext';
import { MAX_TAGS_PER_ITEM, MAX_TAG_LEN, tagColor, tokenFromLink, useDriveMarks } from '../../lib/driveMarks';
import { afterGuard } from '../../lib/saveCenter';
import { isSystemNode } from '../../desktop/sync';
import { onDriveChanged } from '../../lib/driveEvents';
import { FileGlyph, FolderGlyph } from '../../desktop/OsIcons';
import { extOf, isTextName, opensInEditor } from '../../lib/driveFileKinds';
import { useSharedClip } from '../../lib/driveClipboard';
import { keyOf } from '../../desktop/shortcuts';
import { DROP_EVENT, readDragIds, setDragData } from '../../lib/driveDnd';
import ContentMatches from '../../components/ContentMatches';
import { useContentSearch } from '../../lib/useContentSearch';
import '../../styles/css/my-pc.css';

const ZipWorkbench = lazy(() => import('../../components/zipbench/ZipWorkbench'));

/**
 * "My PC" (جهازي) — the student's own private file system, Explorer-style: folder tree, breadcrumb, grid / list,
 * drag & drop (upload from the computer, move between folders), copy / cut / paste, zip / extract, recycle bin, search,
 * and every editor the platform already has (image, PDF, video / audio, ZIP + code workbench with the real sandbox).
 *
 * Backend: /api/v1/drive/* (DriveApiController). Isolation is server-side: every query is bound to the token's user.
 * Styles: styles/css/my-pc.css (.mp-*). Texts are inline (en / ar) through tt().
 */

const COLORS = {
  pdf: '#e5484d', doc: '#3b82f6', docx: '#3b82f6', odt: '#3b82f6', rtf: '#3b82f6', txt: '#64748b', md: '#64748b',
  xls: '#16a34a', xlsx: '#16a34a', csv: '#16a34a', ppt: '#f97316', pptx: '#f97316',
  zip: '#d4a017', rar: '#d4a017', '7z': '#d4a017', gz: '#d4a017', tar: '#d4a017',
  png: '#8b5cf6', jpg: '#8b5cf6', jpeg: '#8b5cf6', gif: '#8b5cf6', webp: '#8b5cf6', svg: '#8b5cf6', bmp: '#8b5cf6',
  mp4: '#ec4899', mov: '#ec4899', webm: '#ec4899', mkv: '#ec4899', mp3: '#14b8a6', wav: '#14b8a6', ogg: '#14b8a6', m4a: '#14b8a6',
  js: '#eab308', jsx: '#eab308', ts: '#3178c6', tsx: '#3178c6', py: '#3b82f6', php: '#8892bf', html: '#e34f26', css: '#2965f1', json: '#a3a3a3',
};
const TEMPLATES = [
  { key: 'blank', en: 'Blank project', ar: 'مشروع فارغ', icon: 'file' },
  { key: 'web', en: 'Website (HTML / CSS / JS)', ar: 'موقع (HTML / CSS / JS)', icon: 'globe' },
  { key: 'node', en: 'Node.js', ar: 'Node.js', icon: 'terminal' },
  { key: 'python', en: 'Python', ar: 'Python', icon: 'terminal' },
];
const CONCURRENCY = 3;
const DONE_LINGER_MS = 2200;

const colorOf = (n) => COLORS[extOf(n)] || '#64748b';

function NodeIcon({ node, size = 44 }) {
  if (node.kind === 'disk') return <span className="mp-ico mp-ico--disk" style={{ width: size, height: size }}><Icon name="hard-drive" size={Math.round(size * 0.78)} /></span>;
  if (node.type === 'folder') return <span className="mp-ico" style={{ width: size, height: size }}><FolderGlyph size={size} project={node.kind === 'project'} /></span>;
  return <span className="mp-ico" style={{ width: size, height: size }}><FileGlyph size={size} label={extOf(node.name)} color={colorOf(node.name)} /></span>;
}

/** Right-click menu. Rendered in a portal (inside the desktop when there is one) so a window's overflow / animation can never clip or offset it,
 *  and clamped to the screen using its real measured size. */
function CtxMenu({ x, y, rtl, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)), ready: true });
  }, [x, y]);
  return createPortal(
    <ul ref={ref} className="mp-ctx" dir={rtl ? 'rtl' : 'ltr'} role="menu" style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </ul>,
    document.querySelector('.os') || document.body,
  );
}

/** Toolbar drop-down (New / Sort). Rendered in a portal with fixed positioning measured from its button, so the toolbar's own
 *  overflow (it scrolls sideways on phones) can never clip it. Flips above the button when there is no room below. */
function Pop({ anchor, end, rtl, className = '', children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: 8, top: 8, maxHeight: 400, ready: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !anchor?.getBoundingClientRect) return;
    const a = anchor.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
    const w = el.offsetWidth; const h = el.scrollHeight;
    const alignRight = rtl ? !end : !!end; // which edge of the button the menu lines up with
    let left = alignRight ? a.right - w : a.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - a.bottom - 14; const above = a.top - 14;
    const up = h > below && above > below;
    const room = Math.max(120, up ? above : below);
    const top = up ? Math.max(8, a.top - 6 - Math.min(h, room)) : a.bottom + 6;
    setPos({ left, top, maxHeight: room, ready: true });
  }, [anchor, end, rtl]);
  return createPortal(
    <div ref={ref} className={`mp-pop mp-pop--fixed${end ? ' mp-pop--end' : ''}${className ? ` ${className}` : ''}`} dir={rtl ? 'rtl' : 'ltr'} role="menu"
      style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight, visibility: pos.ready ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.querySelector('.os') || document.body,
  );
}

/** One file / folder row. Memoised: a selection change re-renders only the rows whose own state changed, not the whole folder.
 *  Handlers come from `act.current` (always the latest closures) so every prop stays primitive. */
const ItemRow = memo(function ItemRow({ n, view, ar, locale, selected, cut, fav, tagsKey, showPath, act }) {
  const tt = (en, a) => (ar ? a : en);
  const tags = tagsKey ? tagsKey.split('\u0001') : null;
  return (
    <div
                      data-id={n.id} role="option" aria-selected={selected} tabIndex={0}
                      className={`mp-item${selected ? ' is-sel' : ''}${cut ? ' is-cut' : ''}`}
                      draggable
                      onClick={(e) => act.current.clickItem(e, n)}
                      onDoubleClick={(e) => { e.stopPropagation(); act.current.openNode(n); }}
                      onContextMenu={(e) => act.current.showMenu(e, n)}
                      onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); act.current.clickItem({ ctrlKey: true, shiftKey: false, stopPropagation: () => {} }, n); } }}
                      data-node-id={n.id} data-node-type={n.type}
                      onDragStart={(e) => act.current.dragStart(e, n)}
                      onDragOver={(e) => { if (n.type === 'folder' && (e.dataTransfer.types.includes('application/x-drive-ids') || e.dataTransfer.types.includes('Files'))) { e.preventDefault(); e.currentTarget.classList.add('is-over'); } }}
                      onDragLeave={(e) => e.currentTarget.classList.remove('is-over')}
                      onDrop={(e) => { e.currentTarget.classList.remove('is-over'); if (n.type !== 'folder') return; if (e.dataTransfer.types.includes('application/x-drive-ids')) act.current.dropIds(e, n.id); else act.current.onDropFiles(e, n.id); }}
                    >
                      <NodeIcon node={n} size={view === 'grid' ? 56 : 28} />
                      <span className="mp-item__name" dir="auto" title={n.name}>{n.name}{fav && <Icon name="star" size={12} className="mp-star" />}{tags && <span className="mp-dots" aria-label={tags.join(', ')}>{tags.map((t) => <i key={t} style={{ background: tagColor(t) }} title={t} />)}</span>}{showPath && n.path ? <small>{n.path}</small> : null}</span>
                      {view === 'list' && (
                        <>
                          <span className="mp-item__date">{timeAgo(n.updated_at || n.created_at, locale)}</span>
                          <span className="mp-item__type">{n.type === 'folder' ? (n.kind === 'project' ? tt('Project', 'مشروع') : n.kind === 'disk' ? tt('Disk', 'قرص') : tt('Folder', 'مجلد')) : (n.extension || '—').toUpperCase()}</span>
                          <span className="mp-item__size">{n.type === 'folder' ? '' : n.size_human}</span>
                        </>
                      )}
                    </div>
  );
});

/** Folder tree row (recursive). */
function TreeNode({ node, byParent, depth, openSet, toggle, activeId, onOpen, onDropIds, rtl }) {
  const kids = byParent.get(node.id) || [];
  const open = openSet.has(node.id);
  const [over, setOver] = useState(false);
  return (
    <li>
      <div
        data-tree-id={node.id}
        className={`mp-tree__row${activeId === node.id ? ' is-on' : ''}${over ? ' is-over' : ''}`}
        style={{ paddingInlineStart: 8 + depth * 14 }}
        onClick={() => onOpen(node.id)}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-drive-ids')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); onDropIds(e, node.id); }}
        role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={activeId === node.id}
      >
        <button
          type="button" className={`mp-tree__chev${kids.length ? '' : ' is-hidden'}`} tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); toggle(node.id); }} aria-label="toggle"
        >
          <Icon name={open ? 'chevron-down' : (rtl ? 'chevron-left' : 'chevron-right')} size={13} />
        </button>
        <Icon name={node.kind === 'project' ? 'terminal' : node.kind === 'disk' ? 'hard-drive' : 'folder'} size={15} />
        <span dir="auto">{node.name}</span>
      </div>
      {open && kids.length > 0 && (
        <ul role="group">
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} byParent={byParent} depth={depth + 1} openSet={openSet} toggle={toggle}
              activeId={activeId} onOpen={onOpen} onDropIds={onDropIds} rtl={rtl} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Full-screen code / ZIP workbench (a folder, or one text file wrapped as a one-entry ZIP). */
function EditorOverlay({ title, load, onSave, sandboxTokenPath, tt, rtl, onClose }) {
  const [state, setState] = useState({ status: 'loading', blob: null, error: '' });
  const guardRef = useRef(null);
  const close = useCallback(() => { afterGuard(guardRef.current?.(), () => onClose()); }, [onClose]);
  useBackLayer(true, close);
  useEffect(() => lockScroll(), []);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const blob = await load();
        if (!dead) setState({ status: 'ready', blob, error: '' });
      } catch (err) {
        if (!dead) setState({ status: 'error', blob: null, error: errorMessage(err) });
      }
    })();
    return () => { dead = true; };
  }, [load]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.target?.closest?.('.zb')) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return createPortal(
    <div className="mp-editor" dir={rtl ? 'rtl' : 'ltr'} role="dialog" aria-modal="true" aria-label={title}>
      <header className="mp-editor__bar">
        <strong dir="auto">{title}</strong>
        <button type="button" className="mp-btn mp-btn--icon" onClick={close} title={tt('Close', 'إغلاق')} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
      </header>
      <div className="mp-editor__body">
        {state.status === 'loading' && <div className="mp-editor__msg"><span className="mp-spin" />{tt('Loading…', 'جارٍ التحميل…')}</div>}
        {state.status === 'error' && <div className="mp-editor__msg is-error"><Icon name="alert-triangle" size={22} />{state.error}</div>}
        {state.status === 'ready' && (
          <Suspense fallback={<div className="mp-editor__msg"><span className="mp-spin" /></div>}>
            <ZipWorkbench blob={state.blob} fileName={`${title}.zip`} tt={tt} guardRef={guardRef} onSave={onSave} sandboxTokenPath={sandboxTokenPath} />
          </Suspense>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Tags of one item: add / remove, with the tags you already use offered as one-tap suggestions. Saved as you go. */
function TagsDialog({ node, marks, tt, onClose }) {
  const [v, setV] = useState('');
  const cur = marks.tagsOf(node.id);
  const add = (name) => { const t = name.trim().slice(0, MAX_TAG_LEN); if (!t || cur.includes(t) || cur.length >= MAX_TAGS_PER_ITEM) return; marks.setTags(node.id, [...cur, t]); setV(''); };
  const sugg = marks.allTags.filter((t) => !cur.includes(t.name));
  return (
    <StModal title={tt(`Tags — ${node.name}`, `التاجات — ${node.name}`)} onClose={onClose}
      actions={<button type="button" className="btn btn-primary" onClick={onClose}>{tt('Done', 'تم')}</button>}>
      <div className="mp-tags">
        <div className="mp-tags__cur">
          {cur.length === 0 && <small>{tt('No tags yet.', 'مفيش تاجات لسه.')}</small>}
          {cur.map((t) => (
            <span key={t} className="mp-tag" style={{ '--tg': tagColor(t) }}>{t}
              <button type="button" aria-label={tt(`Remove ${t}`, `إزالة ${t}`)} onClick={() => marks.setTags(node.id, cur.filter((x) => x !== t))}><Icon name="x" size={11} /></button></span>
          ))}
        </div>
        <label className="mp-field"><span>{tt(`Add a tag (up to ${MAX_TAGS_PER_ITEM})`, `ضيف تاج (لحد ${MAX_TAGS_PER_ITEM})`)}</span>
          <input value={v} maxLength={MAX_TAG_LEN} disabled={cur.length >= MAX_TAGS_PER_ITEM} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(v); } }}
            placeholder={tt('e.g. Math, Exam, Project', 'مثال: رياضة، امتحان، مشروع')} autoFocus /></label>
        {sugg.length > 0 && (
          <div className="mp-tags__sugg">
            <small>{tt('Your tags:', 'التاجات بتاعتك:')}</small>
            {sugg.slice(0, 12).map((t) => <button key={t.name} type="button" className="mp-tag mp-tag--btn" style={{ '--tg': tagColor(t.name) }} disabled={cur.length >= MAX_TAGS_PER_ITEM} onClick={() => add(t.name)}>+ {t.name}</button>)}
          </div>
        )}
      </div>
    </StModal>
  );
}

/** "Shared with me": the share links other students sent you. Paste one to keep it here; the server decides whether it still works. */
function SharedWithMe({ marks, tt }) {
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({}); // token -> 'ok' | 'gone'
  const tokens = marks.shared.map((x) => x.token).join(',');
  useEffect(() => {
    let live = true;
    marks.shared.slice(0, 20).forEach((x) => {
      sharedApi.view(x.token).then(() => { if (live) setStatus((s) => ({ ...s, [x.token]: 'ok' })); })
        .catch((e) => { if (live && (e?.status === 404 || e?.status === 410 || e?.status === 403)) setStatus((s) => ({ ...s, [x.token]: 'gone' })); });
    });
    return () => { live = false; };
  }, [tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    const token = tokenFromLink(v);
    if (!token) { setErr(tt('That does not look like a share link.', 'ده مش شكل رابط مشاركة.')); return; }
    if (marks.shared.some((x) => x.token === token)) { setErr(tt('Already in the list.', 'الرابط موجود بالفعل.')); return; }
    setBusy(true); setErr('');
    try {
      const d = await sharedApi.view(token);
      marks.addShared({ token, name: d?.node?.name || token, type: d?.node?.type === 'folder' ? 'folder' : 'file' });
      setV('');
    } catch (e) {
      setErr(e?.status === 404 || e?.status === 410 ? tt('This link is expired or was revoked.', 'الرابط ده منتهي أو اتلغى.') : errorMessage(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="mp-shared">
      <h3>{tt('Shared with me', 'مشاركة معي')}</h3>
      <p>{tt('When a classmate sends you a share link, paste it here to keep it close.', 'لما زميلك يبعتلك رابط مشاركة، حطه هنا عشان يفضل قدامك.')}</p>
      <div className="mp-shared__add">
        <input value={v} onChange={(e) => { setV(e.target.value); setErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder={tt('Paste the link', 'الصق الرابط هنا')} dir="ltr" />
        <button type="button" className="mp-btn mp-btn--primary" disabled={!v.trim() || busy} onClick={add}>{tt('Add', 'إضافة')}</button>
      </div>
      {err && <p className="mp-shared__err" role="alert">{err}</p>}
      {marks.shared.length === 0 ? <p className="mp-shared__empty">{tt('Nothing here yet.', 'لسه مفيش حاجة هنا.')}</p> : (
        <ul>
          {marks.shared.map((x) => (
            <li key={x.token} className={status[x.token] === 'gone' ? 'is-gone' : ''}>
              <Icon name={x.type === 'folder' ? 'folder' : 'file'} size={18} />
              <span dir="auto"><b>{x.name}</b><small>{status[x.token] === 'gone' ? tt('No longer available', 'مبقاش متاح') : new Date(x.added).toLocaleDateString()}</small></span>
              <button type="button" className="mp-btn" disabled={status[x.token] === 'gone'} onClick={() => window.open(`/s/${x.token}`, '_blank', 'noopener')}>{tt('Open', 'فتح')}</button>
              <button type="button" className="mp-ib" aria-label={tt('Remove', 'إزالة')} onClick={() => marks.removeShared(x.token)}><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NameDialog({ dlg, tt, onClose }) {
  const [v, setV] = useState(dlg.value || '');
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = v.lastIndexOf('.');
    el.setSelectionRange(0, dlg.selectAll || dot <= 0 ? v.length : dot);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => { const val = v.trim(); if (!val) return; onClose(); dlg.onOk(val); };
  return (
    <StModal
      title={dlg.title} onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{tt('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-primary" disabled={!v.trim()} onClick={submit}>{dlg.action}</button>
        </>
      )}
    >
      <label className="mp-field"><span>{dlg.label}</span>
        <input ref={ref} value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} /></label>
    </StModal>
  );
}

export default function StudentMyPC({ embedded = false, onOpenWindow }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  usePageMeta(embedded ? undefined : (ar ? 'جهازي' : 'My PC'), embedded ? undefined : ar ? 'مساحتك الشخصية: ملفاتك ومشاريعك وأكوادك في مكان واحد.' : 'Your personal space: files, projects and code in one place.');
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);

  const [params, setParams] = usePrivateParams();
  const folderParam = Number(params.get('folder')) || null;
  const inTrash = params.get('view') === 'trash';

  const { user } = useAuth();
  const marks = useDriveMarks(user?.id);
  const [special, setSpecial] = useState(null); // null | { type: 'fav' } | { type: 'tag', tag } | { type: 'shared' }
  const keepSpecial = useRef(false);
  const [data, setData] = useState({ items: [], breadcrumb: [], usage: null });
  const [tree, setTree] = useState([]);
  const [disks, setDisks] = useState([]); // top-level disks with the space each one uses (only loaded at the top of My PC)
  const [trash, setTrash] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [view, setView] = useState(() => { try { return window.localStorage.getItem('mp-view') || 'grid'; } catch { return 'grid'; } });
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [sel, setSel] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [clip, setClip] = useSharedClip(); // { ids, mode: 'copy' | 'cut' } — shared with the desktop icons
  const [menu, setMenu] = useState(null); // { x, y, node? }
  const [newMenu, setNewMenu] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const content = useContentSearch(query, !inTrash); // matches inside file text (code, notes…)
  const [openTree, setOpenTree] = useState(() => new Set());
  const [side, setSide] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [viewer, setViewerState] = useState(null); // { startId }
  const [editor, setEditorState] = useState(null); // { kind: 'folder' | 'text', node }
  // inside the desktop the viewer / code editor are real windows (onOpenWindow) instead of full-screen overlays
  const viewerFilesRef = useRef([]);
  const setViewer = useCallback((v) => { if (v && onOpenWindow) onOpenWindow({ kind: 'viewer', startId: v.startId, files: viewerFilesRef.current }); else setViewerState(v); }, [onOpenWindow]);
  const setEditor = useCallback((e) => { if (e && onOpenWindow) onOpenWindow({ kind: 'editor', editor: e }); else setEditorState(e); }, [onOpenWindow]);
  const [queue, setQueue] = useState([]);

  const rootRef = useRef(null);
  const treeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(treeTimer.current), []);
  const act = useRef({}); // latest handlers for the memoised <ItemRow>s
  const fileInput = useRef(null);
  const dirInput = useRef(null);
  const area = useRef(null);
  const cursorRef = useRef(null);       // item the keyboard cursor is on
  const typeBuf = useRef({ text: '', t: 0 });
  const suppressClick = useRef(false);  // the click that ends a rubber-band drag must not clear the selection
  const [box, setBox] = useState(null); // rubber-band rectangle, in the scrolled content's coordinates
  const pending = useRef([]);
  const running = useRef(0);
  const queueRef = useRef([]);
  const reloadTimer = useRef(null);
  const toastTimer = useRef(null);

  const flash = useCallback((msg, tone = 'ok') => {
    setToast({ msg, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 5200 : 2600);
  }, []);

  // the layout follows the size of this component (a resizable window), not just the viewport
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; el.dataset.size = w < 640 ? 'xs' : w < 900 ? 's' : 'm'; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- data -------------------------------------------------------------------------------------------
  const reload = useCallback(async ({ quiet } = {}) => {
    if (!quiet) setLoading(true);
    try {
      if (inTrash) {
        const r = await drive.trashList();
        setTrash(r.data || []);
      } else {
        const r = await drive.list(folderParam);
        setData(r.data);
        if (!folderParam) drive.disks().then((d) => setDisks(Array.isArray(d) ? d : [])).catch(() => setDisks([]));
      }
      setError('');
    } catch (err) {
      if (err?.status === 404 && folderParam) { setParams({}, { replace: true }); return; }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
    // the folder tree is the heaviest call: refresh it at most once a second and only re-render when it really changed
    window.clearTimeout(treeTimer.current);
    treeTimer.current = window.setTimeout(() => {
      drive.tree().then((r) => {
        const next = r.data || [];
        setTree((prev) => (prev.length === next.length && prev.every((x, i) => x.id === next[i].id && x.name === next[i].name && x.parent_id === next[i].parent_id) ? prev : next));
      }).catch(() => {});
    }, 700);
  }, [folderParam, inTrash, setParams]);

  useEffect(() => { setSel(new Set()); setAnchor(null); setQuery(''); setResults(null); if (keepSpecial.current) keepSpecial.current = false; else setSpecial(null); reload(); }, [reload]);
  // favorites / one tag: show the marked items (live data from the server; anything deleted for good loses its mark)
  const specialKey = special?.type === 'tag' ? `t:${special.tag}:${marks.idsWithTag(special.tag).join(',')}` : special?.type === 'fav' ? `f:${marks.favs.join(',')}` : '';
  useEffect(() => {
    if (!special || special.type === 'shared' || query.trim()) return undefined;
    const ids = special.type === 'fav' ? marks.favs : marks.idsWithTag(special.tag);
    if (!ids.length) { setResults([]); return undefined; }
    let live = true;
    drive.resolve(ids).then((r) => {
      if (!live) return;
      const d = r.data || {};
      setResults(d.items || []);
      if (d.gone?.length) marks.forget(d.gone);
    }).catch(() => { if (live) setResults([]); });
    return () => { live = false; };
  }, [specialKey, query, folderParam, inTrash]); // eslint-disable-line react-hooks/exhaustive-deps
  const showSpecial = (sp) => { keepSpecial.current = !!(folderParam || inTrash); setSel(new Set()); setQuery(''); setSpecial(sp); if (sp.type === 'shared') setResults(null); if (folderParam || inTrash) setParams({}); setSide(false); };
  useEffect(() => onDriveChanged(() => reload({ quiet: true })), [reload]);
  useEffect(() => { try { window.localStorage.setItem('mp-view', view); } catch { /* storage unavailable */ } }, [view]);

  // search (debounced)
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return undefined; }
    const h = window.setTimeout(async () => {
      try { setResults((await drive.search(q)).data || []); } catch { setResults([]); }
    }, 280);
    return () => window.clearTimeout(h);
  }, [query]);

  // keep the current folder's ancestors expanded in the tree
  useEffect(() => {
    if (!data.breadcrumb.length) return;
    setOpenTree((s) => { const n = new Set(s); data.breadcrumb.slice(0, -1).forEach((b) => n.add(b.id)); return n; });
  }, [data.breadcrumb]);

  const byParent = useMemo(() => {
    const m = new Map();
    tree.forEach((n) => { const k = n.parent_id ?? 0; if (!m.has(k)) m.set(k, []); m.get(k).push(n); });
    return m;
  }, [tree]);

  // disks are shown as drive cards at the top of My PC (not mixed with the folders and files below them)
  const diskNodes = useMemo(() => (results || folderParam || inTrash ? [] : data.items.filter((n) => n.kind === 'disk' && n.type === 'folder')), [data.items, results, folderParam, inTrash]);
  const diskCards = useMemo(() => diskNodes.map((n) => ({ ...n, ...(disks.find((d) => d.id === n.id) || {}) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [diskNodes, disks]);
  const items = useMemo(() => {
    const list = [...(results ?? data.items)].filter((n) => !isSystemNode(n) && !(diskNodes.length && n.kind === 'disk' && !results)); // hidden settings files + disks (own section)
    const { key, dir } = sort;
    const val = (n) => (key === 'size' ? n.size_bytes : key === 'date' ? Date.parse(n.updated_at || n.created_at || 0) || 0 : key === 'type' ? (n.type === 'folder' ? '' : n.extension) : n.name.toLowerCase());
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      const x = val(a); const y = val(b);
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return (c || a.name.localeCompare(b.name)) * dir;
    });
    return list;
  }, [data.items, results, sort, diskNodes]);

  const selected = useMemo(() => [...diskCards, ...items].filter((n) => sel.has(n.id)), [diskCards, items, sel]);

  // Big folders: draw the first PAGE rows, then more as the list is scrolled (data, selection and keyboard still cover every item).
  const PAGE = 150;
  const [limit, setLimit] = useState(PAGE);
  const moreRef = useRef(null);
  const shownItems = useMemo(() => (items.length > limit ? items.slice(0, limit) : items), [items, limit]);
  const cutSet = useMemo(() => new Set(clip?.mode === 'cut' ? clip.ids : []), [clip]);
  useEffect(() => { setLimit(PAGE); }, [folderParam, inTrash, special, results === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setLimit((l) => l + PAGE); }, { root: area.current, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shownItems.length, items.length]);

  // ---- navigation -------------------------------------------------------------------------------------
  // back / forward history (like a real Explorer): one entry per visited location
  const locKey = inTrash ? 'trash' : String(folderParam || '');
  const hist = useRef({ stack: [locKey], i: 0, skip: false });
  const [, bumpHist] = useState(0);
  useEffect(() => {
    const h = hist.current;
    if (h.skip) { h.skip = false; bumpHist((n) => n + 1); return; }
    if (h.stack[h.i] === locKey) return;
    h.stack = [...h.stack.slice(0, h.i + 1), locKey]; h.i = h.stack.length - 1; bumpHist((n) => n + 1);
  }, [locKey]);
  const goHist = (d) => {
    const h = hist.current; const j = h.i + d;
    if (j < 0 || j >= h.stack.length) return;
    const k = h.stack[j]; h.i = j;
    if (k !== locKey) h.skip = true;
    setParams(k === 'trash' ? { view: 'trash' } : k ? { folder: k } : {}); setSide(false);
  };
  const canBack = hist.current.i > 0; const canFwd = hist.current.i < hist.current.stack.length - 1;
  const openFolder = useCallback((id) => { setParams(id ? { folder: String(id) } : {}); setSide(false); }, [setParams]);
  const goUp = useCallback(() => {
    const bc = data.breadcrumb;
    openFolder(bc.length > 1 ? bc[bc.length - 2].id : null);
  }, [data.breadcrumb, openFolder]);
  const openTrashView = () => { setParams({ view: 'trash' }); setSide(false); };

  // ---- actions ----------------------------------------------------------------------------------------
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) flash(okMsg);
      await reload({ quiet: true });
      return r;
    } catch (err) {
      flash(errorMessage(err), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [flash, reload]);

  const viewerFiles = useMemo(() => items.filter((n) => n.type === 'file' && !opensInEditor(n.name)).map((n) => ({
    id: n.id, original_name: n.name, url: `drive:${n.id}`, size_bytes: n.size_bytes, size_human: n.size_human, version: 1, driveId: n.id,
  })), [items]);

  viewerFilesRef.current = viewerFiles;

  const openNode = useCallback((n) => {
    if (n.type === 'folder') { openFolder(n.id); return; }
    if (opensInEditor(n.name)) { setEditor({ kind: 'text', node: n }); return; }
    setViewer({ startId: n.id });
  }, [openFolder, setEditor, setViewer]);

  // "New → Word / Excel / PowerPoint / PDF …": the file is created by <NewFileDialog>; once the folder reload shows it, open it in its editor
  const pendingOpen = useRef(null);
  const newDoc = useCallback((kind) => setDlg({ type: 'newfile', kind }), []);
  useEffect(() => {
    if (pendingOpen.current == null) return;
    const n = items.find((x) => x.id === pendingOpen.current);
    if (!n) return;
    pendingOpen.current = null;
    openNode(n);
  }, [items, openNode]);

  // ?open=<id> (used by the desktop shell): open that item once its folder has loaded, then drop the param
  const openParam = Number(params.get('open')) || null;
  useEffect(() => {
    if (!openParam || loading || inTrash) return;
    const loadedId = data.breadcrumb.length ? data.breadcrumb[data.breadcrumb.length - 1].id : null;
    if (loadedId !== folderParam) return;
    const n = data.items.find((i) => i.id === openParam);
    const next = new URLSearchParams(params); next.delete('open');
    setParams(next, { replace: true });
    if (n) openNode(n);
  }, [openParam, loading, inTrash, data, folderParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadViewerBlob = useCallback((file, { onProgress } = {}) => fetchDriveBlob(file.driveId ?? file.id, { onProgress }), []);
  const saveViewerFile = useCallback(async (file, blob, opts) => {
    const res = await drive.replace(file.id, blob, opts?.name || file.original_name);
    reload({ quiet: true });
    return { id: res.data.id, original_name: res.data.name };
  }, [reload]);

  // editor loaders
  const editorLoad = useMemo(() => {
    if (!editor) return null;
    if (editor.kind === 'folder') return () => fetchFolderZip(editor.node.id);
    return async () => {
      const blob = await fetchDriveBlob(editor.node.id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return new Blob([zipSync({ [editor.node.name]: bytes })], { type: 'application/zip' });
    };
  }, [editor]);
  const editorSave = useCallback(async (blob) => {
    if (!editor) return null;
    if (editor.kind === 'folder') {
      const r = await drive.sync(editor.node.id, blob);
      reload({ quiet: true });
      const s = r.data || {};
      return { message: tt(`Saved to My PC — ${s.added || 0} added, ${s.updated || 0} updated, ${s.removed || 0} removed.`, `تم الحفظ في جهازي — ${s.added || 0} مضاف، ${s.updated || 0} معدّل، ${s.removed || 0} محذوف.`) };
    }
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const first = files[editor.node.name] ? editor.node.name : Object.keys(files).find((k) => !k.endsWith('/'));
    if (!first) throw new Error(tt('The file was removed from the editor.', 'تم حذف الملف من المحرر.'));
    await drive.replace(editor.node.id, new Blob([files[first]]), editor.node.name);
    reload({ quiet: true });
    return { message: tt('Saved to My PC.', 'تم الحفظ في جهازي.') };
  }, [editor, reload, tt]);

  const download = useCallback(async (n) => {
    try {
      flash(tt('Preparing download…', 'جارٍ تجهيز التنزيل…'));
      const { blob, name } = await fetchDownload(n);
      saveBlob(blob, name);
    } catch (err) { flash(errorMessage(err), 'error'); }
  }, [flash, tt]);

  const doDelete = useCallback((nodes) => {
    const ids = nodes.map((n) => n.id);
    const days = data.usage?.trash_days || 30;
    setDlg({
      type: 'confirm', danger: true,
      title: tt('Move to recycle bin', 'نقل إلى سلة المحذوفات'),
      text: nodes.length === 1
        ? tt(`Move “${nodes[0].name}” to the recycle bin? You can restore it for ${days} days.`, `نقل «${nodes[0].name}» إلى سلة المحذوفات؟ تقدر تسترجعه خلال ${days} يوم.`)
        : tt(`Move ${nodes.length} items to the recycle bin?`, `نقل ${nodes.length} عنصر إلى سلة المحذوفات؟`),
      action: tt('Delete', 'حذف'),
      onOk: async () => { await run(() => drive.trash(ids), tt('Moved to the recycle bin.', 'تم النقل إلى سلة المحذوفات.')); setSel(new Set()); },
    });
  }, [data.usage, run, tt]);

  const paste = useCallback(async (targetId = folderParam) => {
    if (!clip) return;
    const fn = clip.mode === 'cut' ? () => drive.move(clip.ids, targetId) : () => drive.copy(clip.ids, targetId);
    const r = await run(fn, clip.mode === 'cut' ? tt('Moved.', 'تم النقل.') : tt('Copied.', 'تم النسخ.'));
    if (r && clip.mode === 'cut') setClip(null);
  }, [clip, folderParam, run, tt]);

  const dropIds = useCallback((e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    let ids = [];
    ids = readDragIds(e.dataTransfer);
    ids = ids.filter((i) => i !== targetId);
    if (ids.length) run(() => drive.move(ids, targetId), tt('Moved.', 'تم النقل.'));
  }, [run, tt]);

  // Desktop icons are dragged with the pointer (not HTML5 drag): when one is released over this window it arrives as a DROP_EVENT.
  // Onto a folder row = into that folder; anywhere else = into the folder shown here.
  const dropRef = useRef(null);
  dropRef.current = (nodes, target) => {
    if (inTrash) return;
    const row = target?.closest?.('.mp-item[data-node-type="folder"]');
    const treeRow = target?.closest?.('[data-tree-id]');
    const targetId = row ? Number(row.getAttribute('data-node-id')) : treeRow ? Number(treeRow.getAttribute('data-tree-id')) : folderParam;
    const ids = nodes.map((n) => n.id).filter((id) => id !== targetId && !nodes.some((n) => n.id === id && (n.parent_id ?? null) === (targetId ?? null)));
    if (ids.length) run(() => drive.move(ids, targetId || null), tt('Moved.', 'تم النقل.')).then((r) => { if (r) window.dispatchEvent(new Event('uip-drive-changed')); });
  };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const h = (e) => dropRef.current?.(e.detail?.nodes || [], e.detail?.target);
    el.addEventListener(DROP_EVENT, h);
    return () => el.removeEventListener(DROP_EVENT, h);
  }, []);

  const askName = useCallback((cfg) => setDlg({ type: 'name', ...cfg }), []);
  const newFolder = () => askName({ title: tt('New folder', 'مجلد جديد'), label: tt('Folder name', 'اسم المجلد'), value: tt('New folder', 'مجلد جديد'), selectAll: true, action: tt('Create', 'إنشاء'), onOk: (v) => run(() => drive.createFolder(folderParam, v), tt('Folder created.', 'تم إنشاء المجلد.')) });
  const newFile = () => askName({ title: tt('New text file', 'ملف نصي جديد'), label: tt('File name', 'اسم الملف'), value: 'untitled.txt', action: tt('Create', 'إنشاء'), onOk: (v) => run(() => drive.createFile(folderParam, v), tt('File created.', 'تم إنشاء الملف.')) });
  const newProject = () => setDlg({ type: 'project', value: '', template: 'web' });
  const newDisk = () => askName({ title: tt('New disk', 'قرص جديد'), label: tt('Disk name', 'اسم القرص'), value: tt('New disk', 'قرص جديد'), selectAll: true, action: tt('Create', 'إنشاء'), onOk: (v) => run(() => drive.createDisk(v), tt('Disk created.', 'تم إنشاء القرص.')) });
  const toggleDisk = (n) => run(() => drive.setDisk(n.id, n.kind !== 'disk'), n.kind === 'disk' ? tt('Converted to a normal folder.', 'اتحوّل لمجلد عادي.') : tt('Now a disk — it shows at the top of My PC.', 'بقى قرص — بيظهر فوق في جهازي.'));
  const rename = (n) => askName({ title: tt('Rename', 'إعادة تسمية'), label: tt('New name', 'الاسم الجديد'), value: n.name, selectAll: n.type === 'folder', action: tt('Rename', 'تسمية'), onOk: (v) => run(() => drive.rename(n.id, v), tt('Renamed.', 'تمت إعادة التسمية.')) });
  const zipSelected = (nodes) => askName({
    title: tt('Compress to ZIP', 'ضغط إلى ZIP'), label: tt('Archive name', 'اسم الأرشيف'),
    value: nodes.length === 1 ? `${nodes[0].name}.zip` : 'Archive.zip', action: tt('Compress', 'ضغط'),
    onOk: (v) => run(() => drive.zip(nodes.map((n) => n.id), folderParam, v), tt('Archive created.', 'تم إنشاء الأرشيف.')),
  });
  const extract = (n) => run(() => drive.unzip(n.id, n.parent_id), tt('Extracted.', 'تم فك الضغط.'));

  // ---- upload -----------------------------------------------------------------------------------------
  const setQ = (fn) => { queueRef.current = fn(queueRef.current); setQueue(queueRef.current); };
  const patchQ = (uid, patch) => setQ((q) => q.map((x) => (x.uid === uid ? { ...x, ...patch } : x)));
  const maxMb = data.usage?.max_file_mb || 100;

  const pump = useCallback(() => {
    const nested = queueRef.current.some((x) => x.rel.includes('/') && ['queued', 'uploading'].includes(x.status));
    const limit = nested ? 1 : CONCURRENCY; // folder uploads go one by one so the same new folder is never created twice
    while (running.current < limit && pending.current.length) {
      const uid = pending.current.shift();
      const item = queueRef.current.find((x) => x.uid === uid);
      if (!item || item.status !== 'queued') continue; // eslint-disable-line no-continue
      running.current += 1;
      patchQ(uid, { status: 'uploading', pct: 0 });
      drive.upload(item.parent, item.file, item.rel, (p) => patchQ(uid, { pct: p }))
        .then(() => { patchQ(uid, { status: 'done', pct: 100 }); window.setTimeout(() => setQ((q) => q.filter((x) => x.uid !== uid)), DONE_LINGER_MS); })
        .catch((err) => patchQ(uid, { status: 'error', error: errorMessage(err) }))
        .finally(() => {
          running.current -= 1;
          window.clearTimeout(reloadTimer.current);
          reloadTimer.current = window.setTimeout(() => reload({ quiet: true }), 350);
          pump();
        });
    }
  }, [reload]);

  const enqueue = useCallback(async (picked, parent) => {
    const files = picked.filter((i) => !i.dir && i.file);
    const dirs = picked.filter((i) => i.dir).map((i) => i.rel.replace(/\/$/, ''));
    const tooBig = (f) => f.size > maxMb * 1048576;
    const rows = files.map((i, k) => ({
      uid: `${Date.now()}-${k}-${Math.random().toString(36).slice(2, 7)}`, file: i.file, rel: i.rel, name: i.file.name, parent,
      size: i.file.size, status: tooBig(i.file) ? 'error' : 'queued', pct: 0,
      error: tooBig(i.file) ? tt(`Larger than ${maxMb} MB`, `أكبر من ${maxMb} ميجابايت`) : '',
    }));
    // empty folders from a drag & drop (mkdir -p), best effort
    const emptyDirs = dirs.filter((d) => !files.some((f) => f.rel.startsWith(`${d}/`)));
    for (const d of emptyDirs) { try { await drive.ensurePath(parent, d); } catch { /* ignore */ } } // eslint-disable-line no-await-in-loop
    if (!rows.length) { if (emptyDirs.length) reload({ quiet: true }); return; }
    setQ((q) => [...q, ...rows]);
    pending.current.push(...rows.filter((r) => r.status === 'queued').map((r) => r.uid));
    pump();
  }, [maxMb, pump, reload, tt]);

  const onPick = (e, keepFolders) => {
    const { items: picked } = itemsFromFileList(e.target.files || [], keepFolders);
    e.target.value = '';
    enqueue(picked, folderParam);
  };

  const onDropFiles = async (e, targetId) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    if (!e.dataTransfer.types.includes('Files')) return;
    const { items: picked } = await readDataTransfer(e.dataTransfer);
    enqueue(picked, targetId === undefined ? folderParam : targetId);
  };

  const busyUploading = queue.some((x) => ['queued', 'uploading'].includes(x.status));
  useEffect(() => {
    if (!busyUploading) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busyUploading]);

  // ---- selection / keyboard ---------------------------------------------------------------------------
  const clickItem = (e, n) => {
    e.stopPropagation();
    cursorRef.current = n.id;
    const idx = items.findIndex((x) => x.id === n.id); // -1 for disk cards (they are drawn in their own section)
    if (idx >= 0) setLimit((l) => Math.max(l, idx + 60)); // make sure the target row is drawn
    if (e.shiftKey && anchor != null) {
      const a = items.findIndex((x) => x.id === anchor); const b = items.findIndex((x) => x.id === n.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(new Set(items.slice(lo, hi + 1).map((x) => x.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSel((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; });
      setAnchor(n.id);
    } else { setSel(new Set([n.id])); setAnchor(n.id); }
  };

  // number of icons per row (grid view) — measured, because it depends on the window width
  const columns = () => {
    if (view !== 'grid') return 1;
    const els = area.current?.querySelectorAll('.mp-item');
    if (!els || !els.length) return 1;
    const top = els[0].offsetTop; let c = 0;
    for (const el of els) { if (el.offsetTop === top) c += 1; else break; }
    return Math.max(1, c);
  };
  const focusItem = (id) => {
    window.requestAnimationFrame(() => {
      const el = [...(area.current?.querySelectorAll('.mp-item[data-id]') || [])].find((x) => x.dataset.id === String(id));
      if (el) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.focus({ preventScroll: true }); }
    });
  };
  // move the cursor to items[idx]; Shift extends the selection from the anchor, Ctrl only moves the cursor
  const goTo = (idx, e) => {
    const n = items[Math.max(0, Math.min(items.length - 1, idx))];
    if (!n) return;
    cursorRef.current = n.id;
    if (e.shiftKey && anchor != null) {
      const a = items.findIndex((x) => x.id === anchor); const b = items.findIndex((x) => x.id === n.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(new Set(items.slice(lo, hi + 1).map((x) => x.id)));
    } else if (!(e.ctrlKey || e.metaKey)) { setSel(new Set([n.id])); setAnchor(n.id); }
    focusItem(n.id);
  };

  const onKey = (e) => {
    if (dlg || menu || e.target.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    // with Ctrl held, match the PHYSICAL key: on the Arabic layout e.key is 'ؤ' / 'ء' / 'ي'… so Ctrl+C / X / V / A never matched
    const lk = mod && /^Key[A-Z]$/.test(e.code || '') ? keyOf(e).toLowerCase() : key.toLowerCase();
    if (key === 'F5' || (mod && lk === 'r')) { e.preventDefault(); reload(); return; }
    if (inTrash) return;

    // arrows / Home / End — move between items (grid: left-right and up-down, list: up-down). In RTL the row runs right→left.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key) && !e.altKey && items.length) {
      e.preventDefault();
      let cur = items.findIndex((x) => x.id === cursorRef.current);
      if (cur < 0 && selected.length) cur = items.findIndex((x) => x.id === selected[selected.length - 1].id);
      const cols = columns();
      const fwd = ar ? 'ArrowLeft' : 'ArrowRight'; const back = ar ? 'ArrowRight' : 'ArrowLeft';
      let next = cur;
      if (cur < 0) next = key === 'End' || key === 'ArrowUp' ? items.length - 1 : 0;
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = items.length - 1;
      else if (key === 'ArrowDown') next = cur + cols;
      else if (key === 'ArrowUp') next = cur - cols;
      else if (key === 'PageDown') next = cur + cols * 4;
      else if (key === 'PageUp') next = cur - cols * 4;
      else if (view === 'grid' && key === fwd) next = cur + 1;
      else if (view === 'grid' && key === back) next = cur - 1;
      goTo(next, e);
      return;
    }
    if (key === 'Delete' && selected.length) { e.preventDefault(); doDelete(selected); }
    else if (key === 'F2' && selected.length === 1) { e.preventDefault(); rename(selected[0]); }
    else if (key === 'Enter' && selected.length === 1) { e.preventDefault(); openNode(selected[0]); }
    else if (key === 'Backspace' || (e.altKey && key === 'ArrowUp') || (e.altKey && key === (ar ? 'ArrowRight' : 'ArrowLeft'))) { e.preventDefault(); goUp(); }
    else if (mod && e.shiftKey && lk === 'n') { e.preventDefault(); newFolder(); }
    else if (mod && lk === 'a') { e.preventDefault(); setSel(new Set(items.map((n) => n.id))); }
    else if (mod && lk === 'i') { e.preventDefault(); setSel(new Set(items.filter((n) => !sel.has(n.id)).map((n) => n.id))); }
    else if (mod && lk === 'c' && selected.length) { e.preventDefault(); setClip({ ids: selected.map((n) => n.id), mode: 'copy' }); flash(tt('Copied to clipboard.', 'تم النسخ للحافظة.')); }
    else if (mod && lk === 'x' && selected.length) { e.preventDefault(); setClip({ ids: selected.map((n) => n.id), mode: 'cut' }); flash(tt('Cut.', 'تم القص.')); }
    else if (mod && lk === 'v' && clip) { e.preventDefault(); paste(); }
    else if (key === 'Escape') setSel(new Set());
    else if (key.length === 1 && !mod && !e.altKey && key !== ' ') {
      // type the first letters of a name to jump to it
      const t = typeBuf.current; const now = Date.now();
      t.text = now - t.t > 800 ? key.toLowerCase() : t.text + key.toLowerCase(); t.t = now;
      const start = Math.max(0, items.findIndex((x) => x.id === cursorRef.current)) + (t.text.length === 1 ? 1 : 0);
      const order = [...items.slice(start), ...items.slice(0, start)];
      const hit = order.find((x) => x.name.toLowerCase().startsWith(t.text));
      if (hit) { e.preventDefault(); goTo(items.indexOf(hit), { shiftKey: false, ctrlKey: false, metaKey: false }); }
    }
  };

  // ---- rubber-band (mouse drag) selection on the empty area ---------------------------------------------
  const onMainPointerDown = (e) => {
    if (e.button !== 0 || inTrash || loading || e.target.closest('.mp-item, .mp-head, button, a, input, .mp-dropmsg')) return;
    const main = area.current; if (!main) return;
    const rect = main.getBoundingClientRect();
    const local = (ev) => ({ x: ev.clientX - rect.left + main.scrollLeft, y: ev.clientY - rect.top + main.scrollTop });
    const start = local(e);
    const base = e.ctrlKey || e.metaKey || e.shiftKey ? new Set(sel) : new Set();
    let rects = null; // item rectangles in content coordinates, measured once per drag (not on every mouse move)
    let dragging = false; let raf = 0; let last = null; let lastKey = '';
    rootRef.current?.focus({ preventScroll: true }); // keep keyboard focus on the explorer so Delete / Ctrl+A work right after a drag
    const measure = () => {
      rects = [];
      main.querySelectorAll('.mp-item[data-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        rects.push({ id: Number(el.dataset.id), x1: r.left - rect.left + main.scrollLeft, x2: r.right - rect.left + main.scrollLeft, y1: r.top - rect.top + main.scrollTop, y2: r.bottom - rect.top + main.scrollTop });
      });
    };
    const apply = () => {
      raf = 0;
      if (!last) return;
      const p = last;
      const x1 = Math.min(start.x, p.x); const x2 = Math.max(start.x, p.x);
      const y1 = Math.min(start.y, p.y); const y2 = Math.max(start.y, p.y);
      setBox({ x1, y1, x2, y2 });
      if (!rects) measure();
      const next = new Set(base);
      for (const r of rects) if (r.x1 < x2 && r.x2 > x1 && r.y1 < y2 && r.y2 > y1) next.add(r.id);
      const key = [...next].join(',');
      if (key !== lastKey) { lastKey = key; setSel(next); }
    };
    const move = (ev) => {
      const p = local(ev);
      if (!dragging) { if (Math.hypot(p.x - start.x, p.y - start.y) < 4) return; dragging = true; }
      if (ev.clientY > rect.bottom - 24) main.scrollTop += 14; else if (ev.clientY < rect.top + 24) main.scrollTop -= 14; // auto-scroll near an edge
      last = local(ev);
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (raf) cancelAnimationFrame(raf);
      setBox(null);
      if (dragging) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };

  // Every pop-up closes on: any press outside it (right-clicks included — they never fire "click", which is how two menus used to stay open
  // together), Escape, resize, or a scroll outside it. Only one of the three (toolbar pop-up / right-click menu) is ever open at a time.
  useEffect(() => {
    if (!newMenu && !sortMenu) return undefined;
    const close = () => { setNewMenu(false); setSortMenu(false); };
    const down = (e) => { if (!e.target.closest?.('.mp-pop') && !(newMenu || sortMenu).contains?.(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    const scroll = (e) => { if (!e.target.closest?.('.mp-pop')) close(); };
    window.addEventListener('click', close); window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); };
  }, [newMenu, sortMenu]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const down = (e) => { if (!e.target.closest?.('.mp-ctx')) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close); window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [menu]);

  const showMenu = (e, n) => {
    e.preventDefault(); e.stopPropagation();
    if (n && !sel.has(n.id)) { setSel(new Set([n.id])); setAnchor(n.id); }
    setNewMenu(false); setSortMenu(false);
    setMenu({ x: e.clientX, y: e.clientY, node: n || null });
  };

  const menuItems = () => {
    const n = menu?.node;
    const group = n ? (sel.has(n.id) ? selected : [n]) : [];
    const one = group.length === 1 ? group[0] : null;
    const out = [];
    if (one) out.push({ icon: one.type === 'folder' ? 'folder' : 'eye', label: tt('Open', 'فتح'), run: () => openNode(one) });
    if (one && one.type === 'folder' && !one.parent_id && one.kind !== 'project') out.push({ icon: 'hard-drive', label: one.kind === 'disk' ? tt('Convert to a normal folder', 'تحويل لمجلد عادي') : tt('Make it a disk', 'تحويله لقرص'), run: () => toggleDisk(one) });
    if (one && one.type === 'folder') out.push({ icon: 'terminal', label: tt('Open in code editor', 'فتح في محرر الأكواد'), run: () => setEditor({ kind: 'folder', node: one }) });
    if (one && one.type === 'folder' && onOpenWindow) out.push({ icon: 'terminal', label: tt('Open with VS Code', 'فتح بـ VS Code'), run: () => onOpenWindow({ kind: 'vscode', folder: { id: one.id, name: one.name } }) });
    if (one && one.type === 'file' && isTextName(one.name)) out.push({ icon: 'edit', label: tt('Edit', 'تعديل'), run: () => setEditor({ kind: 'text', node: one }) });
    if (one && one.type === 'file' && extOf(one.name) === 'zip') out.push({ icon: 'archive', label: tt('Extract here', 'فك الضغط هنا'), run: () => extract(one) });
    if (group.length) {
      out.push({ icon: 'download', label: tt('Download', 'تنزيل'), run: () => group.forEach(download), disabled: group.length > 1 });
      out.push({ icon: 'share', label: group.length > 1 ? tt(`Share ${group.length} items in one link`, `مشاركة ${group.length} عناصر في رابط واحد`) : tt('Share', 'مشاركة'), run: () => setDlg({ type: 'share', nodes: group }) });
      if (!inTrash) {
        const allFav = group.every((x) => marks.isFav(x.id));
        out.push({ icon: 'star', label: allFav ? tt('Remove from favorites', 'إزالة من المفضلة') : tt('Add to favorites', 'إضافة للمفضلة'), run: () => marks.setFav(group.map((x) => x.id), !allFav) });
        if (one) out.push({ icon: 'bookmark', label: tt('Tags…', 'التاجات…'), run: () => setDlg({ type: 'tags', node: one }) });
      }
      if (embedded && !inTrash) out.push({ icon: 'external-link', label: tt('Create desktop shortcut', 'إنشاء اختصار على سطح المكتب'), run: () => window.dispatchEvent(new CustomEvent('uip-desktop-shortcut', { detail: { ids: group.map((x) => x.id) } })) });
      if (one && one.type === 'file') out.push({ icon: 'clock', label: tt('Version history', 'سجل الإصدارات'), run: () => setDlg({ type: 'versions', node: one }) });
      out.push({ sep: true });
      out.push({ icon: 'copy', label: tt('Copy', 'نسخ'), hint: 'Ctrl+C', run: () => setClip({ ids: group.map((x) => x.id), mode: 'copy' }) });
      out.push({ icon: 'ed-crop', label: tt('Cut', 'قص'), hint: 'Ctrl+X', run: () => setClip({ ids: group.map((x) => x.id), mode: 'cut' }) });
    }
    if (clip) out.push({ icon: 'file-plus', label: tt('Paste', 'لصق'), hint: 'Ctrl+V', run: () => paste(one && one.type === 'folder' ? one.id : folderParam) });
    if (group.length) {
      out.push({ icon: 'archive', label: tt('Compress to ZIP', 'ضغط إلى ZIP'), run: () => zipSelected(group) });
      if (one) out.push({ icon: 'edit', label: tt('Rename', 'إعادة تسمية'), hint: 'F2', run: () => rename(one) });
      out.push({ sep: true });
      out.push({ icon: 'trash', label: tt('Delete', 'حذف'), hint: 'Del', danger: true, run: () => doDelete(group) });
    }
    if (!n) {
      if (embedded && !inTrash && data.breadcrumb.length) out.push({ icon: 'external-link', label: tt('Create desktop shortcut to this folder', 'إنشاء اختصار لهذا المجلد على سطح المكتب'), run: () => window.dispatchEvent(new CustomEvent('uip-desktop-shortcut', { detail: { ids: [data.breadcrumb[data.breadcrumb.length - 1].id] } })) });
      if (!folderParam) out.push({ icon: 'hard-drive', label: tt('New disk', 'قرص جديد'), run: newDisk });
      out.push({ icon: 'folder-plus', label: tt('New folder', 'مجلد جديد'), run: newFolder });
      out.push({ icon: 'file-plus', label: tt('New text file', 'ملف نصي جديد'), run: newFile });
      out.push({ icon: 'file-plus', label: tt('New document (Word, Excel, PowerPoint, PDF…)', 'مستند جديد (Word, Excel, PowerPoint, PDF…)'), run: () => newDoc('docx') });
      out.push({ icon: 'terminal', label: tt('New project', 'مشروع جديد'), run: newProject });
      out.push({ icon: 'file-up', label: tt('Upload files', 'رفع ملفات'), run: () => fileInput.current?.click() });
      if (data.breadcrumb.length) out.push({ icon: 'terminal', label: tt('Open this folder in code editor', 'فتح هذا المجلد في محرر الأكواد'), run: () => setEditor({ kind: 'folder', node: data.breadcrumb[data.breadcrumb.length - 1] }) });
      if (data.breadcrumb.length && onOpenWindow) { const cur = data.breadcrumb[data.breadcrumb.length - 1]; out.push({ icon: 'terminal', label: tt('Open this folder with VS Code', 'فتح هذا المجلد بـ VS Code'), run: () => onOpenWindow({ kind: 'vscode', folder: { id: cur.id, name: cur.name } }) }); }
    }
    return out;
  };

  // ---- recycle bin actions ----------------------------------------------------------------------------
  const emptyBin = () => setDlg({
    type: 'confirm', danger: true, title: tt('Empty recycle bin', 'تفريغ سلة المحذوفات'),
    text: tt('Everything in the recycle bin will be deleted permanently. This cannot be undone.', 'كل ما في السلة هيتحذف نهائيًا ومش هتقدر ترجعه.'),
    action: tt('Empty', 'تفريغ'), onOk: () => run(() => drive.emptyTrash(), tt('Recycle bin emptied.', 'تم تفريغ السلة.')),
  });

  act.current = {
    clickItem, openNode, showMenu, dropIds, onDropFiles,
    dragStart: (e, n) => {
      const ids = sel.has(n.id) ? sel : new Set([n.id]);
      const list = items.filter((x) => ids.has(x.id));
      setDragData(e.dataTransfer, list.length ? list : [n]);
    },
  };

  // ---- render -----------------------------------------------------------------------------------------
  const usage = data.usage;
  const crumbs = data.breadcrumb;
  const locationName = inTrash ? tt('Recycle bin', 'سلة المحذوفات') : (crumbs.length ? crumbs[crumbs.length - 1].name : tt('My PC', 'جهازي'));
  const currentFolder = crumbs.length ? crumbs[crumbs.length - 1] : null;
  const sortLabels = { name: tt('Name', 'الاسم'), date: tt('Modified', 'آخر تعديل'), size: tt('Size', 'الحجم'), type: tt('Type', 'النوع') };
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const startViewerIndex = viewer ? Math.max(0, viewerFiles.findIndex((f) => f.id === viewer.startId)) : 0;
  const chevron = ar ? 'chevron-left' : 'chevron-right';

  return (
    <div ref={rootRef} data-drive-drop="explorer" className={`mp${embedded ? ' mp--embedded' : ''}`} dir={ar ? 'rtl' : 'ltr'} tabIndex={-1} onKeyDown={onKey}
      onPointerDownCapture={(e) => { if (!e.target.closest('input, textarea, select, .mp-item, [contenteditable]')) window.setTimeout(() => { if (!rootRef.current?.contains(document.activeElement) || document.activeElement === document.body) rootRef.current?.focus({ preventScroll: true }); }, 0); }}>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => onPick(e, false)} />
      <input ref={dirInput} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => onPick(e, true)} />

      <div className="mp-top" data-os-drag>
        <button type="button" className="mp-ib mp-side-toggle" onClick={() => setSide((v) => !v)} aria-label={tt('Folders', 'المجلدات')}><Icon name="panel-left" size={18} /></button>
        <div className="mp-nav">
          <button type="button" className="mp-ib" onClick={() => goHist(-1)} disabled={!canBack} title={tt('Back', 'رجوع')} aria-label={tt('Back', 'رجوع')}><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={17} /></button>
          <button type="button" className="mp-ib" onClick={() => goHist(1)} disabled={!canFwd} title={tt('Forward', 'للأمام')} aria-label={tt('Forward', 'للأمام')}><Icon name={ar ? 'arrow-left' : 'arrow-right'} size={17} /></button>
          <button type="button" className="mp-ib" onClick={goUp} disabled={inTrash || !crumbs.length} title={tt('Up (Backspace)', 'للأعلى (Backspace)')} aria-label={tt('Up', 'للأعلى')}><Icon name="arrow-up" size={17} /></button>
          <button type="button" className="mp-ib" onClick={() => reload()} title={tt('Refresh', 'تحديث')} aria-label={tt('Refresh', 'تحديث')}><Icon name="refresh" size={16} /></button>
        </div>
        <nav className="mp-crumbs" aria-label="breadcrumb">
          <button type="button" className="mp-crumb" onClick={() => openFolder(null)}><Icon name="monitor" size={15} /> {tt('My PC', 'جهازي')}</button>
          {inTrash && <span className="mp-crumb-wrap"><Icon name={chevron} size={13} /><span className="mp-crumb is-last">{tt('Recycle bin', 'سلة المحذوفات')}</span></span>}
          {!inTrash && crumbs.map((c, i) => (
            <span key={c.id} className="mp-crumb-wrap">
              <Icon name={chevron} size={13} />
              <button
                type="button" className={`mp-crumb${i === crumbs.length - 1 ? ' is-last' : ''}`} onClick={() => openFolder(c.id)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-drive-ids')) e.preventDefault(); }}
                onDrop={(e) => dropIds(e, c.id)}
              ><span dir="auto">{c.name}</span></button>
            </span>
          ))}
        </nav>
        <label className="mp-search">
          <Icon name="search" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tt('Search My PC', 'ابحث في جهازي')} disabled={inTrash} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={tt('Clear', 'مسح')}><Icon name="x" size={13} /></button>}
        </label>
      </div>

      <div className="mp-bar" data-os-drag>
        {!inTrash ? (
          <>
            <div className="mp-menu-wrap">
              <button type="button" className="mp-btn mp-btn--primary" onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setSortMenu(false); setMenu(null); setNewMenu((v) => (v ? false : el)); }} aria-haspopup="menu" aria-expanded={!!newMenu}>
                <Icon name="plus" size={16} /> <span>{tt('New', 'جديد')}</span> <Icon name="chevron-down" size={12} />
              </button>
              {newMenu && (
                <Pop anchor={newMenu} rtl={ar} className="mp-pop--new">
                  <div className="mp-nm__label">{tt('Create', 'إنشاء')}</div>
                  {!folderParam && <button type="button" role="menuitem" onClick={() => { setNewMenu(false); newDisk(); }}><span className="mp-nm__ico mp-nm__ico--disk"><Icon name="hard-drive" size={16} /></span><span className="mp-nm__txt"><b>{tt('Disk', 'قرص')}</b><small>{tt('A new top-level drive', 'قرص جديد في الجذر')}</small></span></button>}
                  <button type="button" role="menuitem" onClick={() => { setNewMenu(false); newFolder(); }}><span className="mp-nm__ico mp-nm__ico--folder"><Icon name="folder-plus" size={16} /></span><span className="mp-nm__txt"><b>{tt('Folder', 'مجلد')}</b><small>{tt('Organise your files', 'نظّم ملفاتك')}</small></span></button>
                  <button type="button" role="menuitem" onClick={() => { setNewMenu(false); newFile(); }}><span className="mp-nm__ico mp-nm__ico--text"><Icon name="file-plus" size={16} /></span><span className="mp-nm__txt"><b>{tt('Text file', 'ملف نصي')}</b><small>{tt('Plain text, code, notes', 'نص، كود، ملاحظات')}</small></span></button>
                  <div className="mp-nm__sep" role="separator" />
                  <div className="mp-nm__label">{tt('Documents', 'مستندات')}</div>
                  {[['docx', 'Word document', 'مستند Word', 'word'], ['xlsx', 'Excel workbook', 'جدول Excel', 'excel'], ['pptx', 'PowerPoint', 'عرض PowerPoint', 'ppt'], ['pdf', 'PDF document', 'ملف PDF', 'pdf']].map(([k, en, arb, tone]) => (
                    <button key={k} type="button" role="menuitem" onClick={() => { setNewMenu(false); newDoc(k); }}><span className={`mp-nm__ico mp-nm__ico--${tone}`}><Icon name="file" size={16} /></span><span className="mp-nm__txt"><b>{tt(en, arb)}</b></span><span className="mp-nm__ext">.{k}</span></button>
                  ))}
                  <button type="button" role="menuitem" onClick={() => { setNewMenu(false); newDoc('docx'); }}><span className="mp-nm__ico mp-nm__ico--more"><Icon name="more-horizontal" size={16} /></span><span className="mp-nm__txt"><b>{tt('More file types…', 'أنواع ملفات أخرى…')}</b></span></button>
                  <div className="mp-nm__sep" role="separator" />
                  <button type="button" role="menuitem" onClick={() => { setNewMenu(false); newProject(); }}><span className="mp-nm__ico mp-nm__ico--proj"><Icon name="terminal" size={16} /></span><span className="mp-nm__txt"><b>{tt('Project', 'مشروع')}</b><small>{tt('Code workspace with a terminal', 'مساحة كود مع تيرمنال')}</small></span></button>
                </Pop>
              )}
            </div>
            <span className="mp-sep" />
            <button type="button" className="mp-btn" onClick={() => fileInput.current?.click()} title={tt('Upload files', 'رفع ملفات')}><Icon name="file-up" size={16} /> <span className="mp-lbl">{tt('Upload files', 'رفع ملفات')}</span></button>
            <button type="button" className="mp-btn" onClick={() => dirInput.current?.click()} title={tt('Upload folder', 'رفع مجلد')}><Icon name="folder-up" size={16} /> <span className="mp-lbl">{tt('Upload folder', 'رفع مجلد')}</span></button>
            {currentFolder && <button type="button" className="mp-btn" onClick={() => setEditor({ kind: 'folder', node: currentFolder })} title={tt('Code editor', 'محرر الأكواد')}><Icon name="terminal" size={16} /> <span className="mp-lbl">{tt('Code editor', 'محرر الأكواد')}</span></button>}
            {currentFolder && onOpenWindow && <button type="button" className="mp-btn" onClick={() => onOpenWindow({ kind: 'vscode', folder: { id: currentFolder.id, name: currentFolder.name } })} title={tt('Open this folder with VS Code', 'افتح المجلد ده بـ VS Code')}><Icon name="terminal" size={16} /> <span className="mp-lbl">VS Code</span></button>}
            <span className="mp-sep" />
            <button type="button" className="mp-ib" disabled={!selected.length} onClick={() => setClip({ ids: selected.map((n) => n.id), mode: 'copy' })} title={tt('Copy (Ctrl+C)', 'نسخ (Ctrl+C)')} aria-label={tt('Copy', 'نسخ')}><Icon name="copy" size={16} /></button>
            <button type="button" className="mp-ib" disabled={!selected.length} onClick={() => setClip({ ids: selected.map((n) => n.id), mode: 'cut' })} title={tt('Cut (Ctrl+X)', 'قص (Ctrl+X)')} aria-label={tt('Cut', 'قص')}><Icon name="ed-crop" size={16} /></button>
            <button type="button" className="mp-ib" disabled={!clip} onClick={() => paste()} title={tt('Paste (Ctrl+V)', 'لصق (Ctrl+V)')} aria-label={tt('Paste', 'لصق')}><Icon name="file-plus" size={16} /></button>
            <button type="button" className="mp-ib" disabled={selected.length !== 1} onClick={() => rename(selected[0])} title={tt('Rename (F2)', 'إعادة تسمية (F2)')} aria-label={tt('Rename', 'إعادة تسمية')}><Icon name="edit" size={16} /></button>
            <button type="button" className="mp-ib" disabled={!selected.length} onClick={() => setDlg({ type: 'share', nodes: selected })} title={selected.length > 1 ? tt('Share the selected items in one link', 'مشاركة المحدد في رابط واحد') : tt('Share', 'مشاركة')} aria-label={tt('Share', 'مشاركة')}><Icon name="share" size={16} /></button>
            <button type="button" className="mp-ib" disabled={!selected.length} onClick={() => zipSelected(selected)} title={tt('Compress to ZIP', 'ضغط إلى ZIP')} aria-label={tt('Compress to ZIP', 'ضغط إلى ZIP')}><Icon name="archive" size={16} /></button>
            <button type="button" className="mp-ib mp-danger" disabled={!selected.length} onClick={() => doDelete(selected)} title={tt('Delete (Del)', 'حذف (Del)')} aria-label={tt('Delete', 'حذف')}><Icon name="trash" size={16} /></button>
          </>
        ) : (
          <>
            <button type="button" className="mp-btn" onClick={() => openFolder(null)}><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={16} /> {tt('Back to My PC', 'العودة إلى جهازي')}</button>
            <button type="button" className="mp-btn mp-danger" disabled={!trash.length} onClick={emptyBin}><Icon name="trash" size={16} /> {tt('Empty recycle bin', 'تفريغ السلة')}</button>
          </>
        )}
        <span className="mp-grow" />
        {!inTrash && (
          <div className="mp-menu-wrap">
            <button type="button" className="mp-btn" onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setNewMenu(false); setMenu(null); setSortMenu((v) => (v ? false : el)); }} aria-haspopup="menu" aria-expanded={!!sortMenu}>
              <Icon name={sort.dir > 0 ? 'arrow-up' : 'arrow-down'} size={14} /> <span className="mp-lbl">{tt('Sort', 'ترتيب')}: {sortLabels[sort.key]}</span> <Icon name="chevron-down" size={12} />
            </button>
            {sortMenu && (
              <Pop anchor={sortMenu} end rtl={ar}>
                {Object.entries(sortLabels).map(([k, v]) => (
                  <button key={k} type="button" role="menuitemradio" aria-checked={sort.key === k} className={sort.key === k ? 'is-on' : ''} onClick={() => { setSort((x) => ({ key: k, dir: x.key === k ? x.dir : 1 })); setSortMenu(false); }}>
                    <span className="mp-pop__tick">{sort.key === k && <Icon name="check" size={14} />}</span>{v}
                  </button>
                ))}
                <div className="mp-ctx__sep" />
                {[[1, tt('Ascending', 'تصاعدي')], [-1, tt('Descending', 'تنازلي')]].map(([d, l]) => (
                  <button key={d} type="button" role="menuitemradio" aria-checked={sort.dir === d} className={sort.dir === d ? 'is-on' : ''} onClick={() => { setSort((x) => ({ ...x, dir: d })); setSortMenu(false); }}>
                    <span className="mp-pop__tick">{sort.dir === d && <Icon name="check" size={14} />}</span>{l}
                  </button>
                ))}
              </Pop>
            )}
          </div>
        )}
      </div>

      <div className="mp-body">
        <aside className={`mp-side${side ? ' is-open' : ''}`}>
          {embedded && <div className="mp-side__drag" data-os-drag aria-hidden="true" />}
          <p className="mp-side__head">{tt('Favorites', 'المفضلة')}</p>
          <ul className="mp-tree" role="tree">
            <li>
              <div className={`mp-tree__row mp-tree__root${!folderParam && !inTrash ? ' is-on' : ''}`} onClick={() => openFolder(null)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-drive-ids')) e.preventDefault(); }} onDrop={(e) => dropIds(e, null)}>
                <Icon name="monitor" size={16} /><span>{tt('My PC', 'جهازي')}</span>
              </div>
              <ul role="group">
                {(byParent.get(0) || []).map((n) => (
                  <TreeNode key={n.id} node={n} byParent={byParent} depth={1} openSet={openTree} activeId={inTrash ? null : folderParam}
                    toggle={(id) => setOpenTree((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; })}
                    onOpen={openFolder} onDropIds={dropIds} rtl={ar} />
                ))}
              </ul>
            </li>
          </ul>
          <ul className="mp-quick" aria-label={tt('Quick access', 'وصول سريع')}>
            <li><button type="button" className={special?.type === 'fav' ? 'is-on' : ''} onClick={() => showSpecial({ type: 'fav' })}><Icon name="star" size={16} /><span>{tt('Favorites', 'المفضلة')}</span>{marks.favs.length > 0 && <em>{marks.favs.length}</em>}</button></li>
            <li><button type="button" className={special?.type === 'shared' ? 'is-on' : ''} onClick={() => showSpecial({ type: 'shared' })}><Icon name="users" size={16} /><span>{tt('Shared with me', 'مشاركة معي')}</span>{marks.shared.length > 0 && <em>{marks.shared.length}</em>}</button></li>
            <li><button type="button" onClick={() => setDlg({ type: 'mylinks' })}><Icon name="link" size={16} /><span>{tt('My shared links', 'روابطي المشاركة')}</span></button></li>
            {marks.allTags.map((t) => (
              <li key={t.name}><button type="button" className={special?.type === 'tag' && special.tag === t.name ? 'is-on' : ''} onClick={() => showSpecial({ type: 'tag', tag: t.name })}><i className="mp-quick__dot" style={{ background: tagColor(t.name) }} /><span dir="auto">{t.name}</span><em>{t.count}</em></button></li>
            ))}
          </ul>
          <button type="button" className={`mp-bin${inTrash ? ' is-on' : ''}`} onClick={openTrashView}><Icon name="trash" size={16} /> {tt('Recycle bin', 'سلة المحذوفات')}</button>
          {usage && (
            <div className="mp-usage mp-usage--btn" title={tt('What is using my space?', 'إيه اللي واخد المساحة؟')} role="button" tabIndex={0}
              onClick={() => setDlg({ type: 'storage' })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDlg({ type: 'storage' }); } }}>
              <div className="mp-usage__top"><Icon name="monitor" size={15} /><strong>{tt('Local storage', 'مساحة التخزين')}</strong></div>
              <div className="mp-usage__bar"><i style={{ width: `${Math.max(1.5, Math.min(100, usage.percent))}%` }} className={usage.percent > 90 ? 'is-hot' : ''} /></div>
              <small>{tt(`${usage.used_human} of ${usage.quota_human} used`, `${usage.used_human} من ${usage.quota_human} مستخدمة`)}</small>
              <span className="mp-usage__more">{tt('Manage storage', 'إدارة المساحة')} <Icon name={ar ? 'chevron-left' : 'chevron-right'} size={12} /></span>
            </div>
          )}
        </aside>
        {side && <button type="button" className="mp-scrim" aria-label="close" onClick={() => setSide(false)} />}

        <main
          ref={area} className={`mp-main${dragOver ? ' is-drop' : ''}${box ? ' is-marquee' : ''}${special?.type === 'shared' ? ' is-shared' : ''}`}
          onPointerDown={onMainPointerDown}
          onClick={() => { if (suppressClick.current) return; setSel(new Set()); cursorRef.current = null; rootRef.current?.focus({ preventScroll: true }); }}
          onContextMenu={(e) => { if (!inTrash) showMenu(e, null); }}
          onDragOver={(e) => { if (!inTrash && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { if (!area.current?.contains(e.relatedTarget)) setDragOver(false); }}
          onDrop={(e) => (inTrash ? undefined : onDropFiles(e))}
        >
          {special?.type === 'shared' && <SharedWithMe marks={marks} tt={tt} />}
          {special && special.type !== 'shared' && !query.trim() && (
            <div className="mp-special">
              {special.type === 'fav' ? <Icon name="star" size={15} className="mp-star" /> : <i className="mp-quick__dot" style={{ background: tagColor(special.tag) }} />}
              <b dir="auto">{special.type === 'fav' ? tt('Favorites', 'المفضلة') : special.tag}</b>
              <button type="button" className="mp-btn" onClick={() => { setSpecial(null); setResults(null); }}>{tt('Back to files', 'رجوع للملفات')}</button>
            </div>
          )}
          {box && <div className="mp-marquee" aria-hidden="true" style={{ left: box.x1, top: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 }} />}
          {dragOver && <div className="mp-dropmsg"><Icon name="upload" size={30} /><strong>{tt(`Drop to upload to “${locationName}”`, `أفلت هنا للرفع إلى «${locationName}»`)}</strong></div>}
          {loading && <div className="mp-pad"><Skeleton h={64} count={5} /></div>}
          {!loading && error && <div className="mp-pad"><EmptyState icon="alert-triangle" title={tt('Could not load', 'تعذّر التحميل')} text={error}><button type="button" className="mp-btn mp-btn--primary" onClick={() => reload()}>{tt('Retry', 'إعادة المحاولة')}</button></EmptyState></div>}

          {!loading && !error && inTrash && (
            trash.length === 0
              ? <div className="mp-pad"><EmptyState icon="trash" title={tt('The recycle bin is empty', 'سلة المحذوفات فاضية')} text={tt('Deleted items stay here before they are removed for good.', 'العناصر المحذوفة بتفضل هنا قبل ما تتمسح نهائيًا.')} /></div>
              : (
                <ul className="mp-trash">
                  {trash.map((n) => (
                    <li key={n.id}>
                      <NodeIcon node={n} size={38} />
                      <div className="mp-trash__meta">
                        <strong dir="auto">{n.name}</strong>
                        <small>{[n.type === 'folder' ? tt(`${n.contains || 0} items inside`, `${n.contains || 0} عنصر بالداخل`) : n.size_human, n.deleted_at && timeAgo(n.deleted_at, locale)].filter(Boolean).join(' · ')}</small>
                      </div>
                      <button type="button" className="mp-btn" onClick={() => run(() => drive.restore([n.id]), tt('Restored.', 'تم الاسترجاع.'))}><Icon name="refresh" size={15} /> {tt('Restore', 'استرجاع')}</button>
                      <button
                        type="button" className="mp-btn mp-danger"
                        onClick={() => setDlg({ type: 'confirm', danger: true, title: tt('Delete permanently', 'حذف نهائي'), text: tt(`Delete “${n.name}” permanently? This cannot be undone.`, `حذف «${n.name}» نهائيًا؟ مش هتقدر ترجعه.`), action: tt('Delete forever', 'حذف نهائي'), onOk: () => run(() => drive.purge([n.id]), tt('Deleted permanently.', 'تم الحذف نهائيًا.')) })}
                      ><Icon name="trash" size={15} /> {tt('Delete forever', 'حذف نهائي')}</button>
                    </li>
                  ))}
                </ul>
              )
          )}

          {!loading && !error && !inTrash && diskCards.length > 0 && (
            <section className="mp-disks" aria-label={tt('Disks', 'الأقراص')}>
              <h4 className="mp-disks__h">{tt('Disks', 'الأقراص')}</h4>
              <div className="mp-disks__grid">
                {diskCards.map((d) => {
                  const pct = Math.max(0, Math.min(100, Number(d.percent) || 0));
                  return (
                    <div
                      key={d.id} data-id={d.id} role="option" aria-selected={sel.has(d.id)} tabIndex={0}
                      className={`mp-item mp-disk${sel.has(d.id) ? ' is-sel' : ''}`} data-node-id={d.id} data-node-type="folder"
                      onClick={(e) => clickItem(e, d)} onDoubleClick={(e) => { e.stopPropagation(); openFolder(d.id); }} onContextMenu={(e) => showMenu(e, d)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); openFolder(d.id); } }}
                      draggable onDragStart={(e) => setDragData(e.dataTransfer, [d])}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-drive-ids') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.currentTarget.classList.add('is-over'); } }}
                      onDragLeave={(e) => e.currentTarget.classList.remove('is-over')}
                      onDrop={(e) => { e.currentTarget.classList.remove('is-over'); if (e.dataTransfer.types.includes('application/x-drive-ids')) dropIds(e, d.id); else onDropFiles(e, d.id); }}
                    >
                      <span className="mp-disk__ic"><Icon name="hard-drive" size={30} /></span>
                      <span className="mp-disk__body">
                        <span className="mp-disk__top">
                          <b dir="auto" title={d.name}>{d.name}</b>
                          <button type="button" className="mp-disk__edit" title={tt('Rename disk', 'تغيير اسم القرص')} aria-label={tt('Rename disk', 'تغيير اسم القرص')} onClick={(e) => { e.stopPropagation(); rename(d); }}><Icon name="edit" size={13} /></button>
                        </span>
                        <span className="mp-usage__bar"><i style={{ width: `${d.used_bytes ? Math.max(1.5, pct) : 0}%` }} className={pct > 90 ? 'is-hot' : ''} /></span>
                        <small>{d.used_human != null
                          ? tt(`${d.used_human} used · ${d.files_count || 0} files`, `${d.used_human} مستخدمة · ${d.files_count || 0} ملف`)
                          : tt('Open to see its contents', 'افتحه عشان تشوف محتواه')}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
              {items.length > 0 && <h4 className="mp-disks__h mp-disks__h--sub">{tt('Folders and files', 'المجلدات والملفات')}</h4>}
            </section>
          )}
          {!loading && !error && !inTrash && (
            items.length === 0
              ? diskCards.length > 0 ? null : (
                <div className="mp-pad" hidden={content.items.length > 0 || content.loading}>
                  <EmptyState
                    icon={results ? 'search' : 'folder'}
                    title={special && special.type !== 'shared' ? (special.type === 'fav' ? tt('No favorites yet', 'مفيش مفضلة لسه') : tt('Nothing with this tag', 'مفيش حاجة بالتاج ده')) : results ? tt('No matches', 'لا توجد نتائج') : tt('This folder is empty', 'المجلد فاضي')}
                    text={special && special.type === 'fav' ? tt('Right-click a file or folder and choose “Add to favorites”.', 'كليك يمين على ملف أو مجلد واختار «إضافة للمفضلة».') : results ? tt('Try another name.', 'جرّب اسمًا آخر.') : tt('Drop files here, or create a folder or a project.', 'أفلت ملفات هنا، أو أنشئ مجلدًا أو مشروعًا.')}
                  />
                </div>
              )
              : (
                <div className={`mp-items is-${view}`} role="listbox" aria-multiselectable="true">
                  {view === 'list' && (
                    <div className="mp-head">
                      {['name', 'date', 'type', 'size'].map((k) => (
                        <button key={k} type="button" onClick={(e) => { e.stopPropagation(); toggleSort(k); }} className={`mp-head__${k}`}>
                          {sortLabels[k]} {sort.key === k && <Icon name={sort.dir > 0 ? 'arrow-up' : 'arrow-down'} size={11} />}
                        </button>
                      ))}
                    </div>
                  )}
                  {shownItems.map((n) => (
                    <ItemRow
                      key={n.id} n={n} view={view} ar={ar} locale={locale} act={act}
                      selected={sel.has(n.id)} cut={clip?.mode === 'cut' && cutSet.has(n.id)}
                      fav={marks.isFav(n.id)} tagsKey={marks.tagsOf(n.id).join('\u0001')} showPath={!!results}
                    />
                  ))}
                  {shownItems.length < items.length && <div ref={moreRef} className="mp-more" aria-hidden="true" />}
                </div>
              )
          )}
          {!loading && !error && !inTrash && <ContentMatches res={content} tt={tt} onOpen={(n) => openNode(n)} />}
        </main>
      </div>

      <footer className="mp-status">
        <span>{inTrash ? tt(`${trash.length} items`, `${trash.length} عنصر`) : tt(`${items.length} items`, `${items.length} عنصر`)}{selected.length ? ` · ${tt(`${selected.length} selected`, `${selected.length} محدد`)}` : ''}{selected.length && selected.every((n) => n.type === 'file') ? ` · ${selected.reduce((t, n) => t + (n.size_bytes || 0), 0) > 1048576 ? `${(selected.reduce((t, n) => t + (n.size_bytes || 0), 0) / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(selected.reduce((t, n) => t + (n.size_bytes || 0), 0) / 1024))} KB`}` : ''}</span>
        {clip && <span className="mp-status__clip">{clip.mode === 'cut' ? tt('Ready to move — paste where you want', 'جاهز للنقل — الصق في المكان المطلوب') : tt('Copied — paste where you want', 'تم النسخ — الصق في المكان المطلوب')}</span>}
        {busy && <span className="mp-spin" />}
        <span className="mp-grow" />
        {!inTrash && (
          <div className="mp-seg" role="group" aria-label={tt('View', 'العرض')}>
            <button type="button" className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')} title={tt('Details', 'تفاصيل')} aria-label={tt('Details', 'تفاصيل')}><Icon name="menu" size={15} /></button>
            <button type="button" className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')} title={tt('Large icons', 'أيقونات كبيرة')} aria-label={tt('Large icons', 'أيقونات كبيرة')}><Icon name="grid" size={15} /></button>
          </div>
        )}
      </footer>

      {queue.length > 0 && (
        <div className="mp-queue" role="status">
          <div className="mp-queue__head"><strong>{busyUploading ? tt('Uploading…', 'جارٍ الرفع…') : tt('Uploads', 'الرفع')}</strong>
            <button type="button" onClick={() => { pending.current = []; setQ((q) => q.filter((x) => x.status === 'uploading')); }} aria-label={tt('Clear', 'مسح')}><Icon name="x" size={14} /></button></div>
          <ul>
            {queue.slice(-30).map((q) => (
              <li key={q.uid} className={`is-${q.status}`}>
                <span dir="auto" title={q.rel}>{q.rel}</span>
                <em>{q.status === 'error' ? q.error : q.status === 'done' ? '✓' : q.status === 'queued' ? tt('Waiting', 'في الانتظار') : `${q.pct}%`}</em>
                {q.status === 'uploading' && <i style={{ width: `${q.pct}%` }} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!embedded && <DeleteProgressHost />}
      {toast && <div className={`mp-toast${toast.tone === 'error' ? ' is-error' : ''}`} role="status">{toast.msg}</div>}

      {menu && (
        <CtxMenu x={menu.x} y={menu.y} rtl={ar}>
          {menuItems().map((m, i) => (m.sep
            ? <li key={`s${i}`} className="mp-ctx__sep" role="separator" />
            : (
              <li key={m.label} role="none">
                <button type="button" role="menuitem" disabled={m.disabled} className={m.danger ? 'mp-danger' : ''} onClick={() => { setMenu(null); m.run(); }}>
                  <Icon name={m.icon} size={15} /><span>{m.label}</span>{m.hint && <kbd>{m.hint}</kbd>}
                </button>
              </li>
            )))}
        </CtxMenu>
      )}

      {dlg?.type === 'versions' && (
        <VersionHistoryDialog node={dlg.node} ar={ar} locale={locale} onClose={() => setDlg(null)} onToast={flash}
          onRestored={() => { reload({ quiet: true }); window.dispatchEvent(new Event('uip-drive-changed')); }} />
      )}
      {dlg?.type === 'storage' && <StorageDialog ar={ar} locale={locale} onClose={() => setDlg(null)} onOpenFolder={openFolder} />}
      {dlg?.type === 'share' && <ShareDialog nodes={dlg.nodes || [dlg.node]} ar={ar} locale={locale} onClose={() => setDlg(null)} onToast={flash} onManage={() => setDlg({ type: 'mylinks' })} />}
      {dlg?.type === 'mylinks' && <MySharedLinks ar={ar} locale={locale} onClose={() => setDlg(null)} onToast={flash} />}
      {dlg?.type === 'name' && <NameDialog dlg={dlg} tt={tt} onClose={() => setDlg(null)} />}
      {dlg?.type === 'tags' && <TagsDialog node={dlg.node} marks={marks} tt={tt} onClose={() => setDlg(null)} />}
      {dlg?.type === 'newfile' && (
        <NewFileDialog
          locale={locale} parentId={folderParam} initialType={dlg.kind} onClose={() => setDlg(null)}
          onCreated={async (node) => { pendingOpen.current = node.id; flash(tt('File created.', 'تم إنشاء الملف.')); await reload({ quiet: true }); }}
        />
      )}
      {dlg?.type === 'confirm' && (
        <StModal
          title={dlg.title} onClose={() => setDlg(null)}
          actions={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDlg(null)}>{tt('Cancel', 'إلغاء')}</button>
              <button type="button" autoFocus className={`btn ${dlg.danger ? 'btn-danger st-btn-danger st-btn-solid mp-confirm-danger' : 'btn-primary'}`} onClick={() => { const f = dlg.onOk; setDlg(null); f(); }}>{dlg.danger && <Icon name="trash" size={15} />}<span>{dlg.action}</span></button>
            </>
          )}
        ><p>{dlg.text}</p></StModal>
      )}
      {dlg?.type === 'project' && (
        <StModal
          title={tt('New project', 'مشروع جديد')} onClose={() => setDlg(null)}
          actions={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDlg(null)}>{tt('Cancel', 'إلغاء')}</button>
              <button
                type="button" className="btn btn-primary" disabled={!dlg.value.trim()}
                onClick={async () => { const d = dlg; setDlg(null); const r = await run(() => drive.createProject(folderParam, d.value.trim(), d.template), tt('Project created.', 'تم إنشاء المشروع.')); if (r?.data) setEditor({ kind: 'folder', node: r.data }); }}
              >{tt('Create & open', 'إنشاء وفتح')}</button>
            </>
          )}
        >
          <label className="mp-field"><span>{tt('Project name', 'اسم المشروع')}</span>
            <input autoFocus value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} maxLength={120} /></label>
          <div className="mp-tpl">
            {TEMPLATES.map((x) => (
              <button key={x.key} type="button" className={dlg.template === x.key ? 'is-on' : ''} onClick={() => setDlg({ ...dlg, template: x.key })}>
                <Icon name={x.icon} size={18} /><span>{ar ? x.ar : x.en}</span>
              </button>
            ))}
          </div>
        </StModal>
      )}

      {viewer && viewerFiles.length > 0 && (
        <FileViewer
          files={viewerFiles} startIndex={startViewerIndex} locale={locale} onClose={() => setViewer(null)}
          loadBlob={loadViewerBlob} onSaveFile={saveViewerFile}
          onEditText={(f) => { const n = items.find((x) => x.id === (f.driveId ?? f.id)); setViewerState(null); setEditor({ kind: 'text', node: n || { id: f.driveId ?? f.id, name: f.original_name } }); }}
          sandboxTokenPathOf={(f) => drive.sandboxTokenPath(f.driveId ?? f.id)}
        />
      )}
      {editor && editorLoad && (
        <EditorOverlay
          title={editor.node.name} load={editorLoad} onSave={editorSave} tt={tt} rtl={ar} onClose={() => setEditor(null)}
          sandboxTokenPath={editor.kind === 'folder' ? drive.sandboxTokenPath(editor.node.id) : undefined}
        />
      )}
    </div>
  );
}
