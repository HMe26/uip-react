import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import AdminPage, { Chips, EmptyState, ErrorState, Skeleton } from '../../components/admin/AdminPage';
import { ConfirmModal } from '../../components/admin/adminUi';
import { fmtDate, useBanner, useL } from '../../components/admin/meetingsControl/shared';

const BASE = '/api/v1/faculty/join-requests';

/** Students who asked to join this faculty. Approving links the student to the university/faculty (same rule as the university queue). */
export default function FacultyJoinRequests() {
  const { ar, L } = useL();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [ask, setAsk] = useState(null); // { row, approve }
  const [busy, setBusy] = useState(false);
  const bn = useBanner();

  const load = useCallback(() => api.get(BASE, { status }).then((j) => { setRows(j.data.items); setError(null); }).catch((e) => setError(errorMessage(e))), [status]);
  useEffect(() => { setRows(null); load(); }, [load]);

  async function decide() {
    setBusy(true); bn.clear();
    try {
      await api.post(`${BASE}/${ask.row.id}/${ask.approve ? 'approve' : 'reject'}`, {});
      bn.setNotice(ask.approve ? L('Request approved.', 'اتقبل الطلب.') : L('Request declined.', 'اترفض الطلب.'));
      setAsk(null); load();
    } catch (e) { bn.setError(errorMessage(e)); setAsk(null); } finally { setBusy(false); }
  }

  const badge = { pending: ['badge-warning', L('Pending', 'قيد الانتظار')], approved: ['badge-success', L('Approved', 'مقبول')], rejected: ['badge-danger', L('Rejected', 'مرفوض')] };

  return (
    <AdminPage icon="inbox" title={L('Join requests', 'طلبات الانضمام')} subtitle={L('Students asking to join your faculty.', 'طلاب طالبين ينضموا لكليتك.')}>
      {bn.banner}
      <Chips value={status} onChange={setStatus} label={L('State', 'الحالة')} options={[['pending', L('Pending', 'قيد الانتظار'), 'warning'], ['all', L('All', 'الكل')]]} />
      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? <Skeleton rows={5} cols={5} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="inbox" title={L('No requests', 'مفيش طلبات')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('Student', 'الطالب')}</th><th>{L('Department', 'القسم')}</th><th>{L('Requested', 'تاريخ الطلب')}</th><th>{L('State', 'الحالة')}</th><th /></tr></thead>
          <tbody>{rows.map((r) => {
            const b = badge[r.status] || ['badge-neutral', r.status];
            return (
              <tr key={r.id}>
                <td data-label={L('Student', 'الطالب')}><strong>{r.full_name}</strong><br /><small className="mtc-muted">{r.email}</small></td>
                <td data-label={L('Department', 'القسم')}>{(ar ? r.department_ar : r.department_en) || '—'}</td>
                <td data-label={L('Requested', 'تاريخ الطلب')}>{fmtDate(r.created_at, ar)}</td>
                <td data-label={L('State', 'الحالة')}><span className={`badge ${b[0]}`}>{b[1]}</span></td>
                <td className="mtc-row-actions">{r.status === 'pending' && <>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAsk({ row: r, approve: false })}>{L('Decline', 'رفض')}</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setAsk({ row: r, approve: true })}>{L('Approve', 'قبول')}</button>
                </>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {ask && <ConfirmModal busy={busy} danger={!ask.approve} title={ask.approve ? L('Approve request?', 'قبول الطلب؟') : L('Decline request?', 'رفض الطلب؟')}
        message={ask.approve ? L(`${ask.row.full_name} will be linked to your university and faculty.`, `${ask.row.full_name} هيتربط بجامعتك وكليتك.`) : L(`${ask.row.full_name} will be told the request was declined.`, `${ask.row.full_name} هيتبلّغ إن الطلب اترفض.`)}
        confirmLabel={ask.approve ? L('Approve', 'قبول') : L('Decline', 'رفض')} onConfirm={decide} onClose={() => setAsk(null)} />}
    </AdminPage>
  );
}
