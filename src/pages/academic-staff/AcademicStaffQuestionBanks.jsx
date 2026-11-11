import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead } from '../../components/staff/stfUi';
import { EmptyState, Skeleton, StModal } from '../../components/student/stUi';
import { ExKpi, fmtDate } from '../../components/exam/examUi';

/**
 * Question Banks workspace — GET/POST /api/v1/exam-system/question-banks,
 * PATCH/DELETE .../question-banks/{id}. Ownership is enforced server-side
 * (findOwnedBank), so the list only ever contains the signed-in doctor's banks.
 * Design: same Assessment-workspace language as the Exams page.
 */

const SORTS = [
  { key: 'latest', en: 'Latest Created', ar: 'الأحدث إنشاءً' },
  { key: 'questions', en: 'Most Questions', ar: 'الأكثر أسئلة' },
  { key: 'title', en: 'Title (A–Z)', ar: 'العنوان (أ–ي)' },
];

function BankModal({ bank, ar, onClose, onSaved }) {
  const isNew = !bank?.id;
  const [title, setTitle] = useState(bank?.title || '');
  const [subject, setSubject] = useState(bank?.subject || '');
  const [description, setDescription] = useState(bank?.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = { title: title.trim(), subject: subject.trim() || null, description: description.trim() || null };
    try {
      if (isNew) await api.post('/api/v1/exam-system/question-banks', payload);
      else await api.patch(`/api/v1/exam-system/question-banks/${bank.id}`, payload);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <StModal
      title={isNew ? (ar ? 'إنشاء بنك أسئلة' : 'Create Question Bank') : (ar ? 'تعديل بنك الأسئلة' : 'Edit Question Bank')}
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" form="bank-form" className="btn btn-primary" disabled={saving || !title.trim()}>{saving ? '…' : (ar ? 'حفظ البنك' : 'Save Bank')}</button>
        </>
      )}
    >
      <form id="bank-form" onSubmit={handleSubmit} className="st-stack">
        <div className="form-group">
          <label className="form-label">{ar ? 'العنوان' : 'Title'}</label>
          <input className="form-input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">{ar ? 'المقرر' : 'Subject'}</label>
          <input className="form-input" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{ar ? 'الوصف' : 'Description'}</label>
          <textarea className="form-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      </form>
    </StModal>
  );
}

function BankCard({ bank: b, ar, onEdit, onDelete }) {
  const archived = b.status === 'archived';
  const count = b.questions_count || 0;
  return (
    <article className={`st-pcard st-ecard xc-card xc-card--${archived ? 'draft' : 'completed'}`}>
      <div className="st-pcard__top">
        {b.subject ? <span className="st-tag">{b.subject}</span> : <span />}
        <span className={`ex-status ex-status--${archived ? 'idle' : 'live'}`}>{archived ? (ar ? 'مؤرشف' : 'Archived') : (ar ? 'نشط' : 'Active')}</span>
      </div>
      <div>
        <h3><Link to={`/academic-staff/question-banks/${b.id}`}>{b.title}</Link></h3>
        {b.description && <p className="xc-desc">{b.description}</p>}
      </div>
      <ul className="st-ecard__facts">
        <li><Icon name="layers" size={14} /><span>{count} {ar ? 'سؤال' : (count === 1 ? 'question' : 'questions')}</span></li>
        {b.created_at && <li><Icon name="calendar" size={14} /><span>{ar ? 'أُنشئ' : 'Created'} {fmtDate(b.created_at, ar)}</span></li>}
      </ul>
      <div className="st-pcard__actions xc-actions">
        <Link to={`/academic-staff/question-banks/${b.id}`} className="btn btn-primary btn-sm">{ar ? 'فتح البنك' : 'Open bank'}</Link>
        <span className="xc-tools">
          <button type="button" className="ex-icon-btn" onClick={() => onEdit(b)} title={ar ? 'تعديل' : 'Edit'} aria-label={ar ? 'تعديل' : 'Edit'}><Icon name="edit" size={15} /></button>
          <button type="button" className="ex-icon-btn ex-icon-btn--danger" onClick={() => onDelete(b)} title={ar ? 'حذف' : 'Delete'} aria-label={ar ? 'حذف' : 'Delete'}><Icon name="trash" size={15} /></button>
        </span>
      </div>
    </article>
  );
}

