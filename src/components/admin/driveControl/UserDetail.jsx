import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal } from '../adminUi';
import { EmptyState, ErrorState, Skeleton } from '../AdminPage';
import AuditTab from './AuditTab';
import LimitsForm from './LimitsForm';
import SharesTab from './SharesTab';
import { BASE, ROLE_LABELS, StatusBadge, UsageBar, catLabel, downloadFrom, fmtBytes, fmtDate, previewFrom, useBanner, useL } from './shared';

/** One user's My PC, on its own page: usage, limits & state, browse / view / download files, recycle bin, links, history, wipe. */
export default function UserDetail({ uid, onClose }) {
  const { ar, L } = useL();
  const [params, setParams] = useSearchParams();
  const { banner, setNotice, setError, clear } = useBanner();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(params.get('tab') || 'overview');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [wipeText, setWipeText] = useState('');

  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/users/${uid}`).then((j) => setD(j.data)).catch((e) => setErr(errorMessage(e)));
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const go = (t) => { setTab(t); const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };

  async function run(fn, after) {
    setBusy(true); clear();
    try { const j = await fn(); if (j?.message) setNotice(j.message); if (after) after(j); await load(); } catch (e) { setError(errorMessage(e)); }
    setConfirm(null); setBusy(false);
  }
  const saveLimits = (payload) => run(() => api.put(`${BASE}/users/${uid}/limits`, payload), () => setEditing(false));
  const resetLimits = () => run(() => api.del(`${BASE}/users/${uid}/limits`));
  const wipe = () => setConfirm({
    title: L('Delete this user’s ENTIRE My PC?', 'حذف جهاز المستخدم بالكامل؟'),
    message: L('Every file, folder, version and link of this user is deleted permanently. This cannot be undone.', 'كل ملفات ومجلدات ونسخ وروابط المستخدم هتتحذف نهائيًا. مفيش رجوع.'),
    label: L('Delete everything', 'حذف كل حاجة'), wipe: true,
    run: () => run(() => api.post(`${BASE}/users/${uid}/wipe`, { confirm: 'DELETE' })),
  });

  if (err) return <><button type="button" className="btn btn-outline btn-sm mtc-back" onClick={onClose}><Icon name="arrow-left" size={14} /> {L('Back', 'رجوع')}</button><ErrorState error={err} onRetry={load} /></>;
  if (!d) return <Skeleton rows={8} cols={4} />;

  const { user, usage, limits } = d;
  const TABS = [['overview', L('Overview', 'نظرة عامة')], ['files', L('Files', 'الملفات')], ['trash', L('Recycle bin', 'المحذوفات')], ['shares', L('Links', 'الروابط')], ['history', L('Admin history', 'سجل الأدمن')]];

  return (
    <div className="mtc-page">
      <button type="button" className="btn btn-outline btn-sm mtc-back" onClick={onClose}><Icon name="arrow-left" size={14} /> {L('Back to My PC control', 'رجوع لتحكم جهازي')}</button>
      {banner}
      <header className="mtc-block dvc-head">
        <div>
          <h1 className="mtc-drawer__title">{user.name || `#${user.id}`}</h1>
          <div className="mtc-drawer__sub"><StatusBadge status={limits.status} />
            {(user.roles || []).map((r) => <span key={r} className="badge badge-neutral">{ROLE_LABELS[r] ? ROLE_LABELS[r][ar ? 1 : 0] : r}</span>)}
            {user.deleted && <span className="badge badge-danger">{L('Account deleted', 'الحساب محذوف')}</span>}
            <small className="mtc-muted">{user.email}</small></div>
        </div>
        <div className="mtc-actions mtc-actions--wrap">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing((x) => !x)}><Icon name="settings" size={14} /> {L('Limits & state', 'الحدود والحالة')}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { clear(); downloadFrom(`${BASE}/users/${uid}/archive`, { all: 1 }, `UIPE-PC-user-${uid}.zip`).catch((e) => setError(errorMessage(e))); }}><Icon name="download" size={14} /> {L('Download everything (ZIP)', 'تنزيل كل الملفات (ZIP)')}</button>
        </div>
      </header>

      {limits.status !== 'active' && (
        <div className="st-alert st-alert--danger mtc-banner"><Icon name="lock" size={16} /><span>{limits.status === 'blocked' ? L('My PC is closed for this user.', 'جهازي مقفول للمستخدم ده.') : L('This user is read-only (view & download only).', 'المستخدم ده قراءة فقط (عرض وتنزيل).')}{limits.reason ? ` — ${limits.reason}` : ''}</span></div>
      )}

      {editing && (
        <section className="mtc-block">
          <h2 className="mtc-block__title"><Icon name="settings" size={15} /> {L('Limits & state', 'الحدود والحالة')}</h2>
          <LimitsForm key={JSON.stringify(limits)} initial={limits} busy={busy} onSubmit={saveLimits} onCancel={() => setEditing(false)} />
          {limits.has_override && <button type="button" className="mtc-link" onClick={resetLimits}><Icon name="refresh" size={11} /> {L('Back to the default limits', 'الرجوع للحدود الافتراضية')}</button>}
        </section>
      )}

      <div className="mtc-tabs mtc-subtabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`mtc-tab${tab === k ? ' is-active' : ''}`} onClick={() => go(k)}>{label}</button>)}
      </div>

      {tab === 'overview' && (
        <>
          <section className="mtc-block">
            <h2 className="mtc-block__title"><Icon name="hard-drive" size={15} /> {L('Storage', 'التخزين')}</h2>
            <UsageBar {...usage} quotaHuman={usage.quota_human} usedHuman={usage.used_human} />
            <div className="mtc-facts" style={{ marginTop: 14 }}>
              <div><span className="mtc-muted">{L('Quota source', 'مصدر الحصة')}</span><strong>{{ user: L('Custom for user', 'مخصصة للمستخدم'), role: L('Account type', 'نوع الحساب'), global: L('Default', 'الافتراضية') }[limits.quota_source] || limits.quota_source}</strong></div>
              <div><span className="mtc-muted">{L('Max file size', 'أقصى حجم للملف')}</span><strong>{limits.effective_max_file_mb} MB</strong></div>
              <div><span className="mtc-muted">{L('Files / folders', 'ملفات / مجلدات')}</span><strong>{usage.files.toLocaleString()} / {usage.folders.toLocaleString()}</strong></div>
              <div><span className="mtc-muted">{L('In recycle bin', 'في المحذوفات')}</span><strong>{usage.trash_human}</strong></div>
              <div><span className="mtc-muted">{L('Versions', 'النسخ')}</span><strong>{d.versions.count} · {d.versions.human}</strong></div>
              <div><span className="mtc-muted">{L('Links (open / total)', 'روابط (مفتوحة / كلها)')}</span><strong>{d.shares.open} / {d.shares.total}</strong></div>
              <div><span className="mtc-muted">{L('Last login', 'آخر دخول')}</span><strong>{fmtDate(user.last_login_at, ar)}</strong></div>
              <div><span className="mtc-muted">{L('Last activity', 'آخر نشاط')}</span><strong>{fmtDate(usage.last_activity, ar)}</strong></div>
            </div>
            {limits.note && <p className="mtc-muted" style={{ marginTop: 10 }}><Icon name="note" size={12} /> {limits.note}</p>}
          </section>
          <section className="mtc-block">
            <h2 className="mtc-block__title"><Icon name="layers" size={15} /> {L('By type', 'حسب النوع')}</h2>
            <div className="mtc-chips">{(d.by_category || []).filter((c) => c.files > 0).map((c) => <span key={c.category} className="mtc-chip">{catLabel(c.category, ar)} · {c.files} · {fmtBytes(c.bytes)}</span>)}</div>
          </section>
          <div className="dvc-grid2">
            <FileList title={L('Largest files', 'أكبر الملفات')} icon="trend" rows={d.largest} uid={uid} setError={setError} clear={clear} />
            <FileList title={L('Recently changed', 'آخر تعديل')} icon="clock" rows={d.recent} uid={uid} setError={setError} clear={clear} />
          </div>
          <section className="mtc-block mtc-danger">
            <h2 className="mtc-block__title"><Icon name="alert-triangle" size={15} /> {L('Danger zone', 'منطقة الخطر')}</h2>
            <div className="mtc-actions mtc-actions--wrap">
              <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => setConfirm({
                title: L('Revoke all links of this user?', 'إلغاء كل روابط المستخدم؟'), message: L('All of this user’s public links stop working.', 'كل الروابط العامة للمستخدم هتقف.'), label: L('Revoke', 'إلغاء'),
                run: () => run(() => api.post(`${BASE}/emergency/revoke-all-shares`, { confirm: true, user_id: uid })),
              })}><Icon name="share" size={14} /> {L('Revoke all links', 'إلغاء كل الروابط')}</button>
              <button type="button" className="btn mtc-btn-danger btn-sm" onClick={wipe}><Icon name="trash" size={14} /> {L('Delete the whole My PC', 'حذف جهازي بالكامل')}</button>
            </div>
          </section>
        </>
      )}
      {tab === 'files' && <Browser uid={uid} trashed={false} initialParent={params.get('parent')} onChanged={load} />}
      {tab === 'trash' && <Browser uid={uid} trashed onChanged={load} />}
      {tab === 'shares' && <SharesTab userId={uid} />}
      {tab === 'history' && <AuditTab userId={uid} />}

      {confirm && (
        <ConfirmModal title={confirm.title} message={<>{confirm.message}{confirm.wipe && (
          <input className="form-input" style={{ marginTop: 10 }} dir="ltr" value={wipeText} placeholder="DELETE" onChange={(e) => setWipeText(e.target.value)} />)}</>}
          confirmLabel={confirm.label} danger busy={busy || (confirm.wipe && wipeText !== 'DELETE')} onConfirm={confirm.run} onClose={() => { setConfirm(null); setWipeText(''); }} />
      )}
    </div>
  );
}

