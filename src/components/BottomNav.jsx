import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import Icon from './Icon';
import { getNavConfig } from '../config/navConfig';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

// Curated 4-item priority lists per role, ported from uip_bottom_nav()
// in app/Views/layouts/sidebar.php. Falls back to the generic
// dashboard/messages/notifications/settings set for any role not listed.
const PRIORITY = {
  student: ['dashboard', 'projects', 'ai-analysis', 'messages'],
  university: ['dashboard', 'approvals', 'students', 'messages'],
  admin: ['dashboard', 'universities', 'users', 'messages'],
  academic_staff: ['dashboard', 'question-banks', 'exams', 'messages'],
  supervisor: ['dashboard', 'projects', 'exams', 'messages'],
};

export default function BottomNav({ role, unreadMessages = 0, unread = 0, onMoreClick }) {
  const { locale } = useLanguage();
  const { can } = useAuth();

  // The CSS (bottom-nav.css) keys page padding and the profile-menu height off this body class,
  // so the menu stops above the bar instead of sliding underneath it.
  useEffect(() => {
    document.body.classList.add('has-bottom-nav');
    return () => document.body.classList.remove('has-bottom-nav');
  }, []);

  const sections = getNavConfig(role, can);
  const allItems = Object.values(sections).flat();
  const findItem = (key) => allItems.find((i) => i.key === key && i.built);

  const priority = PRIORITY[role] || ['dashboard', 'messages', 'notifications', 'settings'];
  const items = priority.map(findItem).filter(Boolean).slice(0, 4);

  return (
    <nav className="bottom-nav" aria-label={locale === 'ar' ? 'التنقل الرئيسي' : 'Primary navigation'}>
      {items.map((item) => (
        <NavLink
          key={item.key}
          to={item.route}
          className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}
        >
          <i className="bottom-nav__icon">
            <Icon name={item.icon} size={21} />
            {(() => {
              const n = item.key === 'messages' ? unreadMessages : item.key === 'notifications' ? unread : 0;
              return n > 0 ? <b className="bottom-nav__badge" aria-label={`${n}`}>{n > 99 ? '99+' : n}</b> : null;
            })()}
          </i>
          <span>{item[locale] || item.en}</span>
        </NavLink>
      ))}
      <button type="button" className="bottom-nav__item" onClick={onMoreClick} aria-label={locale === 'ar' ? 'المزيد' : 'More'}>
        <Icon name="grid" size={21} />
        <span>{locale === 'ar' ? 'المزيد' : 'More'}</span>
      </button>
    </nav>
  );
}
