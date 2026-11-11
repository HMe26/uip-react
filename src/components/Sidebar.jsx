import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, matchPath, useLocation } from 'react-router-dom';
import BrandWordmark from './BrandWordmark';
import Icon from './Icon';
import { getNavConfig, portalPrefix, SECTION_TITLES } from '../config/navConfig';
import { getPortalBrand, pick } from '../config/portalBrand';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useMyPcAccess } from '../hooks/useMyPcAccess';
import { useTheme } from '../context/ThemeContext';
import { useSidebarGroups } from '../hooks/useSidebarGroups';
import { api } from '../api/client';
import { AVATAR_EVENT, avatarSrc } from './insight/AvatarUploader';
import { useLive, PROFILE_WRITE } from '../hooks/useLive';
import { personName } from '../utils/bilingualName';

export function displayName(user, locale) {
  return personName(user, locale || 'ar') || (user?.email ? user.email.split('@')[0] : '') || '—';
}
export function initials(user, locale) {
  const parts = displayName(user, locale).trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

/** Event the sidebar's "UIPE AI Assistant" button fires; AiAssistantWidget opens on it. */
export const OPEN_AI_EVENT = 'uip:open-ai-assistant';

/**
 * Sidebar user card data (every portal now): the signed-in person's photo and
 * the line under their name ("Computer Science · Year 3" for students), read
 * defensively from the portal's own endpoint in config/portalBrand.js
 * (`brand.avatar` — the same one the topbar avatar already uses).
 */
function useUserCard(enabled, endpoint) {
  const [card, setCard] = useState({ line: '', avatar: null, name: '', names: null });
  const load = useCallback(() => {
    if (!enabled || !endpoint) return;
    api.get(endpoint)
      .then((json) => {
        const d = json?.data || {};
        const prof = d.profile || d.user || d;
        const line = [prof.department_name || prof.faculty_name, prof.academic_year].filter(Boolean).join(' · ');
        setCard({ line, avatar: prof.avatar_path || null, name: prof.full_name || '', names: { name_ar: prof.name_ar, name_en: prof.name_en, full_name: prof.full_name } });
      })
      .catch(() => {});
  }, [enabled, endpoint]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!enabled) return undefined;
    const onAvatar = (e) => setCard((c) => ({ ...c, avatar: e.detail?.path || null }));
    window.addEventListener(AVATAR_EVENT, onAvatar);
    return () => window.removeEventListener(AVATAR_EVENT, onAvatar);
  }, [enabled]);
  // Name / department / photo follow any profile write instantly.
  useLive(load, { watch: PROFILE_WRITE, enabled: !!enabled && !!endpoint });
  return card;
}

/** Event the guide page fires once the person has read the latest version (clears the sidebar's "New" tag). */
export const GUIDE_SEEN_EVENT = 'uip:guide-seen';

/** True when an admin changed this portal's guide since the person last opened it. Best-effort: any failure = no tag. */
function useGuideHasNew() {
  const [hasNew, setHasNew] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/api/v1/guides')
      .then((json) => {
        const mine = (json?.data || []).find((g) => g.is_mine);
        if (alive) setHasNew(!!mine?.has_new);
      })
      .catch(() => {});
    const clear = () => setHasNew(false);
    window.addEventListener(GUIDE_SEEN_EVENT, clear);
    return () => { alive = false; window.removeEventListener(GUIDE_SEEN_EVENT, clear); };
  }, []);
  return hasNew;
}

// Shortcuts under "Messages": each opens the messages page on that view (Messages.jsx reads ?view=).
const MESSAGE_SUBLINKS = [
  { view: 'archived', icon: 'archive', en: 'Archived', ar: 'المحفوظات' },
  { view: 'blocked', icon: 'shield', en: 'Blocked', ar: 'المحظورون' },
  { view: 'reports', icon: 'flag', en: 'My reports', ar: 'بلاغاتي' },
  { view: 'trash', icon: 'trash', en: 'Trash', ar: 'المحذوفات' },
];

// Where the sidebar user card leads (the person's own profile page); roles
// without a dedicated profile page fall back to their Settings page.
const PROFILE_ROUTE = {
  student: '/student/profile', university: '/university/profile', faculty: '/faculty/profile',
  academic_staff: '/academic-staff/profile', admin: '/admin/profile',
  data_analyst: '/data-analysis/profile', security_admin: '/security/profile', security_officer: '/security/profile',
};

