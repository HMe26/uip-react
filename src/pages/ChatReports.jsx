import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { REPORT_REASONS, REPORT_STATUSES, reasonLabel, statusMeta } from '../components/messaging/safety';

/**
 * Chat reports follow-up queue — one page for three portals:
 *   /admin/chat-reports       → every report on the platform
 *   /university/chat-reports  → reports about people of this university
 *   /faculty/chat-reports     → reports about people of this faculty
 * Data: GET /api/v1/chat-reports, POST /api/v1/chat-reports/{id}/status
 * (the backend scopes the list by role, so the page never filters by itself).
 */

const ROLE_LABELS = {
  student: ['Student', 'طالب'], university: ['University', 'جامعة'], faculty: ['Faculty', 'كلية'], supervisor: ['Supervisor', 'مشرف'],
  academic_staff: ['Academic staff', 'عضو هيئة تدريس'], admin: ['Admin', 'مدير'], security_admin: ['Security', 'أمان'],
  security_officer: ['Security', 'أمان'], data_analyst: ['Data analyst', 'محلل بيانات'],
};

export default function ChatReports() {
  const { locale } = useLanguage();
  const { user } = useAuth();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState({ items: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [deleteMsg, setDeleteMsg] = useState({});
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(h);
  }, [q]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = {};
    if (status) params.status = status;
    if (reason) params.reason = reason;
    if (debouncedQ) params.q = debouncedQ;
    api.get('/api/v1/chat-reports', params)
      .then((json) => setData(json.data || { items: [], counts: {} }))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [status, reason, debouncedQ]);

  useEffect(() => { load(); }, [load]);

  async function update(r, nextStatus) {
    const wantsDelete = isAdmin && !!deleteMsg[r.id] && !!r.message_id;
    if (wantsDelete && !window.confirm(t('Delete the reported message for everyone?', 'حذف الرسالة المبلَّغ عنها للجميع؟'))) return;
    setBusyId(r.id);
    setActionError(null);
    try {
      await api.post(`/api/v1/chat-reports/${r.id}/status`, {
        status: nextStatus,
        notes: notes[r.id] || '',
        ...(wantsDelete ? { action: 'delete_message' } : {}),
      });
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const counts = data.counts || {};
  const total = useMemo(() => REPORT_STATUSES.reduce((n, s) => n + (counts[s.key] || 0), 0), [counts]);
  const roleName = (slug) => { const r = ROLE_LABELS[slug]; return r ? (ar ? r[1] : r[0]) : (slug || ''); };
  const fmtDate = (v) => (v || '').slice(0, 16).replace('T', ' ');

  const scopeNote = isAdmin
    ? t('All chat reports across the platform.', 'كل بلاغات الشات على مستوى المنصة.')
    : user?.role === 'faculty'
      ? t('Chat reports about people of your faculty.', 'بلاغات الشات الخاصة بأفراد كليتك.')
      : t('Chat reports about people of your university.', 'بلاغات الشات الخاصة بأفراد جامعتك.');

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Chat Reports', 'بلاغات الشات')}</h1>
          <p className="text-small">{scopeNote}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <button type="button" className="card glass-panel" style={{ textAlign: 'start', cursor: 'pointer', outline: status === '' ? '2px solid var(--color-primary, #6c5ce7)' : 'none' }} onClick={() => setStatus('')}>
          <div className="text-caption">{t('All', 'الكل')}</div>
          <div className="text-h2">{total}</div>
        </button>
        {REPORT_STATUSES.map((s) => (
          <button key={s.key} type="button" className="card glass-panel" style={{ textAlign: 'start', cursor: 'pointer', outline: status === s.key ? '2px solid var(--color-primary, #6c5ce7)' : 'none' }} onClick={() => setStatus(status === s.key ? '' : s.key)}>
            <div className="text-caption">{ar ? s.ar : s.en}</div>
            <div className="text-h2">{counts[s.key] || 0}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <input className="form-input" style={{ flex: '1 1 220px' }} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search names, emails, message text…', 'ابحث بالاسم أو الإيميل أو نص الرسالة…')} />
        <select className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('Reason', 'السبب')}>
          <option value="">{t('All reasons', 'كل الأسباب')}</option>
          {REPORT_REASONS.map((r) => <option key={r.key} value={r.key}>{ar ? r.ar : r.en}</option>)}
        </select>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }} role="alert">{actionError}</p>}
      {loading && <p className="text-small">{t('Loading…', 'جارٍ التحميل…')}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }} role="alert">{error}</p>}

      {!loading && !error && data.items.length === 0 && (
        <div className="glass-panel" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <p className="text-small">{t('No reports.', 'لا توجد بلاغات.')}</p>
        </div>
      )}

      {!error && data.items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {data.items.map((r) => {
            const busy = busyId === r.id;
            const st = statusMeta(r.status);
            const open = r.status === 'pending' || r.status === 'reviewing';
            return (
              <div key={r.id} className="card glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span className={`badge ${st.badge}`}>{ar ? st.ar : st.en}</span>
                      <span className="badge badge-neutral">{reasonLabel(r.reason, locale)}</span>
                      {r.message_id ? <span className="badge badge-neutral">{t('Message', 'رسالة')}</span> : <span className="badge badge-neutral">{t('User', 'مستخدم')}</span>}
                      {r.reported_total_reports > 1 && (
                        <span className="badge badge-warning">{t(`${r.reported_total_reports} reports on this person`, `${r.reported_total_reports} بلاغات على هذا الشخص`)}</span>
                      )}
                    </div>

                    <p className="text-small" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
                      <strong>{r.reported_name}</strong>
                      <span className="text-muted"> ({roleName(r.reported_role)}) </span>
                      <span dir="ltr" className="text-caption">{r.reported_email}</span>
                    </p>
                    <p className="text-caption" style={{ marginTop: 4 }}>
                      {t('Reported by', 'المُبلِّغ')} {r.reporter_name} ({roleName(r.reporter_role)}) · {fmtDate(r.created_at)}
                    </p>

                    {r.message_snapshot && (
                      <blockquote className="text-small" style={{ margin: 'var(--space-2) 0 0', padding: '8px 12px', borderInlineStart: '3px solid var(--color-danger, #e5484d)', background: 'rgba(127,127,127,.08)', borderRadius: 6, whiteSpace: 'pre-wrap', maxWidth: 640 }}>
                        {r.message_snapshot}
                      </blockquote>
                    )}
                    {r.details && (
                      <p className="text-small" style={{ marginTop: 'var(--space-2)', maxWidth: 640, whiteSpace: 'pre-wrap' }}>
                        <span className="text-muted">{t('Reporter says:', 'قال المُبلِّغ:')} </span>{r.details}
                      </p>
                    )}
                    {r.reviewed_at && (
                      <p className="text-caption" style={{ marginTop: 'var(--space-2)' }}>
                        {t('Last update by', 'آخر تحديث بواسطة')} {r.reviewer_name || '—'} · {fmtDate(r.reviewed_at)}
                        {r.resolution_notes ? ` — ${r.resolution_notes}` : ''}
                      </p>
                    )}
                    {isAdmin && r.conversation_id && (
                      <p style={{ marginTop: 'var(--space-2)' }}>
                        <Link className="text-small" to={`/admin/messaging/oversight/${r.conversation_id}`}>{t('Open the conversation', 'فتح المحادثة')}</Link>
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 230 }}>
                    <input
                      className="form-input"
                      type="text"
                      maxLength={1000}
                      placeholder={t('Notes (shown to the reporter)', 'ملاحظات (تظهر للمُبلِّغ)')}
                      value={notes[r.id] ?? ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    {r.can_delete_message && open && (
                      <label className="text-small" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!deleteMsg[r.id]} onChange={(e) => setDeleteMsg((p) => ({ ...p, [r.id]: e.target.checked }))} />
                        {t('Also delete the message', 'احذف الرسالة أيضًا')}
                      </label>
                    )}
                    {r.status === 'pending' && (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => update(r, 'reviewing')}>{t('Start review', 'بدء المراجعة')}</button>
                    )}
                    {open && (
                      <>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => update(r, 'resolved')}>{t('Resolve', 'تمت المعالجة')}</button>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => update(r, 'dismissed')}>{t('Dismiss', 'رفض البلاغ')}</button>
                      </>
                    )}
                    {!open && (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => update(r, 'reviewing')}>{t('Reopen', 'إعادة فتح')}</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
