import '../../styles/css/zip-markdown.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inlineText, parseMarkdown, safeUrl, slugify } from './markdown';
import { highlight, languageLabel } from './mdHighlight';

const ALERTS = {
  NOTE: { en: 'Note', ar: 'ملاحظة', g: 'i' },
  TIP: { en: 'Tip', ar: 'نصيحة', g: '✦' },
  IMPORTANT: { en: 'Important', ar: 'مهم', g: '!' },
  WARNING: { en: 'Warning', ar: 'تحذير', g: '!' },
  CAUTION: { en: 'Caution', ar: 'احذر', g: '×' },
};

const alignStyle = (a) => (a ? { textAlign: a } : undefined);
// eslint-disable-next-line no-control-regex
const hasScheme = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u.replace(/[\u0000-\u0020]/g, '')) || u.startsWith('//');
const dim = (v) => (v && /^\d+(\.\d+)?(px|%)?$/.test(v) ? (/[a-z%]$/i.test(v) ? v : `${v}px`) : undefined);

function copyText(text) {
  try { if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text); } catch { /* fall through */ }
  return new Promise((resolve) => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); resolve();
  });
}

/* ---------------------------------------------------------------- inline */

function Img({ n, env, inLink }) {
  const [bad, setBad] = useState(false);
  const raw = n.src || '';
  const src = useMemo(() => {
    const ok = safeUrl(raw, { image: true });
    if (!ok) return null;
    if (hasScheme(ok)) return ok;
    return env.resolveAsset ? env.resolveAsset(ok) : null;
  }, [raw, env]);
  if (!src || bad) {
    return <span className="mdv__imgerr" title={raw}><i aria-hidden="true">▣</i>{n.alt || raw.split('/').pop() || 'image'}</span>;
  }
  return (
    <img
      className={`mdv__img${inLink ? '' : ' is-zoom'}`} src={src} alt={n.alt} title={n.title || undefined} loading="lazy" draggable={false}
      style={{ width: dim(n.w), height: dim(n.h) }}
      onError={() => setBad(true)}
      onClick={inLink ? undefined : () => env.zoom({ src, alt: n.alt })}
    />
  );
}

function Link({ n, env }) {
  const href = safeUrl(n.href);
  if (!href) return <Inl nodes={n.k} env={env} inLink />;
  const onClick = (e) => {
    if (href.startsWith('#')) { e.preventDefault(); env.jump(href.slice(1)); return; }
    if (!hasScheme(href)) { e.preventDefault(); env.openPath(href); }
  };
  const ext = hasScheme(href) && /^https?:/i.test(href);
  return (
    <a href={href} title={n.title || undefined} onClick={onClick} {...(ext ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>
      <Inl nodes={n.k} env={env} inLink />
    </a>
  );
}

function Inl({ nodes, env, inLink }) {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i} className="mdv__ic" dir="auto">{n.v}</code>;
      case 'b': return <strong key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></strong>;
      case 'i': return <em key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></em>;
      case 's': return <s key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></s>;
      case 'u': return <u key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></u>;
      case 'kbd': return <kbd key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></kbd>;
      case 'sub': return <sub key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></sub>;
      case 'sup': return <sup key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></sup>;
      case 'mark': return <mark key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></mark>;
      case 'small': return <small key={i}><Inl nodes={n.k} env={env} inLink={inLink} /></small>;
      case 'a': return <Link key={i} n={n} env={env} />;
      case 'img': return <Img key={i} n={n} env={env} inLink={inLink} />;
      default: return null;
    }
  });
}

/* ----------------------------------------------------------------- blocks */

function CodeBlock({ n, env }) {
  const [done, setDone] = useState(false);
  const toks = useMemo(() => highlight(n.lang, n.text), [n.lang, n.text]);
  const copy = () => { copyText(n.text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); };
  return (
    <figure className="mdv__code" dir="ltr">
      <figcaption>
        <span>{languageLabel(n.lang)}</span>
        {!env.locked && <button type="button" onClick={copy}>{done ? env.tt('Copied', 'تم النسخ') : env.tt('Copy', 'نسخ')}</button>}
      </figcaption>
      <pre><code>{toks.map((t, i) => (t.c ? <span key={i} className={`mdv-t-${t.c}`}>{t.v}</span> : t.v))}</code></pre>
    </figure>
  );
}

