import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal } from '../adminUi';
import { Skeleton } from '../AdminPage';
import { BASE, StatusPill, Switch, fmtBytes, fmtDate, useBanner, useL } from './shared';

const SETTING_FLAGS = [
  ['mute_on_entry', 'Mute on entry', 'كتم الميكروفون عند الدخول'],
  ['camera_on_entry', 'Camera on at entry', 'تشغيل الكاميرا عند الدخول'],
  ['allow_chat', 'Chat enabled', 'الشات مفعّل'],
  ['allow_file_sharing', 'File sharing enabled', 'مشاركة الملفات مفعّلة'],
  ['recording_enabled', 'Recording allowed', 'التسجيل مسموح'],
];

const CONN_TONE = { connected: 'badge-success', connecting: 'badge-warning', reconnecting: 'badge-warning', disconnected: 'badge-neutral', failed: 'badge-danger' };

const toLocalInput = (v) => (v ? String(v).slice(0, 16) : '');

/**
 * Full control PAGE for ONE meeting (admin) — opens on its own route /admin/meetings-control/:uuid (AdminMeetingControlDetail). Everything here calls
 * /api/v1/admin/meetings/control/meetings/{uuid}/…  Chat text, notes and recording/file contents are
 * deliberately NOT available (privacy rule of the platform) — admins see metadata and can delete.
 */
