import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, getTokens } from '../../api/client';
import Icon from '../../components/Icon';
import { saveBlob } from '../../lib/exporter';

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json'];

/** Authenticated file download (fetch + Blob — the API needs the bearer token, so a plain <a href> won't work). */
export async function downloadExport(url, filename) {
  const { accessToken } = getTokens();
  const res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!res.ok) throw new Error('Export failed');
  saveBlob(await res.blob(), filename);
}

/**
 * Format buttons that SAVE an export into the Exports centre (POST /exam-system/exports)
 * instead of downloading on the spot. `payload` is the request body without `format`.
 * After saving, a link to the centre (where Preview / Download live) is shown.
 */
export function SaveExportButtons({ payload, t, disabled, onSaved }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  async function go(fmt) {
    setBusy(fmt);
    setError(null);
    setSaved(false);
    try {
      const json = await api.post('/api/v1/exam-system/exports', { ...payload, format: fmt });
      setSaved(true);
      onSaved?.(json.data);
    } catch (err) {
      setError(errorMessage(err) || t('Export failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {EXPORT_FORMATS.map((fmt) => (
        <button key={fmt} type="button" className="btn btn-outline btn-sm" disabled={disabled || busy !== null} onClick={() => go(fmt)}>
          <Icon name="download" size={14} /> {busy === fmt ? '…' : fmt.toUpperCase()}
        </button>
      ))}
      {saved && (
        <span className="text-small" style={{ color: 'var(--success, #16a34a)' }}>
          {t('Export saved.')} <Link to="/academic-staff/exports" style={{ fontWeight: 600 }}>{t('Open Exports')}</Link>
        </span>
      )}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

export const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
