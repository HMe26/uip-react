import { api } from '../api/client';
import { saveBlob } from './exporter';

/** Every format the server can build for the code-review report (CodeReviewReportApiController). */
export const CODE_REVIEW_FORMATS = ['pdf', 'docx', 'xlsx', 'csv', 'json', 'html', 'md', 'txt', 'xml'];

/**
 * Download the code-review report of a project in the chosen format.
 * Call it from <ExportMenu onExport={...}>: the menu wraps the call in withExportLang(), so the api client
 * sends lang/X-Locale and the file comes back in the language picked in the menu.
 */
export async function exportCodeReviewReport(projectUuid, format) {
  const res = await api.blob(`/api/v1/code-review-report/${encodeURIComponent(projectUuid)}/export`, { format });
  if (typeof res?.blob !== 'function') throw new Error('The server did not return a file.');
  const blob = await res.blob();
  saveBlob(blob, `code-review-report-${String(projectUuid).slice(0, 8)}.${format}`);
}
