import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { useTt } from './shared';

let sheetSeq = 0; // only one save sheet can be open: a newer one closes any older one
const LAST_KEY = 'uip_posts_last_collection';
const readLast = () => { try { const v = localStorage.getItem(LAST_KEY); return v ? Number(v) : null; } catch { return null; } };

/**
 * Save sheet (like Facebook): pick where to keep a post — "Saved" (no folder) or one of your folders, or make a new folder.
 * When the post is already saved it works as a manager: move it to another folder, or remove it from saved (with a confirmation).
 */
export default function SaveDialog({ post, onClose, onDone }) {
  const { tt } = useTt();
  const already = !!post.saved;
  const [cols, setCols] = useState(null);
  const [sel, setSel] = useState(already ? post.saved_collection_id ?? null : readLast());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    postsApi.collections().then((r) => { setCols(r.items || []); if (!already && readLast() && !(r.items || []).some((c) => c.id === readLast())) setSel(null); }).catch((e) => { setCols([]); setErr(errorMessage(e)); });
  }, [already]);
  useEffect(() => {
    const me = ++sheetSeq;
    const h = (e) => { if (e.detail !== me) onClose(); };
    window.addEventListener('pp-save-sheet', h);
    window.dispatchEvent(new CustomEvent('pp-save-sheet', { detail: me }));
    return () => window.removeEventListener('pp-save-sheet', h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  const wrap = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  const addFolder = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    wrap(async () => { const c = await postsApi.createCollection(name.trim()); setCols((p) => [...(p || []), c]); setSel(c.id); setName(''); setAdding(false); });
  };
  const save = () => wrap(async () => {
    const r = await postsApi.saveTo(post.id, sel);
    try { if (sel) localStorage.setItem(LAST_KEY, String(sel)); else localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
    const folder = sel ? (cols || []).find((c) => c.id === sel)?.name : null;
    onDone({ saved: true, collection_id: sel, saves_count: r.saves_count, folder, moved: already });
  });
  const unsave = () => wrap(async () => { const r = await postsApi.unsave(post.id); onDone({ saved: false, collection_id: null, saves_count: r.saves_count }); });

  const opt = (id, icon, label, sub) => (
    <button type="button" key={id ?? 'none'} className={`sv-opt${sel === id ? ' is-on' : ''}`} onClick={() => setSel(id)} role="radio" aria-checked={sel === id}>
      <span className="sv-opt__ico"><Icon name={icon} size={18} /></span>
      <span className="sv-opt__t"><strong>{label}</strong>{sub != null && <small>{sub}</small>}</span>
      <span className="sv-opt__radio" aria-hidden="true">{sel === id && <Icon name="check" size={13} />}</span>
    </button>
  );

  return createPortal(
    <div className="sv-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sv-sheet" role="dialog" aria-modal="true" aria-label={tt('Save post', 'حفظ المنشور')}>
        {confirm ? (
          <div className="sv-confirm">
            <span className="sv-confirm__ico"><Icon name="bookmark" size={26} /></span>
            <h3>{tt('Remove from saved?', 'إلغاء حفظ المنشور؟')}</h3>
            <p>{tt('This post will be removed from your saved items. You can save it again any time.', 'سيُزال هذا المنشور من محفوظاتك، ويمكنك حفظه مرة أخرى في أي وقت.')}</p>
            {err && <small className="pp-err">{err}</small>}
            <div className="sv-actions">
              <button type="button" className="pp-btn" onClick={() => setConfirm(false)} disabled={busy}>{tt('Keep saved', 'إبقاء محفوظًا')}</button>
              <button type="button" className="pp-btn sv-danger" onClick={unsave} disabled={busy}>{busy ? tt('Removing…', 'جارٍ الإزالة…') : tt('Remove', 'إلغاء الحفظ')}</button>
            </div>
          </div>
        ) : (
          <>
            <header className="sv-head">
              <span className="sv-head__ico"><Icon name="bookmark" size={20} /></span>
              <div><h3>{already ? tt('Saved post', 'منشور محفوظ') : tt('Save to…', 'احفظ في…')}</h3><small>{already ? tt('Move it to another folder or remove it.', 'انقله إلى مجلد آخر أو أزله من المحفوظات.') : tt('Choose where to keep this post.', 'اختر مكان حفظ هذا المنشور.')}</small></div>
              <button type="button" className="pp-icon" onClick={onClose} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
            </header>
            <div className="sv-list" role="radiogroup">
              {opt(null, 'bookmark', tt('Saved items', 'المحفوظات'), tt('No folder', 'بدون مجلد'))}
              {cols === null && <div className="pp-skel" style={{ height: 52 }} />}
              {(cols || []).map((c) => opt(c.id, 'folder', c.name, tt(`${c.count} saved`, `${c.count} محفوظ`)))}
            </div>
            {adding ? (
              <form className="sv-new" onSubmit={addFolder}>
                <input className="pp-input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={tt('Folder name', 'اسم المجلد')} />
                <button className="pp-btn is-primary" disabled={!name.trim() || busy}>{tt('Create', 'إنشاء')}</button>
                <button type="button" className="pp-btn" onClick={() => { setAdding(false); setName(''); }}>{tt('Cancel', 'إلغاء')}</button>
              </form>
            ) : <button type="button" className="sv-add" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> {tt('New folder', 'مجلد جديد')}</button>}
            {err && <small className="pp-err sv-err">{err}</small>}
            <footer className="sv-foot">
              {already && <button type="button" className="pp-btn sv-danger-o" onClick={() => setConfirm(true)} disabled={busy}><Icon name="trash" size={14} /> {tt('Remove from saved', 'إلغاء الحفظ')}</button>}
              <span className="pp-sp" />
              <button type="button" className="pp-btn" onClick={onClose} disabled={busy}>{tt('Cancel', 'إلغاء')}</button>
              <button type="button" className="pp-btn is-primary" onClick={save} disabled={busy || (already && sel === (post.saved_collection_id ?? null))}>{busy ? '…' : already ? tt('Move', 'نقل') : tt('Save', 'حفظ')}</button>
            </footer>
          </>
        )}
      </div>
    </div>, document.body);
}
