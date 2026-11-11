import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { ConfirmModal } from '../admin/adminUi';
import { EmptyState, ErrorState, Skeleton } from '../admin/AdminPage';
import { ROLE_LABELS, fmtDate, useBanner, useL } from '../admin/meetingsControl/shared';
import GrantModal from './GrantModal';
import { featureLabel } from './accessShared';

const BASE = '/api/v1/access/exemptions';

/** Admin only: security and data-analyst accounts are exempt from the university-link gate; cancel (or restore) that per account. */
export default function ExemptionsTab() {
  const { ar, L } = useL();
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ask, setAsk] = useState(null); // { row, cancel }
  const [grant, setGrant] = useState(null);
  const [busy, setBusy] = useState(false);
  const bn = useBanner();

  useEffect(() => { const id = setTimeout(() => setQ(qLive.trim()), 350); return () => clearTimeout(id); }, [qLive]);
  const load = useCallback(() => api.get(BASE, { q }).then((j) => { setData(j.data); setError(null); }).catch((e) => setError(errorMessage(e))), [q]);
  useEffect(() => { load(); }, [load]);

  async function apply() {
    setBusy(true); bn.clear();
    try {
      await api.post(`${BASE}/${ask.row.id}/${ask.cancel ? 'cancel' : 'restore'}`, {});
      bn.setNotice(ask.cancel ? L('Exemption cancelled.', 'اتلغى الاستثناء.') : L('Exemption restored.', 'رجع الاستثناء.'));
      setAsk(null); load();
    } catch (e) { bn.setError(errorMessage(e)); setAsk(null); } finally { setBusy(false); }
  }

  if (error) return <ErrorState error={error} onRetry={load} />;
  const role = (r) => (ROLE_LABELS[r] ? ROLE_LABELS[r][ar ? 1 : 0] : r);

  return (
    <div className="mtc-stack">
      {bn.banner}
      <p className="mtc-muted">{L('Security and data-analyst accounts are exempt from the university-link requirement. Cancel the exemption for a specific account to lock it like an unlinked student (you can then give it access from here).',
        'حسابات الأمن وتحليل البيانات مستثناة من شرط ربط الجامعة. الغي الاستثناء عن حساب معيّن عشان يتقفل زي الطالب غير المرتبط (وبعدها تقدر تديله صلاحية من هنا).')}</p>
      <div className="adm-filters"><div className="adm-filters__search"><input className="form-input" value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={L('Search name or email…', 'ابحث بالاسم أو الإيميل…')} /></div></div>
      {!data ? <Skeleton rows={5} cols={5} /> : data.items.length === 0 ? (
        <section className="sa-card"><EmptyState icon="shield" title={L('No security or data-analyst accounts', 'مفيش حسابات أمن أو تحليل بيانات')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('Account', 'الحساب')}</th><th>{L('Type', 'النوع')}</th><th>{L('Exemption', 'الاستثناء')}</th><th>{L('Current access', 'الصلاحية الحالية')}</th><th /></tr></thead>
          <tbody>{data.items.map((u) => (
            <tr key={u.id}>
              <td data-label={L('Account', 'الحساب')}><strong>{u.name}</strong><br /><small className="mtc-muted">{u.email}</small></td>
              <td data-label={L('Type', 'النوع')}>{role(u.role)}</td>
              <td data-label={L('Exemption', 'الاستثناء')}>{u.exempt
                ? <span className="badge badge-success">{L('Exempt', 'مستثنى')}</span>
                : <><span className="badge badge-danger">{L('Cancelled', 'ملغي')}</span><br /><small className="mtc-muted">{fmtDate(u.cancelled_at, ar)}</small></>}</td>
              <td data-label={L('Current access', 'الصلاحية الحالية')}>{u.exempt ? <span className="mtc-muted">{L('Everything', 'كل حاجة')}</span>
                : u.active_grants.length ? [...new Set(u.active_grants.flatMap((g) => g.features))].map((k) => featureLabel(k, ar)).join('، ') : <span className="mtc-muted">{L('Locked', 'مقفول')}</span>}</td>
              <td className="mtc-row-actions">
                {u.exempt
                  ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setAsk({ row: u, cancel: true })}><Icon name="x-circle" size={14} /> {L('Cancel exemption', 'إلغاء الاستثناء')}</button>
                  : <>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setGrant(u)}>{L('Give access', 'منح صلاحية')}</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setAsk({ row: u, cancel: false })}>{L('Restore exemption', 'رجّع الاستثناء')}</button>
                  </>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {ask && <ConfirmModal busy={busy} danger={ask.cancel} title={ask.cancel ? L('Cancel exemption?', 'إلغاء الاستثناء؟') : L('Restore exemption?', 'رجوع الاستثناء؟')}
        message={ask.cancel
          ? L(`${ask.row.name} will be locked out of the platform right away until you give them access.`, `${ask.row.name} هيتقفل عليه المنصة فورًا لحد ما تديله صلاحية.`)
          : L(`${ask.row.name} will have full access again.`, `${ask.row.name} هيرجع له الوصول الكامل.`)}
        confirmLabel={ask.cancel ? L('Cancel exemption', 'إلغاء الاستثناء') : L('Restore', 'رجّع')} onConfirm={apply} onClose={() => setAsk(null)} />}
      {grant && <GrantModal account={{ id: grant.id, name: grant.name, email: grant.email }} onClose={() => setGrant(null)}
        onDone={() => { setGrant(null); bn.setNotice(L('Access granted.', 'اتمنحت الصلاحية.')); load(); }} />}
    </div>
  );
}