function Blocks({ nodes, env }) {
  return nodes.map((n, i) => <Block key={i} n={n} env={env} />);
}

function Block({ n, env }) {
  switch (n.t) {
    case 'h': {
      const Tag = `h${n.level}`;
      return (
        <Tag id={`md-${n.id}`} className="mdv__h" dir="auto" style={alignStyle(n.align)}>
          <Inl nodes={n.inl} env={env} />
          <a className="mdv__anchor" href={`#${n.id}`} aria-label="link" onClick={(e) => { e.preventDefault(); env.jump(n.id); }}>#</a>
        </Tag>
      );
    }
    case 'p': return <p dir="auto"><Inl nodes={n.inl} env={env} /></p>;
    case 'hr': return <hr className="mdv__hr" />;
    case 'code': return <CodeBlock n={n} env={env} />;
    case 'quote': {
      if (n.alert) {
        const a = ALERTS[n.alert];
        return (
          <aside className={`mdv__alert mdv__alert--${n.alert.toLowerCase()}`}>
            <div className="mdv__alert__t"><span className="mdv__alert__ic" aria-hidden="true">{a.g}</span>{env.tt(a.en, a.ar)}</div>
            <Blocks nodes={n.kids} env={env} />
          </aside>
        );
      }
      return <blockquote className="mdv__quote"><Blocks nodes={n.kids} env={env} /></blockquote>;
    }
    case 'list': {
      const Tag = n.ordered ? 'ol' : 'ul';
      const tasks = n.items.some((it) => it.task !== null);
      return (
        <Tag className={`mdv__list${n.loose ? '' : ' is-tight'}${tasks ? ' has-tasks' : ''}`} dir="auto" start={n.ordered && n.start !== 1 ? n.start : undefined}>
          {n.items.map((it, i) => (
            <li key={i} className={it.task !== null ? 'is-task' : undefined}>
              {it.task !== null && (
                <input type="checkbox" checked={it.task} disabled={!env.toggleTask} onChange={() => env.toggleTask(it.line)} aria-label={env.tt('Toggle task', 'تبديل المهمة')} />
              )}
              <div className="mdv__li"><Blocks nodes={it.kids} env={env} /></div>
            </li>
          ))}
        </Tag>
      );
    }
    case 'table': {
      return (
        <div className="mdv__tablewrap">
          <table className="mdv__table">
            <thead><tr>{n.head.map((c, i) => <th key={i} dir="auto" style={alignStyle(n.align[i])}><Inl nodes={c} env={env} /></th>)}</tr></thead>
            <tbody>{n.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i} dir="auto" style={alignStyle(n.align[i])}><Inl nodes={c} env={env} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case 'wrap': return <div className="mdv__wrap" style={alignStyle(n.align)}><Blocks nodes={n.kids} env={env} /></div>;
    case 'details':
      return (
        <details className="mdv__details">
          <summary dir="auto"><Inl nodes={n.summary.length ? n.summary : [{ t: 'text', v: env.tt('Details', 'تفاصيل') }]} env={env} /></summary>
          <div className="mdv__details__b"><Blocks nodes={n.kids} env={env} /></div>
        </details>
      );
    default: return null;
  }
}

/* ------------------------------------------------------------------- view */

/**
 * Rendered preview of a Markdown tab of the ZIP workbench.
 * Props: text, path, tt(en, ar), themeEd (code colours), resolveAsset(src) -> blob url | null (images inside the archive),
 * openPath(href) (links to other files of the archive), onToggleTask(lineNo) (click a task checkbox -> edits the source), rtl.
 */
export default function MarkdownView({ text, path, tt, themeEd, resolveAsset, openPath, onToggleTask, rtl, locked = false }) {
  const doc = useMemo(() => parseMarkdown(text), [text]);
  const scroller = useRef(null);
  const [toc, setToc] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 1100));
  const [zoom, setZoom] = useState(null);
  const [active, setActive] = useState('');
  const [copied, setCopied] = useState(false);

  const jump = useCallback((id) => {
    const root = scroller.current;
    if (!root) return;
    let key = id;
    try { key = decodeURIComponent(id); } catch { /* keep */ }
    const find = (k) => root.querySelector(`[id="md-${k.replace(/["\\]/g, '')}"]`);
    const el = find(key) || find(slugify(key));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const env = useMemo(() => ({
    tt, jump, zoom: setZoom,
    locked,
    resolveAsset: resolveAsset ? (src) => resolveAsset(src) : null,
    openPath: (href) => { if (openPath) openPath(href); },
    toggleTask: onToggleTask || null,
  }), [tt, jump, resolveAsset, openPath, onToggleTask, locked]);

  const heads = useMemo(() => doc.headings.filter((h) => h.level <= 3), [doc]);
  const minLevel = useMemo(() => heads.reduce((m, h) => Math.min(m, h.level), 6), [heads]);

  // highlight the section being read in the contents list
  useEffect(() => {
    const root = scroller.current;
    if (!root || !heads.length || typeof IntersectionObserver === 'undefined') return undefined;
    const els = heads.map((h) => root.querySelector(`[id="md-${h.id}"]`)).filter(Boolean);
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id); });
      const first = els.find((el) => seen.has(el.id));
      if (first) setActive(first.id.slice(3));
    }, { root, rootMargin: '0px 0px -70% 0px', threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [heads, doc]);

  useEffect(() => {
    if (!zoom) return undefined;
    const k = (e) => { if (e.key === 'Escape') setZoom(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [zoom]);

  const vars = useMemo(() => {
    const e = themeEd || {};
    return {
      '--mdv-kw': e.keyword, '--mdv-str': e.string, '--mdv-num': e.number, '--mdv-com': e.comment, '--mdv-fn': e.fn,
      '--mdv-prop': e.prop, '--mdv-type': e.type, '--mdv-tag': e.tag, '--mdv-attr': e.attr, '--mdv-lit': e.control, '--mdv-var': e.variable,
    };
  }, [themeEd]);

  const minutes = Math.max(1, Math.round(doc.words / 200));
  const title = (path || '').split('/').pop();
  const copyAll = () => { copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); };

  return (
    <div className="mdv" style={vars} dir={rtl ? 'rtl' : 'ltr'}>
      <div className="mdv__bar">
        <strong title={path}>{title}</strong>
        <span className="mdv__stat">{doc.words.toLocaleString()} {tt('words', 'كلمة')} · {minutes} {tt('min read', 'د قراءة')}</span>
        <span className="mdv__sp" />
        {!locked && <button type="button" onClick={copyAll}>{copied ? tt('Copied', 'تم النسخ') : tt('Copy Markdown', 'نسخ Markdown')}</button>}
        {heads.length > 0 && <button type="button" className={toc ? 'is-on' : ''} onClick={() => setToc((v) => !v)}>{tt('Contents', 'المحتويات')}</button>}
      </div>
      <div className="mdv__main">
        <div className="mdv__scroll" ref={scroller}>
          <article className="mdv__doc">
            {doc.meta && (
              <details className="mdv__meta" dir="ltr">
                <summary>{tt('Front matter', 'بيانات الملف (Front matter)')}</summary>
                <pre>{doc.meta}</pre>
              </details>
            )}
            {doc.blocks.length === 0 && !doc.meta
              ? <p className="mdv__empty">{tt('This file is empty. Switch to Text and start writing.', 'الملف فاضي. حوّل لعرض «نص» وابدأ الكتابة.')}</p>
              : <Blocks nodes={doc.blocks} env={env} />}
          </article>
        </div>
        {toc && heads.length > 0 && (
          <nav className="mdv__toc" aria-label={tt('Contents', 'المحتويات')}>
            <div className="mdv__toc__t">{tt('On this page', 'في هذه الصفحة')}</div>
            {heads.map((h, i) => (
              <a key={`${h.id}-${i}`} href={`#${h.id}`} className={active === h.id ? 'is-on' : ''} style={{ '--l': h.level - minLevel }} dir="auto"
                onClick={(e) => { e.preventDefault(); jump(h.id); }}>{inlineText([{ t: 'text', v: h.text }]) || h.id}</a>
            ))}
          </nav>
        )}
      </div>
      {zoom && (
        <div className="mdv__zoom" onClick={() => setZoom(null)} role="dialog" aria-modal="true">
          <img src={zoom.src} alt={zoom.alt} />
        </div>
      )}
    </div>
  );
}
