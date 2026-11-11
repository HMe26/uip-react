import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { ConfirmModal } from '../../components/admin/adminUi';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/mobile';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/** Copy text; falls back to a hidden textarea when the Clipboard API is unavailable (WebView / non-HTTPS). */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;opacity:0;';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/**
 * Mirrors app/Views/admin/mobile.php, talking to the real JSON API
 * (app/Controllers/Api/AdminMobileApiController.php — new, added
 * alongside this page; reuses the exact same ApiTokenRepository calls
 * the Blade view already made). Mobile App Management = issuing/
 * revoking the long-lived bearer tokens the future mobile client
 * authenticates with. One-time-reveal: the raw token is returned once,
 * in the create response, and never again after that.
 */

function StatCard({ label, value, icon }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi__top">{label} <Icon name={icon} size={16} /></div>
      <div className="adm-kpi__value">{value}</div>
    </div>
  );
}

export default function AdminMobile() {
  const t = useTranslations(translations);
  const [tokens, setTokens] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [issuedToken, setIssuedToken] = useState(null);
  const [name, setName] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeStep, setRevokeStep] = useState(1); // revoking needs two warnings: 1 = heads-up, 2 = final, irreversible
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copyState, setCopyState] = useState(null); // 'ok' | 'fail' | null

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/mobile-tokens')
      .then((json) => {
        setTokens(json.data || []);
        setActiveCount(json.meta?.activeCount ?? 0);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleIssue(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setIssuing(true);
    setActionError(null);
    setIssuedToken(null);
    setCopyState(null);
    try {
      const res = await api.post('/api/v1/admin/mobile-tokens', { name: name.trim() });
      setIssuedToken(res.data?.issued_token || null);
      setName('');
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setIssuing(false);
    }
  }

  async function confirmRevoke() {
    setRevokeBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/v1/admin/mobile-tokens/${revoking.id}/revoke`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRevokeBusy(false);
      setRevoking(null);
      setRevokeStep(1);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setActionError(null);
    try {
      await api.delete(`/api/v1/admin/mobile-tokens/${deleting.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  async function handleCopy() {
    const ok = await copyToClipboard(issuedToken);
    setCopyState(ok ? 'ok' : 'fail');
    if (ok) setTimeout(() => setCopyState(null), 2000);
  }

  const revokedCount = tokens.length - activeCount;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Mobile App Management')}</h1>
          <p className="text-small">{t('Bearer tokens issued to the mobile client for API access — issue a new one or revoke an old one.')}</p>
        </div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}
      {error && <p className="form-error">{error}</p>}

      {issuedToken && (
        <div className="adm-panel" style={{ borderColor: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>
          <h2 className="text-h3" style={{ marginBottom: 'var(--space-2)' }}>{t('New Token — Copy It Now')}</h2>
          <p className="text-small" style={{ marginBottom: 'var(--space-3)' }}>{t('This token will never be shown again for any reason.')}</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch', flexWrap: 'wrap' }}>
            <code dir="ltr" style={{ flex: 1, minWidth: 0, padding: 'var(--space-3)', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', wordBreak: 'break-all', fontSize: 'var(--text-small)', userSelect: 'all' }}>{issuedToken}</code>
            <button type="button" className={`btn ${copyState === 'ok' ? 'btn-secondary' : 'btn-primary'}`} onClick={handleCopy} style={{ flex: 'none' }}>
              <Icon name={copyState === 'ok' ? 'check-circle' : 'copy'} size={18} /> {copyState === 'ok' ? t('Copied') : t('Copy')}
            </button>
          </div>
          {copyState === 'fail' && <p className="form-error" style={{ marginTop: 'var(--space-2)' }}>{t('Copy failed — select the token and copy it manually.')}</p>}
        </div>
      )}

      <div className="adm-kpis">
        <StatCard label={t('Active Tokens')} value={activeCount} icon="check-circle" />
        <StatCard label={t('Revoked Tokens')} value={revokedCount} icon="x-circle" />
      </div>

      <div className="adm-panel" style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className="text-h3" style={{ marginBottom: 'var(--space-3)' }}>{t('Issue a New Token')}</h2>
        <form onSubmit={handleIssue} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            <label className="form-label">{t('Token Name (e.g. iOS Build 1.2)')}</label>
            <input className="form-input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={issuing}>
            <Icon name="plus" size={18} /> {issuing ? t('Issuing…') : t('Issue')}
          </button>
        </form>
      </div>

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : tokens.length === 0 ? (
        <div className="adm-panel" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <p className="text-small">{t('No tokens issued yet.')}</p>
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>{t('Token Name')}</th><th>{t('Issued By')}</th><th>{t('Last Used')}</th><th>{t('Issued On')}</th><th>{t('Status')}</th><th>{t('Action')}</th></tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const isRevoked = Boolean(token.revoked_at);
                return (
                  <tr key={token.id}>
                    <td><Link to={`/admin/mobile/${token.id}`} style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{token.name}</Link></td>
                    <td>{token.created_by_name || '—'}</td>
                    <td>{token.last_used_at ? token.last_used_at.slice(0, 16).replace('T', ' ') : t('Never used')}</td>
                    <td>{token.created_at ? token.created_at.slice(0, 10) : '—'}</td>
                    <td>{isRevoked ? <span className="badge badge-danger">{t('Revoked')}</span> : <span className="badge badge-success">{t('Active')}</span>}</td>
                    <td className="adm-actions">
                      <Link to={`/admin/mobile/${token.id}`} className="btn btn-secondary btn-sm" style={{ marginInlineEnd: 'var(--space-2)' }}><Icon name="eye" size={14} /> {t('View details')}</Link>
                      {isRevoked ? (
                        <>
                          <span className="text-caption">{token.revoked_at.slice(0, 10)}</span>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(token)} style={{ marginInlineStart: 'var(--space-2)' }}>
                            <Icon name="trash" size={14} /> {t('Delete')}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => { setRevokeStep(1); setRevoking(token); }}>
                          <Icon name="x" size={14} /> {t('Revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {deleting && (
        <ConfirmModal
          title={t('Confirm action')}
          message={t('Permanently delete "{name}"? This cannot be undone.').replace('{name}', deleting.name)}
          confirmLabel={t('Delete')}
          danger
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
      {revoking && revokeStep === 1 && (
        <ConfirmModal
          title={t('Warning 1 of 2')}
          message={t('Revoking "{name}" immediately locks out every app that uses it. Nobody on that build can sign in or use the app until you build and distribute a new APK with a new token.').replace('{name}', revoking.name)}
          confirmLabel={t('Continue')}
          danger
          onConfirm={() => setRevokeStep(2)}
          onClose={() => { setRevoking(null); setRevokeStep(1); }}
        />
      )}
      {revoking && revokeStep === 2 && (
        <ConfirmModal
          title={t('Final warning 2 of 2')}
          message={t('This cannot be undone: a revoked token can never be used again. Are you sure you want to revoke "{name}"?').replace('{name}', revoking.name)}
          confirmLabel={t('Yes, revoke permanently')}
          danger
          busy={revokeBusy}
          onConfirm={confirmRevoke}
          onClose={() => { setRevoking(null); setRevokeStep(1); }}
        />
      )}
    </>
  );
}
