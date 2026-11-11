import { Link } from 'react-router-dom';
import Icon from './Icon';
import PageLoading from './PageLoading';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useMyPcAccess } from '../hooks/useMyPcAccess';
import { portalPrefix } from '../config/navConfig';

/**
 * Wraps the My PC pages. When the administrator closed My PC (for everybody, for this portal/role, or for this user)
 * the desktop never mounts: the person sees why, with a way back to the portal. Until the answer arrives — or if it
 * cannot be fetched — the page opens as usual (the API still refuses a closed account on its own).
 */
export default function MyPcAccessGate({ children }) {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const a = useMyPcAccess(user?.id);
  if (a.allowed === null) return <PageLoading />;
  if (a.allowed) return children;

  const title = a.code === 'role' ? (ar ? 'جهازي غير متاح لهذه البوابة' : 'My PC is not available for this portal')
    : a.code === 'blocked' ? (ar ? 'جهازي مقفول لحسابك' : 'My PC is closed for your account')
    : (ar ? 'جهازي متوقف مؤقتًا' : 'My PC is temporarily unavailable');
  const home = `/${portalPrefix(user?.role)}/dashboard`;
  return (
    <div role="alert" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
      <div style={{ maxWidth: 440, textAlign: 'center', display: 'grid', gap: 12, justifyItems: 'center' }}>
        <span style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--color-danger, #d33) 14%, transparent)', color: 'var(--color-danger, #d33)' }}>
          <Icon name="lock" size={28} />
        </span>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {a.message && <p style={{ margin: 0, opacity: 0.8 }}>{a.message}</p>}
        <Link to={home} className="btn btn-outline btn-sm">{ar ? 'الرجوع للوحة التحكم' : 'Back to dashboard'}</Link>
      </div>
    </div>
  );
}
