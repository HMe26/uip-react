import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { badgeOf, baseName, dirName } from './zipUtils';
import { compileQuery, parseGlobs, searchFiles } from './zipSearch';

const EMPTY = { status: 'idle', files: [], total: 0, done: 0, of: 0, truncated: false, skipped: 0, error: '' };

function Badge({ path }) {
  const [label, color] = badgeOf(path);
  return <span className="zb-badge" style={{ '--k': color }}>{label}</span>;
}

/**
 * VS Code–style "Search in files": query + Aa / ab / .* toggles, include / exclude globs,
 * results grouped per file. Searches unsaved edits too. Clicking a hit calls onOpen(path, match, spec).
 */
export default function SearchPanel({ tt, off, getFiles, readBatch, onOpen, focusKey }) {
  const [query, setQuery] = useState('');
  const [cs, setCs] = useState(false);
  const [ww, setWw] = useState(false);
  const [rx, setRx] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('node_modules, .git, vendor');
  const [filters, setFilters] = useState(false);
  const [res, setRes] = useState(EMPTY);
  const [folded, setFolded] = useState(() => new Set());
  const [picked, setPicked] = useState('');
  const [runKey, setRunKey] = useState(0);
  const input = useRef(null);
  const tokenRef = useRef({ cancelled: false });

  useEffect(() => {
    if (!focusKey) return;
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  useEffect(() => {
    tokenRef.current.cancelled = true;
    const token = { cancelled: false };
    tokenRef.current = token;
    if (!query) { setRes(EMPTY); return undefined; }
    let re;
    try {
      re = compileQuery(query, { caseSensitive: cs, wholeWord: ww, regex: rx });
    } catch (err) {
      setRes({ ...EMPTY, status: 'error', error: String(err?.message || err) });
      return undefined;
    }
    const timer = setTimeout(async () => {
      setFolded(new Set());
      setPicked('');
      setRes({ ...EMPTY, status: 'running' });
      try {
        const r = await searchFiles({
          files: getFiles(), readBatch, re, include: parseGlobs(include), exclude: parseGlobs(exclude), token,
          onProgress: (p) => { if (!token.cancelled) setRes({ ...p, error: '', status: 'running' }); },
        });
        if (r && !token.cancelled) setRes({ ...r, error: '', status: 'done' });
      } catch (err) {
        if (!token.cancelled) setRes({ ...EMPTY, status: 'error', error: String(err?.message || err) });
      }
    }, 300);
    return () => { clearTimeout(timer); token.cancelled = true; };
  }, [query, cs, ww, rx, include, exclude, runKey, getFiles, readBatch]);

  const toggleFold = (p) => setFolded((f) => { const n = new Set(f); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const spec = { query, caseSensitive: cs, wholeWord: ww, regex: rx };

  const summary = (() => {
    if (res.status === 'error') return <span className="zb-err">{res.error}</span>;
    if (res.status === 'running') return tt(`Searching… ${res.done}/${res.of}`, `جاري البحث… ${res.done}/${res.of}`);
    if (res.status === 'done') {
      if (!res.total) return tt('No results found.', 'لا توجد نتائج.');
      const more = res.truncated ? '+' : '';
      return tt(`${res.total}${more} results in ${res.files.length} files`, `${res.total}${more} نتيجة في ${res.files.length} ملف`);
    }
    return '';
  })();

  return (
    <div className={`zb-sp${off ? ' is-off' : ''}`}>
      <div className="zb-sp__box">
        <div className="zb-sp__field">
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); setRunKey((k) => k + 1); }
              else if (e.key === 'Escape') setQuery('');
            }}
            placeholder={tt('Search in files', 'بحث داخل الملفات')}
            aria-label={tt('Search in files', 'بحث داخل الملفات')}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className={`zb-opt${cs ? ' is-on' : ''}`} onClick={() => setCs((v) => !v)} title={tt('Match case', 'مطابقة حالة الأحرف')} aria-pressed={cs}>Aa</button>
          <button type="button" className={`zb-opt${ww ? ' is-on' : ''}`} onClick={() => setWw((v) => !v)} title={tt('Match whole word', 'مطابقة الكلمة كاملة')} aria-pressed={ww}><u>ab</u></button>
          <button type="button" className={`zb-opt${rx ? ' is-on' : ''}`} onClick={() => setRx((v) => !v)} title={tt('Use regular expression', 'تعبير نمطي (Regex)')} aria-pressed={rx}>.*</button>
        </div>
        <button type="button" className={`zb-sp__more${filters ? ' is-on' : ''}`} onClick={() => setFilters((v) => !v)} aria-expanded={filters}>
          <span className={`zb-chev${filters ? ' is-open' : ''}`}><Icon name="chevron-right" size={12} /></span>
          {tt('files to include / exclude', 'تضمين / استبعاد ملفات')}
        </button>
        {filters && (
          <div className="zb-sp__filters">
            <label>{tt('files to include', 'الملفات المضمَّنة')}
              <input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="*.php, src/components" spellCheck={false} />
            </label>
            <label>{tt('files to exclude', 'الملفات المستبعدة')}
              <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="node_modules, *.min.js" spellCheck={false} />
            </label>
          </div>
        )}
      </div>

      <div className="zb-sp__sum">
        <span>{summary}</span>
        {res.files.length > 0 && (
          <span className="zb-sp__tools">
            <button type="button" onClick={() => setRunKey((k) => k + 1)} title={tt('Refresh', 'تحديث')} aria-label={tt('Refresh', 'تحديث')}>↻</button>
            <button type="button" onClick={() => setFolded(folded.size ? new Set() : new Set(res.files.map((f) => f.path)))} title={tt('Collapse / expand all', 'طيّ / فتح الكل')} aria-label={tt('Collapse or expand all', 'طيّ أو فتح الكل')}>⇅</button>
          </span>
        )}
      </div>
      {res.status === 'done' && res.truncated && <p className="zb-sp__note">{tt('Too many results — refine your search to see the rest.', 'نتائج كثيرة جدًا — حدّد البحث لرؤية الباقي.')}</p>}
      {res.status === 'done' && res.skipped > 0 && <p className="zb-sp__note">{tt(`${res.skipped} large files were skipped (over 1 MB).`, `تم تخطي ${res.skipped} ملف كبير (أكبر من 1 ميجابايت).`)}</p>}

      <div className="zb-side__scroll">
        <ul className="zb-sr">
          {res.files.map((f) => {
            const closed = folded.has(f.path);
            return (
              <li key={f.path}>
                <button type="button" className="zb-sr__file" onClick={() => toggleFold(f.path)} title={f.path}>
                  <span className={`zb-chev${closed ? '' : ' is-open'}`}><Icon name="chevron-right" size={13} /></span>
                  <Badge path={f.path} />
                  <b>{baseName(f.path)}</b>
                  <small>{dirName(f.path)}</small>
                  <i className="zb-pill zb-pill--dim">{f.matches.length}{f.capped ? '+' : ''}</i>
                </button>
                {!closed && (
                  <ul>
                    {f.matches.map((m) => {
                      const id = `${f.path}:${m.line}:${m.col}`;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            className={`zb-sm${picked === id ? ' is-on' : ''}`}
                            onClick={() => { setPicked(id); onOpen(f.path, m, spec); }}
                            title={`${f.path}:${m.line}`}
                          >
                            <span className="zb-sm__ln">{m.line}</span>
                            <span className="zb-sm__txt">{m.pre}<mark>{m.hit}</mark>{m.post}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {res.status === 'idle' && <p className="zb-hint">{tt('Type to search inside every file in the archive.', 'اكتب كلمة للبحث داخل كل ملفات الأرشيف.')}</p>}
      </div>
    </div>
  );
}
