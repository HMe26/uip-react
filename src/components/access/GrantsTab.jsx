import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { ConfirmModal, Field } from '../admin/adminUi';
import { Chips, EmptyState, ErrorState, Skeleton } from '../admin/AdminPage';
import { fmtDate, useBanner, useL } from '../admin/meetingsControl/shared';
import { GRANT_STATE, featureLabel, money } from './accessShared';

const BASE = '/api/v1/access/grants';

export default function GrantsTab({ refreshKey }) {
  const { ar, L } = useL();
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const [paid, setPaid] = useState(null);
  const [ext, setExt] = useState(null);
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const bn = useBanner();

  const load = useCallback(() => api.get(BASE, { status }).then((j) => { setRows(j.data.items); setError(null); }).catch((e) => setError(errorMessage(e))), [status]);
  useEffect(() => { setRows(null); load(); }, [load, refreshKey]);

  async function run(fn, okMsg, close) {
    setBusy(true); bn.clear();
    try { await fn(); bn.setNotice(okMsg); close(null); load(); } catch (e) { bn.setError(errorMessage(e)); close(null); } finally { setBusy(false); }
  }

  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="mtc-stack">
      {bn.banner}
      <Chips value={status} onChange={setStatus} label={L('State', 'الحالة')} options={[
        ['active', L('Active', 'شغالة')], ['pending', L('Awaiting payment', 'في انتظار الدفع'), 'warning'], ['expired', L('Expired', 'منتهية')],
        ['revoked', L('Withdrawn', 'مسحوبة')], ['all', L('All', 'الكل')],
      ]} />
      {!rows ? <Skeleton rows={5} cols={6} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="inbox" title={L('Nothing here', 'مفيش حاجة هنا')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('Student', 'الطالب')}</th><th>{L('Features', 'المميزات')}</th><th>{L('Price', 'السعر')}</th><th>{L('Period', 'الفترة')}</th><th>{L('State', 'الحالة')}</th><th /></tr></thead>
          <tbody>{rows.map((g) => {
            const st = GRANT_STATE[g.state] || GRANT_STATE.active;
            return (
              <tr key={g.id}>
                <td data-label={L('Student', 'الطالب')}><strong>{g.user?.name}</strong><br /><small className="mtc-muted">{g.user?.email}</small>{g.note && <><br /><small className="mtc-muted">{g.note}</small></>}</td>
                <td data-label={L('Features', 'المميزات')}>{g.features.map((k) => featureLabel(k, ar)).join('، ')}</td>
                <td data-label={L('Price', 'السعر')}>{money(g.price, g.currency) || L('Free', 'مجاني')}{g.price > 0 && <><br /><small className="mtc-muted">{g.payment_status === 'paid' ? L('Paid', 'مدفوع') : L('Unpaid', 'غير مدفوع')}</small></>}</td>
                <td data-label={L('Period', 'الفترة')}>{g.starts_at ? fmtDate(g.starts_at, ar) : '—'}<br /><small className="mtc-muted">{g.expires_at ? `→ ${fmtDate(g.expires_at, ar)}` : (g.starts_at ? L('No expiry', 'بدون انتهاء') : (g.duration_days ? L(`${g.duration_days} days after payment`, `${g.duration_days} يوم بعد الدفع`) : ''))}</small></td>
                <td data-label={L('State', 'الحالة')}><span className={`badge ${st.tone}`}>{ar ? st.ar : st.en}</span></td>
                <td className="mtc-row-actions">
                  {g.state === 'pending' && <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaid(g)}>{L('Confirm payment', 'تأكيد الدفع')}</button>}
                  {['active', 'expired'].includes(g.state) && g.expires_at && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setDays('30'); setExt(g); }}>{L('Extend', 'تمديد')}</button>}
                  {['active', 'pending'].includes(g.state) && <button type="button" className="btn btn-outline btn-sm" onClick={() => setRevoke(g)}>{L('Withdraw', 'سحب')}</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}

      {paid && <ConfirmModal busy={busy} title={L('Confirm payment?', 'تأكيد الدفع؟')}
        message={L(`Confirm you received ${money(paid.price, paid.currency)} from ${paid.user?.name}. Access starts now.`, `أكّد إنك استلمت ${money(paid.price, paid.currency)} من ${paid.user?.name}. الصلاحية هتبدأ دلوقتي.`)}
        confirmLabel={L('Confirm', 'تأكيد')} onConfirm={() => run(() => api.post(`${BASE}/${paid.id}/mark-paid`, {}), L('Payment confirmed.', 'اتأكد الدفع.'), setPaid)} onClose={() => setPaid(null)} />}
      {revoke && <ConfirmModal danger busy={busy} title={L('Withdraw access?', 'سحب الصلاحية؟')}
        message={L(`${revoke.user?.name} will lose these features immediately.`, `${revoke.user?.name} هيفقد المميزات دي فورًا.`)}
        confirmLabel={L('Withdraw', 'سحب')} onConfirm={() => run(() => api.post(`${BASE}/${revoke.id}/revoke`, {}), L('Access withdrawn.', 'اتسحبت الصلاحية.'), setRevoke)} onClose={() => setRevoke(null)} />}
      {ext && (
        <div className="modal-overlay" onClick={() => setExt(null)}>
          <form className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); run(() => api.post(`${BASE}/${ext.id}/extend`, { days: Number(days) }), L('Access extended.', 'اتمدّدت الصلاحية.'), setExt); }}>
            <h2 className="modal-box__title text-h3">{L('Extend access', 'تمديد الصلاحية')}</h2>
            <Field id="ex-d" label={L('Add days', 'أضف أيام')}><input id="ex-d" className="form-input" type="number" min="1" max="3650" value={days} onChange={(e) => setDays(e.target.value)} required /></Field>
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={() => setExt(null)}>{L('Cancel', 'إلغاء')}</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !(Number(days) > 0)}>{busy ? '…' : L('Extend', 'تمديد')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
