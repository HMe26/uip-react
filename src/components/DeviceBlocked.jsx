import { useLanguage } from '../context/LanguageContext';
import Icon from './Icon';
import './DeviceBlocked.css';

const DEVICE_ICON = { mobile: 'smartphone', tablet: 'tablet', desktop: 'monitor', unknown: 'smartphone', banned: 'smartphone' };

const DEVICE_LABEL = {
  en: { mobile: 'mobile phones', tablet: 'tablets', desktop: 'computers', unknown: 'this type of device', banned: 'this device' },
  ar: { mobile: 'الموبايل', tablet: 'التابلت', desktop: 'الكمبيوتر', unknown: 'هذا النوع من الأجهزة', banned: 'هذا الجهاز' },
};

const ROLE_LABEL = {
  en: {
    student: 'Student accounts', university: 'University accounts', faculty: 'Faculty accounts', academic_staff: 'Academic staff accounts',
    supervisor: 'Supervisor accounts', admin: 'Administrator accounts', security_admin: 'Security administrator accounts',
    security_officer: 'Security officer accounts', data_analyst: 'Data analyst accounts',
  },
  ar: {
    student: 'حسابات الطلاب', university: 'حسابات الجامعات', faculty: 'حسابات الكليات', academic_staff: 'حسابات أعضاء هيئة التدريس',
    supervisor: 'حسابات المشرفين', admin: 'حسابات مسؤولي النظام', security_admin: 'حسابات مسؤولي الأمان',
    security_officer: 'حسابات ضباط الأمان', data_analyst: 'حسابات محللي البيانات',
  },
};

/**
 * Standalone page shown INSTEAD of the whole app when the Security > Policies > Device restrictions
 * policy blocks this device type. It deliberately has no nav / no links into the platform.
 * `onRetry` re-asks the server (the policy may have been relaxed since); `checking` disables the button meanwhile.
 */
export default function DeviceBlocked({ deviceType = 'unknown', role = null, onRetry, onSwitchAccount, checking = false, stillBlocked = false }) {
  const { locale, toggleLocale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const type = DEVICE_LABEL.en[deviceType] ? deviceType : 'unknown';
  const label = DEVICE_LABEL[isAr ? 'ar' : 'en'][type];
  // Per-account-type rule (e.g. Students on mobile) vs a platform-wide one.
  const roleLabel = role ? (ROLE_LABEL[isAr ? 'ar' : 'en'][role] || role) : null;

  return (
    <main className="devblock" role="alert">
      <div className="devblock__card">
        <div className="devblock__icon" aria-hidden="true">
          <Icon name={DEVICE_ICON[type]} size={40} />
          <span className="devblock__slash" />
        </div>

        <span className="devblock__code" dir="ltr">device_blocked · {type}{role ? ` · ${role}` : ''}</span>

        <h1 className="devblock__title">
          {t("The platform isn't available on this device", 'المنصة غير متاحة على هذا الجهاز')}
        </h1>
        <p className="devblock__desc">
          {roleLabel
            ? t(
                `The platform administrators have turned off access from ${label} for ${roleLabel}. Other account types may still be allowed on this device.`,
                `إدارة المنصة قفلت الدخول من ${label} لـ${roleLabel}. أنواع الحسابات التانية ممكن تفضل مسموحة على الجهاز ده.`
              )
            : t(
                `The platform administrators have turned off access from ${label}. You can't sign in, create an account, or browse from this device while the restriction is on.`,
                `إدارة المنصة قفلت الدخول من ${label}. مش هتقدر تسجّل دخول أو تعمل حساب أو تتصفح المنصة من الجهاز ده طول ما الحظر شغّال.`
              )}
        </p>

        <div className="devblock__tips">
          <ul>
            <li>{t('Open the platform from another device type that is allowed (for example a computer).', 'افتح المنصة من نوع جهاز تاني مسموح (مثلًا كمبيوتر).')}</li>
            <li>{t('If you think this is a mistake, contact the platform support team.', 'لو شايف إن ده غلط، كلّم فريق الدعم في المنصة.')}</li>
          </ul>
        </div>

        <div className="devblock__actions">
          {roleLabel ? (
            <button type="button" className="btn btn-primary" onClick={onSwitchAccount}>
              <Icon name="user" size={16} />
              {t('Use a different account', 'ادخل بحساب تاني')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onRetry} disabled={checking}>
              <Icon name="refresh" size={16} />
              {checking ? t('Checking…', 'جاري الفحص…') : t('Try again', 'حاول تاني')}
            </button>
          )}
          <button type="button" className="btn btn-outline btn-icon" onClick={toggleLocale} aria-label={isAr ? 'English' : 'العربية'} title={isAr ? 'English' : 'العربية'}>
            <Icon name="globe" size={16} />
          </button>
        </div>

        <p className="devblock__status" aria-live="polite">
          {stillBlocked && !checking ? t('Still blocked on this device.', 'لسه الحظر شغّال على الجهاز ده.') : ''}
        </p>
      </div>
    </main>
  );
}
