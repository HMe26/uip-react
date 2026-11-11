import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import { PageHead, SearchBox, SevBadge, StatusPill, EmptyState, ErrorNote, tl, fmtShort } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nDesign from '../../i18n/security/design';

const translations = {
  ...i18nCommon, ...i18nDesign,
  'Search': 'بحث', 'Search results': 'نتائج البحث', 'Workspace / Search': 'مساحة العمل / البحث',
  'Type something in the search box above to get started.': 'اكتب في مربع البحث بالأعلى للبدء.',
  'Nothing found for': 'لا توجد نتائج لـ', 'results for': 'نتيجة لـ', 'result for': 'نتيجة لـ', 'Show all': 'عرض الكل', 'Search Security…': 'ابحث في الأمان…',
  'Some sections could not be searched.': 'تعذّر البحث في بعض الأقسام.',
  'Report Files': 'ملفات التقارير', 'Sessions': 'الجلسات', 'Alerts': 'التنبيهات', 'Vulnerabilities': 'الثغرات', 'Incidents': 'الحوادث', 'Audit & Security Logs': 'سجلات التدقيق والأمان',
};

/**
 * /security/search — target of the topbar search (portalBrand.security_*.search.route).
 * The security API has no single search endpoint, so this fans out to the
 * existing list endpoints in parallel (Promise.allSettled: one failing section
 * never blanks the rest) and filters client-side too, so it still works for
 * endpoints that ignore `?q=`. Each section shows the top matches and links to
 * its own page pre-filled with the same query.
 */
const LIMIT = 5;
const has = (q, ...vals) => vals.some((v) => String(v ?? '').toLowerCase().includes(q));

const SECTIONS = [
  { key: 'incidents', icon: 'shield', title: 'Incidents', path: '/api/v1/security/incidents', page: '/security/incidents', params: { per_page: 100 },
    match: (r, q) => has(q, r.title, r.reference_code, r.source_ip, r.assignee_name, r.category),
    to: (r) => `/security/incidents/${r.id}` },
  { key: 'vulnerabilities', icon: 'alert', title: 'Vulnerabilities', path: '/api/v1/security/vulnerabilities', page: '/security/vulnerabilities', params: { per_page: 100 },
    match: (r, q) => has(q, r.title, r.affected_component, r.assignee_name), to: () => '/security/vulnerabilities' },
  { key: 'alerts', icon: 'bell', title: 'Alerts', path: '/api/v1/security/alerts', page: '/security/alerts', qParam: 'q',
    match: (r, q) => has(q, r.title, r.message, r.source_ip, r.subject_name, r.type), to: () => '/security/alerts' },
  { key: 'sessions', icon: 'monitor', title: 'Sessions', path: '/api/v1/security/sessions', page: '/security/sessions',
    match: (r, q) => has(q, r.full_name, r.email, r.ip_address, r.role_slug, r.location_label), to: () => '/security/sessions' },
  { key: 'logs', icon: 'note', title: 'Audit & Security Logs', path: '/api/v1/security/logs', page: '/security/logs', qParam: 'q',
    match: (r, q) => has(q, r.actor, r.user, r.email, r.action, r.event, r.ip, r.module), to: () => '/security/logs' },
  { key: 'files', icon: 'archive', title: 'Report Files', path: '/api/v1/security/report-files', page: '/security/report-files', qParam: 'q', params: { view: 'active' },
    match: (r, q) => has(q, r.title, r.original_filename, r.uploader_name), to: () => '/security/report-files' },
];

