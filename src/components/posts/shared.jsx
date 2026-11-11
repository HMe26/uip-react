import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { avatarSrc } from '../insight/AvatarUploader';
import { initials } from '../feed/feedUi';

export function useTt() {
  const { locale } = useLanguage();
  const tt = (en, ar) => (locale === 'ar' ? ar : en);
  return { tt, locale, rtl: locale === 'ar' };
}

export const REACTIONS = {
  like: { e: '👍', en: 'Like', ar: 'إعجاب' }, love: { e: '❤️', en: 'Love', ar: 'حب' }, insightful: { e: '💡', en: 'Insightful', ar: 'مفيد' },
  celebrate: { e: '🎉', en: 'Celebrate', ar: 'تهنئة' }, support: { e: '🤝', en: 'Support', ar: 'دعم' }, funny: { e: '😂', en: 'Funny', ar: 'طريف' },
};
export const VIS = {
  public: { icon: 'globe', en: 'Everyone', ar: 'الجميع' }, followers: { icon: 'users', en: 'Followers', ar: 'المتابعون' },
  connections: { icon: 'user-check', en: 'My connections', ar: 'اتصالاتي' },
  contacts: { icon: 'message', en: 'Chat contacts', ar: 'جهات الاتصال' }, university: { icon: 'building', en: 'My university', ar: 'جامعتي' },
  faculty: { icon: 'graduation-cap', en: 'My faculty', ar: 'كليتي' }, selected: { icon: 'user', en: 'Selected people', ar: 'أشخاص محددون' },
  private: { icon: 'lock', en: 'Only me', ar: 'أنا فقط' },
};
export const COMMENT_MODES = {
  everyone: { en: 'Everyone can comment', ar: 'الجميع يعلّق' }, followers: { en: 'Followers only', ar: 'المتابعون فقط' },
  contacts: { en: 'Chat contacts only', ar: 'جهات الاتصال فقط' }, none: { en: 'Comments off', ar: 'التعليقات مغلقة' },
};
export const REPORT_REASONS = {
  spam: ['Spam', 'مزعج / سبام'], harassment: ['Harassment', 'تحرّش'], hate: ['Hate speech', 'خطاب كراهية'], violence: ['Violence', 'عنف'],
  sexual: ['Sexual content', 'محتوى جنسي'], misinformation: ['Misinformation', 'معلومات مضللة'], copyright: ['Copyright', 'حقوق نشر'], other: ['Other', 'أخرى'],
};

export function PAvatar({ user, size = 40 }) {
  const src = user?.avatar_path ? avatarSrc(user.avatar_path) : null;
  return (
    <span className="pp-av" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {src ? <img src={src} alt="" /> : initials(user?.full_name)}
    </span>
  );
}

export function Alert({ children, onRetry, tt }) {
  return (
    <div className="pp-alert" role="alert"><Icon name="alert-triangle" size={16} /><span>{children}</span>
      {onRetry && <button type="button" className="pp-btn" onClick={onRetry}>{tt('Retry', 'إعادة المحاولة')}</button>}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, text }) {
  return <div className="pp-empty"><Icon name={icon} size={34} /><strong>{title}</strong>{text && <p>{text}</p>}</div>;
}

/** Splits text into plain parts, #hashtags and links. onTag(tag) is called when a hashtag is clicked. */
export function RichText({ text, onTag }) {
  const parts = String(text || '').split(/(#[\p{L}\p{N}_]{2,50}|https?:\/\/[^\s<]+)/gu);
  return parts.map((p, i) => {
    if (/^#/.test(p)) return <button type="button" key={i} className="pp-tag" onClick={() => onTag?.(p.slice(1))}>{p}</button>;
    if (/^https?:/.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">{p}</a>;
    return p;
  });
}
