import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Field } from '../admin/adminUi';
import { useL } from '../admin/meetingsControl/shared';
import FeaturePicker from './FeaturePicker';

/** Give an account access: pick a plan from the price list, or set features / price / days by hand. account: {id,name,email} | null (then ask for an e-mail). */
export default function GrantModal({ account, onClose, onDone }) {
  const { ar, L } = useL();
  const [plans, setPlans] = useState([]);
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('plan'); // plan | custom
  const [planId, setPlanId] = useState('');
  const [features, setFeatures] = useState([]);
  const [price, setPrice] = useState('0');
  const [currency, setCurrency] = useState('EGP');
  const [days, setDays] = useState('');
  const [paid, setPaid] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/api/v1/access/plans').then((j) => {
      const act = (j.data || []).filter((p) => p.is_active);
      setPlans(act);
      if (act.length) setPlanId(String(act[0].id)); else setMode('custom');
    }).catch(() => setMode('custom'));
  }, []);

  const plan = plans.find((p) => String(p.id) === planId);
  const effPrice = mode === 'plan' ? Number(plan?.price || 0) : Number(price || 0);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const body = { note: note.trim() || null, paid: effPrice > 0 ? paid : false };
    if (account) body.user_id = account.id; else body.email = email.trim();
    if (mode === 'plan') body.plan_id = Number(planId);
    else Object.assign(body, { features, price: Number(price || 0), currency: String(currency || 'EGP').toUpperCase(), duration_days: days === '' ? null : Number(days) });
    try { await api.post('/api/v1/access/grants', body); onDone(); } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }

  const canSubmit = (account || email.trim()) && (mode === 'plan' ? !!plan : features.length > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="modal-box__title text-h3">{L('Give access', 'منح صلاحية')}</h2>
        {account
          ? <p className="adm-modal-text"><strong>{account.name}</strong><br /><small className="mtc-muted">{account.email}</small></p>
          : <Field id="gr-e" label={L('Student e-mail', 'إيميل الطالب')} required><input id="gr-e" className="form-input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>}

        <div className="sa-chips" role="group">
          {plans.length > 0 && <button type="button" className={`sa-chip${mode === 'plan' ? ' is-active' : ''}`} onClick={() => setMode('plan')}>{L('From price list', 'من قايمة الأسعار')}</button>}
          <button type="button" className={`sa-chip${mode === 'custom' ? ' is-active' : ''}`} onClick={() => setMode('custom')}>{L('Custom', 'مخصّص')}</button>
        </div>

        {mode === 'plan' ? (
          <Field id="gr-p" label={L('Plan', 'الباقة')}>
            <select id="gr-p" className="form-select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{(ar ? p.name_ar : p.name_en)} — {Number(p.price) > 0 ? `${p.price} ${p.currency}` : L('Free', 'مجاني')}{p.duration_days ? ` · ${p.duration_days}${L('d', ' يوم')}` : ''}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field id="gr-f" label={L('Features', 'المميزات')} required><FeaturePicker value={features} onChange={setFeatures} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 10 }}>
              <Field id="gr-pr" label={L('Price (0 = free)', 'السعر (0 = مجاني)')}><input id="gr-pr" className="form-input" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              <Field id="gr-c" label={L('Currency', 'العملة')}><input id="gr-c" className="form-input" maxLength={3} dir="ltr" value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
              <Field id="gr-d" label={L('Days (empty = no expiry)', 'الأيام (فاضي = بدون انتهاء)')}><input id="gr-d" className="form-input" type="number" min="1" max="3650" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
            </div>
          </>
        )}

        {effPrice > 0 && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            {L(`I received ${effPrice} — start access now`, `استلمت ${effPrice} — ابدأ الصلاحية دلوقتي`)}
          </label>
        )}
        {effPrice > 0 && !paid && <p className="mtc-muted">{L('Without this, access stays "awaiting payment" until you confirm it from the Grants tab.', 'من غيرها الصلاحية بتفضل "في انتظار الدفع" لحد ما تأكدها من تاب المنح.')}</p>}
        <Field id="gr-n" label={L('Note (internal)', 'ملاحظة (داخلية)')}><input id="gr-n" className="form-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p className="um-msg um-msg--error" role="alert">{err}</p>}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{L('Cancel', 'إلغاء')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !canSubmit}>{busy ? '…' : L('Grant', 'منح')}</button>
        </div>
      </form>
    </div>
  );
}