function FileList({ title, icon, rows, uid, setError, clear }) {
  const { L } = useL();
  const act = (fn) => { clear(); fn().catch((e) => setError(errorMessage(e))); };
  return (
    <section className="mtc-block">
      <h2 className="mtc-block__title"><Icon name={icon} size={15} /> {title}</h2>
      {!rows || rows.length === 0 ? <p className="mtc-muted">—</p> : (
        <ul className="mtc-list">{rows.map((f) => (
          <li key={f.id}><span dir="auto"><strong>{f.name}</strong><br /><small className="mtc-muted">{f.size_human}</small></span>
            <span className="mtc-actions">
              <button type="button" className="btn btn-outline btn-sm" title={L('View', 'عرض')} onClick={() => act(() => previewFrom(`${BASE}/users/${uid}/files/${f.id}/download`))}><Icon name="eye" size={13} /></button>
              <button type="button" className="btn btn-outline btn-sm" title={L('Download', 'تنزيل')} onClick={() => act(() => downloadFrom(`${BASE}/users/${uid}/files/${f.id}/download`, undefined, f.name))}><Icon name="download" size={13} /></button>
            </span></li>))}
        </ul>
      )}
    </section>
  );
}

/** Folder browser (or the recycle bin) with view / download / versions and trash / restore / purge. */
function Browser({ uid, trashed, initialParent, onChanged }) {
  const { ar, L } = useL();
  const navigate = useNavigate();
  const { banner, setNotice, setError, clear } = useBanner();
  const [parent, setParent] = useState(initialParent ? Number(initialParent) : null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState([]);
  const [info, setInfo] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null); setSel([]);
    return api.get(`${BASE}/users/${uid}/files`, trashed ? { trashed: 1 } : { parent_id: parent ?? undefined })
      .then((j) => setData(j.data)).catch((e) => setErr(errorMessage(e)));
  }, [uid, parent, trashed]);
  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const act = (fn) => { clear(); fn().catch((e) => setError(errorMessage(e))); };
  const url = (f, suffix = '/download') => `${BASE}/users/${uid}/files/${f.id}${suffix}`;

  async function run(fn) {
    setBusy(true); clear();
    try { const j = await fn(); setNotice(j.message); await load(); onChanged && onChanged(); } catch (e) { setError(errorMessage(e)); }
    setConfirm(null); setBusy(false);
  }
  const post = (path, body) => run(() => api.post(`${BASE}/users/${uid}/${path}`, body));
  const ask = (title, message, label, fn) => setConfirm({ title, message, label, run: fn });

  async function openInfo(f) {
    clear();
    try { const j = await api.get(url(f, '')); setInfo(j.data); } catch (e) { setError(errorMessage(e)); }
  }
  const allOn = items.length > 0 && items.every((r) => sel.includes(r.id));
  const crumbs = data?.breadcrumb || [];

  if (err) return <ErrorState error={err} onRetry={load} />;
  if (!data) return <Skeleton rows={6} cols={4} />;

  return (
    <div className="mtc-stack">
      {banner}
      {!trashed && (
        <nav className="dvc-crumbs" aria-label="path">
          <button type="button" className="mtc-link" onClick={() => setParent(null)}>{L('My PC', 'جهازي')}</button>
          {crumbs.map((c) => <span key={c.id}> / <button type="button" className="mtc-link" onClick={() => setParent(c.id)}>{c.name}</button></span>)}
        </nav>
      )}
      <div className="mtc-actions mtc-actions--wrap">
        {sel.length > 0 && !trashed && <>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => act(() => downloadFrom(`${BASE}/users/${uid}/archive?${sel.map((i) => `ids[]=${i}`).join('&')}`, undefined, `UIPE-PC-user-${uid}.zip`))}><Icon name="download" size={13} /> {L('ZIP', 'ZIP')} ({sel.length})</button>
          <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => ask(L('Move to recycle bin?', 'نقل للمحذوفات؟'), L(`${sel.length} item(s) will move to the user’s recycle bin.`, `${sel.length} عنصر هيتنقل لمحذوفات المستخدم.`), L('Move', 'نقل'), () => post('files/trash', { ids: sel }))}><Icon name="trash" size={13} /> {L('Move to bin', 'نقل للمحذوفات')}</button></>}
        {sel.length > 0 && trashed && <>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => post('files/restore', { ids: sel })}><Icon name="refresh" size={13} /> {L('Restore', 'استرجاع')} ({sel.length})</button>
          <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => ask(L('Delete permanently?', 'حذف نهائي؟'), L('This cannot be undone.', 'مفيش رجوع.'), L('Delete', 'حذف'), () => post('files/purge', { ids: sel }))}><Icon name="trash" size={13} /> {L('Delete permanently', 'حذف نهائي')}</button></>}
        {trashed && items.length > 0 && <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => ask(L('Empty the recycle bin?', 'تفريغ المحذوفات؟'), L('Everything in this user’s bin is deleted permanently.', 'كل اللي في محذوفات المستخدم هيتمسح نهائيًا.'), L('Empty', 'تفريغ'), () => post('trash/empty', {}))}>{L('Empty bin', 'تفريغ المحذوفات')}</button>}
        <button type="button" className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={13} /></button>
      </div>

      {items.length === 0 ? <section className="sa-card"><EmptyState icon={trashed ? 'trash' : 'folder'} title={trashed ? L('The recycle bin is empty', 'المحذوفات فاضية') : L('This folder is empty', 'المجلد فاضي')} /></section> : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? [] : items.map((r) => r.id))} aria-label={L('Select all', 'تحديد الكل')} /></th>
            <th>{L('Name', 'الاسم')}</th><th>{L('Size', 'الحجم')}</th><th>{trashed ? L('Deleted', 'اتحذف') : L('Modified', 'تعديل')}</th><th /></tr></thead>
          <tbody>{items.map((f) => {
            const folder = f.type === 'folder';
            return (
              <tr key={f.id}>
                <td><input type="checkbox" checked={sel.includes(f.id)} onChange={() => setSel((s) => (s.includes(f.id) ? s.filter((x) => x !== f.id) : [...s, f.id]))} aria-label={f.name} /></td>
                <td data-label={L('Name', 'الاسم')}>
                  <Icon name={folder ? 'folder' : 'file'} size={14} />{' '}
                  {folder && !trashed ? <button type="button" className="mtc-link mtc-title" onClick={() => setParent(f.id)} dir="auto"><strong>{f.name}</strong></button> : <strong dir="auto">{f.name}</strong>}
                </td>
                <td data-label={L('Size', 'الحجم')}>{folder ? '—' : f.size_human}</td>
                <td data-label={L('Modified', 'تعديل')}>{fmtDate(trashed ? f.deleted_at : f.updated_at, ar)}</td>
                <td className="mtc-row-actions">
                  <button type="button" className="btn btn-outline btn-sm" title={L('Details & versions', 'التفاصيل والنسخ')} onClick={() => openInfo(f)}><Icon name="info" size={13} /></button>
                  {!folder && <>
                    <button type="button" className="btn btn-outline btn-sm" title={L('View (logged)', 'عرض (بيتسجّل)')} onClick={() => act(() => previewFrom(url(f)))}><Icon name="eye" size={13} /></button>
                    <button type="button" className="btn btn-outline btn-sm" title={L('Download (logged)', 'تنزيل (بيتسجّل)')} onClick={() => act(() => downloadFrom(url(f), undefined, f.name))}><Icon name="download" size={13} /></button></>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}

      {info && (
        <div className="modal-overlay" onClick={() => setInfo(null)}>
          <div className="modal-box card glass-panel dvc-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-box__title text-h3" dir="auto">{info.node.name}</h2>
            <div className="mtc-facts">
              <div><span className="mtc-muted">{L('Path', 'المسار')}</span><strong dir="auto">/{(info.path || []).map((p) => p.name).join('/')}</strong></div>
              <div><span className="mtc-muted">{L('Size', 'الحجم')}</span><strong>{info.node.size_human || '—'}</strong></div>
              <div><span className="mtc-muted">{L('Type', 'النوع')}</span><strong dir="ltr">{info.node.mime_type || info.node.type}</strong></div>
              <div><span className="mtc-muted">{L('On storage disk', 'على القرص')}</span><strong>{info.in_storage === null ? '—' : info.in_storage ? L('Yes', 'نعم') : L('MISSING', 'مفقود')}</strong></div>
              <div><span className="mtc-muted">{L('Created', 'اتنشأ')}</span><strong>{fmtDate(info.node.created_at, ar)}</strong></div>
              {info.node.sha1 && <div><span className="mtc-muted">SHA-1</span><strong dir="ltr" style={{ fontSize: 11 }}>{info.node.sha1}</strong></div>}
            </div>
            {info.versions?.length > 0 && <>
              <h3 className="mtc-block__title" style={{ marginTop: 14 }}>{L('Versions', 'النسخ السابقة')}</h3>
              <ul className="mtc-list">{info.versions.map((v) => (
                <li key={v.id}><span>{fmtDate(v.created_at, ar)} · {v.size_human}{v.reason ? ` · ${v.reason}` : ''}</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => act(() => downloadFrom(`${BASE}/users/${uid}/files/${info.node.id}/versions/${v.id}/download`, undefined, v.name))}><Icon name="download" size={13} /></button></li>))}
              </ul></>}
            {info.shares?.length > 0 && <p className="mtc-muted" style={{ marginTop: 10 }}><Icon name="share" size={12} /> {L(`${info.shares.length} share link(s)`, `${info.shares.length} رابط مشاركة`)} · <button type="button" className="mtc-link" onClick={() => navigate(`/admin/drive-control/users/${uid}?tab=shares`)}>{L('Manage', 'إدارة')}</button></p>}
            <div className="modal-box__actions"><button type="button" className="btn btn-primary" onClick={() => setInfo(null)}>{L('Close', 'إغلاق')}</button></div>
          </div>
        </div>
      )}
      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.label} danger busy={busy} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
}
