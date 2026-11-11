import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import Icon from '../Icon';
import Slide from '../editor/PptxSlide';
import { createSession, loadDeck } from '../../lib/officeFmt/pptx';
import { readDocx } from '../../lib/officeFmt/docx';
import { twToPx } from '../editor/docxEdit';
import useNearScreen from '../../lib/useNearScreen';
import { useLanguage } from '../../context/LanguageContext';
import { fetchMediaBlob, mediaBaseOf } from '../../lib/postMedia';
import '../../styles/css/office.css';
import '../../styles/css/pptx.css';
import '../../styles/css/docx.css';

const XlsxPreview = lazy(() => import('../editor/XlsxView').then((m) => ({ default: m.XlsxPreview })));

/**
 * Word / PowerPoint / Excel attachments shown INSIDE the post like a PDF: swipeable pages.
 *   .pptx  every slide is one page (the real slide renderer of the file viewer)
 *   .docx  the text is paginated to the document's own page size (CSS columns = pages), one page per swipe
 *   .xlsx / .csv / .tsv  the sheet in a scrollable frame (sheet tabs inside)
 * Everything is rendered in the browser from the original file, so it works without LibreOffice on the server.
 * The first page is the cover (no more grey placeholder): the file is fetched when the card scrolls near the screen.
 * The full-screen button still opens the platform viewer / editor exactly as before.
 */
export const OFFICE_CAROUSEL_EXT = ['pptx', 'docx', 'xlsx', 'csv', 'tsv'];
const AUTO_MAX_BYTES = 25 * 1024 * 1024;
export const canCarousel = (m) => OFFICE_CAROUSEL_EXT.includes((m.extension || '').toLowerCase()) && (Number(m.size_bytes) || 0) <= AUTO_MAX_BYTES;


/** True once the element is actually in view (not just near it), one frame later — pages are laid out then, never while off-screen. */
function useShownOnce() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return undefined;
    let raf = 0;
    const fire = () => { raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setShown(true)); }); };
    if (typeof IntersectionObserver === 'undefined') { fire(); return () => cancelAnimationFrame(raf); }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fire(); } }, { rootMargin: '0px', threshold: 0.01 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [shown]);
  return { ref, shown };
}

/** Horizontal scroll-snap rail state shared by every kind of page. */
function useRail(total, pitch) {
  const railRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const step = useCallback(() => pitch || railRef.current?.clientWidth || 1, [pitch]);
  const go = (n) => {
    const r = railRef.current; if (!r) return;
    const next = Math.max(0, Math.min(total - 1, n));
    const sign = getComputedStyle(r).direction === 'rtl' ? -1 : 1;
    r.scrollTo({ left: sign * next * step(), behavior: 'smooth' });
    setIdx(next);
  };
  const onScroll = () => {
    const r = railRef.current; if (!r) return;
    const i = Math.round(Math.abs(r.scrollLeft) / step());
    if (i !== idx) setIdx(Math.max(0, Math.min(total - 1, i)));
  };
  return { railRef, idx, go, onScroll };
}

function Chrome({ media, total, idx, go, rtl, onOpenFull, onDownload, tt, children, hint }) {
  const prevIcon = rtl ? 'chevron-right' : 'chevron-left';
  const nextIcon = rtl ? 'chevron-left' : 'chevron-right';
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + (rtl ? -1 : 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx + (rtl ? 1 : -1)); }
  };
  return (
    <div className="pp-doc pp-doc--office" tabIndex={0} onKeyDown={onKey} role="region" aria-label={media.original_name}>
      {children}
      {total > 1 && (
        <>
          <button type="button" className="pp-doc__nav is-prev" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label={tt('Previous page', 'الصفحة السابقة')}><Icon name={prevIcon} size={20} /></button>
          <button type="button" className="pp-doc__nav is-next" onClick={() => go(idx + 1)} disabled={idx >= total - 1} aria-label={tt('Next page', 'الصفحة التالية')}><Icon name={nextIcon} size={20} /></button>
        </>
      )}
      <div className="pp-doc__bar">
        <span>{hint || `${Math.min(idx + 1, Math.max(total, 1))} / ${total || '…'}`}</span>
        <div className="pp-doc__dots" aria-hidden="true">
          {total > 1 && total <= 14 && Array.from({ length: total }, (_, i) => <i key={i} className={i === idx ? 'is-on' : ''} />)}
        </div>
        {onDownload && <button type="button" className="pp-doc__full" onClick={onDownload} title={tt('Download', 'تنزيل')}><Icon name="download" size={15} /></button>}
        {onOpenFull && <button type="button" className="pp-doc__full" onClick={() => onOpenFull(media, idx)} title={tt('Open in viewer', 'فتح في العارض')}><Icon name="maximize" size={15} /></button>}
      </div>
    </div>
  );
}