export default function AcademicStaffQuestionBanks() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const navigate = useNavigate();

  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editing, setEditing] = useState(null); // bank | {} (new) | null

  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [sort, setSort] = useState('latest');
  const [view, setViewState] = useState(() => {
    try { return localStorage.getItem('uip_banks_view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const setView = (v) => { setViewState(v); try { localStorage.setItem('uip_banks_view', v); } catch { /* storage unavailable */ } };

  const load = useCallback(() => api.get('/api/v1/exam-system/question-banks').then((json) => setBanks(json.data || [])), []);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  const subjects = useMemo(() => [...new Set(banks.map((b) => b.subject).filter(Boolean))].sort(), [banks]);

  const counts = useMemo(() => ({
    all: banks.length,
    active: banks.filter((b) => b.status !== 'archived').length,
    archived: banks.filter((b) => b.status === 'archived').length,
  }), [banks]);
  const totalQuestions = useMemo(() => banks.reduce((a, b) => a + (b.questions_count || 0), 0), [banks]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = banks.filter((b) => {
      if (tab === 'active' && b.status === 'archived') return false;
      if (tab === 'archived' && b.status !== 'archived') return false;
      if (subject && b.subject !== subject) return false;
      if (needle && !`${b.title} ${b.subject || ''} ${b.description || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const by = {
      latest: (a, b) => b.id - a.id,
      questions: (a, b) => (b.questions_count || 0) - (a.questions_count || 0),
      title: (a, b) => String(a.title).localeCompare(String(b.title), locale),
    };
    return [...list].sort(by[sort]);
  }, [banks, tab, q, subject, sort, locale]);

  async function handleDelete(bank) {
    if (!window.confirm(ar ? 'حذف بنك الأسئلة؟ سيتم حذف كل أسئلته نهائيًا.' : 'Delete this question bank? All its questions will be permanently deleted.')) return;
    setActionError(null);
    try {
      await api.del(`/api/v1/exam-system/question-banks/${bank.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading) return <div className="st-page"><Skeleton h={100} count={3} /></div>;

  const filtered = q || subject;
  const TABS = [['all', ar ? 'الكل' : 'All'], ['active', ar ? 'نشطة' : 'Active'], ['archived', ar ? 'مؤرشفة' : 'Archived']];

  return (
    <div className="ex-page">
      <StaffHead
        eyebrow={ar ? 'مساحة التقييم' : 'Assessment workspace'}
        title={ar ? 'بنوك الأسئلة' : 'Question Banks'}
        subtitle={ar ? 'نظّم أسئلتك في بنوك وأعد استخدامها في امتحاناتك.' : 'Organise your questions into banks and reuse them across exams.'}
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={16} /> {ar ? 'بنك جديد' : 'New Bank'}
          </button>
        )}
      />

      <div className="ex-kpis">
        <ExKpi label={ar ? 'إجمالي البنوك' : 'Total Banks'} value={counts.all} sub={ar ? 'كل بنوكك' : 'All your banks'} icon="layers" />
        <ExKpi label={ar ? 'إجمالي الأسئلة' : 'Total Questions'} value={totalQuestions} sub={ar ? 'عبر كل البنوك' : 'Across all banks'} icon="file" tone="good" />
        <ExKpi label={ar ? 'بنوك نشطة' : 'Active Banks'} value={counts.active} sub={ar ? 'متاحة للاستخدام' : 'Ready to use'} icon="check-circle" tone="good" />
        <ExKpi label={ar ? 'المقررات' : 'Subjects'} value={subjects.length} sub={ar ? 'مقررات مرتبطة' : 'Linked subjects'} icon="bookmark" tone="warn" />
      </div>

      {error && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {actionError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{actionError}</span></div>}

      <div className="st-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`st-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
            {label}<span className="st-tab__count">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="st-toolbar xc-toolbar">
        <label className="st-search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'ابحث بالعنوان أو المقرر…' : 'Search banks by title or subject…'} aria-label={ar ? 'بحث' : 'Search'} />
        </label>
        <select className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={ar ? 'المقرر' : 'Subject'}>
          <option value="">{ar ? 'كل المقررات' : 'All subjects'}</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={ar ? 'الترتيب' : 'Sort'}>
          {SORTS.map((x) => <option key={x.key} value={x.key}>{ar ? x.ar : x.en}</option>)}
        </select>
        <div className="xc-viewtoggle" role="group" aria-label={ar ? 'طريقة العرض' : 'View'}>
          <button type="button" className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')} aria-pressed={view === 'grid'} title={ar ? 'بطاقات' : 'Cards'}><Icon name="grid" size={15} /></button>
          <button type="button" className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'} title={ar ? 'قائمة' : 'List'}><Icon name="menu" size={15} /></button>
        </div>
      </div>

      {banks.length === 0 ? (
        <EmptyState icon="layers" title={ar ? 'أنشئ بنكًا لتبدأ بإضافة الأسئلة.' : 'Create a bank to start adding questions.'}>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} /> {ar ? 'بنك جديد' : 'New Bank'}</button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title={ar ? 'لا توجد بنوك مطابقة' : 'No banks match'} text={ar ? 'جرّب تغيير البحث أو التصنيف.' : 'Try a different search or filter.'}>
          {(filtered || tab !== 'all') && <button type="button" className="btn btn-outline" onClick={() => { setQ(''); setSubject(''); setTab('all'); }}>{ar ? 'مسح التصفية' : 'Clear filters'}</button>}
        </EmptyState>
      ) : view === 'grid' ? (
        <div className="st-cards st-ecards xc-grid">
          {shown.map((b) => <BankCard key={b.id} bank={b} ar={ar} onEdit={setEditing} onDelete={handleDelete} />)}
        </div>
      ) : (
        <div className="ex-card">
          <div className="ex-table-wrap">
            <table className="ex-table">
              <thead>
                <tr>
                  <th>{ar ? 'البنك' : 'Bank'}</th>
                  <th>{ar ? 'المقرر' : 'Subject'}</th>
                  <th>{ar ? 'الأسئلة' : 'Questions'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th className="is-end">{ar ? 'إجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id}>
                    <td style={{ minWidth: 220 }}>
                      <Link to={`/academic-staff/question-banks/${b.id}`} className="is-title">{b.title}</Link>
                      {b.description && <div className="is-muted xc-clip">{b.description}</div>}
                    </td>
                    <td className="is-muted">{b.subject || '—'}</td>
                    <td><span className="ex-inline"><Icon name="layers" size={14} />{b.questions_count || 0}</span></td>
                    <td>
                      <span className={`ex-status ex-status--${b.status === 'archived' ? 'idle' : 'live'}`}>{b.status === 'archived' ? (ar ? 'مؤرشف' : 'Archived') : (ar ? 'نشط' : 'Active')}</span>
                    </td>
                    <td className="is-end" style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="ex-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => navigate(`/academic-staff/question-banks/${b.id}`)}>{ar ? 'فتح' : 'Open'}</button>
                      <button type="button" className="ex-icon-btn" style={{ marginInlineStart: 8 }} onClick={() => setEditing(b)} title={ar ? 'تعديل' : 'Edit'} aria-label={ar ? 'تعديل' : 'Edit'}><Icon name="edit" size={15} /></button>
                      <button type="button" className="ex-icon-btn ex-icon-btn--danger" style={{ marginInlineStart: 8 }} onClick={() => handleDelete(b)} title={ar ? 'حذف' : 'Delete'} aria-label={ar ? 'حذف' : 'Delete'}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <BankModal bank={editing} ar={ar} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