export default function MeetingDetail({ uuid, onClose }) {
  const { ar, L } = useL();
  const { banner, setNotice, setError, clear } = useBanner();
  const [d, setD] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, label, danger, run }
  const [form, setForm] = useState(null);
  const [announce, setAnnounce] = useState('');
  const [tab, setTab] = useState('people');

  const url = `${BASE}/meetings/${uuid}`;

  const apply = useCallback((data) => {
    setD(data);
    const m = data.meeting;
    setForm({
      title: m.title || '', description: m.description || '',
      scheduled_start_at: toLocalInput(m.scheduled_start_at),
      duration_minutes: m.duration_minutes ?? '', max_participants: m.max_participants ?? '',
      waiting_room_enabled: !!m.waiting_room_enabled, allow_guests: !!m.allow_guests,
      password: '', clear_password: false,
      settings: Object.fromEntries(SETTING_FLAGS.map(([k]) => [k, !!(m.settings || {})[k]])),
    });
  }, []);

  const load = useCallback(() => api.get(url).then((j) => apply(j.data)).catch((e) => setLoadErr(errorMessage(e))), [url, apply]);
  useEffect(() => { load(); }, [load]);

  // Auto-refresh while the meeting is running so the roster stays real.
  useEffect(() => {
    if (!d || !['live', 'lobby'].includes(d.meeting.status) || d.meeting.deleted_at) return undefined;
    const h = setInterval(() => { api.get(url).then((j) => setD(j.data)).catch(() => {}); }, 10000);
    return () => clearInterval(h);
  }, [d, url]);

  async function act(key, fn, done) {
    clear(); setBusy(key);
    try { const j = await fn(); if (j?.data?.meeting) apply(j.data); setNotice(done || j?.message || L('Done.', 'تم.')); } catch (e) { setError(errorMessage(e)); }
    setBusy(null);
  }

  const post = (path, body = {}) => api.post(`${url}/${path}`, body);
  const ask = (c) => setConfirm(c);
  const runConfirmed = async () => { const c = confirm; setConfirm(null); await c.run(); };

  if (loadErr) {
    return (
      <div className="mtc-page">
        <div className="st-alert st-alert--danger mtc-banner"><Icon name="alert-triangle" size={16} /><span>{loadErr}</span></div>
        <button type="button" className="btn btn-outline btn-sm mtc-back" onClick={onClose}><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {L('Back to meetings', 'الرجوع للاجتماعات')}</button>
      </div>
    );
  }

  const m = d?.meeting;
  const deleted = !!m?.deleted_at;
  const running = m && ['live', 'lobby'].includes(m.status) && !deleted;
  const people = d ? [...d.participants, ...d.guests] : [];
  const here = people.filter((p) => p.status === 'joined' || p.status === 'admitted');

  function savable() {
    const body = {
      title: form.title, description: form.description || null,
      duration_minutes: form.duration_minutes === '' ? null : Number(form.duration_minutes),
      max_participants: form.max_participants === '' ? null : Number(form.max_participants),
      waiting_room_enabled: form.waiting_room_enabled, allow_guests: form.allow_guests,
      settings: form.settings,
    };
    if (m.type === 'scheduled' && form.scheduled_start_at) body.scheduled_start_at = form.scheduled_start_at;
    if (form.clear_password) body.clear_password = true;
    else if (form.password) body.password = form.password;
    return body;
  }

  const personAction = (p, action, label) => act(`${p.key}:${action}`, () => post('participants/action', { key: p.key, action }), `${label} — ${p.name}: ${L('done', 'تم')}`);

  function PersonButtons({ p }) {
    const online = p.connection_state === 'connected' && (p.status === 'joined' || p.status === 'admitted');
    const B = ({ action, icon, text, danger, confirmMsg }) => (
      <button type="button" className={`btn btn-outline btn-sm${danger ? ' mtc-btn-danger-outline' : ''}`} disabled={busy === `${p.key}:${action}`} title={text}
        onClick={() => (confirmMsg
          ? ask({ title: text, message: confirmMsg, label: text, danger: true, run: () => personAction(p, action, text) })
          : personAction(p, action, text))}>
        <Icon name={icon} size={13} /> <span className="mtc-btn-txt">{text}</span>
      </button>
    );
    return (
      <div className="mtc-person-actions">
        {online && <B action="mute" icon="mic-off" text={L('Mute', 'كتم')} />}
        {online && p.camera_enabled && <B action="disable-camera" icon="video-off" text={L('Camera off', 'إغلاق الكاميرا')} />}
        {online && p.screen_sharing && <B action="stop-screen-share" icon="screen-share" text={L('Stop sharing', 'إيقاف المشاركة')} />}
        {p.screen_share_allowed === false
          ? <B action="reset-screen-share" icon="screen-share" text={L('Reset sharing', 'إرجاع صلاحية المشاركة')} />
          : <B action="deny-screen-share" icon="screen-share" text={L('Deny sharing', 'منع المشاركة')} />}
        {p.screen_share_allowed !== true && <B action="allow-screen-share" icon="check" text={L('Allow sharing', 'السماح بالمشاركة')} />}
        {p.type === 'user' && p.role === 'participant' && <B action="promote" icon="crown" text={L('Make co-host', 'ترقية لمشرف مساعد')} />}
        {p.type === 'user' && p.role === 'co_host' && <B action="demote" icon="user-x" text={L('Remove co-host', 'إزالة المشرف المساعد')} />}
        {p.type === 'user' && p.role !== 'host' && <B action="make-host" icon="crown" text={L('Make host', 'تحويل لهوست')} confirmMsg={L(`Make ${p.name} the host of this meeting?`, `تحويل ${p.name} لهوست الاجتماع؟`)} />}
        {p.role !== 'host' && online && <B action="remove" icon="user-x" text={L('Remove', 'طرد')} danger confirmMsg={L(`Remove ${p.name} from the meeting?`, `طرد ${p.name} من الاجتماع؟`)} />}
      </div>
    );
  }

  return (
    <div className="mtc-page">
        <button type="button" className="btn btn-outline btn-sm mtc-back" onClick={onClose}><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {L('Back to meetings', 'الرجوع للاجتماعات')}</button>
        <header className="mtc-drawer__head">
          <div>
            <h2 className="mtc-drawer__title">{m ? m.title : '…'}</h2>
            {m && <div className="mtc-drawer__sub"><StatusPill status={m.status} deleted={deleted} /> <small className="mtc-muted" dir="ltr">{m.meeting_code} · {m.uuid}</small></div>}
          </div>
        </header>

        {banner}
        {!d ? <Skeleton rows={6} cols={3} /> : (
          <div className="mtc-drawer__body">
            <section className="mtc-block">
              <div className="mtc-facts">
                <div><span className="mtc-muted">{L('Host', 'الهوست')}</span><strong>{m.host ? `${m.host.name}` : '—'}</strong><small className="mtc-muted">{m.host?.email}</small></div>
                <div><span className="mtc-muted">{L('Type', 'النوع')}</span><strong>{m.type === 'instant' ? L('Instant', 'فوري') : L('Scheduled', 'مجدول')}</strong></div>
                <div><span className="mtc-muted">{L('Scheduled', 'الموعد')}</span><strong>{fmtDate(m.scheduled_start_at, ar)}</strong></div>
                <div><span className="mtc-muted">{L('Started', 'بدأ')}</span><strong>{fmtDate(m.started_at, ar)}</strong></div>
                <div><span className="mtc-muted">{L('Ended', 'انتهى')}</span><strong>{fmtDate(m.ended_at || m.cancelled_at, ar)}</strong></div>
                <div><span className="mtc-muted">{L('Online now', 'متصلين الآن')}</span><strong>{m.live_participants}</strong></div>
                <div><span className="mtc-muted">{L('Chat messages', 'رسائل الشات')}</span><strong>{d.counts.chat_messages}</strong></div>
                <div><span className="mtc-muted">{L('Waiting requests', 'طلبات انتظار')}</span><strong>{d.counts.pending_requests}</strong></div>
              </div>
            </section>

            <section className="mtc-block">
              <h3 className="mtc-block__title">{L('Controls', 'التحكم')}</h3>
              <div className="mtc-actions mtc-actions--wrap">
                {deleted ? (
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act('restore', () => post('restore'), L('Meeting restored.', 'تم استرجاع الاجتماع.'))}><Icon name="refresh" size={14} /> {L('Restore meeting', 'استرجاع الاجتماع')}</button>
                ) : (
                  <>
                    {running && <button type="button" className="btn btn-sm mtc-btn-danger" disabled={!!busy} onClick={() => ask({ title: L('End this meeting?', 'إنهاء الاجتماع؟'), message: L('Everyone will be disconnected now.', 'الكل هيتفصل الآن.'), label: L('End meeting', 'إنهاء الاجتماع'), danger: true, run: () => act('end', () => post('end'), L('Meeting ended.', 'تم إنهاء الاجتماع.')) })}><Icon name="stop" size={14} /> {L('End meeting', 'إنهاء الاجتماع')}</button>}
                    {m.status === 'scheduled' && <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => ask({ title: L('Cancel this meeting?', 'إلغاء الاجتماع؟'), message: L('Invitees will be notified.', 'المدعوين هيتبلّغوا.'), label: L('Cancel meeting', 'إلغاء الاجتماع'), danger: true, run: () => act('cancel', () => post('cancel'), L('Meeting cancelled.', 'تم إلغاء الاجتماع.')) })}><Icon name="x-circle" size={14} /> {L('Cancel meeting', 'إلغاء الاجتماع')}</button>}
                    {(running || m.status === 'scheduled') && <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => act('lock', () => post('lock', { locked: !m.locked }), m.locked ? L('Meeting unlocked.', 'تم فتح الاجتماع.') : L('Meeting locked. Nobody new can join.', 'تم قفل الاجتماع. محدش جديد يقدر يدخل.'))}><Icon name="lock" size={14} /> {m.locked ? L('Unlock', 'فتح الاجتماع') : L('Lock meeting', 'قفل الاجتماع')}</button>}
                    {(running || m.status === 'scheduled') && <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => act('ss', () => post('screen-share-lock', { locked: !m.screen_sharing_locked }))}><Icon name="screen-share" size={14} /> {m.screen_sharing_locked ? L('Enable screen sharing', 'السماح بمشاركة الشاشة') : L('Disable screen sharing', 'إيقاف مشاركة الشاشة')}</button>}
                    <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => ask({ title: L('Regenerate join link?', 'تغيير رابط الانضمام؟'), message: L('The current link stops working immediately. People already inside are not affected.', 'الرابط الحالي هيبطل فورًا. اللي جوه الاجتماع مش هيتأثروا.'), label: L('Regenerate', 'تغيير الرابط'), run: () => act('link', () => post('regenerate-link'), L('New join link generated.', 'تم إنشاء رابط جديد.')) })}><Icon name="link" size={14} /> {L('New join link', 'رابط انضمام جديد')}</button>
                    <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" disabled={!!busy} onClick={() => ask({ title: L('Delete this meeting?', 'حذف الاجتماع؟'), message: L('A live meeting is ended first. You can restore it later from the Deleted filter.', 'لو شغال هيتنهي الأول. تقدر ترجّعه بعدين من فلتر المحذوف.'), label: L('Delete', 'حذف'), danger: true, run: async () => { clear(); setBusy('del'); try { await api.del(url); onClose(); } catch (e) { setError(errorMessage(e)); setBusy(null); } } })}><Icon name="trash" size={14} /> {L('Delete', 'حذف')}</button>
                  </>
                )}
              </div>
              {!deleted && (m.status !== 'cancelled') && (
                <div className="mtc-announce">
                  <input className="form-input" maxLength={500} value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder={L('Send an announcement to the meeting chat…', 'ابعت إعلان لشات الاجتماع…')} />
                  <button type="button" className="btn btn-primary btn-sm" disabled={!announce.trim() || busy === 'announce'} onClick={async () => { await act('announce', () => post('announce', { message: announce.trim() }), L('Announcement sent.', 'تم إرسال الإعلان.')); setAnnounce(''); }}><Icon name="megaphone" size={14} /> {L('Announce', 'إعلان')}</button>
                </div>
              )}
            </section>

            {!deleted && (
              <div className="sa-chips mtc-subtabs" role="tablist">
                {[['people', L(`People (${people.length})`, `المشاركون (${people.length})`)], ['edit', L('Edit settings', 'تعديل الإعدادات')], ['content', L(`Files, recordings & polls`, 'ملفات وتسجيلات واستطلاعات')], ['log', L('Activity', 'النشاط')]].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={`sa-chip${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{label}</button>
                ))}
              </div>
            )}

            {!deleted && tab === 'people' && (
              <section className="mtc-block">
                <h3 className="mtc-block__title">{L(`In the meeting now: ${here.length}`, `جوه الاجتماع الآن: ${here.length}`)}</h3>
                {people.length === 0 ? <p className="mtc-muted">{L('Nobody has joined yet.', 'محدش دخل لسه.')}</p> : (
                  <div className="adm-table-wrap"><table className="adm-table">
                    <thead><tr><th>{L('Person', 'الشخص')}</th><th>{L('Role', 'الدور')}</th><th>{L('Status', 'الحالة')}</th><th>{L('Media', 'ميديا')}</th><th>{L('Actions', 'إجراءات')}</th></tr></thead>
                    <tbody>{people.map((p) => (
                      <tr key={p.key}>
                        <td data-label={L('Person', 'الشخص')}><strong>{p.name}</strong>{p.type === 'guest' && <span className="badge badge-neutral" style={{ marginInlineStart: 6 }}>{L('Guest', 'ضيف')}</span>}<br /><small className="mtc-muted">{p.email || ''}</small></td>
                        <td data-label={L('Role', 'الدور')}>{p.role}</td>
                        <td data-label={L('Status', 'الحالة')}><span className="badge badge-neutral">{p.status}</span> {p.connection_state && <span className={`badge ${CONN_TONE[p.connection_state] || 'badge-neutral'}`}>{p.connection_state}</span>}<br /><small className="mtc-muted">{fmtDate(p.joined_at, ar)}</small></td>
                        <td data-label={L('Media', 'ميديا')}>
                          <span className="mtc-flags">
                            <span title="mic" className={p.mic_enabled ? '' : 'is-off'}><Icon name={p.mic_enabled ? 'mic' : 'mic-off'} size={14} /></span>
                            <span title="camera" className={p.camera_enabled ? '' : 'is-off'}><Icon name={p.camera_enabled ? 'video' : 'video-off'} size={14} /></span>
                            {p.screen_sharing && <span title="screen"><Icon name="screen-share" size={14} /></span>}
                            {p.hand_raised && <span title="hand"><Icon name="hand" size={14} /></span>}
                            {p.screen_share_allowed === false && <span title={L('Sharing denied', 'المشاركة ممنوعة')}><Icon name="x-circle" size={14} /></span>}
                          </span>
                        </td>
                        <td data-label={L('Actions', 'إجراءات')}><PersonButtons p={p} /></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </section>
            )}

            {!deleted && tab === 'edit' && form && (
              <section className="mtc-block">
                <div className="mtc-form">
                  <label className="mtc-field mtc-field--wide"><span>{L('Title', 'العنوان')}</span><input className="form-input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
                  <label className="mtc-field mtc-field--wide"><span>{L('Description', 'الوصف')}</span><textarea className="form-textarea" rows={3} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
                  {m.type === 'scheduled' && <label className="mtc-field"><span>{L('Start time (UTC)', 'وقت البداية (UTC)')}</span><input className="form-input" type="datetime-local" value={form.scheduled_start_at} onChange={(e) => setForm({ ...form, scheduled_start_at: e.target.value })} /></label>}
                  <label className="mtc-field"><span>{L('Duration (min)', 'المدة (دقيقة)')}</span><input className="form-input" type="number" min={5} max={1440} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></label>
                  <label className="mtc-field"><span>{L('Max participants', 'أقصى عدد مشاركين')}</span><input className="form-input" type="number" min={2} max={500} value={form.max_participants} onChange={(e) => setForm({ ...form, max_participants: e.target.value })} /></label>
                  <label className="mtc-field"><span>{m.has_password ? L('New password (leave empty to keep)', 'كلمة سر جديدة (فاضي = بدون تغيير)') : L('Set a password', 'تعيين كلمة سر')}</span><input className="form-input" type="text" minLength={4} maxLength={100} autoComplete="off" value={form.password} disabled={form.clear_password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
                  {m.has_password && <label className="mtc-check"><input type="checkbox" checked={form.clear_password} onChange={(e) => setForm({ ...form, clear_password: e.target.checked, password: '' })} /> {L('Remove the password', 'إزالة كلمة السر')}</label>}
                </div>
                <div className="mtc-settings">
                  <div className="mtc-setting"><div className="mtc-setting__text"><span className="mtc-setting__label">{L('Waiting room', 'غرفة الانتظار')}</span></div><div className="mtc-setting__control"><Switch checked={form.waiting_room_enabled} onChange={(v) => setForm({ ...form, waiting_room_enabled: v })} label="waiting room" /></div></div>
                  <div className="mtc-setting"><div className="mtc-setting__text"><span className="mtc-setting__label">{L('Allow guests', 'السماح بالضيوف')}</span></div><div className="mtc-setting__control"><Switch checked={form.allow_guests} onChange={(v) => setForm({ ...form, allow_guests: v })} label="guests" /></div></div>
                  {SETTING_FLAGS.map(([k, en, arT]) => (
                    <div className="mtc-setting" key={k}><div className="mtc-setting__text"><span className="mtc-setting__label">{ar ? arT : en}</span></div><div className="mtc-setting__control"><Switch checked={form.settings[k]} onChange={(v) => setForm({ ...form, settings: { ...form.settings, [k]: v } })} label={en} /></div></div>
                  ))}
                </div>
                <div className="mtc-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'save' || !form.title.trim()} onClick={() => act('save', () => api.patch(url, savable()), L('Meeting updated.', 'تم تعديل الاجتماع.'))}><Icon name="check" size={14} /> {busy === 'save' ? L('Saving…', 'جارٍ الحفظ…') : L('Save changes', 'حفظ التعديلات')}</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => apply(d)}>{L('Discard', 'تجاهل')}</button>
                </div>
              </section>
            )}

            {tab === 'content' && (
              <>
                <section className="mtc-block">
                  <h3 className="mtc-block__title"><Icon name="file" size={15} /> {L(`Shared files (${d.files.length})`, `الملفات المشاركة (${d.files.length})`)}</h3>
                  <p className="mtc-muted">{L('Contents are private — you can see that a file exists and delete it.', 'المحتوى خاص — تقدر تشوف إن الملف موجود وتحذفه بس.')}</p>
                  {d.files.length === 0 ? <p className="mtc-muted">{L('No files.', 'مفيش ملفات.')}</p> : (
                    <ul className="mtc-list">{d.files.map((f) => (
                      <li key={f.id}><span><strong>{f.name}</strong><br /><small className="mtc-muted">{fmtBytes(f.size_bytes)} · {f.uploaded_by} · {fmtDate(f.created_at, ar)}</small></span>
                        <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" disabled={busy === `f${f.id}`} onClick={() => ask({ title: L('Delete this file?', 'حذف الملف؟'), message: f.name, label: L('Delete', 'حذف'), danger: true, run: () => act(`f${f.id}`, () => api.del(`${url}/files/${f.id}`), L('File deleted.', 'تم حذف الملف.')) })}><Icon name="trash" size={13} /> {L('Delete', 'حذف')}</button></li>
                    ))}</ul>
                  )}
                </section>
                <section className="mtc-block">
                  <h3 className="mtc-block__title"><Icon name="archive" size={15} /> {L(`Recordings (${d.recordings.length})`, `التسجيلات (${d.recordings.length})`)}</h3>
                  {d.recordings.length === 0 ? <p className="mtc-muted">{L('No recordings.', 'مفيش تسجيلات.')}</p> : (
                    <ul className="mtc-list">{d.recordings.map((r) => (
                      <li key={r.id}><span><strong>{r.name || `${r.kind} #${r.id}`}</strong> <span className="badge badge-neutral">{r.status}</span><br /><small className="mtc-muted">{r.kind} · {fmtBytes(r.size_bytes)}{r.duration_seconds ? ` · ${Math.round(r.duration_seconds / 60)} ${L('min', 'د')}` : ''} · {r.started_by} · {fmtDate(r.started_at, ar)}</small></span>
                        <button type="button" className="btn btn-outline btn-sm mtc-btn-danger-outline" disabled={busy === `r${r.id}`} onClick={() => ask({ title: L('Delete this recording?', 'حذف التسجيل؟'), message: L('The recording file is removed permanently.', 'ملف التسجيل هيتحذف نهائيًا.'), label: L('Delete', 'حذف'), danger: true, run: () => act(`r${r.id}`, () => api.del(`${url}/recordings/${r.id}`), L('Recording deleted.', 'تم حذف التسجيل.')) })}><Icon name="trash" size={13} /> {L('Delete', 'حذف')}</button></li>
                    ))}</ul>
                  )}
                </section>
                <section className="mtc-block">
                  <h3 className="mtc-block__title"><Icon name="bar-chart" size={15} /> {L(`Polls (${d.polls.length})`, `الاستطلاعات (${d.polls.length})`)}</h3>
                  {d.polls.length === 0 ? <p className="mtc-muted">{L('No polls.', 'مفيش استطلاعات.')}</p> : (
                    <ul className="mtc-list">{d.polls.map((p) => (
                      <li key={p.id}><span><strong>{p.question}</strong><br /><small className="mtc-muted">{p.status} · {p.options} {L('options', 'اختيارات')} · {p.votes} {L('votes', 'أصوات')}{p.is_anonymous ? ` · ${L('anonymous', 'مجهول')}` : ''}</small></span></li>
                    ))}</ul>
                  )}
                </section>
                <section className="mtc-block">
                  <h3 className="mtc-block__title"><Icon name="mail" size={15} /> {L('Invitations', 'الدعوات')}</h3>
                  {Object.keys(d.counts.invitations || {}).length === 0 ? <p className="mtc-muted">{L('No invitations.', 'مفيش دعوات.')}</p> : (
                    <div className="mtc-chips">{Object.entries(d.counts.invitations).map(([s, c]) => <span key={s} className="mtc-chip is-on">{s}: {c}</span>)}</div>
                  )}
                </section>
              </>
            )}

            {tab === 'log' && (
              <section className="mtc-block">
                <h3 className="mtc-block__title"><Icon name="clock" size={15} /> {L('Activity on this meeting', 'نشاط على الاجتماع ده')}</h3>
                {d.audit.length === 0 ? <p className="mtc-muted">{L('No recorded activity.', 'مفيش نشاط مسجّل.')}</p> : (
                  <ul className="mtc-list">{d.audit.map((a) => (
                    <li key={a.id}><span><span className={`badge ${a.action.startsWith('admin.') ? 'badge-primary' : 'badge-neutral'}`}>{a.action}</span><br /><small className="mtc-muted">{L('User', 'مستخدم')} {a.user_id ?? '—'} · {a.ip_address || ''}</small></span><small className="mtc-muted">{fmtDate(a.created_at, ar)}</small></li>
                  ))}</ul>
                )}
              </section>
            )}
          </div>
        )}

        {confirm && <ConfirmModal danger={confirm.danger} title={confirm.title} message={confirm.message} confirmLabel={confirm.label} onConfirm={runConfirmed} onClose={() => setConfirm(null)} />}
    </div>
  );
}
