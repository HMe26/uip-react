import { useCallback, useRef, useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { SharedLinksPanel } from '../MySharedLinks';
import '../../styles/css/shared-links-manager.css';

/**
 * Settings → Shared links: every My PC link I shared, in one place.
 * Select several (or all) to pause / resume / delete them together, or manage each link on its own.
 */
export default function SharedLinksCard() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [toast, setToast] = useState(null);
  const timer = useRef(0);
  const flash = useCallback((msg, kind) => {
    setToast({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <div className="card glass-panel slm-card">
      <header className="slm-card__head">
        <span className="slm-card__ico"><Icon name="link" size={20} /></span>
        <div>
          <h2 className="text-h3">{ar ? 'الروابط اللي شاركتها' : 'Shared links'}</h2>
          <p className="text-caption">{ar
            ? 'تحكّم في كل روابط "جهازي": أوقفها مؤقتًا وافتحها بعدين، أو احذف المحدد أو الكل. اللي بيفتح رابط موقوف بيشوف صفحة إيقاف مؤقت.'
            : 'Control every My PC link: pause and resume them later, or delete the selected ones or all of them. Anyone opening a paused link sees a “paused” page.'}</p>
        </div>
      </header>
      <SharedLinksPanel ar={ar} locale={locale} onToast={flash} embedded />
      {toast && <div className={`slm-toast${toast.kind === 'error' ? ' is-error' : ''}`} role="status"><Icon name={toast.kind === 'error' ? 'alert' : 'check-circle'} size={16} />{toast.msg}</div>}
    </div>
  );
}
