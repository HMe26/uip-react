import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { StModal } from '../../components/student/stUi';
import { Attachments, DateTile, Empty, FeedAlert, Pager, SearchBox, Skeletons, StatTabs, ago } from '../../components/feed/feedUi';
import { AudienceFields, EMPTY_AUD, FileDrop, LinkRows, Section, Sheet, appendCommon } from '../../components/feed/composerParts';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/feed';

const translations = { ...i18nCommon, ...i18nPage };
const PER_PAGE = 10;
const TABS = [
  { key: 'all', icon: 'layers', en: 'All', ar: 'الكل' },
  { key: 'published', icon: 'check-circle', tone: 'success', en: 'Published', ar: 'منشورة' },
  { key: 'draft', icon: 'edit', tone: 'warning', en: 'Drafts', ar: 'مسودات' },
  { key: 'events', icon: 'calendar', tone: 'violet', en: 'Events', ar: 'فعاليات' },
  { key: 'pinned', icon: 'pin', en: 'Pinned', ar: 'مثبتة' },
];

export default function UniversityFeed() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [posts, setPosts] = useState([]);
  const [atts, setAtts] = useState({});
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [faculties, setFaculties] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/api/v1/feed', { page, per_page: PER_PAGE, q: query || undefined, status: status === 'all' ? undefined : status })
      .then((j) => { setPosts(j.data || []); setTotal(j.meta?.total ?? 0); setAtts(j.meta?.attachments || {}); })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [page, query, status]);
  useEffect(() => { load(); }, [load]);

  const loadCounts = useCallback(() => {
    TABS.forEach(({ key }) => {
      api.get('/api/v1/feed', { page: 1, per_page: 1, status: key === 'all' ? undefined : key })
        .then((j) => setCounts((c) => ({ ...c, [key]: j.meta?.total ?? 0 })))
        .catch(() => {});
    });
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { api.get('/api/v1/faculty', { per_page: 100 }).then((j) => setFaculties(j.data || [])).catch(() => {}); }, []);

  const refresh = () => { load(); loadCounts(); };
  async function run(id, promise) {
    setBusyId(id); setActionError(null);
    try { await promise; refresh(); } catch (e) { setActionError(errorMessage(e)); } finally { setBusyId(null); }
  }
  async function confirmDelete() {
    const id = deleting.id; setDeleting(null);
    await run(id, api.del(`/api/v1/feed/${id}`));
  }

  return (
    <div className="fd-page fd-page--wide">
      <div className="fd-head">
        <div className="fd-head__text">
          <h1>{t('University Feed')}</h1>
          <p>{t('Publish updates and events that every student at your university sees on their dashboard.')}</p>
        </div>
        <div className="fd-head__act">
          <Link to="/university/feed/reports" className="btn btn-outline"><Icon name="alert-triangle" size={15} /> {t('Reports')}</Link>
          <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}><Icon name="plus" size={16} /> {t('New Post')}</button>
        </div>
      </div>

      <StatTabs value={status} onChange={(k) => { setStatus(k); setPage(1); }}
        items={TABS.map((x) => ({ key: x.key, icon: x.icon, tone: x.tone, label: ar ? x.ar : x.en, count: counts[x.key] }))} />

      <div className="fd-toolbar">
        <div className="fd-toolbar__row">
          <SearchBox value={searchInput} onChange={setSearchInput} onSubmit={() => { setPage(1); setQuery(searchInput.trim()); }} placeholder={t('Search titles & descriptions')} label={t('Search')} />
          {!loading && !error && <span className="fd-count">{ar ? `${total} منشور` : `${total} post${total === 1 ? '' : 's'}`}</span>}
        </div>
      </div>

      {actionError && <FeedAlert>{actionError}</FeedAlert>}
      {error && <FeedAlert onRetry={load} locale={locale}>{error}</FeedAlert>}
      {loading && <Skeletons n={3} h={130} />}
      {!loading && !error && posts.length === 0 && (
        query || status !== 'all'
          ? <Empty icon="search" title={ar ? 'لا توجد نتائج' : 'Nothing matches'} text={ar ? 'جرّب تغيير البحث أو الفلتر.' : 'Try changing the search or the filter.'} />
          : <Empty icon="message-square" title={t('No posts yet.')} text={ar ? 'انشر أول تحديث أو فعالية ليراها كل طلاب جامعتك.' : 'Share your first update or event with every student at your university.'}>
            <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}><Icon name="plus" size={16} /> {t('New Post')}</button>
          </Empty>
      )}

      {!loading && !error && posts.length > 0 && (
        <div className="fd-stack">
          {posts.map((p) => {
            const draft = Number(p.status ?? 1) === 0;
            const pinned = Number(p.is_pinned);
            const isEvent = Number(p.is_event);
            const scoped = p.target_faculty_id || p.target_department_id || p.target_academic_year;
            const busy = busyId === p.id;
            return (
              <article key={p.id} className={`fd-desk${draft ? ' is-draft' : ''}${pinned ? ' is-pinned' : ''}`}>
                <DateTile value={isEvent ? p.event_starts_at : p.created_at} locale={locale} tone={draft ? 'mute' : ''} />
                <div className="fd-desk__main">
                  <div className="fd-desk__pills">
                    {draft ? <span className="st-pill st-pill--warning">{t('Draft')}</span> : <span className="st-pill st-pill--success">{ar ? 'منشور' : 'Live'}</span>}
                    {pinned ? <span className="st-pill"><Icon name="pin" size={11} /> {t('Pinned')}</span> : null}
                    {isEvent ? <span className="st-pill st-pill--outline"><Icon name="calendar" size={11} /> {t('Event')}</span> : null}
                    {scoped ? <span className="st-pill st-pill--outline"><Icon name="users" size={11} /> {t('Scoped audience')}</span> : null}
                  </div>
                  <h3>{p.title}</h3>
                  {p.body && <p className="fd-desk__body fd-clamp-2">{p.body}</p>}
                  {(atts[p.id] || []).length > 0 && <Attachments items={atts[p.id]} t={t} />}
                  <div className="fd-stats">
                    <span><Icon name="clock" size={13} /> {ago(p.created_at, locale)}</span>
                    {!draft && <>
                      <span title={ar ? 'إعجابات' : 'Likes'}><Icon name="heart" size={13} /> {Number(p.likes_count || 0)}</span>
                      <span title={ar ? 'تعليقات' : 'Comments'}><Icon name="message" size={13} /> {Number(p.comments_count || 0)}</span>
                      <span title={ar ? 'مشاركات' : 'Shares'}><Icon name="share" size={13} /> {Number(p.shares_count || 0)}</span>
                    </>}
                  </div>
                </div>
                <div className="fd-desk__act">
                  {draft
                    ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(p.id, api.post(`/api/v1/feed/${p.id}/publish`))}><Icon name="send" size={14} /> {t('Publish')}</button>
                    : <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(p.id, api.post(`/api/v1/feed/${p.id}/unpublish`))}>{t('To draft')}</button>}
                  <button type="button" className={`fd-act-pin${pinned ? ' is-on' : ''}`} disabled={busy} title={pinned ? t('Unpin') : t('Pin')} aria-label={pinned ? t('Unpin') : t('Pin')} aria-pressed={!!pinned}
                    onClick={() => run(p.id, api.post(`/api/v1/feed/${p.id}/${pinned ? 'unpin' : 'pin'}`))}><Icon name="pin" size={16} /></button>
                  <button type="button" className="fd-iconbtn" disabled={busy} title={t('Delete')} aria-label={`${t('Delete')}: ${p.title}`} onClick={() => setDeleting(p)}><Icon name="trash" size={17} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && !error && <Pager page={page} pages={pages} setPage={setPage} locale={locale} />}

      {composing && <PostSheet faculties={faculties} onClose={() => setComposing(false)} onDone={() => { setComposing(false); setPage(1); refresh(); }} />}
      {deleting && (
        <StModal title={t('Delete this post?')} onClose={() => setDeleting(null)}
          actions={<><button type="button" className="btn btn-outline" onClick={() => setDeleting(null)}>{t('Cancel')}</button>
            <button type="button" className="btn st-btn-danger st-btn-solid" onClick={confirmDelete}>{t('Delete')}</button></>}>
          <strong style={{ color: 'var(--text-primary)' }}>{deleting.title}</strong>
          <p style={{ marginTop: 6 }}>{ar ? 'سيُحذف المنشور لكل من يراه. لا يمكن التراجع.' : 'This removes it for everyone who can see it. This cannot be undone.'}</p>
        </StModal>
      )}
    </div>
  );
}

function PostSheet({ faculties, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isEvent, setIsEvent] = useState(false);
  const [eventStartsAt, setEventStartsAt] = useState('');
  const [eventEndsAt, setEventEndsAt] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [aud, setAud] = useState(EMPTY_AUD);
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState([{ url: '', title: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(saveAsDraft) {
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('body', body);
      fd.append('is_event', isEvent ? '1' : '0');
      if (isEvent) {
        if (eventStartsAt) fd.append('event_starts_at', eventStartsAt);
        if (eventEndsAt) fd.append('event_ends_at', eventEndsAt);
        if (eventLocation) fd.append('event_location', eventLocation);
      }
      fd.append('save_as_draft', saveAsDraft ? '1' : '0');
      appendCommon(fd, { aud, files, links });
      await api.postForm('/api/v1/feed', fd);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Sheet titleId="fd-post-title" title={t('New Post')} subtitle={ar ? 'يظهر لطلاب جامعتك في موجز الجامعة.' : 'Shown to students in your university feed.'} onClose={onClose} saving={saving}
      onSubmit={(e) => { e.preventDefault(); submit(false); }} closeLabel={ar ? 'إغلاق' : 'Close'}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
        <button type="button" className="btn btn-secondary" disabled={saving || !title.trim()} onClick={() => submit(true)}><Icon name="file" size={16} /> {t('Save as draft')}</button>
        <button type="submit" className={`btn btn-primary${saving ? ' is-loading' : ''}`} disabled={saving || !title.trim()}><Icon name="send" size={16} /> {t('Publish')}</button>
      </>}>
      <Section>
        <div className="ua-field">
          <label htmlFor="fp_title">{t('Title')}</label>
          <input id="fp_title" className="ua-input" type="text" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          <span className="ua-count">{title.length}/200</span>
        </div>
        <div className="ua-field">
          <label htmlFor="fp_body">{t('Description')}</label>
          <textarea id="fp_body" className="ua-textarea" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      </Section>

      <Section>
        <label className="ua-switch">
          <input type="checkbox" checked={isEvent} onChange={(e) => setIsEvent(e.target.checked)} />
          <span className="ua-switch__track" aria-hidden="true" />
          <span className="ua-switch__txt">
            <strong>{t('This post is an event')}</strong>
            <small>{ar ? 'أضف موعدًا ومكانًا ليظهر كتذكرة فعالية.' : 'Add a date and place so it shows as an event card.'}</small>
          </span>
        </label>
        {isEvent && (
          <div className="ua-grid">
            <div className="ua-field">
              <label htmlFor="fp_start">{t('Starts at')}</label>
              <input id="fp_start" className="ua-input" type="datetime-local" value={eventStartsAt} onChange={(e) => setEventStartsAt(e.target.value)} />
            </div>
            <div className="ua-field">
              <label htmlFor="fp_end">{t('Ends at')}</label>
              <input id="fp_end" className="ua-input" type="datetime-local" value={eventEndsAt} onChange={(e) => setEventEndsAt(e.target.value)} />
            </div>
            <div className="ua-field is-wide">
              <label htmlFor="fp_loc">{t('Location')}</label>
              <input id="fp_loc" className="ua-input" type="text" value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} />
            </div>
          </div>
        )}
      </Section>

      <Section title={t('Visibility scope (optional — leave blank to show everyone)')}>
        <AudienceFields faculties={faculties} value={aud} onChange={setAud} ar={ar} />
      </Section>

      <Section title={t('Attachments (images, video, PDF, documents)')} hint={`${files.length}/5`}>
        <FileDrop files={files} setFiles={setFiles} ar={ar} />
      </Section>

      <Section title={t('External links (optional)')}>
        <LinkRows links={links} setLinks={setLinks} ar={ar} />
      </Section>

      {error && <div className="ua-alert" role="alert"><Icon name="alert-triangle" size={18} /><span>{error}</span></div>}
    </Sheet>
  );
}