function PptxPages({ blob, media, chrome }) {
  const [state, setState] = useState({ deck: null, err: '' });
  useEffect(() => {
    let dead = false;
    const session = createSession();
    blob.arrayBuffer()
      .then((b) => unzipSync(new Uint8Array(b)))
      .then((files) => { if (!dead) setState({ deck: loadDeck(files, session), err: '' }); })
      .catch((e) => { if (!dead) setState({ deck: null, err: e?.message || 'error' }); });
    return () => { dead = true; session.revoke(); };
  }, [blob]);
  const total = state.deck?.slides.length || 0;
  const rail = useRail(total);
  const vis = useShownOnce();
  if (state.err) return chrome.fail();
  if (!state.deck) return chrome.loading(16 / 9);
  const { deck } = state;
  return (
    <Chrome {...chrome.props} total={total} idx={rail.idx} go={rail.go}>
      <div className="pp-doc__rail" ref={(n) => { rail.railRef.current = n; vis.ref.current = n; }} onScroll={rail.onScroll} style={vis.shown ? undefined : { aspectRatio: `${deck.cx} / ${deck.cy}` }}>
        {vis.shown && deck.slides.map((sl) => (
          <div key={sl.index} className="pp-doc__slide pp-doc__slide--deck" aria-label={`${chrome.props.tt('Slide', 'شريحة')} ${sl.index}`}>
            <Slide slide={sl} deck={deck} />
          </div>
        ))}
      </div>
    </Chrome>
  );
}

function DocxPages({ blob, media, chrome }) {
  const [state, setState] = useState({ doc: null, err: '' });
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const flowRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  useEffect(() => {
    let dead = false;
    blob.arrayBuffer().then((b) => readDocx(b)).then((doc) => { if (!dead) setState({ doc, err: '' }); }).catch((e) => { if (!dead) setState({ doc: null, err: e?.message || 'error' }); });
    return () => { dead = true; };
  }, [blob]);
  useLayoutEffect(() => {
    if (!state.doc || !boxRef.current) return undefined;
    const measure = () => setWidth(boxRef.current?.clientWidth || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [state.doc]);

  const pg = state.doc?.page;
  const d = state.doc?.defaults;
  const pageW = pg ? twToPx(pg.w) : 1;
  const pageH = pg ? twToPx(pg.h) : 1;
  const fit = width ? width / pageW : 1; // the page is scaled so exactly one page fills the card
  const rail = useRail(pages, width);

  const sizes = useMemo(() => {
    if (!pg) return null;
    const left = twToPx(pg.left); const right = twToPx(pg.right);
    const top = twToPx(Math.min(pg.header, pg.top)); const bottom = twToPx(Math.min(pg.footer, pg.bottom));
    return { left, right, top, bottom, textW: pageW - left - right, textH: pageH - top - bottom };
  }, [pg, pageW, pageH]);

  // count pages: the multi-column flow overflows sideways, one page pitch (page width) per page
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || !state.doc || !width || !sizes) return undefined;
    const count = () => setPages(Math.max(1, Math.ceil((el.scrollWidth + sizes.left + sizes.right - 2) / pageW)));
    count();
    const imgs = Array.from(el.querySelectorAll('img'));
    imgs.forEach((im) => { if (!im.complete) im.addEventListener('load', count, { once: true }); });
    const t = setTimeout(count, 400);
    return () => clearTimeout(t);
  }, [state.doc, width, pageW, sizes]);

  if (state.err) return chrome.fail();
  if (!state.doc) return chrome.loading(0.72);
  const rtl = !!d.rtl;
  const pitch = pageW * fit;
  return (
    <Chrome {...chrome.props} total={pages} idx={rail.idx} go={rail.go} rtl={rtl || chrome.props.rtl}>
      <div ref={boxRef} className="pp-docx" style={{ height: pageH * fit }}>
        <div className="pp-doc__rail pp-docx__rail" ref={rail.railRef} onScroll={rail.onScroll} dir={rtl ? 'rtl' : 'ltr'} style={{ height: pageH * fit }}>
          <div
            ref={flowRef}
            className="dxp dxp--ro pp-docx__flow"
            dir={rtl ? 'rtl' : 'ltr'}
            style={{
              zoom: fit, width: pageW, height: pageH, boxShadow: 'none', display: 'block',
              paddingTop: sizes.top, paddingBottom: sizes.bottom, paddingInlineStart: sizes.left, paddingInlineEnd: sizes.right,
              '--dx-font': `'${d.font}', Calibri, Arial, 'Noto Naskh Arabic', sans-serif`, '--dx-size': `${d.size}pt`, '--dx-before': `${d.before}pt`, '--dx-after': `${d.after}pt`, '--dx-line': d.line,
            }}
          >
            <div
              ref={bodyRef}
              className="dxp__body pp-docx__text"
              style={{ width: sizes.textW, height: sizes.textH, columnWidth: sizes.textW, columnGap: sizes.left + sizes.right, columnFill: 'auto' }}
              dangerouslySetInnerHTML={{ __html: state.doc.html }}
            />
            {Array.from({ length: pages }, (_, i) => <i key={i} className="pp-docx__snap" style={{ insetInlineStart: i * pageW, width: pageW }} />)}
          </div>
        </div>
      </div>
    </Chrome>
  );
}

