import Icon from '../Icon';

/**
 * Project files grouped into collapsible "folders" by type (the API has no folder concept, so the
 * grouping is by extension). Each file is a two-line card: full name (wraps) + meta underneath.
 */
const GROUPS = [
  { key: 'images', icon: 'image', en: 'Images', ar: 'الصور', ext: ['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG', 'BMP', 'AVIF'] },
  { key: 'archives', icon: 'archive', en: 'Archives', ar: 'ملفات مضغوطة', ext: ['ZIP', 'RAR', '7Z', 'TAR', 'GZ'] },
  { key: 'docs', icon: 'file', en: 'Documents', ar: 'المستندات', ext: ['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'TXT', 'MD', 'RTF', 'XLS', 'XLSX', 'CSV'] },
  { key: 'media', icon: 'file', en: 'Video & audio', ar: 'فيديو وصوت', ext: ['MP4', 'MOV', 'WEBM', 'MKV', 'MP3', 'WAV', 'M4A'] },
];
const OTHER = { key: 'other', icon: 'folder', en: 'Other files', ar: 'ملفات أخرى', ext: [] };

export function groupFiles(files) {
  const buckets = new Map();
  files.forEach((f) => {
    const ext = String(f.extension || '').toUpperCase();
    const g = GROUPS.find((x) => x.ext.includes(ext)) || OTHER;
    if (!buckets.has(g.key)) buckets.set(g.key, { ...g, items: [] });
    buckets.get(g.key).items.push(f);
  });
  return [...GROUPS, OTHER].map((g) => buckets.get(g.key)).filter(Boolean);
}

export default function ReviewFileGroups({ files, ar, onPreview }) {
  const groups = groupFiles(files);
  return (
    <div className="rv-folders">
      {groups.map((g) => (
        <details key={g.key} className="rv-folder" open={g.items.length <= 6}>
          <summary className="rv-folder__head">
            <span className="rv-folder__ico"><Icon name={g.icon} size={18} /></span>
            <span className="rv-folder__name">{ar ? g.ar : g.en}</span>
            <span className="rv-folder__count">{g.items.length}</span>
            <span className="rv-folder__chev"><Icon name="chevron-down" size={16} /></span>
          </summary>
          <ul className="rv-folder__list">
            {g.items.map((f) => (
              <li key={f.id} className="rv-file">
                <button type="button" className="rv-file__main" onClick={() => onPreview(f.id)} title={ar ? 'معاينة' : 'Preview'}>
                  <span className="rv-file__badge">{f.extension || 'FILE'}</span>
                  <span className="rv-file__txt">
                    <span className="rv-file__name">{f.original_name}</span>
                    <span className="rv-file__meta">
                      {[f.size_human, f.uploader_name && `${ar ? 'رفعه' : 'by'} ${f.uploader_name}`, Number(f.version) > 1 && `v${f.version}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
                <span className="rv-file__acts">
                  <button type="button" className="rv-file__act" onClick={() => onPreview(f.id)} aria-label={ar ? 'معاينة' : 'Preview'}><Icon name="eye" size={16} /></button>
                  {f.url && (
                    <a className="rv-file__act" href={f.url} target="_blank" rel="noopener noreferrer" aria-label={ar ? 'فتح في تبويب جديد' : 'Open in a new tab'}><Icon name="expand" size={16} /></a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
