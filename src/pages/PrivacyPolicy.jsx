import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Icon from '../components/Icon';
import SiteFooter from '../components/SiteFooter';
import LandingNav from '../components/LandingNav';
import LandingBackdrop from '../components/LandingBackdrop';
import usePaperUnfold from '../hooks/usePaperUnfold';
import { lockScroll } from '../lib/scrollLock';

const CONTACT_EMAIL = 'haythemmohamed478@gmail.com';
const LINKEDIN_URL = 'https://www.linkedin.com/in/haithem-mohamed-8b7143243/';

// [value, icon, [en, ar], mail-subject prefix]
const CONTACT_TYPES = [
  ['complaint', 'alert-triangle', ['Complaint', 'شكوى']],
  ['suggestion', 'sparkles', ['Suggestion', 'اقتراح']],
  ['privacy', 'lock', ['Privacy request', 'طلب خصوصية']],
  ['bug', 'wrench', ['Report a problem', 'الإبلاغ عن مشكلة']],
  ['question', 'info', ['Question', 'استفسار']],
  ['other', 'mail', ['Other', 'أخرى']],
];

const SECTIONS = [
  { id: 's1', label: ['Introduction', 'مقدمة'] },
  { id: 's2', label: ['Information We Collect', 'المعلومات التي نجمعها'] },
  { id: 's3', label: ['How We Use Information', 'كيف نستخدم المعلومات'] },
  { id: 's4', label: ['Project & Portfolio Visibility', 'ظهور المشاريع والملف العام'] },
  { id: 's5', label: ['Data Sharing', 'مشاركة البيانات'] },
  { id: 's6', label: ['Data Security', 'أمان البيانات'] },
  { id: 's7', label: ['Data Retention', 'الاحتفاظ بالبيانات'] },
  { id: 's8', label: ['Your Rights', 'حقوقك'] },
  { id: 's9', label: ['Cookies & Local Storage', 'ملفات تعريف الارتباط والتخزين المحلي'] },
  { id: 's10', label: ['Third-Party Links', 'روابط خارجية'] },
  { id: 's11', label: ["Minors' Privacy", 'خصوصية القُصَّر'] },
  { id: 's12', label: ['Policy Updates', 'تحديثات السياسة'] },
  { id: 's13', label: ['Contact Us', 'تواصل معنا'] },
];

/**
 * Port of app/Views/public/privacy-policy.php — same 13 sections, same
 * sticky table-of-contents with scroll-spy + back-to-top button, same
 * copy in both languages. supportEmail / updatedDisplay come from
 * GET /api/v1/public/site-info (config('app.support_email') /
 * config('app.privacy_policy_updated_at') server-side) instead of being
 * hardcoded, same as the PHP page reading config() directly.
 */
