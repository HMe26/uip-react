import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal } from '../adminUi';
import AdminPage, { ErrorState, Kpi, KpiGrid, Skeleton } from '../AdminPage';
import { BASE, SETTING_META, fmtBytes, fmtDate, useBanner, useL } from './shared';

const FEATURE_KEY = {
  guests: 'feature_guests', invitations: 'feature_invitations', chat: 'feature_chat', private_chat: 'feature_private_chat',
  files: 'feature_files', recording: 'feature_recording', polls: 'feature_polls', notes: 'feature_notes',
  screen_share: 'feature_screen_share', remote_control: 'feature_remote_control', reactions: 'feature_reactions', hand_raise: 'feature_hand_raise',
};

export default function OverviewTab({ onGoto }) {
  const { ar, L } = useL();
  const { banner, setNotice, setError, clear } = useBanner();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/overview`).then((j) => setD(j.data)).catch((e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { load(); const h = setInterval(load, 30000); return () => clearInterval(h); }, [load]);

  async function endAll() {
    setBusy(true); clear();
    try { const j = await api.post(`${BASE}/emergency/end-all-live`, { confirm: true }); setNotice(j.message); setConfirm(false); await load(); } catch (e) { setError(errorMessage(e)); setConfirm(false); }
    setBusy(false);
  }

  if (err) return <ErrorState error={err} onRetry={load} />;
  if (!d) return <Skeleton rows={6} cols={4} />;

  const s = d.meetings_by_status || {};
  const mon = d.monitoring || {};
  const rec = mon.recordings || {};
  const live = (s.live || 0) + (s.lobby || 0);

  return (
    <div className="mtc-stack">
      {banner}
      {!d.system_enabled && (
        <div className="st-alert st-alert--danger mtc-banner">
          <Icon name="alert-triangle" size={16} />
          <span>{L('The meetings system is currently OFF.', 'نظام الاجتماعات مقفول حاليًا.')} {d.maintenance_message && <em>“{d.maintenance_message}”</em>}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onGoto('features')}>{L('Open switches', 'افتح المفاتيح')}</button>
        </div>
      )}

      <KpiGrid>
        <Kpi icon="video" title={L('Live meetings', 'اجتماعات جارية')} value={live} tone={live ? 'ok' : undefined} />
        <Kpi icon="users" title={L('People in meetings now', 'متواجدين الآن')} value={d.live_participants} />
        <Kpi icon="calendar" title={L('Scheduled', 'مجدولة')} value={s.scheduled || 0} note={L(`${d.upcoming_24h} in next 24h`, `${d.upcoming_24h} خلال ٢٤ ساعة`)} />
        <Kpi icon="clock" title={L('Waiting to be admitted', 'في انتظار القبول')} value={d.pending_join_requests} />
      </KpiGrid>
      <KpiGrid>
        <Kpi icon="message-square" title={L('Chat messages today', 'رسائل الشات اليوم')} value={d.chat_messages_today} />
        <Kpi icon="file" title={L('Shared files', 'ملفات مشاركة')} value={d.files?.count ?? 0} note={fmtBytes(d.files?.bytes)} />
        <Kpi icon="archive" title={L('Recordings', 'التسجيلات')} value={rec.total ?? 0} note={fmtBytes(rec.storage_bytes)} />
        <Kpi icon="user-x" title={L('Blocked creators', 'محظورين من الإنشاء')} value={d.blocked_users} />
      </KpiGrid>
      <KpiGrid>
        <Kpi icon="bar-chart" title={L('Total meetings', 'إجمالي الاجتماعات')} value={mon.total_meetings ?? 0} />
        <Kpi icon="trend" title={L('Today / 7 days', 'اليوم / ٧ أيام')} value={`${mon.meetings_today ?? 0} / ${mon.meetings_this_week ?? 0}`} />
        <Kpi icon="clock" title={L('Avg. duration', 'متوسط المدة')} value={mon.duration_stats?.average_minutes != null ? `${mon.duration_stats.average_minutes} ${L('min', 'د')}` : '—'} />
        <Kpi icon="alert" title={L('Connection failures today', 'فشل اتصال اليوم')} value={mon.failed_connections?.today ?? 0} tone={mon.failed_connections?.today ? 'warning' : undefined} />
      </KpiGrid>

      <section className="sa-card mtc-card">
        <h2 className="mtc-card__title"><Icon name="settings" size={16} /> {L('Feature status', 'حالة الميزات')}</h2>
        <div className="mtc-chips">
          {Object.entries(FEATURE_KEY).map(([name, key]) => {
            const on = d.features?.[name];
            const m = SETTING_META[key] || { en: name, ar: name };
            return <span key={name} className={`mtc-chip ${on ? 'is-on' : 'is-off'}`}>{on ? '●' : '○'} {ar ? m.ar : m.en}</span>;
          })}
        </div>
        <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => onGoto('features')}>{L('Change switches', 'تغيير المفاتيح')}</button>
      </section>

      {(mon.security_events || []).length > 0 && (
        <section className="sa-card mtc-card">
          <h2 className="mtc-card__title"><Icon name="shield" size={16} /> {L('Recent security events', 'أحدث الأحداث الأمنية')}</h2>
          <div className="adm-table-wrap"><table className="adm-table">
            <thead><tr><th>{L('Event', 'الحدث')}</th><th>{L('Meeting', 'الاجتماع')}</th><th>{L('User', 'المستخدم')}</th><th>{L('When', 'الوقت')}</th></tr></thead>
            <tbody>{mon.security_events.map((ev) => (
              <tr key={ev.id}><td><span className="badge badge-warning">{ev.action}</span></td><td>#{ev.meeting_id ?? '—'}</td><td>{ev.user_id ?? '—'}</td><td>{fmtDate(ev.created_at, ar)}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <section className="sa-card mtc-card mtc-danger">
        <h2 className="mtc-card__title"><Icon name="alert-triangle" size={16} /> {L('Emergency', 'طوارئ')}</h2>
        <p className="mtc-muted">{L('Immediately ends every live meeting on the platform and notifies participants.', 'بينهي فورًا كل الاجتماعات الشغالة على المنصة ويبلّغ المشاركين.')}</p>
        <button type="button" className="btn btn-sm mtc-btn-danger" disabled={!live} onClick={() => setConfirm(true)}><Icon name="stop" size={14} /> {L(`End all live meetings (${live})`, `إنهاء كل الاجتماعات الشغالة (${live})`)}</button>
      </section>

      {confirm && <ConfirmModal danger busy={busy} title={L('End all live meetings?', 'إنهاء كل الاجتماعات الشغالة؟')}
        message={L(`${live} meeting(s) will be ended for everyone right now. This cannot be undone.`, `${live} اجتماع هيتنهي للجميع الآن. مفيش رجوع.`)}
        confirmLabel={L('End all', 'إنهاء الكل')} onConfirm={endAll} onClose={() => setConfirm(false)} />}
    </div>
  );
}
