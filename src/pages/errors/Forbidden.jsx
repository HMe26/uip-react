import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import Icon from '../../components/Icon';
import { useAuth } from '../../context/AuthContext';
import { roleHome } from '../../config/roleHome';
import ErrorPage from './ErrorPage';

/** 403 — signed in, but this account's role or ownership doesn't cover this page. */
export default function Forbidden() {
  const { locale } = useLanguage();
  const { status, user } = useAuth();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  return (
    <ErrorPage
      code={403}
      statusKey="FORBIDDEN"
      title={t("You don't have access here.", 'مفيش صلاحية للدخول هنا.')}
      desc={t(
        "This page belongs to a different account or role. If you think that's wrong, contact whoever manages access for your organization.",
        'الصفحة دي تابعة لحساب أو صلاحية مختلفة. لو ده غلط في رأيك، كلّم المسؤول عن الصلاحيات في جهتك.'
      )}
      primaryAction={
        status === 'guest' ? (
          <Link to="/auth/login" className="btn btn-primary">
            <Icon name="user" size={16} />
            {t('Log in', 'تسجيل الدخول')}
          </Link>
        ) : (
          <Link to={roleHome(user?.role)} className="btn btn-primary">
            <Icon name="dashboard" size={16} />
            {t('Go to dashboard', 'الذهاب للوحة التحكم')}
          </Link>
        )
      }
    />
  );
}
