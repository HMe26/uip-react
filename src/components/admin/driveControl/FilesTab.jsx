import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { Pager } from '../adminUi';
import { EmptyState, ErrorState, Skeleton } from '../AdminPage';
import { BASE, CATEGORY_LABELS, catLabel, downloadFrom, fmtDate, previewFrom, useBanner, useL } from './shared';

const PER = 30;

/** Search every file on the platform (largest first by default) — open its owner or view / download it (logged). */
export default function FilesTab() {
  const { ar, L } = useL();
  const navigate = useNavigate();
  const { banner, setError, clear } = useBanner();
  const [qLive, setQLive] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('live');
  const [sort, setSort] = useState('size');
  const [minMb, setMinMb] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => { const h = setTimeout(() => { setQ(qLive.trim()); setPage(1); }, 350); return () => clearTimeout(h); }, [qLive]);
  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/files`, { page, per_page: PER, q: q || undefined, category: category || undefined, state, sort, min_mb: minMb || undefined })
      .then((j) => { setRows(j.data.items); setTotal(j.data.meta.total); })
      .catch((e) => setErr(errorMessage(e)));
  }, [page, q, category, state, sort, minMb]);
  useEffect(() => { load(); }, [load]);

  const act = (fn) => { clear(); fn().catch((e) => setError(errorMessage(e))); };
  const p = (f) => `${BASE}/users/${f.owner_id}/files/${f.id}/download`;

  return (
    <div className="mtc-stack">
      {banner}
      <div className="adm-filters mtc-filters">
        <div className="adm-filters__search"><input className="form-input" value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={L('Search file name…', 'ابحث باسم الملف…')} /></div>
        <select className="form-select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={L('Type', 'النوع')}>
          <option value="">{L('All types', 'كل الأنواع')}</option>
          {Object.keys(CATEGORY_LABELS).map((c) => <option key={c} value={c}>{catLabel(c, ar)}</option>)}
        </select>
        <select className="form-select" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} aria-label={L('State', 'الحالة')}>
          <option value="live">{L('Live files', 'الملفات الحالية')}</option>
          <option value="trash">{L('In recycle bin', 'في المحذوفات')}</option>
          <option value="any">{L('Both', 'الاتنين')}</option>
        </select>
        <select className="form-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label={L('Sort', 'الترتيب')}>
          <option value="size">{L('Largest first', 'الأكبر أولًا')}</option>
          <option value="new">{L('Newest', 'الأحدث')}</option>
          <option value="old">{L('Oldest', 'الأقدم')}</option>
          <option value="name">{L('Name', 'الاسم')}</option>
        </select>
        <input className="form-input mtc-date" type="number" min={0} value={minMb} placeholder={L('Min MB', 'أقل حجم MB')} onChange={(e) => { setMinMb(e.target.value); setPage(1); }} />
      </div>

      {err ? <ErrorState error={err} onRetry={load} /> : !rows ? <Skeleton rows={8} cols={5} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="file" title={L('No files match', 'مفيش ملفات مطابقة')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('File', 'الملف')}</th><th>{L('Owner', 'المالك')}</th><th>{L('Size', 'الحجم')}</th><th>{L('Created', 'تاريخ الرفع')}</th><th /></tr></thead>
          <tbody>{rows.map((f) => (
            <tr key={f.id} className={f.trashed ? 'mtc-row-deleted' : undefined}>
              <td data-label={L('File', 'الملف')}><strong dir="auto">{f.name}</strong>{f.trashed && <span className="badge badge-danger" style={{ marginInlineStart: 6 }}>{L('Bin', 'محذوف')}</span>}<br /><small className="mtc-muted" dir="ltr">{f.mime_type || f.extension}</small></td>
              <td data-label={L('Owner', 'المالك')}><button type="button" className="mtc-link" onClick={() => navigate(`/admin/drive-control/users/${f.owner_id}`)}>{f.owner_name || `#${f.owner_id}`}</button><br /><small className="mtc-muted">{f.owner_email}</small></td>
              <td data-label={L('Size', 'الحجم')}><strong>{f.size_human}</strong></td>
              <td data-label={L('Created', 'تاريخ الرفع')}>{fmtDate(f.created_at, ar)}</td>
              <td className="mtc-row-actions">
                <button type="button" className="btn btn-outline btn-sm" title={L('View (logged)', 'عرض (بيتسجّل)')} onClick={() => act(() => previewFrom(p(f)))}><Icon name="eye" size={13} /></button>
                <button type="button" className="btn btn-outline btn-sm" title={L('Download (logged)', 'تنزيل (بيتسجّل)')} onClick={() => act(() => downloadFrom(p(f), undefined, f.name))}><Icon name="download" size={13} /></button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/admin/drive-control/users/${f.owner_id}?parent=${f.parent_id ?? ''}`)}>{L('Open folder', 'فتح المجلد')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={page} setPage={setPage} total={total} perPage={PER} />
    </div>
  );
}
