import { useBackLayer } from '../lib/backStack';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { useLanguage } from '../context/LanguageContext';
import { EXPORT_FORMATS, runWithSink } from '../lib/exporter';
import { BlobPreviewModal } from './FilePreviewButton';
import { getPreferredExportLang, setPreferredExportLang, withExportLang } from '../lib/exportLang';

const LABELS = {
  csv: { en: 'CSV (.csv)', ar: 'CSV (.csv)', hint: { en: 'Plain text', ar: 'نص بسيط' } },
  xlsx: { en: 'Excel (.xlsx)', ar: 'Excel (.xlsx)', hint: { en: 'Spreadsheet', ar: 'جدول بيانات' } },
  pdf: { en: 'PDF (.pdf)', ar: 'PDF (.pdf)', hint: { en: 'Print-ready', ar: 'جاهز للطباعة' } },
  json: { en: 'JSON (.json)', ar: 'JSON (.json)', hint: { en: 'Structured data', ar: 'بيانات منظمة' } },
  docx: { en: 'Word (.docx)', ar: 'Word (.docx)', hint: { en: 'Word document', ar: 'مستند Word' } },
  md: { en: 'Markdown (.md)', ar: 'Markdown (.md)', hint: { en: 'Markdown text', ar: 'نص Markdown' } },
  html: { en: 'Web page (.html)', ar: 'صفحة ويب (.html)', hint: { en: 'Opens in any browser', ar: 'تُفتح في أي متصفح' } },
  txt: { en: 'Text (.txt)', ar: 'نص (.txt)', hint: { en: 'Plain text', ar: 'نص عادي' } },
  xml: { en: 'XML (.xml)', ar: 'XML (.xml)', hint: { en: 'Structured markup', ar: 'بيانات XML' } },
};
const UI = {
  export: { en: 'Export', ar: 'تصدير' },
  exporting: { en: 'Exporting…', ar: 'جارٍ التصدير…' },
  choose: { en: 'Choose file format', ar: 'اختر صيغة الملف' },
  fileLang: { en: 'File language', ar: 'لغة الملف' },
  preview: { en: 'Preview', ar: 'معاينة' },
};

/**
 * Export button with a format picker (CSV / Excel / PDF / JSON).
 *
 *   <ExportMenu onExport={(format) => doExport(format)} busy={exporting} />
 *
 * `onExport` may be async — the button shows the busy state until it settles.
 * The menu is portaled to <body> and positioned against the button, so it is
 * never clipped by scrolling tables or drawers, and flips upward / sideways
 * when there is no room.
 */
export default function ExportMenu({
  onExport,
  formats = EXPORT_FORMATS,
  busy = false,
  disabled = false,
  label,
  iconOnly = false,
  className = 'btn btn-outline',
  iconSize = 16,
  style,
}) {
  const { locale } = useLanguage();
  const lang = locale === 'ar' ? 'ar' : 'en';
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  const [pending, setPending] = useState(false);
  const [pos, setPos] = useState(null);
  const [captured, setCaptured] = useState(null);
  const [fileLang, setFileLangState] = useState(() => getPreferredExportLang(lang));
  const setFileLang = (l) => { setFileLangState(l); setPreferredExportLang(lang, l); };
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const isBusy = busy || pending;
  const text = label || UI.export[lang];

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const menuH = menuRef.current?.offsetHeight || formats.length * 52 + 40;
    const menuW = menuRef.current?.offsetWidth || 220;
    const up = b.bottom + menuH + 12 > window.innerHeight && b.top > menuH + 12;
    const top = up ? b.top - menuH - 6 : b.bottom + 6;
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    let left = rtl ? b.right - menuW : b.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
    setPos({ top: Math.max(8, top), left });
  }, [formats.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const pick = async (format) => {
    setOpen(false);
    setPending(true);
    try { await withExportLang(fileLang, () => onExport?.(format, fileLang)); } finally { setPending(false); }
  };

  // Runs the same export routine, but intercepts the final save and shows the file instead.
  const preview = async (format) => {
    setOpen(false);
    setPending(true);
    try {
      let got = null;
      await runWithSink((blob, filename) => { got = { blob, filename }; }, () => withExportLang(fileLang, () => onExport?.(format, fileLang)));
      if (got) setCaptured(got);
    } finally { setPending(false); }
  };

  return (
    <>
      {captured && <BlobPreviewModal blob={captured.blob} filename={captured.filename} onClose={() => setCaptured(null)} />}
      <button
        ref={btnRef}
        type="button"
        className={iconOnly ? 'icon-btn' : className}
        style={style}
        disabled={disabled || isBusy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={text}
        title={text}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="download" size={iconSize} />
        {!iconOnly && <span>{isBusy ? UI.exporting[lang] : text}</span>}
        {!iconOnly && <Icon name="chevron-down" size={14} />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={UI.choose[lang]}
          className="export-menu"
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        >
          <div className="export-menu__title">{UI.fileLang[lang]}</div>
          <div className="export-menu__lang" role="group" aria-label={UI.fileLang[lang]}>
            {[['ar', 'العربية'], ['en', 'English']].map(([code, name]) => (
              <button key={code} type="button" className={fileLang === code ? 'is-on' : ''} aria-pressed={fileLang === code} onClick={() => setFileLang(code)}>{name}</button>
            ))}
          </div>
          <div className="export-menu__title">{UI.choose[lang]}</div>
          {formats.map((f) => (
            <div key={f} className="export-menu__row">
              <button type="button" role="menuitem" className="export-menu__item" onClick={() => pick(f)}>
                <span className={`export-menu__badge export-menu__badge--${f}`}>{f === 'xlsx' ? 'XLS' : f === 'docx' ? 'DOC' : f.toUpperCase()}</span>
                <span className="export-menu__text">
                  <strong>{LABELS[f]?.[lang] || f}</strong>
                  <small>{LABELS[f]?.hint[lang]}</small>
                </span>
              </button>
              <button type="button" className="export-menu__eye" title={UI.preview[lang]} aria-label={`${UI.preview[lang]} ${f.toUpperCase()}`} onClick={() => preview(f)}>
                <Icon name="eye" size={16} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
