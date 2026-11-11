import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { ConfirmModal } from '../../components/admin/adminUi';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/faq-intents';
import { Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Admin › Smart answers (FAQ intents) — Platform Admin only.
 * Same API as before (/api/v1/admin/faq-intents[/unmatched|/top-matched|/:id|/:id/active]);
 * only the presentation changed: Admin-portal look (KPIs, filter bar, adm-table),
 * a grouped dialog for create/edit, chip inputs for phrasings/keywords and a
 * live chat preview of the answer.
 */

const ROLES = [
  'student', 'university', 'admin',
  'security_admin', 'security_officer', 'data_analyst',
  'supervisor', 'academic_staff', 'faculty',
];

const sameKey = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '_');

/* ────────────────────────────────────────────────────────────────────────── */

export default function AdminFaqIntents() {
  const t = useTranslations(translations);
  const [view, setView] = useState('intents'); // intents | unmatched | top
  const [intents, setIntents] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [topMatched, setTopMatched] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null); // intent | {} (new) | null
  const [prefill, setPrefill] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const loadIntents = useCallback(() => api.get('/api/v1/admin/faq-intents').then((j) => setIntents(j.data || [])), []);
  const loadUnmatched = useCallback(() => api.get('/api/v1/admin/faq-intents/unmatched', { limit: 100 }).then((j) => setUnmatched(j.data || [])), []);
  const loadTop = useCallback(() => api.get('/api/v1/admin/faq-intents/top-matched').then((j) => setTopMatched(j.data || [])), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([loadIntents(), loadUnmatched(), loadTop()])
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadIntents, loadUnmatched, loadTop]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  const categories = useMemo(
    () => [...new Set(intents.map((i) => i.category).filter(Boolean))].sort(),
    [intents],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return intents.filter((i) => {
      if (category && i.category !== category) return false;
      if (status === 'active' && !i.is_active) return false;
      if (status === 'inactive' && i.is_active) return false;
      if (!q) return true;
      return (
        i.intent_key.toLowerCase().includes(q)
        || (i.category || '').toLowerCase().includes(q)
        || (i.question_ar || '').includes(search.trim())
        || (i.question_en || '').toLowerCase().includes(q)
      );
    });
  }, [intents, search, category, status]);

  const activeCount = intents.filter((i) => i.is_active).length;
  const totalHits = intents.reduce((s, i) => s + (Number(i.hit_count) || 0), 0);
  const hasFilters = Boolean(search || category || status);

  async function toggleActive(intent) {
    setActionError(null);
    setTogglingId(intent.id);
    try {
      await api.post(`/api/v1/admin/faq-intents/${intent.id}/active`, { is_active: !intent.is_active });
      await loadIntents();
      setNotice(intent.is_active ? t('Hidden from chats.') : t('Now answering chats.'));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setActionError(null);
    try {
      await api.del(`/api/v1/admin/faq-intents/${deleting.id}`);
      await loadIntents();
      setNotice(t('Deleted.'));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  function openCreate() { setPrefill(null); setEditing({}); }

  function createFromUnmatched(row) {
    const isAr = row.language === 'ar';
    setPrefill({
      question_ar: isAr ? row.sample_question : '',
      question_en: !isAr ? row.sample_question : '',
      role: row.role ? [row.role] : [],
      category: 'general',
    });
    setEditing({});
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Smart answers')}</h1>
          <p className="text-small">{t('Ready-made answers the AI Assistant sends instantly, before it ever calls the AI model.')}</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Icon name="plus" size={16} /> {t('New question')}
          </button>
        </div>
      </div>

      <div className="adm-kpis">
        <div className="adm-kpi">
          <div className="adm-kpi__top">{t('Total questions')} <Icon name="message-square" size={16} /></div>
          <div className="adm-kpi__value">{intents.length.toLocaleString()}</div>
          <div className="adm-kpi__note">{categories.length.toLocaleString()} {t('Category')}</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi__top">{t('Active')} <Icon name="check-circle" size={16} /></div>
          <div className="adm-kpi__value">{activeCount.toLocaleString()}</div>
          <div className="adm-kpi__note adm-kpi__note--good">{t('answering chats now')}</div>
        </div>
        <button type="button" className="adm-kpi" style={{ textAlign: 'start', cursor: 'pointer' }} onClick={() => setView('unmatched')}>
          <div className="adm-kpi__top">{t('Missed questions')} <Icon name="alert-triangle" size={16} /></div>
          <div className="adm-kpi__value">{unmatched.length.toLocaleString()}</div>
          <div className={`adm-kpi__note${unmatched.length ? ' adm-kpi__note--warn' : ''}`}>{t('asked but not answered')}</div>
        </button>
        <div className="adm-kpi">
          <div className="adm-kpi__top">{t('Answers served')} <Icon name="bot" size={16} /></div>
          <div className="adm-kpi__value">{totalHits.toLocaleString()}</div>
          <div className="adm-kpi__note">{t('saved an AI call each time')}</div>
        </div>
      </div>

      {notice && <p className="adm-note adm-note--ok" role="status" style={{ marginBottom: 12 }}><Icon name="check-circle" size={16} /> {notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {actionError && <p className="form-error">{actionError}</p>}

      <div className="adm-tabs" role="tablist">
        {[
          ['intents', t('Questions'), intents.length],
          ['unmatched', t('Missed'), unmatched.length],
          ['top', t('Most used'), null],
        ].map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key}
            className={`adm-tab${view === key ? ' is-active' : ''}`} onClick={() => setView(key)}>
            {label}{count !== null && <span className="faq-chip" style={{ marginInlineStart: 8 }}>{count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton rows={6} cols={4} />
      ) : view === 'intents' ? (
        <>
          <div className="adm-filters">
            <div className="adm-filters__search">
              <Icon name="search" size={16} />
              <input className="form-input" placeholder={t('Search by key, category or question…')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 190 }}>
              <option value="">{t('All categories')}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 170 }}>
              <option value="">{t('All statuses')}</option>
              <option value="active">{t('Active')}</option>
              <option value="inactive">{t('Inactive')}</option>
            </select>
            {hasFilters && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setCategory(''); setStatus(''); }}>
                {t('Clear filters')}
              </button>
            )}
          </div>
          <IntentsTable
            t={t} rows={filtered} total={intents.length} togglingId={togglingId}
            onCreate={openCreate} onEdit={setEditing} onToggle={toggleActive} onDelete={setDeleting}
          />
        </>
      ) : view === 'unmatched' ? (
        <UnmatchedTable t={t} rows={unmatched} onCreateIntent={createFromUnmatched} />
      ) : (
        <TopTable t={t} rows={topMatched} />
      )}

      {deleting && (
        <ConfirmModal
          title={t('Delete this question?')}
          message={`${deleting.intent_key} ${t('will be removed for good and the assistant will stop using it.')}`}
          confirmLabel={t('Delete question')}
          danger busy={deleteBusy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}

      {editing && (
        <IntentDialog
          intent={editing}
          prefill={prefill}
          categories={categories}
          onClose={() => { setEditing(null); setPrefill(null); }}
          onDone={async () => {
            setEditing(null);
            setPrefill(null);
            setNotice(t('Saved.'));
            await loadIntents();
          }}
        />
      )}
    </>
  );
}

