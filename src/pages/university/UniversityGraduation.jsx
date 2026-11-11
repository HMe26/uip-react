import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Alert, Empty, Mono, SearchField, Skeletons, Stat, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/graduation';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/graduation.php, talking to the real JSON
 * API (GET /api/v1/graduation — App\Controllers\Api\GraduationApiController
 * ::index(), the same GraduationService::listForUniversity() buckets the
 * Blade tabs consume: eligible / graduated / revoked). Revoke happens inline
 * here (POST .../revoke with a reason), same as the legacy per-row form;
 * review/approve and certificate-edit live on their own routed pages
 * (UniversityGraduationReview.jsx / UniversityGraduationEdit.jsx).
 *
 * Styled with the shared university management kit (um- / gr- classes in
 * styles/css/university-manage.css) so it matches Approvals / Faculties.
 */

const TABS = [
  { key: 'eligible', icon: 'clock', tone: 'warning', en: 'Eligible to Graduate', ar: 'مؤهلون للتخرج' },
  { key: 'graduated', icon: 'award', tone: 'success', en: 'Graduated', ar: 'خريجون' },
  { key: 'revoked', icon: 'x-circle', tone: 'danger', en: 'Revoked', ar: 'ملغى' },
];

const nameOf = (o, locale, ar, en, fallback) => (locale === 'ar' ? o?.[ar] : o?.[en]) || o?.[fallback] || '—';

function Fact({ icon, label, value, mono }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <span className="gr-fact">
      <Icon name={icon} size={14} />
      <small>{label}</small>
      <b className={mono ? 'um-mono-text' : ''}>{value}</b>
    </span>
  );
}

