import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ACCESS_REQUIRED_EVENT, api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import Icon from '../Icon';
import { FEATURE_LABELS } from './accessShared';
import './AccessGate.css';

/**
 * Client side of the "account must be linked to a university" gate (server: AccountAccessGate + UipAuthMiddleware,
 * answers 403 `university_approval_required`). The server is the real enforcement; this component only decides what to show:
 *  - a student with NO university and NO active grant sees <LockedScreen/> everywhere except the profile (where the
 *    join-university form lives), notifications and settings;
 *  - a student with a PARTIAL grant (e.g. messaging only) keeps the whole app, sees a slim banner, and gets a notice when
 *    they open something that is still locked (the API's 403 fires ACCESS_REQUIRED_EVENT);
 *  - the status is re-checked every 45 s while restricted, so an approval opens the app without a manual reload.
 * Every other role is untouched.
 */
const OPEN_PATHS = /^\/(student\/(profile|notifications|settings)|auth\/|notifications|settings|[a-z_-]+\/(notifications|settings))/;
// Security and data-analyst accounts are exempt unless an admin cancelled the exemption for that account (server decides).
const GATED_ROLES = ['student', 'security_admin', 'security_officer', 'data_analyst'];

export default function AccessGate({ children }) {
  const { status, user, logout } = useAuth();
  const { locale, toggleLocale } = useLanguage();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);

  const [st, setSt] = useState(null);
  const [notice, setNotice] = useState(null); // feature key that was refused
  const isStudent = status === 'authenticated' && GATED_ROLES.includes(user?.role);
  const isLearner = user?.role === 'student'; // only students can join a university
  const navAt = useRef(0); // when the person last navigated: only a refusal right after that is about what they opened
  useEffect(() => { navAt.current = Date.now(); }, [pathname]);

  const load = useCallback(() => api.get('/api/v1/students/me/access')
    .then((json) => setSt(json?.data || null))
    .catch(() => { /* fail open: the server still blocks every locked call */ }), []);

  useEffect(() => {
    if (!isStudent) { setSt(null); return undefined; }
    load();
    return undefined;
  }, [isStudent, user?.id, load]);

  useEffect(() => {
    if (!isStudent || !st?.restricted) return undefined;
    // only while the tab is visible, spread randomly so thousands of locked students do not poll in lockstep
    let timer;
    const tick = () => {
      if (document.visibilityState === 'visible') load();
      timer = setTimeout(tick, 45000 * (0.8 + Math.random() * 0.4));
    };
    timer = setTimeout(tick, 45000 * (0.8 + Math.random() * 0.4));
    return () => clearTimeout(timer);
  }, [isStudent, st?.restricted, load]);

  useEffect(() => {
    // Background polls of a locked feature also get refused; only tell the person when it follows something they opened.
    const on = (e) => { load(); if (Date.now() - navAt.current < 4000) setNotice(e.detail?.feature || 'all'); };
    window.addEventListener(ACCESS_REQUIRED_EVENT, on);
    window.addEventListener('uip:access-refresh', load);
    return () => { window.removeEventListener(ACCESS_REQUIRED_EVENT, on); window.removeEventListener('uip:access-refresh', load); };
  }, [load]);

  const restricted = isStudent && st?.restricted;
  const nothing = restricted && !(st.allowed_features || []).length;

  if (nothing && !OPEN_PATHS.test(pathname)) {
    return <LockedScreen st={st} ar={ar} t={t} learner={isLearner} onProfile={() => navigate('/student/profile')} onRefresh={load} onLogout={logout} onLocale={toggleLocale} />;
  }

  return (
    <>
      {children}
      {restricted && (
        <div className="accgate__banner" role="status">
          <Icon name="lock" size={15} />
          <span>{!isLearner
            ? t('Your account access was restricted by an administrator.', 'الإدارة قيّدت صلاحية حسابك.')
            : nothing
              ? t('Your account is not linked to a university yet.', 'حسابك لسه مش مرتبط بجامعة.')
              : t('Some features are locked until a university approves your account.', 'في مميزات مقفولة لحد ما جامعة توافق على حسابك.')}</span>
          {isLearner && <Link to="/student/profile">{t('Join a university', 'انضم لجامعة')}</Link>}
        </div>
      )}
      {notice && (
        <div className="modal-overlay" onClick={() => setNotice(null)}>
          <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-box__title text-h3">{t('This feature needs approval', 'الميزة دي محتاجة موافقة')}</h2>
            <p className="adm-modal-text">
              {t('Your account is not linked to a university, so ', 'حسابك مش مرتبط بجامعة، فـ ')}
              <strong>{FEATURE_LABELS[notice] ? FEATURE_LABELS[notice][ar ? 1 : 0] : t('this feature', 'الميزة دي')}</strong>
              {t(' is locked. Join a university, or ask the admin, a university or a faculty to grant you access.', ' مقفولة. انضم لجامعة، أو اطلب من الإدارة أو الجامعة أو الكلية تديك صلاحية.')}
            </p>
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={() => setNotice(null)}>{t('Close', 'إغلاق')}</button>
              <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); navigate('/student/profile'); }}>{t('Join a university', 'انضم لجامعة')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LockedScreen({ st, ar, t, learner, onProfile, onRefresh, onLogout, onLocale }) {
  const req = st.request;
  const expired = (st.history || []).some((g) => g.state === 'expired');
  const pendingPay = (st.history || []).find((g) => g.state === 'pending');
  return (
    <main className="accgate">
      <div className="accgate__card">
        <div className="accgate__icon" aria-hidden="true"><Icon name="lock" size={34} /></div>
        <h1 className="accgate__title">{learner ? t('Your account is waiting for approval', 'حسابك مستني الموافقة') : t('Your account access was restricted', 'صلاحية حسابك اتقيّدت')}</h1>
        {!learner && <p className="accgate__desc">{t('An administrator cancelled the exemption for this account, so it can no longer use the platform. Contact the admin to get access back.', 'الإدارة لغت الاستثناء عن الحساب ده، فمبقاش ينفع يستخدم المنصة. كلّم الإدارة عشان ترجّع الصلاحية.')}</p>}
        {learner && <p className="accgate__desc">
          {t(
            'Your account is not linked to a university, so meetings, messages, projects and My PC are locked. A university or faculty has to approve you, or the admin can grant you access.',
            'حسابك مش مرتبط بجامعة، فالاجتماعات والرسائل والمشاريع وجهازي مقفولة. لازم جامعة أو كلية توافق عليك، أو الإدارة تديك صلاحية.'
          )}
        </p>}
        {learner && req?.status === 'pending' && <span className="accgate__state"><Icon name="clock" size={14} /> {t('Your join request is under review', 'طلب الانضمام بتاعك قيد المراجعة')}</span>}
        {learner && req?.status === 'rejected' && <span className="accgate__state accgate__state--rejected"><Icon name="x-circle" size={14} /> {t('Your last join request was declined — you can try another university', 'آخر طلب انضمام اترفض — تقدر تجرّب جامعة تانية')}</span>}
        {learner && !req && <span className="accgate__state"><Icon name="building" size={14} /> {t('You have not requested a university yet', 'لسه ماقدمتش على جامعة')}</span>}
        {expired && <p className="accgate__desc">{t('Your previous access has expired.', 'الصلاحية اللي كانت معاك خلصت.')}</p>}
        {pendingPay && <p className="accgate__desc">{t(`An access of ${pendingPay.price} ${pendingPay.currency} was approved for you and starts once the payment is confirmed.`, `اتوافق لك على صلاحية بمبلغ ${pendingPay.price} ${pendingPay.currency} وهتبدأ أول ما الدفع يتأكد.`)}</p>}
        <div className="accgate__actions">
          {learner && <button type="button" className="btn btn-primary" onClick={onProfile}><Icon name="building" size={16} /> {req?.status === 'pending' ? t('View my request', 'شوف طلبي') : t('Choose a university', 'اختار جامعة')}</button>}
          <button type="button" className="btn btn-outline" onClick={onRefresh}><Icon name="refresh" size={16} /> {t('Check again', 'اتأكد تاني')}</button>
        </div>
        <div className="accgate__foot">
          <button type="button" className="btn btn-outline btn-sm" onClick={onLocale} aria-label={ar ? 'English' : 'العربية'}><Icon name="globe" size={16} /></button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onLogout}>{t('Sign out', 'تسجيل الخروج')}</button>
        </div>
      </div>
    </main>
  );
}
