import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import BrandWordmark from '../BrandWordmark';
import { isNative } from '../../native.js';

/**
 * Scroll-driven "campus handbook" that sits between the hero and the first feature section.
 * A tall track holds a sticky stage; scrolling through the track OPENS a 3D book: the cover swings open, a leaf turns,
 * and the book settles on the last spread (the sign-up call to action). Everything is scrubbed by the scrollbar and
 * reversible. This component only measures: it eases the scroll position (inertia) and writes five unitless custom
 * properties on the root (--r rise, --o1/--o2 leaf turns, --tl tilt, --zm zoom). book-reveal.css turns them into transforms,
 * so the animation costs one rAF write per frame and nothing else (transform/opacity only).
 * Falls back to a flat, readable layout when animations are off (Admin switch / Android app) or reduced motion is requested.
 */
const clamp = (v) => Math.min(1, Math.max(0, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

function shouldAnimate() {
  if (isNative || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'off') return false;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* ignore */ }
  return true;
}

export default function BookReveal({ t }) {
  const root = useRef(null);
  const [animated] = useState(shouldAnimate);

  useEffect(() => {
    const el = root.current;
    if (!el || !animated) return undefined;
    let target = 0;
    let cur = -1;
    let raf = 0;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const len = Math.max(1, r.height - (window.innerHeight || 800));
      target = clamp(-r.top / len);
    };
    const paint = (p) => {
      const s = el.style;
      s.setProperty('--r', easeOut(seg(p, 0, 0.12)).toFixed(4));
      s.setProperty('--o1', ease(seg(p, 0.1, 0.4)).toFixed(4));
      s.setProperty('--o2', ease(seg(p, 0.42, 0.72)).toFixed(4));
      s.setProperty('--tl', ease(seg(p, 0.05, 0.75)).toFixed(4));
      s.setProperty('--zm', ease(seg(p, 0.72, 1)).toFixed(4));
    };
    const loop = () => {
      raf = 0;
      cur += (target - cur) * 0.16; // inertia: the book trails the wheel a little instead of snapping to it
      if (Math.abs(target - cur) < 0.0006) cur = target;
      paint(cur);
      if (cur !== target) raf = requestAnimationFrame(loop);
    };
    const kick = () => { measure(); if (!raf) raf = requestAnimationFrame(loop); };

    measure();
    cur = target; // opening the page mid-way (reload, #anchor) starts at the right spot, no replay
    paint(cur);
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);
    return () => {
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', kick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [animated]);

  const toc = [
    ['message-square', t('Chat and video meetings', 'شات واجتماعات فيديو'), '01'],
    ['book-open', t('Courses and secure exams', 'مواد وامتحانات آمنة'), '02'],
    ['users', t('A real social community', 'مجتمع اجتماعي حقيقي'), '03'],
    ['sparkles', t('Projects scored by AI', 'مشاريع بتقييم ذكي'), '04'],
  ];

  return (
    <section
      ref={root}
      className={`bk${animated ? '' : ' bk--flat'}`}
      aria-label={t('A quick tour of the platform', 'جولة سريعة في المنصة')}
      style={animated ? { '--r': 0, '--o1': 0, '--o2': 0, '--tl': 0, '--zm': 0 } : undefined}
    >
      <div className="bk__sticky">
        <div className="bk__glow" aria-hidden="true" />
        <header className="bk__head">
          <span className="bk__pill"><Icon name="book-open" size={14} /> {t('A quick tour', 'جولة سريعة')}</span>
          <h2>{t('Turn the page on campus life.', 'اقلب الصفحة على حياتك الجامعية.')}</h2>
          <p>{t('Keep scrolling to open the book.', 'كمّل سكرول وافتح الكتاب.')}</p>
        </header>

        <div className="bk__scene">
          <div className="bk__book">
            <i className="bk__ground" aria-hidden="true" />

            {/* right-hand base: back board + last spread (call to action) */}
            <div className="bk__base">
              <div className="bk__inner bk__page bk__page--cta">
                <span className="bk__kicker">{t('Your turn', 'دورك إنت')}</span>
                <h3>{t('Write the next chapter.', 'اكتب الفصل الجاي.')}</h3>
                <p className="bk__p">{t('Join free with your university email. It takes a minute and needs no card.', 'سجّل مجانًا بإيميل جامعتك. بياخد دقيقة ومن غير كريدت كارد.')}</p>
                <div className="bk__actions">
                  <Link to="/auth/register" className="btn btn-primary btn-lg bk__cta">{t('Create a free account', 'اعمل حساب مجاني')} <Icon name="arrow-right" size={16} /></Link>
                  <Link to="/auth/login" className="bk__link">{t('Log in', 'تسجيل الدخول')}</Link>
                </div>
                <span className="bk__folio">04</span>
              </div>
            </div>

            {/* leaf 2: front = contents (spread 1, right) · back = AI tutor (spread 2, left) */}
            <div className="bk__leaf bk__leaf--2">
              <div className="bk__face bk__face--front">
                <div className="bk__inner bk__page">
                  <span className="bk__kicker">{t('In this book', 'جوه الكتاب')}</span>
                  <h3>{t('Contents', 'المحتويات')}</h3>
                  <ol className="bk__toc">
                    {toc.map(([ic, label, n]) => (
                      <li key={n}><span className="bk__ico"><Icon name={ic} size={16} /></span><b>{label}</b><i aria-hidden="true" /><em>{n}</em></li>
                    ))}
                  </ol>
                  <span className="bk__folio">02</span>
                </div>
                <u className="bk__shade" aria-hidden="true" />
              </div>
              <div className="bk__face bk__face--back">
                <div className="bk__inner bk__page">
                  <span className="bk__kicker">{t('Chapter 02', 'الفصل 02')}</span>
                  <h3>{t('An AI tutor beside you.', 'معلم ذكي جنبك.')}</h3>
                  <div className="bk__chat" aria-hidden="true">
                    <p className="bk__bub bk__bub--me">{t('Quiz me on chapter 3.', 'اختبرني في الفصل التالت.')}</p>
                    <p className="bk__bub"><Icon name="sparkles" size={13} /> {t('Sure. Question 1 of 5: what does a primary key guarantee?', 'تمام. سؤال 1 من 5: إيه اللي بيضمنه المفتاح الأساسي؟')}</p>
                  </div>
                  <p className="bk__p">{t('Explains errors, reviews your code and quizzes you, and your instructor still signs off on every grade.', 'بيشرح الأخطاء ويراجع كودك ويختبرك، والدكتور هو اللي بيعتمد كل درجة.')}</p>
                  <span className="bk__folio">03</span>
                </div>
                <u className="bk__shade" aria-hidden="true" />
              </div>
            </div>

            {/* leaf 1 (cover): front = cover · back = welcome page (spread 1, left) */}
            <div className="bk__leaf bk__leaf--1">
              <div className="bk__face bk__face--front bk__cover">
                <span className="bk__foil" aria-hidden="true" />
                <span className="bk__emblem"><BrandWordmark onDark width={150} height={58} alt="UIPE" /></span>
                <strong className="bk__title">{t('The campus handbook', 'دليل الجامعة')}</strong>
                <span className="bk__sub">{t('Chapter one · Begin', 'الفصل الأول · البداية')}</span>
                <u className="bk__shade" aria-hidden="true" />
              </div>
              <div className="bk__face bk__face--back bk__face--board">
                <div className="bk__inner bk__page">
                  <span className="bk__kicker">{t('Chapter 01', 'الفصل 01')}</span>
                  <h3>{t('One account. Your whole campus.', 'حساب واحد. جامعتك كلها.')}</h3>
                  <p className="bk__p">{t('Chat, meetings, courses, exams, community and projects live together, so you stop switching between ten different tools.', 'الشات والاجتماعات والمواد والامتحانات والمجتمع والمشاريع في مكان واحد، فتبطّل تنقّل بين عشر أدوات.')}</p>
                  <blockquote className="bk__quote">{t('Everything in one place, with an AI tutor beside you.', 'كل حاجة في مكان واحد، ومعاك معلم ذكي جنبك.')}</blockquote>
                  <span className="bk__folio">01</span>
                </div>
                <u className="bk__shade" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
