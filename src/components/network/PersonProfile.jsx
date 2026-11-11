import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { networkApi } from '../../api/networkApi';
import { errorMessage } from '../../api/client';
import { Alert, PAvatar, useTt } from '../posts/shared';
import { roleText } from './PersonCard';
import PersonActions from './PersonActions';
import { useProfilePath } from '../posts/UserAvatar';

/** Person profile drawer: counters, mutual connections, relation to me and every action (connect / follow / message). */
export default function PersonProfile({ person, onClose, onPatch, onChanged }) {
  const { tt, locale } = useTt();
  const nav = useNavigate();
  const profilePath = useProfilePath();
  const [data, setData] = useState(person);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    networkApi.person(person.id).then((r) => { if (alive) setData((cur) => ({ ...cur, ...r })); })
      .catch((e) => { if (alive) setErr(errorMessage(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [person.id]);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);

  const patch = (id, r) => { setData((cur) => ({ ...cur, ...r })); onPatch?.(id, r); onChanged?.(); };
  const org = locale === 'ar' ? (data.org_ar || data.org_en) : (data.org_en || data.org_ar);
  const stat = (n, en, ar) => <div className="nw-stat"><strong>{n ?? '–'}</strong><span>{tt(en, ar)}</span></div>;

  const relation = data.connection === 'connected' ? tt('Connected', 'متصل')
    : data.connection === 'pending_sent' ? tt('Request sent', 'تم إرسال الطلب')
    : data.connection === 'pending_received' ? tt('Wants to connect with you', 'يرغب في الاتصال بك') : '';

  return (
    <div className="nw-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="nw-drawer" role="dialog" aria-modal="true" aria-label={data.full_name}>
        <header className="nw-drawer__bar">
          <button type="button" className="pp-icon" onClick={onClose} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>
        <div className="nw-drawer__hero">
          <PAvatar user={data} size={96} />
          <h2>{data.full_name}</h2>
          <p className="pp-muted">{[roleText(data.role, tt), org].filter(Boolean).join(' · ')}</p>
          <div className="nw-drawer__tags">
            {relation && <span className="pp-chip is-on">{relation}</span>}
            {data.follows_me && <span className="pp-chip">{tt('Follows you', 'يتابعك')}</span>}
            {data.mutual_connections > 0 && <span className="pp-chip"><Icon name="users" size={12} /> {tt(`${data.mutual_connections} mutual`, `${data.mutual_connections} مشترك`)}</span>}
          </div>
        </div>
        {err && <Alert tt={tt}>{err}</Alert>}
        <div className="nw-stats" aria-busy={loading}>
          {stat(data.posts_count, 'Posts', 'منشورات')}
          {stat(data.followers_count, 'Followers', 'متابِعون')}
          {stat(data.following_count, 'Following', 'متابَعون')}
          {stat(data.connections_count, 'Connections', 'اتصالات')}
        </div>
        {data.bio && <p className="nw-drawer__bio" dir="auto">{data.bio}</p>}
        <div className="nw-drawer__actions"><button type="button" className="pp-btn is-primary" onClick={() => { onClose(); nav(profilePath(data.id)); }}><Icon name="user" size={14} /> {tt('View full profile', 'عرض البروفايل الكامل')}</button><PersonActions p={data} onPatch={patch} onRemove={(id, why) => { onChanged?.(); if (why !== 'accepted') onClose(); }} /></div>
        {data.connection === 'pending_received' && <p className="pp-muted nw-drawer__hint">{tt('Accepting also makes you follow each other, so you see each other’s posts.', 'قبول الاتصال يجعلكما تتابعان بعضكما فتظهر منشوراتكما في الفيد.')}</p>}
      </aside>
    </div>
  );
}
