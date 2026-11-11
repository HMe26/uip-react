import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { wasStaffSession } from '../api/client';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import { useLanguage } from '../context/LanguageContext';

// A group invite link opened while signed out: remembered for this tab and resumed right after any kind of sign-in.
const PENDING_KEY = 'uip.postLogin';
const INVITE_PATH = /^\/join\/group\/[A-Za-z0-9_-]{8,64}\/?$/;
// Read-only on purpose (render must stay pure); JoinGroup clears it once it is on screen.
const takePending = () => {
  try {
    const p = sessionStorage.getItem(PENDING_KEY);
    return p && INVITE_PATH.test(p) ? p : null;
  } catch { return null; }
};

// Staff-only areas: a signed-out visitor to these goes to the hidden staff sign-in.
const STAFF_AREAS = /^\/(admin|data-analysis|data_analyst|security)(\/|$)/;

export default function ProtectedRoute() {
  const { status } = useAuth();
  const { locale } = useLanguage();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="page-loading">{locale === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</div>;
  }
  if (status === 'guest') {
    if (INVITE_PATH.test(location.pathname)) {
      try { sessionStorage.setItem(PENDING_KEY, location.pathname); } catch { /* not remembered */ }
    }
    const toStaff = wasStaffSession() || STAFF_AREAS.test(location.pathname);
    return <Navigate to={toStaff ? STAFF_LOGIN_PATH : '/auth/login'} state={{ from: location }} replace />;
  }
  const pending = takePending();
  if (pending && pending !== location.pathname) return <Navigate to={pending} replace />;
  return <Outlet />;
}
