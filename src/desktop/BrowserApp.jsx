import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import Icon from '../components/Icon';
import { useSandbox } from '../components/zipbench/runner/useSandbox';
import { api, errorMessage } from '../api/client';
import { drive } from '../lib/driveApi';
import { saveBlob } from '../lib/exporter';
import { zipSync, strToU8 } from 'fflate';
import { useAuth } from '../context/AuthContext';
import './webApps.css';
import './browserApp.css';

/**
 * Browser app. Two ways to show a page, chosen automatically:
 *   direct  — the page allows framing (checked by Full-API, GET /drive/web-probe): an <iframe>, instant, no server resources.
 *   cloud   — everything else (Blender-style web apps, Google, YouTube…): a real Chromium in the student's own container,
 *             streamed by noVNC (uip-RUN `browser` kind). Slower to start (a few seconds) and uses server CPU, so it is only used when needed.
 * The home page has its own search (GET /drive/web-search → results as cards), quick-launch tiles and recent sites.
 */
const TOKEN_PATH = '/api/v1/drive/browser-token';
const RECENT_KEY = 'uip.browser.recent';

// `cloud: true` = known not to allow framing (or needs real browser features): skip the probe.
// `external: true` = GPU-heavy 3D editors: a cloud browser has no GPU (software WebGL + video stream = slow), so they open in the person's own browser tab.
const TILES = [
  { id: 'photopea', name: 'Photopea', url: 'https://www.photopea.com/', color: '#18a497', hint: ['Photo editor', 'محرر صور'] },
  { id: 'excalidraw', name: 'Excalidraw', url: 'https://excalidraw.com/', color: '#6965db', hint: ['Whiteboard', 'سبورة رسم'] },
  { id: 'threejs', name: 'three.js editor', url: 'https://threejs.org/editor/', color: '#111827', hint: ['3D editor', 'محرر 3D'] },
  { id: 'blender', name: 'Blender', url: 'https://www.blender.org/', color: '#ea7600', hint: ['Official site', 'الموقع الرسمي'], external: true },
  { id: 'spline', name: 'Spline', url: 'https://spline.design/', color: '#7c3aed', hint: ['3D in the browser', 'تصميم 3D في المتصفح'], external: true },
  { id: 'playcanvas', name: 'PlayCanvas', url: 'https://playcanvas.com/', color: '#f97316', hint: ['3D / game editor', 'محرر ألعاب 3D'], external: true },
  { id: 'sketchfab', name: 'Sketchfab', url: 'https://sketchfab.com/', color: '#1caad9', hint: ['3D models', 'موديلات 3D'], external: true },
  { id: 'desmos', name: 'Desmos', url: 'https://www.desmos.com/calculator', color: '#2f7d4d', hint: ['Graphing', 'رسم بياني'] },
  { id: 'geogebra', name: 'GeoGebra', url: 'https://www.geogebra.org/classic', color: '#6557d2', hint: ['Math', 'رياضيات'] },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/', color: '#475569', hint: ['Encyclopedia', 'موسوعة'] },
  { id: 'github', name: 'GitHub', url: 'https://github.com/', color: '#24292f', hint: ['Code', 'كود'], cloud: true },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', color: '#dc2626', hint: ['Videos', 'فيديوهات'], cloud: true },
  { id: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/', color: '#f48024', hint: ['Q&A', 'أسئلة'], cloud: true },
  { id: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org/', color: '#1f2937', hint: ['Web docs', 'توثيق الويب'] },
];

const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 12) : []; } catch { return []; } };
const writeRecent = (v) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const payload = (r) => r?.data ?? r;
/** The UIPE Browser Helper extension is installed: pages are shown directly in the window (own GPU), the cloud browser is only a fallback. */
const hasHelper = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-uipe-embed-helper') === '1';
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** what the person typed -> { url } for an address, { q } for a search */
function parseInput(raw) {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\/\S+$/i.test(t)) return { url: t };
  if (!/\s/.test(t) && /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(t) && !/^\d+(\.\d+)*$/.test(t)) return { url: `https://${t}` };
  return { q: t };
}

