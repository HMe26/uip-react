import { useEffect, useState, useCallback } from 'react';
import { api, errorMessage } from '../api/client';
import Icon from '../components/Icon';
import { useTranslations } from '../context/LanguageContext';
import i18nCommon from '../i18n/common';
import i18nPage from '../i18n/shared/publicProfile';
import PortfolioCoverCard from '../components/portfolio/PortfolioCoverCard';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Role-agnostic "Public Profile" page — gives every portal that had no share
 * link (supervisor, admin, data analyst, security admin/officer) the same
 * thing Student / Faculty / Academic Staff already have: a headline + about
 * text, a public/private switch, and a copyable /p/{uuid} link.
 *
 * Talks to the existing role-agnostic /api/v1/portfolios/* endpoints
 * (PortfoliosApiController -> PortfolioService): GET /me, PATCH /me.
 * Nothing new is needed on the backend for editing; the public page itself
 * is PublicPortfolio.jsx at /p/{uuid}.
 *
 * Only roles that can own projects (student) get a Featured Projects section
 * on their own page, so it is intentionally left out here.
 */
export default function PublicProfileEditor() {
  const t = useTranslations(translations);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [headline, setHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/v1/portfolios/me')
      .then((json) => {
        setData(json.data);
        setHeadline(json.data.portfolio?.headline || '');
        setAbout(json.data.portfolio?.about || '');
        setIsPublic(!!json.data.portfolio?.is_public);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setActionError(null);
    try {
      await api.patch('/api/v1/portfolios/me', { headline, about, is_public: isPublic });
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!data?.share_url) return;
    try {
      await navigator.clipboard.writeText(data.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the link is still selectable in the input */ }
  };

  const shareLink = async () => {
    if (!data?.share_url) return;
    if (navigator.share) {
      try { await navigator.share({ title: headline || t('Public Profile'), url: data.share_url }); return; } catch { /* cancelled */ }
    }
    copyLink();
  };

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;
  if (!data) return null;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1"><Icon name="award" size={26} /> {t('Public Profile')}</h1>
          <p className="text-small">{t('A public page with your own shareable link — separate from your dashboard profile.')}</p>
        </div>
        <div className="page-header__actions">
          <span className={`badge ${isPublic ? 'badge-success' : 'badge-neutral'}`}>
            <Icon name={isPublic ? 'eye' : 'eye-off'} size={12} /> {isPublic ? t('Public') : t('Private')}
          </span>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <PortfolioCoverCard
            coverPath={data.portfolio?.cover_path}
            avatarPath={data.avatar_path}
            name={data.owner_name || ''}
            onChanged={(cp) => setData((d) => ({ ...d, portfolio: { ...d.portfolio, cover_path: cp } }))}
          />
          <div className="card glass-panel" style={{ padding: 'var(--space-6)' }}>
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-4)' }}>{t('Headline & About')}</h2>
            <form onSubmit={saveProfile}>
              <div className="form-group">
                <label className="form-label">{t('Headline')}</label>
                <input
                  className="form-input"
                  type="text"
                  maxLength={255}
                  placeholder={t('e.g. Senior engineer, security & platform operations')}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('About')}</label>
                <textarea className="form-textarea" rows={4} value={about} onChange={(e) => setAbout(e.target.value)} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <label className="form-label" style={{ margin: 0 }}>{t('Make profile public')}</label>
                  <p className="text-caption" style={{ margin: '2px 0 0' }}>{t('When on, anyone with your link can view this page.')}</p>
                </div>
                <input type="checkbox" className="form-checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Icon name="check" size={18} /> {saving ? t('Saving…') : t('Save Changes')}
              </button>
            </form>
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div className="card glass-panel" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
            <span style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--color-primary)', color: 'var(--color-on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-4)' }}>
              <Icon name="link" size={34} />
            </span>
            <h2 className="text-h3">{t('Public Share Link')}</h2>
            {isPublic ? (
              <>
                <p className="text-small" style={{ marginBottom: 'var(--space-3)' }}>{t('Anyone with this link can view your public profile.')}</p>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input className="form-input text-caption" type="text" readOnly value={data.share_url} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={copyLink}>
                    {copied ? t('Copied!') : t('Copy')}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={shareLink} aria-label={t('Share')}>
                    <Icon name="share" size={16} />
                  </button>
                </div>
                <a href={data.share_url} target="_blank" rel="noreferrer" className="text-caption" style={{ display: 'block', marginTop: 'var(--space-2)', color: 'var(--color-primary)' }}>
                  {t('Open public page')}
                </a>
              </>
            ) : (
              <p className="text-small" style={{ marginBottom: 'var(--space-3)' }}>{t('Turn on "Make profile public" to get a shareable link.')}</p>
            )}
          </div>

          <div className="card glass-panel">
            <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Tip')}</h2>
            <p className="text-small">{t('This shows your name, headline and about text only. Your email and account details are never shown.')}</p>
          </div>
        </aside>
      </div>
    </>
  );
}