export default function PrivacyPolicy() {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  const [siteInfo, setSiteInfo] = useState({ support_email: '', privacy_policy_updated_at: '' });
  const [activeId, setActiveId] = useState('s1');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [pillVisible, setPillVisible] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100: how far through the policy the reader is
  const [tocOpen, setTocOpen] = useState(false); // mobile contents sheet
  const pendingRef = useRef(null);
  const sheetRef = useRef(null);
  const [form, setForm] = useState({ type: 'complaint', name: '', email: '', message: '' });
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/api/v1/public/site-info')
      .then((json) => { if (alive) setSiteInfo(json.data || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const sections = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    let raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        let current = sections[0];
        sections.forEach((s) => { if (s.getBoundingClientRect().top <= 140) current = s; });
        if (current) setActiveId(current.id);
        setShowBackToTop(window.scrollY > 480);
        setPillVisible(window.scrollY > 220);
        const doc = document.querySelector('.lp2-pv__doc');
        if (doc) {
          const top = doc.getBoundingClientRect().top + window.scrollY;
          const span = Math.max(1, doc.offsetHeight - window.innerHeight * 0.6);
          setProgress(Math.min(100, Math.max(0, ((window.scrollY + 120 - top) / span) * 100)));
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const goTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { window.history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
    setActiveId(id);
  }, []);

  // Mobile contents sheet: freeze the page behind it, Esc closes, active item is centred, then jump after it has closed.
  useEffect(() => {
    if (!tocOpen) {
      if (pendingRef.current) { const id = pendingRef.current; pendingRef.current = null; requestAnimationFrame(() => goTo(id)); }
      return undefined;
    }
    const unlock = lockScroll();
    const onKey = (e) => { if (e.key === 'Escape') setTocOpen(false); };
    document.addEventListener('keydown', onKey);
    const raf = requestAnimationFrame(() => {
      sheetRef.current?.querySelector('a.is-active')?.scrollIntoView({ block: 'center' });
    });
    return () => { unlock(); document.removeEventListener('keydown', onKey); cancelAnimationFrame(raf); };
  }, [tocOpen, goTo]);

  const activeIndex = Math.max(0, SECTIONS.findIndex((s) => s.id === activeId));
  const pickSection = (e, id, fromSheet) => {
    e.preventDefault();
    if (fromSheet) { pendingRef.current = id; setTocOpen(false); } else goTo(id);
  };
  const tocLinks = (fromSheet) => SECTIONS.map((s, i) => (
    <a key={s.id} href={`#${s.id}`} className={activeId === s.id ? 'is-active' : ''}
      aria-current={activeId === s.id ? 'true' : undefined} onClick={(e) => pickSection(e, s.id, fromSheet)}>
      <span>{i + 1}</span>{t(s.label[0], s.label[1])}
    </a>
  ));

  const supportEmail = siteInfo.support_email || CONTACT_EMAIL;
  const setField = (k, v) => { setSent(false); setForm((f) => ({ ...f, [k]: v })); };
  const typeLabel = (v) => { const ty = CONTACT_TYPES.find((c) => c[0] === v); return ty ? t(ty[2][0], ty[2][1]) : v; };
  const submitContact = (e) => {
    e.preventDefault();
    const label = CONTACT_TYPES.find((c) => c[0] === form.type)?.[2][0] || form.type;
    const subject = `[UIPE] ${label}${form.name ? ` — ${form.name}` : ''}`;
    const body = `Type: ${label}\nName: ${form.name}\nReply-to: ${form.email}\n\n${form.message}`;
    window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };
  const copyEmail = () => {
    navigator.clipboard?.writeText(supportEmail).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  };
  const updatedRaw = siteInfo.privacy_policy_updated_at || '';
  let updatedDisplay = updatedRaw;
  if (updatedRaw) {
    const d = new Date(updatedRaw);
    if (!Number.isNaN(d.getTime())) {
      updatedDisplay = isAr
        ? d.toISOString().slice(0, 10)
        : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }

  usePaperUnfold('.lp2-pv__sec');

  return (
    <div className="lp2 lp2-page lp2--fx">
      <LandingNav />

      <header className="lp2-ex-hero">
        <LandingBackdrop compact />
        <div className="lp2-shell">
          <div className="lp2-ex-hero__text animate-rise-in" style={{ marginBottom: 0 }}>
            <span className="lp2-icon lp2-icon--lg"><Icon name="lock" size={24} /></span>
            <h1>{t('Privacy Policy', 'سياسة الخصوصية')}</h1>
            <p>
              {t(
                'This page explains what information the Unified Integrated Platform Ecosystem (UIPE) collects across its Student, University, and Faculty portals, how it is used, and what choices you have.',
                'توضح هذه الصفحة المعلومات التي تجمعها منصة Unified Integrated Platform Ecosystem (UIPE) عبر بوابات الطلاب والجامعات والكليات والشركات والمستثمرين، وكيفية استخدامها، والخيارات المتاحة لك.'
              )}
            </p>
            {updatedDisplay !== '' && (
              <span className="lp2-tag lp2-tag--static">
                <Icon name="clock" size={13} /> {t('Last updated: ', 'آخر تحديث: ')}<strong>{updatedDisplay}</strong>
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="lp2-shell lp2-pv">
        <aside className="lp2-pv__aside">
          <nav className="lp2-pv__toc" aria-label={t('Table of contents', 'جدول المحتويات')}>
            <div className="lp2-pv__toc-head">
              <span className="lp2-pv__toc-title">{t('On this page', 'في هذه الصفحة')}</span>
              <span className="lp2-pv__toc-count" dir="ltr">{activeIndex + 1}/{SECTIONS.length}</span>
            </div>
            <div className="lp2-pv__meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label={t('Reading progress', 'تقدّم القراءة')}>
              <i style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            {tocLinks(false)}
          </nav>
        </aside>

        <article className="lp2-card lp2-pv__doc">
          <section id="s1" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">1</span>{t('Introduction', 'مقدمة')}</h2>
            <p>{t(
              'UIPE (Unified Integrated Platform Ecosystem) is a campus platform that brings students, instructors, faculties and universities together in one place — messaging and video meetings, courses and exams, personal files and tools, a social community with profiles, posts and stories, and publishing of academic projects.',
              'UIPE (Unified Integrated Platform Ecosystem) منصة جامعية تجمع الطلاب والدكاترة والكليات والجامعات في مكان واحد — مراسلة واجتماعات فيديو، ومواد وامتحانات، وملفات وأدوات شخصية، ومجتمع اجتماعي ببروفايلات ومنشورات وستوريز، ونشر المشاريع الأكاديمية.'
            )}</p>
            <p>{t(
              'This Privacy Policy explains what information UIPE collects through its portals, why it is collected, how it is used and shared, and the choices available to you as a user of the platform.',
              'توضّح سياسة الخصوصية هذه المعلومات التي تجمعها UIPE عبر بواباتها، وسبب جمعها، وكيفية استخدامها ومشاركتها، والخيارات المتاحة لك كمستخدم للمنصة.'
            )}</p>
          </section>

          <section id="s2" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">2</span>{t('Information We Collect', 'المعلومات التي نجمعها')}</h2>
            <p>{t('Depending on which portal you use, UIPE may collect:', 'وفقًا للبوابة التي تستخدمها، قد تجمع UIPE:')}</p>
            <ul>
              <li><strong>{t('Account information', 'معلومات الحساب')}</strong> — {t('name, email, role, and login credentials.', 'الاسم والبريد الإلكتروني والدور وبيانات الدخول.')}</li>
              <li><strong>{t('Student information', 'معلومات الطالب')}</strong> — {t('enrollment/department details, submitted graduation projects, certificates.', 'بيانات القيد/القسم، مشاريع التخرج المُقدَّمة، الشهادات.')}</li>
              <li><strong>{t('University, faculty & department information', 'معلومات الجامعة والكلية والقسم')}</strong> — {t("institutional structure and staff assignments entered by an institution's own administrators.", 'الهيكل المؤسسي وتعيينات الموظفين التي يُدخلها مسؤولو المؤسسة أنفسهم.')}</li>
              <li><strong>{t('Project & research information', 'معلومات المشاريع والأبحاث')}</strong> — {t('titles, descriptions, categories, links (e.g. GitHub, live demo), and AI-generated readiness/analysis scores.', 'العناوين والأوصاف والتصنيفات والروابط (مثل GitHub والعرض التجريبي)، ونتائج التحليل بالذكاء الاصطناعي.')}</li>
              <li><strong>{t('Messages, posts & profile', 'الرسائل والمنشورات والبروفايل')}</strong> — {t('chat messages and calls metadata, posts, stories, your profile photo, cover and bio, and your connections and followers.', 'الرسائل وبيانات المكالمات، والمنشورات والستوريز، وصورتك الشخصية والغلاف والنبذة، واتصالاتك ومتابعيك.')}</li>
              <li><strong>{t('Courses & exams', 'المواد والامتحانات')}</strong> — {t('course enrolment, attendance, assignments, exam attempts and grades.', 'التسجيل في المواد والحضور والتكاليف ومحاولات الامتحانات والدرجات.')}</li>
              <li><strong>{t('Uploaded files', 'الملفات المرفوعة')}</strong> — {t('documents, images, and other media attached to a project or profile.', 'المستندات والصور والوسائط الأخرى المرفقة بمشروع أو ملف شخصي.')}</li>
              <li><strong>{t('Contact information', 'معلومات التواصل')}</strong> — {t('email addresses used for account communication or support requests.', 'عناوين البريد الإلكتروني المستخدمة للتواصل بخصوص الحساب أو طلبات الدعم.')}</li>
              <li><strong>{t('Usage & technical information', 'معلومات الاستخدام والتقنية')}</strong> — {t('actions taken within the platform (e.g. audit-logged admin actions), device type, and similar technical details needed to operate the service.', 'الإجراءات المتخذة داخل المنصة (مثل إجراءات المسؤولين المسجَّلة في سجل التدقيق)، ونوع الجهاز، وتفاصيل تقنية مشابهة لازمة لتشغيل الخدمة.')}</li>
            </ul>
          </section>

          <section id="s3" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">3</span>{t('How We Use Information', 'كيف نستخدم المعلومات')}</h2>
            <ul>
              <li>{t('Creating and managing your account and role-based access.', 'إنشاء وإدارة حسابك وصلاحيات الوصول الخاصة بدورك.')}</li>
              <li>{t("University, faculty, and department administration by an institution's own authorized staff.", 'إدارة الجامعة والكلية والقسم من قبل الموظفين المخوَّلين بالمؤسسة نفسها.')}</li>
              <li>{t('Submitting, reviewing, and approving graduation and research projects.', 'تقديم ومراجعة واعتماد مشاريع التخرج والأبحاث.')}</li>
              <li>{t('Running messaging, meetings, courses, exams, files and the social community features.', 'تشغيل المراسلة والاجتماعات والمواد والامتحانات والملفات والمجتمع الاجتماعي.')}</li>
              <li>{t('Project discovery and academic/industry collaboration.', 'اكتشاف المشاريع والتعاون الأكاديمي والصناعي.')}</li>
              <li>{t('Communicating with you — notifications, messaging between platform users, and support responses.', 'التواصل معك — الإشعارات، والمراسلة بين مستخدمي المنصة، والرد على طلبات الدعم.')}</li>
              <li>{t('Maintaining platform security, including authentication, access control, and audit logging of administrative actions.', 'الحفاظ على أمان المنصة، بما يشمل التحقق من الهوية والتحكم في الوصول وتسجيل إجراءات المسؤولين.')}</li>
              <li>{t("Improving the platform's features and reliability.", 'تحسين ميزات المنصة وموثوقيتها.')}</li>
            </ul>
          </section>

          <section id="s4" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">4</span>{t('Project & Portfolio Visibility', 'ظهور المشاريع والملف العام')}</h2>
            <div className="lp2-pv__note">
              <Icon name="eye" size={18} />
              <p>{t(
                "Once a project or profile goes through the platform's approval/publication process, parts of it — such as the project title, description, cover image, and public portfolio link — may become visible to anyone with the link, or to other platform users, depending on the visibility settings used.",
                'بمجرد مرور مشروع أو ملف شخصي عبر عملية الاعتماد/النشر بالمنصة، قد تصبح أجزاء منه — مثل عنوان المشروع ووصفه وصورة الغلاف ورابط الملف العام — مرئية لأي شخص لديه الرابط، أو لمستخدمي المنصة الآخرين، وفقًا لإعدادات الظهور المستخدَمة.'
              )}</p>
            </div>
            <p>{t(
              'You control your social visibility: choose who sees each post and story, lock your profile so only friends and followers see your content, hide your friends and followers lists, and decide who can open or download your profile photo.',
              'إنت اللي بتتحكم في ظهورك الاجتماعي: اختار مين يشوف كل منشور وستوري، وأقفل بروفايلك ليشوف محتواك أصدقاؤك ومتابعوك فقط، وأخفِ قوائم الأصدقاء والمتابعين، وحدّد من يستطيع فتح صورتك الشخصية أو تنزيلها.'
            )}</p>
            <p>{t(
              'Please avoid submitting sensitive, confidential, or personally identifying information (beyond what a project genuinely requires) into any project field, file, or portfolio area that may be published.',
              'يُرجى تجنّب إدخال معلومات حساسة أو سرية أو تعريفية شخصية (بما يتجاوز ما يتطلبه المشروع فعليًا) في أي حقل أو ملف أو منطقة من الملف الشخصي قد يتم نشرها.'
            )}</p>
          </section>

          <section id="s5" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">5</span>{t('Data Sharing', 'مشاركة البيانات')}</h2>
            <p>{t('Information may be shared, strictly for platform purposes, with:', 'قد تتم مشاركة المعلومات، لأغراض المنصة حصرًا، مع:')}</p>
            <ul>
              <li>{t('The university, faculty, or department a student or staff account belongs to.', 'الجامعة أو الكلية أو القسم الذي ينتمي إليه حساب الطالب أو الموظف.')}</li>
              <li>{t('Authorized institutional personnel responsible for reviewing or managing that data.', 'الموظفون المؤسسيون المخوَّلون بمراجعة أو إدارة تلك البيانات.')}</li>
              <li>{t('Other members of a project team collaborating on the same submission.', 'أعضاء فريق المشروع الآخرين المتعاونين على نفس المشروع المقدَّم.')}</li>
            </ul>
            <p>{t(
              'UIPE does not sell personal information, and does not share it with third parties beyond what is described in this policy.',
              'لا تقوم UIPE ببيع المعلومات الشخصية، ولا تشاركها مع أطراف ثالثة بما يتجاوز ما هو موضح في هذه السياسة.'
            )}</p>
          </section>

          <section id="s6" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">6</span>{t('Data Security', 'أمان البيانات')}</h2>
            <p>{t(
              'UIPE relies on authentication, role-based authorization, and access control to help protect information from unauthorized access, together with administrative audit logging so account actions can be reviewed.',
              'تعتمد UIPE على التحقق من الهوية والتفويض القائم على الأدوار والتحكم في الوصول للمساعدة في حماية المعلومات من الوصول غير المصرح به، إلى جانب سجل تدقيق إداري يتيح مراجعة إجراءات الحسابات.'
            )}</p>
            <p>{t(
              'No online platform can guarantee absolute security. We work to apply reasonable safeguards, but we do not claim any specific security certification or compliance framework unless explicitly stated elsewhere on the platform.',
              'لا يمكن لأي منصة إلكترونية ضمان أمان مطلق. نعمل على تطبيق ضمانات معقولة، لكننا لا ندّعي الحصول على أي شهادة أمان أو إطار امتثال محدد ما لم يُذكر ذلك صراحةً في مكان آخر بالمنصة.'
            )}</p>
          </section>

          <section id="s7" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">7</span>{t('Data Retention', 'الاحتفاظ بالبيانات')}</h2>
            <p>{t(
              "Information is generally retained for as long as your account is active, or as needed to operate the platform — for example, to keep academic/institutional records, maintain project portfolios, or meet operational requirements. Some records, such as approved graduation projects and certificates, may be retained for longer as part of an institution's academic record.",
              'يُحتفظ بالمعلومات عمومًا طالما ظل حسابك نشطًا، أو بحسب ما يلزم لتشغيل المنصة — مثل الاحتفاظ بالسجلات الأكاديمية/المؤسسية، أو الحفاظ على ملفات المشاريع، أو تلبية المتطلبات التشغيلية. قد يُحتفظ ببعض السجلات، مثل مشاريع التخرج المعتمدة والشهادات، لفترة أطول كجزء من السجل الأكاديمي للمؤسسة.'
            )}</p>
          </section>

          <section id="s8" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">8</span>{t('Your Rights', 'حقوقك')}</h2>
            <ul>
              <li>{t('Access the personal information held in your account.', 'الوصول إلى المعلومات الشخصية المحفوظة في حسابك.')}</li>
              <li>{t('Request correction of inaccurate account information.', 'طلب تصحيح معلومات الحساب غير الدقيقة.')}</li>
              <li>{t('Request deletion of your account or content, where applicable and subject to any academic/institutional record-keeping requirements.', 'طلب حذف حسابك أو محتواك، حيثما أمكن ومع مراعاة أي متطلبات للاحتفاظ بالسجلات الأكاديمية/المؤسسية.')}</li>
              <li>{t('Manage your own account information directly from your portal.', 'إدارة معلومات حسابك مباشرةً من بوابتك.')}</li>
              <li>{t('Contact the platform or your institution with any privacy question or request.', 'التواصل مع المنصة أو مؤسستك بخصوص أي استفسار أو طلب متعلق بالخصوصية.')}</li>
            </ul>
          </section>

          <section id="s9" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">9</span>{t('Cookies & Local Storage', 'ملفات تعريف الارتباط والتخزين المحلي')}</h2>
            <p>{t(
              'UIPE uses your session to keep you signed in while using the platform. On public, unauthenticated pages, your language and light/dark theme preference are stored locally in your browser (not on our servers) so the page renders consistently the next time you visit. UIPE does not use third-party advertising or tracking cookies.',
              'تستخدم UIPE جلسة تسجيل الدخول لإبقائك متصلاً أثناء استخدام المنصة. في الصفحات العامة غير المصادَق عليها، يتم تخزين تفضيل اللغة والوضع الفاتح/الداكن محليًا في متصفحك (وليس على خوادمنا) بحيث تظهر الصفحة بشكل متسق في زيارتك التالية. لا تستخدم UIPE ملفات تعريف ارتباط إعلانية أو تتبعية من أطراف ثالثة.'
            )}</p>
          </section>

          <section id="s10" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">10</span>{t('Third-Party Links', 'روابط خارجية')}</h2>
            <p>{t(
              'Projects and profiles on UIPE may link to external resources such as GitHub repositories, live project demos, or social media. UIPE is not responsible for the privacy practices or content of any external website you reach through such links.',
              'قد تتضمن المشاريع والملفات الشخصية على UIPE روابط لموارد خارجية مثل مستودعات GitHub أو العروض التجريبية للمشاريع أو مواقع التواصل الاجتماعي. UIPE ليست مسؤولة عن ممارسات الخصوصية أو محتوى أي موقع خارجي تصل إليه عبر هذه الروابط.'
            )}</p>
          </section>

          <section id="s11" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">11</span>{t("Minors' Privacy", 'خصوصية القُصَّر')}</h2>
            <p>{t(
              'UIPE is built for university students, staff, and industry partners, and is not directed at children. If you believe a minor has provided personal information to the platform, please contact us so the matter can be reviewed.',
              'تم تصميم UIPE لطلاب الجامعات والموظفين والشركاء الصناعيين، وهي ليست موجهة للأطفال. إذا كنت تعتقد أن أحد القُصَّر قد قدّم معلومات شخصية إلى المنصة، يُرجى التواصل معنا لمراجعة الأمر.'
            )}</p>
          </section>

          <section id="s12" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">12</span>{t('Policy Updates', 'تحديثات السياسة')}</h2>
            <p>{t(
              'This Privacy Policy may be updated as the platform evolves. Material changes will be reflected by updating the date below.',
              'قد يتم تحديث سياسة الخصوصية هذه مع تطور المنصة. سيتم توضيح أي تغييرات جوهرية من خلال تحديث التاريخ أدناه.'
            )}</p>
            {updatedDisplay !== '' && (
              <p><strong>{t('Last Updated: ', 'آخر تحديث: ')}</strong>{updatedDisplay}</p>
            )}
          </section>

          <section id="s13" className="lp2-pv__sec">
            <h2><span className="lp2-pv__num">13</span>{t('Contact Us', 'تواصل معنا')}</h2>
            <p>{t(
              'For any privacy question or request — or to send a complaint or suggestion — reach us directly or use the form below.',
              'لأي استفسار أو طلب متعلق بالخصوصية — أو لإرسال شكوى أو اقتراح — تواصل معنا مباشرة أو استخدم النموذج التالي.'
            )}</p>

            <div className="lp2-pv__contact-row">
              <a className="lp2-pv__contact-link" href={`mailto:${supportEmail}`}>
                <span className="lp2-icon"><Icon name="mail" size={18} /></span>
                <span><small>{t('Email', 'البريد الإلكتروني')}</small><strong dir="ltr">{supportEmail}</strong></span>
              </a>
              <a className="lp2-pv__contact-link" href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                <span className="lp2-icon"><Icon name="linkedin" size={18} /></span>
                <span><small>LinkedIn</small><strong>{t('Haithem Mohamed', 'هيثم محمد')}</strong></span>
              </a>
            </div>

            <form className="lp2-pv__form" onSubmit={submitContact}>
              <fieldset className="lp2-pv__field">
                <legend>{t('What is this about?', 'نوع الرسالة')}</legend>
                <div className="lp2-pv__types">
                  {CONTACT_TYPES.map(([value, icon]) => (
                    <button
                      type="button" key={value}
                      className={`lp2-chip${form.type === value ? ' is-active' : ''}`}
                      aria-pressed={form.type === value}
                      onClick={() => setField('type', value)}
                    >
                      <Icon name={icon} size={14} /> {typeLabel(value)}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="lp2-pv__two">
                <label className="lp2-pv__field">
                  <span>{t('Your name', 'اسمك')}</span>
                  <input className="form-input" type="text" required maxLength={100} value={form.name}
                    onChange={(e) => setField('name', e.target.value)} placeholder={t('Full name', 'الاسم بالكامل')} />
                </label>
                <label className="lp2-pv__field">
                  <span>{t('Your email', 'بريدك الإلكتروني')}</span>
                  <input className="form-input" type="email" required maxLength={150} dir="ltr" value={form.email}
                    onChange={(e) => setField('email', e.target.value)} placeholder="you@example.com" />
                </label>
              </div>

              <label className="lp2-pv__field">
                <span>{t('Message', 'الرسالة')}</span>
                <textarea className="form-input" rows={5} required maxLength={1500} value={form.message}
                  onChange={(e) => setField('message', e.target.value)}
                  placeholder={form.type === 'complaint'
                    ? t('Tell us what went wrong…', 'احكيلنا إيه اللي حصل…')
                    : form.type === 'suggestion'
                      ? t('Tell us your idea…', 'قولنا فكرتك…')
                      : t('Write your message…', 'اكتب رسالتك…')} />
                <small className="lp2-pv__count">{form.message.length}/1500</small>
              </label>

              <div className="lp2-pv__submit">
                <button type="submit" className="btn btn-primary"><Icon name="send" size={16} /> {t('Send message', 'إرسال الرسالة')}</button>
                <button type="button" className="btn btn-ghost" onClick={copyEmail}>
                  <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? t('Copied', 'تم النسخ') : t('Copy email', 'نسخ البريد')}
                </button>
              </div>

              {sent && (
                <div className="lp2-pv__note" role="status">
                  <Icon name="info" size={18} />
                  <p>{t(
                    'Your email app should open with the message ready to send. If it did not, copy the address above and email us directly.',
                    'المفروض تطبيق البريد عندك يفتح والرسالة جاهزة للإرسال. لو ماحصلش، انسخ العنوان فوق وابعتلنا مباشرة.'
                  )}</p>
                </div>
              )}
            </form>
          </section>
        </article>
      </main>

      <div className="lp2-pv__bar" aria-hidden="true"><i style={{ transform: `scaleX(${progress / 100})` }} /></div>

      <button type="button" className={`lp2-pv__pill${pillVisible && !tocOpen ? ' is-visible' : ''}`}
        aria-haspopup="dialog" aria-expanded={tocOpen} onClick={() => setTocOpen(true)}>
        <Icon name="menu" size={17} />
        <span className="lp2-pv__pill-num" dir="ltr">{activeIndex + 1}/{SECTIONS.length}</span>
        <span className="lp2-pv__pill-label">{t(SECTIONS[activeIndex].label[0], SECTIONS[activeIndex].label[1])}</span>
      </button>

      <div className={`lp2-pv__sheet${tocOpen ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-hidden={!tocOpen}
        aria-label={t('Table of contents', 'جدول المحتويات')} ref={sheetRef}>
        <div className="lp2-pv__sheet-backdrop" onClick={() => setTocOpen(false)} />
        <div className="lp2-pv__sheet-panel">
          <span className="lp2-pv__grip" aria-hidden="true" />
          <div className="lp2-pv__toc-head">
            <span className="lp2-pv__toc-title">{t('On this page', 'في هذه الصفحة')}</span>
            <span className="lp2-pv__toc-count" dir="ltr">{activeIndex + 1}/{SECTIONS.length}</span>
            <button type="button" className="lp2-pv__sheet-close" aria-label={t('Close', 'إغلاق')} onClick={() => setTocOpen(false)}><Icon name="x" size={16} /></button>
          </div>
          <div className="lp2-pv__meter"><i style={{ transform: `scaleX(${progress / 100})` }} /></div>
          <nav className="lp2-pv__toc lp2-pv__toc--sheet">{tocLinks(true)}</nav>
        </div>
      </div>

      <button
        type="button"
        className={`lp2-pv__top${showBackToTop ? ' is-visible' : ''}`}
        aria-label={t('Back to top', 'العودة للأعلى')}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <Icon name="arrow-up" size={18} />
      </button>

      <SiteFooter />
    </div>
  );
}
