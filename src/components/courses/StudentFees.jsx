import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable, AcField } from './acKit';
import { downloadAuthed } from '../../lib/download';

/**
 * المصاريف (الطالب): المستحقات، المتبقي، وإخطار الدفع (مرجع التحويل) اللي الإدارة بتأكّده، وتحميل إيصال PDF لكل دفعة مؤكَّدة.
 * مفيش دفع أونلاين: الطالب بيحوّل/يدفع بره المنصة ويبعت المرجع هنا.
 * Backend: GET /api/v1/fees/mine · POST /api/v1/fees/{id}/notice · DELETE /api/v1/fees/notices/{id} · GET /api/v1/fees/payments/{id}/receipt.
 */

export const FEE_STATUS = {
  unpaid: ['غير مسدّد', 'Unpaid', 'warning'],
  partial: ['مسدّد جزئياً', 'Partially paid', ''],
  paid: ['مسدّد', 'Paid', 'success'],
  waived: ['معفي', 'Waived', 'neutral'],
};
export const PAY_STATUS = {
  pending: ['قيد المراجعة', 'Pending', ''],
  confirmed: ['مؤكَّدة', 'Confirmed', 'success'],
  rejected: ['مرفوضة', 'Rejected', 'warning'],
};
export const METHODS = {
  bank_transfer: ['تحويل بنكي', 'Bank transfer'],
  cash: ['نقدي', 'Cash'],
  card: ['بطاقة', 'Card'],
  other: ['أخرى', 'Other'],
};
export const KINDS = {
  tuition: ['مصروفات دراسية', 'Tuition'],
  registration: ['رسوم تسجيل', 'Registration'],
  service: ['خدمات', 'Service'],
  other: ['أخرى', 'Other'],
};
export const money = (n, cur = 'EGP') => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const fmt = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

