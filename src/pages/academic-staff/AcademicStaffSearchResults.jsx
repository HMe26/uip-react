import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { StaffHead } from '../../components/staff/stfUi';
import { EmptyState, Skeleton } from '../../components/student/stUi';

/**
 * Topbar search for the Academic Staff portal — GET /api/v1/academic-staff/search?q=
 * Results are limited server-side to the signed-in doctor's own exams, question
 * banks, questions, and the students who attempted those exams.
 */

const SECTIONS = [
  {
    key: 'exams', icon: 'file', en: 'Exams', ar: 'الامتحانات',
    to: (r) => `/academic-staff/exams/${r.id}`,
    title: (r) => r.title, meta: (r) => [r.subject, r.status].filter(Boolean).join(' · '),
  },
  {
    key: 'question_banks', icon: 'archive', en: 'Question Banks', ar: 'بنوك الأسئلة',
    to: (r) => `/academic-staff/question-banks/${r.id}`,
    title: (r) => r.title, meta: (r) => [r.subject, r.status].filter(Boolean).join(' · '),
  },
  {
    key: 'questions', icon: 'info', en: 'Questions', ar: 'الأسئلة',
    to: (r) => `/academic-staff/question-banks/${r.bank_id}`,
    title: (r) => r.prompt, meta: (r) => [r.bank_title, r.type, r.topic].filter(Boolean).join(' · '),
  },
  {
    key: 'students', icon: 'users', en: 'Students', ar: 'الطلاب',
    to: (r) => `/academic-staff/students-results?q=${encodeURIComponent(r.student_number || r.name)}`,
    title: (r) => r.name,
    meta: (r, ar) => [r.student_number, `${r.attempts} ${ar ? 'محاولة' : 'attempt(s)'}`].filter(Boolean).join(' · '),
  },
];

export default function AcademicStaffSearchResults() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [params] = useSearchParams();
  const q = (params.get('q') || '').trim();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setData(null); setError(null); return undefined; }
    let alive = true;
    setLoading(true);
    setError(null);
    api.get(`/api/v1/academic-staff/search?q=${encodeURIComponent(q)}`)
      .then((res) => { if (alive) setData(res.data || null); })
      .catch((err) => { if (alive) setError(errorMessage(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q]);

  const total = data ? SECTIONS.reduce((n, s) => n + (data[s.key]?.length || 0), 0) : 0;

  return (
    <div className="stf-page">
      <StaffHead
        title={ar ? 'نتائج البحث' : 'Search results'}
        subtitle={q ? (ar ? `نتائج «${q}»` : `Results for “${q}”`) : undefined}
      />

      {q.length < 2 && (
        <EmptyState icon="search" title={ar ? 'اكتب كلمتين على الأقل' : 'Type at least 2 characters'}
          text={ar ? 'ابحث في امتحاناتك وبنوك أسئلتك وطلابك.' : 'Search your exams, question banks and students.'} />
      )}
      {q.length >= 2 && loading && <Skeleton h={120} />}
      {error && <EmptyState icon="alert" title={ar ? 'تعذّر البحث' : 'Search failed'} text={error} />}
      {q.length >= 2 && !loading && !error && data && total === 0 && (
        <EmptyState icon="search" title={ar ? 'لا توجد نتائج' : 'No results'}
          text={ar ? 'جرّب كلمة مختلفة.' : 'Try a different keyword.'} />
      )}

      {!loading && data && SECTIONS.map((s) => {
        const rows = data[s.key] || [];
        if (!rows.length) return null;
        return (
          <section key={s.key} className="stf-card" style={{ marginBottom: 'var(--space-4)' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-md, 1rem)' }}>
              <Icon name={s.icon} size={16} /> {ar ? s.ar : s.en} <span style={{ opacity: 0.6 }}>({rows.length})</span>
            </h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((r) => (
                <li key={`${s.key}-${r.id}`} style={{ padding: '10px 0', borderTop: '1px solid var(--border, rgba(0,0,0,.08))' }}>
                  <Link to={s.to(r)} style={{ fontWeight: 600 }}>{s.title(r)}</Link>
                  <div style={{ fontSize: '0.85em', opacity: 0.7 }}>{s.meta(r, ar)}</div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
