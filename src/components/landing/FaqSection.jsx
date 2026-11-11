import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';

/**
 * Landing FAQ: searchable, filterable by topic, one answer open at a time, with a "still unsure?" card.
 * Copy lives here (EN + AR) so it can be edited in one place. Styles: styles/css/landing-faq.css (.lp7-faq).
 */
export default function FaqSection({ t, isAr }) {
  const uid = useId();
  const cats = useMemo(() => [
    { id: 'all', icon: 'grid', label: t('All questions', 'كل الأسئلة') },
    { id: 'start', icon: 'sparkles', label: t('Getting started', 'البداية') },
    { id: 'privacy', icon: 'shield', label: t('Privacy & safety', 'الخصوصية والأمان') },
    { id: 'study', icon: 'graduation-cap', label: t('Study & exams', 'الدراسة والامتحانات') },
  ], [t]);

  const items = useMemo(() => [
    { cat: 'start', q: t('Is UIPE free?', 'هل UIPE مجانية؟'),
      a: t('It is free for students. You do not need a credit card to create an account.', 'نعم، مجانية للطلاب بالكامل، ولا تحتاج إلى بطاقة ائتمان لإنشاء حسابك.') },
    { cat: 'start', q: t('Who can use it?', 'من يمكنه استخدامها؟'),
      a: t('Students, instructors and supervisors, universities and faculties, and data and security teams. Each role gets its own tools under one account.', 'الطلاب وأعضاء هيئة التدريس والمشرفون، والجامعات والكليات، وفرق البيانات والأمن. لكل دور أدواته الخاصة ضمن حساب واحد.') },
    { cat: 'start', q: t('How do I get started?', 'كيف أبدأ؟'),
      a: t('Create an account, pick your role and your university, and you will find classmates, courses and groups already waiting for you. It takes about a minute.', 'أنشئ حسابك، واختر دورك وجامعتك، وستجد زملاءك ومقرراتك ومجموعاتك في انتظارك. يستغرق الأمر دقيقة تقريبًا.'),
      link: ['/auth/register', t('Create a free account', 'أنشئ حسابًا مجانيًا')] },
    { cat: 'start', q: t('Can I use it on my phone?', 'هل أستطيع استخدامها من الهاتف؟'),
      a: t('Yes. It works in any browser, and there is an Android app for calls, chat and notifications.', 'نعم. تعمل على أي متصفح، ويتوفر تطبيق أندرويد للمكالمات والمحادثات والإشعارات.') },
    { cat: 'start', q: t('Is it available in Arabic and English?', 'هل المنصة متاحة بالعربية والإنجليزية؟'),
      a: t('Yes. Switch between the two languages at any time from the top bar, and the layout flips to match.', 'نعم. يمكنك التبديل بين اللغتين في أي وقت من الشريط العلوي، ويتغيّر اتجاه الصفحة تلقائيًا.') },
    { cat: 'privacy', q: t('Who sees my posts, photo and stories?', 'من يرى منشوراتي وصورتي وقصصي؟'),
      a: t('You choose. Each post and story has its own audience, you can lock your profile so only friends and followers see it, and your photo can be opened or downloaded only if you allow it.', 'القرار لك. لكل منشور وقصة جمهوره الخاص، ويمكنك قفل ملفك الشخصي ليراه أصدقاؤك ومتابعوك فقط، ولا يمكن فتح صورتك أو تنزيلها إلا بإذنك.') },
    { cat: 'privacy', q: t('Can I see where my account is signed in?', 'هل أستطيع معرفة الأجهزة المسجّل دخولي منها؟'),
      a: t('Yes. See where you are signed in and sign out any device you do not recognise.', 'نعم. يمكنك رؤية الأماكن التي سجّلت الدخول منها، وإنهاء الجلسة على أي جهاز لا تعرفه.') },
    { cat: 'study', q: t('How do exams stay fair?', 'كيف تُحمى نزاهة الامتحانات؟'),
      a: t('Secure mode logs tab switches, and AI grading only suggests marks. The instructor approves them.', 'يسجّل الوضع الآمن أي تبديل بين علامات التبويب، ويقترح الذكاء الاصطناعي الدرجات فقط، بينما يعتمدها عضو هيئة التدريس.') },
    { cat: 'study', q: t('How can an employer verify my certificate?', 'كيف تتحقق جهة العمل من شهادتي؟'),
      a: t('Open the Verify a Certificate page, enter the number printed on it and see whether it is valid. No sign-in needed.', 'تفتح صفحة «التحقق من شهادة»، وتُدخل الرقم المطبوع على الشهادة، فتعرف فورًا إن كانت صحيحة، دون الحاجة إلى تسجيل الدخول.'),
      link: ['/verify-certificate', t('Verify a certificate', 'التحقق من شهادة')] },
  ], [t]);

  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(0); // index in the filtered list

  const norm = (s) => String(s).toLowerCase();
  const list = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((it) => (cat === 'all' || it.cat === cat) && (!q || norm(it.q).includes(q) || norm(it.a).includes(q)));
  }, [items, cat, query]);
  const count = (id) => (id === 'all' ? items.length : items.filter((i) => i.cat === id).length);
  const catOf = (id) => cats.find((c) => c.id === id);

  const pick = (id) => { setCat(id); setOpen(0); };

  return (
    <section className="lp4-section lp4-shell" id="faq" aria-labelledby={`${uid}-h`}>
      <div className="lp7-faq">
        <header className="lp7-faq__head">
          <span className="lp4-eyebrow">{t('FAQ', 'الأسئلة الشائعة')}</span>
          <h2 id={`${uid}-h`}>{t('Everything you want to know', 'كل ما تودّ معرفته')}</h2>
          <p>{t('Quick answers about accounts, privacy and exams. Can’t find yours? Try the search.', 'إجابات سريعة عن الحسابات والخصوصية والامتحانات. لم تجد سؤالك؟ جرّب البحث.')}</p>
          <label className="lp7-faq__search">
            <Icon name="search" size={18} />
            <input
              type="search" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(0); }}
              placeholder={t('Search questions…', 'ابحث في الأسئلة…')} aria-label={t('Search questions', 'ابحث في الأسئلة')}
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear', 'مسح')}><Icon name="x" size={14} /></button>}
          </label>
        </header>

        <div className="lp7-faq__body">
          <nav className="lp7-faq__cats" aria-label={t('Topics', 'المواضيع')}>
            {cats.map((c) => (
              <button key={c.id} type="button" className={cat === c.id ? 'is-on' : ''} aria-pressed={cat === c.id} onClick={() => pick(c.id)}>
                <Icon name={c.icon} size={16} />
                <span>{c.label}</span>
                <em>{count(c.id)}</em>
              </button>
            ))}
          </nav>

          <div className="lp7-faq__list" aria-live="polite">
            {list.length === 0 && (
              <div className="lp7-faq__empty">
                <Icon name="search" size={22} />
                <strong>{t('No matching questions', 'لا توجد أسئلة مطابقة')}</strong>
                <span>{t('Try a different word, or create an account and ask us directly.', 'جرّب كلمة مختلفة، أو أنشئ حسابك وراسلنا مباشرة.')}</span>
              </div>
            )}
            {list.map((it, i) => {
              const isOpen = open === i;
              const c = catOf(it.cat);
              return (
                <article key={it.q} className={`lp7-faq__item${isOpen ? ' is-open' : ''}`}>
                  <h3>
                    <button type="button" id={`${uid}-q${i}`} aria-expanded={isOpen} aria-controls={`${uid}-a${i}`} onClick={() => setOpen(isOpen ? -1 : i)}>
                      <span className="lp7-faq__ico"><Icon name={c.icon} size={18} /></span>
                      <span className="lp7-faq__q">{it.q}</span>
                      <span className="lp7-faq__chev"><Icon name="chevron-down" size={18} /></span>
                    </button>
                  </h3>
                  <div className="lp7-faq__a" id={`${uid}-a${i}`} role="region" aria-labelledby={`${uid}-q${i}`}>
                    <div>
                      <p>{it.a}</p>
                      {it.link && (
                        <Link to={it.link[0]} className="lp7-faq__link">{it.link[1]} <Icon name={isAr ? 'arrow-left' : 'arrow-right'} size={15} /></Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="lp7-faq__cta">
          <span className="lp7-faq__cta-ico"><Icon name="message-square" size={22} /></span>
          <div>
            <strong>{t('Still have questions?', 'ما زال لديك سؤال؟')}</strong>
            <span>{t('Create a free account and explore everything yourself. It takes a minute.', 'أنشئ حسابًا مجانيًا واستكشف كل شيء بنفسك، فالأمر لا يستغرق سوى دقيقة.')}</span>
          </div>
          <div className="lp7-faq__cta-btns">
            <Link to="/auth/register" className="btn btn-lg">{t('Create a free account', 'أنشئ حسابًا مجانيًا')}</Link>
            <Link to="/auth/login" className="lp7-faq__ghost">{t('Log in', 'تسجيل الدخول')}</Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
