import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useTranslations } from '../../context/LanguageContext';
import { isNative } from '../../native';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/github';

const translations = { ...i18nCommon, ...i18nPage };
import GithubRepoPicker from './GithubRepoPicker';

const ERROR_TEXT = {
  denied: 'You cancelled the GitHub authorization.',
  expired_state: 'The connection request expired. Please try again.',
  token_exchange_failed: 'GitHub did not accept the authorization. Please try again.',
  profile_failed: 'Could not read your GitHub profile. Please try again.',
  failed: 'Could not connect GitHub. Please try again.',
};

/**
 * "Connect GitHub" (OAuth) — like Vercel: the student authorizes once, then the
 * platform lists all of their repositories (public + private) to link/import.
 * Talks to /api/v1/github/{status,connect,repos,link,create-project,connection}.
 */
export default function GithubConnectCard({ projects, onChanged }) {
  const t = useTranslations(translations);
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const loadStatus = useCallback(() => {
    api.get('/api/v1/github/status')
      .then((json) => setStatus(json.data))
      .catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Back from GitHub: ?github=connected | ?github=error&reason=...
  useEffect(() => {
    const result = params.get('github');
    if (!result) return;
    if (result === 'connected') {
      setNotice(t('GitHub connected. Choose the repositories you want to use.'));
      setPickerOpen(true);
      loadStatus();
    } else {
      setError(t(ERROR_TEXT[params.get('reason')] || ERROR_TEXT.failed));
    }
    const next = new URLSearchParams(params);
    next.delete('github');
    next.delete('reason');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native app: the OAuth page opens in the in-app browser; refresh when the user comes back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadStatus]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/github/connect', {});
      const url = json.data?.url;
      if (!url) throw new Error('missing url');
      if (isNative) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
        setBusy(false);
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.del('/api/v1/github/connection');
      setConfirmOff(false);
      setNotice(null);
      loadStatus();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="st-skel" style={{ height: 84 }} />;
  if (!status.configured && !status.connected && !error) return null;

  return (
    <>
      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert st-alert--success"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}

      <section className={`gh-connect${status.connected ? ' is-on' : ''}`}>
        {status.connected ? (
          <>
            <div className="gh-connect__who">
              {status.avatar_url
                ? <img src={status.avatar_url} alt="" className="gh-connect__avatar" />
                : <span className="gh-connect__avatar gh-connect__avatar--ph"><Icon name="github" size={22} /></span>}
              <div>
                <strong dir="ltr">@{status.login}</strong>
                <span>{t('Your GitHub account is connected')}{(status.scope || '').includes('repo') ? ` · ${t('private repositories included')}` : ''}</span>
              </div>
            </div>
            <div className="gh-connect__actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}>
                <Icon name="folder" size={14} /> {t('Import repositories')}
              </button>
              {confirmOff ? (
                <>
                  <button type="button" className="btn btn-outline btn-sm st-btn-danger" disabled={busy} onClick={disconnect}>{t('Yes, disconnect')}</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmOff(false)}>{t('Cancel')}</button>
                </>
              ) : (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmOff(true)}>{t('Disconnect')}</button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="gh-connect__who">
              <span className="gh-connect__avatar gh-connect__avatar--ph"><Icon name="github" size={22} /></span>
              <div>
                <strong>{t('Connect your GitHub account')}</strong>
                <span>{t('Authorize once and we will list all your repositories — then link or import them into your projects in one click.')}</span>
              </div>
            </div>
            <div className="gh-connect__actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !status.configured} onClick={connect}>
                <Icon name="github" size={14} /> {busy ? t('Loading…') : t('Connect GitHub')}
              </button>
            </div>
          </>
        )}
      </section>

      {pickerOpen && (
        <GithubRepoPicker
          projects={projects}
          onClose={() => setPickerOpen(false)}
          onChanged={onChanged}
          onRevoked={() => { setPickerOpen(false); loadStatus(); }}
        />
      )}
    </>
  );
}
