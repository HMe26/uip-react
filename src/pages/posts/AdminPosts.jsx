import { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { postsApi } from '../../api/postsApi';
import { errorMessage } from '../../api/client';
import { usePageMeta } from '../../context/PageMetaContext';
import { Alert, Empty, REPORT_REASONS, useTt } from '../../components/posts/shared';
import '../../styles/css/posts-engage.css';
import { useDialogs } from '../../components/posts/Dialogs';
import PostCard from '../../components/posts/PostCard';
import '../../styles/css/posts.css';

const GROUP = { system: ['System', 'النظام'], limits: ['Limits', 'الحدود'], moderation: ['Moderation', 'الإشراف'], ranking: ['Feed algorithm', 'خوارزمية الظهور'] };
const HELP = {
  w_recency: ['Newer posts first', 'الأحدث أولًا'], w_affinity: ['Authors you interact with', 'الكتّاب الذين تتفاعل معهم'], w_engagement: ['Reactions, comments, saves', 'التفاعل والتعليقات والحفظ'],
  w_interest: ['Matches your interests', 'توافق مع اهتماماتك'], w_network: ['Followed / same university', 'المتابَعون / نفس الجامعة'], w_media: ['Bonus for rich media', 'مكافأة للوسائط'],
  half_life_hours: ['Hours until recency halves', 'ساعات حتى يقل وزن الحداثة للنصف'], seen_penalty: ['Push down posts already seen', 'خفض ما شوهد'], diversity_penalty: ['Avoid many posts from one author', 'تنويع الكتّاب'],
  require_approval: ['Student posts wait for approval', 'منشورات الطلاب تنتظر الموافقة'], auto_remove_reports: ['Auto-remove after N reports (0 = off)', 'حذف تلقائي بعد N بلاغ (0 = معطل)'],
  convert_office_to_pdf: ['Needs LibreOffice on the server', 'يحتاج LibreOffice على السيرفر'],
};

function Settings({ tt }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  useEffect(() => { postsApi.admin.settings().then((d) => setData(d)).catch((e) => setErr(errorMessage(e))); }, []);
  if (!data) return err ? <Alert tt={tt}>{err}</Alert> : <div className="pp-skel" style={{ height: 200 }} />;
  const val = (k) => (k in draft ? draft[k] : data.settings[k].value);
  const save = async () => {
    setErr(''); setOk('');
    try { const r = await postsApi.admin.saveSettings(draft); setData((d) => ({ ...d, settings: r.settings })); setDraft({}); setOk(tt('Saved.', 'تم الحفظ.')); } catch (e) { setErr(errorMessage(e)); }
  };
  return (
    <div>
      {data.groups.map((g) => (
        <fieldset key={g} className="pp-card pp-set"><legend>{tt(...(GROUP[g] || [g, g]))}</legend>
          {Object.entries(data.settings).filter(([, s]) => s.group === g).map(([k, s]) => (
            <label key={k} className="pp-set__row">
              <span><strong dir="ltr">{k}</strong>{HELP[k] && <small>{tt(...HELP[k])}</small>}</span>
              {s.type === 'bool'
                ? <input type="checkbox" checked={!!val(k)} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.checked }))} />
                : <input className="pp-input pp-input--sm" type="number" step={s.type === 'float' ? '0.05' : '1'} min={s.min ?? undefined} max={s.max ?? undefined} value={val(k)} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />}
              {k in draft && <button type="button" className="pp-link" onClick={() => setDraft(({ [k]: _, ...r }) => r)}>{tt('Reset', 'تراجع')}</button>}
            </label>))}
        </fieldset>))}
      {err && <Alert tt={tt}>{err}</Alert>}{ok && <p className="pp-ok">{ok}</p>}
      <div className="pp-row"><button type="button" className="pp-btn is-primary" disabled={!Object.keys(draft).length} onClick={save}>{tt('Save settings', 'حفظ الإعدادات')}</button></div>
    </div>
  );
}

