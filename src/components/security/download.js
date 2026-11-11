import { api } from '../../api/client';
import { saveBlob } from '../../lib/exporter';

/**
 * Authenticated file download. A plain <a href="/api/..."> never sends the
 * Bearer token (it lives in localStorage), so the API answers 401 — always
 * download through api.blob() instead. Throws (ApiError) on any failure so the
 * caller can show it; never saves an error body as if it were the file.
 */
export async function downloadFile(path, { params, filename } = {}) {
  const res = await api.blob(path, params);
  if (typeof res?.blob !== 'function') throw new Error('The server did not return a file.');
  const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')?.[1];
  const name = (fromHeader && decodeURIComponent(fromHeader)) || filename || 'download';
  saveBlob(await res.blob(), name);
}
