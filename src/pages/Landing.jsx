import { useEffect, useState } from 'react';
import usePanelStack from '../hooks/usePanelStack';
import FaqSection from '../components/landing/FaqSection';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Icon from '../components/Icon';
import ReadinessRing from '../components/ReadinessRing';
import ProjectCard from '../components/ProjectCard';
import SiteFooter from '../components/SiteFooter';
import CountUp from '../components/CountUp';
import LandingNav from '../components/LandingNav';
import useAppDownload from '../hooks/useAppDownload';
import AppDownloadLink from '../components/AppDownloadLink';
import BrandWordmark from '../components/BrandWordmark';
import { roleHome } from '../config/roleHome';

/**
 * Landing page (.lp4, see styles/css/landing-v4.css; palette tokens from .lp2 in landing.css).
 * Hero with a composed product scene + live numbers, a bento grid of mini UIs (chat, meetings, My PC, AI, exams), the project
 * publishing steps, role tabs and the app download band. Live numbers come from GET /api/v1/public/landing and are never hard-coded.
 * An already-authenticated visitor is sent to their dashboard via roleHome().
 */

export default function Landing() {
  const { status, user } = useAuth();
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);
  const app = useAppDownload();

  const [featured, setFeatured] = useState([]);
  const [liveStats, setLiveStats] = useState(null);
  const [role, setRole] = useState('students');
  usePanelStack('.pnl');

  useEffect(() => {
    let alive = true;
    api.get('/api/v1/public/landing')
      .then((json) => {
        if (!alive) return;
        setFeatured(json.data?.featured || []);
        setLiveStats(json.data?.stats || null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (status === 'authenticated') {
    return <Navigate to={roleHome(user?.role)} replace />;
  }

  const stats = [
    ['users', liveStats?.active_students, t('active students', 'طالب نشط')],
    ['building', liveStats?.partner_universities, t('partner universities', 'جامعة شريكة')],
    ['layers', liveStats?.published_projects, t('published projects', 'مشروع منشور')],
    ['sparkles', liveStats?.projects_scored, t('projects scored by AI', 'مشروع اتقيّم بالذكاء الاصطناعي')],
  ];

  const steps = [
    ['upload', t('Upload', 'ارفع'), t('Describe your idea and attach files or your GitHub repo.', 'اكتب فكرتك وأضف ملفاتك أو رابط GitHub.')],
    ['sparkles', t('Get scored', 'خد تقييمك'), t('AI rates feasibility, market fit, documentation and innovation.', 'الذكاء الاصطناعي يقيّم الجدوى والسوق والتوثيق والابتكار.')],
    ['check-circle', t('Get approved', 'اتعتمد'), t('Your university reviews it before it goes public.', 'جامعتك تراجعه قبل ما يتنشر.')],
    ['globe', t('Get discovered', 'اتكتشف'), t('Published projects are open to universities and companies.', 'المشاريع المنشورة بتظهر للجامعات والشركات.')],
  ];

  const audiences = [
    ['students', t('Students', 'الطلاب'), [
      t('Courses, timetable, attendance and grades', 'المواد والجدول والحضور والدرجات'),
      t('Assignments and exams in one place', 'التكاليف والامتحانات في مكان واحد'),
      t('Portfolio, patents and GitHub link', 'بورتفوليو وبراءات اختراع وربط GitHub'),
      t('Graduation certificate with public verification', 'شهادة تخرج بتتحقق منها أي جهة'),
    ]],
    ['staff', t('Instructors', 'الدكاترة والمشرفون'), [
      t('Question banks and exam builder', 'بنوك أسئلة ومنشئ امتحانات'),
      t('AI-assisted grading you review', 'تصحيح بمساعدة الذكاء الاصطناعي وبمراجعتك'),
      t('Course content, attendance, timetable', 'محتوى المواد والحضور والجدول'),
      t('Project grading and similarity checks', 'تقييم المشاريع وفحص التشابه'),
    ]],
    ['uni', t('Universities', 'الجامعات والكليات'), [
      t('Approve student projects and graduation', 'اعتماد المشاريع والتخرج'),
      t('Registration, fees, summer terms', 'التسجيل والرسوم والفصل الصيفي'),
      t('University email and announcements', 'البريد الجامعي والإعلانات'),
      t('Chat oversight and reports', 'متابعة الشات والبلاغات'),
    ]],
    ['data', t('Data and security', 'فرق البيانات والأمن'), [
      t('Dashboards, KPIs, forecasting, data quality', 'لوحات ومؤشرات وتنبؤ وجودة بيانات'),
      t('Exam analytics and AI insights', 'تحليلات الامتحانات ورؤى الذكاء الاصطناعي'),
      t('Incidents, alerts and security logs', 'الحوادث والتنبيهات وسجلات الأمان'),
      t('Sessions and device control', 'التحكم في الجلسات والأجهزة'),
    ]],
  ];
  const community = [
    ['image', t('Stories that disappear', 'قصص بتختفي'), t('Share a photo, video or text. You choose who sees it, and you see who watched.', 'شارك صورة أو فيديو أو نص. إنت اللي بتختار مين يشوفها وبتعرف مين شافها.')],
    ['file', t('Posts with real files', 'منشورات بملفات حقيقية'), t('PDFs swipe like slides, code runs right in the post, plus video, voice and any file.', 'الـ PDF بتتقلّب زي الشرائح، والكود بيشتغل جوه المنشور، وفيديو وصوت وأي ملف.')],
    ['user', t('A real profile', 'بروفايل حقيقي'), t('Cover, photo, bio, friends and photos. Lock your profile so only friends and followers see it, and decide who can open or download your photo.', 'غلاف وصورة وبايو وأصدقاء وصور. اقفل بروفايلك ليشوفه أصدقاؤك ومتابعوك بس، وحدّد مين يفتح صورتك أو ينزّلها.')],
    ['users', t('Your network', 'شبكتك'), t('Connect with classmates and instructors, follow people, and see what your university shares.', 'اتصل بزمايلك ودكاترتك وتابع الناس وشوف اللي جامعتك بتنشره.')],
  ];

  const trust = [
    ['lock', t('Secure exam mode', 'وضع امتحان آمن'), t('Tab switches are logged and the instructor reviews every AI grading suggestion.', 'تبديل التابات بيتسجل والدكتور بيراجع كل اقتراح تصحيح من الذكاء الاصطناعي.')],
    ['shield', t('Two-step sign-in', 'دخول بخطوتين'), t('Protect your account with a second factor, with recovery if you lose access.', 'احمِ حسابك بعامل تحقق تاني، مع استعادة الحساب لو فقدت الوصول.')],
    ['monitor', t('Sessions and devices', 'الجلسات والأجهزة'), t('See where you are signed in and sign out devices you do not recognise.', 'شوف إنت داخل منين وسجّل خروج من أي جهاز مش معروف.')],
    ['eye-off', t('Privacy you control', 'خصوصية في إيدك'), t('Lock your profile, protect your photo from saving, hide your friends list, and decide who sees your bio, last seen and stories or can message you.', 'اقفل بروفايلك، واحمِ صورتك من الحفظ، وأخفِ قائمة أصدقائك، واختار مين يشوف البايو وآخر ظهور والقصص ومين يراسلك.')],
    ['award', t('Verifiable certificates', 'شهادات تتحقق منها'), t('Anyone can check a graduation certificate by its number, with no sign-in.', 'أي جهة تقدر تتحقق من شهادة التخرج برقمها من غير تسجيل دخول.')],
    ['history', t('Audit trail', 'سجل مراجعة'), t('Important actions are logged so universities can follow up reports and incidents.', 'الإجراءات المهمة بتتسجل عشان الجامعات تتابع البلاغات والحوادث.')],
  ];

  const start = [
    ['user-plus', t('Create your account', 'اعمل حسابك'), t('Pick your role and your university. It takes a minute.', 'اختار دورك وجامعتك. بياخد دقيقة.')],
    ['users', t('Join your campus', 'ادخل جامعتك'), t('Find classmates, courses and groups already waiting for you.', 'هتلاقي زمايلك ومواد وجروبات مستنياك.')],
    ['sparkles', t('Start working', 'ابدأ الشغل'), t('Chat, meet, study, take exams and publish your project from one place.', 'اتكلم واجتمع وذاكر وامتحن وانشر مشروعك من مكان واحد.')],
  ];

  const activeRole = audiences.find(([k]) => k === role) || audiences[0];

  const signals = [
    [t('Feasibility', 'الجدوى'), 90],
    [t('Market fit', 'ملاءمة السوق'), 84],
    [t('Documentation', 'التوثيق'), 78],
    [t('Innovation', 'الابتكار'), 92],
  ];

  const chips = (arr) => (
    <ul className="lp4-chips">{arr.map(([ic, label]) => <li key={label}><Icon name={ic} size={14} />{label}</li>)}</ul>
  );

  return (
    <div className="lp2 lp4">
      <LandingNav anchors />

      {/* ============================ HERO ============================ */}
      <div className="pnl">
      <header className="lp4-hero">
        <div className="lp4-glow" aria-hidden="true" />
        <div className="lp4-shell lp4-hero__grid">
          <div className="lp4-hero__copy">
            <span className="lp4-pill"><span className="lp4-dot" /> {t('The all-in-one campus platform', 'منصة الجامعة المتكاملة')}</span>
            <h1>
              {t('Your whole university, ', 'جامعتك كلها، ')}
              <span className="lp4-grad">{t('in one place.', 'في مكان واحد.')}</span>
            </h1>
            <p className="lp4-lead">
              {t(
                'Chat, video meetings, courses, exams, a social community, projects and a cloud PC, with an AI tutor beside you. Stop switching between ten different tools.',
                'شات واجتماعات فيديو ومواد وامتحانات ومجتمع اجتماعي ومشاريع وجهاز سحابي، ومعاك معلم ذكي جنبك. كفاية تنقّل بين عشر أدوات مختلفة.',
              )}
            </p>
            <div className="lp4-cta">
              <Link to="/auth/register" className="btn btn-primary btn-lg">{t('Create a free account', 'اعمل حساب مجاني')} <Icon name="arrow-right" size={16} /></Link>
              <Link to="/auth/login" className="btn btn-outline btn-lg">{t('Log in', 'تسجيل الدخول')}</Link>
              {app && <AppDownloadLink app={app} className="btn btn-outline btn-lg" iconSize={18} logo />}
            </div>
            <p className="lp4-note"><Icon name="check" size={16} /> {t('Free for students. No credit card.', 'مجاني للطلاب. من غير كريدت كارد.')}</p>
          </div>

          {/* product composition */}
          <div className="lp4-stage" aria-hidden="true">
            <div className="lp4-win lp4-win--main">
              <div className="lp4-win__bar"><i /><i /><i /><b>{t('Graduation project team', 'فريق مشروع التخرج')}</b><em>{t('4 online', '4 أونلاين')}</em></div>
              <div className="lp4-chat">
                <div className="lp4-msg"><span className="lp4-av lp4-av--a">S</span><p>{t('Uploaded the final report. Can you review chapter 3?', 'رفعت التقرير النهائي. تراجع الفصل التالت؟')}</p></div>
                <div className="lp4-msg"><span className="lp4-av lp4-av--b">O</span><p>{t('On it. The AI flagged two weak points in the market section.', 'تمام. الذكاء الاصطناعي لقى نقطتين ضعف في قسم السوق.')}</p></div>
                <div className="lp4-msg lp4-msg--me"><p>{t('Joining the meeting now 🎥', 'داخل الاجتماع دلوقتي 🎥')}</p></div>
                <div className="lp4-poll">
                  <strong>{t('Poll: meeting time', 'استطلاع: ميعاد الاجتماع')}</strong>
                  <div><span style={{ width: '72%' }} />{t('Sat 6 PM', 'السبت 6 م')}<b>72%</b></div>
                  <div><span style={{ width: '28%' }} />{t('Sun 4 PM', 'الأحد 4 م')}<b>28%</b></div>
                </div>
              </div>
            </div>

            <div className="lp4-float lp4-float--score">
              <div className="lp4-float__title">{t('AI Readiness', 'جاهزية المشروع')} <span>{t('Sample', 'مثال')}</span></div>
              <div className="lp4-float__score">
                <ReadinessRing score={87} size={96} caption="" />
                <div className="lp4-signals">
                  {signals.map(([label, v]) => (
                    <div key={label}><div><span>{label}</span><strong>{v}</strong></div><i><b style={{ width: `${v}%` }} /></i></div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lp4-float lp4-float--exam">
              <span className="lp4-icon lp4-icon--amber"><Icon name="lock" size={16} /></span>
              <div><strong>{t('Exam in progress', 'امتحان شغال')}</strong><small>{t('Secure mode · 42:10 left', 'الوضع الآمن · باقي 42:10')}</small></div>
            </div>

            <div className="lp4-float lp4-float--call">
              <div className="lp4-faces"><span className="lp4-av lp4-av--a">S</span><span className="lp4-av lp4-av--b">O</span><span className="lp4-av lp4-av--c">M</span><span className="lp4-av lp4-av--d">+3</span></div>
              <small><Icon name="meeting-type" size={13} /> {t('Live meeting', 'اجتماع مباشر')}</small>
            </div>
          </div>
        </div>

        <div className="lp4-shell">
          <ul className="lp4-stats">
            {stats.map(([ic, num, label]) => (
              <li key={label}>
                <span className="lp4-stats__ico"><Icon name={ic} size={20} /></span>
                <div>
                  <strong>{num == null ? '—' : <CountUp value={num} locale="en" />}</strong>
                  <span>{label}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </header>
      </div>

      <main>
        {/* ============================ FEATURES (bento) ============================ */}
        <div className="pnl">
        <section className="lp4-section lp4-shell" id="talk">
          <div className="lp4-head">
            <span className="lp4-eyebrow">{t('What you get', 'اللي هتلاقيه')}</span>
            <h2>{t('Everything a campus runs on, already connected', 'كل اللي الجامعة بتشتغل بيه، متوصّل ببعضه')}</h2>
            <p>{t('One account, one login, one place for your files, classes, exams and conversations.', 'حساب واحد وتسجيل دخول واحد ومكان واحد لملفاتك ومحاضراتك وامتحاناتك ومحادثاتك.')}</p>
          </div>

          <div className="lp4-bento">
            {/* chat + calls */}
            <article className="lp4-tile lp4-tile--chat">
              <div className="lp4-tile__text">
                <span className="lp4-icon"><Icon name="chat" size={18} /></span>
                <h3>{t('Chat and calls', 'شات ومكالمات')}</h3>
                <p>{t('Direct and group chat with voice notes, polls, location, stories and pinned messages. Voice and video calls for one person or a whole group.', 'شات فردي وجماعي مع رسائل صوتية واستطلاعات ولوكيشن وقصص ورسائل مثبّتة. ومكالمات صوت وفيديو لشخص أو لمجموعة كاملة.')}</p>
              </div>
              <div className="lp4-mini lp4-mini--bubbles" aria-hidden="true">
                <span className="lp4-bub">{t('Lecture moved to 10 AM', 'المحاضرة اتنقلت 10 الصبح')}</span>
                <span className="lp4-bub lp4-bub--me">{t('Thanks! 👍', 'شكرًا! 👍')}</span>
                <span className="lp4-bub">{t('Who has the lab notes?', 'مين معاه ملخص المعمل؟')}</span>
                <span className="lp4-bub lp4-bub--me">{t('Check the shared folder', 'شوف الفولدر المشترك')}</span>
                <span className="lp4-bub lp4-bub--voice"><Icon name="audio-wave" size={16} /> 0:24</span>
              </div>
            </article>

            {/* meetings */}
            <article className="lp4-tile lp4-tile--meet" id="meetings">
              <div className="lp4-tile__text">
                <span className="lp4-icon"><Icon name="meeting-type" size={18} /></span>
                <h3>{t('Video meetings', 'اجتماعات فيديو')}</h3>
                <p>{t('Join from a link with a waiting room, screen sharing, raised hands and recording. Every participant lands in the attendance report with join time, leave time and duration.', 'ادخل من رابط مع غرفة انتظار ومشاركة شاشة ورفع إيد وتسجيل. وكل مشارك بيتحفظ في تقرير الحضور بوقت الدخول والخروج والمدة.')}</p>
              </div>
              <div className="lp4-mini lp4-mini--grid" aria-hidden="true">
                <span className="lp4-tilev lp4-tilev--a">S</span><span className="lp4-tilev lp4-tilev--b">O</span>
                <span className="lp4-tilev lp4-tilev--c">M</span><span className="lp4-tilev lp4-tilev--d"><Icon name="screen-share" size={18} /></span>
              </div>
            </article>

            {/* My PC */}
            <article className="lp4-tile lp4-tile--pc" id="pc">
              <div className="lp4-tile__text">
                <span className="lp4-icon"><Icon name="hard-drive" size={18} /></span>
                <h3>{t('My PC, in your browser', 'My PC جوه متصفحك')}</h3>
                <p>{t('Files with share links and version history, a code editor with a terminal, Word, Excel, PowerPoint and PDF editing. It follows you to any phone or laptop.', 'ملفات مع روابط مشاركة وسجل نسخ، ومحرر أكواد مع ترمينال، وتعديل Word وExcel وPowerPoint وPDF. وبيمشي معاك على أي موبايل أو لابتوب.')}</p>
              </div>
              <ul className="lp4-files" aria-hidden="true">
                <li><Icon name="folder" size={16} /> {t('Graduation project', 'مشروع التخرج')}<small>12 {t('files', 'ملف')}</small></li>
                <li><Icon name="file" size={16} /> report-final.docx<small>v4</small></li>
                <li><Icon name="terminal" size={16} /> main.py<small>{t('edited now', 'اتعدّل دلوقتي')}</small></li>
              </ul>
            </article>

            {/* AI */}
            <article className="lp4-tile lp4-tile--ai" id="ai">
              <div className="lp4-tile__text">
                <span className="lp4-icon"><Icon name="ai-spark" size={18} /></span>
                <h3>{t('AI beside you, not instead of you', 'ذكاء اصطناعي جنبك، مش بدالك')}</h3>
                <p>{t('An AI tutor inside the code editor explains errors and reviews your code. It points to the problem and you fix it.', 'معلم ذكي جوه محرر الأكواد بيشرح الأخطاء وبيراجع كودك. بيشاور على المشكلة وإنت اللي بتحلها.')}</p>
              </div>
              <div className="lp4-code" aria-hidden="true">
                <code><i>1</i> total = sum(grades) / len(grade)</code>
                <div className="lp4-code__tip"><Icon name="sparkles" size={14} /> {t('`grade` is not defined. Did you mean `grades`?', 'المتغير `grade` مش معرّف. قصدك `grades`؟')}</div>
              </div>
            </article>

            {/* Exams */}
            <article className="lp4-tile lp4-tile--exam" id="exams">
              <div className="lp4-tile__text">
                <span className="lp4-icon"><Icon name="layers" size={18} /></span>
                <h3>{t('Exams that run themselves', 'امتحانات بتمشي لوحدها')}</h3>
                <p>{t('Reusable question banks, targeting by faculty, year or group, a secure mode that logs tab switches, and AI grading suggestions the instructor approves.', 'بنوك أسئلة قابلة لإعادة الاستخدام، وتوجيه لكلية أو سنة أو مجموعة، ووضع آمن بيسجل تبديل التابات، واقتراحات تصحيح بالذكاء الاصطناعي يعتمدها الدكتور.')}</p>
              </div>
              <div className="lp4-quiz" aria-hidden="true">
                <strong>{t('Q3 · Which structure uses LIFO?', 'س3 · أي بنية بيانات بتستخدم LIFO؟')}</strong>
                <span><i />{t('Queue', 'Queue')}</span>
                <span className="is-on"><i />{t('Stack', 'Stack')}</span>
                <span><i />{t('Heap', 'Heap')}</span>
              </div>
            </article>
          </div>
        </section>
</div>


        {/* ============================ COMMUNITY ============================ */}
        <div className="pnl">
        <section className="lp4-section lp4-shell" id="community">
          <div className="lp4-head">
            <span className="lp4-eyebrow">{t('Community', 'المجتمع')}</span>
            <h2>{t('A campus network that feels alive', 'شبكة جامعية حيّة')}</h2>
            <p>{t('Stories, posts and profiles, built for students and instructors instead of strangers.', 'قصص ومنشورات وملفات شخصية، متصممة للطلاب والدكاترة مش للغرباء.')}</p>
          </div>
          <div className="lp5-comm">
            <div className="lp5-feed" aria-hidden="true">
              <div className="lp5-stories">
                {['A', 'S', 'O', 'M', 'N'].map((c, i) => <span key={c} className={`lp5-story${i === 0 ? ' is-me' : ''}`}><b>{c}</b></span>)}
              </div>
              <div className="lp5-post">
                <div className="lp5-post__head"><span className="lp4-av lp4-av--a">{t('H', 'هـ')}</span><div><strong>{t('Haitham · Student', 'هيثم · طالب')}</strong><small>{t('2h · Everyone', 'منذ ساعتين · الجميع')}</small></div></div>
                <p>{t('Slides for my machine learning project are ready. Feedback welcome!', 'شرائح مشروع تعلّم الآلة جاهزة. محتاجة رأيكم!')}</p>
                <div className="lp5-slide"><strong>{t('Handling missing data', 'التعامل مع البيانات الناقصة')}</strong><span /><span /><span className="is-short" /><em>2 / 12</em></div>
                <div className="lp5-react"><span>👍 ❤️ 💡 <b>42</b></span><small>{t('9 comments', '9 تعليقات')}</small></div>
              </div>
            </div>
            <ul className="lp5-list">
              {community.map(([ic, title, desc]) => (
                <li key={title}><span className="lp4-icon"><Icon name={ic} size={18} /></span><div><h3>{title}</h3><p>{desc}</p></div></li>
              ))}
            </ul>
          </div>
        </section>
</div>

        {/* ============================ PROJECTS ============================ */}
        <div className="pnl">
        <section className="lp4-section lp4-shell" id="projects">
          <div className="lp4-head">
            <span className="lp4-eyebrow">{t('Projects', 'المشاريع')}</span>
            <h2>{t('Publish your projects and get found', 'انشر مشاريعك واتكتشف')}</h2>
          </div>
          <ol className="lp4-steps">
            {steps.map(([ic, title, desc], i) => (
              <li key={title}>
                <span className="lp4-step__ico"><Icon name={ic} size={20} /></span>
                <span className="lp4-step__n">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{desc}</p>
              </li>
            ))}
          </ol>

          {featured.length > 0 && (
            <>
              <div className="lp4-row">
                <h3>{t('Published on UIPE', 'اتنشر على UIPE')}</h3>
                <Link to="/projects" className="btn btn-outline">{t('Explore all projects', 'استكشف كل المشاريع')} <Icon name="arrow-right" size={16} /></Link>
              </div>
              <div className="public-projects-grid">
                {featured.map((p, i) => (
                  <ProjectCard key={p.uuid || p.slug || i} project={p} locale={locale} index={i} showUniversity />
                ))}
              </div>
            </>
          )}
        </section>
</div>

        {/* ============================ ROLES ============================ */}
        <div className="pnl">
        <section className="lp4-section lp4-shell" id="roles">
          <div className="lp4-head">
            <span className="lp4-eyebrow">{t('Roles', 'الأدوار')}</span>
            <h2>{t('One account, the right tools for your role', 'حساب واحد، والأدوات المناسبة لدورك')}</h2>
          </div>
          <div className="lp4-roles">
            <div className="lp4-tabs" role="tablist">
              {audiences.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={k === activeRole[0]} className={k === activeRole[0] ? 'is-on' : ''} onClick={() => setRole(k)}>{label}</button>
              ))}
            </div>
            <ul className="lp4-roles__list" role="tabpanel">
              {activeRole[2].map((x) => <li key={x}><span><Icon name="check" size={14} /></span>{x}</li>)}
            </ul>
          </div>
        </section>
</div>


        {/* ============================ TRUST ============================ */}
        <div className="pnl">
        <section className="lp4-section lp4-shell" id="security">
          <div className="lp4-head">
            <span className="lp4-eyebrow">{t('Trust', 'الأمان')}</span>
            <h2>{t('Built so universities can rely on it', 'متبنية عشان الجامعات تعتمد عليها')}</h2>
          </div>
          <div className="lp5-trust">
            {trust.map(([ic, title, desc]) => (
              <article key={title}><span className="lp4-icon"><Icon name={ic} size={18} /></span><h3>{title}</h3><p>{desc}</p></article>
            ))}
          </div>
        </section>
</div>

        {/* ============================ GET STARTED ============================ */}
        <div className="pnl">
        <section className="lp4-section lp4-shell" id="start">
          <div className="lp4-head">
            <span className="lp4-eyebrow">{t('Get started', 'ابدأ')}</span>
            <h2>{t('Up and running in three steps', 'شغّال في ثلاث خطوات')}</h2>
          </div>
          <ol className="lp4-steps lp5-start">
            {start.map(([ic, title, desc], i) => (
              <li key={title}>
                <span className="lp4-step__ico"><Icon name={ic} size={20} /></span>
                <span className="lp4-step__n">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{desc}</p>
              </li>
            ))}
          </ol>
        </section>
</div>

        {/* ============================ FAQ ============================ */}
        <div className="pnl"><FaqSection t={t} isAr={isAr} /></div>

        {app && (
          <div className="pnl">
          <section className="lp4-section lp4-shell" id="app">
            <div className="lp4-app">
              <div className="lp4-app__info">
                <span className="lp4-app__logo"><BrandWordmark width={104} height={40} /></span>
                <div>
                  <h2>{app.native ? t('Enjoying UIPE? Share the app with your friends', 'عجبتك UIPE؟ شارك التطبيق مع أصحابك') : t('Take UIPE with you', 'خد UIPE معاك')}</h2>
                  <p>{app.native ? t('Send the download link on WhatsApp, Telegram or anywhere you like.', 'ابعت رابط التحميل على واتساب أو تيليجرام أو أي مكان.') : t('Calls, chat and notifications work best in the Android app.', 'المكالمات والشات والإشعارات بتشتغل أحسن في تطبيق الأندرويد.')}</p>
                </div>
              </div>
              {app.native ? (
                <AppDownloadLink app={app} className="btn btn-primary btn-lg" iconSize={18} logo />
              ) : (
                <a href={app.url} className="btn btn-primary btn-lg app-dl" target="_blank" rel="noopener noreferrer">
                  <Icon name="download" size={18} /> {t('Download for Android', 'تحميل للأندرويد')}
                </a>
              )}
            </div>
            {!app.native && <p className="lp2-app__note">{t('If Android asks, allow installing from this source. The file is an .apk.', 'لو أندرويد سألك، اسمح بالتثبيت من المصدر ده. الملف .apk.')}</p>}
          </section>
</div>
        )}

        <div className="pnl">
<div className="lp4-shell lp4-final-wrap">
          <div className="lp4-final">
            <h2>{t('Open your campus. It takes a minute.', 'افتح جامعتك. بياخد دقيقة.')}</h2>
            <p>{t('Free for students. No credit card.', 'مجاني للطلاب. من غير كريدت كارد.')}</p>
            <Link to="/auth/register" className="btn btn-lg">{t('Create a free account', 'اعمل حساب مجاني')}</Link>
          </div>
        </div>
        </div>
      </main>

      <div className="pnl pnl--free"><SiteFooter /></div>
    </div>
  );
}
