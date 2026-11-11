import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { networkApi } from '../../api/networkApi';
import { errorMessage } from '../../api/client';
import { usePageMeta } from '../../context/PageMetaContext';
import { Alert, Empty, useTt } from '../../components/posts/shared';
import PersonCard, { ROLE_LABEL } from '../../components/network/PersonCard';
import PersonProfile from '../../components/network/PersonProfile';
import '../../styles/css/posts.css';
import '../../styles/css/posts-pro.css';
import '../../styles/css/posts-engage.css';
import '../../styles/css/network.css';

const FILTER_ROLES = ['student', 'academic_staff', 'faculty', 'university', 'supervisor', 'data_analyst'];

/** Paged list of people. `load(page)` resolves { items, meta:{has_more} }; remount (key) to reset. */
function PeopleList({ load, mode = 'default', variant = 'row', onOpen, onChanged, empty }) {
  const { tt } = useTt();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fetchPage = useCallback(async (pg) => {
    setLoading(true); setErr('');
    try {
      const r = await loadRef.current(pg);
      if (!alive.current) return;
      setItems((cur) => (pg === 1 ? r.items : [...cur, ...r.items.filter((n) => !cur.some((c) => c.id === n.id))]));
      setMore(!!r.meta?.has_more);
      setPage(pg);
    } catch (e) {
      if (alive.current) setErr(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => { fetchPage(1); }, [fetchPage]);

  const patch = useCallback((id, r) => { setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...r } : x))); onChanged?.(); }, [onChanged]);
  const remove = useCallback((id) => { setItems((cur) => cur.filter((x) => x.id !== id)); onChanged?.(); }, [onChanged]);
  // Keep rows in sync when the profile drawer changes a relation.
  useEffect(() => {
    const h = (e) => { const { id, patch: r } = e.detail || {}; if (id) setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...r } : x))); };
    window.addEventListener('uip:network-patch', h);
    return () => window.removeEventListener('uip:network-patch', h);
  }, []);

  if (err && !items.length) return <Alert tt={tt} onRetry={() => fetchPage(1)}>{err}</Alert>;
  if (loading && !items.length) return <ul className={`nw-list nw-list--${variant}`} aria-busy="true">{[0, 1, 2, 3].map((i) => <li key={i} className="nw-person nw-skel"><span className="pp-skel" /></li>)}</ul>;
  if (!items.length) return empty || <Empty icon="users" title={tt('Nobody here yet', 'لا أحد هنا بعد')} />;
  return (
    <>
      <ul className={`nw-list nw-list--${variant}`}>
        {items.map((p) => <PersonCard key={p.id} p={p} mode={mode} variant={variant} onPatch={patch} onRemove={remove} onOpen={onOpen} />)}
      </ul>
      {err && <Alert tt={tt}>{err}</Alert>}
      {more && <div className="pp-end"><button type="button" className="pp-btn" disabled={loading} onClick={() => fetchPage(page + 1)}>{loading ? tt('Loading…', 'جارٍ التحميل…') : tt('Show more', 'عرض المزيد')}</button></div>}
    </>
  );
}

function SearchField({ value, onChange, placeholder, label }) {
  return (
    <label className="nw-search">
      <Icon name="search" size={16} />
      <input type="search" className="pp-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} maxLength={80} />
      {value && <button type="button" className="pp-icon" onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={14} /></button>}
    </label>
  );
}

