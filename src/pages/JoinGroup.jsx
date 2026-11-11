import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { portalPrefix } from '../config/navConfig';
import { Avatar } from '../components/messaging/ConversationRail';
import Icon from '../components/Icon';
import AmbientBackdrop from '../components/AmbientBackdrop';
import { BASE, localizeError } from '../components/messaging/groupText';

/**
 * /join/group/:token — landing page of a group invite link. Shows the group (photo, name, description,
 * member count), then joins it — or sends a join request when the admins approve new members.
 * Signed-out visitors are sent to sign in first by <ProtectedRoute>, then returned here.
 */
export default function JoinGroup() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);

  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const openChat = (id) => navigate(`/${portalPrefix(user?.role)}/messages/${id}`, { replace: true });

  useEffect(() => {
    try { sessionStorage.removeItem('uip.postLogin'); } catch { /* nothing to clear */ }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`${BASE}/groups/invite/${encodeURIComponent(token)}`)
      .then((res) => { if (alive) { setInfo(res.data); setError(''); } })
      .catch((err) => { if (alive) setError(localizeError(err?.message) || t('This invite link is invalid.', 'رابط الدعوة غير صالح.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`${BASE}/groups/invite/${encodeURIComponent(token)}/join`);
      if (res.data?.status === 'requested') setInfo((p) => ({ ...p, status: 'request_pending' }));
      else openChat(res.data?.conversation_id || info.conversation_id);
    } catch (err) {
      setError(localizeError(err?.message) || t('Something went wrong.', 'حدث خطأ ما.'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await api.del(`${BASE}/groups/invite/${encodeURIComponent(token)}/request`);
      setInfo((p) => ({ ...p, status: 'needs_approval' }));
    } catch (err) {
      setError(localizeError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  const status = info?.status;

  return (
    <div className="join-grp">
      <AmbientBackdrop />
      <div className="join-grp__card">
        {loading ? (
          <p className="join-grp__muted">{t('Loading invite…', 'جارٍ تحميل الدعوة…')}</p>
        ) : !info ? (
          <>
            <div className="join-grp__icon join-grp__icon--bad"><Icon name="link" size={26} /></div>
            <h1>{t('Invite link unavailable', 'رابط الدعوة غير متاح')}</h1>
            <p className="join-grp__muted">{error}</p>
            <Link className="btn btn-primary" to={`/${portalPrefix(user?.role)}/messages`}>{t('Go to messages', 'الذهاب إلى الرسائل')}</Link>
          </>
        ) : (
          <>
            <div className="join-grp__avatar"><Avatar name={info.name || ''} isGroup src={info.avatar_path} /></div>
            <span className="join-grp__eyebrow">{t('You are invited to join a group', 'تمت دعوتك للانضمام إلى مجموعة')}</span>
            <h1>{info.name}</h1>
            <p className="join-grp__members">
              <Icon name="users" size={14} /> {info.member_count} {t('members', 'عضو')}
              {info.member_names?.length > 0 && <span> · {info.member_names.slice(0, 3).join(ar ? '، ' : ', ')}{info.member_count > 3 ? '…' : ''}</span>}
            </p>
            {info.description && <p className="join-grp__desc">{info.description}</p>}

            {status === 'member' && (
              <>
                <p className="join-grp__note join-grp__note--ok"><Icon name="check-circle" size={15} /> {t('You are already a member of this group.', 'أنت عضو في هذه المجموعة بالفعل.')}</p>
                <button type="button" className="btn btn-primary" onClick={() => openChat(info.conversation_id)}>{t('Open group', 'فتح المجموعة')}</button>
              </>
            )}
            {(status === 'open' || status === 'needs_approval') && (
              <>
                {status === 'needs_approval' && <p className="join-grp__note">{t('An admin has to approve your request before you can join.', 'يجب أن يوافق أحد المشرفين على طلبك قبل الانضمام.')}</p>}
                <button type="button" className="btn btn-primary" disabled={busy} onClick={join}>
                  {status === 'needs_approval' ? t('Request to join', 'طلب الانضمام') : t('Join group', 'انضمام للمجموعة')}
                </button>
              </>
            )}
            {status === 'request_pending' && (
              <>
                <p className="join-grp__note join-grp__note--ok"><Icon name="clock" size={15} /> {t('Your request was sent. You will be notified when an admin responds.', 'تم إرسال طلبك. سيصلك إشعار عند رد أحد المشرفين.')}</p>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={withdraw}>{t('Withdraw request', 'سحب الطلب')}</button>
              </>
            )}
            {status === 'full' && <p className="join-grp__note">{t('This group has reached its member limit.', 'وصلت المجموعة إلى الحد الأقصى للأعضاء.')}</p>}
            {error && <p className="join-grp__note join-grp__note--bad">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
