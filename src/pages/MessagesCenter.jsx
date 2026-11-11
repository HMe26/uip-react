import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, errorMessage } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { usePageMeta } from '../context/PageMetaContext';
import { Avatar } from '../components/messaging/ConversationRail';
import ConfirmDialog from '../components/messaging/ConfirmDialog';
import { peerLabel, previewLabel } from '../components/messaging/format';
import { REPORT_STATUSES, reasonLabel, statusMeta } from '../components/messaging/safety';

/**
 * Messages center — full pages for what used to live in small popups:
 *   /{portal}/messages/archived | blocked | reports | trash
 * One layout (header + section tabs with live counts), one section per route.
 * Data: /api/v1/messaging/{inbox, blocks, reports/mine, trash, trash/*}.
 */

const BASE = '/api/v1/messaging';
const SECTIONS = ['archived', 'blocked', 'reports', 'trash'];
export const isCenterSection = (v) => SECTIONS.includes(v);

const fmtDay = (iso, locale) => {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale === 'ar' ? 'ar-EG' : undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

function useSelection(ids) {
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => {
    setSel((prev) => {
      const alive = new Set(ids);
      const next = new Set([...prev].filter((i) => alive.has(i)));
      return next.size === prev.size ? prev : next;
    });
  }, [ids]);
  const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = ids.length > 0 && sel.size === ids.length;
  const toggleAll = () => setSel(all ? new Set() : new Set(ids));
  const clear = () => setSel(new Set());
  return { sel, toggle, all, toggleAll, clear };
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="mc-empty">
      <span className="mc-empty__icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function Loading() {
  return <div className="mc-loading" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="mc-skel" />)}</div>;
}

