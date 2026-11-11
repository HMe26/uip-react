import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal, Pager } from '../adminUi';
import { Chips, EmptyState, ErrorState, Skeleton } from '../AdminPage';
import { BASE, SHARE_STATUS, fmtDate, useBanner, useL } from './shared';

const PER = 30;

/** Every public share link on the platform: pause / resume / revoke / delete (alone or in bulk) and see who opened it. */
export default function SharesTab({ userId }) {
  const { ar, L } = useL();
  const navigate = useNavigate();
  const { banner, setNotice, setError, clear } = useBanner();
  const [status, setStatus] = useState('');
  const [qLive, setQLive] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(null);

  useEffect(() => { const h = setTimeout(() => { setQ(qLive.trim()); setPage(1); }, 350); return () => clearTimeout(h); }, [qLive]);
  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/shares`, { page, per_page: PER, status: status || undefined, q: q || undefined, sort, user_id: userId || undefined })
      .then((j) => { setRows(j.data.items); setTotal(j.data.meta.total); })
      .catch((e) => setErr(errorMessage(e)));
  }, [page, status, q, sort, userId]);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setBusy(true); clear();
    try { const j = await fn(); setNotice(j.message); setSel([]); await load(); } catch (e) { setError(errorMessage(e)); }
    setConfirm(null); setBusy(false);
  }
  const one = (s, action) => run(() => (action === 'delete' ? api.del(`${BASE}/shares/${s.id}`) : api.post(`${BASE}/shares/${s.id}/${action}`, {})));
  const many = (action) => run(() => api.post(`${BASE}/shares/bulk`, { action, ids: sel }));
  const ask = (s, action) => setConfirm({
    title: action === 'delete' ? L('Delete this link?', 'حذف الرابط؟') : L('Revoke this link?', 'إلغاء الرابط؟'),
    message: L('The public link stops working for everyone.', 'الرابط العام هيقف للجميع.'),
    label: action === 'delete' ? L('Delete', 'حذف') : L('Revoke', 'إلغاء'), run: () => one(s, action),
  });
  const askBulk = (action) => setConfirm({
    title: L(`${action} ${sel.length} link(s)?`, `تنفيذ على ${sel.length} رابط؟`), message: L('This applies to every selected link.', 'ده هيتطبّق على كل الروابط المحددة.'),
    label: L('Confirm', 'تأكيد'), run: () => many(action),
  });

  async function openActivity(s) {
    clear();
    try { const j = await api.get(`${BASE}/shares/${s.id}/activity`); setActivity({ share: s, data: j.data }); } catch (e) { setError(errorMessage(e)); }
  }

  const allOn = rows && rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const chip = (s) => { const k = s.status in SHARE_STATUS ? s.status : (s.paused ? 'paused' : 'active'); const v = SHARE_STATUS[k]; return <span className={`badge ${v[2]}`}>{ar ? v[1] : v[0]}</span>; };

  return (
    <div className="mtc-stack">
      {banner}
      <div className="adm-filters mtc-filters">
        <div className="adm-filters__search"><input className="form-input" value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={L('Search file, title, owner…', 'ابحث بالملف أو العنوان أو المالك…')} /></div>
        <select className="form-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label={L('Sort', 'الترتيب')}>
          <option value="new">{L('Newest', 'الأحدث')}</option><option value="views">{L('Most viewed', 'الأكثر فتحًا')}</option><option value="downloads">{L('Most downloaded', 'الأكثر تنزيلًا')}</option>
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> {L('Refresh', 'تحديث')}</button>
      </div>
      <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} label={L('Status', 'الحالة')}
        options={[['', L('All', 'الكل')], ['active', L('Active', 'نشط')], ['paused', L('Paused', 'متوقف')], ['expired', L('Expired', 'منتهي')], ['revoked', L('Revoked', 'ملغي')]]} />

      {sel.length > 0 && (
        <div className="mtc-savebar"><span>{L(`${sel.length} selected`, `${sel.length} محدد`)}</span>
          <div className="mtc-actions mtc-actions--wrap">
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => many('pause')}>{L('Pause', 'إيقاف')}</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => many('resume')}>{L('Resume', 'استئناف')}</button>
            <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" disabled={busy} onClick={() => askBulk('revoke')}>{L('Revoke', 'إلغاء')}</button>
            <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" disabled={busy} onClick={() => askBulk('delete')}>{L('Delete', 'حذف')}</button>
          </div></div>
      )}

      {err ? <ErrorState error={err} onRetry={load} /> : !rows ? <Skeleton rows={8} cols={5} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="share" title={L('No links', 'مفيش روابط')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr>
            <th><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? [] : rows.map((r) => r.id))} aria-label={L('Select all', 'تحديد الكل')} /></th>
            <th>{L('Link', 'الرابط')}</th><th>{L('Owner', 'المالك')}</th><th>{L('Status', 'الحالة')}</th><th>{L('Opens / downloads', 'فتح / تنزيل')}</th><th>{L('Expires', 'ينتهي')}</th><th />
          </tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}>
              <td><input type="checkbox" checked={sel.includes(s.id)} onChange={() => setSel((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))} aria-label={`#${s.id}`} /></td>
              <td data-label={L('Link', 'الرابط')}><strong dir="auto">{s.title || s.node_name || `#${s.id}`}</strong>{s.node_deleted && <small className="mtc-muted"> · {L('file gone', 'الملف اتحذف')}</small>}
                <br /><small className="mtc-muted">{s.is_bundle ? L('Bundle', 'مجموعة') : s.node_type === 'folder' ? L('Folder', 'مجلد') : L('File', 'ملف')}{s.has_password ? ` · ${L('password', 'كلمة سر')}` : ''}{s.single_person ? ` · ${L('single person', 'شخص واحد')}` : ''}{s.one_time ? ` · ${L('one-time', 'مرة واحدة')}` : ''}</small></td>
              <td data-label={L('Owner', 'المالك')}><button type="button" className="mtc-link" onClick={() => navigate(`/admin/drive-control/users/${s.owner_id}`)}>{s.owner_name || `#${s.owner_id}`}</button><br /><small className="mtc-muted">{s.owner_email}</small></td>
              <td data-label={L('Status', 'الحالة')}>{chip(s)}</td>
              <td data-label={L('Opens / downloads', 'فتح / تنزيل')}>{s.views} / {s.downloads}<br /><small className="mtc-muted">{s.last_used_at ? fmtDate(s.last_used_at, ar) : '—'}</small></td>
              <td data-label={L('Expires', 'ينتهي')}>{s.expires_at ? fmtDate(s.expires_at, ar) : L('Never', 'أبدًا')}</td>
              <td className="mtc-row-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openActivity(s)}><Icon name="users" size={13} /> {L('Visitors', 'الزوّار')}</button>
                {s.paused ? <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => one(s, 'resume')}><Icon name="play" size={13} /></button>
                  : s.status !== 'revoked' && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => one(s, 'pause')}><Icon name="pause" size={13} /></button>}
                {s.status !== 'revoked' && <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => ask(s, 'revoke')}><Icon name="x-circle" size={13} /></button>}
                <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => ask(s, 'delete')}><Icon name="trash" size={13} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={page} setPage={setPage} total={total} perPage={PER} />

      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.label} danger busy={busy} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
      {activity && <ActivityModal {...activity} ar={ar} L={L} onClose={() => setActivity(null)}
        onAction={async (a) => { await run(() => api.post(`${BASE}/shares/${activity.share.id}/${a}`, {})); setActivity(null); }} />}
    </div>
  );
}