// Ported from uip_sidebar() in app/Views/layouts/sidebar.php, then restyled
// to ONE shared design for every portal (the Academic Staff look): brand block,
// grouped nav, user card + theme switch + AI button at the bottom. Each portal
// only contributes its own accent colour (--color-primary) and `data-portal`.
export default function Sidebar({ role, user, isOpen, collapsed = false, unread = 0, unreadMessages = 0, onClose }) {
  const { locale } = useLanguage();
  const { mode, setMode } = useTheme();
  const { can } = useAuth();
  const pcAccess = useMyPcAccess(user?.id);
  const navAll = getNavConfig(role, can);
  // My PC closed for this portal / account (Admin → My PC Control): do not offer it in the menu
  const sections = pcAccess.allowed === false
    ? Object.fromEntries(Object.entries(navAll).map(([k, v]) => [k, v.filter((i) => i.key !== 'my-pc')]))
    : navAll;
  const brand = getPortalBrand(role);
  const promo = brand.promo;
  const profileTo = PROFILE_ROUTE[role] || `/${portalPrefix(role)}/settings`;
  const card = useUserCard(true, brand.avatar);
  const guideHasNew = useGuideHasNew();
  const shownName = (card.names && personName(card.names, locale)) || card.name || displayName(user, locale);

  // Collapsible groups — state is remembered per person + portal (see useSidebarGroups).
  const { pathname } = useLocation();
  const sectionKeys = Object.keys(sections);
  const groups = useSidebarGroups(`${user?.id || 'anon'}:${role || 'student'}`, sectionKeys);
  const ar = locale === 'ar';
  const itemBadge = (item) => (
    (item.key === 'messages' && unreadMessages > 0) || (item.key === 'notifications' && unread > 0) || (item.key === 'guide' && guideHasNew)
  );

  return (
    <aside data-portal={role} className={`sidebar glass-panel glass-panel--flat${isOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar__brand">
        {/* Every portal uses the same UIPE logo mark (the Data Analyst design) — only the title/subtitle differ. */}
        <div className="sidebar__brand-id">
          <BrandWordmark onDark className="sidebar__word" width={118} height={46} />
          <img className="sidebar__logo sidebar__logo--mark" src="/images/logo/uipe-mark.png" srcSet="/images/logo/uipe-mark@2x.png 2x" alt="" width="36" height="36" />
          <div className="sidebar__brand-text">
            {(brand.name || (brand.title && pick(brand.title, locale) !== 'UIPE')) && (
              <div className="sidebar__brand-name">
                {brand.name ? <>{brand.name.strong} <span className="sidebar__brand-light">{brand.name.light}</span></> : pick(brand.title, locale)}
              </div>
            )}
            <span className="sidebar__brand-sub">{pick(brand.sub, locale)}</span>
          </div>
        </div>
        <button type="button" className="sidebar__close-btn" onClick={onClose} aria-label={locale === 'ar' ? 'إغلاق القائمة' : 'Close menu'}>
          <Icon name="x" size={18} />
        </button>
      </div>

      {sectionKeys.length > 1 && (
        <div className="sidebar__groups-bar" role="group" aria-label={ar ? 'التحكم في المجموعات' : 'Group controls'}>
          <button type="button" onClick={groups.expandAll} disabled={groups.allOpen} title={ar ? 'فتح كل المجموعات' : 'Expand all groups'}>
            <Icon name="chevron-down" size={13} /> <span>{ar ? 'فتح الكل' : 'Expand all'}</span>
          </button>
          <button type="button" onClick={groups.collapseAll} disabled={groups.allClosed} title={ar ? 'طي كل المجموعات' : 'Collapse all groups'}>
            <Icon name="chevron-up" size={13} /> <span>{ar ? 'طي الكل' : 'Collapse all'}</span>
          </button>
        </div>
      )}

      <nav className="sidebar__nav">
        {Object.entries(sections).map(([sectionKey, items]) => {
          // The icon rail has no titles, so every group is always shown there.
          const open = collapsed || groups.isOpen(sectionKey);
          const title = SECTION_TITLES[sectionKey]?.[locale] || SECTION_TITLES[sectionKey]?.en || sectionKey;
          const hasActive = items.some((i) => i.built && i.route && !!matchPath({ path: i.route, end: false }, pathname));
          const hasAlert = items.some(itemBadge);
          const bodyId = `sidebar-group-${sectionKey}`;
          return (
          <div key={sectionKey} className={`sidebar__group${open ? ' is-open' : ' is-closed'}`}>
            <button
              type="button"
              className="sidebar__section-title sidebar__section-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => groups.toggle(sectionKey)}
              title={open ? (ar ? 'طي المجموعة' : 'Collapse group') : (ar ? 'فتح المجموعة' : 'Expand group')}
            >
              <span className="sidebar__section-label">{title}</span>
              {!open && (hasActive || hasAlert) && <span className={`sidebar__section-dot${hasAlert ? ' is-alert' : ''}`} aria-hidden="true" />}
              {!open && <span className="sidebar__section-count" aria-hidden="true">{items.length}</span>}
              <Icon name="chevron-down" size={14} className="sidebar__section-chevron" />
            </button>
            <div className="sidebar__group-body" id={bodyId}>
            <div className="sidebar__group-inner">
            {items.map((item) => (
              <Fragment key={item.key}>
              <NavLink
                to={item.built ? item.route : '#'}
                className={({ isActive }) => `sidebar__link${isActive && item.built ? ' is-active' : ''}${item.built ? '' : ' is-disabled'}`}
                onClick={(e) => {
                  if (!item.built) e.preventDefault();
                  else onClose?.();
                }}
                aria-disabled={!item.built || undefined}
                title={collapsed ? (item[locale] || item.en) : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span>{item[locale] || item.en}</span>
                {item.key === 'messages' && unreadMessages > 0 && (
                  <span className="sidebar__count">{unreadMessages > 9 ? '9+' : unreadMessages}</span>
                )}
                {item.key === 'notifications' && unread > 0 && (
                  <span className="sidebar__count">{unread > 9 ? '9+' : unread}</span>
                )}
                {item.key === 'guide' && guideHasNew && (
                  <span className="sidebar__count">{locale === 'ar' ? 'جديد' : 'New'}</span>
                )}
                {!item.built && (
                  <span
                    className="badge badge-coming-soon"
                    style={{ marginInlineStart: 'auto', fontSize: 9, padding: '2px 6px' }}
                  >
                    {locale === 'ar' ? 'قريباً' : 'Soon'}
                  </span>
                )}
              </NavLink>
              {item.key === 'messages' && item.built && (
                <div className="sidebar__sub" role="group" aria-label={locale === 'ar' ? 'إدارة الرسائل' : 'Manage messages'}>
                  {MESSAGE_SUBLINKS.map((l) => (
                    <NavLink
                      key={l.view}
                      to={`${item.route}/${l.view}`}
                      className={({ isActive }) => `sidebar__sublink${isActive ? ' is-active' : ''}`}
                      onClick={onClose}
                    >
                      <Icon name={l.icon} size={15} />
                      <span>{locale === 'ar' ? l.ar : l.en}</span>
                    </NavLink>
                  ))}
                </div>
              )}
              </Fragment>
            ))}
            </div>
            </div>
          </div>
          );
        })}
      </nav>

      {promo && (
        <div className="sidebar__promo">
          <Icon name="ai-spark" size={18} />
          <p>{pick(promo.text, locale)}</p>
          {promo.to && (
            <Link to={promo.to} onClick={onClose}>
              {pick(promo.cta, locale)} <Icon name={locale === 'ar' ? 'arrow-left' : 'arrow-right'} size={14} />
            </Link>
          )}
        </div>
      )}

      <div className="sidebar__footer">
        <div className="theme-switch theme-switch--3" role="group" aria-label={locale === 'ar' ? 'المظهر' : 'Appearance'}>
          {[
            ['light', 'sun', locale === 'ar' ? 'فاتح' : 'Light'],
            ['classic', 'palette', locale === 'ar' ? 'كلاسيكي' : 'Classic'],
            ['dark', 'moon', locale === 'ar' ? 'داكن' : 'Dark'],
          ].map(([key, icon, label]) => (
            <button key={key} type="button" className={mode === key ? 'is-active' : ''} aria-pressed={mode === key} title={label} onClick={() => setMode(key)}>
              <Icon name={icon} size={14} /> <span>{label}</span>
            </button>
          ))}
        </div>
        {can('ai.assistant_use') && (
          <button
            type="button"
            className="sidebar__ai-btn"
            onClick={() => { window.dispatchEvent(new Event(OPEN_AI_EVENT)); onClose?.(); }}
          >
            <Icon name="sparkles" size={16} /> <span>{locale === 'ar' ? 'مساعد UIPE الذكي' : 'UIPE AI Assistant'}</span>
          </button>
        )}
      </div>

      {user && (
        <Link to={profileTo} className="sidebar__user sidebar__user--bottom" onClick={onClose} title={shownName}>
          <span className="sidebar__user-avatar" aria-hidden="true">
            {card.avatar ? <img src={avatarSrc(card.avatar)} alt="" /> : initials({ full_name: shownName })}
          </span>
          <div className="sidebar__user-text">
            <strong>{shownName}</strong>
            <span>{card.line || pick(brand.roleLabel, locale)}</span>
          </div>
          <Icon name={locale === 'ar' ? 'chevron-left' : 'chevron-right'} size={16} />
        </Link>
      )}
    </aside>
  );
}
