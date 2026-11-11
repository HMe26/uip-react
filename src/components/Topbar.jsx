import { nativeNotify } from '../native'; // [ANDROID]
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import Dropdown from './Dropdown';
import { api, ApiError } from '../api/client';
import { portalPrefix } from '../config/navConfig';
import { getPortalBrand, pick } from '../config/portalBrand';
import { AVATAR_EVENT, avatarSrc } from './insight/AvatarUploader';
import { useLive, PROFILE_WRITE } from '../hooks/useLive';
import { fetchSummary } from '../lib/appSummary';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../config/roleHome';
import { displayName, initials, OPEN_AI_EVENT } from './Sidebar';
import { usePageMetaValue } from '../context/PageMetaContext';
import { parseServerDate } from '../utils/serverDate';
import { VirtualLauncher } from '../virtual/ModeCard';
import { isSoundEnabled, setSoundEnabled, playSound, SOUND_EVENT } from '../lib/notificationSound';

const TXT = {
  en: {
    toggle: 'Toggle sidebar', noNotif: 'No new notifications', viewAll: 'View all notifications',
    profile: 'Profile', publicProfile: 'Public profile', settings: 'Settings', logout: 'Log out', switchLang: 'Switch to English', theme: 'Toggle theme', bell: 'Notifications',
    soundOn: 'Notification sound: on', soundOff: 'Notification sound: off',
    now: 'just now', m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago`,
  },
  ar: {
    toggle: 'تبديل القائمة الجانبية', noNotif: 'لا توجد إشعارات جديدة', viewAll: 'عرض كل الإشعارات',
    profile: 'الملف الشخصي', publicProfile: 'الملف العام', settings: 'الإعدادات', logout: 'تسجيل الخروج', switchLang: 'التبديل للإنجليزية', theme: 'تبديل المظهر', bell: 'الإشعارات',
    soundOn: 'صوت الإشعارات: يعمل', soundOff: 'صوت الإشعارات: متوقف',
    now: 'الآن', m: (n) => `منذ ${n} د`, h: (n) => `منذ ${n} س`, d: (n) => `منذ ${n} يوم`,
  },
};

// Roles with a real results page wired to a /api/v1/search-shaped endpoint
// declare it as `search.route` in config/portalBrand.js. Every other role's
// search box stays display-only (submit is a no-op), same as before.

function timeAgo(dateStr, tx) {
  const diff = (Date.now() - parseServerDate(String(dateStr)).getTime()) / 1000;
  if (!Number.isFinite(diff) || diff < 60) return tx.now;
  if (diff < 3600) return tx.m(Math.floor(diff / 60));
  if (diff < 86400) return tx.h(Math.floor(diff / 3600));
  return tx.d(Math.floor(diff / 86400));
}

// Each portal exposes the signed-in person's avatar under a slightly
// different key; read them all defensively.
const pickAvatar = (json) =>
  json?.data?.profile?.avatar_path || json?.data?.user?.avatar_path || json?.data?.avatar_path || null;

// Same endpoint also carries the current name (the JWT's copy is frozen at login).
const pickNames = (json) => {
  const d = json?.data || {};
  const src = d.profile?.full_name || d.profile?.name_ar ? d.profile : (d.user?.full_name || d.user?.name_ar ? d.user : d);
  if (!src || !(src.full_name || src.name_ar || src.name_en)) return null;
  return { full_name: src.full_name || null, name_ar: src.name_ar || null, name_en: src.name_en || null };
};

export default function Topbar({ role, user, onMenuClick, onLogout, collapsed = false, onUnreadChange }) {
  const { theme, toggleTheme, mode, setMode } = useTheme();
  const { locale, toggleLocale } = useLanguage();
  const navigate = useNavigate();
  const { updateUser, can, isJoker, availableRoles, switchRole } = useAuth();
  const prefix = portalPrefix(role);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchValue, setSearchValue] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  // Last seen state of the bell, to tell a *new* notification from a refresh.
  const bellSeen = useRef({ ready: false, unread: 0, maxId: 0 });

  useEffect(() => {
    const onChange = (e) => setSoundOn(!!e.detail?.enabled);
    window.addEventListener(SOUND_EVENT, onChange);
    return () => window.removeEventListener(SOUND_EVENT, onChange);
  }, []);

  const brand = getPortalBrand(role);
  const isAdmin = brand.shell === 'admin';
  const isFaculty = brand.shell === 'faculty' || isAdmin;
  const isStudent = brand.shell === 'student' || isFaculty;
  const isStaff = brand.shell === 'staff';
  const meta = usePageMetaValue();
  const tx = TXT[locale] || TXT.en;

  // Show the profile photo + current name for every portal. Re-read after any
  // profile/settings write (and on focus), and follow AVATAR_EVENT instantly.
  const loadProfile = useCallback(() => {
    if (!brand.avatar) return;
    api.get(brand.avatar)
      .then((json) => {
        setAvatar(pickAvatar(json));
        const names = pickNames(json);
        if (names) updateUser(names);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.avatar]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => {
    const onChange = (e) => setAvatar(e.detail?.path || null);
    window.addEventListener(AVATAR_EVENT, onChange);
    return () => window.removeEventListener(AVATAR_EVENT, onChange);
  }, []);
  useLive(loadProfile, { watch: PROFILE_WRITE, enabled: !!brand.avatar });

  // Bell: list + unread count. Refreshes after notification/message writes and
  // polls every 30s so new notifications from other people appear on their own.
  const loadBell = useCallback(() => {
    // The counter comes from the shared app summary (already fetched for permissions/heartbeat); the list of the 3 newest
    // unread is only requested when there is something unread. Old backend / failure => the two original calls.
    fetchSummary({ maxAge: 3000 })
      .then(async (sum) => {
        const c = sum?.notification_counts;
        if (c && typeof c.unread === 'number') {
          const prevEmpty = bellSeen.current.ready && bellSeen.current.unread === 0;
          const list = (c.unread === 0 && prevEmpty) ? { data: [] } : await api.get('/api/v1/notifications', { status: 'unread', per_page: 3 });
          return [list, { data: c }];
        }
        return Promise.all([
          api.get('/api/v1/notifications', { status: 'unread', per_page: 3 }),
          api.get('/api/v1/notifications/counts'),
        ]);
      })
      .then(([list, counts]) => {
        setNotifications(list.data || []);
        const unread = counts.data?.unread ?? 0;
        // Sound only for something that arrived after the first load: the unread
        // count went up, or a notification newer than any seen before showed up
        // (reading one / an older one sliding into the top 3 stays silent).
        const seen = bellSeen.current;
        const maxId = Math.max(0, ...(list.data || []).map((n) => Number(n.id) || 0));
        if (seen.ready && (unread > seen.unread || (maxId > seen.maxId && unread > 0))) {
          playSound('notification');
          // [ANDROID] phone notification (no-op in the browser)
          const newest = (list.data || []).reduce((m, n) => (Number(n.id) > Number(m?.id || 0) ? n : m), null);
          if (newest) nativeNotify(newest.title, newest.body || newest.message, { link: newest.link_url, alert: String(newest.type || '').startsWith('system_app_failure') });
        }
        bellSeen.current = { ready: true, unread, maxId: Math.max(seen.maxId, maxId) };
        setUnreadCount(unread);
        onUnreadChange?.(unread);
      })
      .catch((err) => {
        // Bell degrades to "no notifications" rather than breaking the page.
        if (!(err instanceof ApiError)) console.error(err);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadBell(); }, [loadBell, role]);
  // A push arrived while the app is open (native.js): sync the bell immediately.
  useEffect(() => {
    const on = () => loadBell();
    window.addEventListener('uip:push-received', on);
    return () => window.removeEventListener('uip:push-received', on);
  }, [loadBell]);
  useLive(loadBell, { watch: /\/(notifications|messaging|messages|exams?|appeals?)(\/|$|\?)/, interval: 30000, topics: ['notification', 'messaging'] });

  const searchPlaceholder = pick(brand.search?.placeholder, locale);
  const searchResultsRoute = brand.search?.route;
  const initial = initials(user, locale);
  const roleLabel = isJoker ? (locale === 'ar' ? 'سوبر أدمن' : 'Super Admin') : pick(brand.roleLabel, locale);

  function submitSearch(e) {
    e.preventDefault();
    if (!searchResultsRoute) return;
    navigate(`${searchResultsRoute}?q=${encodeURIComponent(searchValue)}`);
  }

  return (
    <header className="topbar glass-panel glass-panel--flat">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <button className="topbar__icon-btn" onClick={onMenuClick} aria-label={tx.toggle} aria-expanded={!collapsed}>
          <Icon name="panel-left" size={20} />
        </button>

        {(isStudent || isStaff || meta.title) && (
          isAdmin ? (
            <nav className="topbar__crumbs" aria-label={locale === 'ar' ? 'مسار التنقل' : 'Breadcrumb'}>
              <span>{locale === 'ar' ? 'مساحة العمل' : 'Workspace'}</span>
              <Icon name={locale === 'ar' ? 'chevron-left' : 'chevron-right'} size={12} />
              <strong>{meta.title}</strong>
            </nav>
          ) : (
          <div className="topbar__title">
            {meta.title && <h1>{meta.title}</h1>}
            {meta.subtitle && <p>{meta.subtitle}</p>}
          </div>
          )
        )}

        {isStudent ? null : searchResultsRoute ? (
          <form className="topbar__search" onSubmit={submitSearch}>
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              style={{ border: 'none', background: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%' }}
            />
          </form>
        ) : (
          <div className="topbar__search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder={searchPlaceholder}
              style={{ border: 'none', background: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%' }}
              disabled
            />
          </div>
        )}
      </div>

      <div className="topbar__actions">
        {isStudent && (
          <form
            className="topbar__search"
            onSubmit={(e) => { e.preventDefault(); navigate(`${isAdmin ? '/admin/search' : isFaculty ? `/${prefix}/students` : '/student/projects'}${searchValue.trim() ? `?q=${encodeURIComponent(searchValue.trim())}` : ''}`); }}
          >
            <Icon name="search" size={16} />
            <input type="search" placeholder={searchPlaceholder} aria-label={searchPlaceholder} value={searchValue} onChange={(e) => setSearchValue(e.target.value)} />
          </form>
        )}
        <VirtualLauncher />
        <button
          type="button"
          className="topbar__icon-btn"
          onClick={toggleLocale}
          aria-label={tx.switchLang}
          title={locale === 'ar' ? 'English' : 'العربية'}
        >
          <Icon name="globe" size={18} />
        </button>

        <button
          type="button"
          className="topbar__icon-btn"
          onClick={toggleTheme}
          aria-label={tx.theme}
          title={tx.theme}
          aria-pressed={theme === 'dark'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>

        <Dropdown
          menuClassName="pal-menu"
          trigger={
            <button type="button" className="topbar__icon-btn topbar__palette-btn" aria-label={locale === 'ar' ? 'المظهر' : 'Appearance'} title={locale === 'ar' ? 'المظهر' : 'Appearance'}>
              <Icon name="palette" size={18} />
            </button>
          }
        >
          <div className="pal-menu__title">{locale === 'ar' ? 'المظهر' : 'Appearance'}</div>
          {[
            ['light', locale === 'ar' ? 'فاتح' : 'Light', ['#515FFF', '#FBFBFC', '#FFFFFF']],
            ['classic', locale === 'ar' ? 'كلاسيكي' : 'Classic', ['#515FFF', '#F6F7FC', '#FFFFFF']],
            ['dark', locale === 'ar' ? 'داكن' : 'Dark', ['#5A67FF', '#101420', '#171E2E']],
          ].map(([key, label, sw]) => (
            <button key={key} type="button" className={`pal-opt${mode === key ? ' is-active' : ''}`} aria-pressed={mode === key} onClick={() => setMode(key)}>
              <span className="pal-opt__sw" aria-hidden="true">
                {sw.map((c, i) => <i key={i} style={{ background: c }} />)}
              </span>
              {label}
              {mode === key && <Icon name="check" size={15} className="pal-opt__check" />}
            </button>
          ))}
        </Dropdown>

        <Dropdown
          trigger={
            <button className="topbar__icon-btn" aria-label={tx.bell} style={{ position: 'relative' }}>
              <Icon name="bell" size={18} />
              {unreadCount > 0 && (isStaff || isFaculty) && (
                <span className="topbar__count">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
              {unreadCount > 0 && !isStaff && !isFaculty && (
                <span
                  className="status-dot--live"
                  style={{
                    position: 'absolute',
                    top: 8,
                    insetInlineEnd: 8,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--color-danger)',
                  }}
                />
              )}
            </button>
          }
          menuClassName="notif-dropdown"
        >
          {notifications.length === 0 ? (
            <div className="notif-item">
              <Icon name="bell" size={16} />
              <div><p className="text-small" style={{ margin: 0 }}>{tx.noNotif}</p></div>
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`notif-item${n.is_read ? '' : ' is-unread'}`}>
                <Icon name={n.icon || 'bell'} size={16} />
                <div>
                  <p className="text-small" style={{ margin: 0 }}>{n.title}</p>
                  <span className="text-caption">{timeAgo(n.created_at, tx)}</span>
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            className="dropdown__item"
            style={{ width: '100%', justifyContent: 'center', gap: 8 }}
            onClick={(e) => {
              e.stopPropagation(); // keep the menu open
              const next = !soundOn;
              setSoundEnabled(next);
              if (next) playSound('notification'); // preview
            }}
          >
            <Icon name="bell" size={14} /> {soundOn ? tx.soundOn : tx.soundOff}
          </button>
          <Link to={`/${prefix}/notifications`} className="dropdown__item" style={{ justifyContent: 'center', color: 'var(--color-primary)' }}>
            {tx.viewAll}
          </Link>
        </Dropdown>

        {isFaculty && !isAdmin && <span className="topbar__role-chip">{pick(brand.roleLabel, locale)}</span>}
        {isAdmin && can('ai.assistant_use') && (
          <button type="button" className="topbar__ask-ai" onClick={() => window.dispatchEvent(new Event(OPEN_AI_EVENT))}>
            <Icon name="sparkles" size={14} /> <span>{locale === 'ar' ? 'اسأل الذكاء' : 'Ask AI'}</span>
          </button>
        )}

        <Dropdown
          menuClassName="profile-menu"
          trigger={
            <button className="dropdown__item" style={{ width: 'auto', gap: 'var(--space-2)' }}>
              <span
                className="topbar__avatar"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--color-primary)',
                  color: 'var(--color-on-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 'var(--text-small)',
                }}
              >
                {avatar ? <img src={avatarSrc(avatar)} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initial}
              </span>
              <span className="topbar__user-text">
                <strong>{displayName(user, locale)}</strong>
                {roleLabel && <span>{roleLabel}</span>}
              </span>
              <Icon name="chevron-down" size={14} />
            </button>
          }
        >
          <div className="profile-menu__scroll">
          <Link to={`/${prefix}/profile`} className="dropdown__item"><Icon name="user" size={16} /> {tx.profile}</Link>
          <Link to={`/${prefix}/portfolio`} className="dropdown__item"><Icon name="link" size={16} /> {tx.publicProfile}</Link>
          <Link to={`/${prefix}/settings`} className="dropdown__item"><Icon name="settings" size={16} /> {tx.settings}</Link>
          {isJoker && (
            <>
              <div className="divider" style={{ margin: 'var(--space-2) 0' }} />
              <RoleSwitch role={role} locale={locale} availableRoles={availableRoles} switchRole={switchRole} navigate={navigate} />
            </>
          )}
          </div>
          <div className="profile-menu__footer">
          <button
            type="button"
            className="dropdown__item dropdown__item--logout"
            style={{ color: 'var(--color-danger)', width: '100%', textAlign: 'start' }}
            onClick={onLogout}
          >
            <Icon name="logout" size={16} /> {tx.logout}
          </button>
          </div>
        </Dropdown>
      </div>
    </header>
  );
}

const SWITCH_ROLE_LABELS = {
  admin: ['Admin', 'مدير النظام'], super_admin: ['Super Admin', 'سوبر أدمن'], student: ['Student', 'طالب'], university: ['University', 'جامعة'],
  faculty: ['Faculty', 'كلية'], academic_staff: ['Academic staff', 'عضو هيئة تدريس'], supervisor: ['Supervisor', 'مشرف'],
  security_admin: ['Security admin', 'مسؤول أمن المعلومات'], security_officer: ['Security officer', 'ضابط أمن المعلومات'], data_analyst: ['Data analyst', 'محلل بيانات'],
};
const SWITCH_ROLE_ICONS = {
  admin: 'shield', super_admin: 'shield', student: 'user', university: 'building', faculty: 'briefcase', academic_staff: 'users',
  supervisor: 'check-circle', security_admin: 'lock', security_officer: 'shield', data_analyst: 'bar-chart',
};

// Collapsible role switcher. Starts closed so the profile menu stays short and
// "Log out" is always reachable; it re-closes every time the menu is reopened
// (Dropdown unmounts its children when closed, which resets this state).
function RoleSwitch({ role, locale, availableRoles, switchRole, navigate }) {
  const [open, setOpen] = useState(false);
  const ar = locale === 'ar';
  const label = (r) => {
    const [en, arLabel] = SWITCH_ROLE_LABELS[r] || [r.replace(/_/g, ' '), r.replace(/_/g, ' ')];
    return ar ? arLabel : en;
  };
  return (
    <div className="role-switch" role="group" aria-label={ar ? 'تبديل الدور' : 'Switch role'}>
      <button
        type="button"
        className="role-switch__toggle"
        aria-expanded={open}
        // Dropdown closes on any click inside the menu; keep it open for this toggle.
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span className="role-switch__toggle-text">
          <span className="role-switch__title">{ar ? 'تبديل الدور' : 'Switch role'}</span>
          <span className="role-switch__current">{label(role)}</span>
        </span>
        <Icon name="chevron-down" size={14} className={`role-switch__chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && availableRoles.map((r) => {
        const active = r === role;
        return (
          <button
            key={r} type="button"
            className={`role-switch__item${active ? ' is-active' : ''}`}
            aria-current={active ? 'true' : undefined}
            disabled={active}
            onClick={async () => { try { const res = await switchRole(r); navigate(res.redirect || roleHome(res.role), { replace: true }); } catch { /* server rejected the switch; stay put */ } }}
          >
            <span className="role-switch__icon" aria-hidden="true"><Icon name={SWITCH_ROLE_ICONS[r] || 'user'} size={15} /></span>
            <span className="role-switch__label">{label(r)}</span>
            {active && <span className="role-switch__check" aria-hidden="true"><Icon name="check" size={14} /></span>}
          </button>
        );
      })}
    </div>
  );
}
