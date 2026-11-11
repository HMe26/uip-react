import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Alert, Empty, Mono, Pill, SearchField, Skeletons, Stat, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/join-requests';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/join-requests.php. Data comes from
 * GET /api/v1/university/join-requests (App\Controllers\Api\
 * UniversityJoinRequestsApiController::index() -> StudentJoinRequestService
 * ::pendingQueue()/fullQueue(), the only place that ever writes
 * students.university_id). Approve/reject post to .../approve|reject.
 *
 * Design: um- system (styles/css/university-manage.css) — same family as
 * /university/approvals: stat tiles that double as filters, search, review rows.
 */

const STATUS_META = {
  pending: { tone: 'warning', en: 'Pending', ar: 'قيد الانتظار' },
  approved: { tone: 'success', en: 'Approved', ar: 'مقبول' },
  rejected: { tone: 'danger', en: 'Rejected', ar: 'مرفوض' },
};

const TABS = [
  { key: 'pending', icon: 'clock', tone: 'warning', en: 'Pending', ar: 'قيد الانتظار' },
  { key: 'approved', icon: 'check-circle', tone: 'success', en: 'Approved', ar: 'مقبول' },
  { key: 'rejected', icon: 'x-circle', tone: 'danger', en: 'Rejected', ar: 'مرفوض' },
  { key: 'all', icon: 'users', tone: 'primary', en: 'All requests', ar: 'كل الطلبات' },
];

