import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { getChatStyle, setChatStyle } from '../../lib/chatStyle';

/** Picks how chat messages look (works on the website and in the app). */
export default function ChatStyleCard() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, a) => (ar ? a : en);
  const [style, setStyle] = useState(getChatStyle);
  const pick = (s) => { setStyle(s); setChatStyle(s); };
  const opts = [
    { key: 'light', name: t('Light bubbles', 'فقاعات فاتحة'), hint: t('Easier to read, calmer look', 'أوضح في القراءة وأهدى بصرياً') },
    { key: 'soft', name: t('Soft bubbles', 'فقاعات ناعمة'), hint: t('Solid colour, WhatsApp-like', 'لون كامل، قريبة من الواتساب') },
  ];
  const bubble = (k) => (k === 'soft'
    ? { background: 'var(--color-primary)', color: '#fff' }
    : { background: 'rgba(var(--color-primary-rgb), .13)', color: 'var(--text-primary)', borderInlineStart: '3px solid var(--color-primary)' });
  return (
    <section className="card" style={{ padding: 'var(--space-5, 20px)' }}>
      <h3 style={{ margin: '0 0 4px' }}>{t('Message style', 'شكل الرسائل')}</h3>
      <p className="text-small" style={{ margin: '0 0 14px', opacity: 0.75 }}>{t('Applies to your chats on this device.', 'ينطبق على محادثاتك على هذا الجهاز.')}</p>
      <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {opts.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={style === o.key} onClick={() => pick(o.key)}
            style={{ textAlign: 'start', padding: 12, borderRadius: 12, background: 'transparent', color: 'inherit', cursor: 'pointer', border: style === o.key ? '2px solid var(--color-primary)' : '1px solid var(--border-subtle, rgba(0,0,0,.15))' }}>
            <span style={{ display: 'block', padding: '8px 12px', borderRadius: 14, fontSize: 13, marginBottom: 8, ...bubble(o.key) }}>{t('Send me the file', 'ابعتلي الملف')}</span>
            <strong style={{ display: 'block', fontSize: 14 }}>{o.name}</strong>
            <span className="text-small" style={{ opacity: 0.7 }}>{o.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
