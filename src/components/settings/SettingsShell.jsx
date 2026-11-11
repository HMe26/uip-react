import { useSearchParams } from 'react-router-dom';
import Icon from '../Icon';
import { CARD } from '../../pages/settings/shared';
import { useLanguage } from '../../context/LanguageContext';
import PermissionsCard from './PermissionsCard';
import ChatStyleCard from './ChatStyleCard';

/**
 * The Insight Platform Settings layout, shared by every portal:
 * page header + a section nav on the side + one section's cards at a time.
 *
 * Each portal keeps its OWN cards and endpoints — this component only owns
 * the frame. Pass the sections that portal actually has:
 *
 *   <SettingsShell
 *     title="Settings" subtitle="…"
 *     sections={[{ key: 'profile', label: { en: 'Profile', ar: 'الملف الشخصي' }, icon: 'user', content: <>…cards…</> }]}
 *   />
 *
 * The active section is kept in `?section=` so a refresh / shared link keeps
 * the same tab. Unknown or missing values fall back to the first section.
 */
export default function SettingsShell({ title, subtitle, sections }) {
  const { locale } = useLanguage();
  const [params, setParams] = useSearchParams();
  // Every portal gets an "Permissions" section (location / camera / microphone / notifications).
  const permSection = { key: 'permissions', label: { en: 'Permissions', ar: 'الأذونات' }, icon: 'shield', content: <PermissionsCard /> };
  const chatSection = { key: 'chat', label: { en: 'Chat', ar: 'المحادثات' }, icon: 'message', content: <ChatStyleCard /> };
  const has = (k) => sections.some((x) => x && x.key === k);
  const visible = [...sections.filter(Boolean), ...(has('chat') ? [] : [chatSection]), ...(has('permissions') ? [] : [permSection])];
  const active = visible.find((s) => s.key === params.get('section')) || visible[0];
  const label = (l) => (typeof l === 'string' ? l : l?.[locale] || l?.en || '');

  const select = (key) => {
    const next = new URLSearchParams(params);
    next.set('section', key);
    setParams(next);
  };

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={title}>
          {visible.map((sec) => (
            <button
              key={sec.key}
              type="button"
              className={active?.key === sec.key ? 'is-active' : ''}
              aria-current={active?.key === sec.key ? 'page' : undefined}
              onClick={() => select(sec.key)}
            >
              <Icon name={sec.icon} size={16} />
              <span>{label(sec.label)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content" style={CARD}>{active?.content}</div>
      </div>
    </>
  );
}