function primary(key, r, label) {
  switch (key) {
    case 'incidents': return { title: r.title, sub: r.reference_code, badge: <SevBadge level={r.severity} text={label(r.severity)} />, end: <StatusPill status={r.status} text={label(r.status)} /> };
    case 'vulnerabilities': return { title: r.title, sub: r.affected_component, badge: <SevBadge level={r.severity} text={label(r.severity)} />, end: <StatusPill status={r.status} text={label(r.status)} /> };
    case 'alerts': return { title: r.title, sub: r.message, badge: <SevBadge level={r.severity} text={label(r.severity)} />, end: <StatusPill status={r.status} text={label(r.status)} /> };
    case 'sessions': return { title: r.full_name || r.email, sub: [r.email, r.ip_address].filter(Boolean).join(' · '), badge: null, end: <span className="muted">{fmtShort(r.last_activity_at)}</span> };
    case 'logs': return { title: r.action || r.event, sub: [r.actor || r.user, r.ip].filter(Boolean).join(' · '), badge: <SevBadge level={r.severity} text={label(r.severity)} />, end: <span className="muted">{fmtShort(r.time)}</span> };
    default: return { title: r.title, sub: r.original_filename, badge: <span className="pill pill--neutral">{String(r.file_extension || '').toUpperCase()}</span>, end: <span className="muted">{r.uploader_name}</span> };
  }
}

export default function SecuritySearch() {
  const t = useTranslations(translations);
  const label = tl(t);
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const [input, setInput] = useState(q);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setInput(q);
    if (!q) { setResults(null); return undefined; }
    let cancelled = false;
    setLoading(true); setFailed(false);
    const needle = q.toLowerCase();
    Promise.allSettled(SECTIONS.map((s) => api.get(s.path, { ...(s.params || {}), ...(s.qParam ? { [s.qParam]: q } : {}) })))
      .then((out) => {
        if (cancelled) return;
        setFailed(out.some((o) => o.status === 'rejected'));
        setResults(SECTIONS.map((s, i) => {
          const rows = out[i].status === 'fulfilled' ? (out[i].value.data || []) : [];
          return { ...s, rows: (Array.isArray(rows) ? rows : []).filter((r) => s.match(r, needle)) };
        }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  const submit = () => setParams(input.trim() ? { q: input.trim() } : {});
  const total = results ? results.reduce((n, s) => n + s.rows.length, 0) : 0;

  return (
    <div className="sec-page">
      <PageHead eyebrow={t('Workspace / Search')} title={t('Search results')}
        subtitle={!q ? t('Type something in the search box above to get started.') : loading ? t('Loading…') : `${total} ${total === 1 ? t('result for') : t('results for')} "${q}"`} />
      <div className="sec-toolbar"><SearchBox value={input} onChange={setInput} onSubmit={submit} placeholder={t('Search Security…')} /><button type="button" className="btn btn-primary" onClick={submit}><Icon name="search" size={15} /> {t('Search')}</button></div>
      {failed && <ErrorNote>{t('Some sections could not be searched.')}</ErrorNote>}

      {q && loading && <section className="sec-card"><div className="sec-card__body" style={{ display: 'grid', gap: 12 }}>{[70, 50, 60].map((w) => <span key={w} className="sec-skel" style={{ width: `${w}%` }} />)}</div></section>}
      {q && !loading && results && total === 0 && <section className="sec-card"><EmptyState icon="search">{t('Nothing found for')} "{q}"</EmptyState></section>}

      {!loading && results && results.filter((s) => s.rows.length).map((s) => (
        <section key={s.key} className="sec-card sec-card--flush">
          <div className="sec-card__head" style={{ paddingBottom: 12 }}>
            <div><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name={s.icon} size={17} /> {t(s.title)} <span className="pill pill--neutral">{s.rows.length}</span></h2></div>
            <Link to={`${s.page}?q=${encodeURIComponent(q)}`} className="sec-link">{t('Show all')}</Link>
          </div>
          <ul className="sec-results">
            {s.rows.slice(0, LIMIT).map((r, i) => {
              const p = primary(s.key, r, label);
              return (
                <li key={r.id ?? i}>
                  <Link to={s.to(r)} className="sec-results__row">
                    <span className="sec-results__main"><strong>{p.title}</strong>{p.sub && <span>{p.sub}</span>}</span>
                    {p.badge}{p.end}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