function SheetPages({ blob, media, chrome }) {
  const ext = (media.extension || '').toLowerCase();
  const { props } = chrome;
  const vis = useShownOnce();
  return (
    <Chrome {...props} total={1} idx={0} go={() => {}} hint={props.tt('Sheet', 'جدول')}>
      <div className="pp-sheet" ref={vis.ref}>
        {vis.shown ? (
          <Suspense fallback={<div className="pp-doc__spin" />}>
            <XlsxPreview blob={blob} ext={ext === 'xlsx' ? 'xlsx' : ext} tt={props.tt} rtl={props.rtl} />
          </Suspense>
        ) : <div className="pp-doc__spin" />}
      </div>
    </Chrome>
  );
}

export default function OfficeCarousel({ media, onOpenFull, onDownload }) {
  const { locale } = useLanguage();
  const rtl = locale === 'ar';
  const tt = useCallback((en, ar) => (rtl ? ar : en), [rtl]);
  const { ref, seen } = useNearScreen();
  const [state, setState] = useState({ blob: null, err: false });
  const ext = (media.extension || '').toLowerCase();

  useEffect(() => {
    if (!seen) return undefined;
    let dead = false;
    fetchMediaBlob(media.id, 'file', mediaBaseOf(media)).then((b) => { if (!dead) setState({ blob: b, err: false }); }).catch(() => { if (!dead) setState({ blob: null, err: true }); });
    return () => { dead = true; };
  }, [seen, media.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const props = { media, rtl, onOpenFull, onDownload, tt };
  const chrome = {
    props,
    loading: (ratio) => <div className="pp-doc pp-doc--wait" style={{ aspectRatio: String(ratio) }}><span className="pp-doc__spin" /><span className="pp-doc__badge"><Icon name="file" size={14} /> {media.original_name}</span></div>,
    fail: () => (
      <button type="button" className="pp-doc pp-doc--wait" style={{ aspectRatio: '16 / 9' }} onClick={() => onOpenFull?.(media, 0)}>
        <span className="pp-doc__ph"><Icon name="file" size={44} /></span>
        <span className="pp-doc__badge"><Icon name="file" size={14} /> {media.original_name} · {tt('Open', 'فتح')}</span>
      </button>
    ),
  };

  let body;
  if (state.err) body = chrome.fail();
  else if (!state.blob) body = chrome.loading(ext === 'docx' ? 0.72 : 16 / 9);
  else if (ext === 'pptx') body = <PptxPages blob={state.blob} media={media} chrome={chrome} />;
  else if (ext === 'docx') body = <DocxPages blob={state.blob} media={media} chrome={chrome} />;
  else body = <SheetPages blob={state.blob} media={media} chrome={chrome} />;
  return <div ref={ref} className="pp-officewrap">{body}</div>;
}
