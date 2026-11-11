import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { Pager } from '../adminUi';
import { EmptyState, ErrorState, Skeleton } from '../AdminPage';
import LimitsForm from './LimitsForm';
import { BASE, ROLE_LABELS, StatusBadge, UsageBar, fmtDate, useBanner, useL } from './shared';

const PER = 25;

/** Every user with their My PC usage, quota and state. Open one for the full panel; tick several for bulk limits. */
export default function UsersTab() {
  const { ar, L } = useL();
  const navigate = useNavigate();
  const { banner, setNotice, setError, clear } = useBanner();
  const [qLive, setQLive] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('with_files');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [sort, setSort] = useState('used');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState([]);
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const h = setTimeout(() => { setQ(qLive.trim()); setPage(1); }, 350); return () => clearTimeout(h); }, [qLive]);
  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/users`, { page, per_page: PER, q: q || undefined, scope, status: status || undefined, role: role || undefined, sort, dir })
      .then((j) => { setRows(j.data.items); setTotal(j.data.meta.total); })
      .catch((e) => setErr(errorMessage(e)));
  }, [page, q, scope, status, role, sort, dir]);
  useEffect(() => { load(); }, [load]);

  const sortBy = (k) => { if (sort === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('desc'); } setPage(1); };
  const arrow = (k) => (sort === k ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOn = rows && rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const open = (id) => navigate(`/admin/drive-control/users/${id}`);

  async function applyBulk(payload) {
    setBusy(true); clear();
    try {
      const j = await api.post(`${BASE}/users/bulk-limits`, { user_ids: sel, ...payload });
      const f = j.data.failed || [];
      setNotice(L(`${j.data.done} user(s) updated${f.length ? `, ${f.length} failed` : ''}.`, `تم تحديث ${j.data.done} مستخدم${f.length ? `، وفشل ${f.length}` : ''}.`));
      if (f.length) setError(f.map((x) => `#${x.id}: ${x.message}`).join(' · '));
      setBulk(false); setSel([]); await load();
    } catch (e) { setError(errorMessage(e)); }
    setBusy(false);
  }

  const roles = Object.keys(ROLE_LABELS);

  return (
    <div className="mtc-stack">
      {banner}
      <div className="adm-filters mtc-filters">
        <div className="adm-filters__search"><input className="form-input" value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={L('Search name or email…', 'ابحث بالاسم أو الإيميل…')} /></div>
        <select className="form-select" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label={L('Account type', 'نوع الحساب')}>
          <option value="">{L('All account types', 'كل الأنواع')}</option>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r][ar ? 1 : 0]}</option>)}
        </select>
        <select className="form-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={L('State', 'الحالة')}>
          <option value="">{L('Any state', 'أي حالة')}</option>
          <option value="active">{L('Active (with overrides)', 'نشط (بتخصيص)')}</option>
          <option value="readonly">{L('Read-only', 'قراءة فقط')}</option>
          <option value="blocked">{L('Blocked', 'محظور')}</option>
        </select>
        <select className="form-select" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }} aria-label={L('Scope', 'النطاق')}>
          <option value="with_files">{L('Users with files', 'مستخدمين عندهم ملفات')}</option>
          <option value="all">{L('All users', 'كل المستخدمين')}</option>
        </select>
        <button type="button" className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> {L('Refresh', 'تحديث')}</button>
      </div>

      {sel.length > 0 && (
        <div className="mtc-savebar"><span>{L(`${sel.length} selected`, `${sel.length} محدد`)}</span>
          <div className="mtc-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => setBulk(true)}><Icon name="settings" size={14} /> {L('Set limits…', 'ضبط الحدود…')}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setSel([])}>{L('Clear', 'مسح التحديد')}</button></div></div>
      )}

      {err ? <ErrorState error={err} onRetry={load} /> : !rows ? <Skeleton rows={8} cols={5} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="users" title={L('No users match', 'مفيش مستخدمين مطابقين')} hint={L('Try clearing the filters.', 'جرّب تمسح الفلاتر.')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr>
            <th><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? [] : rows.map((r) => r.id))} aria-label={L('Select all', 'تحديد الكل')} /></th>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('name')}>{L('User', 'المستخدم')}{arrow('name')}</button></th>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('used')}>{L('Storage', 'التخزين')}{arrow('used')}</button></th>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('files')}>{L('Files', 'الملفات')}{arrow('files')}</button></th>
            <th>{L('State', 'الحالة')}</th>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('activity')}>{L('Last activity', 'آخر نشاط')}{arrow('activity')}</button></th>
            <th />
          </tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}>
              <td><input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggle(u.id)} aria-label={u.name} /></td>
              <td data-label={L('User', 'المستخدم')}>
                <button type="button" className="mtc-link mtc-title" onClick={() => open(u.id)}><strong>{u.name || `#${u.id}`}</strong></button>
                <br /><small className="mtc-muted">{u.email}{u.role ? ` · ${ROLE_LABELS[u.role] ? ROLE_LABELS[u.role][ar ? 1 : 0] : u.role}` : ''}</small>
              </td>
              <td data-label={L('Storage', 'التخزين')}><UsageBar {...u} quotaHuman={u.quota_human} usedHuman={u.used_human} />
                {u.trash_bytes > 0 && <small className="mtc-muted">{L('Bin', 'محذوفات')}: {u.trash_human}</small>}</td>
              <td data-label={L('Files', 'الملفات')}>{u.files.toLocaleString()}{u.shares > 0 && <><br /><small className="mtc-muted">{L(`${u.shares} links`, `${u.shares} رابط`)}</small></>}</td>
              <td data-label={L('State', 'الحالة')}><StatusBadge status={u.status} />
                <span className="mtc-flags">{u.has_override && <small className="mtc-muted">{L('custom', 'مخصص')}</small>}{u.sharing_blocked && <span title={L('Sharing blocked', 'المشاركة ممنوعة')}><Icon name="share" size={13} /></span>}{u.uploads_blocked && <span title={L('Uploads blocked', 'الرفع ممنوع')}><Icon name="upload" size={13} /></span>}</span></td>
              <td data-label={L('Last activity', 'آخر نشاط')}>{fmtDate(u.last_activity, ar)}</td>
              <td className="mtc-row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => open(u.id)}>{L('Manage', 'تحكم')}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={page} setPage={setPage} total={total} perPage={PER} />

      {bulk && (
        <div className="modal-overlay" onClick={() => setBulk(false)}>
          <div className="modal-box card glass-panel dvc-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-box__title text-h3">{L(`Set limits for ${sel.length} user(s)`, `ضبط حدود ${sel.length} مستخدم`)}</h2>
            <p className="mtc-muted">{L('Tick only the fields you want to change.', 'علّم بس على الحقول اللي عايز تغيّرها.')}</p>
            <LimitsForm bulk busy={busy} onSubmit={applyBulk} onCancel={() => setBulk(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
