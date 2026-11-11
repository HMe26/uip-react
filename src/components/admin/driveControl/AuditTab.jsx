import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import { Pager } from '../adminUi';
import { EmptyState, ErrorState, Skeleton } from '../AdminPage';
import { BASE, actionLabel, fmtDate, useL } from './shared';

const PER = 30;
const FILTERS = [['', 'All', 'الكل'], ['settings', 'Settings', 'الإعدادات'], ['limits', 'User limits', 'حدود المستخدمين'], ['file', 'File access', 'الوصول للملفات'],
  ['files', 'Deletions', 'الحذف'], ['share', 'Links', 'الروابط'], ['drive_wiped', 'Wipes', 'المسح الكامل']];

/** Everything admins did in My PC (settings, limits, opening/downloading/deleting user files, link actions). userId narrows to one user. */
export default function AuditTab({ userId }) {
  const { ar, L } = useL();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/audit`, { page, per_page: PER, action: action || undefined, subject_id: userId || undefined })
      .then((j) => { setRows(j.data.items); setTotal(j.data.meta.total); })
      .catch((e) => setErr(errorMessage(e)));
  }, [page, action, userId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mtc-stack">
      <div className="sa-chips" role="group">
        {FILTERS.map(([v, en, arT]) => (
          <button key={v || 'all'} type="button" aria-pressed={action === v} className={`sa-chip${action === v ? ' is-active' : ''}`} onClick={() => { setAction(v); setPage(1); }}>{ar ? arT : en}</button>
        ))}
      </div>
      {err ? <ErrorState error={err} onRetry={load} /> : !rows ? <Skeleton rows={8} cols={4} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="clock" title={L('No activity yet', 'مفيش نشاط لسه')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('When', 'الوقت')}</th><th>{L('Admin', 'الأدمن')}</th><th>{L('Action', 'الإجراء')}</th><th>{L('Target', 'الهدف')}</th><th>{L('IP', 'IP')}</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} className="mtc-row-click" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <td data-label={L('When', 'الوقت')}>{fmtDate(a.created_at, ar)}</td>
              <td data-label={L('Admin', 'الأدمن')}>{a.admin_name || `#${a.admin_id}`}</td>
              <td data-label={L('Action', 'الإجراء')}><strong>{actionLabel(a.action, ar)}</strong>
                {open === a.id && (a.old || a.new) && <pre className="mtc-json" dir="ltr">{JSON.stringify({ old: a.old, new: a.new }, null, 2)}</pre>}</td>
              <td data-label={L('Target', 'الهدف')}>{a.target_name || (a.subject_id ? `#${a.subject_id}` : '—')}</td>
              <td data-label="IP" dir="ltr">{a.ip || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={page} setPage={setPage} total={total} perPage={PER} />
    </div>
  );
}