function ProfileModal({ requestId, ar, locale, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/api/v1/university/join-requests/${requestId}`, { locale })
      .then((json) => { if (alive) setData(json.data); })
      .catch((e) => { if (alive) setErr(errorMessage(e)); });
    return () => { alive = false; };
  }, [requestId, locale]);

  const rows = data ? [
    ['mail', ar ? 'الإيميل' : 'Email', data.email],
    ['smartphone', ar ? 'التليفون' : 'Phone', data.phone],
    ['user', ar ? 'الرقم الجامعي' : 'Student number', data.student_number],
    ['building', ar ? 'الكلية' : 'Faculty', data.faculty],
    ['building', ar ? 'القسم' : 'Department', data.department],
    ['layers', ar ? 'السنة الدراسية' : 'Academic year', data.academic_year],
    ['calendar', ar ? 'تاريخ الطلب' : 'Requested on', data.requested_at],
  ].filter(([, , v]) => v && v !== '—') : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {err ? <Alert>{err}</Alert> : !data ? <Skeletons n={3} h={32} /> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Mono name={data.student_name} hue={hueOf(data.student_id)} />
              <div style={{ minWidth: 0 }}>
                <h2 className="modal-box__title text-h3" style={{ margin: 0 }}>{data.student_name}</h2>
                <Pill tone={(STATUS_META[data.status] || STATUS_META.pending).tone}>{(STATUS_META[data.status] || STATUS_META.pending)[ar ? 'ar' : 'en']}</Pill>
              </div>
            </div>
            <div className="um-rows" style={{ display: 'grid', gap: 8 }}>
              {rows.map(([ico, label, val]) => (
                <p key={label} className="um-fact" style={{ margin: 0, justifyContent: 'space-between', gap: 12 }}>
                  <span><Icon name={ico} size={13} /> {label}</span>
                  <b style={{ overflowWrap: 'anywhere' }}>{val}</b>
                </p>
              ))}
              {data.bio && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{data.bio}</p>}
            </div>
          </>
        )}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</button>
        </div>
      </div>
    </div>
  );
}

function RequestRow({ r, ar, showActions, busy, onDecide, onOpen }) {
  const meta = STATUS_META[r.status] || STATUS_META.pending;
  return (
    <div className="um-row">
      <Mono name={r.student_name} hue={hueOf(r.student_id)} size="sm" />
      <div className="um-row__main">
        <p className="um-row__name"><button type="button" className="btn-link" style={{ all: 'unset', cursor: 'pointer' }} onClick={() => onOpen(r)}>{r.student_name}</button></p>
        <p className="um-row__sub">
          {r.email && <span className="um-fact"><Icon name="mail" size={13} /> {r.email}</span>}
          {r.student_number && <span className="um-fact um-fact--mono"><Icon name="user" size={13} /> {r.student_number}</span>}
        </p>
        <p className="um-row__sub">
          {(r.faculty || r.department) && (
            <span className="um-fact"><Icon name="building" size={13} /> {[r.faculty, r.department].filter(Boolean).join(' · ')}</span>
          )}
          {r.academic_year && <span className="um-fact"><Icon name="layers" size={13} /> {ar ? `السنة ${r.academic_year}` : `Year ${r.academic_year}`}</span>}
          {r.requested_at && <span className="um-fact"><Icon name="calendar" size={13} /> {r.requested_at}</span>}
        </p>
      </div>
      <div className="um-row__end">
        {showActions ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => onOpen(r)}><Icon name="eye" size={15} /> {ar ? 'الملف' : 'Profile'}</button>
            <button type="button" className="btn btn-outline um-btn-danger" disabled={busy} onClick={() => onDecide(r, 'reject')}>
              <Icon name="x" size={15} /> {ar ? 'رفض' : 'Reject'}
            </button>
            <button type="button" className="btn um-btn-ok" disabled={busy} onClick={() => onDecide(r, 'approve')}>
              <Icon name="check" size={15} /> {ar ? 'قبول' : 'Approve'}
            </button>
          </>
        ) : (
          <Pill tone={meta.tone}>{meta[ar ? 'ar' : 'en']}</Pill>
        )}
      </div>
    </div>
  );
}

export default function UniversityJoinRequests() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';

  const [pending, setPending] = useState([]);
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    setError(null);
    api.get('/api/v1/university/join-requests', { locale })
      .then((json) => {
        setPending(json.data?.pending || []);
        setAll(json.data?.all || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [locale]);

  useEffect(() => { load(); }, [load]);

  async function decide(r, action) {
    if (action === 'reject' && !window.confirm(ar ? `رفض طلب انضمام ${r.student_name}؟` : `Reject ${r.student_name}'s join request?`)) return;
    setBusyId(r.id);
    setActionError(null);
    try {
      await api.post(`/api/v1/university/join-requests/${r.id}/${action}`, {});
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => ({
    pending: pending.length,
    approved: all.filter((r) => r.status === 'approved').length,
    rejected: all.filter((r) => r.status === 'rejected').length,
    all: all.length,
  }), [pending, all]);

  const rows = useMemo(() => {
    const base = tab === 'pending' ? pending : tab === 'all' ? all : all.filter((r) => r.status === tab);
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((r) => [r.student_name, r.email, r.student_number, r.faculty, r.department]
      .some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [pending, all, tab, q]);

  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <h1>{t('Join Requests')}</h1>
          <p>{t('Students who asked to join your university on the platform — approving links their account to you automatically.')}</p>
        </div>
      </header>

      {actionError && <Alert>{actionError}</Alert>}

      <div className="um-stats" style={{ '--n': TABS.length }} data-scroll="">
        {TABS.map((tb) => (
          <Stat key={tb.key} icon={tb.icon} tone={tb.tone} value={counts[tb.key]} label={tb[locale]} active={tab === tb.key} onClick={() => setTab(tb.key)} />
        ))}
      </div>

      <div className="um-bar">
        <SearchField value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو الإيميل أو الرقم الجامعي…' : 'Search by name, email or student number…'} />
        <span className="um-count">{ar ? `${rows.length} طلب` : `${rows.length} ${rows.length === 1 ? 'request' : 'requests'}`}</span>
      </div>

      {loading ? <Skeletons n={4} h={84} /> : error ? <Alert>{error}</Alert> : rows.length === 0 ? (
        <Empty
          icon={tab === 'pending' ? 'check-circle' : 'inbox'}
          title={q ? (ar ? 'لا توجد نتائج مطابقة.' : 'No matching requests.') : tab === 'pending' ? t('No join requests waiting for review.') : t('No requests yet.')}
          text={q ? (ar ? 'جرّب كلمات بحث مختلفة.' : 'Try a different search.') : undefined}
        />
      ) : (
        <section className="um-panel um-panel--flush">
          <div className="um-rows">
            {rows.map((r) => (
              <RequestRow key={r.id} r={r} ar={ar} showActions={r.status === 'pending'}
                busy={busyId === r.id} onDecide={decide} onOpen={(x) => setOpenId(x.id)} />
            ))}
          </div>
        </section>
      )}

      {openId && <ProfileModal requestId={openId} ar={ar} locale={locale} onClose={() => setOpenId(null)} />}
    </div>
  );
}
