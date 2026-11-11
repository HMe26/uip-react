import { Link } from 'react-router-dom';
import Icon from '../Icon';

/** Switch between the two oversight views: people↔people and people↔AI. */
export default function MessagingTabs({ active, t }) {
  const tabs = [
    { key: 'people', to: '/admin/messaging/oversight', icon: 'users', label: t('People ↔ People') },
    { key: 'ai', to: '/admin/messaging/ai', icon: 'message-square', label: t('People ↔ AI') },
  ];
  return (
    <div role="tablist" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
      {tabs.map((tb) => (
        <Link
          key={tb.key}
          to={tb.to}
          role="tab"
          aria-selected={active === tb.key}
          className={`btn btn-sm ${active === tb.key ? 'btn-primary' : 'btn-outline'}`}
        >
          <Icon name={tb.icon} size={14} /> {tb.label}
        </Link>
      ))}
    </div>
  );
}
