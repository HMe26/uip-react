import { useState } from 'react';
import { api, errorMessage } from '../api/client';

/**
 * Shown under the sign-in error when the account is at its device limit and the platform is set to
 * "block new sign-ins" (Admin → Platform Policy → Devices per account). The password was already verified
 * (that is what the takeover token proves), so the owner may sign one of the open devices out from here
 * and then press "Sign in" again.
 */
export default function DeviceLimitList({ devices, takeoverToken, locale = 'en' }) {
  const ar = locale === 'ar';
  const [list, setList] = useState(devices || []);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [freed, setFreed] = useState(false);

  if (!list.length && !freed) return null;

  async function release(id) {
    setBusyId(id); setError(null);
    try {
      await api.post('/api/v1/auth/session-takeover/release', { takeover_token: takeoverToken, session_id: id });
      setList((l) => l.filter((d) => d.id !== id));
      setFreed(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') || String(iso).includes('+') ? '' : 'Z'));
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(ar ? 'ar-EG' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--color-border, #ddd)', borderRadius: 10, textAlign: ar ? 'right' : 'left' }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>{ar ? 'الأجهزة المسجّل عليها الحساب' : 'Devices signed in to this account'}</strong>
      {list.map((d) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 0' }}>
          <span style={{ minWidth: 0 }}>
            <span dir="auto" style={{ display: 'block', fontWeight: 600 }}>{d.device_label || (ar ? 'جهاز غير معروف' : 'Unknown device')}</span>
            <small style={{ opacity: 0.7 }}>{[d.location_label, when(d.last_activity_at)].filter(Boolean).join(' · ')}</small>
          </span>
          <button type="button" className="btn btn-outline btn-sm" disabled={busyId === d.id} onClick={() => release(d.id)}>
            {busyId === d.id ? '…' : (ar ? 'تسجيل خروج' : 'Sign out')}
          </button>
        </div>
      ))}
      {freed && <p style={{ margin: '8px 0 0', color: 'var(--color-success, #1a7f37)' }}>{ar ? 'تمام — دوس تسجيل الدخول تاني.' : 'Done — now press Sign in again.'}</p>}
      {error && <p style={{ margin: '8px 0 0', color: 'var(--color-danger, #c0392b)' }}>{error}</p>}
    </div>
  );
}
