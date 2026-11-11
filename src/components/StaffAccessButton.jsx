import { Link } from 'react-router-dom';
import { isNative } from '../native';
import { STAFF_LOGIN_PATH } from '../config/staffPortal';
import { useLanguage } from '../context/LanguageContext';
import Icon from './Icon';

/** Android app only: the staff sign-in page is not linked on the web, and the app has no address bar. */
export default function StaffAccessButton() {
  const { locale } = useLanguage();
  if (!isNative) return null;
  return (
    <div className="auth-footer-link" style={{ marginTop: 14 }}>
      <Link
        to={STAFF_LOGIN_PATH}
        className="auth-link"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}
      >
        <Icon name="shield" size={16} />
        {locale === 'ar' ? 'دخول الموظفين (أدمن / محلل بيانات / أمن)' : 'Staff sign-in (Admin / Data analyst / Security)'}
      </Link>
    </div>
  );
}
