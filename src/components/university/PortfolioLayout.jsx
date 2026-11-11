import Icon from '../Icon';
import { Alert, Mono, Pill, Stat, Switch } from './umUi';

/**
 * Shared "Public Portfolio" screen for the University and Faculty portals
 * (um- kit → styles/css/university-manage.css). The pages own the data
 * fetching; this only lays it out.
 *
 *   verified  true | false | null — null hides the verification pill (faculty)
 */
export default function PortfolioLayout({
  t, name, logo, place, verified = null, isPublic, saving, error,
  onToggle, stats, shareUrl, copied, onCopy, subtitle, tip,
}) {
  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <h1>{t('Public Portfolio')}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="um-head__act">
          <Pill tone={isPublic ? 'success' : 'muted'}>{isPublic ? t('Public') : t('Private')}</Pill>
        </div>
      </header>

      {error && <Alert>{error}</Alert>}

      <div className="um-layout">
        <div className="um-stack">
          <section className="um-panel" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Mono name={name} src={logo} hue="0" />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{name}</h2>
                {verified === true && <Pill tone="success">{t('Verified')}</Pill>}
                {verified === false && <Pill tone="muted">{t('Unverified')}</Pill>}
              </div>
              <p className="um-panel__sub" style={{ margin: '4px 0 0' }}>
                <Icon name="building" size={13} /> {place || t('Location not set yet')}
              </p>
            </div>
          </section>

          <div className="um-stats" style={{ '--n': stats.length }}>
            {stats.map((s) => <Stat key={s.label} icon={s.icon} tone={s.tone} value={s.value} label={s.label} />)}
          </div>

          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Profile Visibility')}</h2></div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <strong>{t('Make profile public')}</strong>
                <p className="um-panel__sub" style={{ margin: '4px 0 0' }}>{t('When on, anyone with the link can view your published student projects.')}</p>
              </div>
              <Switch on={isPublic} disabled={saving} onChange={onToggle} label={t('Make profile public')} />
            </div>
          </section>
        </div>

        <aside className="um-aside">
          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Public Share Link')}</h2></div>
            {isPublic ? (
              <>
                <p className="um-panel__sub">{t('Anyone with this link can view your published projects.')}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input className="form-input" type="text" readOnly value={shareUrl} style={{ flex: 1, minWidth: 0 }} />
                  <button type="button" className="btn btn-outline" onClick={onCopy}>
                    <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? t('Copied!') : t('Copy')}
                  </button>
                </div>
                <a href={shareUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>
                  <Icon name="link" size={16} /> {t('Open public page')}
                </a>
              </>
            ) : (
              <p className="um-panel__sub">{t('Turn on "Make profile public" above to get a shareable link.')}</p>
            )}
          </section>

          <section className="um-panel">
            <div className="um-panel__head"><h2>{t('Tip')}</h2></div>
            <p className="um-note">{tip}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
