import Icon from '../Icon';

/**
 * Centered result panel (icon badge + title + message + actions) used by the
 * verify-email, confirm-email-change and "check your inbox" screens.
 * tone: 'success' | 'danger' | 'info' | 'loading'
 */
export default function AuthStatus({ tone = 'info', icon, title, children, actions }) {
  return (
    <div className="auth-status" data-tone={tone}>
      <div className="auth-status__badge" aria-hidden="true">
        {tone === 'loading' ? <span className="auth-spinner" /> : <Icon name={icon} size={30} />}
      </div>
      <h1 className="auth-title">{title}</h1>
      {children && <div className="auth-status__body" role={tone === 'loading' ? 'status' : undefined}>{children}</div>}
      {actions && <div className="auth-status__actions">{actions}</div>}
    </div>
  );
}