export default function StudentFees() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [form, setForm] = useState({ amount: '', reference: '', method: 'bank_transfer', note: '' });

  const load = useCallback(() => api.get('/api/v1/fees/mine', { locale }).then((j) => setData(j.data || { summary: {}, fees: [] })), [locale]);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError(null); setNotice(null);
    try { const j = await fn(); setNotice(j?.message || null); await load(); return true; } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  };

  const openPay = (f) => {
    const pending = f.payments.filter((p) => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
    setPayFor(f.id);
    setForm({ amount: String(Math.max(0, f.balance - pending).toFixed(2)), reference: '', method: 'bank_transfer', note: '' });
  };
  const submit = async (e, f) => {
    e.preventDefault();
    if (await run(() => api.post(`/api/v1/fees/${f.id}/notice`, { ...form, amount: Number(form.amount), locale }))) setPayFor(null);
  };
  const receipt = (p) => downloadAuthed(`/api/v1/fees/payments/${p.id}/receipt`, `${p.receipt_no}.pdf`, { locale }).catch((e) => setError(errorMessage(e)));

  const s = data?.summary || {};
  const cur = data?.fees?.[0]?.currency || 'EGP';

  return (
    <AcPage>
      <AcHead
        title={ar ? 'المصاريف' : 'Fees'}
        text={ar ? 'ادفع من خلال قنوات الجامعة (تحويل بنكي أو الخزينة)، ثم أرسل رقم المرجع هنا ليتم تأكيد الدفعة وإصدار الإيصال.' : 'Pay through the university channels (bank transfer or cashier), then send the reference here so the payment is confirmed and a receipt issued.'}
      />
      <AcAlerts error={error} notice={notice} />

      {!data && !error ? <Skeleton h={90} count={3} /> : data && (
        <>
          <AcKpis items={[
            { label: ar ? 'المتبقي عليك' : 'Balance due', value: money(s.total_due, cur), icon: 'dollar', tone: s.total_due > 0 ? 'warn' : 'good' },
            { label: ar ? 'المدفوع' : 'Paid', value: money(s.paid, cur), icon: 'check-circle', tone: 'good' },
            { label: ar ? 'متأخرة' : 'Overdue', value: s.overdue || 0, icon: 'alert-triangle', tone: s.overdue ? 'bad' : '' },
          ]} />

          {data.fees.length === 0 ? (
            <EmptyState icon="dollar" title={ar ? 'لا توجد مصروفات مستحقة' : 'No fees issued to you'} />
          ) : data.fees.map((f) => {
            const st = FEE_STATUS[f.status] || FEE_STATUS.unpaid;
            const canPay = (f.status === 'unpaid' || f.status === 'partial');
            return (
              <AcPanel
                key={f.id}
                title={f.name}
                sub={`${ar ? KINDS[f.kind]?.[0] : KINDS[f.kind]?.[1]}${f.due_on ? ` · ${ar ? 'الاستحقاق' : 'Due'} ${f.due_on}` : ''}`}
                flush={f.payments.length > 0 || payFor === f.id}
                tools={(
                  <>
                    {f.overdue && <span className="st-pill st-pill--warning">{ar ? 'متأخر' : 'Overdue'}</span>}
                    <span className={`st-pill${st[2] ? ` st-pill--${st[2]}` : ''}`}>{ar ? st[0] : st[1]}</span>
                    {canPay && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => (payFor === f.id ? setPayFor(null) : openPay(f))}>{ar ? 'إرسال إخطار دفع' : 'Send payment notice'}</button>}
                  </>
                )}
              >
                {f.payments.length > 0 || payFor === f.id ? (
                  <>
                    <div className="acx-panel__body">
                      <AcNums items={[[ar ? 'الإجمالي' : 'Total', money(f.amount, f.currency)], [ar ? 'المدفوع' : 'Paid', money(f.paid, f.currency)], [ar ? 'المتبقي' : 'Balance', money(f.balance, f.currency)]]} />
                      {f.status === 'waived' && f.waive_note && <p className="acx-note" style={{ marginTop: 8 }}>{ar ? 'سبب الإعفاء: ' : 'Waiver reason: '}{f.waive_note}</p>}
                    </div>

                    {payFor === f.id && (
                      <form className="acx-form" onSubmit={(e) => submit(e, f)}>
                        <div className="acx-form__grid">
                          <AcField label={ar ? 'المبلغ' : 'Amount'}><input className="acx-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></AcField>
                          <AcField label={ar ? 'طريقة الدفع' : 'Method'}>
                            <select className="acx-input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                              {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}
                            </select>
                          </AcField>
                          <AcField label={ar ? 'رقم مرجع التحويل / الإيصال' : 'Transfer / receipt reference'}><input className="acx-input" required maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></AcField>
                        </div>
                        <AcField label={ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}><textarea className="acx-input" rows={2} maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></AcField>
                        <div className="acx-form__actions">
                          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{ar ? 'إرسال' : 'Send'}</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPayFor(null)}>{ar ? 'إلغاء' : 'Cancel'}</button>
                        </div>
                      </form>
                    )}

                    {f.payments.length > 0 && (
                      <AcTable>
                        <thead><tr><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'المبلغ' : 'Amount'}</th><th>{ar ? 'الطريقة' : 'Method'}</th><th>{ar ? 'المرجع' : 'Reference'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th /></tr></thead>
                        <tbody>
                          {f.payments.map((p) => {
                            const ps = PAY_STATUS[p.status] || PAY_STATUS.pending;
                            return (
                              <tr key={p.id}>
                                <td className="is-num">{fmt(p.created_at)}</td><td className="is-num">{money(p.amount, f.currency)}</td>
                                <td>{ar ? METHODS[p.method]?.[0] : METHODS[p.method]?.[1]}</td><td>{p.reference || '—'}</td>
                                <td>
                                  <span className={`st-pill${ps[2] ? ` st-pill--${ps[2]}` : ''}`}>{ar ? ps[0] : ps[1]}</span>
                                  {p.status === 'rejected' && p.decision_note && <span className="acx-sub">{p.decision_note}</span>}
                                </td>
                                <td className="is-end">
                                  {p.status === 'confirmed' && p.receipt_no && <button type="button" className="btn btn-outline btn-sm" onClick={() => receipt(p)}><Icon name="download" size={14} /> {ar ? 'الإيصال' : 'Receipt'}</button>}
                                  {p.status === 'pending' && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => api.delete(`/api/v1/fees/notices/${p.id}`, { locale }))}>{ar ? 'سحب' : 'Withdraw'}</button>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </AcTable>
                    )}
                  </>
                ) : (
                  <>
                    <AcNums items={[[ar ? 'الإجمالي' : 'Total', money(f.amount, f.currency)], [ar ? 'المدفوع' : 'Paid', money(f.paid, f.currency)], [ar ? 'المتبقي' : 'Balance', money(f.balance, f.currency)]]} />
                    {f.status === 'waived' && f.waive_note && <p className="acx-note" style={{ marginTop: 8 }}>{ar ? 'سبب الإعفاء: ' : 'Waiver reason: '}{f.waive_note}</p>}
                  </>
                )}
              </AcPanel>
            );
          })}
        </>
      )}
    </AcPage>
  );
}
