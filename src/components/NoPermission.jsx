import Icon from './Icon';
import { useLanguage } from '../context/LanguageContext';

/** Shown in place of a page whose permission an admin has taken away from the user's role.
 *  The server already refuses the page's API calls (403 permission_denied); this just stops
 *  the page from rendering a wall of failed requests. */
export default function NoPermission({ permission }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  return (
    <div style={{ display: 'grid', placeItems: 'center', textAlign: 'center', padding: '72px 16px', gap: 10 }}>
      <Icon name="lock" size={34} />
      <h2 style={{ margin: 0 }}>{ar ? 'ليست لديك صلاحية لهذه الصفحة' : "You don't have access to this page"}</h2>
      <p style={{ margin: 0, maxWidth: 440, opacity: 0.75 }}>
        {ar
          ? 'تم إيقاف هذه الصلاحية لدورك الحالي. تواصل مع مسؤول المنصة إذا كنت تحتاجها.'
          : 'This permission is turned off for your role. Contact a platform administrator if you need it.'}
      </p>
      {permission && <code style={{ fontSize: 12, opacity: 0.6 }}>{permission}</code>}
    </div>
  );
}
