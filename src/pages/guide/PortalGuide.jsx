import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { GUIDE_SEEN_EVENT } from '../../components/Sidebar';
import { errorMessage } from '../../api/client';
import { usePageMeta } from '../../context/PageMetaContext';
import { guideApi } from './guideApi';
import { useGuideText } from './guideText';
import { GuideBadge, ItemCard, Rich, TaskTile } from './GuideParts';
import {
  ConfirmDialog, HistoryDrawer, ItemEditor, MetaEditor, SectionEditor, UndocumentedDrawer, useToast,
} from './GuideEditors';
import {
  PORTAL_NAMES, itemHaystack, pickText, portalNavItems, undocumentedPages,
} from './guideUtils';
import './guide.css';

/**
 * Platform guide — ONE page for every portal (/student/guide, /admin/guide, …).
 *
 *  - Everyone: reads the guide of their own portal (what each page does, where it is, how to do a task),
 *    searches it, follows the links straight into the platform.
 *  - Admin (or any role holding `guides.manage`): the same page gets "Edit mode" — add / edit / hide /
 *    reorder / delete sections and entries, restore old versions, see which sidebar pages still have no
 *    explanation, and open the guide of any other portal (?portal=student).
 *
 * Backend: /api/v1/guides/* (read) and /api/v1/admin/guides/* (write) — see PORTAL_GUIDE_API.md.
 */

