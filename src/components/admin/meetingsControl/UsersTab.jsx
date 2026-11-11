import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { Skeleton, EmptyState } from '../AdminPage';
import { BASE, useBanner, useL } from './shared';

/** Block / unblock users from creating meetings (they can still join other people's meetings). */
export default function UsersTab() {
  const { L } = useL();
  const { banner, setNotice, setError, clear } = useBanner();
  const [blocked, setBlocked] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => api.get(`${BASE}/blocked-users`).then((j) => setBlocked(j.data || [])), []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))); }, [load, setError]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const h = setTimeout(() => {
      api.get(`${BASE}/users/search`, { q: q.trim() }).then((j) => setResults(j.data || [])).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  async function block(u) {
    clear(); setBusy(u.id);
    try { const j = await api.post(`${BASE}/blocked-users`, { user_id: u.id }); setBlocked(j.data || []); setNotice(L(`${u.name} can no longer create meetings.`, `${u.name} لم يعد يقدر ينشئ اجتماعات.`)); } catch (e) { setError(errorMessage(e)); }
    setBusy(null);
  }
  async function unblock(u) {
    clear(); setBusy(u.id);
    try { const j = await api.del(`${BASE}/blocked-users/${u.id}`); setBlocked(j.data || []); setNotice(L('User unblocked.', 'تم رفع الحظر.')); } catch (e) { setError(errorMessage(e)); }
    setBusy(null);
  }

  const isBlocked = (id) => (blocked || []).some((b) => b.id === id);

  return (
    <div className="mtc-stack">
      {banner}
      <section className="sa-card mtc-card">
        <h2 className="mtc-card__title"><Icon name="user-x" size={16} /> {L('Block a user from creating meetings', 'حظر مستخدم من إنشاء اجتماعات')}</h2>
        <p className="mtc-muted">{L('Blocked users can still join meetings they are invited to. Admins cannot be blocked.', 'المستخدم المحظور لسه يقدر يدخل اجتماعات اتدعى ليها. الأدمن مايتحظرش.')}</p>
        <div className="adm-filters__search" style={{ maxWidth: 420 }}>
          <input className="form-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Search by name or email…', 'ابحث بالاسم أو الإيميل…')} />
        </div>
        {results.length > 0 && (
          <ul className="mtc-list">
            {results.map((u) => (
              <li key={u.id}>
                <span><strong>{u.name}</strong><br /><small className="mtc-muted">{u.email}</small></span>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy === u.id || isBlocked(u.id)} onClick={() => block(u)}>
                  <Icon name="x-circle" size={14} /> {isBlocked(u.id) ? L('Blocked', 'محظور') : L('Block', 'حظر')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sa-card mtc-card">
        <h2 className="mtc-card__title"><Icon name="users" size={16} /> {L('Blocked users', 'المحظورين')} {blocked ? `(${blocked.length})` : ''}</h2>
        {!blocked ? <Skeleton rows={3} cols={2} /> : blocked.length === 0 ? (
          <EmptyState icon="check-circle" title={L('Nobody is blocked', 'مفيش حد محظور')} />
        ) : (
          <ul className="mtc-list">
            {blocked.map((u) => (
              <li key={u.id}>
                <span><strong>{u.name}</strong><br /><small className="mtc-muted">{u.email}</small></span>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy === u.id} onClick={() => unblock(u)}>{L('Unblock', 'رفع الحظر')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