/* ---- tabs ------------------------------------------------------------------------------------------------------------ */
const TABS_KEY = (uid) => `uip.browser.tabs.v2.${uid ?? 'anon'}`;
const MAX_TABS = 12;
let seq = 0;
const mkId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
const HOME = { kind: 'home' };
const newTab = (cur = HOME) => ({ id: mkId(), cur, hist: [cur], pos: 0, title: '', res: null, loading: false });
const titleOf = (cur) => (cur.kind === 'results' ? cur.q : cur.kind === 'direct' || cur.kind === 'cloud' ? hostOf(cur.url) : '');
const inputFor = (cur) => (cur.kind === 'results' ? cur.q : cur.kind === 'direct' || cur.kind === 'cloud' ? cur.url : '');
const cleanCur = (c) => {
  if (c && c.kind === 'results' && typeof c.q === 'string' && c.q) return { kind: 'results', q: c.q.slice(0, 200), page: Math.max(1, Math.min(10, Number(c.page) || 1)) };
  if (c && (c.kind === 'direct' || c.kind === 'cloud') && /^https?:\/\//i.test(String(c.url || ''))) return { kind: c.kind, url: String(c.url) };
  return HOME;
};

/** the tabs of the last session (per account): closing the window or refreshing no longer loses what was open */
function loadTabs(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(TABS_KEY(uid)) || 'null');
    if (v && Array.isArray(v.tabs) && v.tabs.length) {
      const tabs = v.tabs.slice(0, MAX_TABS).map((t) => {
        const cur = cleanCur(t.cur);
        const hist = (Array.isArray(t.hist) ? t.hist : [cur]).slice(-50).map(cleanCur);
        const pos = Math.max(0, Math.min(hist.length - 1, Number(t.pos) || 0));
        return { id: String(t.id || mkId()), cur, hist: hist.length ? hist : [cur], pos, title: String(t.title || titleOf(cur)).slice(0, 80), res: null, loading: false };
      });
      return { tabs, active: tabs.some((t) => t.id === v.active) ? v.active : tabs[0].id };
    }
  } catch { /* corrupted: start fresh */ }
  const t = newTab();
  return { tabs: [t], active: t.id };
}
function saveTabs(uid, tabs, active) {
  try {
    const slim = tabs.map((t) => { const start = Math.max(0, t.hist.length - 20); return { id: t.id, cur: t.cur, hist: t.hist.slice(start), pos: Math.max(0, t.pos - start), title: t.title }; });
    localStorage.setItem(TABS_KEY(uid), JSON.stringify({ tabs: slim, active }));
  } catch { /* private mode */ }
}

