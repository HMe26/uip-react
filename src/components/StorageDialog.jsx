import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { StModal, timeAgo } from './student/stUi';
import { errorMessage } from '../api/client';
import { drive } from '../lib/driveApi';
import '../styles/css/storage-monitor.css';

const CATS = {
  images: { en: 'Images', ar: 'صور', color: '#a855f7' },
  video: { en: 'Video', ar: 'فيديو', color: '#ef4444' },
  audio: { en: 'Audio', ar: 'صوت', color: '#f59e0b' },
  documents: { en: 'Documents', ar: 'مستندات', color: '#3b82f6' },
  code: { en: 'Code & data', ar: 'أكواد وبيانات', color: '#10b981' },
  archives: { en: 'Archives', ar: 'أرشيفات', color: '#ec4899' },
  other: { en: 'Other', ar: 'أخرى', color: '#94a3b8' },
};
const TRASH_COLOR = '#64748b';

export function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)) - 1);
  const v = n / 1024 ** (i + 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** "What is using my space?" — categories, biggest files / folders, recycle bin, old versions, duplicates — with quick cleanup. */
export default function StorageDialog({ ar, locale, onClose, onOpenFolder }) {
  const tt = useCallback((en, a) => (ar ? a : en), [ar]);
  const [rep, setRep] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false); // second click needed for "delete permanently"
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try { setRep(await drive.storage()); setError(''); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changed = () => window.dispatchEvent(new Event('uip-drive-changed'));
  const act = async (fn, msg) => {
    setBusy(true); setError(''); setNote('');
    try { const r = await fn(); setSel(new Set()); setConfirm(false); await load(); changed(); setNote(typeof msg === 'function' ? msg(r) : msg || ''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const toggle = (id) => { setConfirm(false); setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const ids = [...sel];
  const allFiles = useMemo(() => {
    const m = new Map();
    (rep?.largest || []).forEach((f) => m.set(f.id, f));
    (rep?.duplicates?.groups || []).forEach((g) => g.files.forEach((f) => m.set(f.id, { ...f, size_bytes: g.size_bytes })));
    return m;
  }, [rep]);
  const selBytes = ids.reduce((a, id) => a + (allFiles.get(id)?.size_bytes || 0), 0);

  const toTrash = () => act(() => drive.trash(ids), tt('Moved to the recycle bin — empty it to free the space.', 'اتنقلت للسلة — فرّغ السلة عشان المساحة تتحرر.'));
  const purgeNow = () => act(async () => { await drive.trash(ids); await drive.purge(ids); }, tt(`Deleted permanently — ${fmtBytes(selBytes)} freed.`, `اتحذفت نهائيًا — اتحررت ${fmtBytes(selBytes)}.`));
  const emptyBin = () => act(() => drive.emptyTrash(), tt('Recycle bin emptied.', 'تم تفريغ السلة.'));
  const clearVersions = () => act(() => drive.clearVersions(), (r) => tt(`Old versions deleted — ${r?.freed_human || ''} freed.`, `اتحذفت النسخ القديمة — اتحررت ${r?.freed_human || ''}.`));
  const show = (parentId) => { onOpenFolder?.(parentId); onClose(); };

  const u = rep?.usage;
  const quota = u?.quota_bytes || 1;
  const segs = rep ? [
    ...rep.categories.map((c) => ({ key: c.key, bytes: c.bytes, color: (CATS[c.key] || CATS.other).color, label: ar ? (CATS[c.key] || CATS.other).ar : (CATS[c.key] || CATS.other).en, count: c.count })),
    ...(rep.trash.bytes > 0 ? [{ key: 'trash', bytes: rep.trash.bytes, color: TRASH_COLOR, label: tt('Recycle bin', 'سلة المحذوفات'), count: rep.trash.count }] : []),
  ] : [];

  const renderRow = (f, size) => (
    <li key={f.id} className={`sm-row${sel.has(f.id) ? ' is-sel' : ''}`}>
      <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} aria-label={f.name} />
      <span className="sm-row__main"><b dir="auto" title={f.name}>{f.name}</b><small dir="auto">{f.path || tt('My PC', 'جهازي')}</small></span>
      <span className="sm-row__meta">{size}</span>
      <span className="sm-row__date">{f.updated_at ? timeAgo(f.updated_at, locale) : ''}</span>
      {f.parent_id !== undefined && <button type="button" className="sm-link" onClick={() => show(f.parent_id)}>{tt('Show', 'إظهار')}</button>}
    </li>
  );

  const actionBar = ids.length > 0 && (
    <div className="sm-actions" role="region" aria-live="polite">
      <span>{tt(`${ids.length} selected · ${fmtBytes(selBytes)}`, `${ids.length} محدد · ${fmtBytes(selBytes)}`)}</span>
      <span className="sm-grow" />
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={toTrash}><Icon name="trash" size={14} /> {tt('Move to recycle bin', 'نقل للسلة')}</button>
      <button type="button" className={`btn ${confirm ? 'btn-danger st-btn-danger st-btn-solid' : 'btn-ghost sm-danger'}`} disabled={busy} onClick={() => (confirm ? purgeNow() : setConfirm(true))}>
        {confirm ? tt('Click again to delete forever', 'اضغط تاني للحذف النهائي') : tt('Delete permanently', 'حذف نهائي')}
      </button>
    </div>
  );

  return (
    <StModal wide title={tt('Storage', 'مراقب التخزين')} onClose={onClose} actions={<button type="button" className="btn btn-primary" onClick={onClose}>{tt('Done', 'تم')}</button>}>
      <div className="sm">
        {!rep && !error && <div className="sm-empty">{tt('Analyzing your files…', 'جارٍ تحليل ملفاتك…')}</div>}
        {error && <div className="mp-share__err" role="alert">{error}</div>}
        {note && !error && <div className="sm-note" role="status">{note}</div>}

        {rep && (
          <>
            <div className="sm-top">
              <strong>{u.used_human}</strong> <span>{tt(`of ${u.quota_human} used`, `من ${u.quota_human}`)} · {u.percent}%</span>
            </div>
            <div className="sm-bar" role="img" aria-label={`${u.percent}%`}>
              {segs.map((s) => <i key={s.key} title={`${s.label}: ${fmtBytes(s.bytes)}`} style={{ width: `${Math.max(0, Math.min(100, (s.bytes * 100) / quota))}%`, background: s.color }} />)}
            </div>
            <ul className="sm-legend">
              {segs.map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}<small>{fmtBytes(s.bytes)}</small></li>)}
            </ul>

            <div className="sm-tabs" role="tablist">
              {[['overview', tt('Overview', 'نظرة عامة')], ['large', tt('Large files', 'ملفات كبيرة')], ['dups', tt(`Duplicates${rep.duplicates.groups.length ? ` (${rep.duplicates.groups.length})` : ''}`, `مكررات${rep.duplicates.groups.length ? ` (${rep.duplicates.groups.length})` : ''}`)]].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => { setTab(k); setConfirm(false); }}>{l}</button>
              ))}
            </div>

            {tab === 'overview' && (
              <>
                <div className="sm-cards">
                  <div className="sm-card">
                    <Icon name="trash" size={18} />
                    <div><b>{tt('Recycle bin', 'سلة المحذوفات')}</b><small>{rep.trash.count ? tt(`${rep.trash.human} in ${rep.trash.count} file(s) — still counted in your space`, `${rep.trash.human} في ${rep.trash.count} ملف — لسه محسوبة من مساحتك`) : tt('Empty', 'فاضية')}</small></div>
                    <button type="button" className="btn btn-ghost" disabled={busy || !rep.trash.count} onClick={emptyBin}>{tt('Empty', 'تفريغ')}</button>
                  </div>
                  <div className="sm-card">
                    <Icon name="clock" size={18} />
                    <div><b>{tt('Old versions', 'النسخ القديمة')}</b><small>{rep.versions.count ? tt(`${rep.versions.human} in ${rep.versions.count} saved version(s)`, `${rep.versions.human} في ${rep.versions.count} نسخة محفوظة`) : tt('None', 'مفيش')}</small></div>
                    <button type="button" className="btn btn-ghost" disabled={busy || !rep.versions.count} onClick={clearVersions}>{tt('Delete all', 'حذف الكل')}</button>
                  </div>
                  <div className="sm-card">
                    <Icon name="copy" size={18} />
                    <div><b>{tt('Duplicates', 'ملفات مكررة')}</b><small>{rep.duplicates.groups.length ? tt(`${rep.duplicates.wasted_human} wasted by identical copies`, `${rep.duplicates.wasted_human} مهدرة في نسخ متطابقة`) : tt('No duplicates found', 'مفيش مكررات')}</small></div>
                    <button type="button" className="btn btn-ghost" disabled={!rep.duplicates.groups.length} onClick={() => { setTab('dups'); setSel(new Set(rep.duplicates.groups.flatMap((g) => g.files.slice(1).map((f) => f.id)))); }}>{tt('Review', 'مراجعة')}</button>
                  </div>
                </div>

                <h4 className="sm-h">{tt('By type', 'حسب النوع')}</h4>
                <ul className="sm-cats">
                  {rep.categories.map((c) => {
                    const m = CATS[c.key] || CATS.other;
                    return <li key={c.key}><i style={{ background: m.color }} /><span>{ar ? m.ar : m.en}</span><small>{tt(`${c.count} file(s)`, `${c.count} ملف`)}</small><b>{fmtBytes(c.bytes)}</b></li>;
                  })}
                  {!rep.categories.length && <li className="sm-empty">{tt('No files yet.', 'مفيش ملفات لسه.')}</li>}
                </ul>

                {rep.folders.length > 0 && (
                  <>
                    <h4 className="sm-h">{tt('Biggest folders', 'أكبر المجلدات')}</h4>
                    <ul className="sm-cats">
                      {rep.folders.map((f) => (
                        <li key={f.id}><Icon name="folder" size={14} /><button type="button" className="sm-link sm-link--name" dir="auto" onClick={() => show(f.id)}>{f.name}</button><small dir="auto">{f.path}</small><b>{f.size_human}</b></li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {tab === 'large' && (
              <>
                <p className="sm-hint">{tt('Your biggest files. Tick the ones you do not need. Files in the recycle bin still use space until it is emptied.', 'أكبر ملفاتك. علّم اللي مش محتاجه. الملفات في السلة بتفضل محسوبة لحد ما تفرّغها.')}</p>
                <ul className="sm-list">
                  {rep.largest.map((f) => renderRow(f, f.size_human))}
                  {!rep.largest.length && <li className="sm-empty">{tt('No files yet.', 'مفيش ملفات لسه.')}</li>}
                </ul>
              </>
            )}

            {tab === 'dups' && (
              <>
                <p className="sm-hint">{tt('Identical files (same content). The oldest copy of each group is kept un-ticked.', 'ملفات متطابقة (نفس المحتوى). أقدم نسخة في كل مجموعة بتفضل من غير علامة.')}</p>
                {rep.duplicates.groups.map((g, i) => (
                  <div key={i} className="sm-group">
                    <div className="sm-group__h">{tt(`${g.count} copies × ${g.size_human}`, `${g.count} نسخ × ${g.size_human}`)}<small>{tt(`${fmtBytes(g.wasted_bytes)} wasted`, `${fmtBytes(g.wasted_bytes)} مهدرة`)}</small></div>
                    <ul className="sm-list">{g.files.map((f) => renderRow({ ...f, parent_id: undefined }, g.size_human))}</ul>
                  </div>
                ))}
                {!rep.duplicates.groups.length && <div className="sm-empty">{tt('No duplicate files found.', 'مفيش ملفات مكررة.')}</div>}
              </>
            )}
            {actionBar}
          </>
        )}
      </div>
    </StModal>
  );
}