export default function MessagesCenter({ section }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const navigate = useNavigate();
  const location = useLocation();
  const base = location.pathname.replace(/\/messages(\/.*)?$/, '/messages');

  const TITLES = {
    archived: [t('Archived chats', 'المحادثات المحفوظة'), t('Chats you archived. They stay out of your list until you unarchive them.', 'محادثات أرشفتها. تبقى بعيدة عن قائمتك حتى تلغي أرشفتها.')],
    blocked: [t('Blocked people', 'المحظورون'), t("Blocked people can't message you and you can't message them.", 'المحظور لا يستطيع مراسلتك ولا تستطيع مراسلته.')],
    reports: [t('My reports', 'بلاغاتي'), t('Reports you sent about messages or people, and what happened to them.', 'البلاغات التي أرسلتها عن رسائل أو أشخاص، وما تم بشأنها.')],
    trash: [t('Trash', 'المحذوفات'), t('Deleted chats are kept for 30 days, then deleted permanently.', 'المحادثات المحذوفة تُحفظ 30 يومًا ثم تُحذف نهائيًا.')],
  };
  usePageMeta(TITLES[section][0], TITLES[section][1]);

  // Phone: this page becomes a full-screen native-style screen (see messaging-mobile.css). The body class
  // also tells the APK shell not to treat a downward drag as pull-to-refresh (a reload would lose state).
  useEffect(() => {
    document.body.classList.add('msg-center-active');
    return () => document.body.classList.remove('msg-center-active');
  }, []);
  const tabsRef = useRef(null);
  useEffect(() => {
    // The active tab used to be clipped off-screen in RTL; bring it to the middle of the strip.
    const el = tabsRef.current?.querySelector('.mc-tab.is-active');
    if (el?.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [section]);

  const [inbox, setInbox] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [reports, setReports] = useState(null);
  const [trash, setTrash] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState(null); // { text, error? }
  const [confirm, setConfirm] = useState(null);

  const flash = (text, error = false) => { setNotice({ text, error }); };
  useEffect(() => {
    if (!notice) return undefined;
    const h = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(h);
  }, [notice]);

  const loadAll = useCallback(async () => {
    const run = (p, set, pick) => p.then((r) => set(pick(r))).catch((e) => { set((prev) => prev ?? []); setLoadError(errorMessage(e)); });
    await Promise.all([
      run(api.get(BASE + '/inbox'), setInbox, (r) => r.data || []),
      run(api.get(BASE + '/blocks'), setBlocked, (r) => r.data || []),
      run(api.get(BASE + '/reports/mine'), setReports, (r) => r.data || []),
      run(api.get(BASE + '/trash'), setTrash, (r) => r.data?.items || []),
    ]);
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);
  // APK pull-to-refresh (native.js fires 'uip:pull-refresh')
  useEffect(() => {
    const onPull = (e) => e.detail?.wait?.(loadAll());
    window.addEventListener('uip:pull-refresh', onPull);
    return () => window.removeEventListener('uip:pull-refresh', onPull);
  }, [loadAll]);

  const archived = useMemo(() => (inbox || []).filter((c) => c.is_archived), [inbox]);
  const counts = { archived: archived.length, blocked: blocked?.length, reports: reports?.length, trash: trash?.length };

  const ask = (cfg) => new Promise((resolve) => {
    setConfirm({
      ...cfg,
      cancel: () => { setConfirm(null); resolve(false); },
      run: async () => {
        try { await cfg.run(); setConfirm(null); resolve(true); } catch (e) { setConfirm(null); flash(errorMessage(e), true); resolve(false); }
      },
    });
  });

  const ctx = { t, ar, locale, base, navigate, flash, ask, loadAll, archived, blocked, reports, trash, inbox, setBlocked };

  return (
    <div className="mc">
      <div className="mc-top">
        <Link to={base} className="mc-back" aria-label={t('Back to messages', 'العودة للرسائل')}>
          <Icon name={ar ? 'arrow-right' : 'arrow-left'} size={18} /> <span>{t('Back to messages', 'العودة للرسائل')}</span>
        </Link>
        <h1 className="mc-title">{TITLES[section][0]}</h1>
        <p className="mc-sub">{TITLES[section][1]}</p>
      </div>

      <nav className="mc-tabs" ref={tabsRef} aria-label={t('Messages sections', 'أقسام الرسائل')}>
        {[
          ['archived', 'archive', t('Archived', 'المحفوظات')],
          ['blocked', 'shield', t('Blocked', 'المحظورون')],
          ['reports', 'flag', t('My reports', 'بلاغاتي')],
          ['trash', 'trash', t('Trash', 'المحذوفات')],
        ].map(([key, icon, label]) => (
          <NavLink key={key} to={`${base}/${key}`} className={({ isActive }) => `mc-tab${isActive ? ' is-active' : ''}`}>
            <Icon name={icon} size={16} />
            <span>{label}</span>
            {counts[key] != null && <span className="mc-tab__count">{counts[key]}</span>}
          </NavLink>
        ))}
      </nav>

      {loadError && <div className="mc-alert" role="alert">{loadError}</div>}

      <div className="card glass-panel mc-card">
        {section === 'archived' && <ArchivedSection {...ctx} />}
        {section === 'blocked' && <BlockedSection {...ctx} />}
        {section === 'reports' && <ReportsSection {...ctx} />}
        {section === 'trash' && <TrashSection {...ctx} />}
      </div>

      {notice && <div className={`mc-toast${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} danger={confirm.danger !== false} onConfirm={confirm.run} onClose={confirm.cancel} />}
    </div>
  );
}

/** Search box + optional actions row shared by the sections. */
function Toolbar({ q, setQ, placeholder, children }) {
  return (
    <div className="mc-toolbar">
      <label className="mc-search">
        <Icon name="search" size={15} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      </label>
      <div className="mc-toolbar__actions">{children}</div>
    </div>
  );
}

const matches = (q, ...fields) => {
  const n = q.trim().toLowerCase();
  return !n || fields.some((f) => String(f || '').toLowerCase().includes(n));
};

function ChatCell({ c, locale }) {
  return (
    <div className="mc-person">
      <Avatar name={peerLabel(c)} isGroup={c.is_group} src={c.is_group ? c.group_avatar : (c.peer_deleted ? null : c.peer_avatar)} />
      <div className="mc-person__text">
        <strong>{peerLabel(c)}</strong>
        <span>{previewLabel(c, locale) || (locale === 'ar' ? 'لا توجد رسائل بعد' : 'No messages yet')}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ archived
function ArchivedSection({ t, locale, base, navigate, flash, ask, loadAll, archived, inbox }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => archived.filter((c) => matches(q, peerLabel(c), c.preview, c.peer_email)), [archived, q]);
  const ids = useMemo(() => rows.map((c) => c.id), [rows]);
  const s = useSelection(ids);

  const unarchive = async (list) => {
    setBusy(true);
    try {
      await Promise.all(list.map((id) => api.post(`${BASE}/conversations/${id}/flags/archive`, { value: false })));
      flash(t('Moved back to your messages.', 'تمت إعادتها إلى رسائلك.'));
      s.clear();
      await loadAll();
    } catch (e) { flash(errorMessage(e), true); } finally { setBusy(false); }
  };
  const toTrash = (list) => ask({
    title: t('Delete chats', 'حذف المحادثات'),
    message: t(`${list.length} chat(s) will move to Trash for 30 days.`, `سيتم نقل ${list.length} محادثة إلى المحذوفات لمدة 30 يومًا.`),
    confirmLabel: t('Move to Trash', 'نقل إلى المحذوفات'),
    run: async () => {
      for (let i = 0; i < list.length; i += 200) await api.post(BASE + '/trash/delete', { ids: list.slice(i, i + 200) });
      flash(t('Moved to Trash.', 'تم النقل إلى المحذوفات.'));
      s.clear();
      await loadAll();
    },
  });

  if (inbox === null) return <Loading />;
  if (archived.length === 0) return <EmptyState icon="archive" title={t('No archived chats', 'لا توجد محادثات محفوظة')} text={t('Archive a chat from its details panel to keep your list tidy.', 'أرشف محادثة من لوحة تفاصيلها لتبقى قائمتك مرتبة.')} />;

  const sel = [...s.sel];
  return (
    <>
      <Toolbar q={q} setQ={setQ} placeholder={t('Search archived chats…', 'ابحث في المحادثات المحفوظة…')}>
        {sel.length > 0 && (
          <>
            <span className="mc-selcount">{t(`${sel.length} selected`, `تم تحديد ${sel.length}`)}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => unarchive(sel)}><Icon name="upload" size={14} /> {t('Unarchive', 'إلغاء الأرشفة')}</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => toTrash(sel)}><Icon name="trash" size={14} /> {t('Delete', 'حذف')}</button>
          </>
        )}
      </Toolbar>
      <div className="table-responsive">
        <table className="data-table mc-table">
          <thead>
            <tr>
              <th className="mc-col-check"><input type="checkbox" checked={s.all} onChange={s.toggleAll} aria-label={t('Select all', 'تحديد الكل')} /></th>
              <th>{t('Chat', 'المحادثة')}</th>
              <th>{t('Last activity', 'آخر نشاط')}</th>
              <th className="mc-col-actions">{t('Actions', 'إجراءات')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={s.sel.has(c.id) ? 'is-selected' : ''}>
                <td className="mc-col-check mc-td-check"><input type="checkbox" checked={s.sel.has(c.id)} onChange={() => s.toggle(c.id)} aria-label={peerLabel(c)} /></td>
                <td className="mc-td-main"><ChatCell c={c} locale={locale} /></td>
                <td className="mc-muted mc-td-meta" data-label={t('Last activity', 'آخر نشاط')}>{fmtDay(c.time, locale)}</td>
                <td className="mc-col-actions mc-td-actions">
                  <div className="mc-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`${base}/${c.id}`)}>{t('Open', 'فتح')}</button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => unarchive([c.id])}>{t('Unarchive', 'إلغاء الأرشفة')}</button>
                    <button type="button" className="mc-iconbtn is-danger" title={t('Delete', 'حذف')} aria-label={t('Delete', 'حذف')} onClick={() => toTrash([c.id])}><Icon name="trash" size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mc-none">{t('No matches.', 'لا توجد نتائج مطابقة.')}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- blocked
function BlockedSection({ t, locale, ask, flash, loadAll, blocked }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => (blocked || []).filter((u) => matches(q, u.full_name, u.email)), [blocked, q]);

  const unblock = (u) => ask({
    title: t('Unblock', 'إلغاء الحظر'),
    danger: false,
    message: t(`Unblock ${u.full_name}? You will be able to message each other again.`, `إلغاء حظر ${u.full_name}؟ ستتمكنان من المراسلة مجددًا.`),
    confirmLabel: t('Unblock', 'إلغاء الحظر'),
    run: async () => {
      await api.del(`${BASE}/blocks/${u.id}`);
      flash(t('Unblocked.', 'تم إلغاء الحظر.'));
      await loadAll();
    },
  });

  if (blocked === null) return <Loading />;
  if (blocked.length === 0) return <EmptyState icon="shield" title={t("You haven't blocked anyone", 'لم تحظر أحدًا')} text={t('You can block someone from their chat or when reporting them.', 'يمكنك حظر شخص من محادثته أو عند الإبلاغ عنه.')} />;

  return (
    <>
      <Toolbar q={q} setQ={setQ} placeholder={t('Search blocked people…', 'ابحث في المحظورين…')} />
      <div className="table-responsive">
        <table className="data-table mc-table mc-table--nocheck">
          <thead>
            <tr><th>{t('Person', 'الشخص')}</th><th>{t('Blocked on', 'تاريخ الحظر')}</th><th className="mc-col-actions">{t('Actions', 'إجراءات')}</th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="mc-td-main">
                  <div className="mc-person">
                    <Avatar name={u.full_name || ''} src={u.avatar_path} />
                    <div className="mc-person__text">
                      <strong>{u.full_name}{u.is_deleted && <em className="mc-tag">{t('Deleted account', 'حساب محذوف')}</em>}</strong>
                      {u.email && <span dir="ltr">{u.email}</span>}
                    </div>
                  </div>
                </td>
                <td className="mc-muted mc-td-meta" data-label={t('Blocked on', 'تاريخ الحظر')}>{fmtDay(u.blocked_at, locale)}</td>
                <td className="mc-col-actions mc-td-actions"><div className="mc-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => unblock(u)}>{t('Unblock', 'إلغاء الحظر')}</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mc-none">{t('No matches.', 'لا توجد نتائج مطابقة.')}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- reports
function ReportsSection({ t, locale, reports }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const rows = useMemo(() => (reports || []).filter((r) => (!status || r.status === status) && matches(q, r.reported_name, r.message_snapshot, r.details, reasonLabel(r.reason, locale))), [reports, q, status, locale]);

  if (reports === null) return <Loading />;
  if (reports.length === 0) return <EmptyState icon="flag" title={t("You haven't sent any reports", 'لم ترسل أي بلاغات')} text={t('Report a message or a person from inside a chat. Your report goes to the admins, university and faculty.', 'أبلغ عن رسالة أو شخص من داخل المحادثة. يصل بلاغك للإدارة والجامعة والكلية.')} />;

  const count = (k) => reports.filter((r) => r.status === k).length;
  return (
    <>
      <div className="mc-chips" role="group" aria-label={t('Status', 'الحالة')}>
        <button type="button" className={`mc-chip${status === '' ? ' is-active' : ''}`} onClick={() => setStatus('')}>{t('All', 'الكل')} <b>{reports.length}</b></button>
        {REPORT_STATUSES.map((s) => (
          <button key={s.key} type="button" className={`mc-chip${status === s.key ? ' is-active' : ''}`} onClick={() => setStatus(status === s.key ? '' : s.key)}>
            {locale === 'ar' ? s.ar : s.en} <b>{count(s.key)}</b>
          </button>
        ))}
      </div>
      <Toolbar q={q} setQ={setQ} placeholder={t('Search reports…', 'ابحث في البلاغات…')} />
      <ul className="mc-reports">
        {rows.map((r) => {
          const st = statusMeta(r.status);
          return (
            <li key={r.id} className="mc-report">
              <div className="mc-report__top">
                <span className={`badge ${st.badge}`}>{locale === 'ar' ? st.ar : st.en}</span>
                <strong>{r.reported_name}</strong>
                <span className="mc-muted">· {reasonLabel(r.reason, locale)}</span>
                <span className="mc-report__date">{fmtDay(r.created_at, locale)}</span>
              </div>
              {r.message_snapshot && <blockquote className="mc-report__quote">{r.message_snapshot}</blockquote>}
              {r.details && <p className="mc-report__details">{r.details}</p>}
              {r.resolution_notes && (
                <div className="mc-report__note"><Icon name="info" size={14} /> <span><b>{t('Reviewer note:', 'ملاحظة المراجع:')}</b> {r.resolution_notes}</span></div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="mc-none">{t('No matches.', 'لا توجد نتائج مطابقة.')}</p>}
    </>
  );
}

// --------------------------------------------------------------------- trash
function TrashSection({ t, ar, locale, ask, flash, loadAll, trash }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (trash || []).filter((c) => matches(q, peerLabel(c), c.preview)), [trash, q]);
  const ids = useMemo(() => rows.map((c) => c.id), [rows]);
  const s = useSelection(ids);

  const post = async (action, body) => {
    const list = body.ids;
    if (list) for (let i = 0; i < list.length; i += 200) await api.post(`${BASE}/trash/${action}`, { ids: list.slice(i, i + 200) });
    else await api.post(`${BASE}/trash/${action}`, body);
  };
  const restore = async (body) => {
    setBusy(true);
    try { await post('restore', body); flash(t('Chats restored.', 'تم استرجاع المحادثات.')); s.clear(); await loadAll(); } catch (e) { flash(errorMessage(e), true); } finally { setBusy(false); }
  };
  const purge = (body) => {
    const n = body.all ? (trash || []).length : body.ids.length;
    return ask({
      title: body.all ? t('Empty Trash', 'تفريغ المحذوفات') : t('Delete forever', 'حذف نهائي'),
      message: t(`${n} chat(s) will be permanently deleted from your account. This can't be undone.`, `سيتم حذف ${n} محادثة نهائيًا من حسابك ولا يمكن التراجع عن ذلك.`),
      confirmLabel: t('Delete forever', 'حذف نهائي'),
      run: async () => { await post('purge', body); flash(t('Deleted permanently.', 'تم الحذف نهائيًا.')); s.clear(); await loadAll(); },
    });
  };
  const daysLabel = (n) => {
    if (n <= 0) return t('Deleting today', 'يُحذف اليوم');
    if (!ar) return `${n} day${n === 1 ? '' : 's'} left`;
    return n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : `${n} ${n <= 10 ? 'أيام' : 'يومًا'}`;
  };

  if (trash === null) return <Loading />;
  if (trash.length === 0) return <EmptyState icon="trash" title={t('Trash is empty', 'سلة المحذوفات فارغة')} text={t('Chats you delete appear here for 30 days before they are removed for good.', 'تظهر هنا المحادثات التي تحذفها لمدة 30 يومًا قبل أن تُحذف نهائيًا.')} />;

  const sel = [...s.sel];
  return (
    <>
      <div className="mc-banner"><Icon name="clock" size={16} /> <span>{t('Deleted chats are kept for 30 days. Restore them any time before then, or delete them forever.', 'تُحفظ المحادثات المحذوفة 30 يومًا. يمكنك استرجاعها في أي وقت قبل ذلك، أو حذفها نهائيًا.')}</span></div>
      <Toolbar q={q} setQ={setQ} placeholder={t('Search deleted chats…', 'ابحث في المحذوفات…')}>
        {sel.length > 0 ? (
          <>
            <span className="mc-selcount">{t(`${sel.length} selected`, `تم تحديد ${sel.length}`)}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => restore({ ids: sel })}><Icon name="refresh" size={14} /> {t('Restore', 'استرجاع')}</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => purge({ ids: sel })}><Icon name="trash" size={14} /> {t('Delete forever', 'حذف نهائي')}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => restore({ all: true })}><Icon name="refresh" size={14} /> {t('Restore all', 'استرجاع الكل')}</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => purge({ all: true })}><Icon name="trash" size={14} /> {t('Empty trash', 'تفريغ السلة')}</button>
          </>
        )}
      </Toolbar>
      <div className="table-responsive">
        <table className="data-table mc-table">
          <thead>
            <tr>
              <th className="mc-col-check"><input type="checkbox" checked={s.all} onChange={s.toggleAll} aria-label={t('Select all', 'تحديد الكل')} /></th>
              <th>{t('Chat', 'المحادثة')}</th>
              <th>{t('Deleted on', 'تاريخ الحذف')}</th>
              <th>{t('Time left', 'المدة المتبقية')}</th>
              <th className="mc-col-actions">{t('Actions', 'إجراءات')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const left = c.days_left ?? 0;
              return (
                <tr key={c.id} className={s.sel.has(c.id) ? 'is-selected' : ''}>
                  <td className="mc-col-check mc-td-check"><input type="checkbox" checked={s.sel.has(c.id)} onChange={() => s.toggle(c.id)} aria-label={peerLabel(c)} /></td>
                  <td className="mc-td-main"><ChatCell c={c} locale={locale} /></td>
                  <td className="mc-muted mc-td-meta" data-label={t('Deleted on', 'تاريخ الحذف')}>{fmtDay(c.deleted_at, locale)}</td>
                  <td className="mc-td-life">
                    <div className={`mc-life${left <= 3 ? ' is-urgent' : ''}`}>
                      <span className="mc-life__bar"><i style={{ width: `${Math.max(4, Math.min(100, (left / 30) * 100))}%` }} /></span>
                      <span className="mc-life__text">{daysLabel(left)}</span>
                    </div>
                  </td>
                  <td className="mc-col-actions mc-td-actions">
                    <div className="mc-actions">
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => restore({ ids: [c.id] })}><Icon name="refresh" size={14} /> {t('Restore', 'استرجاع')}</button>
                      <button type="button" className="mc-iconbtn is-danger" title={t('Delete forever', 'حذف نهائي')} aria-label={t('Delete forever', 'حذف نهائي')} onClick={() => purge({ ids: [c.id] })}><Icon name="trash" size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mc-none">{t('No matches.', 'لا توجد نتائج مطابقة.')}</p>}
      </div>
    </>
  );
}
