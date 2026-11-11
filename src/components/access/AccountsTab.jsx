import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { Pager } from '../admin/adminUi';
import { EmptyState, ErrorState, Skeleton } from '../admin/AdminPage';
import { fmtDate, useBanner, useL } from '../admin/meetingsControl/shared';
import GrantModal from './GrantModal';
import { featureLabel } from './accessShared';

const PER = 25;

/** Students with no university: search them and give access. */
export default function AccountsTab({ onGranted }) {
  const { ar, L } = useL();
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(undefined); // undefined closed · null by e-mail · account
  const bn = useBanner();

  useEffect(() => { const id = setTimeout(() => { setQ(qLive.trim()); setPage(1); }, 350); return () => clearTimeout(id); }, [qLive]);
  const load = useCallback(() => api.get('/api/v1/access/accounts', { q, page, per_page: PER }).then((j) => { setData(j.data); setError(null); }).catch((e) => setError(errorMessage(e))), [q, page]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;

  const reqLabel = (r) => (!r ? '—' : ({ pending: L('Pending', 'قيد الانتظار'), approved: L('Approved', 'مقبول'), rejected: L('Rejected', 'مرفوض') }[r.status] || r.status)
    + ((ar ? r.university_ar : r.university_en) ? ` · ${ar ? r.university_ar : r.university_en}` : ''));

  return (
    <div className="mtc-stack">
      {bn.banner}
      {data && data.enabled === false && <div className="st-alert mtc-banner" role="status"><Icon name="alert-triangle" size={16} /><span>{L('The university-link requirement is switched off in Platform Policy, so nobody is restricted right now.', 'شرط ربط الجامعة مقفول من سياسة المنصة، فمفيش حد مقيّد دلوقتي.')}</span></div>}
      <div className="adm-filters">
        <div className="adm-filters__search"><input className="form-input" value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={L('Search name or email…', 'ابحث بالاسم أو الإيميل…')} /></div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setTarget(null)}><Icon name="mail" size={14} /> {L('Grant by e-mail', 'منح بالإيميل')}</button>
      </div>
      {!data ? <Skeleton rows={5} cols={5} /> : data.items.length === 0 ? (
        <section className="sa-card"><EmptyState icon="users" title={L('No unlinked student accounts', 'مفيش حسابات طلاب غير مرتبطة')} hint={L('Accounts linked to a university never need a grant.', 'الحسابات المرتبطة بجامعة مش محتاجة منحة.')} /></section>
      ) : (
        <>
          <div className="adm-table-wrap"><table className="adm-table">
            <thead><tr><th>{L('Student', 'الطالب')}</th><th>{L('Join request', 'طلب الانضمام')}</th><th>{L('Current access', 'الصلاحية الحالية')}</th><th>{L('Joined', 'التسجيل')}</th><th /></tr></thead>
            <tbody>{data.items.map((a) => (
              <tr key={a.id}>
                <td data-label={L('Student', 'الطالب')}><strong>{a.name}</strong><br /><small className="mtc-muted">{a.email}</small></td>
                <td data-label={L('Join request', 'طلب الانضمام')}>{reqLabel(a.request)}</td>
                <td data-label={L('Current access', 'الصلاحية الحالية')}>{a.active_grants.length
                  ? [...new Set(a.active_grants.flatMap((g) => g.features))].map((k) => featureLabel(k, ar)).join('، ')
                  : <span className="mtc-muted">{L('Locked', 'مقفول')}</span>}</td>
                <td data-label={L('Joined', 'التسجيل')}>{fmtDate(a.created_at, ar)}</td>
                <td className="mtc-row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => setTarget(a)}>{L('Give access', 'منح صلاحية')}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <Pager page={page} setPage={setPage} total={data.meta.total} perPage={data.meta.per_page} />
        </>
      )}
      {target !== undefined && <GrantModal account={target} onClose={() => setTarget(undefined)}
        onDone={() => { setTarget(undefined); bn.setNotice(L('Access granted.', 'اتمنحت الصلاحية.')); load(); onGranted?.(); }} />}
    </div>
  );
}
