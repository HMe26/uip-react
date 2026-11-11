import { useEffect, useState, useCallback } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Attachments, CategoryChips, DateTile, Empty, FeedAlert, Pager, SearchBox, Skeletons, catLabel, fmtWhen } from '../../components/feed/feedUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/announcements';
import { parseServerDate } from '../../utils/serverDate';

const translations = { ...i18nCommon, ...i18nPage };
const isNew = (v) => v && Date.now() - parseServerDate(v).getTime() < 3 * 86400000;

export default function StudentAnnouncements() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [items, setItems] = useState([]);
  const [atts, setAtts] = useState({});
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState({});

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/api/v1/announcements', { page, per_page: 10, category, q })
      .then((j) => { setItems(j.data || []); setAtts(j.meta?.attachments || {}); setMeta(j.meta || {}); })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [page, category, q]);
  useEffect(() => { load(); }, [load]);
  const pages = Math.max(1, Math.ceil((meta.total || 0) / (meta.perPage || 10)));

  return (
    <div className="fd-page">
      <div className="fd-head">
        <div className="fd-head__text">
          <h1>{t('University Announcements')}</h1>
          <p>{t('The latest academic announcements, events, and opportunities from your university.')}</p>
        </div>
      </div>

      {meta.unaffiliated ? (
        <Empty icon="building" title={ar ? 'غير منتسب لجامعة' : 'No university yet'} text={ar ? 'لست منتسبًا لجامعة بعد. اطلب الانضمام من صفحة الملف الشخصي لرؤية إعلانات جامعتك.' : "You're not affiliated with a university yet. Request to join one from your profile to see its announcements."} />
      ) : (
        <>
          <div className="fd-toolbar">
            <div className="fd-toolbar__row">
              <SearchBox value={qInput} onChange={setQInput} onSubmit={() => { setQ(qInput.trim()); setPage(1); }} placeholder={t('Search titles & descriptions')} label={t('Search')} />
              {!loading && !error && <span className="fd-count">{ar ? `${meta.total || 0} إعلان` : `${meta.total || 0} announcement${meta.total === 1 ? '' : 's'}`}</span>}
            </div>
            <CategoryChips value={category} onChange={(k) => { setCategory(k); setPage(1); }} locale={locale} allLabel={t('All')} label={t('Category')} />
          </div>
          {error && <FeedAlert onRetry={load} locale={locale}>{error}</FeedAlert>}
          {loading && <Skeletons n={3} h={130} />}
          {!loading && !error && items.length === 0 && <Empty icon="megaphone" title={t('No announcements right now.')} text={ar ? 'سنعرض هنا إعلانات جامعتك فور نشرها.' : 'New announcements from your university will show up here.'} />}
          {!loading && !error && items.length > 0 && (
            <div className="fd-stack">
              {items.map((a) => {
                const when = a.published_at || a.publish_at || a.created_at;
                const long = (a.body || '').length > 220 || (a.body || '').split('\n').length > 4;
                const expanded = !!open[a.id];
                return (
                  <article key={a.id} className="fd-notice" data-cat={a.category}>
                    <DateTile value={when} locale={locale} />
                    <div className="fd-notice__main">
                      <div className="fd-notice__top">
                        <span className="fd-cat">{catLabel(a.category, locale)}</span>
                        {isNew(when) && <span className="fd-new">{ar ? 'جديد' : 'New'}</span>}
                      </div>
                      <h2 className="fd-title">{a.title}</h2>
                      {a.body && <p className={`fd-body${long && !expanded ? ' fd-clamp' : ''}`}>{a.body}</p>}
                      {long && <button type="button" className="fd-more" aria-expanded={expanded} onClick={() => setOpen((p) => ({ ...p, [a.id]: !expanded }))}>{expanded ? (ar ? 'عرض أقل' : 'Show less') : (ar ? 'عرض المزيد' : 'Show more')}</button>}
                      <Attachments items={atts[a.id]} t={t} />
                      <div className="fd-meta">
                        {a.author_name && <span><Icon name="user" size={13} /> {a.author_name}</span>}
                        <span><Icon name="calendar" size={13} /> {fmtWhen(when, locale)}</span>
                        {a.expires_at && <span><Icon name="clock" size={13} /> {ar ? 'حتى ' : 'Until '}{fmtWhen(a.expires_at, locale)}</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!loading && <Pager page={page} pages={pages} setPage={setPage} locale={locale} />}
        </>
      )}
    </div>
  );
}