/* ── Tables ───────────────────────────────────────────────────────────────── */

function EmptyState({ icon, title, text, action }) {
  return (
    <div className="faq-empty">
      <span className="faq-empty__icon"><Icon name={icon} size={20} /></span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

function RoleChips({ t, roles }) {
  if (!roles || roles.length === 0) return <span className="faq-chip">{t('Everyone')}</span>;
  const shown = roles.slice(0, 2);
  return (
    <div className="faq-chips">
      {shown.map((r) => <span key={r} className="faq-chip faq-chip--primary">{t(r)}</span>)}
      {roles.length > 2 && <span className="faq-chip" title={roles.map((r) => t(r)).join('، ')}>+{roles.length - 2}</span>}
    </div>
  );
}

function IntentsTable({ t, rows, total, togglingId, onCreate, onEdit, onToggle, onDelete }) {
  const maxHits = Math.max(1, ...rows.map((r) => Number(r.hit_count) || 0));
  if (total === 0) {
    return (
      <div className="adm-panel">
        <EmptyState icon="message-square" title={t('No questions yet')}
          text={t('Add the first ready-made answer so the assistant can reply without calling the AI model.')}
          action={<button type="button" className="btn btn-primary btn-sm" onClick={onCreate}><Icon name="plus" size={14} /> {t('New question')}</button>} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="adm-panel">
        <EmptyState icon="search" title={t('Nothing matches your filters')} text={t('Try a different word or clear the filters.')} />
      </div>
    );
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>{t('Question')}</th><th>{t('Category')}</th><th>{t('Audience')}</th>
            <th>{t('Priority')}</th><th>{t('Used')}</th><th>{t('Status')}</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const hits = Number(i.hit_count) || 0;
            return (
              <tr key={i.id} className={i.is_active ? '' : 'faq-row-off'}>
                <td>
                  <span className="faq-key">{i.intent_key}</span>
                  <span className="faq-q" dir="auto">{i.question_ar || i.question_en}</span>
                </td>
                <td><span className="badge badge-neutral">{i.category}</span></td>
                <td><RoleChips t={t} roles={i.role} /></td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{i.priority}</td>
                <td>
                  <div className="faq-hits">
                    <b>{hits.toLocaleString()}</b>
                    <span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${(hits / maxHits) * 100}%` }} /></span>
                  </div>
                </td>
                <td className="faq-keep">
                  <button type="button" role="switch" aria-checked={!!i.is_active} disabled={togglingId === i.id}
                    aria-label={i.is_active ? t('Turn off') : t('Turn on')} title={i.is_active ? t('Turn off') : t('Turn on')}
                    className={`faq-switch${i.is_active ? ' is-on' : ''}`} onClick={() => onToggle(i)} />
                </td>
                <td className="adm-actions">
                  <button type="button" className="btn btn-ghost btn-sm" title={t('Edit')} aria-label={t('Edit')} onClick={() => onEdit(i)}><Icon name="edit" size={16} /></button>
                  <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} aria-label={t('Delete')} onClick={() => onDelete(i)}><Icon name="trash" size={16} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function scoreClass(s) {
  if (s === null || s === undefined || s === '') return '';
  const n = Number(s);
  if (n >= 0.6) return 'faq-score--high';
  if (n >= 0.35) return 'faq-score--mid';
  return 'faq-score--low';
}

function UnmatchedTable({ t, rows, onCreateIntent }) {
  return (
    <>
      <div className="faq-banner">
        <Icon name="info" size={16} />
        <span>{t('Questions people asked that no ready-made answer matched, most frequent first. Turn a recurring one into a new question.')}</span>
      </div>
      {rows.length === 0 ? (
        <div className="adm-panel">
          <EmptyState icon="check-circle" title={t('No missed questions')} text={t('Every question so far found an answer or went to the AI model.')} />
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>{t('What they asked')}</th><th>{t('Language')}</th><th>{t('Role')}</th>
                <th>{t('Closest match')}</th><th>{t('Match')}</th><th>{t('Asked')}</th><th>{t('Last asked')}</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ maxWidth: 300 }} dir="auto">{r.sample_question}</td>
                  <td><span className="faq-chip">{String(r.language || '').toUpperCase() || '—'}</span></td>
                  <td>{r.role ? t(r.role) : <span className="adm-muted">{t('any')}</span>}</td>
                  <td>{r.best_candidate_key ? <span className="faq-key">{r.best_candidate_key}</span> : <span className="adm-muted">{t('none')}</span>}</td>
                  <td><span className={`faq-score ${scoreClass(r.best_candidate_score)}`}>{r.best_candidate_score ?? '—'}</span></td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{r.hit_count}</td>
                  <td className="adm-muted">{r.last_seen_at ? String(r.last_seen_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="adm-actions">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => onCreateIntent(r)}>
                      <Icon name="plus" size={14} /> {t('Add answer')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TopTable({ t, rows }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.hit_count) || 0));
  if (rows.length === 0) {
    return (
      <div className="adm-panel">
        <EmptyState icon="bar-chart" title={t('No answers served yet')} text={t('Usage appears here once the assistant answers from a ready-made question.')} />
      </div>
    );
  }
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr><th /><th>{t('Question')}</th><th>{t('Category')}</th><th className="is-num">{t('Used')}</th><th>{t('Last used')}</th><th>{t('Status')}</th></tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const hits = Number(r.hit_count) || 0;
            return (
              <tr key={r.intent_key}>
                <td className="is-rank">{idx + 1}</td>
                <td><span className="faq-key">{r.intent_key}</span></td>
                <td><span className="badge badge-neutral">{r.category}</span></td>
                <td className="is-num">
                  <div className="adm-share"><span className="adm-bar__track"><span className="adm-bar__fill" style={{ width: `${(hits / max) * 100}%` }} /></span><b>{hits.toLocaleString()}</b></div>
                </td>
                <td className="adm-muted">{r.last_hit_at ? String(r.last_hit_at).slice(0, 16).replace('T', ' ') : t('never')}</td>
                <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-neutral'}`}>{r.is_active ? t('Active') : t('Inactive')}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Chip list input ──────────────────────────────────────────────────────── */

/** Type a phrase + Enter. Pasting several lines adds one chip per line. */
function ChipListInput({ t, value, onChange, placeholder, dir, flagSingleWords, ariaLabel }) {
  const [draft, setDraft] = useState('');
  const ref = useRef(null);

  function commit(raw) {
    const parts = String(raw).split('\n').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    parts.forEach((p) => { if (!next.includes(p)) next.push(p); });
    onChange(next);
    setDraft('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  }

  return (
    <div className="faq-tags" onClick={() => ref.current?.focus()}>
      {value.map((v) => {
        const single = flagSingleWords && !v.includes('+');
        return (
          <span key={v} className={`faq-chip${single ? ' faq-chip--warn' : ''}`} title={single ? t('Single word — will not match alone') : undefined} dir={dir}>
            <span>{v}</span>
            <button type="button" aria-label={`${t('Remove')} ${v}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== v)); }}>
              <Icon name="x" size={12} />
            </button>
          </span>
        );
      })}
      <input
        ref={ref} dir={dir} value={draft} placeholder={value.length ? '' : placeholder} aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text.includes('\n')) { e.preventDefault(); commit(text); }
        }}
      />
    </div>
  );
}

/* ── Create / edit dialog ─────────────────────────────────────────────────── */

function Section({ icon, title, hint, children }) {
  return (
    <section className="faq-sec">
      <div className="faq-sec__head">
        <Icon name={icon} size={18} />
        <h3>{title}{hint && <small>{hint}</small>}</h3>
      </div>
      {children}
    </section>
  );
}

function IntentDialog({ intent, prefill, categories, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const isNew = !intent.id;
  const seed = prefill || intent;

  const [intentKey, setIntentKey] = useState(intent.intent_key || '');
  const [category, setCategory] = useState(seed.category || 'general');
  const [role, setRole] = useState(intent.role || seed.role || []);
  const [questionAr, setQuestionAr] = useState(seed.question_ar || '');
  const [questionEn, setQuestionEn] = useState(seed.question_en || '');
  const [answerAr, setAnswerAr] = useState(intent.answer_ar || '');
  const [answerEn, setAnswerEn] = useState(intent.answer_en || '');
  const [aliasesAr, setAliasesAr] = useState(intent.aliases_ar || []);
  const [aliasesEn, setAliasesEn] = useState(intent.aliases_en || []);
  const [aliasesMixed, setAliasesMixed] = useState(intent.aliases_mixed || []);
  const [keywords, setKeywords] = useState(intent.keywords || []);
  const [priority, setPriority] = useState(intent.priority ?? 0);
  const [threshold, setThreshold] = useState(Number(intent.confidence_threshold ?? 0.75));
  const [isActive, setIsActive] = useState(intent.is_active ?? true);
  const [previewLang, setPreviewLang] = useState(locale === 'ar' ? 'ar' : 'en');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const key = sameKey(intentKey);
  const noKey = !key;
  const noQuestion = !questionAr.trim() && !questionEn.trim();
  const noAnswer = !answerAr.trim() && !answerEn.trim();
  const invalid = noKey || noQuestion || noAnswer;
  const showErr = tried && invalid;

  const previewQ = previewLang === 'ar' ? (questionAr || questionEn) : (questionEn || questionAr);
  const previewA = previewLang === 'ar' ? (answerAr || answerEn) : (answerEn || answerAr);

  const toggleRole = (r) => setRole((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  async function handleSubmit(e) {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    setSaving(true);
    setError(null);
    const payload = {
      intent_key: key,
      category: category.trim() || 'general',
      role,
      question_ar: questionAr,
      question_en: questionEn,
      answer_ar: answerAr,
      answer_en: answerEn,
      aliases_ar: aliasesAr,
      aliases_en: aliasesEn,
      aliases_mixed: aliasesMixed,
      keywords,
      priority: Number(priority) || 0,
      confidence_threshold: Number(threshold),
      is_active: isActive,
    };
    try {
      if (isNew) await api.post('/api/v1/admin/faq-intents', payload);
      else await api.put(`/api/v1/admin/faq-intents/${intent.id}`, payload);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="faq-dialog" role="dialog" aria-modal="true" aria-labelledby="faq-dlg-title" noValidate
        onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>

        <header className="faq-dialog__head">
          <span className="faq-dialog__icon"><Icon name="sparkles" size={20} /></span>
          <div>
            <h2 id="faq-dlg-title">{isNew ? t('New ready-made answer') : `${t('Edit answer')} · ${intent.intent_key}`}</h2>
            <p>{t('Teach the assistant a question it should answer instantly, in Arabic, English or both.')}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm faq-dialog__close" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={18} /></button>
        </header>

        <div className="faq-dialog__body">
          {/* 1 — Basics */}
          <Section icon="note" title={t('Basics')} hint={t('A unique key and a category to keep things organised.')}>
            <div className="faq-grid faq-grid--key">
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-key">{t('Key')}</label>
                <input id="faq-key" ref={firstRef} className={`form-input faq-mono${showErr && noKey ? ' is-invalid' : ''}`} dir="ltr"
                  disabled={!isNew} placeholder="ADD_GRADUATION_PROJECT" value={intentKey} maxLength={80}
                  onChange={(e) => setIntentKey(e.target.value)} />
                {showErr && noKey
                  ? <p className="faq-hint faq-hint--error">{t('Key is required.')}</p>
                  : <p className="faq-hint">{isNew
                    ? (key && key !== intentKey ? <>{t('Will be saved as')} <code className="faq-mono">{key}</code></> : t('Unique and cannot be changed later. Spaces become underscores.'))
                    : t('Unique and cannot be changed later. Spaces become underscores.')}</p>}
              </div>
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-cat">{t('Category')}</label>
                <input id="faq-cat" className="form-input" dir="ltr" list="faq-cats" maxLength={60}
                  placeholder={t('Pick or type a category')} value={category} onChange={(e) => setCategory(e.target.value)} />
                <datalist id="faq-cats">{[...new Set(['general', ...categories])].map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
          </Section>

          {/* 2 — Audience */}
          <Section icon="users" title={t('Who can see it')} hint={t('Leave all roles unselected to answer everyone.')}>
            <div className="faq-roles" role="group" aria-label={t('Who can see it')}>
              <button type="button" aria-pressed={role.length === 0} className={`faq-role faq-role--all${role.length === 0 ? ' is-on' : ''}`} onClick={() => setRole([])}>
                <Icon name="globe" size={14} /> {t('Everyone')}
              </button>
              {ROLES.map((r) => (
                <button key={r} type="button" aria-pressed={role.includes(r)} className={`faq-role${role.includes(r) ? ' is-on' : ''}`} onClick={() => toggleRole(r)}>
                  {role.includes(r) && <Icon name="check" size={14} />} {t(r)}
                </button>
              ))}
            </div>
          </Section>

          {/* 3 — Question & answer */}
          <Section icon="message-square" title={t('Question and answer')} hint={t('Write in one language or both. Only the matching language is shown to the user.')}>
            <div className="faq-grid">
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-qar"><span><span className="faq-lang">AR</span>{t('Question (Arabic)')}</span><em>{questionAr.length}/500</em></label>
                <input id="faq-qar" className={`form-input${showErr && noQuestion ? ' is-invalid' : ''}`} dir="rtl" maxLength={500} value={questionAr} onChange={(e) => setQuestionAr(e.target.value)} />
              </div>
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-qen"><span><span className="faq-lang">EN</span>{t('Question (English)')}</span><em>{questionEn.length}/500</em></label>
                <input id="faq-qen" className={`form-input${showErr && noQuestion ? ' is-invalid' : ''}`} dir="ltr" maxLength={500} value={questionEn} onChange={(e) => setQuestionEn(e.target.value)} />
              </div>
            </div>
            <p className={`faq-either${showErr && noQuestion ? ' is-error' : ''}`}><Icon name="info" size={14} /> {t('Add at least one question, in Arabic or English.')}</p>

            <div className="faq-grid" style={{ marginTop: 16 }}>
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-aar"><span><span className="faq-lang">AR</span>{t('Answer (Arabic)')}</span><em>{answerAr.length} {t('characters')}</em></label>
                <textarea id="faq-aar" className={`form-input${showErr && noAnswer ? ' is-invalid' : ''}`} dir="rtl" value={answerAr} onChange={(e) => setAnswerAr(e.target.value)} />
              </div>
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-aen"><span><span className="faq-lang">EN</span>{t('Answer (English)')}</span><em>{answerEn.length} {t('characters')}</em></label>
                <textarea id="faq-aen" className={`form-input${showErr && noAnswer ? ' is-invalid' : ''}`} dir="ltr" value={answerEn} onChange={(e) => setAnswerEn(e.target.value)} />
              </div>
            </div>
            <p className={`faq-either${showErr && noAnswer ? ' is-error' : ''}`}><Icon name="info" size={14} /> {t('Add at least one answer, in Arabic or English.')}</p>
          </Section>

          {/* 4 — Matching */}
          <Section icon="ai-spark" title={t('How the assistant recognises it')} hint={t('Other ways people might ask the same thing. Type a phrase and press Enter.')}>
            <div className="faq-grid">
              <div className="faq-field">
                <span className="faq-field__label"><span><span className="faq-lang">AR</span>{t('Arabic phrasings')}</span><em>{aliasesAr.length}</em></span>
                <ChipListInput t={t} value={aliasesAr} onChange={setAliasesAr} dir="rtl" placeholder={t('Type a phrase and press Enter')} ariaLabel={t('Arabic phrasings')} />
              </div>
              <div className="faq-field">
                <span className="faq-field__label"><span><span className="faq-lang">EN</span>{t('English phrasings')}</span><em>{aliasesEn.length}</em></span>
                <ChipListInput t={t} value={aliasesEn} onChange={setAliasesEn} dir="ltr" placeholder={t('Type a phrase and press Enter')} ariaLabel={t('English phrasings')} />
              </div>
              <div className="faq-field">
                <span className="faq-field__label"><span>{t('Mixed Arabic / English and Arabizi')}</span><em>{aliasesMixed.length}</em></span>
                <ChipListInput t={t} value={aliasesMixed} onChange={setAliasesMixed} dir="auto" placeholder={t('Type a phrase and press Enter')} ariaLabel={t('Mixed Arabic / English and Arabizi')} />
              </div>
              <div className="faq-field">
                <span className="faq-field__label"><span>{t('Keywords')}</span><em>{keywords.length}</em></span>
                <ChipListInput t={t} value={keywords} onChange={setKeywords} dir="ltr" flagSingleWords placeholder={t('Type a keyword combination, e.g. add+project')} ariaLabel={t('Keywords')} />
                <p className="faq-hint">{t('Join words with + to require both, e.g. add+project. A single word never triggers a match by itself.')}</p>
              </div>
            </div>
          </Section>

          {/* 5 — Behaviour */}
          <Section icon="settings" title={t('Behaviour')} hint={t('Control how strictly the question must match and which answer wins a tie.')}>
            <div className="faq-grid">
              <div className="faq-field">
                <span className="faq-field__label">{t('Priority')}</span>
                <div className="faq-stepper">
                  <button type="button" aria-label="−" onClick={() => setPriority((p) => (Number(p) || 0) - 1)}>−</button>
                  <input type="number" dir="ltr" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={t('Priority')} />
                  <button type="button" aria-label="+" onClick={() => setPriority((p) => (Number(p) || 0) + 1)}>+</button>
                </div>
                <p className="faq-hint">{t('Higher wins when two answers match equally.')}</p>
              </div>
              <div className="faq-field">
                <label className="faq-field__label" htmlFor="faq-thr">{t('Match strictness')}</label>
                <div className="faq-range" dir="ltr">
                  <input id="faq-thr" type="range" min="0" max="1" step="0.01" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                  <b>{Math.round(threshold * 100)}%</b>
                </div>
                <p className="faq-hint">{t('Higher means fewer, more exact matches.')}</p>
              </div>
            </div>
            <div className="faq-active">
              <div><strong>{t('Answer chats')}</strong><span>{t('Turn off to keep it saved without using it.')}</span></div>
              <button type="button" role="switch" aria-checked={isActive} aria-label={t('Answer chats')} className={`faq-switch${isActive ? ' is-on' : ''}`} onClick={() => setIsActive((v) => !v)} />
            </div>
          </Section>

          {/* 6 — Preview */}
          <Section icon="eye" title={t('Preview')} hint={t('See how the assistant will reply.')}>
            <div className="faq-preview__bar">
              <div className="adm-seg" role="group">
                <button type="button" className={previewLang === 'ar' ? 'is-active' : ''} onClick={() => setPreviewLang('ar')}>العربية</button>
                <button type="button" className={previewLang === 'en' ? 'is-active' : ''} onClick={() => setPreviewLang('en')}>{t('English')}</button>
              </div>
            </div>
            <div className="faq-preview__stage" dir={previewLang === 'ar' ? 'rtl' : 'ltr'}>
              <div className={`faq-bubble faq-bubble--user${previewQ ? '' : ' faq-bubble--empty'}`}>{previewQ || t('Your question will appear here.')}</div>
              <div className={`faq-bubble faq-bubble--bot${previewA ? '' : ' faq-bubble--empty'}`}>
                <div className="faq-bot-tag"><Icon name="bot" size={14} /> {t('Assistant')}</div>
                {previewA || t('Your answer will appear here.')}
              </div>
            </div>
          </Section>
        </div>

        <footer className="faq-dialog__foot">
          <div className={`faq-dialog__status${error || showErr ? ' is-error' : !invalid ? ' is-ready' : ''}`} role="status">
            {error ? error
              : showErr ? <><Icon name="alert-triangle" size={14} /> {[noKey && t('Key is required.'), noQuestion && t('Add at least one question, in Arabic or English.'), noAnswer && t('Add at least one answer, in Arabic or English.')].filter(Boolean)[0]}</>
              : !invalid ? <><Icon name="check-circle" size={14} /> {t('Ready to save')}</> : null}
          </div>
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className={`btn btn-primary${saving ? ' is-loading' : ''}`} disabled={saving}>
            {isNew ? t('Save question') : t('Save changes')}
          </button>
        </footer>
      </form>
    </div>
  );
}
