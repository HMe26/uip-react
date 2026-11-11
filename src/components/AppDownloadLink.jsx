import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import BrandWordmark from './BrandWordmark';
import Icon from './Icon';

/** Native share sheet when the WebView has it, else copy the link. Resolves 'shared' | 'copied' | 'cancelled' | 'failed'. */
export async function shareAppLink(url, title, text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch { /* clipboard blocked: legacy path below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * The "get the app" call to action, one component for every place it appears.
 * - Website: a normal link that opens the APK download (new tab).
 * - Inside the Android app (app.native): the same spot becomes "Share the app" — it opens the phone's share sheet
 *   (or copies the link), because people who already have the app need to pass it on, not download it again.
 * `app` comes from useAppDownload(). Children are not used: the label is built here (EN/AR).
 */
export default function AppDownloadLink({ app, className = '', iconSize = 16, withIcon = true, labels, logo = false }) {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const [note, setNote] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const L = {
    download: t('Download the Android app', 'حمّل تطبيق الأندرويد'),
    share: t('Share the app', 'شارك التطبيق'),
    ...labels,
  };

  async function onClick(e) {
    if (!app.native) return; // website: let the link open the download
    e.preventDefault();
    const res = await shareAppLink(
      app.url,
      'UIPE',
      t('Join me on UIPE — get the Android app:', 'انضم لي على UIPE — حمّل تطبيق الأندرويد:'),
    );
    if (res === 'copied') setNote(t('Link copied ✓', 'تم نسخ الرابط ✓'));
    else if (res === 'failed') window.prompt(t('Copy the app link:', 'انسخ رابط التطبيق:'), app.url);
    clearTimeout(timer.current);
    if (res === 'copied') timer.current = setTimeout(() => setNote(''), 2500);
  }

  return (
    <a href={app.url} className={`${className}${logo ? ' app-dl' : ''}`} onClick={onClick}
      {...(app.native ? { role: 'button' } : { target: '_blank', rel: 'noopener noreferrer' })}>
      {logo && (
        <span className="app-dl__logo" aria-hidden="true">
          <BrandWordmark width={Math.round((iconSize + 14) * 2.5)} height={iconSize + 14} />
        </span>
      )}
      {withIcon && !logo && <Icon name={app.native ? 'share' : 'smartphone'} size={iconSize} />} {note || (app.native ? L.share : L.download)}
    </a>
  );
}