/** Debounced value so typing does not fire a request per key. */
function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Discover({ onOpen, onChanged }) {
  const { tt } = useTt();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [relation, setRelation] = useState('all');
  const [sameUni, setSameUni] = useState(false);
  const dq = useDebounced(q.trim());
  const active = dq.length >= 2 || role !== '' || sameUni || relation !== 'all';
  const key = `${dq}|${role}|${relation}|${sameUni}`;
  const search = useCallback((pg) => networkApi.search({ q: dq || undefined, role: role || undefined, relation, same_university: sameUni ? 1 : undefined }, pg), [dq, role, relation, sameUni]);
  const suggest = useCallback(() => networkApi.suggestions(12).then((items) => ({ items: items || [], meta: { has_more: false } })), []);

  return (
    <section className="nw-section">
      <div className="pp-card nw-filters">
        <SearchField value={q} onChange={setQ} placeholder={tt('Search people by name…', 'ابحث عن أشخاص بالاسم…')} />
        <div className="nw-filters__row">
          <select className="pp-input pp-input--sm" value={role} onChange={(e) => setRole(e.target.value)} aria-label={tt('Role', 'الدور')}>
            <option value="">{tt('Any role', 'كل الأدوار')}</option>
            {FILTER_ROLES.map((r) => <option key={r} value={r}>{tt(ROLE_LABEL[r][0], ROLE_LABEL[r][1])}</option>)}
          </select>
          <select className="pp-input pp-input--sm" value={relation} onChange={(e) => setRelation(e.target.value)} aria-label={tt('Relationship', 'العلاقة')}>
            <option value="all">{tt('Everyone', 'الجميع')}</option>
            <option value="connections">{tt('My connections', 'اتصالاتي')}</option>
            <option value="following">{tt('People I follow', 'من أتابعهم')}</option>
            <option value="followers">{tt('My followers', 'متابعيّ')}</option>
          </select>
          <label className={`pp-chip nw-check ${sameUni ? 'is-on' : ''}`}>
            <input type="checkbox" checked={sameUni} onChange={(e) => setSameUni(e.target.checked)} />
            <Icon name="building" size={13} /> {tt('Same university', 'نفس الجامعة')}
          </label>
        </div>
      </div>

      {active ? (
        <PeopleList key={key} load={search} onOpen={onOpen} onChanged={onChanged}
          empty={<Empty icon="search" title={tt('No people found', 'لا نتائج')} text={tt('Try another name or loosen the filters. People who hide themselves from search only appear to their connections.', 'جرّب اسمًا آخر أو خفّف الفلاتر. من أغلق "الظهور في البحث" لا يظهر إلا لاتصالاته.')} />} />
      ) : (
        <>
          <h3 className="nw-h">{tt('People you may know', 'أشخاص قد تعرفهم')}</h3>
          <PeopleList key="suggest" load={suggest} variant="card" onOpen={onOpen} onChanged={onChanged}
            empty={<Empty icon="users" title={tt('No suggestions yet', 'لا اقتراحات بعد')} text={tt('Connect with a few people or search by name — suggestions come from your connections and your university.', 'اتصل ببعض الأشخاص أو ابحث بالاسم — الاقتراحات تأتي من اتصالاتك وجامعتك.')} />} />
        </>
      )}
    </section>
  );
}

function Requests({ summary, onOpen, onChanged }) {
  const { tt } = useTt();
  const [params, setParams] = useSearchParams();
  const showFollow = summary.follow_requests > 0 || summary.settings?.follow_approval;
  const sub = params.get('sub') || 'received';
  const setSub = (s) => { const p = new URLSearchParams(params); p.set('sub', s); setParams(p, { replace: true }); };
  const SUBS = [['received', 'Received', 'الواردة', summary.requests_received], ['sent', 'Sent', 'المرسلة', summary.requests_sent], ...(showFollow ? [['follow', 'Follow requests', 'طلبات المتابعة', summary.follow_requests]] : [])];
  const load = useMemo(() => {
    if (sub === 'sent') return (pg) => networkApi.requests('sent', pg);
    if (sub === 'follow') return (pg) => networkApi.followRequests(pg);
    return (pg) => networkApi.requests('received', pg);
  }, [sub]);
  const mode = sub === 'sent' ? 'sent' : sub === 'follow' ? 'followreq' : 'received';
  const texts = {
    received: [tt('No pending invitations', 'لا دعوات معلّقة'), tt('When someone asks to connect with you, it shows up here.', 'عندما يرسل لك أحد طلب اتصال سيظهر هنا.')],
    sent: [tt('No sent requests', 'لا طلبات مرسلة'), tt('Requests you send stay here until they are accepted.', 'الطلبات التي ترسلها تبقى هنا حتى يتم قبولها.')],
    follow: [tt('No follow requests', 'لا طلبات متابعة'), tt('People who ask to follow you appear here while manual approval is on.', 'من يطلب متابعتك يظهر هنا طالما الموافقة اليدوية مفعّلة.')],
  }[sub];
  return (
    <section className="nw-section">
      <div className="pp-seg" role="tablist" aria-label={tt('Request type', 'نوع الطلبات')}>
        {SUBS.map(([k, en, ar, n]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? 'is-on' : ''} onClick={() => setSub(k)}>
            {tt(en, ar)}{n > 0 && <span className="nw-pill">{n}</span>}
          </button>
        ))}
      </div>
      <PeopleList key={sub} load={load} mode={mode} onOpen={onOpen} onChanged={onChanged} empty={<Empty icon="inbox" title={texts[0]} text={texts[1]} />} />
    </section>
  );
}

