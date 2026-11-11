import { FileGlyph } from '../desktop/OsIcons';
import { extOf } from '../lib/driveFileKinds';
import '../styles/css/content-search.css';

/** One matching line with the searched text highlighted (server offsets count characters, not UTF-16 units). */
function Snippet({ m }) {
  const a = [...String(m.text || '')];
  return (
    <span className="cm-line" dir="auto">
      <i className="cm-ln">{m.line}</i>
      <code>{a.slice(0, m.start).join('')}<mark>{a.slice(m.start, m.start + m.len).join('')}</mark>{a.slice(m.start + m.len).join('')}</code>
    </span>
  );
}

/** "Inside files" results of useContentSearch: file + path + the first matching lines. */
export default function ContentMatches({ res, tt, onOpen, compact = false, max = 20 }) {
  if (!res || (!res.items.length && !res.loading)) return null;
  const rows = res.items.slice(0, max);
  return (
    <section className={`cm${compact ? ' cm--compact' : ''}`} aria-label={tt('Inside files', 'داخل الملفات')}>
      <h4 className="cm-h">
        {tt('Inside files', 'داخل الملفات')}
        {res.loading && !rows.length && <small>{tt('Searching…', 'جارٍ البحث…')}</small>}
        {res.pending > 0 && <small>{tt(`Indexing ${res.pending} more file(s)…`, `جارٍ فهرسة ${res.pending} ملف آخر…`)}</small>}
      </h4>
      <ul className="cm-list">
        {rows.map((n) => (
          <li key={n.id}>
            <button type="button" className="cm-item" onClick={() => onOpen?.(n)}>
              <FileGlyph size={compact ? 26 : 30} label={extOf(n.name)} />
              <span className="cm-body">
                <span className="cm-top"><b dir="auto">{n.name}</b>{n.path ? <small dir="auto">{n.path}</small> : null}
                  <em>{tt(`${n.match_count} match${n.match_count === 1 ? '' : 'es'}`, `${n.match_count} نتيجة`)}</em></span>
                {(n.matches || []).slice(0, compact ? 2 : 3).map((m, i) => <Snippet key={i} m={m} />)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
