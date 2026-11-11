import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { StModal } from './student/stUi';
import { errorMessage } from '../api/client';
import { drive, fetchDriveBlob } from '../lib/driveApi';
import { extOf, isTextName } from '../lib/driveFileKinds';
import { diffStats, foldDiff, lineDiff } from '../lib/lineDiff';
import { parseServerDate } from '../utils/serverDate';
import '../styles/css/drive-versions.css';

const MAX_TEXT = 400 * 1024; // bigger files are not rendered inline (download them instead)
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico']);
const CUR = 'current';

/** "Version history" of a My PC file: the copies kept before every save — preview, compare with the current file, restore, download. */
export default function VersionHistoryDialog({ node, ar, locale, onClose, onToast, onRestored }) {
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  const isText = isTextName(node.name);
  const isImg = IMG_EXT.has(extOf(node.name));
  const [data, setData] = useState(null); // { node, items, limit }
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null); // CUR | version id
  const [view, setView] = useState('changes'); // changes | content (text files)
  const [body, setBody] = useState({ status: 'idle' }); // { status, text?, url?, size?, curText? }
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'restore:<id>' | 'delete:<id>'
  const urlRef = useRef(null);
  const curTextRef = useRef(null);

  const fmt = useCallback((v) => {
    const d = parseServerDate(v);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale === 'ar' ? 'ar-EG' : undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, [locale]);

  const load = useCallback(async (pick) => {
    try {
      const r = await drive.versions(node.id);
      setData(r);
      setError('');
      setSel((cur) => (pick !== undefined ? pick : (cur ?? (r.items[0]?.id ?? CUR))));
    } catch (e) { setError(errorMessage(e)); setData({ node: null, items: [], limit: 0 }); }
  }, [node.id]);
  useEffect(() => { load(); }, [load]);

  // load what is selected
  useEffect(() => {
    if (sel === null || !data) return undefined;
    let dead = false;
    const drop = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; } };
    drop();
    setBody({ status: 'loading' });
    (async () => {
      try {
        const blob = sel === CUR ? await fetchDriveBlob(node.id) : await drive.versionBlob(node.id, sel);
        if (dead) return;
        if (isText) {
          if (blob.size > MAX_TEXT) { setBody({ status: 'big', size: blob.size }); return; }
          const text = await blob.text();
          if (dead) return;
          if (sel === CUR) curTextRef.current = text;
          let curText = curTextRef.current;
          if (sel !== CUR && curText === null) {
            const cb = await fetchDriveBlob(node.id);
            curText = cb.size > MAX_TEXT ? false : await cb.text();
            curTextRef.current = curText;
          }
          if (!dead) setBody({ status: 'ready', text, curText });
        } else if (isImg) {
          urlRef.current = URL.createObjectURL(blob);
          setBody({ status: 'ready', url: urlRef.current });
        } else setBody({ status: 'ready' });
      } catch (e) { if (!dead) setBody({ status: 'error', error: errorMessage(e) }); }
    })();
    return () => { dead = true; };
  }, [sel, data, node.id, isText, isImg]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => { setConfirm(null); }, [sel]);

  const item = data?.items.find((x) => x.id === sel) || null;
  const diff = useMemo(() => {
    if (!isText || sel === CUR || body.status !== 'ready' || typeof body.curText !== 'string') return null;
    const ops = lineDiff(body.text, body.curText);
    return ops ? { rows: foldDiff(ops), ...diffStats(ops) } : null;
  }, [isText, sel, body]);

  const reasonText = (r) => (r === 'sync' ? tt('Saved from the code editor', 'اتحفظ من محرر الأكواد') : r === 'restore' ? tt('Before a restore', 'قبل استرجاع') : tt('Before a save', 'قبل حفظ'));

  const download = async () => {
    try {
      const blob = sel === CUR ? await fetchDriveBlob(node.id) : await drive.versionBlob(node.id, sel);
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = item?.name || node.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) { setError(errorMessage(e)); }
  };
  const restore = async () => {
    if (confirm !== `restore:${sel}`) { setConfirm(`restore:${sel}`); return; }
    setBusy(true); setError('');
    try {
      await drive.restoreVersion(node.id, sel);
      curTextRef.current = null;
      onToast?.(tt('Version restored. The previous content was kept in the history.', 'تم استرجاع النسخة. المحتوى السابق فضل في السجل.'));
      onRestored?.();
      await load(CUR);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); setConfirm(null); }
  };
  const remove = async () => {
    if (confirm !== `delete:${sel}`) { setConfirm(`delete:${sel}`); return; }
    setBusy(true); setError('');
    try {
      await drive.deleteVersion(node.id, sel);
      onToast?.(tt('Version deleted.', 'تم حذف النسخة.'));
      await load(CUR);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); setConfirm(null); }
  };

  const cur = data?.node;
  return (
    <StModal wide title={`${tt('Version history', 'سجل الإصدارات')} — ${node.name}`} onClose={onClose}
      actions={<button type="button" className="btn btn-primary" onClick={onClose}>{tt('Done', 'تم')}</button>}>
      <div className="mp-ver">
        <p className="mp-ver__hint">
          {tt('Every time this file is saved over, the old copy is kept here, so you can look at it, compare it, or go back to it.', 'كل ما الملف يتحفظ فوقه، النسخة القديمة بتفضل هنا، تقدر تشوفها وتقارنها وترجع لها.')}
          {data?.limit ? tt(` The last ${data.limit} copies are kept.`, ` بنحتفظ بآخر ${data.limit} نسخة.`) : ''}
        </p>
        {error && <div className="mp-share__err" role="alert">{error}</div>}
        {data === null && <div className="mp-share__empty">{tt('Loading…', 'جارِ التحميل…')}</div>}
        {data && (
          <div className="mp-ver__cols">
            <ul className="mp-ver__list" role="listbox" aria-label={tt('Versions', 'النسخ')}>
              <li>
                <button type="button" role="option" aria-selected={sel === CUR} className={sel === CUR ? 'is-on' : ''} onClick={() => setSel(CUR)}>
                  <b>{tt('Current version', 'النسخة الحالية')}</b>
                  <small>{cur ? `${cur.size_human} · ${fmt(cur.updated_at)}` : ''}</small>
                </button>
              </li>
              {data.items.map((v) => (
                <li key={v.id}>
                  <button type="button" role="option" aria-selected={sel === v.id} className={sel === v.id ? 'is-on' : ''} onClick={() => setSel(v.id)}>
                    <b>{tt('Replaced ', 'اتبدّلت ')}{fmt(v.created_at)}</b>
                    <small>{v.size_human} · {reasonText(v.reason)}</small>
                  </button>
                </li>
              ))}
              {data.items.length === 0 && <li className="mp-ver__none">{tt('No older versions yet. They appear after the next save.', 'مفيش نسخ قديمة لسه. هتظهر بعد أول حفظ جديد.')}</li>}
            </ul>

            <section className="mp-ver__pane">
              <div className="mp-ver__bar">
                <span className="mp-ver__title">{sel === CUR ? tt('Current version', 'النسخة الحالية') : (item ? `${tt('Replaced ', 'اتبدّلت ')}${fmt(item.created_at)}` : '')}</span>
                {isText && sel !== CUR && (
                  <div className="mp-ver__seg" role="group">
                    <button type="button" className={view === 'changes' ? 'is-on' : ''} onClick={() => setView('changes')}>{tt('Changes', 'التغييرات')}</button>
                    <button type="button" className={view === 'content' ? 'is-on' : ''} onClick={() => setView('content')}>{tt('Content', 'المحتوى')}</button>
                  </div>
                )}
                <span className="mp-ver__sp" />
                <button type="button" className="btn btn-ghost" onClick={download} disabled={busy}><Icon name="download" size={14} /><span>{tt('Download', 'تنزيل')}</span></button>
                {sel !== CUR && item && (
                  <>
                    <button type="button" className="btn btn-ghost mp-ver__del" onClick={remove} disabled={busy}><Icon name="trash" size={14} /><span>{confirm === `delete:${sel}` ? tt('Sure? Delete', 'متأكد؟ احذف') : tt('Delete', 'حذف')}</span></button>
                    <button type="button" className="btn btn-primary" onClick={restore} disabled={busy}><Icon name="ed-undo" size={14} /><span>{confirm === `restore:${sel}` ? tt('Confirm restore', 'تأكيد الاسترجاع') : tt('Restore this version', 'استرجاع النسخة دي')}</span></button>
                  </>
                )}
              </div>
              {sel !== CUR && diff && view === 'changes' && <div className="mp-ver__stat"><span className="is-add">+{diff.added}</span><span className="is-del">−{diff.removed}</span><em>{tt('what changed from this version to the current file (green = added since, red = removed since)', 'اللي اتغيّر من النسخة دي للملف الحالي (أخضر = اتضاف بعدها، أحمر = اتشال بعدها)')}</em></div>}
              <div className="mp-ver__view">
                {body.status === 'loading' && <div className="mp-ver__msg"><span className="mp-spin" /></div>}
                {body.status === 'error' && <div className="mp-ver__msg is-error">{body.error}</div>}
                {body.status === 'big' && <div className="mp-ver__msg">{tt('This file is too large to preview here — download it instead.', 'الملف كبير على المعاينة هنا — نزّله بدل كده.')}</div>}
                {body.status === 'ready' && isText && (sel === CUR || view === 'content' || !diff) && <pre className="mp-ver__code" dir="auto">{body.text || tt('(empty file)', '(ملف فاضي)')}</pre>}
                {body.status === 'ready' && isText && sel !== CUR && view === 'changes' && diff && (
                  diff.added + diff.removed === 0
                    ? <div className="mp-ver__msg">{tt('Identical to the current file.', 'مطابقة للملف الحالي.')}</div>
                    : <div className="mp-ver__diff" dir="ltr">
                      {diff.rows.map((r, i) => (r.t === 'gap'
                        ? <div key={i} className="mp-ver__ln is-gap">⋯ {tt(`${r.n} unchanged lines`, `${r.n} سطر من غير تغيير`)}</div>
                        : <div key={i} className={`mp-ver__ln${r.t === '+' ? ' is-add' : r.t === '-' ? ' is-del' : ''}`}><i>{r.t === '=' ? ' ' : r.t}</i><span>{r.s || ' '}</span></div>))}
                    </div>
                )}
                {body.status === 'ready' && !isText && isImg && body.url && <div className="mp-ver__img"><img src={body.url} alt={node.name} /></div>}
                {body.status === 'ready' && !isText && !isImg && <div className="mp-ver__msg">{tt('No preview for this file type — download it or restore it.', 'مفيش معاينة لنوع الملف ده — نزّله أو استرجعه.')}</div>}
              </div>
            </section>
          </div>
        )}
      </div>
    </StModal>
  );
}