function SearchableList({ fetcher, mode, onOpen, onChanged, placeholder, empty }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const load = useCallback((pg) => fetcher(dq, pg), [fetcher, dq]);
  return (
    <section className="nw-section">
      <SearchField value={q} onChange={setQ} placeholder={placeholder} />
      <PeopleList key={dq} load={load} mode={mode} onOpen={onOpen} onChanged={onChanged}
        empty={dq ? <Empty icon="search" title={placeholder} text="" /> : empty} />
    </section>
  );
}

function Toggle({ checked, onChange, title, text, busy }) {
  return (
    <label className="nw-toggle">
      <span><strong>{title}</strong><small>{text}</small></span>
      <input type="checkbox" role="switch" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

function Settings({ summary, onSaved }) {
  const { tt } = useTt();
  const s = summary.settings || {};
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (body) => {
    setBusy(true); setErr('');
    try { const r = await networkApi.saveSettings(body); onSaved(r); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="nw-section">
      <div className="pp-card nw-settings">
        <h3>{tt('Privacy of your network', 'خصوصية شبكتك')}</h3>
        <Toggle busy={busy} checked={!!s.follow_approval} onChange={(v) => save({ follow_approval: v })}
          title={tt('Approve followers manually', 'أوافق على المتابِعين يدويًا')}
          text={tt('New followers become requests you accept or decline. Turning it off accepts every pending request.', 'يتحوّل كل متابِع جديد إلى طلب تقبله أو ترفضه. إيقافه يقبل كل الطلبات المعلّقة تلقائيًا.')} />
        <Toggle busy={busy} checked={s.accept_connection_requests !== false} onChange={(v) => save({ accept_connection_requests: v })}
          title={tt('Allow connection requests', 'السماح بطلبات الاتصال')}
          text={tt('When off, nobody new can send you a connection request. Existing connections are unaffected.', 'عند الإيقاف لا يستطيع أحد جديد إرسال طلب اتصال لك. اتصالاتك الحالية لا تتأثر.')} />
        {err && <Alert tt={tt}>{err}</Alert>}
        <p className="pp-muted">{tt('Message and search visibility are managed in Messages ▸ Privacy settings.', 'خصوصية الرسائل والظهور في البحث تُدار من الرسائل ▸ إعدادات الخصوصية.')}</p>
      </div>
    </section>
  );
}

const TABS = [
  ['discover', 'Discover', 'اكتشف', 'search'],
  ['requests', 'Requests', 'الطلبات', 'user-plus'],
  ['connections', 'Connections', 'الاتصالات', 'user-check'],
  ['followers', 'Followers', 'المتابِعون', 'users'],
  ['following', 'Following', 'المتابَعون', 'user'],
  ['settings', 'Settings', 'الإعدادات', 'settings'],
];

export default function Network() {
  const { tt } = useTt();
  usePageMeta(tt('My network', 'شبكتي'));
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t[0] === params.get('tab')) ? params.get('tab') : 'discover';
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const timer = useRef(null);

  const refresh = useCallback(() => networkApi.summary().then(setSummary).catch((e) => setErr(errorMessage(e))), []);
  useEffect(() => { refresh(); return () => clearTimeout(timer.current); }, [refresh]);
  // Lists call this after every action: refresh the counters once things settle.
  const changed = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(refresh, 250); }, [refresh]);
  const onProfilePatch = useCallback((id, patch) => { window.dispatchEvent(new CustomEvent('uip:network-patch', { detail: { id, patch } })); }, []);
  const go = (t) => { const p = new URLSearchParams(); p.set('tab', t); setParams(p, { replace: false }); };

  const fetchers = useMemo(() => ({
    connections: (q, pg) => networkApi.connections(q, pg),
    followers: (q, pg) => networkApi.followers(q, pg),
    following: (q, pg) => networkApi.following(q, pg),
  }), []);

  const counts = summary ? {
    requests: (summary.requests_received || 0) + (summary.follow_requests || 0),
    connections: summary.connections, followers: summary.followers, following: summary.following,
  } : {};

  return (
    <div className="pp-page nw-page">
      <header className="nw-head">
        <div><h1><Icon name="network" size={24} /> {tt('My network', 'شبكتي')}</h1>
          <p className="pp-muted">{tt('Grow your professional circle, manage who follows you, and start conversations.', 'وسّع دائرتك المهنية، وأدِر من يتابعك، وابدأ المحادثات.')}</p></div>
        {summary && (
          <div className="nw-kpis">
            <button type="button" onClick={() => go('connections')}><strong>{summary.connections}</strong><span>{tt('Connections', 'اتصالات')}</span></button>
            <button type="button" onClick={() => go('followers')}><strong>{summary.followers}</strong><span>{tt('Followers', 'متابِعون')}</span></button>
            <button type="button" onClick={() => go('following')}><strong>{summary.following}</strong><span>{tt('Following', 'متابَعون')}</span></button>
          </div>
        )}
      </header>

      {err && <Alert tt={tt} onRetry={() => { setErr(''); refresh(); }}>{err}</Alert>}

      <div className="nw-layout">
        <nav className="nw-tabs" role="tablist" aria-label={tt('My network', 'شبكتي')}>
          {TABS.map(([k, en, ar, ic]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => go(k)}>
              <Icon name={ic} size={16} /><span>{tt(en, ar)}</span>
              {k === 'requests' ? (counts.requests > 0 && <b className="nw-pill is-alert">{counts.requests}</b>) : (counts[k] != null && <b className="nw-pill">{counts[k]}</b>)}
            </button>
          ))}
        </nav>

        <main className="nw-main">
          {tab === 'discover' && <Discover onOpen={setOpen} onChanged={changed} />}
          {tab === 'requests' && summary && <Requests summary={summary} onOpen={setOpen} onChanged={changed} />}
          {tab === 'connections' && (
            <SearchableList key="c" fetcher={fetchers.connections} mode="connections" onOpen={setOpen} onChanged={changed} placeholder={tt('Search your connections…', 'ابحث في اتصالاتك…')}
              empty={<Empty icon="user-check" title={tt('No connections yet', 'لا اتصالات بعد')} text={tt('Find people in Discover and send a connection request.', 'ابحث عن أشخاص في "اكتشف" وأرسل طلب اتصال.')} />} />
          )}
          {tab === 'followers' && (
            <SearchableList key="f" fetcher={fetchers.followers} mode="followers" onOpen={setOpen} onChanged={changed} placeholder={tt('Search your followers…', 'ابحث في متابعيك…')}
              empty={<Empty icon="users" title={tt('No followers yet', 'لا متابِعين بعد')} text={tt('Share posts to grow your audience.', 'انشر منشورات لتوسيع جمهورك.')} />} />
          )}
          {tab === 'following' && (
            <SearchableList key="g" fetcher={fetchers.following} mode="following" onOpen={setOpen} onChanged={changed} placeholder={tt('Search people you follow…', 'ابحث فيمن تتابعهم…')}
              empty={<Empty icon="user" title={tt('You are not following anyone', 'لا تتابع أحدًا بعد')} text={tt('Follow people to see their posts in your feed.', 'تابع أشخاصًا لتظهر منشوراتهم في الفيد.')} />} />
          )}
          {tab === 'settings' && summary && <Settings summary={summary} onSaved={(s) => { setSummary((cur) => ({ ...cur, settings: s })); changed(); }} />}
          {(tab === 'requests' || tab === 'settings') && !summary && !err && <span className="pp-skel" />}
        </main>
      </div>

      {open && <PersonProfile person={open} onClose={() => setOpen(null)} onPatch={onProfilePatch} onChanged={changed} />}
    </div>
  );
}
