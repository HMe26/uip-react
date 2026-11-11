import { api } from '../api/client';
import { exportFromCsvBlob } from './exporter';

/**
 * Fetch an authenticated CSV export endpoint (Bearer token + refresh-on-401 via
 * api.blob) and deliver it in the format the user picked: csv / xlsx / pdf / json.
 * Throws on any failure so the caller can show it.
 */
export async function downloadExport(path, { params, format = 'csv', filename, title, rtl } = {}) {
  const res = await api.blob(path, params);
  if (typeof res?.blob !== 'function') throw new Error('The server did not return a file.');
  await exportFromCsvBlob(await res.blob(), { format, filename, title, rtl });
}
