import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { ConfirmModal, Field } from '../admin/adminUi';
import { EmptyState, ErrorState, Skeleton } from '../admin/AdminPage';
import { Switch, useBanner, useL } from '../admin/meetingsControl/shared';
import FeaturePicker from './FeaturePicker';
import { featureLabel, money } from './accessShared';

const BASE = '/api/v1/access/plans';
const BLANK = { name_en: '', name_ar: '', description: '', price: '0', currency: 'EGP', duration_days: '', features: [] };

function PlanModal({ plan, onClose, onSaved }) {
  const { L } = useL();
  const [f, setF] = useState(plan ? { ...plan, description: plan.description || '', price: String(plan.price), duration_days: plan.duration_days ?? '' } : BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = {
      name_en: f.name_en.trim(), name_ar: f.name_ar.trim(), description: f.description.trim() || null,
      price: Number(f.price || 0), currency: String(f.currency || 'EGP').toUpperCase(),
      duration_days: f.duration_days === '' ? null : Number(f.duration_days), features: f.features,
    };
    try {
      if (plan) await api.patch(`${BASE}/${plan.id}`, body); else await api.post(BASE, body);
      onSaved();
    } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 className="modal-box__title text-h3">{plan ? L('Edit plan', 'تعديل الباقة') : L('New plan', 'باقة جديدة')}</h2>
        <Field id="pl-en" label={L('Name (English)', 'الاسم (إنجليزي)')} required><input id="pl-en" className="form-input" value={f.name_en} onChange={set('name_en')} required maxLength={120} /></Field>
        <Field id="pl-ar" label={L('Name (Arabic)', 'الاسم (عربي)')} required><input id="pl-ar" className="form-input" dir="rtl" value={f.name_ar} onChange={set('name_ar')} required maxLength={120} /></Field>
        <Field id="pl-d" label={L('Description', 'الوصف')}><textarea id="pl-d" className="form-input" rows={2} value={f.description} onChange={set('description')} maxLength={1000} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 10 }}>
          <Field id="pl-p" label={L('Price (0 = free)', 'السعر (0 = مجاني)')}><input id="pl-p" className="form-input" type="number" min="0" step="0.01" value={f.price} onChange={set('price')} /></Field>
          <Field id="pl-c" label={L('Currency', 'العملة')}><input id="pl-c" className="form-input" maxLength={3} value={f.currency} onChange={set('currency')} dir="ltr" /></Field>
          <Field id="pl-n" label={L('Days (empty = no expiry)', 'عدد الأيام (فاضي = بدون انتهاء)')}><input id="pl-n" className="form-input" type="number" min="1" max="3650" value={f.duration_days} onChange={set('duration_days')} /></Field>
        </div>
        <Field id="pl-f" label={L('Features included', 'المميزات المشمولة')} required><FeaturePicker value={f.features} onChange={(features) => setF((p) => ({ ...p, features }))} /></Field>
        {err && <p className="um-msg um-msg--error" role="alert">{err}</p>}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{L('Cancel', 'إلغاء')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !f.features.length}>{busy ? '…' : L('Save', 'حفظ')}</button>
        </div>
      </form>
    </div>
  );
}

export default function PlansTab() {
  const { ar, L } = useL();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(undefined); // undefined closed · null new · plan
  const [off, setOff] = useState(null);
  const [busy, setBusy] = useState(false);
  const bn = useBanner();

  const load = useCallback(() => api.get(BASE).then((j) => { setRows(j.data || []); setError(null); }).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  async function toggle(p, on) {
    try { await api.patch(`${BASE}/${p.id}`, { is_active: on }); load(); } catch (e) { bn.setError(errorMessage(e)); }
  }
  async function disable() {
    setBusy(true);
    try { await api.del(`${BASE}/${off.id}`); bn.setNotice(L('Plan disabled.', 'اتعطلت الباقة.')); setOff(null); load(); } catch (e) { bn.setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!rows) return <Skeleton rows={4} cols={5} />;

  return (
    <div className="mtc-stack">
      {bn.banner}
      <div><button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit(null)}><Icon name="plus" size={14} /> {L('New plan', 'باقة جديدة')}</button></div>
      {rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="inbox" title={L('No plans yet', 'مفيش باقات لسه')} hint={L('Create a price list entry, then give it to an account from the Accounts tab.', 'اعمل باقة بسعر ومدة، وبعدين اديها لحساب من تاب الحسابات.')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('Plan', 'الباقة')}</th><th>{L('Price', 'السعر')}</th><th>{L('Duration', 'المدة')}</th><th>{L('Features', 'المميزات')}</th><th>{L('Active', 'مفعّلة')}</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td data-label={L('Plan', 'الباقة')}><strong>{ar ? p.name_ar : p.name_en}</strong>{p.description && <><br /><small className="mtc-muted">{p.description}</small></>}</td>
              <td data-label={L('Price', 'السعر')}>{money(p.price, p.currency) || L('Free', 'مجاني')}</td>
              <td data-label={L('Duration', 'المدة')}>{p.duration_days ? L(`${p.duration_days} days`, `${p.duration_days} يوم`) : L('No expiry', 'بدون انتهاء')}</td>
              <td data-label={L('Features', 'المميزات')}>{p.features.map((k) => featureLabel(k, ar)).join('، ')}</td>
              <td data-label={L('Active', 'مفعّلة')}><Switch checked={p.is_active} label={L('Active', 'مفعّلة')} onChange={(x) => toggle(p, x)} /></td>
              <td className="mtc-row-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(p)}>{L('Edit', 'تعديل')}</button>
                {p.is_active && <button type="button" className="btn btn-outline btn-sm" onClick={() => setOff(p)}>{L('Disable', 'تعطيل')}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit !== undefined && <PlanModal plan={edit} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); bn.setNotice(L('Saved.', 'اتحفظ.')); load(); }} />}
      {off && <ConfirmModal danger busy={busy} title={L('Disable plan?', 'تعطيل الباقة؟')} message={L('New grants can no longer use it. Existing grants keep working.', 'مش هينفع تتمنح من جديد. المنح الحالية هتفضل شغالة.')} confirmLabel={L('Disable', 'تعطيل')} onConfirm={disable} onClose={() => setOff(null)} />}
    </div>
  );
}
