import { useEffect, useRef, useState } from 'react';
import useAutoDraft, { DraftChip } from '../../lib/useAutoDraft';
import { afterGuard, askUnsaved } from '../../lib/saveCenter';
import { discardDraft } from '../../lib/draftStore';
import { Btn } from './EditorUI';
import '../../styles/css/editor.css';
import '../../styles/css/office.css';

/**
 * Shared frame for the Office editors: title, save / download / cancel, unsaved-changes guard and 409 conflict handling.
 *   build() -> Promise<Blob>   (called for both Save and Download)
 */
export default function OfficeShell({ className = '', actionsRef, saveKeyRef, fileName, tt, guardRef, onSave, onClose, dirty, build, onSaved, tools, children, status, draftKey, draftToken, draftBuild, draftDelay }) {
  const saveRef = useRef(null);
  // draftBuild: a cheap snapshot for the local autosave (the full file is only built on Save / Download, never every few seconds)
  const draft = useAutoDraft({ draftKey, dirty, token: draftToken, build: draftBuild || build, delay: draftDelay, meta: { name: fileName }, saver: () => saveRef.current?.() });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [conflict, setConflict] = useState(false);
  // Promise<boolean>: the "Save changes?" dialog (Save / Don't save / Cancel) that says where the file is saved
  const ask = () => askUnsaved({ key: draftKey, name: fileName, tt, discard: () => discardDraft(draftKey) });

  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = () => !dirty || ask();
    return () => { guardRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, guardRef]);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const doSave = async (force) => {
    if (saving) return false;
    setSaving(true); setErr(''); setConflict(false);
    try {
      const out = await build();
      await onSave(out, { name: fileName, force: force === true });
      onSaved?.();
      return true;
    } catch (e) { if (e?.status === 409) setConflict(true); else setErr(e?.message || String(e)); return false; } finally { setSaving(false); }
  };
  saveRef.current = () => doSave(false);
  if (saveKeyRef) saveKeyRef.current = () => doSave(false); // lets the editor inside bind Ctrl+S to Save
  const download = async () => {
    try {
      const out = await build();
      const a = document.createElement('a'); a.href = URL.createObjectURL(out); a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e?.message || String(e)); }
  };

  if (actionsRef) actionsRef.current = { download, close: () => afterGuard(dirty ? ask() : true, onClose), exportAs: null, ...(actionsRef.current || {}), download, close: () => afterGuard(dirty ? ask() : true, onClose) };
  return (
    <div className={`ed ed--office ${className}`}>
      <div className="ed__top">
        <Btn icon="x" label={tt('Cancel', 'إلغاء')} onClick={() => afterGuard(dirty ? ask() : true, onClose)} />
        <strong className="ed__title" dir="auto">{fileName}</strong>
        {dirty && <span className="ed__pagecount">●&nbsp;{tt('unsaved', 'غير محفوظ')}</span>}
        <span className="ed__sp" />
        {conflict && (
          <span className="ed__warn">{tt('A newer version was saved by someone else.', 'حد تاني حفظ نسخة أحدث.')}
            <Btn label={tt('Save over it', 'احفظ فوقها')} onClick={() => doSave(true)} /></span>
        )}
        {err && <span className="ed__err" title={err}>{err}</span>}
        <DraftChip draft={draft} tt={tt} />
        <Btn icon="download" label={tt('Download', 'تنزيل')} onClick={download} />
        <Btn icon="save" label={saving ? tt('Saving…', 'جارٍ الحفظ…') : tt('Save', 'حفظ')} onClick={() => doSave(false)} disabled={!dirty || saving} primary />
      </div>
      {tools}
      <div className="ed__office-body">{children}</div>
      {status}
    </div>
  );
}
