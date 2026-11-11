import Icon from './Icon';
import ExportMenu from './ExportMenu';
import { api } from '../api/client';
import { exportFromCsvBlob, saveBlob } from '../lib/exporter';
import { useLanguage } from '../context/LanguageContext';

/**
 * Download button for a report/export file the server already generated.
 *  - CSV files get the format picker (CSV / Excel / PDF / JSON) — the CSV is
 *    fetched and converted in the browser.
 *  - Files already in another format (xlsx, pdf, docx, …) download as they are.
 */
export default function StoredFileDownload({ path, format, filename, title, iconOnly = true, iconSize = 16, className = 'btn btn-ghost btn-sm', label }) {
  const { locale } = useLanguage();
  const fmt = String(format || path || '').toLowerCase();
  const isCsv = fmt === 'csv' || /\.csv$/i.test(String(path));
  const base = filename || String(path).split('/').pop().replace(/\.[^.]+$/, '');
  const dlLabel = label || (locale === 'ar' ? 'تنزيل' : 'Download');

  if (!isCsv) {
    // Already Excel / PDF / Word / …: download as-is (authenticated, via the shared client).
    const ext = (/\.([a-z0-9]+)$/i.exec(String(path)) || [])[1] || fmt || 'bin';
    const save = async () => {
      const res = await api.blob(path);
      saveBlob(await res.blob(), `${base}.${ext}`);
    };
    return (
      <button type="button" className={className} title={dlLabel} aria-label={dlLabel} onClick={() => save().catch(() => window.alert(locale === 'ar' ? 'فشل التنزيل.' : 'Download failed.'))}>
        <Icon name="download" size={iconSize} />{!iconOnly && <> {dlLabel}</>}
      </button>
    );
  }
  return (
    <ExportMenu
      iconOnly={iconOnly}
      className={className}
      iconSize={iconSize}
      label={iconOnly ? undefined : dlLabel}
      onExport={async (f) => {
        const res = await api.blob(path);
        await exportFromCsvBlob(await res.blob(), { format: f, filename: base, title, rtl: locale === 'ar' });
      }}
    />
  );
}
