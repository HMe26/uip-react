import { api } from '../api/client';
import { saveBlob } from './exporter';

/** Every format the server can build for the AI-analysis report (ProjectsApiController::exportAiAnalysis). */
export const AI_ANALYSIS_FORMATS = ['pdf', 'docx', 'xlsx', 'csv', 'json', 'html', 'md', 'txt', 'xml'];

/** Download the saved AI analysis of a project. Call it from <ExportMenu onExport={...}> so the file language follows the menu. */
export async function exportAiAnalysisReport(projectId, format) {
  const res = await api.blob(`/api/v1/projects/${encodeURIComponent(projectId)}/ai-analysis/export`, { format });
  if (typeof res?.blob !== 'function') throw new Error('The server did not return a file.');
  const blob = await res.blob();
  saveBlob(blob, `ai-analysis-${String(projectId).slice(0, 8)}.${format}`);
}
