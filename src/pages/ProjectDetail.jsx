import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../lib/backStack';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api, errorMessage } from '../api/client';
import Icon from '../components/Icon';
import VideoPlayer from '../components/VideoPlayer';
import SiteFooter from '../components/SiteFooter';
import LandingNav from '../components/LandingNav';
import LandingBackdrop from '../components/LandingBackdrop';
import usePaperUnfold from '../hooks/usePaperUnfold';
import { parseServerDate } from '../utils/serverDate';

const LINK_ICONS = {
  github: 'github', gitlab: 'github', live_demo: 'globe', website: 'globe',
  mobile_app: 'smartphone', documentation: 'file', video_demo: 'monitor',
  presentation: 'monitor', research_paper: 'file', other: 'link',
};

const SOCIAL_ICONS = { github: 'github', linkedin: 'linkedin', portfolio: 'globe', website: 'globe' };

const ROLE_LABELS = {
  supervisor: ['Supervisor', 'مشرف'],
  professor: ['Professor', 'أستاذ'],
  principal_investigator: ['Principal Investigator', 'الباحث الرئيسي'],
  teaching_assistant: ['Teaching Assistant', 'معيد'],
  collaborator: ['Collaborator', 'متعاون'],
  student_member: ['Team member', 'عضو فريق'],
  external_collaborator: ['External collaborator', 'متعاون خارجي'],
};

function safeJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Screenshot of the student's live site (used only when no cover/featured image exists).
function livePreviewUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=1200&h=750`;
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function Avatar({ name, src, size = 'md' }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`lp2-pd__avatar lp2-pd__avatar--${size}`} aria-hidden="true">
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

/**
 * Public project page — GET /api/v1/public/projects/{slug}.
 * Hero (cover / uploaded screenshot / live-site preview in a browser frame),
 * about, tech stack, SDGs, gallery, owner student, supervisors/doctors, team,
 * links, documents and contact. Emails/social links are returned by the API
 * only for logged-in viewers (or PROJECT_CONTACTS_PUBLIC=true); guests get
 * names/roles plus a "log in to see contacts" prompt.
 */
export default function ProjectDetail() {
  const { slug } = useParams();
  const { status, user } = useAuth();
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [copied, setCopied] = useState(false);
  const [heroBroken, setHeroBroken] = useState(false);

  // Re-fetch when auth status changes so contact emails appear right after login.
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setHeroBroken(false);
    api.get(`/api/v1/public/projects/${encodeURIComponent(slug)}`)
      .then((json) => { if (alive) setData(json.data); })
      .catch((err) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [slug, status]);

  useEffect(() => {
    if (lightbox === null) return undefined;
    const media = data?.media || [];
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowLeft') setLightbox((i) => (i - 1 + media.length) % media.length);
      if (e.key === 'ArrowRight') setLightbox((i) => (i + 1) % media.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, data]);

  const shaped = useMemo(() => {
    if (!data?.project) return null;
    const p = data.project;
    const title = (isAr ? p.title_ar : p.title_en) || p.title_en || p.title_ar || '';
    const uniName = (isAr ? p.university_name_ar : p.university_name_en) || '';
    const facName = (isAr ? p.faculty_name_ar : p.faculty_name_en) || '';
    const depName = (isAr ? p.department_name_ar : p.department_name_en) || '';
    const tags = safeJsonArray(p.tags);
    const technologies = safeJsonArray(p.technologies);
    const keywords = safeJsonArray(p.keywords);
    const sdgs = safeJsonArray(p.sdgs);
    const media = data.media || [];
    const mediaIds = new Set(media.map((m) => m.id));
    const otherFiles = (data.files || []).filter((f) => !mediaIds.has(f.id));
    const links = data.links || [];
    const liveLink = links.find((l) => l.type === 'live_demo' || l.type === 'website') || null;
    const repoLink = links.find((l) => l.type === 'github' || l.type === 'gitlab') || null;
    const featuredImage = media.find((m) => m.file_type === 'image' && m.is_featured) || media.find((m) => m.file_type === 'image');
    const coverSrc = p.cover_image_path
      ? `/${String(p.cover_image_path).replace(/^\//, '')}`
      : (featuredImage?.url || '');
    const heroLivePreview = coverSrc ? null : livePreviewUrl(liveLink?.url);
    const isOwner = status === 'authenticated' && user && Number(user.id) === Number(p.owner_id);
    return { p, title, uniName, facName, depName, tags, technologies, keywords, sdgs, media, otherFiles, links, liveLink, repoLink, coverSrc, heroLivePreview, isOwner };
  }, [data, isAr, status, user]);

  // Scroll-reveal for the content cards (re-runs once the project has loaded).
  usePaperUnfold('.lp2-pd__sec');

  const shell = (children) => (
    <div className="lp2 lp2-page lp2--fx">
      <LandingNav />
      <div className="lp2-pd-stage">
        <LandingBackdrop compact />
        {children}
      </div>
      <SiteFooter />
    </div>
  );

  if (error) {
    return shell(
      <main className="lp2-pd lp2-shell">
        <div className="lp2-card lp2-ex-empty">
          <span className="lp2-icon lp2-icon--lg"><Icon name="search" size={22} /></span>
          <h3>{t('Project not found.', 'المشروع غير موجود.')}</h3>
          <p>{t('It may have been unpublished or the link is wrong.', 'ممكن يكون اتشال من النشر أو الرابط غلط.')}</p>
          <Link to="/projects" className="btn btn-primary">{t('Back to all projects', 'رجوع لكل المشاريع')}</Link>
        </div>
      </main>
    );
  }

  if (!shaped) {
    return shell(
      <main className="lp2-pd lp2-shell" aria-busy="true">
        <div className="lp2-skel__line lp2-skel__line--s" style={{ width: 140 }} />
        <div className="lp2-skel__img" style={{ aspectRatio: '16/7', borderRadius: 16, margin: '16px 0' }} />
        <div className="lp2-skel__line" style={{ height: 28, width: '60%' }} />
        <div className="lp2-skel__line lp2-skel__line--m" />
      </main>
    );
  }

  const { p, title, uniName, facName, depName, tags, technologies, keywords, sdgs, media, otherFiles, links, liveLink, repoLink, coverSrc, heroLivePreview, isOwner } = shaped;
  const current = lightbox !== null ? media[lightbox] : null;
  const contactsVisible = true; // contacts are public for everyone
  const num = (n) => Number(n).toLocaleString(isAr ? 'ar-EG' : 'en-US');

  // People: new `people` block, with a graceful fallback to the old payload.
  const people = data.people || {};
  const owner = people.owner || (p.owner_name ? { full_name: p.owner_name } : null);
  const supervisors = people.supervisors?.length
    ? people.supervisors
    : (p.supervisor_name ? [{ name: p.supervisor_name, role: 'supervisor' }] : []);
  const team = people.team || (data.team_members || [])
    .filter((m) => m.status === 'accepted')
    .map((m) => ({ id: m.id, name: m.display_name, role: m.role, academic_year: m.academic_year, student_number: m.student_number }));
  const hasPeople = Boolean(owner) || supervisors.length > 0 || team.length > 0;
  // Everyone on the team who has an email (owner + supervisors + members), de-duplicated.
  const recipients = [];
  const seenMail = new Set();
  [owner, ...supervisors, ...team].forEach((x) => {
    const em = String(x?.email || '').trim();
    if (em && !seenMail.has(em.toLowerCase())) {
      seenMail.add(em.toLowerCase());
      recipients.push({ name: x.full_name || x.name || em, email: em });
    }
  });
  const recipientEmails = recipients.map((r) => r.email);
  const defaultSubject = `${t('Regarding your project', 'بخصوص مشروعكم')}: ${title}`;
  const mailSubject = contactSubject.trim() || defaultSubject;
  const projectUrl = typeof window !== 'undefined' ? window.location.href : '';
  const mailBody = `${contactMessage.trim()}\n\n—\n${t('Sent from the project page', 'من صفحة المشروع')}: ${projectUrl}`;
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmails.join(','))}&su=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;
  const mailtoUrl = `mailto:${recipientEmails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;
  const canCompose = recipientEmails.length > 0 && contactMessage.trim().length > 0;
  const openGmail = () => { if (canCompose) window.open(gmailUrl, '_blank', 'noopener,noreferrer'); };
  const copyEmails = async () => {
    try { await navigator.clipboard.writeText(recipientEmails.join(', ')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const anyEmail = Boolean(owner?.email) || supervisors.some((s) => s.email) || team.some((m) => m.email);

  const views = (Number(p.views_count) || 0) + 1;
  const likes = Number(p.likes_count) || 0;
  const fmtDate = (d) => {
    if (!d) return '';
    const dt = parseServerDate(String(d));
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const published = fmtDate(p.published_at);
  const timeline = p.timeline_start || p.timeline_end
    ? [fmtDate(p.timeline_start), fmtDate(p.timeline_end)].filter(Boolean).join(' → ')
    : '';
  const roleLabel = (role) => { const r = ROLE_LABELS[role]; return r ? t(r[0], r[1]) : (role || ''); };
  const sdgLabel = (s) => (/^\d+$/.test(String(s)) ? `${t('SDG', 'هدف')} ${s}` : String(s));
  const uniLogo = p.university_logo_path ? `/${String(p.university_logo_path).replace(/^\//, '')}` : null;
  const showImg = coverSrc && !heroBroken;
  const showLive = !coverSrc && heroLivePreview && !heroBroken;
  const frameHost = hostOf(liveLink?.url) || hostOf(repoLink?.url) || (slug || '');

  const facts = [
    uniName && ['building', t('University', 'الجامعة'), p.university_slug
      ? <Link to={`/universities/${encodeURIComponent(p.university_slug)}`}>{uniName}</Link> : uniName],
    facName && ['layers', t('Faculty', 'الكلية'), facName],
    depName && ['folder', t('Department', 'القسم'), depName],
    p.category && ['projects', t('Category', 'التصنيف'), p.category],
    published && ['calendar', t('Published', 'تاريخ النشر'), published],
    timeline && ['clock', t('Timeline', 'المدة'), timeline],
  ].filter(Boolean);

  const mail = (email) => (
    <a className="lp2-pd__mail" href={`mailto:${email}`}>
      <Icon name="mail" size={13} /> <span>{email}</span>
    </a>
  );

  return shell(
    <main className="lp2-pd lp2-shell">
      <BackLink to="/projects" className="lp2-pd__back">
        <Icon name={isAr ? 'arrow-right' : 'arrow-left'} size={16} /> {t('Back to all projects', 'رجوع لكل المشاريع')}
      </BackLink>

      <header className="lp2-pd__head animate-rise-in">
        <div className="lp2-pd__badges">
          {p.category && <span className="lp2-tag lp2-tag--static">{p.category}</span>}
          <span className="lp2-badge"><Icon name="check-circle" size={13} /> {t('Published', 'منشور')}</span>
        </div>
        <h1>{title}</h1>
        {p.summary && <p className="lp2-pd__summary">{p.summary}</p>}
        {(uniName || facName) && (
          <div className="lp2-pd__org">
            {uniLogo
              ? <img className="lp2-pd__org-logo" src={uniLogo} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              : <span className="lp2-icon"><Icon name="building" size={16} /></span>}
            <span>
              {p.university_slug
                ? <Link to={`/universities/${encodeURIComponent(p.university_slug)}`}>{uniName}</Link>
                : uniName}
              {facName && <em> · {facName}</em>}
              {depName && <em> · {depName}</em>}
            </span>
          </div>
        )}
      </header>

      <div className="lp2-pd__stats animate-rise-in">
        <div><Icon name="eye" size={16} /><strong>{num(views)}</strong><span>{t('Views', 'مشاهدة')}</span></div>
        <div><Icon name="heart" size={16} /><strong>{num(likes)}</strong><span>{t('Likes', 'إعجاب')}</span></div>
        <div><Icon name="users" size={16} /><strong>{num(team.length + (owner ? 1 : 0))}</strong><span>{t('Members', 'عضو')}</span></div>
        <div><Icon name="link" size={16} /><strong>{num(links.length + otherFiles.length)}</strong><span>{t('Links & files', 'روابط وملفات')}</span></div>
      </div>

      <div className="lp2-pd__grid">
        <div className="lp2-pd__main">
          {(showImg || showLive || liveLink) && (
            <div className="lp2-pd__browser animate-rise-in">
              <div className="lp2-pd__browser-bar">
                <span className="lp2-pd__dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="lp2-pd__urlbar"><Icon name="lock" size={12} /> {frameHost}</span>
                {liveLink && <span className="lp2-pd__live"><span className="pp-live__dot" />{t('Live', 'شغّال')}</span>}
              </div>
              <div className="lp2-pd__screen">
                {showImg || showLive ? (
                  <img
                    src={showImg ? coverSrc : heroLivePreview}
                    alt={showImg ? (title || t('Project cover image', 'صورة المشروع')) : `${title} — ${t('live preview', 'معاينة حية')}`}
                    onError={() => setHeroBroken(true)}
                  />
                ) : (
                  <div className="lp2-pd__screen-ph" aria-hidden="true"><span>{(title || 'U').charAt(0).toUpperCase()}</span></div>
                )}
              </div>
            </div>
          )}

          {p.description && (
            <section className="lp2-card lp2-pd__sec">
              <h2><Icon name="info" size={18} /> {t('About this project', 'عن المشروع')}</h2>
              <div className="lp2-pd__prose">{p.description}</div>
            </section>
          )}

          {(technologies.length > 0 || tags.length > 0 || keywords.length > 0 || sdgs.length > 0) && (
            <section className="lp2-card lp2-pd__sec">
              <h2><Icon name="terminal" size={18} /> {t('Technologies & topics', 'التقنيات والمواضيع')}</h2>
              {technologies.length > 0 && (
                <div className="lp2-pd__group">
                  <h3>{t('Tech stack', 'التقنيات المستخدمة')}</h3>
                  <div className="lp2-pd__chips-row">{technologies.map((x, i) => <span className="lp2-tag lp2-tag--brand" key={`tech-${i}`}>{x}</span>)}</div>
                </div>
              )}
              {sdgs.length > 0 && (
                <div className="lp2-pd__group">
                  <h3>{t('Sustainable Development Goals', 'أهداف التنمية المستدامة')}</h3>
                  <div className="lp2-pd__chips-row">{sdgs.map((x, i) => <span className="lp2-tag lp2-tag--sdg" key={`sdg-${i}`}><Icon name="globe" size={13} /> {sdgLabel(x)}</span>)}</div>
                </div>
              )}
              {(tags.length > 0 || keywords.length > 0) && (
                <div className="lp2-pd__group">
                  <h3>{t('Tags & keywords', 'الوسوم والكلمات المفتاحية')}</h3>
                  <div className="lp2-pd__chips-row">
                    {[...tags, ...keywords.filter((k) => !tags.includes(k))].map((x, i) => <span className="lp2-tag lp2-tag--static" key={`tag-${i}`}>{x}</span>)}
                  </div>
                </div>
              )}
            </section>
          )}

          {media.length > 0 && (
            <section className="lp2-card lp2-pd__sec">
              <h2><Icon name="image" size={18} /> {t('Media Gallery', 'معرض الوسائط')}</h2>
              <div className="pp-gallery">
                {media.map((m, i) => {
                  const thumb = m.file_type === 'image' ? m.url : m.thumbnail_url;
                  return (
                    <button
                      key={m.id} type="button"
                      className={`pp-gallery__item${m.is_featured ? ' pp-gallery__item--featured' : ''}`}
                      aria-label={m.caption || m.original_name}
                      onClick={() => setLightbox(i)}
                    >
                      {thumb ? (
                        <img src={thumb} alt={m.caption || ''} loading="lazy" />
                      ) : (
                        <div className="pp-gallery__placeholder" aria-hidden="true"><Icon name="file" size={22} /></div>
                      )}
                      {m.file_type !== 'image' && <span className="pp-gallery__play"><Icon name="play" size={18} /></span>}
                      {(m.caption || m.original_name) && <span className="pp-gallery__caption">{m.caption || m.original_name}</span>}
                    </button>
                  );
                })}
              </div>

              {current && (
                <div className="pp-lightbox" onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}>
                  <button type="button" className="pp-lightbox__close" aria-label={t('Close', 'إغلاق')} onClick={() => setLightbox(null)}>
                    <Icon name="x" size={22} />
                  </button>
                  <button
                    type="button" className="pp-lightbox__nav pp-lightbox__nav--prev" aria-label={t('Previous', 'السابق')}
                    onClick={() => setLightbox((i) => (i - 1 + media.length) % media.length)}
                  >
                    <Icon name="chevron-left" size={26} />
                  </button>
                  <div className="pp-lightbox__stage">
                    {current.file_type === 'image' && <img src={current.url} alt={current.caption || ''} />}
                    {current.file_type === 'video' && current.url && <VideoPlayer key={current.url} src={current.url} autoPlay />}
                    {current.file_type !== 'image' && current.embed_url && (
                      <iframe src={current.embed_url} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={current.caption || 'media'} />
                    )}
                  </div>
                  <button
                    type="button" className="pp-lightbox__nav pp-lightbox__nav--next" aria-label={t('Next', 'التالي')}
                    onClick={() => setLightbox((i) => (i + 1) % media.length)}
                  >
                    <Icon name="chevron-right" size={26} />
                  </button>
                  <div className="pp-lightbox__caption">{current.caption || current.original_name || ''}</div>
                </div>
              )}
            </section>
          )}

          {hasPeople && (
            <section className="lp2-card lp2-pd__sec">
              <h2><Icon name="users" size={18} /> {t('People behind the project', 'القائمون على المشروع')}</h2>

              {owner && (
                <div className="lp2-pd__group">
                  <h3>{t('Project owner (student)', 'صاحب المشروع (الطالب)')}</h3>
                  <article className="lp2-pd__owner">
                    <Avatar name={owner.full_name} src={owner.avatar_url} size="lg" />
                    <div className="lp2-pd__owner-body">
                      <strong>{owner.full_name}</strong>
                      <span className="lp2-pd__sub">
                        {[owner.student_number && `${t('ID', 'رقم')} ${owner.student_number}`,
                          owner.academic_year && `${t('Year', 'الفرقة')} ${owner.academic_year}`,
                          facName, depName].filter(Boolean).join(' · ')}
                      </span>
                      {owner.bio && <p>{owner.bio}</p>}
                      {owner.skills?.length > 0 && (
                        <div className="lp2-pd__chips-row">{owner.skills.map((s, i) => <span className="lp2-tag lp2-tag--static" key={i}>{s}</span>)}</div>
                      )}
                      <div className="lp2-pd__contact">
                        {owner.email && mail(owner.email)}
                        {Object.entries(owner.social_links || {}).map(([k, url]) => (
                          <a key={k} className="lp2-pd__mail" href={url} target="_blank" rel="noopener noreferrer">
                            <Icon name={SOCIAL_ICONS[k] || 'link'} size={13} /> <span>{k}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  </article>
                </div>
              )}

              {supervisors.length > 0 && (
                <div className="lp2-pd__group">
                  <h3>{t('Supervisors & doctors', 'المشرفون والدكاترة')}</h3>
                  <div className="lp2-pd__people">
                    {supervisors.map((s, i) => (
                      <article className="lp2-pd__person" key={`sv-${i}`}>
                        <Avatar name={s.name} src={s.avatar_url} />
                        <div>
                          <strong>{s.name}</strong>
                          <span className="lp2-pd__sub">
                            {[(isAr ? s.title_ar : s.title_en) || s.title, roleLabel(s.role), s.department].filter(Boolean).join(' · ')}
                          </span>
                          {s.email && mail(s.email)}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {team.length > 0 && (
                <div className="lp2-pd__group">
                  <h3>{t('Team members', 'أعضاء الفريق')}</h3>
                  <div className="lp2-pd__people">
                    {team.map((m, i) => (
                      <article className="lp2-pd__person" key={m.id ?? `tm-${i}`}>
                        <Avatar name={m.name} src={m.avatar_url} />
                        <div>
                          <strong>{m.name}</strong>
                          <span className="lp2-pd__sub">
                            {[roleLabel(m.role), m.academic_year && `${t('Year', 'الفرقة')} ${m.academic_year}`, m.student_number && `${t('ID', 'رقم')} ${m.student_number}`].filter(Boolean).join(' · ')}
                          </span>
                          {m.email && mail(m.email)}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {contactsVisible && !anyEmail && (
                <p className="lp2-pd__muted">{t('No contact emails were provided for this project.', 'مفيش إيميلات تواصل متاحة للمشروع ده.')}</p>
              )}
            </section>
          )}
        </div>

        <aside className="lp2-pd__side">
          <div className="lp2-card lp2-pd__panel">
            {liveLink && (
              <a href={liveLink.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary lp2-pd__cta">
                <Icon name="globe" size={16} /> {t('Visit live project', 'زيارة المشروع مباشرة')}
              </a>
            )}
            {repoLink && (
              <a href={repoLink.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline lp2-pd__cta lp2-pd__cta--gap">
                <Icon name="github" size={16} /> {t('View source code', 'الكود المصدري')}
              </a>
            )}
            <dl className={`lp2-pd__facts${liveLink || repoLink ? ' lp2-pd__facts--spaced' : ''}`}>
              {facts.map(([icon, label, value]) => (
                <div key={label}>
                  <dt><Icon name={icon} size={14} /> {label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {(links.length > 0 || otherFiles.length > 0) && (
            <div className="lp2-card lp2-pd__panel">
              <h2>{t('Links & Documents', 'روابط ومستندات')}</h2>
              <div className="lp2-pd__links">
                {links.map((l) => (
                  <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer">
                    <Icon name={LINK_ICONS[l.type] || 'link'} size={16} /> <span>{l.label}</span>
                    <Icon name="arrow-right" size={14} />
                  </a>
                ))}
                {otherFiles.map((f) => (
                  <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer">
                    <Icon name="file" size={16} /> <span>{f.original_name}</span>
                    <Icon name="arrow-right" size={14} />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="lp2-card lp2-pd__panel">
            <h2>{t('Contact the Team', 'تواصل مع الفريق')}</h2>
            {isOwner ? (
              <p className="lp2-pd__muted">{t('This is your own project.', 'ده مشروعك انت.')}</p>
            ) : (
              <div className="lp2-pd__mailform">
                {recipients.length > 0 ? (
                  <>
                    <p className="lp2-pd__muted">{t('Write your message, then continue in Gmail with everyone already added as recipients.', 'اكتب رسالتك وكمّل في Gmail وكل الفريق مضاف كمستلمين.')}</p>
                    <div className="lp2-pd__rcpts" aria-label={t('Recipients', 'المستلمون')}>
                      {recipients.map((r) => (
                        <span className="lp2-pd__rcpt" key={r.email} title={r.email}>
                          <strong>{r.name}</strong>
                          <small dir="ltr">{r.email}</small>
                        </span>
                      ))}
                    </div>
                    <input
                      className="form-input" type="text" maxLength={150}
                      value={contactSubject} onChange={(e) => setContactSubject(e.target.value)}
                      placeholder={defaultSubject}
                      aria-label={t('Subject', 'الموضوع')}
                    />
                    <textarea
                      className="form-input" rows={5} maxLength={1000} style={{ marginTop: 8 }}
                      value={contactMessage} onChange={(e) => setContactMessage(e.target.value)}
                      placeholder={t('Write your message to the team...', 'اكتب رسالتك للفريق...')}
                    />
                    <button type="button" className="btn btn-primary lp2-pd__cta" disabled={!canCompose} onClick={openGmail}>
                      <Icon name="mail" size={16} /> {t('Continue in Gmail', 'كمّل في Gmail')}
                    </button>
                    <div className="lp2-pd__mailalt">
                      <a href={canCompose ? mailtoUrl : undefined} aria-disabled={!canCompose} className={canCompose ? '' : 'is-disabled'}>{t('Use another mail app', 'استخدم تطبيق بريد تاني')}</a>
                      <button type="button" onClick={copyEmails}>{copied ? t('Copied ✓', 'تم النسخ ✓') : t('Copy all emails', 'انسخ كل الإيميلات')}</button>
                    </div>
                  </>
                ) : (
                  <p className="lp2-pd__muted">{t('No contact emails were provided for this project.', 'مفيش إيميلات تواصل متاحة للمشروع ده.')}</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