function RevokeDialog({ ar, name, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <div className="gr-modal" role="dialog" aria-modal="true" onClick={onCancel}>
      <form
        className="gr-modal__box"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onConfirm(reason.trim()); }}
      >
        <span className="gr-modal__ico"><Icon name="alert-triangle" size={22} /></span>
        <h2>{ar ? 'إلغاء التخرج' : 'Revoke graduation'}</h2>
        <p>
          {ar
            ? <>سيتم إلغاء تخرج <strong>{name}</strong> وتعطيل شهادته. يمكنك التراجع لاحقًا من تبويب «ملغى».</>
            : <>This will revoke <strong>{name}</strong>&apos;s graduation and invalidate the certificate. You can undo it later from the Revoked tab.</>}
        </p>
        <label htmlFor="gr-reason">{ar ? 'سبب الإلغاء' : 'Reason for revoking'}</label>
        <textarea
          id="gr-reason"
          className="form-input"
          rows={3}
          autoFocus
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={ar ? 'اكتب السبب الذي سيُسجَّل في سجل التدقيق…' : 'Written to the audit trail…'}
        />
        <div className="gr-modal__acts">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{ar ? 'إلغاء الأمر' : 'Cancel'}</button>
          <button type="submit" className="btn um-btn-danger-solid" disabled={busy || !reason.trim()}>
            <Icon name="x-circle" size={16} /> {ar ? 'تأكيد الإلغاء' : 'Confirm revoke'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function UniversityGraduation() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [lists, setLists] = useState({ eligible: [], graduated: [], revoked: [] });
  const [searchParams] = useSearchParams();
  const initialTab = TABS.some((x) => x.key === searchParams.get('tab')) ? searchParams.get('tab') : 'eligible';
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [revoking, setRevoking] = useState(null);

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    setError(null);
    api.get('/api/v1/graduation')
      .then((json) => setLists({
        eligible: json.data?.eligible || [],
        graduated: json.data?.graduated || [],
        revoked: json.data?.revoked || [],
      }))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(studentId, reason) {
    setBusyId(studentId);
    setActionError(null);
    try {
      await api.post(`/api/v1/graduation/${studentId}/revoke`, { reason });
      setRevoking(null);
      load(true);
    } catch (err) {
      setRevoking(null);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(studentId) {
    if (!window.confirm(ar
      ? 'سحب الإلغاء وإرجاع الطالب متخرجًا بنفس الشهادة؟'
      : 'Withdraw the revocation and set this student back to graduated with the same certificate?')) return;

    setBusyId(studentId);
    setActionError(null);
    try {
      await api.post(`/api/v1/graduation/${studentId}/restore`, {});
      setTab('graduated');
      load(true);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  // Normalise the three buckets to one card shape.
  const cards = useMemo(() => {
    const eligible = lists.eligible.map((entry) => {
      const s = entry.student || {};
      return { id: s.id, kind: 'eligible', name: nameOf(s, locale, 'name_ar', 'name_en', 'full_name'), number: s.student_number, grade: entry.finalized_grade };
    });
    const mapG = (kind) => (g) => ({
      id: g.student_id, kind, name: nameOf(g, locale, 'student_name_ar', 'student_name_en', 'student_name'),
      cert: g.certificate_number, date: g.graduation_date, gpa: g.final_gpa, revokedAt: g.revoked_at, reason: g.revoke_reason,
    });
    return { eligible, graduated: lists.graduated.map(mapG('graduated')), revoked: lists.revoked.map(mapG('revoked')) };
  }, [lists, locale]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cards[tab] || []).filter((c) => !needle
      || [c.name, c.number, c.cert, c.id].some((v) => String(v ?? '').toLowerCase().includes(needle)));
  }, [cards, tab, q]);

  const emptyText = {
    eligible: t('No students currently eligible to graduate.'),
    graduated: t('No graduates yet.'),
    revoked: t('No revoked records.'),
  };

  return (
    <div className="um-page animate-rise-in">
      <header className="um-head">
        <div className="um-head__text">
          <h1>{t('Graduation Records')}</h1>
          <p>{ar ? 'مراجعة أهلية الطلاب واعتماد أو إلغاء تخرجهم.' : 'Review student eligibility and approve or revoke graduation.'}</p>
        </div>
      </header>

      {actionError && <Alert>{actionError}</Alert>}

      <div className="um-stats" style={{ '--n': TABS.length }} data-scroll="">
        {TABS.map((tb) => (
          <Stat key={tb.key} icon={tb.icon} tone={tb.tone} value={cards[tb.key].length} label={tb[locale]} active={tab === tb.key} onClick={() => setTab(tb.key)} />
        ))}
      </div>

      <div className="um-bar">
        <SearchField value={q} onChange={setQ} placeholder={ar ? 'ابحث بالاسم أو الرقم الجامعي أو رقم الشهادة…' : 'Search by name, student # or certificate #…'} />
        <span className="um-count">{ar ? `${rows.length} سجل` : `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}</span>
      </div>

      {loading ? <Skeletons n={4} h={96} /> : error ? <Alert>{error}</Alert> : rows.length === 0 ? (
        <Empty
          icon={tab === 'graduated' ? 'award' : tab === 'revoked' ? 'x-circle' : 'users'}
          title={emptyText[tab]}
          text={q ? (ar ? 'جرّب كلمات بحث مختلفة.' : 'Try a different search.') : undefined}
        />
      ) : (
        <div className="um-stack">
          {rows.map((c) => {
            const tone = c.kind === 'eligible' ? 'warning' : c.kind === 'graduated' ? 'success' : 'danger';
            const busy = busyId === c.id;
            const hasGrade = c.grade && c.grade.total_score !== undefined && c.grade.total_score !== null;
            return (
              <article key={`${c.kind}-${c.id}`} className="gr-card" data-tone={tone}>
                <span className="gr-card__spine" aria-hidden="true" />
                <div className="gr-card__main">
                  <Mono name={c.name} hue={hueOf(c.id)} />
                  <div className="gr-card__info">
                    <h3 className="gr-card__name">{c.name}</h3>
                    <div className="gr-facts">
                      {c.kind === 'eligible' && (
                        <>
                          <Fact icon="user" label={ar ? 'الرقم الجامعي' : 'Student #'} value={c.number} mono />
                          <Fact icon="star" label={ar ? 'درجة المشروع' : 'Project grade'}
                            value={hasGrade ? `${c.grade.total_score}/${c.grade.max_score}${c.grade.letter_grade ? ` (${c.grade.letter_grade})` : ''}` : null} />
                          {!hasGrade && <span className="gr-fact gr-fact--muted"><Icon name="info" size={14} />{ar ? 'بدون درجة مشروع نهائية' : 'No finalized project grade'}</span>}
                        </>
                      )}
                      {c.kind === 'graduated' && (
                        <>
                          <Fact icon="award" label={ar ? 'رقم الشهادة' : 'Certificate #'} value={c.cert} mono />
                          <Fact icon="calendar" label={ar ? 'تاريخ التخرج' : 'Graduated'} value={c.date} />
                          <Fact icon="star" label={ar ? 'المعدل النهائي' : 'Final GPA'} value={c.gpa} />
                        </>
                      )}
                      {c.kind === 'revoked' && (
                        <>
                          <Fact icon="award" label={ar ? 'رقم الشهادة' : 'Certificate #'} value={c.cert} mono />
                          <Fact icon="calendar" label={ar ? 'تاريخ الإلغاء' : 'Revoked'} value={c.revokedAt} />
                        </>
                      )}
                    </div>
                    {c.kind === 'revoked' && c.reason && (
                      <p className="gr-reason"><Icon name="note" size={14} /><span><b>{ar ? 'السبب: ' : 'Reason: '}</b>{c.reason}</span></p>
                    )}
                  </div>
                </div>

                <div className="gr-card__acts">
                  {c.kind === 'eligible' && (
                    <Link to={`/university/graduation/${c.id}/review`} className="btn btn-primary">
                      <Icon name="check-circle" size={16} /> {t('Review & Approve')}
                    </Link>
                  )}
                  {c.kind === 'graduated' && (
                    <>
                      <a href={`/university/graduation/${c.id}/certificate`} target="_blank" rel="noreferrer" className="btn btn-outline">
                        <Icon name="award" size={16} /> {t('View Certificate')}
                      </a>
                      <Link to={`/university/graduation/${c.id}/edit`} className="btn btn-outline">
                        <Icon name="edit" size={16} /> {t('Edit Certificate')}
                      </Link>
                      <button type="button" className="btn btn-outline um-btn-danger" disabled={busy} onClick={() => setRevoking(c)}>
                        <Icon name="x-circle" size={16} /> {t('Revoke')}
                      </button>
                    </>
                  )}
                  {c.kind === 'revoked' && (
                    <>
                      <button type="button" className="btn um-btn-ok" disabled={busy} onClick={() => handleRestore(c.id)}>
                        <Icon name="refresh" size={16} /> {ar ? 'سحب الإلغاء' : 'Restore'}
                      </button>
                      <Link to={`/university/graduation/${c.id}/review`} className="btn btn-outline"
                        title={ar ? 'اعتماد من جديد بشهادة جديدة' : 'Re-approve with a new certificate'}>
                        <Icon name="award" size={16} /> {ar ? 'اعتماد جديد' : 'Re-approve'}
                      </Link>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {revoking && (
        <RevokeDialog
          ar={ar}
          name={revoking.name}
          busy={busyId === revoking.id}
          onCancel={() => setRevoking(null)}
          onConfirm={(reason) => handleRevoke(revoking.id, reason)}
        />
      )}
    </div>
  );
}