const favicon = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
function siteName(domain) {
  const p = String(domain || '').split('.');
  const n = p.length > 2 && SLD.has(p[p.length - 2]) ? p[p.length - 3] : (p[p.length - 2] || domain || '');
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : domain;
}
function crumbs(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).slice(0, 3).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    return [u.origin.replace(/^https?:\/\/(www\.)?/, (m) => m.replace(/www\./, '')), ...segs].join(' › ');
  } catch { return url; }
}
/** Google-style: the words that were searched for are bold inside the snippet */
function Hl({ text, q }) {
  const terms = [...new Set(String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1))].slice(0, 6);
  if (!terms.length || !text) return text || null;
  const re = new RegExp(`(${terms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
}
function Fav({ domain, size = 16 }) {
  const [bad, setBad] = useState(false);
  if (!domain || bad) return <span className="wb-fav wb-fav--fb" style={{ width: size, height: size }}>{(domain || '?').slice(0, 1).toUpperCase()}</span>;
  return <img className="wb-fav" src={favicon(domain)} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
}

export default function BrowserApp({ tt, ar, req }) {
  const { user } = useAuth();
  const uid = user?.id;
  // keepAlive: closing the Browser window only detaches from the cloud browser; reopening re-attaches (the gateway keeps it ~10 min)
  const sbx = useSandbox('browser', TOKEN_PATH, { keepAlive: true });
  const helper = useMemo(hasHelper, []);
  const { phase, busy, previewUrl, error } = sbx;
  const sbxRef = useRef(sbx); sbxRef.current = sbx;

  const init = useRef(null);
  if (!init.current) init.current = loadTabs(uid);
  const [tabs, setTabs] = useState(init.current.tabs);
  const [activeId, setActiveId] = useState(init.current.active);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const [loaded, setLoaded] = useState(() => new Set([init.current.active])); // iframes are created lazily, the first time their tab is shown
  const [reloadKey, setReloadKey] = useState({});
  const [input, setInput] = useState('');
  const [recent, setRecent] = useState(readRecent);
  const [msg, setMsg] = useState('');
  const [cloudUp, setCloudUp] = useState(false);
  const [dl, setDl] = useState('');
  const stageRef = useRef(null);
  const pendingUrl = useRef('');
  const omniRef = useRef(null);

  const active = tabs.find((t) => t.id === activeId) || tabs[0];
  const cur = active.cur;

  // remember tabs
  useEffect(() => { saveTabs(uid, tabs, active.id); }, [uid, tabs, active.id]);
  useEffect(() => { setLoaded((s) => (s.has(active.id) ? s : new Set(s).add(active.id))); }, [active.id]);
  useEffect(() => { setInput(inputFor(active.cur)); }, [active.id, active.cur]);

  const patch = useCallback((id, p) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t))), []);
  const commit = useCallback((id, c) => patch(id, (t) => {
    const hist = [...t.hist.slice(0, t.pos + 1), c].slice(-50);
    return { cur: c, hist, pos: hist.length - 1, title: titleOf(c), loading: false };
  }), [patch]);

  const remember = useCallback((url) => {
    setRecent((old) => { const next = [{ url, host: hostOf(url), at: Date.now() }, ...old.filter((x) => x.url !== url)].slice(0, 12); writeRecent(next); return next; });
  }, []);

  // ---- cloud browser (ONE real Chromium for all cloud tabs; it has its own tab bar inside) ----------------------------
  const startCloud = useCallback((url) => {
    const el = stageRef.current;
    const w = Math.max(800, Math.min(2560, Math.round((el?.clientWidth || 1280) / 2) * 2));
    const h = Math.max(500, Math.min(1500, Math.round((el?.clientHeight || 720) / 2) * 2));
    const zip = zipSync({ 'README.txt': strToU8('Cloud browser workspace. Files you download are in Downloads/.\n') });
    setCloudUp(true);
    sbxRef.current.start({ kind: 'browser', entry: `u:${b64(url)}`, zip, cols: 80, rows: 24, screen: `${w}x${h}` });
  }, []);
  const ensureCloud = useCallback((url) => {
    remember(url);
    const s = sbxRef.current;
    if (s.phase === 'running') s.openUrl(url);
    else if (!['connecting', 'starting'].includes(s.phase)) startCloud(url);
    else pendingUrl.current = url;
  }, [remember, startCloud]);
  useEffect(() => { if (phase === 'running' && pendingUrl.current) { sbxRef.current.openUrl(pendingUrl.current); pendingUrl.current = ''; } }, [phase]);
  // window reopened / page refreshed: the gateway may still hold the session
  useEffect(() => { if (sbxRef.current.resumable()) { setCloudUp(true); sbxRef.current.resumeSaved(); } }, []);
  // a restored cloud tab with no live session starts a new one the first time it is shown
  const cloudWanted = cur.kind === 'cloud';
  useEffect(() => {
    if (cloudWanted && !cloudUp && !sbxRef.current.resumable() && !['connecting', 'starting', 'running'].includes(sbxRef.current.phase)) startCloud(cur.url);
  }, [cloudWanted, cloudUp, cur.url, startCloud]);
  const stopCloud = useCallback(() => { sbxRef.current.reset(); setCloudUp(false); }, []);

  // ---- search results ---------------------------------------------------------------------------------------------------
  const fetchResults = useCallback(async (id, q, page) => {
    const mine = (t) => t.cur.kind === 'results' && t.cur.q === q && (t.cur.page || 1) === page;
    patch(id, (t) => (mine(t) ? { res: { items: null } } : {}));
    try {
      const d = payload(await api.get('/api/v1/drive/web-search', { q, lang: ar ? 'ar' : 'en', page }));
      patch(id, (t) => (mine(t) ? { res: { items: d?.results || [], configured: d?.configured !== false, failed: !!d?.failed } } : {}));
    } catch (e) { patch(id, (t) => (mine(t) ? { res: { items: [], configured: true, error: errorMessage(e) } } : {})); }
  }, [ar, patch]);
  // a results tab restored from the last session (or reached by Back) loads its results when it is shown
  useEffect(() => { if (cur.kind === 'results' && !active.res) fetchResults(active.id, cur.q, cur.page || 1); }, [active.id, cur, active.res, fetchResults]);

  // ---- navigation ---------------------------------------------------------------------------------------------------------
  const go = useCallback((id, entry, { record = true } = {}) => {
    setMsg('');
    if (entry.kind === 'cloud' && (record || !cloudUp)) ensureCloud(entry.url);
    if (record) commit(id, entry); else patch(id, { cur: entry, title: titleOf(entry), loading: false });
    if (entry.kind === 'results') patch(id, { res: null }); // the effect above loads them
  }, [cloudUp, commit, ensureCloud, patch]);

  const openUrl = useCallback(async (id, url, { cloud = false } = {}) => {
    setMsg('');
    if (cloud) { go(id, { kind: 'cloud', url }); return; }
    patch(id, { loading: true });
    let embeddable = false;
    try {
      const d = payload(await api.get('/api/v1/drive/web-probe', { url }));
      embeddable = !!(d?.ok && d?.embeddable);
      if (d?.ok === false && d?.reason === 'blocked') { patch(id, { loading: false }); setMsg(tt('That address cannot be opened.', 'العنوان ده مينفعش يتفتح.')); return; }
    } catch { /* probe failed: the cloud browser always works */ }
    if (!embeddable && !helper) { go(id, { kind: 'cloud', url }); return; }
    remember(url); go(id, { kind: 'direct', url });
  }, [go, helper, patch, remember, tt]);

  const runInput = useCallback((id, raw) => {
    const p = parseInput(raw);
    if (!p) return;
    if (p.url) openUrl(id, p.url); else go(id, { kind: 'results', q: p.q, page: 1 });
  }, [go, openUrl]);

  const addTab = useCallback((entry) => {
    if (tabsRef.current.length >= MAX_TABS) { setMsg(tt(`Up to ${MAX_TABS} tabs.`, `الحد الأقصى ${MAX_TABS} تبويب.`)); return null; }
    const t = newTab();
    setTabs((ts) => [...ts, t]); setActiveId(t.id);
    if (entry) setTimeout(() => (entry.url ? openUrl(t.id, entry.url, { cloud: !!entry.cloud }) : runInput(t.id, entry.q)), 0);
    else setTimeout(() => omniRef.current?.focus(), 30);
    return t.id;
  }, [openUrl, runInput, tt]);

  const closeTab = useCallback((id) => {
    const ts = tabsRef.current;
    const i = ts.findIndex((t) => t.id === id);
    if (i < 0) return;
    const next = ts.filter((t) => t.id !== id);
    let nextActive = activeId;
    if (!next.length) { const n = newTab(); next.push(n); nextActive = n.id; } else if (id === activeId) nextActive = next[Math.min(i, next.length - 1)].id;
    setTabs(next); setActiveId(nextActive);
    if (!next.some((t) => t.cur.kind === 'cloud') && cloudUp) stopCloud(); // last cloud tab closed: free the server
  }, [activeId, cloudUp, stopCloud]);

  const step = (d) => {
    const n = active.pos + d;
    if (n < 0 || n >= active.hist.length) return;
    patch(active.id, { pos: n });
    go(active.id, active.hist[n], { record: false });
  };
  const goHome = () => { setMsg(''); commit(active.id, HOME); };
  const reload = () => {
    if (cur.kind === 'direct') setReloadKey((k) => ({ ...k, [active.id]: (k[active.id] || 0) + 1 }));
    else if (cur.kind === 'results') fetchResults(active.id, cur.q, cur.page || 1);
  };
  const openLink = (e, url, cloud = false) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.button === 1) addTab({ url, cloud }); else openUrl(active.id, url, { cloud });
  };

  // opened from elsewhere (an address given by another app) -> a new tab
  const handled = useRef(null);
  useEffect(() => { if (req?.url && handled.current !== req.nonce) { handled.current = req.nonce; const cu = tabsRef.current.find((t) => t.id === activeId); if (cu && cu.cur.kind === 'home' && tabsRef.current.length === 1) runInput(cu.id, req.url); else addTab(parseInput(req.url)); } }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- downloads of the cloud browser -> My PC ------------------------------------------------------------------------
  const saveDownloads = async () => {
    setDl(tt('Collecting your downloads…', 'بجمّع التنزيلات…')); setMsg('');
    try {
      const files = Object.entries(unzipSync(await sbx.pull())).filter(([p, d]) => p.startsWith('Downloads/') && !p.endsWith('/') && d.length);
      if (!files.length) { setDl(''); setMsg(tt('Nothing was downloaded in the cloud browser yet.', 'لسه مفيش حاجة اتنزّلت في المتصفح السحابي.')); return; }
      let folderId = null;
      try { folderId = payload(await drive.ensurePath(null, 'Cloud browser downloads'))?.id ?? null; } catch { /* fall back to a ZIP on this device */ }
      if (!folderId) { saveBlob(new Blob([zipSync(Object.fromEntries(files))], { type: 'application/zip' }), 'cloud-browser-downloads.zip'); setDl(''); return; }
      for (const [p, d] of files) await drive.upload(folderId, new File([d], p.split('/').pop())); // eslint-disable-line no-await-in-loop
      window.dispatchEvent(new Event('uip-drive-changed'));
      setDl(tt(`Saved ${files.length} file(s) to My PC ▸ Cloud browser downloads.`, `اتحفظ ${files.length} ملف في جهازي ◂ Cloud browser downloads.`)); setTimeout(() => setDl(''), 6000);
    } catch (e) { setDl(''); setMsg(errorMessage(e) || tt('Could not read the downloads.', 'معرفتش أقرا التنزيلات.')); }
  };

  const cloudSrc = previewUrl ? `${previewUrl}/vnc.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=1000&path=websockify&show_dot=true&quality=6&compression=2` : '';
  const cloudLive = ['running', 'starting', 'connecting', 'disconnected'].includes(phase);
  const showUrl = cur.kind === 'direct' || cur.kind === 'cloud';
  const tabLabel = (t) => t.title || (t.cur.kind === 'home' ? tt('New tab', 'تبويب جديد') : titleOf(t.cur));
  const res = active.res;
  const page = cur.page || 1;

  const onKey = (e) => { // Alt+T new tab · Alt+W close tab (Ctrl+T/W belong to the real browser)
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') { e.preventDefault(); addTab(); } else if (k === 'w') { e.preventDefault(); closeTab(active.id); }
  };

  return (
    <div className="os-wa os-wa--web wb" onKeyDown={onKey}>
      {/* tab strip */}
      <div className="wb-tabs" role="tablist" aria-label={tt('Tabs', 'التبويبات')}>
        {tabs.map((t) => (
          <div key={t.id} role="tab" tabIndex={0} aria-selected={t.id === active.id} className={`wb-tab${t.id === active.id ? ' is-on' : ''}`} title={tabLabel(t)}
            onClick={() => setActiveId(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveId(t.id); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}>
            {t.loading ? <span className="wb-spin wb-spin--sm" /> : t.cur.kind === 'direct' || t.cur.kind === 'cloud' ? <Fav domain={hostOf(t.cur.url)} /> : <Icon name={t.cur.kind === 'results' ? 'search' : 'globe'} size={14} />}
            <span className="wb-tab__t" dir="auto">{tabLabel(t)}</span>
            <button type="button" className="wb-tab__x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label={tt('Close tab', 'إغلاق التبويب')} title={tt('Close tab', 'إغلاق التبويب')}><Icon name="x" size={12} /></button>
          </div>
        ))}
        <button type="button" className="wb-newtab" onClick={() => addTab()} title={tt('New tab (Alt+T)', 'تبويب جديد (Alt+T)')} aria-label={tt('New tab', 'تبويب جديد')}><Icon name="plus" size={16} /></button>
      </div>

      {/* toolbar */}
      <form className="wb-bar" onSubmit={(e) => { e.preventDefault(); runInput(active.id, input); }}>
        <button type="button" onClick={() => step(-1)} disabled={active.pos <= 0} title={tt('Back', 'رجوع')} aria-label={tt('Back', 'رجوع')}><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={16} /></button>
        <button type="button" onClick={() => step(1)} disabled={active.pos >= active.hist.length - 1} title={tt('Forward', 'قدّام')} aria-label={tt('Forward', 'قدّام')}><Icon name={ar ? 'arrow-left' : 'arrow-right'} size={16} /></button>
        <button type="button" onClick={reload} disabled={cur.kind !== 'direct' && cur.kind !== 'results'} title={tt('Reload', 'إعادة تحميل')} aria-label={tt('Reload', 'إعادة تحميل')}><Icon name="refresh" size={15} /></button>
        <button type="button" onClick={goHome} title={tt('Home', 'الرئيسية')} aria-label={tt('Home', 'الرئيسية')}><Icon name="home" size={16} /></button>
        <div className="wb-omni">
          <Icon name={showUrl ? 'lock' : 'search'} size={14} />
          <input ref={omniRef} value={input} onChange={(e) => setInput(e.target.value)} onFocus={(e) => e.target.select()} placeholder={tt('Search the web or type an address', 'ابحث في الويب أو اكتب عنوان')} dir="auto" spellCheck={false} aria-label={tt('Address', 'العنوان')} />
          {cur.kind === 'cloud' && <span className="wb-badge wb-badge--cloud" title={tt('A real browser running on the server', 'متصفح حقيقي شغال على السيرفر')}><Icon name="cloud" size={12} />{tt('Cloud', 'سحابي')}</span>}
        </div>
        {cur.kind === 'direct' && <button type="button" onClick={() => openUrl(active.id, cur.url, { cloud: true })} title={tt('Open this page in the cloud browser (for sites that do not work here)', 'افتح الصفحة في المتصفح السحابي (للمواقع اللي مش شغالة هنا)')}><Icon name="cloud" size={15} /><span className="wb-lbl">{tt('Cloud', 'سحابي')}</span></button>}
        {showUrl && <a className="wb-btn" href={cur.url} target="_blank" rel="noopener noreferrer" title={tt('Open in your own browser tab', 'فتح في تبويب متصفحك')}><Icon name="external-link" size={15} /></a>}
        {cloudUp && cloudLive && <button type="button" onClick={saveDownloads} title={tt('Save files you downloaded in the cloud browser to My PC', 'احفظ الملفات اللي نزّلتها في المتصفح السحابي في جهازي')}><Icon name="download" size={15} /><span className="wb-lbl">{tt('Downloads', 'التنزيلات')}</span></button>}
        {cloudUp && cloudLive && <button type="button" onClick={() => { stopCloud(); setTabs((ts) => ts.map((t) => (t.cur.kind === 'cloud' ? { ...t, cur: HOME, hist: [HOME], pos: 0, title: '' } : t))); }} title={tt('Stop the cloud browser and free its resources', 'اقفل المتصفح السحابي وحرّر موارده')}><Icon name="stop" size={15} /></button>}
      </form>
      {(msg || dl) && <div className={`wb-note${dl ? ' is-ok' : ''}`} role="status">{dl || msg}</div>}

      <div className="wb-stage" ref={stageRef}>
        {cur.kind === 'home' && (
          <div className="wb-home">
            <div className="wb-logo"><Icon name="globe" size={38} /><h1>{tt('UIPE Search', 'بحث UIPE')}</h1></div>
            <form className="wb-big" onSubmit={(e) => { e.preventDefault(); runInput(active.id, input); }}>
              <Icon name="search" size={20} />
              <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={tt('Search the web or type an address', 'ابحث في الويب أو اكتب عنوان')} dir="auto" spellCheck={false} />
              <button type="submit">{tt('Search', 'بحث')}</button>
            </form>
            <div className="wb-tiles">
              {TILES.map((t) => (
                <button type="button" key={t.id} className="wb-tile" title={tt(t.hint[0], t.hint[1])}
                  onClick={(e) => (t.external && !helper ? window.open(t.url, '_blank', 'noopener,noreferrer') : openLink(e, t.url, !!t.cloud && !helper))}
                  onAuxClick={(e) => { if (e.button === 1 && !(t.external && !helper)) openLink(e, t.url, !!t.cloud && !helper); }}>
                  <b style={{ background: t.color }}>{t.name.slice(0, 1)}</b><span>{t.name}</span>{t.external && <i aria-hidden="true">↗</i>}
                </button>
              ))}
            </div>
            {recent.length > 0 && (
              <div className="wb-recent"><h3>{tt('Recent', 'الأخيرة')}</h3>
                <div>{recent.map((r) => <button type="button" key={r.url} onClick={(e) => openLink(e, r.url)} title={r.url}><Fav domain={r.host} size={14} />{r.host}</button>)}</div>
              </div>
            )}
            <p className="wb-foot">{helper
              ? tt('Pages that allow it open instantly; everything else opens in a real cloud browser.', 'الصفحات اللي بتسمح بتفتح فورًا، وأي حاجة تانية بتتفتح في متصفح سحابي حقيقي.')
              : tt('Pages that allow it open instantly; everything else opens in a real cloud browser. For more speed install the UIPE Browser Helper extension (Chrome / Edge).', 'الصفحات اللي بتسمح بتفتح فورًا، وأي حاجة تانية بتتفتح في متصفح سحابي حقيقي. للسرعة أكتر ركّب إضافة UIPE Browser Helper (Chrome / Edge).')}</p>
          </div>
        )}

        {cur.kind === 'results' && (
          <div className="wb-results">
            <div className="wb-rhead">
              <button type="button" className="wb-rlogo" onClick={goHome} title={tt('Home', 'الرئيسية')}><Icon name="globe" size={22} /><span>UIPE</span></button>
              <form className="wb-rbox" onSubmit={(e) => { e.preventDefault(); runInput(active.id, input); }}>
                <input value={input} onChange={(e) => setInput(e.target.value)} dir="auto" spellCheck={false} aria-label={tt('Search', 'بحث')} />
                {input && <button type="button" className="wb-rbox__x" onClick={() => { setInput(''); omniRef.current?.focus(); }} aria-label={tt('Clear', 'مسح')}><Icon name="x" size={15} /></button>}
                <button type="submit" className="wb-rbox__go" aria-label={tt('Search', 'بحث')}><Icon name="search" size={18} /></button>
              </form>
            </div>
            <div className="wb-rtabs">
              <span className="is-on">{tt('All', 'الكل')}</span>
              <button type="button" onClick={(e) => openLink(e, `https://www.google.com/search?q=${encodeURIComponent(cur.q)}`, true)}><Icon name="cloud" size={13} />{tt('Search on Google (cloud browser)', 'ابحث في جوجل (المتصفح السحابي)')}</button>
            </div>
            <div className="wb-rbody">
              {res && res.items === null && Array.from({ length: 5 }, (_, i) => <div className="wb-skel" key={i}><i /><b /><u /><u /></div>)}
              {!res && <div className="wb-wait"><span className="wb-spin" /></div>}
              {res && res.items && (!res.configured || res.failed) && (
                <div className="wb-warn"><Icon name="alert-triangle" size={20} />
                  <div><b>{res.failed ? tt('Web search is unavailable right now.', 'البحث في الويب مش شغال دلوقتي.') : tt('Web search is not set up on this server yet.', 'البحث في الويب لسه مش متظبط على السيرفر.')}</b>
                    <p>{tt('Type a full address to open a site, or search with the cloud browser.', 'اكتب عنوان كامل لفتح موقع، أو ابحث من المتصفح السحابي.')}</p>
                    <button type="button" className="wb-cta" onClick={(e) => openLink(e, `https://www.google.com/search?q=${encodeURIComponent(cur.q)}`, true)}><Icon name="cloud" size={14} />{tt('Search in the cloud browser', 'ابحث في المتصفح السحابي')}</button></div></div>
              )}
              {res && res.items && res.configured && !res.failed && res.error && <div className="wb-note" role="alert">{res.error}</div>}
              {res && res.items && res.configured && !res.failed && !res.error && !res.items.length && (
                <div className="wb-empty"><b>{tt('No results found', 'مفيش نتايج')}</b><p>{tt('Check the spelling or try different, more general words.', 'اتأكد من الكتابة أو جرّب كلمات تانية أعم.')}</p></div>
              )}
              {res && res.items && res.items.map((r) => (
                <article key={r.url} className="wb-r">
                  <a className="wb-r__site" href={r.url} onClick={(e) => openLink(e, r.url)} onAuxClick={(e) => { if (e.button === 1) openLink(e, r.url); }} tabIndex={-1}>
                    <span className="wb-r__ico"><Fav domain={r.domain} size={18} /></span>
                    <span className="wb-r__who"><b dir="auto">{siteName(r.domain)}</b><cite dir="ltr">{crumbs(r.url)}</cite></span>
                  </a>
                  <a className="wb-r__t" href={r.url} dir="auto" onClick={(e) => openLink(e, r.url)} onAuxClick={(e) => { if (e.button === 1) openLink(e, r.url); }}>{r.title}</a>
                  {r.snippet && <p dir="auto"><Hl text={r.snippet} q={cur.q} /></p>}
                </article>
              ))}
              {res && res.items && res.configured && !res.failed && !res.error && (res.items.length > 0 || page > 1) && (
                <nav className="wb-pager" aria-label={tt('Pages', 'الصفحات')}>
                  <button type="button" disabled={page <= 1} onClick={() => go(active.id, { kind: 'results', q: cur.q, page: page - 1 })}>{tt('Previous', 'السابق')}</button>
                  {Array.from({ length: Math.min(page + (res.items.length >= 5 ? 1 : 0), 10) - Math.max(1, page - 4) + 1 }, (_, i) => Math.max(1, page - 4) + i).map((n) => (
                    <button type="button" key={n} className={n === page ? 'is-on' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => n !== page && go(active.id, { kind: 'results', q: cur.q, page: n })}>{n}</button>
                  ))}
                  <button type="button" disabled={res.items.length < 5 || page >= 10} onClick={() => go(active.id, { kind: 'results', q: cur.q, page: page + 1 })}>{tt('Next', 'التالي')}</button>
                </nav>
              )}
            </div>
          </div>
        )}

        {/* direct pages stay mounted (hidden) while another tab is shown, so a tab keeps its scroll, form and login state */}
        {tabs.filter((t) => t.cur.kind === 'direct' && loaded.has(t.id)).map((t) => (
          <iframe key={`${t.id}:${t.cur.url}:${reloadKey[t.id] || 0}`} src={t.cur.url} title={hostOf(t.cur.url)} className="wb-frame" style={{ display: t.id === active.id ? 'block' : 'none' }} referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write; fullscreen; camera; microphone; autoplay" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock" />
        ))}

        {/* the cloud browser stays mounted (hidden) while another tab is shown, so its pages and logins survive */}
        {cloudUp && (
          <div className="wb-cloud" style={{ display: cur.kind === 'cloud' ? 'block' : 'none' }}>
            {previewUrl && cloudLive ? <iframe src={cloudSrc} title="Cloud browser" className="wb-frame" referrerPolicy="no-referrer" allow="clipboard-read; clipboard-write; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" />
              : <div className="wb-wait"><span className="wb-spin" /><p>{phase === 'error' ? (error || tt('Could not start the cloud browser.', 'معرفتش أشغّل المتصفح السحابي.')) : phase === 'closed' ? tt('The cloud browser session ended.', 'جلسة المتصفح السحابي انتهت.') : tt('Starting your cloud browser…', 'بشغّل المتصفح السحابي…')}</p>
                {(phase === 'error' || phase === 'closed') && <button type="button" className="wb-cta" onClick={() => { stopCloud(); goHome(); }}>{tt('Back', 'رجوع')}</button>}</div>}
          </div>
        )}

        {active.loading && <div className="wb-loadbar" aria-hidden="true"><i /></div>}
      </div>
      {busy && cur.kind === 'cloud' && <div className="wb-ribbon">{tt('Starting the cloud browser — this takes a few seconds the first time…', 'بشغّل المتصفح السحابي — بياخد كام ثانية أول مرة…')}</div>}
    </div>
  );
}