const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export default function PortalGuide() {
  const { tx, locale } = useGuideText();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const portalParam = params.get('portal') || '';
  usePageMeta(tx.pageTitle, '');

  const [guide, setGuide] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | none | error
  const [errorText, setErrorText] = useState('');
  const [portals, setPortals] = useState([]);
  const [edit, setEdit] = useState(false);
  const [query, setQuery] = useState('');
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const [activeSection, setActiveSection] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newDismissed, setNewDismissed] = useState(false);
  const [toast, showToast] = useToast();
  const guideRef = useRef(null);
  const searchRef = useRef(null);
  guideRef.current = guide;

  /* ── loading ─────────────────────────────────────────────────────────── */

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading');
    try {
      const data = portalParam ? await guideApi.get(portalParam, edit) : await guideApi.me();
      // "me" has no hidden-content mode; once we know our portal, re-ask for the edit view.
      const full = (!portalParam && edit) ? await guideApi.get(data.portal, true) : data;
      setGuide(full);
      setStatus('ready');
    } catch (err) {
      if (err?.status === 404) {
        setGuide(null);
        setErrorText(errorMessage(err));
        setStatus('none');
      } else if (!silent || !guideRef.current) {
        setErrorText(errorMessage(err));
        setStatus('error');
      } else {
        showToast(errorMessage(err), 'error');
      }
    }
  }, [portalParam, edit, showToast]);

  useEffect(() => { load({ silent: guideRef.current != null }); }, [load]);

  // A different portal → start from a clean view.
  useEffect(() => { setQuery(''); setOpenKeys(new Set()); setNewDismissed(false); }, [portalParam]);

  // Managers get the list of portals for the switcher.
  const canManage = !!guide?.can_manage;
  useEffect(() => {
    if (!canManage) return;
    guideApi.list().then((d) => setPortals(d || [])).catch(() => {});
  }, [canManage]);

  // A first visit records the version, so the next admin change can show "updated" (the API only flags a
  // change for someone who has a previous "seen" mark).
  useEffect(() => {
    if (guide && !edit && guide.seen_version == null) guideApi.seen(guide.portal).catch(() => {});
  }, [guide, edit]);

  const ownGuide = useMemo(() => {
    if (!guide) return false;
    if (!portalParam) return true;
    return !!portals.find((p) => p.portal === guide.portal)?.is_mine || !canManage;
  }, [guide, portalParam, portals, canManage]);

  const dismissNew = async () => {
    setNewDismissed(true);
    try {
      await guideApi.seen(guide.portal);
      if (ownGuide) window.dispatchEvent(new Event(GUIDE_SEEN_EVENT));
    } catch { /* the banner is already gone; the next visit asks again */ }
  };

  /* ── derived view ────────────────────────────────────────────────────── */

  const sections = guide?.sections || [];
  const tokens = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const view = useMemo(() => sections
    .map((s) => ({
      ...s,
      shown: tokens.length ? (s.items || []).filter((it) => tokens.every((t) => itemHaystack(it, s).includes(t))) : (s.items || []),
    }))
    .filter((s) => (tokens.length ? s.shown.length > 0 : true)), [sections, tokens]);
  const matchCount = view.reduce((n, s) => n + s.shown.length, 0);

  const stats = useMemo(() => {
    const visible = sections.filter((s) => !s.is_hidden);
    const count = (pred) => visible.filter(pred).reduce((n, s) => n + (s.items || []).filter((i) => !i.is_hidden).length, 0);
    return {
      sections: visible.length,
      pages: count((s) => s.kind !== 'tasks' && s.kind !== 'faq'),
      tasks: count((s) => s.kind === 'tasks'),
    };
  }, [sections]);

  const missing = useMemo(() => (guide && edit ? undocumentedPages(guide.portal, guide) : []), [guide, edit]);
  const navItems = useMemo(() => (guide ? portalNavItems(guide.portal) : []), [guide]);

  /* ── scroll-spy + deep links + "/" to search ─────────────────────────── */

  useEffect(() => {
    if (!view.length || typeof IntersectionObserver === 'undefined') return undefined;
    const els = view.map((s) => document.getElementById(`sec-${s.key}`)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActiveSection(hit.target.id.replace(/^sec-/, ''));
    }, { rootMargin: '-12% 0px -72% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [view]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !hash) return;
    const id = hash.replace(/^#/, '');
    if (id.startsWith('g-')) setOpenKeys((cur) => new Set(cur).add(id.slice(2)));
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    return () => clearTimeout(t);
  }, [status, hash, guide?.portal]);

  const toggleOpen = (key) => setOpenKeys((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allKeys = useMemo(() => view.flatMap((s) => (s.kind === 'tasks' ? [] : s.shown.map((i) => i.key))), [view]);
  const allOpen = allKeys.length > 0 && allKeys.every((k) => openKeys.has(k));
  const toggleAll = () => setOpenKeys(allOpen ? new Set() : new Set(allKeys));

  const goSection = (key) => {
    setActiveSection(key);
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const copyLink = async (item) => {
    const url = `${window.location.origin}${window.location.pathname}${portalParam ? `?portal=${portalParam}` : ''}#g-${item.key}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(tx.linkCopied);
    } catch {
      window.prompt(tx.copyLink, url);
    }
  };

  /* ── admin actions ───────────────────────────────────────────────────── */

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      await load({ silent: true });
      if (okMsg) showToast(okMsg);
      return true;
    } catch (err) {
      showToast(errorMessage(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const swap = (ids, i, d) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return null;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const moveSection = (s, d) => {
    const ids = sections.map((x) => x.id);
    const next = swap(ids, ids.indexOf(s.id), d);
    if (next) act(() => guideApi.reorderSections(guide.portal, next));
  };
  const moveItem = (s, it, d) => {
    const ids = (s.items || []).map((x) => x.id);
    const next = swap(ids, ids.indexOf(it.id), d);
    if (next) act(() => guideApi.reorderItems(s.id, next));
  };
  const toggleItemHidden = (it) => act(() => guideApi.updateItem(it.id, { is_hidden: !it.is_hidden }), it.is_hidden ? tx.show : tx.hide);
  const toggleSectionHidden = (s) => act(() => guideApi.updateSection(s.id, { is_hidden: !s.is_hidden }), s.is_hidden ? tx.show : tx.hide);
  const togglePublished = () => act(() => guideApi.updateMeta(guide.portal, { is_published: !guide.is_published }), tx.saved);

  const askDeleteItem = (it) => setModal({
    type: 'confirm', danger: true, title: tx.deleteItemTitle, body: `${tx.deleteItemBody}\n\n«${pickText(it, 'title', locale)}»`, label: tx.delete,
    run: () => act(() => guideApi.deleteItem(it.id), tx.deleted),
  });
  const askDeleteSection = (s) => setModal({
    type: 'confirm', danger: true, title: tx.deleteSectionTitle, body: `${tx.deleteSectionBody}\n\n«${pickText(s, 'title', locale)}»`, label: tx.delete,
    run: () => act(() => guideApi.deleteSection(s.id), tx.deleted),
  });
  const askReset = () => setModal({
    type: 'confirm', danger: true, title: tx.resetTitle, body: tx.resetBody, label: tx.reset,
    run: () => act(() => guideApi.reset(guide.portal), tx.resetDone),
  });

  const submitItem = async ({ body, sectionId, item }) => {
    if (item) await guideApi.updateItem(item.id, body);
    else await guideApi.createItem(sectionId, body);
    await load({ silent: true });
    setModal(null);
    showToast(tx.saved);
  };
  const submitSection = async ({ body, section }) => {
    if (section) await guideApi.updateSection(section.id, body);
    else await guideApi.createSection(guide.portal, body);
    await load({ silent: true });
    setModal(null);
    showToast(tx.saved);
  };
  const submitMeta = async (body) => {
    await guideApi.updateMeta(guide.portal, body);
    await load({ silent: true });
    setModal(null);
    showToast(tx.saved);
  };

  const createFromNav = (nav) => {
    const group = sections.find((s) => s.key === `nav-${nav.groupKey}`) || sections.find((s) => s.kind === 'group') || sections[0];
    setModal({
      type: 'item',
      sectionId: group?.id,
      prefill: { route: nav.route, title_ar: nav.ar, title_en: nav.en, icon: nav.icon, permission: nav.perm || '', section_id: group?.id },
    });
  };

  const switchPortal = (slug) => {
    const next = new URLSearchParams(params);
    next.set('portal', slug);
    setParams(next, { replace: true });
  };

  /* ── toolbars ────────────────────────────────────────────────────────── */

  const ToolBtn = ({ icon, label, onClick, danger, disabled }) => (
    <button type="button" className={`gd-iconbtn${danger ? ' gd-iconbtn--danger' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={busy || disabled}>
      <Icon name={icon} size={15} />
    </button>
  );

  const itemTools = (s, it) => {
    const idx = (s.items || []).findIndex((x) => x.id === it.id);
    return (
      <>
        <ToolBtn icon="arrow-up" label={tx.moveUp} onClick={() => moveItem(s, it, -1)} disabled={idx <= 0 || !!tokens.length} />
        <ToolBtn icon="arrow-down" label={tx.moveDown} onClick={() => moveItem(s, it, 1)} disabled={idx === (s.items || []).length - 1 || !!tokens.length} />
        <ToolBtn icon={it.is_hidden ? 'eye' : 'eye-off'} label={it.is_hidden ? tx.show : tx.hide} onClick={() => toggleItemHidden(it)} />
        <ToolBtn icon="edit" label={tx.edit} onClick={() => setModal({ type: 'item', item: it })} />
        <ToolBtn icon="trash" label={tx.delete} danger onClick={() => askDeleteItem(it)} />
      </>
    );
  };

  const sectionTools = (s) => {
    const idx = sections.findIndex((x) => x.id === s.id);
    return (
      <>
        <ToolBtn icon="arrow-up" label={tx.moveUp} onClick={() => moveSection(s, -1)} disabled={idx <= 0 || !!tokens.length} />
        <ToolBtn icon="arrow-down" label={tx.moveDown} onClick={() => moveSection(s, 1)} disabled={idx === sections.length - 1 || !!tokens.length} />
        <ToolBtn icon={s.is_hidden ? 'eye' : 'eye-off'} label={s.is_hidden ? tx.show : tx.hide} onClick={() => toggleSectionHidden(s)} />
        <ToolBtn icon="edit" label={tx.edit} onClick={() => setModal({ type: 'section', section: s })} />
        <ToolBtn icon="trash" label={tx.delete} danger onClick={() => askDeleteSection(s)} />
      </>
    );
  };

  /* ── states ──────────────────────────────────────────────────────────── */

  if (status === 'loading' && !guide) {
    return (
      <div className="gd" aria-busy="true" aria-live="polite">
        <div className="gd-skel gd-skel--hero" />
        <div className="gd-layout">
          <div className="gd-toc"><div className="gd-skel" style={{ height: 260 }} /></div>
          <div className="gd-main">
            {[0, 1, 2].map((i) => <div key={i} className="gd-skel" style={{ height: 120 }} />)}
          </div>
        </div>
        <span className="gd-sr">{tx.loading}</span>
      </div>
    );
  }

  if (status === 'none' || status === 'error') {
    return (
      <div className="gd">
        <div className="gd-state">
          <span className="gd-state__icon"><Icon name={status === 'none' ? 'book-open' : 'alert-triangle'} size={30} /></span>
          <h1>{status === 'none' ? tx.noGuide : tx.loadFailed}</h1>
          {errorText && <p>{errorText}</p>}
          {status === 'error' && <button type="button" className="gd-btn gd-btn--primary" onClick={() => load()}><Icon name="refresh" size={15} /> {tx.retry}</button>}
        </div>
      </div>
    );
  }

  const portalName = PORTAL_NAMES[guide.portal]?.[locale] || guide.portal;
  const title = pickText(guide, 'title', locale) || tx.pageTitle;
  const subtitle = pickText(guide, 'subtitle', locale);
  const intro = pickText(guide, 'intro', locale);
  const updatedAt = guide.updated_at ? new Date(guide.updated_at) : null;
  const updatedText = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? updatedAt.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  /* ── render ──────────────────────────────────────────────────────────── */

  return (
    <div className={`gd${edit ? ' is-editing' : ''}`}>
      {canManage && (
        <section className="gd-admin" aria-label={tx.manage}>
          <div className="gd-admin__row">
            <div className="gd-admin__title">
              <span className="gd-admin__icon"><Icon name="settings" size={16} /></span>
              <strong>{tx.manage}</strong>
              {portals.length > 1 && (
                <label className="gd-admin__portal">
                  <span>{tx.viewing}</span>
                  <select value={guide.portal} onChange={(e) => switchPortal(e.target.value)} disabled={busy}>
                    {portals.map((p) => <option key={p.portal} value={p.portal}>{PORTAL_NAMES[p.portal]?.[locale] || p.portal}{p.has_new ? ' •' : ''}</option>)}
                  </select>
                </label>
              )}
              <GuideBadge tone={guide.is_published ? 'ok' : 'warn'} icon={guide.is_published ? 'check-circle' : 'eye-off'}>
                {guide.is_published ? tx.published : tx.draft}
              </GuideBadge>
            </div>
            <label className="gd-switch gd-switch--lg" title={tx.editModeHint}>
              <input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} disabled={busy} />
              <span className="gd-switch__track" aria-hidden="true" />
              <span>{tx.editMode}</span>
            </label>
          </div>
          {edit && (
            <div className="gd-admin__tools">
              <p className="gd-admin__hint"><Icon name="info" size={14} /> {tx.editModeHint}</p>
              <div className="gd-admin__btns">
                <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => setModal({ type: 'meta' })}><Icon name="edit" size={14} /> {tx.editInfo}</button>
                <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => setModal({ type: 'section' })}><Icon name="plus" size={14} /> {tx.addSection}</button>
                <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => setModal({ type: 'undoc' })}>
                  <Icon name="alert-triangle" size={14} /> {tx.undocumented}
                  {missing.length > 0 && <span className="gd-count">{missing.length}</span>}
                </button>
                <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => setModal({ type: 'history' })}><Icon name="history" size={14} /> {tx.history}</button>
                <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={togglePublished} disabled={busy}>
                  <Icon name={guide.is_published ? 'eye-off' : 'check-circle'} size={14} /> {guide.is_published ? tx.unpublish : tx.publish}
                </button>
                <button type="button" className="gd-btn gd-btn--ghost gd-btn--sm gd-btn--dangerText" onClick={askReset}><Icon name="refresh" size={14} /> {tx.reset}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {guide.has_new && !newDismissed && !edit && (
        <div className="gd-banner" role="status">
          <span className="gd-banner__icon"><Icon name="sparkles" size={18} /></span>
          <div className="gd-banner__text"><strong>{tx.whatsNew}</strong><span>{tx.whatsNewBody}</span></div>
          <button type="button" className="gd-btn gd-btn--primary gd-btn--sm" onClick={dismissNew}>{tx.gotIt}</button>
        </div>
      )}

      <header className="gd-hero">
        <div className="gd-hero__glow" aria-hidden="true" />
        <div className="gd-hero__top">
          <span className="gd-hero__icon" aria-hidden="true"><Icon name={guide.icon || 'book-open'} size={30} /></span>
          <div className="gd-hero__titles">
            <div className="gd-eyebrow">{portalName}</div>
            <h1>{title}</h1>
            {subtitle && <p className="gd-hero__sub">{subtitle}</p>}
          </div>
          <div className="gd-hero__actions">
            <button type="button" className="gd-btn gd-btn--glass gd-btn--sm" onClick={toggleAll} disabled={!allKeys.length}>
              <Icon name={allOpen ? 'collapse-all' : 'expand'} size={14} /> {allOpen ? tx.collapseAll : tx.expandAll}
            </button>
            <button type="button" className="gd-btn gd-btn--glass gd-btn--sm" onClick={() => window.print()}>
              <Icon name="ed-print" size={14} /> {tx.print}
            </button>
          </div>
        </div>
        {intro && <Rich text={intro} className="gd-hero__intro" />}
        <div className="gd-hero__meta">
          <div className="gd-stat"><strong>{stats.sections}</strong><span>{tx.statSections}</span></div>
          <div className="gd-stat"><strong>{stats.pages}</strong><span>{tx.statPages}</span></div>
          <div className="gd-stat"><strong>{stats.tasks}</strong><span>{tx.statTasks}</span></div>
          <div className="gd-hero__ver">
            <span><Icon name="history" size={13} /> {tx.version(guide.version)}</span>
            {updatedText && <span><Icon name="clock" size={13} /> {tx.updated}: {updatedText}</span>}
          </div>
        </div>
        <div className="gd-search" role="search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={tx.searchPlaceholder}
            aria-label={tx.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
          />
          {query && (
            <>
              <span className="gd-search__count" aria-live="polite">{tx.results(matchCount)}</span>
              <button type="button" className="gd-iconbtn" onClick={() => setQuery('')} aria-label={tx.clearSearch}><Icon name="x" size={15} /></button>
            </>
          )}
        </div>
      </header>

      <div className="gd-layout">
        <nav className="gd-toc" aria-label={tx.onThisPage}>
          <div className="gd-toc__title">{tx.onThisPage}</div>
          <ul>
            {view.map((s) => (
              <li key={s.id}>
                <button type="button" className={`gd-toc__link${activeSection === s.key ? ' is-active' : ''}${s.is_hidden ? ' is-hidden' : ''}`} onClick={() => goSection(s.key)}>
                  <Icon name={s.icon || 'file'} size={15} />
                  <span>{pickText(s, 'title', locale)}</span>
                  <em>{s.shown.length}</em>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="gd-main">
          {view.length === 0 && (
            <div className="gd-state gd-state--inline">
              <span className="gd-state__icon"><Icon name="search" size={26} /></span>
              <h2>{tokens.length ? tx.noResults : tx.emptySection}</h2>
              {tokens.length > 0 && <p>{tx.noResultsHint}</p>}
            </div>
          )}

          {view.map((s) => {
            const kind = s.kind;
            const head = (
              <header className="gd-sec__head">
                <span className="gd-sec__icon" aria-hidden="true"><Icon name={s.icon || 'file'} size={20} /></span>
                <div className="gd-sec__titles">
                  <h2>
                    {pickText(s, 'title', locale)}
                    {s.is_hidden && <GuideBadge tone="muted" icon="eye-off">{tx.hidden}</GuideBadge>}
                    {s.is_custom && <GuideBadge tone="info" icon="sparkles">{tx.custom}</GuideBadge>}
                  </h2>
                  {pickText(s, 'summary', locale) && <p>{pickText(s, 'summary', locale)}</p>}
                </div>
                <span className="gd-sec__count">{tx.itemsCount(s.shown.length)}</span>
                {edit && <div className="gd-sec__tools">{sectionTools(s)}</div>}
              </header>
            );

            return (
              <section key={s.id} id={`sec-${s.key}`} className={`gd-sec gd-sec--${kind}${s.is_hidden ? ' is-hidden' : ''}`}>
                {head}
                {kind === 'tasks' ? (
                  <div className="gd-tasks">
                    {s.shown.map((it) => <TaskTile key={it.id} item={it} tx={tx} locale={locale} editing={edit} tools={edit ? itemTools(s, it) : null} />)}
                  </div>
                ) : (
                  <div className="gd-list">
                    {s.shown.map((it) => (
                      <ItemCard
                        key={it.id}
                        item={it}
                        tx={tx}
                        locale={locale}
                        variant={kind === 'faq' ? 'faq' : kind === 'overview' ? 'overview' : 'page'}
                        open={tokens.length > 0 || openKeys.has(it.key)}
                        onToggle={() => toggleOpen(it.key)}
                        onCopyLink={copyLink}
                        tools={edit ? itemTools(s, it) : null}
                      />
                    ))}
                  </div>
                )}
                {edit && (
                  <button type="button" className="gd-add" onClick={() => setModal({ type: 'item', sectionId: s.id })}>
                    <Icon name="plus-circle" size={18} /> {tx.addItem}
                  </button>
                )}
              </section>
            );
          })}

          {edit && !tokens.length && (
            <button type="button" className="gd-add gd-add--section" onClick={() => setModal({ type: 'section' })}>
              <Icon name="plus-circle" size={18} /> {tx.addSection}
            </button>
          )}
        </main>
      </div>

      {modal?.type === 'item' && (
        <ItemEditor guide={guide} item={modal.item} sectionId={modal.sectionId} prefill={modal.prefill} navItems={navItems} tx={tx} locale={locale} onSubmit={submitItem} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'section' && (
        <SectionEditor guide={guide} section={modal.section} tx={tx} locale={locale} onSubmit={submitSection} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'meta' && <MetaEditor guide={guide} tx={tx} onSubmit={submitMeta} onClose={() => setModal(null)} />}
      {modal?.type === 'history' && (
        <HistoryDrawer portal={guide.portal} tx={tx} locale={locale} toast={showToast} onRestored={() => load({ silent: true })} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'undoc' && (
        <UndocumentedDrawer
          portal={guide.portal}
          guide={guide}
          tx={tx}
          locale={locale}
          onCreate={(nav) => { createFromNav(nav); }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'confirm' && (
        <ConfirmDialog
          tx={tx}
          danger={modal.danger}
          title={modal.title}
          body={modal.body}
          confirmLabel={modal.label}
          busy={busy}
          onClose={() => setModal(null)}
          onConfirm={async () => { await modal.run(); setModal(null); }}
        />
      )}

      {toast && <div key={toast.id} className={`gd-toast gd-toast--${toast.tone}`} role="status" aria-live="polite"><Icon name={toast.tone === 'error' ? 'alert-triangle' : 'check-circle'} size={16} /> {toast.message}</div>}
    </div>
  );
}