function Reports({ tt }) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => postsApi.admin.reports(status).then((r) => { setItems(r.items); setErr(''); }).catch((e) => setErr(errorMessage(e))), [status]);
  useEffect(() => { setItems(null); load(); }, [load]);
  const act = async (r, action) => { try { await postsApi.admin.resolve(r.id, action); setItems((p) => p.filter((x) => x.id !== r.id)); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <div>
      <div className="pp-seg">{['pending', 'resolved', 'dismissed', 'all'].map((s) => <button key={s} type="button" className={status === s ? 'is-on' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div>
      {err && <Alert tt={tt} onRetry={load}>{err}</Alert>}
      {items === null ? <div className="pp-skel" style={{ height: 120 }} /> : items.length === 0 ? <Empty icon="check-circle" title={tt('No reports', 'لا توجد بلاغات')} /> : (
        <ul className="pp-stack">{items.map((r) => (
          <li key={r.id} className="pp-card">
            <div className="pp-row"><span className="pp-chip is-warn">{tt(...(REPORT_REASONS[r.reason] || [r.reason, r.reason]))}</span>
              {r.pending_for_post > 1 && <span className="pp-chip">{r.pending_for_post} {tt('reports on this post', 'بلاغات على المنشور')}</span>}
              <small className="pp-muted">{tt('by', 'من')} {r.reporter_name} · {r.created_at}</small></div>
            <p><strong>{r.author_name}</strong>{r.post_title ? ` — ${r.post_title}` : ''}</p>
            <p className="pp-muted">{r.comment_snippet || r.post_snippet}</p>
            {r.details && <p className="pp-muted">“{r.details}”</p>}
            {r.status === 'pending' ? (
              <div className="pp-row">
                <button type="button" className="pp-btn" onClick={() => act(r, 'dismiss')}>{tt('Dismiss', 'تجاهل')}</button>
                <button type="button" className="pp-btn is-danger" onClick={() => act(r, r.comment_id ? 'remove_comment' : 'remove_post')}>{r.comment_id ? tt('Remove comment', 'حذف التعليق') : tt('Remove post', 'حذف المنشور')}</button>
              </div>) : <small className="pp-muted">{r.resolution}</small>}
          </li>))}</ul>)}
    </div>
  );
}

function Pending({ tt }) {
  const dialogs = useDialogs();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { postsApi.admin.pending().then((r) => setItems(r.items)).catch((e) => setErr(errorMessage(e))); }, []);
  const act = async (p, ok) => {
    try {
      if (ok) await postsApi.admin.approve(p.id); else { const reason = await dialogs.ask({ title: tt('Reject post', 'رفض المنشور'), label: tt('Reason (optional)', 'السبب (اختياري)'), allowEmpty: true, maxLength: 300, confirmLabel: tt('Reject', 'رفض'), icon: 'x' }); if (reason === null) return; await postsApi.admin.reject(p.id, reason || undefined); }
      setItems((l) => l.filter((x) => x.id !== p.id));
    } catch (e) { setErr(errorMessage(e)); }
  };
  if (err) return <Alert tt={tt}>{err}</Alert>;
  if (!items) return <div className="pp-skel" style={{ height: 120 }} />;
  if (!items.length) return <Empty icon="check-circle" title={tt('Nothing waiting for approval', 'لا شيء بانتظار الموافقة')} />;
  return (
    <>
    <ul className="pp-stack">{items.map((p) => (
      <li key={p.id}><PostCard post={p} compactView />
        <div className="pp-row pp-pad"><button type="button" className="pp-btn is-primary" onClick={() => act(p, true)}>{tt('Approve', 'موافقة')}</button><button type="button" className="pp-btn is-danger" onClick={() => act(p, false)}>{tt('Reject', 'رفض')}</button></div></li>))}</ul>
    {dialogs.dialogs}
    </>
  );
}

export default function AdminPosts() {
  const { tt } = useTt();
  usePageMeta(tt('Posts Control', 'التحكم في المنشورات'));
  const [tab, setTab] = useState('settings');
  const [stats, setStats] = useState(null);
  useEffect(() => { postsApi.admin.stats().then(setStats).catch(() => {}); }, [tab]);
  const S = stats && [
    [tt('Published (7d)', 'منشور (٧ أيام)'), stats.posts_last_7_days], [tt('Comments (7d)', 'تعليقات (٧ أيام)'), stats.comments_last_7d],
    [tt('Active authors', 'كتّاب نشطون'), stats.active_authors_7d], [tt('Pending reports', 'بلاغات معلّقة'), stats.pending_reports], [tt('Awaiting approval', 'بانتظار الموافقة'), stats.pending_posts],
  ];
  return (
    <div className="pp-page pp-admin">
      {S && <div className="pp-kpis">{S.map(([l, v]) => <div key={l} className="pp-card"><strong>{v}</strong><span>{l}</span></div>)}</div>}
      <div className="pp-tabs">{[['settings', 'Settings & algorithm', 'الإعدادات والخوارزمية', 'settings'], ['reports', 'Reports', 'البلاغات', 'flag'], ['pending', 'Approval queue', 'قائمة الموافقة', 'clock']]
        .map(([k, en, ar, ic]) => <button key={k} type="button" className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={14} /> {tt(en, ar)}</button>)}</div>
      {tab === 'settings' && <Settings tt={tt} />}{tab === 'reports' && <Reports tt={tt} />}{tab === 'pending' && <Pending tt={tt} />}
    </div>
  );
}
