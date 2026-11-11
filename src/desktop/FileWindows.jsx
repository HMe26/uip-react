import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync, zipSync } from 'fflate';
import { errorMessage } from '../api/client';
import Icon from '../components/Icon';
import FileViewer from '../components/FileViewer';
import { drive, fetchDriveBlob, fetchFolderZip } from '../lib/driveApi';
import useDraftScope from '../lib/useDraftScope';
import '../styles/css/my-pc.css'; // .mp-editor / .mp-spin (also loaded by the Explorer window)

const ZipWorkbench = lazy(() => import('../components/zipbench/ZipWorkbench'));

/** Tell the Explorer window / desktop that a file window changed something in My PC. */
const changed = () => window.dispatchEvent(new Event('uip-drive-changed'));

/** Images, PDFs, office files, media, ZIPs… in a normal desktop window (same viewer + editors as the full-screen one). */
export function ViewerWindow({ files, startId, locale, registerGuard, onClose, onEditText }) {
  const loadBlob = useCallback((file, { onProgress } = {}) => fetchDriveBlob(file.driveId ?? file.id, { onProgress }), []);
  const saveFile = useCallback(async (file, blob, opts) => {
    const res = await drive.replace(file.id, blob, opts?.name || file.original_name);
    changed();
    return { id: res.data.id, original_name: res.data.name };
  }, []);
  const sandboxTokenPathOf = useCallback((f) => drive.sandboxTokenPath(f.driveId ?? f.id), []);
  const startIndex = Math.max(0, files.findIndex((f) => f.id === startId));
  return (
    <FileViewer
      embedded files={files} startIndex={startIndex} locale={locale} onClose={onClose} registerGuard={registerGuard}
      loadBlob={loadBlob} onSaveFile={saveFile} onEditText={onEditText} sandboxTokenPathOf={sandboxTokenPathOf}
    />
  );
}

/** The code / ZIP workbench for a folder (or one text file wrapped as a one-entry ZIP) in a desktop window. */
export function EditorWindow({ editor, locale, registerGuard }) {
  const ar = locale === 'ar';
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  const { node } = editor;
  const draftScope = useDraftScope();
  const draftKey = `zip:${draftScope}:${editor.kind}:${node.id}`; // edits + open tabs survive a refresh (see zipDraft.js)
  const [state, setState] = useState({ status: 'loading', blob: null, error: '' });
  const guardRef = useRef(null);

  useEffect(() => {
    registerGuard?.(() => !guardRef.current || guardRef.current());
    return () => registerGuard?.(null);
  }, [registerGuard]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        let blob;
        if (editor.kind === 'folder') blob = await fetchFolderZip(node.id);
        else {
          const bytes = new Uint8Array(await (await fetchDriveBlob(node.id)).arrayBuffer());
          blob = new Blob([zipSync({ [node.name]: bytes })], { type: 'application/zip' });
        }
        if (!dead) setState({ status: 'ready', blob, error: '' });
      } catch (err) {
        if (!dead) setState({ status: 'error', blob: null, error: errorMessage(err) });
      }
    })();
    return () => { dead = true; };
  }, [editor.kind, node.id, node.name]);

  const onSave = useMemo(() => async (blob) => {
    if (editor.kind === 'folder') {
      const r = await drive.sync(node.id, blob);
      changed();
      const s = r.data || {};
      return { message: tt(`Saved to My PC — ${s.added || 0} added, ${s.updated || 0} updated, ${s.removed || 0} removed.`, `تم الحفظ في جهازي — ${s.added || 0} مضاف، ${s.updated || 0} معدّل، ${s.removed || 0} محذوف.`) };
    }
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const first = files[node.name] ? node.name : Object.keys(files).find((k) => !k.endsWith('/'));
    if (!first) throw new Error(tt('The file was removed from the editor.', 'تم حذف الملف من المحرر.'));
    await drive.replace(node.id, new Blob([files[first]]), node.name);
    changed();
    return { message: tt('Saved to My PC.', 'تم الحفظ في جهازي.') };
  }, [editor.kind, node.id, node.name, tt]);

  return (
    <div className="mp-editor mp-editor--win" dir={ar ? 'rtl' : 'ltr'}>
      <div className="mp-editor__body">
        {state.status === 'loading' && <div className="mp-editor__msg"><span className="mp-spin" />{tt('Loading…', 'جارٍ التحميل…')}</div>}
        {state.status === 'error' && <div className="mp-editor__msg is-error"><Icon name="alert-triangle" size={22} />{state.error}</div>}
        {state.status === 'ready' && (
          <Suspense fallback={<div className="mp-editor__msg"><span className="mp-spin" /></div>}>
            <ZipWorkbench
              blob={state.blob} fileName={`${node.name}.zip`} tt={tt} guardRef={guardRef} onSave={onSave} draftKey={draftKey}
              sandboxTokenPath={drive.sandboxTokenPath(node.id)} /* folders, ZIPs AND single files (a lone .cpp / .java / … opens as a one-file archive) */
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
