import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal, Pager } from '../adminUi';
import { EmptyState, ErrorState, Skeleton } from '../AdminPage';
import { BASE, StatusPill, fmtDate, useL } from './shared';

const PER = 20;

const STATUS_FILTERS = [
  ['', 'All', 'الكل'],
  ['live', 'Live', 'جارٍ'],
  ['lobby', 'Lobby', 'في الانتظار'],
  ['scheduled', 'Scheduled', 'مجدول'],
  ['ended', 'Ended', 'انتهى'],
  ['cancelled', 'Cancelled', 'ملغي'],
  ['deleted', 'Deleted', 'محذوف'],
];

/**
 * Every meeting on the platform (all portals). Filters + paging here; clicking a row opens the
 * full control panel for that meeting (MeetingDetail).
 */
export default function MeetingsTab() {
  const navigate = useNavigate();
  const { ar, L } = useL();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);
  const [quick, setQuick] = useState(null); // { row, kind } confirm modal for the inline end button
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => { const h = setTimeout(() => { setQ(qLive.trim()); setPage(1); }, 350); return () => clearTimeout(h); }, [qLive]);

  const load = useCallback(() => {
    setErr(null);
    return api.get(`${BASE}/meetings`, {
      page, per_page: PER, status: status || undefined, type: type || undefined, q: q || undefined,
      from: from || undefined, to: to || undefined, sort, dir,
    }).then((j) => { setRows(j.data.items); setTotal(j.data.meta.total); })
      .catch((e) => setErr(errorMessage(e)));
  }, [page, status, type, q, from, to, sort, dir]);
  useEffect(() => { load(); }, [load]);

  // Live meetings change quickly — keep that view fresh.
  useEffect(() => {
    if (status !== 'live' && status !== 'lobby') return undefined;
    const h = setInterval(load, 15000);
    return () => clearInterval(h);
  }, [status, load]);

  const open = (uuid) => navigate(`/admin/meetings-control/${uuid}`); // each meeting has its own page

  async function quickEnd() {
    setBusy(true);
    try { await api.post(`${BASE}/meetings/${quick.row.uuid}/end`, {}); setFlash(L('Meeting ended.', 'تم إنهاء الاجتماع.')); setQuick(null); await load(); } catch (e) { setFlash(errorMessage(e)); setQuick(null); }
    setBusy(false);
  }

  const sortBy = (k) => { if (sort === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('desc'); } setPage(1); };
  const arrow = (k) => (sort === k ? (dir === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <div className="mtc-stack">
      {flash && <div className="st-alert mtc-banner" role="status"><Icon name="check-circle" size={16} /><span>{flash}</span><button type="button" className="mtc-link" onClick={() => setFlash(null)}>{L('Dismiss', 'إغلاق')}</button></div>}

      <div className="adm-filters mtc-filters">
        <div className="adm-filters__search">
          <input className="form-input" value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder={L('Search title, code, host name or email…', 'ابحث بالعنوان أو الكود أو اسم/إيميل الهوست…')} />
        </div>
        <select className="form-select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label={L('Type', 'النوع')}>
          <option value="">{L('All types', 'كل الأنواع')}</option>
          <option value="instant">{L('Instant', 'فوري')}</option>
          <option value="scheduled">{L('Scheduled', 'مجدول')}</option>
        </select>
        <input className="form-input mtc-date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label={L('Created from', 'أُنشئ من')} title={L('Created from', 'أُنشئ من')} />
        <input className="form-input mtc-date" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label={L('Created to', 'أُنشئ حتى')} title={L('Created to', 'أُنشئ حتى')} />
        <button type="button" className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> {L('Refresh', 'تحديث')}</button>
      </div>

      <div className="sa-chips" role="group">
        {STATUS_FILTERS.map(([v, en, arT]) => (
          <button key={v || 'all'} type="button" aria-pressed={status === v} className={`sa-chip${status === v ? ' is-active' : ''}`}
            onClick={() => { setStatus(v); setPage(1); }}>{ar ? arT : en}</button>
        ))}
      </div>

      {err ? <ErrorState error={err} onRetry={load} /> : !rows ? <Skeleton rows={8} cols={5} /> : rows.length === 0 ? (
        <section className="sa-card"><EmptyState icon="video" title={L('No meetings match', 'مفيش اجتماعات مطابقة')} hint={L('Try clearing the filters.', 'جرّب تمسح الفلاتر.')} /></section>
      ) : (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('title')}>{L('Meeting', 'الاجتماع')}{arrow('title')}</button></th>
            <th>{L('Host', 'الهوست')}</th>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('status')}>{L('Status', 'الحالة')}{arrow('status')}</button></th>
            <th><button type="button" className="mtc-th" onClick={() => sortBy('scheduled_start_at')}>{L('When', 'الموعد')}{arrow('scheduled_start_at')}</button></th>
            <th>{L('Online', 'متصلين')}</th>
            <th>{L('Flags', 'علامات')}</th>
            <th />
          </tr></thead>
          <tbody>{rows.map((m) => {
            const isLive = m.status === 'live' || m.status === 'lobby';
            return (
              <tr key={m.uuid} className={m.deleted_at ? 'mtc-row-deleted' : undefined}>
                <td data-label={L('Meeting', 'الاجتماع')}>
                  <button type="button" className="mtc-link mtc-title" onClick={() => open(m.uuid)}><strong>{m.title}</strong></button>
                  <br /><small className="mtc-muted" dir="ltr">{m.meeting_code} · {m.type === 'instant' ? L('Instant', 'فوري') : L('Scheduled', 'مجدول')}</small>
                </td>
                <td data-label={L('Host', 'الهوست')}>{m.host ? <>{m.host.name}<br /><small className="mtc-muted">{m.host.email}</small></> : '—'}</td>
                <td data-label={L('Status', 'الحالة')}><StatusPill status={m.status} deleted={!!m.deleted_at} /></td>
                <td data-label={L('When', 'الموعد')}>{fmtDate(m.scheduled_start_at || m.started_at || m.created_at, ar)}</td>
                <td data-label={L('Online', 'متصلين')}>{isLive ? <strong>{m.live_participants}</strong> : '—'}</td>
                <td data-label={L('Flags', 'علامات')}>
                  <span className="mtc-flags">
                    {m.locked && <span title={L('Locked', 'مقفول')}><Icon name="lock" size={14} /></span>}
                    {m.screen_sharing_locked && <span title={L('Screen sharing disabled', 'مشاركة الشاشة موقوفة')}><Icon name="screen-share" size={14} /></span>}
                    {m.has_password && <span title={L('Password', 'كلمة سر')}><Icon name="shield" size={14} /></span>}
                    {m.waiting_room_enabled && <span title={L('Waiting room', 'غرفة انتظار')}><Icon name="clock" size={14} /></span>}
                    {m.allow_guests && <span title={L('Guests allowed', 'الضيوف مسموحين')}><Icon name="users" size={14} /></span>}
                  </span>
                </td>
                <td className="mtc-row-actions">
                  {isLive && <button type="button" className="btn btn-outline btn-sm" onClick={() => setQuick({ row: m })}><Icon name="stop" size={13} /> {L('End', 'إنهاء')}</button>}
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => open(m.uuid)}>{L('Manage', 'تحكم')}</button>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <Pager page={page} setPage={setPage} total={total} perPage={PER} />

      {quick && <ConfirmModal danger busy={busy} title={L('End this meeting?', 'إنهاء الاجتماع؟')}
        message={L(`“${quick.row.title}” will be ended for everyone now.`, `اجتماع “${quick.row.title}” هيتنهي للجميع الآن.`)}
        confirmLabel={L('End meeting', 'إنهاء الاجتماع')} onConfirm={quickEnd} onClose={() => setQuick(null)} />}

    </div>
  );
}
