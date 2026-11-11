import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/notification-settings';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = {
  ...i18nCommon, ...i18nPage,
  'Active': 'مفعّلة',
};

const MAX_DAYS = 3650;

function PolicyRow({ icon, title, label, hint, value, onChange, unit, activeLabel, disabledLabel, active }) {
  return (
    <div className="adm-policy">
      <div className="adm-policy__head">
        <div className="adm-policy__title"><span className="adm-policy__icon"><Icon name={icon} size={16} /></span>{title}</div>
        <span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{active ? activeLabel : disabledLabel}</span>
      </div>
      <div className="adm-field">
        <label className="adm-field__label">{label}</label>
        <div className="adm-unit">
          <input type="number" min="0" max={MAX_DAYS} className="form-input" value={value} onChange={(e) => onChange(e.target.value)} />
          <span>{unit}</span>
        </div>
        <span className="adm-field__hint">{hint}</span>
      </div>
    </div>
  );
}

/**
 * Mirrors app/Views/admin/notification-settings.php, talking to the real
 * JSON API (AdminNotificationSettingsApiController): platform-wide automatic
 * archive/delete policy for read notifications. Same endpoint and payload as
 * before — the redesign only changes the layout (Admin design).
 */
export default function AdminNotificationSettings() {
  const t = useTranslations(translations);
  const [archiveDays, setArchiveDays] = useState(0);
  const [deleteDays, setDeleteDays] = useState(0);
  const [saved, setSaved] = useState({ archive: 0, del: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/api/v1/admin/notification-settings')
      .then((json) => {
        const a = Number(json.data?.archive_days ?? 0);
        const d = Number(json.data?.delete_days ?? 0);
        setArchiveDays(a); setDeleteDays(d); setSaved({ archive: a, del: d });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const a = Number(archiveDays) || 0;
  const d = Number(deleteDays) || 0;
  const dirty = a !== saved.archive || d !== saved.del;

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.patch('/api/v1/admin/notification-settings', { archive_days: archiveDays, delete_days: deleteDays });
      setSaved({ archive: a, del: d });
      setSuccess(t('Notification retention policy saved.'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function discard() { setArchiveDays(saved.archive); setDeleteDays(saved.del); setSuccess(null); setError(null); }

  const when = (n) => (n > 0 ? t('after {n} days').replace('{n}', n) : t('Not scheduled'));

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Notification Settings')}</h1>
          <p className="text-small">{t('Platform-wide automatic archive/delete policy for read notifications.')}</p>
        </div>
      </div>

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : (
        <div className="adm-grid">
          <form className="adm-panel" onSubmit={handleSubmit}>
            <div className="adm-panel__head">
              <div>
                <h2>{t('Notification Retention Policy')}</h2>
                <p>{t('Applied by a scheduled job that runs once a day.')}</p>
              </div>
            </div>

            <PolicyRow icon="archive" title={t('Auto-archive')} label={t('Archive read notifications after')} hint={t('0 disables this step.')}
              value={archiveDays} onChange={setArchiveDays} unit={t('days')} active={a > 0} activeLabel={t('Active')} disabledLabel={t('Disabled')} />
            <PolicyRow icon="trash" title={t('Auto-delete')} label={t('Delete archived notifications after')} hint={t('0 disables this step.')}
              value={deleteDays} onChange={setDeleteDays} unit={t('days')} active={d > 0} activeLabel={t('Active')} disabledLabel={t('Disabled')} />

            <div className="adm-form-foot">
              <span className="grow">
                {error && <span className="adm-note adm-note--err"><Icon name="alert" size={15} /> {error}</span>}
                {!error && success && !dirty && <span className="adm-note adm-note--ok"><Icon name="check-circle" size={15} /> {success}</span>}
                {!error && dirty && <span className="adm-note" style={{ color: 'var(--color-warning)' }}><Icon name="alert" size={15} /> {t('Unsaved changes')}</span>}
              </span>
              <button type="button" className="btn btn-outline" disabled={!dirty || saving} onClick={discard}>{t('Discard')}</button>
              <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
                <Icon name="check" size={16} /> {saving ? t('Saving…') : t('Save')}
              </button>
            </div>
          </form>

          <aside className="adm-panel">
            <div className="adm-panel__head"><h3>{t('How it works')}</h3></div>
            <ol className="adm-flow">
              <li>
                <span className="adm-flow__dot"><Icon name="eye" size={14} /></span>
                <div><strong>{t('A notification is read')}</strong><span>{t('It stays in the inbox until the archive step runs.')}</span></div>
              </li>
              <li>
                <span className={`adm-flow__dot ${a > 0 ? '' : 'adm-flow__dot--off'}`}><Icon name="archive" size={14} /></span>
                <div><strong>{t('Archived')}</strong><span>{when(a)} · {t('Moved out of the inbox')}</span></div>
              </li>
              <li>
                <span className={`adm-flow__dot ${d > 0 ? '' : 'adm-flow__dot--off'}`}><Icon name="trash" size={14} /></span>
                <div><strong>{t('Deleted')}</strong><span>{when(d)} · {t('Removed permanently')}</span></div>
              </li>
            </ol>
          </aside>
        </div>
      )}
    </>
  );
}
