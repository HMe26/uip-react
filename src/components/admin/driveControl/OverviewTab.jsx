import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal } from '../adminUi';
import { ErrorState, Kpi, KpiGrid, Skeleton } from '../AdminPage';
import { BASE, SETTING_META, Switch, UsageBar, catLabel, fmtBytes, useBanner, useL } from './shared';

const FEATURES = { uploads: 'feature_uploads', sharing: 'feature_sharing', archive: 'feature_archive', terminal: 'feature_terminal', vscode: 'feature_vscode', browser: 'feature_browser' };

export default function OverviewTab({ onGoto }) {
  const { ar, L } = useL();
  const navigate = useNavigate();
  const { banner, setNotice, setError, clear } = useBanner();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/overview`).then((j) => setD(j.data)).catch((e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setBusy(true); clear();
    try { const j = await fn(); setNotice(j.message); await load(); } catch (e) { setError(errorMessage(e)); }
    setConfirm(null); setBusy(false);
  }
  const toggleFeature = (key, on) => run(() => api.put(`${BASE}/settings`, { values: { [key]: on } }));

  if (err) return <ErrorState error={err} onRetry={load} />;
  if (!d) return <Skeleton rows={6} cols={4} />;

  const t = d.totals || {};
  const sh = d.shares || {};
  const maxCat = Math.max(1, ...(d.by_category || []).map((c) => c.bytes));
  const days = d.uploads_30d || [];
  const maxDay = Math.max(1, ...days.map((x) => x.bytes));

  return (
    <div className="mtc-stack">
      {banner}
      {!d.system_enabled && (
        <div className="st-alert st-alert--danger mtc-banner"><Icon name="alert-triangle" size={16} />
          <span>{L('My PC is switched OFF for all users.', 'جهازي مقفول لكل المستخدمين.')} {d.maintenance_message}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.put(`${BASE}/settings`, { values: { feature_drive: true } }))}>{L('Turn on', 'تشغيل')}</button>
        </div>
      )}

      <KpiGrid>
        <Kpi icon="hard-drive" title={L('Total storage used', 'إجمالي التخزين المستخدم')} value={t.used_human} note={L(`incl. ${t.trash_human} in recycle bins`, `منها ${t.trash_human} في المحذوفات`)} />
        <Kpi icon="users" title={L('Users with files', 'مستخدمين عندهم ملفات')} value={(t.users_with_files || 0).toLocaleString()} />
        <Kpi icon="file" title={L('Files', 'الملفات')} value={(t.files || 0).toLocaleString()} note={L(`${(t.folders || 0).toLocaleString()} folders`, `${(t.folders || 0).toLocaleString()} مجلد`)} />
        <Kpi icon="history" title={L('Versions', 'النسخ المحفوظة')} value={(t.versions || 0).toLocaleString()} note={t.versions_human} />
        <Kpi icon="share" title={L('Active links', 'روابط نشطة')} value={(sh.active || 0).toLocaleString()} note={L(`${sh.views || 0} views · ${sh.downloads || 0} downloads`, `${sh.views || 0} فتح · ${sh.downloads || 0} تنزيل`)} />
        <Kpi icon="lock" title={L('Restricted users', 'مستخدمين مقيّدين')} value={((d.users_by_status?.readonly || 0) + (d.users_by_status?.blocked || 0)).toLocaleString()} tone={(d.users_by_status?.blocked || 0) ? 'warning' : undefined}
          note={L(`${d.users_by_status?.readonly || 0} read-only · ${d.users_by_status?.blocked || 0} blocked`, `${d.users_by_status?.readonly || 0} قراءة فقط · ${d.users_by_status?.blocked || 0} محظور`)} />
      </KpiGrid>

      <section className="sa-card mtc-card">
        <h2 className="mtc-card__title"><Icon name="settings" size={16} /> {L('Quick switches', 'مفاتيح سريعة')}</h2>
        <div className="mtc-chips">
          <span className={`mtc-chip ${d.system_enabled ? 'is-on' : 'is-off'}`}>
            <Switch checked={d.system_enabled} disabled={busy} label="My PC" onChange={(x) => run(() => api.put(`${BASE}/settings`, { values: { feature_drive: x } }))} /> {L('My PC', 'جهازي')}
          </span>
          {Object.entries(FEATURES).map(([k, key]) => (
            <span key={k} className={`mtc-chip ${d.features?.[k] ? 'is-on' : 'is-off'}`}>
              <Switch checked={!!d.features?.[k]} disabled={busy} label={SETTING_META[key].en} onChange={(x) => toggleFeature(key, x)} /> {ar ? SETTING_META[key].ar : SETTING_META[key].en}
            </span>
          ))}
        </div>
        <p className="mtc-muted" style={{ marginTop: 10 }}>
          <Icon name="hard-drive" size={12} /> {L('Disk', 'القرص')}: <b dir="ltr">{d.disk?.name}</b> ({d.disk?.driver}){d.disk?.direct ? ` · ${L('direct upload on', 'الرفع المباشر شغال')}` : ''} · {L('Default quota', 'الحصة الافتراضية')}: {d.global_quota_mb} MB
        </p>
      </section>

      <div className="dvc-grid2">
        <section className="sa-card mtc-card">
          <h2 className="mtc-card__title"><Icon name="layers" size={16} /> {L('Storage by type', 'التخزين حسب النوع')}</h2>
          <ul className="dvc-bars">
            {(d.by_category || []).filter((c) => c.files > 0).sort((a, b) => b.bytes - a.bytes).map((c) => (
              <li key={c.category}>
                <span>{catLabel(c.category, ar)}</span>
                <div className="dvc-usage__bar"><i style={{ width: `${Math.max(2, (c.bytes / maxCat) * 100)}%` }} /></div>
                <small className="mtc-muted">{fmtBytes(c.bytes)} · {c.files.toLocaleString()}</small>
              </li>
            ))}
          </ul>
        </section>
        <section className="sa-card mtc-card">
          <h2 className="mtc-card__title"><Icon name="upload" size={16} /> {L('Uploads — last 30 days', 'الرفع — آخر 30 يوم')}</h2>
          <div className="dvc-spark" role="img" aria-label={L('Uploads per day', 'الرفع في اليوم')}>
            {days.map((x) => <i key={x.date} title={`${x.date} · ${x.files} · ${fmtBytes(x.bytes)}`} style={{ height: `${Math.max(3, (x.bytes / maxDay) * 100)}%` }} />)}
          </div>
          <small className="mtc-muted">{L(`${days.reduce((s, x) => s + x.files, 0).toLocaleString()} files · ${fmtBytes(days.reduce((s, x) => s + x.bytes, 0))}`, `${days.reduce((s, x) => s + x.files, 0).toLocaleString()} ملف · ${fmtBytes(days.reduce((s, x) => s + x.bytes, 0))}`)}</small>
        </section>
      </div>

      <div className="dvc-grid2">
        <UserList title={L('Top storage users', 'أكثر المستخدمين استهلاكًا')} icon="trend" rows={d.top_users} onOpen={(id) => navigate(`/admin/drive-control/users/${id}`)} L={L} />
        <UserList title={L('Close to their quota (90%+)', 'قاربوا على حصتهم (90%+)')} icon="alert-triangle" rows={d.near_quota} onOpen={(id) => navigate(`/admin/drive-control/users/${id}`)} L={L} empty={L('Nobody is close to the limit.', 'مفيش حد قريب من الحد.')} />
      </div>

      <section className="sa-card mtc-card mtc-danger">
        <h2 className="mtc-card__title"><Icon name="alert-triangle" size={16} /> {L('Emergency & maintenance', 'الطوارئ والصيانة')}</h2>
        <div className="mtc-actions mtc-actions--wrap">
          <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" onClick={() => setConfirm({
            title: L('Revoke ALL share links?', 'إلغاء كل روابط المشاركة؟'),
            message: L('Every public link on the platform stops working immediately. Users can create new ones.', 'كل الروابط العامة على المنصة هتقف فورًا. المستخدمين يقدروا ينشئوا روابط جديدة.'),
            label: L('Revoke all', 'إلغاء الكل'),
            run: () => run(() => api.post(`${BASE}/emergency/revoke-all-shares`, { confirm: true })),
          })}><Icon name="share" size={14} /> {L('Revoke all links', 'إلغاء كل الروابط')}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirm({
            title: L('Purge expired recycle-bin items?', 'مسح المحذوفات المنتهية؟'),
            message: L('Items older than the retention period are deleted permanently now.', 'العناصر اللي عدّت مدة الاحتفاظ هتتمسح نهائيًا دلوقتي.'),
            label: L('Purge', 'مسح'),
            run: () => run(() => api.post(`${BASE}/maintenance/purge-trash`, {})),
          })}><Icon name="trash" size={14} /> {L('Purge expired bin', 'مسح المحذوفات المنتهية')}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onGoto('health')}><Icon name="wrench" size={14} /> {L('Check missing files', 'فحص الملفات المفقودة')}</button>
        </div>
      </section>

      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.label} danger busy={busy} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function UserList({ title, icon, rows, onOpen, empty, L }) {
  return (
    <section className="sa-card mtc-card">
      <h2 className="mtc-card__title"><Icon name={icon} size={16} /> {title}</h2>
      {!rows || rows.length === 0 ? <p className="mtc-muted">{empty || '—'}</p> : (
        <ul className="mtc-list">
          {rows.map((u) => (
            <li key={u.id}>
              <span><button type="button" className="mtc-link mtc-title" onClick={() => onOpen(u.id)}><strong>{u.name || `#${u.id}`}</strong></button><br /><small className="mtc-muted">{u.email}</small></span>
              <UsageBar {...u} quotaHuman={u.quota_human} usedHuman={u.used_human} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
