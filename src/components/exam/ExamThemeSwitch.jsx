import Icon from '../Icon';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Light / Classic / Dark switch for inside the exam. The student portal is locked while an attempt is
 * running (no sidebar, no top bar), so a student who forgot to pick a look before starting would
 * otherwise be stuck with it. Same three modes and the same setter as the rest of the platform.
 */
export default function ExamThemeSwitch({ className = '' }) {
  const { mode, setMode } = useTheme();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const options = [
    ['light', 'sun', ar ? 'فاتح' : 'Light'],
    ['classic', 'palette', ar ? 'كلاسيكي' : 'Classic'],
    ['dark', 'moon', ar ? 'داكن' : 'Dark'],
  ];
  return (
    <div className={`ex-theme ${className}`.trim()} role="group" aria-label={ar ? 'المظهر' : 'Appearance'}>
      {options.map(([key, icon, label]) => (
        <button
          key={key} type="button" title={label} aria-label={label}
          className={mode === key ? 'is-active' : ''} aria-pressed={mode === key}
          onClick={() => setMode(key)}
        >
          <Icon name={icon} size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
