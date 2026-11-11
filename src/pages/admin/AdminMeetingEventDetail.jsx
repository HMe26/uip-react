import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';
import { BASE, ROLE_LABELS, StatusPill, actionLabel, fmtDate, useL } from '../../components/admin/meetingsControl/shared';
import { observeTables } from '../../lib/labelTables';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Admin → Meetings Control → one audit event, on its own page (/admin/meetings-control/events/:id).
 * Opened from the Activity log tab and from "Recent security events" in Meetings Monitoring.
 * Data: GET /api/v1/admin/meetings/control/audit/{id} → { event, user, meeting, related }.
 */
export default function AdminMeetingEventDetail() {
  const { id } = useParams();
  const { ar, L } = useL();
  const navigate = useNavigate();
  const { key } = useLocation();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const ref = useRef(null);
  useEffect(() => (ref.current ? observeTables(ref.current) : undefined), [d]);

  const load = useCallback(() => {
    setErr(null); setD(null);
    return api.get(`${BASE}/audit/${id}`).then((j) => setD(j.data)).catch((e) => setErr(errorMessage(e)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const back = () => (key !== 'default' ? navigate(-1) : navigate('/admin/meetings-control?tab=audit', { replace: true }));
  const e = d?.event;
  const before = isObj(e?.old_values) ? e.old_values : null;
  const after = isObj(e?.new_values) ? e.new_values : null;
  const fields = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const rawOnly = e && !before && !after && (e.old_values != null || e.new_values != null);
  const roleLabel = d?.user?.role ? (ROLE_LABELS[d.user.role]?.[ar ? 1 : 0] || d.user.role) : null;

  return (
    <div className="sa-page ap-page" ref={ref}>
      <div className="mtc-page">
        <button type="button" className="btn btn-outline btn-sm mtc-back" onClick={back}><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {L('Back', 'رجوع')}</button>
        {err ? <ErrorState error={err} onRetry={load} /> : !d ? <Skeleton rows={6} cols={3} /> : (
          <>
            <header className="mtc-drawer__head">
              <div>
                <h2 className="mtc-drawer__title">{actionLabel(e.action, ar)}</h2>
                <div className="mtc-drawer__sub"><span className={`badge ${e.action.startsWith('admin.') ? 'badge-primary' : 'badge-neutral'}`}>{e.action}</span> <small className="mtc-muted" dir="ltr">{L('Event', 'حدث')} #{e.id}</small></div>
              </div>
            </header>

            <section className="mtc-block">
              <div className="mtc-facts">
                <div><span className="mtc-muted">{L('When', 'الوقت')}</span><strong>{fmtDate(e.created_at, ar)}</strong><small className="mtc-muted" dir="ltr">{String(e.created_at || '')}</small></div>
                <div><span className="mtc-muted">{L('Who', 'مين')}</span><strong>{d.user ? d.user.name : (e.user_id ? `#${e.user_id}` : L('Guest / system', 'ضيف / النظام'))}</strong>{d.user && <small className="mtc-muted">{d.user.email}</small>}</div>
                {roleLabel && <div><span className="mtc-muted">{L('Role', 'الدور')}</span><strong>{roleLabel}</strong></div>}
                <div><span className="mtc-muted">{L('IP address', 'عنوان IP')}</span><strong dir="ltr">{e.ip_address || '—'}</strong></div>
                <div><span className="mtc-muted">{L('Target', 'الهدف')}</span><strong>{e.subject_type ? `${e.subject_type} #${e.subject_id ?? ''}` : '—'}</strong></div>
              </div>
            </section>

            {d.meeting && (
              <section className="mtc-block">
                <h3 className="mtc-block__title"><Icon name="video" size={15} /> {L('Meeting', 'الاجتماع')}</h3>
                <div className="mtc-facts">
                  <div><span className="mtc-muted">{L('Title', 'العنوان')}</span><strong>{d.meeting.title}</strong></div>
                  <div><span className="mtc-muted">{L('Status', 'الحالة')}</span><StatusPill status={d.meeting.status} deleted={!!d.meeting.deleted_at} /></div>
                  <div><span className="mtc-muted">{L('Host', 'الهوست')}</span><strong>{d.meeting.host?.name || '—'}</strong><small className="mtc-muted">{d.meeting.host?.email}</small></div>
                  <div><span className="mtc-muted">{L('Code', 'الكود')}</span><strong dir="ltr">{d.meeting.meeting_code}</strong></div>
                  <div><span className="mtc-muted">{L('Started', 'بدأ')}</span><strong>{fmtDate(d.meeting.started_at, ar)}</strong></div>
                  <div><span className="mtc-muted">{L('Ended', 'انتهى')}</span><strong>{fmtDate(d.meeting.ended_at, ar)}</strong></div>
                </div>
                <div style={{ marginTop: 12 }}><Link className="btn btn-primary btn-sm" to={`/admin/meetings-control/${d.meeting.uuid}`}>{L('Open meeting control', 'فتح صفحة التحكم في الاجتماع')}</Link></div>
              </section>
            )}
            {!d.meeting && e.subject_type === 'Meeting' && <div className="st-alert mtc-banner"><Icon name="info" size={16} /><span>{L('This meeting no longer exists.', 'الاجتماع ده مش موجود.')}</span></div>}

            <section className="mtc-block">
              <h3 className="mtc-block__title"><Icon name="note" size={15} /> {L('Event data', 'بيانات الحدث')}</h3>
              {fields.length > 0 ? (
                <div className="adm-table-wrap"><table className="adm-table">
                  <thead><tr><th>{L('Field', 'الحقل')}</th><th>{L('Before', 'قبل')}</th><th>{L('After', 'بعد')}</th></tr></thead>
                  <tbody>{fields.map((f) => <tr key={f}><td><code>{f}</code></td><td dir="auto">{show(before?.[f])}</td><td dir="auto">{show(after?.[f])}</td></tr>)}</tbody>
                </table></div>
              ) : rawOnly ? <pre className="mtc-json" dir="ltr">{JSON.stringify({ before: e.old_values, after: e.new_values }, null, 2)}</pre>
                : <p className="mtc-muted">{L('This event carries no extra data — the action, time, user, IP and target above are everything that was recorded.', 'الحدث ده ما فيهوش بيانات إضافية — الإجراء والوقت والمستخدم والـ IP والهدف فوق هما كل اللي اتسجّل.')}</p>}
            </section>

            {d.related.length > 0 && (
              <section className="mtc-block">
                <h3 className="mtc-block__title"><Icon name="history" size={15} /> {L('Other activity on this meeting', 'نشاط تاني على نفس الاجتماع')}</h3>
                <div className="adm-table-wrap"><table className="adm-table">
                  <thead><tr><th>{L('When', 'الوقت')}</th><th>{L('Who', 'مين')}</th><th>{L('Action', 'الإجراء')}</th><th /></tr></thead>
                  <tbody>{d.related.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.created_at, ar)}</td><td>{r.user_name || '—'}</td><td>{actionLabel(r.action, ar)}</td>
                      <td><Link className="mtc-link" to={`/admin/meetings-control/events/${r.id}`}>{L('Details', 'تفاصيل')}</Link></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