function ActivityModal({ share, data, ar, L, onClose, onAction }) {
  const groups = data.visitors || data.groups || data.items || [];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel dvc-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{L('Who opened this link', 'مين فتح الرابط')}: {share.title || share.node_name}</h2>
        {groups.length === 0 ? <p className="mtc-muted">{L('Nobody yet.', 'لسه محدش.')}</p> : (
          <div className="adm-table-wrap"><table className="adm-table">
            <thead><tr><th>{L('Visitor', 'الزائر')}</th><th>{L('Opens', 'فتح')}</th><th>{L('Downloads', 'تنزيل')}</th><th>{L('Devices / IPs', 'الأجهزة / IP')}</th><th>{L('Last seen', 'آخر ظهور')}</th></tr></thead>
            <tbody>{groups.map((g, i) => (
              <tr key={g.key || i}>
                <td data-label={L('Visitor', 'الزائر')}>{g.account?.name || g.name || L('Anonymous', 'مجهول')}<br /><small className="mtc-muted">{g.email}{g.phone ? ` · ${g.phone}` : ''}</small></td>
                <td>{g.opens}</td><td>{g.downloads}</td>
                <td><small className="mtc-muted" dir="ltr">{[...(Array.isArray(g.devices) ? g.devices : Object.keys(g.devices || {})), ...(Array.isArray(g.ips) ? g.ips : Object.keys(g.ips || {}))].join(' · ') || '—'}</small></td>
                <td>{fmtDate(g.last_seen_at, ar)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={() => onAction('reset-claim')}>{L('Reset claim', 'إعادة ضبط الحجز')}</button>
          <button type="button" className="btn btn-outline" onClick={() => onAction('clear-activity')}>{L('Clear activity', 'مسح النشاط')}</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>{L('Close', 'إغلاق')}</button>
        </div>
      </div>
    </div>
  );
}
