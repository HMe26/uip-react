import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { StModal } from '../../components/student/stUi';
import { Attachments, CategoryChips, DateTile, Empty, FeedAlert, Pager, SearchBox, Skeletons, StatTabs, CATS, catLabel, fmtWhen } from '../../components/feed/feedUi';
import { AudienceFields, EMPTY_AUD, FileDrop, LinkRows, Section, Sheet, appendCommon } from '../../components/feed/composerParts';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/announcements';

const translations = { ...i18nCommon, ...i18nPage };
const PER_PAGE = 10;
const STATUS = [
  { key: 'all', icon: 'megaphone', en: 'All', ar: 'الكل' },
  { key: 'live', icon: 'check-circle', tone: 'success', en: 'Live', ar: 'منشورة' },
  { key: 'scheduled', icon: 'clock', tone: 'warning', en: 'Scheduled', ar: 'مجدولة' },
  { key: 'expired', icon: 'archive', tone: 'muted', en: 'Expired', ar: 'منتهية' },
];

export default function UniversityAnnouncements() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [items, setItems] = useState([]);
  const [atts, setAtts] = useState({});
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [faculties, setFaculties] = useState([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/api/v1/announcements', { page, per_page: PER_PAGE, q: query || undefined, category: category === 'all' ? undefined : category, status: status === 'all' ? undefined : status })
      .then((j) => { setItems(j.data || []); setTotal(j.meta?.total ?? 0); setAtts(j.meta?.attachments || {}); })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [page, query, category, status]);
  useEffect(() => { load(); }, [load]);

  const loadCounts = useCallback(() => {
    STATUS.forEach(({ key }) => {
      api.get('/api/v1/announcements', { page: 1, per_page: 1, status: key === 'all' ? undefined : key })
        .then((j) => setCounts((c) => ({ ...c, [key]: j.meta?.total ?? 0 })))
        .catch(() => {});
    });
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { api.get('/api/v1/faculty', { per_page: 100 }).then((j) => setFaculties(j.data || [])).catch(() => {}); }, []);

  const refresh = () => { load(); loadCounts(); };

  async function confirmDelete() {
    setBusy(true); setActionError(null);
    try { await api.del(`/api/v1/announcements/${deleting.id}`); setDeleting(null); refresh(); }
    catch (e) { setActionError(errorMessage(e)); setDeleting(null); } finally { setBusy(false); }
  }

  const filtered = !!query || category !== 'all' || status !== 'all';

  return (
    <div className="fd-page fd-page--wide">
      <div className="fd-head">
        <div className="fd-head__text">
          <h1>{t('University Announcements')}</h1>
          <p>{t('Publish categorized announcements, and optionally schedule them for later.')}</p>
        </div>
        <div className="fd-head__act">
          <button type="button" className="btn btn-primary" onClick={() => setComposeOpen(true)}><Icon name="plus" size={16} /> {t('New Announcement')}</button>
        </div>
      </div>

      <StatTabs value={status} onChange={(k) => { setStatus(k); setPage(1); }}
        items={STATUS.map((s) => ({ key: s.key, icon: s.icon, tone: s.tone, label: ar ? s.ar : s.en, count: counts[s.key] }))} />

      <div className="fd-toolbar">
        <div className="fd-toolbar__row">
          <SearchBox value={searchInput} onChange={setSearchInput} onSubmit={() => { setPage(1); setQuery(searchInput.trim()); }} placeholder={t('Search titles & descriptions')} label={t('Search')} />
          {!loading && !error && <span className="fd-count">{ar ? `${total} إعلان` : `${total} announcement${total === 1 ? '' : 's'}`}</span>}
        </div>
        <CategoryChips value={category} onChange={(k) => { setCategory(k); setPage(1); }} locale={locale} allLabel={t('All')} label={t('Category')} />
      </div>

      {actionError && <FeedAlert>{actionError}</FeedAlert>}
      {error && <FeedAlert onRetry={load} locale={locale}>{error}</FeedAlert>}
      {loading && <Skeletons n={3} h={150} />}
      {!loading && !error && items.length === 0 && (
        filtered
          ? <Empty icon="search" title={t('No announcements match')} text={ar ? 'جرّب تغيير البحث أو التصنيف أو الحالة.' : 'Try changing the search, category or status.'} />
          : <Empty icon="megaphone" title={ar ? 'لا توجد إعلانات بعد' : 'No announcements yet'} text={t('Publish your first announcement to reach students and staff.')}>
            <button type="button" className="btn btn-primary" onClick={() => setComposeOpen(true)}><Icon name="plus" size={16} /> {t('New Announcement')}</button>
          </Empty>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="fd-stack">
          {items.map((a) => {
            const future = a.publish_at && new Date(a.publish_at).getTime() > Date.now() && !a.published_at;
            const expired = a.expires_at && new Date(a.expires_at).getTime() <= Date.now();
            const scoped = a.target_faculty_id || a.target_department_id || a.target_academic_year;
            return (
              <article key={a.id} className={`fd-notice${expired ? ' is-expired' : ''}${future ? ' is-scheduled' : ''}`} data-cat={a.category}>
                <DateTile value={future ? a.publish_at : (a.published_at || a.created_at)} locale={locale} tone={future ? 'warn' : expired ? 'mute' : ''} />
                <div className="fd-notice__main">
                  <div className="fd-notice__top">
                    <span className="fd-cat">{catLabel(a.category, locale)}</span>
                    {future && <span className="st-pill st-pill--warning"><Icon name="clock" size={11} /> {t('Scheduled')} · {fmtWhen(a.publish_at, locale)}</span>}
                    {expired && <span className="st-pill st-pill--neutral">{t('Expired')}</span>}
                    {!future && !expired && <span className="st-pill st-pill--success">{ar ? 'منشور' : 'Live'}</span>}
                    <button type="button" className="fd-iconbtn" aria-label={`${t('Delete')}: ${a.title}`} title={t('Delete')} onClick={() => setDeleting(a)}><Icon name="trash" size={17} /></button>
                  </div>
                  <h2 className="fd-title">{a.title}</h2>
                  {a.body && <p className="fd-body fd-clamp">{a.body}</p>}
                  <Attachments items={atts[a.id]} t={t} />
                  <div className="fd-meta">
                    <span><Icon name={scoped ? 'users' : 'globe'} size={13} /> {scoped ? t('Scoped audience') : (ar ? 'للجميع' : 'Everyone')}</span>
                    {a.expires_at && !expired && <span><Icon name="clock" size={13} /> {ar ? 'ينتهي ' : 'Expires '}{fmtWhen(a.expires_at, locale)}</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && !error && <Pager page={page} pages={pages} setPage={setPage} locale={locale} />}

      {composeOpen && <ComposeSheet faculties={faculties} onClose={() => setComposeOpen(false)} onDone={() => { setComposeOpen(false); setPage(1); refresh(); }} />}
      {deleting && (
        <StModal title={t('Delete this announcement?')} onClose={() => !busy && setDeleting(null)}
          actions={<><button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDeleting(null)}>{t('Cancel')}</button>
            <button type="button" className="btn st-btn-danger st-btn-solid" disabled={busy} onClick={confirmDelete}>{t('Delete')}</button></>}>
          <strong style={{ color: 'var(--text-primary)' }}>{deleting.title}</strong>
          <p style={{ marginTop: 6 }}>{t('This removes it for everyone who can see it. This cannot be undone.')}</p>
        </StModal>
      )}
    </div>
  );
}

function ComposeSheet({ faculties, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('academic');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState('now'); // 'now' | 'later'
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [aud, setAud] = useState(EMPTY_AUD);
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState([{ url: '', title: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (when === 'later' && !publishAt) { setError(t('Choose when to publish.')); return; }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('category', category);
      fd.append('body', body);
      if (when === 'later' && publishAt) fd.append('publish_at', publishAt);
      if (expiresAt) fd.append('expires_at', expiresAt);
      appendCommon(fd, { aud, files, links });
      await api.postForm('/api/v1/announcements', fd);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Sheet titleId="ua-compose-title" title={t('New Announcement')} subtitle={t('Visible to students and staff in your university.')} onClose={onClose} saving={saving} onSubmit={handleSubmit} closeLabel={t('Close')}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
        <button type="submit" className={`btn btn-primary${saving ? ' is-loading' : ''}`} disabled={saving || !title.trim()}>
          <Icon name={when === 'later' ? 'clock' : 'send'} size={16} /> {when === 'later' ? t('Schedule') : t('Publish')}
        </button>
      </>}>
      <Section>
        <div className="ua-field">
          <label htmlFor="ua_title">{t('Title')}</label>
          <input id="ua_title" className="ua-input" type="text" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          <span className="ua-count">{title.length}/200</span>
        </div>
        <div className="ua-field">
          <span className="ua-label" id="ua_cat_label">{t('Category')}</span>
          <div className="ua-cats" role="group" aria-labelledby="ua_cat_label">
            {Object.entries(CATS).map(([key, val]) => (
              <button key={key} type="button" className="ua-cat" aria-pressed={category === key} onClick={() => setCategory(key)}>{val[locale] || val.en}</button>
            ))}
          </div>
        </div>
        <div className="ua-field">
          <label htmlFor="ua_body">{t('Description')}</label>
          <textarea id="ua_body" className="ua-textarea" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      </Section>

      <Section title={t('Timing')}>
        <div className="ua-seg" role="group" aria-label={t('Timing')}>
          <button type="button" aria-pressed={when === 'now'} onClick={() => setWhen('now')}>{t('Publish now')}</button>
          <button type="button" aria-pressed={when === 'later'} onClick={() => setWhen('later')}>{t('Schedule')}</button>
        </div>
        <div className="ua-grid">
          {when === 'later' && (
            <div className="ua-field">
              <label htmlFor="ua_pub">{t('Publish at')}</label>
              <input id="ua_pub" className="ua-input" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} required />
            </div>
          )}
          <div className="ua-field">
            <label htmlFor="ua_exp">{t('Expires at (optional)')}</label>
            <input id="ua_exp" className="ua-input" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            <small>{t('Leave empty to never expire.')}</small>
          </div>
        </div>
      </Section>

      <Section title={t('Audience')} hint={t('Leave blank to show everyone')}>
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
